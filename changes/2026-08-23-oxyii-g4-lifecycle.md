<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: OXYII-ACQUISITION-CHARTER-2026-08-23-BRIEF.md
---
OxyII acquisition-lifecycle journal (charter G4) — `capture-host/oxy_lifecycle.py`, the CPAP P2 twin for the O2Ring arm. A pure, run_oxyii-agnostic `OxyState` machine (12 states DERIVED from what run_oxyii/handoff/autopull actually do — not a spec-imposed 16-state machine; §25 liveness expressed as CONNECTED/DISCONNECTED/NOT_SEEN/INTERRUPTED states), an explicit legal-transition frozenset (illegal moves raise, no partial record), the shared `cpap_acq.FailureClass` taxonomy (not forked — `oxy_transfer.py` already imports it), and an immutable `Transition` with an `OXYLIFE.csv` sidecar row (`writers.LinkLogWriter` idiom) + a `status_state()` for STATUS. Boundary: the daemon lifecycle as seen from capture.py; per-transfer depth stays G1's inventory ledger. Adds the §16 PI/motion cannot-swap regression guard. 100% branch. The run_oxyii emit calls + OXYLIFE.csv writer land as the separate announced wiring touch (P2→wiring pattern).
