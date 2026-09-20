<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: VIGIL-SELF-SUSTAINED-FOLDING-2026-09-01-BRIEF.md
---
Brief drain, round 4, box lane — four briefs re-triaged on the box (2026-09-20, Wren), each next-step
TRACED into the code that would run it rather than re-read from its header.

- `OXYII-DAT-AUTO-HARVEST-REFINEMENT`: the T-series ledger is written in production — 56 sessions
  in `stored/inventory.jsonl` through 2026-09-19 22:45, T3 emitting — and **T3/T4 no longer share a
  stamp** (0/55 identical, 0.1–11.8 ms apart), so the §11 `[~]` closes to `[x]`. §24 bench and §10
  durability unchanged.
- `O2RING-AUTONOMOUS-HARVEST` + `O2RING-PRESENCE-TRIGGER-IMPL`: the coexistence matrix is still not
  run (keys absent, observer off at every start). Traced: the matrix would exercise the observer's
  passive scan, which shares `_O2_PASSIVE_SCAN` with `_connect_scan` and is REFUSED by vigil's BlueZ
  without `or_patterns` — so as coded it would characterise ACTIVE scanning, the mode the power brief
  was designed to avoid. Land `or_patterns` first, or record that the matrix measured active. Same
  radio in both briefs. Precision on the earlier residue's count: 174 downgrade lines = 174 daemon
  PROCESSES (deploy-driven restarts, ~11.6/day, all clean), one per process, not 174 scan windows.
- `VIGIL-SELF-SUSTAINED-FOLDING`: the Done-when cannot be attempted on vigil — **`node` is not
  installed on the box** (never named in the header), no fold unit exists, and the capture service
  runs `MemoryMax=infinity` / `OOMScoreAdjust=0`, so acceptance 2's protections are not in place
  (owner-side). The protected tenant has moved: `tepna-capture` VmHWM **1.30 GB** / VmRSS 447 MB
  steady, against the 89 MB the header cites from 09-06 — a startup transient and a 5× steady
  state, unattributed → residue `2026-09-20-capture-daemon-startup-peak-1-3gb`.
