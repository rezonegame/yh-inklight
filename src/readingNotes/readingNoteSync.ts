/**
 * [INPUT]: sidecar 成功变更通知、显式阅读笔记绑定与 Vault.process
 * [OUTPUT]: 防抖、按笔记路径串行的受管区同步；失败仅提示，不回滚批注
 * [POS]: readingNotes 编排层，不改变 source 文件或 sidecar 事实源
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { App, Notice, TFile } from "obsidian";

import type { AnnotationStore } from "../storage/annotationStore";
import type { AnnotationTagDefinition } from "../tags/tagDomain";
import { ReadingNoteBindingService, isReadingNoteSource } from "./readingNoteBinding";
import { renderReadingNoteProjection, replaceManagedSection } from "./readingNoteProjection";

export class ReadingNoteSync {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly noteQueues = new Map<string, Promise<void>>();
  private disposed = false;

  constructor(
    private readonly app: App,
    private readonly store: AnnotationStore,
    private readonly binding: ReadingNoteBindingService,
    private readonly getFolder: () => string,
    private readonly getTags: () => AnnotationTagDefinition[],
  ) {}

  schedule(file: TFile, delay = 300): void {
    if (this.disposed || !isReadingNoteSource(file)) return;
    const pending = this.timers.get(file.path);
    if (pending) clearTimeout(pending);
    this.timers.set(file.path, setTimeout(() => {
      this.timers.delete(file.path);
      void this.sync(file).catch((error) => {
        console.error("yh-inklight: reading note sync failed", error);
        new Notice(`批注已保存，阅读笔记同步失败：${error instanceof Error ? error.message : "请稍后重试"}`);
      });
    }, delay));
  }

  async sync(file: TFile): Promise<void> {
    if (this.disposed || !isReadingNoteSource(file)) return;
    const note = await this.binding.openOrCreate(file, this.getFolder());
    const previous = this.noteQueues.get(note.path) ?? Promise.resolve();
    const job = previous.catch(() => undefined).then(async () => {
      if (this.disposed) return;
      const document = await this.store.getFreshDocument(file);
      if (document.readingNoteBinding?.notePath !== note.path) {
        throw new Error("阅读笔记绑定已变化，停止写入旧文件");
      }
      const projection = renderReadingNoteProjection(document, this.getTags());
      await this.app.vault.process(note, (current) => replaceManagedSection(current, projection));
    });
    this.noteQueues.set(note.path, job);
    void job.then(
      () => { if (this.noteQueues.get(note.path) === job) this.noteQueues.delete(note.path); },
      () => { if (this.noteQueues.get(note.path) === job) this.noteQueues.delete(note.path); },
    );
    await job;
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
