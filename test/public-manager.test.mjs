// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { queryDirectory } from "../src/directory.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "unlisted-package");

test("a valid unlisted local package remains independently verifiable through the public manager", {
  skip: process.env.FGPM_PUBLIC_NODE && process.env.FGPM_PUBLIC_ENTRY
    ? false
    : "set FGPM_PUBLIC_NODE and FGPM_PUBLIC_ENTRY to an extracted public manager",
}, async () => {
  const query = await queryDirectory({ filters: { namespace: "22222222-3333-4444-8555-666666666666", name: "example.unlisted-local" } });
  assert.equal(query.status, "not-known");
  assert.equal(query.meaning, "not known to these sources");
  const { stdout } = await execFileAsync(process.env.FGPM_PUBLIC_NODE, [process.env.FGPM_PUBLIC_ENTRY, "package", "identity", root, "--json"], { windowsHide: true });
  const identity = JSON.parse(stdout);
  const declaration = JSON.parse(await readFile(resolve(root, "fgpm-package.json"), "utf8"));
  assert.equal(declaration.namespace, "22222222-3333-4444-8555-666666666666");
  assert.equal(declaration.name, "example.unlisted-local");
  assert.equal(identity.status, "computed");
  assert.equal(identity.exitCode, 0);
  assert.match(identity.observed, /^sha256:[0-9a-f]{64}$/);
});
