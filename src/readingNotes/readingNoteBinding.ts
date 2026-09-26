/**
 * [INPUT]: PDF/电子书源文件、sidecar 绑定和 Vault 文件
 * [OUTPUT]: 显式创建/打开阅读笔记，确认时只修复已绑定笔记的来源信息
 * [POS]: readingNotes 绑定服务，不按书名认领 Markdown 文件
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { App, normalizePath, TFile, TFolder } from "obsidian";

import type { AnnotationStore } from "../storage/annotationStore";
import { SUPPORTED_BOOK_EXTENSIONS } from "../storage/types";
import { assertReadingNoteIdentity, readReadingNoteIdentity, rewriteReadingNoteSource } from "./readingNoteIdentity";

export function normalizeReadingNoteFolder(value: string): string | null {
  const parts = value.trim().replace(/\\/g, "/").split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[\u0000-\u001f]/.test(part))) return null;
  const path = normalizePath(parts.join("/"));
  return path && path !== "/" ? path : null;
}

export function isReadingNoteSource(file: TFile): boolean {
  const extension = file.extension.toLowerCase();
  return extension === "pdf" || (SUPPORTED_BOOK_EXTENSIONS as readonly string[]).includes(extension);
}

export function readingNotePath(folder: string, source: TFile, collision = false): string {
  const suffix = collision ? ` - ${hashPath(source.path)}` : "";
  return normalizePath(`${folder}/${source.basename} - 阅读笔记${suffix}.md`);
}

export function initialReadingNote(source: TFile): string {
  const kind = source.extension.toLowerCase() === "pdf" ? "pdf" : "ebook";
  return [
    "---",
    "type: inklight-reading-note",
    `inklight-source: ${JSON.stringify(normalizePath(source.path))}`,
    `inklight-source-type: ${JSON.stringify(kind)}`,
    "inklight-schema: 1",
    "---",
    "",
    `来源：[[${source.path}]]`,
    "",
    "## 我的笔记",
    "",
    "<!-- yh-inklight:managed:start -->",
    "<!-- yh-inklight:managed:end -->",
    "",
  ].join("\n");
}

function hashPath(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export class ReadingNoteBindingService {
  private readonly pending = new Map<string, Promise<TFile>>();

  constructor(private readonly app: App, private readonly store: AnnotationStore) {}

  openOrCreate(source: TFile, folderSetting: string): Promise<TFile> {
    const existing = this.pending.get(source.path);
    if (existing) return existing;
    const task = this.createOrResolve(source, folderSetting).finally(() => this.pending.delete(source.path));
    this.pending.set(source.path, task);
    return task;
  }

  private async createOrResolve(source: TFile, folderSetting: string): Promise<TFile> {
    if (!isReadingNoteSource(source)) throw new Error("请先打开 PDF 或电子书文件");
    const folder = normalizeReadingNoteFolder(folderSetting);
    if (!folder) throw new Error("阅读笔记文件夹无效，请在设置中填写 Vault 内的文件夹路径");

    const current = await this.store.getFreshDocument(source);
    if (current.readingNoteBinding) {
      const bound = this.app.vault.getAbstractFileByPath(current.readingNoteBinding.notePath);
      if (!(bound instanceof TFile) || bound.extension.toLowerCase() !== "md") {
        throw new Error(`绑定的阅读笔记不存在：${current.readingNoteBinding.notePath}`);
      }
      assertReadingNoteIdentity(await this.app.vault.read(bound), source.path);
      return bound;
    }

    const defaultPath = readingNotePath(folder, source);
    const path = (this.app.vault.getAbstractFileByPath(defaultPath)
      || await this.app.vault.adapter.exists(defaultPath))
      ? readingNotePath(folder, source, true) : defaultPath;
    if (this.app.vault.getAbstractFileByPath(path) || await this.app.vault.adapter.exists(path)) {
      throw new Error(`阅读笔记名称已被占用：${path}，未认领现有文件`);
    }

    await this.ensureFolder(folder);
    const note = await this.app.vault.create(path, initialReadingNote(source));
    try {
      const updated = await this.store.mutateDocument(source, (document) => ({
        ...document,
        lastModified: new Date().toISOString(),
        readingNoteBinding: document.readingNoteBinding ?? {
          notePath: note.path,
          schemaVersion: 1,
          boundAt: new Date().toISOString(),
        },
      }));
      if (updated.readingNoteBinding?.notePath !== note.path) {
        throw new Error("另一设备已绑定阅读笔记，请重新执行命令");
      }
      return note;
    } catch (error) {
      if (await this.app.vault.cachedRead(note) === initialReadingNote(source)) {
        await this.app.vault.delete(note);
      }
      throw error;
    }
  }

  async confirmSource(source: TFile): Promise<void> {
    const document = await this.store.getFreshDocument(source);
    const notePath = document.readingNoteBinding?.notePath;
    const note = notePath ? this.app.vault.getAbstractFileByPath(notePath) : null;
    if (!(note instanceof TFile)) throw new Error("当前文件没有可确认的阅读笔记绑定");
    const otherBinding = (await this.store.getIndexedDocuments()).find((candidate) =>
      candidate.filePath !== source.path && candidate.readingNoteBinding?.notePath === note.path);
    if (otherBinding) throw new Error(`此阅读笔记已绑定到 ${otherBinding.filePath}，不能重新认领`);
    await this.app.vault.process(note, (content) => {
      const identity = readReadingNoteIdentity(content);
      const expectedType = source.extension.toLowerCase() === "pdf" ? "pdf" : "ebook";
      if (identity.sourceType !== expectedType) throw new Error("阅读笔记格式与当前文件不一致，不能确认绑定");
      return rewriteReadingNoteSource(content, identity.sourcePath, source.path, null);
    });
  }

  private async ensureFolder(path: string): Promise<void> {
    const parts = path.split("/");
    for (let index = 1; index <= parts.length; index++) {
      const partial = parts.slice(0, index).join("/");
      const existing = this.app.vault.getAbstractFileByPath(partial);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`阅读笔记目录被文件占用：${partial}`);
      await this.app.vault.createFolder(partial);
    }
  }
}
