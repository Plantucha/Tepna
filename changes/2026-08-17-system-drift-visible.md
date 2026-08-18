---
bump: minor
type: added
---

**The system-file drift detector has worked since PR #435. Nobody read it for eight days.**
`VIGIL-AUTO-UPDATE-FOLLOWUPS-2026-08-14` §2a **Option C**, owner-signed 2026-08-17.

`check-system-files.sh` detects when the root-owned helpers in `/etc` and `/usr/local/lib/tepna/`
differ from the repo. `nightqc.system_file_drift()` already parses its `--json` and already reaches the
QC summary. **`webmon.py` mentions `system_files` zero times** — so the verdict arrives at the monitor
page and is never drawn. Detection was never the failure; #914's helpers ran eight days behind in a log
nobody opened.

Now a first-class tile on the box-health strip: **red** when helpers have drifted, green when they
match, and —

⚠️ **`null` is DRAWN, not skipped.** `system_file_drift()` returns `null` for every unhappy path (not a
deployed host, script absent, timed out, unparseable), and an **absent tile reads exactly like a clean
one**. "unchecked" is the honest third state. Suppressing it would rebuild the invisibility this option
exists to end, one layer up.

## Why the drift is reported and not repaired

Option A — a root-owned installer pulling `origin/main` — would convert *"root writes when the owner
types a password"* into *"root writes whenever `vigil` asks, from GitHub"*. Its own author declined to
propose it. Option C **preserves the privilege boundary completely**: no new grant, no
root-executes-fetched-code path, `/etc` untouched, sudoers stays a human act.

The measured failure supports that choice — **three of three staleness events were noticed late, not
blocked**. This is the same trade the repo already made elsewhere: *detection you can perform beats
remediation you cannot.* A watcher with no write permission is still a real safety layer.

Monitor-side only; `nightqc` unchanged.
