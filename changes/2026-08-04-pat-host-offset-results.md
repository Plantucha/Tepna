<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---
§3f — run `tools/pat-host-offset.mjs` over both corpora: PAT coupling is real, intermittent, and absent in most windows; the phone-captured corpus cannot support the measurement at all.

**§3f.1 — the phone tree is refused entirely.** 34 nights / 208 files of the older tri-device corpus: **29 refusals, 100 % of them `NOT INDEPENDENT`, zero windows scored.** Residual spread exactly **1.00 ms ≤ 2 ms** — one stamp quantum, i.e. the host column *is* the device stamp rounded, so there is no second clock to read an offset from. That reproduces `clock.js` §7's documented phone/box bimodality (box 101.89–5124 ms, phone 0.13–1.00 ms) on an independent corpus, by a tool with no knowledge of which tree was which. Any PAT attempt on phone-captured nights is measuring nothing, and the guard says so instead of falling back to an uncorrected axis.

**§3f.2 — the box tree.** 20 nights, 14 with scorable pairs, **57 windows / 179 389 beats**: strict beats its own circular-shift null at p<0.05 on **20/57 (35 %)** against ~1.4 expected, while the **median** window sits at **7 % — exactly its chance floor**, 33/57 are at or below chance, and the strongest reach **48 %** and **47 %**. Both halves are the finding: not "PAT works" but "PAT is present intermittently and absent most of the time" — the first statement in this brief with a shape a verdict could be built on.

**§3f.3 — a consistency check running the right way.** The two nights with the most significant windows (08-01 **7/9**, 08-03 **4/6**) are exactly the two with the **worst** whole-night offset IQR in §3e.4 (128 ms, 126 ms), while 07-24 — the best at 39 ms — scores 0/1. Windowing rescues precisely the nights whose whole-night offset was least stable, which is what §3e.4 predicts and the opposite of "those nights just had better clocks".

**§3f.4 — not claimed.** The 20/57 count is a magnitude, not a p-value: windows from one night and from overlapping pairs are not independent, so the binomial tail this invites (2.8 × 10⁻¹⁸) is deliberately not quoted. The intermittency is not yet attributed — physiology coming and going and the offset wandering in and out of the `[200, 650]` ms window both predict this shape, and the per-window `ppm` needed to separate them is carried but unused.

Docs-only; no bundle, `manifestHash` or fixture is touched.
