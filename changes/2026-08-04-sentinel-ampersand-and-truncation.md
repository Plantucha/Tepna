<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: none
---
CLAUDE.md §👥.4 shipped a copy-paste snippet that blocks — the `&` was missing — and §4b generalises the truncation trap beyond pipeline exit codes.

**The `&` fix.** §4's replacement (3) was written as `( pytest … ; echo "EXIT=$?" ) > /tmp/mine.$$.log 2>&1` with no `&`, so the first line runs **synchronously**: the sentinel is already in the file before the loop starts, and the loop exits on its first check. Measured **0 polls**. It still prints the correct exit code, which is precisely why it survived review — you get blocking execution followed by a no-op loop, in the one section whose entire point is how to wait *without* blocking. With the `&` the same test polls 3 times and reports the same `EXIT=7`. Caught in review of #825, after it merged.

**§4b — the general form.** The paired trap was framed as a pipeline-exit-code issue. That is one instance, not the class. Two from 2026-08-04 in different tools: `pytest … | tail -20` reports **tail's** exit code (a run that FAILED at 91.19 % printed `EXIT=0`), while `gh pr checks <N> | tail -15` has **no exit-code problem at all** — it simply cut two failing checks out of the listing, so a failing PR looked like it was merely hanging. The second is why the rule must be stated generally: **if you truncate, you must know the discarded part cannot change the verdict**, and for a gate summary it always can. So: never read a verdict off a tail — aggregate (`grep -c`, `--jq 'group_by(.bucket)'`, a `TOTAL`/`Required` line) and tail afterwards for detail only.

Names the shared shape of the family (`grep -q` exit codes, `npx` no-op greens, a child's JSON truncated through a pipe): the check ran, and reported success about something it never examined.

Docs-only; no bundle, `manifestHash` or fixture is touched.
