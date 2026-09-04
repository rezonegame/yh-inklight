import assert from "node:assert/strict";
import test from "node:test";

import { TFile } from "obsidian";

import { AnnotationStore, AnnotationStoreReadError } from "../src/storage/annotationStore";
import { EpubHighlightAnnotation, FileAnnotationDocument } from "../src/storage/types";

class FakeFile extends TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  parent = { path: "books" };

  constructor(path: string) {
    super();
    this.path = path;
    this.name = path.split("/").pop()!;
    this.basename = this.name.replace(/\.[^.]+$/, "");
    this.extension = this.name.split(".").pop()!;
  }
}

class FakeAdapter {
  readonly files = new Map<string, string>();
  failBackup = false;

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.files.set(`${path}/`, "");
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`Missing fake file: ${path}`);
    return value;
  }

  async write(path: string, value: string): Promise<void> {
    if (this.failBackup && path.endsWith(".bak")) {
      throw new Error("simulated backup failure");
    }
    this.files.set(path, value);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = `${path}/`;
    return {
      files: [...this.files.keys()].filter((item) => item.startsWith(prefix) && !item.slice(prefix.length).includes("/")),
      folders: [],
    };
  }
}

class FakeVault {
  readonly adapter = new FakeAdapter();
  readonly source = new FakeFile("books/example.epub");

  getAbstractFileByPath(path: string): FakeFile | null {
    return path === this.source.path ? this.source : null;
  }

  async readBinary(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }

  async cachedRead(): Promise<string> {
    return "book";
  }
}

function createApp(vault: FakeVault): { vault: FakeVault } {
  return { vault };
}

function highlight(id: string, text: string): EpubHighlightAnnotation {
  return {
    id,
    type: "epub-highlight",
    color: "yellow",
    style: "fill",
    anchor: { cfiRange: `epubcfi(/${id})`, chapter: "第一章", selectedText: text },
    createdAt: "2026-09-04T08:00:00.000Z",
  };
}

test("AnnotationStore preserves a remote record and writes the previous sidecar to backup", async () => {
  const vault = new FakeVault();
  const store = new AnnotationStore(createApp(vault) as never);
  await store.initialize();
  await store.addEpubHighlight(vault.source, highlight("first", "第一条"));

  const sidecarPath = store.toSidecarPath(vault.source.path);
  const disk = JSON.parse(vault.adapter.files.get(sidecarPath)!) as FileAnnotationDocument;
  disk.epubHighlights.push(highlight("remote", "另一设备"));
  vault.adapter.files.set(sidecarPath, JSON.stringify(disk, null, 2));

  await store.addEpubHighlight(vault.source, highlight("second", "第二条"));

  const merged = JSON.parse(vault.adapter.files.get(sidecarPath)!) as FileAnnotationDocument;
  const backup = JSON.parse(vault.adapter.files.get(`${sidecarPath}.bak`)!) as FileAnnotationDocument;
  assert.deepEqual(merged.epubHighlights.map((item) => item.id), ["first", "second", "remote"]);
  assert.deepEqual(backup.epubHighlights.map((item) => item.id), ["first", "remote"]);
});

test("AnnotationStore refuses to overwrite a corrupted sidecar", async () => {
  const vault = new FakeVault();
  const store = new AnnotationStore(createApp(vault) as never);
  await store.initialize();
  await store.addEpubHighlight(vault.source, highlight("first", "第一条"));

  const sidecarPath = store.toSidecarPath(vault.source.path);
  vault.adapter.files.set(sidecarPath, "{broken");

  await assert.rejects(
    store.addEpubHighlight(vault.source, highlight("second", "第二条")),
    (error: unknown) => error instanceof AnnotationStoreReadError,
  );
  assert.equal(vault.adapter.files.get(sidecarPath), "{broken");
});

test("AnnotationStore rebuilds a corrupted derived index without reading backup files", async () => {
  const vault = new FakeVault();
  const firstStore = new AnnotationStore(createApp(vault) as never);
  await firstStore.initialize();
  await firstStore.addEpubHighlight(vault.source, highlight("first", "第一条"));
  vault.adapter.files.set(".obsidian-annotations/index.json", "{broken");

  const secondStore = new AnnotationStore(createApp(vault) as never);
  await secondStore.initialize();

  const documents = await secondStore.getIndexedDocuments();
  assert.equal(documents.length, 1);
  assert.equal(documents[0]?.epubHighlights[0]?.id, "first");
  assert.equal(await vault.adapter.exists(".obsidian-annotations/index.json.bak"), true);
});

test("AnnotationStore does not change the main sidecar when backup creation fails", async () => {
  const vault = new FakeVault();
  const store = new AnnotationStore(createApp(vault) as never);
  await store.initialize();
  await store.addEpubHighlight(vault.source, highlight("first", "第一条"));

  const sidecarPath = store.toSidecarPath(vault.source.path);
  const before = vault.adapter.files.get(sidecarPath);
  vault.adapter.failBackup = true;

  await assert.rejects(store.addEpubHighlight(vault.source, highlight("second", "第二条")));
  assert.equal(vault.adapter.files.get(sidecarPath), before);
});
