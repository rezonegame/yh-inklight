import assert from "node:assert/strict";
import test from "node:test";

import { getEpubLayoutAttributes } from "../src/epub/EpubLayoutController";

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
