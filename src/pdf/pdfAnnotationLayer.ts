/**
 * [INPUT]: 依赖 Obsidian workspace/vault、PDF viewer DOM selection、storage/types 的 PDF 注释模型
 * [OUTPUT]: 对外提供 PdfAnnotationLayer，在 PDF 页面上绘制非侵入式高亮与弹层批注
 * [POS]: pdf 模块的渲染与选区控制器，与 Markdown/CM6 通道并列，共享 sidecar store
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { App, Component, MarkdownRenderer, Notice, setIcon, TFile } from "obsidian";

import {
  AnnotationColor,
  AnnotationPluginSettings,
  FileAnnotationDocument,
  PdfAnchor,
  PdfCommentAnnotation,
  PdfHighlightAnnotation,
  PdfReadingProgress,
} from "../storage/types";
import { PdfViewerAdapter } from "./pdfViewerAdapter";

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
  saveProgress: (file: TFile, progress: PdfReadingProgress) => Promise<void>;
  getProgress: (file: TFile) => Promise<PdfReadingProgress | null>;
  viewerAdapter: PdfViewerAdapter;
}

interface PdfSelectionSnapshot {
  file: TFile;
  anchor: PdfAnchor;
}

const PDF_VIEWER_SELECTOR = ".pdf-container, .pdf-viewer, .pdf-embed, .workspace-leaf-content[data-type='pdf']";

export class PdfAnnotationLayer {
  private root: HTMLElement | null = null;
  private popover: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private frame: number | null = null;
  private lastSelection: PdfSelectionSnapshot | null = null;
  private currentPage = 0;
  private totalPages = 0;
  private progressSaveTimer: number | null = null;
  private sessionFilePath = "";
  private lifecycleHost: HTMLElement | null = null;

  constructor(private readonly options: PdfAnnotationLayerOptions) {}

  private get viewerAdapter(): PdfViewerAdapter {
    return this.options.viewerAdapter;
  }

  register(): void {
    this.options.component.registerDomEvent(document, "selectionchange", () => this.captureSelection());
    this.options.component.registerDomEvent(document, "mouseup", () => {
      window.setTimeout(() => this.captureSelection(), 10);
    });
    this.options.component.registerDomEvent(document, "click", (event) => {
      void this.handleClick(event);
    });
    this.options.component.registerEvent(
      this.options.app.workspace.on("active-leaf-change", () => {
        this.scheduleRender();
      }),
    );
    this.options.component.registerEvent(
      this.options.app.workspace.on("layout-change", () => this.scheduleRender()),
    );
    // 全局滚动：检测 PDF 页面切换 → 更新进度
    this.options.component.registerDomEvent(document, "scroll", () => this.updateCurrentPage(), { passive: true, capture: true });

    this.observer = new MutationObserver(() => this.scheduleRender());
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.options.component.register(() => this.destroy());
    this.scheduleRender();
  }

  async createHighlight(color: AnnotationColor): Promise<boolean> {
    const snapshot = this.resolveSelection();
    if (!snapshot) {
      new Notice("请先在 PDF 中选中文本。");
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
      new Notice("请先在 PDF 中选中文本。");
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
    return this.viewerAdapter.isPdfActive();
  }

  /** 实时计算当前视口中心的页码（不依赖缓存的 currentPage）。 */
  private computeCurrentPage(): number {
    return this.viewerAdapter.getCurrentPageNumber();
  }

  /** 当前正在阅读的页码（供主命令调用）。 */
  getCurrentPageNumber(): number {
    // 实时计算，不依赖可能过期的缓存
    const live = this.computeCurrentPage();
    if (live >= 1) {
      this.currentPage = live;
    }
    return this.currentPage;
  }

  /** 当前打开的 PDF 文件（供主命令调用）。 */
  getActiveFile(): TFile | null {
    return this.viewerAdapter.getActiveFile();
  }

  // ===== PDF 目录（Phase 5 P3） =====

  /** 获取 PDF 大纲/目录（来自 pdf.js）。 */
  async getOutline(): Promise<Array<{ title: string; pageNumber: number; children: Array<{ title: string; pageNumber: number }> }>> {
    const result: Array<{ title: string; pageNumber: number; children: Array<{ title: string; pageNumber: number }> }> = [];
    try {
      const pdfViewerApp = (window as unknown as Record<string, unknown>).PDFViewerApp as Record<string, unknown> | undefined;
      const pdfViewer = pdfViewerApp?.pdfViewer as Record<string, unknown> | undefined;
      const pdfDocument = pdfViewer?.pdfDocument as { getOutline?: () => Promise<Array<Record<string, unknown>>> } | undefined;
      if (!pdfDocument?.getOutline) return result;
      const outline = await pdfDocument.getOutline();
      if (!Array.isArray(outline)) return result;
      for (const item of outline) {
        const title = String(item.title ?? "");
        if (!title) continue;
        const pageNum = await this.outlineDestToPage(item);
        const children: Array<{ title: string; pageNumber: number }> = [];
        if (Array.isArray(item.items)) {
          for (const child of item.items) {
            const childTitle = String(child.title ?? "");
            if (!childTitle) continue;
            children.push({ title: childTitle, pageNumber: await this.outlineDestToPage(child) });
          }
        }
        result.push({ title, pageNumber: pageNum, children });
      }
    } catch (e) {
      console.warn("yh-inklight: PDF getOutline failed", e);
    }
    return result;
  }

  /** 解析 pdf.js outline item 的目标页码。 */
  private async outlineDestToPage(item: Record<string, unknown>): Promise<number> {
    try {
      const dest = item.dest;
      if (typeof dest === "string") {
        const pdfViewerApp = (window as unknown as Record<string, unknown>).PDFViewerApp as Record<string, unknown> | undefined;
        const pdfViewer = pdfViewerApp?.pdfViewer as Record<string, unknown> | undefined;
        const pdfDocument = pdfViewer?.pdfDocument as { getPageIndex?: (dest: string) => Promise<number> } | undefined;
        if (pdfDocument?.getPageIndex) {
          const idx = await pdfDocument.getPageIndex(dest);
          return idx >= 0 ? idx + 1 : 0;
        }
      }
      if (Array.isArray(dest) && dest.length > 0) {
        const ref = dest[0] as { num?: number } | undefined;
        if (ref?.num !== undefined) {
          const pdfViewerApp = (window as unknown as Record<string, unknown>).PDFViewerApp as Record<string, unknown> | undefined;
          const pdfViewer = pdfViewerApp?.pdfViewer as Record<string, unknown> | undefined;
          const pdfDocument = pdfViewer?.pdfDocument as { getPageIndex?: (ref: { num?: number }) => Promise<number> } | undefined;
          if (pdfDocument?.getPageIndex) {
            const idx = await pdfDocument.getPageIndex(ref);
            return idx >= 0 ? idx + 1 : 0;
          }
        }
      }
    } catch { /* ignore */ }
    return 0;
  }


  // ===== PDF 阅读进度（Phase 5 P1） =====

  /** 从 sidecar 恢复上次阅读位置并跳转到对应页面。 */
  async restoreProgress(): Promise<void> {
    const file = this.activePdfFile();
    if (!file) return;
    const progress = await this.options.getProgress(file);
    if (!progress || progress.pageNumber < 1) return;
    await this.viewerAdapter.goToPage(progress.pageNumber, { flash: true, block: "center" });
    this.currentPage = progress.pageNumber;
  }

  /** 保存当前阅读进度到 sidecar（防抖 2 秒）。 */
  private debouncedSaveProgress(): void {
    if (!this.options.getSettings().pdfProgressTracking) {
      return;
    }
    if (this.progressSaveTimer !== null) {
      window.clearTimeout(this.progressSaveTimer);
    }
    this.progressSaveTimer = window.setTimeout(async () => {
      this.progressSaveTimer = null;
      const file = this.activePdfFile();
      if (!file || this.currentPage < 1) return;
      const allPages = this.pages();
      await this.options.saveProgress(file, {
        pageNumber: this.currentPage,
        totalPages: allPages.length,
        percent: allPages.length > 0 ? this.currentPage / allPages.length : 0,
        lastRead: new Date().toISOString(),
      });
    }, 2000);
  }

  /** 在 active-leaf-change 或 scroll 时更新 currentPage 并触发保存。 */
  private updateCurrentPage(): void {
    const viewer = this.activeViewer();
    if (!viewer) return;
    const state = this.viewerAdapter.getViewState();
    if (!state || state.page < 1) return;
    this.totalPages = state.totalPages;
    const closestPage = state.page;
    if (closestPage !== this.currentPage && closestPage >= 1) {
      this.currentPage = closestPage;
      this.debouncedSaveProgress();
    }
  }

  destroy(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
    }
    if (this.progressSaveTimer !== null) {
      window.clearTimeout(this.progressSaveTimer);
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
    const context = this.viewerAdapter.getContext();
    if (!context) {
      this.root?.remove();
      this.root = null;
      return;
    }
    const { file, viewerEl: viewer } = context;
    this.attachViewerLifecycle(context.viewerEl);

    const document = await this.options.getDocument(file);
    const settings = this.options.getSettings();
    const host = viewer.closest<HTMLElement>(".workspace-leaf-content") ?? viewer;
    host.addClass("yh-pdf-host");
    host.style.setProperty("--yh-sticky-width", `${settings.stickyWidth}px`);

    if (!this.root || this.root.parentElement !== host) {
      this.root?.remove();
      this.root = host.createDiv({ cls: "yh-pdf-layer" });
    }

    this.renderHighlights(host, document);
    // Phase 5 P1：渲染后恢复上次阅读位置；同时更新页数并注册滚动检测
    this.totalPages = this.pages().length;
    if (this.sessionFilePath !== (file?.path ?? "")) { this.sessionFilePath = file?.path ?? ""; void this.restoreProgress(); }
  }

  private renderHighlights(host: HTMLElement, document: FileAnnotationDocument): void {
    if (!this.root) {
      return;
    }

    this.root.querySelectorAll(".yh-pdf-highlight").forEach((item) => item.remove());
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
          cls: `yh-pdf-highlight yh-pdf-highlight--${annotation.color}`,
          attr: {
            "data-yh-id": annotation.id,
            "data-yh-color": annotation.color,
          },
        });
        highlight.style.left = `${pageRect.left - hostRect.left + rect.left * pageRect.width}px`;
        highlight.style.top = `${pageRect.top - hostRect.top + rect.top * pageRect.height}px`;
        highlight.style.width = `${rect.width * pageRect.width}px`;
        highlight.style.height = `${rect.height * pageRect.height}px`;
        highlight.style.setProperty("background-color", pdfHighlightBackground(annotation.color), "important");
      }
    }
  }

  private attachViewerLifecycle(host: HTMLElement): void {
    if (this.lifecycleHost === host) {
      return;
    }

    const pageEventsAttached = this.viewerAdapter.onPageReady(() => this.scheduleRender());
    const textEventsAttached = this.viewerAdapter.onTextLayerReady(() => this.scheduleRender());
    if (pageEventsAttached || textEventsAttached) {
      this.lifecycleHost = host;
    }
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

    const container = selectionContainer(selection);
    if (!container?.closest(PDF_VIEWER_SELECTOR)) {
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
    };
  }

  private async handleClick(event: MouseEvent): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const highlight = target.closest<HTMLElement>(".yh-pdf-highlight");
    if (!highlight) {
      if (!target.closest(".yh-pdf-popover")) {
        this.hidePopover();
      }
      return;
    }

    const file = this.activePdfFile();
    const id = highlight.dataset.yhId;
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
    this.popover = document.body.createDiv({ cls: "yh-pdf-popover yh-annotation-popover is-visible" });
    const header = this.popover.createDiv({ cls: "yh-popover-header" });
    header.createSpan({ cls: "yh-popover-title", text: `PDF 第 ${annotation.anchor.pageNumber} 页` });
    const close = header.createEl("button", { cls: "yh-icon-button", attr: { type: "button", title: "关闭" } });
    setIcon(close, "x");
    close.addEventListener("click", () => this.hidePopover());

    const card = this.popover.createDiv({
      cls: "yh-popover-card",
      attr: { "data-yh-color": annotation.color, "data-yh-id": annotation.id },
    });
    card.createDiv({ cls: "yh-popover-quote", text: annotation.anchor.selectedText });
    if ("content" in annotation && annotation.content) {
      const body = card.createDiv({ cls: "yh-popover-body" });
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
    return this.viewerAdapter.pageElementFromRect(rect);
  }

  private pageElement(pageNumber: number): HTMLElement | null {
    return this.viewerAdapter.pageElement(pageNumber);
  }

  private pages(): HTMLElement[] {
    return this.viewerAdapter.pages();
  }

  private pageNumber(page: HTMLElement): number {
    return this.viewerAdapter.pageNumber(page);
  }

  private activeViewer(): HTMLElement | null {
    return this.viewerAdapter.getContext()?.viewerEl ?? null;
  }

  private activePdfFile(): TFile | null {
    return this.viewerAdapter.getActiveFile();
  }
}

function selectionContainer(selection: Selection): Element | null {
  if (selection.rangeCount === 0) {
    return null;
  }

  const node = selection.getRangeAt(0).commonAncestorContainer;
  return node instanceof Element ? node : node.parentElement;
}

function pdfHighlightBackground(color: AnnotationColor): string {
  const colors: Record<AnnotationColor, string> = {
    yellow: "rgba(255, 213, 0, 0.35)",
    orange: "rgba(255, 140, 0, 0.35)",
    pink: "rgba(255, 105, 180, 0.35)",
    green: "rgba(82, 196, 26, 0.35)",
    blue: "rgba(22, 119, 255, 0.35)",
    purple: "rgba(114, 46, 209, 0.35)",
  };

  return colors[color] ?? colors.yellow;
}
