<!--
  REGEN-CORPUS-PATH-FOLLOWUPS-II-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-03 · **Created:** 2026-08-03 · **Spawned-by:** `REGEN-CORPUS-PATH-FOLLOWUPS-2026-08-03-BRIEF.md` (execution) · **Affects:** `tests/run-tests.mjs`, `tools/build.mjs`, `tools/regen-goldens.mjs`

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

> ### ⚠ CORRECTION (2026-08-03, on execution) — the counts below were WRONG, in both directions
>
> They were produced with `grep -q PAT "$f" || echo MISSING`, and in this environment **`grep` is a
> shell function**, not GNU grep — its `-q` exit code disagrees with `-c` **on the same file in the
> same shell**. The audit therefore reported `tools/make-synthetic-edf.mjs` as headerless when it is
> not, and a separate earlier run of the same idiom **missed** files that genuinely were. Re-measured
> in Python, reading bytes:

| | count |
|---|---|
| authored `.js`/`.mjs` in the tree | **203** |
| of those, in `env.sources` (A2's old scope) | **124** — 61 % |
| headerless, whole tree | **4** — `how-to-collect/image-slot.js` **and its generated `docs/` mirror**, `tools/o2ring-finger-roundtrip.mjs`, `tools/o2ring-finger-validate-batch.mjs` |
| headerless **inside** A2's old scope | **0** |

The last row is the finding, sharpened: **every** headerless file sat in the 39 % A2 could not see, and
two of them (`image-slot.js` and its mirror) are in no scan list and never would be. `make-synthetic-edf.mjs`
is fine. The original claim of "3, including make-synthetic-edf" was an instrument error, not a measurement.

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

- [x] **DONE.** A2 walks the tree itself (`walkRepoPaths`, the same walker + exclusions `docs-ledger`
      uses) and is handed the first 4 KB of every `.js`/`.mjs`; the gate keeps its own regexes, because
      handing it a precomputed boolean would move the predicate out of the gate. Three anti-vacuity legs:
      the walk found >150 files, it **reaches files no scan list contains**, and it covers strictly more
      than `env.sources` (203 vs 124). All 4 headers added — the `docs/` mirror via `build-docs.mjs`, not
      by hand. **Verified RED the way that proves the point:** with the headers removed, the OLD wired
      legs report `present across 124 files` — fully green — while the new whole-tree legs name all four.
      That single run is the borrowed-scope defect.
- [x] **DONE.** `build.mjs` collects every `--app` occurrence and **validates all names before writing
      any bundle**, so a typo in the third flag cannot leave the first two rebuilt. Gated on the shape
      that failed (`findIndex` must not return).
- [x] **DONE.** `node tools/regen-goldens.mjs --all [--check]`, one child process per node — **not** nine
      imports into one realm, because each recipe co-loads the real modules and several define the same
      globals, so sharing a process would let one node's modules answer another node's regeneration.
      One combined summary keeping `NOT REACHED` distinct from `skipped`; a node that prints no summary
      is a failure, never folded into a zero. Measured: without `DEX_UPLOADS` it reports **11 NOT REACHED
      across 7 nodes** on one line (the parent brief's 11, previously only findable by a shell loop);
      with the corpus, **0**.
      **Deliberately NOT a failure:** `--check` still exits 0 when fixtures are unreached. A contributor
      without the corpus cannot green it, and the wall that matters is already downstream —
      `tools/release.mjs` refuses to cut a release while a corpus-backed fixture is unverified.

## Cross-references
- Parent: `REGEN-CORPUS-PATH-FOLLOWUPS-2026-08-03-BRIEF.md` (DONE 2026-08-03).
- `CLAUDE.md` §📜 (the SPDX invariant §1 measures against) · §🧪 (the lint lives in the shared suite).
- Grandparent: `FOLLOWUP-FINDINGS-BRIEF.md` P4.
