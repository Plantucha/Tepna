<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff: the live ring envelope ends at its last row

**state:** IN-PROGRESS
**unit:** Fix row `2026-10-27-the-live-ring-envelope-ends-a-file-by-one-episodes-row-count`.
**bird:** wren
**branch:** claude/ringend-wrn
**worktree:** ../wt-ringend-wrn
**doc-search:** `live ring envelope end_time_ms derived from row count resume`
**stopping-point:** The draft PR is open, and `capture-host/check.sh` exits 0 on it.
**next-step:** Kestrel undrafts the PR after a full green run.
**done-when:** `git show origin/main:briefs/RESIDUE.md` shows the row as `fixed #PRNUM`.

## What main already did

PR #4019 fixed the resume half. A resumed file now reports no start, no count and no end.

## What this PR fixes

The writer did not keep the stamp of its last landed row. So a fresh file still got an end equal to its first row plus the row count. A stall inside one episode adds no row, and the derived end fell short of the last row by the stall.

1. `Spo2CsvWriter` keeps `last_row_ms`, the stamp of the last row that landed.
2. `assemble_live` takes `last_row_ms` as a new optional keyword. The end is that stamp plus one second.
3. Without a last stamp, the envelope reports no end (§∅). The row count no longer makes an end.
4. `duration_check` now carries the observed span between the first and the last row.

## Measurement

I read the SpO2 CSV files of the O2Ring on the capture box. The read was read-only. The window is 2026-09-06 to 2026-10-28, files with two rows or more. The shortfall is the stamp span minus the row count.

| population | files | short by more than 5 s | more than 60 s | more than 600 s | median s | max s |
|---|---|---|---|---|---|---|
| fresh file-sets | 37 | 21 | 7 | 1 | 10 | 712 |
| resumed file-sets | 37 | 36 | 30 | 5 | 350 | 1282 |

On main, the resumed files already report no end. The fresh files are the population this PR changes.

```json
{"schema":"tepna.verdict/1","gate":"ring-envelope-end-shortfall","status":"FAIL",
 "population":{"checked":37,"eligible":37,"excluded":0},
 "criterion":{"name":"fresh_files_short_gt_5s","threshold":0,"unit":"files","direction":"lte"},
 "result":{"fresh_files_short_gt_5s":21,"max_short_s":712},
 "evidence":["capture-host/writers.py","capture-host/acq_evidence_o2ring.py"],
 "reason":"the count-derived end falls short of the last row on 21 of 37 fresh files",
 "producedBy":{"tool":"box-local read of SpO2 CSV stamps","commit":"22974e0d"},"at":"2026-10-28T00:00:00Z"}
```

## Open question

On a resume, the last row is still observed, but the start is not. This PR keeps the resumed end as `null`, as PR #4019 decided.
