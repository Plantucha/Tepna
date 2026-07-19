<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ppgdex]
brief: PPGDEX-MULTICHANNEL-FUSION-2026-07-18-BRIEF.md
---
Stop a replicated optical channel from fabricating 3-LED agreement. The capture host fans the O2Ring's single ~125.7 Hz finger pleth across `ppg0/1/2` so it routes through the Polar PSL layout with no new parser branch (`capture.py`) — so `consensusBeats` was voting a lone sensor against two bit-identical copies of itself and scoring a structurally-guaranteed `ledAgreementPct: 100`, surfaced as a **`measured`**-tier KPI. `analyze` now dedupes bit-identical channels before the consensus vote (§4's *distinct-channel count*, not a 3-of-3 test — a pre-2026-07-18 capture's extra `timestamp [ms]` column shifts indices so the same ring reads as `(ms-ramp, v, v)`, which a 3-of-3 test would pass as a legitimate 2-LED sensor); at one distinct channel it takes the existing honest `nCh < 2` path and reports `ledAgreement: null`. Beats are unaffected — the guard drops the false claim, not the data. Closes `ENGINE-VERIFICATION-FINDINGS` §1.3 at the DSP tier, where it defends against any device or capture bug that replicates channels rather than today's O2Ring instance. Genuine Verity captures are untouched (three real photodiodes are never bit-identical) — proven, not asserted: the PpgDex real-corpus equiv fixture reproduced byte-identical under the new compute closure. 7 new assertions, both directions mutation-verified (neutering the guard reproduces the original `100`; a naive always-null fix reds the independent-channel leg).
