/**
 * [INPUT]: Obsidian Markdown post processors and exported Inklight callout anchors
 * [OUTPUT]: Wires exported PDF annotation callouts/links back to the source page
 * [POS]: PDF backlink handler for unified "export annotations" Markdown files
 *        结构镜像 EpubGotoHandler，只是目标从 CFI 换成 page（+可选 rects 闪烁定位）
 * [PROTOCOL]: When changed, update this header and check AGENTS.md
 */

import { App, MarkdownPostProcessorContext, Notice, Plugin } from "obsidian";

const CALLOUT_TYPE = "inklight-pdf";

export interface PdfGotoTarget {
  file: string;
  page: number;
  rects?: string;
}

export function registerPdfGotoHandler(
  plugin: Plugin,
  openAtPage: (target: PdfGotoTarget) => Promise<void>,
): void {
  plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    if (!isExportedAnnotationPath(ctx.sourcePath)) {
      return;
    }

    wireCalloutClickHandlers(el, ctx.sourcePath, openAtPage, plugin.app);
    wireBackLinks(el, ctx.sourcePath, openAtPage, plugin.app);
  });
}

function isExportedAnnotationPath(sourcePath: string): boolean {
  const basename = sourcePath.split("/").pop() ?? sourcePath;
  return /-notes(?:-[^.]+)?\.md$/i.test(basename) || basename.endsWith("摘录.md") || basename.endsWith("excerpt.md");
}

function wireBackLinks(
  el: HTMLElement,
  sourcePath: string,
  goto: (target: PdfGotoTarget) => Promise<void>,
  app: App,
): void {
  el.querySelectorAll("a").forEach((node) => {
    const anchor = node as HTMLAnchorElement;
    const text = anchor.textContent?.trim();
    if (text !== "Back to source" && text !== "回到原文") {
      return;
    }
    wireGotoAnchor(anchor, sourcePath, goto, app);
  });
}

function wireCalloutClickHandlers(
  el: HTMLElement,
  sourcePath: string,
  goto: (target: PdfGotoTarget) => Promise<void>,
  app: App,
): void {
  for (const node of el.querySelectorAll(`[data-callout="${CALLOUT_TYPE}"]`)) {
    const container = (node.closest(".callout") ?? node) as HTMLElement;
    if (container.dataset.yhPdfGotoWired === "1") {
      continue;
    }

    const target = findTargetNear(container, sourcePath, app);
    if (!target) {
      continue;
    }

    container.dataset.yhPdfGotoWired = "1";
    container.addClass("yh-pdf-goto-callout");
    container.setAttr("title", "打开源 PDF 批注");
    container.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("a")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void goto(target);
    });
  }
}

function wireGotoAnchor(
  anchor: HTMLAnchorElement,
  sourcePath: string,
  goto: (target: PdfGotoTarget) => Promise<void>,
  app: App,
): void {
  if (anchor.dataset.yhPdfGotoWired === "1") {
    return;
  }

  const callout = anchor.closest(".callout");
  const target = callout ? findTargetNear(callout as HTMLElement, sourcePath, app) : null;

  anchor.dataset.yhPdfGotoWired = "1";
  anchor.addClass("yh-pdf-goto-link");
  anchor.title = "打开源 PDF 批注";
  anchor.removeAttribute("href");
  anchor.removeAttribute("data-href");
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (target) {
      void goto(target);
      return;
    }
    new Notice("无法解析源 PDF 批注位置");
  });
}

function findTargetNear(container: HTMLElement, exportPath: string, app: App): PdfGotoTarget | null {
  const page = findPdfPageNear(container);
  if (page === null) {
    return null;
  }

  const rects = findPdfRectsNear(container);
  const sourcePath = findSourcePathNear(container);
  if (sourcePath && app.vault.getAbstractFileByPath(sourcePath)) {
    return { file: sourcePath, page, rects };
  }

  const inferredFile = findPdfFileFromExportPath(exportPath, app);
  return inferredFile ? { file: inferredFile, page, rects } : null;
}

function findPdfPageNear(container: HTMLElement): number | null {
  const span = container.querySelector("[data-yh-pdf-page]") as HTMLElement | null;
  if (span?.dataset?.yhPdfPage) {
    const n = Number.parseInt(span.dataset.yhPdfPage, 10);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  // 文本兜底
  const m = (container.textContent ?? "").match(/yh-pdf-page[=:]\s*(\d+)/i);
  return m ? Number.parseInt(m[1], 10) : null;
}

function findPdfRectsNear(container: HTMLElement): string | undefined {
  const span = container.querySelector("[data-yh-pdf-rects]") as HTMLElement | null;
  return span?.dataset?.yhPdfRects || undefined;
}

function findSourcePathNear(container: HTMLElement): string | null {
  const span = container.querySelector("[data-yh-source-path]") as HTMLElement | null;
  return span?.dataset?.yhSourcePath ?? null;
}

function findPdfFileFromExportPath(exportPath: string, app: App): string | null {
  const basename = exportPath.split("/").pop() ?? "";
  const candidates = [
    basename.replace(/-notes(?:-[^.]+)?\.md$/i, ""),
    basename.replace(/\.md$/i, "").replace(/^《/, "").replace(/》摘录$/, ""),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const file = app.vault.getFiles().find((item) => item.extension.toLowerCase() === "pdf" && item.basename === candidate);
    if (file) {
      return file.path;
    }
  }

  return null;
}
