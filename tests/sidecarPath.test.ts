import assert from "node:assert";
import { test } from "node:test";

import { AnnotationStore } from "../src/storage/annotationStore";
import { AnnotationIndex, EMPTY_INDEX, SidecarLocation } from "../src/storage/types";

/** In-memory vault adapter so we can exercise AnnotationStore without Obsidian. */
class MemoryAdapter {
  private files = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`missing: ${path}`);
    return content;
  }
  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
  async mkdir(): Promise<void> {
    /* no-op for memory store */
  }
}

class MemoryApp {
  vault = { adapter: new MemoryAdapter() };
}

function makeStore(location: SidecarLocation, baseDir = ".obsidian-annotations") {
  const app = new MemoryApp() as unknown as ConstructorParameters<typeof AnnotationStore>[0];
  let saved: unknown = null;
  const store = new AnnotationStore(
    app,
    () => [],
    () => ({ baseDir, format: "json", sidecarLocation: location }),
    async () => saved,
    async (data) => {
      saved = data;
    },
  );
  return { store, getSaved: () => saved as AnnotationIndex | null };
}

test("sidecar path: specifiedFolder keeps baseDir and flat naming", async () => {
  const { store } = makeStore("specifiedFolder");
  const path = (store as unknown as { toSidecarPath: (f: string) => string }).toSidecarPath("books/未命名.pdf");
  assert.equal(path, ".obsidian-annotations/books-未命名.pdf.json");
});

test("sidecar path: sameFolder puts sidecar next to source with .annotations suffix", async () => {
  const { store } = makeStore("sameFolder");
  const path = (store as unknown as { toSidecarPath: (f: string) => string }).toSidecarPath("books/未命名.pdf");
  assert.equal(path, "books/未命名.pdf.annotations.json");
});

test("index merges into plugin data.json via loadData/saveData", async () => {
  const { store, getSaved } = makeStore("specifiedFolder");
  await store.initialize();
  assert.deepEqual(getSaved(), null, "nothing saved before first write");

  // Drive the index write path directly: writeIndex persists through saveData.
  const index: AnnotationIndex = {
    version: 1,
    files: {
      "books/未命名.pdf": {
        filePath: "books/未命名.pdf",
        sidecarPath: ".obsidian-annotations/books-未命名.pdf.json",
        fileHash: "h",
        highlightCount: 0,
        commentCount: 0,
        epubHighlightCount: 0,
        epubCommentCount: 0,
        bookmarkCount: 0,
        updatedAt: "2026-08-22T00:00:00.000Z",
      },
    },
  };
  await (store as unknown as { writeIndex: (i: AnnotationIndex) => Promise<void> }).writeIndex(index);

  const saved = getSaved();
  assert.ok(saved && typeof saved === "object" && "files" in saved, "index saved as data.json payload");
  const written = saved as AnnotationIndex;
  assert.ok(written.files["books/未命名.pdf"], "index entry present");
  assert.equal(written.files["books/未命名.pdf"].sidecarPath, ".obsidian-annotations/books-未命名.pdf.json");
});

test("initialize reads existing index from loadData (no index.json)", async () => {
  const prior: AnnotationIndex = {
    version: 1,
    files: {
      "a/b.epub": {
        filePath: "a/b.epub",
        sidecarPath: "a/b.epub.annotations.json",
        fileHash: "h",
        highlightCount: 0,
        commentCount: 0,
        epubHighlightCount: 1,
        epubCommentCount: 0,
        bookmarkCount: 0,
        updatedAt: "2026-08-22T00:00:00.000Z",
      },
    },
  };
  let saved: unknown = prior;
  const app = new MemoryApp() as unknown as ConstructorParameters<typeof AnnotationStore>[0];
  const store = new AnnotationStore(
    app,
    () => [],
    () => ({ baseDir: ".obsidian-annotations", format: "json", sidecarLocation: "sameFolder" }),
    async () => saved,
    async (data) => {
      saved = data;
    },
  );
  await store.initialize();
  // The index must be loaded from loadData, not from an index.json file.
  const loaded = (store as unknown as { index: AnnotationIndex }).index;
  assert.equal(loaded.files["a/b.epub"]?.sidecarPath, "a/b.epub.annotations.json", "index loaded from data.json");
});

void EMPTY_INDEX;
