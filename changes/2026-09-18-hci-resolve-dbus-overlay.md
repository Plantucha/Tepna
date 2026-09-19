---
bump: patch
type: fixed
brief: none
---

`resolve_hci` could not reach its last surviving source on the one deployment its guard was written
for — the kernel removed the sysfs attribute the cheap path depended on, and nothing said so.

Closes residue `2026-09-12-sysfs-hci-address-attr-gone`.

## The attribute is gone, and it is a removal rather than a relocation

`sysfs_hci()` reads `/sys/class/bluetooth/hciN/address`. Measured 2026-09-18 on kernel **7.0.0-31**,
both boxes: every `hci*` node carries exactly `device power reset rfkill0 subsystem uevent` and **no
`address`**; `uevent` holds only `DEVTYPE=host`; and nothing under the node carries the BD_ADDR at all.
So there is no other sysfs path to re-target — which is why the fix widens the D-Bus overlay instead of
pointing the read somewhere else.

## Why that mattered, and where

`resolve_hci` asked the overlay under `if key and key not in devs` — i.e. **only on behalf of a pinned
adapter**. Compose that with a dead sysfs:

- sysfs → `{}` (always, now);
- `hcitool` → absent on the Pi 5 target, so `{}`;
- no `adapter:` pinned → `key == ""` → the guard is **False**, D-Bus is never asked;
- `devs` is empty → `resolve_hci` returns `None` → **RSSI unreadable, no error, nothing logged.**

That is the 2026-07-18 deaf-onboard mis-pin's own failure shape — a source that fails silently and
looks exactly like a radio reporting nothing — re-armed for the deployment `sysfs_hci` was written to
protect. The guard is now `if not devs or (key and key not in devs)`.

**The widening is strictly information-adding.** The overlay is consulted only in cases that previously
produced `None` or a missing key, so wherever a cheap source answers at all, the call count and the
result are unchanged. Measured on vigil: `hcitool dev` lists 4 controllers and an adapter **is** pinned,
so this branch does not fire there before or after — the change is inert on the production box.

## `sysfs_hci` is kept, and its docstring stops making a false claim

On an older kernel that still publishes the attribute the function works and remains the cheapest
source, so deleting it would trade a working fast path for nothing. But it described itself as *"the
DEPENDENCY-FREE resolver that works on any BlueZ box including the Pi 5 target"*, and on that exact
target the claim had quietly become false. **That was the half of the defect a reader could not see**,
and it is the half a comment can fix.

## Tests

5 added, and the guard is mutation-pinned **from both sides** — it can be neither reverted nor
over-widened:

| mutation | fires |
|---|---|
| revert to `key and key not in devs` | the defect test **and** the all-sources-empty test (2) |
| make the overlay unconditional | the cost-guarantee test (1) |

The cost guarantee is part of the contract, not decoration: the code's own argument is that "the common
case still costs one subprocess", so the tests **count** D-Bus calls rather than only checking the
result. That same assertion is what pins the change as inert on vigil.

Plus a positive control that `sysfs_hci` returns `{}` — an honest "I know nothing" — when handed nodes
shaped exactly as kernel 7.0 exposes them, rather than raising or inventing an entry.

`check.sh` EXIT=0: 7365 passed, coverage 100.00%, mypy 41 at baseline. Zero added ruff-format debt in
both files, measured in place.
