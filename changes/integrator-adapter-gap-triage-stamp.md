---
bump: patch
type: fixed
brief: INTEGRATOR-OXYDEX-ADAPTER-GAP-FOLLOWUPS-2026-07-22-BRIEF.md
---

**Triaged, not built: every section of the Integrator↔OxyDex adapter-gap followups is closed, and
both residues are data-shaped rather than code.**

The brief read as live work at IN-PROGRESS. It is not. §1 closed (the rich export has a committed
golden) · §2 answered, and §2.2's wiring ask resolved 2026-08-20 — the guard exists for every summary
that *has* a reader, and a global one would red on someone else's file · §3 audited and **gated**
2026-08-04, structurally and mutation-verified · §4 closed 2026-08-18.

**Two residues remain, neither a work-unit:**

1. Regenerate or delete `OxyDex_2026-07-02_2205_summary.json` — a **gitignored working file belonging
   to whoever generated it** (§👥.2). Nothing reads it, so it corrupts no analysis; it is only
   indistinguishable from a live export to the next person who globs the directory.
2. **§5's gap is real, and re-verified against the ledger rather than taken on the brief's word:**
   both `integrator_fusion_2026-06-11/13.json` are `historical: true` — byte-pinned, not code-gated —
   and the only code-gated Integrator fixture is `integrator_tch_golden`, which exercises TCH, not
   fusion. So **no fixture re-runs the Integrator's fusion against a real multi-node night**, exactly
   as §5 says. Closing that means committing a real multi-node night as a code-gated fixture — a
   corpus and privacy decision, not an edit.

⚠️ **One number in the brief has drifted and is now wrong to quote:** §5 records
`integrator_tch_golden verifiedUnder → 289ab4da91fe`; the ledger reads **`48a16810b759`**. The
fixture has been re-verified since — the system working — but a reader citing §5's hash would be
citing a stale one. Recorded rather than silently corrected, because the drift is the interesting
part.

Kept IN-PROGRESS rather than DONE: residue (1) is genuinely outstanding, so DONE would be false. Out
of the queue because no code discharges either residue. Docs-only — one header, one `DOCS-INDEX` pill.
