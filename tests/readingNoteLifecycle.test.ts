import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";

import { initialReadingNote } from "../src/readingNotes/readingNoteBinding";
import { ReadingNoteLifecycle } from "../src/readingNotes/readingNoteLifecycle";
import type { ReadingNoteSync } from "../src/readingNotes/readingNoteSync";
import type { AnnotationStore } from "../src/storage/annotationStore";
import type { FileAnnotationDocument } from "../src/storage/types";

const timestamp = "2026-09-27T08:00:00.000Z";

function file(path: string): TFile {
  const value = new TFile();
  Object.assign(value, { path, extension: path.split(".").pop(), basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") });
  return value;
}

function document(sourcePath: string, notePath: string): FileAnnotationDocument {
  return {
    filePath: sourcePath, fileHash: "hash", lastModified: timestamp,
    highlights: [], comments: [], pdfHighlights: [], pdfComments: [], epubHighlights: [], epubComments: [],
    bookmarks: [], canvasNodes: [],
    readingNoteBinding: { notePath, schemaVersion: 1, boundAt: timestamp },
  };
}

test("note rename follows explicit binding and deletion clears it without restoring user content", async () => {
  const source = file("books/book.pdf");
  const note = file("notes/new.md");
  let current = document(source.path, "notes/old.md");
  const cancelled: string[] = [];
  const app = { vault: { getAbstractFileByPath: (path: string) => path === source.path ? source : path === note.path ? note : null } };
  const store = {
    getIndexedDocuments: async () => [current],
    mutateDocument: async (_file: TFile, update: (value: FileAnnotationDocument) => FileAnnotationDocument) => {
      current = update(current);
      return current;
    },
  };
  const sync = { cancel: (path: string) => cancelled.push(path) };
  const lifecycle = new ReadingNoteLifecycle(app as never, store as unknown as AnnotationStore, sync as unknown as ReadingNoteSync, () => []);
  await lifecycle.onNoteRenamed(note, "notes/old.md");
  assert.equal(current.readingNoteBinding?.notePath, "notes/new.md");
  await lifecycle.onNoteDeleted(note);
  assert.equal(current.readingNoteBinding, undefined);
  assert.deepEqual(cancelled, [source.path, source.path]);
});

test("source rename refreshes frontmatter, source link and deep links without renaming note", async () => {
  const source = file("books/new.epub");
  const note = file("notes/custom-name.md");
  const current = document(source.path, note.path);
  current.epubHighlights.push({ id: "a", type: "epub-highlight", color: "yellow", style: "fill",
    anchor: { chapter: "第一章", cfiRange: "epubcfi(/6/2)", selectedText: "内容" }, createdAt: timestamp });
  let body = initialReadingNote(file("books/old.epub")).replace("## 我的笔记\n", "## 我的笔记\n手写区域\n");
  const app = { vault: {
    getAbstractFileByPath: (path: string) => path === note.path ? note : null,
    process: async (_file: TFile, update: (value: string) => string) => { body = update(body); return body; },
  } };
  const store = { getExistingDocument: async () => current, getFreshDocument: async () => current };
  const lifecycle = new ReadingNoteLifecycle(app as never, store as unknown as AnnotationStore, { cancel: () => undefined } as never, () => []);
  await lifecycle.onSourceRenamed(source, "books/old.epub");
  assert.match(body, /inklight-source: "books\/new.epub"/);
  assert.match(body, /来源：\[\[books\/new.epub\]\]/);
  assert.match(body, /file=books%2Fnew.epub/);
  assert.match(body, /手写区域/);
  assert.equal(note.path, "notes/custom-name.md");
});

test("moving or deleting a note folder follows and clears nested bindings", async () => {
  const source = file("books/book.pdf");
  let current = document(source.path, "old-notes/sub/book.md");
  const folder = new TFolder();
  Object.assign(folder, { path: "new-notes" });
  const app = { vault: { getAbstractFileByPath: (path: string) => path === source.path ? source : null } };
  const store = {
    getIndexedDocuments: async () => [current],
    mutateDocument: async (_file: TFile, update: (value: FileAnnotationDocument) => FileAnnotationDocument) => {
      current = update(current);
      return current;
    },
  };
  const lifecycle = new ReadingNoteLifecycle(app as never, store as unknown as AnnotationStore, { cancel: () => undefined } as never, () => []);
  await lifecycle.onNoteRenamed(folder, "old-notes");
  assert.equal(current.readingNoteBinding?.notePath, "new-notes/sub/book.md");
  await lifecycle.onNoteDeleted(folder);
  assert.equal(current.readingNoteBinding, undefined);
});
