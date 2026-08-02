<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: POLAR-ONBOARD-BACKUP-2026-08-01-BRIEF.md
---
The Verity can be forced to record to its own flash — proven on hardware, Phase 1.

§7 Phase 1 ("lifecycle, no recording"), executed against the real Verity `0C301E3F`. The brief assumed
the start op was PS-FTP needing a new transport and a widened query allowlist. It is not: onboard
recording is the **ordinary PMD control-point START with one bit set** on the measurement-type byte.

```
status_before   acc = none
start_cmd       0282 0001 3400 0101 1000 0201 0800 0401 03    (0x02, ACC|0x80, negotiated settings)
start_ack       ok
status_during   acc = "offline"      ← the DEVICE reports it is recording to flash
stop_ack        ok
status_after    acc = none
```

**The hardware corrected an inference.** I assumed STOP mirrors START and carries the recording bit.
Sending `03 82` is refused outright — GATT `Unlikely Error 0x0E`, a protocol refusal rather than a
control-point ACK with an error status. There is exactly **one** STOP and it takes the bare measurement
type (`BlePMDClient.kt:475`). The `offline=` parameter was removed rather than left as a no-op, and the
wrong guess is now a test.

`polar_pmd` gains `as_offline` / `is_offline_cmd` / `meas_of`, and `status_cmd` / `parse_status_response`
/ `is_recording` (command `0x05`) — the only honest confirmation, since an ACK says the request was
accepted, not that anything is recording.

`probe_verity_offline.py` is read-only by default, issues STOP *before* it ever attempts a start, and
stops again in a `finally`: a probe that can start something it cannot stop fills the flash until the
device auto-stops mid-night, which is §0.2's fabricated-absence class. It targets **ACC**, not PPG —
recording a type removes its live stream (§2).

`tepna-restart.sh` gains `stop [minutes]`, because a Polar holds one BLE link and the probe must take it
off the daemon. Its failure mode is not an error but a silent dark night, so it is **deadman-timed**: it
arms a transient restart timer *before* stopping and refuses to stop at all if arming fails. Three
defects surfaced building it — `${2:-15}` turning `stop ""` into a silent stop, per-verb arity (`restart
extra` was accepted), and, on hardware, a spent transient unit staying loaded so the verb was single-use
per boot (the refusal was safe; the daemon kept running).

Still open: whether **PPG** accepts it, whether a recording survives a link drop, and what container
comes off the flash (§6 Q3). Nothing is wired into `capture.py` — no config, no automatic start; that is
Phase 2.

capture-host only, out of suite — no bundle, no `manifestHash` movement, no fixture re-recorded.
