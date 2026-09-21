---
bump: patch
type: changed
brief: CPAP-ACQ-P3-GAP-ACCOUNTING-2026-09-18-BRIEF.md
---

Stamp the CPAP-ACQ-P3 brief's status header to the state its own items reached today: W1 (#2626), W2(a)
(#2627), W3 (#2634) and W4 (#2633) have all landed, leaving only W2(b), which is GATED on an empirical
question rather than unassigned. Also records that W2's original done-when was unsatisfiable — producer
and consumer are the same coroutine in `stream_to_bus`, so a bounded queue can never hold more than one
item and "a test drives a real overflow" could only pass by forcing the condition from inside. The header
previously read PROPOSED with three of four items unmentioned, which under-reports completion in exactly
the direction that gets work re-done.
