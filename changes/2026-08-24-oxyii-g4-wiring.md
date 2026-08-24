<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: OXYII-ACQUISITION-CHARTER-2026-08-23-BRIEF.md
---
Wire the OxyII lifecycle journal into `run_oxyii` (charter G4 wiring). The daemon now emits acquisition-lifecycle transitions at its real state-change points via a crash-safe `_oxy_emit` (an illegal edge is skipped, never raised — a modelling gap can't take down live capture; the guard doubles as idempotence for the LIVE-every-poll emit), writes them to a per-run `OXYLIFE.csv` sidecar (`writers.OxyLifeLogWriter`), and surfaces the current state in the STATUS dict. Emits are all outer-scope (no nested-callback surgery) with DISCONNECTED in the session finally to keep transitions legal across reconnects. `session_id` = the shared `cpap_record.new_session_id`; `FailureClass` = the shared `cpap_acq` one. Boundary: the daemon lifecycle as seen from capture.py; per-transfer depth stays G1's ledger. The webmon-forward + monitor draw and the IDLE_UNWORN/PULLING emit hooks are a tracked follow-up.
