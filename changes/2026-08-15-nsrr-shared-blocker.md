---
bump: patch
type: changed
brief: DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md
---

Two independent briefs are blocked on the same records, and neither named the other.

`DEEP-AUDIT-V` **F8** (does the event-coupling statistic survive events arriving in bouts of 5–20 min?)
and `REM-STAGING-FOLLOWUPS` **§2b** (score the shipped REM conjunction against expert PSG labels) both
wait on NSRR data under a signed DUA. Each records its blocker; neither could see that it was the same
one.

**Why the local corpus structurally cannot supply it.** The committed CPAP night carries **20 events —
13 apnea, 7 hypopnea**. That is what effective therapy looks like, and it is why "the trio corpus is a
healthy sleeper" is a claim about the *recordings*, not about the subject. F8 needs clustering structure;
twenty events across a night can neither exhibit nor refute it at any useful power. **The blocker is
statistical, not instrumental** — and collecting untreated nights is a clinical decision, not an
engineering one.

**The reader F8 needs is already built.** §2a rebuilt `nsrr-adapter.js` for sleep staging, and it parses
respiratory events too:

```
nsrr-adapter.js:228   var kind = HYPOP_RE.test(concept) ? 'hypopnea' : APNEA_RE.test(concept) ? 'apnea' : 'resp';
```

plus `tools/nsrr-stage-validate.mjs`, `--selftest`-proven with no records required. So the marginal cost
of F8 **after** a DUA is a diagnostic, not an ingest pipeline.

**Consequence: the DUA unblocks two briefs, not one, and the second arrives with its reader written and
tested.** Neither brief argues that on its own. Recorded in both, so whoever weighs it sees the real
value.

Docs only: no code, no bundle, no fixture.
