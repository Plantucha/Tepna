<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# The 37 "addressed elsewhere" residue closures — mechanism checked — 2026-09-25

**What this is:** a report. It follows up #3082, which verified 243 `fixed #NNNN` residue closures and marked 37 as *addressed elsewhere*: the closing PR's diff does not touch the defect's named file, but a first reading said it fixes the defect anyway. For each of those 37, this report names the file the diff **did** touch that does the work and quotes one added line from it. Each row is classified **CONFIRMED** (the defect's mechanism is changed there), **MOVED** (the defect's file was renamed or split), or **UNCONFIRMED** (the diff touches a neighbour but not the mechanism). No residue row was edited or appended; see §2 for why.

**Totals:** 37 closures: **33 CONFIRMED · 0 MOVED · 1 UNCONFIRMED · 3 could not decide** (record-only rows with no mechanism to change). The quotes come from `git show --format= -U0 <squash sha>` on `origin/main`.

## 1 · Table

| key | PR | file the diff touched | the line (added) | class |
|---|---|---|---|---|
| `2026-09-04-drawn-rule-defeated-by-rounding` | #2212 | `ppgdex-dsp.js` | `const axisDrawn = quantizedShare != null && quantizedShare >= 0.67;` | CONFIRMED |
| `2026-09-03-memory-dir-has-no-stale-guard` | #2845 | `.claude/hooks/guard-memory-stale.sh` | `[ "${CLAUDE_ALLOW_STALE_MEMORY:-}" = "1" ] && exit 0` (the new guard's escape hatch; the guard is the file) | CONFIRMED |
| `2026-09-05-respacc-run-is-not-unavailable` | #2729 | `papers/figures/cohort-manifest.json` | `"status": "done — 14 night(s), 8,057 epochs",` | CONFIRMED |
| `2026-09-05-drawn-remedy-is-relabel-not-refuse` | #2237 | `ecgdex-dsp.js` | `var ecgAxisDrawn = ecgHostAx.ok && ecgHostAx.deviceDrawn === true;` | CONFIRMED |
| `2026-09-05-respacc-replication-blocked-locally` | #2729 | `papers/figures/cohort-manifest.json` | `"status": "done — 14 night(s), 8,057 epochs",`: the row's 8,057-epoch figure, reproduced | CONFIRMED |
| `2026-09-06-ring-fileset-never-resumes` | #2378 | *(nothing but the ledger)* | — | **UNCONFIRMED**, see §2 |
| `2026-09-06-mode-search-constraint-is-one-unit-not-two` | #2501 | `briefs/PAT-FORENSICS-WINDOW-REGIMES-2026-08-28-BRIEF.md` | `§8.5 named the experiment that had to run before any mode-search constraint was built: median accepted` | CONFIRMED (the constraint question is answered; the brief is DONE) |
| `2026-09-06-beat-free-anchor-exists-brief-says-none` | #2300 | `briefs/PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md` | `and \`tools/pat-buzz-stability.mjs\` is committed (\`--cmds HH:MM:SS.mmm,... --a <ACC\|PPG2W>\`). A buzz` | CONFIRMED |
| `2026-09-06-marker-isolation-heuristic-unvalidated` | #2758 | `tools/pletha-marker-oracle.mjs` | `* 2026-09-06-marker-isolation-heuristic-unvalidated recorded that it had never been scored against` (the oracle that scores it) | CONFIRMED |
| `2026-09-07-alerts-comment-named-the-wrong-knob` | #2335 | `capture-host/alerts.py` | `# 2026-09-07 and that named the wrong knob. \`pull.notworn_settle_sec\` (45 s, capture.py:7001) is what` | CONFIRMED (the comment *is* the mechanism) |
| `2026-09-07-refinement-brief-quotes-a-deleted-clamp` | #2335 | `briefs/OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md` | `the settle is \`max(notworn_settle_sec, _DROP_NOT_WORN_SEC + 30)\` *(⚠️ STALE since 2026-08-26 — that clamp was DELETED; …` | CONFIRMED |
| `2026-09-07-partial-exports-survive-child-abort` | #2420 | `tools/tch-multinight.mjs` | `const incomplete = classifyCompleteness(` | CONFIRMED (the reader honours the fold stamp, as argued in the PR) |
| `2026-09-09-alert-poller-test-order-dependent` | #2934 | `capture-host/tests/conftest.py` | `_RUNNER_STATE_GLOBALS = ("_LAST_DATA", "_LAST_PULL_OK", "_IDLE_TIMER_NAMED")` | CONFIRMED |
| `2026-09-10-daemon-restarts-are-idle-gated` | #2873 | `capture-host/writers.py` | `STARTS_NAME = "STARTS.csv"` | CONFIRMED |
| `2026-09-12-ecgdsp-analyze-mixes-seconds-and-ms` | #2429 | `ecgdex-dsp.js` | `contract, so they are NOT renamed (CLAUDE.md §📦 back-compat). The unit-suffixed aliases below` | CONFIRMED |
| `2026-09-13-convention-measured-on-the-signal-subset` | #2442 | `DOCS-INDEX.md` (+ `docs/SHHS-COHORT-REFERENCE.md`) | `\| [\`SHHS-COHORT-REFERENCE.md\`](docs/SHHS-COHORT-REFERENCE.md) \| What the SHHS1 cohort contains, measured over all 5136 scored records …` | CONFIRMED |
| `2026-09-14-union-merge-duplicates-a-closed-row` | #2529 | `.gitattributes` | `briefs/RESIDUE.md           merge=residue` | CONFIRMED |
| `2026-09-16-recut-conflates-generator-and-tool-drift` | #2579 | `briefs/COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md` | `⚠️ **The \`expect\` column this table used to carry is gone, and deliberately.** It predicted` | CONFIRMED |
| `2026-09-17-seam-exposure-is-input-provenance` | #2609 | `motiondex-dsp.js` | `var _seam = !!(accRows && accRows._clockResyncs && accRows._clockResyncs.length);` | CONFIRMED |
| `2026-09-17-no-fixture-expresses-epoch-hrstat` | #2613 | `tests/run-tests.mjs` | `const fxH = join(ROOT, 'uploads', 'integrator_hrstat_class_twins.node-export.json');` | CONFIRMED |
| `2026-09-18-draft-discriminates-claim-false` | #2669 | `tools/verify-draft-kills.mjs` | `import vm from 'node:vm';` (the new tool that plants each mutant and runs the drafted call as written) | CONFIRMED |
| `2026-09-20-docs-papers-md-owned-by-nobody` | #2701 | `tests/dex-tests.js` | `\`build-docs.mjs\` writes a docs/ file only where a root twin exists AND the extension survives` (the served-twin equality gate) | CONFIRMED (the *silence* is the mechanism; the builder is unchanged) |
| `2026-09-20-papers-remedy-cause-contradicted` | #2729 | `papers/figures/cohort-manifest.json` | `"status": "done — 14 night(s), 8,057 epochs",` | CONFIRMED |
| `2026-09-20-fake-accepts-and-drops-is-suite-wide` | #2776 | `capture-host/mutation_swallow.py` | *(new module, 165 lines)* test: `assert ("BleakClient", "setattr-lambda", ("addr", "kw")) in fakes` | CONFIRMED |
| `2026-09-20-open-writer-counter-leaks-across-tests` | #2764 | `capture-host/tests/conftest.py` | `def _sample_writer_count_is_not_leaked(request):` | CONFIRMED |
| `2026-09-20-ledger-line-citations-rot` | #2778 | `tools/residue-cite-drift.mjs` | *(new tool, 196 lines)* `import { execFileSync } from 'node:child_process';` | CONFIRMED |
| `2026-09-21-wfdb-interop-mapping-unwritten` | #2878 | `DOCS-INDEX.md` (+ `docs/WFDB-INTEROP-MAPPING.md`) | `\| [\`WFDB-INTEROP-MAPPING.md\`](docs/WFDB-INTEROP-MAPPING.md) \| **Tepna ↔ WFDB/PhysioNet concepts, and the five places they do NOT meet** …` | CONFIRMED |
| `2026-09-21-mutation-cost-is-the-selection-not-the-function-size` | #2848 | `briefs/MUTATION-AUDIT-RUNBOOK-2026-08-03-BRIEF.md` | `compile dominates and is paid once, as below. For \`tools/mutate_diff.py\` it is the **test SELECTION**:` | CONFIRMED |
| `2026-09-22-negotiated-pmd-rate-not-written` | #2912 | `capture-host/writers.py` | `def note_pmd(self, *, rate=None, offered=None, configured=None, default=None) -> None:` | CONFIRMED |
| `2026-09-22-capture-filename-stamp-disagrees-with-content` | #2846 | `tools/trio-batch.mjs` | `import { anchoredRec, startOf } from './trio-anchor.mjs';` | CONFIRMED |
| `2026-09-22-repo-root-has-no-file-set-gate` | #2892 | `tests/run-tests.mjs` | `const rootFiles = rootTrackedFiles(ROOT);` | CONFIRMED |
| `2026-09-22-union-resolved-over-the-hunk-not-the-deletions` | #2913 | *(the ledger only)* | — | could not decide (record-only) |
| `2026-09-23-draft-bank-crossed-against-the-absence-survey` | #2923 | *(the ledger and a changeset only)* | — | could not decide (record-only) |
| `2026-09-23-t-stuck-not-exercised-on-four-streams` | #2924 | `audits/T-STUCK-PER-STREAM-2026-09-23.json` | `"schema": "tepna.audit/t-stuck-per-stream/1",` (the measurement the row asked for) | CONFIRMED |
| `2026-09-23-sourced-claim-already-answers-the-stamp-problem` | #2929 | *(the ledger and a changeset only)* | — | could not decide (record-only) |
| `2026-09-24-mypy-count-risen-on-main-itself` | #3044 | `capture-host/capture.py` | `top_rows: list[str] = [str(s) for s in snap.compare_to(prev, "lineno")[:top]] if prev is not None else []` | CONFIRMED |
| `2026-09-25-ppg2w-routes-to-spo2` | #3075 | `adapters/o2ring-ppg2w.js` | *(new adapter, 116 lines)* `var REG = root.SignalAdapters;` | CONFIRMED |

## 2 · Why no closure-unverified row was appended

- **The one UNCONFIRMED closure, `2026-09-06-ring-fileset-never-resumes` · #2378.** The PR's diff touches only the ledger; its subject is *"the ring's file-set fragmentation decayed — close it without building it"*. But the defect **is fixed on main**, by a different PR: `b6ee520e` (#2405), *"the ring never resumed its file-set, and a zero stamp became a clock"*, and `resumable` now appears in `run_oxyii`'s body. An OPEN "closure-unverified" row would assert an open defect that does not exist. What is wrong is the closing PR number, and the ledger's rules give no way to edit a closed row's state. This is recorded here for the rig to decide.
- **Three record-only rows (#2913, #2923, #2929).** Each PR adds the row and closes it in the same change: a lesson, a measurement, an answer. There is no mechanism for a diff to change, so neither CONFIRMED nor UNCONFIRMED applies.

Rule 0 not run (cloud session).
