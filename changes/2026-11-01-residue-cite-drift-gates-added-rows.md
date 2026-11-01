---
bump: minor
type: added
brief: none
---

`tools/residue-cite-drift.mjs` gains a `--base <ref>` mode and runs under `npm run check`.
The mode keeps the ledger rows whose key the base does not carry. Those are the rows a branch
added, and it judges only their citations. Its exit needs no `--strict`, because a gate that
wants an unpassed flag decides nothing. An unreadable base reads NOT_RUN at exit 2, never an
empty diff. The whole ledger stays unjudged, since §📌 forbids repairing a row cell where it
sits.
