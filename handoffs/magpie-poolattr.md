<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 Michal Planicka -->

# Magpie · unit `poolattr` — the trio pooled hat publishes its contributions block

**Rule 0:** `trio pooled hat leave-one-out contributions per night trio-batch` → `CHANGELOG.md:3178` ·
`briefs/VERDICT-CONTRIBUTIONS-2026-10-04-BRIEF.md:82-92` · `briefs/RESIDUE.md:820-821` ·
`docs/TOOLS-INDEX.md:308-315` · `briefs/INTEGRATOR-POOLED-CLOCK-APPLY-2026-08-01-BRIEF.md`

- **Branch** `claude/poolattr-mg`, worktree `~/wt-poolattr-mg`, **PR #4354 (draft)**.
- **Head** `4f941cdf8`, three commits on `377f40b42`.
- **Gates over the final state:** `TC_RC=0`, `LINT_RC=0`, `✓ check — all 49 steps passed`, `EXIT=0`,
  0 steps NOT RUN. `node tools/secret-scan.mjs` PASS over the 3 commits (gitleaks now installed on the
  rig, board #3324, so the step examines rather than reading NOT_RUN).
- **Selftest** `node tools/tch-pooled-hat.mjs --selftest` → 12 passed, 0 failed; six assertions new.
- **Adoption gate** reads `adopted 2 (read 2, block examined 2) · pending 3`, up from one adopted.

## Stopping point

The draft is green and waiting for `tepna-pr-walker.timer` to ready it. I never undraft my own PR.

## Next step

VERDICT-CONTRIBUTIONS §2 row 5 — the Integrator fused sleep summary (`integrator-dsp.js`,
`leave-one-out` over nodes), which §2 orders last. §5 box 4 still wants one recorded night where the
block answered "which input" without a bird reading code.

## Open questions

- The two capture-host §2 rows (SOLID-NIGHT, LOSS) are not my lane.
- Row `2026-11-04-the-adoption-gate-cross-checks-two-copies-of-one-claim` is OPEN and deliberately
  prevention-only: whether a named file computes a named figure is not mechanically decidable.

## Lessons

- `--verdict-sample` is a CROSS-TOOL contract, not a free surface. The suite pins `status: PASS`,
  `result.rule: sampleNights` and one parseable object for all four trio-night readers. A figure
  verdict is `UNKNOWN` with no rule, and the probe concatenates stdout and stderr, so a second object
  under that flag parses as neither. It gets its own flag.
- A gate that compares a row against the brief and against nothing else lets two copies of one wrong
  claim agree forever.
- The deltas of a leave-one-out set do not sum to the figure, and the selftest says so.

Fleet-Session: Magpie
