<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS — 2026-09-11 (**the IDENTIFIER-EXISTENCE check is REFUTED and must not be built** — 15/15 false positives, zero sensitivity on its own defining case. ⚠️ **SCOPE CORRECTED same day — that is NOT 'the class is undetectable', and §7 was recorded one step too broad; see §8.** The §5 measurement landed the same day and killed it twice over — 15 of 15 candidates were false positives with zero true findings, and it has ZERO SENSITIVITY on the very case that motivated it. Declining was listed in §5.3 as a legitimate outcome and it is the outcome. The question is answered, so this is DONE with a negative, not parked — and §7 records what the measurement pointed at instead) · **Created:** 2026-09-11 · **Promoted-from:** residue `2026-09-11-brief-code-anchors-are-unchecked` · **Extends:** `DOCS-LEDGER-HEADER-REFS-2026-08-27-BRIEF.md` (`docs-ledger` check7, same family, different reference kind)

# A brief's quoted code anchor is checked by nothing

## 1 · The failure this exists for, and why dates cannot find it

**The risk is no longer a STALE STAMP. It is a stamp that was ACCURATE WHEN WRITTEN and was overtaken by
a landing nobody told it about.** Those are different populations and only one of them is findable by
sorting on a date.

Measured 2026-09-11 over all 507 briefs: 28 are IN-PROGRESS, **22 of them stamped within nine days and
15 within six**. The date-ordered search is exhausted — there is no neglected tail left to drain. Every
remaining brief carries a recent, detailed, verified stamp.

And a recent stamp is exactly what the motivating case had.

### 1.1 The motivating instance

`PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21` listed punch-list item **#2** as `🔶 OPEN, and partly advanced`,
quoting `ppgdex-dsp.js:1999-2002`'s `if (bad) { v = ref; nCorr++; … }`. That code was deleted by **#2333
(`5cd8d699`, 2026-09-07)**, which rewrote `correctRR` across 56 lines. The brief carried the quotation of
deleted code for **four days**, and its stamp was six days old — well inside anyone's freshness window.

**Nothing could have surfaced it.** The committed corpus cannot EXPRESS that behavioural change —
measured correction rates **0.00 % / 0.00 % / 6.25 %** against the ~28.8 % the fix targets — so no gate
could redden on the behaviour. Two fixtures did move, but only by a `contentId` line: an identity hash
that shifts on ANY compute-path edit and names no item. It was found by a human-equivalent read
comparing one brief against the log, which does not scale to 28.

## 2 · The proposal

Assert that a brief's quoted **code identifier** still occurs in the file the brief names.

This is `docs-ledger` **check7** one reference-kind over. check7 resolves a backticked `*-BRIEF.md` on a
`**Status:**` line against the real brief set; this resolves a backticked code identifier against the
real tree. Same group, same shape, same self-test discipline.

## 3 · ⚠️ Two cautions that make it non-trivial

### 3.1 Key on the IDENTIFIER, never the line number

Line numbers rot independently of the code they point at — measured twice: residue
`2026-09-06-brief-header-file-line-citations-rot` records two citations in one header that had both
drifted while the code was untouched, and following them read as the CLAIM being false rather than the
coordinate being stale. A line-keyed check would therefore fire constantly on correct briefs and be
switched off inside a week. `file:line` may be *displayed*; only the identifier may be *asserted*.

### 3.2 A naive check convicts briefs that are RIGHT

A brief that quotes removed code **in order to say it was removed** is doing its job. The residue row
that spawned this brief does exactly that, and so does §1.1 above — this document would fail its own
check on its first run.

**An invariant that flags deliberate, correct behaviour is the wrong invariant, not a finding.** The
exemption must be by **declared provenance**, never by shape: `tools/commit-shape.mjs` exempts a commit
by its `Revert `/`rescue:` prefix precisely because a rescue snapshot is shape-identical to the
corruption it resembles, and widening the shape rule would re-admit the accident. Anything inferred from
surrounding prose ("the sentence sounds past-tense") is a shape rule wearing a provenance costume.

Sketch, to be argued in the design pass rather than adopted here: an explicit marker on the quotation —
the way `authorAliases` requires an `aliasSource` — so "this identifier is gone and that is the point"
is *declared* by the author and machine-visible, and everything undeclared is asserted.

## 4 · What it would have caught, and what it would not

- **Would have caught** §1.1: `v = ref` quoted as live, absent from the file.
- **Would NOT catch** a brief whose quoted code still exists but whose *claim about it* went stale.
  This check is narrow on purpose; the wider version is unbounded.

## 5 · 🔴 DONE-WHEN — the measurement comes FIRST

1. [ ] **A measured false-positive rate over the CURRENT brief set, before any gate is proposed.** A
       manual sweep (Magpie, in flight 2026-09-11) records per brief examined whether a naive identifier
       check would have flagged it **and whether that flag would have been RIGHT**. That ratio is the
       input to every decision below. ⚠️ `citation-ledger` deliberately EXCLUDES `briefs/` because
       gating them ran **35 % false positives** — this check has the same exposure and the same
       precedent against it.
2. [ ] A declared-provenance exemption specified — marker, placement, and what an undeclared quotation
       means — with a plant proving the exemption cannot be earned by prose alone.
3. [ ] A decision, ON that rate: gate · advisory-only · or **decline**. Declining is a legitimate
       outcome and §5.1's precedent is that it has been the right one before.
4. [ ] Only then: the check, its self-tests, and a ratchet.

## 6 · Scope

Node-lane only (it reads `briefs/` and the tree from the filesystem, as `docs-ledger` already does).
No bundle, no runtime surface, no fixture movement.


## 7 · 🔴 REFUTED 2026-09-11 — the measurement, and where it points instead

The §5.1 sweep (Magpie, by hand over the 22 punch-list/★ briefs, PAT excluded) returned **15 of 15
false positives and zero true findings**. Two independent reasons, either of which is fatal.

### 7.1 The false positives are STRUCTURAL, not incidental

The dominant class is **proposed-but-not-yet-built**: `spanHours` from *"additive `spanHours`"*,
`_PREF_RANGE` from *"**Fix.** A `_PREF_RANGE` table beside `_PREF_RATE`"*. **A brief's PURPOSE is to
describe work not yet done, so its identifiers are EXPECTED to be absent.** The check was pointed at the
one document class where absence is the normal state — which §3.2 half-saw (it anticipated
quoted-as-removed) and still under-counted, because it treated the exemption as an edge case rather
than the majority.

The rest: quoted to say it was removed (`morningCount`) · a row already marked FIXED (`pickSite`) · **the
absence IS the argument** (`effortPresentFrac` — the brief says the registry has no such entry, so the
check would flag exactly the briefs that state an absence correctly) · renamed with the mechanism alive
(`fuseHrvConsensus` → `hrvConsensus`) · third-party identifiers (`engzee_ecg_detector`, `start_from`) ·
not code at all (a fixture name, a filename fragment, a DOM class).

### 7.2 🔴 AND IT IS BLIND TO ITS OWN DEFINING CASE

Run as a positive control against `PPGDEX-ALGORITHM-DEEP-DIVE` — §1.1, the instance this brief exists
for — it flags **nothing**. Verified here: `correctRR` occurs **21 times** in `ppgdex-dsp.js` today. The
identifier is ALIVE; what went stale was the BEHAVIOUR it was described as having.

**An existence check cannot see a behaviour change**, and a behaviour change is precisely what lands
when an approved item ships. So the check would be 100 % noise AND miss the thing it was built for —
worse than nothing, because its silence would read as *"no stale briefs"*.

### 7.3 What the negative result points at

The defining instance was found by a human reading a brief against a merged PR — and **#2333 already
named the brief item in its own body**. So the cheap mechanism is not a scanner over briefs; it is **the
landing PR stamping the brief row it executes, in the same PR** — CLAUDE.md's *"triage stamps the brief"*
rule extended from TRIAGE to EXECUTION. That removes the class at the source rather than detecting it
afterwards, and costs one line in a PR already touching the work.

⚠️ **Scope of the negative, stated honestly:** 22 punch-list briefs of 507, the highest-yield slice. That
bounds the FP rate where the check would have been most useful; it does not prove the wider class empty.
The instance in §1.1 is real. It is simply **not identifier-shaped**.


## 8 · ⚠️ SCOPE CORRECTION — the negative was recorded one step too broad

§7 refuted the **identifier-existence** check and that refutation stands on its measurement. It does
**not** establish that the class is undetectable, and §7.3's implied *"only a convention change works"*
is withdrawn. Exactly one detector SHAPE was tested — the grep-shaped one — while CLAUDE.md's **standing
pickup step** (`node tools/doc-search.mjs`, owner-mandated 2026-08-26: *"a brief pickup starts with a
semantic search, not a grep: grep finds only your own vocabulary"*) went unused by both the sweep and
this design. A negative from one untried-alternative is a negative about the instrument, not the class.

### 8.1 The semantic shape, demonstrated at n = 1

Measured 2026-09-11:

| query | top hits |
|---|---|
| the **stale** claim — *"correctRR fills rejected intervals with a running median"* | **the brief 0.636** · DEEP-AUDIT-FOLLOWUPS 0.604 · `sensor-trio-worker.js` 0.602 |
| the **true** claim — *"correctRR excludes a rejected interval instead of filling it"* | `sensor-trio-worker.js` 0.630 · **the brief 0.612** · `ppgdex-dsp.js` 0.595 |

The direction is real, and it is the one shape that CAN see this failure: the stale claim ranks the
brief first; the true claim ranks code above it. An identifier check scores zero here because
`correctRR` is alive (21 occurrences) and only its BEHAVIOUR is stale.

### 8.2 ⚠️ But the separation is WEAK, and weaker than first relayed

The brief scores **0.636 vs 0.612** across the two queries — a **0.024** gap — and it is **rank 2 on the
negation, not absent from the top 3** as an earlier relay of this result stated. A detector keyed on
"does the brief outrank the code" would decide on a margin indistinguishable from embedding noise at
n = 1, and the runner-up on the stale query is a DIFFERENT brief, not code.

**So this is a demonstration, not a baseline.** It needs exactly what §5 demanded of the identifier
check and for the same reason: an FP tally over the same 22-brief slice with each flag judged RIGHT or
WRONG by hand, BEFORE any gate is proposed. Proposing one on a single favourable pair would repeat the
error this brief exists to document — and would do it in the document that documents it.

### 8.3 Status

**IN-PROGRESS, not DONE.** One shape is closed; the question is open. The baseline is owned by the
session that ran the first sweep; this brief folds the result when it lands.
