import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";

import { initialReadingNote } from "../src/readingNotes/readingNoteBinding";
import { assertReadingNoteIdentity, readReadingNoteIdentity, rewriteReadingNoteSource } from "../src/readingNotes/readingNoteIdentity";

function file(path: string): TFile {
  const value = new TFile();
  Object.assign(value, { path, extension: path.split(".").pop(), basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") });
  return value;
}

test("only explicitly marked reading notes match their bound source", () => {
  const note = initialReadingNote(file("books/one.pdf"));
  assert.equal(readReadingNoteIdentity(note).sourcePath, "books/one.pdf");
  assert.doesNotThrow(() => assertReadingNoteIdentity(note, "books/one.pdf"));
  assert.throws(() => assertReadingNoteIdentity(note, "books/two.pdf"), /来源与 sidecar/);
  assert.throws(() => assertReadingNoteIdentity("# 旧阅读笔记导出\n来源：[[books/one.pdf]]", "books/one.pdf"), /frontmatter/);
  assert.throws(() => assertReadingNoteIdentity(note.replace("type: inklight-reading-note", "type: unrelated"), "books/one.pdf"), /有效的墨光/);
  assert.throws(() => assertReadingNoteIdentity(note.replace("<!-- yh-inklight:managed:end -->", ""), "books/one.pdf"), /受管标记/);
  assert.throws(() => assertReadingNoteIdentity(note.replace("inklight-source:", 'inklight-source: "books/fake.pdf"\ninklight-source:'), "books/one.pdf"), /来源字段缺失或重复/);
});

test("migration preserves CRLF handwritten content outside the managed section", () => {
  const note = initialReadingNote(file("books/old.pdf")).replaceAll("\n", "\r\n")
    .replace("## 我的笔记\r\n", "## 我的笔记\r\n> [!note] 手写\r\n```text\r\n原文\r\n```\r\n");
  const updated = rewriteReadingNoteSource(note, "books/old.pdf", "books/new.pdf", "### 第 1 页");
  assert.match(updated, /## 我的笔记\r\n> \[!note\] 手写\r\n```text\r\n原文\r\n```\r\n/);
});

test("source migration changes only declared source, source link and managed projection", () => {
  const oldPath = "books/old.pdf";
  const note = initialReadingNote(file(oldPath)).replace("## 我的笔记\n", "## 我的笔记\n中文手写 **不修改**\n");
  const updated = rewriteReadingNoteSource(note, oldPath, "books/new.pdf", "### 第 2 页\n> [返回原文](obsidian://inklight?file=books%2Fnew.pdf&id=a)");
  assert.match(updated, /inklight-source: "books\/new.pdf"/);
  assert.match(updated, /来源：\[\[books\/new.pdf\]\]/);
  assert.match(updated, /中文手写 \*\*不修改\*\*/);
  assert.match(updated, /file=books%2Fnew.pdf/);
  assert.doesNotThrow(() => assertReadingNoteIdentity(updated, "books/new.pdf"));
  assert.throws(() => rewriteReadingNoteSource(note.replace("来源：[[books/old.pdf]]", "来源已手动修改"), oldPath, "books/new.pdf", ""), /来源链接已修改/);
  const manualOnly = note.replace("来源：[[books/old.pdf]]", "来源已手动修改")
    .replace("## 我的笔记", "## 我的笔记\n来源：[[books/old.pdf]]");
  assert.throws(() => rewriteReadingNoteSource(manualOnly, oldPath, "books/new.pdf", ""), /来源链接已修改/);
  const withDescription = note.replace("type: inklight-reading-note", 'description: "来源：[[books/old.pdf]]"\ntype: inklight-reading-note');
  const descriptionSafe = rewriteReadingNoteSource(withDescription, oldPath, "books/new.pdf", "");
  assert.match(descriptionSafe, /description: "来源：\[\[books\/old.pdf\]\]"/);
  assert.match(descriptionSafe, /来源：\[\[books\/new.pdf\]\]/);
});

test("confirmation can repair source metadata without touching managed or handwritten text", () => {
  const source = file("books/book.pdf");
  const note = initialReadingNote(source)
    .replace('inklight-source: "books/book.pdf"', 'inklight-source: "books/wrong.pdf"')
    .replace("## 我的笔记\n", "## 我的笔记\n手写内容\n")
    .replace("<!-- yh-inklight:managed:start -->\n", "<!-- yh-inklight:managed:start -->\n原有投影\n");
  const repaired = rewriteReadingNoteSource(note, "books/wrong.pdf", source.path, null);
  assert.match(repaired, /手写内容/);
  assert.match(repaired, /原有投影/);
  assert.doesNotThrow(() => assertReadingNoteIdentity(repaired, source.path));
});
