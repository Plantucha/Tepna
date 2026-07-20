<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
PpgDex's windowed ACF cadence no longer locks onto the sub-harmonic. With beat-to-beat amplitude
alternation the 2T autocorrelation peak can exceed the T peak, so the cadence reported a doubled
period, the refractory was sized from it, alternate beats were suppressed at detection and the HR
read exactly half — measured 75 bpm → 37.5 and 100 bpm → 50.0, with every quality channel reading
perfect. The per-lag correlation is now a mean rather than a raw sum (so lags are comparable), and
a sub-multiple lag is adopted when it scores within SUBH_FRAC of the winner. Verified 60–100 bpm;
>= 120 bpm remains unresolved and is pinned as a known limit.
