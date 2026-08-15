---
bump: patch
type: added
brief: MUTATION-COVERAGE-SELECTION-2026-08-14-BRIEF.md
---

34 known-answer assertions on `computeKarvonenZones`'s **Next-Day Readiness composite** — five scoring
ladders that produce a user-facing 0-100 number, executed on every night with a profile and asserted
by nothing.

**The queue's top two entries were both mirages, and finding that out was most of the work.**

`cpapdex selfTest` ranked first with 125 survivors. Its mutants change assertion text and tolerances
inside the DSP's own self-check (`ok('near() REJECTS a value just outside the tolerance', …)`), so
killing them would mean testing the test. That is the "not production code" population #1196 measured
at 15.4 % of the fleet; it is classification work, not test-writing.

`oxydex computeKarvonenZones` ranked second with 110 — and the Karvonen arithmetic was ALREADY
thoroughly tested (`OxyDex computeKarvonenZones — reserve, not max`: Tanaka at two ages, all five
zones, contiguity, ascending order, the hrRest window, the 3600-row gate). A first draft of this
changeset added a near-duplicate of that group, because a `grep | head -8` truncated the evidence and
absence was read off a truncated list. Deleted.

**Locating the survivors BY LINE is what found the real hole.** They are not in the zones:

    L5749-5752  spo2Score ladder    16      L5737-5741  rmssdScore ladder   12
    L5667/5674  hrRestOverride      10      L5758       durationMin          4

`computeKarvonenZones` does two things, and only one was gated. FOLLOWUPS §4 in a single function.

**Method.** Every threshold is read from the source and pinned at BOTH sides of its boundary, since a
ladder is exactly where an off-by-one hides — `>= 2.3` and `> 2.3` differ on one input only. The
compound gates get one test per OPERAND and never a joint move: §2c's rule that "all-or-none in the
DATA is not all-or-none in the GATE", because varying both halves together can never separate `&&`
from `||`. So `odi4 1 / hd94 30` is asserted to score 20 rather than 25 — proving the second operand
is load-bearing, which no joint move could.

**Verified by re-applying real mutants, not by the group passing:**

    spo2 top rung  &&  -> ||      14 assertions red
    durationMin >= 420 -> >= 0    12
    remProxyMin >= 45  -> >= 0    10
    hd94Rate    <  60  -> <  0     4
    rmssd       >= 2.3 -> >  2.3   2

5 of 5 sampled mutants killed. ⚠️ A sixth "SURVIVED" in the first verification pass was a **false
negative in the harness**: the `sed` expression carrying `&&` failed to parse, so the mutant was never
applied and the loop reported a verdict about something it never did. Re-run with a python applier
that asserts the anchor is unique — §8's rule — it kills 14. A verification harness is as capable of
reporting success about something it never examined as anything else.

Also pins two shapes the ladders would otherwise fabricate: `rmssd: null` scores 0 rather than the
4-point floor (absent is not "worst"), and a present-but-empty `stageProxy` scores BELOW the neutral
no-data bonus, which is the intended asymmetry rather than a bug.
