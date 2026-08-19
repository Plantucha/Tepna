<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md
---
`ENGINE-VERIFICATION-FINDINGS` flipped IN-PROGRESS → DONE. No code changes — a verification pass that
recorded where each remaining finding was already closed.

Six of eight findings carried close markers in place. The two that did not:

- **§1.3** (`ledAgreementPct: 100` fabricated on a one-photodiode device) was fixed at BOTH ends by
  later work and never marked here: `capture.py` writes the O2Ring pleth single-column now, and legacy
  replicated files are caught by `deriveSiteFromLayout`'s data-not-header replication scan (100 %
  identical across 526 O2Ring files vs 0 % of 261 Verity — perfect separation), routing to the finger
  lane where the field is null. Gated in BOTH directions, so hard-coding null cannot pass either.
- **§1.5** (PAT tool verdict on uncorrected drift) closed as MOOT: its stated purpose was "fix before
  `INTEGRATOR-PAT-VASCULAR` Phase 0"; Phase 0 ran with the coupler extracted and fixed as
  `pat-align.js` (16 gated assertions), and the PAT question is terminally closed. Re-instrumenting a
  feasibility tool whose feasibility question has a final answer is work with no consumer.

§4's Done-when audited item by item, including the three cross-brief prose corrections it demanded
(all landed). No follow-up spawned — the pass surfaced nothing new.
