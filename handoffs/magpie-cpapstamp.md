# Magpie — unit `cpapstamp`

**Row:** `2026-10-27-the-cpapdex-14-digit-stamp-arm-bounds-no-run` (OPEN at the ref when claimed, board #1729)
**Branch:** `claude/cpapstamp-mg` · **Worktree:** `wt-cpapstamp-mg` (sibling of the primary checkout) · **Base:** `ef4eb7605`
**Rule 0:** `cpapdex 14-digit filename stamp regex bound digit run` →
`briefs/RESIDUE.md:984`, `briefs/FILENAME-STAMP-JS-CONSUMERS-2026-10-20-BRIEF.md`,
`clock.js:236-270` (`fileStamp`, the remedy's shape).

## What the row said, and what the read added

The row names one site, `cpapdex-dsp.js:85`. Two more carry the same defect class in the same bundle,
and the read found them, not the row:

| site | before | after |
|---|---|---|
| `cpapdex-dsp.js` 14-digit arm | `9920260612_222830_BRP.edf` → 2026-06-12 22:28:30 | null |
| `cpapdex-dsp.js` ISO arm | `12026-06-12 22:28:30` → 2026-06-12 22:28:30 | null |
| `cpapdex-app.js` `parseEdfName` | `9920260612_222830_BRP.edf` → 2026-06-12 22:28:30 | null |

§2.7 cannot see this class at all: the window the unbounded pattern takes spells a legal date and a
legal time, so the round-trip validator passes it. The row's own evidence read that the ranges
"catch most shifted windows" — they do, for a 14-digit run. They catch none of the three above,
because `[_\-]?` lets the window start two digits into a ten-digit token.

## The remedy

`(?:^|\D)` … `(?!\d)` on the 14-digit arms, `(?:^|\D)` alone on the ISO arm — a four-digit fraction
may legally run past three digits, so that arm takes no right bound. The prefix is non-capturing, so
every group index is unchanged. This is the maximal-run rule `clock.js fileStamp` states, written as
a boundary rather than a token split, and it agrees with `fileStamp` on every shape measured.

## Blast radius, stated honestly

Neither site has a consumer that a wrong instant reaches today.
`CpapDsp.parseTimestamp` has no in-repo caller but its own selftests; `prefixMs` orders the array
handed to `CpapEdf.groupSessionSets`, which re-sorts it by its own ANCHORED reader (`_F4_RE`), so no
cluster boundary or cluster order depends on it. This is a contract repair, not a measured
corruption, and the PR says so.

## The ∅ beside it

`groupEdfFiles` sorted on `(a.prefixMs || 0)`, which manufactures epoch 0 for an absent stamp and
puts every unstamped file ahead of every real one. Bounding the pattern only grows that set, so the
comparator now sorts absent LAST and keeps input order.

## Gates

- `node tests/run-tests.mjs --group=node-local-clock` ✓ 300 · `--group='cpapdex-dsp'` ✓ 260
- **Plant:** reverting all four halves reds 7 legs in `node-local-clock` and both selftest pins in the
  leaf-module group, with every ACCEPT leg still green. Restored byte-identical (`cmp`).
- `npm run typecheck` ✓ · `npm run lint` ✓ (pre-flight, before the bundle)
- `manifestHash` 3a76f9d0a932 → ec72091395ed · `computeHash` 2b4f52499bc6 → 4896da8e4d80. Both moved,
  so this bundle is NOT export-inert and it owes a re-verification.
- `npm run check` — appended below.
---

## FINISHED 2026-10-27 — head `7df031bdc`, PR #4027 still DRAFT

🔴 **A CPAPDex DSP EDIT STALENS FOUR ANALYSIS TOOLS THROUGH A WORKER BLOB, NOT AN INLINE BLOCK.**
`verify:analysis` redded at step 27 of 41 with `STALE (4)`. None of the four inlines the file I
edited: `grep -c 'data-inline-src="cpapdex-dsp.js"'` reads 0 in each of them. The dep sits one layer
down. `cohort-worker.js:113` lists `cpapdex-dsp.js` among the `rrgluco` worker's sources, and
`build-analysis.mjs` ships that worker as a `var __WSRC = {…}` string literal.

So the whole diff is one line of 2,092,492 bytes against 2,095,272. The inline-marker grep that
normally attributes a rebuild sees nothing here.

**The control ran before the claim.** `node tools/build-analysis.mjs --check` at main (`137c58725`)
reads `analysis tools current — 14 checked, all self-contained`. The ref owes nothing on these four,
so the staleness is mine and the rebuild belongs in this PR.

**What a CPAPDex DSP edit actually costs, in order:** `build.mjs --app CPAPDex`, the two
orchestrators, `build-docs.mjs`, `build-analysis.mjs`, then one gate run. Two gate runs paid for
steps two and four of that list, each learned from a red step rather than from the table in
CLAUDE.md.

**The bundle owed a re-verification, and this head pays it.** `verify:fixture-currency` redded at step 40 of 41:
four CPAPDex fixtures still read `verifiedUnder=2b4f52499bc6` against the closure `4896da8e4d80`.
`node tools/verify-fixtures.mjs` re-ran them on their committed inputs after a green suite. Only the
four stamps moved, and no `outputHash` did, so the bound changes no fixture output.

**Rebased, because main moved twice while the gate ran.** `node tools/rebase-safe.mjs` read `RB_EXIT=0`
with no conflict and no artifact moved. Head `bb8c23079`, 0 behind, MERGEABLE. Every half survived:
both regexes bounded, the ∅ comparator in place, 12 test identifiers present, the row closed, and the
four `verifiedUnder` stamps intact.

**Final gate on `bb8c23079`:** `✓ check — all 41 steps passed`, `EXIT=0`, suite 14,588 assertions over
834 groups.
