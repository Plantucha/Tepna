---
bump: patch
type: changed
---

**`VIGIL-AUTO-UPDATE-FOLLOWUPS` §4 says the interlock ratio "is real data, and nobody is looking at it".
Someone looked.** The section asks the owner to decide whether the deferral behaviour is acceptable, and
that decision had no number behind it — only the phrase *"a large fraction of its life"*.

A deferral **streak** (consecutive `deferred` ticks ending at a `restarted`) is exactly the interval during
which the box runs code that is on disk but not loaded. From `journalctl -u tepna-update`, 13-day window,
**17 closed streaks**:

| | hours running unloaded code |
|---|---|
| median | **8.27 h** |
| mean | 12.72 h |
| max | **70.09 h** (08-05 22:12 → 08-08 20:18, across 5 deferrals) |
| total | 216.2 h of the window = **68.6 %** |
| streaks ≥ 4 h | **16 of 17** |

The ratio has grown since the brief was written: **88 deferrals against 66 restarts** over 30 days, versus
the 47/41 recorded there.

**Two things follow that the prose did not make visible.**

1. **This is the normal case, not a tail.** 16 of 17 streaks exceed four hours, so the 70 h outlier is not
   what makes it a problem — the median night is.
2. **§4's own hypothetical is the median.** It imagines *"deferring the same commit for 9 hours"* as the
   thing nothing surfaces; measured, the median streak is **8.27 h**. The example it reaches for to argue
   the gap matters turns out to be the typical case.

**Recommendation, with the decision left to the owner:** build the patient case — a deploy able to say
*"restart at the next idle moment"* rather than waiting for the next 30-minute tick. It collapses the median
from ~8 h to minutes, and what justifies it is the 16-of-17, not the outlier. `--force-restart` (2026-08-14)
covers only the impatient case.

Both §4 boxes are left **unticked**: this supplies the number they asked for, it does not make the call.
No code change. Gate: docs-ledger, release-ledger.
