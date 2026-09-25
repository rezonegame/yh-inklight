/**
 * [INPUT]: PDF/EPUB sidecar 文档与当前语义标签定义
 * [OUTPUT]: 稳定的阅读笔记批注投影及仅替换受管区的纯逻辑函数
 * [POS]: readingNotes 纯逻辑层，不读取或写入 Vault
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { createAnnotationUri } from "../links/annotationLink";
import { resolveAnnotationTag } from "../tags/tagDomain";
import type { AnnotationTagDefinition } from "../tags/tagDomain";
import type {
  AnnotationColor, EpubCommentAnnotation, EpubHighlightAnnotation, FileAnnotationDocument,
  PdfCommentAnnotation, PdfHighlightAnnotation,
} from "../storage/types";

export const MANAGED_START = "<!-- yh-inklight:managed:start -->";
export const MANAGED_END = "<!-- yh-inklight:managed:end -->";

type ReadingComment = PdfCommentAnnotation | EpubCommentAnnotation;
type ReadingHighlight = PdfHighlightAnnotation | EpubHighlightAnnotation;

interface ProjectionEntry {
  mode: "pdf" | "epub";
  id: string;
  page?: number;
  chapter?: string;
  color: AnnotationColor;
  text: string;
  content: string;
  tag?: string;
  createdAt: string;
  updatedAt?: string;
}

function createEntry(
  mode: "pdf" | "epub",
  highlight: ReadingHighlight | null,
  comment: ReadingComment | null,
  tags: AnnotationTagDefinition[],
): ProjectionEntry {
  const anchor = (highlight ?? comment)!.anchor;
  const page = "pageNumber" in anchor ? anchor.pageNumber : undefined;
  const chapter = "chapter" in anchor ? anchor.chapter : undefined;
  return {
    mode,
    id: (highlight ?? comment)!.id,
    page,
    chapter,
    color: (highlight ?? comment)!.color,
    text: anchor.selectedText,
    content: comment ? ("note" in comment ? comment.note : comment.content) : "",
    tag: comment ? resolveAnnotationTag(tags, comment)?.name : undefined,
    createdAt: (highlight ?? comment)!.createdAt,
    updatedAt: comment?.updatedAt,
  };
}

function matchPdf(highlight: PdfHighlightAnnotation, comment: PdfCommentAnnotation): boolean {
  return comment.highlightId === highlight.id || (
    !comment.highlightId
    && highlight.anchor.pageNumber === comment.anchor.pageNumber
    && Boolean(highlight.anchor.selectedText.trim())
    && highlight.anchor.selectedText.trim() === comment.anchor.selectedText.trim()
  );
}

function matchEpub(highlight: EpubHighlightAnnotation, comment: EpubCommentAnnotation): boolean {
  return highlight.anchor.cfiRange === comment.anchor.cfiRange && Boolean(highlight.anchor.cfiRange);
}

function collectEntries(document: FileAnnotationDocument, tags: AnnotationTagDefinition[]): ProjectionEntry[] {
  const result: ProjectionEntry[] = [];
  const pdfComments = [...document.pdfComments].sort(compareAnnotations);
  const epubComments = [...document.epubComments].sort(compareAnnotations);
  const usedPdf = new Set<string>();
  const usedEpub = new Set<string>();

  for (const highlight of document.pdfHighlights) {
    const comment = pdfComments.find((candidate) => !usedPdf.has(candidate.id) && matchPdf(highlight, candidate)) ?? null;
    if (comment) usedPdf.add(comment.id);
    result.push(createEntry("pdf", highlight, comment, tags));
  }
  for (const comment of pdfComments) {
    if (!usedPdf.has(comment.id)) result.push(createEntry("pdf", null, comment, tags));
  }
  for (const highlight of document.epubHighlights) {
    const comment = epubComments.find((candidate) => !usedEpub.has(candidate.id) && matchEpub(highlight, candidate)) ?? null;
    if (comment) usedEpub.add(comment.id);
    result.push(createEntry("epub", highlight, comment, tags));
  }
  for (const comment of epubComments) {
    if (!usedEpub.has(comment.id)) result.push(createEntry("epub", null, comment, tags));
  }
  return result;
}

function compareAnnotations(left: { createdAt: string; id: string }, right: { createdAt: string; id: string }): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function compareEntries(left: ProjectionEntry, right: ProjectionEntry): number {
  return compareAnnotations(left, right);
}

function blockLines(entry: ProjectionEntry, sourcePath: string): string[] {
  const location = entry.mode === "pdf" ? `第 ${entry.page ?? "?"} 页` : entry.chapter?.trim() || "电子书";
  const lines = [
    `> [!inklight-${entry.mode}|${entry.color}] ${location} ^${entry.mode}-${entry.id}`,
    ...entry.text.split(/\r?\n/).map((line) => `> ${line}`),
  ];
  if (entry.tag) lines.push(`> 标签：${entry.tag}`);
  if (entry.content.trim()) lines.push(...entry.content.split(/\r?\n/).map((line) => `> 批注：${line}`));
  lines.push(`> 创建：${entry.createdAt}`);
  if (entry.updatedAt) lines.push(`> 更新：${entry.updatedAt}`);
  lines.push(`> [返回原文](${createAnnotationUri(sourcePath, entry.id)})`);
  return lines;
}

export function renderReadingNoteProjection(document: FileAnnotationDocument, tags: AnnotationTagDefinition[]): string {
  const mode = document.filePath.toLowerCase().endsWith(".pdf") ? "pdf" : "epub";
  const entries = collectEntries(document, tags).filter((entry) => entry.mode === mode).sort(compareEntries);
  const groups = new Map<string, ProjectionEntry[]>();
  for (const entry of entries) {
    const group = entry.mode === "pdf" ? `pdf:${entry.page ?? 0}` : `epub:${entry.chapter?.trim() || "未定位章节"}`;
    const items = groups.get(group) ?? [];
    items.push(entry);
    groups.set(group, items);
  }
  const keys = [...groups.keys()];
  if (entries.every((entry) => entry.mode === "pdf")) {
    keys.sort((left, right) => Number(left.slice(4)) - Number(right.slice(4)));
  }
  return keys.flatMap((key) => {
    const items = groups.get(key)!;
    const heading = key.startsWith("pdf:") ? `### 第 ${key.slice(4)} 页` : `### ${key.slice(5)}`;
    return [heading, "", ...items.flatMap((entry) => [...blockLines(entry, document.filePath), ""])];
  }).join("\n").trimEnd();
}

export function replaceManagedSection(note: string, projection: string): string {
  const start = note.indexOf(MANAGED_START);
  const end = note.indexOf(MANAGED_END);
  if (start < 0 || end < 0 || start >= end
    || note.indexOf(MANAGED_START, start + MANAGED_START.length) >= 0
    || note.indexOf(MANAGED_END, end + MANAGED_END.length) >= 0) {
    throw new Error("阅读笔记受管标记缺失或重复，已停止同步以保护手写内容");
  }
  const before = note.slice(0, start + MANAGED_START.length);
  const after = note.slice(end);
  return `${before}\n${projection ? `${projection}\n` : ""}${after}`;
}
