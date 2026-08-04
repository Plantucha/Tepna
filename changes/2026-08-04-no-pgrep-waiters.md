<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: none
---
CLAUDE.md §👥.4 — ban `until ! pgrep -f "<cmd>"` waiters: the loop matches its own command line and waits on itself, and 13 were found deadlocked across 5+ sessions.

The gates here run for minutes, so every session eventually writes a "tell me when it's done" loop. The obvious one never exits, for two independent reasons — and **the first needs no other session to be running at all**: the waiter runs as `bash -c '… until ! pgrep -f "pytest -q --cov" …'`, so its own `/proc/<pid>/cmdline` contains the pattern it searches for. Measured 2026-08-04 with **zero** pytest processes on the box, that pattern matched **six** processes, every one a waiter blocked on itself. The second reason is §1's world: several sessions run the same gate commands at once.

Found in the wild the same day: **13 deadlocked shells across 5+ sessions**, each spinning a `sleep` loop forever, each meaning a session never received the notification it was waiting for — two had been waiting on a `mutate_diff.py` run and a `verify-fixtures` run that could never report. They are invisible because a hung waiter looks exactly like a slow gate.

The section records that the `[p]ytest` bracket trick is **not** a fix — it defeats self-match but was tested here and still matched, because other sessions carry the unbracketed string — and gives three replacements in order: don't poll (background task + harness notification), own the PID (`kill -0 "$PID"`, which also yields the exit code `pgrep` structurally cannot), or wait on a `$$`-unique sentinel file.

Paired with the mirror-image trap from the same hour: `pytest … | tail -20` reports **tail's** exit code, so a coverage run that FAILED at 91.19 % printed `EXIT=0` and read as green. Capture `$?` of the command itself before any pipe. And identify your own processes by a token you put in the command line, never by a session id that appears only in an output path — that under-reports for the same reason `pgrep -f` over-reports.

Docs-only; no bundle, `manifestHash` or fixture is touched.
