<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff: does the daemon RSS plateau after the night

**state:** IN-PROGRESS
**unit:** Answer row `2026-10-18-the-post-child-climb-plateaus-inside-the-documented-band` from box measurements.
**bird:** wren
**branch:** claude/plateau-wrn
**worktree:** ../wt-plateau-wrn
**doc-search:** `post-child climb plateaus daemon RSS documented band`, then `needrestart unattended-upgrades restarts the capture daemon during a held night`
**stopping-point:** The census is done, and the verdict is UNDERPOWERED. The new row `2026-10-28-an-apt-upgrade-restarts-the-daemon-through-a-held-night` names the largest restart source.
**next-step:** Read the post-08:00 tail of each night that reaches 10:00 on one PID. Three such nights decide the row.
**done-when:** Three nights each show a post-08:00 tail of at least 2 h on one PID, and the verdict below is PASS or FAIL.

## 1 · What the row asked

The row asks whether the daemon's RSS plateaus or keeps rising when a night runs with no restart. One night answered it so far: 2026-10-17, PID 388529. The row reads that night's tail as ±5 MB with no rise over 2.5 h.

## 2 · How I measured

All reads are read-only, on vigil, on 2026-10-28.

1. Read the `INFO mem:` lines of `tepna-capture` from 2026-10-17, segmented by PID.
2. Call a night eligible when one PID spans 22:00 to 08:00 and runs at least 60 min past 08:00.
3. For every other night, find the first stop after 04:00 and read its cause.
4. Read each cause from the journal, the cron watchdog log and the unattended-upgrades dpkg log.

## 3 · Result

Only 1 of 11 nights from 2026-10-17 to 2026-10-27 reaches 08:00 on one PID.

| night | PID tail after 08:00 | VmRSS at 08:00 → end | range | slope |
|---|---|---|---|---|
| 2026-10-17 | 2.42 h, 146 samples | 289.7 → 278.1 MB | 274.3 to 292.4 MB | −4.8 MB/h |

The other 10 nights end in a morning stop. Each stop has a recorded cause.

| night | stop (EDT) | cause |
|---|---|---|
| 2026-10-18 | 10-19 06:00:02 | cron watchdog: O2Ring and Verity Sense connected but silent, 94 min |
| 2026-10-19 | 10-20 06:07:46 | a person pressed the daemon control on the monitor page (`POST /api/daemon`) |
| 2026-10-20 | 10-21 06:44:15 | needrestart, after an unattended apt upgrade |
| 2026-10-21 | 10-22 06:00:01 | cron watchdog: connected but silent, 70 min |
| 2026-10-22 | 10-23 06:30:01 | cron watchdog: connected but silent, 89 min |
| 2026-10-23 | 10-24 06:00:21 | needrestart, after an unattended apt upgrade |
| 2026-10-24 | 10-25 07:01:09 | a manual deploy (`tepna-restart.sh deploy`) |
| 2026-10-25 | 10-26 06:30:01 | cron watchdog: connected but silent, 118 min |
| 2026-10-26 | 10-27 06:42:13 | needrestart, after an unattended apt upgrade |
| 2026-10-27 | 10-28 06:10:37 | needrestart, after an unattended apt upgrade |

| cause | nights |
|---|---|
| needrestart | 4 |
| cron watchdog, connected but silent | 4 |
| monitor-page restart | 1 |
| manual deploy | 1 |
| automatic `tepna-update` deploy | 0 |

`tepna-update` caused none of the 10 stops. On 10-21 and 10-28 it deferred its restart because a link was held. needrestart then restarted the daemon within 60 s. Row `2026-10-28-an-apt-upgrade-restarts-the-daemon-through-a-held-night` records that defect.

## 4 · Verdict

The criterion comes from the row, which stated it on 2026-10-18: the VmRSS slope after 08:00 stays at or under 5 MB/h. The one eligible night passes. One night cannot tell a plateau from a slow climb, so the status is UNDERPOWERED.

```json
{"schema":"tepna.verdict/1","gate":"box-rss-plateau-after-0800","status":"UNDERPOWERED","population":{"checked":1,"eligible":11,"excluded":10},"criterion":{"name":"post_0800_vmrss_slope","threshold":5,"unit":"MB/h","direction":"lte"},"result":{"nights_reaching_0800":1,"slope_mb_h_2026_10_17":-4.8,"tail_range_mb_2026_10_17":18.1,"tail_h_2026_10_17":2.42,"stops":{"needrestart":4,"watchdog_connected_but_silent":4,"monitor_page_restart":1,"manual_deploy":1,"tepna_update_auto":0}},"evidence":["journalctl -u tepna-capture | grep 'INFO mem:'","unattended-upgrades-dpkg.log 'Restarting services...'","briefs/RESIDUE.md#2026-10-28-an-apt-upgrade-restarts-the-daemon-through-a-held-night"],"reason":"1 of 11 nights from 2026-10-17 to 2026-10-27 reaches 08:00 on one PID; the other 10 end in a morning stop, so one night cannot separate a plateau from a slow climb","producedBy":{"tool":"journalctl and the dpkg log (read-only, Wren)","commit":"63127fa82"},"at":"2026-10-28T15:10:53Z"}
```

## 5 · Corrections

- On 2026-10-28 I sized this row and wrote that every restart is a `tepna-update` deploy. The census refutes that: `tepna-update` caused 0 of 10 stops.
- `handoffs/rss-climb.md` says only the owner can hold the morning restart. Four sources issue it, and three of them are not deploys.

## 6 · Open questions

- The watchdog stops follow a link that stayed connected but sent no samples for 70 to 118 min. This unit does not ask why the streams went silent.
- A needrestart exclusion is a box change, so it is the owner's call.
