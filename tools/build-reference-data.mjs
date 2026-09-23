// SPDX-License-Identifier: MPL-2.0
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function parseArgs(argv) {
  const values = {};
  while (argv.length) {
    const key = argv.shift();
    if (!key.startsWith("--") || !argv.length) throw new Error(`invalid argument: ${key}`);
    values[key.slice(2)] = argv.shift();
  }
  for (const required of ["index", "packages-root", "out", "verified-at"]) {
    if (!values[required]) throw new Error(`--${required} is required`);
  }
  return values;
}

function collectStrings(value, keys, result = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, keys, result);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (keys.has(key) && typeof item === "string") result.add(item);
      collectStrings(item, keys, result);
    }
  }
  return [...result].sort();
}

const args = parseArgs(process.argv.slice(2));
const index = JSON.parse(await readFile(resolve(args.index), "utf8"));
if (index.schema !== "fgpm.publication-assets/1" || index.packageCount !== 28) {
  throw new Error("the input must be the verified Stage C 28-package publication index");
}

const repository = "https://github.com/Treatid2/FOSS-Package-Manager";
const release = `${repository}/releases/tag/v0.11.0-rc.6`;
const download = `${repository}/releases/download/v0.11.0-rc.6`;
const records = [];
for (const item of index.packages) {
  const manifestPath = resolve(args["packages-root"], item.id, "fgpm-package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.namespace !== item.namespace || manifest.name !== item.name || manifest.version !== item.version || manifest.format !== item.format || manifest.license !== item.licence) {
    throw new Error(`manifest/index mismatch for ${item.id}`);
  }
  records.push({
    recordId: `treatid2-fgpm-rc6:${item.contentRoot}`,
    coordinate: { namespace: item.namespace, name: item.name, version: item.version },
    package: {
      format: item.format,
      contentRoot: item.contentRoot,
      license: item.licence,
      predecessor: null,
    },
    declarations: {
      capabilities: collectStrings(manifest, new Set(["capability", "governingCapability"])),
      interfaces: collectStrings(manifest, new Set(["protocol", "manifestType", "binding", "vocabulary", "schema"])),
      functions: collectStrings(manifest, new Set(["id", "handles", "validates", "builds", "adapts", "conversion"])),
    },
    publisher: {
      repository,
      release,
      artifact: `${download}/${item.archive.filename}`,
      checksum: `${download}/${item.checksum}`,
      receipt: "https://api.github.com/repos/Treatid2/FOSS-Package-Manager/releases/394337356",
      sourceCommit: "d8e5148b6b8fd3b8b491889f73eceea4aaf1c3d6",
    },
    verification: {
      status: "exact-bytes-and-content-root-verified",
      verifiedAt: args["verified-at"],
      archiveBytes: item.archive.bytes,
      archiveSha256: item.archive.sha256,
      method: "anonymous release download SHA-256 plus FGPM v0.11.0-rc.6 package identity --expected",
    },
    availability: { status: "observed-available", observedAt: args["verified-at"] },
    policy: { recommendation: "not-assessed", statement: null },
  });
}

records.sort((a, b) => {
  const ak = `${a.coordinate.namespace}/${a.coordinate.name}@${a.coordinate.version}/${a.package.contentRoot}`;
  const bk = `${b.coordinate.namespace}/${b.coordinate.name}@${b.coordinate.version}/${b.package.contentRoot}`;
  return ak.localeCompare(bk);
});

const dataset = {
  schema: "fgpm.known-package-source/1",
  source: {
    id: "treatid2.fgpm.stage-c-release",
    name: "Treatid2 FGPM verified Stage C release",
    version: "2026-09-23.1",
    attribution: "Treatid2 publication facts independently re-read and verified by the FGPM release owner",
    observedAt: args["verified-at"],
    url: `${repository}/releases/tag/v0.11.0-rc.6`,
    manager: {
      version: "0.11.0-rc.6",
      artifact: `${download}/fgpm-reference-tools-win32-x64-v0.11.0-rc.6.zip`,
      sha256: "b396a7675af15b2252737a41311742f178ceb4e9d83703b20960ed7fbba09701",
      immutableRelease: true,
    },
  },
  records,
};

await writeFile(resolve(args.out), `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "PASS", output: resolve(args.out), records: records.length }));
