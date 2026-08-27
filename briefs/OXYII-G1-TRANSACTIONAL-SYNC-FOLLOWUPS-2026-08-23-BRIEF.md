<!--
  OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS-2026-08-23-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-27 (**three of six boxes are executed and the label said `PROPOSED`, which means unstarted.** Corrected 2026-08-27 after reading the boxes rather than the header: Layer-3 validation **LANDED** (D-w1), the mutation-cache re-key passed its first-run control (**#1726**, `mmeta.py`), and the zero-mutant-module guard refuses on the induced failure. **NOT DONE** — the three open items are real and one is physically gated: the drop test awaits the next physical session, `pull_session` wiring is unblocked now §4's boundary was ruled 2026-08-24, and the fsync chaos-lane control is unbuilt. Found by `tools/brief-verified-index.mjs`, which ranked this brief as never claiming a verification — it does not, and three of its items shipped anyway.) · **Created:** 2026-08-23 · **Follows:** `OXYII-G1-TRANSACTIONAL-SYNC-2026-08-23-BRIEF.md` (DONE, #1702) · **Affects:** `capture-host/oxy_transfer.py`, `capture-host/pull_session.py`, `capture-host/tools/mutate.py`, `capture-host/tools/mutate_diff.py`

# G1 follow-ups — what execution left open, and what the gates taught while it shipped

G1 landed as a standalone module (#1702). This brief carries the items it deliberately did **not**
close, plus the tooling defects found while gating it — several of which are worth more than the
feature was.

---

## 1 · G1's own open items

| # | item | why it is open, not forgotten |
|---|---|---|
| 1.1 | **Layer-3 semantic validation** — record-boundary walk (10-byte header, 3-byte records, 48-byte trailer) | **BUILT — D-w1.** `oxy_transfer.verify()` now walks the Format-A grid: header signature + a whole number of 3-byte records between header and the 48-byte trailer + record count == trailer `total_seconds`. `VALIDATION_DEPTH` moved to `"size+finalised+records"`; old rows keep their recorded depth (honesty test-locked). Geometry MEASURED against real 95 KB / 81 KB `.dat` — the invariant is `(size-58)/3 == total_seconds`; the JS `ff ff` end-marker sits ~10 records before the trailer and would mis-count, so the size/trailer arithmetic is the reliable one, not the marker walk. Control: a right-sized, finalised file with a shifted grid (20 records, trailer claims 21) REDs where size+finalised passed. `check.sh` green (100% cov). |
| 1.2 | **The physical drop test** | decides `resume_strategy`'s one flag. Needs a ring wake. Until it runs, re-serve-from-start is the default because a wrong resume offset yields a right-sized, silently corrupt file. |
| 1.3 | **`pull_session` wiring** | held for review of the standalone module, per house pattern. ⚠️ Touches `pull_session.py` — see §4 for the G4 boundary question. |
| 1.4 | **fsync durability — a chaos-lane item, NOT a permanent unknown** | removing either fsync (file-before-verify, directory-after-rename) leaves all 51 tests green: *measured*, not assumed. Durability is not observable from a unit test but IS observable to fault injection, so this belongs to the OxyII chaos lane (the P7 analog). Filing it as untestable would be its own quiet false completion. |

## 2 · The mutation-cache defect — PROVEN, unfixed

**`mutate_diff` can return a verdict that is not reproducible from its inputs.** Seven runs, one rule:
**the first run after a test is ADDED does not credit it; that run refreshes the cache, so the next
run is correct.** A MODIFIED test is credited immediately, because its hash moves.

| run | change since previous | verdict |
|---|---|---|
| 2 | 7 tests **ADDED** | **STALE** (26 survivors) |
| 5 | 1 test **MODIFIED** | correct |
| 6 | 1 test **ADDED** | **STALE** (mutant reported surviving) |
| 7 | **NOTHING** | **correct** (same mutant reported killed) |

🔴 **Run 7 is the whole finding: identical tree, opposite verdict.**

**Why it survived to today: the evidence self-destructs.** Anyone who doubts a survivor re-runs, sees
it killed, and reads the first answer as a blip. And it is blind in exactly the loop the tool exists
for — see a survivor, write a killing test, re-run, be told nothing changed — which is the moment a
correct fix is most likely to be reverted. It nearly was: I concluded my new assertions were worthless
and started rewriting them.

⚠️ **"Clearing the cache fixes it" is a CONFOUND** and was this defect's founding evidence for two
weeks. The runs that "proved" it were *both* cache-cleared **and** second-runs-after-the-addition.
Run 7 isolated the variable with the cache fully intact.

**Fix, ratified but unbuilt:** re-key the verdict store on source **+ test** revision. Keep the
expensive artifacts (the generated mutants, the warm `.pyc` — the 22 min → 18 s the reuse exists for);
invalidate only what tests can invalidate. **Held to its control:** state-B → add-a-killer → the
**FIRST** run reports KILLED, with the `(N recorded as equivalent)` clause still present as a liveness
check. A control that runs the gate twice, or clears the scratch, passes today.
⚠️ Do not narrow it to added *files*: the addition that proved this went into an existing, already-copied file.

## 3 · The zero-mutant-module false green — root cause found, guard NOT shipped

**An entire module can drop out of the gate while being LISTED as covered.** Measured: all seven
`oxy_transfer` globs failed, `oxy_inventory` ran, and the gate printed `every mutant on the changed
functions was killed`, `EXIT=0`, `survivors: []` — with all seven functions named in the coverage list.

**Root cause is one layer below the obvious one.** `run_one` returns mutmut's real `rc` but sets
`"error"` for exactly one failure mode (`no test file names this module`). `mutate_diff` branches on
`"error"` alone, so **a crashed mutmut invocation is counted as a successful run** (`_ran += 1`).
That is why the existing `if _attempted and not _ran` refusal cannot see it either: the problem is not
that the refusal is all-or-nothing, it is that **nothing in the file distinguishes crashed from clean**.

⚠️ **`if r.get("rc")` is the tempting one-liner and is probably WRONG** — mutmut exits nonzero when
mutants merely survive, i.e. on every real finding. **Reason to measure, not a fact.**

**Ratified redesign:** count `exit_code_by_key` entries under the glob prefix in
`mutants/<module>.meta` — a *direct* measure of "were mutants actually tested" rather than a proxy.
Killed mutants are recorded there (unlike `mutmut results`, which lists only survivors and
not-checked), so a legitimately all-killed glob still has keys. **Held to the induced-failure control:
REFUSING where the same setup previously printed `EXIT=0`.**

`blind_modules()` is written and shelved: right shape, wrong signal. Its four selftest assertions pass
and three planted defects kill them — and it still **could never fire in production**. A perfect
control on a variable that does not carry the information.

## 4 · Boundary to settle before G4 starts

G4 (transition journal, reassigned to tepna-99) will touch `capture.py`'s `run_oxyii` region. G1's
wiring (§1.3) touches **`pull_session.py`**. These should not collide — **unless** G4's journal
instruments the *pull* lifecycle rather than only the capture lifecycle, in which case both reach the
same file. Worth confirming before either starts rather than discovering it in a rebase.

## 5 · Method findings — each bought by a specific failure

- **DECISION ASSERTED, PAYLOAD NOT.** 26 mutants survived a suite at 100% statement+branch coverage
  because every *decision* was asserted and none of its *payload* was — reason strings, the offset
  handed to the transport, bytes written on failure paths, the attempt number. In this module the
  reason is contract (carried so the ledger records the sentence the policy used), so a suite that
  never reads one is not testing what it claims.
- **THE BOUNDARY TEST THAT SITS OFF THE BOUNDARY.** `attempt > max_attempts` → `>=` survived because
  the bound test used 3-of-3, which skips under *both*.
- **SYMMETRIC ARMS, ONE COVERED.** `continue` → `break` survived in two loops because the skipped
  entries came **last**, where both keywords produce identical output. Fixing one arm left its mirror
  alive — the arms read symmetrically and only one was actually exercised.
- **AN ABSENT SIDE EFFECT IS A BETTER ALARM THAN A PRESENT ERROR.** The tell that caught the false
  green was the `(5 recorded as equivalent)` clause **vanishing** — five unkillable mutants cannot
  become killed. Same epistemics as an unchanged distill count. **A liveness check that must appear
  beats a failure check that must not.**
- **CI SILENCE CAN BE A CONFLICT, NOT A HANG.** A conflicted PR runs no workflows.
- **A MERGED BRANCH IS DEAD.** A push to it succeeds, prints `[new branch]`, and lands nowhere.
  Verify by grepping `origin/main` for an identifier, never by trusting push output.
- **A GREP BEAT AN AST WALK.** A second `Resume(` construction hid inside a `Selection(...)` argument
  list; the structural check for `return Resume(` missed what the plain grep caught.
- 🔴 **THE RULE THAT CAUGHT EVERYTHING: run it against the real failure before believing it.** Four
  confident mechanisms were walked back on this thread and **two would-be false greens were caught** —
  a registry-unlink that reported everything killed, and a guard whose own controls passed while it
  could never fire. Every survivor came from refusing to ship on reasoning; every walk-back came from
  reasoning that had not yet been run.

## 6 · Done when

- [x] Layer-3 validation lands, or is re-costed with a decision recorded — never implied to exist. **LANDED (D-w1):** record-boundary walk in `oxy_transfer.verify()`, `VALIDATION_DEPTH → "size+finalised+records"`, held to the shifted-grid control; geometry measured against real `.dat`.
- [ ] The drop test runs and `resume_strategy`'s flag is set from measurement. *(gated: next physical
      doff window — pull-before-restart order, watcher on the SYSTEM journal)*
- [ ] `pull_session` wiring lands, with §4's boundary settled first. *(§4 boundary RULED 2026-08-24,
      lead: per `oxy_lifecycle.py`'s own ratified docstring, G4's journal sees the pull only at daemon
      granularity — `PAUSED_FOR_PULL` / `PULLING` — so per-transfer pull lifecycle is the pull layer's
      OWN instrumentation in `pull_session`/`oxy_transfer`, not new G4 journal rows.)*
- [ ] fsync durability has a chaos-lane control that fails when either fsync is removed.
- [x] The mutation-cache re-key passes its FIRST-run control. *(DONE — #1726, `mmeta.py`: test-tree
      hash keys the reuse scratch; first-run-credits-an-added-killer control passes, mutation-verified.)*
- [x] The zero-mutant-module guard refuses on the induced failure, and `blind_modules` is either
      re-keyed onto a real signal or deleted rather than left shelved indefinitely. *(DONE — #1726,
      `mmeta.tested_count`: counts DECIDED exit codes per glob from `mutants/<module>.py.meta`; zero on
      a no-error run → refuse exit 2. Confirmed on real scratches: clean 389/389, crashed 0/320.)*

*(2026-08-24, coordinator note — method finding from execution, recorded so it isn't rediscovered:
`mutate_diff.py` itself sits OUTSIDE the unit-coverage floor — no test imports it and `tools/` has no
`__init__.py` — so a gate DRIVER is invisible to the coverage gate; that is why #1726's logic lives in
an imported root module (`mmeta.py`, 100% covered) with only thin wiring in the driver.)*
