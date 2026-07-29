<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Integrator]
brief: CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF.md
---
The Integrator can now tell a node with a wrong clock from a node that observed nothing — which it previously could not, and the difference is invisible: `runFusion` pairs events within `toleranceSec` (default **120 s**), and the reference deployment's CPAP runs **~39 min slow**, so no CPAP event has ever co-occurred with any other node's. `alsoObservedBy`, the apnea-confirmation path and the redundancy accounting `INTEGRATOR-FUSION-ISSUES` §3.1 protects have all been running on an empty intersection, silently.

**This is stage 1 of 2, and is scoped as a COARSE GATE.** Its job is to narrow an unbounded ±90 min hunt to a few-minute window, not to be the final answer.

## What it does

`estimateEventLag(aTimes, bTimes, opts)` — pure and exported — finds the lag at which two event sets best coincide, reporting `peakOverFloor` (peak count ÷ mean count across all scanned lags) as the honesty term: a weak or absent peak declares nothing rather than inventing a shift. `detectClockSkew(recs, opts)` estimates every dated pair and names a node only when it is skewed against **every** partner, with consistent sign **and agreeing magnitude**.

`runFusion` always emits a `clockSkew` block (so "checked, clean" is distinguishable from "never checked"), applies the fitted correction to a **shallow copy** so callers keep original timestamps, and honours `applyClockSkew: false` to declare without shifting. The app raises a permanent warning banner naming the node, offset, direction, evidence multiple, and that the correction is *fitted, not authoritative*.

Fitted rather than refused because the device is on its own cell network: it cannot be NTP-disciplined, so the offset is permanent and refusing to fuse would mean permanently discarding a signal that is fine apart from its timestamps. Never silent, though — that was the whole finding.

## Measured on the reference corpus, precision-first

| | |
|---|---|
| nights analysed | 38 |
| CPAPDex correctly named | **6** |
| a non-CPAP node wrongly named | **0** |
| fitted offset when found | median **38.5 min** (37.5–40.0) |

Every hit lands within 2 min of the 39.5 min offset established independently in the brief. A looser setting found **17** nights but also produced **7 false positives** — including naming a host-captured node as 29 min skewed on a night with **no CPAP present at all**. For a correction that gets applied, that is not a trade worth taking, so the tighter rule stands and the recall gap is closed by stage 2 rather than by loosening this.

What separated true from false was **not** peak-over-floor (true 3.5–7.2 vs false 3.0–3.8, overlapping) but **agreement in magnitude across partners**: a device whose clock is wrong is wrong by the same amount against everything it is compared with.

## Stage 2, for which this is the prior

The precise estimator already exists — `estimateDriftACC` in `pat-feasibility-worker.js`, shipped by `PAT-FEASIBILITY-2026-07-08`. It anchors on **strong isolated body movements** (> mean + 4σ, local maxima, ≥3 s apart) and cross-correlates tightly around each, because — in its own words — *"fixed windows drown a shared whole-body turn in decorrelated background"*. That is exactly why correlating whole series failed here: respiration at 5-min resolution gave margins of 0.02 over the next-best lag, and the CPAP's own oximetry turned out to be **empty on 197 of 197 nights** (`SA2.edf`'s `Pulse.1s`/`SpO2.1s` channels exist but were never populated — no oximeter was attached, which contradicts `CPAP-AUTOHARVEST-FOLLOWUPS` §2).

## Two estimator bugs the gate caught

Written down because both would have shipped silently. The scan kept the **first** tied lag, so a perfectly aligned pair reported **−60 s** — a hard match window makes the peak a plateau ~2×`matchSec` wide, and it now takes the plateau **centre**, which is 0 by symmetry when the clocks agree. And the attribution **sign was inverted**, which would have reported every skew backwards; the gate now pins direction, not just magnitude.

## Coverage

19 assertions: exact recovery of a planted +39.5 min offset and of a negative one, lag 0 on an aligned pair, refusal on too-few events, correct attribution among three nodes, no finding when all three agree, the declared-and-applied path end-to-end, caller recs left untouched, and `applyClockSkew:false` declaring without shifting. Includes a **mutation control** — unrelated event sets must not produce a confident skew (1.67×, well under the 4× bar) — without which the group would pass for a detector that always reports something.

Integrator re-bundled (`manifestHash 4b4fb067f293 → 34cc8dec37a5`) plus `docs/` and `OverDex`. `computeHash` moved `ebd789226368 → c16f4c416ba9`, so this is a re-verification, not an inertness claim: `verify-fixtures.mjs` re-ran the app and re-stamped `integrator_tch_golden`; no fixture output moved. `run-tests.mjs` **4299 green, 0 skipped** against the real corpus, `tsc` clean.

**Not wired into `tools/trio-batch.mjs`.** Attempted and reverted: trio-batch is a dispatcher whose per-node work runs in child processes, so a check placed in that path sees one node per child and silently does nothing — precisely the failure this feature exists to prevent. It needs the dispatcher/worker boundary handled deliberately, as its own change.
