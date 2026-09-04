import assert from "node:assert/strict";
import test from "node:test";

import { mergeAnnotationDocuments } from "../src/storage/documentMerge";
import { FileAnnotationDocument } from "../src/storage/types";

function document(overrides: Partial<FileAnnotationDocument> = {}): FileAnnotationDocument {
  return {
    filePath: "books/example.epub",
    fileHash: "hash",
    lastModified: "2026-09-04T08:00:00.000Z",
    highlights: [],
    comments: [],
    pdfHighlights: [],
    pdfComments: [],
    epubHighlights: [],
    epubComments: [],
    bookmarks: [],
    canvasNodes: [],
    ...overrides,
  };
}

function epubHighlight(id: string, text: string) {
  return {
    id,
    type: "epub-highlight" as const,
    color: "yellow" as const,
    style: "fill" as const,
    anchor: { cfiRange: `epubcfi(/${id})`, chapter: "第一章", selectedText: text },
    createdAt: "2026-09-04T08:00:00.000Z",
  };
}

function epubProgress(lastRead: string, percent: number) {
  return {
    cfi: "epubcfi(/6/2)",
    chapter: "第一章",
    percent,
    lastRead,
    readingTimeSeconds: 10,
  };
}

test("preserves records added to disk by another device", () => {
  const base = document({ epubHighlights: [epubHighlight("local", "旧内容")] });
  const intended = document({ epubHighlights: [epubHighlight("local", "旧内容"), epubHighlight("new", "本地新增")] });
  const disk = document({ epubHighlights: [epubHighlight("local", "旧内容"), epubHighlight("remote", "另一设备新增")] });

  const merged = mergeAnnotationDocuments(base, intended, disk);

  assert.deepEqual(merged.epubHighlights.map((item) => item.id), ["local", "new", "remote"]);
});

test("applies a local deletion only to the deleted stable ID", () => {
  const base = document({ epubHighlights: [epubHighlight("remove", "删除"), epubHighlight("keep", "保留")] });
  const intended = document({ epubHighlights: [epubHighlight("keep", "保留")] });
  const disk = document({ epubHighlights: [epubHighlight("remove", "删除"), epubHighlight("keep", "保留"), epubHighlight("remote", "远端")] });

  const merged = mergeAnnotationDocuments(base, intended, disk);

  assert.deepEqual(merged.epubHighlights.map((item) => item.id), ["keep", "remote"]);
});

test("keeps the most recent progress when local and disk progress differ", () => {
  const base = document({ epubProgress: epubProgress("2026-09-04T08:00:00.000Z", 0.1) });
  const intended = document({ epubProgress: epubProgress("2026-09-04T08:05:00.000Z", 0.2) });
  const disk = document({ epubProgress: epubProgress("2026-09-04T08:10:00.000Z", 0.3) });

  const merged = mergeAnnotationDocuments(base, intended, disk);

  assert.equal(merged.epubProgress?.percent, 0.3);
  assert.equal(merged.epubProgress?.lastRead, "2026-09-04T08:10:00.000Z");
});

test("keeps a disk progress update when the local operation changed annotations only", () => {
  const base = document({ epubProgress: epubProgress("2026-09-04T08:00:00.000Z", 0.1) });
  const intended = document({
    epubProgress: base.epubProgress,
    epubHighlights: [epubHighlight("local", "本地批注")],
  });
  const disk = document({ epubProgress: epubProgress("2026-09-04T08:10:00.000Z", 0.3) });

  const merged = mergeAnnotationDocuments(base, intended, disk);

  assert.equal(merged.epubProgress?.percent, 0.3);
  assert.equal(merged.epubHighlights[0]?.id, "local");
});
