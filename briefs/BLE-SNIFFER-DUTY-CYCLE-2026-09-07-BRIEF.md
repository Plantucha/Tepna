<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-09-07

# The air captures hold ~40 % of the air — the sniffer drains slower than real time

Measured by Wren on the box, 2026-09-07. The nRF sniffer writes `/srv/tepna/captures/sniffer/night/`
on a 15-minute rotation. **Each file contains only the first ~6 minutes of its window.** This bounds
every conclusion anyone has drawn or will draw from these pcaps, including §4 of
[`VIGIL-BLUETOOTH-ADAPTERS-2026-09-05-BRIEF.md`](VIGIL-BLUETOOTH-ADAPTERS-2026-09-05-BRIEF.md),
which is my own.

## 1 · The measurement

Consecutive files, first and last packet, 2026-09-07:

| file | first packet | last packet | span | then |
|---|---|---|---|---|
| `air-20260907-0006` | 00:06:54 | 00:13:02 | 368 s | 532 s unobserved |
| `air-20260907-0021` | 00:21:54 | 00:28:04 | 370 s | 531 s unobserved |
| `air-20260907-0036` | 00:36:55 | 00:42:08 | 313 s | 587 s unobserved |
| `air-20260907-0051` | 00:51:55 | 00:57:47 | 352 s | 548 s unobserved |
| `air-20260907-0106` | 01:06:55 | 01:12:19 | 324 s | 548 s unobserved |
| `air-20260907-0121` | 01:21:55 | 01:27:52 | 357 s | 576 s unobserved |
| `air-20260907-0136` | 01:36:55 | 01:43:06 | 371 s | 543 s unobserved |
| `air-20260907-0151` | 01:51:56 | 01:58:02 | 366 s | 530 s unobserved |

**Mean duty cycle 40.3 %, range 34.7–45.1 %, n = 14.** Of 40 files inspected across the day, **2**
spanned more than 600 s. Every capture *starts* on schedule, so this is not a scheduling fault.

## 2 · Mechanism — it does NOT hang, it falls behind

The first reading is wrong and worth stating because it is the obvious one: the process sits at 101 %
CPU producing nothing, which reads as a spin-hang. It is not.

The file keeps GROWING after its last packet timestamp. Measured on the live capture at 11:35–11:37:

```
11:35:54   last packet 11:28:18   lag = 456 s
11:36:14   last packet 11:28:29   lag = 465 s
11:36:35   last packet 11:28:41   lag = 474 s
```

**The lag grows.** In 41 s of wall clock the capture advanced 23 s of air: it drains roughly **11 s of
air per 20 s of wall time**, ~55 % of real time, and the deficit accumulates. `timeout -s INT 900`
then kills it with the backlog undelivered, so what lands on disk is the *front* of each window and
the tail is never written.

101 % CPU is therefore normal operation, not a symptom — it is one saturated core, single-threaded, on
a 4-core box. `storm-watch.err` carries only Python `SyntaxWarning`s; there is no crash, no traceback,
and `/proc/<pid>/wchan` reads `0` with state `R` throughout.

⚠️ **The unobserved time is the TAIL of each window, not a random 60 %.** Anything periodic that
happens more than ~6 minutes after a quarter-hour boundary has never been captured at all.

## 3 · Why this bounds prior work

`VIGIL-BLUETOOTH-ADAPTERS-2026-09-05` §4 draws an air census from these captures — connect counts,
the SCAN_REQ proportion, the ring's advertising behaviour. Those numbers are drawn from ~40 % of the
air, sampled from the same phase of every window. Rates and proportions are probably fine; **absolute
counts and any "X never happened" are not**, and F2's single 2 h death in that brief is now known to
be the general case rather than an incident.

## 4 · Two traps this cost me, both reusable

**4a · A device going quiet in a pcap is not a device going quiet.** I set out to measure the O2Ring's
~122 s post-doff power-off on air, as an independent instrument for the figure in `alerts.py`. The
ring's last advertisement was **08:07:21.560**; the daemon's journal shows it CONNECTING at
**08:07:21.573**, 13 ms later. The ring stopped advertising because it was connected. The pcap alone
reads as a clean power-off, and the conclusion would have been confidently wrong.

The check that saves it is cheap: confirm *other* devices kept transmitting after the silence (here
they did, for 7½ minutes), and cross-read the daemon journal for a connect at that instant.

**4b · `btle.advertising_address == <dev>` does not mean the device transmitted.** It matches
SCAN_REQs *aimed at* that device too. My first pass counted 539 "ring advertisements" in a window
where the ring sent **11**; the other 528 were PDU type `0x03` (SCAN_REQ) from scanners. Filter the
PDU type explicitly — `0x00` ADV_IND, `0x02` ADV_NONCONN_IND, `0x06` ADV_SCAN_IND — never the address
alone. Given §4's finding that ~60 % of all air packets are SCAN_REQs, the address-only filter
over-counts by roughly the storm's size.

Both are the same shape as the repo's dominant class: a query that ran, examined something other than
its subject, and returned a confident number.

## 5 · Proposals (not done — box ops are owner-authorized)

1. **Name the hang site.** `py-spy dump --pid <pid>` is read-only and would show where the drain
   loop spends its core; py-spy is **not installed** on the box today. `/proc/<pid>/stack` needs root.
2. **Reduce the input.** §4 measured ~60 % of captured packets as SCAN_REQs from neighbours' scanners.
   If the sniffer can filter those at the device or in the extcap, the drain may fit inside real time.
   This is a hypothesis with a mechanism, not a diagnosis — the CPU cost per packet class is unmeasured.
3. **Surface the deficit.** The failure is silent: a full-looking file, no error, no gap in the file
   *names*. A one-line check per file — `last_packet − first_packet` against the rotation period —
   turns it into an observation. That is the cheapest item here and does not require fixing the cause.
4. **Do not wrap or restart the launcher** without the owner. The capture is running unattended
   overnight and a wrapper that restarts on stall would change what the corpus contains mid-collection.

## Done when

- [ ] The duty-cycle deficit is either fixed or reported per file, so no future reader takes a pcap's
      span for its window.
- [ ] §4's air-census claims carry the bound (a pointer line is added by this brief's PR).
- [ ] The mechanism is named at the code level, not just at the throughput level.
