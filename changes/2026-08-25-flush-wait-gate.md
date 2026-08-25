---
bump: patch
type: added
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Add flush_gate(), §14a's wait-for-run_status-3->1 decision for the close-triggered pull. The deadline
is checked first so waiting can never outlive the grace; a flush waits, a new session abandons
(which=latest would fetch the wrong one), an unobservable run_status defers to the poller, and idle
pulls. Sibling of pull_deadline and the second half of §8's held-link mechanism.
