---
bump: patch
type: fixed
brief: none
---

The updater decided whether a restart was owed by **string-comparing an abbreviated sha against a full
one**. `/api/version` reports what `build_id.probe` collected — `git rev-parse --short HEAD`, an
abbreviation whose length is git's choice, measured **12 characters on 2026-09-19 and 8 on 2026-09-23 on
the same box** — while `$after` is a full 40-character `rev-parse`. So `[ "$running_sha" != "$after" ]`
was true for every commit that has ever existed, and `restart_owed` could never reach 0 through that
branch.

Measured live on vigil 2026-09-23, with the daemon running exactly the disk code:

```
restart still OWED from an earlier tick — the daemon is on beee0537, disk is at beee05377fc3
$ git -C /opt/tepna rev-parse HEAD
beee05377fc39a9b2971838de6e5bf0363adbb31
```

**544 such lines on the night of 09-22, 104 of them naming a sha that is a prefix of the disk sha** — the
same commit printed twice at two truncation lengths. 277 on 09-19, 137 on 09-18.

⚠️ **It caused no needless restart, and the PR says so.** The content gate downstream diffs
`running_sha..after -- capture-host/`, git resolves the abbreviation there perfectly well, a same-commit
range is empty, and that branch sets `restart_owed=0`. The outcome was right — **produced by a rescue
rather than by the comparison being right**, which is the reason to fix it at the comparison: a second
gate silently absorbing the first one's false positive is accidental correctness, and narrowing that
gate's empty-delta branch even slightly would turn the false debt into a real restart.

What it did cost is a false line at a two-minute cadence, in the unit whose own header forbids exactly
that forty lines above: *"IT MUST NOT SPEAK WHEN THERE IS NOTHING TO SAY … a single line per tick is 720
lines a day in the journal of the unit whose legibility §4 is about."*

The comparison now resolves the abbreviation **in the checkout** (`rev-parse --verify --quiet
<sha>^{commit}`) instead of string-matching. An abbreviation naming a commit the checkout has becomes that
commit's full sha; one it cannot name, or an ambiguous prefix, stays as it is and still reads as owed —
the honest answer, since a daemon running code this checkout cannot name is exactly the case a restart is
for.

⚠️ **A test already covered "daemon reports the current sha ⇒ not owed" and passed throughout**, because
it fed a FULL sha where production feeds `rev-parse --short`. The new plant is parameterised over both
observed abbreviation lengths *and* git's own current answer, so it cannot pass by agreeing with whichever
length happens to be in force; a second test pins the fail-closed case.
