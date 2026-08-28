<!--
  CLAUDE-MD-REDUNDANCY-AUDIT-2026-08-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-28 (**owner verdict: option (a), CONVENTION-ONLY — no dedicated trim pass.** The 17.8 % band-gap measurement (§2a) was resolved by the owner choosing among three explicitly presented options. Ratified as standing convention: **never restate in prose what a gate's red output already prints; compress such gate-description passages whenever a PR touches their section anyway** (seam 1, opportunistic, zero dedicated cost). Seam 2 — incident narratives and corrected-error annotations — is KEPT deliberately: it teaches calibration a one-liner cannot. The §2.4 band's hole stands as this brief's methodological finding; see pre-state-the-threshold's band-gap corollary.) · **Created:** 2026-08-27

# CLAUDE.md redundancy audit — trim what the gates now enforce, keep what teaches

## 0 · The proposal in one paragraph

`CLAUDE.md` is loaded into every session's context, and it has grown by accretion: many of its
rules are now ALSO enforced deterministically by gates (`commit-shape`, `stale-file`,
`docs-ledger`, `release-ledger`, `guard-format`, `claude-md-claims`, `citation-ledger`, the
hooks). The AGENTS.md ecosystem's core design principle — *"if a constraint can be enforced
deterministically by a tool already in the repo, it must not be restated in the context file"* —
plus published measurement that bloated context files reduce agent success by >20 % (Gloaguen
et al. 2026, cited in the ASDLC AGENTS.md spec) argue for a disciplined trim: where enforcement
is TOTAL, compress the passage to its one-line rule + the WHY + a pointer, and move the full
incident narrative to a brief. **This brief proposes the audit; nothing is trimmed until the
owner ratifies the item-by-item diff.**

## 1 · Why this is genuinely contested here (the counter-position, stated first)

The house style — failure-dated rules with the incident inline — is not decoration. Measured
properties this repo depends on:

- **The prose prevents; the gate detects.** `commit-shape` catches the corruption commit AFTER
  it exists; §👥.2's narrative is what stops a session from creating it. Trimming prose because
  the gate exists confuses the two layers (CLAUDE.md §2b-bis makes exactly this distinction).
- **Several rules are NOT mechanically enforceable** (§2c rebase reverts, the ≥3-anchor
  contract's reasoning, "measure the tree not the ref") — their only enforcement IS the prose.
- **The corrected-error genre teaches calibration** ("this sentence used to say X and was
  wrong") in a way a one-liner cannot.

So the audit's null hypothesis is *keep*. A passage is a trim candidate only when ALL of:
(a) a gate reds CI on violation with no escape hatch a session would plausibly reach for,
(b) the passage's content is recoverable one hop away (a brief, a tool header, a test name
printed in the failure), and (c) the WHY survives in the compressed line.

## 2 · Method

1. Enumerate every normative constraint in `CLAUDE.md` (sentence-level inventory; expect
   150–250 items).
2. Classify each: **gate-enforced (total)** · **gate-assisted (partial: hook-only, one-lane,
   escape-hatched)** · **prose-only**.
3. For gate-enforced items, draft the compressed form: rule + WHY + pointer (target ≤ 2 lines).
   Gate-assisted and prose-only items are KEEP by default.
4. Measure: bytes and estimated tokens before/after; count of items per class. Pre-stated
   success band: a worthwhile trim saves ≥ 20 % of the file's tokens without moving any
   prose-only rule; below 10 % savings, recommend NOT executing (the churn and link-rot risk
   outweigh the context saving).
5. Deliver the item-by-item diff to the owner. Execution is a separate, ratified step —
   and any executed trim must keep `claude-md-claims` and every `CLAIM` marker intact.

## 2a · PILOT EXECUTED 2026-08-27 — and the answer is that §2.4's band has a HOLE

Rather than inventory 150–250 items to reach a foregone conclusion, the two heaviest plausible
candidates were inventoried at sentence level and the result extrapolated under a **deliberately
generous** assumption. **The arithmetic gate was pre-stated before measuring**, which is the only
reason the number below can be read as a result rather than a rationalisation.

### Pre-stated, before any classification

With pilot bytes `P` and file bytes `T`, savings extrapolate as `trim(P) + ½·rate·(T−P)` — every other
section assumed to trim at **half** the pilot rate. Setting that equal to §2.4's 20 % bar:

> **the pilot must be ≥ 34.4 % trimmable for the full audit to be worth running.**

### Measured

| section | bytes | trimmable | rate |
|---|---|---|---|
| §🔒 EXPORT-INERT | 6 062 | 2 177 | **35.9 %** |
| §📌 brief lifecycle | 9 409 | 2 574 | **27.4 %** |
| **pilot total** | **15 471** (16.1 % of file) | **4 751** | **30.7 %** |

**30.7 % < 34.4 %.** Extrapolated generously: **17 121 B = 17.8 %** of the 96 035 B file.

### 🔴 17.8 % is in a gap the brief never defined — so this is NOT a decline

§2.4 states two rules: **≥ 20 %** is worthwhile, **< 10 %** means recommend not executing. It says
nothing about the space between, and **the measurement landed exactly there.** The decline path is
therefore *not* pre-authorized by the brief's own text, and claiming it would be moving the goalposts
after seeing the data — the precise sin a pre-stated band exists to prevent. **Routed to the owner.**

The three live readings, none of which this brief can pick on its own:
1. **17.8 % is worth having** — ~4 300 tokens off every session's context for a day's work.
2. **17.8 % is not worth the churn** — the link-rot and re-review cost was what the 20 % bar priced.
3. **The band was set too coarsely** and should be re-derived — but that is an owner decision made
   *before* the next measurement, never after this one.

### What the pilot found that the byte count does not show

- **The four biggest sections are excluded by this brief's own §1 criteria**, not by preference:
  §7 hostAxis and §5 LANDING are prose-only, §🐍 capture-host *is* the trap it teaches, and §📌 is
  gate-**assisted** (`CLAUDE_ALLOW_STALE_BRIEF` is exactly the "escape hatch a session would plausibly
  reach for" that criterion (a) excludes).
- **The savings are concentrated in gate DESCRIPTIONS, not rules.** The largest single items are
  passages that *describe what a gate checks* — §📌's `docs-ledger` coverage list (757 B) and
  §🔒's GATE-C surface (823 B). The failure names print in the red output, so they are recoverable
  one hop by construction. Rules themselves compress badly.
- **The incident narratives are the second seam** (§🔒's 2026-07-14 stale-fixture story, 629 B), and
  trimming them is the contested half of §1 — they teach calibration, and this pilot does not settle
  whether that is worth 0.7 % of the file.

⚠️ **Honest error bar.** The per-item "compressed form" is a judgment call, not a measurement; the
rate is good to perhaps ±20 % relative. That does not rescue the verdict — even at +20 % the pilot
reaches 36.9 % and the extrapolation 21.4 % (and at −20 %, 14.3 %), i.e. *barely* over the bar on the most favourable reading
of an estimate. The honest statement is that the answer is **near the bar, not clear of it**, which is
itself the argument for asking rather than deciding.

## 3 · Interaction with AGENTS.md (landed with this brief)

The new thin `AGENTS.md` deliberately holds only the command table and the NEVER/ASK/ALWAYS
tiers, pointing here for depth. If this audit executes, the compressed CLAUDE.md and AGENTS.md
converge in style: enforcement in gates, orientation in short files, narrative in briefs. If it
does not execute, AGENTS.md still stands on its own.

## 4 · Done when

- [ ] Inventory + classification committed (as an appendix to this brief or a sibling data file).
- [ ] Before/after token measurement against the §2.4 pre-stated band.
- [ ] Owner ratifies: execute, execute-partially, or decline (all three are valid outcomes;
      decline flips this brief DONE with the measurement as its result).
