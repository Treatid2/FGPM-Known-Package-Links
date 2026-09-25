// SPDX-License-Identifier: MPL-2.0

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function addString(target, value) {
  if (typeof value === "string" && value.length > 0) target.add(value);
}

function addStrings(target, values) {
  if (!Array.isArray(values)) return;
  for (const value of values) addString(target, value);
}

function addCapabilityEntry(capabilities, interfaces, entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
  addString(capabilities, entry.capability);
  addString(capabilities, entry.governingCapability);
  addString(interfaces, entry.binding);
}

function addRuntimeMetadata(capabilities, interfaces, metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return;
  addString(interfaces, metadata.schema);
  addString(interfaces, metadata.vocabulary);
  for (const snapshot of metadata.snapshots ?? []) {
    addCapabilityEntry(capabilities, interfaces, snapshot);
    addString(interfaces, snapshot.schema);
    addString(interfaces, snapshot.vocabulary);
  }
  for (const output of metadata.outputs ?? []) addString(interfaces, output.vocabulary);
}

export function extractDeclarations(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("manifest must be an object");
  if (!["fgpm.package/1", "fgpm.package/2"].includes(manifest.format)) throw new Error(`unsupported package manifest format: ${String(manifest.format)}`);
  const capabilities = new Set();
  const interfaces = new Set();
  const functions = new Set();

  for (const entry of manifest.provides ?? []) addCapabilityEntry(capabilities, interfaces, entry);
  for (const entry of manifest.requires ?? []) addCapabilityEntry(capabilities, interfaces, entry);

  for (const contribution of manifest.contributions ?? []) {
    addString(functions, contribution?.id);
    addString(interfaces, contribution?.manifestType);
  }

  for (const handler of manifest.handlers ?? []) {
    addString(functions, handler?.id);
    addString(interfaces, handler?.protocol);
    addStrings(functions, handler?.handles);
    addStrings(functions, handler?.validates);
    addStrings(functions, handler?.builds);
    for (const adapter of handler?.adapts ?? []) addString(functions, adapter?.id);
    addString(interfaces, handler?.buildEnvironment?.schema);
  }

  for (const service of manifest.runtimeServices ?? []) {
    addString(functions, service?.id);
    addString(interfaces, service?.protocol);
    for (const entry of service?.provides ?? []) {
      addCapabilityEntry(capabilities, interfaces, entry);
      addRuntimeMetadata(capabilities, interfaces, entry?.metadata);
    }
    for (const entry of service?.requires ?? []) {
      addCapabilityEntry(capabilities, interfaces, entry);
      addRuntimeMetadata(capabilities, interfaces, entry?.metadata);
    }
  }

  return {
    capabilities: [...capabilities].sort(compareText),
    interfaces: [...interfaces].sort(compareText),
    functions: [...functions].sort(compareText),
  };
}
