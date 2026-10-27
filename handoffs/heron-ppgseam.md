# Heron · unit 84 · `ppgseam`

## 1 · Unit

Publish the PpgDex clock seam on the node-export, closing residue row
`2026-10-25-the-ring-seam-verdict-never-reaches-a-folded-artifact` (my own row, claimed on board #1520,
scope on #1521).

## 2 · Branch and worktree

`claude/ppgseam-hrn` in `~/wt-ppgseam-hrn`, cut from `ef522124d`. Nothing committed at the
time of writing.

## 3 · Exact stopping point

Every edit is in the tree and every pre-flight passes.

- `ppgdex-dsp.js:6708` — the conditional `out.recording.clockResyncs` publish, mirroring
  `ecgdex-dsp.js:6510` field for field.
- `tests/dex-tests.js` — three legs after the existing `clockSeam` control at about `:67804`.
- `changes/2026-10-26-ppg-export-publishes-the-clock-seam.md` — minor, added, ste-lint PASS.
- `npm run typecheck` rc 0. `npm run lint` rc 0.
- `node tools/build.mjs --check` — 11 owned bundles clean. PpgDex b2e94d5304c7 → 30ac6a6663e3,
  `Data Unifier.html` cd3a70594cf7, `OverDex.html` ea813d2a9c65, `docs/PpgDex.html` rebuilt.
- Six goldens regenerated. `tools/verify-fixtures.mjs` `VF_EXIT=0`, suite green, 1 fixture stamped,
  `verifiedUnder` → f61b52d8e0d5.
- `node tools/build-analysis.mjs` rebuilt 11 of the 14 analysis tools, which inline `ppgdex-dsp.js`
  as well. A control in a clean worktree at the same base exits 0 there, so the staleness was mine.
- The three new legs are plant-backed. Each plant reds naming its own leg, and `tests/dex-tests.js`
  hashes to 4319d247ca030fbd both before the first plant and after the last revert.
- The final `npm run check` runs detached into `/tmp/h84check3.log` behind an `NPM_EXIT=` sentinel.

## 4 · Next step

Read `NPM_EXIT=` from `/tmp/h84check3.log`. On a zero: stage by explicit path, commit with
`/tmp/msg84.txt`, push, run `PR_BODY=$(cat /tmp/body84.md) PR_BASE_SHA=ef522124d PR_HEAD_SHA=HEAD node
tools/pr-compliance.mjs` BEFORE `gh pr create`, open the PR as a draft, read the number back from
`gh pr view`, then close the row inside the same PR with `fixed #<number>`.

## 5 · Open questions

One clause of the row needs a narrower reading, and the PR body states it. The seam count already
reaches a reader on 6 of the 173 PpgDex nights, as a sentence inside `measurementReason` that opens with
`clock-seam:`. A census cannot read a count out of prose, so the structured field was the absent part.
Whether that correction wants a second row of its own is Kestrel's call.

## 6 · Blockers

None. #3979 merged, so the one-PR cap leaves my slot free, and #3973 belongs to Osprey.

The one cost worth naming: the export compute closure moved, so any rebase that touches
`ppgdex-dsp.js` costs a re-bundle of three bundles plus the docs copy, a fixture regen and another
`verify-fixtures.mjs` run, which is about 25 minutes.

## 7 · The doc-search query

`node tools/doc-search.mjs --read "PpgDex node export publishes clockResyncs clock seam"` finds
`docs/EXPORT-SHAPES.md:68-79` for the §12 row and the seam refusal, and
`briefs/BLE-TIMEBASE-AT-THE-EDGE-2026-09-16-BRIEF.md` for the node-side half that computed the verdict.
