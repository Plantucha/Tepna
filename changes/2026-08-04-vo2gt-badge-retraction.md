<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: AUDIT-FOLLOWUPS-BRIEF.md
---

Retract the `VO₂ GT` unbadged-row finding from the 2026-08-04 backlog sweep. It was a false positive
and no code change is owed — `PULSE_REGISTRY` is already correct.

`VO₂ GT` is an explicit key of `_META_DENY` in `pulsedex-registry.js:242` — *"Pure metadata /
non-metric rows — never badge even with fallback"* — consulted inside `badgeForLabel` itself
(`if (fallback && !_META_DENY[_norm(label)])`), and gate-pinned at `tests/dex-tests.js:5608`. It is a
user-entered laboratory reference value, an input rather than a node-surfaced measurement, so it sits
correctly with `date` / `source` / `duration`. It is also not the `staging_disagreement` class it was
compared to: that one was absent from its grade map and fell through a `!key` guard silently, whereas
this one is named in an explicit deny list with a comment.

The probe was sound — `badgeForLabel(label, true)`, correct second argument, non-vacuous. The
interpretation was not: an empty return was read as a missing badge without asking whether empty was
intended, and the tell was in the output and hand-waved (4 of the 5 unbadged labels were exact
`_META_DENY` keys, i.e. the scan had rediscovered the deny list). Recorded in §5.3 so a future sweep
does not re-raise it.
