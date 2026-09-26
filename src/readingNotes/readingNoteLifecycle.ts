/**
 * [INPUT]: Vault 文件改名/删除事件、sidecar 显式绑定与阅读笔记投影
 * [OUTPUT]: 保守迁移笔记路径和来源链接，删除笔记时清除绑定
 * [POS]: readingNotes 生命周期编排层，不恢复已删除的手写内容
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { App, Notice, TAbstractFile, TFile, TFolder } from "obsidian";

import type { AnnotationStore } from "../storage/annotationStore";
import type { AnnotationTagDefinition } from "../tags/tagDomain";
import { isReadingNoteSource } from "./readingNoteBinding";
import { rewriteReadingNoteSource } from "./readingNoteIdentity";
import { renderReadingNoteProjection } from "./readingNoteProjection";
import type { ReadingNoteSync } from "./readingNoteSync";

function movedNotePath(path: string, oldPath: string, newPath: string): string | null {
  if (path === oldPath) return newPath;
  if (path.startsWith(`${oldPath}/`)) return `${newPath}${path.slice(oldPath.length)}`;
  return null;
}

export class ReadingNoteLifecycle {
  constructor(
    private readonly app: App,
    private readonly store: AnnotationStore,
    private readonly sync: ReadingNoteSync,
    private readonly getTags: () => AnnotationTagDefinition[],
  ) {}

  async onNoteRenamed(file: TAbstractFile, oldPath: string): Promise<void> {
    if (!(file instanceof TFolder) && (!(file instanceof TFile) || file.extension.toLowerCase() !== "md")) return;
    const documents = await this.store.getIndexedDocuments();
    for (const document of documents) {
      const binding = document.readingNoteBinding;
      if (!binding) continue;
      const nextPath = movedNotePath(binding.notePath, oldPath, file.path);
      if (!nextPath) continue;
      const source = this.app.vault.getAbstractFileByPath(document.filePath);
      if (!(source instanceof TFile) || !isReadingNoteSource(source)) continue;
      this.sync.cancel(source.path);
      await this.store.mutateDocument(source, (latest) => ({
        ...latest,
        readingNoteBinding: latest.readingNoteBinding?.notePath === binding.notePath
          ? { ...latest.readingNoteBinding, notePath: nextPath }
          : latest.readingNoteBinding,
        lastModified: new Date().toISOString(),
      }));
    }
  }

  async onNoteDeleted(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFolder) && (!(file instanceof TFile) || file.extension.toLowerCase() !== "md")) return;
    const documents = await this.store.getIndexedDocuments();
    for (const document of documents) {
      const binding = document.readingNoteBinding;
      if (!binding || !movedNotePath(binding.notePath, file.path, file.path)) continue;
      const source = this.app.vault.getAbstractFileByPath(document.filePath);
      if (!(source instanceof TFile) || !isReadingNoteSource(source)) continue;
      this.sync.cancel(source.path);
      await this.store.mutateDocument(source, (latest) => ({
        ...latest,
        readingNoteBinding: latest.readingNoteBinding?.notePath === binding.notePath
          ? undefined : latest.readingNoteBinding,
        lastModified: new Date().toISOString(),
      }));
      new Notice(`阅读笔记已删除，${source.basename} 的绑定已清除；下次批注会创建新笔记，手写内容不会恢复。`);
    }
  }

  async onSourceRenamed(source: TFile, oldPath: string): Promise<void> {
    if (!isReadingNoteSource(source)) return;
    if (!(await this.store.getExistingDocument(source))) return;
    const document = await this.store.getFreshDocument(source);
    const notePath = document.readingNoteBinding?.notePath;
    if (!notePath) return;
    const note = this.app.vault.getAbstractFileByPath(notePath);
    if (!(note instanceof TFile) || note.extension.toLowerCase() !== "md") {
      throw new Error(`绑定的阅读笔记不存在：${notePath}`);
    }
    const projection = renderReadingNoteProjection(document, this.getTags());
    await this.app.vault.process(note, (content) =>
      rewriteReadingNoteSource(content, oldPath, source.path, projection));
  }
}
