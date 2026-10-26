<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED — 2026-10-25 (core BUILT, remainder PR- and owner-blocked — verified 2026-10-26, Kestrel: §3 waits on #3959, OPEN, which carries row `2026-10-26-the-absorbed-civil-shift-reaches-no-night-artifact`. §4 holds two owner questions, still undecided.) · Previously: PROPOSED — 2026-10-25 (core BUILT, verified 2026-10-25. §1 measures every rail's edge. The CPAP live rail now declares its clocks. §3 names a new defect for a residue row. §4 stays the owner's.) · **Created:** 2026-10-25

# Brief — where a transport-edge seam stamp lives, and what a seam event is on the wire

> Discharges residue `2026-09-17-ble-timebase-edge-stamp-undecided` for the two questions that
> `BLE-TIMEBASE-AT-THE-EDGE-2026-09-16-BRIEF.md` §4 does not leave to the owner. That brief reads
> **DONE — 2026-09-17** with §4 open, and §5 serialises §4 behind the Clock Contract. Both questions
> have answers already in the tree. Nobody had written them down.

## 1 · Q1 — the stamp lives at the rail's OWN edge, and the tree has three edges

The row states the premise that `CPAP/AS11` and file-import have no host stamping point, and warns
that a partial edge is a second seam. **The tree refutes the first half and confirms the second.**

| rail | the host-side stamp site | the device clock in the artifact | `clock_status` |
|---|---|---|---|
| Polar live (BLE PMD + SIG) | `capture._now()` → `writers._phone_ts` | a `sensor timestamp [ns]` column, per stream | `device+host` or `host`, from the writer's own header table (`acq_evidence_polar.py:58`) |
| O2Ring live (1 Hz CSV + pleth) | `capture._now()` | four opcodes carry an ns column that `writers` fills with a literal `0` | the refusal at `acq_evidence_polar.py:66` — for those streams the column is the opposite of evidence |
| O2Ring stored `.dat` pull | none: no host sat on the link | the trailer's `start_t_ms`, a u32 the ring writes from its own clock | `device` (#3906) |
| Polar stored PS-FTP pull | none: the acquisition carries no host clock at all | the device's own directory listing | its own assembler, `assemble_pull` |
| **CPAP AS11 live** | **`cpap_record._iso_utc(time.time())` plus `time.monotonic()`, per batch** (`cpap_record.py:48`, `cpap_record.py:124`) | `device_start`, verbatim per batch (INV3/INV4) | **`UNKNOWN` until this PR** |

**The CPAP rail has a host edge and it is a SECOND one.** `capture._now()` reads a monotonic-anchored
civil clock that absorbs a DST relabelling and a backward step so an open recording cannot rewind
(`capture.py:322`). `cpap_record` reads `time.time()` raw. So the two live rails take OPPOSITE
remedies at their edges: the BLE rail absorbs the step and keeps the file monotonic, the CPAP rail
records both clocks verbatim and leaves the step in the bytes.

**Both are defensible and the remedy is not to merge them.** An append-only record that carries
`host_mono` beside `host_wall` hands the reader everything Clock Contract §7 needs to build an axis,
and forcing that rail onto `_now()` would delete the second clock. §✅ already rules the same shape of
question for `DexClock` and three bundles that keep node-local variants.

**So the answer to Q1 is a DECLARATION, not a single site.** Each rail states which clocks reached
its artifact, in that artifact's own envelope, derived from the artifact's own content. Five of the
six rows above do that today. The sixth was the CPAP live rail, and this PR closes it: the pump passes
`acq_evidence_cpap.clock_status_for(raw)`, which reads the batch count and the first device stamp off
the raw record's own facts. Four words, each honest in its branch — `device+host`, `host`, `none` for
a header-only record that no clock ever reached, and `UNKNOWN` for a facts dict that does not state
its batch count.

**The defect that fixes is the same one as #3906, on the rail with the most evidence of a second
clock.** `cpap_stream.py` named every other derived field and left this one at `assemble_live`'s
`UNKNOWN` default, in the same call that hands the envelope a MEASURED offset between the two clocks
it would not name.

## 2 · Q2 — a seam event is a SIDECAR ROW, and the tree already rules out the alternatives

`writers.py:2567` states the rule, for the device clock: a live status field is not an evidence
channel, and any question a reader will ask about a night post-hoc must travel WITH the night. The
corollary decides the format question. A stream row changes every reader's parse, and a per-packet
field pays a column on every sample for an event that happens twice a year. A sidecar pays nothing
until the seam happens.

What a reader can rebuild from the bytes decides whether a seam needs a channel at all:

| the seam | can a reader rebuild it from the bytes? | the shipped remedy |
|---|---|---|
| the DST fall-back ambiguity in the host column | yes, by continuity against the device counter | a reader-side resolver plus a count of what nothing decided (`localstamp.py`; owner ruling 2026-09-21 chose remedy (a) and no format change) |
| a device clock jump or a mid-session resync | no: only the daemon saw it | a sidecar EVENT row — `CLOCKSYNC.csv`, with its own one-word vocabulary (`writers.py:2557`) |
| a host clock step, or the civil shift the host absorbs | no: the fact lives only in `capture._civil_shift` | **nothing persists it — see §3** |
| a rail whose host edge does not exist | no | declare the absence: `clock_status=device` (#3906) |

**The rule, in one line.** A seam a reader can rebuild from the bytes gets a reader-side resolver and
a count of what it could not decide. A seam that exists only in the producer's memory gets a sidecar
row. A rail whose edge does not exist declares that in its envelope. Every clause names a shipped
precedent, so none of this is new mechanism.

## 3 · The defect §2 found, for a new residue row

`capture.py:8790` sets `capture_absorbed_sec` on the dict it hands the host-clock sidecar writer.
`HostClockLogWriter.write` then writes thirteen named columns and that key is not one of them
(`writers.py:2342`). So the absorbed civil shift — how wrong a night's absolute stamps knowingly are —
reaches live STATUS and journald, and nothing else. Those are exactly the two channels `writers.py:2567`
rules out.

Two halves, and the first is small:

- **the LEVEL.** A fourteenth column, appended last, which is the discipline that file's own header
  comment states (`writers.py:2328`). A polled column gives the shift at the 120 s provenance cadence.
- **the INSTANT.** A poll cannot date the seam closer than its own period, and an absorption that
  opens and expires inside one period leaves no row at all — `capture.py:342` expires the shift as
  soon as the last sample writer closes. The seam's own stamp needs an event row, and `_now()` runs
  per sample at 130 Hz and holds no night root. So `_now()` records the seam in memory and
  `host_clock_poller`, which already holds the root and the open writer, drains it.

This PR does not fix either half. I own the row; Kestrel sequences the ledger.

## 4 · The two questions that stay the owner's

§4 of the source brief lists four. These two are not mine to decide, and this brief does not decide
them:

- **whether consumers are FORCED to see a seam**, or may ignore the sidecar. That is a contract
  question about every downstream node, and §🔒 §6's export contract is the surface it would move.
- **migration.** Every night already on disk predates any seam channel, so a reader that requires one
  refuses the whole corpus. Whether old nights read as UNKNOWN or as seam-free is a ruling, not a
  measurement.

## 5 · Acceptance

- [x] §1 — I measured the per-rail table, with `file:line` for every cell.
- [x] §1 — the CPAP live rail declares its clocks, derived from its record's own facts, with the
      derivation and the pump wiring both pinned.
- [x] §2 — the format question has an answer and every clause of the rule names a precedent.
- [ ] §3 — the absorbed shift reaches the night's own file. Both halves wait on a residue row.
- [ ] §4 — the two owner questions stay undecided.
