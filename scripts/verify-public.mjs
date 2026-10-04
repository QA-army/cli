import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const listing = execFileSync("tar", ["-tzf", `dist/package/${manifest.name}-${manifest.version}.tgz`], {encoding: "utf8"}).trim().split("\n");
for (const path of listing) assert.match(path, /^package\/(dist\/src\/|docs\/|examples\/|skills\/|LICENSE$|README.md$|package.json$)/, `Unexpected public file: ${path}`);
assert(listing.includes("package/dist/src/index.js"));
console.log(`Verified ${listing.length} public package paths`);
