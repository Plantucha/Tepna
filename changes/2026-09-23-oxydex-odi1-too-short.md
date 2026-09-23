---
bump: patch
type: fixed
brief: none
---
A recording under 60 samples cannot yield an ODI-1 at all, and `computeODI1` returned `{ odi1Rate: 0 }` for it — the healthiest possible index for a night that was never long enough to index. `computeSpO2Percentiles`, **nine lines below**, carries the IDENTICAL `n < 60` precondition and already returns null: two functions, one guard, opposite answers, in the same file. A parity assertion now pins them together so they cannot drift apart again.

A second fabrication in the same function is fixed with it: `odi1Rate: durationHr > 0 ? … : 0` — a per-hour rate with no duration to divide by is undefined, not zero. The event COUNT survives, because it really was counted.

Most consumers were already written for the refusal — `computeNightExtras` tests `odi1.odi1Rate > 0` before taking the ODI-4/ODI-1 ratio, and `computeODRI` opens with `if (!odi1 || !odi3) return null`. The score push was not, and `null < 10` is TRUE, so an unindexable night would have taken the best bucket; it is guarded here.

⚠️ One more adopted model-written property reconciled — and it was the ODD ONE OUT between two siblings that both refuse (`_oxyEnsureRows`, `computeCT94`), inside a group titled *"every guard refuses, null never throws"*. Ninth such reconciliation in this sweep.

This closes the last OxyDex HIGH row from `ABSENCE-SURVEY-2026-09-22`.
