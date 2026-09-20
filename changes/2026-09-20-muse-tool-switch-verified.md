<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
`run_muse`'s `muse_tool` switch, re-read against BOTH upstreams at HEAD (2026-09-20). Residue
`2026-09-19-capture-muse-tool-switch-encodes-stale-assumption` framed the `openmuse` branch as
encoding an expired assumption ("the Athena needs a different tool"). For this supervisor — ONE child,
connects by `--address`, writes ONE file — the split is real and still current; what was wrong was the
other branch, and it could never have recorded anything:

- **muse-lsl (v2.5.3, 2026-09-08):** Athena support is real (`74fcb916`, 2026-06-30) but lives in
  `stream` (`devices.create_device`). `record` is an LSL CONSUMER: it takes **no `--address`** — the argv
  the daemon spawned exited 2 on argparse every 5 s — needs a running `stream`, defaults to 60 s, and
  RETURNS 0 when it finds none. The one-process by-address path is `record_direct`: legacy `Muse` class
  only (no Athena), default 60 s, and it writes its CSV **only after its loop** — SIGTERM kills it with
  nothing on disk; SIGINT takes the `KeyboardInterrupt` branch and saves.
- **OpenMuse (last push 2026-01-28, no license file, optics/PPG issues #24 #27 open):** Athena-ONLY,
  and its `record --address … --outfile` IS the daemon's shape; default duration 30 s.

Fixed: `muselsl` → `record_direct --address --filename --duration`; `openmuse` → `record --address
--duration --outfile`; both with `MUSE_RECORD_DURATION_S = 24 h` (the tools' defaults would have
produced ~100 half-minute files a night with 5 s holes, reading as a capture). Stop sequence is now
SIGINT → SIGTERM → SIGKILL. A child that exits 0 having written **no bytes** is reported as an error
(`exited 0 but wrote nothing`) instead of the silent green respawn — both tools return 0 on "could
not find the Muse". Docstring and `config.example.yaml` state the split, the dated upstream snapshot,
and that the path is UNEXERCISED on the box (no Muse configured, neither tool installed). An Athena
through muse-lsl needs `stream` + `record` as two children on LSL — not built, said so.

Not touched: `how-to-collect/muse-eeg.md` (#2687) — it describes the operator running `stream`/`record`
by hand and is right for that. The residue row is closed in a follow-up once this PR has a number.
