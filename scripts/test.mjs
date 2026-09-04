import { build } from "esbuild";
import { mkdir, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const testDir = path.join(root, "tests");
const outputDir = path.join(root, ".test-build");
const obsidianStub = path.join(testDir, "support", "obsidian-stub.mjs");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

try {
  const entryPoints = (await readdir(testDir))
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => path.join(testDir, name));

  if (!entryPoints.length) {
    throw new Error("No test files found.");
  }

  await build({
    entryPoints,
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    plugins: [{
      name: "test-obsidian-stub",
      setup(buildContext) {
        buildContext.onResolve({ filter: /^obsidian$/ }, () => ({ path: obsidianStub }));
      },
    }],
    outExtension: { ".js": ".mjs" },
    logLevel: "silent",
  });

  const files = (await readdir(outputDir))
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => path.join(outputDir, name));
  const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
