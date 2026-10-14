<!--
  API-LANE-FINDINGS-2026-10-13-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->
**Status:** PROPOSED — 2026-10-13 · **Created:** 2026-10-13 · **Residue:** 2026-10-13-oxydex-coverage-segments-reach-the-integrator-as-strings, 2026-10-13-computehradvanced-keeps-an-absent-hr-as-a-sample

# API coder lane findings — 2026-10-13

On 2026-10-13 the owner ordered the fleet to spend the API credit balance on autonomous coder sessions. Five lanes ran from 18:40 to 20:41 EDT. The API then refused every session with a billing error. This brief keeps every verdict, every patch and every lesson, so nothing from that run is lost. The full ledger is `audits/API-LANE-VERDICTS-2026-10-13.json`, one object per row, with each patch text embedded.

Each lane fed one RESIDUE row, mutant, brief or audit cell to a managed agent. The agent read the repo at a pinned commit and answered PATCH, NO_PATCH or NOT_A_DEFECT. A PATCH carries a test. The agent says the test fails on the base commit. **Every verdict is the agent's self-report.** A patch counts only after a local re-run shows the test red on main and green with the patch. Kestrel re-ran that proof for 13 of the 35 PATCH verdicts, column `proof` below.

## 1 · What ran

| lane | input | rows done | PATCH | NO_PATCH | NOT_A_DEFECT | LOST | cents |
|---|---|---|---|---|---|---|---|
| max | open RESIDUE rows | 100 of 52 | 14 | 72 | 14 | 4 | 2704 |
| max1 | every RESIDUE row, open and closed | 72 of 104 | 12 | 60 | 0 | 4 | 5502 |
| mutants1 | surviving mutants in the mutation ledger | 21 of 30 | 3 | 12 | 6 | 2 | 1767 |
| briefs1 | PROPOSED briefs | 13 of 14 | 4 | 9 | 0 | 0 | 1507 |
| audit | file × AUDIT-PROMPT bug class | 2 of 92 | 2 | 0 | 0 | 4 | 2261 |
| total | | | 35 | 153 | 20 | 14 | 13741 |

The residue lanes read the repo at `eef31a054`. The audit lane read it at `67db6ffca`. A LOST row is a session that the billing refusal ended before it wrote a verdict. Its cost is real and its findings are gone. The max and max1 lanes overlap, so one key can carry two verdicts.

## 2 · PATCH verdicts

| key | lane | file | proof | next |
|---|---|---|---|---|
| `2026-09-23-heredoc-strip-is-decided-once-for-many` | max, max1 | `.claude/hooks/guard-shared-tree.sh` | PROVEN (verify-lane) | hook file: own PR held `do-not-merge`, the owner merges |
| `2026-09-23-loss-audit-cannot-attribute-a-night-with-no-file` | max, max1 | `CAPTURE-LOSS-PRECEDENCE-AUDIT-2026-09-22-BRIEF.md` | PROVEN; landed in #3577 | none |
| `2026-09-27-load-bearing-sources-no-gate-can-read` | max, max1 | `tests/run-tests.mjs` | PROVEN; landed in #3577 | none |
| `2026-09-29-fold-session-merge-rule-is-module-local-to-trio-batch` | max, max1 | `tools/trio-batch.mjs` | PROVEN; landed in #3577 | none |
| `2026-10-05-the-js-mutation-job-cannot-finish-on-the-pr-that-makes-its-own-target-fast` | max, max1 | `.github/workflows/mutation.yml` | PROVEN; landed in #3577 | none |
| `2026-10-06-parsetimestr-zero-on-unparseable` | max, max1 | `oxydex-dsp.js` | PROVEN; landed in #3577 | none |
| `2026-10-06-the-test-lanes-two-inventories-disagree-undetected` | max | `Dex-Test-Suite.html` | PROVEN (verify-lane) | follow-up PR A with the two rows below |
| `2026-10-07-nadir-ramp-max-sec-is-a-duration-applied-as-an-index-count` | max, max1 | `oxydex-dsp.js` | PROVEN; landed in #3577 | none |
| `2026-10-10-a-closes-residue-claim-is-never-checked-against-the-row` | max | `briefs/RESIDUE.md` | NOT PROVEN: the patch carries no test hunk | re-derive the test, then verify |
| `2026-10-11-one-module-list-in-six-tool-literals` | max | `tools/measurement-walk.mjs` | PROVEN (verify-lane) | follow-up PR A |
| `2026-10-12-load-bearing-sources-debt-is-six-of-eight-unpaid` | max | `tests/dex-tests.js` | PROVEN (verify-lane) | follow-up PR A |
| `2026-10-12-seven-hooks-exit-before-draining-stdin-and-their-tests-cannot-see-it` | max | `#3493` | SUPERSEDED: #3572 landed the fix | none |
| `2026-10-12-the-night-band-mixes-a-floating-stamp-with-a-local-epoch` | max | `capture-host/nightqc.py` | UNVERIFIED | re-run the test on main, then with the patch |
| `2026-10-12-four-capture-host-runtime-libraries-are-named-in-no-licence-doc` | max | `THIRD-PARTY.md` | NOT PROVEN: a doc-only check the verifier refuses | add the THIRD-PARTY rows by hand |
| `2026-09-23-avahi-renames-the-box-after-a-quick-reboot` | max1 | `capture-host/deploy/tepna-capture.service` | PROVEN by hand (5 red → 5 green) | owner decision: it edits the deployed unit |
| `2026-09-29-oxydex-counts-rows-as-seconds` | max1 | `oxydex-dsp.js` | UNVERIFIED | re-run the test on main, then with the patch |
| `2026-10-03-verity-ppg-moves-in-a-ring-seam-refold` | max1 | `ppgdex-dsp.js` | UNVERIFIED | re-run the test on main, then with the patch |
| `2026-10-10-doc-search-chunker-splits-surrogate-pairs` | max1 | `tools/doc-search.mjs` | UNVERIFIED | re-run the test on main, then with the patch |
| `2026-10-12-filename-stamp-consumers-split-twelve-convert-four-identify` | max1 | `capture-host/loss_audit.py` | UNVERIFIED | re-run the test on main, then with the patch |
| `nightqc.x_summarize__mutmut_17` | mutants1 | `capture-host/nightqc.py` | UNVERIFIED | re-run the test on main, then with the patch |
| `nightqc.x_summarize__mutmut_20` | mutants1 | `capture-host/nightqc.py` | UNVERIFIED | re-run the test on main, then with the patch |
| `nightqc.x_summarize__mutmut_103` | mutants1 | `capture-host/nightqc.py` | UNVERIFIED | re-run the test on main, then with the patch |
| `brief-ahi-surrogate-refit-sizing-2026-10-12` | briefs1 | `briefs/AHI-SURROGATE-REFIT-SIZING-2026-10-12-BRIEF.md` | UNVERIFIED | re-run the test on main, then with the patch |
| `brief-mutation-survivor-ledger-2026-09-28` | briefs1 | `briefs/MUTATION-SURVIVOR-LEDGER-2026-09-28-BRIEF.md` | UNVERIFIED | re-run the test on main, then with the patch |
| `brief-o2ring-power-aware-ble-lifecycle-2026-09-05` | briefs1 | `briefs/O2RING-POWER-AWARE-BLE-LIFECYCLE-2026-09-05-BRIEF.md` | UNVERIFIED | re-run the test on main, then with the patch |
| `brief-open-dataset-ahi-derivation-2026-10-12` | briefs1 | `briefs/OPEN-DATASET-AHI-DERIVATION-2026-10-12-BRIEF.md` | UNVERIFIED | re-run the test on main, then with the patch |
| `audit-2026-10-13-oxydex-dsp-units-clock` | audit | `oxydex-dsp.js` | PROVEN (verify-lane) | audit PR B |
| `audit-2026-10-13-oxydex-dsp-siblings` | audit | `oxydex-dsp.js` | PROVEN (verify-lane); moves one fixture | audit PR B |

Follow-up PR A carries three proven patches that share `tests/dex-tests.js`, `tests/run-tests.mjs` and `Dex-Test-Suite.html`. Audit PR B carries the two OxyDex patches. It re-bundles OxyDex, both orchestrators, the analysis tools and the docs copies, re-runs `tools/verify-fixtures.mjs`, and regenerates the gap fixture with `tools/regen-oxydex-goldens.mjs`.

## 3 · NOT_A_DEFECT verdicts

The agent reports that the row is already fixed, already ruled, or records an event and not code. Kestrel has not checked these claims. A row closes as `withdrawn` only after a human reads the claim against the code.

| key | lane | the agent's claim |
|---|---|---|
| `2026-09-20-oxydex-resprate-pair-is-owner-blocked` | max | On eef31a05 the question the row calls open is already answered in code: oxydex-dsp.js sets `var respRate = null;` under a comment recording the owner's 2026-09-15 decision to not publish it (r = 0.046), and the export emits `respRate: n.respRate \|\| null`. T… |
| `2026-09-22-widening-merged-ahead-of-its-tests` | max | The row records a one-off ordering event, not code. On this sha the widening is in capture-host/mutation_diff.py (`_subdir_index` ×2 definition and uses). The `only_after_*`/`only_here` fixtures are in capture-host/tests/test_mutation_scratch_reuse.py. The `_s… |
| `2026-09-22-sentinel-waiter-outlives-its-producer` | max | On this sha §👥.4 option 3 already carries a `kill -0 "$PID"` guard beside the sentinel for the launching shell, a deadline loop for a different shell, and the reason both forms are kept; the existing group 'CLAUDE.md §👥.4 — the EXIT= sentinel carries a livenes… |
| `2026-09-24-optical-worn-calls-a-removed-verity-worn-in-the-dark` | max | At eef31a05 the defect is already fixed: `optical_worn` returns `False` (bright) or `None` (dark) and never `True`, with `ambient_level_undecidable` naming the dark case, and a direct probe of the row's own values (ambient -185 → -98, and 3951) at 55 Hz gave `… |
| `2026-09-25-owner-queue-d1-has-no-verdict` | max | On eef31a05 the D1 section (line 74) already carries a ✅ RULED 2026-10-13 marker (owner wears the devices tonight for D10 only, and the clean worn night follows once the probe is off), so the logged absence of a verdict is gone; I made no edit, and one stale s… |
| `2026-09-27-sample-shortfall-without-a-time-gap-is-unmeasured` | max | The sample-based measure the row asks for already exists as loss_audit.sample_completeness and _completeness_of_run (landed in #3515, in capture-host/loss_audit.py, which cites this key), published beside the time-based ledger and never folded into the grid, a… |
| `2026-10-03-verity-ppg-moves-in-a-ring-seam-refold` | max | On the base sha the Verity export carries its own offset steps: every moved PpgDex night has an old-export hostAxis.spreadMs over the 10 000 ms PPG_OFFSET_STEP_BOUND_MS (11.8–54.5 s) or a refused axis, none of the 49 unmoved nights with an axis exceeds 9.19 s,… |
| `2026-10-03-corpus-tier-24g-peak-is-not-known-to-be-held` | max | The tool's own process stays at about 89 MB peak RSS while copying 2 GB and hashing 3.4 GB, and the OS page cache absorbed the I/O, which matches the cache-charge reading of the 24.8G figure; the held-heap reading is not supported, and the tool has no code pat… |
| `2026-10-04-the-rings-stream-offset-field-is-device-dead` | max | The defect is already fixed on this sha, in pat-feasibility-worker.js by #3274 and #3471. A constant ring offset refuses as `ring-offset-never-advances`, keyed on non-advance and not on the value 0. `ringLegRefusal` ranks that structural reason above floorMap'… |
| `2026-10-06-two-registry-ids-are-structural-not-drifts` | max | On eef31a05 both ids are already adjudicated: `crCoupling` has no key in ecgdex-registry.js (removed 2026-10-10, only comments remain; its label alias routes to `crcPLV`), and `cmpResidSD` carries `emittedAt: 'scale.residSD'`, which the resolvability gate walk… |
| `2026-10-12-the-trim-hook-is-superlinear-in-the-command-length` | max | The base commit eef31a05 (#3573) is itself the fix: it replaced the quadratic `last="${cmd##*\|}"` with the linear `rest="${cmd%\|*}"` cut, and the defect shows only on the parent commit, not on this sha.… |
| `2026-10-12-a-command-over-arg-max-escapes-the-trim-hook-with-jq-noise` | max | The base commit eef31a05 (#3573) already adds TRIM_MAX_CMD=126000 and the check `[ "$cmd_bytes" -gt "$TRIM_MAX_CMD" ] && exit 0`, which runs before any scan or jq call, so the over-limit command no longer prints jq noise; the briefs/RESIDUE.md rows still say O… |
| `2026-10-12-published-trio-numbers-cite-a-digest-a-refold-stalens` | max | At eef31a05, the 10-03 record's citation of closure 23ce26ba72921405 is accurate history for a superseded record: #3521 (a596d470, merged after the row was filed) re-folded the corpus under 54df21a0a400403d (89/89 .trio-stamp files), added tch-pooled-hat-2026-… |
| `2026-10-12-ste-lint-skips-table-cells` | max | #3502 (92e3485a) landed 37 minutes after the row's 117f8427 measurement and is an ancestor of eef31a05. It added scan() with checked+excluded=eligible, a NOT_RUN reason naming the skipped lines, and the pr-compliance 'ste-population' check, which refuses a non… |
| `nightqc.x_summarize__mutmut_133` | mutants1 | py, briefs/RESIDUE.md, capture-host/nightqc.py, capture-host/tests/test_qc_judged_session.py; `git grep -n 'summarize' -- capture-host/tests` → test_nightqc.py:47-48 (_summarize wrapper), test_device_identity.py:59-60, test_frozen_stream_alert.py:83-107, test_… |
| `nightqc.x_summarize__mutmut_100` | mutants1 | py, capture-host/nightqc.py, capture-host/tests/test_nightqc.py, briefs/QC-SCOPE-RESOLUTION-2026-07-28-BRIEF.md; `git grep -n daemon_starts -- capture-host/tests` → test_nightqc.py:6516 and :6537 (which kill mutants 21/101/104), test_starts_sidecar.py, test_ti… |
| `nightqc.x_summarize__mutmut_132` | mutants1 | py, DOCS-INDEX.md, briefs/RESIDUE.md, capture-host/nightqc.py, capture-host/pyproject.toml, tests/test_device_identity.py, tests/test_qc_judged_session.py, tests/test_solid_night_inputs.py; `git grep -n summarize -- capture-host/tests` → test_nightqc.py, test_… |
| `nightqc.x_summarize__mutmut_314` | mutants1 | py, CHANGELOG.md, briefs/CAPTURE-HOST-DEEP-AUDIT-2026-07-26-BRIEF.md, briefs/RESIDUE.md, capture-host/nightqc.py, and `git grep -n 'summarize' -- capture-host/tests` → 272 hits in 21 files, including test_nightqc.py::test_a_clockless_file_falls_back_to_the_ses… |
| `nightqc.x_summarize__mutmut_329` | mutants1 | md, capture-host/tests/test_nightqc.py, CHANGELOG.md, briefs/CAPTURE-HOST-DEEP-AUDIT-2026-07-26-BRIEF.md, capture-host/nightqc.py, plus `git grep -n summarize -- capture-host/tests` → 272 hits in 21 files, the only dev_span hit being test_nightqc.py:6460, whos… |
| `nightqc.x_summarize__mutmut_234` | mutants1 | md, briefs/RESIDUE.md, capture-host/nightqc.py (the mutmut_173 note), capture-host/tests/test_nightqc.py, plus `git grep -n summarize -- capture-host/tests` → test_nightqc.py:47-48, test_device_identity.py:59-60 and test_frozen_stream_alert.py:83-107; these hi… |

Two lanes disagree on these keys. A disagreement is a reason to read both answers, not a verdict.

| key | verdicts |
|---|---|
| `2026-09-20-oxydex-resprate-pair-is-owner-blocked` | max: NOT_A_DEFECT, max1: NO_PATCH |
| `2026-09-22-widening-merged-ahead-of-its-tests` | max: NOT_A_DEFECT, max1: NO_PATCH |
| `2026-09-22-sentinel-waiter-outlives-its-producer` | max: NOT_A_DEFECT, max1: NO_PATCH |
| `2026-09-23-avahi-renames-the-box-after-a-quick-reboot` | max: NO_PATCH, max1: PATCH |
| `2026-09-24-optical-worn-calls-a-removed-verity-worn-in-the-dark` | max: NOT_A_DEFECT, max1: NO_PATCH |
| `2026-09-25-owner-queue-d1-has-no-verdict` | max: NOT_A_DEFECT, max1: NO_PATCH |
| `2026-09-27-sample-shortfall-without-a-time-gap-is-unmeasured` | max: NOT_A_DEFECT, max1: NO_PATCH |
| `2026-09-29-oxydex-counts-rows-as-seconds` | max: NO_PATCH, max1: PATCH |
| `2026-10-03-verity-ppg-moves-in-a-ring-seam-refold` | max: NOT_A_DEFECT, max1: PATCH |
| `2026-10-03-corpus-tier-24g-peak-is-not-known-to-be-held` | max: NOT_A_DEFECT, max1: NO_PATCH |
| `2026-10-04-the-rings-stream-offset-field-is-device-dead` | max: NOT_A_DEFECT, max1: NO_PATCH |
| `2026-10-06-two-registry-ids-are-structural-not-drifts` | max: NOT_A_DEFECT, max1: NO_PATCH |
| `2026-10-10-doc-search-chunker-splits-surrogate-pairs` | max: NO_PATCH, max1: PATCH |
| `2026-10-12-filename-stamp-consumers-split-twelve-convert-four-identify` | max: NO_PATCH, max1: PATCH |
| `2026-10-12-seven-hooks-exit-before-draining-stdin-and-their-tests-cannot-see-it` | max: PATCH, max1: NO_PATCH |
| `2026-10-12-published-trio-numbers-cite-a-digest-a-refold-stalens` | max: NOT_A_DEFECT, max1: NO_PATCH |

## 4 · Deep audit

The owner asked for a very intensive task at 20:13 EDT. The audit lane gave each agent one file and one bug class from `AUDIT-PROMPT.md`. It asked for one highest finding as a PATCH and the rest as `FINDING:` lines with an input and a failing assertion. Two rows completed before the credits ran out. Both found a defect, and both proofs ran red on `67db6ffca` and green with the patch.

| finding | file | effect | proof |
|---|---|---|---|
| `oxyCoverage` builds `recording.coverage.segments` from the compat `Date`, so the export writes `startMs` as an ISO string | `oxydex-dsp.js` | `integrator-dsp recSegments` keeps only finite numbers and drops every OxyDex segment. The gap-aware overlap and the apnea denominator fall back to the 120 min envelope where 5398 s was recorded | group "OxyDex coverage segments carry numeric" red 4 of 5 on base, green patched |
| `computeHRAdvanced` filters its still pool on motion and artifact only; its sibling `computeHRV` also drops `hr == null` | `oxydex-dsp.js` | an absent HR cell reaches the 1 Hz RMSSD value (`60 - null` is 60), the HR IQR and the PB window means. On a 3600 s still night 2.2 % absent seconds move the value 1 → 12.75. The committed gap fixture pinned the defect: hrIQR 60 on a night spanning 50–66 | group "computeHRAdvanced skips an ABSENT" red 3 on base, green patched; the fixture moves (rmssd 0.97 → 0.2, hrIQR 60 → 6, meanHRnonPb 43.6 → 58.1) |

The agents also wrote two findings without a test. Nobody has replayed them.

| finding | file | the agent's input |
|---|---|---|
| `oxyBuildSpo2Series` sizes the grid with `floor()` and places rows with `round()` | `oxydex-dsp.js` | one row at t0 and ten rows at t0 + i·1000 + 600 ms give n = 11 cells, 10 filled; the last row is dropped and cell 1 stays empty |
| `_o2BinStartMs` takes the time of day from `file.lastModified` as the night start, while `_o2DateAnchorMs` takes only its date | `oxydex-dsp.js` | a binary file saved at noon starts its night at noon |

The 86 untouched audit rows wait in the lane input. A completed row cost about 4 USD and took 10 to 16 min.

## 5 · Lessons

- A lane needs a balance check before each batch. Twelve sessions ran into the billing refusal mid-task. They cost 14 of the run's 137 USD and wrote nothing.
- `red_on_base` is a self-report. The verifier found two patches whose test fails on both sides, and one patch with no test hunk.
- The verifier's refusal regex matched `deselected` in a pytest `-k` run. Read the base tail before you trust a REFUSE.
- A `*-dsp.js` patch owes five rebuilds before the first full gate. They are the app bundle, both orchestrators, the analysis tools and the docs copies. It also owes `verify-fixtures.mjs`. #3577 found one of them per gate run.
- The embedder was down for every agent. Each one fell back to token search and said so in its Rule 0 line.

## 6 · Acceptance

1. Follow-up PR A lands the three proven patches that share the test spine.
2. Audit PR B lands the two OxyDex patches and closes the two residue rows this brief logs.
3. The held hook PR carries the heredoc-strip patch for the owner to merge.
4. The owner answers board items 11 (avahi unit) and 12 (credits for the 86 audit rows).
5. A session verifies or withdraws each of the 13 UNVERIFIED patches and records the result here.
6. A human reads each NOT_A_DEFECT claim and closes the row as `withdrawn` or leaves it open.
