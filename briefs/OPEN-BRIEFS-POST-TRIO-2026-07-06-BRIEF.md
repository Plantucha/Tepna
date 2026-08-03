<!--
  OPEN-BRIEFS-POST-TRIO-2026-07-06-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE (redirect stub — the snapshot was archived 2026-08-03, owner-sanctioned) · **Created:** 2026-07-06 · **Moved-to:** [`docs-archive/OPEN-BRIEFS-POST-TRIO-2026-07-06-BRIEF.md`](../docs-archive/OPEN-BRIEFS-POST-TRIO-2026-07-06-BRIEF.md)

# ➡️ Moved — the open-brief snapshot is archived

**The 2026-07-06 snapshot now lives at [`docs-archive/OPEN-BRIEFS-POST-TRIO-2026-07-06-BRIEF.md`](../docs-archive/OPEN-BRIEFS-POST-TRIO-2026-07-06-BRIEF.md).**

## For the current open-brief state, use [`DOCS-INDEX.md`](../DOCS-INDEX.md)

Its **Role** column carries each brief's live status (`Brief *(IN-PROGRESS 2026-08-02)*`, `Brief *(DONE
2026-07-23)*`, …), and `CLAUDE.md` §📌 already makes keeping it in sync part of every status flip. It is the
dashboard; this file was a second one.

You can also derive the state from the tree directly, which cannot go stale at all:

```sh
grep -L "Status:.*DONE" briefs/*.md          # every brief not stamped DONE
grep -h -m1 -oP '^\*\*Status:\*\*\s*\K\S+' briefs/*.md | sort | uniq -c   # the tally
```

## Why it was archived

A `REFERENCE (living)` stamp is a promise to re-verify, and this one sat at `last-verified: 2026-07-06` for
four weeks while roughly 70 briefs changed status underneath it. A stale snapshot of *which work is open* is
worse than no snapshot: a reader trusts it and picks up something already finished, or misses something that
started after it was written. Two sources of truth for the same fact is the problem; `DOCS-INDEX.md` is the
one with a gate behind it.

This is the `CLAUDE.md` §📌 sanctioned relocation, done deliberately with this stub so existing
cross-references still resolve and the filename stays frozen.
