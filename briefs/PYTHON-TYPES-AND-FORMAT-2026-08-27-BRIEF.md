<!--
  PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **Created:** 2026-08-27 · **Owner decision** ("alright, mypy ruff then" — mypy adopted; black's STYLE via `ruff format`, not the black tool) · **Interlocks:** `QWEN-ENGINEERING-PROGRAM-2026-08-27-BRIEF.md` (the qwen fix lane runs under its §0 + precision bands), `MUTATION-ACCOUNTING-LOOP-2026-08-27-BRIEF.md` (format-wave cost to mutation state)

# Python types + format — mypy and ruff-format for capture-host, measured first

## 0 · The decision and its numbers (sized before opining, 2026-08-27 22:15)

- **mypy**: `--ignore-missing-imports --explicit-package-bases` over 278 source files →
  **189 errors in 41 files**. Top classes: Argument-type 68 · incompatible assignment 27 ·
  missing annotation 12 · unsupported operands 11. The codebase is already densely annotated
  (typed dataclasses, `X | None` unions, keyword-only signatures), which is why the wave is this
  small — and why the argument/assignment classes overlap the "can it silently mislead" defect
  class the mutation program hunts: some of the 189 are likely real findings, not pedantry.
- **format**: `ruff format --check` → **263 of 279 files would reformat**. The style is black's
  (ruff-format is black-compatible); the TOOL is ruff because it is already the lane's linter —
  adding literal black would create a second formatter authority to keep aligned forever.
- **🔴 The big-bang cost that forbids a one-shot reformat:** the mutation program's accumulated
  state — canaries `(line, op, before)`, journal keys `line\0op\0before\0after`, equivalence
  entries keyed on before/after text — is keyed on LINE TEXT AND NUMBERS. A 263-file wave
  orphans essentially all of it at once. The ledgers are designed to exclude orphans rather than
  lie, so nothing breaks — but the known-answer record's value is lost until re-derived. Hence:
  **incremental adoption** — format enforced on CHANGED files only, so mutation state stales
  exactly where it would have staled anyway as files change.

## 1 · Phases

- **§P1 — advisory wiring (DONE in this PR).** `check.sh` gains an ADVISORY section that runs
  and reports but cannot fail the run: `mypy` (full-tree error count against the recorded 189
  baseline — the number must only go DOWN) and `ruff format --check` on files changed vs
  `origin/main` (honest "0 changed files in scope" line when none). Advisory here is not the
  ignorable kind: both print their counts in the summary block, and the flip conditions are
  pre-stated below, not negotiable per-PR. `mypy` is pinned in `requirements-dev.txt` (new).
- **§P2 — the burn-down, split by qwen's measured profile (owner-asked, owner-approved):**
  - **qwen lane (~the mechanical share):** per-error patch proposals for annotation gaps,
    Optional handling, container types. Verifier = mypy delta + full `check.sh` (the 100 % floor
    and the mutation gate catch behavior changes). Rails: no `Any`, no bare `type: ignore` —
    a proposal using either is auto-rejected (the lazy path makes the count drop while adding
    nothing); every proposal human-read before landing, per §0 of the qwen program. **The lane's
    precision metric is its fix-acceptance rate**, tracked in the findings ledger under lens
    `mypy-fix`, same pre-stated bands as every lens: <30 % accepted after 30 triaged ⇒ retire
    the lane; it is the program's first code-fix experiment and earns or loses that scope here.
  - **session lane (the judgment share):** the 68 Argument-type + 27 assignment errors triaged
    eyes-first (Vigil box's lane) — each is either an annotation fix or a REAL logic finding,
    and that call is exactly what the model measurably cannot make.
- **§P3 — the flips, pre-stated:** mypy flips BLOCKING when the count reaches 0 (typed-ignores
  with reasons count as 0; bare ignores do not exist by rail). Changed-files format flips
  BLOCKING after one fleet-notice cycle (so no in-flight branch reds by surprise). Both flips
  land in `check.sh` AND the CI capture-host workflow in the same PR.
- **§P4 — explicitly NOT planned:** a big-bang reformat (see §0's cost); mypy `--strict`
  (re-size after the 189 reach 0); black-the-tool.

## 2 · Done when

- [x] §P1 advisory gates in `check.sh`, mypy pinned, baseline 189 recorded (2026-08-27).
- [ ] §P2 qwen lane produces its first 30 triaged proposals; acceptance rate recorded; band applied.
- [ ] §P2 session lane triages the argument/assignment classes; real-bug findings ledgered.
- [ ] §P3 mypy blocking at 0; changed-files format blocking after fleet notice.
- [ ] Follow-up brief if the qwen fix lane earns expansion (its acceptance rate is the evidence).
