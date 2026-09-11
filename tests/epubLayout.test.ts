import assert from "node:assert/strict";
import test from "node:test";

import { escapeEpubFontFamilyCss, getEpubFontFamilyCss, getEpubLayoutAttributes } from "../src/epub/EpubLayoutController";

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
