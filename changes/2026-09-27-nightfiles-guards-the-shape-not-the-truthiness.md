---
bump: patch
type: fixed
brief: none
---

`nightFilesFor` now guards the **shape it needs** instead of truthiness, so no index entry of any shape
can yield a non-array or throw. This closes the class behind #3173 rather than the one instance.

**Measured on `origin/main`**, feeding a wrong-shaped entry to a node column and to a branch:

```
OxyDex = boolean-true         -> NOT-AN-ARRAY: undefined
OxyDex = string               -> NOT-AN-ARRAY: undefined
OxyDex = object-without-files -> NOT-AN-ARRAY: undefined
OxyDex = files-not-an-array   -> NOT-AN-ARRAY: string        ← would be iterated per CHARACTER
ECGDex = true, node '3 corner hat' -> THROWS TypeError: … is not iterable
```

**The branch case is the one the fix would have missed.** Every lookup read `n.X ? n.X.files : []`, which
guards ABSENCE and admits anything truthy. In the fallback that escaped as `undefined`; inside a branch
`[...undefined]` **throws**, and a throw in `openNight` lands in an unhandled rejection with no toast —
exactly how the "PAT fused" pill came to do nothing. So the guard belongs on every node lookup, not only
on the fallback.

One helper (`nodeFileList`) does every lookup, and the files and the REASON come out of one function
(`nightFiles`) with `nightFilesFor` as its projection — the same single-source discipline as
`ppmContribution`/`effectivePpm`, so the value and its explanation cannot drift. A reason is returned only
when it is TRUE of the input: an empty night holding a correct node record still gets `openNight`'s own
"nothing to load", never a borrowed shape complaint (§∅ — a named reason, not a borrowed one). A derived
tool that reaches the fallback is named as a **missing branch**, because that is a code defect rather than
a thin night.

**A second §∅ case the plant found, in this change's own first draft:** a `.files` array holding
non-strings was filtered to empty and reported as "nothing to load" — our drop presented as the night's
absence. The usable paths are now handed over and the drop is named with its count. Its stated limit:
`openNight` surfaces `reason` only when nothing loads, so a PARTIAL drop loads the good paths with the
reason unshown. That gap is written down rather than hidden.

**Control is an EQUIVALENCE, not a re-assertion:** `origin/main`'s `nightFilesFor` and this one are run
side by side over a real night built through `ni.night_entry`, and must return the identical list for every
`NODES` column and every derived tool. The guard is meant to change what happens to wrong shapes and
nothing else, and running both versions is the cheapest way to say so.
