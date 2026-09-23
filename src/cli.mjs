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

function human(result) {
  const lines = [
    `Status: ${result.status}`,
    `Meaning: ${result.meaning}`,
    `Sources: ${result.sourceReports.filter((source) => source.status === "loaded").length} loaded, ${result.sourceReports.filter((source) => source.status !== "loaded").length} unavailable`,
    `Listings: ${result.count}`,
  ];
  for (const source of result.sourceReports.filter((item) => item.status !== "loaded")) {
    lines.push(`Source unavailable: ${source.requested} (${source.error})`);
  }
  for (const { source, record } of result.listings) {
    lines.push("");
    lines.push(`${record.coordinate.namespace}/${record.coordinate.name}@${record.coordinate.version}`);
    lines.push(`  root: ${record.package.contentRoot}`);
    lines.push(`  format/licence: ${record.package.format} / ${record.package.license}`);
    lines.push(`  source: ${source.name} (${source.id}@${source.version})`);
    lines.push(`  repository: ${record.publisher.repository ?? "unknown"}`);
    lines.push(`  release: ${record.publisher.release ?? "unknown"}`);
    lines.push(`  artifact: ${record.publisher.artifact ?? "unknown"}`);
    lines.push(`  verification: ${record.verification.status} at ${record.verification.verifiedAt}`);
  }
  for (const conflict of result.conflicts.ambiguousCoordinates) {
    lines.push("");
    lines.push(`Ambiguous coordinate: ${conflict.coordinate}`);
    for (const root of conflict.contentRoots) lines.push(`  ${root}`);
  }
  if (result.conflicts.multiplyListedObjects.length) {
    lines.push("");
    lines.push(`Same exact object listed by multiple sources: ${result.conflicts.multiplyListedObjects.length}`);
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
  const result = await queryDirectory(options);
  io.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : human(result));
  return result.status === "sources-unavailable" ? 3 : 0;
}
