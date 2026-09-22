<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-09-21 (**§12 SECOND EMITTER BUILT 2026-09-22 (Kestrel)** — ECGDex emits `measurement: { hr, rmssd, sdnn }` on every export, light and rich, values = the whole-record `hrv.time.wholeRecord*` numbers the Integrator already reads as its consensus axis, `basis: derived`, `sourceChannel: H10:ecg`, `window.spreadMs` published from the host axis on a box night (the H10 has a second clock — the one thing this emitter can say that OxyDex cannot), envelope hop null-with-reason (no envelope joins the ECG path yet), schema 2.1; the generic `adaptEnvelopeNode` consumes it into refs (the §12 Integrator row's one line, landed with the second emitter as that row said); plants: null metric → no block, zero window → no map, no clock end → beat span named, host axis → measured spread, refused axis → no spread, envelope → session_id, plus the adapter's inputHash/value-disagreement plants; four ECGDex fixtures regenerated carrying the shipped bundle's code identity, gated like OxyDex's. **§10 EXECUTED on all three dimensions 2026-09-22**, bands pre-stated, verdict PASS as a `tepna.verdict/1` record `audits/MEASUREMENT-EMITTER-PERF-2026-09-22.json` (runtime delta negative, RSS ±0.7 MB, +2.3 KB per export). Still in the remainder: per-FINDING refs (needs per-window emission, which needs the shared-parts hoist — `2026-09-21-measurement-block-serialises-shared-parts-per-block`), the envelope-hop fixture (Magpie, in progress), §11 WFDB doc, PpgDex as the third emitter with the `clock-seam ⇒ no block` rule.) (envelope hop EXERCISED #2798 2026-09-21: a stored .dat night + its acquisition envelope is the fourth OxyDex fixture, `measurement-walk` re-derives the hop and speaks `tepna.verdict/1`; every Done-when item ticked with its gate named; §4 half, §10 runtime/memory and §11 are NOT executed and are listed in §12 + the residue ledger rather than folded in — the roadmap is closed as a MAP, not as a claim that every section ran. F-section report DONE — `docs/MEASUREMENT-PROVENANCE-REPORT-2026-09-21.md`, honesty criteria pre-stated, twelve limits each labelled found/assumed; §12 lists the remainder. **For the next emitter:** every owned bundle now carries its own code identity on the `<html>` tag — `data-manifest-hash` / `data-compute-hash`, stamped by `tools/build-core.js` OUTSIDE every inline block by the version stamp's masking, so reading it is free: `document.documentElement.dataset.manifestHash/computeHash` in the bundle, `opts.code` headless, and the stamp moves no hash and no fixture by itself. §8 DONE — the Integrator consumes the block behind a tolerant, fail-closed adapter and carries refs forward; 0 of 5 fusion fixtures moved. §3 DONE — OxyDex emits the measurement block on every night element, schema 2.1, invariance measured (one moved field per fixture), walk-through checkable via `tools/measurement-walk.mjs`. §5 DONE — the oracle harness runs on 52 real nights with pre-stated bands, `tools/oracle-ecg-firmware-rr.mjs`; rMSSD/mean-RR CONSISTENT; the time-anchored per-beat pairing landed the same day: matched 98.7 %, RR |Δ| 0.45 ms on pairs, LoA SHORTFALL tail-driven. Two units remain: the F-section report, the follow-up brief.) · IN-PROGRESS — 2026-09-20 (NOT owner-blocked: the schedule decision was ratified 2026-09-15 (queue D5). Five Done-when units remain unticked and are executable by the fleet; re-stamped 2026-09-20 because the header still read as parked on a decision that was made five days earlier) · **Created:** 2026-08-26 · **Follows:** `ACQ-EVIDENCE-CONTRACT-2026-08-24-BRIEF.md` (the acquisition half of this chain — 21/22 §21 criteria met, last one in flight) · **Relates:** CLAUDE.md §🔒 Clock Contract, §🎫 evidence ladder, §🔏 provenance gates, `docs/LEXICON.md` · **Residue:** 2026-09-21-validaterr-compares-gap-spanning-intervals, 2026-09-21-measurement-envelope-hop-unexercised, 2026-09-21-measurement-block-serialises-shared-parts-per-block, 2026-09-21-measurement-emitter-runtime-memory-unmeasured, 2026-09-21-wfdb-interop-mapping-unwritten

# Measurement-provenance roadmap — the canonical Measurement layer between Dex outputs and the Integrator

> **The one-sentence goal, which every phase serves:** a skeptical researcher can take any important
> Tepna-derived number, follow its provenance backward, identify exactly what was measured and when,
> how it was derived, under what quality and timing limitations — and reproduce or challenge it.

**Owner-commissioned 2026-08-26** from an external draft prompt, reconciled against the repository as
it actually stands. The draft's spine survives; roughly half its asks are ALREADY BUILT under Tepna
names, and building them again as a parallel vocabulary would be the competing-abstraction failure
its own Phase 0 warns about. This roadmap is the reconciled, Tepna-real version. **Each phase below
spawns its own dated executable brief when picked up** (house pattern); this file is the index and
stays the map.

## §R · RECONCILIATION — what the draft asks for vs. what exists (read this first, it halves the work)

| draft concept | Tepna reality | verdict |
|---|---|---|
| "raw acquisition evidence" | Acquisition Evidence Contract envelopes (`acq_evidence*.py`, schema 1.1.0, ClockOffset + start_time, CPAP live+spool, O2Ring stored + live-in-flight #1809) | **EXISTS** — this roadmap consumes it, never rebuilds it |
| "clock_domain / timing semantics / don't silently convert" | Clock Contract §1–§7: floating `tMs`, `hostAxis` refusal semantics, `quality.timingSource` (`device+host`·`host`·`none`), `independent`, `spreadMs` | **EXISTS** — stronger than the draft; reuse verbatim |
| "timing_uncertainty, don't manufacture precision" | `spreadMs`, `maxStepMs`, Allan machinery, refusal-not-fabrication doctrine; house rule: unknown = null + reason | **EXISTS** as doctrine; **EXTEND** into per-measurement fields |
| "algorithm + algorithm_version" | `manifestHash` (executed-code identity) + `computeHash` (compute-closure identity) — content-addressed, deterministic, already stamped per bundle | **EXISTS** — a hash IS the version; never add a hand-typed version string (§📦 forbids it) |
| "quantity / unit / source" | `<node>-registry.js` per-metric: id, label, unit, evidence tier, goodDirection; §📏 metric-canonical units | **EXISTS** at the metric level; **EXTEND** to the measurement instance |
| "measured / derived / estimated / inferred" | The 5-tier evidence ladder (per-METRIC epistemics) — but the draft's axis is per-INSTANCE derivation kind, a different thing | **BUILD** as `basis`, small enum, explicitly NOT a second ladder |
| "quality vs confidence, don't conflate" | SQI machinery (selfGate, pulseValid, motion SQI), `conf` on ganglior events; the ladder | **EXISTS** piecewise; the contract names which field is which |
| "canonical Events" | `ganglior_events` (`{t, impulse, node, conf, meta?}`) in every node export; Integrator consumes them today | **EXISTS** — **EXTEND** additively (see §2), never replace |
| "provenance chain" | GATE A/B content-addressing, `FIXTURE-PROVENANCE` triples, `ganglior-provenance.js` export stamps, per-app `provenance/*.json` | **EXISTS** at code/fixture level; the GAP is per-measurement lineage to the evidence envelope — the heart of this roadmap |
| "reference/oracle validation" | The real tri-device corpus, CPAP-flow-as-home-reference (paper), STR cross-validation (#1781), live-vs-SD comparator v1.1, ppg-ecg-hrv-validation (20 nights) | **EXISTS** as cross-DEVICE validation; **BUILD** the cross-ALGORITHM oracle harness (§5) — genuinely new |
| "real data first, synthetic supporting" | House doctrine — with one correction to the draft: committed adversarial synthetic twins exist BECAUSE CI cannot re-run gitignored real corpora (§🔏). Synthetic is the CI reproducibility layer, not a validation centerpiece; both stay | **EXISTS**; keep both honestly |
| "mutation testing" | 17-file fleet, 47.4 % fleet kill rate measured 2026-08-26, adoption discipline, equivalence ledger | **EXISTS** — new modules join `DEFAULT_FLEET` |
| "WFDB/EDF interop" | EDF is already a first-class INPUT (CPAPDex); no export mapping doc | **BUILD** the mapping doc (§11, cheap); adapters only if low-risk |

**The genuinely missing piece, in one line:** metrics reach the Integrator as values with registry
identity and an export-level provenance stamp, but **no individual measurement can name the evidence
envelope, input hash, window, and compute identity that produced it.** That lineage is this roadmap.

## §0 · RECONNAISSANCE (mandatory first step of EVERY phase brief, not a one-time phase)
- Read from **origin/main**, never the root checkout (it drifts). Verify claimed-built items in the
  files themselves (`verify-in-the-files-the-brief-names`); trace every planned consumer chain to its
  LAST link before building (`trace-to-the-consumer` — four premise failures were caught this way in
  the 24 h before this brief was written).
- Baseline before touching code: `npm run check` green · `capture-host/check.sh` green · fleet
  mutation scores (2026-08-26 baseline: 47.4 %, per-file table in the crawl checkpoints) · the
  GATE-C equiv legs and which fixtures each phase will move.
- **Anti-duplication rule, hard:** if a concept exists under a Tepna name (table above), extend it.
  A competing vocabulary is a defect, not a design.

## §1 · THE MEASUREMENT INSTANCE CONTRACT (additive to `ganglior.node-export` — MINOR bump)
Not a new layer beside the export — a new **block inside it**. Per surfaced metric instance:

```
measurement: {
  metricId,                  // the registry key — quantity, unit, label, evidence tier all resolve
                             // from the node registry; NEVER duplicated inline (single source)
  value,                     // finite number; NaN/Infinity are refusals upstream, never values here
  window: { startTMs, endTMs,          // Clock Contract floating tMs, always
            clockDomain,               // 'device' | 'host' | 'host-corrected' — named, never implied
            timingSource,              // quality.timingSource passthrough
            spreadMs },                // null + reason when unmeasured — never fabricated
  sourceChannel,             // e.g. 'O2Ring-S:spo2', 'H10:ecg' — device:stream, matching capture names
  code: { manifestHash, computeHash }, // the algorithm identity — content-addressed, already computed
  evidence: { envelopeRef, inputHash },// the acquisition-evidence join; null+reason for legacy inputs
  basis,                     // 'measured' | 'derived' | 'estimated' — per-instance derivation kind;
                             // NOT the evidence ladder (per-metric epistemics) — conflating them is a red
  quality: { ... },          // the node's existing SQI facts, referenced not re-invented
  uncertainty                // value with named method, or null + reason — 'unknown' is a valid state
}
```
- **Schema versioning:** MINOR bump per §📦 (additive field). Consumers tolerating its absence is the
  back-compat contract, gated like the `t`-only event tolerance.
- **Done when:** the block is specified in `docs/LEXICON.md` + schema docs; a schema test group
  exists (positive + the §9 negative table); no node emits it yet (that's §3).

## §2 · EVENTS — extend `ganglior_events`, additively, finishing what §6 of the Clock Contract started
Add per event (all optional, `t`-only legacy consumers keep working): `tMs` (already SHOULD per
Clock Contract §6 — make it real), `endTMs` for durative events, `clockDomain`, `evidenceRef`,
`detector: {manifestHash}`. `impulse` stays the type vocabulary (`docs/EVENT-LEXICON.md` owns it —
extend there, never fork). **Do not overdesign:** no event bus changes, no new event kinds in this
phase; the point is that a desat event can name the night and code that produced it.

## §3 · THE REFERENCE PATH — O2Ring `.dat` → OxyDex, end to end (ONE node, deliberately)
Chosen because every link already exists: `assemble_dat` envelopes (Phase A) + OxyDex's Phase C
envelope reader (#1752) already join; OxyDex has regen tooling (`regen-oxydex-goldens.mjs`), equiv
legs, and the richest artifact history. The work: OxyDex's export gains `measurement` blocks for its
headline metrics (ODI-4, T90, meanSpO2, hypoxic burden) and `evidenceRef` on desat events.
- **Numerical invariance is the gate:** values byte-identical before/after (the blocks are additive
  metadata). The export bytes MOVE (new fields) → `outputHash` moves → **plan the §🔏 fixture
  regeneration honestly**: `regen-oxydex-goldens` + `verify-fixtures` re-stamp, one node only.
- **Done when:** a real committed night's export carries blocks whose `evidence.inputHash` matches
  the committed input, `code.computeHash` matches the shipped bundle, and a written walk-through
  traces ODI-4 → window → channel → envelope → raw `.dat` (deliverable D of the final report).

## §4 · PROVENANCE CHAIN — references, never payloads
The chain is IDs and hashes: `value → measurement block → evidenceRef+inputHash → envelope →
raw file hash`, with code identity (`computeHash`) at every derived hop. No duplicated waveforms, no
O(n²) assembly. It must survive export → Data Unifier/OverDex routing → Integrator fusion → fusion
export (the Integrator re-emits consumed measurements' refs, not copies). Kernel-audit extends to
assert ref integrity. **Fail closed:** a measurement whose refs don't resolve is marked
`provenance:'unresolved'` loudly — never silently accepted, never silently dropped.

## §5 · THE ORACLE HARNESS — cross-algorithm validation, quarantined from runtime
Genuinely new. Independent reference implementations (WFDB/PhysioNet tooling, NeuroKit2-class
algorithms) compared against Tepna's own, **under absolute quarantine**: Node-lane dev-dependency in
`tools/oracle/` only, pinned versions, **never imported by any bundle or shipped surface** (the
`no-network` + SOUP doctrine both apply; runtime SOUP stays empty — a new dev-dep gets a
`docs/COMPLIANCE/` SOUP note). Comparisons run offline on the real corpus.
- First targets, each with dataset + preprocessing assumptions + tolerance + metric + failure
  criteria **pre-stated before the first run** (house rule): Pan-Tompkins R-peaks vs a reference
  detector on H10 nights (matched by tolerance-window pairing — reuse the `pb-agreement` machinery,
  never naive array equality); HR/RR agreement (median abs diff + max + LoA); rMSSD/SDNN on the same
  RR trains; PPG pulse detection on O2Ring/Verity nights.
- **A reference is a reference, not ground truth** — disagreement opens an investigation, never an
  auto-fix; agreement between two algorithms proves nothing physiological (both stated in the
  harness's own report header, machine-printed).
- **Do not force comparisons where algorithms intentionally differ** (e.g. Tepna's artifact-refusal
  behavior is a feature; an oracle that "repairs" input cannot judge it — the kind-instrument rule).

## §6 · REAL DATA FIRST — with the honest CI correction
Hierarchy: real captured corpus (76 foldable nights + the tri-device 20-night validated set) →
cross-device references (CPAP flow, STR) → controlled experiments (buzz fiducial class) → acquisition
evidence → deterministic regression → synthetic. **Correction to the draft:** committed adversarial
synthetic twins are not a centerpiece to demote — they are the only layer CI can re-run (real nights
are gitignored), which is why §🔏 prefers them for fixtures. Real-data validation and synthetic CI
reproducibility are different jobs; this roadmap keeps both and says which is which.

## §7 · QUALITY & UNCERTAINTY — architecture, not a statistics framework
The fields exist after §1; this phase is the discipline: `quality` ≠ `confidence` ≠ `uncertainty` ≠
evidence tier, each named, none substituting. Unknown uncertainty is `null` + machine-readable
reason (`defined-is-not-informative`: a computable statistic with no information is refused, not
reported). No new estimators in this phase.

## §8 · INTEGRATOR INTERFACE — consume, don't rewrite
The Integrator reads `measurement` blocks where present (adapter tolerating absence), reasons over
value+unit+window+quality+refs instead of bare scalars, and its fusion export carries consumed refs
forward. **No fusion-engine work** — interface only. Gate: the existing Integrator suites + a new
consumes-canonical group; historical fusion fixtures stay `historical:true` byte-pinned.

## §9 · TESTS — protecting invariants, not counts
Schema group (§1) · provenance-resolution group (§4, incl. fail-closed) · timing group (clock-domain
preserved; corrected never silently substitutes raw — assert BOTH fields coexist) · numerical
regression (equiv legs, tolerance zero for §3) · oracle comparisons (§5, pre-stated bands) ·
**negative table, verbatim from the draft because it is good:** missing evidenceRef · invalid unit ·
impossible timestamps · unknown clockDomain · missing code identity · malformed provenance ·
NaN/Infinity · zero-length window · negative duration · absurd ranges · duplicate event ids.
Every negative test carries a planted control **verified to fire for the mechanism under test**
(the control-vacuity rule). New modules join the mutation `DEFAULT_FLEET`.

## §10 · PERFORMANCE — measure on a real night, respect the export boundary
The measurement layer decorates DERIVED outputs (~300× summarised below raw — the export boundary is
already the bottleneck); raw signals stay typed arrays, never per-sample objects, no `Array.from` on
big buffers, no waveform JSON. Benchmark one representative overnight per touched node: runtime, peak
memory, export size delta (expected: KBs). Pre-state acceptable deltas before measuring.

## §11 · INTEROP MAPPING — document, defer adapters
One `docs/` note mapping Tepna ↔ WFDB/PhysioNet concepts (signal/channel/fs/unit/annotation/record/
start time; EDF already an ingest format via CPAPDex). Implement an export adapter only if it is
provably low-risk and somebody needs it; otherwise the doc is the deliverable. Tepna is not
redesigned around WFDB.

## §12 · REMAINDER — node migrations and open scientific questions (written 2026-09-21, closes the map)
The last Done-when item asked for these "as the follow-up brief". **No `-FOLLOWUPS-` file is created**:
the owner ruling of 2026-09-02 (CLAUDE.md §📌, `briefs/RESIDUE.md`) says a follow-up brief is written
only by the session that picks the work up, so it has an owner the moment it exists — and this roadmap
is itself the index ("this file is the index and stays the map"). So the list lives HERE, the verified
defects it contains are residue rows (keyed on the Status line), and a unit spawns its own dated brief
when picked up, exactly as every phase above did.

**Node migrations — one unit each, in the order the emitter cost suggests (regen tooling exists for all):**

| node | headline instances to emit | notes |
|---|---|---|
| ECGDex | meanHR · rMSSD · SDNN · (AHI-estimate) | the §5 oracle already names the code that agrees with the firmware; `deviceRR` gives a second `sourceChannel` per night |
| PulseDex | rMSSD · SDNN · meanRR | RR-only input — `inputHash` is the RR train's contentId; no waveform |
| PpgDex | rMSSD · meanHR · SpO₂-proxy where emitted | the seam-refusal (`clock-seam`) must map to *no block*, never a block over a discontinuity (§∅ ruling 2026-09-17) |
| HRVDex | the per-measurement `measurements[]` rows | already a per-instance table — the block is the lineage it lacks; naming collision with `measurement` must be handled explicitly, not by renaming the existing table |
| GlucoDex | mean glucose · TIR · CV · GMI | CGM windows are days, not nights — `window` spans the record; the 14 h-gap twin is the plant |
| CPAPDex | AHI · leak p95 · usage | EDF ingest — `sourceChannel` names the EDF signal label; the device-scored AHI is a *measured* basis, ours is *derived* |
| MotionDex | actigraphy immobile fraction · arousal index | the F1 counter step (`_clockResyncs`) → `clockDomain` must say which segment |
| Integrator | per-**finding** refs (`findings[].sources[]` still carry bare scalars), `adaptEnvelopeNode` gains `consumeMeasurements` (one line) with the second emitter; kernel-audit ref integrity (§4's unbuilt half) | after ≥ 2 emitters |

**Open scientific questions (each a unit with pre-stated bands, none a code change by itself):**

1. **The per-beat LoA shortfall (35 ms vs 30 ms) on reconnection-heavy nights** — is the band right and
   those nights refused for beat-level use, or does the pairing need a stronger anchor across a stalled
   link? The harness already publishes the per-window verdicts; the decision is not made.
2. **A second modality for the oracle** — the PPG leg is coverage only (32 usable Verity nights). Two
   detectors on one lead share its artefacts; agreement across modalities is the claim the ECG leg
   cannot make.
3. **The oxygen leg has no same-signal oracle** — the ODI-bias lane (`docs/ODI-BIAS-README.md`) is a
   cross-device night-level reference; per-event truth needs manual scoring or PSG. Whether the
   ODI-4 walk-through should *consume* that lane's calibration is a design question, not an emitter one.
4. **Uncertainty estimators** — every emitted block says `null` + reason. Which metrics admit a bootstrap
   over windows, which a coverage-weighted bound, and which honestly none (§7: architecture, not a
   statistics framework).
5. **Window-level lineage under the export boundary** — §10's measured cost is +4.1–4.35 KB per night for
   four whole-night blocks (+11–17 %), because shared window/evidence/reason objects serialise per block.
   Hoisting the shared parts is a contract change; it must precede any per-window emission.

**Verified remainders logged as residue** (keys on the Status line): the envelope hop unexercised on
every committed fixture; the export-size repetition; §10 runtime/memory unmeasured; §11 interop doc
unwritten.

## NON-GOALS (the draft's list, plus Tepna's own)
No capture-host rewrite · no BLE redesign · no new clock system (§7 exists) · no DSP rewrites · no
runtime NeuroKit2/WFDB (dev-lane only, quarantined) · no synthetic-golden re-centering · no
speculative PAT (the wall is published) · no cloud, no network, browser/local-first inviolable ·
**no renaming Ganglior/fascia · no second badge/evidence vocabulary · no hand-typed version strings
· no per-sample Measurement objects · no editing raw evidence, ever**.

## SEQUENCING & OWNER DECISION POINTS
Order: §1 → §2 → §3 (+§4 inside it) → §9 as it goes → §8 → §5 → §10/§11; later node migrations are
listed at §3's close, one brief each. Owner decides: (a) the §1 schema MINOR bump timing (it re-stamps
one node's fixtures in §3, all eight eventually — staged, never fleet-wide at once); (b) the §5
oracle dev-dependency set (SOUP note required); (c) whether §11 gets an adapter or stays a doc.

## Done when (this roadmap file)
- [x] §1+§2 contract brief **SPAWNED AND EXECUTED 2026-09-17** — gates green (schema group live, 27 assertions; `npm run check` 16/16). The shape is specified and validated; NO node emits it, which is §3.
- [~] ~~§1+§2 contract brief **SPAWNED 2026-09-17**~~ — `MEASUREMENT-INSTANCE-CONTRACT-2026-09-17-BRIEF.md`
      (unassigned; any session may pick it up). Still owed by that brief: executed, gates green,
      schema groups live. It holds the scope fence this item implies — spec + validator + tests,
      **no node emits**, so it moves no fixture and no `manifestHash`; emission is §3.
- [x] §3 reference path executed: one real night's OxyDex export carries resolvable measurement
      blocks; the backward walk-through is written and checkable.
      ✅ **DONE 2026-09-21 (Osprey).** OxyDex is the first emitter: every night element carries
      `measurement.{meanSpo2,t90,odi4,hypoxicBurden}`, `schema.version` 2.1, desat events carry
      `inputHash`+`evidenceRef` (§2). **Numerical invariance measured, not claimed:** the regenerator
      reported exactly ONE moved field on each of the three fixtures (`measurement: undefined → {…}`),
      every other byte identical. `code` comes off a new build-time `<html data-manifest-hash
      data-compute-hash>` stamp (tools/build-core.js, both lanes) that is manifestHash-INVARIANT by the
      same masking construction as the version stamp — so only OxyDex's hash moved
      (1b7905a69e6b → 57a90c14bc79) and only its 3 fixtures were re-recorded. `evidence.inputHash` is
      `contentId` (12-hex, recomputable from the committed input; the raw file's sha256 sits one hop
      further in the ledger). All four blocks validate under `measurement-block.js` with all five
      legs RUN, on the synthetic golden and both real nights. **Walk-through, checkable:**
      `docs/MEASUREMENT-WALKTHROUGH-OXYDEX-2026-09-21.md` + `tools/measurement-walk.mjs` (re-derives
      every hop from disk — value, window, channel, code vs the shipped bundle AND the ledger, contentId
      recomputed by the real parser, envelope reason, ledger vs raw bytes; 13 plants). Gates: two
      new groups (36 + 22 assertions) incl. the done-when literally — fixture `code.computeHash` ≡
      shipped `OxyDex.html`; build-core-tests assert the stamp on all 9 GATE-A bundles. Deliberately
      NOT done: the envelope hop is unexercised on committed fixtures (they are CSVs; a `.dat` +
      `acq/*.json` night carries `session_id`); no uncertainty model (null + reason).
- [x] §5 harness runs at least the R-peak and HR comparisons on real nights with pre-stated bands.
      ✅ **DONE 2026-09-21 (Osprey) — `tools/oracle-ecg-firmware-rr.mjs`, run over 52 real H10 nights
      (965 326 beats).** Reference = the strap FIRMWARE's RR train (an independent detector on the same
      lead; no dev-dep, so §5's quarantine holds by construction — and `tools/oracle/` was NOT used
      because both tool gates read `tools/` non-recursively). Bands written before the first night; the
      caveats machine-printed every run. **Detector comparison (pairing-free): mean RR Δ 0.40 %, rMSSD Δ
      1.2 % — CONSISTENT.** Per-beat rows are BIMODAL — 20 nights paired within one sample (≈ 1 ms), 25
      UNPAIRED because the index alignment (±60 beats/decile) loses the train when the firmware's
      surplus (up to +34 %, bursts where ECGDex refused) exceeds it; SDNN inherits the extent
      difference (8.85 % SHORTFALL). Two findings on our side: `validateRR` / the export's `validation`
      compare a gap-contaminated train (65 797.8 % dRMSSD on 2026-09-03 — residue
      `2026-09-21-validaterr-compares-gap-spanning-intervals`, fix is a separate PR), and the harness's
      first LoA paired with one global offset (fixed before the report; both numbers stated).
      **Next unit, named:** the TIME-ANCHORED pairing §5 literally asks for (cumulate firmware RR,
      re-anchor on arrival stamps, tolerance-window pair), which turns 25 unpaired nights into a
      measurement. ✅ **EXECUTED the same day (Osprey), same tool, same 52 nights, bands pre-stated
      in the header before the first run:** firmware beats placed on the host axis (300-beat lower-
      envelope anchors + per-600-beat coincidence-search latency, halved to 150 across a step; a
      window with no peak is *unanchored*, never paired at the night's average), paired 1:1 within
      ±150 ms. **matched self 98.7 % / matched firmware 99.2 % (both ≥ 97 % CONSISTENT); RR |Δ| on
      pairs 0.45 ms, ≤ 8 ms on 52/52 nights; LoA 35 ms SHORTFALL (bar 30) with an empirical 95 %
      width of 1.9 ms — tail-driven, reported as the band says, not re-banded.** The stream's delivery
      latency is ≈ 2.2 s and STEPS at reconnections (0.2 → 4.6 s within one night). The 4 nights
      < 90 % (09-04, 09-20 at 48.7 %; 09-05; 08-29) each carry 14–33 anchor jumps and 2 100–3 653
      firmware beats in unanchored windows — coverage of the instrument on reconnection-heavy nights,
      listed in the doc, not averaged over. PPG leg: coverage only (37 Verity nights with `_PPI.txt`, 32 usable). Detail:
      `docs/ORACLE-ECG-FIRMWARE-RR-2026-09-21.md`. Related landing the same night, different instrument:
      #2759 validated the capture-host live-strip R detector against the same firmware stream.
- [x] §8 Integrator consumes canonical blocks behind a tolerant adapter.
      ✅ **DONE 2026-09-21 (Osprey) — interface only, no fusion-engine work.** `integrator-dsp.js
      consumeMeasurements(night, scalars)`, wired into `adaptOxyDex`: a night carrying `measurement.*`
      adapts to a rec with `measurements.{blocks, resolved, unresolved}`; each block becomes a REF
      (metricId · value · basis · window · code · evidence join · `provenance: resolved|unresolved` +
      reason), never the payload, and the refs ride forward on the fusion export's node card
      (`nodes[].measurements`). **Tolerant:** a legacy export adds no key anywhere — measured with
      `regen-integrator-goldens --check`: 0 of 5 fixtures moved (their inputs predate the block).
      **Fail closed (§4):** inputHash ≠ the element's contentId · missing/non-12-hex code identity ·
      value ≠ the element scalar (the block adds lineage, never a second number) · non-positive window ·
      non-finite value — each reads `unresolved` with the reason named, carried forward LOUDLY, while the
      summary scalar every existing consumer reads is untouched. The summary scalars stay element-
      sourced; a resolved block is what makes them walkable. 25 assertions (real OxyDex 2.1 export →
      4/0 resolved, legacy → no key, five plants). Integrator manifestHash 1430f6feee5d → 29252cdcfe8c.
      Verified before writing (Kestrel's two named interactions): the `fascia` alias is an EVENTS-key
      alias (`fascia_events`, `BUS_ALIASES`) and `ganglior.crossnight` is a top-level ≥3-night block —
      neither touches the per-night `measurement` map, which only `adaptOxyDex` (the route every
      `nights[]` export takes) reads. NOT done, deliberately: only OxyDex emits, so only `adaptOxyDex` consumes — the generic
      `adaptEnvelopeNode` gains the call when a second node emits (one line, `consumeMeasurements` is
      node-agnostic); the render surface does not yet show the refs (interface only, per §8).
- [x] The final report answers the draft's F-section honestly: what this does NOT prove
      scientifically (agreement ≠ physiological truth; provenance ≠ accuracy).
      ✅ **DONE 2026-09-21 (Osprey) — `docs/MEASUREMENT-PROVENANCE-REPORT-2026-09-21.md`.** "Honest"
      pre-stated as six criteria before the writing (every "proves" names its gate; every "does not
      prove" names the missing mechanism and where it stands; numbers carry n, a missed band stays
      missed; unexecuted sections listed as such; no tier moves; each limit labelled FOUND vs ASSUMED).
      §1 delivered-with-gate table (§1+§2, §3, §3 D, §5, §8, §4 partial); §2 what it proves; §3 the
      F-section — twelve limits: provenance ≠ accuracy (the ODI-bias lane named as the cross-device
      night-level reference that exists; per-event truth out of scope), agreement ≠ truth (sharpened
      by the bimodal finding), the LoA shortfall standing, contentId ≠ file hash, the envelope hop
      unexercised, uncertainty null everywhere, one emitter / findings still bare scalars, night-level
      windows only (with §10's measured cost: +4.1–4.35 KB per night, +11–17 %), per-bundle code
      identity, §4 kernel-audit not built, §10 runtime/memory unmeasured, §11 unwritten, no tier
      moves. §4 found-vs-assumed in one place. The right-hand column is the follow-up brief's input.
- [x] Remaining node migrations + unresolved scientific questions listed as the follow-up brief.
      ✅ **DONE 2026-09-21 (Osprey) — listed as §12 of THIS file, not as a `-FOLLOWUPS-` brief**, per the
      owner ruling of 2026-09-02 (a follow-up brief is created only by the session that picks the work
      up); the four verified remainders are residue rows, keyed on the Status line. Seven node
      migrations + the Integrator's per-finding refs, and five open scientific questions, each a unit
      with its own dated brief when picked up.
