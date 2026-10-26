# Magpie — unit `patfeas`

**Row:** `2026-10-12-filename-stamp-consumers-split-twelve-convert-four-identify` (OPEN at the ref,
and it STAYS open — this PR empties the JS half only)
**Branch:** `claude/patfeas-mg` · **Worktree:** `wt-patfeas-mg` (sibling of the primary checkout) ·
**Base:** `0de289150`
**Rule 0:** `night key from filename stamp instead of first data row in a browser ingest` →
`briefs/FILENAME-STAMP-JS-CONSUMERS-2026-10-20-BRIEF.md:68-91`, `briefs/RESIDUE.md:604`,
`sigma-no-reference-analysis.js` ingest loop.

## What the census missed

The row enumerates 17 files and names ten JS converters. `pat-feasibility.js` is not among them, and
it is a SERVED page: `tools/build-analysis.mjs TOOLS` lists `PAT Feasibility.html`, so a page absent
from that list 404s every dependency while a page present in it runs. It keyed its night on the
filename stamp and picked every companion by name-stamp proximity — the same defect #3746 and #3791
repaired in its three siblings. Its own comment cites `sensor-trio-power-analysis.js` as the rule it
copies, and that rule moved under this residue while the copy did not.

🔴 **A CENSUS ENUMERATION HAS NO INSTRUMENT, SO ITS POPULATION DRIFTS IN SILENCE.** Re-running the
row's own derivation at the ref returns 15 files, not 17: four left as their fix landed and two
entered, one of them this page. Nothing in the tree watches that number. A residue row for the drift
rides this PR's ledger line.

## The change

- `pat-feasibility.js`: the reader ported verbatim from `sensor-trio-power-analysis.js`
  (`ROW_SCAN_BYTES` / `ROW_SCAN_LINES` / `_ISO_ROW` / `_RING_ROW` / `_rowTMs` / `firstRowTMs` /
  `nightKeyOfMs`), `ingestFiles` now `async` and keying on the row, each candidate carrying `ms` and
  `stampSource`, `nearestTo` comparing `.ms` rather than a name stamp, and the status note naming the
  fallback count. No `DexClock`: the page carries no `clock.js` and `verify:analysis` requires it to
  stay self-contained.
- `tests/dex-tests.js`: a FOURTH entry in the night-key group's `PAGES`, with a per-page `sliceEnd`
  because `pat-feasibility.js` has no `hashStr` next to its reader.
- `PAT Feasibility.html` rebuilt by `tools/build-analysis.mjs`.

## The corpus delta

Over the 9591 files the page's own classifier accepts: 8075 carry a parseable first-row stamp and
1516 do not, median error 4.5 s, 99 files over 5 min, worst 18.71 h, **13 files cross the noon
fold**. Nights 141 by name and 141 by row, none gained or lost, and **eligible 126 by name against
127 by row** — one night whose ECG and PPG the name had split across two buckets now holds both.
A second run against a warm cache reproduced every figure.

⚠️ **I WROTE THE SELF-MATCHING `until ! pgrep -f` §4 FORBIDS, TWICE IN ONE UNIT.** Both waiters
matched their own command line, neither could ever exit, and both died at exit 144 — the tell the
rule names. A waiter that owns a `$PID` needs no pattern, and that is the form that worked.

## The plant

Restoring `origin/main`'s page reds **9** of the group's legs, every one naming `pat-feasibility.js`,
including the anti-vacuity floor at 3 of 4. Restoring gives 101 of 101.

## Not in this PR

The row's closure — the census covers Python converters and part (a), the capture-host writer, which
needs a night and an owner-authorized deploy. The paper re-run at `papers/sensor-trio-nights.html`
§3.4 is its own unit by the brief's own ruling.

---

## FINISHED 2026-10-26 17:30Z — PR #3981 (DRAFT), head `a0d52683f`

`npm run check` → all 41 steps pass. Suite 14,443 assertions over 830 groups. GATE A 9 of 9, GATE B 26
fixtures reproducible. `pr-compliance.mjs` preflight PASS over 9 checks before `gh pr create`.

Pushed, opened as DRAFT, board #1529 on thread 8 asking Kestrel to undraft. My one open PR.

The first gate run red at step 15 on `check5`: a changeset's `brief:` field resolves as a FILENAME, so
the `.md` suffix is load-bearing. The 4-second proof is `node tests/run-tests.mjs --group=release-ledger`.

Still not in this PR: the census row's closure verb, the Python converters, part (a) of the parent row,
and the paper re-run at `papers/sensor-trio-nights.html` §3.4.
