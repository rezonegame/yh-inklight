import assert from "node:assert/strict";
import test from "node:test";
import {
  BookCoverCache, coverCacheKey, coverEvictions, coverIsUsable, CoverRecord, extractFoliateCover,
} from "../src/epub/BookCoverCache";
import { normalizeLibraryViewMode } from "../src/epub/readingLibrary";

function record(key: string, bytes = 1, lastAccess = 0): CoverRecord {
  const blob = new Blob(["x"], { type: "image/png" });
  return { key, sourceMtime: 42, mime: "image/png", blob, byteSize: bytes, lastAccess };
}

test("cover keys isolate vaults and normalize paths", () => {
  assert.equal(coverCacheKey("Vault A", "Books\\One.epub"), "Vault%20A:Books/One.epub");
  assert.notEqual(coverCacheKey("Vault A", "One.epub"), coverCacheKey("Vault B", "One.epub"));
});

test("cover validity requires matching source mtime and safe image data", () => {
  const good = record("a");
  assert.equal(coverIsUsable(good, 42), true);
  assert.equal(coverIsUsable(good, 43), false);
  assert.equal(coverIsUsable({ ...good, mime: "image/svg+xml" }, 42), false);
  assert.equal(coverIsUsable({ ...good, byteSize: 2 }, 42), false);
});

test("oldest covers are evicted at 100 records or 32 MiB", () => {
  const many = Array.from({ length: 101 }, (_, n) => record(`cover-${n}`, 1, n));
  assert.deepEqual(coverEvictions(many), ["cover-0"]);
  const large = [record("old", 20 * 1024 * 1024, 1), record("new", 20 * 1024 * 1024, 2)];
  assert.deepEqual(coverEvictions(large), ["old"]);
});

test("foliate cover is read only on explicit extraction and rejects unsupported media", async () => {
  let calls = 0;
  const book = { getCover: async () => { calls++; return new Blob(["cover"], { type: "image/png" }); } };
  assert.equal(calls, 0);
  assert.equal((await extractFoliateCover(book))?.type, "image/png");
  assert.equal(calls, 1);
  assert.equal(await extractFoliateCover({ getCover: () => new Blob(["x"], { type: "image/svg+xml" }) }), null);
  const untypedPng = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])]);
  assert.equal((await extractFoliateCover({ getCover: () => untypedPng }))?.type, "image/png");
  assert.equal(await extractFoliateCover({ getCover: () => new Blob(["not an image"]) }), null);
});

test("IndexedDB unavailable falls back without blocking the library", async () => {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const cache = new BookCoverCache("vault", null);
    assert.equal(await cache.put("book.epub", 42, new Blob(["x"], { type: "image/png" })), false);
    assert.equal((await cache.getMany([{ path: "book.epub", mtime: 42 }])).size, 0);
    await cache.remove("book.epub");
  } finally {
    console.warn = warn;
  }
});

test("unknown local view modes fall back to list", () => {
  assert.equal(normalizeLibraryViewMode("grid"), "grid");
  assert.equal(normalizeLibraryViewMode("other"), "list");
  assert.equal(normalizeLibraryViewMode(null), "list");
});
