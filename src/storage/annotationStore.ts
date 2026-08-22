/**
 * [INPUT]: 依赖 obsidian App/Vault/Adapter 的文件读写能力，依赖 storage/types 的 sidecar JSON 合约
 * [OUTPUT]: 对外提供 AnnotationStore，负责 Markdown/PDF 的 .obsidian-annotations sidecar 文件、索引、缓存与导出
 * [POS]: storage 模块的唯一持久化入口，隔离原始 Markdown 与注释数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { App, normalizePath, Notice, TFile } from "obsidian";
import { t } from "../i18n";

import { createAnnotationUri } from "../links/annotationLink";
import { AnnotationTagDefinition, resolveAnnotationTag } from "../tags/tagDomain";
import {
  AnnotationIndex,
  AnnotationIndexEntry,
  AnnotationColor,
  AnnotationExportFormat,
  CanvasBinding,
  CanvasExcerptNode,
  CommentAnnotation,
  EMPTY_INDEX,
  EpubCommentAnnotation,
  EpubCfiAnchor,
  EpubHighlightAnnotation,
  EpubReadingProgress,
  FileAnnotationDocument,
  HighlightAnnotation,
  PdfAnchor,
  PdfCommentAnnotation,
  PdfHighlightAnnotation,
  PdfReadingProgress,
  ReadingBookmark,
  StorageFormat,
  TextAnchor,
} from "./types";

const DEFAULT_STORE_DIR = ".obsidian-annotations";

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
  tagName?: string;
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

export interface StorageConfig {
  baseDir: string;
  format: StorageFormat;
}

export class AnnotationStore {
  private readonly documents = new Map<string, FileAnnotationDocument>();
  private readonly documentWrites = new Map<string, Promise<unknown>>();
  private indexWriteTail: Promise<unknown> = Promise.resolve();
  private index: AnnotationIndex = EMPTY_INDEX;
  private changeVersion = 0;

  constructor(
    private readonly app: App,
    private readonly getAnnotationTags: () => AnnotationTagDefinition[] = () => [],
    private readonly getStorageConfig: () => StorageConfig = () => ({ baseDir: DEFAULT_STORE_DIR, format: "json" }),
  ) {}

  get version(): number {
    return this.changeVersion;
  }

  getStorageConfigResolved(): StorageConfig {
    const cfg = this.getStorageConfig?.() ?? { baseDir: DEFAULT_STORE_DIR, format: "json" };
    return { baseDir: resolveStoreDir(cfg.baseDir), format: cfg.format === "md" ? "md" : "json" };
  }

  private getBaseDir(): string {
    return this.getStorageConfigResolved().baseDir;
  }

  private getFormat(): StorageFormat {
    return this.getStorageConfigResolved().format;
  }

  private getIndexPath(): string {
    return normalizePath(`${this.getBaseDir()}/index.json`);
  }

  async initialize(): Promise<void> {
    await this.ensureStoreDir();
    this.index = await this.readJson<AnnotationIndex>(this.getIndexPath(), EMPTY_INDEX, { allowCorruptFallback: true });
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
    const document = await this.readDocumentOrFallback(sidecarPath, fallback);
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
      const serialized =
        this.getFormat() === "md" ? serializeDocumentToMarkdown(normalized) : JSON.stringify(normalized, null, 2);
      await this.app.vault.adapter.write(sidecarPath, serialized);
      const persisted = await this.readDocumentOrThrow(sidecarPath);
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
      new Notice(t("notice.notSaved", { path: sidecarPath }));
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
    if (!(await this.app.vault.adapter.exists(oldSidecar))) {
      return;
    }
    const oldDocument = await this.readDocumentOrThrow(oldSidecar);

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
   * 2. 文件内容里所有指向旧路径的 source 引用（标题、[[wikilink]]、data-book-note-source-path）替换为新路径。
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
        const updated = content.split(oldPath).join(newPath);
        const newName = candidate.replace(oldBase.split(/[\\/]/).pop()!, newBase.split(/[\\/]/).pop()!);
        const targetPath = normalizePath(`${newParent}/${newName}`);
        if (updated !== content) {
          await this.app.vault.modify(excerptFile, updated);
        }
        if (targetPath !== candidatePath && !this.app.vault.getAbstractFileByPath(targetPath)) {
          await this.app.vault.rename(excerptFile, targetPath);
        }
      } catch (error) {
        console.warn("book-note: migrate excerpt file failed", candidatePath, error);
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

  // ===== 旧版书签兼容字段（EPUB/PDF 通用）=====

  async exportNotes(file: TFile, format: AnnotationExportFormat = "summary"): Promise<TFile> {
    const document = await this.getDocument(file);
    const baseName = file.basename || file.name.replace(/\.md$/i, "");
    const suffix = format === "summary" ? "" : `-${format}`;
    const targetPath = normalizePath(`${file.parent?.path ?? ""}/${baseName}-notes${suffix}.md`);
    const lines = buildExportLines(`Notes for ${file.path}`, [{ filePath: file.path, document }], format, this.getAnnotationTags());

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
    const targetPath = normalizePath(`book-note-all-notes${suffix}.md`);
    const sources = documents.map((document) => ({ filePath: document.filePath, document }));
    const lines = buildExportLines(t("export.heading"), sources, format, this.getAnnotationTags());

    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, lines.join("\n"));
      return existing;
    }

    return this.app.vault.create(targetPath, lines.join("\n"));
  }

  async testWriteAccess(): Promise<string> {
    await this.ensureStoreDir();
    const testPath = normalizePath(`${this.getBaseDir()}/.write-test.json`);
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
      new Notice(t("notice.storageTestFailed", { path: testPath }));
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

  /**
   * Build a human-readable sidecar path from the source file path:
   * `{baseDir}/{path-segments}-{filename}.{ext}.{sidecarExt}`
   * e.g. `books/未命名.pdf` -> `.obsidian-annotations/books-未命名.pdf.json`
   * Path separators are collapsed to "-", and the original extension is kept to
   * avoid collisions between same-named files of different types.
   */
  toSidecarPath(filePath: string): string {
    const normalized = this.normalizeVaultPath(filePath);
    const parts = normalized.split("/").filter((part) => part.length > 0);
    const safeName = parts.join("-");
    return normalizePath(`${this.getBaseDir()}/${safeName}.${this.sidecarExtension()}`);
  }

  private sidecarExtension(): string {
    return this.getFormat() === "md" ? "md" : "json";
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
    await this.ensureDir(this.getBaseDir());
  }

  private async ensureDir(path: string): Promise<void> {
    const normalizedPath = normalizePath(path);
    if (await this.app.vault.adapter.exists(normalizedPath)) {
      return;
    }
    const segments = normalizedPath.split("/").filter((segment) => segment.length > 0);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  private async writeIndex(nextIndex: AnnotationIndex = this.index): Promise<void> {
    await this.ensureStoreDir();
    await this.app.vault.adapter.write(this.getIndexPath(), JSON.stringify(nextIndex, null, 2));
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
      new Notice(t("notice.cannotRead", { path: normalizedPath }));
      throw new AnnotationStoreReadError(normalizedPath, error);
    }
  }

  private async readDocumentOrFallback(path: string, fallback: FileAnnotationDocument): Promise<FileAnnotationDocument> {
    const normalizedPath = normalizePath(path);
    if (!(await this.app.vault.adapter.exists(normalizedPath))) {
      return fallback;
    }
    try {
      return this.parseDocument(await this.app.vault.adapter.read(normalizedPath), normalizedPath);
    } catch (error) {
      new Notice(t("notice.cannotRead", { path: normalizedPath }));
      return fallback;
    }
  }

  private async readDocumentOrThrow(path: string): Promise<FileAnnotationDocument> {
    const normalizedPath = normalizePath(path);
    if (!(await this.app.vault.adapter.exists(normalizedPath))) {
      throw new AnnotationStoreReadError(normalizedPath, new Error("missing"));
    }
    try {
      return this.parseDocument(await this.app.vault.adapter.read(normalizedPath), normalizedPath);
    } catch (error) {
      throw new AnnotationStoreReadError(normalizedPath, error);
    }
  }

  private parseDocument(raw: string, path: string): FileAnnotationDocument {
    const format: StorageFormat = path.toLowerCase().endsWith(".md") ? "md" : "json";
    if (format === "md") {
      return parseMarkdownDocument(raw, path);
    }
    return JSON.parse(raw) as FileAnnotationDocument;
  }

  /** Rewrite every indexed sidecar to the current storage directory and format. */
  async migrateAll(): Promise<{ migrated: number; failed: number }> {
    const result = { migrated: 0, failed: 0 };
    const filePaths = Object.keys(this.index.files);

    for (const filePath of filePaths) {
      const entry = this.index.files[filePath];
      const oldSidecar = entry.sidecarPath;
      const newSidecar = this.toSidecarPath(filePath);
      const oldFormat: StorageFormat = oldSidecar.toLowerCase().endsWith(".md") ? "md" : "json";

      if (!(await this.app.vault.adapter.exists(oldSidecar))) {
        continue;
      }
      if (oldSidecar === newSidecar && oldFormat === this.getFormat()) {
        continue;
      }

      try {
        const document = await this.readDocumentOrThrow(oldSidecar);
        const normalized = this.normalizeDocument(document, filePath);
        await this.ensureStoreDir();
        const serialized =
          this.getFormat() === "md" ? serializeDocumentToMarkdown(normalized) : JSON.stringify(normalized, null, 2);
        await this.app.vault.adapter.write(newSidecar, serialized);
        if (newSidecar !== oldSidecar) {
          await this.deleteIfExists(oldSidecar);
        }
        this.index.files[filePath] = this.toIndexEntry(normalized, newSidecar);
        this.documents.delete(this.toCacheKey(filePath));
        result.migrated += 1;
      } catch (error) {
        console.warn("book-note: migrate sidecar failed", oldSidecar, error);
        result.failed += 1;
      }
    }

    await this.writeIndex();
    return result;
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

function buildExportLines(
  title: string,
  sources: ExportDocumentSource[],
  format: AnnotationExportFormat,
  tags: AnnotationTagDefinition[],
): string[] {
  const entries = sources.flatMap((source) => collectExportEntries(source, tags));
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

function collectExportEntries(source: ExportDocumentSource, tags: AnnotationTagDefinition[]): ExportEntry[] {
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
      tagName: resolveAnnotationTag(tags, comment)?.name,
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
      tagName: resolveAnnotationTag(tags, comment)?.name,
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
      tagName: resolveAnnotationTag(tags, comment)?.name,
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
  const calloutType = entry.mode === "epub" ? "book-note-epub" : entry.mode === "pdf" ? "book-note-pdf" : "book-note-md";
  const header = `> [!${calloutType}|${entry.color}] ${entrySource(entry)} - ${entry.createdAt} ^${blockId}`;
  const lines = [header];

  for (const line of entry.text.split(/\r?\n/)) {
    lines.push(`> ${line}`);
  }

  if (entry.tagName) {
    lines.push(">");
    lines.push(`> 标签：${entry.tagName}`);
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
    return `> <span style="display:none" data-book-note-id="${escapeHtmlAttribute(entry.id)}" data-book-note-mode="epub" data-book-note-cfi="${escapeHtmlAttribute(entry.cfiRange)}" data-book-note-source-path="${escapeHtmlAttribute(entry.sourcePath)}"></span>`;
  }
  if (entry.mode === "pdf" && entry.pageNumber) {
    const rects = entry.pdfRects ? ` data-book-note-pdf-rects="${escapeHtmlAttribute(entry.pdfRects)}"` : "";
    return `> <span style="display:none" data-book-note-id="${escapeHtmlAttribute(entry.id)}" data-book-note-mode="pdf" data-book-note-pdf-page="${entry.pageNumber}" data-book-note-source-path="${escapeHtmlAttribute(entry.sourcePath)}" data-book-note-pdf-id="${escapeHtmlAttribute(entry.id)}"${rects}></span>`;
  }
  return `> <span style="display:none" data-book-note-id="${escapeHtmlAttribute(entry.id)}" data-book-note-mode="md" data-book-note-source-path="${escapeHtmlAttribute(entry.sourcePath)}"></span>`;
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

// ===== Markdown sidecar storage (StorageFormat = "md") =====
// Document-level metadata (including reading progress) is stored in YAML
// frontmatter. Each annotation is a level-1 heading; the machine-readable data
// lives in a hidden span (data-book-note) so the file round-trips losslessly.

const MD_ANNOTATION_ATTR = "data-book-note";

interface SerializedAnnotation {
  kind: "md-highlight" | "md-comment" | "pdf-highlight" | "pdf-comment" | "epub-highlight" | "epub-comment";
  value: unknown;
}

interface DocMeta {
  filePath: string;
  fileHash: string;
  lastModified: string;
  epubProgress: EpubReadingProgress | null;
  pdfProgress: PdfReadingProgress | null;
  bookmarks: ReadingBookmark[];
  canvasBinding: CanvasBinding | null;
  canvasNodes: CanvasExcerptNode[];
}

function emptyDocMeta(): DocMeta {
  return {
    filePath: "",
    fileHash: "",
    lastModified: new Date().toISOString(),
    epubProgress: null,
    pdfProgress: null,
    bookmarks: [],
    canvasBinding: null,
    canvasNodes: [],
  };
}

/**
 * Resolve a user-provided storage directory to a safe, vault-relative path.
 * Only vault-relative paths are allowed (mobile-safe, no Node fs). Anything
 * absolute, containing "..", or empty falls back to the default directory.
 */
function resolveStoreDir(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return DEFAULT_STORE_DIR;
  }
  const normalized = normalizePath(trimmed);
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(normalized) ||
    normalized.includes("..") ||
    normalized === "." ||
    normalized === ".."
  ) {
    return DEFAULT_STORE_DIR;
  }
  return normalized;
}

export function serializeDocumentToMarkdown(document: FileAnnotationDocument): string {
  const meta: DocMeta = {
    filePath: document.filePath,
    fileHash: document.fileHash,
    lastModified: document.lastModified,
    epubProgress: document.epubProgress ?? null,
    pdfProgress: document.pdfProgress ?? null,
    bookmarks: document.bookmarks ?? [],
    canvasBinding: document.canvasBinding ?? null,
    canvasNodes: document.canvasNodes ?? [],
  };

  const lines: string[] = [];
  lines.push("---");
  lines.push(`filePath: ${yamlValue(meta.filePath)}`);
  lines.push(`fileHash: ${yamlValue(meta.fileHash)}`);
  lines.push(`lastModified: ${yamlValue(meta.lastModified)}`);
  lines.push(`pdfProgress: ${yamlValue(meta.pdfProgress)}`);
  lines.push(`epubProgress: ${yamlValue(meta.epubProgress)}`);
  lines.push(`bookmarks: ${yamlValue(meta.bookmarks)}`);
  lines.push(`canvasBinding: ${yamlValue(meta.canvasBinding)}`);
  lines.push(`canvasNodes: ${yamlValue(meta.canvasNodes)}`);
  lines.push("---");
  lines.push("");

  const pushBlock = (
    mode: "md" | "pdf" | "epub",
    kind: SerializedAnnotation["kind"],
    value: { id: string },
    title: string,
    content: string,
    resolved: boolean,
    replies: { createdAt: string; content: string }[],
  ): void => {
    const blockId = `bn-${mode}-${value.id}`;
    const heading = (title || "Annotation").split(/\r?\n/)[0].trim().slice(0, 200) || "Annotation";
    lines.push(`# ${heading} ^${blockId}`);
    if (content.trim()) {
      lines.push(">");
      for (const line of content.split(/\r?\n/)) {
        lines.push(`> Note: ${line}`);
      }
    }
    if (replies.length) {
      lines.push(">");
      for (const reply of replies) {
        lines.push(`> reply ${reply.createdAt}: ${reply.content}`);
      }
    }
    if (resolved) {
      lines.push(">");
      lines.push("> resolved");
    }
    lines.push(`<span style="display:none" ${MD_ANNOTATION_ATTR}="${escapeHtmlAttribute(JSON.stringify({ kind, value }))}"></span>`);
    lines.push("");
  };

  for (const highlight of document.highlights) {
    pushBlock("md", "md-highlight", highlight, highlight.anchor.selectedText, "", false, []);
  }
  for (const comment of document.comments) {
    pushBlock("md", "md-comment", comment, comment.anchor.selectedText, comment.content, comment.resolved, comment.replies);
  }
  for (const highlight of document.pdfHighlights) {
    pushBlock("pdf", "pdf-highlight", highlight, highlight.anchor.selectedText, "", false, []);
  }
  for (const comment of document.pdfComments) {
    pushBlock("pdf", "pdf-comment", comment, comment.anchor.selectedText, comment.content, comment.resolved, comment.replies);
  }
  for (const highlight of document.epubHighlights) {
    pushBlock("epub", "epub-highlight", highlight, highlight.anchor.selectedText, "", false, []);
  }
  for (const comment of document.epubComments) {
    pushBlock("epub", "epub-comment", comment, comment.anchor.selectedText, comment.note, comment.resolved, comment.replies);
  }

  return lines.join("\n");
}

export function parseMarkdownDocument(raw: string, path: string): FileAnnotationDocument {
  const meta = parseFrontmatter(raw);
  const annotations = extractAnnotations(raw);
  const document: FileAnnotationDocument = {
    filePath: meta.filePath,
    fileHash: meta.fileHash ?? "",
    lastModified: meta.lastModified ?? new Date().toISOString(),
    highlights: [],
    comments: [],
    pdfHighlights: [],
    pdfComments: [],
    epubHighlights: [],
    epubComments: [],
    epubProgress: meta.epubProgress ?? undefined,
    pdfProgress: meta.pdfProgress ?? undefined,
    bookmarks: meta.bookmarks ?? [],
    canvasBinding: meta.canvasBinding ?? undefined,
    canvasNodes: meta.canvasNodes ?? [],
  };

  for (const item of annotations) {
    switch (item.kind) {
      case "md-highlight":
        document.highlights.push(item.value as HighlightAnnotation);
        break;
      case "md-comment":
        document.comments.push(item.value as CommentAnnotation);
        break;
      case "pdf-highlight":
        document.pdfHighlights.push(item.value as PdfHighlightAnnotation);
        break;
      case "pdf-comment":
        document.pdfComments.push(item.value as PdfCommentAnnotation);
        break;
      case "epub-highlight":
        document.epubHighlights.push(item.value as EpubHighlightAnnotation);
        break;
      case "epub-comment":
        document.epubComments.push(item.value as EpubCommentAnnotation);
        break;
    }
  }

  return document;
}

function parseFrontmatter(raw: string): DocMeta {
  const meta = emptyDocMeta();
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) {
    return meta;
  }
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = parseYamlScalar(line.slice(idx + 1).trim());
    switch (key) {
      case "filePath":
        meta.filePath = typeof value === "string" ? value : "";
        break;
      case "fileHash":
        meta.fileHash = typeof value === "string" ? value : "";
        break;
      case "lastModified":
        meta.lastModified = typeof value === "string" ? value : new Date().toISOString();
        break;
      case "pdfProgress":
        meta.pdfProgress = isObject(value) ? (value as unknown as PdfReadingProgress) : null;
        break;
      case "epubProgress":
        meta.epubProgress = isObject(value) ? (value as unknown as EpubReadingProgress) : null;
        break;
      case "bookmarks":
        meta.bookmarks = Array.isArray(value) ? (value as unknown as ReadingBookmark[]) : [];
        break;
      case "canvasBinding":
        meta.canvasBinding = isObject(value) ? (value as unknown as CanvasBinding) : null;
        break;
      case "canvasNodes":
        meta.canvasNodes = Array.isArray(value) ? (value as CanvasExcerptNode[]) : [];
        break;
    }
  }
  return meta;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Serialize any value into a YAML-safe single-quoted scalar. The value is
 * JSON-encoded first, then wrapped in single quotes (with internal single
 * quotes escaped as ''), which keeps the frontmatter a valid YAML document
 * while guaranteeing a lossless round-trip through parseYamlScalar.
 */
function yamlValue(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  return `'${json.replace(/'/g, "''")}'`;
}

function parseYamlScalar(raw: string): unknown {
  const s = raw.trim();
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    try {
      return JSON.parse(s.slice(1, -1).replace(/''/g, "'"));
    } catch {
      return s.slice(1, -1).replace(/''/g, "'");
    }
  }
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try {
      return JSON.parse(s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s === "" || s === "null") {
    return null;
  }
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function extractAnnotations(raw: string): SerializedAnnotation[] {
  const regex = new RegExp(`<span[^>]*\\s${MD_ANNOTATION_ATTR}="([^"]*)"[^>]*>\\s*</span>`, "g");
  const result: SerializedAnnotation[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    try {
      const item = JSON.parse(unescapeHtmlAttribute(match[1])) as SerializedAnnotation;
      if (item && typeof item.kind === "string" && "value" in item) {
        result.push(item);
      }
    } catch {
      // skip malformed annotation span; readable callout is cosmetic only
    }
  }
  return result;
}

function unescapeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
