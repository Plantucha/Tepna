---
bump: patch
type: fixed
brief: none
---

The §3 crash refusal in `tools/mutate_diff.py` printed its prose and returned an exit code without
calling `emit`, so a run refused for "0 tested mutants" produced no `tepna.verdict/1` object and, with
`--json`, wrote no artifact — a consumer polling that file read the PREVIOUS run's verdict, or nothing,
for a run that refused. It now emits, with the same `decided == 0 ⇒ NOT_RUN else UNKNOWN` split its
three sibling refusals already use, and an AST test asserts that every terminal in `main()` emits so
the class cannot reopen. A stale `--json` artifact is also removed at startup: an absent file says no
verdict was reached, where a stale PASS says something false.
