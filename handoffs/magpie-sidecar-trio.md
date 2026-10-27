<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — the trio HR walk reads its validity companion (Magpie)

**Unit:** residue row `2026-10-17-sample-parsers-called-without-their-sidecar`, board claim #493.
**Branch:** `claude/sidecar-mg`, worktree `~/wt-sidecar-mg`. **DRAFT #3772** @ `706d6e2ea` —
`npm run check` EXIT=0 over 39 steps, 13427 assertions over 803 groups, corpus lap green. Board #502.
**Doc-search query that found the prior work:** `sample parser called without its RUNS sidecar validity`
→ `tests/dex-tests.js:37417` (the ratchet) · `briefs/SAMPLE-VALIDITY-ENVELOPE-*-BRIEF.md` ·
memory `half-wired-mechanism-hides`. Second query, for the testing shape:
`export a dead helper from a dsp module to give a worker a tested predicate` →
`briefs/WORKER-REALM-GATES-2026-07-12-BRIEF.md:15-37` · `briefs/PPGDEX-WORKER-CLOSURE-2026-07-12-BRIEF.md:31-51`.

## What the row actually asked for

The row's own framing counted **call sites**, not repairs: the node-side product paths took the companion in
September, and what is left is six calls in three files plus 64 research-tool calls. Per-family sidecar
counts decided the scope — measured 2026-10-20 over the corpus, H10 `_ECGRUNS` is **38 files / 38 with
runs / 306 runs**, the ring's pleth `_PPGRUNS` is 164 / 85 / 247, and every other family (Verity PPG and
ACC, H10 ACC, ring ACC and 2W) records **0 runs** across 500-odd companions. So the trio lane is the one
place where the omission costs a number today.

## What shipped

- `sensor-trio-worker.js` takes the companion at all three parse sites (`ECGDSP.parseECG`,
  `PPGDSP.parsePPG` ×2) and its own Pan–Tompkins HR derivation drops any RR interval that touches a
  blanked run, reporting `blanking.intervalsDropped`. That walk never reaches ECGDex's epoch path, which
  is the node's only reader of `rec.blankingSpans`.
- `ecgdex-dsp.js` exports `intersectsRun` — the sample-frame overlap rule that `parseEcgRuns` was
  written with and **nobody called**, because the node's own path converts the spans to seconds. The
  worker calls it rather than mirroring it.
- The three `realNight` feeders (`sensor-trio-night.js`, `sensor-trio-power-analysis.js`,
  `sigma-no-reference-analysis.js`) pair the companion **by name** at selection time and ship it in the
  job: a companion carries no sample rows, so the first-data-row night key cannot read one.
- `tests/dex-tests.js`: a new group with a 14-row numeric truth table for the half-open predicate plus a
  comment-stripped structural pin on the worker and the three feeders; the ratchet's
  `'sensor-trio-worker.js': [3, OPEN]` pin drops in the same diff and the worker joins the wired-caller
  positive controls.

## Carry this forward

The scan **must strip comments first** — the fix's own comment names `intersectsRun`, so a raw-text
assertion would pass on the prose. One assertion in the group exists only to prove the strip is
load-bearing.

The exported helper moves `manifestHash` **and** `computeHash` for `ECGDex.html`, `Data Unifier.html` and
`OverDex.html`, so this PR owes a corpus lap (`tools/verify-fixtures.mjs`) even though `analyze` never calls
it and no number moves.
