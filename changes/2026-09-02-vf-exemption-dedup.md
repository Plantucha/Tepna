<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---
The bootstrap exemption's audit line counted one fixture as two. Found by its own first real run.

`verify-fixtures.mjs` printed:

    ▸ BOOTSTRAP EXEMPTION APPLIED — §3.1 named exactly 2 first-generation fixture(s) this run stamps;
      Excused: integrator_apnea_null_twins.node-export.json, integrator_apnea_null_twins.node-export.json

One fixture, listed twice. The §3.1 assertion appears TWICE in the suite's stdout — once in its
group's body and once in the `▸ FAILURES` summary — and both lines carry `got [...]`, so every name
is parsed from each. The DECISION was unaffected (a subset test is indifferent to duplicates, and the
run stamped correctly), but that line exists so an exemption can be AUDITED, and a false count in it
is the unchecked claim this tool exists to prevent.

The six selftest cases all used a SINGLE occurrence, so none of them could express the bug. The new
case emits §3.1 twice as the real suite does — and asserts the LIST and the COUNT, not just the
verdict: planted against the un-deduped code, the verdict case still passes and only the count
assertion fires.
