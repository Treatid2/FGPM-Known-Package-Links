// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { queryDirectory, validateDataset } from "../src/directory.mjs";
import { runCli } from "../src/cli.mjs";

const namespace = "11111111-2222-4333-8444-555555555555";
const rootA = `sha256:${"a".repeat(64)}`;
const rootB = `sha256:${"b".repeat(64)}`;

function record({ root = rootA, name = "example.package", checksum = null } = {}) {
  return {
    recordId: `record:${name}:${root}`,
    coordinate: { namespace, name, version: "1.0.0" },
    package: { format: "fgpm.package/1", contentRoot: root, license: "Apache-2.0", predecessor: null },
    declarations: {
      capabilities: ["example.capability"],
      interfaces: ["example.interface/1"],
      functions: ["example.function"],
    },
    publisher: {
      repository: "https://example.invalid/source",
      release: "https://example.invalid/release",
      artifact: "https://example.invalid/package.zip",
      checksum,
      receipt: null,
      sourceCommit: "1".repeat(40),
    },
    verification: {
      status: "publisher-declared",
      verifiedAt: "2026-09-23T00:00:00Z",
      archiveBytes: 123,
      archiveSha256: "c".repeat(64),
      method: "fixture",
    },
    availability: { status: "unknown", observedAt: "2026-09-23T00:00:00Z" },
    policy: { recommendation: "not-assessed", statement: null },
  };
}

function dataset(id, records) {
  return {
    schema: "fgpm.known-package-source/1",
    source: {
      id,
      name: id,
      version: "1",
      attribution: `fixture ${id}`,
      observedAt: "2026-09-23T00:00:00Z",
      url: null,
      manager: null,
    },
    records,
  };
}

async function workspace(t) {
  const root = process.env.FGPM_TEST_ROOT || tmpdir();
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, "fgpm-known-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(path, { recursive: true, force: true });
  });
  return path;
}

async function sourceFile(t, id, records) {
  const root = await workspace(t);
  const path = join(root, `${id}.json`);
  await writeFile(path, `${JSON.stringify(dataset(id, records), null, 2)}\n`);
  return path;
}

test("bundled reference dataset contains the 28 verified public package records", async () => {
  const result = await queryDirectory();
  assert.equal(result.status, "ok");
  assert.equal(result.count, 28);
  assert.equal(result.sourceReports[0].source.id, "treatid2.fgpm.stage-c-release");
  assert.ok(result.listings.every(({ record: item }) => item.verification.status === "exact-bytes-and-content-root-verified"));
});

test("search covers readable identity, capabilities, interfaces, functions, and version", async () => {
  const capability = await queryDirectory({ filters: { capability: "runtime.scheduler.barrier" } });
  assert.ok(capability.listings.some(({ record: item }) => item.coordinate.name === "demo.deterministic-scheduler-v2"));
  const byName = await queryDirectory({ filters: { query: "demo.camera", version: "0.1.0" } });
  assert.equal(byName.count, 1);
  const byInterface = await queryDirectory({ filters: { interface: "fgpm.demo.camera/1" } });
  assert.equal(byInterface.count, 1);
  const byFunction = await queryDirectory({ filters: { function: "pkg:demo.camera/camera/fixed" } });
  assert.equal(byFunction.count, 1);
});

test("zero sources succeeds and means only not known to these sources", async () => {
  const result = await queryDirectory({ includeDefault: false });
  assert.equal(result.status, "no-sources");
  assert.equal(result.count, 0);
  assert.equal(result.meaning, "not known to these sources");
});

test("same exact object from two sources preserves both listings and attribution", async (t) => {
  const one = await sourceFile(t, "source.one", [record()]);
  const two = await sourceFile(t, "source.two", [record()]);
  const result = await queryDirectory({ includeDefault: false, sources: [one, two] });
  assert.equal(result.count, 2);
  assert.deepEqual(result.listings.map((item) => item.source.id).sort(), ["source.one", "source.two"]);
  assert.deepEqual(result.conflicts.multiplyListedObjects, [{ contentRoot: rootA, sources: ["source.one", "source.two"] }]);
});

test("conflicting roots for one coordinate remain visible ambiguity", async (t) => {
  const one = await sourceFile(t, "source.one", [record({ root: rootA })]);
  const two = await sourceFile(t, "source.two", [record({ root: rootB })]);
  const result = await queryDirectory({ includeDefault: false, sources: [one, two] });
  assert.equal(result.count, 2);
  assert.equal(result.conflicts.ambiguousCoordinates.length, 1);
  assert.deepEqual(result.conflicts.ambiguousCoordinates[0].contentRoots, [rootA, rootB]);
});

test("missing sidecar remains null rather than inventing a URL", async (t) => {
  const path = await sourceFile(t, "source.no-sidecar", [record({ checksum: null })]);
  const result = await queryDirectory({ includeDefault: false, sources: [path] });
  assert.equal(result.listings[0].record.publisher.checksum, null);
});

test("malformed and offline sources are explicit without erasing valid sources", async (t) => {
  const valid = await sourceFile(t, "source.valid", [record()]);
  const root = await workspace(t);
  const malformed = join(root, "malformed.json");
  await writeFile(malformed, "{ not json");
  const partial = await queryDirectory({ includeDefault: false, sources: [valid, malformed] });
  assert.equal(partial.status, "partial");
  assert.equal(partial.count, 1);
  assert.equal(partial.sourceReports[1].status, "unavailable");
  const offline = await queryDirectory({ includeDefault: false, sources: ["https://example.invalid/source.json"], offline: true });
  assert.equal(offline.status, "sources-unavailable");
  assert.match(offline.sourceReports[0].error, /--offline/);
});

test("querying reads dataset facts but does not execute linked package code or mutate it", async (t) => {
  const root = await workspace(t);
  const marker = join(root, "executed.txt");
  const module = join(root, "package-module.mjs");
  await writeFile(module, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "executed");\n`);
  const before = await readFile(module, "utf8");
  const path = await sourceFile(t, "source.passive", [record()]);
  const result = await queryDirectory({ includeDefault: false, sources: [path], filters: { query: "example" } });
  assert.equal(result.count, 1);
  await assert.rejects(readFile(marker, "utf8"), /ENOENT/);
  assert.equal(await readFile(module, "utf8"), before);
});

test("human and JSON CLI outputs represent the same query result", async () => {
  const capture = () => {
    let stdout = "";
    let stderr = "";
    return {
      io: { stdout: { write: (text) => { stdout += text; } }, stderr: { write: (text) => { stderr += text; } } },
      values: () => ({ stdout, stderr }),
    };
  };
  const jsonCapture = capture();
  assert.equal(await runCli(["search", "demo.camera", "--json"], jsonCapture.io), 0);
  const machine = JSON.parse(jsonCapture.values().stdout);
  const humanCapture = capture();
  assert.equal(await runCli(["search", "demo.camera"], humanCapture.io), 0);
  assert.equal(machine.count, 1);
  assert.match(humanCapture.values().stdout, new RegExp(machine.listings[0].record.coordinate.name));
  assert.match(humanCapture.values().stdout, new RegExp(machine.listings[0].record.package.contentRoot));
});

test("malformed records fail validation with a bounded explanation", () => {
  const malformed = dataset("source.bad", [record()]);
  malformed.records[0].package.contentRoot = "not-a-root";
  assert.throws(() => validateDataset(malformed), /lowercase sha256 identity/);
});
