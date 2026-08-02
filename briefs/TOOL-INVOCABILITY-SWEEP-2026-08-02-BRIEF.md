<!--
  TOOL-INVOCABILITY-SWEEP-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-02 · **Created:** 2026-08-02 · **Found-by:** repairing two dead tools in PR #686 and asking whether there were more

# Four committed tools could not find their own checkout — and no gate could have noticed

## 1 · The class

`tools/` holds 43 scripts. Most are **operator sweeps over gitignored captures**, so **no gate runs them**
— and a tool no gate runs is a tool nobody notices is dead. PR #686 repaired two by accident:

```
o2ring-finger-validate-batch.mjs   ROOT = '…/wt-fingerval'   worktree deleted the same day
o2ring-finger-roundtrip.mjs        ROOT = '…/wt-fingerrt'    same
```

Both threw `ERR_MODULE_NOT_FOUND` on their first import **since the commit that added them**, for
everyone including their author, while two briefs cited them as evidence. This brief asks the obvious
follow-on question — *how many others?* — and answers it by running things, not by reading them.

## 2 · What the sweep found

**All 14 committed `--selftest`s pass.** That is a real result and it is why the answer is not "the tools
are rotten": the ones with a self-check are healthy.

The damage is in the tools *without* one. Two more, beyond PR #686's pair:

| tool | defect | symptom |
|---|---|---|
| `tch-reference-validation.mjs` | `REPO = '/media/…/GENOME/Michal/Tepna'` — a mount that does not exist | ran, ENOENT'd on **every** module, produced nothing |
| `acc-acc-control.mjs` | `REPO = argv[2] \|\| '/run/media/…/Tepna'` | **ran fine, on the wrong tree** |

`tch-reference-validation.mjs` is the sharper lesson. The comment directly above the dead constant
already called it *"the stale REPO below"* and routed `build-core.js` around it — then left every DSP
load pointing at the dead path anyway. **A comment recording a defect is not a fix**
(`ENGINE-VERIFICATION` §0). Repaired, it works: it now prints real per-night CPAP/ECG/PPG respiratory
comparisons (`2026-06-10: 6 epochs — CPAP 16.3 · ECG 16.9 · PPG 15.7 br/min`).

`acc-acc-control.mjs` is the more dangerous one, because it never failed. Run inside a **worktree** it
loaded `build-core.js` and every DSP from the **main checkout** — so it measured a different tree's code
and reported the answer as this one's. Several sessions work this repo in parallel worktrees, and
`CLAUDE.md` §👥 exists because one of them *"spent an hour debugging a broken build that was actually
another session's in-flight `clock.js`"*. This makes the same confusion **silent**. Demonstrated before
fixing: from `wt-toolsweep`, its root resolved to `…/Tepna/ppgdex-dsp.js` — a different tree.

## 3 · The gate

`tests/dex-tests.js`, group `tools · source-scan · portability`. Scope is **read from `tools/` on disk**,
never curated — a hand-maintained list is the failure `DEEP-AUDIT-III` §1.4 already documented. Node-lane
only (the browser cannot list a directory), like `docs-ledger`.

1. **A tool that loads repo code must DERIVE its root**, checked on the line that *defines* it.
2. **No tool may hardcode a checkout root** (`…/Tepna`, `…/wt-*`).

Measured before writing: **22 of 43 tools load repo code, and after the repairs all 22 pass** — zero
exemptions, zero grandfathering.

### 3.1 · Three drafts of this gate were wrong, and mutation found each

- **Draft 1 tested `/import\.meta\.url/` anywhere in the file.** Nearly hollow: almost every tool writes
  `createRequire(import.meta.url)`, so the *original* `acc-acc-control.mjs` — hardcoded root **and** that
  call — would have passed. A mutation that hardcoded the root left the second occurrence behind and the
  assertion stayed green.
- **Draft 2 demanded the URL on the defining line.** Flagged four correct tools (`build.mjs`,
  `pb-fusion-blast`, `ppg-gap-bridge-scan`, `trio-batch`) that derive `ROOT` from a `__dirname`.
- **Draft 3 followed one hop.** `trio-batch.mjs` chains three (`import.meta.url → __filename → __dirname
  → ROOT`). The rule is now a **transitive closure**, which is the general answer rather than an
  exemption list.
- **The absolute-path rule was too broad**, flagging `tch-reference-validation`'s `Ecg nightly` corpus
  default. That is **data**: env-overridable, and it does not decide which code runs. Narrowed to
  checkout roots, which is what the assertion's own comment had claimed all along.

### 3.2 · Mutation-verified, both assertions, each catching what the other misses

```
hardcode a checkout root                      → ✕ both assertions
hardcode root, keep createRequire(…url)       → ✕ both  (draft 1 was blind to this)
root = process.cwd() instead of file location → ✕ derivation only  (not a literal, so rule 2 is blind)
restore                                        → green, 22/22 derived, 0 of 43 hardcoded
```

## 4 · Done when

- [x] Every `--selftest` in `tools/` run: **14/14 pass**.
- [x] Every other non-writing tool smoke-tested for load failure; the two survivors of PR #686 found and
      repaired (`tch-reference-validation.mjs`, `acc-acc-control.mjs`).
- [x] The class gated with derived scope and zero exemptions, mutation-verified in both directions.
- [x] `acc-acc-control.mjs` also given a `--help` path — `argv[2]` was consumed as a repo root, so
      `--help` became `require('--help/tools/build-core.js')`.

## 5 · What this does NOT cover, stated so it is not over-read

- **Writing tools were excluded from the smoke test on purpose** (`build*`, `release`, `regen-*`,
  `verify-fixtures`, `make-*`): invoking them bare would modify the tree. They are covered by rules 1–2
  statically, and by CI for the ones CI runs.
- **A tool can still be dead for reasons a source scan cannot see** — a wrong corpus default, a renamed
  export, a changed file format. The only real defence is a `--selftest`, and **29 of 43 tools have
  none**. That is the residue, and it is the natural follow-up: the 14 that have one all pass, which is
  precisely why they are the healthy half.


## 6 · First sweep with `tools/mutate.mjs`, and the first triage (2026-08-02)

The harness landed in PR #692; this is what it found on its first real use, and what was done about it.

**A defect in the harness came first.** About a third of the initial survivors were mutations of
**prose** — a `<` in a block-comment body, a trailing `// 90 min` after real code, digits inside an
HTML string. The line filter skipped lines that *began* with a comment marker, which is not the same
as "is a comment". Fixed with a per-character code mask (PR #694). It matters for honesty as well as
noise: prose survivors **depress** the kill rate, so the first numbers were wrong pessimistically.

Sampled 40 mutants per module (`oxydex-dsp.js` alone generates **2665**, so these are samples, not
audits, and the rates should not be read to two significant figures):

| module | tested | killed | survived | kill rate |
|---|---|---|---|---|
| `oxydex-dsp.js` | 40 | 17 | 23 | 42 % |
| `integrator-tch.js` | 40 | 15 | 25 | 37 % |
| `pulsedex-dsp.js` | 40 | 9 | 31 | 22 % |

### 6.1 · Two holes closed, and the loop verified end to end

- **`oxydex-dsp.js:624` — the physiological sanity filter.**
  `if (spo2 < 50 || spo2 > 100 || hr < 20 || hr > 250) continue;` The first `||` could be `&&` with
  the suite green: nothing tested the guard between a garbage CSV row and every downstream statistic.
  Now gated by one out-of-range row per axis (each tripping exactly one disjunct, which is what kills
  the `&&` mutant) plus the four **boundary** values 50 / 100 / 20 / 250, which must be KEPT — those
  are what kill the `<`→`<=` mutants — plus an in-range control so a green result cannot mean "the
  parser returned nothing".
- **`integrator-tch.js` — the `need three series` guards** in `threeCorneredHat` and `allanTriplet`.
  Every existing test passed all three corners, so the precondition was only ever exercised satisfied.
  Nothing had called it with exactly ONE corner missing — the case that actually occurs when a device
  does not record. Now gated with each corner omitted in turn. The mutant's failure mode is the useful
  part: without the guard the code **throws** in `pairDiffVar`, so it is preventing a crash, not
  tidying a return value.

Both verified by re-applying the exact reported mutants and watching the new tests red — the harness
found the hole, the test closes it, the harness confirms the close.

### 6.2 · Triaged as NOT actionable — recorded so it is not re-derived

`integrator-tch.js:279` `if (sol && sol.a >= -1e-6 && sol.b >= -1e-6 && sol.c >= -1e-6)` — the
`>=`→`>` mutant survives and **should be left alone**. Killing it requires a solution landing exactly
on `-1e-6`, which is not constructible from a `Vab/Vac/Vbc` triple. This is the "legitimately
untestable float boundary" category the tool's own header warns about, and it is the reason mutation
output is a **lead list, not a defect list**. Worth noting the temptation: this same boundary decides
the degenerate-night verdict for **8 of 39 corpus nights** (§6 of `TRIO-ARTIFACT-GATE-AND-N15-POWER`),
so it *looks* like it deserves a test — but the untested thing is the exact-equality case, which
cannot occur.

### 6.3 · Not triaged, and stated so

**Loop bounds dominate the remaining survivors** (`i < N` → `i <= N`). In JS an overrun yields
`undefined` rather than throwing, so many are real weak spots — but they are also the cheapest to
wave away, and they have NOT been examined. And some survivors mean *"no test reaches this function
at all"* rather than *"the assertion is weak"*: `pulsedex-dsp.js:208`'s `acc / 1000` → `acc / 0`
survives, making timestamps `Infinity` unnoticed, which points at an unexercised path. Different
problem, same symptom, and the tool cannot tell them apart.


## 7 · The 40 unmeasurable files, audited (2026-08-02) — the real number is ZERO

§6's residue read *"29 of 43 tools have no `--selftest`"* and, for the shipped roster, *"40 of 111 files
have no tagged group"*. The second was audited on the owner's instruction, and the raw count was
misleading in the reassuring direction once each file was classified rather than counted.

| | n | what it actually is |
|---|---|---|
| **A · mis-tagged** | **7** | Already reachable via `env.X` in `dex-tests.js` — the groups exercise them, the tag just did not name the module, so the mutator could not select them. |
| **B · other harness** | 4 | Covered by `verify-manifest` / `build-core-tests` / the browser gates: `provenance-ledger`, `provenance-banner`, `dex-actions`, `overdex-app`. |
| **C · DOM-bound** | 28 | app / render / chart / analysis-UI. The headless suite structurally cannot drive them; that is the browser lane's job (`Dex-Test-Suite.html?full`). |
| **D · genuine gap** | **0** | `dex-contracts.js` was the lone candidate — and it is **types-only**: 126 lines of JSDoc `@typedef`, not inlined in any bundle, exporting a version stamp. It is listed in `tsconfig.json` and checked by `tsc --noEmit --checkJs`. There is no behaviour to mutate. |

**So "40 files the mutator cannot see" was never 40 files without tests.** It was 7 tags, 4 files under a
different harness, 28 files in the wrong lane, and one file with no runtime behaviour at all. Counting
is not classifying, and the raw number invited exactly the wrong conclusion.

### 7.1 · The 7 tags, added mechanically

Not hand-picked: for each module, every group whose body references its `env` symbol had the module
stem appended to its tag — **18 groups** across `signal-adapters` (9), `signal-spec` (4), `cohort-gen`
(3), `hrvdex-registry` (3), `cpapdex-registry` (3), `glucodex-registry` (2), `pat-gate` (1). Measurable
files: **71 → 78**.

Measured immediately, because a tag that selects the wrong groups is worse than no tag:

```
 41 %  signal-adapters.js    5/12  ( 27 mutants, 9 groups)
 50 %  cpapdex-registry.js   6/12  ( 15 mutants, 3 groups)
 50 %  glucodex-registry.js  6/12  ( 12 mutants, 2 groups)
 66 %  signal-spec.js        8/12  ( 13 mutants, 4 groups)
 66 %  cohort-gen.js         8/12  (236 mutants, 3 groups)
 77 %  hrvdex-registry.js    7/ 9  (  9 mutants, 3 groups)
 83 %  pat-gate.js          10/12  ( 32 mutants, 1 group)
 ──    50/81 = 61 % across the seven
```

Nothing catastrophic, and `pat-gate` — the promotion gate `ENGINE-VERIFICATION` §1.5 single-sourced —
is among the strongest in the fleet. The residue is now **C alone**: 28 DOM-bound files whose coverage
question belongs to the browser render lane, not to this tool.
