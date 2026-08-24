---
bump: patch
type: added
brief: OXYII-G1-TRANSACTIONAL-SYNC-2026-08-23-BRIEF.md
---

G1's design brief (charter G1, spec §8–§19), fixed by the G5 measurements rather than by preference:
p90 69.2 s / max 104.7 s link occupancy against a median 78 KB payload, hourly poller cadence.

The organising fact is that cost is link acquisition, not bytes — so the retry policy is the
performance policy, and a retry bound must be stated in link-seconds against the p90 rather than as a
count. Five separate functions because each boundary is a crash point with a different correct
recovery; the ten named crash points become the planted-control list.

Records two things honestly rather than designing around them: validation layer 3 (record-boundary)
may need a subset port from the JS parser, so a VERIFIED row must state which layer verified it; and
the re-serve/resume choice sits behind one function until the drop test lands, with
re-serve-from-start as the safe default because a wrong resume offset yields a right-sized, silently
corrupt file.

Brief only; no code.
