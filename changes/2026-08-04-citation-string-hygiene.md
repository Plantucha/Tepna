---
bump: patch
type: added
nodes: []
brief: DEX-CITATION-FORMULA-AUDIT-BRIEF.md
---

Gates the offline-checkable half of the citation audit across all node registries: no malformed DOI
(one trailing a full stop cannot resolve, and a reader cannot tell that from a fabricated one) and no
correction history in a reader-facing `cite`/`label`/`unit` string. Measured clean over 956 strings
when it landed, so this is a ratchet rather than a fix; mutation-verified both ways. Records the
headline finding too: across 412 `cite:` strings there are zero DOIs — the registries cite author-year
— so the audit's "working DOI/PMID" criterion is unmet by construction and unclosable without reading
the literature. The gate deliberately does not require a DOI, because a rule that pressures 412
identifiers into existence is worse than the gap it closes.
