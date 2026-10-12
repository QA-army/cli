// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)) {
  throw new Error("package.json contains an invalid version");
}

writeFileSync(
  new URL("../src/version.ts", import.meta.url),
  `// SPDX-License-Identifier: MIT\n// Generated from package.json by scripts/generate-version.mjs.\nexport const QA_ARMY_CLI_VERSION = ${JSON.stringify(manifest.version)};\n`,
);
