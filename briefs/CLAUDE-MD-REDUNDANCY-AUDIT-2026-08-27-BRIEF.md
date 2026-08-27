<!--
  CLAUDE-MD-REDUNDANCY-AUDIT-2026-08-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (owner ratification required before ANY trim lands) · **Created:** 2026-08-27

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
