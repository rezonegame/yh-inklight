/**
 * [INPUT]: 依赖 Obsidian ItemView API 和 storage/annotationStore 的进度查询
 * [OUTPUT]: 提供 EpubBookshelfView，展示 vault 中所有电子书的进度
 * [POS]: EPUB 书架侧栏视图
 */

import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import { AnnotationStore } from "../storage/annotationStore";
import { SUPPORTED_BOOK_EXTENSIONS } from "../storage/types";

export const EPUB_BOOKSHELF_VIEW_TYPE = "book-note-epub-bookshelf";

export class EpubBookshelfView extends ItemView {
  private store: AnnotationStore;
  private openCallback: (file: TFile) => void;

  constructor(
    leaf: WorkspaceLeaf,
    store: AnnotationStore,
    onOpen: (file: TFile) => void,
  ) {
    super(leaf);
    this.store = store;
    this.openCallback = onOpen;
  }

  getViewType(): string {
    return EPUB_BOOKSHELF_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t("bookshelf.displayName");
  }

  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("book-note-epub-bookshelf-view");

    container.createEl("h4", {
      cls: "bookshelf-heading",
      text: t("bookshelf.title"),
    });

    const bookFiles = this.app.vault
      .getFiles()
      .filter((f) => (SUPPORTED_BOOK_EXTENSIONS as readonly string[]).includes(f.extension.toLowerCase()));

    if (bookFiles.length === 0) {
      container.createEl("p", {
        cls: "bookshelf-empty",
        text: t("bookshelf.empty"),
      });
      return;
    }

    const list = container.createDiv({ cls: "bookshelf-list" });

    for (const file of bookFiles) {
      const progress = this.store.getCachedDocument(file.path)?.epubProgress;
      const percent = progress ? Math.round(progress.percent * 100) : 0;

      const item = list.createDiv({ cls: "bookshelf-item" });

      const info = item.createDiv({ cls: "bookshelf-info" });
      info.createEl("div", { cls: "bookshelf-title", text: file.basename });
      info.createEl("div", {
        cls: "bookshelf-path",
        text: `${file.extension.toUpperCase()} · ${file.path}`,
      });

      const meta = item.createDiv({ cls: "bookshelf-meta" });

      // 进度条
      const progressBar = meta.createDiv({ cls: "bookshelf-progress-wrap" });
      const bar = progressBar.createDiv({ cls: "bookshelf-progress-bar" });
      bar.setCssProps({ width: `${percent}%` });
      progressBar.createEl("span", {
        cls: "bookshelf-percent",
        text: `${percent}%`,
      });

      if (progress) {
        meta.createEl("div", {
          cls: "bookshelf-last-read",
          text: `t("bookshelf.lastRead", { chapter: progress.chapter || t("common.unknownChapter"), date: progress.lastRead.slice(0, 10) })`,
        });

        const readingSeconds = progress.readingTimeSeconds ?? 0;
        if (readingSeconds > 0) {
          meta.createEl("div", {
            cls: "bookshelf-reading-time",
            text: `t("bookshelf.readTime", { time: this.formatReadingTime(readingSeconds) })`,
          });
        }

        if (progress.estimatedRemainingMinutes != null && progress.estimatedRemainingMinutes > 0) {
          meta.createEl("div", {
            cls: "bookshelf-remaining",
            text: `t("bookshelf.remaining", { minutes: Math.ceil(progress.estimatedRemainingMinutes) })`,
          });
        }
      }

      item.addEventListener("click", () => {
        this.openCallback(file);
      });
    }
  }

  private formatReadingTime(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const parts: string[] = [];
    if (hours > 0) {
      parts.push(t("bookshelf.hours", { count: hours }));
    }
    if (minutes > 0 || hours > 0) {
      parts.push(t("bookshelf.minutes", { count: minutes }));
    }
    parts.push(t("bookshelf.seconds", { count: secs }));
    return parts.join("");
  }
}
