<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: none
---
Optional GNSS session elevation — the one profile field a travelling box cannot guess, recorded as a
measurement or not at all.

`dex-profile.js`'s `elevation` is not decoration: OxyDex lowers the healthy SpO₂ threshold by
**~1.8 %/1000 m** (Roach 1998 / AMS guidance) and HRVDex/ECGDex scale the Uth–Sørensen VO₂max by an
altitude factor. Both read a value a human typed once. On a box that travels, that value is stale the
moment the box moves, and stale in the direction that **invents pathology**: a night at 2500 m against
a profile still saying 0 m reads as ~4.5 % of desaturation that never happened.

`geo.py` reads GGA from any NMEA receiver and records the night's elevation in the CLOCK sidecar's
header — a comment, not a column, because it is a per-session constant (`LinkLogWriter`'s `# adapter=`
pattern) and a column would shift every existing reader's offsets to repeat one value.

🔴 **OPTIONAL BY CONSTRUCTION, because Tepna is public and almost nobody has a receiver wired to their
capture host.** Absent config short-circuits before any import or device access; enabled-with-no-device
logs once and returns `None`; a device that is not a GNSS at all reads as absent. No path lets a
missing receiver degrade a capture — gate-asserted by a test that injects a reader which *raises if
called*, so "never touched" is verified rather than assumed.

∅ **Absence is null, never sea level.** No fix, < 4 satellites, HDOP > 5, or GGA quality 6 (dead
reckoning — an inference, not a measurement) all record **nothing**. `0 m` is a legal elevation, so a
fabricated zero is indistinguishable downstream from a measured one; the writer emits no header line
at all rather than an empty or zero field.

🔒 **Privacy: elevation is recorded, position is not.** The analysis needs altitude and has no use for
coordinates, and a medical recording carrying them to metre precision is a disclosure nobody asked
for. `record_position` defaults false; lat/lon are parsed (the altitude rides the same sentence) and
discarded, so enabling it is a disclosure decision rather than a capability change.

Fixtures are real sentences from a QUESCAN UBX-M10050 (u-blox M10) measured 2026-09-15 — quality 2,
12 satellites, HDOP 0.62, 619.7 m MSL — not hand-written ones, which would only prove the parser and
the fixture agree about a format neither had seen. MSL (GGA field 9) is taken deliberately over
ellipsoidal height: the SpO₂ literature is keyed to MSL and the two differ by 32 m at this site.

**Does not touch the JS side.** The consumers still default an absent elevation to `0` in four places
(`num(p.elevation) || 0`), which is the same §∅ defect one layer up — recorded as residue
`2026-09-15-profile-elevation-defaults-to-sea-level`, not fixed here: it moves `computeHash` on all
eight bundles and changes four nodes' published numbers, so it wants the corpus and the owner.
