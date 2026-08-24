/**
 * [INPUT]: 依赖 foliate-js/view.js（动态 import）、EpubFoliateGuard、Obsidian vault readBinary
 * [OUTPUT]: foliate 引擎加载器——注册 <foliate-view> 自定义元素、从 vault 文件创建 view、打开书
 * [POS]: epub 模块的 foliate 引擎入口，供 EpubReaderView 渲染层（Phase 4-A 重写后）调用
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 *
 * foliate-js 关键 API（摸自 weave FoliateReaderService）：
 * - 注册：guard 后 customElements.define("foliate-view", View)，View 来自 foliate-js/view.js
 * - 打开书：view.open(book)，book 可直接传 Blob（foliate 自动识别 epub/mobi/azw3/fb2/cbz/txt）
 * - 事件：relocate{cfi,index} / load{doc,index} / link{a,href} / draw-annotation{draw,annotation} / show-annotation{value,index,range}
 * - 导航：view.goTo(target) / goToTextStart() / goLeft()/goRight() 或 prev()/next()
 * - 标注：view.addAnnotation({value:cfi,color,...}) / deleteAnnotation(value)
 * - 渲染器：view.renderer.setStyles(css) / render() / getContents()[{index,doc}]
 *
 * 简化说明：weave 的 FoliateVaultPublicationParser（加载+metadata+CFI 规范化+搜索）是为高级功能。
 * 本基础实现直接 view.open(Blob)，先满足渲染/选区/标注/进度；metadata/搜索等留待后续按需引入。
 */

import { installFoliateCustomElementGuard } from "./EpubFoliateGuard";
import { installFoliateBlobIframePatch } from "./EpubFoliatePatches";

/** foliate-js 的 View 构造器所在模块（动态 import，便于 esbuild 打包）。 */
type FoliateViewModule = {
  View?: CustomElementConstructor;
  default?: CustomElementConstructor;
  makeBook?: (file: File | string | unknown) => Promise<FoliateBookHandle>;
};

type FoliateBookHandle = {
  transformTarget?: EventTarget;
  toc?: Array<{ label?: string; href?: string; subitems?: unknown[] }>;
  sections?: Array<{ id?: unknown; cfi?: string; size?: number; linear?: string }>;
  [key: string]: unknown;
};

let viewModulePromise: Promise<FoliateViewModule> | null = null;

async function ensureViewModule(): Promise<FoliateViewModule> {
  if (!viewModulePromise) {
    viewModulePromise = import("foliate-js/view.js") as Promise<FoliateViewModule>;
  }
  return viewModulePromise;
}

/** 确保 <foliate-view> 自定义元素已注册（带冲突保护，幂等）。 */
export async function ensureFoliateViewRegistered(): Promise<void> {
  installFoliateCustomElementGuard();
  // Obsidian 桌面端 CSP：foliate 的 blob: iframe src 会被 style-src 拦，
  // patch 改用 srcdoc 注入（移植自 weave）。
  // ⚠️ 暂不装 sandbox patch：移除 allow-scripts 会让 foliate iframe 脚本不跑、内容空白。
  //    保留 allow-scripts 让 foliate 正常渲染（实测 v0.6.4 空白根因）。
  installFoliateBlobIframePatch((error) => {
    console.warn("book-note: foliate blob iframe 加载失败", error);
  });
  if (customElements.get("foliate-view")) {
    return;
  }
  const mod = await ensureViewModule();
  const ViewConstructor = mod.View ?? mod.default;
  if (ViewConstructor && !customElements.get("foliate-view")) {
    customElements.define("foliate-view", ViewConstructor);
  }
}

/** foliate-view 元素对外用到的句柄类型（保持宽松，foliate-js 无官方 .d.ts）。 */
export interface FoliateViewHandle {
  open: (...args: unknown[]) => Promise<unknown> | unknown;
  close?: () => void;
  goTo: (target: unknown) => Promise<unknown> | unknown;
  goToFraction?: (fraction: number) => Promise<unknown> | unknown;
  getCFI?: (index: number, range?: Range | null) => string;
  resolveCFI?: (cfi: string) => unknown;
  init?: (options?: { lastLocation?: unknown; showTextStart?: boolean }) => Promise<unknown> | unknown;
  goToTextStart?: () => Promise<unknown> | unknown;
  prev?: () => Promise<unknown> | unknown;
  next?: () => Promise<unknown> | unknown;
  goLeft?: () => Promise<unknown> | unknown;
  goRight?: () => Promise<unknown> | unknown;
  addAnnotation: (...args: unknown[]) => unknown;
  deleteAnnotation: (...args: unknown[]) => unknown;
  addEventListener: HTMLElement["addEventListener"];
  removeEventListener: HTMLElement["removeEventListener"];
  renderer?: {
    setStyles?: (styles: string | [string, string]) => void;
    render?: () => void;
    getContents?: () => Array<{ index?: number; doc?: Document | null }>;
  };
  book?: FoliateBookHandle;
  [key: string]: unknown;
}

type FoliateTransformDetail = {
  data?: Promise<string | Blob> | string | Blob;
  type?: string;
  name?: string;
};

/** 创建并挂载一个 <foliate-view> 到容器，返回句柄（事件由调用方自行 addEventListener）。 */
export async function createFoliateView(container: HTMLElement): Promise<FoliateViewHandle> {
  await ensureFoliateViewRegistered();
  const element = activeDocument.createElement("foliate-view");
  container.appendChild(element);
  return element as unknown as FoliateViewHandle;
}

function readBlobUrlAsText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "text";
    xhr.onload = () => {
      if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
        resolve(xhr.responseText || "");
        return;
      }
      reject(new Error(`Failed to read blob URL (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Failed to read blob URL"));
    xhr.send();
  });
}

function readBlobUrlAsDataUrl(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "blob";
    xhr.onload = () => {
      if (!(xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) || !(xhr.response instanceof Blob)) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(xhr.response);
    };
    xhr.onerror = () => resolve(null);
    xhr.send();
  });
}

async function inlineBlobCssImports(cssText: string, visited = new Set<string>()): Promise<string> {
  const importPattern = /@import\s+(?:url\()?['"]?([^'")]+)['"]?\)?\s*;/gi;
  let output = cssText;
  for (const match of Array.from(cssText.matchAll(importPattern))) {
    const href = (match[1] || "").trim();
    if (!href.startsWith("blob:") || visited.has(href)) {
      continue;
    }
    visited.add(href);
    try {
      const imported = await readBlobUrlAsText(href);
      output = output.replace(match[0], await inlineBlobCssImports(imported, visited));
    } catch {
      output = output.replace(match[0], "");
    }
  }
  return output;
}

async function inlineBlobCssUrls(cssText: string, visited = new Set<string>()): Promise<string> {
  const urlPattern = /url\(\s*(['"]?)(blob:[^'")]+)\1\s*\)/gi;
  let output = cssText;
  for (const match of Array.from(cssText.matchAll(urlPattern))) {
    const href = (match[2] || "").trim();
    if (!href.startsWith("blob:") || visited.has(href)) {
      continue;
    }
    visited.add(href);
    const dataUrl = await readBlobUrlAsDataUrl(href);
    output = output.replace(match[0], dataUrl ? `url("${dataUrl}")` : "");
  }
  return output;
}

async function normalizeFoliateCss(cssText: string): Promise<string> {
  return inlineBlobCssUrls(await inlineBlobCssImports(cssText));
}

async function transformFoliateMarkup(markup: string, mediaType: string): Promise<string> {
  const parserType = mediaType.includes("html") ? "text/html" : "application/xhtml+xml";
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(markup, parserType);
  } catch {
    return markup;
  }

  for (const element of Array.from(doc.querySelectorAll("script, iframe, object, embed"))) {
    element.remove();
  }
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value || "";
      if (name.startsWith("on") || name === "srcdoc" || /^javascript:/i.test(value.trim())) {
        element.removeAttribute(attr.name);
      }
    }
  }

  for (const style of Array.from(doc.querySelectorAll("style"))) {
    if (style.textContent) {
      style.textContent = await normalizeFoliateCss(style.textContent);
    }
  }
  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const href = link.getAttribute("href") || "";
    if (!href.startsWith("blob:")) {
      continue;
    }
    try {
      const css = await normalizeFoliateCss(await readBlobUrlAsText(href));
      const style = doc.createElement("style");
      style.setAttribute("data-book-note-foliate-inlined", "1");
      style.textContent = css;
      link.replaceWith(style);
    } catch {
      link.remove();
    }
  }
  for (const element of Array.from(doc.querySelectorAll("[style]"))) {
    const styleValue = element.getAttribute("style") || "";
    if (/blob:/i.test(styleValue)) {
      element.setAttribute("style", await normalizeFoliateCss(styleValue));
    }
  }

  return parserType === "text/html" ? doc.documentElement.outerHTML : new XMLSerializer().serializeToString(doc);
}

function attachFoliateTransformPipeline(book: FoliateBookHandle): void {
  book.transformTarget?.addEventListener("data", (event: Event) => {
    const detail = (event as CustomEvent<FoliateTransformDetail>).detail;
    if (!detail?.data) {
      return;
    }
    const mediaType = String(detail.type || "").toLowerCase();
    detail.data = Promise.resolve(detail.data).then(async (payload) => {
      if (typeof payload !== "string") {
        return payload;
      }
      if (mediaType.includes("css")) {
        return normalizeFoliateCss(payload);
      }
      if (mediaType.includes("html") || mediaType.includes("xml") || mediaType.includes("svg")) {
        return transformFoliateMarkup(payload, mediaType);
      }
      return payload;
    });
  });
}

/**
 * 从 ArrayBuffer（vault readBinary 得到）打开书，foliate 自动按文件名后缀识别格式。
 *
 * ⚠️ 必须传 File（带 filename），不能用裸 Blob：foliate-js 的 makeBook（view.js）
 *    用 `file.name` 后缀判断格式（epub/mobi/fb2/cbz/...），裸 Blob 无 name 会导致
 *    `Cannot read properties of undefined (reading 'endsWith')`。
 *
 * 特殊处理 .txt 文件：foliate makeBook 不支持纯文本，需要自制 book object。
 */
export async function openBookFromBuffer(
  view: FoliateViewHandle,
  buffer: ArrayBuffer,
  filename: string,
): Promise<void> {
  const isTxt = /\.txt$/i.test(filename);
  if (isTxt) {
    const text = new TextDecoder().decode(buffer);
    const html = buildTxtHtml(filename, text);
    const parser = new DOMParser();
    const sectionId = "txt-section-1.xhtml";
    const blobUrl = URL.createObjectURL(new Blob([html], { type: "application/xhtml+xml" }));
    const createDoc = (): Document => parser.parseFromString(html, "application/xhtml+xml");
    const book = {
      sections: [{
        id: sectionId,
        cfi: "epubcfi(/6/2)",
        linear: "yes",
        size: text.length,
        // ⚠️ load() 必须返回 URL（blob/data），foliate 直接 iframe.src = src；返回 HTML 字符串会导致空白
        load: () => blobUrl,
        createDocument: () => createDoc(),
        unload: () => { try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ } },
      }],
      toc: [{ label: filename.replace(/\.txt$/i, ""), href: sectionId }],
      metadata: { title: filename.replace(/\.txt$/i, ""), author: "", language: "zh-CN" },
      rendition: {},
      splitTOCHref: (href: string): [number, string | null] => {
        const [sid] = String(href || "").split("#");
        return [sid === sectionId ? 0 : 0, null];
      },
      getTOCFragment: (doc: Document, _fragment: string | null) => doc.documentElement,
      isExternal: (href: string) => /^\w+:/i.test(String(href || "")),
      resolveCFI: (_cfi: string) => ({ index: 0, anchor: (doc: Document) => doc.documentElement }),
      resolveHref: (_href: string) => ({ index: 0, anchor: (doc: Document) => doc.documentElement }),
      destroy: () => { try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ } },
    };
    await view.open(book as any);
    return;
  }

  const file = new File([buffer], filename, { type: "application/epub+zip" });
  const mod = await ensureViewModule();
  const book = mod.makeBook ? await mod.makeBook(file) : file;
  if (book && typeof book === "object" && "transformTarget" in book) {
    attachFoliateTransformPipeline(book as FoliateBookHandle);
  }
  await view.open(book);
}

function buildTxtHtml(filename: string, text: string): string {
  const title = filename.replace(/\.txt$/i, "");
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+$/g, "").trim())
    .filter(Boolean);
  const body = paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
  return `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title><style>body{margin:0;padding:1em 1.5em;font-family:inherit;font-size:1em;line-height:1.8;word-break:break-word;overflow-wrap:anywhere;}p{margin:0 0 0.95em;text-indent:2em;white-space:pre-wrap;}</style></head><body>${body}</body></html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** foliate open() only mounts the renderer; callers must explicitly navigate/render the first page. */
export async function showFoliateStart(view: FoliateViewHandle): Promise<void> {
  if (typeof view.goToTextStart === "function") {
    await view.goToTextStart();
    return;
  }
  if (typeof view.init === "function") {
    await view.init({ showTextStart: true });
    return;
  }
  const renderer = view.renderer as { next?: () => Promise<unknown> | unknown } | undefined;
  if (typeof renderer?.next === "function") {
    await renderer.next();
  }
}
