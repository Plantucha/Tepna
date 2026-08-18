---
bump: patch
type: changed
brief: PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md
---

**Route 1 derived on the single-segment box night — the first box night to beat its own null, and it
still is not enough for PAT.**

`tools/pat-host-offset.mjs --night 2026-08-11`, 120 min windows, 50 surrogates, ECG reference:

| window | beats | strict | chance | p |
|---|---|---|---|---|
| 0 | 6212 | 8 % | 7 % | 0.059 |
| 120 | 6297 | **25 %** | 7 % | **0.020** |
| 240 | 6381 | 14 % | 7 % | **0.020** |

**strict beats its own surrogate null on 2 of 3 windows** — against this brief's recorded *"0 of 13
box"*. What changed is exactly what §7 said was needed: one unfragmented segment on **both** legs.

⚠️ **Not "PAT recovered".** 8–25 % strict against a 7 % chance line is *detectable*, not *usable* —
a statement about identifiability, not accuracy.

⚠️ **The p-values are floored by the surrogate count.** At 50 surrogates p = (k+1)/51, so **0.020 means
zero surrogates exceeded** — the smallest value the test can express, not a measured 1-in-50. Re-run
with more surrogates before publishing any number here.

n = 1 night, 3 windows, and legacy sits at chance on the third — the effect is not uniform even within
the night. The per-fragment Δ item stays open; it is no longer waiting on a capture, and now has a
night with a derived rather than fitted rate to test against.
