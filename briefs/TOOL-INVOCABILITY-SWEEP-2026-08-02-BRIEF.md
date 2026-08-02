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
