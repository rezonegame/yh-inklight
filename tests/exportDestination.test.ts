import assert from "node:assert/strict";
import test from "node:test";

import { TFile, TFolder } from "obsidian";

import { AnnotationStore } from "../src/storage/annotationStore";
import { normalizeExportFolder } from "../src/storage/exportDestination";

class TestFile extends TFile {
  constructor(public override path: string) {
    super();
    this.name = path.split("/").pop()!;
    this.basename = this.name.replace(/\.[^.]+$/, "");
    this.extension = this.name.split(".").pop()!;
    this.parent = Object.assign(new TFolder(), { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/" });
  }
}

function fixture(sourcePath = "reading/book.md") {
  const entries = new Map<string, TFile | TFolder>();
  const contents = new Map<string, string>();
  const create = async (path: string, text: string) => {
    if (entries.has(path)) throw new Error("already exists");
    const file = new TestFile(path);
    entries.set(path, file);
    contents.set(path, text);
    return file;
  };
  const hooks: { beforeProcess?: (file: TFile) => void } = {};
  const read = async (file: TFile) => contents.get(file.path)!;
  const vault = {
    adapter: {
      exists: async (path: string) => entries.has(path),
    },
    getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
    createFolder: async (path: string) => {
      if (entries.has(path)) throw new Error("already exists");
      entries.set(path, Object.assign(new TFolder(), { path }));
    },
    create,
    read,
    cachedRead: read,
    process: async (file: TFile, update: (text: string) => string) => {
      hooks.beforeProcess?.(file);
      const text = update(contents.get(file.path)!);
      contents.set(file.path, text);
      return text;
    },
    rename: async (file: TFile, path: string) => {
      const oldPath = file.path;
      const text = contents.get(oldPath)!;
      entries.delete(oldPath);
      contents.delete(oldPath);
      file.path = path;
      entries.set(path, file);
      contents.set(path, text);
    },
  };
  const store = new AnnotationStore({ vault } as never);
  const source = new TestFile(sourcePath);
  return { store, source, create, contents, entries, hooks };
}

test("export folders accept vault-relative paths, the vault root, and the empty default", () => {
  assert.equal(normalizeExportFolder(" 摘录\\学习/ "), "摘录/学习");
  assert.equal(normalizeExportFolder(" / "), "/");
  assert.equal(normalizeExportFolder("  "), "");
  for (const invalid of ["../outside", "all/../elsewhere", "./folder", "C:\\Notes", "\\", "/Notes", "//share/path", "a//b", "a/.. ", "a/b.", "a/b?c", "exports/NUL", 123]) {
    assert.equal(normalizeExportFolder(invalid), null);
  }
});

test("single and vault-wide export share a custom folder and preserve legacy defaults", async () => {
  const { store, source, contents, entries } = fixture();
  assert.equal((await store.exportNotes(source)).path, "reading/book-notes.md");
  assert.equal((await store.exportAllNotes()).path, "inklight-all-notes.md");
  assert.equal((await store.exportNotes(source, "summary", "/")).path, "book-notes.md");
  assert.equal((await store.exportNotes(source, "notes-only", "摘录/学习")).path, "摘录/学习/book-notes-notes-only.md");
  assert.equal((await store.exportAllNotes("by-color", "摘录/学习")).path, "摘录/学习/inklight-all-notes-by-color.md");
  assert.ok(entries.get("摘录") instanceof TFolder);
  assert.ok(entries.get("摘录/学习") instanceof TFolder);
  const path = "reading/book-notes.md";
  assert.match(contents.get(path)!, /^<!-- yh-inklight:export:v1 /);
  await assert.rejects(store.exportNotes(source, "summary", "../outside"), /无效/);
});

test("export never overwrites unmarked files, edited files, or exports for another source", async () => {
  const { store, source, create, contents } = fixture();
  const ordinary = "# Notes for reading/book.md\n\nExported: 2026-11-13T12:00:00Z\n\nMy note";
  await create("Exports/book-notes.md", ordinary);
  const first = await store.exportNotes(source, "summary", "Exports");
  assert.equal(first.path, "Exports/book-notes (2).md");
  assert.equal(await store.exportNotes(source, "summary", "Exports"), first);
  const edited = contents.get(first.path)! + "\nMy handwritten notes";
  contents.set(first.path, edited);
  const next = await store.exportNotes(source, "summary", "Exports");
  assert.equal(next.path, "Exports/book-notes (3).md");
  const other = await store.exportNotes(new TestFile("elsewhere/book.md"), "summary", "Exports");
  assert.equal(other.path, "Exports/book-notes (4).md");
  assert.equal(contents.get("Exports/book-notes.md"), ordinary);
  assert.equal(contents.get(first.path), edited);
  assert.notEqual(contents.get(other.path), contents.get(next.path));
});

test("export preserves a concurrent edit detected by Vault.process", async () => {
  const { store, source, contents, hooks } = fixture();
  const first = await store.exportNotes(source);
  hooks.beforeProcess = (file) => contents.set(file.path, contents.get(file.path)! + "\nConcurrent edit");
  assert.equal((await store.exportNotes(source)).path, "reading/book-notes (2).md");
  assert.match(contents.get(first.path)!, /Concurrent edit$/);
});

test("custom folders preserve annotation text, tags, and the original deep link", async () => {
  const { store, source, contents } = fixture("阅读/原文.md");
  const document = await store.getDocument(source);
  const time = "2026-11-13T12:00:00Z";
  document.comments.push({
    id: "note 1",
    color: "yellow",
    anchor: { startOffset: 0, endOffset: 4, selectedText: "选中的文字", prefix: "", suffix: "" },
    content: "我的批注",
    title: "疑问",
    author: "读者",
    createdAt: time,
    updatedAt: time,
  });
  const output = await store.exportNotes(source, "notes-only", "摘录");
  const markdown = contents.get(output.path)!;
  assert.match(markdown, /选中的文字/);
  assert.match(markdown, /我的批注/);
  assert.match(markdown, /标签：疑问/);
  assert.ok(markdown.includes(`obsidian://inklight?file=${encodeURIComponent(source.path)}&id=note%201`));
});

test("a file blocking the configured folder fails without exporting elsewhere", async () => {
  const { store, source, create, contents } = fixture();
  await create("Exports", "do not overwrite");
  await assert.rejects(store.exportNotes(source, "summary", "Exports/nested"), /目录不可用：Exports/);
  assert.deepEqual([...contents], [["Exports", "do not overwrite"]]);
});

test("source migration keeps owned exports reusable and leaves unrelated or edited files alone", async () => {
  const { store, source, create, contents } = fixture();
  const migrate = Reflect.get(store, "migrateExcerptFile").bind(store);
  const first = await store.exportNotes(source);
  await migrate(source.path, "reading/moved.md");
  const moved = await store.exportNotes(new TestFile("reading/moved.md"));
  assert.equal(moved, first);
  assert.equal(moved.path, "reading/moved-notes.md");

  const edited = contents.get(moved.path)! + "\nHandwritten";
  contents.set(moved.path, edited);
  await migrate("reading/moved.md", "reading/changed.md");
  assert.equal(contents.get(moved.path), edited);
  await create("reading/user-notes.md", "A personal note about reading/user.md");
  await migrate("reading/user.md", "reading/renamed.md");
  assert.equal(contents.get("reading/user-notes.md"), "A personal note about reading/user.md");
  await create("reading/legacy-notes.md", "# Notes for reading/legacy.md\n\nExported: 2026-11-13T12:00:00Z\n\nNo annotations found.\n");
  await migrate("reading/legacy.md", "reading/legacy-moved.md");
  assert.match(contents.get("reading/legacy-moved-notes.md")!, /^# Notes for reading\/legacy-moved\.md/);
});

test("a custom-folder export does not move with its source even if they share a directory", async () => {
  const { store, source, contents } = fixture();
  const exported = await store.exportNotes(source, "summary", "reading");
  const before = contents.get(exported.path);
  const migrate = Reflect.get(store, "migrateExcerptFile").bind(store);
  await migrate(source.path, "other/book.md");
  assert.equal(exported.path, "reading/book-notes.md");
  assert.equal(contents.get(exported.path), before);
});
