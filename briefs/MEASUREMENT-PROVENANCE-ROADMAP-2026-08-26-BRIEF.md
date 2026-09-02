<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED (parked 2026-09-02 — drain triage, Kestrel: a ROADMAP whose first unit, the §1+§2 measurement-block schema contract, is a MINOR schema bump that re-stamps every node's fixtures in stages — §📦 makes its timing the owner's call, and the owner has not scheduled it; none of the six done-when items is started and none can start before that decision. Owner: the owner (schedule) → Kestrel (spawns the §1+§2 contract brief when scheduled). Not to be executed during the drain) · **Created:** 2026-08-26 · **Follows:** `ACQ-EVIDENCE-CONTRACT-2026-08-24-BRIEF.md` (the acquisition half of this chain — 21/22 §21 criteria met, last one in flight) · **Relates:** CLAUDE.md §🔒 Clock Contract, §🎫 evidence ladder, §🔏 provenance gates, `docs/LEXICON.md`

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
- [ ] §1+§2 contract brief spawned, executed, gates green (schema groups live).
- [ ] §3 reference path executed: one real night's OxyDex export carries resolvable measurement
      blocks; the backward walk-through is written and checkable.
- [ ] §5 harness runs at least the R-peak and HR comparisons on real nights with pre-stated bands.
- [ ] §8 Integrator consumes canonical blocks behind a tolerant adapter.
- [ ] The final report answers the draft's F-section honestly: what this does NOT prove
      scientifically (agreement ≠ physiological truth; provenance ≠ accuracy).
- [ ] Remaining node migrations + unresolved scientific questions listed as the follow-up brief.
