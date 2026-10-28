<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff: the daemon RSS climb across a night

**state:** DONE
**unit:** Decide row `2026-09-23-daemon-rss-climbs-across-a-night-and-is-released-only-by-restart` from box measurements.
**bird:** wren
**branch:** claude/rssclimb-wrn
**worktree:** ../wt-rssclimb-wrn
**doc-search:** `daemon rss climbs across a night released only by restart qc child`
**stopping-point:** The row reads `answered #4042`.
**next-step:** None for this row. The plateau question stays with row `2026-10-18-the-post-child-climb-plateaus-inside-the-documented-band`.
**done-when:** `git show origin/main:briefs/RESIDUE.md` shows the row as `answered #4042`.

## 1 · What the row asked

The 2026-09-23 night climbed from 368 MB to 842 MB. That is about 2.7 times the documented steady state of 241 to 313 MB. PR #2936 moved the QC scan into a child process after that night. The row named one test. Suppose the climb after #2936 stays inside the band. Then the QC working set explains the 842 MB.

## 2 · Population

Wren read the `tepna-capture` journal on vigil read-only on 2026-10-28 at 00:44 EDT. There was no deploy and no restart. Each night is the daemon PID that held 22:00. The window runs from 22:00 to 08:00 or to the end of that PID.

| night | PID span | `mem:` lines | first VmRSS (MB) | peak VmRSS (MB) | peak at | ΔRssAnon (MB) |
|---|---|---|---|---|---|---|
| 10-17 | 21:21 → 10:25 next day | 599 | 112.5 | 289.5 | 07:59 | 176.9 |
| 10-18 | 22:06 → 05:59 | 473 | 77.8 | 231.8 | 03:45 | 127.2 |
| 10-19 | 21:59 → 06:07 | 487 | 97.7 | 278.5 | 04:43 | 169.8 |
| 10-20 | 21:05 → 06:44 | 524 | 136.5 | 286.6 | 06:44 | 150.0 |
| 10-21 | 22:03 → 05:59 | 477 | 78.9 | 249.1 | 05:34 | 153.4 |
| 10-22 | 20:04 → 06:29 | 509 | 141.4 | 271.1 | 05:50 | 129.7 |
| 10-23 | 22:31 → 05:59 | 448 | 78.5 | 217.3 | 04:59 | 126.7 |
| 10-24 | 22:23 → 07:00 | 517 | 78.9 | 263.0 | 06:58 | 167.9 |
| 10-25 | 20:24 → 06:29 | 509 | 167.0 | 286.0 | 06:19 | 104.4 |
| 10-26 | 22:02 → 06:42 | 520 | 79.2 | 274.6 | 06:35 | 191.1 |

The 10-27 night was still in progress at the read. It held 243.2 MB at 00:43 after 164 lines, so it does not count.

## 3 · Verdict

The criterion comes from the row: the peak after #2936 stays at or under the 313 MB band top. All 10 nights pass. The highest peak is 289.5 MB, against 842 MB on 2026-09-23.

A restart between 05:59 and 07:00 ends 9 of the 10 nights. That restart does not hide a large climb. The 2026-09-23 night already held 829 MB at 04:04, and every night here ran past 05:59. The 10-17 night ran to 10:25 with no restart, and it peaked at 289.5 MB.

A smaller climb persists, at 104 to 191 MB of anon growth per night. PR #4030 named that population: CPython's pymalloc arenas cover 94 % or more of the growth outside glibc on 7 of 7 nights. So the magnitude question closes, and the climb has a named owner.

```json
{"schema":"tepna.verdict/1","gate":"box-rss-climb-after-2936","status":"PASS","population":{"checked":10,"eligible":10,"excluded":0},"criterion":{"name":"peak_vmrss_after_2936","threshold":313,"unit":"MB","direction":"lte"},"result":{"peak_max_mb":289.5,"peak_min_mb":217.3,"nights_inside_band":10,"reference_peak_2026_09_23_mb":842},"evidence":["journalctl -u tepna-capture | grep 'INFO mem:'","capture-host/capture.py:mem_log_line","#2936","#4030"],"reason":null,"producedBy":{"tool":"journalctl (read-only, Wren)","commit":"22974e0d2"},"at":"2026-10-28T04:44:17Z"}
```

## Open questions

- The plateau half stays with the row named in the next step. It needs a night with no morning restart, and only the owner can hold that restart.
