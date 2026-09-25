<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex, ECGDex, Data Unifier, OverDex]
brief: SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md
---
The `…_PPGRUNS.txt` validity sidecar now reaches `parsePPG(text, { runsText })` from every ingest path —
the PpgDex file drop, both PPG adapters (Verity Sense, O2Ring finger) and the Data Unifier / OverDex
companion pairing. The reader had shipped in #2316 and no production caller ever passed it the text:
the §∅ P5 cross-check ran only in a unit test. Measured before the fix, every `<base>RUNS.txt` /
`<base>SEAMS.txt` matched no companion suffix and fell through BOTH bare-name defaults, so a night-folder
drop queued the sidecars as RECORDINGS in PpgDex and ECGDex (the PMDARRIVAL / F12 class, fourth
instance); they are now `runs` (PpgDex) or set aside (everything else). `rec.companions.runs` names the
sidecar that fed the parse. No sidecar → the exact single-argument call as before. Consumer set for the
brief's done-when 2 enumerated in its §3.2: PpgDex is the ONE reader; ECG, ACC and PPG2W sidecars are
written and unread.
