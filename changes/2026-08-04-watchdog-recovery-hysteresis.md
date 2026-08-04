<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [suite]
brief: VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md
---

Give the adapter watchdog's *recovery* verdict the same hysteresis its *wedge* verdict already had
(P1.1, out-of-suite `capture-host/`).

`grace_checks` exists so one bad poll cannot escalate. The mirror was missing: one good poll cleared
`consecutive` outright. On 2026-07-24 the watchdog logged "adapter healthy again" 25+ times over a DOWN
radio and deferred its own escalation by ~65 minutes.

Half of P1.1 had already landed — `_adapter_is_up()` now feeds `classify_adapter_health`, so a DOWN
radio can no longer read healthy, which kills that original shape. The hysteresis the item actually
asked for had not, and it is a distinct live path to the same outcome: a **flapping** adapter, genuinely
up on alternate polls, still reset the count every time it blipped, so `grace` was never accumulated and
the ladder was never reached.

`recover_checks` (default 2) now requires that many consecutive clean polls before the wedge count
clears; a wedged poll breaks the run. `cycles` — the power-cycle budget — is reset behind the same gate,
which matters in both directions: clearing it on a single flap allowed unbounded power-cycling, and
never clearing it would let one early wedge disarm the ladder for the rest of the night.

Verified by re-applying the defect: 5 mutants, all killed. Two survived the first pass. One was the
`cycles` reset, now pinned by a test driving wedge → power-cycle → sustained recovery → wedge and
asserting the second power-cycle happens. The other was a `max(1, …)` guard that turned out to be dead
code — `healthy_run >= recover` is already satisfied by the first clean poll for any value ≤ 1 — so the
guard was removed rather than kept as a claim no test could check, and the config test now pins an
observable instead (`recover_checks: 3` requires three clean polls).

One existing test needed its poll budget raised from 2 to 3, since wedge → clean → clean is now the
shortest run that legitimately announces recovery.
