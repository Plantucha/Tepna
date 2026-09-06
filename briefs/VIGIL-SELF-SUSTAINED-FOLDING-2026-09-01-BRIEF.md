<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED (drain triage 2026-09-02 — SURVIVES as a real owner-mandated work-unit, not parked. Owner: Kestrel (P0 heap profile of one box night through `trio-batch`, on rig-x870, at a fresh-budget window) → Heron (the protected-tenant units on the box, owner-authorized). Next step: P0 — measure where the 17–25 GB/worker goes before designing anything) · **P0 BOX-SIDE MEASURED 2026-09-06 (Wren, on vigil, read-only, bands pre-stated before measuring):** the box is **15.4 GB total / 12.9 GB available**, NOT the 8 GB this brief assumes — see §P0-box below, and the 8 GB premise is logged as `2026-09-06-folding-brief-assumes-8gb`. Verdict **INFEASIBLE AS-IS**: a 17–25 GB fold exceeds physical RAM, so P1/P2 reduction is mandatory rather than optional, and the reduced target must peak **under ~10 GB**. Capture is NOT the constraint — the daemon's peak RSS is **89 MB** (VmHWM; systemd MemoryPeak 71.6 MB), i.e. 0.6 % of RAM. Disk and CPU are both FEASIBLE with wide margin (167 GB free against 1.3 GB/night; 78.9 % idle). The rig-side heap profile — which allocation dominates — remains Kestrel's and is untouched by this) · **Residue:** 2026-09-06-folding-brief-assumes-8gb · **Created:** 2026-09-01

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
### P0 box-side — what the box actually has (measured 2026-09-06, Wren)

Read-only, on the live box, nothing restarted and nothing competing with a recording. **Bands were
stated before the numbers were taken**, because a headroom verdict is exactly the kind that gets
fitted to whatever is measured: FEASIBLE ≥ 26 GB available · MARGINAL 10–26 GB · INFEASIBLE < 10 GB ·
disk needs ≥ 2× a night's raw bytes · CPU needs ≥ 50 % sustained idle.

| quantity | measured | source |
|---|---|---|
| RAM total / available | **15 366 MB / 12 924 MB** | `free -m`, idle, no device recording |
| swap | 4 095 MB, **16 KB used** | `swapon --show`, `/proc/meminfo` |
| CommitLimit / Committed_AS | 11 470 MB / 2 607 MB (8.9 GB headroom) | `/proc/meminfo`, `overcommit_memory=0` (heuristic) |
| daemon RSS (peak) | **89 MB** VmRSS = VmHWM | `/proc/<MainPID>/status` |
| daemon peak, systemd | 71.6 MB; per-run 67.4–68.1 MB across last night | `MemoryPeak`, journal run summaries |
| disk free (`/srv`, `/opt` — one volume) | **167 GB** of 233 GB | `df -h` |
| one night's raw bytes | 1.3 GB (2026-09-05, 10 h, 4 devices + CPAP) | `du -sh` |
| CPU idle | **78.9 %** cumulative, 4 cores | `/proc/stat`, 5 s sample |

**Verdict: INFEASIBLE AS-IS on RAM; FEASIBLE on disk and CPU.** A 17–25 GB fold does not fit in
15.4 GB of physical RAM, and 12.9 GB available plus 4 GB of swap (16.9 GB) only reaches the bottom of
that range while guaranteeing thrash — so P1/P2 are not optimisations here, they are the gate. A
reduced fold should target a peak **under ~10 GB** to run beside capture with the page cache intact.

**Capture is not what is squeezing the box, and that is the load-bearing finding for the design.** The
daemon's high-water mark is 89 MB — 0.6 % of RAM — so folding does not need to be scheduled around
capture's memory at all; the whole 12.9 GB is available to it. The interesting constraint is CPU
contention and I/O, not co-residency, and both measure comfortable (78.9 % idle, 128× disk headroom).

⚠️ **THE 8 GB PREMISE DOES NOT DESCRIBE THIS BOX.** The brief designs against "8 GB RAM, alone";
vigil measures 15.4 GB. Two readings are possible and they lead to different designs, so this is
recorded rather than resolved here: either the 8 GB refers to FUTURE production hardware (the
`HP 800 G3 mini` / `MINIX Z100` choice still open in `VIGIL-OFFLOAD-AND-RETENTION`), in which case the
headroom is *worse* than measured and the under-10 GB target becomes an under-5 GB one; or it is a
stale assumption about this machine, in which case there is ~60 % more room than the plan assumes.
**Which box the requirement targets is an owner question, and the P1/P2 sizing depends on the answer.**

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
