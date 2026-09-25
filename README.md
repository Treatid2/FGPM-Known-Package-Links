# FGPM Known Package Links

This is an optional, independently usable directory for source-attributed links to known FGPM package releases. It is not a registry of permitted identities, a compatibility resolver, a trust authority, an installer, or a required FGPM service.

The component is dependency-free and works with Node.js 20 or newer. Its bundled reference dataset records 28 exact package archives from the immutable [FGPM v0.11.0-rc.6 release](https://github.com/Treatid2/FOSS-Package-Manager/releases/tag/v0.11.0-rc.6), verified by anonymous download and recomputation of each FGPM content root. One accepted integration package is intentionally absent because its exact accepted tree contained a private coordination identifier; absence is not revocation or invalidity.

The corrected `data/reference-v1.json` SHA-256 is `a41ccdd7e48eedde1ecabb27e99f885a8ace28507cf8f518aba354a126040d06`; the adjacent sidecar is informational and the JSON source remains replaceable. Declaration extraction follows the supported package-manifest structures and does not treat descriptive values such as conversion quality as callable functions.

## Query

```powershell
node .\bin\fgpm-known.mjs list
node .\bin\fgpm-known.mjs search runtime.scheduler --json
node .\bin\fgpm-known.mjs get --namespace 6d7092e8-6f8a-4e25-bb6e-a0bf6588e5b4 --name demo.camera
node .\bin\fgpm-known.mjs list --no-default-source
node .\bin\fgpm-known.mjs search camera --no-default-source --source .\my-private-source.json
```

Use repeated `--source` options to query multiple sources. Use `--offline` to reject HTTP(S) retrieval. A valid query with no matching record says “not known to these sources”; it does not say that a package is invalid or unauthorized.

Each source is validated and processed completely before any of its claims are admitted. Listings carry both the source's claimed identity and an immutable query-local provenance identity containing the requested and resolved origin. Input bytes, records, strings, JSON depth/nodes, source count, total records, fetch duration, and reported errors have fixed safety ceilings; programmatic callers may configure lower limits per query.

The [query contract](docs/query-contract.md) documents semantics and exit codes. The open [dataset schema](schemas/known-package-source-v1.schema.json) permits mirrors, forks, local/private sources, and independent catalogues.

## Tests

```powershell
npm test
npm run check
```

Set `FGPM_PUBLIC_NODE` to an extracted public `bin/node.exe` and `FGPM_PUBLIC_ENTRY` to its `bin/fgpm.mjs`, then run `node --test test/public-manager.test.mjs` to prove a valid package absent from every directory source remains independently verifiable by the manager.

## Licensing

Implementation code is MPL-2.0. Public contracts, documentation, tests, fixtures, and the original reference dataset are Apache-2.0. See [LICENSING.md](LICENSING.md).
