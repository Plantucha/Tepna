<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED — 2026-09-11 (DESIGN ONLY, deliberately unbuilt: the false-positive rate over the real brief set is being measured by a separate manual sweep and MUST land before any gate is proposed — see §5) · **Created:** 2026-09-11 · **Promoted-from:** residue `2026-09-11-brief-code-anchors-are-unchecked` · **Extends:** `DOCS-LEDGER-HEADER-REFS-2026-08-27-BRIEF.md` (`docs-ledger` check7, same family, different reference kind)

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
