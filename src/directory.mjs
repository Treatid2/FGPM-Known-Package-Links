// SPDX-License-Identifier: MPL-2.0
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const defaultSource = resolve(moduleRoot, "data", "reference-v1.json");

function assertString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

export function validateDataset(dataset) {
  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) {
    throw new Error("dataset must be a JSON object");
  }
  if (dataset.schema !== "fgpm.known-package-source/1") {
    throw new Error(`unsupported dataset schema: ${String(dataset.schema)}`);
  }
  for (const field of ["id", "name", "version", "attribution", "observedAt"]) {
    assertString(dataset.source?.[field], `source.${field}`);
  }
  if (!Array.isArray(dataset.records)) {
    throw new Error("records must be an array");
  }
  const recordIds = new Set();
  for (const [index, record] of dataset.records.entries()) {
    const prefix = `records[${index}]`;
    assertString(record.recordId, `${prefix}.recordId`);
    if (recordIds.has(record.recordId)) {
      throw new Error(`duplicate recordId: ${record.recordId}`);
    }
    recordIds.add(record.recordId);
    for (const field of ["namespace", "name", "version"]) {
      assertString(record.coordinate?.[field], `${prefix}.coordinate.${field}`);
    }
    for (const field of ["format", "contentRoot", "license"]) {
      assertString(record.package?.[field], `${prefix}.package.${field}`);
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(record.package.contentRoot)) {
      throw new Error(`${prefix}.package.contentRoot must be a lowercase sha256 identity`);
    }
    if (!record.publisher || typeof record.publisher !== "object") {
      throw new Error(`${prefix}.publisher is required`);
    }
    for (const field of ["repository", "release", "artifact", "checksum", "receipt"]) {
      if (record.publisher[field] !== null) {
        assertString(record.publisher[field], `${prefix}.publisher.${field}`);
      }
    }
    for (const field of ["status", "verifiedAt", "archiveSha256"]) {
      assertString(record.verification?.[field], `${prefix}.verification.${field}`);
    }
    if (!Array.isArray(record.declarations?.capabilities) ||
        !Array.isArray(record.declarations?.interfaces) ||
        !Array.isArray(record.declarations?.functions)) {
      throw new Error(`${prefix}.declarations lists are required`);
    }
  }
  return dataset;
}

async function readSource(spec, { offline }) {
  if (/^https?:\/\//i.test(spec)) {
    if (offline) {
      throw new Error("remote source disabled by --offline");
    }
    const response = await fetch(spec, {
      headers: { Accept: "application/json", "User-Agent": "fgpm-known-package-links/0.1.0" },
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return { text: await response.text(), resolved: response.url };
  }
  const path = spec.startsWith("file:") ? fileURLToPath(spec) : resolve(spec);
  return { text: await readFile(path, "utf8"), resolved: pathToFileURL(path).href };
}

function values(record) {
  return [
    record.coordinate.namespace,
    record.coordinate.name,
    record.coordinate.version,
    record.package.contentRoot,
    record.package.format,
    record.package.license,
    ...record.declarations.capabilities,
    ...record.declarations.interfaces,
    ...record.declarations.functions,
  ].map((value) => value.toLowerCase());
}

function contains(valuesToSearch, needle) {
  const folded = needle.toLowerCase();
  return valuesToSearch.some((value) => value.includes(folded));
}

function matches(record, filters) {
  const searchable = values(record);
  if (filters.query && !contains(searchable, filters.query)) return false;
  if (filters.namespace && record.coordinate.namespace !== filters.namespace) return false;
  if (filters.name && record.coordinate.name !== filters.name) return false;
  if (filters.version && record.coordinate.version !== filters.version) return false;
  if (filters.root && record.package.contentRoot !== filters.root) return false;
  if (filters.capability && !contains(record.declarations.capabilities.map((x) => x.toLowerCase()), filters.capability)) return false;
  if (filters.interface && !contains(record.declarations.interfaces.map((x) => x.toLowerCase()), filters.interface)) return false;
  if (filters.function && !contains(record.declarations.functions.map((x) => x.toLowerCase()), filters.function)) return false;
  return true;
}

function summarizeConflicts(listings) {
  const coordinates = new Map();
  const objects = new Map();
  for (const listing of listings) {
    const record = listing.record;
    const coordinate = `${record.coordinate.namespace}/${record.coordinate.name}@${record.coordinate.version}`;
    if (!coordinates.has(coordinate)) coordinates.set(coordinate, new Set());
    coordinates.get(coordinate).add(record.package.contentRoot);
    if (!objects.has(record.package.contentRoot)) objects.set(record.package.contentRoot, new Set());
    objects.get(record.package.contentRoot).add(listing.source.id);
  }
  return {
    ambiguousCoordinates: [...coordinates]
      .filter(([, roots]) => roots.size > 1)
      .map(([coordinate, roots]) => ({ coordinate, contentRoots: [...roots].sort() })),
    multiplyListedObjects: [...objects]
      .filter(([, sources]) => sources.size > 1)
      .map(([contentRoot, sources]) => ({ contentRoot, sources: [...sources].sort() })),
  };
}

export async function queryDirectory({
  sources = [],
  includeDefault = true,
  offline = false,
  filters = {},
} = {}) {
  const requested = [...(includeDefault ? [defaultSource] : []), ...sources];
  const sourceReports = [];
  const listings = [];

  for (const spec of requested) {
    try {
      const loaded = await readSource(spec, { offline });
      const dataset = validateDataset(JSON.parse(loaded.text));
      sourceReports.push({
        requested: spec,
        resolved: loaded.resolved,
        status: "loaded",
        source: dataset.source,
        recordCount: dataset.records.length,
      });
      for (const record of dataset.records) {
        if (matches(record, filters)) {
          listings.push({ source: dataset.source, record });
        }
      }
    } catch (error) {
      sourceReports.push({ requested: spec, status: "unavailable", error: error.message });
    }
  }

  listings.sort((a, b) => {
    const ak = `${a.record.coordinate.namespace}/${a.record.coordinate.name}@${a.record.coordinate.version}/${a.record.package.contentRoot}/${a.source.id}`;
    const bk = `${b.record.coordinate.namespace}/${b.record.coordinate.name}@${b.record.coordinate.version}/${b.record.package.contentRoot}/${b.source.id}`;
    return ak.localeCompare(bk);
  });
  const loadedCount = sourceReports.filter((source) => source.status === "loaded").length;
  const status = requested.length === 0
    ? "no-sources"
    : loadedCount === 0
      ? "sources-unavailable"
      : listings.length === 0
        ? "not-known"
        : sourceReports.some((source) => source.status !== "loaded")
          ? "partial"
          : "ok";

  return {
    schema: "fgpm.known-package-query-result/1",
    status,
    meaning: status === "not-known" || status === "no-sources" || status === "sources-unavailable"
      ? "not known to these sources"
      : "source-attributed listings; not authorization, compatibility, trust, or selection",
    sourceReports,
    count: listings.length,
    conflicts: summarizeConflicts(listings),
    listings,
  };
}
