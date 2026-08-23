---
bump: patch
type: fixed
brief: none
---

`capture-host/tools/mutate_diff.py` — the ORPHANED-entry warning named two causes ("the line moved, or
the entry is malformed") and fired for a third it never named, which is the **common** one: equivalence
entries are filtered to the **modules** a diff touched, but mutants are generated only for the
**functions** it changed. So an entry filed against any other function in the same module matches
nothing — forever, on every future PR touching that file, through no fault of the entry.

Measured: two `load_rows` entries fired on a PR that changed only `make_row`.

⚠️ **Re-keying them, the obvious reading of the warning, would have damaged correct data** — their
recorded `before` matches the current source **verbatim** at `oxy_inventory.py:152`. Nothing had moved.
That is the warning actively misdirecting the reader, not merely being noisy.

The discriminator needs no scope plumbing: if the entry's `before` text is still present in the module,
the line did not move and the entry is out of scope for this diff rather than stale. Controlled over
five cases — both real entries classify `out-of-scope`, while a moved line, a wholly stale entry, and a
malformed entry carrying no `key` at all each stay ORPHANED, so nothing that needs attention is
silenced.

A warning nobody can act on is the "trains people to ignore it" death this file's own header names —
the same reasoning that has equivalent mutants recorded with a probe rather than left permanently red.
