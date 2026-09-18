---
bump: patch
type: fixed
brief: CPAP-ACQ-P3-GAP-ACCOUNTING-2026-09-18-BRIEF.md
---

CPAP-ACQ-P3 W1 — `as11_pull.stream` now calls `classify_frame` instead of re-deciding inline, so the
tested spec is the executed one. The brief recorded the twin as untestable-for-disagreement; it did
disagree, twice. A non-dict frame, a missing or non-dict `params`, and a non-list `data` all RAISED out of
the generator and ended the stream — `classify_frame` counts them MALFORMED, a pure robustness gain. And a
StreamData carrying `data: []` yielded a batch of ZERO samples; it is now MALFORMED, which is the one
behaviour change and is deliberate: a zero-sample batch is presence-shaped absence (§∅), reaching the bus
and the EDF sink looking like data while carrying none. Whether AS11 emits such frames is NOT established
— if it does they now surface as `malformed` rather than as silent empty batches. Both divergences are
pinned by tests verified non-vacuous by planting the pre-W1 behaviour back.
