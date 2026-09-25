// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { queryDirectory, validateDataset } from "../src/directory.mjs";
import { escapeHuman, runCli } from "../src/cli.mjs";
import { extractDeclarations } from "../src/declarations.mjs";

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

async function datasetFile(t, filename, value) {
  const root = await workspace(t);
  const path = join(root, filename);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
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
  assert.deepEqual(result.conflicts.multiplyListedObjects[0].sources.map((item) => item.claimedSourceId), ["source.one", "source.two"]);
  assert.deepEqual(result.conflicts.multiplyListedObjects[0].sources.map((item) => item.provenanceId), ["source-0001", "source-0002"]);
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

test("runtime validation enforces every published schema class", () => {
  const cases = [
    ["namespace", (value) => { value.records[0].coordinate.namespace = "not-a-uuid"; }, /UUID/],
    ["date", (value) => { value.records[0].verification.verifiedAt = "2026-02-30T00:00:00Z"; }, /RFC 3339/],
    ["publisher URL", (value) => { value.records[0].publisher.release = "not a URI"; }, /valid URI/],
    ["availability", (value) => { delete value.records[0].availability; }, /availability is required/],
    ["policy", (value) => { delete value.records[0].policy; }, /policy is required/],
    ["archive bytes", (value) => { value.records[0].verification.archiveBytes = -1; }, /non-negative/],
    ["fractional archive bytes", (value) => { value.records[0].verification.archiveBytes = 1.5; }, /non-negative/],
    ["archive hash", (value) => { value.records[0].verification.archiveSha256 = "no"; }, /SHA-256/],
    ["verification method", (value) => { delete value.records[0].verification.method; }, /method is required/],
    ["source commit", (value) => { value.records[0].publisher.sourceCommit = "ABC"; }, /40-hex/],
    ["declaration type", (value) => { value.records[0].declarations.functions.push(7); }, /string/],
    ["declaration uniqueness", (value) => { value.records[0].declarations.functions.push("example.function"); }, /unique/],
    ["additional property", (value) => { value.records[0].invented = true; }, /unsupported property/],
    ["nested additional property", (value) => { value.records[0].coordinate.invented = true; }, /unsupported property/],
    ["predecessor", (value) => { value.records[0].package.predecessor = "not-an-object"; }, /must be an object/],
    ["availability enum", (value) => { value.records[0].availability.status = "maybe"; }, /unsupported/],
    ["policy enum", (value) => { value.records[0].policy.recommendation = "preferred"; }, /unsupported/],
    ["source date", (value) => { value.source.observedAt = "yesterday"; }, /RFC 3339/],
    ["source URL", (value) => { value.source.url = "not a URI"; }, /valid URI/],
    ["source manager", (value) => { value.source.manager = []; }, /must be an object/],
  ];
  for (const [name, mutate, pattern] of cases) {
    const value = dataset(`source.bad-${name}`, [record()]);
    mutate(value);
    assert.throws(() => validateDataset(value), pattern, name);
  }
});

test("a late malformed record rejects its source atomically", async (t) => {
  const malformed = dataset("source.atomic", [record(), record({ root: rootB, name: "second" })]);
  malformed.records[1].declarations.functions.push(42);
  const path = await datasetFile(t, "atomic.json", malformed);
  const result = await queryDirectory({ includeDefault: false, sources: [path] });
  assert.equal(result.status, "sources-unavailable");
  assert.equal(result.count, 0);
  assert.equal(result.sourceReports.length, 1);
  assert.equal(result.sourceReports[0].status, "unavailable");
});

test("a no-match result remains incomplete when another source is unavailable", async (t) => {
  const valid = await sourceFile(t, "source.no-match", [record()]);
  const missing = join(await workspace(t), "missing.json");
  const result = await queryDirectory({ includeDefault: false, sources: [valid, missing], filters: { query: "absent" } });
  assert.equal(result.status, "partial");
  assert.equal(result.count, 0);
  assert.match(result.meaning, /incomplete/);
});

test("actual origin disambiguates duplicate claimed source IDs", async (t) => {
  const one = await datasetFile(t, "one.json", dataset("official.claim", [record()]));
  const two = await datasetFile(t, "two.json", dataset("official.claim", [record()]));
  const result = await queryDirectory({ includeDefault: false, sources: [one, two] });
  assert.equal(result.count, 2);
  assert.ok(result.sourceReports.every((item) => item.claimedSourceIdCollision));
  assert.deepEqual(result.listings.map((item) => item.provenance.id), ["source-0001", "source-0002"]);
  assert.notEqual(result.listings[0].provenance.resolved, result.listings[1].provenance.resolved);
  assert.equal(result.conflicts.multiplyListedObjects[0].sources.length, 2);
});

test("human output visibly escapes hostile controls and includes material links", async (t) => {
  const hostile = dataset("official.claim", [record({ checksum: "https://example.invalid/checksum" })]);
  hostile.source.name = "forged\nStatus: ok\u001b]8;;https://evil.invalid\u0007";
  const path = await datasetFile(t, "hostile.json", hostile);
  let stdout = "";
  let stderr = "";
  const code = await runCli(["list", "--no-default-source", "--source", path], {
    stdout: { write: (text) => { stdout += text; } },
    stderr: { write: (text) => { stderr += text; } },
  });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.doesNotMatch(stdout, /\u001b/);
  assert.match(stdout, /forged\\u000aStatus: ok\\u001b/);
  for (const value of [path, hostile.records[0].publisher.repository, hostile.records[0].publisher.release,
    hostile.records[0].publisher.artifact, hostile.records[0].publisher.checksum, hostile.records[0].publisher.sourceCommit,
    hostile.records[0].recordId]) {
    assert.ok(stdout.includes(escapeHuman(value)), value);
  }
});

test("source byte, record, and fetch-time limits fail one source and continue", async (t) => {
  const valid = await sourceFile(t, "source.after-limit", [record()]);
  const oversized = await datasetFile(t, "oversized.json", { padding: "x".repeat(8_000) });
  const local = await queryDirectory({ includeDefault: false, sources: [oversized, valid], limits: { maxSourceBytes: 4_000 } });
  assert.equal(local.status, "partial");
  assert.equal(local.count, 1);
  assert.match(local.sourceReports[0].error, /byte limit/);

  const excessive = await sourceFile(t, "source.too-many", [record(), record({ root: rootB, name: "second" })]);
  const counted = await queryDirectory({ includeDefault: false, sources: [excessive, valid], limits: { maxRecordsPerSource: 1 } });
  assert.equal(counted.status, "partial");
  assert.equal(counted.count, 1);
  assert.match(counted.sourceReports[0].error, /record source limit/);

  const total = await queryDirectory({ includeDefault: false, sources: [valid, valid], limits: { maxTotalRecords: 1 } });
  assert.equal(total.status, "partial");
  assert.equal(total.count, 1);
  assert.match(total.sourceReports[1].error, /record query limit/);

  const longString = dataset("source.long-string", [record()]);
  longString.source.name = "x".repeat(257);
  const longStringPath = await datasetFile(t, "long-string.json", longString);
  const boundedString = await queryDirectory({ includeDefault: false, sources: [longStringPath, valid], limits: { maxStringLength: 256 } });
  assert.equal(boundedString.status, "partial");
  assert.equal(boundedString.count, 1);
  assert.match(boundedString.sourceReports[0].error, /character limit/);

  const server = createServer((request, response) => {
    if (request.url === "/big") {
      response.writeHead(200, { "content-type": "application/json", "transfer-encoding": "chunked" });
      response.write("x".repeat(3_000));
      response.end("x".repeat(2_000));
      return;
    }
    setTimeout(() => { response.writeHead(200, { "content-type": "application/json" }); response.end("{}"); }, 200);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  const streamed = await queryDirectory({ includeDefault: false,
    sources: [`http://127.0.0.1:${address.port}/big`, valid], limits: { maxSourceBytes: 4_000 } });
  assert.equal(streamed.status, "partial");
  assert.equal(streamed.count, 1);
  assert.match(streamed.sourceReports[0].error, /byte limit/);
  const timed = await queryDirectory({ includeDefault: false,
    sources: [`http://127.0.0.1:${address.port}/slow`, valid], limits: { fetchTimeoutMs: 25 } });
  assert.equal(timed.status, "partial");
  assert.equal(timed.count, 1);
  assert.match(timed.sourceReports[0].error, /timed out/);

  await assert.rejects(queryDirectory({ includeDefault: false, sources: [valid, valid], limits: { maxSources: 1 } }), /source limit/);
});

test("manifest-aware declaration extraction excludes conversion descriptors", () => {
  const declarations = extractDeclarations({
    format: "fgpm.package/1",
    provides: [{ capability: "cap.one" }],
    contributions: [{ id: "contribution:one", manifestType: "manifest/1" }],
    handlers: [{ id: "handler:one", protocol: "handler/1", handles: ["handled/1"],
      adapts: [{ id: "adapter:one", conversion: "lossless" }], buildEnvironment: { schema: "build/1" } }],
    runtimeServices: [{ id: "service:one", protocol: "service/1", provides: [{ capability: "runtime.one",
      binding: "binding/1", metadata: { schema: "member/1", vocabulary: "vocabulary/1",
        snapshots: [{ capability: "snapshot.one", schema: "snapshot/1", vocabulary: "snapshot-vocabulary/1" }] } }] }],
  });
  assert.deepEqual(declarations.capabilities, ["cap.one", "runtime.one", "snapshot.one"]);
  assert.ok(declarations.functions.includes("adapter:one"));
  assert.ok(declarations.functions.includes("handler:one"));
  assert.ok(declarations.functions.includes("service:one"));
  assert.ok(!declarations.functions.includes("lossless"));
  assert.ok(declarations.interfaces.includes("snapshot-vocabulary/1"));
});
