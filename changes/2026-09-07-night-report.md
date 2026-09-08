<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: none
---
**A night either happened or it did not, and the only way to know was to open the box and read four
artifacts.** The morning report writes one file beside each night and sends one line:

    2026-09-06: ring 9.7 h, 0 spans, back-check ok, sniffer coverage unknown ?

**A separate unit on its own timer; the daemon is not touched.** `tepna-capture` holds the BLE links
all night, so a reporting bug must not be able to cost a recording — nothing here runs inside it and
nothing here can restart, block or slow it. It reads what the night left behind.

🔴 **Every missing input is the word `unknown`, never a number.** An absent QC summary, an absent
back-check, an absent sniffer verdict: each renders as `unknown`, not `0`, not `--`, not a quietly
dropped field. The distinction the file is built around is `class_b: []` (the back-check ran and found
nothing → `ok`, 0 spans) versus **no `class_b` key at all** (it never ran → `unknown`, no count) — and
that is not hypothetical: the real 2026-09-06 summary on the box carries no such key, because it was
written by a daemon predating the back-check. The tests use that exact shape.

The sniffer glyph follows the same rule: `✓` only for a pass, `✗` for a fail, and **`?` when no audit
ran** — a reader must be able to tell "clean" from "we did not look" at a glance.

🔴 **The webhook token appears in nothing the report produces.** `night_report.py` never receives the
URL (asserted by a source scan in its own tests), so the report file cannot carry it even by a later
mistake; delivery happens in one process that hands the URL straight to `alerts.Notifier`. The script
test drives a real send FAILURE — the path where a careless error message would echo the URL — and
asserts neither the token nor its host reaches stdout, stderr, the journal or the file.

Alerts disabled is a **success**: the report was still written, and exiting non-zero for a
configuration the operator chose would leave a permanent red in `systemctl --failed`. Only a
configured send that fails is an error (exit 5); no night to report is exit 4.

⚠️ The units are **user-scope and say so**. The sibling sniffer unit carries `After=`, `User=` and
`Group=` lines that are silent no-ops under a `--user` install; these carry none, and they are
deliberately kept OUT of `check-system-files.sh` — a MANAGED row for a file that never lands in
`/etc/systemd` would report it absent every run, forever.
