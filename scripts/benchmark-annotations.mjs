import { build, transform } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const exportsOf = code => import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const baselineSource = execFileSync("git", ["show", "0.23.7:src/anchor/fuzzyMatch.ts"], { encoding: "utf8" });
const baseline = await exportsOf((await transform(baselineSource, { loader: "ts", format: "esm" })).code);
const current = await exportsOf((await build({ entryPoints: ["src/anchor/fuzzyMatch.ts"], bundle: true, write: false, format: "esm", platform: "node" })).outputFiles[0].text);
const results = [];
for (const chars of [5000, 20000, 50000]) {
  const source = "abcdefghij ".repeat(Math.ceil(chars / 11)).slice(0, chars);
  const target = "ZYXWVUTSRQPONMLKJIHGFEDCBA".repeat(2);
  const start = performance.now();
  const oldResult = baseline.findBestFuzzyMatch(source, target, 0);
  const oldMs = performance.now() - start;
  const fullStart = performance.now();
  const currentResult = current.findBestFuzzyMatch(source, target, 0);
  const currentMs = performance.now() - fullStart;
  const next = performance.now();
  const budget = { comparisons: 256, cells: 250_000 };
  const result = current.findBestFuzzyMatch(source, target, 0, budget);
  const boundedMs = performance.now() - next;
  if (oldResult !== null || currentResult !== null || result !== null) throw new Error("Synthetic missing quote unexpectedly matched");
  results.push({ chars, targetChars: target.length, baselineMs: Math.round(oldMs * 100) / 100, currentFullSearchMs: Math.round(currentMs * 100) / 100, boundedVisualMs: Math.round(boundedMs * 100) / 100, budgetExhausted: budget.exhausted, sameMissingResult: true });
}
await mkdir("output/playwright", { recursive: true });
await writeFile("output/playwright/annotation-benchmark.json", JSON.stringify({ baseline: "0.23.7", results, scope: "Single synthetic missing quote. Full-search pruning preserves legacy acceptance thresholds; visual projection adds a budget. Timings are single runs, not device guarantees." }, null, 2));
console.log(JSON.stringify(results, null, 2));
