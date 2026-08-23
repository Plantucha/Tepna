---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

`mutate_diff.py` CRASHED instead of reporting when an equivalence entry lacks a `key`: `classify()`
reads it with `.get("key", "")` — so a keyless entry is tolerated and classified orphaned — while the
reporter subscripted `e['key']` directly and raised KeyError. The two halves disagreed about whether
a malformed entry is survivable.

Reachable and fired on #1681. This file matches on the whitespace-normalised diff (`diff_key`), but
the JS sibling's entries are shaped `{line, op, before}` and 422 of 424 entries carry that shape;
they never crash only because entries are filtered to the modules the diff touches. The landmine
waits for the first PR that both adds a Python-side entry and changes that module.

A gate that crashes reports NOTHING — no survivor list, no verdict, a red check whose log is a
traceback. Worse than the orphan it was describing. The reporter now names what the malformed entry
actually carries.

Also reformats this session's two `oxy_inventory.py` entries from the JS shape to the `key` shape
they should have had.
