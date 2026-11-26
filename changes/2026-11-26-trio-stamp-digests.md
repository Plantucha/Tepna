---
bump: patch
type: fixed
brief: PUBLISHED-NUMBER-PROVENANCE-2026-09-15-BRIEF.md
---

The pooled-hat stamp line now prints the `inputsDigest=` value that the TABLE-PROVENANCE gate recomputes. `corpusIdentity` adds `treeDigest`, which covers every tracked file under the root and ignores the scope of the nights read. `stampFields` prints that digest. Before this change, it printed the scoped `dataDigest`, which the gate rejects.

The `trio-batch` fold verdict now writes its output tree as a repo-relative path. Before this change, every fold commit carried an absolute home path, and secret-scan rejected it.
