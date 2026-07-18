<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [PulseDex, HRVDex, OxyDex, suite]
brief: DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS-2026-07-18-BRIEF.md
---
Render-harness §RN wave 2: hoist three inline render classifiers to pure, exposed, TESTABLE functions used at their original call sites (behavior-identical → compute-inert, verified by the green equiv/GATE-C legs) — PulseDex.tanakaHRmax (208−0.7·age, its duplicated HRmax copy), HRVDex hrvRmssdClass (rMSSD readiness color band), OxyDex oxySpo2NightCV (SD/mean·100 night CV). Each was previously an inline expression inside a non-exported DOM-mutating render function, unreachable by any gate, so a threshold/scale slip shipped green; the render-execution harness now pins the surfaced value both-direction. Re-bundled PulseDex/HRVDex/OxyDex (manifestHash moves, outputs unchanged).
