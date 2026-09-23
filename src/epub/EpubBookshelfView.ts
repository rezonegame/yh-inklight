/** Unified ebook/PDF library. Keep the view ID so saved Obsidian layouts survive. */
import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { AnnotationStore } from "../storage/annotationStore";
import { EpubReadingProfile, SUPPORTED_BOOK_EXTENSIONS } from "../storage/types";
import {
  createReadingLibraryItem, DEFAULT_READING_LIBRARY_QUERY, queryReadingLibrary,
  normalizeLibraryViewMode, LibraryViewMode, ReadingLibraryItem, ReadingLibraryQuery,
} from "./readingLibrary";
import { BookCoverCache } from "./BookCoverCache";

export const EPUB_BOOKSHELF_VIEW_TYPE = "inklight-epub-bookshelf";

export class ReadingLibraryView extends ItemView {
  private renderTimer: number | null = null;
  private generation = 0;
  private observedStoreVersion: number;
  private entries: Array<{ file: TFile; item: ReadingLibraryItem }> = [];
  private query: ReadingLibraryQuery = { ...DEFAULT_READING_LIBRARY_QUERY };
  private resultsEl!: HTMLElement;
  private countEl!: HTMLElement;
  private formatSelect!: HTMLSelectElement;
  private parentSelect!: HTMLSelectElement;
  private viewMode: LibraryViewMode = "list";
  private listButton!: HTMLButtonElement;
  private gridButton!: HTMLButtonElement;
  private coverGeneration = 0;
  private objectUrls = new Set<string>();
  private coverMemory = new Map<string, { mtime: number; blob: Blob }>();
  private coverChecked = new Map<string, number>();

  constructor(
    leaf: WorkspaceLeaf,
    private readonly store: AnnotationStore,
    private readonly openBook: (file: TFile) => void,
    private readonly openPdf: (file: TFile) => void,
    private readonly getReadingProfile: () => EpubReadingProfile,
    private readonly isPdfProgressTrackingEnabled: () => boolean,
    private readonly coverCache: BookCoverCache,
    private readonly viewModeStorageKey: string,
  ) {
    super(leaf);
    this.observedStoreVersion = store.version;
  }

  getViewType(): string { return EPUB_BOOKSHELF_VIEW_TYPE; }
  getDisplayText(): string { return "阅读资料库"; }
  getIcon(): string { return "library"; }

  async onOpen(): Promise<void> {
    this.viewMode = this.readViewMode();
    this.buildShell();
    this.registerEvent(this.app.vault.on("create", () => this.refresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.refresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.refresh()));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile && (file.extension.toLowerCase() === "pdf"
        || (SUPPORTED_BOOK_EXTENSIONS as readonly string[]).includes(file.extension.toLowerCase()))) this.refresh();
    }));
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
    this.coverGeneration++;
    this.releaseObjectUrls();
    this.coverMemory.clear();
    this.coverChecked.clear();
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

  coverUpdated(path: string): void {
    this.coverMemory.delete(path);
    this.coverChecked.delete(path);
    this.refresh();
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
    this.entries = items;
    this.contentEl.toggleClass("yh-epub-eink", this.getReadingProfile().einkMode === true);
    this.updateOptions();
    this.renderResults();
  }

  private buildShell(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("yh-epub-bookshelf-view");
    container.createEl("h4", { cls: "bookshelf-heading", text: "阅读资料库" });
    const controls = container.createDiv({ cls: "bookshelf-controls" });
    const search = controls.createEl("input", {
      cls: "bookshelf-search",
      attr: { type: "search", placeholder: "搜索名称或路径", "aria-label": "搜索资料库" },
    });
    search.addEventListener("input", () => {
      this.query.search = search.value;
      this.renderResults();
    });
    const filters = controls.createDiv({ cls: "bookshelf-filters" });
    this.createSelect(filters, "阅读状态", [
      ["all", "全部"], ["recent", "最近"], ["unstarted", "未开始"],
      ["reading", "在读"], ["finished", "已读"], ["untracked", "未记录"],
    ], (value) => { this.query.status = value as ReadingLibraryQuery["status"]; this.renderResults(); });
    this.formatSelect = this.createSelect(filters, "格式", [["all", "全部格式"]],
      (value) => { this.query.format = value; this.renderResults(); });
    this.parentSelect = this.createSelect(filters, "父目录", [["", "全部目录"]],
      (value) => { this.query.parentPath = value === "" ? null : decodeURIComponent(value.slice(2)); this.renderResults(); });
    this.createSelect(filters, "排序", [["recent", "最近阅读"], ["title", "标题"], ["progress", "进度"]],
      (value) => { this.query.sort = value as ReadingLibraryQuery["sort"]; this.renderResults(); });
    const viewBar = container.createDiv({ cls: "bookshelf-view-bar" });
    this.countEl = viewBar.createDiv({ cls: "bookshelf-count" });
    const viewSwitch = viewBar.createDiv({ cls: "bookshelf-view-switch", attr: { role: "group", "aria-label": "资料库视图" } });
    this.listButton = this.createViewButton(viewSwitch, "list", "列表视图", "list");
    this.gridButton = this.createViewButton(viewSwitch, "grid", "封面网格", "grid-2x2");
    this.updateViewButtons();
    this.resultsEl = container.createDiv({ cls: "bookshelf-results" });
  }

  private createViewButton(parent: HTMLElement, mode: LibraryViewMode, label: string, icon: string): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "bookshelf-view-button", attr: { type: "button", title: label, "aria-label": label } });
    setIcon(button, icon);
    button.addEventListener("click", () => {
      if (this.viewMode === mode) return;
      this.viewMode = mode;
      try { window.localStorage.setItem(this.viewModeStorageKey, mode); }
      catch (error) { console.warn("yh-inklight: cannot save local library view", error); }
      this.updateViewButtons();
      this.renderResults();
    });
    return button;
  }

  private readViewMode(): LibraryViewMode {
    try { return normalizeLibraryViewMode(window.localStorage.getItem(this.viewModeStorageKey)); }
    catch { return "list"; }
  }

  private updateViewButtons(): void {
    this.listButton.setAttribute("aria-pressed", String(this.viewMode === "list"));
    this.gridButton.setAttribute("aria-pressed", String(this.viewMode === "grid"));
  }

  private createSelect(
    parent: HTMLElement, label: string, options: Array<[string, string]>, onChange: (value: string) => void,
  ): HTMLSelectElement {
    const select = parent.createEl("select", { cls: "bookshelf-select", attr: { "aria-label": label, title: label } });
    for (const [value, text] of options) select.createEl("option", { value, text });
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  private updateOptions(): void {
    const formats = [...new Set(this.entries.map(({ item }) => item.extension.toLowerCase()))].sort();
    const parents = [...new Set(this.entries.map(({ item }) => item.parentPath))].sort((a, b) => a.localeCompare(b));
    this.formatSelect.replaceChildren();
    this.formatSelect.createEl("option", { value: "all", text: "全部格式" });
    for (const format of formats) this.formatSelect.createEl("option", { value: format, text: format.toUpperCase() });
    if (this.query.format !== "all" && !formats.includes(this.query.format)) this.query.format = "all";
    this.formatSelect.value = this.query.format;
    this.parentSelect.replaceChildren();
    this.parentSelect.createEl("option", { value: "", text: "全部目录" });
    for (const path of parents) this.parentSelect.createEl("option", { value: `p:${encodeURIComponent(path)}`, text: path || "/" });
    if (this.query.parentPath !== null && !parents.includes(this.query.parentPath)) this.query.parentPath = null;
    this.parentSelect.value = this.query.parentPath === null ? "" : `p:${encodeURIComponent(this.query.parentPath)}`;
  }

  private renderResults(): void {
    const coverGeneration = ++this.coverGeneration;
    this.releaseObjectUrls();
    const selected = queryReadingLibrary(this.entries.map(({ item }) => item), this.query);
    const files = new Map(this.entries.map(({ file }) => [file.path, file]));
    this.countEl.textContent = `${selected.length} / ${this.entries.length}`;
    this.resultsEl.empty();
    if (selected.length === 0) {
      this.resultsEl.createEl("p", { cls: "bookshelf-empty",
        text: this.entries.length === 0 ? "Vault 中没有找到电子书或 PDF 文件。" : "没有符合条件的文件。" });
      return;
    }
    const list = this.resultsEl.createDiv({ cls: "bookshelf-list" });
    list.toggleClass("bookshelf-grid", this.viewMode === "grid");
    const coverSlots: Array<{ file: TFile; element: HTMLElement }> = [];
    for (const item of selected) {
      const file = files.get(item.path);
      if (!file) continue;
      const row = list.createDiv({ cls: "bookshelf-item", attr: { role: "button", tabindex: "0" } });
      if (this.viewMode === "grid") {
        const cover = row.createDiv({ cls: "bookshelf-cover" });
        cover.createSpan({ cls: "bookshelf-cover-initial", text: Array.from(item.basename.trim())[0] ?? "·" });
        cover.createSpan({ cls: "bookshelf-cover-format", text: item.extension.toUpperCase() });
        if (item.kind === "ebook") coverSlots.push({ file, element: cover });
      } else {
        const icon = row.createSpan({ cls: "bookshelf-file-icon" });
        setIcon(icon, item.kind === "pdf" ? "file-text" : "book-open");
      }
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
      const open = () => item.kind === "pdf" ? this.openPdf(file) : this.openBook(file);
      row.addEventListener("click", open);
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
      });
    }
    if (coverSlots.length > 0) void this.loadCovers(coverSlots, coverGeneration);
  }

  private async loadCovers(slots: Array<{ file: TFile; element: HTMLElement }>, generation: number): Promise<void> {
    const pending = slots.map(({ file }) => ({ file, mtime: file.stat.mtime })).filter(({ file, mtime }) => {
      const cached = this.coverMemory.get(file.path);
      if (cached && cached.mtime !== mtime) this.coverMemory.delete(file.path);
      return this.coverChecked.get(file.path) !== mtime;
    });
    if (pending.length > 0) {
      const covers = await this.coverCache.getMany(pending.map(({ file, mtime }) => ({ path: file.path, mtime })));
      for (const { file, mtime } of pending) {
        this.coverChecked.set(file.path, mtime);
        const blob = covers.get(file.path);
        if (blob) this.coverMemory.set(file.path, { mtime, blob });
      }
    }
    if (generation !== this.coverGeneration) return;
    for (const { file, element } of slots) {
      const cached = this.coverMemory.get(file.path);
      if (!cached || cached.mtime !== file.stat.mtime) continue;
      const blob = cached.blob;
      const url = URL.createObjectURL(blob);
      this.objectUrls.add(url);
      const image = element.createEl("img", { attr: { alt: "" } });
      image.onload = () => element.addClass("has-image");
      image.onerror = () => {
        element.removeClass("has-image");
        image.remove();
        URL.revokeObjectURL(url);
        this.objectUrls.delete(url);
      };
      image.src = url;
    }
  }

  private releaseObjectUrls(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }
}

function formatReadingTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${hours > 0 ? `${hours}小时` : ""}${minutes > 0 || hours > 0 ? `${minutes}分` : ""}${secs}秒`;
}
