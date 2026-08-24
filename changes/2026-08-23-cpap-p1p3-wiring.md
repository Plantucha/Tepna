<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: CPAP-ACQ-P1-RAW-RECORD-2026-08-23-BRIEF.md
---
Wire the CPAP P1 durable raw record + P3 gap accounting into the live BLE stream (the CPAP hardening program's last unit). `cpap_record.RawRecordSink` (append-only JSONL, one file per host-authored acquisition-run session_id, device time + samples verbatim, observed interval, fsync per batch — INV1/INV3/INV4/INV5/INV9) attaches on #1701's ingestion seam via `stream_to_bus(extra_sinks=)`, written BEFORE the bus push (INV9 reorder). `as11_pull.stream` counts OK/FOREIGN/MALFORMED frames at the boundary via P3's taxonomy (INV7, counting only — filtering unchanged); a sink write failure is non-fatal but loud (`GapCounters.sink_errors`, stream survives). Enabled by `cpap.ble_stream.raw_record_dir`. Touch: capture.py, cpap_stream.py, as11_pull.py, cpap_ingest.py, cpap_record.py. All 100% branch.
