---
bump: patch
type: added
brief: none
---

The capture-host suite now runs under a **per-test bound**, so a hanging test produces a named FAILED
test instead of nothing at all. Measured 2026-09-24: a `check.sh` run for a PR that had already merged
sat at **99 % CPU for four hours** with no exit code, no failing test and no coverage table — which is
byte-for-byte how a merely SLOW gate presents (CLAUDE.md §4c), on a suite whose honest runtime is 8
minutes. `pytest-timeout` was declared nowhere and installed nowhere, so no invocation in the lane
could bound anything.

`pytest-timeout>=2.4.0` joins `requirements-dev.txt` and the CI job's inline install; the bound is
`PYTEST_TIMEOUT_S` (default **180 s**) in `check.sh` and `--timeout=180` on the CI pytest line, which
does not run `check.sh`. A test asserts the two numbers agree — the same shape as the `mutmut` pin.

**The bound is derived, and measured the way the gate runs.** Slowest single test on main: **31.98 s**
of 8314 `--no-cov` — but the gate runs WITH coverage, where the same test is **36.99 s** (+16 %), and a
bound derived from the faster configuration is derived from a run nobody performs. 180 s is 4.9× that. The quantity being caught was four hours —
80× the bound — so precision buys nothing while headroom buys the only thing that could make this
change harmful: it cannot convict a working test on a contended box.

**An absent plugin is ANNOUNCED, not silent.** This is the one place `check.sh` departs from its own
`XDIST`-when-present pattern, and on purpose: a venv without xdist runs the identical gate slower, so
silence there is true, while a venv without `pytest-timeout` runs it with **no bound at all**. A guard
that is missing and says nothing is the defect the bound exists to fix, so the warning names what is
lost ("a hang here produces no verdict") rather than reporting a missing package.

**Not wired into `pyproject.toml`'s `addopts`, deliberately.** That would bound every pytest run in the
repo including the mutation gate's, silently converting a hanging mutant from its own verdict into a
KILL — and `RUN-POLAR-MUTATION-STOP-HERE-2026-08-09-BRIEF.md` §7 decided the opposite ("a hang is now
its own verdict, never a kill"). Changing a mutation-ledger semantic is not this unit's to make.

Residue row `2026-09-24-a-hanging-test-had-no-verdict` closed by this change.
