import { test } from "node:test";
import assert from "node:assert/strict";

import { serializeDocumentToJson, parseJsonDocument } from "../src/storage/annotationStore";
import type { FileAnnotationDocument } from "../src/storage/types";

function sampleDocument(): FileAnnotationDocument {
  return {
    filePath: "Books/未命名.pdf",
    fileHash: "hash1",
    lastModified: "2026-08-22T00:26:03.606Z",
    highlights: [],
    comments: [],
    pdfHighlights: [
      {
        id: "ph1",
        color: "blue",
        anchor: { pageNumber: 1, selectedText: "x", rects: [] },
        createdAt: "2026-08-22T00:25:00.000Z",
      },
    ],
    pdfComments: [],
    epubHighlights: [],
    epubComments: [],
    pdfProgress: { pageNumber: 1, totalPages: 1, percent: 1, lastRead: "2026-08-22T00:26:03.606Z" },
    bookmarks: [],
    canvasBinding: null,
    canvasNodes: [],
  };
}

function sampleEpubDocument(): FileAnnotationDocument {
  return {
    filePath: "00-资源收藏/电子书/蛊真人.epub",
    fileHash: "hash2",
    lastModified: "2026-08-22T00:18:56.520Z",
    highlights: [],
    comments: [],
    pdfHighlights: [],
    pdfComments: [],
    epubHighlights: [],
    epubComments: [],
    epubProgress: {
      cfi: "epubcfi(/6/8/2!/4/2,/8/1:29)",
      chapter: "第二十四节：影鸦",
      percent: 0.183,
      lastRead: "2026-08-22T00:18:56.520Z",
      readingTimeSeconds: 9,
      estimatedRemainingMinutes: 42,
    },
    bookmarks: [],
    canvasBinding: null,
    canvasNodes: [],
  };
}

test("json sidecar: progress flattened, no nested objects", () => {
  const json = serializeDocumentToJson(sampleDocument());
  const parsed = JSON.parse(json) as Record<string, unknown>;

  assert.ok(!("pdfProgress" in parsed), "nested pdfProgress object must be absent");
  assert.ok(!("epubProgress" in parsed), "nested epubProgress object must be absent");
  assert.ok(!("pdfPageNumber" in parsed), "pdfPageNumber prefix must be gone");
  assert.equal(parsed.pageNumber, 1, "pageNumber flattened to top level (unprefixed)");
  assert.equal(parsed.totalPages, 1);
  assert.equal(parsed.percent, 1);
  assert.equal(parsed.lastRead, "2026-08-22T00:26:03.606Z");
});

test("json sidecar: full round-trip is lossless", () => {
  const doc = sampleDocument();
  const parsed = parseJsonDocument(serializeDocumentToJson(doc), doc.filePath);

  assert.deepEqual(parsed.pdfProgress, doc.pdfProgress, "pdfProgress reassembles losslessly");
  assert.equal(parsed.pdfHighlights.length, 1);
  assert.deepEqual(parsed.pdfHighlights[0], doc.pdfHighlights[0]);
});

test("json sidecar: epub progress flattens and round-trips", () => {
  const doc = sampleEpubDocument();
  const parsed = parseJsonDocument(serializeDocumentToJson(doc), doc.filePath);

  const raw = JSON.parse(serializeDocumentToJson(doc)) as Record<string, unknown>;
  assert.ok(!("epubProgress" in raw), "nested epubProgress object must be absent");
  assert.ok(!("epubCfi" in raw), "epubCfi prefix must be gone");
  assert.equal(raw.cfi, "epubcfi(/6/8/2!/4/2,/8/1:29)");
  assert.equal(raw.estimatedRemainingMinutes, 42);
  assert.deepEqual(parsed.epubProgress, doc.epubProgress);
});

test("json sidecar: tolerates legacy nested pdfProgress/epubProgress", () => {
  const legacy = {
    filePath: "old.pdf",
    fileHash: "h",
    lastModified: "2026-01-01T00:00:00.000Z",
    highlights: [],
    comments: [],
    pdfHighlights: [],
    pdfComments: [],
    epubHighlights: [],
    epubComments: [],
    pdfProgress: { pageNumber: 7, totalPages: 20, percent: 35, lastRead: "2026-01-01T00:00:00.000Z" },
    epubProgress: {
      cfi: "epubcfi(/6)",
      chapter: "Ch",
      percent: 50,
      lastRead: "x",
      readingTimeSeconds: 10,
    },
    bookmarks: [],
    canvasBinding: null,
    canvasNodes: [],
  };
  const parsed = parseJsonDocument(JSON.stringify(legacy), "old.pdf");
  assert.deepEqual(parsed.pdfProgress, legacy.pdfProgress, "legacy nested pdfProgress parsed");
  assert.deepEqual(parsed.epubProgress, legacy.epubProgress, "legacy nested epubProgress parsed");
});

test("json sidecar: tolerates legacy prefixed flat keys", () => {
  const legacyPrefixed = {
    filePath: "old.pdf",
    fileHash: "h",
    lastModified: "2026-01-01T00:00:00.000Z",
    highlights: [],
    comments: [],
    pdfHighlights: [],
    pdfComments: [],
    epubHighlights: [],
    epubComments: [],
    pdfPageNumber: 7,
    pdfTotalPages: 20,
    pdfPercent: 35,
    pdfLastRead: "2026-01-01T00:00:00.000Z",
    bookmarks: [],
    canvasBinding: null,
    canvasNodes: [],
  };
  const parsed = parseJsonDocument(JSON.stringify(legacyPrefixed), "old.pdf");
  assert.deepEqual(parsed.pdfProgress, {
    pageNumber: 7,
    totalPages: 20,
    percent: 35,
    lastRead: "2026-01-01T00:00:00.000Z",
  }, "legacy prefixed flat keys parsed into unprefixed progress");
});
