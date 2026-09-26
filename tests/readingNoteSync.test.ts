import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";

import { initialReadingNote } from "../src/readingNotes/readingNoteBinding";
import { ReadingNoteSync } from "../src/readingNotes/readingNoteSync";
import type { ReadingNoteBindingService } from "../src/readingNotes/readingNoteBinding";
import type { AnnotationStore } from "../src/storage/annotationStore";
import type { FileAnnotationDocument } from "../src/storage/types";

const timestamp = "2026-09-25T08:00:00.000Z";

function file(path: string): TFile {
  const result = new TFile();
  Object.assign(result, { path, extension: path.split(".").pop(), basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") });
  return result;
}

function document(source: TFile, note: TFile): FileAnnotationDocument {
  return {
    filePath: source.path, fileHash: "hash", lastModified: timestamp,
    highlights: [], comments: [], pdfHighlights: [], pdfComments: [], epubHighlights: [], epubComments: [],
    bookmarks: [], canvasNodes: [],
    readingNoteBinding: { notePath: note.path, schemaVersion: 1, boundAt: timestamp },
  };
}

test("rapid syncs are serialized and preserve handwritten text", async () => {
  const source = file("books/book.epub");
  const note = file("墨光阅读笔记/book - 阅读笔记.md");
  const current = document(source, note);
  let body = initialReadingNote(source).replace("## 我的笔记\n", "## 我的笔记\n手写段落\n");
  let writes = 0;
  const app = { vault: { process: async (_file: TFile, update: (value: string) => string) => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    body = update(body);
    writes++;
    return body;
  } } };
  const store = { getFreshDocument: async () => current };
  const binding = { openOrCreate: async () => note };
  const sync = new ReadingNoteSync(app as never, store as unknown as AnnotationStore,
    binding as unknown as ReadingNoteBindingService, () => "墨光阅读笔记", () => []);
  current.epubHighlights.push({ id: "first", type: "epub-highlight", color: "yellow", style: "fill",
    anchor: { cfiRange: "epubcfi(/6/2)", chapter: "第一章", selectedText: "第一段" }, createdAt: timestamp });
  const first = sync.sync(source);
  current.epubHighlights.push({ id: "second", type: "epub-highlight", color: "yellow", style: "fill",
    anchor: { cfiRange: "epubcfi(/6/4)", chapter: "第一章", selectedText: "第二段" }, createdAt: timestamp });
  await Promise.all([first, sync.sync(source), sync.sync(source)]);
  assert.equal(writes, 3);
  assert.equal(body.match(/\^epub-first/g)?.length, 1);
  assert.equal(body.match(/\^epub-second/g)?.length, 1);
  assert.match(body, /## 我的笔记\n手写段落\n/);
  sync.dispose();
});

test("damaged managed markers reject writes without changing the note", async () => {
  const source = file("books/book.pdf");
  const note = file("墨光阅读笔记/book - 阅读笔记.md");
  const current = document(source, note);
  let body = initialReadingNote(source).replace("<!-- yh-inklight:managed:start -->", "用户自己的内容");
  const before = body;
  const app = { vault: { process: async (_file: TFile, update: (value: string) => string) => {
    body = update(body);
    return body;
  } } };
  const store = { getFreshDocument: async () => current };
  const binding = { openOrCreate: async () => note };
  const sync = new ReadingNoteSync(app as never, store as unknown as AnnotationStore,
    binding as unknown as ReadingNoteBindingService, () => "墨光阅读笔记", () => []);
  await assert.rejects(sync.sync(source), /受管标记/);
  assert.equal(body, before);
  sync.dispose();
});

test("a failed sync can retry after the user restores the markers", async () => {
  const source = file("books/book.pdf");
  const note = file("墨光阅读笔记/book - 阅读笔记.md");
  const current = document(source, note);
  let body = initialReadingNote(source).replace("<!-- yh-inklight:managed:end -->", "");
  const app = { vault: { process: async (_file: TFile, update: (value: string) => string) => {
    body = update(body);
    return body;
  } } };
  const store = { getFreshDocument: async () => current };
  const binding = { openOrCreate: async () => note };
  const sync = new ReadingNoteSync(app as never, store as unknown as AnnotationStore,
    binding as unknown as ReadingNoteBindingService, () => "墨光阅读笔记", () => []);
  await assert.rejects(sync.sync(source), /受管标记/);
  body = initialReadingNote(source);
  current.pdfHighlights.push({ id: "one", color: "yellow",
    anchor: { pageNumber: 1, selectedText: "摘录", rects: [] }, createdAt: timestamp });
  await sync.sync(source);
  assert.match(body, /\^pdf-one/);
  sync.dispose();
});
