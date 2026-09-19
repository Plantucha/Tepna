---
bump: minor
type: fixed
brief: none
---

Two BLE ops counted their failures into a dict `snapshot()` could not read, so `link` and `offline_op`
have never appeared in `status.json` — and both call sites quietened their logs on the promise that
they did.

Closes residue `2026-09-19-ble-rate-cannot-see-absence`.

## The silent drop

`snapshot()` built its key set from `_ATTEMPTS | _SUCCESSES`. `attempt()` has **exactly one call site**
in `capture.py` and it is `"connect"` — so the two ops that only ever call `fail()`, **`link`** and
**`offline_op`**, appeared in neither dict and were **unpublishable by construction**.

That inverts this module's own purpose. Both sites assert the publication in their comments — *"the
total is in `status.json` `ble` where a rate can be read off it"*, *"the rate rides in `status.json` as
`ble` and is the thing an operator should actually watch"*, *"the total is never lost"* — and **both use
that assertion to justify quietening their logs** to first-occurrence-plus-decades. So the frequency was
suppressed in the log on the strength of a report it never reached: precisely the *"recovery that hides
its own frequency"* `blestats.py`'s header says the module exists to end.

**Measured on vigil before the fix**, and the control is that the failures demonstrably happened:

| | |
|---|---|
| `ble.ops` keys in `status.json` | 3 × `connect/…`, **no `link/` or `offline_op/`** |
| link-error occurrence lines, 72 h journal | **445** |
| offline_op lines, same window | **887** |

## The fix, and why it does not bend §∅

The key set now includes `_FAILURES`. A failures-only op publishes its **counts** with **`rate: None`** —
it has no denominator, and inventing one is the fabrication the rule forbids. `None` reads *"nobody
counted the attempts"*, which is the true statement. A count of 0 is a measurement; a rate over 0 is not.

## The denominator, and why its PLACEMENT is the whole of its meaning

`offline_op` now counts a real attempt — placed **after** the `_device_on_air` guard and after the slot
is acquired. So it counts ops actually run against a device that **was on air**.

That is the assigned row's absent-vs-failing collapse, answered structurally. Counting earlier would put
*"the device was never there"* and *"the op failed"* into one denominator, and the rate would fall every
night the hardware sat in its dock — an alert that fires on absence is the one that gets muted. Counting
before the slot would score an `OfflineBusy` bounce as an attempt at an op that never started.

**This is §∅'s out-of-band validity in its cheapest form: the guard decides presence, the counter
measures only what presence admitted.** No sentinel inside the value's range.

`link` deliberately gets **no** attempt counter: a link error occurs *during* a connect attempt, which is
already counted under `connect`. A second denominator there would double-count the same event.

## Tests

Five added; each mutation-verified:

- revert the key union → **2 fail** (the drop, and the `rate is None` rule);
- move the `offline_op` attempt **above** the on-air guard → the absent-device test fires.

⚠️ My first attempt at that second mutation moved the counter only as far as the `async with`, which is
still *after* the guard — it did not kill the test, and the honest reading was that **my mutation had
missed the invariant, not that the test was vacuous**. Re-run above the guard, it kills it.

## Not in scope, and found while gating

`MYPY_BASELINE=41` is stale against `main` itself: a pristine `origin/main` checkout measures **42**
(`mypy --ignore-missing-imports --explicit-package-bases .`), and this PR adds **zero** — 42 before, 42
after, error sets identical. So every branch cut from main inherits a RISEN advisory that reads as the
brancher's fault. Reported rather than banked here, because re-banking a ratchet inside an unrelated PR
is how a real regression gets absorbed silently.
