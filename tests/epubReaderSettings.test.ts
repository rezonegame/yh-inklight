import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { EpubReaderView } from "../src/epub/EpubReaderView";
import { DEFAULT_EPUB_READING_PROFILE, type EpubReadingProfile } from "../src/storage/types";

function setup(t: TestContext) {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
	const timers = new Map<number, () => void>();
	let timerId = 0;
	Object.defineProperty(globalThis, "window", { configurable: true, value: {
		setTimeout(callback: () => void) { const id = ++timerId; timers.set(id, callback); return id; },
		clearTimeout(id: number) { timers.delete(id); },
	} });
	Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: true } });
	t.after(() => {
		if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
		else Reflect.deleteProperty(globalThis, "window");
		if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
		else Reflect.deleteProperty(globalThis, "document");
	});
	let stored: EpubReadingProfile = { ...DEFAULT_EPUB_READING_PROFILE, flow: "paginated" };
	const saved: EpubReadingProfile[] = [];
	const view = new EpubReaderView(
		{ containerEl: { toggleClass() {} } } as any, {} as any, {} as any,
		() => undefined, () => undefined, () => stored,
		async profile => { stored = { ...profile }; saved.push(stored); },
		async () => stored, {} as any, () => undefined,
	);
	const internals = view as unknown as {
		updateReadingProfile(profile: EpubReadingProfile): void;
		readingProfile: EpubReadingProfile;
	};
	return { view, internals, saved, timers, change: () => internals.updateReadingProfile({ ...stored, flow: "scrolled" }) };
}

test("an annotation refresh cannot revert an unsaved book flow selection", async t => {
	const { view, internals, saved, timers, change } = setup(t);
	change();
	view.refreshExternalSettings();
	assert.equal(internals.readingProfile.flow, "scrolled");
	for (const callback of [...timers.values()]) callback();
	assert.equal(saved[0].flow, "scrolled");
	await view.onClose();
});

test("replacing a book flushes its pending flow setting", async t => {
	const { view, saved, timers, change } = setup(t);
	change();
	await view.onUnloadFile({} as any);
	assert.equal(saved[0].flow, "scrolled");
	assert.equal(timers.size, 0);
	await view.onClose();
});

test("closing the reader flushes its pending flow setting", async t => {
	const { view, saved, timers, change } = setup(t);
	change();
	await view.onClose();
	assert.equal(saved[0].flow, "scrolled");
	assert.equal(timers.size, 0);
});

test("a profile save failure does not prevent reader cleanup", async t => {
	const { view, timers, change } = setup(t);
	const internals = view as any;
	let disposed = false;
	internals.saveReadingProfile = async () => { throw new Error("device save unavailable"); };
	internals.navigationController.dispose = () => { disposed = true; };
	t.mock.method(console, "error", () => undefined);
	change();
	await assert.doesNotReject(view.onClose());
	assert.equal(disposed, true);
	assert.equal(timers.size, 0);
});
