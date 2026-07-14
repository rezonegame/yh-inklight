import assert from "node:assert/strict";
import test from "node:test";

import { createAnnotationUri, readProtocolParam } from "../src/links/annotationLink";

test("annotation URI encodes source paths and IDs", () => {
  assert.equal(
    createAnnotationUri("资料/一本书.pdf", "annotation id"),
    "obsidian://inklight?file=%E8%B5%84%E6%96%99%2F%E4%B8%80%E6%9C%AC%E4%B9%A6.pdf&id=annotation%20id",
  );
});

test("protocol parameters accept strings and ignore non-strings", () => {
  assert.equal(readProtocolParam("a%20b"), "a b");
  assert.equal(readProtocolParam(["x"]), "");
});
