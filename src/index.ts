#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { runCli } from "./cli.js";

const code = await runCli(process.argv.slice(2), process.env, {
  out: (value) => process.stdout.write(`${value}\n`),
  error: (value) => process.stderr.write(`${value}\n`),
});
process.exitCode = code;
