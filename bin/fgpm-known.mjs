#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
import { runCli } from "../src/cli.mjs";

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
});
