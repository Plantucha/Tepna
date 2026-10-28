# Heron · unit 106 `defaults16`

## 1. Unit

Close row `2026-10-21-sixteen-literal-defaults-are-taken-by-no-production-call`: sixteen capture-host literal defaults that no call ever omits become required parameters.

## 2. Branch and worktree

Branch `claude/defaults16-hrn` in `~/wt-defaults16-hrn`, cut from `a3261c1fe`. `node_modules` symlinked from the primary checkout.

## 3. Exact stopping point

Twelve files changed: ten sources and two test files. Thirteen defaults are plain deletions. `as11_link.rpc` reads `def rpc(method, params=None, *, rpc_id: int, version: str)` at `as11_link.py:195`, and `capture._cpap_loop` carries a `*` ahead of `end_debounce_s` at `capture.py:11471`. Eighteen call sites now name those three parameters.

`capture-host/check.sh` under the primary checkout's venv interpreter reads `EXIT=0`, all gates green, 11569 passed, 3 skipped, `TOTAL 30548 0 10626 0 100%`, `Required test coverage of 100% reached` and `mypy=AT_BASELINE`.

`capture-host/tools/scan_signature_only_defaults.py --json` reads `uncovered` 20 before and 4 after, with `observable` 239 and `undecidable` 39 unmoved both times.

## 4. Next step

Commit the code, the changeset and this handoff. Push the branch. Open the draft PR. Append the row closure in a second commit. Run `npm run check` on that final tree. Then the report on board thread 8 carries the undraft ask.

## 5. Open questions

The owner may want any of the deleted values back as a named module constant. Three of them were separate copies of `30.0` for one CPAP poll interval, and no constant names that number today. A named constant is still a required argument at the call, so the question is naming rather than defaulting.

## 6. Blockers

None for the code. The row closure needs the PR number from `gh pr view`, so it cannot land in the first commit.

The gitleaks `home-path` rule reads each commit's added lines, so every commit here needs its own home-path check before the push. That rule cost unit 105 a branch rewrite.

## 7. The doc-search query

`node tools/doc-search.mjs "literal default taken by no production call signature-only mutant"` finds `capture-host/tests/test_literal_defaults_taken.py`, the scanner changeset `2026-10-20-scan-signature-only-defaults.md`, and board #1204 and #1255, which hold my two earlier measurements of this row's population.
