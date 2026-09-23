import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";

import { initialReadingNote, normalizeReadingNoteFolder, readingNotePath, ReadingNoteBindingService } from "../src/readingNotes/readingNoteBinding";
import type { AnnotationStore } from "../src/storage/annotationStore";
import type { FileAnnotationDocument } from "../src/storage/types";

function source(path: string): TFile {
  const file = new TFile();
  Object.assign(file, {
    path,
    extension: path.split(".").pop(),
    basename: path.split("/").pop()?.replace(/\.[^.]+$/, ""),
  });
  return file;
}

test("reading note paths distinguish same-name sources and reject unsafe folders", () => {
  const pdf = source("a/book.pdf");
  const ebook = source("b/book.epub");
  assert.equal(readingNotePath("墨光阅读笔记", pdf), "墨光阅读笔记/book - 阅读笔记.md");
  assert.notEqual(readingNotePath("墨光阅读笔记", pdf, true), readingNotePath("墨光阅读笔记", ebook, true));
  assert.equal(normalizeReadingNoteFolder(" notes / reading "), "notes / reading");
  assert.equal(normalizeReadingNoteFolder("notes/../other"), null);
  assert.equal(normalizeReadingNoteFolder(""), null);
  assert.match(initialReadingNote(ebook), /inklight-source-type: "ebook"/);
  assert.match(initialReadingNote(pdf), /<!-- yh-inklight:managed:start -->\n<!-- yh-inklight:managed:end -->/);
});

test("repeated or concurrent commands create one bound note", async () => {
  const files = new Map<string, TFile | TFolder>();
  const content = new Map<string, string>();
  const pdf = source("a/book.pdf");
  let document = { filePath: pdf.path } as FileAnnotationDocument;
  let creates = 0;
  const app = { vault: {
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    adapter: { exists: async (path: string) => files.has(path) },
    createFolder: async (path: string) => { files.set(path, new TFolder()); },
    create: async (path: string, text: string) => {
      creates++;
      const file = source(path);
      files.set(path, file);
      content.set(path, text);
      return file;
    },
    cachedRead: async (file: TFile) => content.get(file.path) ?? "",
    delete: async (file: TFile) => { files.delete(file.path); },
  } };
  const store = {
    getFreshDocument: async () => document,
    mutateDocument: async (_file: TFile, update: (value: FileAnnotationDocument) => FileAnnotationDocument) => {
      document = update(document);
      return document;
    },
  };
  const service = new ReadingNoteBindingService(app as never, store as unknown as AnnotationStore);
  const [first, second] = await Promise.all([
    service.openOrCreate(pdf, "墨光阅读笔记"),
    service.openOrCreate(pdf, "墨光阅读笔记"),
  ]);
  assert.equal(first, second);
  assert.equal(creates, 1);
  assert.equal((await service.openOrCreate(pdf, "墨光阅读笔记")).path, first.path);
  assert.equal(creates, 1);
  assert.equal(document.readingNoteBinding?.notePath, first.path);
});

test("unrelated Markdown is not claimed even when it has the preferred name", async () => {
  const pdf = source("a/book.pdf");
  const files = new Map<string, TFile | TFolder>([["墨光阅读笔记/book - 阅读笔记.md", source("墨光阅读笔记/book - 阅读笔记.md")]]);
  let created = "";
  const app = { vault: {
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    adapter: { exists: async (path: string) => files.has(path) },
    createFolder: async (path: string) => { files.set(path, new TFolder()); },
    create: async (path: string) => { created = path; return source(path); },
  } };
  const document = { filePath: pdf.path } as FileAnnotationDocument;
  const store = {
    getFreshDocument: async () => document,
    mutateDocument: async (_file: TFile, update: (value: FileAnnotationDocument) => FileAnnotationDocument) => update(document),
  };
  const note = await new ReadingNoteBindingService(app as never, store as unknown as AnnotationStore)
    .openOrCreate(pdf, "墨光阅读笔记");
  assert.equal(note.path, created);
  assert.equal(note.path, readingNotePath("墨光阅读笔记", pdf, true));
});
