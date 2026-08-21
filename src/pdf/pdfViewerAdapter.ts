/**
 * [INPUT]: Obsidian workspace active leaf, built-in PDF viewer DOM/pdf.js internals
 * [OUTPUT]: PdfViewerAdapter for current PDF context, page state, navigation and page lifecycle callbacks
 * [POS]: pdf module adapter that isolates fragile Obsidian/PDF.js private APIs from feature code
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { App, Component, TFile } from "obsidian";

const PDF_PAGE_SELECTOR = ".pdf-page, .page[data-page-number], .page";
const PDF_VIEWER_SELECTOR = ".pdf-container, .pdf-viewer, .pdf-embed, .workspace-leaf-content[data-type='pdf']";

type PdfJsEventBus = {
  on?: (name: string, listener: (data: unknown) => void) => void;
  off?: (name: string, listener: (data: unknown) => void) => void;
};

type PdfJsViewer = {
  currentPageNumber?: number;
  pagesCount?: number;
  currentScale?: number;
  currentScaleValue?: string;
  _location?: { pageNumber?: number; left?: number; top?: number };
  _pages?: Array<{ div?: HTMLElement; textLayer?: unknown; annotationLayer?: unknown }>;
  eventBus?: PdfJsEventBus;
  scrollPageIntoView?: (args: { pageNumber: number; destArray?: unknown[] }) => void;
};

type ObsidianPdfViewer = {
  eventBus?: PdfJsEventBus;
  pdfViewer?: PdfJsViewer;
  pdfDocument?: unknown;
  dom?: { viewerContainerEl?: HTMLElement; viewerEl?: HTMLElement };
};

type PdfViewerChild = {
  file?: TFile | null;
  pdfViewer?: ObsidianPdfViewer;
  getPage?: (pageNumber: number) => { div?: HTMLElement } | undefined;
};

type PdfViewLike = {
  containerEl?: HTMLElement;
  file?: TFile | null;
  viewer?: { child?: PdfViewerChild | null };
};

export interface PdfViewState {
  page: number;
  left?: number;
  top?: number;
  zoom?: number;
  totalPages: number;
}

export interface PdfViewerContext {
  file: TFile;
  viewRoot: HTMLElement;
  viewerEl: HTMLElement;
  child: PdfViewerChild | null;
  obsidianViewer: ObsidianPdfViewer | null;
  pdfViewer: PdfJsViewer | null;
  eventBus: PdfJsEventBus | null;
}

export class PdfViewerAdapter {
  constructor(private readonly app: App, private readonly component: Component) {}

  getContext(): PdfViewerContext | null {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "pdf") {
      return null;
    }

    const activeView = this.app.workspace.activeLeaf?.view as PdfViewLike | undefined;
    const viewRoot =
      activeView?.containerEl ??
      document.querySelector<HTMLElement>(".workspace-leaf.mod-active");
    if (!viewRoot) {
      return null;
    }

    const viewerEl = viewRoot.matches(PDF_VIEWER_SELECTOR)
      ? viewRoot
      : viewRoot.querySelector<HTMLElement>(PDF_VIEWER_SELECTOR);
    if (!viewerEl) {
      return null;
    }

    const child = activeView?.viewer?.child ?? null;
    const obsidianViewer = child?.pdfViewer ?? this.getGlobalObsidianViewer();
    const pdfViewer = obsidianViewer?.pdfViewer ?? this.getGlobalPdfViewer();
    const eventBus = obsidianViewer?.eventBus ?? pdfViewer?.eventBus ?? null;

    return {
      file,
      viewRoot,
      viewerEl,
      child,
      obsidianViewer: obsidianViewer ?? null,
      pdfViewer: pdfViewer ?? null,
      eventBus,
    };
  }

  isPdfActive(): boolean {
    return this.getContext() !== null;
  }

  getActiveFile(): TFile | null {
    return this.getContext()?.file ?? null;
  }

  getViewState(): PdfViewState | null {
    const context = this.getContext();
    if (!context) {
      return null;
    }

    const pdfViewer = context.pdfViewer;
    const location = pdfViewer?._location;
    const page =
      this.validPage(location?.pageNumber) ??
      this.validPage(pdfViewer?.currentPageNumber) ??
      this.validPage(this.getGlobalPdfViewerAppPage()) ??
      this.validPage(this.readActivePageInput()) ??
      this.validPage(this.computePageFromViewport(context)) ??
      0;
    const totalPages =
      this.validPage(pdfViewer?.pagesCount) ??
      this.pages(context).length;

    return {
      page,
      left: location?.left,
      top: location?.top,
      zoom: typeof pdfViewer?.currentScale === "number" ? pdfViewer.currentScale : undefined,
      totalPages,
    };
  }

  getCurrentPageNumber(): number {
    return this.getViewState()?.page ?? 0;
  }

  getTotalPages(): number {
    return this.getViewState()?.totalPages ?? 0;
  }

  pages(context = this.getContext()): HTMLElement[] {
    if (!context) {
      return [];
    }

    const viewerPages = context.pdfViewer?._pages
      ?.map((page) => page.div)
      .filter((page): page is HTMLElement => page instanceof HTMLElement);
    if (viewerPages?.length) {
      return viewerPages;
    }

    return Array.from(context.viewerEl.querySelectorAll<HTMLElement>(PDF_PAGE_SELECTOR));
  }

  pageElement(pageNumber: number, context = this.getContext()): HTMLElement | null {
    if (!context || pageNumber < 1) {
      return null;
    }

    const childPage = context.child?.getPage?.(pageNumber)?.div;
    if (childPage instanceof HTMLElement) {
      return childPage;
    }

    return this.pages(context).find((page) => this.pageNumber(page, context) === pageNumber) ?? null;
  }

  pageNumber(page: HTMLElement, context = this.getContext()): number {
    const attr = page.dataset.pageNumber ?? page.getAttr("data-page-number");
    const parsed = attr ? Number.parseInt(attr, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= 1) {
      return parsed;
    }

    return Math.max(1, this.pages(context).indexOf(page) + 1);
  }

  pageElementFromRect(rect: DOMRect, context = this.getContext()): HTMLElement | null {
    if (!context) {
      return null;
    }

    const element = context.viewRoot.doc.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return element?.closest<HTMLElement>(PDF_PAGE_SELECTOR) ?? null;
  }

  async goToPage(pageNumber: number, options: { flash?: boolean; block?: ScrollLogicalPosition } = {}): Promise<boolean> {
    const context = this.getContext();
    if (!context || pageNumber < 1) {
      return false;
    }

    const total = this.getTotalPages();
    if (total > 0 && pageNumber > total) {
      return false;
    }

    const pdfViewer = context.pdfViewer;
    if (pdfViewer) {
      try {
        if (typeof pdfViewer.scrollPageIntoView === "function") {
          pdfViewer.scrollPageIntoView({ pageNumber });
        } else {
          pdfViewer.currentPageNumber = pageNumber;
        }
      } catch (error) {
        console.warn("book-note: pdf viewer navigation failed, falling back to DOM scroll", error);
      }
    }

    const page = await this.waitForPage(pageNumber, context);
    if (!page) {
      return false;
    }

    page.scrollIntoView({ block: options.block ?? "center" });
    if (options.flash ?? true) {
      this.flashPage(page);
    }
    return true;
  }

  onPageReady(callback: (pageNumber: number, page: HTMLElement, newlyRendered: boolean) => void): boolean {
    const context = this.getContext();
    if (!context) {
      return false;
    }

    for (const page of this.pages(context)) {
      callback(this.pageNumber(page, context), page, false);
    }

    return this.registerPdfEvent(context, "pagerendered", (data) => {
      const payload = data as { pageNumber?: number; source?: { div?: HTMLElement } };
      const pageNumber = this.validPage(payload.pageNumber);
      const page = payload.source?.div ?? (pageNumber ? this.pageElement(pageNumber, context) : null);
      if (pageNumber && page) {
        callback(pageNumber, page, true);
      }
    });
  }

  onTextLayerReady(callback: (pageNumber: number, page: HTMLElement, newlyRendered: boolean) => void): boolean {
    const context = this.getContext();
    if (!context) {
      return false;
    }

    context.pdfViewer?._pages?.forEach((pageView, index) => {
      if (pageView.textLayer && pageView.div) {
        callback(index + 1, pageView.div, false);
      }
    });

    return this.registerPdfEvent(context, "textlayerrendered", (data) => {
      const payload = data as { pageNumber?: number; source?: { div?: HTMLElement } };
      const pageNumber = this.validPage(payload.pageNumber);
      const page = payload.source?.div ?? (pageNumber ? this.pageElement(pageNumber, context) : null);
      if (pageNumber && page) {
        callback(pageNumber, page, true);
      }
    });
  }

  flashPage(page: HTMLElement): void {
    page.addClass("book-note-flash-target");
    window.setTimeout(() => page.removeClass("book-note-flash-target"), 850);
  }

  private async waitForPage(pageNumber: number, context: PdfViewerContext): Promise<HTMLElement | null> {
    const immediate = this.pageElement(pageNumber, context);
    if (immediate) {
      return immediate;
    }

    return new Promise((resolve) => {
      let attempts = 0;
      const tick = (): void => {
        const page = this.pageElement(pageNumber, context);
        if (page || attempts >= 20) {
          resolve(page);
          return;
        }
        attempts += 1;
        window.setTimeout(tick, 50);
      };
      tick();
    });
  }

  private registerPdfEvent(context: PdfViewerContext, name: string, callback: (data: unknown) => void): boolean {
    const eventBus = context.eventBus;
    if (typeof eventBus?.on !== "function") {
      return false;
    }

    eventBus.on(name, callback);
    this.component.register(() => eventBus.off?.(name, callback));
    return true;
  }

  private computePageFromViewport(context: PdfViewerContext): number {
    const pages = this.pages(context);
    if (pages.length === 0) {
      return 0;
    }

    const viewport = context.viewerEl.getBoundingClientRect();
    const centerY = viewport.top + viewport.height / 2;
    let closestPage = 1;
    let closestDist = Infinity;
    for (const page of pages) {
      const rect = page.getBoundingClientRect();
      const dist = Math.abs(rect.top + rect.height / 2 - centerY);
      if (dist < closestDist) {
        closestDist = dist;
        closestPage = this.pageNumber(page, context);
      }
    }
    return closestPage;
  }

  private readActivePageInput(): number {
    const active = this.app.workspace.activeLeaf?.view as PdfViewLike | undefined;
    const root = active?.containerEl ?? document.querySelector<HTMLElement>(".workspace-leaf.mod-active");
    const input = root?.querySelector<HTMLInputElement>("input[data-page], input.pdf-page-input");
    const parsed = input?.value ? Number.parseInt(input.value, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private getGlobalPdfViewerAppPage(): number {
    const pdfViewerApp = (window as unknown as Record<string, unknown>).PDFViewerApp as
      | { page?: number; pdfViewer?: { currentPageNumber?: number } }
      | undefined;
    return pdfViewerApp?.page ?? pdfViewerApp?.pdfViewer?.currentPageNumber ?? 0;
  }

  private getGlobalObsidianViewer(): ObsidianPdfViewer | null {
    const pdfViewerApp = (window as unknown as Record<string, unknown>).PDFViewerApp as ObsidianPdfViewer | undefined;
    return pdfViewerApp ?? null;
  }

  private getGlobalPdfViewer(): PdfJsViewer | null {
    const pdfViewerApp = (window as unknown as Record<string, unknown>).PDFViewerApp as
      | { pdfViewer?: PdfJsViewer }
      | undefined;
    return pdfViewerApp?.pdfViewer ?? null;
  }

  private validPage(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : null;
  }
}
