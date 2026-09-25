<!-- SPDX-License-Identifier: Apache-2.0 -->
# Automatic review V01 correction record

This record preserves the bounded correction made in response to `REVIEW-FGPM-KNOWN-PACKAGE-LINKS-V01` (`CHANGES_REQUIRED`). The retained review result was 32,388 bytes with SHA-256 `baa50d63f6dccd4cd9e587796f3d53eb7addf88885aa76f3b99167562778d03f`. The reviewed base head was `54dfcd8a9f7e9b56d89a8efce417bb97f07e9560`.

The registered review transaction was completed after evaluating the findings. Completion records receipt of the review only; it does not assert acceptance, publication, release, or deployment. The original review package was not resubmitted.

## Correction mapping

- F01: runtime validation now covers the complete published dataset shape and resource invariants. Each source is validated and searched in source-local structures, then committed atomically. A failed source contributes one unavailable report and zero listings.
- F02: remote and local bodies have byte limits; remote fetches have an abort deadline; record, total-record, source, string, JSON-depth, JSON-node, and error limits are enforced. Later sources continue after a timeout or limit failure.
- F03: every report and listing carries query-local requested/resolved provenance. Duplicate claimed IDs are marked and conflict summaries use provenance identities. Human output visibly escapes terminal controls and line/bidirectional controls.
- F04: an unavailable source takes precedence over a no-match result, producing `partial` even when the listing count is zero.
- F05: declaration extraction follows supported manifest structures. The `lossless` conversion descriptor was removed from functions in the corrected reference data.
- F06: human output now includes record identity, actual origin, claimed source, declarations, all publisher links, verification, availability, policy, and attributed conflict details. The query contract defines this material-facts projection.

## Validation receipt

Captured `2026-09-25T10:40:03.0637457+01:00` on Node `v24.18.0` and npm `11.16.0`:

- `npm run check`: exit 0.
- `npm test`: exit 0; 18 tests discovered, 17 passed, 1 environment-gated manager test skipped.
- `node --test test/public-manager.test.mjs` with `FGPM_PUBLIC_NODE` set to the installed Node executable and `FGPM_PUBLIC_ENTRY` set to the local FOSS Package Manager CLI: exit 0; 1 passed, 0 skipped.
- `npm pack --dry-run --json`: exit 0; 14 package entries, including `src/declarations.mjs`; 137,268 unpacked bytes.
- `git diff --check`: no whitespace errors.
- Corrected `data/reference-v1.json`: 60,311 bytes; SHA-256 `a41ccdd7e48eedde1ecabb27e99f885a8ace28507cf8f518aba354a126040d06`; the sidecar matches.

The manager-independence check used the local manager source entry rather than a separately extracted release archive. It supports the independence invariant but is not a new anonymous-release verification. No network release check was performed during this correction.
