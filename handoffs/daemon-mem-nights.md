<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — the daemon mem block over every night since #3601

**state:** DONE
**unit:** Measure the daemon `mem:` journal block over every night since #3601, and decide rows `2026-10-18-the-post-child-climb-plateaus-inside-the-documented-band` and `2026-10-18-most-of-the-climb-sits-outside-glibc-arena-accounting`.
**bird:** wren
**branch:** claude/memnights-wrn
**worktree:** ../wt-memnights-wrn
**doc-search:** `daemon mem block rss climb plateau band glibc arena outside`
**stopping-point:** The glibc row reads `answered #PRNUM`. The plateau row stays OPEN, for the reason in part 2.
**next-step:** The plateau row needs one more night with no daemon restart between 22:00 and 10:00. Only the owner can hold the morning restart.
**done-when:** `git show origin/main:briefs/RESIDUE.md` shows the glibc row as `answered #PRNUM`.

## 1 · Population

Wren read the `tepna-capture` journal read-only on 2026-10-27, from 2026-10-17 00:00. There was no deploy and no restart. Each night is the daemon PID that held 22:00.

| night | span of that PID | peak VmRSS (MB) | ΔRssAnon (MB) | Δglibc system + mmap (MB) | Δpymalloc held (MB) | residual (MB) |
|---|---|---|---|---|---|---|
| 10-17 | 21:21 → 10:25 next day | 289.5 | 176.9 | 89.4 | not logged | 87.5 |
| 10-18 | 22:06 → 05:59 | 231.8 | 127.2 | 72.3 | not logged | 54.9 |
| 10-19 | 21:59 → 06:07 | 278.5 | 169.8 | 90.9 | not logged | 78.9 |
| 10-20 | 21:05 → 06:44 | 286.6 | 150.0 | 72.6 | 73.0 | 4.4 |
| 10-21 | 22:03 → 05:59 | 249.1 | 153.4 | 76.6 | 89.0 | −12.2 |
| 10-22 | 20:04 → 06:29 | 271.1 | 129.7 | 59.3 | 70.0 | 0.4 |
| 10-23 | 22:31 → 05:59 | 217.3 | 126.7 | 41.0 | 86.0 | −0.3 |
| 10-24 | 22:23 → 07:00 | 263.0 | 167.9 | 79.6 | 95.0 | −6.7 |
| 10-25 | 20:24 → 06:29 | 286.0 | 104.4 | 38.1 | 66.0 | 0.3 |
| 10-26 | 22:02 → 06:42 | 274.6 | 191.1 | 94.7 | 103.0 | −6.6 |

The deltas run from the first to the last `mem:` line inside 22:00 → 08:00. The residual is ΔRssAnon minus the glibc and pymalloc columns. VmSwap read 0 kB on every line that logged it. The pymalloc segment arrived with #3733, from the 10-20 night on.

## 2 · Verdicts

**Glibc row — answered.** The criterion comes from the row's own words: the growth outside glibc must have a named population for the majority of it. On all 7 nights with the pymalloc segment, CPython's arena growth covers 94 % or more of the growth outside glibc. The residual is between −12.2 and +4.4 MB. CPython maps its arenas itself, so `mallinfo2` cannot see them. The block names that population now.

**Plateau row — stays OPEN.** The band half holds. The peak stays at or below 289.5 MB on 10 of 10 nights, under the 313 MB top.

The plateau half has 1 eligible night of 10, and that is the row's own 10-17 night. A systemd stop between 05:59 and 07:00 ends each of the other 9 nights. In the last hour of those 9 nights, VmRSS moved between −13.4 and +16.7 MB. Those nights neither show a plateau nor rule one out.

```json
{"schema":"tepna.verdict/1","gate":"box-mem-nights-since-3601","status":"UNDERPOWERED","population":{"checked":1,"eligible":10,"excluded":9},"criterion":{"name":"restart_free_nights_showing_a_plateau","threshold":2,"unit":"nights","direction":"gte"},"result":{"peak_max_mb":289.5,"band_top_mb":313,"nights_inside_band":10,"pymalloc_share_min_pct":94,"residual_mb":[-12.2,4.4]},"evidence":["journalctl -u tepna-capture | grep 'INFO mem:'","capture-host/capture.py:mem_log_line","#3733"],"reason":"9 of 10 nights end in a 05:59-07:00 restart, so only the 10-17 night tests the plateau","producedBy":{"tool":"journalctl (read-only, Wren)","commit":"6644866c0"},"at":"2026-10-28T00:45:00Z"}
```

## Open questions

- Owner: hold the morning restart for one night, so that a second night can test the plateau.
