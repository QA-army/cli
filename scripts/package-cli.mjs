// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist", "package");
const npmExecutable = process.env.npm_execpath;
if (!npmExecutable) throw new Error("npm_execpath is required to package the QA.army CLI");

mkdirSync(output, { recursive: true });
execFileSync(
  process.execPath,
  [npmExecutable, "pack", "--pack-destination", output],
  { cwd: root, stdio: "inherit" },
);
