---
bump: patch
type: fixed
brief: none
---

The sniffer remedy I stamped in #2664 was wrong: there is no sniffer radio to enable.

#2664 merged while my correction was still in flight, so the wrong remedy reached `main`. This is that
correction, standing alone.

## What was wrong

I read *"units installed on vigil, timer `disabled`/`inactive`"* as **"the action is an enable — minutes,
not a build."** It is not. **Both dongles now report `Zephyr HCI UART anchor np`** — the
RADIO-CLOCK-SIDECAR flash of 2026-09-07 took them — and the newest sniffer capture is
`nightly-20260909-0701.pcap`, **2026-09-09 03:11**. Sniffing stopped when the firmware changed.

Enabling the timer would schedule a unit against **no hardware**, which is worse than leaving it
disabled: it would run, produce nothing, and **read as a working capability**.

So the open item is an **owner decision, not a task** — re-flash one dongle back to sniffer firmware
(losing an anchor), or retire the duty-cycle capability. Owner-authorized either way, being a
daemon-state and firmware change on the box.

## Why I got it wrong, which is the reusable part

**The tree said *installed*; only the box said *and inert*.** The units and the radio are independent
surfaces. I checked one and derived a remedy from it, and the remedy was plausible, cheap, and wrong.
Wren reached the hardware fact independently from the box, and the second surface **inverted** the
conclusion rather than confirming it.

An install state cannot tell you whether the thing it schedules has anything to run against.

## Verified rather than relayed

The correction came to me as a relay, and relayed measurements pass no gate, so I re-read the box
myself. That confirmed the conclusion and corrected two details of the relay: the units were installed
**2026-09-12 14:37** with no `timers.target.wants` link, and the last pcap is **09-09 03:11** — an
intermediate relay said 09-05 03:57, which would have put the end of sniffing four days before the
reflash that actually caused it.
