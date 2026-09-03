<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The refusal reported an assertion's headline and dropped its body — which is the half that says what failed.

#1995 made a refusing clean run name the failing test. It printed pytest's `FAILED …` summary line,
which carries only the **first** line of an assertion message. For the test that is actually blocking
`capture.py`, that line is:

    AssertionError: shellcheck findings:

…and the findings themselves live in the body, in the `FAILURES` section. So the report showed a
headline with nothing after it.

**That emptiness was then read as evidence the tool had printed nothing**, and a diagnosis started down
a branch built on it — was shellcheck invoked with no files, did it exit silently. Neither: shellcheck
with zero arguments exits 3 and prints usage, and on a missing file exits 2 and says so. The tool was
never silent. **The reporter was truncating.**

A reporter that drops the body is worse than one that reports nothing, because it manufactures a
confident wrong conclusion out of its own filtering — the [[queries-that-examined-nothing]] shape turned
on the diagnostic itself.

It now prints up to 40 non-blank lines of the `FAILURES` section after the summary. Verified against a
plant whose detail lines exist only in the body, and pinned on the function via `ast` (a substring check
would pass while this function still printed only the summary).
