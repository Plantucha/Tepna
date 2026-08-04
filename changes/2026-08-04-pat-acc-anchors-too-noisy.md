<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---
§3e — the ACC anchors cannot supply an inter-device offset at PAT precision: within a single pair they disagree with each other by 1.2–3.1 seconds.

§3d blamed the ACC correction's *wander* and asked for the per-pair offset to be measured directly. Measured, and §3d was too generous: **there is no stable offset for the interpolation to wander around.**

Over the 18 pairs that produce anchors at all, `offsetRange` — exactly `max − min` of the anchor offsets **within one pair** (`pat-align.js`) — runs **1171–3094 ms**, against a stage-two tolerance of ±90 ms (**13–34×**), a whole acceptance window of 450 ms (**2.6–6.9×**), and `pat-gate.js`'s 60 ms `residIQR` bar (**19–51×**). Median anchor offsets across pairs span −91 … +1400 ms.

**Which is why no offset model wins.** Three models over the *same* anchors — piecewise-linear `interp` (shipped), a single `const` = median of those anchors, and `zero` (the a-priori box-capture model) — give mean legacy `matchRate` 37 % / 35 % / 42 %, with head-to-head records of 9/18, 8/18 and 8/18. Three coin-flips: the signature of all three being noise around one mid-range.

**What survives.** The 94–100 % pairs of §3d.1 remain the only direct evidence of real R→foot coupling here — and they are evidence *because* they applied no estimated offset at all, not because zero is correct (it wins only 8/18). §3a's negative is confirmed uninterpretable, now with a number. Nothing indicts `PATAlign.alignByAnchors` outside this use: anchoring two accelerometers on shared movement is sound for coarse work, and is being asked here for ~30× more precision than it delivers on this corpus.

**The remaining route is different in kind:** stop estimating the offset and read it. On a box capture both streams are stamped by the same daemon, so what separates them is each device's own BLE delivery latency — and each device carries `sensor timestamp [ns]` against `Phone timestamp` to measure it. `DexClock.hostAxis` §7 already formalises that shape. Until it exists, no PAT coupling verdict from this harness family is quotable.

Docs-only; no bundle, `manifestHash` or fixture is touched. Scratch probes over the shipped tool, removed and not committed.
