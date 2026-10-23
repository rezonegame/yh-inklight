/**
 * [INPUT]: 依赖 Reading View 渲染 DOM、TextAnchor 数据与 fuzzyMatch 的容错定位能力
 * [OUTPUT]: 对外提供 installReadingViewHighlights，在非 CodeMirror 阅读模式中注入视觉高亮
 * [POS]: editor 阅读投影层；单次文本索引、共享模糊预算及观察器暂停防止重复重绘
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { MarkdownPostProcessorContext, MarkdownRenderChild, Platform } from "obsidian";

import { findBestFuzzyMatch, FuzzyMatchBudget } from "../anchor/fuzzyMatch";
import { AnnotationColor, CommentAnnotation, HighlightAnnotation, TextAnchor } from "../storage/types";
import { highlightBackground } from "./highlightColors";

export type ReadingMark = Pick<HighlightAnnotation | CommentAnnotation, "id" | "color" | "anchor" | "orphaned">;

interface InstallReadingHighlightsOptions {
  root: HTMLElement;
  context: MarkdownPostProcessorContext;
  marks: ReadingMark[];
  getMarks?: () => ReadingMark[];
}

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

interface RenderedRange {
  start: number;
  end: number;
}

interface NormalizedIndex {
  text: string;
  map: number[];
}

const MARK_SELECTOR = ".yh-reading-highlight, mark.yh-highlight";
const MOBILE_RENDER_DELAYS = [0, 80, 220, 520, 900];
const DESKTOP_RENDER_DELAYS = [0, 40, 160];
const projections = new Set<{ root: HTMLElement; pause: () => void; resume: () => void }>();

export function installReadingViewHighlights(options: InstallReadingHighlightsOptions): void {
  const component = new MarkdownRenderChild(options.root);
  let frame: number | null = null;
  let disposed = false;
  let dirty = true;

  const render = (): void => {
    if (disposed || !dirty) {
      return;
    }

    if (frame !== null) {
      cancelAnimationFrame(frame);
    }

    frame = requestAnimationFrame(() => {
      frame = null;
      if (disposed || !dirty) return;
      dirty = false;
      refreshReadingViewHighlights(options.root, options.getMarks?.() ?? options.marks);
    });
  };

  const delays = Platform.isMobile ? MOBILE_RENDER_DELAYS : DESKTOP_RENDER_DELAYS;
  for (const delay of delays) {
    const timer = window.setTimeout(render, delay);
    component.register(() => window.clearTimeout(timer));
  }

  const observer = new MutationObserver((mutations) => {
    if (!mutations.length) return;
    dirty = true;
    render();
  });
  const projection = {
    root: options.root,
    pause: () => observer.disconnect(),
    resume: () => {
      if (disposed) return;
      dirty = false;
      observer.observe(options.root, { childList: true, subtree: true, characterData: true });
    },
  };
  projection.resume();
  dirty = true;
  projections.add(projection);

  component.register(() => {
    disposed = true;
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }
    observer.disconnect();
    projections.delete(projection);
  });
  options.context.addChild(component);
}

export function refreshReadingViewHighlights(root: HTMLElement, marks: ReadingMark[]): void {
  const callouts = calloutRoots(root);
  const roots = [root, ...callouts];
  const paused = [...projections].filter((item) => roots.some((target) => target.contains(item.root) || item.root.contains(target)));
  for (const item of paused) item.pause();
  try {
    unwrapReadingHighlights(root);
    const budget: FuzzyMatchBudget = { comparisons: 256, cells: 250_000 };
    const rendered = renderReadingHighlights(root, marks, budget);
    for (const callout of callouts) {
      const remaining = marks.filter(mark => !rendered.has(mark.id));
      if (remaining.length) for (const id of renderReadingHighlights(callout, remaining, budget)) rendered.add(id);
    }
  } finally {
    for (const item of paused) item.resume();
  }
}

function renderReadingHighlights(root: HTMLElement, marks: ReadingMark[], budget: FuzzyMatchBudget): Set<string> {
  const liveMarks = marks
    .filter((mark) => !mark.orphaned && mark.anchor.selectedText.trim())
    .sort((left, right) => right.anchor.selectedText.length - left.anchor.selectedText.length);

  const rendered = new Set(Array.from(root.querySelectorAll<HTMLElement>(MARK_SELECTOR)).map(element => element.dataset.yhId!));
  if (!liveMarks.length) return rendered;
  const snapshot = collectText(root);
  const normalized = { value: undefined as NormalizedIndex | undefined };
  const planned: Array<{ range: RenderedRange; mark: ReadingMark }> = [];
  for (const mark of liveMarks) {
    if (rendered.has(mark.id)) {
      continue;
    }

    const range = locateRenderedRange(snapshot.text, mark.anchor, normalized, budget);
    if (range && !planned.some(item => item.range.start < range.end && item.range.end > range.start)) {
      planned.push({ range, mark });
    }
  }
  // Right-to-left wrapping preserves the original text-node offsets after splitting.
  for (const { range, mark } of planned.sort((a, b) => b.range.start - a.range.start)) {
    wrapRange(snapshot.segments, range, mark.color, mark.id);
    rendered.add(mark.id);
  }
  return rendered;
}

function calloutRoots(root: HTMLElement): HTMLElement[] {
  const roots = new Set<HTMLElement>();

  if (root.matches(".callout")) {
    roots.add(root);
  }

  const parentCallout = root.closest<HTMLElement>(".callout");
  if (parentCallout) {
    roots.add(parentCallout);
  }

  for (const callout of Array.from(root.querySelectorAll<HTMLElement>(".callout"))) {
    roots.add(callout);
  }

  return Array.from(roots);
}

function unwrapReadingHighlights(root: HTMLElement): void {
  const parents = new Set<Node>();
  for (const mark of Array.from(root.querySelectorAll<HTMLElement>(MARK_SELECTOR))) {
    const parent = mark.parentNode;
    if (!parent) {
      continue;
    }

    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parents.add(parent);
  }
  for (const parent of parents) parent.normalize();
}

function locateRenderedRange(renderedText: string, anchor: TextAnchor, normalized: { value?: NormalizedIndex }, budget: FuzzyMatchBudget): RenderedRange | null {
  if (!renderedText.trim()) return null;
  const exact = locateBestTextRange(renderedText, anchor);
  if (exact) {
    return exact;
  }

  normalized.value ??= normalizeWithMap(renderedText);
  const normalizedRange = locateNormalizedRange(renderedText, anchor, normalized.value);
  if (normalizedRange) {
    return normalizedRange;
  }

  const fuzzy = findBestFuzzyMatch(
    renderedText,
    anchor.selectedText,
    0,
    budget,
  );
  if (!fuzzy || fuzzy.confidence < 0.55) {
    return null;
  }

  return {
    start: fuzzy.startOffset,
    end: fuzzy.endOffset,
  };
}

function locateBestTextRange(renderedText: string, anchor: TextAnchor): RenderedRange | null {
  if (!anchor.selectedText) {
    return null;
  }

  let cursor = renderedText.indexOf(anchor.selectedText);
  let best: { range: RenderedRange; score: number } | null = null;

  while (cursor >= 0) {
    const range = {
      start: cursor,
      end: cursor + anchor.selectedText.length,
    };
    const score = rangeScore(renderedText, anchor, range);
    if (!best || score > best.score) {
      best = { range, score };
    }
    cursor = renderedText.indexOf(anchor.selectedText, cursor + 1);
  }

  return best?.range ?? null;
}

function locateNormalizedRange(renderedText: string, anchor: TextAnchor, rendered: NormalizedIndex): RenderedRange | null {
  const selected = normalizeWithMap(anchor.selectedText);
  if (!rendered.text || !selected.text) {
    return null;
  }

  let normalizedStart = rendered.text.indexOf(selected.text);
  let best: { range: RenderedRange; score: number } | null = null;

  while (normalizedStart >= 0) {
    const normalizedEnd = normalizedStart + selected.text.length - 1;
    const start = rendered.map[normalizedStart];
    const end = rendered.map[normalizedEnd] + 1;
    if (start !== undefined && end !== undefined && start < end) {
      const range = { start, end };
      const score = rangeScore(renderedText, anchor, range);
      if (!best || score > best.score) {
        best = { range, score };
      }
    }
    normalizedStart = rendered.text.indexOf(selected.text, normalizedStart + 1);
  }

  return best?.range ?? null;
}

function rangeScore(renderedText: string, anchor: TextAnchor, range: RenderedRange): number {
  const before = renderedText.slice(Math.max(0, range.start - anchor.prefix.length), range.start);
  const after = renderedText.slice(range.end, Math.min(renderedText.length, range.end + anchor.suffix.length));
  const context = prefixScore(anchor.prefix, before) * 0.45 + suffixScore(anchor.suffix, after) * 0.45;
  const distance = 1 - Math.min(1, Math.abs(range.start - anchor.startOffset) / Math.max(renderedText.length, 1));
  return context + distance * 0.1;
}

function prefixScore(expected: string, actual: string): number {
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

function suffixScore(expected: string, actual: string): number {
  if (!expected && !actual) {
    return 1;
  }
  if (!expected || !actual) {
    return 0;
  }
  if (actual.startsWith(expected) || expected.startsWith(actual)) {
    return 1;
  }

  let shared = 0;
  const max = Math.min(expected.length, actual.length);
  for (let index = 1; index <= max; index += 1) {
    if (expected.slice(0, index) === actual.slice(0, index)) {
      shared = index;
    }
  }
  return shared / Math.max(expected.length, actual.length);
}

function normalizeWithMap(value: string): NormalizedIndex {
  let text = "";
  const map: number[] = [];
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

function collectText(root: HTMLElement): { text: string; segments: TextSegment[] } {
  const segments: TextSegment[] = [];
  let text = "";
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
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

      if (!node.textContent) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node = walker.nextNode() as Text | null;
  while (node) {
    const start = text.length;
    text += node.textContent ?? "";
    segments.push({ node, start, end: text.length });
    node = walker.nextNode() as Text | null;
  }

  return { text, segments };
}

function wrapRange(segments: TextSegment[], range: RenderedRange, color: AnnotationColor, id: string): boolean {
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
    const mark = selected.ownerDocument.createElement("mark");
    mark.className = `yh-reading-highlight yh-highlight yh-highlight--${color}`;
    mark.dataset.yhColor = color;
    mark.dataset.yhId = id;
    mark.style.setProperty("background-color", highlightBackground(color), "important");
    mark.tabIndex = 0;
    selected.parentNode?.insertBefore(mark, selected);
    mark.appendChild(selected);
  }

  return true;
}

function splitTextRange(node: Text, start: number, end: number): Text {
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
