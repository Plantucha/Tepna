---
bump: patch
type: fixed
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

cohort-harness's realm tripwire (#2572) is now gate-backed by a plant: the authored boot script is driven in a vm with the node's global absent (ready WITH error, naming the global) and present (clean ready); REQUIRED_GLOBAL and SCRIPTS key sets are pinned equal, and the tripwire's fallback to an empty list — under which a node with no entry passed with nothing examined — is removed; every iframe consumer is scanned for reading the error. The same driver on the pre-#2572 harness produces no refusal, so the gate discriminates.
