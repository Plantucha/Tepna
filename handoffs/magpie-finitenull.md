# Magpie — unit `finitenull`

**Row:** `2026-09-28-bare-isfinite-admits-the-null-that-absence-is-null-requires` (OPEN at the ref)
**Branch:** `claude/finitenull-mg` · **Worktree:** `wt-finitenull-mg` (sibling of the primary checkout) · **Base:** `324dabcb6`
**Rule 0:** three queries, every one a flat field (best 0.302 → 0.173 → 0.378). The class has prior
work; this consequence has none. Nearest on-class hit: `ext:memory/a-guard-must-test-the-value-it-uses.md`,
whose coercion table (`null >= 0` true, `isFinite(null)` true) is the mechanism, not the fix.

## The row's named consequence was already closed, hours after it was logged

The row ends by naming one concrete exposure: `pat-feasibility.js` writes `beatToBeatIQRms`,
`driftRangeMs` and `driftPpm` through `+(+x).toFixed(1)`, so a NaN lands in the download as `null`
and a bare-`isFinite` reader sees 0 ms / 0 ppm. **#3203 fixed exactly that on 2026-09-28 at 20:11Z,
the same day the row landed.** Every one of the three now carries a `*Reason` sibling written on the
line that makes the absence (`pat-feasibility-worker.js:385-393`, `:441`, `:64-66`), the page and the
download read one source, and `tests/dex-tests.js` pins the round trip.

🔴 **A FROZEN DEFECT CELL AGES, AND `OPEN` DOES NOT REFRESH IT.** Four weeks of the row's text read as
live when none of it was. Check every factual clause against the code at the ref before building.

## What is NOT fixed: the same rule one layer up

The per-night layer is faithful to §∅. The corpus-level medians ABOVE it kept the older shape.
Measured at the ref by running the page's own expressions on an empty subset:

| surface | published |
|---|---|
| coupling + spread cards | the string `"NaN"` |
| drift card sub-line | `median · range Infinity–-Infinity` |
| conclusion sentence | `left drift at NaN ms (raw NaN ms)` |
| **drift shape card** | **`wander · NON-LINEAR — needs continuous correction`** |
| download aggregate | `null` with no reason and no count |

The fourth is the one that matters. `median([]) >= 0.6` is false and the false arm of that ternary is
a **verdict**, so a card that had measured zero nights stated a finding in the voice of a measurement.
§∅ forbids an in-range sentinel for an unmeasured value.

**Reachable, not hypothetical.** `linR2` is NaN below 3 bins and a bin is 5 minutes, so ONE short
coupled night empties that subset. `cp.ppm` is NaN on ≤ 0 overlap or an absent drift range.

🔴 **AND THE SECOND HALF IS LIVE ON ORDINARY DATA.** The old `agg()` dropped unmeasurable nights
silently, so `beatToBeatIQRmsMedian` could be the median of 3 nights while `nightsCoupled` said 25 and
nothing in the file said which. §∅ splits the two: a discontinuity refuses, reduced coverage annotates.

## The fix

`PATGate.coverStat(rows, f, label)` in `pat-gate.js` — the subset, its coverage and a reason that is
non-null only on refusal. All 15 `agg()`/`median()` call sites in `pat-feasibility.js` route through
it: four cards, the corrected-drift pair, the buffering card, the conclusion sentence and nine
download fields. Both private helpers are DELETED rather than left unused.

## The bare `isFinite`, measured rather than argued

`coverStat` keeps on `typeof v === 'number' && Number.isFinite(v)`. The one null-capable field is
`floorSync.bufferingDiffMs` (`pat-feasibility-worker.js:1379` writes `null`), and **every call site
reaching it today carries the same condition the producer uses**, so the bare filter has never yet
been wrong here. Loaded trap, not a live defect — the same verdict the row's own three traced suspects
got. The plant shows what it was one guard away from: under the discarded filter, `[null, null, 4]`
gives n=3 and a median of **`null`**.

## The suite leg · 35 assertions

Executed, not scanned, except the delegation-parity scans at the end. Full coverage · reduced coverage
(annotates, reason stays null) · empty (refuses, names the quantity and `0 of N nights`) · the null
case with the OLD filter beside it as a control · a numeric string · and an **anti-vacuity** leg
pinning that three real zeros stay three measurements, because the row warns that a blanket conversion
throws away legitimate values.

**Plant:** restoring the bare `isFinite` in `coverStat` reds 4 of the 35 and names them. Restoring
gives 35/35.

## Gates

- `node tests/run-tests.mjs --group="PAT aggregate"` ✓ 35
- `npx --no-install biome check` ✓ — 5 warnings, identical to the base copies of both files
- `node tools/build-analysis.mjs` → 2 bundles (`PAT Feasibility.html`, `PAT Classic vs Fused.html`)
- `node tools/ste-lint.mjs changes/2026-10-26-pat-aggregate-coverage.md` ✓ 0 findings
- `npm run check` — running detached; result appended below

## Not in this PR

The row's closure. The per-night half is `fixed #3203` and the aggregate half is this PR, so the row
needs a closure naming BOTH, plus a correcting row for the four weeks its cell read live. That rides
the RESIDUE-only PR Kestrel sequences. **The PR body must not carry the words `closes residue`** —
Kodiak squashes the body into main's commit message and `verify:residue-claims` then reds the ref.

---

## FINISHED 2026-10-26 04:15Z — head `0504263aa`, all 40 steps pass, PR #3944 DRAFT

PR opened at https://github.com/Plantucha/Tepna/pull/3944, draft, body ste-lint clean (EXIT=0
captured into a variable, never read off a pipe). Board finding #1379 on thread 7, addressed to
Kestrel. The row claim stays HELD until the PR lands.

`npm run check` ✓ all 40 steps, suite **14,295 assertions over 827 groups**. Note Osprey's #3943
adds a 41st step (`tools/residue-citations.mjs`); my base predates it, so 40 is the right count here
and a rebase will move it to 41.

⚠️ **ste-lint's `long-paragraph` rule appears only once `long-sentence` clears.** Splitting the last
sentence of a six-sentence paragraph produced a seventh and a new finding. Split by paragraph, not
only by sentence, when a block is already at the limit.

## Still owed, and it is NOT in this PR

Kestrel's RESIDUE-only PR carries two cells for this row: the closure naming BOTH halves (per-night
`fixed #3203`, aggregate `fixed #3944`), and a correcting row for the four weeks the cell read live.
Also still owed from `adoptwiden`: an `emits.cmd` for the two `pending` `tch-` manifest rows.

## MERGED 2026-10-26 04:45Z — #3944, worktree retired

Kestrel undrafted it (board #1382) and Kodiak merged it. CI read **27 pass, 1 skipping, 0 fail**.
`node tools/wt-done.mjs /home/michal/wt-finitenull-mg` removed the worktree, reporting the PR merged,
the tree clean, idle, and every commit landed. My PR slot is free. Merge note on board #1388.

The board claim on the row stays HELD until Kestrel's RESIDUE-only PR closes it. A released claim on
a row whose remedy already merged is the pickup the fleet has wasted sessions on.
