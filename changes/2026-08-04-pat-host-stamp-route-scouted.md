<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---
§3e.4 — scout the host-stamp offset route: 15–79× better than the ACC anchors, but it clears the PAT bar on only 3 of 8 nights, and it explains §3c.2's length effect.

Both Polars carry a genuine `{devMs, hostMs}` pair on the same row and both read **independent** (post-line residual sd 114–161 ms, far above `hostAxis`'s 2 ms quantum test), so §3e.3's route exists. Applying `hostAxis`'s contract per device and taking **the difference between the two devices' corrections** — exactly the inter-device offset PAT needs — gives an IQR of **39–128 ms** across 8 box-captured nights.

Against the ACC anchors' 1171–3094 ms internal spread that is **15–79× better**, so the route is real. But the `residIQR ≤ 60 ms` bar is cleared on **3 of 8 nights** and missed by up to 2.1× on the longest. It sits *at* the requirement, not inside it.

**And it explains §3c.2 mechanically.** The IQR grows monotonically with overlap length — 123 min → 39 ms, 182 min → 54 ms, 373 min → 77 ms, 563 min → 128 ms. The inter-device offset **wanders over hours**, so a long fragment accumulates more offset variation and scores lower. That is precisely the inverse length↔`matchRate` relationship §3c.2 measured and could not explain, and it means "shorter pairs score better" is a real property of the timebase rather than a selection artefact.

**So the actionable form of PAT here is a short window (~≤3 h), not a whole night.** A 9 h night cannot be scored as one block at this precision by any method examined in §3c–§3e.

Scouting only: `hostAxis`'s contract was re-implemented rather than called, one pair per night, offset sampled at 10 s. A shipped result must drive `DexClock.hostAxis` itself.

Docs-only; no bundle, `manifestHash` or fixture is touched.
