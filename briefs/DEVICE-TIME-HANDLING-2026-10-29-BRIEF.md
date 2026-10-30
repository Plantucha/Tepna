<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-10-29 (O1 and U5 done; U1 measured, no code; U2 measuring; U3 claimed; U6 waits for the owner) · **Created:** 2026-10-29

# Brief — better time handling on every device

Rule 0: `time handling improvements per device clock drift host axis resync` →
`INTERDISCIPLINARY-LITERATURE-DIAGNOSIS-2026-08-16` §2, memory `vigil-box-clock-facts`,
`RADIO-CLOCK-SIDECAR-2026-09-07`, `INTEGRATOR-PAT-VASCULAR-2026-07-18`, `DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02` §1.2a.
Per-item searches are in §2 beside each item.

## 1 · Where each node stands (measured 2026-10-29 on `origin/main` `f74094549`)

The capture box disciplines its clock with chrony against a local stratum-1 source: 0.008 ppm residual.
Every wearable clock is worse. A node can borrow the box clock only where a row carries a device stamp
and a host stamp (Clock Contract §7).

| node | `hostAxis` refs in `*-dsp.js` | step detection (`clockResyncs`) | `clock.js` in the bundle |
|---|---|---|---|
| ECGDex (H10) | 50 | yes | yes |
| PpgDex (Verity, ring PPG) | 59 | yes | yes, since O1 (was **no**) |
| MotionDex | **0** | yes | yes |
| OxyDex (ring SpO₂) | 0 | **no** | yes |
| PulseDex, HRVDex | 0 | no | yes |
| GlucoDex, CPAPDex | 0 | no | no |

Counted with `grep -c` per file; the bundle column is `grep -c 'data-inline-src="clock.js"' <App>.html`.

**The PpgDex bundle carries no clock spine.** `ppgdex-dsp.js:1250` then returns
`{ ok:false, reason:'no clock spine in this bundle' }`, and `:1253` never corrects `fs`. The fold
(`tools/trio-batch.mjs:1535`) and the test runner co-load `clock.js`, so corpus numbers are
host-corrected and the app's numbers are not. Row `2026-09-22-ppgdex-fixture-spread-not-bundle-reproducible`
named remedy (b), "PpgDex inlines `clock.js`", as the owner's decision. #3914 closed that row by the
fixture route. The owner approved **O1** in §4 on 2026-10-29. The PpgDex clock PR inlines `clock.js` and closes the app gap.

**Scope of O1 (Heron, board #2195).** An unstamped finger file defaults to `'device-crystal'` at `ppgdex-dsp.js:1403`. Line 1446 then sets `fs = O2_ADC_HZ` after `:1253`. So the `:1253` correction reaches the Verity and the host-disciplined ring nights only. Heron's #2164 counted 516 ring exports that declare `host-disciplined` and 5 that declare a crystal.

## 2 · The units

### U1 · Ring PPG: one host anchor per `PMDARRIVAL` frame — **Kestrel**

Search: `O2Ring PMDARRIVAL frame anchor every row host axis` → `O2RING-FRAME-SAMPLE-LOCK-2026-08-03`
(REFERENCE), `tools/o2ring-frame-cadence.mjs`.

- Today the ring axis takes one anchor every `PPG_AXIS_EVERY = 500` rows.
- Each `PPG_FRAME` row carries `n_samples`. The cumulative sum minus 1 is the frame's last row. That row's
  Phone timestamp equals the arrival time: 0 ms at median and p95 on 2026-10-25 (27512 frames, sum
  3467814 = the PPG row count).
- One anchor per frame gives ~4× the anchors and seam resolution at one frame.
- Expected accuracy change: small, because the stamps already equal arrival. The scratch build runs; the
  retest arm `trio-sc-arrival` scores it against the H10 ECG.

- [x] Retest scored against the ECG, box nights and phone nights separately (2026-10-30, board #2207)
- Withdrawn 2026-10-30, because the arm did not win: `parsePPG` reading `opts.arrivalText`, and the
  PpgDex fixture regen that it would have owed.

**Result (2026-10-30).** Population: 97 nights, 94 with an H10 ECG, scored in 5-min bins against the ECG HR.

| group | nights | today MAE | arrival MAE | crystal MAE | arrival vs today, better/worse |
|---|---|---|---|---|---|
| box | 69 | 0.28 bpm | 0.31 bpm | 0.43 bpm | 17 / 28 |
| phone | 24 | 0.38 bpm | 0.38 bpm | 0.39 bpm | 0 / 0 |

One anchor per frame reads no better than one anchor per 500 rows, so U1 lands no code. Phone nights
carry no `PMDARRIVAL` file, so the arrival arm equals today there by construction. Today's host axis
beats the crystal on 55 box nights, and the crystal wins 7.

### U2 · Correct each beat through `correctionAt()`, not one `fs` per night — **Heron**

Search: `per-beat correctionAt instead of fs ppm rescale` → `DEVICE-RATE-TRUTH-2026-08-05` §9,
`IBI-ALIGNMENT-LIMIT-2026-08-01`, `papers/wearable-clock-drift.html`.

- **Correction (Heron, board #2193).** The per-beat mapping already ships: `ppgdex-dsp.js:1288` sets `relSec[i]` through `correctionAt(devMs)`. The defect left is `fs` alone.
- `ppgdex-dsp.js:1253` divides `fs` by `(1 + ppm/1e6)` for the whole night, also on a stepped stream.
- `:1254` rounds `fs` to 0.01 Hz, which is 80 ppm at 125 Hz.
- The published `ppm` lags the end-point rate by 5 anchors: `ppm/spanPpm = 1 − 5/(n−1)` (#4099).
- `correctionAt()` is linear between anchors and needs no rate, so it carries neither the lag nor a
  single-rate assumption.
- This folds into Heron's confirmed next unit (board #2178–#2180, the PpgDex span flag). Its first step
  stands: measure the sub-2400 s fragments alone against the ECG, with today's correction and without it.

- [ ] Fragment measurement against the ECG, before any code
- [ ] A change to `fs` at `:1253`–`:1254` lands only if it beats today's `fs/(1+ppm)` on that measurement
- [ ] Sub-2400 s rate annotated, never refused (decided #2180)

### U3 · A clock-seam tripwire for OxyDex, PulseDex and HRVDex — **Osprey**

Search: `OxyDex clock seam tripwire step detection` → no prior unit (top hits `CPAPDEX-KICKOFF`,
`DEX-EVENT-UNIFY-FOLLOWUPS-2026-06-23`, neither builds one).

- Clock Contract §7: a node without step detection owes a tripwire. These three have none.
- Detect by run length against the file's own interval distribution (§∅), never by a fixed value.
- A backward stamp or an interval far outside the file's own spread is a DISCONTINUITY: the window it
  splits returns `null` with reason `clock-seam`. A dropout keeps its value with coverage beside it
  (owner ruling 2026-09-17).
- One shared helper, three call sites.

- [ ] Helper plus suite legs with a planted backward step, a planted forward jump, and a clean file
- [ ] Clean-file metric parity on every committed fixture of the three nodes
- [ ] Fixtures regenerated by their regen tools where an output moved

### U4 · MotionDex rate correction through `hostAxis` — **Magpie, after U5**

Search: `MotionDex host axis rate correction` → `MOTIONDEX-BUILD-2026-07-17`,
`WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02`, `TCH-REFERENCE-AXIS-MATCH-2026-10-20`. None wires it.

- MotionDex detects steps (`_clockResyncs`) and never corrects the rate, so its axis is the device crystal.
- H10 and Verity ACC rows carry the same two clocks as their ECG and PPG rows.
- Build the axis from anchors after the last resync and count the dropped ones, as ECGDex does (§7).

- [ ] `hostAxis` on the post-resync segment; refusal keeps the device axis and says so
- [ ] `motiondex` fixture regenerated with `tools/regen-motiondex-goldens.mjs`

### U5 · One shared timing block on every export — **Magpie** (spine; lands FIRST)

Search: `shared timing block export timingSource independent` → `O2RING-PHASE4-PREMISE-REVIEW-2026-08-06`,
`RADIO-CLOCK-SIDECAR-2026-09-07` §timingSource, `CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01`.

- Each node reshapes the host-axis block twice by hand, field by field (Heron, unit 129).
- One function fills `timingSource`, `independent`, anchor count, `spanMs`, `ppm`, `spanPpm`,
  resyncs and seams.
- A node with no second clock writes `timingSource:'device-only'` and `independent:false`, not silence.
- **Built in `dex-export.js`, not `clock.js`.** `clock.js` sits in 6 of 8 bundles even after O1, so a
  spine-hosted builder would still owe GlucoDex and CPAPDex a hand-written twin — and those are exactly
  the two nodes with no host column, whose block is all absence. `dex-export.js` is inlined in 9 of 9
  bundles and already hosts `coverageFromSegments`, so no node-local emitter exists anywhere. The block
  CONSUMES a `hostAxis` result and never produces one, which is why it does not need the spine.

- [x] Shape documented in `docs/EXPORT-SHAPES.md`
- [x] Every node-export carries the block; a parity group asserts one shape across nodes

### U6 · Radio-anchor spread measured on the box — **Wren**

Search: `RADIO-CLOCK-SIDECAR-2026-09-07` (the owner flashed the firmware on 2026-09; nobody has built the node side).

- Measure the device↔anchor residual spread on box nights. Compare it with the bands that brief already states
  (< 2 ms ⇒ `'radio'`; 2–50 ms ⇒ jitter aid; > 50 ms ⇒ ignore).
- Read-only on vigil. Nothing deploys and no daemon restarts without the owner.
- **NOT_RUN (Wren, board #2191).** The box holds 0 `RADIOCLOCK` sidecars. Nobody enabled `tepna-radioclock.service`, and `config.yaml` has no `radio_clock` block. The unit waits for the owner to arm the collector for one night.

- [ ] Spread per night, population and window stated, one `tepna.verdict/1` object

### U7 · AS11 per-EDF re-anchor at ingest — **queued, Heron after U2**

Search: `AS11 per-EDF re-anchor ingest` → `AS11-CLOCK-DISCIPLINE-2026-08-24` (DONE; per-EDF placement +
ingest re-anchor carried as #1956's follow-up).

- Measured rate −4.7 ppm over 160 h, about 2.7 s a week. Harmless for sleep metrics; it matters only
  for fusion. Lowest priority.

## 3 · Assignment and order

| unit | bird | touches | order |
|---|---|---|---|
| U5 | Magpie | `dex-export.js` (spine, 9 bundles) | 1st, alone — DONE |
| U3 | Osprey | `oxydex-dsp.js`, `pulsedex-dsp.js`, `hrvdex-dsp.js` | any time; rebase after U5 |
| U2 | Heron | `ppgdex-dsp.js` | measurement now; code after U1 |
| U1 | Kestrel | nothing: measured, no code (2026-10-30) | done |
| U6 | Wren | box read-only | any time |
| U4 | Magpie | `motiondex-dsp.js` | after U5 merges |
| U7 | Heron | `capture-host/` | after U2 |

U1 landed no code, so U2 had no rebase to wait for.
One PR per bird, draft-first, WIP cap 4 (§👥.5).

**Usage guard.** The owner's order lifts pace ruling #2138 for these units. On 2026-10-29 the weekly
meter read 77 %, with the reset Sat 2026-10-31 16:00 EDT. A bird that sees the weekly meter at 90 %
writes its handoff and stops at the next unit boundary.

## 4 · Owner decisions

- [x] **O1** — inline `clock.js` into PpgDex (5 → 6 clock bundles; the node-local parser variants stay). The owner approved it on 2026-10-29, and the PpgDex clock PR does it.
- [ ] **O2** — arm the radio collector on vigil for one night, so U6 can run.
- Not reopened: resync file-set rotation (declined 2026-09-07), edge-stamp §4 (your two open questions).
