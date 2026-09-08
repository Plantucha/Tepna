<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: none
---
**The morning report's mutation survivors, worked rather than excused: 26 → 0.** Twelve were real
gaps — inputs the report can actually receive that no test had handed it — and the most important is
that an `AIR AUDIT:` line carrying a word the parser does not recognise (`pending`, a truncated write,
a future format) rendered as **`✗`** instead of **`?`**, reporting a failed audit for one nobody could
read. That is the same class of statement as a number for an absence, which is the thing this module
exists to prevent, so it now has a test. Also killed: `main()` called with its third argument — the
sniffer directory, the way the deployed script *always* calls it, and nothing exercised it end to end
— a back-check block whose `clip` is not a list being counted as a clipped span, the newest-verdict
pick (a two-file fixture cannot test it: `names[-1]` and `names[1]` are the same file), and
**"AIR AUDIT: NOT OK" reading as a pass**.

**Seven more were code removed rather than excused.** `partition()` replaces `split(sep, 1)` — it
means "at the first occurrence" with no maxsplit number that can be wrong, and takes four mutants with
it; a dead pre-assignment went; and `_SPO2_HZ = 1.0` with `rows / _SPO2_HZ / 3600.0` was a
divide-by-one no input could ever distinguish, now `_SPO2_ROWS_PER_HOUR = 3600.0`. A no-op that must
be excused forever is worse than one deleted once.

**Eight are excused, probed rather than asserted** — six `encoding="utf-8"` (untestable on a UTF-8
host, and the argument is still worth keeping; same class and reasoning as `oxy_inventory.py`'s four)
and two falsy-value stores whose consumers cannot tell them apart. Each entry records the battery
that was actually run.

⚠️ **`tepna-report.sh` gains a `TEPNA_PYTHON` seam, and it is what makes the script mutation-testable
at all.** The mutation tool rewrites `night_report.py` into a tree under `/tmp`; the script
re-executes that module as a subprocess, so inside the tree `$here/.venv` does not exist, the fallback
picked a system `python3` without `mutmut`, and every mutant died on import. The gate correctly
REFUSED — "a gate that cannot see must not report green" — rather than reading an empty survivor list
as a clean sweep.
