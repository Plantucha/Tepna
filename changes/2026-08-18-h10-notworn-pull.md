---
bump: minor
type: added
---

**`POLAR-ONBOARD-BACKUP-FOLLOWUPS` §4's retrieval half — and most of it was already built.** The brief asks
for an H10 pull path. There already is one: `pull_polar_offline_all` → `polar_offline_op` →
`polar_psftp.list_recordings`/`pull_recording`, and `charger_pull_poller` has carried `Polar` in its vendor
set since **2026-07-23** (`3add29bd`). The vendor-scope complaint is true of `autopull_poller`'s hourly path
only.

**What was actually missing was a reachable trigger.** The H10 runs on a **CR2025 coin cell**, so
`charging` is permanently `False` and the entire on-charger path is unreachable for it. Recording without
retrieval fills the single onboard slot once and then silently records nothing — the parent brief's own
§0.2 fabricated-absence class.

`notworn_pull_due(worn, since, now, settle, already)` is the doff-edge sibling of `charger_pull_due`, wired
into the same poller as a second trigger. Two deliberate properties:

- **`worn is False`, not falsy.** `worn` is tri-state; `None` means *no verdict* (no contact bit, no optical
  inference) and the device may still be on the body mid-recording. Same `worn is not False` convention the
  power drop and `cpap_harvest.blocking_devices` already use.
- **The settle is CLAMPED above the power-drop grace, not merely defaulted above it.** A pull holds a
  connection; `should_drop_not_worn` closes one, so firing inside the 180 s grace would **block the drop** —
  the one thing §4 forbids. Default 300 s; anything below `_DROP_NOT_WORN_SEC + 30` is raised with a log
  line rather than obeyed, so a config cannot quietly reintroduce the fault.

⚠️ **The trigger is gate-tested; the round trip is not.** No H10 pull has been exercised against real
hardware, and the RR-vs-HR acceptance probe (parent §6 Q1) stays open — this unblocks it, it does not answer
it. Said plainly here because a green gate on a trigger reads too easily as a working backup.

Every DENY is paired with an ALLOW so a predicate that never fires cannot pass: the `None` denial sits
beside an explicit-`False` allowance, and "worn again re-arms" sits beside "once per doff".

Gate: `pytest --cov --cov-branch --cov-fail-under=100` — **100.00 %**, 3907 passed, `capture.py` 0 miss /
0 partial. ruff clean.
