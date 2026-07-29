<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
---
`wpa_cli` can now reach the supplicant from inside the unit's sandbox, so the CPAP harvest stops leaking a root `wpa_supplicant` per run — and a teardown that fails says so instead of reporting success.

**Found by testing the harvest live** (2026-07-29). Two pulls both returned `ok: true` and downloaded correctly, but afterwards:

```
2199    /usr/sbin/wpa_supplicant -u -s -O DIR=/run/wpa_supplicant   ← the system's, correctly untouched
706705  wpa_supplicant -B -i wlp1s0 -c …/tepna-ezshare-*.conf       ← ours, LEAKED (conf already deleted)
```

**Why `-p` was only half the fix.** `-p` points at the SERVER sockets and is load-bearing — resolving through `/run/wpa_supplicant` would let `terminate` kill the box's own supplicant. But `wpa_cli` also creates its **own client socket**, under a compiled-in `/tmp` that is READ-ONLY for this unit (`ProtectSystem=strict`, and `/tmp` is not in `ReadWritePaths`; `PrivateTmp=no`). So every call failed with

```
Failed to connect to non-global ctrl_ifname: wlp1s0  error: Read-only file system
```

with the server sockets sitting right there in `/srv/tepna/.run/wpa`. `associated()` was written to route the **status** read around this by reading `/sys` instead — but **teardown has no `/sys` equivalent**, so `terminate` stayed broken and leaked a supplicant every harvest.

**The fix is `wpa_cli -s`**, which relocates the client socket into the same probed-writable directory as `-p`. No unit change, no `PrivateTmp`, and no widening of the `NOPASSWD` grant to `kill` — which was the obvious-but-wrong alternative, since the supplicant runs as root and `kill` is not (and should not be) whitelisted.

Verified against the real box before writing the fix: `sudo -n wpa_cli -p <dir> -s <dir> -i wlp1s0 status` returned `wpa_state=INTERFACE_DISABLED` and `terminate` returned `OK`, where both had been failing `rc=255`. The leaked supplicant was reaped by that call.

**`_wpa_down` no longer swallows the result.** It used to `return True` unconditionally, so a `terminate` that never worked reported a clean teardown and the harvest reported `ok: true` over a leaked root process. It now returns whether `terminate` succeeded and logs loudly when it did not, naming the interface and the real `rc`. The address flush and link-down still run regardless — reporting a failure must not turn into skipping the steps that stop anything routing over a half-torn link.

Downloads were never affected, which is exactly why this went unnoticed: the next run's `wpa_supplicant -B` fails, logs *"continuing; an existing supplicant may still associate"*, and `/sys` still reports the association — so the harvest works either way. A green verdict over a failed step is the shape this codebase keeps finding bugs behind.

3 tests, **mutation-checked** — dropping `-s` fails the client-socket test and nothing else; restoring the unconditional `True` fails both teardown tests: every `wpa_cli` argv carries `-s` *and* `-p` at the same writable dir; a failed `terminate` returns `False` and warns that a supplicant may survive; the flush still comes first and the link still goes down when it fails.

`pytest` **1652 passed**, **100.00 %** statement + branch coverage, `ruff` clean. Out-of-suite (`capture-host/`) — no bundle, no `manifestHash`, no fixture.
