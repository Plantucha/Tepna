---
bump: minor
type: added
brief: MUTATION-ACCOUNTING-LOOP-2026-08-27-BRIEF.md
---

`tools/mutation-adoption-delta.mjs` — §E3, closing §3-G4: *"nothing re-runs mutation after adoption to
confirm the adopted assertions kill their mutants."*

Adoption's value has been inferred **by construction** — a draft was written to discriminate a
surviving mutant, therefore adopting it kills that mutant. Reasonable, and not a measurement. This
measures it: previously-`SURVIVED` mutants that are now `KILLED`, each attributed to the group that
killed it via the journal's `ks`.

⚠️ **The verdict vocabulary has FOUR values, not two, and the fourth is the tool's central care.** A
journal line is written when a mutant is PLANNED (`{k}`) and rewritten when JUDGED (`{k,v,ks}`), so a
journal reads **last-write-wins per key**.

🔴 **Count keys, not lines — the first draft of this got it wrong.** The 30 committed journals hold
**12990 lines with no `v`** against 12982 that carry one, which reads like half the corpus was never
judged and is a plan-line artifact. Resolved per key: **6818 SURVIVED · 5987 KILLED · 93 INVALID ·
8 UNJUDGED (0.06 %)**. Nearly every no-`v` line is a plan superseded by its own verdict moments later.

The rarity is not a reason to fold UNJUDGED into SURVIVED — it is the reason folding it in would be
hard to notice. Eight mutants is invisible beside 12906 and material beside a delta of three.

> `v !== 'KILLED'` is not `SURVIVED`. It is *survived, or invalid, or never actually ran.*

Folding UNJUDGED into SURVIVED would put mutants nobody measured into the before-set, and any that run
and die in the after-sweep would be credited to adoption — **a positive delta because the sweep
finished, not because the assertions bite.** UNJUDGED is its own class, never a delta term, and is
reported: a mutant that stopped terminating between two sweeps is a finding about the harness.

**ABSENT is the same argument at a different scale**, and on a partial after-sweep it is the large
class: a mutant the sweep never reached is not a survivor either. A delta over a partial sweep is a
**lower bound over the mutants actually judged**, and is quoted that way.

Also separated rather than absorbed: a kill by a group the batch did **not** add (real, not
adoption's), a kill with **no** group recorded (unattributable, credited nowhere), and a
**REGRESSION** — killed before, surviving now — which is reported loudly and never as a negative
delta.

**20 selftest assertions**, including the acceptance criteria as planted controls: a survivor killed
by an adopted group measures 1; **a no-op adoption measures exactly zero** (the delta's own null
control — a delta that cannot produce zero on an unchanged pair is measuring the sweep, not the
adoption); UNJUDGED planted in both directions; the regression case; block idempotence.

The report block goes beside the drafts (machine-local, `--write`), and a metrics row is appended as
JSONL there. The drafts' own content is never rewritten — the same contract `verify-drafts.mjs` holds.

## The first measured delta — §6's metric now exists

`hrvdex-dsp.js`, before = the committed journal (which carries **zero** kills attributed to any
`mutation drafts` group, so it is a clean pre-adoption baseline), after = a fresh sweep under current
identity:

```
delta 3 · killedByOther 2 · killedUnattributed 0 · stillSurviving 134
regressed 0 · unjudged 1 -> 1 · newlyUnjudged 0
```

**Three previously-surviving mutants are now killed by the adopted group** — at lines 1148
(`eq !== -> ===`), 1179 and 1195 (`bool && -> ||`). Two more became killed by groups this batch did
not add; those are real and are **not** credited to adoption.

⚠️ **A LOWER BOUND, and it must be quoted that way.** The sweep ran 400 of the 490 mutants that exist
for this file (67 % killed overall). Mutants it never reached are **ABSENT**, not survivors, and
contribute to neither side. The delta is over the mutants actually judged.

And the corpus figure lands exactly where the header predicts: 8 UNJUDGED mutants fleet-wide is
invisible beside 12906 — and this delta is **3**. Folding that class into SURVIVED could have more
than doubled the first number the program ever reported.

