# Query contract

`fgpm-known` reads one or more explicit `fgpm.known-package-source/1` datasets. The bundled reference source is only a default convenience and can be disabled with `--no-default-source`. Repeating `--source` adds local files, `file:` URLs, or HTTP(S) datasets. `--offline` disables network retrieval. Zero sources is valid.

Every listing retains its source attribution. The tool does not merge away equal objects or conflicting claims. It reports a coordinate as ambiguous when the same namespace, name, and version is listed with more than one content root. It reports an exact object as multiply listed when more than one source names the same root. Deterministic display order is not a recommendation or provider selection.

Claimed source identity is not transport provenance. Every requested source receives a deterministic query-local `source-NNNN` identity. Loaded reports and listings retain that identity together with the requested source specification and resolved file URL or final HTTP(S) URL. Duplicate claimed source IDs are marked as collisions and remain distinct in listing and conflict attribution.

A dataset is admitted atomically. The complete dataset must satisfy the published schema-equivalent runtime validator and all records must be searchable before the loaded source report or any listing is committed. A malformed or over-limit source contributes exactly one unavailable report and no listings; independently valid sources continue.

Querying performs no package installation, registration, import, selection, execution, project mutation, trust decision, or permission grant. An empty result means only “not known to these sources.” Direct package verification and use do not depend on this directory.

Machine output uses `fgpm.known-package-query-result/1`. Human output is a material-facts rendering of the same result object, including actual origin, claimed identity, declarations, publisher links, verification, availability, policy, and conflict attribution. Control characters, line separators, and bidirectional formatting controls in untrusted values are visibly escaped in human output. JSON uses JSON's normal escaping.

Source failures are explicit; successful records from other sources remain available with `partial` status. `partial` also takes precedence over `not-known` when a loaded source has no match but another requested source is unavailable, because the negative result is incomplete.

Default and maximum safety ceilings are: 32 sources; 2 MiB per source; 10,000 records per source; 20,000 admitted records per query; 16,384 UTF-16 code units per string; JSON depth 32; 100,000 JSON nodes; a 10-second HTTP(S) deadline per source; and 512 characters per reported error. Programmatic callers may lower, but not raise, these limits with the `limits` query option. HTTP bodies are streamed under the byte cap; local files are read through a bounded file handle. Timeout and limit failures are unavailable-source reports, and later sources continue.

Exit codes are `0` for a completed query (including no match and zero sources), `2` for command syntax errors, and `3` when sources were requested but none could be loaded.
