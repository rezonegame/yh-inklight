import { build } from "esbuild";
import { mkdir, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const testDir = path.join(root, "tests");
const outputDir = path.join(root, ".test-build");

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
    outExtension: { ".js": ".mjs" },
    logLevel: "silent",
    // The real `obsidian` package ships type definitions only (no runtime
    // entry), so it cannot be bundled for Node. Alias it to a minimal shim
    // that the test graph (i18n + annotation-link service) actually touches.
    alias: { obsidian: path.join(root, "tests", "obsidian-shim.ts") },
  });

  const files = (await readdir(outputDir))
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => path.join(outputDir, name));
  const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  // Best-effort cleanup; never let a sandbox/safe-delete failure mask the result.
  try {
    await rm(outputDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
}
