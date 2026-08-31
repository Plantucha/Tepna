<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The mutation gate's refusal now names the test that caused it, instead of only that one did.

`clean_run_seconds` runs the baseline with `capture_output=True` and **discarded the report**,
returning only `(seconds, False)`. Downstream that surfaced as
`no budget: the clean run did not pass, so its duration measures nothing`, and from there as
`mutate-diff: REFUSING`.

Every one of those messages is *true*, and none of them is *actionable*. The failure is almost always
a test that cannot pass inside mutmut's scratch tree — a COPY, not a repo — and the remedy is a
`DESELECTED_TESTS` entry, which cannot be written without the node id. Three CI runs and a local
reproduction went into identifying a test that the failing run had already named to itself and thrown
away.

On failure the baseline now prints the `FAILED`/`ERROR` lines (capped at 20). When there are none it
prints the tail instead, with a note saying so, because an empty list there means a **different**
failure — a collection error, a bad import, a missing plugin — and printing nothing would imply
nothing was wrong.

Both branches verified against planted failures rather than assumed: an assertion failure reports
`FAILED tests/…::test_that_fails - AssertionError: planted` at exit 1; a syntax error reports
`ERROR collecting tests/…` at exit 2.

Pinned structurally on the function via `ast`, not a substring — `r.stdout` and `returncode` appear
elsewhere in the module, so an `in src` check would pass while this function stayed silent.
