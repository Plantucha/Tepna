---
bump: patch
type: changed
brief: OXYII-PRESENCE-MODEL-2026-08-23-BRIEF.md
---

`briefs/OXYII-PRESENCE-MODEL-2026-08-23-BRIEF.md` §5b — the G6 presence model's motivating measurement
now exists as a dated production event rather than a hypothesis, verified first-hand against `vigil`'s
journal because a cross-session report passes no gate.

**The hourly poller missed a night's recording.** The ring was worn through (autopull's off-finger
condition unmet), the stream ended 04:38:10, a consolidation restart at 04:45:42 dropped every BLE
link and restarted the 3600 s timer, and by 05:07:29 the ring was `not advertising`. The next tick
falls at ~05:45 — after the device is gone. The only `auto-pull:` line in the whole day is the enable
line: no tick, no transfer, no `.dat`. **Latency is wake-dependent, not schedule-dependent.**

**A held link is presence maintenance, not just observation.** An unworn ring never re-advertises, so
the restart converted *awake-and-linked* into *unreachable*. Operationally: pull first, restart after.

⚠️ Two details the first report did not carry, both found in verification: the failure changes
character at 05:18:45 from `not advertising` to `org.bluez.Error.InProgress` — a stack state, not a
sleeping device, and the two have different remedies; and the journal prints **local** time while
`date -u` prints UTC, which makes a healthy daemon look like one silent for four hours. `ps -o
etimes=` is what exposed the contradiction. Every timestamp in §5b now carries its zone.
