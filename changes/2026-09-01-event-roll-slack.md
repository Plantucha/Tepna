<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [oxydex, cpapdex]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
Legacy t-only `ganglior_events` are no longer thrown +24 h by a single jittered row when OxyDex or
CPAPDex fuses an ECG export (DEEP-AUDIT-VI F9).

Both `oxydex-fusion.js _oxyHHMMSStoMs` and `cpapdex-coimport.js _hmsToMs` reconstruct a date-less
`t` by chaining on the previous event and rolling past midnight whenever the candidate fell more
than **1 second** behind it. A 2 s backwards step — a duplicated/jittered row, or a lexically sorted
legacy export listing 01:20 before 22:30 — therefore rolled that surge AND every later surge a day
forward. Executed on t0 22:00 with [22:30, 23:10:05, 23:10:03, 23:45, 01:20, 05:50]: the last surge
landed at +31.83 h instead of +7.83 h, overlapped zero desats/apneas, and `confPct` /
`corroboratedPct` read a confident 40 % (0 with a garbage `t`) where every event had a surge. The
integrator's `reconstructEventTMs` and `clock.js` (`CK_ROLL_SLACK_MS`, DEEP-AUDIT-III §1.2) already
place the same stream correctly.

Fix: the roll threshold is a fraction of a day (12 h, mirrored from clock.js as a local constant —
neither bundle inlines `DexClock`), so only a genuine ~23 h wrap rolls; and `oxydex-fusion` now
honours an emitter's absolute `tMs` before re-deriving from `t` (Clock §6 — the cpapdex-coimport
site already did).

Gate: three F9 assertions added to each of the §11 (OxyDex fusion) and §6.3/§6.4 (CPAPDex co-import)
groups plus real-wrap controls; pair-verified — 6 red on `origin/main`'s two files, all green here.
No committed OxyDex/CPAPDex fixture carries an ECG co-import, so every output is byte-identical
(`regen-oxydex-goldens` / `regen-cpap-goldens`: 0 moved); `manifestHash` moves for both bundles.
