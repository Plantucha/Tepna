<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ecgdex]
brief: DEEP-AUDIT-V-2026-08-04-BRIEF.md
---
`parseECGText` is the one consumer that reads `hostAxis.ppm` and divides `fs` by it, and its apply condition was `ok && isFinite(ppm) && span >= MIN` — none of which a DERIVED host column fails. Clock Contract §7 requires the opposite: "FIRST ASK WHETHER THERE IS A SECOND CLOCK AT ALL — read `independent`, never a ~0 ppm." Measured on the real H10 captures (full files, 3.7 M rows, up to 481 min): the host↔device slope is **0.0 ppm** with a 1–3 ms residual — two independent crystals cannot agree to 0.0 ppm over eight hours, so that column is the device stamp restamped, exactly what `independent === false` reports. The correction is consequently a no-op on that corpus, so the guard costs nothing there; it earns its place by making the decision explicit rather than resting on "ppm happened to be ~0", and it matters on any capture whose host column is genuinely independent. `independent`/`spreadMs` are forwarded into the emitted `hostAxis` so `applied:false` can be told apart — a short fragment and a recording that never had a second clock are different problems with different remedies. Gated in BOTH directions, because a guard that only ever refuses is indistinguishable from one that broke the feature: red-verified at 5 failing assertions against main, and the independent arm still applies the correction. Export-inertness computed, not asserted — `DEX_UPLOADS=… verify-fixtures` re-ran the real corpus green.
