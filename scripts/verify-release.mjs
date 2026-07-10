import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
const version = manifest.version;

const mismatches = [
  ["package.json", pkg.version],
  ["package-lock.json", lock.version],
  ["package-lock packages root", lock.packages?.[""]?.version],
].filter(([, value]) => value !== version);

if (!versions[version]) {
  mismatches.push(["versions.json", undefined]);
}

const tag = process.env.GITHUB_REF_NAME;
if (tag && process.env.GITHUB_REF_TYPE === "tag" && tag !== version) {
  mismatches.push(["git tag", tag]);
}

if (mismatches.length) {
  throw new Error(`Version mismatch for ${version}: ${mismatches.map(([name, value]) => `${name}=${value ?? "missing"}`).join(", ")}`);
}

console.info(`yh-inklight release metadata verified: ${version}`);
