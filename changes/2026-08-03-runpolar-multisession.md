<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: none
---
`run_polar` gets the multi-session harness its survivors actually need — and the charging inference is pinned.

`run_polar` measures **44 %**, the weakest surface in `capture-host`, and the reason its survivors resist
testing is SHAPE, not volume. The existing fixtures drive ONE connect cycle against a static device,
while the surviving mutants live in state inferred from CHANGE ACROSS SESSIONS: battery direction,
stale-bond counting, rebond cadence, worn-since timing.

Driving a second session needed one thing the harness did not do. `capture._STOP` is a module global
that `_stop_after` SETS, and the autouse fixture only recreates it per TEST — so a second `run_polar`
call in the same test saw it already set and returned instantly. An earlier attempt at these tests kept
reading the FIRST session's battery for exactly that reason. `_next_session()` gives each cycle a fresh
Event, which is also required because every `_run` is a new event loop.

**The harness carries its own guard test.** Without the fresh `_STOP` every test built on it would pass
while silently measuring the first session twice — a hollow harness, which is worse than none.

First use: the charging inference. A Polar exposes no charge flag mid-session (`in_charger` only appears
when a PMD START is REFUSED, impossible for a device already streaming when it went on the dock), so it
is inferred from battery DIRECTION — the 2026-07-19 case where a Verity climbed 35 → 61 % while the
monitor said `charging=False` throughout. All three branches now asserted.

**The tests corrected an assumption:** `charging` is NOT carried across sessions. A successful PMD START
re-derives it, so only a STRICT rise turns it on, which makes the `>` boundary load-bearing in a way a
persisted flag would not be. Documented in the test rather than left as folklore.

No kill-rate delta is claimed: the measurement did not complete cleanly (see the commit).
