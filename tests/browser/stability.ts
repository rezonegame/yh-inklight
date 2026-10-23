import { Component, Platform, TFile, editorInfoField } from "obsidian";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createHighlightExtension } from "../../src/editor/highlightExtension";
import { refreshReadingViewHighlights, installReadingViewHighlights } from "../../src/editor/readingViewHighlight";
import { PdfAnnotationLayer } from "../../src/pdf/pdfAnnotationLayer";
import { AnnotationSidebarView } from "../../src/views/sidebarView";
import { DEFAULT_SETTINGS } from "../../src/storage/types";

const delay = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const metrics: Record<string, unknown> = {};

// Only the fixture supplies Obsidian's DOM conveniences; the controllers below are production code.
for (const prototype of [Element.prototype, DocumentFragment.prototype]) {
  Object.assign(prototype, {
    createEl(this: Element, tag: string, options: any = {}) {
      const element = document.createElement(tag);
      const config = typeof options === "string" ? { cls: options } : options;
      if (config.cls) element.className = config.cls;
      if (config.text !== undefined) element.textContent = config.text;
      if (config.value !== undefined) (element as HTMLInputElement).value = config.value;
      for (const [name, value] of Object.entries(config.attr ?? {})) element.setAttribute(name, String(value));
      this.appendChild(element);
      return element;
    },
    createDiv(this: any, options: any) { return this.createEl("div", options); },
    createSpan(this: any, options: any) { return this.createEl("span", options); },
    empty(this: Element) { this.replaceChildren(); },
    addClass(this: Element, cls: string) { this.classList.add(cls); },
    removeClass(this: Element, cls: string) { this.classList.remove(cls); },
    toggleClass(this: Element, cls: string, active: boolean) { this.classList.toggle(cls, active); },
    setText(this: Element, text: string) { this.textContent = text; },
  });
}

function anchor(source: string, text: string) {
  const startOffset = source.indexOf(text);
  return { startOffset, endOffset: startOffset + text.length, selectedText: text,
    prefix: source.slice(Math.max(0, startOffset - 20), startOffset), suffix: source.slice(startOffset + text.length, startOffset + text.length + 20) };
}

function annotationDocument(count: number, path = "samples/长文阅读与批注.md") {
  const highlights = Array.from({ length: count }, (_, i) => ({ id: `h-${i}`, color: "yellow", createdAt: "2026-10-23T00:00:00Z", anchor: { startOffset: i * 100, endOffset: i * 100 + 8, selectedText: `摘录 ${i}：阅读与思考`, prefix: "", suffix: "" } }));
  return { filePath: path, highlights, comments: highlights.map((h, i) => ({ id: `n-${i}`, highlightId: h.id, color: "yellow", anchor: h.anchor,
    content: `批注 ${i}：${i % 2 ? "需要进一步研究" : "这是一条洞见"}`, tagId: i % 2 ? "question" : "insight", createdAt: h.createdAt, updatedAt: h.createdAt })), pdfHighlights: [], pdfComments: [], epubHighlights: [], epubComments: [] } as any;
}

async function readingTests() {
  const root = document.createElement("article");
  document.body.appendChild(root);
  for (let i = 0; i < 500; i++) {
    const p = document.createElement("p");
    p.textContent = `unique-${String(i).padStart(4, "0")} ` + "plain text for a long reading paragraph. ".repeat(10);
    root.appendChild(p);
  }
  const source = root.textContent!;
  const marks = Array.from({ length: 500 }, (_, i) => ({ id: `mark-${i}`, color: "yellow" as const, anchor: anchor(source, `unique-${String(i).padStart(4, "0")}`) }));
  for (const count of [0, 100, 500]) {
    let walks = 0;
    const original = document.createTreeWalker;
    document.createTreeWalker = function (...args: Parameters<Document["createTreeWalker"]>) { walks++; return original.apply(document, args); };
    const start = performance.now();
    try { refreshReadingViewHighlights(root, marks.slice(0, count)); } finally { document.createTreeWalker = original; }
    metrics[`reading-${source.length}-${count}`] = { ms: Math.round(performance.now() - start), textWalks: walks };
    assert(root.querySelectorAll("mark.yh-highlight").length === count, `reading mark count ${count}`);
    assert(root.textContent === source, "reading changed source text");
    assert(walks === (count ? 1 : 0), "reading rebuilt the text index per annotation");
  }
  const missing = marks.map((mark, i) => ({ ...mark, id: `missing-${i}`, anchor: { ...mark.anchor, selectedText: "ZYXWVUTSRQPONMLKJIHGFEDCBA".repeat(2) } }));
  const start = performance.now();
  refreshReadingViewHighlights(root, missing);
  const elapsed = performance.now() - start;
  metrics.missing500 = Math.round(elapsed);
  assert(elapsed < 2000, "bounded reading projection still blocked the main thread");
  assert(root.querySelectorAll("mark").length === 0 && root.textContent === source, "missing quotes were drawn at a wrong location");
  root.replaceChildren();
  const paragraph = document.createElement("p");
  paragraph.append("before ");
  const strong = document.createElement("strong"); strong.textContent = "target"; paragraph.append(strong, " text after"); root.appendChild(paragraph);
  refreshReadingViewHighlights(root, [{ id: "cross", color: "green", anchor: anchor(root.textContent!, "target text") }]);
  assert([...root.querySelectorAll("mark")].map(mark => mark.textContent).join("") === "target text", "cross-node mark lost text");
  root.replaceChildren(document.createTextNode("before target after"));
  let current: any[] = [{ id: "live", color: "blue", anchor: anchor(root.textContent!, "target") }];
  const children: Component[] = [];
  let changes = 0;
  const monitor = new MutationObserver(() => changes++);
  monitor.observe(root, { childList: true, subtree: true });
  installReadingViewHighlights({ root, marks: current, getMarks: () => current, context: { addChild(child: Component) { children.push(child); } } as any });
  await delay(180);
  const settled = changes;
  await delay(200);
  assert(changes === settled, "reading observer retriggers its own painting");
  root.firstChild!.textContent = "changed before ";
  await delay();
  assert(root.querySelector("mark")?.textContent === "target", "external text mutation did not repaint");
  current = [];
  refreshReadingViewHighlights(root, []);
  await delay(600);
  assert(!root.querySelector("mark"), "delayed mobile repaint restored a deleted annotation");
  monitor.disconnect();
  children.forEach(child => child.unload());
  root.remove();
}

async function editorTests() {
  let version = 0, reads = 0;
  const extension = createHighlightExtension({ getVersion: () => version, getDocument: () => {
    reads++; return { highlights: [{ id: "editor", color: "green", anchor: { startOffset: 0, endOffset: 6 } }], comments: [] } as any;
  }, rememberSelection: () => undefined });
  const parent = document.createElement("div"); document.body.appendChild(parent);
  const view = new EditorView({ parent, state: EditorState.create({ doc: "target text", extensions: [editorInfoField.init(() => ({ file: { path: "fixture.md" } } as any)), extension] }) });
  assert(reads === 1, "editor did not build initial highlights");
  view.dispatch({ selection: { anchor: 2 } });
  view.dispatch({ selection: { anchor: 3 } });
  assert(reads === 1, "cursor movement rebuilt the full annotation set");
  assert(parent.querySelector(".yh-highlight")?.textContent === "target", "editor highlight disappeared after cursor movement");
  version++; view.dispatch({}); assert(reads === 2, "store changes did not rebuild editor decoration");
  view.dispatch({ changes: { from: 10, insert: "!" } }); assert(reads === 3, "document edits did not rebuild editor decoration");
  view.destroy(); parent.remove();
  metrics.editor = { cursorRebuilds: 0, dataAndEditRefresh: true };
}

async function pdfTests() {
  const host = document.createElement("div"); host.className = "workspace-leaf-content";
  const viewer = document.createElement("div"); viewer.className = "pdf-container";
  Object.assign(viewer.style, { height: "400px", overflow: "auto", position: "relative" });
  host.appendChild(viewer); document.body.appendChild(host);
  const pages = Array.from({ length: 12 }, (_, index) => {
    const page = document.createElement("div"); page.dataset.pageNumber = String(index + 1); page.style.height = "600px"; page.textContent = `PDF page ${index + 1}`; viewer.appendChild(page); return page;
  });
  const file = Object.assign(new TFile(), { path: "fixture.pdf", extension: "pdf", name: "fixture.pdf" });
  let context: any = { file, viewerEl: viewer };
  const data: any = annotationDocument(0, file.path);
  data.pdfHighlights = pages.map((_, index) => ({ id: `pdf-${index}`, color: "yellow", anchor: { pageNumber: index + 1, rects: [{ pageNumber: index + 1, left: 0.1, top: 0.2, width: 0.5, height: 0.03 }] } }));
  const component = new Component();
  let reads = 0;
  let deferred: ((doc: any) => void) | null = null;
  let wait = false;
  const layer = new PdfAnnotationLayer({ app: { workspace: { on() { return () => undefined; } } } as any, component,
    viewerAdapter: { getContext: () => context, pages: () => pages, pageNumber: (page: HTMLElement) => Number(page.dataset.pageNumber), getActiveFile: () => context?.file, getViewState: () => ({ page: 1, totalPages: 12 }) } as any,
    getDocument: async () => { reads++; if (wait) return new Promise(resolve => { deferred = resolve; }); return data; },
    getCachedDocument: () => data, getProgress: async () => null, getSettings: () => ({ pdfProgressTracking: false }) as any,
  } as any);
  layer.register();
  await delay(150);
  const idle = reads;
  await delay(200);
  assert(reads === idle, "PDF observer is repainting at idle");
  const initialOverlays = host.querySelectorAll(".yh-pdf-highlight").length;
  assert(initialOverlays > 0 && initialOverlays < 12, "PDF must paint only visible pages");
  const unrelated = document.createElement("div"); unrelated.textContent = "unrelated sidebar change"; document.body.appendChild(unrelated);
  await delay(); assert(reads === idle, "PDF observes the whole document body"); unrelated.remove();
  const own = host.querySelector<HTMLElement>(".yh-pdf-highlight")!; own.style.opacity = "0.9";
  await delay(); assert(reads === idle, "own PDF highlight triggers rendering");
  const text = document.createElement("span"); text.textContent = "text layer ready"; pages[0].appendChild(text);
  await delay(); assert(reads > idle, "PDF page/text mutation no longer renders");
  viewer.scrollTop = 1200;
  await delay();
  assert(host.querySelector('[data-yh-id="pdf-2"]'), "PDF scrolling did not project the new visible page");
  context = { file, viewerEl: host };
  layer.refresh(); await delay(120);
  const nestedIdle = reads;
  await delay(150);
  assert(reads === nestedIdle, "PDF self-loops when the viewer includes its overlay host");
  wait = true;
  layer.refresh(); await delay();
  assert(deferred, "PDF async fixture never started");
  layer.destroy(); context = null;
  deferred!(data); await delay();
  assert(!host.querySelector(".yh-pdf-layer"), "late PDF render recreated a destroyed overlay");
  component.unload(); host.remove();
  metrics.pdf = { idleReads: idle, initialOverlays, lateRenderDiscarded: true };
}

async function mountSidebar(count = 500) {
  const appRoot = document.getElementById("app")!; appRoot.replaceChildren();
  const containerEl = document.createElement("div"); containerEl.className = "fixture-leaf";
  containerEl.appendChild(document.createElement("div"));
  const content = document.createElement("div"); content.className = "view-content"; containerEl.appendChild(content); appRoot.appendChild(containerEl);
  const file = Object.assign(new TFile(), { path: "samples/长文阅读与批注.md", name: "长文阅读与批注.md", basename: "长文阅读与批注", extension: "md" });
  let active: any = file;
  let documentData = annotationDocument(count, file.path);
  let reads = 0, collapsed = 0;
  let loader: (() => Promise<any>) | null = null;
  const workspace: any = { getActiveFile: () => active, on() { return () => undefined; }, rightSplit: { collapse() { collapsed++; } }, getLeaf: () => ({ async openFile() {} }) };
  const app = { workspace, vault: { getAbstractFileByPath: (path: string) => path === file.path ? file : null } };
  const store = { version: 1, async getDocument() { reads++; return loader ? loader() : documentData; }, async getIndexedDocuments() { reads++; return [documentData]; } };
  const view = new AnnotationSidebarView({ containerEl, app } as any, { store, settings: structuredClone(DEFAULT_SETTINGS) } as any);
  await view.onOpen();
  return { view, store, file, content, reads: () => reads, collapsed: () => collapsed, loseFocus: () => { active = null; }, setDocument: (data: any) => { documentData = data; store.version++; }, setLoader: (value: (() => Promise<any>) | null) => { loader = value; store.version++; } };
}

async function sidebarTests() {
  const fixture = await mountSidebar();
  assert(fixture.content.querySelectorAll(".yh-ov-card").length === 40, "sidebar eagerly mounted the whole library");
  assert(fixture.content.querySelector(".yh-ov-pagination")?.textContent?.includes("500"), "sidebar pagination lost results");
  const search = fixture.content.querySelector<HTMLInputElement>('input[type="search"]')!;
  fixture.loseFocus();
  search.value = "批注 499"; search.dispatchEvent(new Event("input")); await delay(240);
  assert(fixture.content.querySelectorAll(".yh-ov-card").length === 1, "search cannot find an item beyond page one");
  assert(search === fixture.content.querySelector('input[type="search"]'), "search rebuilt its input");
  assert(fixture.reads() === 1, "search reconstructed source documents despite a current cache");
  search.value = ""; search.dispatchEvent(new Event("input")); await delay(240);
  const tags = fixture.content.querySelector<HTMLSelectElement>(".yh-ov-tag-filter")!;
  assert(!tags.closest(".yh-ov-filter-row"), "mobile tags remain inside the collapsed filters");
  tags.value = "question"; tags.dispatchEvent(new Event("change")); await delay();
  assert(fixture.content.querySelector(".yh-ov-count")?.textContent?.includes("250"), "tag filtering changed its semantics");
  assert(fixture.reads() === 1, "tag selection bypassed the card cache");
  tags.value = "__all__"; tags.dispatchEvent(new Event("change")); await delay();
  fixture.content.querySelector<HTMLButtonElement>('[aria-label="下一页批注"]')!.click();
  assert(fixture.content.querySelector(".yh-ov-pagination")?.textContent?.includes("41"), "next page did not advance");
  fixture.content.querySelector<HTMLButtonElement>('[aria-label="Close panel"]')!.click();
  assert(fixture.collapsed() === 1 && fixture.content.querySelector(".yh-ov-pagination")?.textContent?.includes("41"), "mobile close detached the view or discarded state");
  let resolveOld: (data: any) => void = () => undefined;
  fixture.setLoader(() => new Promise(resolve => { resolveOld = resolve; }));
  const pending = (fixture.view as any).refreshList();
  fixture.setLoader(null); fixture.setDocument(annotationDocument(1));
  await (fixture.view as any).refreshList();
  resolveOld(annotationDocument(500)); await pending;
  assert(fixture.content.querySelectorAll(".yh-ov-card").length === 1, "old async query overwrote fresh results");
  let resolveClosed: (data: any) => void = () => undefined;
  fixture.setLoader(() => new Promise(resolve => { resolveClosed = resolve; }));
  const closing = (fixture.view as any).refreshList();
  await fixture.view.onClose(); resolveClosed(annotationDocument(500)); await closing;
  assert(fixture.content.querySelectorAll(".yh-ov-card").length === 1, "closed sidebar accepted a late render");
  metrics.sidebar = { pageSize: 40, searchBeyondFirstPage: true, cacheReadsBeforeInvalidation: 1, staleResultDiscarded: true };
}

(window as any).stability = {
  setMobile(value: boolean) { (Platform as any).isMobile = value; },
  async run() {
    (Platform as any).isMobile = true;
    const results: any[] = [];
    for (const [name, run] of [["reading", readingTests], ["editor", editorTests], ["pdf", pdfTests], ["sidebar", sidebarTests]] as const) {
      try { await run(); results.push({ name, passed: true }); }
      catch (error) { results.push({ name, passed: false, error: String(error), stack: (error as Error).stack }); }
    }
    return { results, metrics };
  },
  mountSidebar,
};
