import assert from "node:assert/strict";
import test from "node:test";

import {
  cloneDefaultAnnotationTags,
  resolveAnnotationTag,
  validateAnnotationTags,
} from "../src/tags/tagDomain";

test("default annotation tags are valid", () => {
  assert.equal(validateAnnotationTags(cloneDefaultAnnotationTags()), null);
});

test("tag names reject whitespace, case, and full-width duplicates", () => {
  const tags = cloneDefaultAnnotationTags();
  tags[1].name = "　洞见  ";
  assert.equal(validateAnnotationTags(tags), "标签名称已存在。");

  tags[0].name = "Insight";
  tags[1].name = "INSIGHT";
  assert.equal(validateAnnotationTags(tags), "标签名称已存在。");
});

test("only five annotation tags may be enabled", () => {
  const tags = cloneDefaultAnnotationTags();
  tags.push(
    { id: "custom-a", name: "摘录", icon: "bookmark", enabled: true },
    { id: "custom-b", name: "待办", icon: "flag", enabled: true },
    { id: "custom-c", name: "复习", icon: "star", enabled: true },
  );
  assert.equal(validateAnnotationTags(tags), "最多只能启用 5 个标签。");
});

test("current tag definitions override old snapshots and legacy values", () => {
  const tags = cloneDefaultAnnotationTags();
  tags[0].name = "观点";
  const resolved = resolveAnnotationTag(tags, {
    tagId: "insight",
    tagLabelSnapshot: "旧洞见",
    title: "Insight",
  });
  assert.deepEqual(resolved, {
    id: "insight",
    name: "观点",
    icon: "lightbulb",
    enabled: true,
    unavailable: false,
  });
});

test("legacy title and EPUB noteType resolve to the same tag", () => {
  const tags = cloneDefaultAnnotationTags();
  assert.equal(resolveAnnotationTag(tags, { title: "Question" })?.id, "question");
  assert.equal(resolveAnnotationTag(tags, { noteType: "question" })?.id, "question");
});

test("unknown legacy labels stay visible instead of becoming unclassified", () => {
  const resolved = resolveAnnotationTag(cloneDefaultAnnotationTags(), { title: "待研究" });
  assert.equal(resolved?.name, "待研究");
  assert.equal(resolved?.unavailable, true);
});
