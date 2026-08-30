---
bump: patch
type: added
brief: RADIO-FAILOVER-DISTRESS-SIGNAL-2026-08-29-BRIEF.md
---

**Two gaps in the failover ladder, pinned so a fix has a red-to-green target.**

An adversarial review of the landed ladder (#1963, #1970, #1971) found two properties that read as
implemented and are not. Neither is fixed here — the source belongs to its owner — but an unpinned
gap drifts silently, so both are characterised in a new test file that touches no source.

**The failure CLASS is written and never read.** `UnreachableRow` records the exception name in
`trigger` (`parts[5]`, verified against `Decision.ROW_FIELDS` rather than the literal, since the row
is built by field order). `therapy_minutes` reads only `parts[7]` and `parts[8]`, and no consumer
anywhere reads `parts[5]` — so a night the machine was OFF and a night the RADIO could not answer are
byte-identical to it, though they need opposite responses. ⚠️ The source never claimed otherwise: the
comment says the class is there "so a persistent fault is identifiable", by a human reading the CSV.
This is a spec-versus-implementation gap, **not** a false claim in code, and the two deserve
different responses.

**`classify_failure` keys on message TEXT, so one exception class lands on both sides.** `"…was not
found"` → ABSENT; `"…not found after 10.0 seconds, timed out"` → CONTENDED, because `_CONTENTION`
holds `"timed out"` and is tested first. That precedence is **deliberate and documented** — bleak
wraps some contention failures in classes whose names contain "NotFound", so absence-first would read
a jammed radio as a missing device. The test pins the intent *and* its cost: on any bleak path whose
not-found message carries timeout wording, ABSENT is unreachable and the module can never conclude
the machine is simply off. Safe direction, real consequence.

🔴 **The first version of the class test was VACUOUS, and the non-vacuity check missed it.** Its two
journals returned equal, non-`None` values (2.5 minutes each), which read as sound — but against a
planted gap-closing change **the test still passed**: the fixture sat far below `MIN_OBSERVED_FRAC`,
so discounting the class moved `unreachable` from 2 to 0 and the answer stayed 2.5 either way.
**"Both non-None and equal" is not "would diverge if the code changed."** The fixture now STRADDLES
the coverage refusal — six observed against six unreachable refuses today and becomes measurable the
moment any are discounted — so the verdict itself turns on whether the class is read. A
characterization test exists to be a red-to-green target; one that cannot go red pins nothing, which
is the very defect class this review was hunting.

Both are control-verified: a plant that makes `therapy_minutes` consume the class turns the F2 test
red and nothing else; a plant that makes `classify_failure` key on type turns the F3 test red and
nothing else; with neither, all six pass. Three passing tests beside them pin what IS implemented —
an unreachable poll adds no therapy time, and a mostly-unreachable journal refuses to answer.

New file only, no source touched.
