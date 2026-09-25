import assert from "node:assert/strict";
import test from "node:test";

import { renderReadingNoteProjection, replaceManagedSection, MANAGED_START, MANAGED_END } from "../src/readingNotes/readingNoteProjection";
import { cloneDefaultAnnotationTags } from "../src/tags/tagDomain";
import type { EpubCommentAnnotation, EpubHighlightAnnotation, FileAnnotationDocument, PdfCommentAnnotation, PdfHighlightAnnotation } from "../src/storage/types";

const time = "2026-09-25T08:00:00.000Z";

function document(path: string, fields: Partial<FileAnnotationDocument> = {}): FileAnnotationDocument {
  return {
    filePath: path, fileHash: "hash", lastModified: time,
    highlights: [], comments: [], pdfHighlights: [], pdfComments: [],
    epubHighlights: [], epubComments: [], bookmarks: [], canvasNodes: [], ...fields,
  };
}

function pdfHighlight(id: string, page: number, text: string): PdfHighlightAnnotation {
  return { id, color: "yellow", anchor: { pageNumber: page, selectedText: text, rects: [] }, createdAt: time };
}

function pdfComment(id: string, page: number, text: string, content: string): PdfCommentAnnotation {
  return {
    id, color: "yellow", anchor: { pageNumber: page, selectedText: text, rects: [] },
    content, tagId: "insight", position: { offsetX: 0, offsetY: 0 }, collapsed: false,
    author: "读者", createdAt: time, updatedAt: time, replies: [], resolved: false,
  };
}

function epubHighlight(id: string, chapter: string, cfi: string): EpubHighlightAnnotation {
  return {
    id, type: "epub-highlight", color: "blue", style: "fill",
    anchor: { chapter, cfiRange: cfi, selectedText: id }, createdAt: time,
  };
}

function epubComment(id: string, chapter: string, cfi: string): EpubCommentAnnotation {
  return {
    id, type: "epub-comment", color: "blue", style: "fill",
    anchor: { chapter, cfiRange: cfi, selectedText: id }, note: "我的评论", tagId: "question",
    createdAt: time, updatedAt: time, collapsed: false, author: "读者", replies: [], resolved: false,
  };
}

test("PDF projection groups pages and merges same-anchor notes without duplicate blocks", () => {
  const note = pdfComment("c2", 2, "第二页", "重要评论");
  const source = document("资料/书.pdf", {
    pdfHighlights: [pdfHighlight("h9", 9, "第九页"), pdfHighlight("h2", 2, "第二页")],
    pdfComments: [note, pdfComment("solo", 3, "孤立评论", "单独保留")],
  });
  const rendered = renderReadingNoteProjection(source, cloneDefaultAnnotationTags());
  assert.ok(rendered.indexOf("### 第 2 页") < rendered.indexOf("### 第 3 页"));
  assert.ok(rendered.indexOf("### 第 3 页") < rendered.indexOf("### 第 9 页"));
  assert.match(rendered, /\^pdf-h2/);
  assert.doesNotMatch(rendered, /\^pdf-c2/);
  assert.match(rendered, /\^pdf-solo/);
  assert.match(rendered, /批注：重要评论/);
  assert.match(rendered, /标签：洞见/);
  assert.match(rendered, /obsidian:\/\/inklight\?file=/);
  assert.equal(rendered, renderReadingNoteProjection(source, cloneDefaultAnnotationTags()));
});

test("EPUB projection keeps first-seen chapter order and CFI-based pairing", () => {
  const source = document("资料/书.epub", {
    epubHighlights: [epubHighlight("b", "第二章", "epubcfi(/6/4)"), epubHighlight("a", "第一章", "epubcfi(/6/2)")],
    epubComments: [epubComment("comment", "第一章", "epubcfi(/6/2)")],
  });
  const rendered = renderReadingNoteProjection(source, cloneDefaultAnnotationTags());
  assert.ok(rendered.indexOf("### 第一章") < rendered.indexOf("### 第二章"));
  assert.match(rendered, /\^epub-a/);
  assert.doesNotMatch(rendered, /\^epub-comment/);
  assert.match(rendered, /批注：我的评论/);
});

test("managed replacement preserves every byte of handwritten areas and rejects bad markers", () => {
  const note = `---\ntype: inklight-reading-note\n---\n## 我的笔记\n中文 **手写**\n${MANAGED_START}\n旧投影\n${MANAGED_END}\n\n手写尾部`;
  const updated = replaceManagedSection(note, "### 第 2 页\n内容");
  assert.ok(updated.startsWith(`---\ntype: inklight-reading-note\n---\n## 我的笔记\n中文 **手写**\n${MANAGED_START}`));
  assert.ok(updated.endsWith(`${MANAGED_END}\n\n手写尾部`));
  assert.equal(replaceManagedSection(updated, "### 第 2 页\n内容"), updated);
  for (const broken of ["no markers", `${MANAGED_END}\n${MANAGED_START}`, `${MANAGED_START}\n${MANAGED_START}\n${MANAGED_END}`]) {
    assert.throws(() => replaceManagedSection(broken, "new"));
  }
});
