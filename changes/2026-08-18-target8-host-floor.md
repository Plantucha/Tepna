---
bump: patch
type: changed
---

**`KNOWN-CLOCK-ADVERSARIAL-CAPTURE` target 8 requires "the 19.5 µs floor". Re-measured on the live box, the
floor holds — but it has TWO numbers, and quoting the wrong one overstates the host by ~100×.**

`chronyc tracking` on vigil, 2026-08-18:

    RMS offset       14.6 µs      (better than the 19.5 µs on record)
    System time      2.7 µs slow
    Root dispersion  1.47 ms      <- the bound on ABSOLUTE time
    Stratum 2, locked to the stratum-1 LAN server 192.168.0.123 (+54 µs ± 1356 µs)

⚠️ **RMS offset is tracking precision; root dispersion bounds how wrong the source chain may be.** Target
8's criterion names only the µs figure, so a run quoting it alone would claim ~100× more host accuracy than
is defensible.

**The conclusion survives either number, which is why both belong in the report:**

| host figure | meaning | vs BLE ~100 ms |
|---|---|---|
| RMS offset 14.6 µs | tracking precision | ~6 800× |
| root dispersion 1.47 ms | absolute bound | **~68×** |

So §2.1's *"do not let a GPS/PPS hat gate the experiment"* stands on the conservative reading too — even at
1.47 ms the host is two orders below the transport it immediately feeds. Quoting 14.6 µs alone would be the
same error as quoting a `ppm` without its span.

No code change. Target 8 remains unrun; this pins the floor it must be reported against.
