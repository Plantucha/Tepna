<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — the supervised-restart trigger, re-measured over the whole retention

**state:** DONE
**unit:** Re-measure the crash-loop trigger of row `2026-10-18-supervised-restart-trigger-has-never-fired-over-the-whole-retention` on the capture box, read-only, and close the row.
**bird:** wren
**branch:** claude/restarttrig-wrn
**worktree:** ../wt-restarttrig-wrn
**doc-search:** `supervised restart crash-loop trigger never fired marker store journal retention`
**stopping-point:** `briefs/RESIDUE.md` — the row reads `answered #4025`
**next-step:** None. Kestrel sequences the PR. The unit owes no deploy and no restart.
**done-when:** `git show origin/main:briefs/RESIDUE.md` shows the row with the state cell `answered #4025`.

## Verdict

The trigger did not fire once over the whole journal retention. The row's conclusion holds, and the row closes as a measurement.

| measure, read-only on the capture box, 2026-10-27 | value |
|---|---|
| journal retention | 2026-09-06 18:46 → 2026-10-27 19:47 (51 days) |
| `tepna-capture` journal lines | 1,693,356 |
| lines `crashed — restarting` from that unit | 0 |
| the same text anywhere in the journal | 2, both from `tailscaled` |
| distinct daemon PIDs in the unit journal | 437 |
| `tasks` key in the daemon's `status.json` | absent |

1. The log text comes from `keep_running` at `capture-host/capture.py:13173`. The grep reads that text.
2. The 2 journal-wide hits are self-matches. `tailscaled` logged the command text of two earlier ssh measurements of this row, and that text holds the pattern.
3. `keep_running` creates the `tasks` key on the first crash at `capture.py:13176`. Its absence agrees with 0 events.
4. Each of the 437 daemon starts resets the in-memory state that a crash restart resets. PR #3681 keeps the spool day across a restart.

```json
{"schema":"tepna.verdict/1","gate":"box-supervised-restart-trigger","status":"PASS","population":{"checked":1693356,"eligible":1693356,"excluded":0},"criterion":{"name":"crash_restart_lines","threshold":0,"unit":"lines","direction":"lte"},"result":{"crash_restart_lines":0,"self_match_lines":2,"daemon_pids":437},"evidence":["journalctl -u tepna-capture --no-pager | grep -c 'crashed — restarting'","capture-host/capture.py:13173"],"reason":null,"producedBy":{"tool":"journalctl (read-only, Wren)","commit":"ef4eb7605"},"at":"2026-10-27T23:50:00Z"}
```

## Open questions

None. Heron reached the same reading at board #1324.
