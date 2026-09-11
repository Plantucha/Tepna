<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED (**sniffer BUILT, this brief is duty-cycle POLICY over it, and its remainder is BOX work — verified 2026-09-11 (Osprey) in the tree.** `capture-host/ble_sniff.py` exists and already carries the CRC/span handling (#2240), so nothing here is "write a sniffer". 1 of 4 Done-when boxes is ticked (the mechanism named, 2026-09-05). Of the three open: `tepna-sniff.service`/`.timer` are NOT in the tree — confirmed absent, so that box is genuinely open and is a BOX install, owner-authorized; the chunk-log verdicts reaching a human and §4's air-census bound are both small repo units against live code. Sized as policy + one pointer line, not as a build.) · **Created:** 2026-09-07

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

**Mean duty cycle 40.3 %, range 34.7–45.1 %, n = 14 — but those 14 files are 00:06–03:21 only.**
Re-measured over **28 files spanning the whole day** with `ble_sniff.py --expect-seconds 900` (§5.3):
spans **311–570 s**, i.e. the deficit is present in every file and varies about **2×** across the day —
the table above sampled one part of the night, the same error as quoting a cadence without its window.
**28 of 28 fail the tool's own 80 % floor; zero pass.** Of 40 files inspected, **2** spanned more than
600 s. Every capture *starts* on schedule, so this is not a scheduling fault.

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

## 5 · What was already done — corrected 2026-09-07 against the box

⚠️ **This section proposed four things. Two were already done on 2026-09-05, one was TESTED and found
insufficient, and the one that matters is blocked on an install, not on a proposal.** Verified
read-only on the box; the running collector script and its chunk log are the evidence.

**5.1 · The mechanism is NAMED, and was on 2026-09-05.** Not "unidentified", and no `py-spy` needed:
the collector script's own comments carry the measurement — *the extcap python pegs ONE CORE at
101 % and processes air at ~0.4× real time (newest packet 127→160→193 s behind over 110 s of wall
clock), so a 900 s window yielded only 337–421 s of packets and the missing 60 % was always the END
of the window — a systematic blind spot, not sampling.* §2's throughput reading and this are the same
finding; only this brief did not know it.

**Coverage well under 1.0 is therefore the NORMAL state of this rig, not an incident.** That is the
sentence §1's numbers need beside them.

**5.2 · Reducing the input was TESTED and is NOT the fix.** An `rssi >= -70` filter is in the
collector today, with its rationale and its trade recorded. Measured: it cut written packets ~70 %
and moved coverage **0.41 → 0.51**, and no further. The reason is structural — **the filter runs
AFTER parse**, so it saves the write path and not the receive path, which is where the core is
spent. Presenting this as an untested proposal was wrong; it is a measured, rejected remedy.

*(The filter is still right for the storm question and WRONG for a foreign-connect audit, which
needs the far-field packets it discards. The collector says so at the invocation.)*

**5.3 · The audit RUNS per chunk, and the versioned unit is NOT INSTALLED.** Both halves were
understated:

- The collector already invokes `ble_sniff.py` on every chunk and appends the verdict to its chunk
  log — **970 lines** since 2026-09-05T18:19:52, of which **160 carry a coverage figure**:
  min **0.27**, p50 **0.49**, mean **0.66**. So "nothing runs it" was false; what is true is that
  **nobody reads it**.
- `capture-host/tepna-sniff.sh` captures AND audits in one unit, propagating the audit's exit status
  (`ble_sniff` returns 3 when the window check fails, and the script exits with it), with versioned
  `systemd/tepna-sniff.service` + `.timer` **in the repo**. Checked on the box in both user and
  system scope: **not installed.**

**That is the real gap, and it is not a proposal.** The tooling exists, versioned and gated;
installing it is box ops and therefore owner-authorized. A brief proposing what is already built,
while the built thing sits uninstalled, is the shape this correction exists to stop.

**5.4 · Do not wrap or restart the launcher** without the owner — unchanged. The capture runs
unattended overnight and a restart-on-stall wrapper would change what the corpus contains
mid-collection.

## Done when

The open question, stated plainly: **coverage is ≈ 0.5, the one tested remedy does not fix it,
nobody reads the verdicts that are already being produced, and the versioned unit that would put
them somewhere a human looks is not installed.**

- [ ] The chunk log's verdicts reach a human — the audit already runs per chunk, so this is a
      DESTINATION decision, not a tooling one, and the destination is the owner's call.
- [ ] `tepna-sniff.service` + `.timer` are installed on the box, or the decision not to is recorded.
      Owner-authorized; nothing in the repo can close this.
- [ ] §4's air-census claims carry the bound (a pointer line is added by this brief's PR).
- [x] **The mechanism is named** — 2026-09-05, in the collector's own comments: extcap python at
      101 % of one core, ~0.4× real time, deficit always at the END of the window. Closed by
      correction rather than by work, and re-deriving it is what this section is here to prevent.
