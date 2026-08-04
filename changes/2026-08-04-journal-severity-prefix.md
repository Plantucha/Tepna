<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: VIGIL-COEXISTENCE-AND-RANGE-2026-07-26-BRIEF.md
---

Express log severity to journald, so `journalctl -u tepna-capture -p warning` stops returning clean on
a box that logged warnings (VIGIL-COEXISTENCE-AND-RANGE §1, out-of-suite `capture-host/`).

systemd assigns ONE priority to a service's whole stdout stream, so with a bare `logging.basicConfig`
every line — INFO, WARNING, ERROR — landed at priority 6. Measured on the box 2026-07-26: 33
application warnings in one daemon lifetime while `-p warning` returned nothing, and the overnight
watch logged "zero warnings" five times because of it. The severity was printed but never expressed,
so every standard operator tool (`-p warning`, `-p err`, journald alert rules, log-shipping filters,
`systemctl status`'s red-line extraction) came back clean.

Built as §1 specifies: a leading `<N>` syslog prefix, parsed by systemd because `SyslogLevelPrefix=yes`
is the default — no unit change, no new dependency. `python3-systemd`'s `JournalHandler` was
deliberately not taken; it would add a dependency to an appliance whose SOUP list is intentionally
empty. The prefix is applied only when systemd's own `JOURNAL_STREAM` is set, not on `isatty()`: a run
redirected to a file is equally not-a-TTY and prefixing there would corrupt the file.

This also unblocks the rest of its own brief — §"Sequencing" notes that until §1 lands, every other item
is measured through an instrument that cannot see warnings.

Verified by re-applying the defect, five mutants all killed: never-prefix (the original bug),
WARNING→5, always-prefix (console leak), call site reverted to `basicConfig`, and `force=True`
reintroduced. That last one is a bug this work introduced and the suite caught: `force=True` removes
every existing root handler, which under pytest is `caplog`'s, so four tests driving `main()` saw an
empty `caplog.records` while the logging worked perfectly. A test now states that property directly
rather than leaving it to be caught incidentally.

Field confirmation on the box (`journalctl -p warning` returning the link-error lines) still owed — it
needs a deploy.
