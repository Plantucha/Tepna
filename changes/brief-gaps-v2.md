---
bump: minor
type: changed
brief: BRIEF-GAPS-2026-10-11-BRIEF.md
---

**brief-gaps v2 — the criterion re-stated as a share, the pooling moved to chunk pairs. PASS.**

v1 SHORTFALLED at recall@50 = 0.167. The finding was that a fixed k of 50 is the top **0.034 %** of
148,785 pairs, so the floor was unreachable before the first run.

v2 pre-states the criterion as **recall within the top 1 % ≥ 0.5**, with the share computed *from* the
pair space, and pools the **three strongest chunk-pair similarities** instead of a whole-file mean.
**Result: PASS — 0.833 held-out (15 of 18), fit 0.833, all 30/36.** Mean pooling on the same ranking
gives 0.444, so both the pooling and the criterion were defective, and the criterion was the larger.

No threshold is fitted: with the criterion a share of the ranking, the threshold only has to avoid
truncating the top 1 %. The reading list is now the top 1 %, not every pair above a threshold.

⚠️ The asked-for decision-text pooling was **not buildable**: the cached index records
`{ file, h, vecs }` with no chunk text and no offsets, so no chunk can be identified as the status line
or a ruling section, and embedding an extracted passage needs a model call. Chunk-level pooling is the
only option from cached data; unblocking the asked-for shape needs an index that records chunk offsets.

Cost: 1 m 50 s wall, 368 MB peak RSS. 27 selftests, including the case mean-pooling loses and that an
empty chunk list gives `null` rather than a 0 similarity.
