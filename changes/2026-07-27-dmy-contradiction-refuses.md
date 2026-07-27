<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: DEEP-AUDIT-III-2026-07-26-BRIEF.md
---
A file carrying both DMY and MDY proofs now refuses its ambiguous rows instead of guessing. `resolveDMY` has always detected the contradiction and returned `contradictory: true`, clock.js has always documented "refuse rather than guess", and DEEP-AUDIT-2026-07-11 stamped that executed — but all four live callers read only `.dmy`/`.locked` and threw the flag away, so the file silently fell back to the caller's preference and one anomalous row moved a proven-MDY O2Ring night 2026-06-12 to 2026-12-06, taking the date, t0Ms, exportName(), the crossnight axis and the Integrator's date join with it. The refusal is per row SHAPE, not per file: only the two ambiguous slash forms depend on the unresolvable order, so an ISO, 14-digit, epoch or time-only stamp in the same file still parses. Punishing unambiguous rows for their neighbours would be its own dishonesty. Shared-spine change: all 11 owned bundles rebuilt, 7 moved, 8 fixtures re-verified against the real corpus.
