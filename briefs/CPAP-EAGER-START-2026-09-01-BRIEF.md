<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-09-02 (code BUILT 2026-09-01; bar (1) MEASURED 2026-09-02 on the 2026-09-01 night at `alignmentOffsetSec` 9.12/9.16 s against ≤ ~30 s, with the pre-stated instrument and with provenance that the night ran under the code. Bar (2) recorded NOT-YET-EXERCISED per its own clause — no real false start has occurred, and the first one is still owed an observation) · **Created:** 2026-09-01

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
- [x] One real night measured against bar (1): **2026-09-01 — `alignmentOffsetSec` 9.12 s (Flow.40ms)
      / 9.16 s (Press.40ms)**, against the bar of ≤ ~30 s and the ~147 s this unit set out to fix.
      Measured 2026-09-02 with the pre-stated instrument — `CPAPCross.cpapCompare` over
      `buildCompareSets`, on `CpapEdf.readEDF` of the real pair (BLE live
      `cpap-ble/DATALOG/20260901/20260901_224844_BRP.edf` vs SD `cpap/DATALOG/20260901/20260901_224835_BRP.edf`),
      real modules co-loaded through `DexBuild.classicify`.
      ⚠️ **Read the 9.12 s as a START-TIME difference, not as misalignment.** `clockOffsetSec` is 9 s on
      both channels — the two files' headers differ by exactly that (SD 22:48:35, BLE 22:48:44) — so the
      residual after alignment is only **0.12–0.16 s**. The signals agree to a sixth of a second; what
      remains is when live capture *began*, which is the quantity bar (1) is about.
      Provenance, checked before treating it as evidence FOR the eager path rather than merely after it:
      `CPAP auto-start: ARMED — EAGER` at 22:10:46 on the last daemon restart before the session, therapy
      start 22:48:44. **n = 1 night**, which is what the bar asked for; it is not a distribution.
- [x] Bar (2) **NOT-YET-EXERCISED, recorded as such at bar-1 time** (the clause this box allows): no false
      start occurred on 2026-09-01 — zero discard lines in the session window — so the discard path has
      not run on real hardware. It stays pinned behaviourally by `test_cpap_autostart_wire` (five
      consecutive false starts, budget and no-orphan). The first real false start is still owed an
      observation; nothing here should be read as having seen one.
- [x] Bar (3) — therapy-end auto-stop and #2027's night-scoped accounting behaved normally on the same
      night: `CPAP harvest armed by therapy end (therapy ended and held for 3882s)` at 06:23.
