import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const archive = `dist/package/${manifest.name}-${manifest.version}.tgz`;
const listing = execFileSync("tar", ["-tzf", archive], {encoding: "utf8"}).trim().split(/\r?\n/);
for (const path of listing) assert.match(path, /^package\/(dist\/src\/|docs\/|examples\/|skills\/|LICENSE$|README.md$|package.json$)/, `Unexpected public file: ${path}`);
assert(listing.includes("package/dist/src/index.js"));
const unpacked = mkdtempSync(join(resolve("dist"), "verify-package-"));
try {
  execFileSync("tar", ["-xzf", archive, "-C", unpacked]);
  const reportedVersion = execFileSync(
    process.execPath,
    [join(unpacked, "package", "dist", "src", "index.js"), "--version"],
    { encoding: "utf8" },
  ).trim();
  assert.equal(reportedVersion, manifest.version, "Packaged CLI version must match package.json");
} finally {
  rmSync(unpacked, { recursive: true, force: true });
}
console.log(`Verified ${listing.length} public package paths`);
