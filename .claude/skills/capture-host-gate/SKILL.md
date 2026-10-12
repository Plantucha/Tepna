---
name: capture-host-gate
description: Use when changing anything under capture-host/ — the Python gate to run, why a pytest invocation without --cov does not evaluate the coverage floor at all, and how to tell a missing tool from a failing gate. Use before committing a capture-host change, and when a pytest run looks green but you have not seen a TOTAL row.
---

# capture-host has its own gate

Run the script, not a hand-rolled pytest line: `capture-host/check.sh`. Rules: `CLAUDE.md` §🐍.

It is ruff · shellcheck · `pytest -q --cov --cov-branch --cov-fail-under=100` ·
`tools/find_unwired.py --check` · mypy against a ratcheting baseline.

- **A pytest line without `--cov` does not evaluate the floor at all.** The tell is that no `TOTAL`
  row was printed. A green run with no TOTAL row has not measured coverage.
- `shellcheck` missing exits **127** — a missing tool, not a failing gate. Install it or say it was
  absent; do not read 127 as a pass or as a real failure.
- Scanners must be written as `for … in enumerate(…)` or with a tokenizer. A hand-advanced `while`
  index **times out** under the mutation gate rather than failing, so mutmut reports UNDECIDED and
  `mutate_diff` refuses (exit 2, blocking even under `--report-only`).

## Measured

The missing-`TOTAL` tell is how a 100 % floor was reported satisfied by a run that never computed
coverage. The 127 case was read as a gate failure and chased before anyone checked whether the binary
existed.

Memory: `invoke-a-gate-the-way-the-gate-invokes-it`.
