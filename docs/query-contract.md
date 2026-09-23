# Query contract

`fgpm-known` reads one or more explicit `fgpm.known-package-source/1` datasets. The bundled reference source is only a default convenience and can be disabled with `--no-default-source`. Repeating `--source` adds local files, `file:` URLs, or HTTP(S) datasets. `--offline` disables network retrieval. Zero sources is valid.

Every listing retains its source attribution. The tool does not merge away equal objects or conflicting claims. It reports a coordinate as ambiguous when the same namespace, name, and version is listed with more than one content root. It reports an exact object as multiply listed when more than one source names the same root. Deterministic display order is not a recommendation or provider selection.

Querying performs no package installation, registration, import, selection, execution, project mutation, trust decision, or permission grant. An empty result means only “not known to these sources.” Direct package verification and use do not depend on this directory.

Machine output uses `fgpm.known-package-query-result/1`. Human output is rendered from the same result object. Source failures are explicit; successful records from other sources remain available with `partial` status.

Exit codes are `0` for a completed query (including no match and zero sources), `2` for command syntax errors, and `3` when sources were requested but none could be loaded.
