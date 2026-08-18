<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite]
brief: RUN-POLAR-MUTATION-PASS-2026-08-08-BRIEF.md
---
Closes §6's fourth Done-when item, which had been outstanding since 2026-08-08 while its successor
brief (`RUN-POLAR-MUTATION-STOP-HERE`) was already marked DONE.

**The rule, now §1's eighth entry** — the section was titled *"Seven ways a run fails while looking
fine"* and is retitled accordingly. mutmut names a mutant `x` + the function name **verbatim**, so the
underscores are load-bearing:

| function | mutant name | why |
|---|---|---|
| `_now` | `x__now__` | **two** — the function itself starts with `_` |
| `run_polar` | `x_run_polar__` | **one** |

`--only 'capture.x__run_polar__*'` therefore matches nothing. Copying the fleet brief's
`capture.x__now__*` example is what produces the wrong form, because that example is correct *for its
own function*.

**It belongs in §1 rather than §2 because of how it fails.** mutmut asserts *"Filtered for specific
mutants, but nothing matches"*, `tools/mutate.py` surfaces it as `rc=1` with a truncated traceback, and
the results dump then reads **`not checked` for every mutant**. That is the **third** distinct cause of
that same output — a mid-run read, a poisoned baseline, and a filter that matched nothing all print an
identical all-`not checked` dump, and the dump cannot tell you which you have. `--list` first is the
only cheap discriminator. It cost a 978-second run.

⚠️ **The item's second half is left OPEN, not ticked.** It also asked that the text-anchor kill-checker
be retired repo-wide. No tool under `tools/` or `capture-host/tools/` still emits `SKIP anchor` — which
is consistent with retirement and equally consistent with it never having lived there. Ticking on
absence of evidence is the failure this runbook catalogues, so it stays open with the reason recorded.

Also noted for the owner: `RUN-POLAR-MUTATION-PASS` is **IN-PROGRESS** while the brief that *follows*
it — `RUN-POLAR-MUTATION-STOP-HERE`, titled *"the case for stopping there"* — is **DONE since
2026-08-15**, and neither carries the `Supersedes:`/`Superseded-by:` pair CLAUDE.md §📌 requires when
one brief replaces another. I have not changed either status: whether STOP-HERE supersedes PASS or
merely follows it is a judgement about the work, not about the paperwork.
