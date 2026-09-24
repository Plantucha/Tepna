---
bump: patch
type: fixed
brief: none
---
The §∅ 2026-09-17 ruling — **a discontinuity refuses, reduced coverage annotates** — applied across the nodes, after planting a seam in each and measuring what its window metrics actually return.

**Population of eight, one failure.** PulseDex failed: a 7-year clock jump left `rmssd`/`sdnn`/`pnn50` **byte-identical** to the continuous record, with `coverage` 0 sitting beside them. That is §∅'s *"a number computable from broken input, reporting no problem"*. ECGDex, PpgDex and MotionDex pass via their parsers (a device-counter step yields one resync each). OxyDex and GlucoDex pass with named annotations. HRVDex and CPAPDex are structurally exempt.

**Why the metrics were blind**: `rmssd`/`sdnn`/`pnn50` read the RR **values** and never touch `tsMs`, so a clock step cannot reach them. They were correct about the RR series and wrong about the recording — the window no longer describes one continuous stretch of signal.

PulseDex now refuses those three with `hrvReason: 'clock-seam'`, publishing `clockSeams {n, maxDisagreeMs, boundMs}`. The per-beat `meanRR`/`hr` are kept deliberately: `classifyRecording` and `adaptEnvelopeNode` consume the duration immediately, and collapsing it is the DEEP-AUDIT-III §6.2 regression HRVDex already paid for once. It is the same split PpgDex makes, nulling the CVHR index and leaving the rest of the record alone.

**The bound is shared, not re-invented.** The discriminator is ECGDex's, in its own words: *"through a real BLE dropout both clocks keep ticking, so the device delta ≈ the phone delta; only a clock step makes them disagree."* PulseDex has both clocks and never compared them — the RR interval **is** the device delta, the `tsMs` delta is the host's. `PD_RESYNC_BOUND_MS = 60000` is `ECG_RESYNC_BOUND_MS` = `PPG_RESYNC_BOUND_MS`, and the twin asserts all three equal from source, because a second constant would eventually disagree with the first.

**OxyDex**: `sparse` and `discontinuous` are different claims. `DexExport.coverageFromSegments` labels every multi-segment record `sparse`, and `clockNonMonotonic` is the OxyDex stat that separates them — so the relabel is applied at OxyDex's own call site. Doing it in `dex-export.js` would serialise a fleet-wide re-verification for a label nothing currently reads. ⚠️ OxyDex's existing `rawDurMs` guard was **left alone deliberately**: its bound is `1.5 × n × cadence + 1 h`, derived from the row count and the file's own measured cadence, and replacing it with the shared 24 h ceiling would have loosened a data-derived bound roughly tenfold.

**CPAPDex pin** — a property, not a detector. An EDF timeline is constructed from the header (`startdate`/`starttime` + `recordIndex × recDurSec`), which is §7's *"a device whose axis was DRAWN is not a clock"*: one clock, so no seam is expressible and none was planted. The assertion carries its own invalidation — if `cpapdex-edf.js` ever grows a resync bound, it says the pin is stale and the seam plant must be re-run for that node.

⚠️ **The twin plants the seam in `tsMs`, and that matters.** A seam planted as a giant RR *value* is replaced by `artifactClean` with the local median and tests nothing — the next reader will reach for that form. Measured: the raw primitive returns `rmssd` 28,498,960,541 ms against a 5.62 baseline, while the production path returns 5.62 either way.

Reverting both DSPs reds 5 behavioural assertions, the defect verbatim as `{"clean":5.62,"seamed":5.62}`. No measured value moved in any fixture.
