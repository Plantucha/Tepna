<!--
  CONNECT-LOCK-DUTY-CYCLE-2026-08-09-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-09 · **Created:** 2026-08-09

# An absent sensor held the global connect lock for most of every minute — four fixes, three of them mine, and why the first three were not enough

**Out-of-suite (`capture-host/`).** No Dex bundle / `manifestHash` / provenance impact. This records a
measured defect, the four attempts on it (two historical, two this session), and — the part worth
keeping — **why each earlier fix was locally correct and globally insufficient.**

## The defect

`auto_sync_clock` runs a 12-attempt ladder. Every attempt goes through `polar_offline_op`, which holds
the **global `_CONNECT_LOCK`** for the whole operation. While it is held, **no other sensor can
reconnect**. For a strap sitting on a desk, that ran at:

```
2026-08-09, H10 absent:  51 ops in 59.1 min · mean hold 41.1 s · 2097 s of 3544 s  =  59 % DUTY CYCLE
```

## Four fixes, and the shape they kept missing

| # | date | what was measured | what was changed | result |
|---|---|---|---|---|
| 1 | 2026-07-19 | an out-of-range device wedged capture — *"ZERO bytes for 58 minutes"* | `_OFFLINE_OP_TIMEOUT_S = 300` | permanent wedge → bounded wedge |
| 2 | 2026-07-19 | 12 × 300 s = *"97 % duty-cycle wedge"* — *"the bound has to be proportionate"* | `_CLOCK_SYNC_TIMEOUT_S = 45` | 97 % → 59 % |
| 3 | 2026-08-09 (#1062) | `devicenotfound` retried as though it were contention | `device_absent_error` — defer absence at attempt 1 | ladder stops at 1, **59 % → 53 %** |
| 4 | 2026-08-09 (#1081) | 12 × 45 s ≈ 9 min of lock per cycle regardless of error | `_CLOCK_SYNC_LADDER_BUDGET_S = 120` | bounds the worst case; never fired in practice |
| 5 | 2026-08-09 (this) | **the deferral lands AFTER the expensive part** | presence check **outside** every lock | the 45 s becomes a 6 s scan under no lock |

**Fixes 1 and 2 bounded ONE OP. Fix 3 bounded the LADDER. None of them bounded the LOCK.** The residue
after all three is visible in three log lines:

```
07:09:45  live capture paused     <- _CONNECT_LOCK taken
07:10:27  offline op finished     <- 42 s of doomed connect
07:10:27  auto-sync deferred      <- absence detected, too late to matter
```

One doomed connect per reconnect cycle (~70–110 s) is **53 %** on its own. Absence is cheap to detect —
it is a scan — and was being paid for at connect-timeout prices, under a lock that excludes every other
device.

## The generalisable lesson

Each earlier fix attacked the quantity it could see. #1 and #2 saw a *duration* and bounded it; #3 saw a
*retry count* and bounded that; #4 bounded the *total*. The cost was never in any of those — it was in
**what was held while waiting**. A bound on time spent is not a bound on exclusion, and the number that
kept not moving was the one nobody was measuring.

"The bound has to be proportionate" (2026-07-19) was the right instinct pointed at the wrong axis, and
it took three more iterations to notice — including two of mine tonight, both of which lowered the
number and neither of which removed the shape.

## The fix

`polar_offline_op` gained an **opt-in** `presence_check_s`. When set, it scans for the address **before**
taking the offline slot, `_POLAR_PAUSED`, or `_CONNECT_LOCK`; a definitive "nothing on the air" raises
`DeviceNotAdvertising` and nothing exclusive is ever taken.

Three safety properties, each with a test:

- **Opt-in.** Only the automatic clock sync passes it. A user-clicked pull keeps the old behaviour
  exactly — a person who pressed a button has information a 6 s sample does not.
- **`None` is not `False`.** `_device_on_air` returns `None` when it *cannot ask* (scan error, busy
  adapter, bleak absent), and the caller then does exactly what it did before. Collapsing that to
  `False` would let one scan outage silently stop every clock sync on the box.
- **A connected device is never scanned for.** It does not advertise, so scanning would "prove" absence
  about the one case that is certainly present.

The raised error's message contains `not advertising` **on purpose**, so it flows through the existing
`device_absent_error` / `transient_ble_error` predicates. A bespoke class no predicate recognised would
have been a third way to be wrong about a string.

## Errors made getting here, recorded because they were not cheap

- **Generalised from n=1.** I declared #1062 "does not fire" from a 6.9-minute window containing one
  retry line. The 8-hour distribution says **89 of 122 retries (73 %) were exactly the error it
  matches**, and it had already deferred once.
- **Compared across two changed variables.** I reported 59 % → 17 % as improvement; the H10 had gone from
  absent to *worn* in between. The honest comparison (absent, post-fix) was 53 %.
- **Twice inferred a mechanism from a filename.** On the USB side, `Holtek_HIDApi.dll` was read as
  evidence of the device's MCU family; it is a generic Windows HID wrapper.
- **A `-k` filter that selected nothing read as a pass.** `-k absent` does not substring-match
  `absence`, so a mutant looked survivable when the killing test was never collected. Same family as
  `| tail -N` on a gate summary.
- **A test asserted its own string.** The first absence-flows-through-predicates test constructed the
  message it then checked, so a mutant rewriting the real raise site passed. It now asserts on the
  exception the code actually raises.
- **A structural test matched its own comment.** The ordering test found `_CONNECT_LOCK` in the prose
  explaining why the check precedes it. Comments are stripped before indexing now.

## Still open

**The acceptance measurement.** 53 % was measured with an absent H10 before this fix. The same
measurement after it — absent H10, post-deploy — has not been taken, and a green suite is not a
substitute. Re-measure the duty cycle over ≥20 minutes with the strap off and record it here.

## Related

- [`VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md`](VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md) — the wedge that made this lock discipline load-bearing.
- [`VIGIL-DEEP-ANALYSIS-2026-07-22-BRIEF.md`](VIGIL-DEEP-ANALYSIS-2026-07-22-BRIEF.md) — §4's BLE fix ranking.
