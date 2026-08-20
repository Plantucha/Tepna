<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md
---
Record what the 2026-08-20 reboot exposed in the mutation suite — the pid file was a claim, and the integrator stall wedged the whole 22-worker pool rather than one mutant, which is not the failure `--resume` was built to recover.
