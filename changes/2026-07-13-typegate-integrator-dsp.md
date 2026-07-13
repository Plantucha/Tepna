<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [Integrator, tooling]
brief: OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md
---
Gate integrator-dsp.js in checkJs (D.2): IntegratorDSP attach + the IntegratorTCH and GangliorProvenance optional siblings declared in a new node-scoped integrator-globals.d.ts, and 6 comment-only source casts (audit-breadcrumb props on fixed-shape events, a null-index accumulator, a never-narrowed posture lookup, and possibly-null window-span arithmetic). Export-inert re-bundle of Integrator (+ OverDex, which co-loads it); GATE A/B green, no fixture output moved.
