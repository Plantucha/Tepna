<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-09-01

# Vigil self-sustained folding — fit a night's fold into an 8 GB box that is also capturing

**One-line: owner requirement (2026-09-01): production vigil will have NO dev-box access — folding
and QC must run on the box itself, so trio-batch's ~17–25 GB-per-night memory footprint is now a
blocking defect, not a dev-box scheduling nuisance.**

## The requirement, verbatim

> "at some point vigil in production won't have access to dev box. it have to be self sustainable"

Today the architecture leans on `tepna-archive-pull.timer` shipping every night to the 64 GB dev
machine daily, where folding happens (or fails to — see below). That pull is an **interim**, not the
design: production vigil = capture + fold + QC on 8 GB RAM, alone.

## What is measured (2026-08-31 → 09-01, the OOM night)

- A **box-captured night needs ~17–25 GB per trio-batch worker** to fold. Direct: the kernel OOM
  log shows one node worker at **17.4 GB anon-RSS** (22:53:29); a 12-worker fold peaked **54.2 G**,
  2 workers **48 G**, AUTO **50 G** — three OOM kills in one refold, all on the box-capture trees.
  Phone-tree nights fold at the tool's ~0.9 GB design envelope; box nights are ~25× over it.
- The cost is **representation, not data**: a full night of every stream held as `Float64Array` is
  tens of MB (130 Hz ECG × 8 h ≈ 3.7 M samples ≈ 30 MB; everything else smaller). The waste is
  whole-file `readFileSync` UTF-16 strings, `split()` line materialization, and per-row objects.
  `trio-batch.mjs` streams nothing; the DSPs take whole text in (browser-shared contract).
- `trio-batch.mjs` already does the *containment* correctly: process-per-night children, AUTO jobs
  probed from free RAM, per-child `--max-old-space-size` from the budget. **Never force `--jobs`**
  past it (that is how all three OOMs happened). Containment does not help an 8 GB box: a cap on a
  17 GB need means the fold always dies.

## Pre-stated acceptance (written BEFORE the profile, per house rule)

1. **A real box night folds in ≤ 4 GB peak RSS** (systemd `MemoryPeak` of the fold unit, on a real
   ~1400-file night from `smoketest-captures`), leaving headroom for daemon + OS on 8 GB.
2. **Capture is the protected tenant**: the fold runs as its own systemd unit with `MemoryMax`
   sized to the box, `nice`, scheduled in the daytime dead zone after capture closes; the capture
   daemon carries negative `OOMScoreAdjust`. The failure mode must be "tonight's fold is missing",
   never "tonight's recording is lost".
3. **Node-export bytes are unchanged** by any memory work (substance-diff over the refolded corpus,
   volatile keys stripped) — this is a representation change, gate-provable as export-inert.
4. The DSPs' whole-text browser contract is **not forked**: memory work lands in the Node fold path
   (trio-batch feeding/sequencing) unless the profile proves DSP-internal storage dominates.

## Plan

- **P0 — heap-profile one box night** (the gate on everything else; ~20 min once the current refold
  frees the RAM). Which allocation dominates: (a) fragment concatenation / whole-night text held at
  once, (b) per-row parse objects inside the DSPs, (c) retained per-night results in the child?
  Decide P1 vs P2 from evidence, not the hypothesis above.
- **P1 — per-fragment sequencing in trio-batch** (if P0 blames concatenation): feed each parser only
  its own fragment file, release between; peak drops from whole-night to largest-fragment. No DSP
  contract change.
- **P2 — typed-array columns inside the DSP parse path** (only if P0 demands): the real ~10× win if
  row objects dominate, but it touches browser-shared modules → re-bundle + provenance regen + equiv
  gates. Not started without P0's evidence.
- **P3 — vigil rails**: the fold unit (systemd, `MemoryMax`, schedule-after-capture, capture
  `OOMScoreAdjust` protection), plus on-box QC already present. Route A (dev-box fold post-pull)
  stays the interim until P0–P2 land, then becomes the redundant copy, not the dependency.

## Done when

Acceptance 1–4 hold on vigil itself: a scheduled on-box fold of a real night completes under the
budget with capture running, and the produced node-exports byte-match the dev-box fold of the same
night (volatile keys aside).
