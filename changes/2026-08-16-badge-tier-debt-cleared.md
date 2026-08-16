---
bump: minor
type: fixed
brief: DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md
---

The fabricated-tier debt is zero. It was 94 this morning.

Owner-ratified adjudication of the 68 remaining OxyDex labels: 62 new registry rows, 3 aliases to
metrics that already existed, and 3 denials. Each tier is a claim about how well that number is
established, assigned one at a time against the ladder these files already use — meanSpo2 and minHr as
measured, odi3/odi4/t88 as validated, hypoxicBurden and pnn3 as experimental, MOS as heuristic — rather
than filled in to turn a gate green.

The rule that did most of the work: an established external method applied to a signal it was not
validated on is emerging, never validated. DFA α1, deceleration capacity and approximate entropy are
real published methods computed here on pulse rate rather than ECG RR, and that transfer has not been
validated. Anything the code itself hedges — proxy, -equiv, ~est — is heuristic, and for the staging
estimates that is independently supported, since REM-STAGING records that recall and precision against
PSG labels have never been measured.

Three labels are denied rather than tiered because they are not measurements. Best Night and Worst Night
render a date. HR Range renders minHr–maxHr, two separately registered measured metrics in one field,
which is the chart-caption rule arriving in a KPI.

Checking before writing caught four things worth more than the tiers. Frag Index, Motion % and NSI Mean
already existed in the registry as sfi, motion and nsi, so they are aliases rather than duplicate rows —
and two of the three existing grades matched the draft exactly. CRC Index looked like the existing
cvhrIndex and is not: cardio-respiratory coupling and Hayano's cyclical-variation-of-HR are different
measures with similar names. NSI Mean's label was built by concatenation — metric('NSI Mean (' + n +
'n)') — so no registry row could ever have matched it at runtime; a row keyed on the captured prefix
would have silenced the static scan while users still saw a fabricated tier. The call site is now static.

The cohesion gate then caught six disagreements with grades already published in OxyDex Reference.html.
Five were more conservative than the draft and were adopted: ApEn, CRC Index, HR IQR, SOL Trend and
Ultradian Cycles all move to heuristic. The sixth went the other way — the doc graded CDI emerging while
the registry says experimental — and there the doc came down, because its own footnote reads "citation
pending independent verification… full attribution being confirmed", and an emerging grade resting on an
unconfirmed citation is exactly the upgrade §🎫 forbids. Its tooltip is corrected too, since a badge whose
hover text still says Emerging is a half-fix that lies.

Provenance: computeHash moved 669b0255daf3 → 68f969245cae, so the corpus re-verification was owed and was
run — green, two fixtures stamped, twelve already current. All three generated trees rebuilt; GATE A 9/9,
GATE B 18 reproducible.
