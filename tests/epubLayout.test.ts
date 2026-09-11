import assert from "node:assert/strict";
import test from "node:test";

import { escapeEpubFontFamilyCss, getEpubAppearanceColors, getEpubFontFamilyCss, getEpubLayoutAttributes } from "../src/epub/EpubLayoutController";

test("generates stable paginated EPUB layout attributes", () => {
	assert.deepEqual(getEpubLayoutAttributes("paginated"), {
		flow: "paginated",
		margin: "28px",
		gap: "8%",
		"max-inline-size": "760px",
	});
});

test("generates stable scrolled EPUB layout attributes", () => {
	assert.deepEqual(getEpubLayoutAttributes("scrolled"), {
		flow: "scrolled",
		margin: "0px",
		gap: "8%",
		"max-inline-size": "760px",
	});
});

test("uses the profile content width and a local font stack", () => {
	assert.equal(getEpubLayoutAttributes("scrolled", 900)["max-inline-size"], "900px");
	assert.match(getEpubFontFamilyCss("serif"), /Noto Serif SC/);
	assert.equal(getEpubFontFamilyCss("publisher"), "");
});

test("puts a custom installed font before the selected fallback stack", () => {
	assert.equal(
		getEpubFontFamilyCss("sans", true, "Microsoft YaHei"),
		'"Microsoft YaHei", -apple-system, BlinkMacSystemFont, \'Segoe UI\', \'Noto Sans SC\', sans-serif',
	);
	assert.equal(getEpubFontFamilyCss("publisher", true, "LXGW WenKai"), '"LXGW WenKai", serif');
	assert.equal(escapeEpubFontFamilyCss('A"B\\C'), 'A\\"B\\\\C');
});

test("uses strict black and white colors for e-ink mode", () => {
	const colors = {
		background: "#123456",
		textColor: "#abcdef",
		linkColor: "#fedcba",
		selectionBg: "rgba(1, 2, 3, 0.2)",
		accent: "#987654",
	};
	assert.deepEqual(getEpubAppearanceColors(colors, false), colors);
	assert.deepEqual(getEpubAppearanceColors(colors, true), {
		background: "#ffffff",
		textColor: "#000000",
		linkColor: "#000000",
		selectionBg: "#000000",
		accent: "#000000",
	});
});
