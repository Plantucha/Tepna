<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PulseDex]
brief: DEEP-AUDIT-V-2026-08-04-BRIEF.md
---
Three PulseDex indices returned 0 when they could not be computed, and for each of them 0 is a meaningful point on the scale the renderer grades against — so "no measurement" arrived as a confident reading at the wrong end: Baevsky SI 0 graded ok, Cardiac CRS 0 graded bad, and ABS 0.000 graded ok, the exact centre of its −1..+1 scale. absIdx was the sharpest: ansBalance deliberately returns nulls and `null + null === 0` is falsy, so the honest null was converted back into "perfectly balanced" one line later.
