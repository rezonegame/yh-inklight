import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import { AnnotationSidebarView } from "../src/views/sidebarView";
import { isPdfOverlayMutation } from "../src/pdf/pdfAnnotationLayer";

function setup() {
  const file = Object.assign(new TFile(), { path: "book.md", extension: "md" });
  let active: TFile | null = file;
  let exists = true, reads = 0;
  const document = { filePath: file.path, highlights: [], comments: [], pdfHighlights: [], pdfComments: [], epubHighlights: [], epubComments: [] };
  const store = { version: 1, async getDocument() { reads++; return document; }, async getIndexedDocuments() { reads++; return [document]; } };
  const view = new AnnotationSidebarView({ containerEl: {}, app: { workspace: { getActiveFile: () => active }, vault: { getAbstractFileByPath: () => exists ? file : null } } } as any, { store } as any) as any;
  return { view, store, file, reads: () => reads, blur: () => { active = null; }, remove: () => { exists = false; } };
}

test("the sidebar retains its reading source when the drawer takes focus, but not after deletion", () => {
  const fixture = setup();
  assert.equal(fixture.view.sourceFile(), fixture.file);
  fixture.blur();
  assert.equal(fixture.view.sourceFile(), fixture.file);
  fixture.remove();
  assert.equal(fixture.view.sourceFile(), null);
  const fresh = setup();
  fresh.blur();
  fresh.view.setSourceFile(fresh.file);
  assert.equal(fresh.view.sourceFile(), fresh.file, "first open keeps the source captured before revealing the drawer");
});

test("sidebar card cache is reused until data version or scope changes", async () => {
  const fixture = setup();
  const initial = await fixture.view.loadCards(fixture.file);
  assert.equal(await fixture.view.loadCards(fixture.file), initial);
  assert.equal(fixture.reads(), 1);
  fixture.store.version++;
  await fixture.view.loadCards(fixture.file);
  assert.equal(fixture.reads(), 2);
  fixture.view.annotationScope = "all";
  await fixture.view.loadCards(fixture.file);
  assert.equal(fixture.reads(), 3);
  await fixture.view.onClose();
  assert.equal(fixture.view.cardCache, null);
});

test("PDF mutation filtering excludes own overlays but not page/text/style updates", () => {
  const own = { nodeType: 1, closest: () => ({}) } as any;
  const page = { nodeType: 1, closest: () => null } as any;
  const mutation = (target: any, addedNodes: any[] = [], removedNodes: any[] = []) => ({ target, addedNodes, removedNodes }) as unknown as MutationRecord;
  assert.equal(isPdfOverlayMutation(mutation(own)), true);
  assert.equal(isPdfOverlayMutation(mutation(page, [own])), true);
  assert.equal(isPdfOverlayMutation(mutation(page, [], [own])), true);
  assert.equal(isPdfOverlayMutation(mutation(page, [page])), false);
  assert.equal(isPdfOverlayMutation(mutation(page, [own, page])), false);
  assert.equal(isPdfOverlayMutation(mutation(page)), false);
});
