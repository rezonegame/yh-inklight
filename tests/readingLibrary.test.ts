import assert from "node:assert/strict";
import test from "node:test";
import {
  createReadingLibraryItem, DEFAULT_READING_LIBRARY_QUERY, queryReadingLibrary, ReadingLibraryItem,
} from "../src/epub/readingLibrary";

const epub = { path: "books/story.epub", basename: "story", extension: "epub", parentPath: "books" };
const pdf = { path: "papers/work.pdf", basename: "work", extension: "pdf", parentPath: "papers" };

test("new ebook and PDF files are listed without sidecars", () => {
  assert.equal(createReadingLibraryItem(epub, undefined, undefined, true).status, "unstarted");
  assert.equal(createReadingLibraryItem(pdf, undefined, undefined, true).status, "unstarted");
});

test("ebook status uses progress thresholds and retains reading metadata", () => {
  const progress = { cfi: "x", chapter: "One", percent: 0.5, lastRead: "2026-09-24", readingTimeSeconds: 90 };
  const reading = createReadingLibraryItem(epub, progress, undefined, true);
  assert.equal(reading.status, "reading");
  assert.equal(reading.readingTimeSeconds, 90);
  assert.equal(createReadingLibraryItem(epub, { ...progress, percent: 0.99 }, undefined, true).status, "finished");
  assert.equal(createReadingLibraryItem(epub, { ...progress, percent: Number.NaN }, undefined, true).status, "unstarted");
});

test("PDF progress is hidden when tracking is disabled", () => {
  const progress = { pageNumber: 4, totalPages: 10, percent: 0.4, lastRead: "2026-09-24" };
  const tracked = createReadingLibraryItem(pdf, undefined, progress, true);
  assert.equal(tracked.status, "reading");
  assert.equal(tracked.progress, 0.4);
  const disabled = createReadingLibraryItem(pdf, undefined, progress, false);
  assert.equal(disabled.status, "untracked");
  assert.equal(disabled.progress, null);
  assert.equal(disabled.lastRead, null);
});

test("stored progress is clamped into the visible range", () => {
  const progress = { pageNumber: 10, totalPages: 10, percent: 2, lastRead: "2026-09-24" };
  const item = createReadingLibraryItem(pdf, undefined, progress, true);
  assert.equal(item.progress, 1);
  assert.equal(item.status, "finished");
});

function item(path: string, progress: number | null, lastRead: string | null): ReadingLibraryItem {
  const basename = path.split("/").pop()!.replace(/\.[^.]+$/, "");
  const extension = path.split(".").pop()!;
  return {
    path, basename, extension, kind: extension === "pdf" ? "pdf" : "ebook",
    parentPath: path.slice(0, path.lastIndexOf("/")), progress,
    status: progress === null ? "untracked" : progress === 0 ? "unstarted" : progress >= 0.99 ? "finished" : "reading",
    lastRead, readingTimeSeconds: null, estimatedRemainingMinutes: null,
  };
}

test("search matches basename or full path without case sensitivity", () => {
  const items = [item("Books/Novel.EPUB", 0.2, null), item("Papers/Work.pdf", 0, null)];
  assert.deepEqual(queryReadingLibrary(items, { ...DEFAULT_READING_LIBRARY_QUERY, search: "NOVEL" }).map((x) => x.path), ["Books/Novel.EPUB"]);
  assert.deepEqual(queryReadingLibrary(items, { ...DEFAULT_READING_LIBRARY_QUERY, search: "papers/" }).map((x) => x.path), ["Papers/Work.pdf"]);
});

test("status, format and direct parent filters intersect", () => {
  const items = [item("A/one.epub", 0.5, null), item("A/two.pdf", 0.5, null), item("A/child/three.epub", 0.5, null)];
  const result = queryReadingLibrary(items, {
    ...DEFAULT_READING_LIBRARY_QUERY, status: "reading", format: "epub", parentPath: "A",
  });
  assert.deepEqual(result.map((x) => x.path), ["A/one.epub"]);
  assert.equal(queryReadingLibrary(items, { ...DEFAULT_READING_LIBRARY_QUERY, search: "absent" }).length, 0);
});

test("a folder named all remains filterable", () => {
  const items = [item("all/one.epub", 0, null), item("other/two.epub", 0, null)];
  assert.deepEqual(queryReadingLibrary(items, { ...DEFAULT_READING_LIBRARY_QUERY, parentPath: "all" }).map((x) => x.path),
    ["all/one.epub"]);
});

test("recent shows only latest 20 dated items irrespective of selected sort", () => {
  const items = Array.from({ length: 25 }, (_, n) => item(`Books/${n}.epub`, 0.5, `2026-09-${String(n + 1).padStart(2, "0")}`));
  items.push(item("Books/never.epub", 0, null));
  const result = queryReadingLibrary(items, { ...DEFAULT_READING_LIBRARY_QUERY, status: "recent", sort: "title" });
  assert.equal(result.length, 20);
  assert.equal(result[0].path, "Books/24.epub");
  assert.equal(result.at(-1)?.path, "Books/5.epub");
});

test("title and progress sorting are stable with path tie-breaks", () => {
  const items = [item("B/Same.epub", 0.4, null), item("A/Same.epub", 0.4, null), item("A/Zed.pdf", null, null)];
  assert.deepEqual(queryReadingLibrary(items, { ...DEFAULT_READING_LIBRARY_QUERY, sort: "title" }).map((x) => x.path),
    ["A/Same.epub", "B/Same.epub", "A/Zed.pdf"]);
  assert.deepEqual(queryReadingLibrary(items, { ...DEFAULT_READING_LIBRARY_QUERY, sort: "progress" }).map((x) => x.path),
    ["A/Same.epub", "B/Same.epub", "A/Zed.pdf"]);
});

test("500-item queries derive from memory without asking the repository again", () => {
  let reads = 0;
  const fakeRepository = { load: () => { reads++; return Array.from({ length: 500 }, (_, n) => item(`Books/book-${n}.epub`, n / 500, null)); } };
  const loaded = fakeRepository.load();
  for (const search of ["book-1", "book-2", "book-3", "book-4"]) {
    const result = queryReadingLibrary(loaded, { ...DEFAULT_READING_LIBRARY_QUERY, search, sort: "progress" });
    assert.ok(result.length > 0);
  }
  assert.equal(reads, 1);
});
