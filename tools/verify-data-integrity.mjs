// SPDX-License-Identifier: MPL-2.0
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const datasetPath = resolve(projectRoot, "data", "reference-v1.json");
const sidecarPath = resolve(projectRoot, "data", "reference-v1.json.sha256");

const [dataset, sidecar] = await Promise.all([
  readFile(datasetPath),
  readFile(sidecarPath, "utf8"),
]);

const match = /^([0-9a-f]{64})  reference-v1\.json\r?\n?$/.exec(sidecar);
if (!match) throw new Error("data/reference-v1.json.sha256 must contain one canonical checksum record");

const observed = createHash("sha256").update(dataset).digest("hex");
if (observed !== match[1]) {
  throw new Error(`data/reference-v1.json differs from its sidecar: expected ${match[1]}, observed ${observed}`);
}

JSON.parse(dataset.toString("utf8"));
console.log(`reference dataset verified: ${dataset.length} bytes, sha256 ${observed}`);
