<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS (code BUILT 2026-09-01 — eager start + retention shipped with the acceptance below pre-stated; remaining: the real-night measurement against bar (1)) · **Created:** 2026-09-01

# CPAP eager start — the 120 s rule moves from the gate to retention

**One-line: start the live stream at the FIRST Therapy sighting; answer the 120 s
continuous-therapy question AFTERWARD, by discarding sessions that fail to sustain it — because the
gate's cost was borne by every genuine night and the inversion's cost only by false starts.**

## 1 · The measured head gap this removes (night of 2026-08-31)

| term | cost |
|---|---|
| the 120 s continuous-therapy START gate | ~120 s, every night, by construction |
| detector poll latency (30 s cadence, stacked with the loop's own 30 s) | ~27 s observed |
| BLE connect | ~1.3 s |
| **total: SD therapy start → first live sample** | **147.44 s** (therapy ~22:58:13 SD-stamped, decision 23:00:40, streaming 23:00:41.3) |

The comparator verified the SD record covers the head, so this buys **live-path completeness and
redundancy**, not archive recovery — the archive was never missing these seconds.

## 2 · The inversion, and why its failure direction is the benign one

An eager start that turns out false costs **bounded BLE churn**: the stream opens, flow reads flat,
the therapy-end auto-stop ends it at ~its hold, the fragment is discarded, and the SAME per-session
attempt budget (5) that bounds failed connects bounds these too. The old gate's failure direction
was **data loss on every genuine night**. This asymmetry is the opposite of the failover-arming
case (where firing wrongly costs a night), which is why this lands ACTIVE while that lands unarmed.

## 3 · The retention window is `retain_s + hold_s`, not `retain_s` — derivation

While a stream runs the detector defers entirely (every reading is None), so "did therapy sustain?"
cannot be asked of FGState — the stream's own lifetime answers it. A false start's flow is flat from
the outset, so the auto-stop's hold (`auto_stop.hold_sec`, default 120 s) times out and the stream
dies at ~hold_s old — **older than `retain_s` alone**, which would therefore miss almost every false
start. A session that genuinely sustained `retain_s` of therapy cannot be ended by a flat-flow stop
before `retain_s + hold_s`. So: **discard iff stream lifetime < retain_s + hold_s** (240 s at the
defaults), manual stops exempt (intent is never a false start), unparseable timestamps retain (a
discard cannot be undone). `cpap_live.false_start_verdict` is the pure decider; both boundaries are
test-pinned.

Two supporting changes the inversion forced:
- **`note_started` keeps the attempt count** (it used to zero it): the budget is per-session and a
  false start spends from it after a successful start, so zeroing would unbound the churn via
  start→discard→start. Test-pinned through five consecutive false starts.
- **The autostart loop polls every 5 s** (was 30): it reads an in-memory dict, so the fast poll is
  free and stops the loop's cadence stacking on the detector's ~27 s latency.

## 4 · PRE-STATED ACCEPTANCE (owner-relayed, written before any night ran under this code)

1. On a real night, **first live sample ≤ 30 s after the SD record's therapy start** — the
   comparator's `alignmentOffsetSec` is the measuring instrument; it should drop from ~147 to ≤~30.
2. **False-start fragments bounded by the existing attempt budget**, the discard path leaving **no
   orphan files**, and a **journal line naming each discard** (per file, with the verdict).
3. The **therapy-end auto-stop and #2027's night-scoped accounting untouched** — this unit adds a
   post-stop classification and moves a gate; it changes nothing about how sessions end.

## 5 · Residues, named not taken

- **Detector cadence near bedtime** (the ~27 s term): needs a bedtime model to be more than a global
  duty-cycle increase on the CPAP radio; not taken here. The 5 s loop poll already removes the
  stacked half of the latency.
- **Live EDF `SRN=UNKNOWN`** though `Identification.json` holds the serial — the device-identity
  rider, separate unit.
- **Crc16 compared as physiological** in the comparator — separate unit.
- **Continuous-recording v2** ("record in Standby, select therapy afterward") is gated on the
  owner-ordered Standby-BRP probe (queued separately): does BRP deliver anything in Standby, and
  does a held link behave?

## Done when

- [x] Eager fire + retention verdict + budget-through-success pinned pure (`cpap_live`), the
      discard/journal/no-orphan path pinned behavioral (`test_cpap_autostart_wire`).
- [ ] One real night measured against bar (1): `alignmentOffsetSec ≤ ~30 s`, recorded here with the
      night named.
- [ ] Bar (2) observed on the first real false start (or noted as not-yet-exercised at bar-1 time).
