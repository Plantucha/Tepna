---
bump: patch
type: added
nodes: []
brief: REFERENCE-GUIDE-AUDIT-BRIEF.md
---

Gates in-page link integrity across the reference guides: every `href="#x"` must resolve to an `id` in
the same guide, and no guide may carry a duplicate `id`. Measured clean when it landed — 128 distinct
anchors, 284 ids, zero dead, zero duplicated across 7 authored guides plus the generated EEGDex one —
so this is a ratchet over a verified state rather than a fix. A dead anchor fails silently (the browser
scrolls nowhere); a duplicate is nastier, because the link still works and lands on the wrong copy.
Mutation-verified both ways. The external-DOI half of the same done-when is left explicitly ungated:
the suite takes no network, so a resolving DOI is only checkable by a human, and a gate named "zero
dead links" that quietly checked only the internal ones would be the borrowed-scope dishonesty the
neighbouring gates exist to remove.
