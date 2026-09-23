<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** IN-PROGRESS — 2026-09-23 (owner-ratified programme; assignments issued the same evening; the first ranking below is measured from the box's own loss audits, the verdict is Magpie's unit and its bands are DRAFT until stated in §3 before the first night is scored) · **Created:** 2026-09-23 · **Relates:** `STRATEGIC-PRIORITIES-2026-08-26-BRIEF.md` (P1–P4 deferred by this programme; P5's "two error-free weeks" is this programme's exit) · `OPERATIONAL-MATURITY-ROADMAP-2026-08-27-BRIEF.md` · `ABSENCE-SURVEY-2026-09-22-BRIEF.md` (the one processing lane that continues) · `SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md` · CLAUDE.md §∅ and §🔒 §7

# SOLID NIGHT — capture quality first, scored by one nightly verdict, exit at fourteen consecutive solid nights

## 0 · The ruling, verbatim (owner, 2026-09-23 ~19:20)

> "Have good processing is good. But if I feed it with junk fragmented not time aligned data any output
> will be also junk. So I think we have to first focus on capturing solid high quality data then
> refocus on processing. After we have solid product we can play with us and ui, storage, security,
> this is not product so sale so we have not any community at time restrictions pressure."

Allocation: "2x coders work on capture 1x on processing, Kestrel coordinator and can do whatever looks
most productive." On the bird mapping in §4: "Sounds good to me."

The argument was run both ways before the ruling and is recorded so it is not re-litigated:

- **Against capture-first:** the absence survey's 290 confirmed defects were ALL path-manufactured in
  processing (an absent read folded as "nothing there", a defaulted rate spent as a timebase); capture
  quality is invisible without honest processing (the 10-minute stall went four nights unseen because
  every downstream number stayed computable and green); capture has a physical ceiling; a "first"
  phase without an exit never ends.
- **For capture-first:** captured bytes are immutable and irreplaceable, processing is replayable on
  any later day — effort on the irreplaceable side compounds; every defect found this week was
  capture-side (the stall, the H10 flat-battery drop, Verity drop-outs, the ring's in-band zeros, the
  AS11 clock); the trio corpus is the asset and its eligibility losses are all capture.
- **Fusion (what this brief is):** the asymmetry wins, so capture first — but "quality" is DEFINED as
  a per-night verdict with pre-stated bands so the phase has an exit, and the processing that
  MEASURES capture (refusal semantics, coverage, the verdict itself) is part of capture, not a detour.

## 1 · Motivation, measured

Two hundred merges 2026-09-20 → 09-23, counted by title: tools/gates/guards/verdicts/hooks **94**,
docs/residue/briefs 53, capture-host 43, absence refusals 36, node analyzers 24; touching P1 interop
**4**, P3 provenance export **4**, P4 longitudinal change detection **0**. Three quarters of the
fleet's output was the repo instrumenting itself. Some of it was earned (the guards caught real
defects the day they were built), none of it changed what reaches the owner in the morning.

## 2 · A SOLID night — the criteria (bands are §3's job, not this section's)

One `tepna.verdict/1` per night, gate `solid-night`, written beside the existing `QC-VERDICT.json`,
`BACKCHECK-VERDICT.json`, `ADAPTERHCI-VERDICT.json` and `LOSS-AUDIT.json` — it COMPOSES them, it does
not replace them — and drawn on the monitor page as one line per night. Per configured stream:

1. **Continuity.** Every gap named and attributed to one of: link drop · box stall · device blanking ·
   doff · unattributed — counted ONLY inside the worn interval, which is taken from the device's own
   beat evidence, never from the file span (§5, the Verity 09-12 case). An unattributed gap above the band is not solid; a named, attributed one is
   judged by its class. Gaps are COUNTED as well as summed — the 09-22 stall cost 2–5 s every 10.7 min,
   small minutes and a broken axis.
2. **Timebase.** Host-anchored (`hostAxis` with `independent: true` where a second clock exists),
   every resync seam recorded, ppm within the §🔒 §7 bound, no step absorbed into a slope.
3. **Completeness.** Rows against expected rows for the stream's rate and the night's span.
4. **Validity.** The `…RUNS.txt` sidecar present for every stream that has a writer. An ABSENT sidecar
   is validity UNKNOWN, never "no absences" (#2950's contract); an EMPTY one is the informative
   opposite.
5. **Clocks.** Every device clock offset against the host known (AS11: the `AS11CLOCK.csv` sidecar;
   Polar/ring: the host-axis anchors).

Two facts measured on the box the night this was written, both binding on the verdict:

- **The settle trigger.** The loss audit for night N cannot exist until night N+1's capture starts —
  the QC poller rewrites verdicts into N's folder, `active_nights` reads any file mtime as activity,
  `_current_night` keeps picking N until N+1 holds data. So night N is **UNKNOWN with reason
  `not settled`** until N+1's first data write; never "not solid", never PASS. Pre-registered
  acceptance (Wren): the audit lands ≤ 55 min after the next night's first ECG write.
- **Expected streams come from a declared list, not from what was captured.** The COOSPO 808S has
  zero files on every night and the audit reports `no primary stream known for model 'HRM808S'`;
  the owner ruled it a manual-only backup (§6): NOT expected unless entered into that night's
  capture, so it cannot make every night UNKNOWN by construction.

**Exit criterion: fourteen consecutive SOLID nights** — the owner's own P5 bar ("not until we have
some 2 weeks without errors"). When it holds, the fleet refocuses on processing with a corpus worth
processing. A night absent outright (no file for an expected stream) is its own class and breaks the
run.

## 3 · Bands — DRAFT, to be stated by the verdict's author before the first night is scored

The rule (memory `pre-state-the-threshold`): write the decision bands before the measurement. This
section is Magpie's to fill in the verdict PR; the numbers below are the coordinator's draft from §5's
ranking and are INPUT, not the spec.

| criterion | draft SOLID | draft not solid | UNKNOWN |
|---|---|---|---|
| continuity | unattributed gaps < 1 min AND < 5 count; attributed link/doff gaps any | unattributed ≥ 1 min or ≥ 5, or any box-stall gap | loss audit not settled |
| timebase | hostAxis ok, |ppm| < 50 000, seams recorded | refused, or a step absorbed | anchors < 3 |
| completeness | ≥ 99 % of expected rows | < 99 % | expected rate unknown |
| validity | sidecar present for every writer stream | — | sidecar absent |
| clocks | offset known for every device | — | any device without an offset |
| night | every expected stream present with span ≥ 4 h | any expected stream absent or < 4 h | expected list undeclared |

## 4 · Assignments (issued 2026-09-23 ~19:30)

| bird | lane | first unit |
|---|---|---|
| **Heron** | the daemon and the devices | finish the capture-host absence rows (the instrument's honesty), then the top of §5, one defect per unit, the verdict as acceptance |
| **Wren** | the measurement, on the box | attribute the unattributed H10 losses (09-04 · 09-05 · 09-12) by the cadence-table method; ground truth for the bands; refute any band a real night contradicts |
| **Magpie** | the verdict and its monitor draw | `nightqc.py` composition of the four existing verdicts + bands + the monitor line; runs in the QC poller's child process (#2936) |
| **Osprey** | the ONE processing lane, narrowed | absence refusals only (`ABSENCE-SURVEY` rows), the "follow the value downstream" rule binding; no features |
| **Finch** | capture when engaged | BLE / firmware on demand |
| **Kestrel** | coordinator | §5's ranking; then whatever the ranking leaves undefended |

**Stops during the phase, fleet-wide:** new gates without a measured false negative; node feature
work; UI, storage, security; P1–P4. Deploys and daemon restarts stay owner-authorized.

## 5 · The ranking — nights lost by capture defect (Wren, from the box's LOSS-AUDIT files, 2026-09-23)

28 nights, 2026-08-25 → 09-21 (`vigil:~/wren-notes/loss-by-night-2026-09-23.tsv`, 112 device-nights).

| device | nights present | nights > 5 min lost | lost min | daemon-attributed | fragments |
|---|---|---|---|---|---|
| Polar H10 | 25 | 11 | 781.9 | 567.1 | 590 |
| Polar Verity | 26 | 10 | 247.3 | 141.0 | 210 |
| O2Ring | 26 | 0 | 10.4 | 0 | 69 |

By cause: H10 not-worn drop **561.7** (the flat-battery inference on the new CR2032, fixed #2833 —
09-22 witness: 0 drops, coverage 0.999) · H10 unattributed **214.8** · Verity not-worn drop 141.0 ·
Verity unattributed 106.3 · ring unattributed 9.7 · H10 stall re-negotiate 5.4 · ring link timeout 0.7.

Night-absent class (not gaps — the audit cannot count them): H10 missing 09-01, 09-02, 09-14 and
short on 08-27 (50 min), 09-18 (24), 09-19 (68); Verity missing 09-14, 09-18, short 08-27 (34); ring
missing 09-14, 09-18.

**Attribution of the "unattributed" H10 class (Wren, same evening, 28 nights):** 147.3 of the 214.8
min (69 %) are gaps preceded within 15 s by a journal line `device clock is −29.2 s off host —
re-syncing`: the daemon paused live capture for an offline op every ~5.5 min, the ECG gapped 55–100 s
each time, the resync never held, and the storm repeated (resync lines per night: 09-05 73 · 09-06
74 · 09-11 55 · 09-12 55 · zero on every night since #2459 merged on 09-13). Corrected: **H10
daemon-caused 714 of 782 min (91 %)**, both mechanisms already fixed (#2833, #2459); the H10's own
remaining loss is ~67 min in 28 nights (09-12 19.7 in 67 short gaps · 09-03 8.5 · 08-25 6.8). The
resync storm and the 09-22 stall are one shape a layer apart: the box tearing its own recording. An
instrument defect made it invisible — `loss_audit.py` matches journal lines by device NAME and a
fixed KIND list; the resync line matches no KIND, and 8,369 of 8,956 `live capture paused` lines
carry only the device ADDRESS — Wren's unit, go given 2026-09-23 ~19:50.

**Work order this yields, top-down (corrected):**
1. The `loss_audit.py` instrument: the resync KIND, and match on name OR address, with plants run
   with and without the fix; re-auditing re-labels the old nights (Wren).
2. **The night-absent class — Heron's first daemon unit**: why an expected device produced no file
   on six nights (H10 missing 09-01/09-02/09-14, 50/24/68 min on 08-27/09-18/09-19; Verity and ring
   missing 09-14/09-18). The journal per device per night: never started (daemon down, adapter down,
   not advertising, never worn) · started and torn · started under another name.
3. Verity unattributed 106 min — the same attribution method (Wren).

**The Verity 09-12 "drop" was the daemon being RIGHT (Wren):** all 62 drops fall 18:24→20:36, before
bed; the PPG between them carries no pulse (autocorrelation 0.1, AC amplitude at the noise floor),
the reconnected PPI set `received no rows` 61 times, and the H10 on the same body read 81–84 bpm;
from 20:37:51 the PPG is pulsatile and matches the H10 beat for beat, and the drops stop at that
minute. The audit booked the pre-wear span as `worn_lost_min` because `worn_evidence` is NIGHT-level.
Consequence for §2: **loss is counted only inside the WORN interval, taken from the device's own beat
evidence** (first → last pulsatile window), never from the file span; outside it a gap is `doff`.
With both corrections, every daemon-caused minute over 28 nights is already fixed (#2833, #2459) or
correct behaviour, which is why the work order starts with the nights that never started.
4. The 09-19 → 09-22 stall (fixed #2936, live since 06:52 on 09-23) — tonight is its acceptance.
5. The ring is effectively solid on every night; its in-band blanking is a validity-sidecar matter
   (#2317/#2950), already recorded per night.

## 6 · Owner decisions this brief waits on

- ~~Is the **COOSPO 808S** an expected stream?~~ 🟢 **ANSWERED — owner, 2026-09-23 ~20:00, verbatim:**
  *"Coospo is just backup that can produce rr and hr only. It's not expected to be used, but it's
  widely used device and still can provide some info. I would not expect to be used unless manually
  entered to capture."* So: `expected: false` by default; expected for a night ONLY when manually
  entered into that night's capture, and then its HR/RR are scored like the H10's RR. The verdict's
  expected-stream list is therefore PER NIGHT, from the capture's own device set, never a static
  config; the audit's `no primary stream known for model 'HRM808S'` is a non-finding on a normal
  night. No Heron unit.
- The **known-clock adversarial capture night** (`KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14`) is
  still the owner's to run; it is capture work and belongs in this phase.

## Done when

- [ ] §3 bands stated in the verdict PR before the first night is scored, and the verdict emits
      UNKNOWN (`not settled`) until night N+1's first data write.
- [ ] `solid-night` verdict written for every night from 2026-08-25 on, drawn on the monitor.
- [ ] §5's work order executed top-down, each unit accepted by the verdict, not by prose.
- [ ] **Fourteen consecutive SOLID nights.** Then this brief flips to DONE and the fleet refocuses on
      processing (`ABSENCE-SURVEY` remainder first, then `STRATEGIC-PRIORITIES` P4 → P3 → P1).
