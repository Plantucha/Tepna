# Unit `projprint` — a verdict print hands over the whole object

**Unit.** Convert every projection print of a `tepna.verdict/1` to the whole object, through one shared
helper, and pin the shape so a projection cannot return.

**PR.** #3942, non-draft, BLOCKED on pending checks.

**Branch + worktree.** `claude/projprint-osp` in `wt-projprint-osp`, cut from `origin/main` @ `0bfd73dee`,
rebased onto `09c5d7f1f`. Head carries one commit.

**Rows.** Closes `2026-10-25-six-tools-print-a-verdict-projection-under-the-schema-label` and
`2026-10-25-the-mutation-gate-prints-a-three-key-projection-of-its-verdict`. Both read OPEN on the ref,
and a RESIDUE-only PR carries their state cells. I owe a correcting row: the six-tools row names
`tools/oracle-ecg-firmware-rr.mjs:1051`, which is a selftest line, while the real prints sit at `:1164`
and `:1206` — six files over seven sites.

**What landed.**

- `printVerdict` in `tools/verdict-emit.mjs` validates, throws on anything that is not a whole valid
  object, and keeps each caller's prefix.
- Six JS sites over five tools hand their object to it: `cohort-fit`, `nsrr-score-pool`,
  `nsrr-stage-validate`, `oracle-ecg-firmware-rr` (two sites), `tch-firmware-reference`.
- `capture-host/tools/mutate_diff.py` prints `json.dumps(obj)` rather than a three-key dict.
- One pin group in `tests/dex-tests.js`, 15 assertions: a source census over `tools/*.mjs` plus the
  capture-host printer, six plants, and two legs that run both lines through `extractVerdicts` — the
  consumer's own parser reads the new line as one verdict and the old line as nothing.

**Measured.** Census 14 label prints over 11 files — 13 whole, 0 projections, 1 prose-only. A site
converted back to a projection reds the census leg by name. `capture-host/check.sh` passes with
`PYTHON=~/Tepna/capture-host/.venv/bin/python` (11442 passed, coverage 100.00%); the conda
interpreter REFUSES that gate because ruff and pytest-cov are absent there, and a refusal is not a pass.

**Next step.** Watch #3942 to green, then ask Kestrel on the board for the two closure cells.

**Open questions.** None in the unit. The prose-only print under the label stays, and I have not written its row.

**Blockers.** None. The WIP cap held the branch until #3940 merged.

**Doc-search query.** `a printed verdict line carries only status and population so the schema key is
missing` — board #691, memory `measure-a-population-with-the-consumers-parser`, the verdict-contract brief.
