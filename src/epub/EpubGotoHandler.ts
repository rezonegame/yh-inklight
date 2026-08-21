/**
 * [INPUT]: Obsidian Markdown post processors and exported Inklight callout anchors
 * [OUTPUT]: Wires exported EPUB annotation callouts/links back to the source CFI
 * [POS]: EPUB backlink handler for unified "export annotations" Markdown files
 * [PROTOCOL]: When changed, update this header and check AGENTS.md
 */

import { App, MarkdownPostProcessorContext, Notice, Plugin } from "obsidian";
import { t } from "../i18n";

const CALLOUT_TYPE = "book-note-epub";
const CFI_COMMENT_RE = /<!--\s*book-note-epub-cfi:\s*(epubcfi\([\s\S]*?\))\s*-->/;
const SOURCE_EXTENSIONS = ["epub", "mobi", "azw3", "fb2", "fbz", "cbz", "txt"];

export interface EpubGotoResolver {
  (annId: string, excerptPath: string): Promise<{ file: string; cfi: string } | null>;
}

export function registerEpubGotoHandler(
  plugin: Plugin,
  openAtCfi: (file: string, cfi: string) => Promise<void>,
  resolveAnn?: EpubGotoResolver,
): void {
  plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    if (!isExportedAnnotationPath(ctx.sourcePath)) {
      return;
    }

    el.querySelectorAll("p, pre, code").forEach((node) => {
      const htmlEl = node as HTMLElement;
      if (CFI_COMMENT_RE.test(htmlEl.textContent?.trim() ?? "")) {
        htmlEl.addClass("book-note-epub-cfi-hidden");
      }
    });

    wireCalloutClickHandlers(el, ctx.sourcePath, openAtCfi, resolveAnn, plugin.app);
    wireBackLinks(el, ctx.sourcePath, openAtCfi, resolveAnn, plugin.app);
  });
}

function isExportedAnnotationPath(sourcePath: string): boolean {
  const basename = sourcePath.split("/").pop() ?? sourcePath;
  return /-notes(?:-[^.]+)?\.md$/i.test(basename) || basename.endsWith("摘录.md") || basename.endsWith("excerpt.md");
}

function wireBackLinks(
  el: HTMLElement,
  sourcePath: string,
  goto: (file: string, cfi: string) => Promise<void>,
  resolveAnn: EpubGotoResolver | undefined,
  app: App,
): void {
  el.querySelectorAll("a").forEach((node) => {
    const anchor = node as HTMLAnchorElement;
    const text = anchor.textContent?.trim();
    if (text !== "Back to source" && text !== "回到原文") {
      return;
    }
    wireGotoAnchor(anchor, sourcePath, goto, resolveAnn, app);
  });
}

function wireCalloutClickHandlers(
  el: HTMLElement,
  sourcePath: string,
  goto: (file: string, cfi: string) => Promise<void>,
  resolveAnn: EpubGotoResolver | undefined,
  app: App,
): void {
  for (const node of el.querySelectorAll(`[data-callout="${CALLOUT_TYPE}"]`)) {
    const container = (node.closest(".callout") ?? node) as HTMLElement;
    if (container.dataset.bookNoteEpubGotoWired === "1") {
      continue;
    }

    const target = findTargetNear(container, sourcePath, app);
    if (!target) {
      continue;
    }

    container.dataset.bookNoteEpubGotoWired = "1";
    container.addClass("book-note-epub-goto-callout");
    container.setAttr("title", "Open source annotation");
    container.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("a")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void goto(target.file, target.cfi);
    });
  }
}

function wireGotoAnchor(
  anchor: HTMLAnchorElement,
  sourcePath: string,
  goto: (file: string, cfi: string) => Promise<void>,
  resolveAnn: EpubGotoResolver | undefined,
  app: App,
): void {
  if (anchor.dataset.bookNoteEpubGotoWired === "1") {
    return;
  }

  const callout = anchor.closest(".callout");
  const target = callout ? findTargetNear(callout as HTMLElement, sourcePath, app) : null;

  anchor.dataset.bookNoteEpubGotoWired = "1";
  anchor.addClass("book-note-epub-goto-link");
  anchor.title = "Open source annotation";
  anchor.removeAttribute("href");
  anchor.removeAttribute("data-href");
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (target) {
      void goto(target.file, target.cfi);
      return;
    }
    new Notice(t("notice.unableResolve"));
  });
}

function findTargetNear(container: HTMLElement, exportPath: string, app: App): { file: string; cfi: string } | null {
  const cfi = findCfiNear(container);
  if (!cfi) {
    return null;
  }

  const sourcePath = findSourcePathNear(container);
  if (sourcePath && app.vault.getAbstractFileByPath(sourcePath)) {
    return { file: sourcePath, cfi };
  }

  const inferredFile = findEpubFileFromExportPath(exportPath, app);
  return inferredFile ? { file: inferredFile, cfi } : null;
}

function findCfiNear(container: HTMLElement): string | null {
  const span = container.querySelector("[data-book-note-cfi]") as HTMLElement | null;
  if (span?.dataset?.bookNoteCfi) {
    return span.dataset.bookNoteCfi;
  }

  const commentMatch = (container.textContent ?? "").match(CFI_COMMENT_RE);
  if (commentMatch) {
    return commentMatch[1];
  }

  const textMatch = (container.textContent ?? "").match(/book-note-cfi[=:]\s*(epubcfi\([\s\S]*?\))/i);
  return textMatch ? textMatch[1] : null;
}

function findSourcePathNear(container: HTMLElement): string | null {
  const span = container.querySelector("[data-book-note-source-path]") as HTMLElement | null;
  return span?.dataset?.bookNoteSourcePath ?? null;
}

function findEpubFileFromExportPath(exportPath: string, app: App): string | null {
  const basename = exportPath.split("/").pop() ?? "";
  const candidates = [
    basename.replace(/-notes(?:-[^.]+)?\.md$/i, ""),
    basename.replace(/\.md$/i, "").replace(/^《/, "").replace(/》摘录$/, ""),
  ].filter(Boolean);

  for (const candidate of candidates) {
    for (const ext of SOURCE_EXTENSIONS) {
      const file = app.vault.getFiles().find((item) => item.extension.toLowerCase() === ext && item.basename === candidate);
      if (file) {
        return file.path;
      }
    }
  }

  return null;
}
