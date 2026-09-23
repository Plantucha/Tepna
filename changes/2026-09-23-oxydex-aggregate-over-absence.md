---
bump: patch
type: fixed
brief: none
---
Three OxyDex render sites absorbed an absent night into a number instead of reporting it (`ABSENCE-SURVEY-2026-09-22`, family F5). The worst is the 7-day rolling mean SpO2: `s + x.stats.meanSpo2` COERCES a null to 0, so the unmeasured night left the NUMERATOR while `w.length` still counted it in the denominator — one absent night in a 7-night window of 97 % plotted as **83 %**, a dramatic false dip on the one chart whose job is to show drift. The poor-night rate filtered its numerator on nights that have a stability score while dividing by every night, so each unscored night silently counted as "not poor" and diluted the rate; it now divides by the SCORED nights and the sub-label names that population. And `Math.floor(null / 60)` is 0, so a night whose duration was never derived rendered "0h 00m" and was GRADED on it — at a KPI, as bad.

Per §∅'s 2026-09-17 ruling the two aggregates ANNOTATE (the window is sparse, not discontinuous) while the absent scalar REFUSES.

A new gate group scans for the three shapes generically rather than pinning these lines, and it earned its keep immediately: it flagged two further duration sites, both of which turned out to be correctly guarded by an enclosing `if (s0.durationMin)` and a same-line ternary. The scan was widened to accept a guard that NAMES the field — load-bearing, because the defect it replaced (`st ? Math.floor(st.durationMin / 60) : 0`) does have a ternary guard, on the wrong thing. All three original defects were planted back and confirmed caught.
