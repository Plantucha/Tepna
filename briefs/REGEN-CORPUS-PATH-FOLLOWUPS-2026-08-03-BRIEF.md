<!--
  REGEN-CORPUS-PATH-FOLLOWUPS-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-03 · **Created:** 2026-08-03 · **Spawned-by:** `FOLLOWUP-FINDINGS-BRIEF.md` (P4 execution) · **Affects:** `tools/regen-goldens-core.mjs`, `tools/regen-*-goldens.mjs`, `tools/verify-fixtures.mjs`

# The regen tools and the verify tool disagree about where the corpus is, and only one of them says so

## 1 · What happened

Executing `FOLLOWUP-FINDINGS` P4 from a **git worktree** (the arrangement `CLAUDE.md` §👥.1 tells every
agent to use), `node tools/regen-goldens.mjs --node ECGDex` reported:

```
⊘ ECGDex_2026-06-27_equiv.node-export.json — INPUT ABSENT (real recording, gitignored —
  copy the Polar H10 *_ECG.txt into uploads/ to regenerate)
regen: 1 fixture(s) moved, 0 minted, 1 skipped
```

**The input was not absent.** It sits in the main checkout's `uploads/`, and
`DEX_UPLOADS=…/Tepna/uploads` was set in the same shell. `tools/verify-fixtures.mjs` **honors
`DEX_UPLOADS`** (`const UPLOADS = process.env.DEX_UPLOADS || path.join(REPO, 'uploads')`, :48); the regen
family does **not** — grep finds no `DEX_UPLOADS` anywhere in `regen-goldens-core.mjs` or the per-node
tools. So the two halves of the sanctioned fixture workflow look in different places, and the half that
**writes** is the one that cannot be pointed at the corpus.

## 2 · Why this is a fails-open shape, not a papercut

The skip is *printed*, which is better than silence — but what it says is **"this input does not exist"**
when what it means is **"this input is not at this path."** Those license opposite next actions. A
contributor in a worktree who runs the sanctioned regen command gets a **clean-looking** run that
regenerated only the synthetic fixtures and left every corpus-backed one stale, and the summary line
(`1 skipped`) reads like a known exemption rather than a hole. That is the same shape as the stale
GlucoDex fixture in `CLAUDE.md` §🔒: a step that appears to have run, over inputs it never saw.

It did not cause harm this time only because `verify-fixtures` **refuses to stamp** when an input is
missing — the wall held. But the wall is downstream, and it holds by refusing rather than by fixing: the
author still has to work out that the two tools disagree.

## 3 · The fix (small)

1. **Teach the regen family `DEX_UPLOADS`** — one shared resolver in `regen-goldens-core.mjs`, identical
   in precedence to `verify-fixtures.mjs:48`, so the two tools cannot look in different places again.
2. **Say which path was searched** when an input is absent. `INPUT ABSENT (looked in <resolved
   uploads>; set DEX_UPLOADS=… if your corpus is elsewhere)` turns a dead end into a one-step recovery.
3. **Make the summary distinguish the two skips.** `skipped (input absent)` is a *hole*; a deliberate
   exemption is not. A single `skipped` count conflates them, which is precisely what let this read as
   normal.
4. **Gate it.** A source scan asserting both tools resolve uploads through the same helper — cheap, and
   the only thing that stops them drifting apart a third time. Anti-vacuity leg required (the helper name
   must actually be found in both files, or the scan is hollow).

## 4 · Second, unrelated finding — dead Baevsky helpers with divergent binning

`ecgdex-dsp.js` carries `modeV` (5-ms bins) and `amo50` (±25-ms window) as **module-level consts with no
call sites**, immediately above the new `baevskyGeom` (50-ms bins) that the exports actually use. They are
a live trap: the obvious move for a future author needing Mode/AMo50 is to reach for the ones already
named that, and get **different numbers under the same export key** — worse than the omission P4 was
about, because it would be invisible rather than null.

Left in place with a warning comment (deleting dead code is a separate concern and this pass was already
touching the export contract). **Decide deliberately:** (a) delete them, or (b) if something is expected
to use them, give them a call site and a test. Leaving an untested divergent duplicate is the third option
and the worst one.

## Done when

- [x] **DONE.** `resolveCorpus(repo)` is exported from `regen-goldens-core.mjs` and imported by all
      nine regen tools **and** `verify-fixtures.mjs` (whose hardcoded `:48` expression is gone). Gated by
      `Regen + verify resolve the corpus through ONE helper — §3.4` — 10 assertions, of which 8 fail on
      the pre-fix tools **by value**, while the three anti-vacuity legs still PASS (sources loaded and
      non-trivial), which is what shows the scan isn't hollow.
- [x] **DONE.** `INPUT ABSENT` now prints `looked in <resolved corpus>` plus either `(from DEX_UPLOADS)`
      or the recovery hint, and the summary reports `N NOT REACHED (input absent — this run did not
      cover them)` separately from `skipped`.
- [x] **§4 DECIDED: (a) delete.** `modeV`/`amo50` had no call site anywhere in the tree, and
      `baevskyGeom` is already THE single source. Option (b) was rejected: inventing a call site to
      justify a second binning is how the two numbers diverge under one export key. The deletion is
      pinned by `ECGDex has ONE Mode/AMo50 implementation — §4`, which asserts on the **bin width**
      (`Math.round(v/5)*5`, `|v−mo| <= 25`) rather than the identifier names — the identifiers can be
      renamed, the divergence cannot be hidden.
- [x] **DONE, and it found more than the report did.** Run from this worktree with `DEX_UPLOADS` set:
      before, **11 corpus-backed fixtures across 7 nodes** were unreachable (OxyDex 2 · ECGDex 1 ·
      PpgDex 1 · PulseDex 2 · HRVDex 2 · GlucoDex 1 · CPAPDex 2) — the report named one. After, all nine
      nodes report `0 NOT REACHED` and `ECGDex_2026-06-27_equiv.node-export.json` — the fixture §1
      opened with — is re-run and compared, not skipped. Verified on the **reached fixture list**, not
      on the exit code.

## Executed — one correction to §3.1 as written

§3.1 asked for one resolver "identical in precedence" across both tools. Applied literally to
`uploadsDir` that would have been a **worse** bug than the one it fixes: `uploads/` holds gitignored
recordings *and* **133 git-tracked** artifacts, including every `*_equiv.node-export.json` a regen
**writes** (`runRegen` resolved both against the same dir). Routing the write side through
`DEX_UPLOADS` would make a worktree regen silently rewrite a tracked file in **another checkout** —
invisible to the worktree's git, and precisely the shared-tree failure `CLAUDE.md` §👥 exists to
prevent. So the two paths are **split, named, and gated apart**: `corpusDir` (DEX_UPLOADS-aware, read
side) vs `fixturesDir` (always this checkout, write side). `verify-fixtures` never writes to
`uploads/`, so it needs only the corpus half and the shared-helper invariant still holds.

Also fixed in passing: `tools/regen-ppgdex-goldens.mjs` carried **no SPDX header**. It was invisible
because the A2 lint only scans wired sources — adding the regen family to the source list is what
surfaced it.

## Cross-references
- Parent: `FOLLOWUP-FINDINGS-BRIEF.md` (DONE 2026-08-03) — P4's execution surfaced both items.
- `CLAUDE.md` §🔒 (`verifiedUnder`, and why an unrun verification is a false claim) · §👥.1 (work in a
  worktree — the arrangement that exposes this).
