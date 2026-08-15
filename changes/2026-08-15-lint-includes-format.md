---
bump: patch
type: fixed
brief: none
---

**`npm run lint` is now `biome ci` — it checks formatting, which it did not.**

`npm run lint` ran `biome lint`, which does **not** check formatting, while the required `biome` status
check runs `biome ci` (format **+** lint floor). So a file could be clean locally and red CI, and
because `npm run check` chains `lint`, **the full local gate inherited the same blind spot** — CLAUDE.md
calls `npm run check` *"exactly what CI gates on"*, and for formatting it was not.

Measured on this repo's own tree the same day: `npm run lint` exited **0** on two files that
`biome format` rejected. The failure is invisible by construction — the weaker command passes, so
nothing looks wrong (CONTRIBUTING.md §"a locally weaker command than CI's reports green and tells you
nothing", where this exact row was already documented as a known gap).

**Whole-tree, not `--changed`, and that was measured rather than assumed.** With a format-only violation
present, `biome ci --changed --since=origin/main` exited **0 both untracked and staged** — git does not
report a new file as "changed" in the way `--changed` consumes, so the local run misses precisely the
new file a PR is most likely to add. Whole-tree `biome ci` caught it (exit 1). CI's PR job keeps
`--changed` deliberately (§B2: never demand a legacy file be reformatted because a sibling PR touched
it); that argument is about *other people's* files and does not apply to a pre-flight you run on your own
tree.

**Safe today, verified before changing:** clean `origin/main` passes whole-tree `biome ci` at exit 0, so
this reds nobody on arrival.

**Mutation-verified in both directions**: clean tree → 0 · format-only violation → 1 (was 0) · the
retired command still → 0, proving the delta is exactly the fix · restored → 0.

The old behaviour survives as **`npm run lint:only`**, for isolating a lint error from a format one.
`CONTRIBUTING.md`'s two rows describing the old semantics are updated; the known-gap row is kept and
struck through, because the *shape* is the lesson rather than the instance.
