/**
 * [INPUT]: 依赖 Obsidian Plugin API 和 MarkdownPostProcessor
 * [OUTPUT]: 处理摘录 Markdown 文件中"回到原文"链接的点击 → 跳转到 EPUB 原文位置
 * [POS]: EPUB 摘录回跳的核心处理器
 */

import { App, MarkdownPostProcessorContext, MarkdownView, Notice, Plugin } from "obsidian";

const CALLOUT_TYPE = "inklight-epub";
const CFI_COMMENT_RE = /<!--\s*yh-epub-cfi:\s*(epubcfi\([\s\S]*?\))\s*-->/;
const GOTO_LINK_RE = /\[回到原文\]\(#[^)]+\)/;

/** 从标注块中提取 CFI */
function extractCfiFromChunk(text: string): string | null {
  const commentMatch = text.match(CFI_COMMENT_RE);
  if (commentMatch) {
    return commentMatch[1];
  }
  return null;
}

/** 从 Markdown 文件内容中提取所有标注的 CFI → blockId 映射 */
function extractAnnotationCfis(content: string): Map<string, string> {
  const result = new Map<string, string>();
  const blockRefRe = /\^((?:epub|ann)-[a-z0-9-]+)/g;
  const blocks = content.split(/^---$/m);

  for (const block of blocks) {
    const blockIdMatch = block.match(blockRefRe);
    if (!blockIdMatch) {
      continue;
    }
    const blockId = blockIdMatch[1];
    const cfi = extractCfiFromChunk(block);
    if (cfi) {
      result.set(blockId, cfi);
    }
  }
  return result;
}

export interface EpubGotoResolver {
  (annId: string, excerptPath: string): Promise<{ file: string; cfi: string } | null>;
}

/** 注册摘录回跳处理器 */
export function registerEpubGotoHandler(
  plugin: Plugin,
  openAtCfi: (file: string, cfi: string) => Promise<void>,
  resolveAnn?: EpubGotoResolver,
): void {
  // 注册 Markdown 后处理器
  plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    if (!ctx.sourcePath.endsWith("摘录.md") && !ctx.sourcePath.endsWith("excerpt.md")) {
      return;
    }

    // 隐藏 CFI 注释行
    el.querySelectorAll("p, pre, code").forEach((node) => {
      const htmlEl = node as HTMLElement;
      if (CFI_COMMENT_RE.test(htmlEl.textContent?.trim() ?? "")) {
        htmlEl.addClass("yh-epub-cfi-hidden");
      }
    });

    // 处理 callout 中的回跳
    wireCalloutClickHandlers(el, ctx.sourcePath, openAtCfi, resolveAnn, plugin.app);

    // 处理 [回到原文] 链接
    el.querySelectorAll("a").forEach((node) => {
      const anchor = node as HTMLAnchorElement;
      const text = anchor.textContent?.trim();
      if (text !== "回到原文") {
        return;
      }
      wireGotoAnchor(anchor, ctx.sourcePath, openAtCfi, resolveAnn, plugin.app);
    });
  });
}

/** 为 callout 绑定点击跳转 */
function wireCalloutClickHandlers(
  el: HTMLElement,
  sourcePath: string,
  goto: (file: string, cfi: string) => Promise<void>,
  resolveAnn: EpubGotoResolver | undefined,
  app: App,
): void {
  for (const node of el.querySelectorAll(`[data-callout="${CALLOUT_TYPE}"]`)) {
    const container = (node.closest(".callout") ?? node) as HTMLElement;
    if (container.dataset.yhEpubGotoWired === "1") {
      continue;
    }

    // 找到附近的"回到原文"链接或 CFI 注释
    const cfi = findCfiNear(container);
    if (!cfi) {
      continue;
    }

    container.dataset.yhEpubGotoWired = "1";
    container.addClass("yh-epub-goto-callout");
    container.setAttr("title", "点击定位到电子书原文");

    container.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("a")) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      // 从文件名推断 EPUB 文件路径
      const epubFile = findEpubFileFromExcerptPath(sourcePath, app);
      if (epubFile) {
        void goto(epubFile, cfi);
      } else {
        new Notice("无法找到对应的电子书文件");
      }
    });
  }
}

/** 为"回到原文"链接绑定跳转 */
function wireGotoAnchor(
  anchor: HTMLAnchorElement,
  sourcePath: string,
  goto: (file: string, cfi: string) => Promise<void>,
  resolveAnn: EpubGotoResolver | undefined,
  app: App,
): void {
  if (anchor.dataset.yhEpubGotoWired === "1") {
    return;
  }

  // 查找附近 callout 中的 CFI
  const callout = anchor.closest(".callout");
  const cfi = callout ? findCfiNear(callout as HTMLElement) : null;

  anchor.dataset.yhEpubGotoWired = "1";
  anchor.dataset.yhEpubGotoCfi = cfi ?? "";
  anchor.addClass("yh-epub-goto-link");
  anchor.title = "定位到电子书原文";
  anchor.removeAttribute("href");
  anchor.removeAttribute("data-href");

  anchor.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (cfi) {
      const epubFile = findEpubFileFromExcerptPath(sourcePath, app);
      if (epubFile) {
        void goto(epubFile, cfi);
      } else {
        new Notice("无法找到对应的电子书文件");
      }
    } else {
      new Notice("无法解析「回到原文」链接");
    }
  });
}

/** 在 callout 内查找 CFI（data-yh-cfi 属性优先，兜底文本匹配） */
function findCfiNear(container: HTMLElement): string | null {
  // 优先从 callout 内的 hidden span data 属性取
  const span = container.querySelector('[data-yh-cfi]') as HTMLElement | null;
  if (span?.dataset?.yhCfi) {
    return span.dataset.yhCfi;
  }
  // 兜底：从 callout 文本中正则匹配 CFI
  const text = container.textContent ?? "";
  const match = text.match(/yh-cfi[=:]\s*(epubcfi\([\s\S]*?\))/i);
  return match ? match[1] : null;
}

/** 从摘录文件路径推断 EPUB 文件路径 */
function findEpubFileFromExcerptPath(excerptPath: string, app: App): string | null {
  // 从摘录文件名中提取书名：《书名》摘录.md → 书名
  const basename = excerptPath.split("/").pop() ?? "";
  const titleMatch = basename.match(/《(.+?)》摘录/);
  if (!titleMatch) {
    return null;
  }
  const bookTitle = titleMatch[1];

  // 在 vault 中搜索匹配的 EPUB 文件
  const extensions = ["epub", "mobi", "azw3", "fb2", "cbz", "txt"];
  for (const ext of extensions) {
    const files = app.vault.getFiles().filter(
      (f) => f.extension.toLowerCase() === ext && f.basename === bookTitle,
    );
    if (files.length > 0) {
      return files[0].path;
    }
  }
  return null;
}
