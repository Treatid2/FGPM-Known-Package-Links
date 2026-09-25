<!-- SPDX-License-Identifier: Apache-2.0 -->
# Browser assessment V01 final-artifact correction

This record addresses `RL-KL-01` from the 2026-09-25 consolidated Runtime/FGRW/known-links browser assessment. The assessment archive is 1,181,364 bytes with SHA-256 `9e82dd4645f2111d4a6be8b6e874bfbfe6b1f5c4a96fbeb4bfc474550d9ae6cc`.

The previous source snapshot was created by `git archive` on a Windows installation with `core.autocrlf=true`. Although both the committed blob and checked-out dataset were LF, archive export converted `data/reference-v1.json` to CRLF. The exported dataset was therefore 61,752 bytes with SHA-256 `408a6499a3ebe2eab05d4d0107b420be97ab8d5d5c0227bea17e0ef077911c2b`, while its sidecar and earlier receipt still described the intended 60,311-byte LF object.

The correction freezes repository text exports to LF through `.gitattributes`. `tools/verify-data-integrity.mjs` hashes the dataset's exact bytes, compares them with the sidecar without normalizing newlines, and parses the verified bytes as JSON. It runs before both the ordinary test suite and `npm pack`, so a fresh extraction with altered dataset bytes fails before tests or packaging can succeed.

The intended dataset representation remains 60,311 bytes with SHA-256 `a41ccdd7e48eedde1ecabb27e99f885a8ace28507cf8f518aba354a126040d06`. The record contents and query implementation are unchanged. The earlier CRLF export remains provenance evidence and is not relabelled or replaced in place.

This correction does not assert merge, publication, release, deployment, acceptance, task closure, cycle closure, or authority movement.
