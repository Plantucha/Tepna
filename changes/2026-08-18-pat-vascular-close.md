<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: INTEGRATOR-PAT-VASCULAR-2026-07-18-BRIEF.md
---
`INTEGRATOR-PAT-VASCULAR` flipped PROPOSED → DONE (executed-and-refuted). No code changes.

The brief's Phase 0 ran twice (2026-07-29, then offset-free) and NO-GO'd both times — 0 of 54
pairings clear the gate, and its own §2 kill criterion voids the promotion phases. It stayed
PROPOSED because two revival paths were open at the time. **Both have since been measured out
elsewhere**, which is what makes this a bookkeeping close rather than a judgement call:

- the §4 dual-site differentiator was actually run — arm→finger cancels PEP by construction and the
  scatter does not collapse (92 ms vs 84, 1/43 clearing the bar);
- the §2-RESULT-II.4 beat-correspondence audit is subsumed by `PAT-VERDICT-CONSOLIDATED`, which
  eliminates every analysis-side candidate and identifies the ~96 ms floor as movable only by a
  tighter foot or a longer transit path — neither analysis.

The live successor is `PPG-SAMPLE-RATE-AND-PAT` (176 Hz Verity foot), already its own brief.

Why now: a peer session was nearly three tool calls into reimplementing a different already-shipped
brief off a stale status line this same evening. A measured NO-GO left reading as PROPOSED invites
the same misread with a two-week detour attached — everything above sat in the header, but only for
a reader who got past the status word.
