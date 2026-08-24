<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-24 · **Created:** 2026-08-23

# CPAP acquisition P1 — the durable raw record (the bus is not the only copy)

> P1 of the CPAP hardening audit (audit §2, gaps **G2/G6/G8**). **Design now, unblocked and blocking
> nothing.** The MODULE is standalone and testable immediately (like P2 `cpap_acq.py` and P3
> `cpap_ingest.py`); the WIRING lands as ONE announced `capture.py`/`cpap_stream.py` touch **after the
> feature arm's controller-race fix**, together with P3. Reviewing this brief before that fix means the
> wiring ships the moment the Vigil box controller PR merges, instead of starting its design then.

## 1 · The load-bearing invariant — INV9

**The live telemetry bus is NOT the sole authoritative copy of a CPAP acquisition.** Today the BLE live
path preserves only the bus (audit G2): a viewer disconnects, a process restarts, the bus buffer rolls —
and the samples are gone, with no durable trace they ever arrived. P1 puts a **crash-safe raw record on
disk beside the bus**, written *before* the bus publish, so the authoritative copy survives everything
the bus does not. Every other CPAP invariant that talks about "the stored sample" (INV1/INV3/INV4/INV5)
presupposes this record exists.

## 2 · The canonical CPAP observation (§11 — one representation, many projections)

The owner findings spec §11 is explicit: **live and spool must CONVERGE on ONE canonical CPAP
observation.** P1 defines that representation once; the **P4 committed store** and the **live side of
the CPAPDex comparator** are *projections* of it, never independent second models.

A **canonical observation** is one decoded batch of raw device samples with its full provenance —
never a derived summary, never a bus event. It is the atom the record appends and everything downstream
reads.

## 3 · The per-batch field list (findings spec §1 — complete, each field earns its place)

Each durable batch record carries EXACTLY these fields; none is optional, none is derived at write time:

| field | meaning | invariant it serves |
|---|---|---|
| `device_id` | the AS11 serial / stable device identity | INV1 (sample ↔ one device) |
| `session_id` | the P2 `AcqLifecycle` session this batch belongs to | **INV1** (exactly one session) |
| `stream_id` | the device stream this batch came from (P3 `classify_frame`'s `expected_stream_id`) | INV1, gap accounting |
| `device_start` | device-clock start of the batch (Clock-Contract floating `tMs`, `parseEdfClock` family) | **INV4** (device time, never host) |
| `device_interval` | the **observed** inter-sample interval, measured from the batch, NOT the requested rate | **INV5** (observed > requested) |
| `sequence` | monotonic batch sequence number from the device stream | ordering, gap detection |
| `channels` | channel names + units as the device reports them (e.g. Flow.40ms L/s, pressure cmH₂O) | INV3 (raw, un-rescaled) |
| `samples` | the raw decoded sample values, verbatim — no interpolation, no unit conversion | **INV3** (raw ≠ derived) |
| `host_mono` | host monotonic clock at receipt (drift-free duration reference) | timing provenance |
| `host_wall` | host wall clock at receipt (the capture-box stratum-1 stamp) | timing provenance, offset capture (G8) |
| `provenance` | code/version + `AcqState` + `FailureClass` context (the P2 `Transition` fields) | **G7** (thick provenance) |

Two host clocks are recorded, never one: `host_mono` for durations that must not jump, `host_wall` for
the absolute stamp — and **both are kept alongside `device_start`, never substituted for it** (INV4).
`device_interval` is measured from the batch and preferred over any requested/nominal rate (INV5): a
device that streams at 24.7 Hz when it was asked for 25 Hz is recorded as 24.7.

## 4 · Pipeline order — DURABLE before BUS (the crux)

```
BLE notification → FIG frame → classify_frame (P3) → [DURABLE RECORD append (P1)] → bus publish
```

The durable append happens **before** the bus publish, not after. A crash in the window between the two
still leaves the raw batch on disk; the bus is downstream of the authoritative copy, not the source of
it. `classify_frame` runs first so a FOREIGN/MALFORMED frame is counted (P3 `GapCounters`) and never
written as if it were a real sample; `BoundedIngestQueue` (P3) provides the backpressure boundary so a
slow disk records overflow rather than dropping silently.

## 5 · The writer — the existing crash-safe sidecar idiom

P1 reuses `capture-host/writers.py`'s proven `StreamWriter` discipline, not a new mechanism:

- **Append rows as samples arrive; flush periodically; `fsync` on.** No buffering the night in RAM.
- **Torn-tail recovery:** on open, a partial final line (the write a crash interrupted) is truncated
  back to the last complete record *before* appending — so a resumed session never appends after a
  torn row. This is the existing `StreamWriter` behaviour, applied to CPAP batches.
- **One record file per `session_id`** (INV1): a batch cannot land in two sessions, and a session's
  raw record is a single append-only file.
- **Never rewrites history:** append-only, so a re-pull or reconnect adds, never mutates (the property
  P4's committed store builds its idempotency on).

## 6 · Tap-point attachment plan

- **Now:** P1 is a standalone module — the record dataclass + the writer + the "append then publish"
  helper — tested against synthetic batches (100% branch, the P2/P3 bar). It touches neither
  `capture.py` nor `cpap_stream.py`.
- **When the controller-race fix lands:** the wiring attaches P1's append + P3's `classify_frame`/
  counters at the **single ingestion point** the fix creates in `cpap_stream.py`, as **ONE announced
  touch** (P1+P3 together, per the audit §7/§8 sequencing). The coexistence `gate()` is unchanged; the
  record is written on the pull path the gate already guards.
- The wiring PR is small by construction because both modules already exist and are gate-green — this
  brief existing early is what lets it ship immediately rather than be designed then.

## 7 · What projects from this record

- **P4 committed store** = the durable record promoted through the transactional spool chain; it reads
  the same canonical observation, never a re-derived one.
- **CPAPDex comparator (live side)** reads this record + P3's `GapCounters` for its streamed-vs-logged
  divergence series.
- **Node export** (`ganglior.node-export`, Clock Contract §6) is a projection too: `startEpochMs` = the
  floating device `t0`, events reconstructed from `device_start` + sample offsets — never from host time.

## Invariants closed

- **INV1** — every stored sample belongs to exactly one session (`session_id` + one file per session).
- **INV3** — raw samples never silently replaced by derived values (`samples` verbatim, `channels` in
  device units).
- **INV4** — device timestamps never silently replaced by host timestamps (`device_start` primary;
  `host_mono`/`host_wall` recorded *beside* it).
- **INV5** — observed sample interval preferred over requested (`device_interval` measured, not nominal).
- **INV9** — the live bus is not the sole authoritative copy (durable record, written before the bus).
- Partial toward **G6** (restart state — the record is what a restart replays) and **G8** (clock-offset
  capture — `host_wall` − `device_start` is recordable per batch).

## Done when

> **Executed in #1708** (the P1+P3 wiring capstone) — `capture-host/cpap_record.py`
> `RawRecordSink` is the durable JSONL raw record; the §3 field list ships as its per-batch
> `on_batch` record (no field derived at write time — `test_device_start_and_samples_are_verbatim`);
> DURABLE-before-bus is the enforced sink order (`test_the_durable_sink_writes_before_the_bus_push`);
> FOREIGN/MALFORMED counting + overflow via P3's `GapCounters`. 100% branch, gated.

- [x] A `RawBatch` record type carrying the §3 field list exactly; a decoy asserts no field is derived
      at write time.
- [x] Each batch is one **JSONL line** (samples as an array) in a per-`session_id` file beside the
      night's other capture files — the ratified format/location above.
- [x] An append-only, torn-tail-safe, `fsync`-on writer (StreamWriter idiom) — one file per `session_id`.
- [x] "Append DURABLE before bus publish" is the enforced order; a test proves a crash after append /
      before publish still has the batch on disk.
- [x] `device_interval` is the observed interval; `device_start` is device-clock floating `tMs`;
      `host_mono` + `host_wall` both recorded; none substituted for the device clock.
- [x] FOREIGN/MALFORMED frames (P3 `classify_frame`) are never written as samples; overflow is recorded.
- [x] Standalone module, 100% branch (the P2/P3 bar); touches neither `capture.py` nor `cpap_stream.py`.
- [ ] Wiring plan (§6) reviewed so the P1+P3 touch ships when the controller-race fix merges.

## Rulings (owner/lead-ratified, 2026-08-23)

1. **On-disk format — JSONL, one line per batch.** Matches the sidecar/append idiom (the PMD-arrival
   family), auditable with a pager, and CPAP's rates make the size argument moot (~tens of MB/night;
   rotation/compression is a later optimization if ever needed). Binary buys nothing worth losing
   greppability for.
2. **File location — beside the night's capture files, keyed by `session_id`.** INV1 gets
   one-file-per-session for free, the night walker discovers it, and provenance is colocated with what
   it describes.
3. **The wiring PR carries P1+P3 TOGETHER** as the one announced touch (standing ruling, reconfirmed) —
   not P1 then P3.
