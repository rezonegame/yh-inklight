import { test } from "node:test";
import assert from "node:assert/strict";

import { serializeDocumentToMarkdown, parseMarkdownDocument } from "../src/storage/annotationStore";
import type { FileAnnotationDocument } from "../src/storage/types";

function sampleDocument(): FileAnnotationDocument {
  return {
    filePath: "Notes/Reading & <Book>.md",
    fileHash: "abc123",
    lastModified: "2026-08-21T10:00:00.000Z",
    highlights: [
      {
        id: "h1",
        color: "yellow",
        anchor: { startOffset: 0, endOffset: 5, selectedText: 'He said "hi" <b> & ok', prefix: "", suffix: "" },
        createdAt: "2026-08-21T09:00:00.000Z",
      },
    ],
    comments: [
      {
        id: "c1",
        highlightId: "h1",
        anchor: { startOffset: 0, endOffset: 5, selectedText: '> quote "x"', prefix: "", suffix: "" },
        title: "T",
        tagId: "t1",
        tagLabelSnapshot: "Tag",
        content: 'Line1\nLine2 with <tag> & "q" and \'apostrophe\'',
        color: "green",
        position: { offsetX: 1, offsetY: 2 },
        collapsed: false,
        author: "作者",
        createdAt: "2026-08-21T09:01:00.000Z",
        updatedAt: "2026-08-21T09:02:00.000Z",
        replies: [{ id: "r1", content: 'reply "a" <b>', createdAt: "2026-08-21T09:03:00.000Z" }],
        resolved: true,
      },
    ],
    pdfHighlights: [
      {
        id: "ph1",
        color: "blue",
        anchor: { pageNumber: 3, selectedText: 'PDF "x" <y>', rects: [{ pageNumber: 3, left: 1, top: 2, width: 3, height: 4 }] },
        createdAt: "2026-08-21T09:10:00.000Z",
      },
    ],
    pdfComments: [
      {
        id: "pc1",
        color: "pink",
        anchor: { pageNumber: 4, selectedText: 'P "q"', rects: [] },
        content: 'pdf note "n"',
        createdAt: "2026-08-21T09:11:00.000Z",
        position: { offsetX: 0, offsetY: 0 },
        collapsed: false,
        author: "a",
        updatedAt: "2026-08-21T09:11:00.000Z",
        replies: [],
        resolved: false,
      },
    ],
    epubHighlights: [
      {
        id: "eh1",
        type: "epub-highlight",
        color: "orange",
        style: "fill",
        anchor: { cfiRange: "epubcfi(/6/4!/2)", chapter: "Ch 1 <x>", selectedText: 'E "e"' },
        createdAt: "2026-08-21T09:20:00.000Z",
      },
    ],
    epubComments: [
      {
        id: "ec1",
        type: "epub-comment",
        color: "purple",
        style: "fill",
        anchor: { cfiRange: "epubcfi(/6/8!/2)", chapter: "Ch 2", selectedText: 'EC "q"' },
        note: 'epub note "n" & <i>',
        noteType: "insight",
        createdAt: "2026-08-21T09:21:00.000Z",
        collapsed: false,
        author: "a",
        updatedAt: "2026-08-21T09:21:00.000Z",
        replies: [],
        resolved: false,
      },
    ],
    epubProgress: { cfi: "epubcfi(/6)", chapter: "Ch", percent: 50, lastRead: "x", readingTimeSeconds: 10 },
    bookmarks: [{ id: "b1", type: "pdf-bookmark", label: 'bm "l"', position: "p", createdAt: "x" }],
    canvasBinding: { bookPath: "b", canvasPath: "c", autoCreate: true, layoutDirection: "horizontal" },
    canvasNodes: [{ annotationId: "n1", nodeId: "node1", position: { x: 1, y: 2 } }],
  };
}

test("markdown sidecar: YAML frontmatter holds progress + metadata", () => {
  const doc = sampleDocument();
  const md = serializeDocumentToMarkdown(doc);

  assert.ok(md.startsWith("---"), "file must start with YAML frontmatter delimiter");
  assert.ok(md.includes("\n---\n"), "frontmatter must close with a second delimiter");
  assert.ok(md.includes("cfi:"), "cfi must live in frontmatter (flattened)");
  assert.ok(md.includes("chapter:"), "chapter must live in frontmatter (flattened)");
  assert.ok(md.includes("percent:"), "percent must live in frontmatter (flattened)");
  assert.ok(md.includes("lastRead:"), "lastRead must live in frontmatter (flattened)");
  assert.ok(md.includes("readingTimeSeconds:"), "readingTimeSeconds must live in frontmatter (flattened)");
  assert.ok(!md.includes("pdfProgress:"), "nested pdfProgress object must be gone");
  assert.ok(!md.includes("epubProgress:"), "nested epubProgress object must be gone");
  assert.ok(!md.includes("data-book-note-doc"), "old hidden doc span must be gone");
});

test("markdown sidecar: each annotation is its own level-1 heading", () => {
  const doc = sampleDocument();
  const md = serializeDocumentToMarkdown(doc);

  // highlights(1)+comments(1)+pdfHighlights(1)+pdfComments(1)+epubHighlights(1)+epubComments(1) = 6
  const realCount = (md.match(/^# .* \^bn-/gm) ?? []).length;
  assert.equal(realCount, 6, "exactly six annotation headings with block ids");
});

test("markdown sidecar: full round-trip is lossless", () => {
  const doc = sampleDocument();
  const md = serializeDocumentToMarkdown(doc);
  const parsed = parseMarkdownDocument(md, "Notes/Reading & <Book>.md");

  assert.equal(parsed.filePath, doc.filePath);
  assert.equal(parsed.fileHash, doc.fileHash);
  assert.equal(parsed.lastModified, doc.lastModified);

  assert.deepEqual(parsed.epubProgress, doc.epubProgress, "epubProgress round-trips (unprefixed keys)");
  assert.deepEqual(parsed.bookmarks, doc.bookmarks, "bookmarks round-trip");
  assert.deepEqual(parsed.canvasBinding, doc.canvasBinding, "canvasBinding round-trips");
  assert.deepEqual(parsed.canvasNodes, doc.canvasNodes, "canvasNodes round-trip");

  assert.equal(parsed.highlights.length, 1);
  assert.deepEqual(parsed.highlights[0], doc.highlights[0], "md highlight round-trips with special chars");
  assert.equal(parsed.highlights[0].anchor.selectedText, 'He said "hi" <b> & ok');

  assert.equal(parsed.comments.length, 1);
  assert.deepEqual(parsed.comments[0], doc.comments[0], "md comment round-trips");
  assert.equal(parsed.comments[0].content, 'Line1\nLine2 with <tag> & "q" and \'apostrophe\'');
  assert.equal(parsed.comments[0].replies[0].content, 'reply "a" <b>');
  assert.equal(parsed.comments[0].resolved, true);

  assert.equal(parsed.pdfHighlights.length, 1);
  assert.deepEqual(parsed.pdfHighlights[0], doc.pdfHighlights[0]);
  assert.equal(parsed.pdfHighlights[0].anchor.selectedText, 'PDF "x" <y>');

  assert.equal(parsed.pdfComments.length, 1);
  assert.deepEqual(parsed.pdfComments[0], doc.pdfComments[0]);
  assert.equal(parsed.pdfComments[0].content, 'pdf note "n"');

  assert.equal(parsed.epubHighlights.length, 1);
  assert.deepEqual(parsed.epubHighlights[0], doc.epubHighlights[0]);

  assert.equal(parsed.epubComments.length, 1);
  assert.deepEqual(parsed.epubComments[0], doc.epubComments[0]);
  assert.equal(parsed.epubComments[0].note, 'epub note "n" & <i>');
});

test("markdown sidecar: PDF progress uses unprefixed keys", () => {
  const doc: FileAnnotationDocument = {
    ...sampleDocument(),
    filePath: "Papers/example.pdf",
    epubProgress: undefined,
    pdfProgress: { pageNumber: 7, totalPages: 20, percent: 35, lastRead: "2026-08-22T01:00:00.000Z" },
  };
  const md = serializeDocumentToMarkdown(doc);

  assert.ok(md.includes("pageNumber:"), "pageNumber must be unprefixed");
  assert.ok(md.includes("totalPages:"), "totalPages must be unprefixed");
  assert.ok(md.includes("percent:"), "percent must be unprefixed");
  assert.ok(md.includes("lastRead:"), "lastRead must be unprefixed");
  assert.ok(!md.includes("pdfPageNumber:"), "pdfPageNumber prefix must be gone");

  const parsed = parseMarkdownDocument(md, doc.filePath);
  assert.deepEqual(parsed.pdfProgress, doc.pdfProgress, "pdfProgress round-trips with unprefixed keys");
});

test("markdown sidecar: backward compatibility with prefixed keys", () => {
  const md = `---
filePath: 'legacy.pdf'
fileHash: 'h'
lastModified: '2026-01-01T00:00:00.000Z'
pdfPageNumber: 1
pdfTotalPages: 1
pdfPercent: 1
pdfLastRead: '2026-01-01T00:00:00.000Z'
bookmarks: []
canvasBinding: null
canvasNodes: []
---
`;
  const parsed = parseMarkdownDocument(md, "legacy.pdf");
  assert.deepEqual(parsed.pdfProgress, {
    pageNumber: 1,
    totalPages: 1,
    percent: 1,
    lastRead: "2026-01-01T00:00:00.000Z",
  });
});

test("markdown sidecar: missing frontmatter degrades gracefully", () => {
  const doc = sampleDocument();
  let md = serializeDocumentToMarkdown(doc);
  // Strip the YAML frontmatter block; annotations should still parse.
  md = md.replace(/^---\n[\s\S]*?\n---\n/, "");
  const parsed = parseMarkdownDocument(md, "x.md");
  assert.equal(parsed.filePath, "");
  assert.equal(parsed.highlights.length, 1);
  assert.equal(parsed.highlights[0].id, "h1");
});
