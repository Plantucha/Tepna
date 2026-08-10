<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite, docs]
brief: TCH-CORRELATED-SOLVE-KNIFE-EDGE-FOLLOWUPS-2026-08-04-BRIEF.md
---
Show that the TCH "knife edge" is an algebraic identity — a rho measured against one corner as truth forces that corner's sigma to zero.

Adds `tools/tch-per-epoch-rho.mjs` (per-night re-solve + night-level bootstrap + a 200-random-triple
self-test of the identity). No runtime code changes: `analysis-stats.js` is read, not modified, and the
solver, its refusal path and `rhoCrit` are all confirmed sound and untouched.

Refutes the open item's hypothesis (that a constant rho per pair was the mis-specification) and §2's
diagnosis with it. Per-night rho spans -0.007 to 0.978 and every solvable night still lands exactly on
its own singularity, because rho-hat and rho-at-sigma-zero are the same expression.
