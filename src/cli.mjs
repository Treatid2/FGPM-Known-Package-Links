// SPDX-License-Identifier: MPL-2.0
import { queryDirectory } from "./directory.mjs";

const usage = `Usage:
  fgpm-known list [options]
  fgpm-known search <text> [options]
  fgpm-known get (--root <sha256:...> | --namespace <uuid> --name <name>) [options]

Options:
  --source <path-or-url>   Add an explicit source; repeatable
  --no-default-source     Do not load the bundled reference source
  --offline               Do not fetch HTTP(S) sources
  --capability <text>     Filter declared capabilities
  --interface <text>      Filter declared interfaces/protocols
  --function <text>       Filter declared functions/contributions
  --version <version>     Filter exact declared version
  --json                  Emit machine-readable JSON
  --help                  Show this help

Results are attributed source claims. Listing is not authorization, installation,
compatibility, trust, recommendation, or provider selection.`;

export function escapeHuman(value) {
  return String(value).replace(
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    (character) => `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`,
  );
}

function shown(value) {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "object") return escapeHuman(JSON.stringify(value));
  return escapeHuman(value);
}

function list(values) {
  return values.length ? values.map(shown).join(", ") : "none";
}

function parse(argv) {
  const command = argv.shift();
  if (!command || command === "--help" || command === "help") return { help: true };
  if (!["list", "search", "get"].includes(command)) throw new Error(`unknown command: ${command}`);
  const options = {
    command,
    sources: [],
    includeDefault: true,
    offline: false,
    json: false,
    filters: {},
  };
  if (command === "search") {
    const query = argv.shift();
    if (!query || query.startsWith("--")) throw new Error("search requires text");
    options.filters.query = query;
  }
  while (argv.length) {
    const token = argv.shift();
    if (token === "--source") {
      if (!argv.length) throw new Error("--source requires a value");
      options.sources.push(argv.shift());
    } else if (token === "--no-default-source") {
      options.includeDefault = false;
    } else if (token === "--offline") {
      options.offline = true;
    } else if (token === "--json") {
      options.json = true;
    } else if (token === "--help") {
      options.help = true;
    } else if (["--capability", "--interface", "--function", "--version", "--namespace", "--name", "--root"].includes(token)) {
      if (!argv.length) throw new Error(`${token} requires a value`);
      options.filters[token.slice(2)] = argv.shift();
    } else {
      throw new Error(`unknown option: ${token}`);
    }
  }
  if (command === "get" && !options.filters.root && !(options.filters.namespace && options.filters.name)) {
    throw new Error("get requires --root or both --namespace and --name");
  }
  return options;
}

export function renderHuman(result) {
  const lines = [
    `Status: ${result.status}`,
    `Meaning: ${result.meaning}`,
    `Sources: ${result.sourceReports.filter((source) => source.status === "loaded").length} loaded, ${result.sourceReports.filter((source) => source.status !== "loaded").length} unavailable`,
    `Listings: ${result.count}`,
  ];
  for (const source of result.sourceReports.filter((item) => item.status === "loaded")) {
    lines.push(`Source loaded [${shown(source.provenance.id)}]: ${shown(source.requested)} -> ${shown(source.resolved)}`);
    lines.push(`  claimed source: ${shown(source.source.name)} (${shown(source.source.id)}@${shown(source.source.version)})${source.claimedSourceIdCollision ? " [duplicate claimed ID]" : ""}`);
    lines.push(`  attribution/observed: ${shown(source.source.attribution)} / ${shown(source.source.observedAt)}`);
    lines.push(`  source URL/manager: ${shown(source.source.url)} / ${shown(source.source.manager)}`);
  }
  for (const source of result.sourceReports.filter((item) => item.status !== "loaded")) {
    lines.push(`Source unavailable [${shown(source.provenance.id)}]: ${shown(source.requested)}${source.resolved ? ` -> ${shown(source.resolved)}` : ""} (${shown(source.error)})`);
  }
  for (const { source, provenance, claimedSourceIdCollision, record } of result.listings) {
    lines.push("");
    lines.push(`${shown(record.coordinate.namespace)}/${shown(record.coordinate.name)}@${shown(record.coordinate.version)}`);
    lines.push(`  record ID: ${shown(record.recordId)}`);
    lines.push(`  root: ${shown(record.package.contentRoot)}`);
    lines.push(`  format/licence/predecessor: ${shown(record.package.format)} / ${shown(record.package.license)} / ${shown(record.package.predecessor)}`);
    lines.push(`  claimed source: ${shown(source.name)} (${shown(source.id)}@${shown(source.version)})${claimedSourceIdCollision ? " [duplicate claimed ID]" : ""}`);
    lines.push(`  actual origin: ${shown(provenance.id)}; requested ${shown(provenance.requested)}; resolved ${shown(provenance.resolved)}`);
    lines.push(`  attribution/observed/source URL: ${shown(source.attribution)} / ${shown(source.observedAt)} / ${shown(source.url)}`);
    lines.push(`  capabilities: ${list(record.declarations.capabilities)}`);
    lines.push(`  interfaces: ${list(record.declarations.interfaces)}`);
    lines.push(`  functions: ${list(record.declarations.functions)}`);
    lines.push(`  repository: ${shown(record.publisher.repository)}`);
    lines.push(`  release: ${shown(record.publisher.release)}`);
    lines.push(`  artifact: ${shown(record.publisher.artifact)}`);
    lines.push(`  checksum: ${shown(record.publisher.checksum)}`);
    lines.push(`  receipt: ${shown(record.publisher.receipt)}`);
    lines.push(`  source commit: ${shown(record.publisher.sourceCommit)}`);
    lines.push(`  verification: ${shown(record.verification.status)} at ${shown(record.verification.verifiedAt)}; ${shown(record.verification.archiveBytes)} bytes; sha256 ${shown(record.verification.archiveSha256)}; ${shown(record.verification.method)}`);
    lines.push(`  availability: ${shown(record.availability.status)} at ${shown(record.availability.observedAt)}`);
    lines.push(`  policy: ${shown(record.policy.recommendation)}; ${shown(record.policy.statement)}`);
  }
  for (const conflict of result.conflicts.ambiguousCoordinates) {
    lines.push("");
    lines.push(`Ambiguous coordinate: ${shown(conflict.coordinate)}`);
    for (const claim of conflict.claims) {
      lines.push(`  ${shown(claim.contentRoot)} from ${shown(claim.provenanceId)} (${shown(claim.claimedSourceId)}; ${shown(claim.resolved)})`);
    }
  }
  for (const conflict of result.conflicts.multiplyListedObjects) {
    lines.push("");
    lines.push(`Same exact object listed by multiple sources: ${shown(conflict.contentRoot)}`);
    for (const source of conflict.sources) {
      lines.push(`  ${shown(source.provenanceId)} (${shown(source.claimedSourceId)}; ${shown(source.resolved)})`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function runCli(argv, io) {
  let options;
  try {
    options = parse([...argv]);
  } catch (error) {
    io.stderr.write(`Error: ${error.message}\n\n${usage}\n`);
    return 2;
  }
  if (options.help) {
    io.stdout.write(`${usage}\n`);
    return 0;
  }
  let result;
  try {
    result = await queryDirectory(options);
  } catch (error) {
    io.stderr.write(`Error: ${escapeHuman(error.message)}\n`);
    return 2;
  }
  io.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : renderHuman(result));
  return result.status === "sources-unavailable" ? 3 : 0;
}
