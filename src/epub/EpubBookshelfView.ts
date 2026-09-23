/** Unified ebook/PDF library. Keep the view ID so saved Obsidian layouts survive. */
import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { AnnotationStore } from "../storage/annotationStore";
import { EpubReadingProfile, SUPPORTED_BOOK_EXTENSIONS } from "../storage/types";
import { createReadingLibraryItem, ReadingLibraryItem } from "./readingLibrary";

export const EPUB_BOOKSHELF_VIEW_TYPE = "inklight-epub-bookshelf";

export class ReadingLibraryView extends ItemView {
  private renderTimer: number | null = null;
  private generation = 0;
  private observedStoreVersion: number;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly store: AnnotationStore,
    private readonly openBook: (file: TFile) => void,
    private readonly openPdf: (file: TFile) => void,
    private readonly getReadingProfile: () => EpubReadingProfile,
    private readonly isPdfProgressTrackingEnabled: () => boolean,
  ) {
    super(leaf);
    this.observedStoreVersion = store.version;
  }

  getViewType(): string { return EPUB_BOOKSHELF_VIEW_TYPE; }
  getDisplayText(): string { return "阅读资料库"; }
  getIcon(): string { return "library"; }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.vault.on("create", () => this.refresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.refresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.refresh()));
    this.registerInterval(window.setInterval(() => {
      if (this.observedStoreVersion !== this.store.version) {
        this.observedStoreVersion = this.store.version;
        this.refresh(5000);
      }
    }, 1000));
    await this.render();
  }

  async onClose(): Promise<void> {
    this.generation++;
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    this.renderTimer = null;
    this.contentEl.empty();
  }

  refresh(delay = 150): void {
    if (this.renderTimer !== null && delay > 150) return;
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      void this.render();
    }, delay);
  }

  private async render(): Promise<void> {
    const generation = ++this.generation;
    const files = this.app.vault.getFiles()
      .filter((file) => file.extension.toLowerCase() === "pdf"
        || (SUPPORTED_BOOK_EXTENSIONS as readonly string[]).includes(file.extension.toLowerCase()))
      .sort((a, b) => a.path.localeCompare(b.path));
    const items: Array<{ file: TFile; item: ReadingLibraryItem }> = [];
    for (const file of files) {
      try {
        const document = await this.store.getExistingDocument(file);
        items.push({ file, item: createReadingLibraryItem(
          { path: file.path, basename: file.basename, extension: file.extension,
            parentPath: file.parent?.path ?? "" },
          document?.epubProgress, document?.pdfProgress, this.isPdfProgressTrackingEnabled(),
        ) });
      } catch (error) {
        console.warn(`yh-inklight: cannot read library progress for ${file.path}`, error);
        items.push({ file, item: createReadingLibraryItem(
          { path: file.path, basename: file.basename, extension: file.extension,
            parentPath: file.parent?.path ?? "" },
          undefined, undefined, this.isPdfProgressTrackingEnabled(),
        ) });
      }
      if (generation !== this.generation) return;
    }
    if (generation !== this.generation) return;
    const container = this.contentEl;
    container.empty();
    container.addClass("yh-epub-bookshelf-view");
    container.toggleClass("yh-epub-eink", this.getReadingProfile().einkMode === true);
    container.createEl("h4", { cls: "bookshelf-heading", text: "阅读资料库" });
    if (items.length === 0) {
      container.createEl("p", { cls: "bookshelf-empty", text: "Vault 中没有找到电子书或 PDF 文件。" });
      return;
    }
    const list = container.createDiv({ cls: "bookshelf-list" });
    for (const { file, item } of items) {
      const row = list.createEl("button", { cls: "bookshelf-item", attr: { type: "button" } });
      const icon = row.createSpan({ cls: "bookshelf-file-icon" });
      setIcon(icon, item.kind === "pdf" ? "file-text" : "book-open");
      const body = row.createDiv({ cls: "bookshelf-body" });
      body.createDiv({ cls: "bookshelf-title", text: item.basename });
      body.createDiv({ cls: "bookshelf-path", text: `${item.extension.toUpperCase()} · ${item.parentPath || "/"}` });
      const meta = body.createDiv({ cls: "bookshelf-meta" });
      if (item.status === "untracked") {
        meta.createSpan({ text: "未记录进度" });
      } else {
        const wrap = meta.createDiv({ cls: "bookshelf-progress-wrap" });
        const bar = wrap.createDiv({ cls: "bookshelf-progress-bar" });
        bar.createDiv().setCssProps({ width: `${Math.round((item.progress ?? 0) * 100)}%` });
        wrap.createSpan({ cls: "bookshelf-percent", text: `${Math.round((item.progress ?? 0) * 100)}%` });
      }
      if (item.lastRead) meta.createDiv({ cls: "bookshelf-last-read", text: `最近阅读：${item.lastRead.slice(0, 10)}` });
      if (item.readingTimeSeconds && item.readingTimeSeconds > 0) {
        meta.createDiv({ cls: "bookshelf-reading-time", text: `已读 ${formatReadingTime(item.readingTimeSeconds)}` });
      }
      row.addEventListener("click", () => item.kind === "pdf" ? this.openPdf(file) : this.openBook(file));
    }
  }
}

function formatReadingTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${hours > 0 ? `${hours}小时` : ""}${minutes > 0 || hours > 0 ? `${minutes}分` : ""}${secs}秒`;
}
