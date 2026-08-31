<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: none
---
Six bug classes proven on 2026-08-31 folded into the deep-audit charter, each with the PR that proved it.

`AUDIT-PROMPT.md` gains a section of classes found *and fixed* in a single day, so an auditor pattern-matches
against a real instance rather than an abstraction. The receipts are the point — every claim names its PR.

- **A · The hollow-pinned oracle** — a test that *asserts the bug*. `test_registers_both_channels_and_pushes_each_batch`
  asserted the buggy `"L/min"` for `L/s` data, so every run was green and the pin was the thing to fix (#2009).
- **B · Two representations, one tested** — the EDF side of a channel was unit-tested, the bus side was not, and
  they disagreed silently. Fix shape is a **differential oracle** (`assert bus_unit == edf_unit`), which needs no
  third source of truth (#2009).
- **C · The instrument that cannot see** — a parse failure rendered as a clean zero. `loadSurvivors` parsed NDJSON
  only, swallowed every throw on a pretty-printed input, and printed "0 with a SURVIVING mutant" (#2008); sibling
  refusals named no test (#1995) and then no body (#1997). Fix shape is to **refuse on an empty result**.
- **D · A status field is not a verdict** — `canary: STALE` means *unguarded*, not *wrong*: a re-sweep reproduced the
  data almost exactly and still reported STALE (#2008). Siblings: *exists* ≠ *works*, and a RED gate meaning
  **could not measure** rather than *found something* (#2005).
- **E · The gate that cannot see what it guards** — a matcher narrower than the property it names, and a file-walk
  that scanned generated trees (#1982, #1998).
- **F · A brief marked DONE with a diagnosed defect open** — and its inverse, briefs describing built work as
  pending, one of which told readers to build a quarantined optimisation (#2009, #1994, #2002, #2005).

F carries the search rule the day kept re-teaching: check `tools/` **by concept, not by name** — the tool that
answered one of these is called `guarantees.mjs` and matches no search for "mutation".
