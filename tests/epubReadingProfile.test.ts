import assert from "node:assert/strict";
import test from "node:test";

import {
	DEFAULT_EPUB_READING_PROFILE,
	createEpubReadingProfileFromLegacy,
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
		fontSize: 28,
		lineHeight: 1.5,
		contentWidth: 560,
		textAlign: "justify",
		flow: "paginated",
		theme: "dark",
	});
});
