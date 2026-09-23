import assert from "node:assert/strict";
import test from "node:test";
import { createReadingLibraryItem } from "../src/epub/readingLibrary";

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
