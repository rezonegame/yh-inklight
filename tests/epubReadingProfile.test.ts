import assert from "node:assert/strict";
import test from "node:test";

import {
	DEFAULT_EPUB_READING_PROFILE,
	createEpubReadingProfileFromLegacy,
	normalizeCustomEpubFontFamily,
	normalizeEpubReadingProfile,
} from "../src/storage/types";

test("migrates legacy EPUB settings without changing their visible values", () => {
	assert.deepEqual(createEpubReadingProfileFromLegacy({
		epubFontSize: 20,
		epubDefaultFlow: "paginated",
		epubReadingTheme: "sepia",
	}), {
		...DEFAULT_EPUB_READING_PROFILE,
		fontSize: 20,
		flow: "paginated",
		theme: "sepia",
	});
});

test("normalizes malformed EPUB profile values into the supported ranges", () => {
	assert.deepEqual(normalizeEpubReadingProfile({
		fontFamily: "unknown",
		fontSize: 99,
		lineHeight: 1.46,
		contentWidth: 555,
		textAlign: "justify",
		flow: "paginated",
		theme: "dark",
	}), {
		fontFamily: "publisher",
		customFontEnabled: false,
		customFontFamily: "",
		einkMode: false,
		fontSize: 28,
		lineHeight: 1.5,
		contentWidth: 560,
		textAlign: "justify",
		flow: "paginated",
		theme: "dark",
	});
});

test("normalizes a local font name without accepting CSS or path input", () => {
	assert.equal(normalizeCustomEpubFontFamily("  Microsoft YaHei  "), "Microsoft YaHei");
	assert.equal(normalizeCustomEpubFontFamily("LXGW WenKai"), "LXGW WenKai");
	assert.equal(normalizeCustomEpubFontFamily("font-family: serif"), "");
	assert.equal(normalizeCustomEpubFontFamily("C:\\Fonts\\custom.ttf"), "");
	assert.equal(normalizeCustomEpubFontFamily("A, sans-serif"), "");
	assert.equal(normalizeCustomEpubFontFamily("a\nb"), "");
});

test("keeps the custom font opt-in and migrates old profiles", () => {
	assert.equal(normalizeEpubReadingProfile({}).customFontEnabled, false);
	assert.equal(normalizeEpubReadingProfile({
		customFontEnabled: true,
		customFontFamily: " Microsoft YaHei ",
	}).customFontFamily, "Microsoft YaHei");
	assert.equal(normalizeEpubReadingProfile({
		customFontEnabled: true,
		customFontFamily: "bad; font-family: serif",
	}).customFontEnabled, false);
});

test("keeps e-ink mode opt-in while preserving an explicit device setting", () => {
	assert.equal(normalizeEpubReadingProfile({}).einkMode, false);
	assert.equal(normalizeEpubReadingProfile({ einkMode: true }).einkMode, true);
	assert.equal(normalizeEpubReadingProfile({ einkMode: "yes" }).einkMode, false);
});
