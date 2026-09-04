import assert from "node:assert/strict";
import test from "node:test";

import {
	isEpubSearchTokenCurrent,
	normalizeEpubSearchResult,
	normalizeEpubSearchResults,
} from "../src/epub/EpubSearch";

test("normalizes foliate search results from arrays and chapter subitems", () => {
	assert.deepEqual(
		normalizeEpubSearchResults({
			label: "第一章",
			subitems: [{ cfi: "epubcfi(/1)", excerpt: { pre: "前", match: "中", post: "后" } }],
		}),
		[{ cfi: "epubcfi(/1)", excerpt: "前中后", label: "第一章" }],
	);
	assert.deepEqual(
		normalizeEpubSearchResults([{ value: "epubcfi(/2)", text: "命中" }]),
		[{ cfi: "epubcfi(/2)", excerpt: "命中", label: undefined }],
	);
});

test("ignores unusable search result values", () => {
	assert.equal(normalizeEpubSearchResult(null), null);
	assert.equal(normalizeEpubSearchResult({}), null);
	assert.deepEqual(normalizeEpubSearchResults({ results: [null, {}, { text: "只有文本" }] }), [
		{ cfi: "", excerpt: "只有文本", label: undefined },
	]);
});

test("stale search tokens cannot render over the current query", () => {
	assert.equal(isEpubSearchTokenCurrent(4, 4), true);
	assert.equal(isEpubSearchTokenCurrent(4, 5), false);
});
