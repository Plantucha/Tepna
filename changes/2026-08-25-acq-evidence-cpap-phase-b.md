<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: ACQ-EVIDENCE-CONTRACT-2026-08-24-BRIEF.md
---

Acquisition Evidence Contract **Phase B — the CPAP adapter** (`acq_evidence_cpap`), completing the
envelope over both devices. A pure ASSEMBLER over stores that already exist: the `cpap_record` durable
JSONL (INV9's authoritative copy, and therefore the artifact), `cpap_ingest.GapCounters`, the derived
`EdfSink` file (provenance, never the artifact), the supervisor's FGState/LastTherapyUseDateTime
observations, and the `cpap_spool` committed ledger. It decodes nothing, hashes nothing, and modifies
none of them.

Two sources kept distinct per §10 — `assemble_live` (BLE stream) and `assemble_spool`
(`SOURCE_STORED_SPOOL`, new). CPAP's `duration_check` analog is the device's own
LastTherapyUseDateTime verdict as `stored_s` against the streamed duration, reusing the O2Ring
vocabulary and sign convention.

Wired on the production path: `cpap_stream.stream_to_bus` emits the envelope after the sinks close, in
the `finally`, so an interrupted night gets one too — and it records `stopped_cleanly` as OBSERVED
rather than assumed. `capture.py` writes it as a `<raw-record>.meta.json` sidecar, the same shape and
placement the O2Ring `.dat` path uses.

Contract invariants are planted controls, each verified to FAIL when the invariant is relaxed: absent
accounting is UNKNOWN and not 0 (with the mirror control that a real 0 stays 0), a never-opened record
is UNKNOWN and not INVALID, and validation/completeness are asserted in all four combinations.
