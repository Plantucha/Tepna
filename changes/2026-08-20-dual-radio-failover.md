---
bump: minor
type: added
brief: VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md
---

**Dual-radio failover (VIGIL-OVERNIGHT-FINDINGS P1.5) — the section's last large item.**

The night the brief was written, the pinned USB dongle wedged for ~110 min while a healthy internal
radio sat idle. The recovery ladder only reset the SAME radio; now, when that power-cycle budget is
spent, capture fails over to a healthy spare.

- `parse_hciconfig` / `failover_target` / `list_adapters` — pure parser + decision + probe: enumerate
  controllers (`hciconfig -a`) and pick one that is UP and not the pinned (wedged) one.
- `adapter_watchdog` L3 rung: at give-up, repoint the process adapter pin (`_set_active_adapter`) and
  re-bond the sensors on the spare (bonds are per-adapter). Because `adapter_kw`/`adapter_hci` resolve
  `ADAPTER`→`hciN` fresh on every reconnect, that one repoint moves every device task. `max_failovers`
  caps ping-pong; `watchdog.failover: false` restores the old give-up. Degrades safely — no spare →
  `list_adapters()` is `[]` → the ladder exits exactly as before.

Pure parser + decision fully tested (real `hciconfig -a` fixture; down/no-mac/malformed/leading-junk
edges); watchdog branch tested end to end (failover + budget exhaustion, disabled-no-probe,
bond-failure-non-fatal). Field-gated remainder: proven to fail over in tests, not yet observed clearing
a REAL wedge. capture-host lane only — no bundle, manifest, or fixture moves.
