import assert from "node:assert/strict";
import test from "node:test";
import { findBestFuzzyMatch } from "../src/anchor/fuzzyMatch";
import { referenceFuzzyMatch } from "./support/fuzzy-reference";

test("bounded visual matching never changes an exact quote or the legacy result", () => {
  const source = "A short paragraph with a colour in the middle and an ending.";
  assert.deepEqual(findBestFuzzyMatch(source, "a colour", 0, { comparisons: 0, cells: 0 }), { startOffset: 23, endOffset: 31, confidence: 1 });
  const legacy = findBestFuzzyMatch(source, "a color", 23);
  assert.ok(legacy);
  assert.deepEqual(findBestFuzzyMatch(source, "a color", 23, { comparisons: 10_000, cells: 10_000_000 }), legacy);
});

test("shared visual budgets bound work and reject incomplete approximate searches", () => {
  const budget = { comparisons: 256, cells: 250_000, exhausted: false };
  const source = "abcdefghij ".repeat(20_000);
  assert.equal(findBestFuzzyMatch(source, "ZYXWVUTSRQPONMLKJIHGFEDCBA".repeat(2), 0, budget), null);
  assert.equal(budget.exhausted, true);
  assert.ok(budget.cells >= 0 && budget.comparisons >= 0);
  const remaining = { ...budget };
  for (let i = 0; i < 500; i++) assert.equal(findBestFuzzyMatch(source, "missing quote", 0, budget), null);
  assert.deepEqual(budget, remaining);
  assert.equal(findBestFuzzyMatch(source, "abcdefghij", 0, budget)?.confidence, 1);
});

test("running out of visual budget cannot produce a low-confidence early match", () => {
  assert.equal(findBestFuzzyMatch("a small change at the beginning followed by more text", "a smoll change", 0, { comparisons: 1, cells: 100_000 }), null);
});

test("pruning preserves legacy match positions and confidence across Unicode and edited quotes", () => {
  let seed = 20261023;
  const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const alphabet = "abcde 中国测试\n ΑΒγß🙂";
  for (let i = 0; i < 180; i++) {
    const source = Array.from({ length: 80 + random(80) }, () => alphabet[random(alphabet.length)]).join("");
    const start = random(50);
    const quote = source.slice(start, start + 5 + random(15));
    const target = i % 3 === 0 ? quote.toUpperCase() : i % 3 === 1 ? `${quote.slice(0, 2)}#${quote.slice(3)}` : quote.slice(1);
    const expected = random(300);
    assert.deepEqual(findBestFuzzyMatch(source, target, expected), referenceFuzzyMatch(source, target, expected), `case ${i}`);
  }
});
