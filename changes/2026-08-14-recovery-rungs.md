---
bump: minor
type: added
---

The monitor gains the three recovery rungs a human has to decide: **Restart bluetooth**, **Re-bind
adapter**, **Reboot box**. Two of the three need no new privilege — the helpers were already installed
and already granted, and nothing could reach them.

**Why they are buttons and not another automatic rung.** The adapter watchdog structurally cannot fire
these. A deaf-but-`UP` adapter is indistinguishable from nobody wearing the sensors — every device times
out identically in both cases — which is exactly why ~20 min of a night was lost on 2026-07-30 until a
human restarted bluetoothd by hand (0 → 91 devices seen afterwards). `radio` is the cheap rung;
`rebind` (USB driver unbind/bind) is the only thing that clears an RTL8761B controller firmware hang;
`reboot` is the last one, for a wedge no userspace rung reaches.

**`rebind` uses a second helper, and the two allowlists stay disjoint.** `tepna-btreset.sh` may touch
ONLY Bluetooth radios (USB class `e0:01:01`, read off the device, never from the argument);
`tepna-usbreset.sh` ONLY a docked Polar. Merging them would build a "reset any USB device as root"
primitive — a denial-of-service surface the fixed-helper pattern exists not to have.

**The port comes from the server's config, never the request body.** The helper's real allowlist is the
device class it reads off the hardware, but the pattern exists so a *request* cannot name the target at
all, so the body's value is discarded and replaced rather than defaulted from. Those two differ only
when someone supplies a port, which is the only case that matters. This was untested until a surviving
mutant said so: taking the port from the body passed every other assertion.

**`reboot` is guarded server-side, and the guard is deliberately NOT in the helper.** "Is a sensor
streaming right now?" is a question only the daemon can answer; the helper would have to infer it from
file mtimes, and `status.json` plus the LINK log are written continuously whether or not anything is
connected — so it would refuse forever. A guard that is usually wrong is worse than one honestly placed.
The refusal is a 409 that NAMES what is live, because "refused" alone tells the operator nothing about
whether to force it. `force` is an explicit act, not a bypass: anyone who could route around it already
has `sudo` and could reboot directly.

**`KILLS_SELF` sorts by "does it end the responder", not by danger** — a distinction `DROPS_LINKS` now
makes explicit. `radio` and `rebind` take every BLE link down (arguably worse mid-night) but leave the
web server alive, so they are answered INLINE with the helper's real output; deferring them would return
a cheerful 200 carrying nothing. Sorting by danger is how a recovery verb loses its answer.

Gated: 55 assertions across the two suites, with the guard, the config-sourced port, the helper choice
and the `KILLS_SELF` membership each verified by re-applying the mutant it exists to kill.
