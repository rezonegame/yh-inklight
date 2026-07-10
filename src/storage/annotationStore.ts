/**
 * [INPUT]: 依赖 obsidian App/Vault/Adapter 的文件读写能力，依赖 storage/types 的 sidecar JSON 合约
 * [OUTPUT]: 对外提供 AnnotationStore，负责 Markdown/PDF 的 .obsidian-annotations sidecar 文件、索引、缓存与导出
 * [POS]: storage 模块的唯一持久化入口，隔离原始 Markdown 与注释数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { App, normalizePath, Notice, TFile } from "obsidian";

import { createAnnotationUri } from "../links/annotationLink";
import {
  AnnotationIndex,
  AnnotationIndexEntry,
  AnnotationColor,
  AnnotationExportFormat,
  CommentAnnotation,
  EMPTY_INDEX,
  FileAnnotationDocument,
  HighlightAnnotation,
  PdfCommentAnnotation,
  PdfHighlightAnnotation,
  PdfReadingProgress,
  EpubHighlightAnnotation,
  EpubCommentAnnotation,
  EpubReadingProgress,
  EpubCfiAnchor,
  PdfAnchor,
  TextAnchor,
} from "./types";

const STORE_DIR = ".obsidian-annotations";
const INDEX_PATH = normalizePath(`${STORE_DIR}/index.json`);
const MAX_LEGACY_SIDECAR_NAME_LENGTH = 180;
const MAX_COMPACT_SIDECAR_PREFIX_LENGTH = 96;

interface ExportDocumentSource {
  filePath: string;
  document: FileAnnotationDocument;
}

interface ExportEntry {
  id: string;
  kind: "highlight" | "note";
  mode: "md" | "pdf" | "epub";
  sourcePath: string;
  color: AnnotationColor;
  text: string;
  content: string;
  createdAt: string;
  pageNumber: number | null;
  chapter?: string;
  cfiRange?: string;
  startOffset: number;
  pdfRects?: string;
}

export type StoredAnnotationTarget = {
  filePath: string;
  id: string;
  mode: "md" | "pdf" | "epub";
  anchor: TextAnchor | PdfAnchor | EpubCfiAnchor;
};

export class AnnotationStoreReadError extends Error {
  constructor(readonly path: string, readonly originalError: unknown) {
    super(`Failed to read annotation sidecar JSON: ${path}`);
    this.name = "AnnotationStoreReadError";
  }
}

export class AnnotationStoreWriteError extends Error {
  constructor(readonly path: string, readonly originalError: unknown) {
    super(`Failed to write annotation sidecar JSON: ${path}`);
    this.name = "AnnotationStoreWriteError";
  }
}

export class AnnotationStore {
  private readonly documents = new Map<string, FileAnnotationDocument>();
  private readonly documentWrites = new Map<string, Promise<unknown>>();
  private indexWriteTail: Promise<unknown> = Promise.resolve();
  private index: AnnotationIndex = EMPTY_INDEX;
  private changeVersion = 0;

  constructor(private readonly app: App) {}

  get version(): number {
    return this.changeVersion;
  }

  async initialize(): Promise<void> {
    await this.ensureStoreDir();
    this.index = await this.readJson<AnnotationIndex>(INDEX_PATH, EMPTY_INDEX, { allowCorruptFallback: true });
  }

  getCachedDocument(filePath: string): FileAnnotationDocument | null {
    return this.documents.get(this.toCacheKey(filePath)) ?? null;
  }

  async getIndexedDocuments(): Promise<FileAnnotationDocument[]> {
    const documents: FileAnnotationDocument[] = [];
    const filePaths = Object.keys(this.index.files).sort((left, right) => left.localeCompare(right));

    for (const filePath of filePaths) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) {
        continue;
      }

      documents.push(await this.getDocument(file));
    }

    return documents;
  }

  async getDocument(file: TFile): Promise<FileAnnotationDocument> {
    const filePath = this.normalizeVaultPath(file.path);
    const cacheKey = this.toCacheKey(filePath);
    const cached = this.documents.get(cacheKey);
    if (cached) {
      return cached;
    }

    const sidecarPath = this.toSidecarPath(filePath);
    const fallback = await this.createEmptyDocument(file);
    const document = await this.readJson<FileAnnotationDocument>(sidecarPath, fallback);
    this.documents.set(cacheKey, this.normalizeDocument(document, filePath));
    return this.documents.get(cacheKey)!;
  }

  async saveDocument(document: FileAnnotationDocument): Promise<void> {
    await this.enqueueDocument(document.filePath, () => this.persistDocument(document));
  }

  async mutateDocument(
    file: TFile,
    updater: (document: FileAnnotationDocument) => FileAnnotationDocument,
  ): Promise<FileAnnotationDocument> {
    return this.enqueueDocument(file.path, async () => {
      const document = await this.getDocument(file);
      const nextDocument = updater(document);
      await this.persistDocument(nextDocument);
      return this.getCachedDocument(file.path) ?? nextDocument;
    });
  }

  async findAnnotationTarget(filePath: string, annotationId: string): Promise<StoredAnnotationTarget | null> {
    const file = this.app.vault.getAbstractFileByPath(this.normalizeVaultPath(filePath));
    if (!(file instanceof TFile)) {
      return null;
    }
    return this.findTargetInDocument(file.path, await this.getDocument(file), annotationId);
  }

  async findAnnotationTargets(annotationId: string): Promise<StoredAnnotationTarget[]> {
    const results: StoredAnnotationTarget[] = [];
    for (const filePath of Object.keys(this.index.files)) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) {
        continue;
      }
      const target = this.findTargetInDocument(file.path, await this.getDocument(file), annotationId);
      if (target) {
        results.push(target);
      }
    }
    return results;
  }

  private async persistDocument(document: FileAnnotationDocument): Promise<void> {
    const filePath = this.normalizeVaultPath(document.filePath);
    const sidecarPath = this.toSidecarPath(filePath);
    const normalized = this.normalizeDocument(document, filePath);

    try {
      await this.ensureStoreDir();
      await this.app.vault.adapter.write(sidecarPath, JSON.stringify(normalized, null, 2));
      const persisted = await this.readExistingJson<FileAnnotationDocument>(sidecarPath);
      this.verifyPersistedDocument(normalized, persisted, sidecarPath);
      await this.enqueueIndexWrite(async () => {
        const nextIndex: AnnotationIndex = {
          ...this.index,
          files: {
            ...this.index.files,
            [normalized.filePath]: this.toIndexEntry(normalized, sidecarPath),
          },
        };
        await this.writeIndex(nextIndex);
        this.index = nextIndex;
      });
    } catch (error) {
      new Notice(`墨光批注未保存，请检查写入权限或同步状态：${sidecarPath}`);
      throw new AnnotationStoreWriteError(sidecarPath, error);
    }

    this.documents.set(this.toCacheKey(normalized.filePath), normalized);
    this.changeVersion += 1;
  }

  async addHighlight(file: TFile, highlight: HighlightAnnotation): Promise<FileAnnotationDocument> {
    return this.mutateDocument(file, (document) => ({
      ...document,
      highlights: [...document.highlights, highlight].sort((a, b) => a.anchor.startOffset - b.anchor.startOffset),
      lastModified: new Date().toISOString(),
    }));
  }

  async addComment(file: TFile, comment: CommentAnnotation): Promise<FileAnnotationDocument> {
    return this.mutateDocument(file, (document) => ({
      ...document,
      comments: [...document.comments, comment].sort((a, b) => a.anchor.startOffset - b.anchor.startOffset),
      lastModified: new Date().toISOString(),
    }));
  }

  async addPdfHighlight(file: TFile, highlight: PdfHighlightAnnotation): Promise<FileAnnotationDocument> {
    return this.mutateDocument(file, (document) => ({
      ...document,
      pdfHighlights: [...document.pdfHighlights, highlight].sort((a, b) => a.anchor.pageNumber - b.anchor.pageNumber),
      lastModified: new Date().toISOString(),
    }));
  }

  async addPdfComment(file: TFile, comment: PdfCommentAnnotation): Promise<FileAnnotationDocument> {
    return this.mutateDocument(file, (document) => ({
      ...document,
      pdfComments: [...document.pdfComments, comment].sort((a, b) => a.anchor.pageNumber - b.anchor.pageNumber),
      lastModified: new Date().toISOString(),
    }));
  }

  async updatePdfComment(file: TFile, comment: PdfCommentAnnotation): Promise<FileAnnotationDocument> {
    return this.mutateDocument(file, (document) => ({
      ...document,
      pdfComments: document.pdfComments.map((item) => (item.id === comment.id ? comment : item)),
      lastModified: new Date().toISOString(),
    }));
  }

  async updateComment(file: TFile, comment: CommentAnnotation): Promise<FileAnnotationDocument> {
    return this.mutateDocument(file, (document) => ({
      ...document,
      comments: document.comments.map((item) => (item.id === comment.id ? comment : item)),
      lastModified: new Date().toISOString(),
    }));
  }

  async updateCommentContent(
    file: TFile,
    commentId: string,
    content: string,
    title?: string,
  ): Promise<FileAnnotationDocument> {
    const now = new Date().toISOString();
    return this.mutateDocument(file, (document) => ({
      ...document,
      comments: document.comments.map((item) => {
        if (item.id !== commentId) {
          return item;
        }

        return {
          ...item,
          title,
          content,
          updatedAt: now,
        };
      }),
      lastModified: now,
    }));
  }

  async updatePdfCommentContent(
    file: TFile,
    commentId: string,
    content: string,
    title?: string,
  ): Promise<FileAnnotationDocument> {
    const now = new Date().toISOString();
    return this.mutateDocument(file, (document) => ({
      ...document,
      pdfComments: document.pdfComments.map((item) => {
        if (item.id !== commentId) {
          return item;
        }

        return {
          ...item,
          title,
          content,
          updatedAt: now,
        };
      }),
      lastModified: now,
    }));
  }

  async removeAnnotation(file: TFile, annotationId: string): Promise<FileAnnotationDocument> {
    return this.mutateDocument(file, (document) => ({
      ...document,
      highlights: document.highlights.filter((item) => item.id !== annotationId),
      comments: document.comments.filter((item) => item.id !== annotationId),
      pdfHighlights: document.pdfHighlights.filter((item) => item.id !== annotationId),
      pdfComments: document.pdfComments.filter((item) => item.id !== annotationId),
      epubHighlights: document.epubHighlights.filter((item) => item.id !== annotationId),
      epubComments: document.epubComments.filter((item) => item.id !== annotationId),
      lastModified: new Date().toISOString(),
    }));
  }

  async migrateFilePath(oldPath: string, file: TFile): Promise<void> {
    const normalizedOldPath = this.normalizeVaultPath(oldPath);
    const oldSidecar = this.toSidecarPath(normalizedOldPath);
    const oldDocument = await this.readJson<FileAnnotationDocument | null>(oldSidecar, null);
    if (!oldDocument) {
      return;
    }

    const nextDocument: FileAnnotationDocument = {
      ...oldDocument,
      filePath: this.normalizeVaultPath(file.path),
      fileHash: await this.hashFile(file),
      lastModified: new Date().toISOString(),
    };

    await this.saveDocument(nextDocument);
    await this.deleteIfExists(oldSidecar);
    await this.enqueueIndexWrite(async () => {
      const files = { ...this.index.files };
      delete files[normalizedOldPath];
      const nextIndex = { ...this.index, files };
      await this.writeIndex(nextIndex);
      this.index = nextIndex;
    });
    this.documents.delete(this.toCacheKey(normalizedOldPath));

    // 同步迁移摘录导出文件（*-notes.md / 《名》摘录.md）：更新内部 source 路径引用 + 重命名文件。
    await this.migrateExcerptFile(normalizedOldPath, this.normalizeVaultPath(file.path));
  }

  /**
   * 重命名/移动源文件后，把对应的摘录导出文件一并迁移：
   * 1. 文件名从旧 basename 派生改为新 basename 派生（兼容 {-notes.md} 与 《名》摘录.md 两种历史格式）；
   * 2. 文件内容里所有指向旧路径的 source 引用（标题、[[wikilink]]、data-yh-source-path）替换为新路径。
   * 摘录文件不存在时静默跳过。
   */
  private async migrateExcerptFile(oldPath: string, newPath: string): Promise<void> {
    if (oldPath === newPath) {
      return;
    }
    const oldBase = oldPath.replace(/\.[^.]+$/, "");
    const newBase = newPath.replace(/\.[^.]+$/, "");
    const oldParent = oldPath.split(/[\\/]/).slice(0, -1).join("/") || "/";
    const newParent = newPath.split(/[\\/]/).slice(0, -1).join("/") || "/";
    // 候选文件名：v0.16.3 起统一 {basename}-notes.md；早期为 《basename》摘录.md
    const candidates = [
      `${oldBase.split(/[\\/]/).pop()}-notes.md`,
      `《${oldBase.split(/[\\/]/).pop()}》摘录.md`,
    ];
    for (const candidate of candidates) {
      const candidatePath = normalizePath(`${oldParent}/${candidate}`);
      const excerptFile = this.app.vault.getAbstractFileByPath(candidatePath);
      if (!(excerptFile instanceof TFile)) {
        continue;
      }
      try {
        const content = await this.app.vault.read(excerptFile);
        // 替换内容中所有旧路径引用（标题、wikilink、hidden anchor）
        const updated = content
          .split(oldPath).join(newPath)
          .split(encodeURIComponent(oldPath)).join(encodeURIComponent(newPath));
        const newName = candidate.replace(oldBase.split(/[\\/]/).pop()!, newBase.split(/[\\/]/).pop()!);
        const targetPath = normalizePath(`${newParent}/${newName}`);
        if (updated !== content) {
          await this.app.vault.modify(excerptFile, updated);
        }
        if (targetPath !== candidatePath && !this.app.vault.getAbstractFileByPath(targetPath)) {
          await this.app.vault.rename(excerptFile, targetPath);
        }
      } catch (error) {
        console.warn("yh-inklight: migrate excerpt file failed", candidatePath, error);
      }
    }
  }

  // ===== EPUB 标注 CRUD =====

  async addEpubHighlight(file: TFile, highlight: EpubHighlightAnnotation): Promise<FileAnnotationDocument> {
    return this.mutateDocument(file, (document) => ({
      ...document,
      epubHighlights: [...document.epubHighlights, highlight],
      lastModified: new Date().toISOString(),
    }));
  }

  async addEpubComment(file: TFile, comment: EpubCommentAnnotation): Promise<FileAnnotationDocument> {
    return this.mutateDocument(file, (document) => ({
      ...document,
      epubComments: [...document.epubComments, comment],
      lastModified: new Date().toISOString(),
    }));
  }

  async updateEpubComment(file: TFile, comment: EpubCommentAnnotation): Promise<FileAnnotationDocument> {
    return this.mutateDocument(file, (document) => ({
      ...document,
      epubComments: document.epubComments.map((item) => (item.id === comment.id ? comment : item)),
      lastModified: new Date().toISOString(),
    }));
  }

  // ===== EPUB 进度 =====

  async getEpubProgress(file: TFile): Promise<EpubReadingProgress | null> {
    const document = await this.getDocument(file);
    return document.epubProgress ?? null;
  }

  async saveEpubProgress(file: TFile, progress: EpubReadingProgress): Promise<void> {
    await this.mutateDocument(file, (document) => ({
      ...document,
      epubProgress: progress,
      lastModified: new Date().toISOString(),
    }));
  }
  // ===== PDF 进度 =====

  async getPdfProgress(file: TFile): Promise<PdfReadingProgress | null> {
    const document = await this.getDocument(file);
    return document.pdfProgress ?? null;
  }

  async savePdfProgress(file: TFile, progress: PdfReadingProgress): Promise<void> {
    await this.mutateDocument(file, (document) => ({
      ...document,
      pdfProgress: progress,
      lastModified: new Date().toISOString(),
    }));
  }

  // ===== 书签（EPUB/PDF 通用）=====

  async exportNotes(file: TFile, format: AnnotationExportFormat = "summary"): Promise<TFile> {
    const document = await this.getDocument(file);
    const baseName = file.basename || file.name.replace(/\.md$/i, "");
    const suffix = format === "summary" ? "" : `-${format}`;
    const targetPath = normalizePath(`${file.parent?.path ?? ""}/${baseName}-notes${suffix}.md`);
    const lines = buildExportLines(`Notes for ${file.path}`, [{ filePath: file.path, document }], format);

    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, lines.join("\n"));
      return existing;
    }

    return this.app.vault.create(targetPath, lines.join("\n"));
  }

  async exportAllNotes(format: AnnotationExportFormat = "summary"): Promise<TFile> {
    const documents = await this.getIndexedDocuments();
    const suffix = format === "summary" ? "" : `-${format}`;
    const targetPath = normalizePath(`inklight-all-notes${suffix}.md`);
    const sources = documents.map((document) => ({ filePath: document.filePath, document }));
    const lines = buildExportLines("墨光批注全库汇总", sources, format);

    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, lines.join("\n"));
      return existing;
    }

    return this.app.vault.create(targetPath, lines.join("\n"));
  }

  async testWriteAccess(): Promise<string> {
    await this.ensureStoreDir();
    const testPath = normalizePath(`${STORE_DIR}/.write-test.json`);
    const payload = JSON.stringify({ ok: true, timestamp: new Date().toISOString() }, null, 2);

    try {
      await this.app.vault.adapter.write(testPath, payload);
      const persisted = await this.app.vault.adapter.read(testPath);
      if (persisted !== payload) {
        throw new Error("Write test content mismatch");
      }
      await this.deleteIfExists(testPath);
      return testPath;
    } catch (error) {
      new Notice(`墨光批注存储测试失败：${testPath}`);
      throw new AnnotationStoreWriteError(testPath, error);
    }
  }


  async hashFile(file: TFile): Promise<string> {
    if (file.extension === "md") {
      return this.hashString(await this.app.vault.cachedRead(file));
    }

    const bytes = await this.app.vault.readBinary(file);
    return this.hashBytes(bytes);
  }

  toSidecarPath(filePath: string): string {
    const legacyPath = this.toLegacySidecarPath(filePath);
    const legacyName = legacyPath.split("/").pop() ?? "";
    if (legacyName.length <= MAX_LEGACY_SIDECAR_NAME_LENGTH) {
      return legacyPath;
    }

    return this.toCompactSidecarPath(filePath);
  }

  private toLegacySidecarPath(filePath: string): string {
    const safeName = this.normalizeVaultPath(filePath)
      .toLowerCase()
      .split(/[\\/]/)
      .map((part) => encodeURIComponent(part))
      .join("__");
    return normalizePath(`${STORE_DIR}/${safeName}.json`);
  }

  private toCompactSidecarPath(filePath: string): string {
    const normalizedPath = this.normalizeVaultPath(filePath).toLowerCase();
    const fileName = normalizedPath.split(/[\\/]/).pop() ?? "annotation";
    const encodedName = encodeURIComponent(fileName).replace(/%/g, "_").replace(/[^a-z0-9._-]/g, "_");
    const prefix = encodedName.slice(0, MAX_COMPACT_SIDECAR_PREFIX_LENGTH).replace(/[._-]+$/g, "") || "annotation";
    return normalizePath(`${STORE_DIR}/${prefix}--${hashPath(normalizedPath)}.json`);
  }

  private async createEmptyDocument(file: TFile): Promise<FileAnnotationDocument> {
    return {
      filePath: this.normalizeVaultPath(file.path),
      fileHash: await this.hashFile(file),
      lastModified: new Date().toISOString(),
      highlights: [],
      comments: [],
      pdfHighlights: [],
      pdfComments: [],
      epubHighlights: [],
      epubComments: [],
      bookmarks: [],
      canvasNodes: [],
    };
  }

  private normalizeDocument(document: FileAnnotationDocument, filePath: string): FileAnnotationDocument {
    return {
      ...document,
      filePath,
      fileHash: document.fileHash ?? "",
      lastModified: document.lastModified ?? new Date().toISOString(),
      highlights: document.highlights ?? [],
      comments: document.comments ?? [],
      pdfHighlights: document.pdfHighlights ?? [],
      pdfComments: document.pdfComments ?? [],
      epubHighlights: document.epubHighlights ?? [],
      epubComments: document.epubComments ?? [],
      epubProgress: document.epubProgress,
      pdfProgress: document.pdfProgress,
      bookmarks: document.bookmarks ?? [],
      canvasBinding: document.canvasBinding,
      canvasNodes: document.canvasNodes ?? [],
    };
  }

  private toIndexEntry(document: FileAnnotationDocument, sidecarPath: string): AnnotationIndexEntry {
    return {
      filePath: document.filePath,
      sidecarPath,
      fileHash: document.fileHash,
      highlightCount: document.highlights.length + document.pdfHighlights.length,
      commentCount: document.comments.length + document.pdfComments.length,
      epubHighlightCount: document.epubHighlights.length,
      epubCommentCount: document.epubComments.length,
      bookmarkCount: document.bookmarks.length,
      updatedAt: document.lastModified,
    };
  }

  private async ensureStoreDir(): Promise<void> {
    await this.ensureDir(STORE_DIR);
  }

  private async ensureDir(path: string): Promise<void> {
    const normalizedPath = normalizePath(path);
    if (!(await this.app.vault.adapter.exists(normalizedPath))) {
      await this.app.vault.adapter.mkdir(normalizedPath);
    }
  }

  private async writeIndex(nextIndex: AnnotationIndex = this.index): Promise<void> {
    await this.ensureStoreDir();
    await this.app.vault.adapter.write(INDEX_PATH, JSON.stringify(nextIndex, null, 2));
  }

  private verifyPersistedDocument(expected: FileAnnotationDocument, persisted: FileAnnotationDocument, sidecarPath: string): void {
    const normalizedPersisted = this.normalizeDocument(persisted, expected.filePath);
    const countsMatch =
      normalizedPersisted.highlights.length === expected.highlights.length &&
      normalizedPersisted.comments.length === expected.comments.length &&
      normalizedPersisted.pdfHighlights.length === expected.pdfHighlights.length &&
      normalizedPersisted.pdfComments.length === expected.pdfComments.length &&
      normalizedPersisted.epubHighlights.length === expected.epubHighlights.length &&
      normalizedPersisted.epubComments.length === expected.epubComments.length &&
      normalizedPersisted.bookmarks.length === expected.bookmarks.length;

    if (
      normalizedPersisted.filePath !== expected.filePath ||
      normalizedPersisted.lastModified !== expected.lastModified ||
      !countsMatch
    ) {
      throw new Error(`Persisted sidecar verification failed: ${sidecarPath}`);
    }
  }

  private async readJson<T>(
    path: string,
    fallback: T,
    options: { allowCorruptFallback?: boolean } = {},
  ): Promise<T> {
    const normalizedPath = normalizePath(path);
    if (!(await this.app.vault.adapter.exists(normalizedPath))) {
      return fallback;
    }

    try {
      return JSON.parse(await this.app.vault.adapter.read(normalizedPath)) as T;
    } catch (error) {
      if (options.allowCorruptFallback) {
        return fallback;
      }
      new Notice(`墨光批注无法读取 ${normalizedPath}，已停止写入以保护批注数据。`);
      throw new AnnotationStoreReadError(normalizedPath, error);
    }
  }

  private async readExistingJson<T>(path: string): Promise<T> {
    const normalizedPath = normalizePath(path);
    if (!(await this.app.vault.adapter.exists(normalizedPath))) {
      throw new Error(`Expected JSON file does not exist: ${normalizedPath}`);
    }

    return JSON.parse(await this.app.vault.adapter.read(normalizedPath)) as T;
  }

  private async deleteIfExists(path: string): Promise<void> {
    const normalizedPath = normalizePath(path);
    if (await this.app.vault.adapter.exists(normalizedPath)) {
      await this.app.vault.adapter.remove(normalizedPath);
    }
  }

  private enqueueDocument<T>(filePath: string, task: () => Promise<T>): Promise<T> {
    const key = this.toCacheKey(filePath);
    const previous = this.documentWrites.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    const tail = next.then(() => undefined, () => undefined);
    this.documentWrites.set(key, tail);
    void tail.then(() => {
      if (this.documentWrites.get(key) === tail) {
        this.documentWrites.delete(key);
      }
    });
    return next;
  }

  private enqueueIndexWrite<T>(task: () => Promise<T>): Promise<T> {
    const next = this.indexWriteTail.catch(() => undefined).then(task);
    this.indexWriteTail = next.then(() => undefined, () => undefined);
    return next;
  }

  private findTargetInDocument(
    filePath: string,
    document: FileAnnotationDocument,
    annotationId: string,
  ): StoredAnnotationTarget | null {
    const markdown = document.highlights.find((item) => item.id === annotationId) ?? document.comments.find((item) => item.id === annotationId);
    if (markdown) {
      return { filePath, id: annotationId, mode: "md", anchor: markdown.anchor };
    }
    const pdf = document.pdfHighlights.find((item) => item.id === annotationId) ?? document.pdfComments.find((item) => item.id === annotationId);
    if (pdf) {
      return { filePath, id: annotationId, mode: "pdf", anchor: pdf.anchor };
    }
    const epub = document.epubHighlights.find((item) => item.id === annotationId) ?? document.epubComments.find((item) => item.id === annotationId);
    return epub ? { filePath, id: annotationId, mode: "epub", anchor: epub.anchor } : null;
  }

  private normalizeVaultPath(filePath: string): string {
    return normalizePath(filePath);
  }

  private toCacheKey(filePath: string): string {
    return this.normalizeVaultPath(filePath).toLowerCase();
  }

  private async hashString(content: string): Promise<string> {
    return this.hashBytes(new TextEncoder().encode(content));
  }

  private async hashBytes(bytes: BufferSource): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
}

function hashPath(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildExportLines(
  title: string,
  sources: ExportDocumentSource[],
  format: AnnotationExportFormat,
): string[] {
  const entries = sources.flatMap((source) => collectExportEntries(source));
  const lines = [`# ${title}`, "", `Exported: ${new Date().toISOString()}`, ""];

  if (!entries.length) {
    return [...lines, "No annotations found.", ""];
  }

  if (format === "by-color") {
    return [...lines, ...renderByColor(entries)];
  }

  if (format === "notes-only") {
    return [...lines, ...renderNotesOnly(entries)];
  }

  if (format === "reading-notes") {
    return [...lines, ...renderReadingNotes(entries)];
  }

  return [...lines, ...renderSummary(entries)];
}

function collectExportEntries(source: ExportDocumentSource): ExportEntry[] {
  return [
    ...source.document.highlights.map((highlight): ExportEntry => ({
      id: highlight.id,
      kind: "highlight",
      mode: "md",
      sourcePath: source.filePath,
      color: highlight.color,
      text: highlight.anchor.selectedText,
      content: "",
      createdAt: highlight.createdAt,
      pageNumber: null,
      startOffset: highlight.anchor.startOffset,
    })),
    ...source.document.comments.map((comment): ExportEntry => ({
      id: comment.id,
      kind: "note",
      mode: "md",
      sourcePath: source.filePath,
      color: comment.color,
      text: comment.anchor.selectedText,
      content: comment.content,
      createdAt: comment.updatedAt || comment.createdAt,
      pageNumber: null,
      startOffset: comment.anchor.startOffset,
    })),
    ...source.document.pdfHighlights.map((highlight): ExportEntry => ({
      id: highlight.id,
      kind: "highlight",
      mode: "pdf",
      sourcePath: source.filePath,
      color: highlight.color,
      text: highlight.anchor.selectedText,
      content: "",
      createdAt: highlight.createdAt,
      pageNumber: highlight.anchor.pageNumber,
      startOffset: Number.MAX_SAFE_INTEGER,
      pdfRects: JSON.stringify(highlight.anchor.rects),
    })),
    ...source.document.pdfComments.map((comment): ExportEntry => ({
      id: comment.id,
      kind: "note",
      mode: "pdf",
      sourcePath: source.filePath,
      color: comment.color,
      text: comment.anchor.selectedText,
      content: comment.content,
      createdAt: comment.updatedAt || comment.createdAt,
      pageNumber: comment.anchor.pageNumber,
      startOffset: Number.MAX_SAFE_INTEGER,
      pdfRects: JSON.stringify(comment.anchor.rects),
    })),
    ...source.document.epubHighlights.map((highlight): ExportEntry => ({
      id: highlight.id,
      kind: "highlight",
      mode: "epub",
      sourcePath: source.filePath,
      color: highlight.color,
      text: highlight.anchor.selectedText,
      content: "",
      createdAt: highlight.createdAt,
      pageNumber: null,
      chapter: highlight.anchor.chapter,
      cfiRange: highlight.anchor.cfiRange,
      startOffset: Number.MAX_SAFE_INTEGER,
    })),
    ...source.document.epubComments.map((comment): ExportEntry => ({
      id: comment.id,
      kind: "note",
      mode: "epub",
      sourcePath: source.filePath,
      color: comment.color,
      text: comment.anchor.selectedText,
      content: comment.note,
      createdAt: comment.createdAt,
      pageNumber: null,
      chapter: comment.anchor.chapter,
      cfiRange: comment.anchor.cfiRange,
      startOffset: Number.MAX_SAFE_INTEGER,
    })),
  ].sort((left, right) => {
    return left.sourcePath.localeCompare(right.sourcePath) || left.startOffset - right.startOffset;
  });
}

function renderSummary(entries: ExportEntry[]): string[] {
  const highlights = entries.filter((entry) => entry.kind === "highlight");
  const notes = entries.filter((entry) => entry.kind === "note");
  return [
    "## Highlights",
    "",
    ...highlights.flatMap((entry) => renderAnnotationBlock(entry)),
    "",
    "## Notes",
    "",
    ...notes.flatMap((entry) => renderAnnotationBlock(entry)),
  ];
}

function renderByColor(entries: ExportEntry[]): string[] {
  const colors: AnnotationColor[] = ["yellow", "green", "blue", "pink", "orange", "purple"];
  return colors.flatMap((color) => {
    const colorEntries = entries.filter((entry) => entry.color === color);
    if (!colorEntries.length) {
      return [];
    }
    return [
      `## ${color}`,
      "",
      ...colorEntries.flatMap((entry) => {
        return renderAnnotationBlock(entry);
      }),
    ];
  });
}

function renderNotesOnly(entries: ExportEntry[]): string[] {
  const notes = entries.filter((entry) => entry.kind === "note" && entry.content.trim());
  if (!notes.length) {
    return ["No notes found.", ""];
  }
  return ["## Notes", "", ...notes.flatMap((entry) => renderAnnotationBlock(entry))];
}

function renderReadingNotes(entries: ExportEntry[]): string[] {
  return [
    "## Reading Notes",
    "",
    ...entries.flatMap((entry) => {
      return [`### ${entrySource(entry)}`, "", ...renderAnnotationBlock(entry)];
    }),
  ];
}

function renderAnnotationBlock(entry: ExportEntry): string[] {
  const blockId = `${entry.mode}-${entry.id}`;
  const calloutType = entry.mode === "epub" ? "inklight-epub" : entry.mode === "pdf" ? "inklight-pdf" : "inklight-md";
  const header = `> [!${calloutType}|${entry.color}] ${entrySource(entry)} - ${entry.createdAt} ^${blockId}`;
  const lines = [header];

  for (const line of entry.text.split(/\r?\n/)) {
    lines.push(`> ${line}`);
  }

  if (entry.content.trim()) {
    lines.push(">");
    for (const line of entry.content.split(/\r?\n/)) {
      lines.push(`> Note: ${line}`);
    }
  }

  lines.push(">");
  lines.push(`> [返回原文](${createAnnotationUri(entry.sourcePath, entry.id)})`);
  const anchor = hiddenAnchor(entry);
  if (anchor) {
    lines.push(anchor);
  }

  lines.push("");
  return lines;
}

function hiddenAnchor(entry: ExportEntry): string {
  if (entry.mode === "epub" && entry.cfiRange) {
    return `> <span style="display:none" data-yh-id="${escapeHtmlAttribute(entry.id)}" data-yh-mode="epub" data-yh-cfi="${escapeHtmlAttribute(entry.cfiRange)}" data-yh-source-path="${escapeHtmlAttribute(entry.sourcePath)}"></span>`;
  }
  if (entry.mode === "pdf" && entry.pageNumber) {
    const rects = entry.pdfRects ? ` data-yh-pdf-rects="${escapeHtmlAttribute(entry.pdfRects)}"` : "";
    return `> <span style="display:none" data-yh-id="${escapeHtmlAttribute(entry.id)}" data-yh-mode="pdf" data-yh-pdf-page="${entry.pageNumber}" data-yh-source-path="${escapeHtmlAttribute(entry.sourcePath)}" data-yh-pdf-id="${escapeHtmlAttribute(entry.id)}"${rects}></span>`;
  }
  return `> <span style="display:none" data-yh-id="${escapeHtmlAttribute(entry.id)}" data-yh-mode="md" data-yh-source-path="${escapeHtmlAttribute(entry.sourcePath)}"></span>`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function entrySource(entry: ExportEntry): string {
  if (entry.pageNumber) {
    return `${entry.sourcePath} p.${entry.pageNumber}`;
  }
  if (entry.mode === "epub" && entry.chapter?.trim()) {
    return `${entry.sourcePath} · ${entry.chapter.trim()}`;
  }
  return entry.sourcePath;
}
