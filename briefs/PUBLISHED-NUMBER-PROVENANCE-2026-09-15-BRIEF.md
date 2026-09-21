<!--
  PUBLISHED-NUMBER-PROVENANCE-2026-09-15-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-09-21 (closed by Magpie, #2788, on the tree not the header: phase 1 BUILT #2514; phase 2 STAMP BUILT #2614; item 6 DONE #2787 — 26 sourced `CLAIM`s on the sweep's two drifted tables, against committed records. ⚠️ The DAG-HASH HALF of phase 2 is NOT built, verified 2026-09-21 in the gate itself: `docs · table-provenance · published-numbers` checks a resolvable `inputs=` path for EXISTENCE only (`env.treeHas`) and recomputes no digest over it, so a stamp with git-tracked inputs is distinguished from a recorded-only one but can still not CLEAR a churn flag — that remainder is residue row `2026-09-21-table-provenance-inputs-digest-never-recomputed`, one unit with a ready first consumer (`analysis/published-numbers/tch-pooled-hat-2026-09-21.json` already carries the digest). Phase 3 is EVIDENCE-GATED, not open: "only where phase 2 keeps firing" — no stamp has fired yet, so it is a parked sub-item, re-opened by the first real red, never by effort. Earlier header text follows: phase 1 BUILT #2514; **PHASE 2 BUILT 2026-09-18** — `TABLE-PROVENANCE` stamps, gate `docs · table-provenance · published-numbers`, first marked table in §4b. The output hash is over the TABLE TEXT, so a hand-edited cell reds: planted σ 0.07→0.99 and the gate moved `0f30dca78aa2`→`35750bcdda57`, which is the decay sweep's measured failure made mechanical, and it needs no corpus so it runs in CI. The marker distinguishes a RESOLVABLE committed `inputs` path from a recorded-only digest, because only the first can ever CLEAR a churn flag — §2 of the sweep says its screen "can FLAG but probably cannot CLEAR", and a committed upstream node is precisely what changes that. Phase 3 (generate rather than mark) remains unbuilt and is only worth it where phase 2 keeps firing — so it waits on evidence from phase 2 rather than on effort) · **Created:** 2026-09-15 · **Residue:** 2026-09-21-table-provenance-inputs-digest-never-recomputed · **Follows:** `audits/PUBLISHED-NUMBER-DECAY-SWEEP-2026-09-03.md` (the measurement this answers) · **Interlocks:** the `docs · claude-md · claims` gate, `tools/formula-constant-audit.mjs`

# 98 % of this repo's published numbers are uncheckable — and the fix is a convention, not a cleverer parser

> **In one line:** the decay sweep measured that at most **5 of 259** substantial published tables can
> be attributed to a producing tool; phase 1 adds `CLAIM <name> = <value> FROM <path>#<pointer>`, a
> marker that makes a number checkable by naming where it came from — chosen over a prose scanner
> because the scanner was built, measured, and **refused**.

## 1 · The gap, already measured

`PUBLISHED-NUMBER-DECAY-SWEEP-2026-09-03` established it and this brief does not re-derive it:

    brief files containing a table                          303
    tables total                                           1009
    tables with >=4 columns and >=3 numeric rows            259
    ATTRIBUTABLE to a producing tool, after manual audit       5

Of the four re-run, three diverged — for **three distinct reasons** (the tool changed; the corpus was
refolded; one was circularly rewritten), and the sweep is careful that none of them is *"wrong when
published"*. One reproduced exactly, which is its positive control.

The JS side answers the same question and answers it well: GATE-B is `hash(input) + executed-code
identity → hash(output)`, **36 fixtures, 34 code-gated, 17 carrying `verifiedUnder`** — which only a
tool that actually re-ran the app may write. Same repo, same question, opposite answer, split along a
language boundary that has nothing to do with the problem.

## 2 · ⚠️ THE PROSE SCANNER WAS BUILT, MEASURED, AND REFUSED — do not rebuild it

The attractive idea is statcheck's: recompute a reported quantity from the other quantities reported
beside it, needing neither the corpus nor the producing tool, and so reaching **all 1009 tables**
rather than the attributable 5. `statcheck` finds inconsistencies in roughly half of published
psychology papers on exactly this principle.

**Measured here 2026-09-15, over `briefs/ audits/ docs/`:**

| pattern | candidates | flagged | verdict |
|---|---|---|---|
| naive ratio↔percentage | 213 | 45 | **every one of 4 sampled was a FALSE POSITIVE** |
| strict (parenthesised, transitions excluded) | 14 | **0** | precise, and nothing to find |

Four distinct false-positive mechanisms in four samples:

| line | why it is not an inconsistency |
|---|---|
| `28 of 28 fail the tool's own 80 % floor` | 80 % is a **threshold**, not this ratio's percentage |
| `nf = 219/220/221 — a 16 % swing` | a **sequence** of values; the 16 % is unrelated |
| `61/319 → 118/319 = 36 %` | a **transition**; the percentage belongs to the *second* pair |
| `15 / 164 \| 8.4 %` | an **adjacent column** is the real denominator (15/179 = 8.4 %) |

**The conclusion is structural, not a tuning failure.** statcheck works because NHST reporting is
rigidly stereotyped — `t(28) = 2.1, p = .04` has one shape. **Its precision comes from the convention,
not from the checking.** Tepna's briefs are discursive prose with no such convention, so there is
nothing for a parser to grip: importing the mechanism leaves behind the thing that makes it work.

That reframes the remedy and is the brief's main result: **a marker is not the cheaper option, it is
the only one that works, because it CREATES the stereotypy statcheck depends on.**

## 3 · Phase 1 — sourced CLAIMs (BUILT, #2514)

`CLAIM <name> = <value> FROM <path>#<pointer>`, checked by the existing `docs · claude-md · claims`
gate, now scanning **briefs/** as well as CLAUDE.md (510 files).

The three pre-existing CLAIMs each need a **bespoke resolver hand-written into the gate** — which is
why there are three and not thirty. A sourced claim carries its own resolver.

- **Refusal is loud.** An unresolvable source REDS, never skips. A claim whose artifact vanished is
  precisely the stale number this exists to catch.
- **First claim** is a real published number: CLAUDE.md's trio corpus `20 eligible nights`, resolved
  against `analysis/tri_device_nights.json#count`. List length 20, count 20, prose 20 — all three
  agree today, which is what makes it a safe first marker rather than a fix.
- **Mutation-verified across all three failure modes**: a wrong stated value reds; a dead pointer reds;
  and the case the sweep actually measured — *the committed artifact moving while the prose does not* —
  reds. Two anti-vacuity assertions alongside, because a generic checker with nothing to check is not a
  gate.

## 4 · Phases 2-3 — specified, unbuilt

**Phase 2 — a per-table stamp.** `CLAIM`-per-number is right for prose and too heavy for a 20-number
table; a table wants one footer naming producer, invocation, input hashes and an output hash — GATE-B's
triple in a form Markdown carries. Two granularities, which is the granularity-levels point
`Workflow Run RO-Crate` makes from a different direction. Borrow its vocabulary; do **not** adopt
JSON-LD.

**Phase 3 — generate rather than mark**, for numbers a tool produces: resolve at build time from a
committed results JSON, Quarto's answer to prose numbers. Only worth it where phase 2 keeps firing.

**The upstream-DAG idea folds into phase 2's resolver, and it is the one that unblocks the sweep's own
remedy.** Section 2 of the decay sweep proposes a churn screen and states honestly that it *"can FLAG
but probably cannot CLEAR"*, because per-table corpus provenance is unknowable after the fact — table 4
proves it (tool unchanged, corpus refolded, diverged 3 of 3). `showyourwork` hashes *the rule and all
upstream dependencies* recursively. **If the corpus is an upstream node with a hash, table 4's case
invalidates automatically and the screen can clear.** The two proposals are not alternatives: one is
the other's missing input.

## 4b · First application — a marked table (phase 2)

The mechanism §4 specifies, applied to a number that will decay. These are tonight's three-cornered-hat
figures for the 2026-09-17 trio, and they are exactly the shape the decay sweep counted: a small table
of derived values, published in prose, with nothing today tying it to the run that produced it.

| night | n epochs | σ ECGDex | σ PpgDex | σ OxyDex | culprit | method |
|---|---|---|---|---|---|---|
| 2026-09-17 | 74 | 0.67 | 0.93 | 0.07 | PpgDex | classic→classic |
<!-- TABLE-PROVENANCE producer=tools/tch-multinight.mjs invocation="--dir uploads/trio" inputs=a6b6cb313cf5 output=0f30dca78aa2 generated=2026-09-18 -->

**What the marker buys, precisely.** `output` is a hash of the table TEXT, so hand-editing a cell
without re-running the producer reds — which is the failure the sweep measured, made mechanical. It
needs no corpus, so it works in CI.

⚠️ **`inputs` here is a RECORDED hash, not a resolvable path, and the gate must tell those apart.**
The trio corpus is gitignored, so nothing in CI can recompute it — this stamp can therefore be
FLAGGED when the corpus moves but can never be CLEARED, which is exactly the limit §2 of the decay
sweep states about its churn screen. A stamp whose `inputs` names a COMMITTED artifact can be cleared,
and that is the upstream-node case §4 identifies as the screen's missing input. Both forms are legal;
conflating them would let an unclearable stamp read as a cleared one.

⚠️ And read σ[OxyDex] = 0.07 as a flagged value rather than a measurement: the corpus median is 1.01,
so this night sits 14× below it and near the non-negativity boundary that excluded 9 of 68 nights from
the same run. That is D7's open question, and the marker's job here is only to tie the number to the
run — not to defend it.

## 5 · What was considered and rejected

**noWorkflow** (127★, MIT), proposed 2026-09-14. Rejected on three independent grounds, any one
sufficient:

1. **Epistemics.** It RECORDS a trial; GATE-B RE-RUNS one. This repo already shipped a pre-fix DSP to
   real CGM data on the strength of a recorded claim, and the fix was making the claim *computed* —
   `verifiedUnder` may only be written by something that actually re-ran the app. A tracer that records
   would re-import the failure mode the repo removed.
2. **Entry model.** Its unit is `now run script.py`, and **4 of the 5 candidate scripts have no
   `__main__` at all** — `nightarchive.py`, `allan.py`, `blind_spots.py`, `acq_evidence.py` are
   libraries. Only `jitterfloor.py` is a CLI.
3. **Reach.** Its trial DB lives in an isolated venv, outside every gate this repo runs — and an
   artifact no gate reads is the shape CLAUDE.md §4b keeps finding.

The licensing analysis (MIT into Apache-2.0, permissive dependencies, avoid the `[all]` extra) was
sound and is not the reason for rejection.

## 6 · What this does NOT do

- **It finds inconsistency, never wrongness.** Two numbers agreeing can both be wrong — the same
  discipline as the sweep's *"at risk is never a verdict"*.
- **A marked number is not a verified one.** Phase 1 checks a claim against a committed artifact; it
  does not re-run the producer. That is phase 2's `verify-published`, and "stamped" must never be
  displayed as "verified".
- **It is opt-in and therefore under-covers.** A number nobody marks is simply not gated — chosen
  deliberately, because a prose gate that reports the *documentation* of a rule as a violation of it is
  the failure the original CLAIM design already avoided.

## 7 · Done when

- [x] The prose-scanner alternative measured and refused, with its false-positive mechanisms named so
      it is not rebuilt.
- [x] `CLAIM … FROM …` parsed over CLAUDE.md + `briefs/`, resolving against a committed artifact.
- [x] Unresolvable source REDS rather than skipping; anti-vacuity assertions present.
- [x] Mutation-verified across all three failure modes, including artifact-moved-prose-didn't.
- [x] One real published number marked.
- [x] A second and third marker on numbers that have actually drifted, chosen from the sweep's table 3
      and table 4 — the markers that would have *caught* something, rather than one that agrees.
      **DONE 2026-09-21 (Magpie, #2787).** Both tables re-run and re-cut under a dated correction block
      beside the original: table 3 (`PAT-UNDER-PERBLOCK-ALIGNMENT` §3a, 18 `CLAIM`s — beats, legacy ratio,
      strict ratio × 6 nights) and table 4 (`SENSOR-TRIO-NIGHTS-PAPER` §11, 8 `CLAIM`s — both sides of the
      identity × 3 corners, nights, pooled seconds), each resolving against a committed record under
      `analysis/published-numbers/` that carries producer, commit, invocation, inputs (a RESOLVABLE
      git-tracked digest for table 4; recorded-only for table 3's gitignored raw captures) and the tool's
      full-precision output. ⚠️ Table 4 had moved a THIRD time since the sweep (h10 gap 0.007960 → 0.007835,
      54 → 63 nights) — the drift the sweep measured was still running while the fix was being built, which
      is the point. Table 3 reproduced the sweep's re-run exactly (deterministic surrogates, tool unchanged
      since 09-03). The gate's exact-equality compare needs the record to carry the values AT PUBLISHED
      PRECISION (`claims/*`, 2 dp ratios / 9 dp variances) beside the full-precision `result` — a convention
      the next marker should copy rather than re-derive.
- [x] Phase 2 per-table stamp — **BUILT #2614** (`TABLE-PROVENANCE`, output hash over the table text,
      resolvable-vs-recorded `inputs` told apart). **The upstream-DAG hash that lets the churn screen
      CLEAR is NOT built** — verified 2026-09-21 by reading the gate, not the header: a resolvable
      `inputs=` path is checked for existence only and no digest is recomputed over it. Residue row
      `2026-09-21-table-provenance-inputs-digest-never-recomputed` — **BUILT #PRNUM (2026-09-21):**
      `inputsDigest=<12hex>` beside a resolvable `inputs=`, recomputed by the runner over the git-tracked
      files under that path (sha12 over `path\0sha12(bytes)`, `git ls-files` order — the same recipe the
      `analysis/published-numbers/` records use), compared by the gate, refusing loudly when git or a file
      is unavailable. First clearable stamp: the table-4 re-cut in `SENSOR-TRIO-NIGHTS-PAPER` §11 over the
      441 trio exports. Plant: one byte appended to one export reds the leg by name (`e06b2bf23139` ≠
      `19c31a194ec7`). A blockquoted table is now captured (quote prefix stripped for detection and hash).
- [x] Phase 3 generate-rather-than-mark — **PARKED, evidence-gated, not open** (2026-09-21): it is
      worth building "only where phase 2 keeps firing", and no `TABLE-PROVENANCE` or sourced `CLAIM` has
      yet fired on `main`. The first real red re-opens it; nothing else does.

## 8 · The published-precision rule (a RULE, not a note — learned on #2787)

The `CLAIM` gate compares by **exact equality** against the committed artifact, and a producer's raw
output is full-precision. So **a record that backs sourced `CLAIM`s MUST carry the values AT PUBLISHED
PRECISION** (`claims/*` — 2 dp ratios, 9 dp variances, whole-percent rates, whatever the prose prints)
**beside the full-precision `result`**, and the marker points at `claims/<key>`. A marker pointed at the
raw value can never match once the prose rounds, and "round in the gate" would re-import the parser
problem §2 refused (whose rounding? to what?). The wrapper that rounds is part of the producer's record,
named in it, so the rounding is itself attributable. Both records under `analysis/published-numbers/`
follow this; the next one copies the shape rather than re-deriving it.
