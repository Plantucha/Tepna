<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# DONE briefs re-verified: acceptance items of briefs stamped DONE on or after 2026-08-15 (2026-09-25)

Read-only audit. **No brief was edited.** Every verdict is against `origin/main` at `9841c341`. Cloud session: no corpus, no capture box, and the full gate was not run.

## 1 · Findings: acceptance items that do not hold

**75 acceptance items are UNTICKED inside 27 briefs whose header says DONE.** A DONE stamp over an unticked box is a contradiction on its face (CLAUDE.md §📌: "Never stamp DONE on unverified work"). Checked item by item, they split as follows:

| verdict (unticked items) | n |
|---|---|
| does not hold | 6 |
| holds (box unticked) | 13 |
| re-scoped in place (~) | 10 |
| not an acceptance item | 4 |
| undecidable | 42 |

**Does not hold** (the brief is DONE, the item is not met on main):

- `CPAP-BLE-CAPTURE-2026-08-21-BRIEF.md` line 70: "`cpap_ble_pull.py` delivered as an operator probe; the operator's live run against the CPAP prints…". `capture-host/cpap_ble_pull.py` is absent from `origin/main` (`git ls-tree`).
- `OPERATIONAL-MATURITY-AUDIT-2026-08-27-BRIEF.md` line 185: "§13's resource-budget measurements — **needs the box** (Thursday).…". its own text: "needs the box (Thursday)". No later measurement is recorded in the item.
- `OPERATIONAL-MATURITY-AUDIT-2026-08-27-BRIEF.md` line 186: "§14's long-run behaviour tests — **needs the box** (Thursday).…". its own text: "needs the box (Thursday)".
- `QWEN-ENGINEERING-PROGRAM-2026-08-27-BRIEF.md` line 368: "The draft adoption lands (value realized, metric unblocked). ⚠️ **376 drafts, not 57** — a batch programme, no…". its own text: "376 drafts, not 57 … first batch landed #2652", i.e. a batch programme not finished.
- `R5-HR-TRIPLET-REFERENCE-2026-07-12-BRIEF.md` line 190: "**Acquire** a ResMed oximeter module, then record ≥ 5 quad-modal nights (CPAP + H10 + Verity +…". requires acquiring a ResMed oximeter module and ≥ 5 quad-modal nights. No such corpus is recorded.
- `R5-HR-TRIPLET-REFERENCE-2026-07-12-BRIEF.md` line 193: "Re-run the R5 experiment with **ResMed pulse as the external reference** — then, and only then, the HR…". depends on the unacquired module of line 190.

**Holds but was never ticked** (13): the work is on main and only the checkbox is stale. The largest groups are `CPAPDEX-LIVE-SD-COMPARATOR`, `MEASUREMENT-INSTANCE-CONTRACT`, `HOSTAXIS-STABILITY` and `CPAP-CLOCK-LONGITUDINAL-SEGMENT`. The mirror image of residue `2026-09-13-executing-session-stamps-nothing` is that the executing session flipped the header and left the boxes.

Unticked items per brief:

| brief | unticked |
|---|---|
| `CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23-BRIEF.md` | 12 |
| `MEASUREMENT-INSTANCE-CONTRACT-2026-09-17-BRIEF.md` | 8 |
| `HOSTAXIS-STABILITY-2026-08-13-BRIEF.md` | 7 |
| `QWEN-ENGINEERING-PROGRAM-2026-08-27-BRIEF.md` | 5 |
| `CPAP-BLE-CAPTURE-2026-08-21-BRIEF.md` | 4 |
| `CPAP-CLOCK-LONGITUDINAL-SEGMENT-2026-08-21-BRIEF.md` | 4 |
| `O2RING-WAVEFORM-SPO2-SHIP-2026-08-20-BRIEF.md` | 4 |
| `CLAUDE-MD-REDUNDANCY-AUDIT-2026-08-27-BRIEF.md` | 3 |
| `LOST-APPARATUS-INVENTORY-2026-08-26-BRIEF.md` | 3 |
| `R5-HR-TRIPLET-REFERENCE-2026-07-12-BRIEF.md` | 3 |
| `DEAD-FIELD-HINTS-FLEET-FOLLOWUPS-2026-08-19-BRIEF.md` | 2 |
| `OPERATIONAL-MATURITY-AUDIT-2026-08-27-BRIEF.md` | 2 |
| `REFERENCE-GUIDE-AUDIT-BRIEF.md` | 2 |
| `SEARCHBACK-AWARE-INJECTION-2026-08-15-BRIEF.md` | 2 |
| `UNWIRED-ORPHAN-TRIAGE-2026-08-27-BRIEF.md` | 2 |
| `CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS-2026-08-04-BRIEF.md` | 1 |
| `CAPTURE-HOST-UNWIRED-MACHINERY-2026-08-14-BRIEF.md` | 1 |
| `CPAP-ACQ-P1-RAW-RECORD-2026-08-23-BRIEF.md` | 1 |
| `CPAP-AUTOHARVEST-FOLLOWUPS-II-2026-08-03-BRIEF.md` | 1 |
| `DEVICE-RATE-TRUTH-2026-08-05-BRIEF.md` | 1 |
| `MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26-BRIEF.md` | 1 |
| `MOTIONDEX-RESPIRATORY-RATE-2026-07-21-BRIEF.md` | 1 |
| `MUTATION-COVERAGE-SELECTION-2026-08-14-BRIEF.md` | 1 |
| `R5-HR-TRIPLET-FOLLOWUPS-2026-08-04-BRIEF.md` | 1 |
| `SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md` | 1 |
| `WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md` | 1 |
| `WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md` | 1 |

## 2 · Ticked items

389 ticked items in 83 briefs:

| verdict | n | meaning |
|---|---|---|
| holds (named artifacts exist) | 73 | every repo path or `#PR` the item names resolves on main (path in tree, PR squash-merged) |
| undecidable | 314 | the item names no path and no PR, so the check would be a behavioural re-run. Not done |
| flagged, then cleared | 2 | see below |

The two flagged items are false positives, both cleared by reading them:

- `DEAD-FIELD-HINTS-FLEET-2026-08-19-BRIEF.md` line 144 names `.src.html` as a file class, not a path.
- `MOTIONDEX-RESPIRATORY-RATE-2026-07-21-BRIEF.md` line 204 names `changes/2026-07-21-motiondex-spectral-resp-rate.md`. That changeset was pruned by `release: v1.17.0` (57be2560), which is the lifecycle working as designed.

⚠️ "Holds (named artifacts exist)" is an existence check. It does not show that the artifact does what the item says.

## 3 · Per-item table (unticked items)

| brief | line | box | item (truncated) | verdict | evidence |
|---|---|---|---|---|---|
| `CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS-2026-08-04` | 177 | `[ ]` | **§6's `harvest` cluster (21 logic mutants) — LEFT, deliberately, and this is the note.** | not an acceptance item | the item is a note that the cluster was "LEFT, deliberately" |
| `CAPTURE-HOST-UNWIRED-MACHINERY-2026-08-14` | 238 | `[ ]` | **STANDING, not completable — do not tick.** §7 is still true — re-check before any change | not an acceptance item | its own text: "STANDING, not completable — do not tick" |
| `CLAUDE-MD-REDUNDANCY-AUDIT-2026-08-27` | 122 | `[ ]` | Inventory + classification committed (as an appendix to this brief or a sibling data file) | undecidable | decided by locating the inventory appendix or data file. Not searched |
| `CLAUDE-MD-REDUNDANCY-AUDIT-2026-08-27` | 123 | `[ ]` | Before/after token measurement against the §2.4 pre-stated band. | undecidable | decided by the before/after token measurement. None found quoted |
| `CLAUDE-MD-REDUNDANCY-AUDIT-2026-08-27` | 124 | `[ ]` | Owner ratifies: execute, execute-partially, or decline (all three are valid outcomes; | undecidable | an owner ratification. No record located |
| `CPAP-ACQ-P1-RAW-RECORD-2026-08-23` | 131 | `[ ]` | Wiring plan (§6) reviewed so the P1+P3 touch ships when the controller-race fix merges. | undecidable | a review item. Nothing checkable |
| `CPAP-AUTOHARVEST-FOLLOWUPS-II-2026-08-03` | 290 | `[ ]` | §4 — nothing, unless backfill time matters again | not an acceptance item | its own text: "nothing, unless backfill time matters again" |
| `CPAP-BLE-CAPTURE-2026-08-21` | 64 | `[ ]` | `as11_link.py` + `as11_pull.py` land with 100 % statement+branch coverage (`capture-host/c | undecidable | `capture-host/as11_link.py` and `as11_pull.py` exist on main. 100 % coverage needs `check.sh`, not run |
| `CPAP-BLE-CAPTURE-2026-08-21` | 65 | `[ ]` | The pull state machine is exercised against a fake AS11 replaying canned encrypted frames: | undecidable | fake-AS11 replay test not located |
| `CPAP-BLE-CAPTURE-2026-08-21` | 69 | `[ ]` | SRP round-trip proven against a simulated device (M1/M2/K agree), matching the live pairin | undecidable | SRP round-trip test not located |
| `CPAP-BLE-CAPTURE-2026-08-21` | 70 | `[ ]` | `cpap_ble_pull.py` delivered as an operator probe; the operator's live run against the CPA | does not hold | `capture-host/cpap_ble_pull.py` is absent from `origin/main` (`git ls-tree`) |
| `CPAP-CLOCK-LONGITUDINAL-SEGMENT-2026-08-21` | 49 | `[ ]` | `fitClockOffsetSegments` in integrator-dsp.js, exported, pure, deterministic. | holds (box unticked) | `integrator-dsp.js:5228` `function fitClockOffsetSegments(nightOffsets, opts)`, exported at `:7501` |
| `CPAP-CLOCK-LONGITUDINAL-SEGMENT-2026-08-21` | 50 | `[ ]` | Step detection separates a planted travel-step from crystal drift; interpolates within a s | undecidable | behavioural. Covered only if the group at `tests/dex-tests.js:7488` plants a step. Not read |
| `CPAP-CLOCK-LONGITUDINAL-SEGMENT-2026-08-21` | 52 | `[ ]` | A suite group drives it: linear-drift segment (interpolates), a planted step (segments + r | holds (box unticked) | a group drives it: `tests/dex-tests.js:7488` `var f = D && D.fitClockOffsetSegments;`. Its content was not read |
| `CPAP-CLOCK-LONGITUDINAL-SEGMENT-2026-08-21` | 55 | `[ ]` | Full chain + verify-fixtures green; changeset (bump: minor, type: added, nodes: [Integrato | undecidable | full chain not run here. The changeset would have been pruned by a release |
| `CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23` | 147 | `[ ]` | `cpapdex-cross.js` exposes `cpapCompare(setA, setB)` → per-channel `{ scale:{a,b,residSD}, | holds (box unticked) | `cpapdex-cross.js:779` `function cpapCompare(liveSet, sdSet, opts)`, consumed at `cpapdex-app.js:370` |
| `CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23` | 149 | `[ ]` | Coimport finds the BLE/SD pair by device-clock date; manual two-file load also works. | undecidable | not examined beyond the item text |
| `CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23` | 150 | `[ ]` | Alignment is on device-clock minutes; viewer-timezone-independent (Clock Contract §5). | undecidable | not examined beyond the item text |
| `CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23` | 151 | `[ ]` | Bland–Altman + scale regression only; **no Pearson r anywhere** in the surface. | holds (box unticked) | `cpapdex-cross.js:598` "NEVER Pearson r" and `cpapdex-render.js:1303` "No Pearson r anywhere". No Pearson computation found |
| `CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23` | 152 | `[ ]` | Streamed-vs-logged divergence surfaced explicitly from `cpap_ingest.GapCounters`. | undecidable | `GapCounters` has 0 hits in `*.js`. Whether the divergence is surfaced under another name was not checked |
| `CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23` | 153 | `[ ]` | The **alignment offset** the comparator applied is a badged, first-class output; a non-zer | undecidable | not examined beyond the item text |
| `CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23` | 155 | `[ ]` | Every quoted agreement number carries its **n**; the n=1 pin result (scale 0.924, RMSE 0.0 | undecidable | not examined beyond the item text |
| `CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23` | 157 | `[ ]` | No-overlap / single-file / missing-channel each refuse with a reason string; a decoy asser | undecidable | not examined beyond the item text |
| `CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23` | 158 | `[ ]` | Every surfaced number badged; new metrics in `CPAP_REGISTRY` at `measured`; `registry-defs | undecidable | not examined beyond the item text |
| `CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23` | 160 | `[ ]` | Committed fixture pair (from the capture-box pin) + equiv leg via `regen-cpap-goldens.mjs`; | undecidable | not examined beyond the item text |
| `CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23` | 162 | `[ ]` | Reference-guide row added; `docs-ledger` green. | undecidable | not examined beyond the item text |
| `CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23` | 163 | `[ ]` | v1 is BRP-only; SA2 and PLD appear ONLY as the documented non-goals above — no SA2/PLD com | holds (box unticked) | `cpapdex-cross.js:747` "PLD … is NOT here and must not be added". No SA2/PLD comparison code found |
| `DEAD-FIELD-HINTS-FLEET-FOLLOWUPS-2026-08-19` | 92 | `[ ]` | The four guards above carry either a removal or a dated rationale, decided as one unit. | undecidable | not examined beyond the item text |
| `DEAD-FIELD-HINTS-FLEET-FOLLOWUPS-2026-08-19` | 93 | `[ ]` | If (c) is attempted: the false-positive count over all 8 nodes is measured and recorded he | undecidable | not examined beyond the item text |
| `DEVICE-RATE-TRUTH-2026-08-05` | 443 | `[~]` | §6.4's clobber bug fixed **before** any rate is set; §5's configuration applied and verifi | re-scoped in place (~) | marked `~` in the brief |
| `HOSTAXIS-STABILITY-2026-08-13` | 171 | `[ ]` | `hostAxis` returns `stability` (curve · slope · noise name · `ppmUncertainty` at the file' | holds (box unticked) | `clock.js:708` `ppmUncertainty: curve[curve.length - 1].adev * 1000`, with `stability` documented at `clock.js:377` |
| `HOSTAXIS-STABILITY-2026-08-13` | 173 | `[ ]` | `ppm` unchanged; verified additive by the equivalence gate passing against the **real corp | undecidable | not examined beyond the item text |
| `HOSTAXIS-STABILITY-2026-08-13` | 175 | `[ ]` | a phone-captured file is asserted to yield `stability: null` — the common path, and the on | undecidable | not examined beyond the item text |
| `HOSTAXIS-STABILITY-2026-08-13` | 177 | `[ ]` | cross-language known answer pinned against `capture-host/allan.py`, using MINSTD (**not**  | undecidable | not examined beyond the item text |
| `HOSTAXIS-STABILITY-2026-08-13` | 180 | `[ ]` | ECGDex's host axis surfaced in its node export | holds (box unticked) | `ecgdex-dsp.js:5603` documents `ppmUncertainty` in ECGDex's export |
| `HOSTAXIS-STABILITY-2026-08-13` | 181 | `[ ]` | all 8 bundles re-built and all three generated trees checked (`npm run check`, not a subse | undecidable | not examined beyond the item text |
| `HOSTAXIS-STABILITY-2026-08-13` | 183 | `[ ]` | a follow-up brief spawned per CLAUDE.md, or the header states that nothing surfaced | undecidable | not examined beyond the item text |
| `LOST-APPARATUS-INVENTORY-2026-08-26` | 161 | `[ ]` | The 🔴 tier is resolved: either `ppg2w-sweep.mjs` is rebuilt and committed, or | undecidable | `tools/ppg2w-sweep.mjs` is absent from main. The item's "or" branch was not evaluated |
| `LOST-APPARATUS-INVENTORY-2026-08-26` | 164 | `[ ]` | Each 🟠 brief carries a one-line note at its finding: *apparatus not committed, finding not | undecidable | not examined beyond the item text |
| `LOST-APPARATUS-INVENTORY-2026-08-26` | 166 | `[ ]` | The §3 rule is recorded where a session will hit it before writing a brief, and the counte | undecidable | not examined beyond the item text |
| `MEASUREMENT-INSTANCE-CONTRACT-2026-09-17` | 167 | `[ ]` | `measurement-block.js` exists as a CORE module mirroring `signal-frame.js`'s validator pat | holds (box unticked) | `measurement-block.js` exists at root beside `signal-frame.js` |
| `MEASUREMENT-INSTANCE-CONTRACT-2026-09-17` | 169 | `[ ]` | The block and §2's event additions are specified in `docs/LEXICON.md`, | holds (box unticked) | `docs/LEXICON.md:102` "The measurement-instance block (`measurement-block.js` …)" |
| `MEASUREMENT-INSTANCE-CONTRACT-2026-09-17` | 171 | `[ ]` | A schema test group is live and green, carrying the full §4 negative table, **each negativ | holds (box unticked) | group `tests/dex-tests.js:52294` "Measurement instance — the validator rejects what the roadmap§9 table names". Green-ness not run |
| `MEASUREMENT-INSTANCE-CONTRACT-2026-09-17` | 173 | `[ ]` | `measurement-block.js` is in both lanes' source inventories and the | holds (box unticked) | `tests/run-tests.mjs:681` and `Dex-Test-Suite.html:205` both load `measurement-block.js` |
| `MEASUREMENT-INSTANCE-CONTRACT-2026-09-17` | 176 | `[ ]` | The module is in the mutation `DEFAULT_FLEET`. | holds (box unticked) | `tools/mutation-crawl.mjs` `DEFAULT_FLEET` lists `'measurement-block.js'` |
| `MEASUREMENT-INSTANCE-CONTRACT-2026-09-17` | 177 | `[ ]` | **No fixture moved and no `manifestHash` changed** — assert it rather than assume it: | undecidable | not examined beyond the item text |
| `MEASUREMENT-INSTANCE-CONTRACT-2026-09-17` | 180 | `[ ]` | `npm run check` green. A changeset is owed **only if** code moved into a bundle — under th | undecidable | not examined beyond the item text |
| `MEASUREMENT-INSTANCE-CONTRACT-2026-09-17` | 183 | `[ ]` | The roadmap's first Done-when item is ticked **in the roadmap**, and this brief's header f | undecidable | the roadmap's matching item (line 220) is struck through `~`, not ticked |
| `MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26` | 220 | `[~]` | ~~§1+§2 contract brief **SPAWNED 2026-09-17**~~ — `MEASUREMENT-INSTANCE-CONTRACT-2026-09-1 | re-scoped in place (~) | struck through with a SPAWNED note |
| `MOTIONDEX-RESPIRATORY-RATE-2026-07-21` | 254 | `[~]` | Figures emitted into `papers/figures/` — **RE-SCOPED 2026-08-04: the blocker is not "run t | re-scoped in place (~) | "RE-SCOPED 2026-08-04" |
| `MUTATION-COVERAGE-SELECTION-2026-08-14` | 330 | `[~]` | ~~`cpapdex` · `glucodex` · `hrvdex` · `motiondex` re-swept WITH selection~~ — **OVERTAKEN | re-scoped in place (~) | struck through as "OVERTAKEN" |
| `O2RING-WAVEFORM-SPO2-SHIP-2026-08-20` | 65 | `[ ]` | **Post-#1596 re-fit**: contiguous double-drain nights should steepen the converted slope | undecidable | not examined beyond the item text |
| `O2RING-WAVEFORM-SPO2-SHIP-2026-08-20` | 71 | `[ ]` | **Sunlight spectral test** (field-gated): the channel-identity confirmation the functional | undecidable | not examined beyond the item text |
| `O2RING-WAVEFORM-SPO2-SHIP-2026-08-20` | 73 | `[ ]` | **LUT recovery**: per-beat R (not buffer-wise), then fit the firmware's fixed R→SpO₂ curve | undecidable | not examined beyond the item text |
| `O2RING-WAVEFORM-SPO2-SHIP-2026-08-20` | 76 | `[~]` | 🔴 **Sweep apparatus — LOST. RULED 2026-08-27: the re-CHECK is RETRACTED; the rebuild folds | re-scoped in place (~) | "the re-CHECK is RETRACTED" |
| `OPERATIONAL-MATURITY-AUDIT-2026-08-27` | 185 | `[ ]` | §13's resource-budget measurements — **needs the box** (Thursday). | does not hold | its own text: "needs the box (Thursday)". No later measurement is recorded in the item |
| `OPERATIONAL-MATURITY-AUDIT-2026-08-27` | 186 | `[ ]` | §14's long-run behaviour tests — **needs the box** (Thursday). | does not hold | its own text: "needs the box (Thursday)" |
| `QWEN-ENGINEERING-PROGRAM-2026-08-27` | 366 | `[ ]` | Owner ratifies the priority map (or amends ranks in place). | undecidable | not examined beyond the item text |
| `QWEN-ENGINEERING-PROGRAM-2026-08-27` | 367 | `[ ]` | C1 + C2 + C3 built and the first nightly report produced. | undecidable | not examined beyond the item text |
| `QWEN-ENGINEERING-PROGRAM-2026-08-27` | 368 | `[ ]` | The draft adoption lands (value realized, metric unblocked). ⚠️ **376 drafts, not 57** — a | does not hold | its own text: "376 drafts, not 57 … first batch landed #2652", i.e. a batch programme not finished |
| `QWEN-ENGINEERING-PROGRAM-2026-08-27` | 369 | `[ ]` | First precision numbers exist for ≥2 lenses; §2.5 bands applied once. | undecidable | not examined beyond the item text |
| `QWEN-ENGINEERING-PROGRAM-2026-08-27` | 370 | `[ ]` | Follow-up brief records what the first month of precision data says about which | undecidable | not examined beyond the item text |
| `R5-HR-TRIPLET-FOLLOWUPS-2026-08-04` | 51 | `[~]` | **MEASURED 2026-08-04 — the fleet statistic is `rate-of-mean`, and OxyDex's closest unbias | re-scoped in place (~) | marked `~` with a MEASURED note |
| `R5-HR-TRIPLET-REFERENCE-2026-07-12` | 190 | `[ ]` | **Acquire** a ResMed oximeter module, then record ≥ 5 quad-modal nights (CPAP + H10 + Veri | does not hold | requires acquiring a ResMed oximeter module and ≥ 5 quad-modal nights. No such corpus is recorded |
| `R5-HR-TRIPLET-REFERENCE-2026-07-12` | 193 | `[ ]` | Re-run the R5 experiment with **ResMed pulse as the external reference** — then, and only  | does not hold | depends on the unacquired module of line 190 |
| `R5-HR-TRIPLET-REFERENCE-2026-07-12` | 235 | `[~]` | *(superseded by the entry above)* **Investigated 2026-08-04 — one candidate ELIMINATED, th | re-scoped in place (~) | "(superseded by the entry above)" |
| `REFERENCE-GUIDE-AUDIT` | 177 | `[~]` | **Dimension 2, the NAMED formulas — audited 2026-08-04. Three verify clean; the fourth fou | re-scoped in place (~) | marked `~`, partially audited |
| `REFERENCE-GUIDE-AUDIT` | 248 | `[~]` | **Internal half DONE + gate-backed (2026-08-04); external half is UNGATEABLE, deliberately | re-scoped in place (~) | marked `~`: "external half is UNGATEABLE, deliberately" |
| `SEARCHBACK-AWARE-INJECTION-2026-08-15` | 198 | `[ ]` | **Measure the real clustering of faint beats** — whether low-amplitude beats arrive isolat | undecidable | not examined beyond the item text |
| `SEARCHBACK-AWARE-INJECTION-2026-08-15` | 201 | `[ ]` | §7.3's sentence corrected in `CROSS-DOMAIN-METHODS-FOLLOWUPS` (carried by this PR, by agre | undecidable | not examined beyond the item text |
| `SHHS-EXTERNAL-VALIDATION-2026-09-04` | 206 | `[ ]` | `PAPERS-ROADMAP` §3.2 and `REM-STAGING-FOLLOWUPS` §2b banners re-stamped — both now state | undecidable | not examined beyond the item text |
| `UNWIRED-ORPHAN-TRIAGE-2026-08-27` | 86 | `[ ]` | SCAN 5 red-on-stale (step 3) — unblocked by this, and its count must be RE-MEASURED on cur | undecidable | not examined beyond the item text |
| `UNWIRED-ORPHAN-TRIAGE-2026-08-27` | 88 | `[ ]` | `message_call_lines` wiring — needs the mutant lineno; its own unit. | holds (box unticked) | wired on main: `capture-host/mutation_triage.py:262` `return line is not None and line in message_call_lines(source)`, reached from `capture-host/tools/mutate_triage.py:109` (#1889) |
| `WEARABLE-DRIFT-DIRECT-2026-08-02` | 107 | `[~]` | **⛔ CORRECTED 2026-08-04 (same day). The claim below — "it CANNOT be run on this corpus" — | re-scoped in place (~) | marked `~` with a CORRECTED note |
| `WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02` | 691 | `[ ]` | **PAT — RE-OPENED and HANDED OFF.** The NO was produced by a harness that fitted a free of | not an acceptance item | "RE-OPENED and HANDED OFF" |

## 4 · Method, and what was not examined

- **Population.** Every `briefs/*.md` whose `**Status:**` line reads DONE with a date on or after 2026-08-15. Items are the `- [ ]`/`- [x]`/`- [~]` checkboxes under the first "Done when"/"Acceptance" heading, or every checkbox in the file when there is no such heading.
- **Not examined:**
  - Acceptance criteria written as prose rather than checkboxes. A DONE brief with no checkboxes contributes nothing here.
  - The behavioural claim of every "undecidable" item. No test group, `npm run check`, capture-host `check.sh` or corpus run was executed.
  - Whether a ticked item's artifact does what the item says.
- Rule 0 not run (cloud session).

