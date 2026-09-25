// SPDX-License-Identifier: MPL-2.0
import { open } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const defaultSource = resolve(moduleRoot, "data", "reference-v1.json");
export const DEFAULT_LIMITS = Object.freeze({
  fetchTimeoutMs: 10_000,
  maxSources: 32,
  maxSourceBytes: 2 * 1024 * 1024,
  maxRecordsPerSource: 10_000,
  maxTotalRecords: 20_000,
  maxStringLength: 16_384,
  maxJsonDepth: 32,
  maxJsonNodes: 100_000,
  maxErrorLength: 512,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_IDENTITY = /^sha256:[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/i;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeLimits(overrides = {}) {
  if (!isObject(overrides)) throw new Error("limits must be an object");
  const unknown = Object.keys(overrides).find((key) => !(key in DEFAULT_LIMITS));
  if (unknown !== undefined) throw new Error(`unknown limit: ${unknown}`);
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
    if (value > DEFAULT_LIMITS[name]) throw new Error(`${name} may not exceed its ${DEFAULT_LIMITS[name]} safety ceiling`);
  }
  return limits;
}

function assertObject(value, field) {
  if (!isObject(value)) throw new Error(`${field} must be an object`);
}

function assertKeys(value, allowed, field) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra !== undefined) throw new Error(`${field} has unsupported property ${extra}`);
}

function assertRequired(value, required, field) {
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (missing !== undefined) throw new Error(`${field}.${missing} is required`);
}

function assertString(value, field, limits, { nonEmpty = true } = {}) {
  if (typeof value !== "string" || (nonEmpty && value.length === 0)) {
    throw new Error(`${field} must be ${nonEmpty ? "a non-empty " : "a "}string`);
  }
  if (value.length > limits.maxStringLength) throw new Error(`${field} exceeds the ${limits.maxStringLength}-character limit`);
}

function assertDateTime(value, field, limits) {
  assertString(value, field, limits);
  const match = DATE_TIME.exec(value);
  if (!match) throw new Error(`${field} must be an RFC 3339 date-time`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offsetValid = zone.toUpperCase() === "Z" || (() => {
    const [offsetHour, offsetMinute] = zone.slice(1).split(":").map(Number);
    return offsetHour <= 23 && offsetMinute <= 59;
  })();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 60 || !offsetValid) {
    throw new Error(`${field} must be an RFC 3339 date-time`);
  }
}

function assertUri(value, field, limits, { reference = false } = {}) {
  assertString(value, field, limits, { nonEmpty: !reference });
  if (/[\u0000-\u0020\u007f-\u009f]/u.test(value)) throw new Error(`${field} must be a valid URI${reference ? " reference" : ""}`);
  try {
    if (reference) new URL(value, "https://fgpm.invalid/base/");
    else if (!new URL(value).protocol) throw new Error("missing scheme");
  } catch {
    throw new Error(`${field} must be a valid URI${reference ? " reference" : ""}`);
  }
}

function assertStringList(value, field, limits) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    assertString(item, `${field}[${index}]`, limits, { nonEmpty: false });
    if (seen.has(item)) throw new Error(`${field} must contain unique strings`);
    seen.add(item);
  }
}

function assertBoundedJson(value, limits) {
  const seen = new WeakSet();
  let nodes = 0;
  function visit(item, field, depth) {
    nodes += 1;
    if (nodes > limits.maxJsonNodes) throw new Error(`dataset exceeds the ${limits.maxJsonNodes}-node limit`);
    if (depth > limits.maxJsonDepth) throw new Error(`dataset exceeds the ${limits.maxJsonDepth}-level depth limit`);
    if (typeof item === "string") {
      if (item.length > limits.maxStringLength) throw new Error(`${field} exceeds the ${limits.maxStringLength}-character limit`);
      return;
    }
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error(`${field} must contain a finite JSON number`);
      return;
    }
    if (typeof item !== "object") throw new Error(`${field} must contain JSON-compatible values`);
    if (seen.has(item)) throw new Error(`${field} must not contain a cycle`);
    seen.add(item);
    if (Array.isArray(item)) {
      for (const [index, child] of item.entries()) visit(child, `${field}[${index}]`, depth + 1);
    } else {
      for (const [key, child] of Object.entries(item)) visit(child, `${field}.${key}`, depth + 1);
    }
    seen.delete(item);
  }
  visit(value, "dataset", 0);
}

function validateRecord(record, index, limits) {
  const prefix = `records[${index}]`;
  const recordFields = ["recordId", "coordinate", "package", "declarations", "publisher", "verification", "availability", "policy"];
  assertObject(record, prefix);
  assertRequired(record, recordFields, prefix);
  assertKeys(record, recordFields, prefix);
  assertString(record.recordId, `${prefix}.recordId`, limits);

  assertObject(record.coordinate, `${prefix}.coordinate`);
  assertRequired(record.coordinate, ["namespace", "name", "version"], `${prefix}.coordinate`);
  assertKeys(record.coordinate, ["namespace", "name", "version"], `${prefix}.coordinate`);
  assertString(record.coordinate.namespace, `${prefix}.coordinate.namespace`, limits);
  if (!UUID.test(record.coordinate.namespace)) throw new Error(`${prefix}.coordinate.namespace must be a UUID`);
  assertString(record.coordinate.name, `${prefix}.coordinate.name`, limits);
  assertString(record.coordinate.version, `${prefix}.coordinate.version`, limits);

  assertObject(record.package, `${prefix}.package`);
  assertRequired(record.package, ["format", "contentRoot", "license"], `${prefix}.package`);
  assertKeys(record.package, ["format", "contentRoot", "license", "predecessor"], `${prefix}.package`);
  assertString(record.package.format, `${prefix}.package.format`, limits);
  assertString(record.package.contentRoot, `${prefix}.package.contentRoot`, limits);
  if (!SHA256_IDENTITY.test(record.package.contentRoot)) throw new Error(`${prefix}.package.contentRoot must be a lowercase sha256 identity`);
  assertString(record.package.license, `${prefix}.package.license`, limits);
  if (Object.hasOwn(record.package, "predecessor") && record.package.predecessor !== null) assertObject(record.package.predecessor, `${prefix}.package.predecessor`);

  assertObject(record.declarations, `${prefix}.declarations`);
  const declarationFields = ["capabilities", "interfaces", "functions"];
  assertRequired(record.declarations, declarationFields, `${prefix}.declarations`);
  assertKeys(record.declarations, declarationFields, `${prefix}.declarations`);
  for (const field of declarationFields) assertStringList(record.declarations[field], `${prefix}.declarations.${field}`, limits);

  assertObject(record.publisher, `${prefix}.publisher`);
  const publisherRequired = ["repository", "release", "artifact", "checksum", "receipt"];
  assertRequired(record.publisher, publisherRequired, `${prefix}.publisher`);
  assertKeys(record.publisher, [...publisherRequired, "sourceCommit"], `${prefix}.publisher`);
  for (const field of publisherRequired) if (record.publisher[field] !== null) assertUri(record.publisher[field], `${prefix}.publisher.${field}`, limits);
  if (Object.hasOwn(record.publisher, "sourceCommit")) {
    assertString(record.publisher.sourceCommit, `${prefix}.publisher.sourceCommit`, limits);
    if (!COMMIT.test(record.publisher.sourceCommit)) throw new Error(`${prefix}.publisher.sourceCommit must be a lowercase 40-hex commit`);
  }

  assertObject(record.verification, `${prefix}.verification`);
  const verificationFields = ["status", "verifiedAt", "archiveBytes", "archiveSha256", "method"];
  assertRequired(record.verification, verificationFields, `${prefix}.verification`);
  assertKeys(record.verification, verificationFields, `${prefix}.verification`);
  assertString(record.verification.status, `${prefix}.verification.status`, limits);
  assertDateTime(record.verification.verifiedAt, `${prefix}.verification.verifiedAt`, limits);
  if (!Number.isSafeInteger(record.verification.archiveBytes) || record.verification.archiveBytes < 0) {
    throw new Error(`${prefix}.verification.archiveBytes must be a non-negative safe integer`);
  }
  assertString(record.verification.archiveSha256, `${prefix}.verification.archiveSha256`, limits);
  if (!SHA256.test(record.verification.archiveSha256)) throw new Error(`${prefix}.verification.archiveSha256 must be a lowercase SHA-256`);
  assertString(record.verification.method, `${prefix}.verification.method`, limits);

  assertObject(record.availability, `${prefix}.availability`);
  assertRequired(record.availability, ["status", "observedAt"], `${prefix}.availability`);
  assertKeys(record.availability, ["status", "observedAt"], `${prefix}.availability`);
  if (!["observed-available", "observed-unavailable", "unknown"].includes(record.availability.status)) throw new Error(`${prefix}.availability.status is unsupported`);
  assertDateTime(record.availability.observedAt, `${prefix}.availability.observedAt`, limits);

  assertObject(record.policy, `${prefix}.policy`);
  assertRequired(record.policy, ["recommendation", "statement"], `${prefix}.policy`);
  assertKeys(record.policy, ["recommendation", "statement"], `${prefix}.policy`);
  if (!["not-assessed", "recommended", "not-recommended"].includes(record.policy.recommendation)) throw new Error(`${prefix}.policy.recommendation is unsupported`);
  if (record.policy.statement !== null) assertString(record.policy.statement, `${prefix}.policy.statement`, limits, { nonEmpty: false });
}

export function validateDataset(dataset, options = {}) {
  const limits = normalizeLimits(options.limits ?? options);
  assertBoundedJson(dataset, limits);
  assertObject(dataset, "dataset");
  assertRequired(dataset, ["schema", "source", "records"], "dataset");
  assertKeys(dataset, ["schema", "source", "records"], "dataset");
  if (dataset.schema !== "fgpm.known-package-source/1") throw new Error("unsupported dataset schema");

  assertObject(dataset.source, "source");
  const sourceRequired = ["id", "name", "version", "attribution", "observedAt"];
  assertRequired(dataset.source, sourceRequired, "source");
  for (const field of sourceRequired.slice(0, 4)) assertString(dataset.source[field], `source.${field}`, limits);
  assertDateTime(dataset.source.observedAt, "source.observedAt", limits);
  if (Object.hasOwn(dataset.source, "url") && dataset.source.url !== null) assertUri(dataset.source.url, "source.url", limits, { reference: true });
  if (Object.hasOwn(dataset.source, "manager") && dataset.source.manager !== null) assertObject(dataset.source.manager, "source.manager");

  if (!Array.isArray(dataset.records)) throw new Error("records must be an array");
  if (dataset.records.length > limits.maxRecordsPerSource) throw new Error(`records exceeds the ${limits.maxRecordsPerSource}-record source limit`);
  const recordIds = new Set();
  for (const [index, record] of dataset.records.entries()) {
    validateRecord(record, index, limits);
    if (recordIds.has(record.recordId)) throw new Error(`records[${index}].recordId must be unique`);
    recordIds.add(record.recordId);
  }
  return dataset;
}

function decodeUtf8(chunks) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new Error("source is not valid UTF-8");
  }
}

async function readRemoteSource(spec, limits) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), limits.fetchTimeoutMs);
  try {
    const response = await fetch(spec, {
      headers: { Accept: "application/json", "User-Agent": "fgpm-known-package-links/0.1.0" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > limits.maxSourceBytes) throw new Error(`source exceeds the ${limits.maxSourceBytes}-byte limit`);
    const chunks = [];
    let bytes = 0;
    if (response.body) {
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > limits.maxSourceBytes) {
          controller.abort();
          throw new Error(`source exceeds the ${limits.maxSourceBytes}-byte limit`);
        }
        chunks.push(buffer);
      }
    }
    return { text: decodeUtf8(chunks), resolved: response.url };
  } catch (error) {
    if (controller.signal.aborted && !String(error?.message).startsWith("source exceeds")) throw new Error(`source retrieval timed out after ${limits.fetchTimeoutMs} ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readLocalSource(path, limits) {
  const file = await open(path, "r");
  try {
    const metadata = await file.stat();
    if (metadata.size > limits.maxSourceBytes) throw new Error(`source exceeds the ${limits.maxSourceBytes}-byte limit`);
    const chunks = [];
    let bytes = 0;
    const buffer = Buffer.alloc(Math.min(64 * 1024, limits.maxSourceBytes + 1));
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      if (bytes > limits.maxSourceBytes) throw new Error(`source exceeds the ${limits.maxSourceBytes}-byte limit`);
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    return decodeUtf8(chunks);
  } finally {
    await file.close();
  }
}

async function readSource(spec, { offline, limits }) {
  if (/^https?:\/\//i.test(spec)) {
    if (offline) throw new Error("remote source disabled by --offline");
    return readRemoteSource(spec, limits);
  }
  const path = spec.startsWith("file:") ? fileURLToPath(spec) : resolve(spec);
  return { text: await readLocalSource(path, limits), resolved: pathToFileURL(path).href };
}

function values(record) {
  return [record.coordinate.namespace, record.coordinate.name, record.coordinate.version, record.package.contentRoot,
    record.package.format, record.package.license, ...record.declarations.capabilities,
    ...record.declarations.interfaces, ...record.declarations.functions].map((value) => value.toLowerCase());
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

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function claimFor(listing) {
  return { contentRoot: listing.record.package.contentRoot, provenanceId: listing.provenance.id,
    claimedSourceId: listing.source.id, requested: listing.provenance.requested, resolved: listing.provenance.resolved };
}

function summarizeConflicts(listings) {
  const coordinates = new Map();
  const objects = new Map();
  for (const listing of listings) {
    const record = listing.record;
    const coordinate = `${record.coordinate.namespace}/${record.coordinate.name}@${record.coordinate.version}`;
    if (!coordinates.has(coordinate)) coordinates.set(coordinate, []);
    coordinates.get(coordinate).push(listing);
    if (!objects.has(record.package.contentRoot)) objects.set(record.package.contentRoot, []);
    objects.get(record.package.contentRoot).push(listing);
  }
  return {
    ambiguousCoordinates: [...coordinates]
      .filter(([, claims]) => new Set(claims.map((listing) => listing.record.package.contentRoot)).size > 1)
      .map(([coordinate, claims]) => ({ coordinate,
        contentRoots: [...new Set(claims.map((listing) => listing.record.package.contentRoot))].sort(compareText),
        claims: claims.map(claimFor).sort((a, b) => compareText(a.provenanceId, b.provenanceId)) }))
      .sort((a, b) => compareText(a.coordinate, b.coordinate)),
    multiplyListedObjects: [...objects]
      .filter(([, claims]) => new Set(claims.map((listing) => listing.provenance.id)).size > 1)
      .map(([contentRoot, claims]) => ({ contentRoot,
        sources: claims.map(claimFor).sort((a, b) => compareText(a.provenanceId, b.provenanceId)) }))
      .sort((a, b) => compareText(a.contentRoot, b.contentRoot)),
  };
}

function boundedError(error, limits) {
  const message = typeof error?.message === "string" ? error.message : String(error);
  return message.slice(0, limits.maxErrorLength);
}

function provenanceFor(index, requested, resolved) {
  return Object.freeze({ id: `source-${String(index + 1).padStart(4, "0")}`, requested,
    ...(resolved === undefined ? {} : { resolved }) });
}

function validateFilters(filters, limits) {
  if (!isObject(filters)) throw new Error("filters must be an object");
  const allowed = ["query", "namespace", "name", "version", "root", "capability", "interface", "function"];
  assertKeys(filters, allowed, "filters");
  for (const [field, value] of Object.entries(filters)) assertString(value, `filters.${field}`, limits, { nonEmpty: false });
}

export async function queryDirectory({ sources = [], includeDefault = true, offline = false, filters = {}, limits: limitOverrides = {} } = {}) {
  const limits = normalizeLimits(limitOverrides);
  if (!Array.isArray(sources) || sources.some((source) => typeof source !== "string" || source.length === 0)) throw new Error("sources must be an array of non-empty strings");
  const requested = [...(includeDefault ? [defaultSource] : []), ...sources];
  if (requested.length > limits.maxSources) throw new Error(`query exceeds the ${limits.maxSources}-source limit`);
  for (const [index, spec] of requested.entries()) assertString(spec, `sources[${index}]`, limits);
  validateFilters(filters, limits);

  const sourceReports = [];
  const listings = [];
  let admittedRecords = 0;
  for (const [index, spec] of requested.entries()) {
    let resolved;
    try {
      const loaded = await readSource(spec, { offline, limits });
      resolved = loaded.resolved;
      const dataset = validateDataset(JSON.parse(loaded.text), { limits });
      if (admittedRecords + dataset.records.length > limits.maxTotalRecords) throw new Error(`source would exceed the ${limits.maxTotalRecords}-record query limit`);
      const provenance = provenanceFor(index, spec, resolved);
      const sourceListings = [];
      for (const record of dataset.records) if (matches(record, filters)) sourceListings.push({ source: dataset.source, provenance, record });
      sourceReports.push({ provenance, requested: spec, resolved, status: "loaded", source: dataset.source,
        recordCount: dataset.records.length, claimedSourceIdCollision: false });
      listings.push(...sourceListings);
      admittedRecords += dataset.records.length;
    } catch (error) {
      const provenance = provenanceFor(index, spec, resolved);
      sourceReports.push({ provenance, requested: spec, ...(resolved === undefined ? {} : { resolved }),
        status: "unavailable", error: boundedError(error, limits) });
    }
  }

  const claimedIds = new Map();
  for (const report of sourceReports.filter((item) => item.status === "loaded")) {
    if (!claimedIds.has(report.source.id)) claimedIds.set(report.source.id, []);
    claimedIds.get(report.source.id).push(report.provenance.id);
  }
  for (const report of sourceReports.filter((item) => item.status === "loaded")) report.claimedSourceIdCollision = claimedIds.get(report.source.id).length > 1;
  for (const listing of listings) listing.claimedSourceIdCollision = claimedIds.get(listing.source.id).length > 1;

  listings.sort((a, b) => compareText(
    `${a.record.coordinate.namespace}/${a.record.coordinate.name}@${a.record.coordinate.version}/${a.record.package.contentRoot}/${a.provenance.id}`,
    `${b.record.coordinate.namespace}/${b.record.coordinate.name}@${b.record.coordinate.version}/${b.record.package.contentRoot}/${b.provenance.id}`));
  const loadedCount = sourceReports.filter((source) => source.status === "loaded").length;
  const unavailableCount = sourceReports.length - loadedCount;
  const status = requested.length === 0 ? "no-sources" : loadedCount === 0 ? "sources-unavailable"
    : unavailableCount > 0 ? "partial" : listings.length === 0 ? "not-known" : "ok";
  const meaning = status === "no-sources" || status === "not-known" || status === "sources-unavailable"
    ? "not known to these sources"
    : status === "partial" && listings.length === 0
      ? "query incomplete; no matching listing in loaded sources and at least one source unavailable"
      : "source-attributed listings; not authorization, compatibility, trust, or selection";
  return { schema: "fgpm.known-package-query-result/1", status, meaning, limits, sourceReports,
    count: listings.length, conflicts: summarizeConflicts(listings), listings };
}
