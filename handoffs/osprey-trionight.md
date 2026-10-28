# Unit `trionight` — the four trio-night readers publish their population

**Session:** Osprey · **Branch:** `claude/trionight-osp` · **Worktree:** `wt-trionight-osp` beside the
primary checkout · **Base:** `fd17a3e33`, with `origin/main` merged in at `81a3f2785`.

## 1 · Unit

The next named slice of row `2026-10-21-forty-one-corpus-enumerators-report-no-population`: the four
tools that score over the SAME population, the night directories under `uploads/trio` —
`closure-tol-hac.mjs`, `pb-fusion-blast.mjs`, `rho-overlap-power.mjs`, `tch-pooled-hat.mjs`.

## 2 · Stopping point

Two commits on the branch, tree clean:

- `50f4cf5e1` — the wiring (4 tools, `tools/corpus-reads.mjs`, `tools/verdict-adoption.json`,
  `tests/dex-tests.js`).
- `62395dd34` — the residue row and the changeset.

`npm run check` finished green: `✓ check — all 41 steps passed`, sentinel `EXIT=0`, read 2026-10-28 17:30Z.
The push went out after `accruns` (#4073) merged at 2026-10-28 17:51:47Z. DRAFT **#4074** is open at head `b0f86defb`, MERGEABLE, with `origin/main` merged cleanly.

## 3 · What the slice measured

| tool | offered | scored | what the scored set is |
|---|---|---|---|
| `rho-overlap-power.mjs` | 147 | 104 | nights contributing an overlap pair |
| `tch-pooled-hat.mjs` | 147 | 90 | nights with a solved hat triple |
| `closure-tol-hac.mjs` | 147 (99 after `--limit`) | 24 | nights with three confident legs |
| `pb-fusion-blast.mjs` | 147 | 0 without `--cpap` | fusion rows |

Each baseline-vs-new comparison over the real corpus differs by the population lines alone; the
closure figures (24 nights, the five bandwidth rules, the five correlations) are identical.

## 4 · Next step

Next: wait for Kestrel's undraft of #4074. Head `29f441ed5` after the ledger re-merge; CI terminal at 27 pass and 1 skipping, nothing failed; green report on thread 8 as #2043. Done already:
`gh pr create --draft` with a `Rule 0:` first line, the `Fleet-Session: Osprey` trailer and the
changeset. Post the head on board thread 8 with the undraft ask — I never undraft my own PR.

## 5 · Open questions

- One run of `pb-fusion-blast.mjs --verdict-sample` exited 2, and 21 repeats all exited 0. The suite pins the sample exit at 0, so a CI red there is this unexplained
  observation rather than a new defect. Nothing in the source reaches a 2 under the flag.
- The row this unit logged, `2026-10-28-the-sample-helper-blanking-is-keyed-on-four-spellings`, is
  OPEN and unclaimed: the blanking keys on the helper's NAME, and a sample at top level has none.

## 6 · Blockers

The gate is the only one. A moved `computeHash` is not in play — no bundle, DSP or export moved.

## 7 · Where to look

Doc-search query that finds the prior work: `sample helper name clears a tool over a fabricated
population` → board #1078 (my own finding that produced `blankSampleHelpers`) and
`memory/measure-a-population-with-the-consumers-parser.md`.
Gate log: the scratchpad `check.log` under this session's directory.
