/**
 * [INPUT]: 依赖 Obsidian workspace/vault、PDF viewer DOM selection、storage/types 的 PDF 注释模型
 * [OUTPUT]: 对外提供 PdfAnnotationLayer，在 PDF 页面上绘制非侵入式高亮与右侧便签栏
 * [POS]: pdf 模块的渲染与选区控制器，与 Markdown/CM6 通道并列，共享 sidecar store
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { App, Component, MarkdownRenderer, Notice, TFile, setIcon } from "obsidian";

import {
  AnnotationColor,
  AnnotationPluginSettings,
  FileAnnotationDocument,
  PdfAnchor,
  PdfCommentAnnotation,
  PdfHighlightAnnotation,
} from "../storage/types";

interface PdfAnnotationLayerOptions {
  app: App;
  component: Component;
  getSettings: () => AnnotationPluginSettings;
  getDocument: (file: TFile) => Promise<FileAnnotationDocument>;
  getCachedDocument: (filePath: string) => FileAnnotationDocument | null;
  addHighlight: (file: TFile, highlight: PdfHighlightAnnotation) => Promise<void>;
  addComment: (file: TFile, comment: PdfCommentAnnotation) => Promise<void>;
  updateComment: (file: TFile, comment: PdfCommentAnnotation) => Promise<void>;
  deleteAnnotation: (file: TFile, annotationId: string) => Promise<void>;
}

interface PdfSelectionSnapshot {
  file: TFile;
  anchor: PdfAnchor;
}

const PDF_PAGE_SELECTOR = ".pdf-page, .page[data-page-number], .page";
const PDF_VIEWER_SELECTOR = ".pdf-container, .pdf-viewer, .pdf-embed, .workspace-leaf-content[data-type='pdf']";

export class PdfAnnotationLayer {
  private root: HTMLElement | null = null;
  private lane: HTMLElement | null = null;
  private popover: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private frame: number | null = null;
  private lastSelection: PdfSelectionSnapshot | null = null;

  constructor(private readonly options: PdfAnnotationLayerOptions) {}

  register(): void {
    this.options.component.registerDomEvent(document, "selectionchange", () => this.captureSelection());
    this.options.component.registerDomEvent(document, "click", (event) => {
      void this.handleClick(event);
    });
    this.options.component.registerEvent(
      this.options.app.workspace.on("active-leaf-change", () => this.scheduleRender()),
    );
    this.options.component.registerEvent(
      this.options.app.workspace.on("layout-change", () => this.scheduleRender()),
    );

    this.observer = new MutationObserver(() => this.scheduleRender());
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.options.component.register(() => this.destroy());
    this.scheduleRender();
  }

  async createHighlight(color: AnnotationColor): Promise<boolean> {
    const snapshot = this.resolveSelection();
    if (!snapshot) {
      new Notice("Select text in a PDF first.");
      return true;
    }

    await this.options.addHighlight(snapshot.file, {
      id: crypto.randomUUID(),
      color,
      anchor: snapshot.anchor,
      createdAt: new Date().toISOString(),
    });
    this.clearSelection();
    this.scheduleRender();
    return true;
  }

  async createComment(color: AnnotationColor, content: string, author: string, title = ""): Promise<boolean> {
    const snapshot = this.resolveSelection();
    if (!snapshot) {
      new Notice("Select text in a PDF first.");
      return true;
    }

    const now = new Date().toISOString();
    await this.options.addComment(snapshot.file, {
      id: crypto.randomUUID(),
      anchor: snapshot.anchor,
      title,
      content,
      color,
      position: { offsetX: 0, offsetY: 0 },
      collapsed: false,
      author,
      createdAt: now,
      updatedAt: now,
      replies: [],
      resolved: false,
    });
    this.clearSelection();
    this.scheduleRender();
    return true;
  }

  isPdfActive(): boolean {
    return this.activePdfFile() !== null;
  }

  destroy(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
    }
    this.observer?.disconnect();
    this.root?.remove();
    this.popover?.remove();
  }

  private scheduleRender = (): void => {
    if (this.frame !== null) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      void this.render();
    });
  };

  private async render(): Promise<void> {
    const file = this.activePdfFile();
    const viewer = this.activeViewer();
    if (!file || !viewer) {
      this.root?.remove();
      this.root = null;
      return;
    }

    const document = await this.options.getDocument(file);
    const settings = this.options.getSettings();
    const host = viewer.closest<HTMLElement>(".workspace-leaf-content") ?? viewer;
    host.addClass("axl-pdf-host");
    host.style.setProperty("--axl-sticky-width", `${settings.stickyWidth}px`);

    if (!this.root || this.root.parentElement !== host) {
      this.root?.remove();
      this.root = host.createDiv({ cls: "axl-pdf-layer" });
      this.lane = this.root.createDiv({ cls: "axl-pdf-sticky-lane" });
    }

    const hostRect = host.getBoundingClientRect();
    const activeComments = document.pdfComments.filter((comment) => !comment.orphaned && !comment.resolved);
    const collapsed = hostRect.width < settings.stickyCollapseWidth;
    const laneVisible = settings.stickyNotesVisible && !collapsed && activeComments.length > 0;
    this.root.toggleClass("is-collapsed", !laneVisible);
    host.toggleClass("axl-pdf-sticky-active", laneVisible);

    this.renderHighlights(host, document);
    this.renderLane(file, activeComments, settings, laneVisible);
  }

  private renderHighlights(host: HTMLElement, document: FileAnnotationDocument): void {
    if (!this.root) {
      return;
    }

    this.root.querySelectorAll(".axl-pdf-highlight").forEach((item) => item.remove());
    const hostRect = host.getBoundingClientRect();
    const annotations = [...document.pdfHighlights, ...document.pdfComments].filter((item) => !item.orphaned);

    for (const annotation of annotations) {
      for (const rect of annotation.anchor.rects) {
        const page = this.pageElement(rect.pageNumber);
        if (!page) {
          continue;
        }

        const pageRect = page.getBoundingClientRect();
        const highlight = this.root.createDiv({
          cls: "axl-pdf-highlight",
          attr: {
            "data-axl-id": annotation.id,
            "data-axl-color": annotation.color,
          },
        });
        highlight.style.left = `${pageRect.left - hostRect.left + rect.left * pageRect.width}px`;
        highlight.style.top = `${pageRect.top - hostRect.top + rect.top * pageRect.height}px`;
        highlight.style.width = `${rect.width * pageRect.width}px`;
        highlight.style.height = `${rect.height * pageRect.height}px`;
      }
    }
  }

  private renderLane(
    file: TFile,
    comments: PdfCommentAnnotation[],
    settings: AnnotationPluginSettings,
    laneVisible: boolean,
  ): void {
    if (!this.lane) {
      return;
    }

    this.lane.empty();
    this.lane.style.width = `${settings.stickyWidth}px`;
    if (!laneVisible) {
      return;
    }

    const laneHeader = this.lane.createDiv({ cls: "axl-sticky-lane-header" });
    laneHeader.createSpan({ cls: "axl-sticky-lane-title", text: `便利贴 (${comments.length})` });
    laneHeader.createEl("button", { cls: "axl-icon-button", attr: { type: "button", title: "Filter" } }).setText("⌕");
    laneHeader.createEl("button", { cls: "axl-icon-button", attr: { type: "button", title: "More" } }).setText("⋯");

    for (const comment of comments) {
      const card = this.lane.createDiv({
        cls: "axl-pdf-sticky-card",
        attr: { "data-axl-color": comment.color, "data-axl-id": comment.id },
      });

      const header = card.createDiv({ cls: "axl-sticky-header" });
      header.createSpan({ cls: "axl-sticky-color", attr: { "data-axl-color": comment.color } });
      header.createSpan({ cls: "axl-sticky-title", text: comment.title || "便签" });
      header.createSpan({ cls: "axl-sticky-time", text: formatTime(comment.updatedAt) });
      const star = header.createEl("button", {
        cls: "axl-icon-button axl-sticky-star",
        attr: { type: "button", title: "Star placeholder", "aria-label": "Star placeholder" },
      });
      setIcon(star, "star");

      const edit = header.createEl("button", { cls: "axl-icon-button", attr: { type: "button", title: "Edit note" } });
      setIcon(edit, "pencil");

      const remove = header.createEl("button", { cls: "axl-icon-button", attr: { type: "button", title: "Delete note" } });
      setIcon(remove, "trash-2");
      remove.addEventListener("click", () => {
        void this.options.deleteAnnotation(file, comment.id).then(() => this.scheduleRender());
      });

      card.createDiv({ cls: "axl-sticky-excerpt", text: comment.anchor.selectedText });
      const content = card.createDiv({ cls: "axl-sticky-content" });
      this.renderPdfCommentDisplay(content, file, comment);
      edit.addEventListener("click", () => this.renderPdfCommentEditor(content, file, comment));
      card.createDiv({ cls: "axl-sticky-more", text: "..." });
    }
  }

  private renderPdfCommentDisplay(container: HTMLElement, file: TFile, comment: PdfCommentAnnotation): void {
    container.empty();
    const body = container.createDiv({ cls: "axl-sticky-body" });
    MarkdownRenderer.render(this.options.app, comment.content, body, file.path, this.options.component);
  }

  private renderPdfCommentEditor(container: HTMLElement, file: TFile, comment: PdfCommentAnnotation): void {
    container.empty();
    const title = container.createEl("input", {
      cls: "axl-sticky-title-editor",
      attr: { type: "text", placeholder: "Title" },
    });
    title.value = comment.title ?? "";
    const editor = container.createEl("textarea", {
      cls: "axl-sticky-editor",
      attr: { rows: "5", placeholder: "Write a Markdown note..." },
    });
    editor.value = comment.content;
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);

    const actions = container.createDiv({ cls: "axl-sticky-edit-actions" });
    const save = actions.createEl("button", { text: "Save", cls: "mod-cta", attr: { type: "button" } });
    const cancel = actions.createEl("button", { text: "Cancel", attr: { type: "button" } });
    const saveContent = (): void => {
      const next = {
        ...comment,
        title: title.value.trim(),
        content: editor.value,
        updatedAt: new Date().toISOString(),
      };
      void this.options.updateComment(file, next).then(() => {
        this.renderPdfCommentDisplay(container, file, next);
        this.scheduleRender();
      });
    };

    save.addEventListener("click", saveContent);
    cancel.addEventListener("click", () => this.renderPdfCommentDisplay(container, file, comment));
    editor.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        saveContent();
      }
    });
  }

  private captureSelection(): void {
    const file = this.activePdfFile();
    if (!file) {
      return;
    }

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() ?? "";
    if (!selection || selection.rangeCount === 0 || !selectedText) {
      return;
    }

    const anchor = this.anchorFromSelection(selection, selectedText);
    if (anchor) {
      this.lastSelection = { file, anchor };
    }
  }

  private anchorFromSelection(selection: Selection, selectedText: string): PdfAnchor | null {
    const rects: PdfAnchor["rects"] = [];
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width < 1 || rect.height < 1) {
          continue;
        }

        const page = this.pageElementFromRect(rect);
        if (!page) {
          continue;
        }

        const pageRect = page.getBoundingClientRect();
        rects.push({
          pageNumber: this.pageNumber(page),
          left: (rect.left - pageRect.left) / pageRect.width,
          top: (rect.top - pageRect.top) / pageRect.height,
          width: rect.width / pageRect.width,
          height: rect.height / pageRect.height,
        });
      }
    }

    if (rects.length === 0) {
      return null;
    }

    return {
      pageNumber: rects[0].pageNumber,
      selectedText,
      rects,
      createdScale: this.currentScale(),
    };
  }

  private async handleClick(event: MouseEvent): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const highlight = target.closest<HTMLElement>(".axl-pdf-highlight");
    if (!highlight) {
      if (!target.closest(".axl-pdf-popover")) {
        this.hidePopover();
      }
      return;
    }

    const file = this.activePdfFile();
    const id = highlight.dataset.axlId;
    if (!file || !id) {
      return;
    }

    const document = this.options.getCachedDocument(file.path) ?? (await this.options.getDocument(file));
    const annotation =
      document.pdfComments.find((item) => item.id === id) ?? document.pdfHighlights.find((item) => item.id === id);
    if (!annotation) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.showPopover(file.path, highlight.getBoundingClientRect(), annotation);
  }

  private showPopover(sourcePath: string, rect: DOMRect, annotation: PdfHighlightAnnotation | PdfCommentAnnotation): void {
    this.hidePopover();
    this.popover = document.body.createDiv({ cls: "axl-pdf-popover axl-annotation-popover is-visible" });
    const header = this.popover.createDiv({ cls: "axl-popover-header" });
    header.createSpan({ cls: "axl-popover-title", text: `PDF page ${annotation.anchor.pageNumber}` });
    const close = header.createEl("button", { cls: "axl-icon-button", attr: { type: "button", title: "Close" } });
    setIcon(close, "x");
    close.addEventListener("click", () => this.hidePopover());

    const card = this.popover.createDiv({
      cls: "axl-popover-card",
      attr: { "data-axl-color": annotation.color, "data-axl-id": annotation.id },
    });
    card.createDiv({ cls: "axl-popover-quote", text: annotation.anchor.selectedText });
    if ("content" in annotation && annotation.content) {
      const body = card.createDiv({ cls: "axl-popover-body" });
      MarkdownRenderer.render(this.options.app, annotation.content, body, sourcePath, this.options.component);
    }

    const width = Math.min(320, window.innerWidth - 24);
    this.popover.style.width = `${width}px`;
    this.popover.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, rect.left))}px`;
    this.popover.style.top = `${Math.max(12, Math.min(window.innerHeight - 240, rect.bottom + 8))}px`;
  }

  private hidePopover(): void {
    this.popover?.remove();
    this.popover = null;
  }

  private resolveSelection(): PdfSelectionSnapshot | null {
    this.captureSelection();
    return this.lastSelection;
  }

  private clearSelection(): void {
    window.getSelection()?.removeAllRanges();
    this.lastSelection = null;
  }

  private pageElementFromRect(rect: DOMRect): HTMLElement | null {
    const element = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return element?.closest<HTMLElement>(PDF_PAGE_SELECTOR) ?? null;
  }

  private pageElement(pageNumber: number): HTMLElement | null {
    const pages = this.pages();
    return pages.find((page) => this.pageNumber(page) === pageNumber) ?? null;
  }

  private pages(): HTMLElement[] {
    const viewer = this.activeViewer();
    return viewer ? Array.from(viewer.querySelectorAll<HTMLElement>(PDF_PAGE_SELECTOR)) : [];
  }

  private pageNumber(page: HTMLElement): number {
    const attr = page.dataset.pageNumber ?? page.getAttr("data-page-number");
    const parsed = attr ? Number.parseInt(attr, 10) : NaN;
    if (Number.isFinite(parsed)) {
      return parsed;
    }

    return Math.max(1, this.pages().indexOf(page) + 1);
  }

  private currentScale(): number {
    const page = this.pages()[0];
    return page ? page.getBoundingClientRect().width / Math.max(1, page.offsetWidth) : 1;
  }

  private activeViewer(): HTMLElement | null {
    const active = (this.options.app.workspace.activeLeaf?.view as { containerEl?: HTMLElement } | undefined)
      ?.containerEl;
    const root = active ?? document.querySelector<HTMLElement>(".workspace-leaf.mod-active");
    if (!root) {
      return null;
    }
    return root.matches(PDF_VIEWER_SELECTOR) ? root : root.querySelector<HTMLElement>(PDF_VIEWER_SELECTOR);
  }

  private activePdfFile(): TFile | null {
    const file = this.options.app.workspace.getActiveFile();
    return file instanceof TFile && file.extension.toLowerCase() === "pdf" ? file : null;
  }
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
