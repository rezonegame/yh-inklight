"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => OverlayAnnotationsPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian10 = require("obsidian");

// src/anchor/fuzzyMatch.ts
function findBestFuzzyMatch(source, target, expectedStart) {
  const needle = normalize(target);
  if (!needle) {
    return null;
  }
  const exact = source.indexOf(target);
  if (exact >= 0) {
    return {
      startOffset: exact,
      endOffset: exact + target.length,
      confidence: 1
    };
  }
  const radius = Math.max(300, target.length * 8);
  const windowStart = Math.max(0, expectedStart - radius);
  const windowEnd = Math.min(source.length, expectedStart + radius + target.length);
  const local = scanWindow(source, target, windowStart, windowEnd);
  if (local && local.confidence >= 0.6) {
    return local;
  }
  return scanWindow(source, target, 0, source.length);
}
function scanWindow(source, target, windowStart, windowEnd) {
  const targetLength = target.length;
  const minLength = Math.max(1, Math.floor(targetLength * 0.75));
  const maxLength = Math.max(minLength, Math.ceil(targetLength * 1.35));
  let best = null;
  for (let start = windowStart; start < windowEnd; start += Math.max(1, Math.floor(targetLength / 8))) {
    for (let length = minLength; length <= maxLength; length += Math.max(1, Math.floor(targetLength / 6))) {
      const end = Math.min(source.length, start + length);
      if (end <= start) {
        continue;
      }
      const candidate = source.slice(start, end);
      const confidence = similarity(target, candidate);
      if (!best || confidence > best.confidence) {
        best = { startOffset: start, endOffset: end, confidence };
      }
    }
  }
  return best && best.confidence >= 0.55 ? best : null;
}
function similarity(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) {
    return 0;
  }
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}
function normalize(value) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
function levenshtein(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }
  return previous[b.length];
}

// src/anchor/textAnchor.ts
var CONTEXT_LENGTH = 20;
function createTextAnchor(source, startOffset, endOffset) {
  const normalizedSource = normalizeLineEndings(source);
  const start = Math.max(0, Math.min(startOffset, normalizedSource.length));
  const end = Math.max(start, Math.min(endOffset, normalizedSource.length));
  return {
    startOffset: start,
    endOffset: end,
    selectedText: normalizedSource.slice(start, end),
    prefix: normalizedSource.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: normalizedSource.slice(end, Math.min(normalizedSource.length, end + CONTEXT_LENGTH)),
    isCode: isCodeSelection(normalizedSource, start, end)
  };
}
function resolveTextAnchor(source, anchor) {
  const normalizedSource = normalizeLineEndings(source);
  const normalizedAnchor = normalizeAnchor(anchor);
  const direct = normalizedSource.slice(normalizedAnchor.startOffset, normalizedAnchor.endOffset);
  if (direct === normalizedAnchor.selectedText) {
    return {
      anchor: normalizedAnchor,
      orphaned: false,
      confidence: 1
    };
  }
  const contextual = findContextualMatch(normalizedSource, normalizedAnchor);
  if (contextual) {
    return contextual;
  }
  const fuzzy = findBestFuzzyMatch(normalizedSource, normalizedAnchor.selectedText, normalizedAnchor.startOffset);
  if (fuzzy) {
    return {
      anchor: createTextAnchor(normalizedSource, fuzzy.startOffset, fuzzy.endOffset),
      orphaned: fuzzy.confidence < 0.55,
      confidence: fuzzy.confidence
    };
  }
  return {
    anchor: normalizedAnchor,
    orphaned: true,
    confidence: 0
  };
}
function relocateDocumentAnchors(source, document2) {
  return {
    ...document2,
    highlights: document2.highlights.map((highlight) => {
      const resolved = resolveTextAnchor(source, highlight.anchor);
      return {
        ...highlight,
        anchor: resolved.anchor,
        orphaned: resolved.orphaned
      };
    }),
    comments: document2.comments.map((comment) => {
      const resolved = resolveTextAnchor(source, comment.anchor);
      return {
        ...comment,
        anchor: resolved.anchor,
        orphaned: resolved.orphaned
      };
    })
  };
}
function findContextualMatch(source, anchor) {
  let cursor = source.indexOf(anchor.selectedText);
  let best = null;
  while (cursor >= 0) {
    const end = cursor + anchor.selectedText.length;
    const prefix = source.slice(Math.max(0, cursor - CONTEXT_LENGTH), cursor);
    const suffix = source.slice(end, Math.min(source.length, end + CONTEXT_LENGTH));
    const confidence = contextScore(anchor.prefix, prefix) * 0.45 + contextScore(anchor.suffix, suffix) * 0.45 + 0.1;
    if (!best || confidence > best.confidence) {
      best = {
        anchor: createTextAnchor(source, cursor, end),
        orphaned: confidence < 0.5,
        confidence
      };
    }
    cursor = source.indexOf(anchor.selectedText, cursor + 1);
  }
  return best && best.confidence >= 0.5 ? best : null;
}
function contextScore(expected, actual) {
  if (!expected && !actual) {
    return 1;
  }
  if (!expected || !actual) {
    return 0;
  }
  if (actual.endsWith(expected) || expected.endsWith(actual)) {
    return 1;
  }
  let shared = 0;
  const max = Math.min(expected.length, actual.length);
  for (let index = 1; index <= max; index += 1) {
    if (expected.slice(-index) === actual.slice(-index)) {
      shared = index;
    }
  }
  return shared / Math.max(expected.length, actual.length);
}
function normalizeAnchor(anchor) {
  return {
    ...anchor,
    selectedText: normalizeLineEndings(anchor.selectedText),
    prefix: normalizeLineEndings(anchor.prefix),
    suffix: normalizeLineEndings(anchor.suffix)
  };
}
function isCodeSelection(source, start, end) {
  const selectedText = source.slice(start, end);
  return isInsideFencedCode(source, start) || hasCodeIndent(selectedText);
}
function isInsideFencedCode(source, offset) {
  const before = source.slice(0, offset);
  const fenceMatches = before.match(/^```/gm);
  return Boolean(fenceMatches && fenceMatches.length % 2 === 1);
}
function hasCodeIndent(text) {
  return /^[ \t]{2,}/m.test(text) || /\n[ \t]{2,}\S/.test(text);
}
function normalizeLineEndings(content) {
  return content.replace(/\r\n/g, "\n");
}

// src/editor/highlightExtension.ts
var import_state = require("@codemirror/state");
var import_view = require("@codemirror/view");
var import_obsidian = require("obsidian");
function createHighlightExtension(options) {
  return import_view.ViewPlugin.fromClass(
    class HighlightPlugin {
      constructor(view) {
        this.view = view;
        this.version = -1;
        this.decorations = this.buildDecorations();
        this.version = options.getVersion();
        this.captureSelection();
      }
      update(update) {
        const nextVersion = options.getVersion();
        if (update.docChanged || update.viewportChanged || update.selectionSet || this.version !== nextVersion) {
          this.version = nextVersion;
          this.decorations = this.buildDecorations();
        }
        if (update.selectionSet) {
          this.captureSelection();
        }
      }
      buildDecorations() {
        const filePath = this.filePath();
        if (!filePath) {
          return import_view.Decoration.none;
        }
        const document2 = options.getDocument(filePath);
        if (!document2) {
          return import_view.Decoration.none;
        }
        const builder = new import_state.RangeSetBuilder();
        const docLength = this.view.state.doc.length;
        const marks = [
          ...document2.highlights.map((highlight) => ({
            id: highlight.id,
            color: highlight.color,
            anchor: highlight.anchor,
            orphaned: highlight.orphaned
          })),
          ...document2.comments.map((comment) => ({
            id: comment.id,
            color: comment.color,
            anchor: comment.anchor,
            orphaned: comment.orphaned
          }))
        ].sort((a, b) => a.anchor.startOffset - b.anchor.startOffset);
        for (const mark of marks) {
          if (mark.orphaned) {
            continue;
          }
          const from = Math.max(0, Math.min(mark.anchor.startOffset, docLength));
          const to = Math.max(from, Math.min(mark.anchor.endOffset, docLength));
          if (from === to) {
            continue;
          }
          builder.add(
            from,
            to,
            import_view.Decoration.mark({
              class: `yh-highlight yh-highlight--${mark.color}`,
              attributes: {
                "data-yh-color": mark.color,
                "data-yh-id": mark.id,
                style: `background-color: ${highlightBackground(mark.color)} !important;`
              }
            })
          );
        }
        return builder.finish();
      }
      captureSelection() {
        const filePath = this.filePath();
        if (!filePath) {
          return;
        }
        const selection = this.view.state.selection.main;
        if (selection.empty) {
          return;
        }
        options.rememberSelection(
          filePath,
          selection.from,
          selection.to,
          this.view.state.sliceDoc(selection.from, selection.to)
        );
      }
      filePath() {
        return this.view.state.field(import_obsidian.editorInfoField).file?.path ?? null;
      }
    },
    {
      decorations: (plugin) => plugin.decorations
    }
  );
}
function highlightBackground(color) {
  const colors = {
    yellow: "rgba(245, 197, 24, 0.42)",
    orange: "rgba(255, 140, 0, 0.36)",
    pink: "rgba(255, 105, 180, 0.32)",
    green: "rgba(82, 196, 26, 0.30)",
    blue: "rgba(22, 119, 255, 0.28)",
    purple: "rgba(114, 46, 209, 0.30)"
  };
  return colors[color] ?? colors.yellow;
}

// src/editor/readingViewHighlight.ts
var import_obsidian2 = require("obsidian");
var MARK_SELECTOR = ".yh-reading-highlight, mark.yh-highlight";
var MOBILE_RENDER_DELAYS = [0, 80, 220, 520, 900];
var DESKTOP_RENDER_DELAYS = [0, 40, 160];
function installReadingViewHighlights(options) {
  const component = new import_obsidian2.MarkdownRenderChild(options.root);
  let frame = null;
  let disposed = false;
  const render = () => {
    if (disposed) {
      return;
    }
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }
    frame = requestAnimationFrame(() => {
      frame = null;
      refreshReadingViewHighlights(options.root, options.marks);
    });
  };
  const delays = import_obsidian2.Platform.isMobile ? MOBILE_RENDER_DELAYS : DESKTOP_RENDER_DELAYS;
  for (const delay of delays) {
    const timer = window.setTimeout(render, delay);
    component.register(() => window.clearTimeout(timer));
  }
  const observer = new MutationObserver((mutations) => {
    if (mutations.every(isOwnHighlightMutation)) {
      return;
    }
    render();
  });
  observer.observe(options.root, { childList: true, subtree: true, characterData: true });
  component.register(() => {
    disposed = true;
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }
    observer.disconnect();
  });
  options.context.addChild(component);
}
function refreshReadingViewHighlights(root, marks) {
  unwrapReadingHighlights(root);
  renderReadingHighlights(root, marks);
  renderCalloutReadingHighlights(root, marks);
}
function renderReadingHighlights(root, marks) {
  const liveMarks = marks.filter((mark) => !mark.orphaned && mark.anchor.selectedText.trim()).sort((left, right) => right.anchor.selectedText.length - left.anchor.selectedText.length);
  for (const mark of liveMarks) {
    if (root.querySelector(highlightSelectorForId(mark.id))) {
      continue;
    }
    wrapRenderedAnchor(root, mark.anchor, mark.color, mark.id);
  }
}
function renderCalloutReadingHighlights(root, marks) {
  const callouts = calloutRoots(root);
  if (!callouts.length) {
    return;
  }
  const liveMarks = marks.filter((mark) => !mark.orphaned && mark.anchor.selectedText.trim()).sort((left, right) => right.anchor.selectedText.length - left.anchor.selectedText.length);
  for (const callout of callouts) {
    for (const mark of liveMarks) {
      if (root.querySelector(highlightSelectorForId(mark.id))) {
        continue;
      }
      wrapRenderedAnchor(callout, mark.anchor, mark.color, mark.id);
    }
  }
}
function calloutRoots(root) {
  const roots = /* @__PURE__ */ new Set();
  if (root.matches(".callout")) {
    roots.add(root);
  }
  const parentCallout = root.closest(".callout");
  if (parentCallout) {
    roots.add(parentCallout);
  }
  for (const callout of Array.from(root.querySelectorAll(".callout"))) {
    roots.add(callout);
  }
  return Array.from(roots);
}
function unwrapReadingHighlights(root) {
  for (const mark of Array.from(root.querySelectorAll(MARK_SELECTOR))) {
    const parent = mark.parentNode;
    if (!parent) {
      continue;
    }
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  }
}
function wrapRenderedAnchor(root, anchor, color, id) {
  const snapshot = collectText(root);
  if (!snapshot.text.trim()) {
    return false;
  }
  const range = locateRenderedRange(snapshot.text, anchor);
  if (!range || range.start === range.end) {
    return false;
  }
  return wrapRange(snapshot.segments, range, color, id);
}
function locateRenderedRange(renderedText, anchor) {
  const exact = renderedText.indexOf(anchor.selectedText);
  if (exact >= 0) {
    return {
      start: exact,
      end: exact + anchor.selectedText.length
    };
  }
  const normalized = locateNormalizedRange(renderedText, anchor.selectedText);
  if (normalized) {
    return normalized;
  }
  const fuzzy = findBestFuzzyMatch(
    renderedText,
    anchor.selectedText,
    0
  );
  if (!fuzzy || fuzzy.confidence < 0.55) {
    return null;
  }
  return {
    start: fuzzy.startOffset,
    end: fuzzy.endOffset
  };
}
function locateNormalizedRange(renderedText, selectedText) {
  const rendered = normalizeWithMap(renderedText);
  const selected = normalizeWithMap(selectedText);
  if (!rendered.text || !selected.text) {
    return null;
  }
  const normalizedStart = rendered.text.indexOf(selected.text);
  if (normalizedStart < 0) {
    return null;
  }
  const normalizedEnd = normalizedStart + selected.text.length - 1;
  const start = rendered.map[normalizedStart];
  const end = rendered.map[normalizedEnd] + 1;
  if (start === void 0 || end === void 0 || start >= end) {
    return null;
  }
  return { start, end };
}
function normalizeWithMap(value) {
  let text = "";
  const map = [];
  let pendingSpace = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (/\s/.test(char)) {
      pendingSpace = text.length > 0;
      continue;
    }
    if (pendingSpace) {
      text += " ";
      map.push(index);
      pendingSpace = false;
    }
    text += char.toLowerCase();
    map.push(index);
  }
  return { text: text.trim(), map };
}
function collectText(root) {
  const segments = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node2) {
      const parent = node2.parentElement;
      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }
      const tag = parent.tagName.toLowerCase();
      if (["script", "style"].includes(tag)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.closest(`${MARK_SELECTOR}, mark.yh-highlight, pre, textarea, input`)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!node2.textContent) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let node = walker.nextNode();
  while (node) {
    const start = text.length;
    text += node.textContent ?? "";
    segments.push({ node, start, end: text.length });
    node = walker.nextNode();
  }
  return { text, segments };
}
function wrapRange(segments, range, color, id) {
  const touched = segments.filter((segment) => segment.end > range.start && segment.start < range.end);
  if (!touched.length) {
    return false;
  }
  for (const segment of touched) {
    const localStart = Math.max(0, range.start - segment.start);
    const localEnd = Math.min(segment.node.length, range.end - segment.start);
    if (localStart >= localEnd || !segment.node.parentNode) {
      continue;
    }
    const selected = splitTextRange(segment.node, localStart, localEnd);
    const mark = document.createElement("mark");
    mark.className = `yh-reading-highlight yh-highlight yh-highlight--${color}`;
    mark.dataset.yhColor = color;
    mark.dataset.yhId = id;
    mark.style.setProperty("background-color", highlightBackground2(color), "important");
    mark.tabIndex = 0;
    selected.parentNode?.insertBefore(mark, selected);
    mark.appendChild(selected);
  }
  return true;
}
function splitTextRange(node, start, end) {
  let selected = node;
  if (start > 0) {
    selected = selected.splitText(start);
  }
  const selectedLength = end - start;
  if (selectedLength < selected.length) {
    selected.splitText(selectedLength);
  }
  return selected;
}
function highlightBackground2(color) {
  const colors = {
    yellow: "rgba(245, 197, 24, 0.42)",
    orange: "rgba(255, 140, 0, 0.36)",
    pink: "rgba(255, 105, 180, 0.32)",
    green: "rgba(82, 196, 26, 0.30)",
    blue: "rgba(22, 119, 255, 0.28)",
    purple: "rgba(114, 46, 209, 0.30)"
  };
  return colors[color] ?? colors.yellow;
}
function isOwnHighlightMutation(mutation) {
  const target = mutation.target;
  if (target instanceof HTMLElement && target.closest(MARK_SELECTOR)) {
    return true;
  }
  return Array.from(mutation.addedNodes).every((node) => {
    return node instanceof HTMLElement && Boolean(node.closest(MARK_SELECTOR));
  });
}
function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}
function highlightSelectorForId(id) {
  const escaped = cssEscape(id);
  return `.yh-reading-highlight[data-yh-id="${escaped}"], mark.yh-highlight[data-yh-id="${escaped}"]`;
}

// src/storage/types.ts
var ANNOTATION_COLORS = [
  "yellow",
  "green",
  "blue",
  "pink",
  "orange",
  "purple"
];
var DEFAULT_SETTINGS = {
  defaultHighlightColor: "yellow",
  stickyWidth: 280,
  stickySide: "right",
  stickyCollapseWidth: 800,
  showLeaderLines: true,
  defaultAuthor: "\u8BFB\u8005",
  backupFrequencyMinutes: 30,
  migrateOnRename: true,
  stickyNotesVisible: true
};
var EMPTY_INDEX = {
  version: 1,
  files: {}
};

// src/editor/selectionToolbar.ts
var SelectionToolbar = class {
  constructor(options) {
    this.options = options;
    this.visible = false;
    this.handleMouseUp = () => {
      window.setTimeout(() => this.showForSelection(), 0);
    };
    this.element = document.body.createDiv({ cls: "yh-toolbar yh-selection-toolbar" });
    this.render();
    this.hide();
    document.addEventListener("mouseup", this.handleMouseUp);
  }
  destroy() {
    document.removeEventListener("mouseup", this.handleMouseUp);
    this.element.remove();
  }
  showForSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      this.hide();
      return;
    }
    const text = selection.toString().trim();
    const range = selection.getRangeAt(0);
    if (!text || !isSelectionInsideWorkspace(range)) {
      this.hide();
      return;
    }
    const rect = range.getBoundingClientRect();
    this.element.style.left = `${Math.max(8, rect.left + rect.width / 2)}px`;
    this.element.style.top = `${Math.max(8, rect.top - 46)}px`;
    this.element.toggleClass("is-visible", true);
    this.visible = true;
  }
  hide() {
    this.element.toggleClass("is-visible", false);
    this.visible = false;
  }
  isVisible() {
    return this.visible;
  }
  render() {
    for (const color of ANNOTATION_COLORS) {
      const button = this.element.createEl("button", {
        cls: `yh-toolbar-color yh-toolbar-color--${color}`,
        attr: {
          type: "button",
          "aria-label": `\u9AD8\u4EAE ${color}`,
          "data-yh-color": color
        }
      });
      button.addEventListener("click", () => this.options.onHighlight(color));
    }
    this.element.createDiv({ cls: "yh-toolbar-sep" });
    const commentButton = this.iconButton("\u6DFB\u52A0\u4FBF\u7B7E", NOTE_ICON);
    commentButton.addEventListener("click", () => this.options.onComment());
    const copyButton = this.iconButton("\u590D\u5236", COPY_ICON);
    copyButton.addEventListener("click", () => this.options.onCopy());
    const sidebarButton = this.iconButton("\u6253\u5F00\u603B\u89C8", OVERVIEW_ICON);
    sidebarButton.addEventListener("click", () => this.options.onOpenSidebar());
  }
  iconButton(label, svg) {
    const button = this.element.createEl("button", {
      cls: "yh-toolbar-action",
      attr: {
        type: "button",
        "aria-label": label,
        title: label
      }
    });
    button.innerHTML = svg;
    return button;
  }
};
function isSelectionInsideWorkspace(range) {
  const container = range.commonAncestorContainer instanceof HTMLElement ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  if (!container) {
    return false;
  }
  return Boolean(
    container.closest(".workspace") || container.closest(".callout-content") || container.closest(".markdown-preview-view")
  );
}
var NOTE_ICON = `
  <svg width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5
      a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
`;
var COPY_ICON = `
  <svg width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="9" width="13" height="13"
      rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4
      a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
`;
var OVERVIEW_ICON = `
  <svg width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <line x1="8" y1="6" x2="21" y2="6"/>
    <line x1="8" y1="12" x2="21" y2="12"/>
    <line x1="8" y1="18" x2="21" y2="18"/>
    <line x1="3" y1="6" x2="3.01" y2="6"/>
    <line x1="3" y1="12" x2="3.01" y2="12"/>
    <line x1="3" y1="18" x2="3.01" y2="18"/>
  </svg>
`;

// src/pdf/pdfAnnotationLayer.ts
var import_obsidian3 = require("obsidian");
var PDF_PAGE_SELECTOR = ".pdf-page, .page[data-page-number], .page";
var PDF_VIEWER_SELECTOR = ".pdf-container, .pdf-viewer, .pdf-embed, .workspace-leaf-content[data-type='pdf']";
var PdfAnnotationLayer = class {
  constructor(options) {
    this.options = options;
    this.root = null;
    this.popover = null;
    this.observer = null;
    this.frame = null;
    this.lastSelection = null;
    this.scheduleRender = () => {
      if (this.frame !== null) {
        return;
      }
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        void this.render();
      });
    };
  }
  register() {
    this.options.component.registerDomEvent(document, "selectionchange", () => this.captureSelection());
    this.options.component.registerDomEvent(document, "mouseup", () => {
      window.setTimeout(() => this.captureSelection(), 10);
    });
    this.options.component.registerDomEvent(document, "click", (event) => {
      void this.handleClick(event);
    });
    this.options.component.registerEvent(
      this.options.app.workspace.on("active-leaf-change", () => this.scheduleRender())
    );
    this.options.component.registerEvent(
      this.options.app.workspace.on("layout-change", () => this.scheduleRender())
    );
    this.observer = new MutationObserver(() => this.scheduleRender());
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.options.component.register(() => this.destroy());
    this.scheduleRender();
  }
  async createHighlight(color) {
    const snapshot = this.resolveSelection();
    if (!snapshot) {
      new import_obsidian3.Notice("\u8BF7\u5148\u5728 PDF \u4E2D\u9009\u4E2D\u6587\u672C\u3002");
      return true;
    }
    await this.options.addHighlight(snapshot.file, {
      id: crypto.randomUUID(),
      color,
      anchor: snapshot.anchor,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    this.clearSelection();
    this.scheduleRender();
    return true;
  }
  async createComment(color, content, author, title = "") {
    const snapshot = this.resolveSelection();
    if (!snapshot) {
      new import_obsidian3.Notice("\u8BF7\u5148\u5728 PDF \u4E2D\u9009\u4E2D\u6587\u672C\u3002");
      return true;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
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
      resolved: false
    });
    this.clearSelection();
    this.scheduleRender();
    return true;
  }
  isPdfActive() {
    return this.activePdfFile() !== null;
  }
  destroy() {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
    }
    this.observer?.disconnect();
    this.root?.remove();
    this.popover?.remove();
  }
  async render() {
    const file = this.activePdfFile();
    const viewer = this.activeViewer();
    if (!file || !viewer) {
      this.root?.remove();
      this.root = null;
      return;
    }
    const document2 = await this.options.getDocument(file);
    const settings = this.options.getSettings();
    const host = viewer.closest(".workspace-leaf-content") ?? viewer;
    host.addClass("yh-pdf-host");
    host.style.setProperty("--yh-sticky-width", `${settings.stickyWidth}px`);
    if (!this.root || this.root.parentElement !== host) {
      this.root?.remove();
      this.root = host.createDiv({ cls: "yh-pdf-layer" });
    }
    this.renderHighlights(host, document2);
  }
  renderHighlights(host, document2) {
    if (!this.root) {
      return;
    }
    this.root.querySelectorAll(".yh-pdf-highlight").forEach((item) => item.remove());
    const hostRect = host.getBoundingClientRect();
    const annotations = [...document2.pdfHighlights, ...document2.pdfComments].filter((item) => !item.orphaned);
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
            "data-yh-color": annotation.color
          }
        });
        highlight.style.left = `${pageRect.left - hostRect.left + rect.left * pageRect.width}px`;
        highlight.style.top = `${pageRect.top - hostRect.top + rect.top * pageRect.height}px`;
        highlight.style.width = `${rect.width * pageRect.width}px`;
        highlight.style.height = `${rect.height * pageRect.height}px`;
        highlight.style.setProperty("background-color", pdfHighlightBackground(annotation.color), "important");
      }
    }
  }
  captureSelection() {
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
  anchorFromSelection(selection, selectedText) {
    const rects = [];
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
          height: rect.height / pageRect.height
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
      createdScale: this.currentScale()
    };
  }
  async handleClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const highlight = target.closest(".yh-pdf-highlight");
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
    const document2 = this.options.getCachedDocument(file.path) ?? await this.options.getDocument(file);
    const annotation = document2.pdfComments.find((item) => item.id === id) ?? document2.pdfHighlights.find((item) => item.id === id);
    if (!annotation) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.showPopover(file.path, highlight.getBoundingClientRect(), annotation);
  }
  showPopover(sourcePath, rect, annotation) {
    this.hidePopover();
    this.popover = document.body.createDiv({ cls: "yh-pdf-popover yh-annotation-popover is-visible" });
    const header = this.popover.createDiv({ cls: "yh-popover-header" });
    header.createSpan({ cls: "yh-popover-title", text: `PDF \u7B2C ${annotation.anchor.pageNumber} \u9875` });
    const close = header.createEl("button", { cls: "yh-icon-button", attr: { type: "button", title: "\u5173\u95ED" } });
    (0, import_obsidian3.setIcon)(close, "x");
    close.addEventListener("click", () => this.hidePopover());
    const card = this.popover.createDiv({
      cls: "yh-popover-card",
      attr: { "data-yh-color": annotation.color, "data-yh-id": annotation.id }
    });
    card.createDiv({ cls: "yh-popover-quote", text: annotation.anchor.selectedText });
    if ("content" in annotation && annotation.content) {
      const body = card.createDiv({ cls: "yh-popover-body" });
      import_obsidian3.MarkdownRenderer.render(this.options.app, annotation.content, body, sourcePath, this.options.component);
    }
    const width = Math.min(320, window.innerWidth - 24);
    this.popover.style.width = `${width}px`;
    this.popover.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, rect.left))}px`;
    this.popover.style.top = `${Math.max(12, Math.min(window.innerHeight - 240, rect.bottom + 8))}px`;
  }
  hidePopover() {
    this.popover?.remove();
    this.popover = null;
  }
  resolveSelection() {
    this.captureSelection();
    return this.lastSelection;
  }
  clearSelection() {
    window.getSelection()?.removeAllRanges();
    this.lastSelection = null;
  }
  pageElementFromRect(rect) {
    const element = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return element?.closest(PDF_PAGE_SELECTOR) ?? null;
  }
  pageElement(pageNumber) {
    const pages = this.pages();
    return pages.find((page) => this.pageNumber(page) === pageNumber) ?? null;
  }
  pages() {
    const viewer = this.activeViewer();
    return viewer ? Array.from(viewer.querySelectorAll(PDF_PAGE_SELECTOR)) : [];
  }
  pageNumber(page) {
    const attr = page.dataset.pageNumber ?? page.getAttr("data-page-number");
    const parsed = attr ? Number.parseInt(attr, 10) : NaN;
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    return Math.max(1, this.pages().indexOf(page) + 1);
  }
  currentScale() {
    const page = this.pages()[0];
    return page ? page.getBoundingClientRect().width / Math.max(1, page.offsetWidth) : 1;
  }
  activeViewer() {
    const active = this.options.app.workspace.activeLeaf?.view?.containerEl;
    const root = active ?? document.querySelector(".workspace-leaf.mod-active");
    if (!root) {
      return null;
    }
    return root.matches(PDF_VIEWER_SELECTOR) ? root : root.querySelector(PDF_VIEWER_SELECTOR);
  }
  activePdfFile() {
    const file = this.options.app.workspace.getActiveFile();
    return file instanceof import_obsidian3.TFile && file.extension.toLowerCase() === "pdf" ? file : null;
  }
};
function selectionContainer(selection) {
  if (selection.rangeCount === 0) {
    return null;
  }
  const node = selection.getRangeAt(0).commonAncestorContainer;
  return node instanceof Element ? node : node.parentElement;
}
function pdfHighlightBackground(color) {
  const colors = {
    yellow: "rgba(255, 213, 0, 0.35)",
    orange: "rgba(255, 140, 0, 0.35)",
    pink: "rgba(255, 105, 180, 0.35)",
    green: "rgba(82, 196, 26, 0.35)",
    blue: "rgba(22, 119, 255, 0.35)",
    purple: "rgba(114, 46, 209, 0.35)"
  };
  return colors[color] ?? colors.yellow;
}

// src/settings/settingsTab.ts
var import_obsidian4 = require("obsidian");
var AnnotationSettingsTab = class extends import_obsidian4.PluginSettingTab {
  constructor(plugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "\u58A8\u5149\u6279\u6CE8" });
    new import_obsidian4.Setting(containerEl).setName("\u9ED8\u8BA4\u9AD8\u4EAE\u989C\u8272").addDropdown((dropdown) => {
      for (const color of ANNOTATION_COLORS) {
        dropdown.addOption(color, color);
      }
      dropdown.setValue(this.plugin.settings.defaultHighlightColor).onChange(async (value) => {
        this.plugin.settings.defaultHighlightColor = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian4.Setting(containerEl).setName("\u4FBF\u7B7E\u5BBD\u5EA6").addSlider((slider) => {
      slider.setLimits(220, 420, 10).setValue(this.plugin.settings.stickyWidth).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.stickyWidth = value;
        await this.plugin.saveSettings();
        this.plugin.refreshAnnotations();
      });
    });
    new import_obsidian4.Setting(containerEl).setName("\u4FBF\u7B7E\u663E\u793A\u4F4D\u7F6E").setDesc("\u53F3\u4FA7\u4E3A\u9605\u8BFB\u5E03\u5C40\u9996\u9009\uFF1B\u5DE6\u4FA7\u4E3A\u9AD8\u7EA7\u504F\u597D\u3002").addDropdown((dropdown) => {
      dropdown.addOption("right", "\u53F3\u4FA7");
      dropdown.addOption("left", "\u5DE6\u4FA7");
      dropdown.setValue(this.plugin.settings.stickySide).onChange(async (value) => {
        this.plugin.settings.stickySide = value;
        await this.plugin.saveSettings();
        this.plugin.refreshAnnotations();
      });
    });
    new import_obsidian4.Setting(containerEl).setName("\u7A84\u5C4F\u6298\u53E0\u9608\u503C").setDesc("\u5F53\u7F16\u8F91\u9762\u677F\u5BBD\u5EA6\u4F4E\u4E8E\u6B64\u503C\u65F6\uFF0C\u4FBF\u7B7E\u4EE5\u5F39\u5C42\u5F62\u5F0F\u663E\u793A\u3002").addSlider((slider) => {
      slider.setLimits(640, 1200, 20).setValue(this.plugin.settings.stickyCollapseWidth).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.stickyCollapseWidth = value;
        await this.plugin.saveSettings();
        this.plugin.refreshAnnotations();
      });
    });
    new import_obsidian4.Setting(containerEl).setName("\u663E\u793A\u8FDE\u63A5\u7EBF").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.showLeaderLines).onChange(async (value) => {
        this.plugin.settings.showLeaderLines = value;
        await this.plugin.saveSettings();
        this.plugin.refreshAnnotations();
      });
    });
    new import_obsidian4.Setting(containerEl).setName("\u9ED8\u8BA4\u4F5C\u8005").addText((text) => {
      text.setValue(this.plugin.settings.defaultAuthor).onChange(async (value) => {
        this.plugin.settings.defaultAuthor = value.trim() || "\u8BFB\u8005";
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian4.Setting(containerEl).setName("\u6570\u636E\u5907\u4EFD\u9891\u7387").setDesc("\u81EA\u52A8\u5907\u4EFD\u95F4\u9694\uFF08\u5206\u949F\uFF09\u3002sidecar \u6587\u4EF6\u4ECD\u4F1A\u5373\u65F6\u4FDD\u5B58\u3002").addSlider((slider) => {
      slider.setLimits(5, 240, 5).setValue(this.plugin.settings.backupFrequencyMinutes).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.backupFrequencyMinutes = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian4.Setting(containerEl).setName("\u91CD\u547D\u540D\u65F6\u8FC1\u79FB\u6279\u6CE8").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.migrateOnRename).onChange(async (value) => {
        this.plugin.settings.migrateOnRename = value;
        await this.plugin.saveSettings();
      });
    });
  }
};

// src/storage/annotationStore.ts
var import_obsidian5 = require("obsidian");
var STORE_DIR = ".obsidian-annotations";
var INDEX_PATH = (0, import_obsidian5.normalizePath)(`${STORE_DIR}/index.json`);
var AnnotationStore = class {
  constructor(app) {
    this.app = app;
    this.documents = /* @__PURE__ */ new Map();
    this.index = EMPTY_INDEX;
    this.changeVersion = 0;
  }
  get version() {
    return this.changeVersion;
  }
  async initialize() {
    await this.ensureStoreDir();
    this.index = await this.readJson(INDEX_PATH, EMPTY_INDEX);
  }
  getCachedDocument(filePath) {
    return this.documents.get(this.toCacheKey(filePath)) ?? null;
  }
  async getDocument(file) {
    const filePath = this.normalizeVaultPath(file.path);
    const cacheKey = this.toCacheKey(filePath);
    const cached = this.documents.get(cacheKey);
    if (cached) {
      return cached;
    }
    const sidecarPath = this.toSidecarPath(filePath);
    const fallback = await this.createEmptyDocument(file);
    const document2 = await this.readJson(sidecarPath, fallback);
    this.documents.set(cacheKey, this.normalizeDocument(document2, filePath));
    return this.documents.get(cacheKey);
  }
  async saveDocument(document2) {
    const filePath = this.normalizeVaultPath(document2.filePath);
    const sidecarPath = this.toSidecarPath(filePath);
    const normalized = this.normalizeDocument(document2, filePath);
    await this.ensureStoreDir();
    await this.app.vault.adapter.write(sidecarPath, JSON.stringify(normalized, null, 2));
    this.documents.set(this.toCacheKey(normalized.filePath), normalized);
    this.index.files[normalized.filePath] = this.toIndexEntry(normalized, sidecarPath);
    await this.writeIndex();
    this.changeVersion += 1;
  }
  async addHighlight(file, highlight) {
    const document2 = await this.getDocument(file);
    document2.highlights = [...document2.highlights, highlight].sort(
      (a, b) => a.anchor.startOffset - b.anchor.startOffset
    );
    document2.lastModified = (/* @__PURE__ */ new Date()).toISOString();
    await this.saveDocument(document2);
    return document2;
  }
  async addComment(file, comment) {
    const document2 = await this.getDocument(file);
    document2.comments = [...document2.comments, comment].sort(
      (a, b) => a.anchor.startOffset - b.anchor.startOffset
    );
    document2.lastModified = (/* @__PURE__ */ new Date()).toISOString();
    await this.saveDocument(document2);
    return document2;
  }
  async addPdfHighlight(file, highlight) {
    const document2 = await this.getDocument(file);
    document2.pdfHighlights = [...document2.pdfHighlights, highlight].sort(
      (a, b) => a.anchor.pageNumber - b.anchor.pageNumber
    );
    document2.lastModified = (/* @__PURE__ */ new Date()).toISOString();
    await this.saveDocument(document2);
    return document2;
  }
  async addPdfComment(file, comment) {
    const document2 = await this.getDocument(file);
    document2.pdfComments = [...document2.pdfComments, comment].sort((a, b) => {
      return a.anchor.pageNumber - b.anchor.pageNumber;
    });
    document2.lastModified = (/* @__PURE__ */ new Date()).toISOString();
    await this.saveDocument(document2);
    return document2;
  }
  async updatePdfComment(file, comment) {
    const document2 = await this.getDocument(file);
    document2.pdfComments = document2.pdfComments.map((item) => item.id === comment.id ? comment : item);
    document2.lastModified = (/* @__PURE__ */ new Date()).toISOString();
    await this.saveDocument(document2);
    return document2;
  }
  async updateComment(file, comment) {
    const document2 = await this.getDocument(file);
    document2.comments = document2.comments.map((item) => item.id === comment.id ? comment : item);
    document2.lastModified = (/* @__PURE__ */ new Date()).toISOString();
    await this.saveDocument(document2);
    return document2;
  }
  async updateCommentContent(file, commentId, content, title) {
    const document2 = await this.getDocument(file);
    document2.comments = document2.comments.map((item) => {
      if (item.id !== commentId) {
        return item;
      }
      return {
        ...item,
        title,
        content,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    });
    document2.lastModified = (/* @__PURE__ */ new Date()).toISOString();
    await this.saveDocument(document2);
    return document2;
  }
  async updatePdfCommentContent(file, commentId, content, title) {
    const document2 = await this.getDocument(file);
    document2.pdfComments = document2.pdfComments.map((item) => {
      if (item.id !== commentId) {
        return item;
      }
      return {
        ...item,
        title,
        content,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    });
    document2.lastModified = (/* @__PURE__ */ new Date()).toISOString();
    await this.saveDocument(document2);
    return document2;
  }
  async removeAnnotation(file, annotationId) {
    const document2 = await this.getDocument(file);
    document2.highlights = document2.highlights.filter((item) => item.id !== annotationId);
    document2.comments = document2.comments.filter((item) => item.id !== annotationId);
    document2.pdfHighlights = document2.pdfHighlights.filter((item) => item.id !== annotationId);
    document2.pdfComments = document2.pdfComments.filter((item) => item.id !== annotationId);
    document2.lastModified = (/* @__PURE__ */ new Date()).toISOString();
    await this.saveDocument(document2);
    return document2;
  }
  async migrateFilePath(oldPath, file) {
    const normalizedOldPath = this.normalizeVaultPath(oldPath);
    const oldSidecar = this.toSidecarPath(normalizedOldPath);
    const oldDocument = await this.readJson(oldSidecar, null);
    if (!oldDocument) {
      return;
    }
    const nextDocument = {
      ...oldDocument,
      filePath: this.normalizeVaultPath(file.path),
      fileHash: await this.hashFile(file),
      lastModified: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.saveDocument(nextDocument);
    await this.deleteIfExists(oldSidecar);
    delete this.index.files[normalizedOldPath];
    await this.writeIndex();
    this.documents.delete(this.toCacheKey(normalizedOldPath));
  }
  async exportNotes(file) {
    const document2 = await this.getDocument(file);
    const baseName = file.basename || file.name.replace(/\.md$/i, "");
    const targetPath = (0, import_obsidian5.normalizePath)(`${file.parent?.path ?? ""}/${baseName}-notes.md`);
    const lines = [
      `# Notes for ${file.path}`,
      "",
      `Exported: ${(/* @__PURE__ */ new Date()).toISOString()}`,
      "",
      "## Highlights",
      "",
      ...document2.highlights.map((highlight) => {
        return `- ==${highlight.anchor.selectedText}== (${highlight.color}, ${highlight.createdAt})`;
      }),
      ...document2.pdfHighlights.map((highlight) => {
        return `- ==${highlight.anchor.selectedText}== (PDF page ${highlight.anchor.pageNumber}, ${highlight.color}, ${highlight.createdAt})`;
      }),
      "",
      "## Sticky Notes",
      "",
      ...document2.comments.map((comment) => {
        return [
          `### ${comment.anchor.selectedText}`,
          "",
          `Color: ${comment.color}`,
          `Created: ${comment.createdAt}`,
          "",
          comment.content,
          ""
        ].join("\n");
      }),
      ...document2.pdfComments.map((comment) => {
        return [
          `### PDF page ${comment.anchor.pageNumber}: ${comment.anchor.selectedText}`,
          "",
          `Color: ${comment.color}`,
          `Created: ${comment.createdAt}`,
          "",
          comment.content,
          ""
        ].join("\n");
      })
    ];
    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing instanceof import_obsidian5.TFile) {
      await this.app.vault.modify(existing, lines.join("\n"));
      return existing;
    }
    return this.app.vault.create(targetPath, lines.join("\n"));
  }
  async touchFileHash(file) {
    const document2 = await this.getDocument(file);
    document2.fileHash = await this.hashFile(file);
    document2.lastModified = (/* @__PURE__ */ new Date()).toISOString();
    await this.saveDocument(document2);
  }
  async hashFile(file) {
    if (file.extension === "md") {
      return this.hashString(await this.app.vault.cachedRead(file));
    }
    const bytes = await this.app.vault.readBinary(file);
    return this.hashBytes(bytes);
  }
  toSidecarPath(filePath) {
    const safeName = this.normalizeVaultPath(filePath).toLowerCase().split(/[\\/]/).map((part) => encodeURIComponent(part)).join("__");
    return (0, import_obsidian5.normalizePath)(`${STORE_DIR}/${safeName}.json`);
  }
  async createEmptyDocument(file) {
    return {
      filePath: this.normalizeVaultPath(file.path),
      fileHash: await this.hashFile(file),
      lastModified: (/* @__PURE__ */ new Date()).toISOString(),
      highlights: [],
      comments: [],
      pdfHighlights: [],
      pdfComments: []
    };
  }
  normalizeDocument(document2, filePath) {
    return {
      filePath,
      fileHash: document2.fileHash ?? "",
      lastModified: document2.lastModified ?? (/* @__PURE__ */ new Date()).toISOString(),
      highlights: document2.highlights ?? [],
      comments: document2.comments ?? [],
      pdfHighlights: document2.pdfHighlights ?? [],
      pdfComments: document2.pdfComments ?? []
    };
  }
  toIndexEntry(document2, sidecarPath) {
    return {
      filePath: document2.filePath,
      sidecarPath,
      fileHash: document2.fileHash,
      highlightCount: document2.highlights.length + document2.pdfHighlights.length,
      commentCount: document2.comments.length + document2.pdfComments.length,
      updatedAt: document2.lastModified
    };
  }
  async ensureStoreDir() {
    const storeDir = (0, import_obsidian5.normalizePath)(STORE_DIR);
    if (!await this.app.vault.adapter.exists(storeDir)) {
      await this.app.vault.adapter.mkdir(storeDir);
    }
  }
  async writeIndex() {
    await this.ensureStoreDir();
    await this.app.vault.adapter.write(INDEX_PATH, JSON.stringify(this.index, null, 2));
  }
  async readJson(path, fallback) {
    const normalizedPath = (0, import_obsidian5.normalizePath)(path);
    if (!await this.app.vault.adapter.exists(normalizedPath)) {
      return fallback;
    }
    try {
      return JSON.parse(await this.app.vault.adapter.read(normalizedPath));
    } catch {
      return fallback;
    }
  }
  async deleteIfExists(path) {
    const normalizedPath = (0, import_obsidian5.normalizePath)(path);
    if (await this.app.vault.adapter.exists(normalizedPath)) {
      await this.app.vault.adapter.remove(normalizedPath);
    }
  }
  normalizeVaultPath(filePath) {
    return (0, import_obsidian5.normalizePath)(filePath);
  }
  toCacheKey(filePath) {
    return this.normalizeVaultPath(filePath).toLowerCase();
  }
  async hashString(content) {
    return this.hashBytes(new TextEncoder().encode(content));
  }
  async hashBytes(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
};

// src/views/annotationPopover.ts
var import_obsidian6 = require("obsidian");
var AnnotationPopover = class {
  constructor(options) {
    this.options = options;
    this.element = document.body.createDiv({ cls: "yh-annotation-popover" });
    this.element.addEventListener("click", (event) => event.stopPropagation());
    this.hide();
  }
  destroy() {
    this.element.remove();
  }
  show(options) {
    this.element.empty();
    this.element.toggleClass("is-visible", true);
    const header = this.element.createDiv({ cls: "yh-popover-header" });
    header.createSpan({ cls: "yh-popover-title", text: "\u6279\u6CE8" });
    const close = header.createEl("button", {
      cls: "yh-icon-button",
      attr: { type: "button", title: "\u5173\u95ED\u6279\u6CE8\u5F39\u5C42" }
    });
    (0, import_obsidian6.setIcon)(close, "x");
    close.addEventListener("click", () => this.hide());
    const list = this.element.createDiv({ cls: "yh-popover-list" });
    for (const item of options.items) {
      this.renderItem(list, item, options.sourcePath);
    }
    this.place(options.rect);
  }
  hide() {
    this.element.toggleClass("is-visible", false);
    this.element.empty();
  }
  static itemFromAnnotation(annotation) {
    const isComment = "content" in annotation;
    return {
      id: annotation.id,
      color: annotation.color,
      kind: isComment ? "comment" : "highlight",
      quote: annotation.anchor.selectedText,
      content: isComment ? annotation.content : void 0,
      author: isComment ? annotation.author : void 0
    };
  }
  renderItem(container, item, sourcePath) {
    const card = container.createDiv({
      cls: "yh-popover-card",
      attr: {
        "data-yh-color": item.color,
        "data-yh-id": item.id
      }
    });
    const meta = card.createDiv({ cls: "yh-popover-meta" });
    meta.createSpan({ cls: "yh-color-chip", text: item.color, attr: { "data-yh-color": item.color } });
    meta.createSpan({ text: item.kind === "comment" ? item.author ?? "\u8BFB\u8005" : "\u4EC5\u9AD8\u4EAE" });
    card.createDiv({ cls: "yh-popover-quote", text: item.quote });
    if (!item.content) {
      card.createDiv({ cls: "yh-popover-empty", text: "\u6682\u65E0\u9644\u52A0\u4FBF\u7B7E\u3002" });
      return;
    }
    const body = card.createDiv({ cls: "yh-popover-body" });
    import_obsidian6.MarkdownRenderer.render(this.options.app, item.content, body, sourcePath, this.options.component);
  }
  place(rect) {
    const width = Math.min(320, window.innerWidth - 24);
    const left = clamp(rect.left + rect.width / 2 - width / 2, 12, window.innerWidth - width - 12);
    const below = rect.bottom + 10;
    const top = below + 220 > window.innerHeight ? Math.max(12, rect.top - 230) : below;
    this.element.style.width = `${width}px`;
    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
  }
};
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// src/views/sidebarView.ts
var import_obsidian7 = require("obsidian");
var ANNOTATION_SIDEBAR_VIEW = "yh-inklight-sidebar";
var AnnotationSidebarView = class extends import_obsidian7.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.query = "";
    this.color = "all";
    this.type = "all";
    this.sort = "document";
  }
  getViewType() {
    return ANNOTATION_SIDEBAR_VIEW;
  }
  getDisplayText() {
    return "\u58A8\u5149\u6279\u6CE8";
  }
  getIcon() {
    return "yh-inklight-icon";
  }
  async onOpen() {
    this.containerEl.addClass("yh-sidebar");
    await this.render();
  }
  async render() {
    const container = this.containerEl.children[1] ?? this.containerEl;
    container.empty();
    container.addClass("yh-overview");
    const file = this.app.workspace.getActiveFile();
    this.renderHeader(container);
    this.renderControls(container);
    if (!file) {
      container.createDiv({ cls: "yh-empty", text: "Open a Markdown or PDF file to inspect annotations." });
      return;
    }
    const document2 = await this.plugin.store.getDocument(file);
    const rawCards = this.buildCards(
      document2.highlights,
      document2.comments,
      document2.pdfHighlights,
      document2.pdfComments
    );
    const cards = this.filterCards(rawCards);
    const highlightCount = document2.highlights.filter((highlight) => !highlight.orphaned).length + document2.pdfHighlights.filter((highlight) => !highlight.orphaned).length;
    const noteCount = document2.comments.filter((comment) => !comment.orphaned).length + document2.pdfComments.filter((comment) => !comment.orphaned).length;
    container.createDiv({ cls: "yh-ov-count", text: `${highlightCount} highlights \xB7 ${noteCount} notes` });
    const list = container.createDiv({ cls: "yh-ov-list" });
    if (!cards.length) {
      list.createDiv({ cls: "yh-empty", text: "No matching annotations." });
    } else {
      for (const card of cards) {
        this.renderCard(list, file, card);
      }
    }
    this.renderExportFooter(container, file);
  }
  buildCards(highlights, comments, pdfHighlights, pdfComments) {
    const usedNotes = /* @__PURE__ */ new Set();
    const cards = [];
    for (const source of this.markdownHighlightSources(highlights, comments, usedNotes)) {
      cards.push(this.highlightCard(source));
    }
    for (const source of this.pdfHighlightSources(pdfHighlights, pdfComments, usedNotes)) {
      cards.push(this.highlightCard(source));
    }
    for (const source of this.orphanNoteSources(comments, pdfComments, usedNotes)) {
      cards.push(this.orphanNoteCard(source));
    }
    return cards;
  }
  markdownHighlightSources(highlights, comments, usedNotes) {
    return highlights.map((highlight) => {
      const note = this.findAttachedMarkdownNote(highlight, comments, usedNotes);
      if (note) {
        usedNotes.add(note.id);
      }
      return {
        mode: "md",
        highlight,
        note,
        pageNumber: null,
        startOffset: highlight.anchor.startOffset
      };
    });
  }
  pdfHighlightSources(highlights, comments, usedNotes) {
    return highlights.map((highlight) => {
      const note = this.findAttachedPdfNote(highlight, comments, usedNotes);
      if (note) {
        usedNotes.add(note.id);
      }
      return {
        mode: "pdf",
        highlight,
        note,
        pageNumber: highlight.anchor.pageNumber,
        startOffset: Number.MAX_SAFE_INTEGER
      };
    });
  }
  orphanNoteSources(comments, pdfComments, usedNotes) {
    return [
      ...comments.filter((note) => !usedNotes.has(note.id)).map((note) => ({
        mode: "md",
        note,
        pageNumber: null,
        startOffset: note.anchor.startOffset
      })),
      ...pdfComments.filter((note) => !usedNotes.has(note.id)).map((note) => ({
        mode: "pdf",
        note,
        pageNumber: note.anchor.pageNumber,
        startOffset: Number.MAX_SAFE_INTEGER
      }))
    ];
  }
  findAttachedMarkdownNote(highlight, comments, usedNotes) {
    return comments.find((note) => !usedNotes.has(note.id) && note.highlightId === highlight.id) ?? comments.find((note) => {
      return !usedNotes.has(note.id) && !note.highlightId && note.anchor.startOffset === highlight.anchor.startOffset && note.anchor.selectedText === highlight.anchor.selectedText;
    }) ?? null;
  }
  findAttachedPdfNote(highlight, comments, usedNotes) {
    return comments.find((note) => !usedNotes.has(note.id) && note.highlightId === highlight.id) ?? comments.find((note) => {
      return !usedNotes.has(note.id) && !note.highlightId && note.anchor.pageNumber === highlight.anchor.pageNumber && note.anchor.selectedText === highlight.anchor.selectedText;
    }) ?? null;
  }
  highlightCard(source) {
    return {
      id: source.highlight.id,
      kind: "highlight",
      mode: source.mode,
      color: source.highlight.color,
      text: source.highlight.anchor.selectedText,
      content: source.note?.content ?? "",
      createdAt: source.highlight.createdAt,
      startOffset: source.startOffset,
      pageNumber: source.pageNumber,
      orphaned: source.highlight.orphaned || source.note?.orphaned,
      isCode: isCodeAnchor(source.highlight.anchor),
      highlight: source.highlight,
      note: source.note
    };
  }
  orphanNoteCard(source) {
    return {
      id: source.note.id,
      kind: "note",
      mode: source.mode,
      color: source.note.color,
      text: source.note.anchor.selectedText,
      content: source.note.content,
      createdAt: source.note.createdAt,
      startOffset: source.startOffset,
      pageNumber: source.pageNumber,
      orphaned: source.note.orphaned,
      isCode: isCodeAnchor(source.note.anchor),
      highlight: null,
      note: source.note
    };
  }
  renderHeader(container) {
    const header = container.createDiv({ cls: "yh-ov-head" });
    header.createSpan({ cls: "yh-ov-title", text: "\u58A8\u5149\u6279\u6CE8" });
    const close = header.createEl("button", {
      cls: "yh-icon-btn yh-ov-close",
      attr: { type: "button", title: "Close panel", "aria-label": "\u5173\u95ED\u58A8\u5149\u6279\u6CE8\u9762\u677F" }
    });
    (0, import_obsidian7.setIcon)(close, "x");
    close.addEventListener("click", () => {
      void this.leaf.detach();
    });
  }
  renderControls(container) {
    const searchRow = container.createDiv({ cls: "yh-ov-search-row" });
    const search = searchRow.createEl("input", {
      cls: "yh-ov-search",
      attr: { type: "search", placeholder: "\u641C\u7D22\u6279\u6CE8..." }
    });
    search.value = this.query;
    search.addEventListener("input", async () => {
      this.query = search.value;
      await this.render();
    });
    const filterButton = searchRow.createEl("button", { cls: "yh-icon-btn", attr: { type: "button", title: "\u7B5B\u9009" } });
    (0, import_obsidian7.setIcon)(filterButton, "filter");
    const filterRow = container.createDiv({ cls: "yh-ov-filter-row" });
    const color = filterRow.createEl("select", { cls: "yh-filter-select" });
    color.createEl("option", { text: "\u5168\u90E8\u989C\u8272", value: "all" });
    for (const item of ANNOTATION_COLORS) {
      color.createEl("option", { text: item, value: item });
    }
    color.value = this.color;
    color.addEventListener("change", async () => {
      this.color = color.value;
      await this.render();
    });
    const type = filterRow.createEl("select", { cls: "yh-filter-select" });
    type.createEl("option", { text: "\u5168\u90E8\u7C7B\u578B", value: "all" });
    type.createEl("option", { text: "\u9AD8\u4EAE", value: "highlight" });
    type.createEl("option", { text: "\u7B14\u8BB0", value: "note" });
    type.value = this.type;
    type.addEventListener("change", async () => {
      this.type = type.value;
      await this.render();
    });
    const sort = filterRow.createEl("select", { cls: "yh-filter-select" });
    const sortOptions = { document: "\u6587\u6863\u987A\u5E8F", newest: "\u6700\u65B0\u4F18\u5148", oldest: "\u6700\u65E9\u4F18\u5148" };
    for (const item of ["document", "newest", "oldest"]) {
      sort.createEl("option", { text: sortOptions[item], value: item });
    }
    sort.value = this.sort;
    sort.addEventListener("change", async () => {
      this.sort = sort.value;
      await this.render();
    });
  }
  renderCard(list, file, cardData) {
    const card = list.createDiv({
      cls: `yh-ov-card yh-ov-card--${cardData.color}`,
      attr: this.cardAttributes(cardData)
    });
    card.toggleClass("is-orphaned", !!cardData.orphaned);
    const head = card.createDiv({ cls: "yh-ov-card-head" });
    head.createSpan({ cls: `yh-ov-label yh-label--${cardData.color}`, text: cardData.color });
    head.createSpan({ cls: "yh-ov-meta", text: cardData.mode });
    head.createSpan({ cls: "yh-ov-dot", text: "\xB7" });
    const title = cardData.note?.title ?? "";
    const type = head.createSpan({
      cls: "yh-ov-type",
      text: title ? getTitleLabel(title) : cardData.kind
    });
    if (title) {
      type.dataset.title = title;
    }
    head.createSpan({ cls: "yh-ov-time", text: formatTime(cardData.createdAt) });
    const quote = card.createDiv({ cls: "yh-ov-quote" });
    quote.textContent = cardData.text;
    quote.toggleClass("is-code", cardData.isCode || isCodeLikeText(cardData.text));
    this.addExpandToggle(quote, card);
    if (cardData.content) {
      const content = card.createDiv({ cls: "yh-ov-content" });
      void import_obsidian7.MarkdownRenderer.render(this.app, cardData.content, content, file.path, this).then(() => {
        this.addExpandToggle(content, card);
      });
    }
    const source = card.createDiv({ cls: "yh-ov-source" });
    source.createSpan({ cls: "yh-ov-file", text: file.name });
    source.createSpan({ cls: "yh-ov-mode", text: cardData.pageNumber ? `p.${cardData.pageNumber}` : "Markdown" });
    const actions = card.createDiv({ cls: "yh-ov-actions" });
    if (cardData.note) {
      const edit2 = actions.createEl("button", {
        cls: "yh-ov-btn yh-ov-btn--icon",
        attr: { type: "button", title: "\u7F16\u8F91\u7B14\u8BB0", "data-action": "edit-note" }
      });
      (0, import_obsidian7.setIcon)(edit2, "pencil");
      edit2.addEventListener("click", () => this.openInlineEditor(card, file, cardData, cardData.content));
    } else if (cardData.highlight) {
      const addNote = actions.createEl("button", {
        cls: "yh-ov-btn",
        text: "\u6DFB\u52A0\u7B14\u8BB0",
        attr: { type: "button", "data-action": "add-note" }
      });
      addNote.addEventListener("click", () => {
        addNote.addClass("hidden");
        this.openInlineEditor(card, file, cardData, "");
      });
    }
    const jump = actions.createEl("button", {
      cls: "yh-ov-btn",
      text: "\u8DF3\u8F6C",
      attr: { type: "button", "data-action": "jump" }
    });
    jump.addEventListener("click", () => this.jumpTo(file, cardData.startOffset, cardData.pageNumber));
    const remove = actions.createEl("button", {
      cls: "yh-ov-btn yh-ov-btn--danger",
      text: "\u5220\u9664",
      attr: { type: "button", "data-action": "delete" }
    });
    remove.addEventListener("click", async () => {
      await this.deleteCard(file, cardData);
      new import_obsidian7.Notice("\u6279\u6CE8\u5DF2\u5220\u9664");
      await this.plugin.refreshAnnotations();
    });
    const edit = card.createDiv({ cls: "yh-ov-edit hidden" });
    const textarea = edit.createEl("textarea", {
      cls: "yh-ov-textarea",
      attr: { placeholder: "\u5199\u4E0B\u4F60\u7684\u60F3\u6CD5..." }
    });
    const editActions = edit.createDiv({ cls: "yh-ov-edit-actions" });
    editActions.createEl("button", { cls: "yh-ov-save", text: "\u4FDD\u5B58", attr: { type: "button" } });
    editActions.createEl("button", { cls: "yh-ov-cancel", text: "\u53D6\u6D88", attr: { type: "button" } });
  }
  cardAttributes(card) {
    const attrs = { "data-id": card.id };
    if (card.highlight) {
      attrs["data-highlight-id"] = card.highlight.id;
    }
    if (card.note) {
      attrs["data-note-id"] = card.note.id;
    }
    return attrs;
  }
  openInlineEditor(card, file, cardData, initialValue) {
    const edit = card.querySelector(".yh-ov-edit");
    const textarea = card.querySelector(".yh-ov-textarea");
    const save = card.querySelector(".yh-ov-save");
    const cancel = card.querySelector(".yh-ov-cancel");
    const addNote = card.querySelector('[data-action="add-note"]');
    if (!edit || !textarea || !save || !cancel) {
      return;
    }
    textarea.value = initialValue;
    edit.removeClass("hidden");
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    const saveContent = async () => {
      await this.saveCardContent(file, cardData, textarea.value);
      await this.plugin.refreshAnnotations();
    };
    save.onclick = () => {
      void saveContent();
    };
    cancel.onclick = () => {
      textarea.value = initialValue;
      edit.addClass("hidden");
      addNote?.removeClass("hidden");
    };
    textarea.onkeydown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void saveContent();
      }
      if (event.key === "Escape") {
        textarea.value = initialValue;
        edit.addClass("hidden");
        addNote?.removeClass("hidden");
      }
    };
  }
  addExpandToggle(contentEl, wrapperEl) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const lineHeight = parseFloat(getComputedStyle(contentEl).lineHeight);
        const threshold = lineHeight * 3 + 10;
        if (contentEl.scrollHeight <= threshold + 2) {
          return;
        }
        const button = document.createElement("span");
        button.className = "yh-ov-expand-btn";
        button.textContent = "\u5C55\u5F00";
        button.tabIndex = 0;
        button.setAttribute("role", "button");
        contentEl.insertAdjacentElement("afterend", button);
        const toggle = () => {
          const expanded = contentEl.hasClass("expanded");
          contentEl.toggleClass("expanded", !expanded);
          button.setText(expanded ? "\u5C55\u5F00" : "\u6536\u8D77");
        };
        button.addEventListener("click", toggle);
        button.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        });
      });
    });
  }
  async saveCardContent(file, card, content) {
    if (card.note && card.mode === "pdf") {
      await this.plugin.store.updatePdfComment(file, {
        ...card.note,
        content,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      return;
    }
    if (card.note && card.mode === "md") {
      await this.plugin.store.updateComment(file, {
        ...card.note,
        content,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      return;
    }
    if (card.highlight && card.mode === "pdf") {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const highlight = card.highlight;
      await this.plugin.store.addPdfComment(file, {
        id: crypto.randomUUID(),
        highlightId: highlight.id,
        anchor: highlight.anchor,
        content,
        color: highlight.color,
        position: { offsetX: 20, offsetY: 0 },
        collapsed: false,
        author: this.plugin.settings.defaultAuthor,
        createdAt: now,
        updatedAt: now,
        replies: [],
        resolved: false
      });
      return;
    }
    if (card.highlight && card.mode === "md") {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const highlight = card.highlight;
      await this.plugin.store.addComment(file, {
        id: crypto.randomUUID(),
        highlightId: highlight.id,
        anchor: highlight.anchor,
        content,
        color: highlight.color,
        position: { offsetX: 20, offsetY: 0 },
        collapsed: false,
        author: this.plugin.settings.defaultAuthor,
        createdAt: now,
        updatedAt: now,
        replies: [],
        resolved: false
      });
    }
  }
  async deleteCard(file, card) {
    if (card.highlight) {
      await this.plugin.store.removeAnnotation(file, card.highlight.id);
    }
    if (card.note) {
      await this.plugin.store.removeAnnotation(file, card.note.id);
    }
  }
  filterCards(cards) {
    return cards.filter((card) => this.color === "all" || card.color === this.color).filter((card) => {
      if (this.type === "all") {
        return true;
      }
      if (this.type === "highlight") {
        return card.kind === "highlight";
      }
      return Boolean(card.note);
    }).filter((card) => {
      const haystack = `${card.text} ${card.content}`.toLowerCase();
      return haystack.includes(this.query.toLowerCase());
    }).sort((a, b) => {
      if (this.sort === "newest") {
        return this.cardUpdatedAt(b).localeCompare(this.cardUpdatedAt(a));
      }
      if (this.sort === "oldest") {
        return this.cardUpdatedAt(a).localeCompare(this.cardUpdatedAt(b));
      }
      return (a.pageNumber ?? 0) - (b.pageNumber ?? 0) || a.startOffset - b.startOffset;
    });
  }
  cardUpdatedAt(card) {
    return card.note?.updatedAt ?? card.createdAt;
  }
  renderExportFooter(container, file) {
    const footer = container.createDiv({ cls: "yh-ov-foot" });
    const exportButton = footer.createEl("button", { cls: "yh-export-btn", text: "\u2191 \u5BFC\u51FA\u6279\u6CE8", attr: { type: "button" } });
    exportButton.disabled = !file;
    exportButton.addEventListener("click", async () => {
      if (!file) {
        return;
      }
      const exported = await this.plugin.store.exportNotes(file);
      new import_obsidian7.Notice(`\u5DF2\u5BFC\u51FA\u7B14\u8BB0\u81F3 ${exported.path}`);
    });
    footer.createDiv({ cls: "yh-ov-export-note", text: "\u5BFC\u51FA\u4E3A Markdown \u6458\u8981" });
  }
  async jumpTo(file, offset, pageNumber) {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    if (file.extension.toLowerCase() === "pdf") {
      window.setTimeout(() => {
        const page = document.querySelector(
          `.workspace-leaf.mod-active .pdf-page[data-page-number="${pageNumber}"], .workspace-leaf.mod-active .page[data-page-number="${pageNumber}"]`
        );
        page?.scrollIntoView({ block: "center" });
        page?.addClass("yh-flash-target");
        window.setTimeout(() => page?.removeClass("yh-flash-target"), 850);
      }, 120);
      return;
    }
    const view = leaf.view instanceof import_obsidian7.MarkdownView ? leaf.view : this.app.workspace.getActiveViewOfType(import_obsidian7.MarkdownView);
    if (!view) {
      return;
    }
    const pos = view.editor.offsetToPos(offset);
    view.editor.setCursor(pos);
    view.editor.scrollIntoView({ from: pos, to: pos }, true);
    view.containerEl.addClass("yh-flash-target");
    window.setTimeout(() => view.containerEl.removeClass("yh-flash-target"), 850);
  }
};
function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function getTitleLabel(title) {
  const labels = {
    Insight: "\u{1F4A1} Insight",
    Question: "\u2753 Question",
    Reminder: "\u{1F514} Reminder"
  };
  return labels[title] ?? title;
}
function isCodeAnchor(anchor) {
  return "isCode" in anchor && Boolean(anchor.isCode);
}
function isCodeLikeText(text) {
  return /^[ \t]{2,}/m.test(text) || /\n[ \t]{2,}\S/.test(text);
}

// src/views/stickyNoteLane.ts
var import_obsidian9 = require("obsidian");

// src/utils/positioning.ts
var GAP = 10;
function layoutStickyNotes(items) {
  const sorted = [...items].sort((a, b) => a.anchorTop - b.anchorTop);
  const output = [];
  let cursor = 0;
  for (const item of sorted) {
    const preferred = Math.max(0, item.anchorTop + item.offsetY);
    const top = Math.max(preferred, cursor);
    output.push({ id: item.id, top });
    cursor = top + item.height + GAP;
  }
  return output;
}

// src/views/stickyNoteView.ts
var import_obsidian8 = require("obsidian");
function renderStickyNoteCard(container, options) {
  container.empty();
  const card = container.createDiv({
    cls: `yh-card yh-card--${options.comment.color} yh-sticky-card`,
    attr: {
      "data-yh-color": options.comment.color,
      "data-yh-id": options.comment.id,
      "data-yh-card-id": options.comment.id
    }
  });
  const header = card.createDiv({ cls: "yh-card-head" });
  header.createSpan({
    cls: `yh-card-color-label yh-label--${options.comment.color}`,
    text: options.comment.color
  });
  header.createSpan({ cls: "yh-card-page", text: "md" });
  header.createSpan({ cls: "yh-card-time", text: formatTime2(options.comment.updatedAt) });
  header.createSpan({ cls: "yh-card-author", text: options.comment.author });
  const tools = header.createDiv({ cls: "yh-card-tools" });
  const edit = tools.createEl("button", {
    cls: "yh-icon-btn",
    attr: { type: "button", title: "\u7F16\u8F91\u7B14\u8BB0" }
  });
  (0, import_obsidian8.setIcon)(edit, "pencil");
  const collapse = tools.createEl("button", {
    cls: "yh-icon-btn",
    attr: { type: "button", title: options.comment.collapsed ? "\u5C55\u5F00" : "\u6298\u53E0" }
  });
  (0, import_obsidian8.setIcon)(collapse, options.comment.collapsed ? "chevron-down" : "chevron-up");
  collapse.addEventListener("click", () => options.onToggle(options.comment));
  const remove = tools.createEl("button", {
    cls: "yh-icon-btn",
    attr: { type: "button", title: "\u5220\u9664\u7B14\u8BB0" }
  });
  (0, import_obsidian8.setIcon)(remove, "trash-2");
  remove.addEventListener("click", () => options.onDelete(options.comment));
  if (options.comment.collapsed) {
    const body2 = card.createDiv({ cls: "yh-card-body" });
    body2.createDiv({ cls: "yh-card-quote", text: options.comment.anchor.selectedText });
    return card;
  }
  const body = card.createDiv({ cls: "yh-card-body" });
  body.createDiv({ cls: "yh-card-quote", text: options.comment.anchor.selectedText });
  const content = body.createDiv({ cls: "yh-card-content" });
  renderDisplayMode(content, options);
  edit.addEventListener("click", () => renderEditMode(content, options));
  const foot = card.createDiv({ cls: "yh-card-foot" });
  foot.createEl("button", { cls: "yh-card-more", text: "\xB7\xB7\xB7", attr: { type: "button", title: "\u66F4\u591A" } });
  return card;
}
function renderDisplayMode(container, options) {
  container.empty();
  import_obsidian8.MarkdownRenderer.render(options.app, options.comment.content, container, options.sourcePath, options.component);
}
function renderEditMode(container, options) {
  container.empty();
  const title = container.createEl("input", {
    cls: "yh-sticky-title-editor",
    attr: { type: "text", placeholder: "\u6807\u9898" }
  });
  title.value = options.comment.title ?? "";
  const editor = container.createEl("textarea", {
    cls: "yh-sticky-editor",
    attr: { rows: "5", placeholder: "\u5199\u4E0B Markdown \u7B14\u8BB0..." }
  });
  editor.value = options.comment.content;
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
  const actions = container.createDiv({ cls: "yh-sticky-edit-actions" });
  const save = actions.createEl("button", { text: "\u4FDD\u5B58", cls: "mod-cta", attr: { type: "button" } });
  const cancel = actions.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
  const saveContent = () => {
    options.onUpdate(options.comment, editor.value, title.value.trim());
    renderDisplayMode(container, {
      ...options,
      comment: {
        ...options.comment,
        title: title.value.trim(),
        content: editor.value
      }
    });
  };
  save.addEventListener("click", saveContent);
  cancel.addEventListener("click", () => renderDisplayMode(container, options));
  editor.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      saveContent();
    }
  });
}
function formatTime2(value) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// src/views/stickyNoteLane.ts
var StickyNoteLane = class {
  constructor(options) {
    this.options = options;
    this.container = null;
    this.lane = null;
    this.observer = null;
  }
  register() {
    this.options.component.registerEvent(
      this.options.app.workspace.on("active-leaf-change", () => this.render())
    );
    this.options.component.registerEvent(
      this.options.app.workspace.on("layout-change", () => this.render())
    );
    this.observer = new ResizeObserver(() => this.render());
    this.options.component.register(() => this.destroy());
  }
  async render() {
    const view = this.options.app.workspace.getActiveViewOfType(import_obsidian9.MarkdownView);
    if (!view || !view.file || view.file.extension !== "md") {
      this.hide();
      return;
    }
    const settings = this.options.getSettings();
    if (!settings.stickyNotesVisible) {
      this.hide();
      return;
    }
    const document2 = this.options.getCachedDocument(view.file.path);
    if (!document2 || document2.comments.length === 0) {
      this.hide();
      return;
    }
    const visibleComments = document2.comments.filter((comment) => !comment.orphaned);
    if (visibleComments.length === 0) {
      this.hide();
      return;
    }
    const editorWidth = view.containerEl.offsetWidth;
    if (editorWidth < settings.stickyCollapseWidth) {
      this.hide();
      return;
    }
    this.ensureContainer(view);
    this.renderLane(view, visibleComments, settings);
  }
  ensureContainer(view) {
    if (this.container && this.container.parentElement === view.containerEl) {
      return;
    }
    this.container?.remove();
    this.container = view.containerEl.createDiv({ cls: "yh-sticky-lane-container" });
    this.lane = this.container.createDiv({ cls: "yh-sticky-lane" });
    if (this.observer) {
      this.observer.observe(view.containerEl);
    }
  }
  renderLane(view, comments, settings) {
    if (!this.lane) {
      return;
    }
    this.lane.empty();
    this.lane.toggleClass("yh-sticky-lane--left", settings.stickySide === "left");
    const layoutInputs = [];
    const commentElements = /* @__PURE__ */ new Map();
    for (const comment of comments) {
      const anchorTop = this.getAnchorTop(view, comment);
      if (anchorTop === null) {
        continue;
      }
      const tempCard = this.lane.createDiv({ cls: "yh-card yh-card--temp" });
      tempCard.style.visibility = "hidden";
      tempCard.style.position = "absolute";
      renderStickyNoteCard(tempCard, {
        app: this.options.app,
        component: this.options.component,
        sourcePath: view.file.path,
        comment,
        onToggle: (c) => this.handleToggle(view.file, c),
        onUpdate: (c, content, title) => this.handleUpdate(view.file, c, content, title),
        onDelete: (c) => this.handleDelete(view.file, c)
      });
      const height = tempCard.offsetHeight;
      tempCard.remove();
      layoutInputs.push({
        id: comment.id,
        anchorTop,
        height,
        offsetY: comment.position?.offsetY ?? 0
      });
    }
    const layoutOutputs = layoutStickyNotes(layoutInputs);
    for (const output of layoutOutputs) {
      const comment = comments.find((c) => c.id === output.id);
      if (!comment) {
        continue;
      }
      const card = this.lane.createDiv({
        cls: `yh-card yh-card--${comment.color} yh-sticky-card`,
        attr: {
          "data-yh-color": comment.color,
          "data-yh-id": comment.id,
          "data-yh-card-id": comment.id
        }
      });
      card.style.position = "absolute";
      card.style.top = `${output.top}px`;
      renderStickyNoteCard(card, {
        app: this.options.app,
        component: this.options.component,
        sourcePath: view.file.path,
        comment,
        onToggle: (c) => this.handleToggle(view.file, c),
        onUpdate: (c, content, title) => this.handleUpdate(view.file, c, content, title),
        onDelete: (c) => this.handleDelete(view.file, c)
      });
      if (settings.stickySide === "right") {
        const line = this.lane.createDiv({ cls: "yh-leader-line" });
        line.style.position = "absolute";
        line.style.left = "0";
        line.style.top = `${output.top + 20}px`;
        line.style.width = "20px";
        line.style.height = "1px";
        line.style.background = `var(--yh-${comment.color})`;
      }
    }
  }
  getAnchorTop(view, comment) {
    const mark = view.containerEl.querySelector(`mark.yh-highlight[data-yh-id="${comment.id}"]`);
    if (mark) {
      const rect = mark.getBoundingClientRect();
      const containerRect = view.containerEl.getBoundingClientRect();
      return rect.top - containerRect.top + view.containerEl.scrollTop;
    }
    try {
      const pos = view.editor.offsetToPos(comment.anchor.startOffset);
      const lineHeight = 20;
      return pos.line * lineHeight;
    } catch {
      return null;
    }
  }
  hide() {
    this.container?.remove();
    this.container = null;
    this.lane = null;
  }
  async handleToggle(file, comment) {
    await this.options.onToggleCollapse(file, { ...comment, collapsed: !comment.collapsed });
    await this.render();
  }
  async handleUpdate(file, comment, content, title) {
    await this.options.onUpdateComment(file, comment, content, title);
    await this.render();
  }
  async handleDelete(file, comment) {
    await this.options.onDeleteAnnotation(file, comment.id);
    await this.render();
  }
  destroy() {
    this.observer?.disconnect();
    this.container?.remove();
    this.container = null;
    this.lane = null;
  }
};

// main.ts
var NOTE_TITLE_OPTIONS = [
  { value: "Insight", label: "\u{1F4A1} \u6D1E\u89C1" },
  { value: "Question", label: "\u2753 \u7591\u95EE" },
  { value: "Reminder", label: "\u{1F514} \u63D0\u9192" }
];
var YH_INKLIGHT_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect x="5" y="5" width="90" height="90" rx="20" ry="20" fill="#F5C518"/>
    <g transform="translate(50,50) rotate(-45) translate(-18,-18)"
      fill="none" stroke="#000" stroke-width="6"
      stroke-linecap="round" stroke-linejoin="round">
      <rect x="8" y="2" width="20" height="28" rx="3" fill="#000" stroke="none"/>
      <polygon points="8,30 28,30 18,42" fill="#000" stroke="none"/>
      <line x1="8" y1="10" x2="28" y2="10" stroke="#F5C518" stroke-width="3"/>
    </g>
  </svg>
`;
var OverlayAnnotationsPlugin = class extends import_obsidian10.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.lastSelection = null;
    this.renameMigrationTimer = null;
  }
  async onload() {
    (0, import_obsidian10.addIcon)("yh-inklight-icon", YH_INKLIGHT_ICON);
    await this.loadSettings();
    this.store = new AnnotationStore(this.app);
    await this.store.initialize();
    this.registerView(ANNOTATION_SIDEBAR_VIEW, (leaf) => new AnnotationSidebarView(leaf, this));
    this.registerEditorExtension([
      createHighlightExtension({
        getDocument: (filePath) => this.store.getCachedDocument(filePath),
        getVersion: () => this.store.version,
        rememberSelection: (filePath, startOffset, endOffset, selectedText) => {
          this.lastSelection = { filePath, startOffset, endOffset, selectedText };
        }
      })
    ]);
    this.toolbar = new SelectionToolbar({
      onHighlight: (color) => this.createHighlight(color),
      onComment: () => this.createComment(),
      onCopy: () => this.copySelection(),
      onOpenSidebar: () => this.activateSidebar()
    });
    this.popover = new AnnotationPopover({ app: this.app, component: this });
    this.pdfLayer = new PdfAnnotationLayer({
      app: this.app,
      component: this,
      getSettings: () => this.settings,
      getDocument: (file) => this.store.getDocument(file),
      getCachedDocument: (filePath) => this.store.getCachedDocument(filePath),
      addHighlight: async (file, highlight) => {
        await this.store.addPdfHighlight(file, highlight);
        await this.refreshAnnotations();
      },
      addComment: async (file, comment) => {
        await this.store.addPdfComment(file, comment);
        await this.refreshAnnotations();
      },
      updateComment: async (file, comment) => {
        await this.store.updatePdfComment(file, comment);
        await this.refreshAnnotations();
      },
      deleteAnnotation: async (file, annotationId) => {
        await this.store.removeAnnotation(file, annotationId);
        await this.refreshAnnotations();
      }
    });
    this.stickyLane = new StickyNoteLane({
      app: this.app,
      component: this,
      getSettings: () => this.settings,
      getCachedDocument: (filePath) => this.store.getCachedDocument(filePath),
      onUpdateComment: async (file, comment, content, title) => {
        await this.store.updateCommentContent(file, comment.id, content, title);
        await this.refreshAnnotations();
      },
      onDeleteAnnotation: async (file, annotationId) => {
        await this.store.removeAnnotation(file, annotationId);
        await this.refreshAnnotations();
      },
      onToggleCollapse: async (file, comment) => {
        await this.store.updateComment(file, comment);
        await this.refreshAnnotations();
      },
      refreshAnnotations: () => this.refreshAnnotations()
    });
    this.addSettingTab(new AnnotationSettingsTab(this));
    this.registerRibbonIcon();
    this.registerCommands();
    this.registerEvents();
    this.pdfLayer.register();
    this.stickyLane.register();
    this.registerMarkdownPostProcessor((element, context) => this.renderReadingHighlights(element, context));
  }
  onunload() {
    if (this.renameMigrationTimer !== null) {
      window.clearTimeout(this.renameMigrationTimer);
    }
    this.toolbar?.destroy();
    this.popover?.destroy();
    this.stickyLane?.destroy();
    this.app.workspace.detachLeavesOfType(ANNOTATION_SIDEBAR_VIEW);
  }
  async loadSettings() {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...await this.loadData() ?? {}
    };
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async refreshAnnotations() {
    this.app.workspace.updateOptions();
    for (const leaf of this.app.workspace.getLeavesOfType(ANNOTATION_SIDEBAR_VIEW)) {
      const view = leaf.view;
      if (view instanceof AnnotationSidebarView) {
        await view.render();
      }
    }
    await this.stickyLane.render();
  }
  registerRibbonIcon() {
    const icon = this.addRibbonIcon("highlighter", "\u6253\u5F00\u58A8\u5149\u6279\u6CE8", () => {
      void this.activateSidebar();
    });
    icon.addClass("yh-ribbon-icon");
  }
  registerCommands() {
    this.addCommand({
      id: "highlight-selection",
      name: "\u9AD8\u4EAE\u9009\u4E2D\u6587\u672C",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "h" }],
      callback: () => this.createHighlight(this.settings.defaultHighlightColor)
    });
    this.addCommand({
      id: "add-sticky-note",
      name: "\u4E3A\u9009\u4E2D\u6587\u672C\u6DFB\u52A0\u4FBF\u7B7E",
      hotkeys: [{ modifiers: ["Mod", "Alt"], key: "m" }],
      callback: () => this.createComment()
    });
    this.addCommand({
      id: "toggle-sticky-notes",
      name: "\u5207\u6362\u6279\u6CE8\u5F39\u5C42\u663E\u793A",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "n" }],
      callback: async () => {
        this.settings.stickyNotesVisible = !this.settings.stickyNotesVisible;
        await this.saveSettings();
        await this.refreshAnnotations();
      }
    });
    this.addCommand({
      id: "open-annotation-sidebar",
      name: "\u6253\u5F00\u6279\u6CE8\u603B\u89C8",
      callback: () => this.activateSidebar()
    });
  }
  registerEvents() {
    this.registerDomEvent(document, "selectionchange", () => this.toolbar.showForSelection());
    this.registerDomEvent(document, "mousedown", (event) => {
      if (!(event.target instanceof HTMLElement) || !event.target.closest(".yh-selection-toolbar")) {
        window.setTimeout(() => this.toolbar.showForSelection(), 0);
      }
    });
    this.registerDomEvent(document, "click", (event) => {
      void this.handleAnnotationClick(event);
    });
    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (!(file instanceof import_obsidian10.TFile) || file.extension !== "md") {
          return;
        }
        const document2 = await this.store.getDocument(file);
        const source = await this.app.vault.cachedRead(file);
        const relocated = relocateDocumentAnchors(source, document2);
        await this.store.saveDocument({
          ...relocated,
          fileHash: await this.store.hashFile(file),
          lastModified: (/* @__PURE__ */ new Date()).toISOString()
        });
        await this.refreshAnnotations();
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (!this.settings.migrateOnRename || !(file instanceof import_obsidian10.TFile) || file.extension !== "md") {
          return;
        }
        if (this.renameMigrationTimer !== null) {
          window.clearTimeout(this.renameMigrationTimer);
        }
        this.renameMigrationTimer = window.setTimeout(async () => {
          await this.store.migrateFilePath(oldPath, file);
          await this.refreshAnnotations();
          this.renameMigrationTimer = null;
        }, 100);
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", async (file) => {
        if (file instanceof import_obsidian10.TFile && ["md", "pdf"].includes(file.extension.toLowerCase())) {
          this.popover.hide();
          await this.store.getDocument(file);
          await this.refreshAnnotations();
        }
      })
    );
  }
  async createHighlight(color) {
    if (this.pdfLayer.isPdfActive()) {
      await this.pdfLayer.createHighlight(color);
      this.toolbar.hide();
      return;
    }
    const snapshot = await this.resolveSelection();
    if (!snapshot) {
      new import_obsidian10.Notice("\u8BF7\u5148\u9009\u4E2D\u6587\u672C\u3002");
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(snapshot.filePath);
    if (!(file instanceof import_obsidian10.TFile)) {
      return;
    }
    const highlight = {
      id: crypto.randomUUID(),
      color,
      anchor: createAnchorForSnapshot(await this.app.vault.cachedRead(file), snapshot),
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.store.addHighlight(file, highlight);
    await this.refreshActiveReadingViewHighlights(file.path);
    await this.refreshAnnotations();
    this.toolbar.hide();
  }
  async createComment() {
    if (this.pdfLayer.isPdfActive()) {
      const note2 = await new CommentModal(this.app, "", "").openAndRead();
      if (note2 !== null) {
        await this.pdfLayer.createComment(
          this.settings.defaultHighlightColor,
          note2.content,
          this.settings.defaultAuthor,
          note2.title
        );
      }
      this.toolbar.hide();
      return;
    }
    const snapshot = await this.resolveSelection();
    if (!snapshot) {
      new import_obsidian10.Notice("\u8BF7\u5148\u9009\u4E2D\u6587\u672C\u3002");
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(snapshot.filePath);
    if (!(file instanceof import_obsidian10.TFile)) {
      return;
    }
    const note = await new CommentModal(this.app, "", "").openAndRead();
    if (note === null) {
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const comment = {
      id: crypto.randomUUID(),
      anchor: createAnchorForSnapshot(await this.app.vault.cachedRead(file), snapshot),
      title: note.title,
      content: note.content,
      color: this.settings.defaultHighlightColor,
      position: { offsetX: 20, offsetY: 0 },
      collapsed: false,
      author: this.settings.defaultAuthor,
      createdAt: now,
      updatedAt: now,
      replies: [],
      resolved: false
    };
    await this.store.addComment(file, comment);
    await this.refreshActiveReadingViewHighlights(file.path);
    await this.refreshAnnotations();
    this.toolbar.hide();
  }
  async refreshActiveReadingViewHighlights(filePath) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof import_obsidian10.TFile)) {
      return;
    }
    const document2 = this.store.getCachedDocument(filePath) ?? await this.store.getDocument(file);
    const marks = [...document2.highlights, ...document2.comments].filter((item) => !item.orphaned);
    if (!marks.length) {
      return;
    }
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof import_obsidian10.MarkdownView) || view.file?.path !== filePath) {
        continue;
      }
      const previewRoot = findPreviewRoot(view);
      if (previewRoot) {
        refreshReadingViewHighlights(previewRoot, marks);
        continue;
      }
      const previewMode = view.previewMode;
      if (previewMode?.rerender) {
        await previewMode.rerender(true);
        const rerenderedRoot = findPreviewRoot(view);
        if (rerenderedRoot) {
          refreshReadingViewHighlights(rerenderedRoot, marks);
        }
      }
    }
  }
  async resolveSelection() {
    const editor = this.activeEditor();
    if (editor?.file) {
      const selectedText2 = editor.editor.getSelection();
      if (selectedText2) {
        const from = editor.editor.posToOffset(editor.editor.getCursor("from"));
        const to = editor.editor.posToOffset(editor.editor.getCursor("to"));
        this.lastSelection = { filePath: editor.file.path, startOffset: from, endOffset: to, selectedText: selectedText2 };
        return this.lastSelection;
      }
    }
    const file = this.app.workspace.getActiveFile();
    const selection = window.getSelection();
    const selectedText = selection?.toString().replace(/\r\n/g, "\n").trim() ?? "";
    if (file && selectedText) {
      const source = await this.app.vault.cachedRead(file);
      const located = locateRenderedSelectionInSource(
        source,
        selectedText,
        selection ? renderedOccurrenceBeforeSelection(selection, selectedText) : 0,
        selection ? isSelectionInsideCallout(selection) : false
      );
      if (located) {
        this.lastSelection = {
          filePath: file.path,
          startOffset: located.startOffset,
          endOffset: located.endOffset,
          selectedText
        };
        return this.lastSelection;
      }
    }
    return this.lastSelection;
  }
  activeEditor() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian10.MarkdownView);
    return view ? { editor: view.editor, file: view.file } : null;
  }
  async activateSidebar() {
    let leaf = this.app.workspace.getLeavesOfType(ANNOTATION_SIDEBAR_VIEW)[0];
    if (!leaf) {
      const nextLeaf = this.app.workspace.getRightLeaf(false);
      if (!nextLeaf) {
        return;
      }
      leaf = nextLeaf;
      await leaf.setViewState({ type: ANNOTATION_SIDEBAR_VIEW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }
  copySelection() {
    const text = window.getSelection()?.toString() || this.activeEditor()?.editor.getSelection() || "";
    if (text) {
      navigator.clipboard.writeText(text);
      new import_obsidian10.Notice("Copied selection");
    }
  }
  async handleAnnotationClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      this.popover.hide();
      return;
    }
    const mark = target.closest(".yh-highlight, .yh-reading-highlight");
    if (!mark) {
      if (!target.closest(".yh-annotation-popover")) {
        this.popover.hide();
      }
      return;
    }
    const annotationId = mark.dataset.yhId;
    const file = this.app.workspace.getActiveFile();
    if (!annotationId || !(file instanceof import_obsidian10.TFile)) {
      return;
    }
    const document2 = this.store.getCachedDocument(file.path) ?? await this.store.getDocument(file);
    const primary = document2.comments.find((comment) => comment.id === annotationId) ?? document2.highlights.find((highlight) => highlight.id === annotationId);
    if (!primary) {
      unwrapStaleHighlight(mark);
      return;
    }
    const sameAnchorComments = document2.comments.filter((comment) => {
      return comment.id !== primary.id && !comment.orphaned && comment.anchor.startOffset === primary.anchor.startOffset && comment.anchor.endOffset === primary.anchor.endOffset;
    });
    const items = [primary, ...sameAnchorComments].map((annotation) => AnnotationPopover.itemFromAnnotation(annotation));
    event.preventDefault();
    event.stopPropagation();
    this.popover.show({
      rect: mark.getBoundingClientRect(),
      sourcePath: file.path,
      items
    });
  }
  async renderReadingHighlights(element, context) {
    if (!context.sourcePath) {
      return;
    }
    await sleep(100);
    const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
    if (!(file instanceof import_obsidian10.TFile)) {
      return;
    }
    const document2 = await this.store.getDocument(file);
    const marks = [...document2.highlights, ...document2.comments].filter((item) => !item.orphaned);
    installReadingViewHighlights({ root: element, context, marks });
  }
};
function locateRenderedSelectionInSource(source, selectedText, occurrenceIndex = 0, preferRendered = false) {
  const exact = nthIndexOf(source, selectedText, occurrenceIndex);
  if (exact >= 0) {
    return {
      startOffset: exact,
      endOffset: exact + selectedText.length
    };
  }
  if (preferRendered) {
    const rendered = locateSelectionIgnoringQuoteMarkers(source, selectedText, occurrenceIndex);
    if (rendered) {
      return rendered;
    }
  }
  return locateSelectionIgnoringQuoteMarkers(source, selectedText, occurrenceIndex);
}
function createAnchorForSnapshot(source, snapshot) {
  const anchor = createTextAnchor(source, snapshot.startOffset, snapshot.endOffset);
  const selectedText = snapshot.selectedText.replace(/\r\n/g, "\n").trim();
  const sourceText = anchor.selectedText.replace(/\r\n/g, "\n").trim();
  if (!selectedText || selectedText === sourceText) {
    return anchor;
  }
  return {
    ...anchor,
    selectedText
  };
}
function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
function findPreviewRoot(view) {
  const previewMode = view.previewMode;
  return view.containerEl.querySelector(".markdown-preview-view") ?? view.containerEl.querySelector(".markdown-preview-section") ?? view.containerEl.querySelector(".mod-preview") ?? previewMode?.containerEl?.querySelector(".markdown-preview-section") ?? previewMode?.containerEl ?? null;
}
function unwrapStaleHighlight(mark) {
  const parent = mark.parentNode;
  if (!parent) {
    mark.remove();
    return;
  }
  while (mark.firstChild) {
    parent.insertBefore(mark.firstChild, mark);
  }
  parent.removeChild(mark);
  parent.normalize();
}
function locateSelectionIgnoringQuoteMarkers(source, selectedText, occurrenceIndex = 0) {
  const normalizedSelection = selectedText.replace(/\r\n/g, "\n");
  const sourceToRendered = [];
  let rendered = "";
  let lineStart = true;
  let quotePrefix = false;
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (lineStart && char === ">") {
      quotePrefix = true;
      lineStart = false;
      index += 1;
      continue;
    }
    if (quotePrefix && char === " ") {
      quotePrefix = false;
      index += 1;
      continue;
    }
    if (!quotePrefix && char === "[" && source.slice(index).match(/^\[![\w-]+\]/)) {
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      quotePrefix = false;
      continue;
    }
    quotePrefix = false;
    rendered += char;
    sourceToRendered.push(index);
    lineStart = char === "\n";
    index += 1;
  }
  const renderedStart = nthIndexOf(rendered, normalizedSelection, occurrenceIndex);
  if (renderedStart < 0) {
    return null;
  }
  const renderedEnd = renderedStart + normalizedSelection.length - 1;
  return {
    startOffset: sourceToRendered[renderedStart],
    endOffset: sourceToRendered[renderedEnd] + 1
  };
}
function renderedOccurrenceBeforeSelection(selection, selectedText) {
  if (!selection.rangeCount || !selectedText) {
    return 0;
  }
  const range = selection.getRangeAt(0);
  const root = selectionRoot(range);
  if (!root) {
    return 0;
  }
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const beforeText = before.toString().replace(/\r\n/g, "\n");
  before.detach();
  return countOccurrences(beforeText, selectedText);
}
function selectionRoot(range) {
  const container = range.commonAncestorContainer instanceof HTMLElement ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  return container?.closest(".markdown-preview-view") ?? container?.closest(".markdown-preview-section") ?? container?.closest(".mod-preview") ?? null;
}
function isSelectionInsideCallout(selection) {
  if (!selection.rangeCount) {
    return false;
  }
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer instanceof HTMLElement ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  return Boolean(container?.closest(".callout, .callout-content"));
}
function countOccurrences(source, target) {
  if (!target) {
    return 0;
  }
  let count = 0;
  let cursor = source.indexOf(target);
  while (cursor >= 0) {
    count += 1;
    cursor = source.indexOf(target, cursor + target.length);
  }
  return count;
}
function nthIndexOf(source, target, occurrenceIndex) {
  if (!target) {
    return -1;
  }
  let cursor = source.indexOf(target);
  let seen = 0;
  while (cursor >= 0) {
    if (seen >= occurrenceIndex) {
      return cursor;
    }
    seen += 1;
    cursor = source.indexOf(target, cursor + target.length);
  }
  return -1;
}
var CommentModal = class extends import_obsidian10.Modal {
  constructor(app, initialTitle, initialContent) {
    super(app);
    this.initialTitle = initialTitle;
    this.initialContent = initialContent;
    this.value = null;
  }
  openAndRead() {
    this.open();
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }
  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "\u4FBF\u7B7E" });
    const titleRow = this.contentEl.createDiv({ cls: "yh-modal-row" });
    titleRow.createEl("label", { cls: "yh-modal-label", text: "\u7C7B\u578B" });
    const title = titleRow.createEl("select", { cls: "yh-modal-select" });
    for (const option of NOTE_TITLE_OPTIONS) {
      title.createEl("option", { text: option.label, attr: { value: option.value } });
    }
    title.value = normalizedNoteTitle(this.initialTitle);
    const contentRow = this.contentEl.createDiv({ cls: "yh-modal-row" });
    contentRow.createEl("label", { cls: "yh-modal-label", text: "\u7B14\u8BB0" });
    const input = contentRow.createEl("textarea", {
      cls: "yh-modal-textarea",
      attr: { rows: "8", placeholder: "\u5199\u4E0B\u4F60\u7684\u60F3\u6CD5..." }
    });
    input.value = this.initialContent;
    const actions = this.contentEl.createDiv({ cls: "yh-modal-actions" });
    const cancel = actions.createEl("button", { text: "\u53D6\u6D88", cls: "yh-modal-cancel", attr: { type: "button" } });
    const save = actions.createEl("button", { text: "\u4FDD\u5B58", cls: "yh-modal-save", attr: { type: "button" } });
    cancel.addEventListener("click", () => {
      this.value = null;
      this.close();
    });
    save.addEventListener("click", () => {
      this.value = {
        title: title.value.trim(),
        content: input.value.trim()
      };
      this.close();
    });
  }
  onClose() {
    this.resolve?.(this.value);
  }
};
function normalizedNoteTitle(value) {
  return NOTE_TITLE_OPTIONS.some((option) => option.value === value) ? value : NOTE_TITLE_OPTIONS[0].value;
}
