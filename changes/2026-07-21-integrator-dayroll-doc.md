<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [Integrator]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Document that reconstructEventTMs pins prevTMs to t0Ms on purpose — an order-independent single-day anchor that is exact for the ≤24 h node-export domain — so it is not "fixed" into a stateful roll, and flag the latent >24 h t-only day-unknown limit (DEEP-AUDIT-II #42, no behavior change).
