<!--
  REGEN-CORPUS-PATH-FOLLOWUPS-II-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-08-03 · **Spawned-by:** `REGEN-CORPUS-PATH-FOLLOWUPS-2026-08-03-BRIEF.md` (execution) · **Affects:** `tests/run-tests.mjs`, `tools/build.mjs`, `tools/regen-goldens.mjs`

# Three tools that silently do less than you asked, and a lint whose coverage is an accident

## 1 · The A2 SPDX lint only sees files another gate happened to need

Executing the parent brief added the regen family to `tests/run-tests.mjs`'s source list, and the A2
SPDX lint immediately went red on `tools/regen-ppgdex-goldens.mjs` — a header that had been missing
since the file was written. **Nothing had changed about the file.** What changed was that some *other*
gate needed its text.

That is the finding. `CLAUDE.md` §📜 states the invariant as universal — *"Every authored source file
carries the SPDX header"* — but A2's scope is `readSources()`'s `wanted` list, which exists to serve
source-scan gates. A file is checked for licensing **iff** some unrelated scan happens to want to read
it. Measured now:

| | count |
|---|---|
| `tools/*.mjs` in the tree | 56 |
| `tools/…` entries in the source list | 22 |
| `tools/*.mjs` still missing SPDX | **3** — `make-synthetic-edf.mjs`, `o2ring-finger-roundtrip.mjs`, `o2ring-finger-validate-batch.mjs` |

Three is small; the **shape** is not. A licensing invariant enforced over an arbitrary subset reports
green for the subset and says nothing about the rest — and the parent brief's whole subject was a step
that appears to have run over inputs it never saw.

**Fix:** give A2 its own scope — enumerate authored source files from the tree (the `docs-ledger` group
already does whole-tree inventory, so the machinery exists) rather than borrowing the scan list. Node
lane only; the browser lane cannot list a directory and should SKIP, as `docs-ledger` does.
Add the 3 missing headers in the same pass. **Anti-vacuity leg required:** the enumeration must be
asserted non-empty and to include a known file, or a bad glob turns the lint into a no-op — which is
the failure being fixed, one level up.

## 2 · `build.mjs --app` honors only the FIRST occurrence, silently

`tools/build.mjs:188` — `const i = argv.findIndex((a) => a === '--app')`. So:

```sh
node tools/build.mjs --app Integrator --app OverDex --app "Data Unifier"
```

builds **Integrator only**, prints one success line, and exits 0. The extra flags are not rejected, not
warned about, not mentioned. This was hit for real while landing PR #808: OverDex drifted and only
`build.mjs --check` caught it — the same "partial application feels complete" trap
`rebundle-includes-analysis-tools` has now recorded five times, except here the *tool* is what makes it
partial.

`--all` exists and would have been correct. That does not rescue the multi-`--app` form: an unknown
flag is an error, but a **recognised flag silently dropped** is worse than either accepting or
rejecting it.

**Fix:** accept repeated `--app` (build each), or exit non-zero with `--app given N times; use --all or
one --app`. Either is fine; silence is not. Gate with a leg asserting the second name is not discarded.

## 3 · `regen-goldens.mjs` has no `--all`, so "regenerate everything" is a shell loop

`build.mjs` has `--all`; the regen dispatcher does not, so the parent brief's verification step —
*"confirm the corpus-backed fixtures are reached"* across the family — had to be a hand-written `for`
loop over nine node names. A loop nobody committed is a step nobody repeats. Given that the parent
brief's defect was **exactly** "the corpus-backed half of the workflow quietly didn't run", the
one-command form is worth having.

**Fix:** `--all` on `tools/regen-goldens.mjs`, iterating `NODES`, with a **combined summary** that keeps
the parent brief's distinction — total moved / minted / skipped / **NOT REACHED** — and a non-zero exit
under `--check` if anything moved. A per-node loop that prints nine separate summaries reintroduces the
conflation the parent fixed, one level up.

## Done when

- [ ] A2 enumerates its own scope from the tree, with a non-empty anti-vacuity leg; the 3 missing
      headers added; the count of unscanned authored sources is zero by construction, not by luck.
- [ ] `build.mjs` cannot silently drop a repeated `--app` — gated.
- [ ] `node tools/regen-goldens.mjs --all [--check]` exists and reports one combined summary that
      distinguishes NOT REACHED from skipped.

## Cross-references
- Parent: `REGEN-CORPUS-PATH-FOLLOWUPS-2026-08-03-BRIEF.md` (DONE 2026-08-03).
- `CLAUDE.md` §📜 (the SPDX invariant §1 measures against) · §🧪 (the lint lives in the shared suite).
- Grandparent: `FOLLOWUP-FINDINGS-BRIEF.md` P4.
