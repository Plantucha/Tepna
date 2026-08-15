---
bump: patch
type: fixed
---

*A charging device cannot be on a body* was encoded twice, and only one copy said so.

`cpap_harvest.blocking_devices` has checked `charging` since 2026-07-26 — the evening when every sensor
was docked and idle and a manual pull still refused with "streaming: Polar Verity Sense, Wellue
O2Ring-S", which its docstring records as *"the gate was unreachable on any evening the sensors were
charging, which is precisely when a pull is safest"*. `capture.autopull_poller` gated on `worn is True`
alone, so a **docked ring reporting contact would have blocked its own backup pull** — at the one moment
it is free to run. The auto-pull is the belt-and-suspenders backup for a lossy BLE link; it is what
rescued a whole SpO₂ night on 2026-07-24.

Both now route through `telemetry.on_body`:

| device state | verdict |
|---|---|
| worn on a wrist | `True` |
| **docked, reports worn** | `False` — the contradictory state a Polar contact bit produces |
| docked, off-body | `False` |
| connected, worn unknown | `None` |
| disconnected | `False` |

**⚠️ `None` is returned rather than collapsed, and the two callers answer it differently on purpose.**
That asymmetry is the reason this is one predicate and not one boolean. Their costs are not symmetric:
blocking a harvest on an unknown is cheap — the next run retries — while refusing to auto-pull on an
unknown loses the ONLY backup for a lossy night, and the ring's `worn` is never actually unknown, so a
conservative default there buys nothing real. So `blocking_devices` blocks on `is not False` and the
auto-pull skips only on `is True`. Folding them into a single bool would silently pick one policy for
both, which is what "unify these two gates" naively means.

The `blocking_devices` rewrite is behaviour-preserving — 276 existing tests pass unchanged — so the only
behavioural change is the one intended: a charging device no longer blocks the auto-pull.

Two of my own recurring traps were caught while building this, both worth the note: `capture.py` imports
*names* from `telemetry`, not the module, so `telemetry.on_body` was undefined (ruff caught it); and the
wiring test's `code.index("autopull_poller")` matched an earlier **docstring mention** and sliced the
wrong function — the same first-occurrence trap that sent a `status=409` mutation into unrelated code
earlier today. It now anchors on `async def autopull_poller(` and is verified to fail when the gate is
reverted.

From `CAPTURE-HOST-UNWIRED-MACHINERY-2026-08-14-BRIEF.md` §4.
