<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: AS11-AUTO-SESSION-DETECTION-2026-08-24-BRIEF.md
---
Two AS11 boxes closed on measured evidence, and the run-length baseline for the three un-named sidecar
streams committed as a record.

- **Debounce box closed on production evidence.** No natural mask-off with recovery exists in 23
  recorded therapy nights (the 25 Hz instrument resolves the 08-25 37 s dip, so the zero is real);
  `auto_stop`'s 120 s quiet-flow hold has ended 12 sessions with trailing-low 118–176 s and zero
  resumptions. Also recorded, un-named: 5–6 sessions of 18–100 min at low pressure WITH flow, which
  auto-stop cannot see and which contradict the brief's n=1 mask-off model — with the owner.
- **Increment 3 closed as satisfied.** The detector already causes action: `auto_start` fires on its
  `Therapy` sighting (11/11 journal-bounded sessions, 3–17 s before the stream). Reopening criterion
  stated verbatim: an action at a therapy boundary that `auto_start` does not already take.
- **Run-length baseline table** (7 nights, 9 channels of `ppg` · `acc` · `accraw`, every run counted):
  runs ≥ 50 = 0 on every channel; `accraw` is its 6–7-sample hold by design; the Verity's 41–42
  maxima are the ADC-ceiling rail. A record, not a mechanism — the sidecar is inert on these by data,
  and a first run ≥ `T_STUCK` is what this table makes a finding.
