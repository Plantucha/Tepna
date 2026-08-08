---
bump: patch
type: added
nodes: [PpgDex, MotionDex]
brief: NODE-EXPORT-DURATION-SEMANTICS-2026-07-27-BRIEF.md
---

Closes the duration-semantics ruling by measuring the two items that had stayed open as premises, and
gates both. Neither premise survived.

PpgDex: the brief carried `durSec` as "a gap-filled-grid span" and asked for a rename to data-seconds.
Driving the shipped `parsePPG` → `compute` over 322 real capture-host PPG files (90 with a coverage
block) shows `durSec` already tracks `coverage.recordedSec` — the DATA — to 0.052 % of span at the
median against 0.425 % for `coverage.spanSec`, and is nearest the data on 75 of 90. §6.1 had already
measured the evidence (`t0 + durSec` short by 6.6 min on the gappiest night) and read it as incomplete
gap-fill; a duration short by exactly the dropout is data-seconds. So PpgDex already satisfies the
ratified option (c) and the proposed rename would have given the one node with both fields right two
envelopes and no data. Gated instead — `durSec ≡ recordedSec`, `endEpochMs − t0 ≡ spanSec`, with a
contiguous CONTROL — and mutation-verified against the literal rename the item proposed.

MotionDex: §7.3 made its `endEpochMs` conditional on `durationOf`'s `rows.length / 26` fallback
actually firing. Over 616 real ACC files (121,429,712 rows, 690 h, both corpus trees) it fires zero
times, so the field is not owed. The same run shows the constant is wrong: delivered ACC rate spans
20.9–202.7 Hz, so if reached the fallback misstates duration by 0.8×–7.8× — 462 s for a 60 s record,
beside a null `startEpochMs`. Removing it is a compute-path change on an unreachable branch whose
`durSec` feeds three windowing denominators, so it is routed to the follow-up brief with the
measurement rather than patched in. Gated: a stream that carries timing is measured, never assumed,
on a 200 Hz fixture where the two answers are 7.7× apart; mutation-verified.

Test-only. No DSP behaviour changed, no export moved, no bundle re-stamped.
