<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: changed
nodes: [suite]
brief: VIGIL-DEEP-ANALYSIS-2026-07-22-BRIEF.md
---
Vigil batch 3 (out-of-suite capture-host/): (1) KNOWN-BUT-NOT-EXPECTED backup devices — a device marked
`optional: true` that fails to connect is noted ONCE then stays quiet (no per-cycle warning spam) and
backs off long (2-5 min), and nightqc no longer counts its absence as a `missing` stream or flags the
night not-ok (surfaced in a new `optional_absent`) — for a spare strap like the COOSPO that rarely joins.
(2) untrust-after-bonding (VIGIL-DEEP-ANALYSIS §2D): the LTK from `pair` is the bond, so `bond()` now
revokes the persistent `trust` flag afterward — the kernel no longer launches its own auto-reconnect that
races bleak for the single ACL slot (br-connection-canceled); bleak's explicit connect works regardless.
(3) watchdog give-up → clean exit (§2C): after exhausting adapter power-cycles, `exit_on_giveup` makes the
daemon exit non-zero so systemd re-execs with a fresh bleak/D-Bus stack instead of looping deaf all night.
10 new/updated pytest cases; suite green.
