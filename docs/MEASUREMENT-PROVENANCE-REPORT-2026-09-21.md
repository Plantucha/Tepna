<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** REFERENCE (living — re-verify the numbers against the tools that produced them when OxyDex, the oracle harness or the Integrator adapter change; every number here names its source) · **last-verified:** 2026-09-21 · **Executes:** `MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26-BRIEF.md` — the final report, and its F-section ("what this does NOT prove") · **Relates:** `docs/MEASUREMENT-WALKTHROUGH-OXYDEX-2026-09-21.md`, `docs/ORACLE-ECG-FIRMWARE-RR-2026-09-21.md`, `docs/EXPORT-SHAPES.md`, `measurement-block.js`, CLAUDE.md §🔏 · §∅ · §🎫

# The measurement-provenance programme — final report, and what it does not prove

The roadmap's goal sentence: *a skeptical researcher can walk any number back to raw evidence and
challenge it.* Five of its eleven sections were executed between 2026-09-17 and 2026-09-21 (§1+§2 the
contract, §3 the reference path, §5 the oracle harness, §8 the Integrator interface); the rest are
doctrine that already existed (§6, §7, §9 in part), partially executed (§4), or unexecuted (§10, §11).
This page says which is which, and then — the F-section — what none of it proves.

## 0 · What "honest" means here, stated before the writing

The draft asked for an F-section "answered honestly". A word like that is a band; it is stated first so
the report can be checked against it rather than read as tone:

| # | criterion | the failure it excludes |
|---|---|---|
| H1 | every **"proves"** names the artifact or gate that proves it | prose evidence — "verified", "export-inert", "consistent" with nothing behind the word |
| H2 | every **"does not prove"** names the mechanism that would be needed and whether it exists in the tree, is planned in the follow-up brief, or is out of scope | a caveat as decoration beside a claim it does not limit |
| H3 | numbers carry their **n / window**, and a band **missed** is reported as missed | the LoA shortfall rewritten as a pass by moving the band, or by averaging the four nights that cause it away |
| H4 | sections **not executed** are listed as not executed | folding doctrine that pre-existed the roadmap into "delivered" |
| H5 | no **evidence tier** moves on this page | "the oracle agrees, so ODI-4 is `measured`" — a badge upgraded on prose (§🎫) |
| H6 | each limit is labelled **found** (the programme measured it) or **assumed** (a limit of the design, known before any run) | claiming discovery for a design decision, or presenting a measured limit as if it had been foreseen |

## 1 · What was built, and the gate behind each claim (H1)

| section | delivered | proven by |
|---|---|---|
| **§1+§2** the contract | `measurement-block.js validateMeasurement → {ok, errors[], checked[]}`; the `basis` enum kept apart from the evidence ladder; `null`-with-reason at every optional field | 27-assertion schema group with roadmap §9's negative table, both anti-vacuity directions, a published `checked[]` denominator; two rows the group **says** it does not cover (absurd ranges — needs the unit, which is the emitter's; duplicate event ids — §2's) |
| **§3** the reference path | OxyDex emits `measurement.{meanSpo2,t90,odi4,hypoxicBurden}` on every night element; `schema.version` 2.1; desat events carry `inputHash`+`evidenceRef`; every owned bundle carries its own `manifestHash`/`computeHash` on `<html>` | **invariance measured**: `regen-oxydex-goldens` reported exactly one moved field per fixture (`measurement: undefined → {…}`), every other byte identical; only OxyDex's manifestHash moved, 8 bundles byte-different and hash-identical (`build-core-tests`, decoy-gated); `verify-fixtures` re-stamped 2 real fixtures; 36+22 assertions incl. the done-when literally (fixture `code.computeHash` ≡ shipped `OxyDex.html`) |
| **§3 D** the walk-through | `docs/MEASUREMENT-WALKTHROUGH-OXYDEX-2026-09-21.md` + `tools/measurement-walk.mjs` | re-derives every hop from disk (value, window, channel, code vs bundle AND ledger, `contentId` recomputed by the real parser, envelope reason, ledger vs raw bytes) — green on 3/3 fixtures; 13 plants, each hop catching its own corruption; an absent input prints `∘`, never ✓ |
| **§5** the oracle harness, ECG leg | `tools/oracle-ecg-firmware-rr.mjs`: ECGDex Pan–Tompkins vs the H10 firmware detector, 52 real nights, 965 326 beats, bands pre-stated in the header before the first night; two pairings — index alignment, then time-anchored (firmware RR on the host axis, per-window coincidence latency) | `docs/ORACLE-ECG-FIRMWARE-RR-2026-09-21.md`; 26 selftests; the caveats machine-printed every run |
| **§8** the Integrator interface | `consumeMeasurements` in `adaptOxyDex`: blocks → refs (value · identity · join · verdict) on the rec and on the fusion export's node cards; fail-closed `unresolved` with the reason named | 25 assertions; `regen-integrator-goldens --check`: **0 of 5** fusion fixtures moved on a legacy input; 5 plants |
| **§4** (partial) | refs-not-payloads on the Integrator side; fail-closed at the adapter | — the kernel-audit ref-integrity extension is **not built** (see §3 of this page) |

Found along the way, and fixed: `validateRR` / the export's `validation` block compared a
gap-contaminated NN train (65 797.8 % dRMSSD on one night, from a single 1 232 840 ms interval) —
residue `2026-09-21-validaterr-compares-gap-spanning-intervals`, closed `fixed #2762`.

## 2 · What it proves

- **A number in an OxyDex export can be walked back to the bytes it was computed from, by a tool, not
  by a reader.** Value → block → window → channel → `code` (bundle and ledger) → `contentId`
  (recomputed) → ledger → `sha256[0:16]` of the file. (H1: the tool, 3/3 green.)
- **Adding lineage moved no number.** One field per fixture; the equiv gate pins every value in the
  block; the fixture-identity gate pins the code identity. (H1: regen output, two gate groups.)
- **A wrong lineage is refused, not absorbed.** A block whose refs do not resolve — different input,
  no code, a value that disagrees with the element, a zero window — reaches the fusion export as
  `unresolved` with its reason, and the scalar every consumer reads is untouched. (H1: five plants.)
- **Two independent R-peak detectors on the same lead place the same beats within one sample, on
  every one of 52 nights**, once the firmware stream is put on the host clock: matched 98.7 % / 99.2 %
  (bar ≥ 97 %), RR |Δ| on consecutively matched pairs 0.45 ms (bar ≤ 8 ms, met on 52/52); mean RR Δ
  0.40 %, rMSSD Δ 1.2 % pairing-free. (H1: the harness, H3: n = 52 nights.)
- **And the harness reports what it missed.** LoA on pairs 35 ms against a 30 ms bar — **SHORTFALL**,
  tail-driven (empirical 95 % width 1.9 ms), the tails being four reconnection-heavy nights
  (14–33 anchor jumps, 2 100–3 653 unanchored beats each; two of them at 48.7 % matched). Listed, not
  averaged over; the band not moved. Index alignment: SDNN 8.85 % and beat count 1.55 % SHORTFALL,
  both from the extent difference the time pairing then accounted for. (H3.)

## 3 · F — what this does NOT prove (H2 · H6)

| limit | found / assumed | what it does not prove | what would be needed, and where that stands |
|---|---|---|---|
| **Provenance ≠ accuracy** | assumed | The walk-through shows *where* ODI-4 = 1.2 ev/h came from. It says nothing about whether 1.2 is the night's true desaturation index. | A per-night reference for ODI-4 **exists outside this programme** — `docs/ODI-BIAS-README.md` / `odi-bias-analysis.html` compares ODI-4 against CPAP device-scored AHI across nights and publishes a recalibration curve — but it is a cross-device, night-level comparison, not per-event truth, and the walk-through does not consume it. Per-event truth needs manual scoring or PSG on the same night: out of scope. The oxygen leg of §5 has **no same-signal oracle** (the O2Ring carries no second SpO₂ detector). |
| **Agreement ≠ physiological truth** | assumed, then **sharpened by measurement** | Two detectors agreeing within one sample on the same lead proves they see the same waveform, not that the waveform's R-peaks are the heart's. Both run on the same electrode and share its artefacts; the firmware is a reference, not ground truth — the harness prints this caveat every run. **Measured sharpening:** the *bimodal* index-alignment result (20 nights paired, 25 unpaired) was an instrument limit, not a detector disagreement — which is exactly the kind of thing agreement statistics cannot tell you until the instrument is rebuilt. | An independent modality (the tri-device corpus has PPG; the PPG leg of §5 is **coverage only** — 32 usable Verity nights, unpaired). Follow-up brief. |
| **The LoA shortfall stands** | found | Per-beat agreement is not uniform across nights. The 35 ms LoA is a property of the four reconnection-heavy nights; the other 48 sit near 2 ms. A reader who needs an all-night per-beat bound cannot quote 0.45 ms. | Either the band is right and those nights are refused for beat-level use (a coverage verdict the harness already publishes per window), or the pairing needs a stronger anchor across a stalled link. Not decided here — a scientific question for the follow-up brief. |
| **`inputHash` is a content address of the decoded signal, not of the file** | assumed | `contentId` folds the 1 Hz SpO₂ samples + `t0Ms` with a deterministic-stride 53-bit hash. It is a collision-*resistant* handle, not a cryptographic one, and a `.dat` and its CSV decode share it by design. | The file's identity is the ledger's `inputHashes` one hop further (`sha256[0:16]`); the tool walks both. A 12-hex address is what the contract specifies; a stronger one is a contract change. |
| **The envelope hop is unexercised** — **CLOSED #PRNUM (2026-09-21)** | found (by the fixtures' shape); now exercised | Was: every committed fixture a CSV, `evidence.envelopeRef` null + reason on all three. Now a FOURTH OxyDex fixture, `OxyDex_2026-09-19_2245_stored_summary.json`, is a stored O2Ring `.dat` night WITH its `.dat.meta.json` acquisition envelope (7.1 h box night, `ganglior.acquisition-evidence` 1.1.0), built through decode → `computeNight` → `_attachAcqEvidence` (the DSP's own session_id join) → `buildNightElement`, no DSP change, `computeHash` unmoved (44afcc7993df). `evidence.envelopeRef = 20260919224526`, a real session_id. `tools/measurement-walk.mjs` now RE-DERIVES the hop from the envelope on disk (session_id ∈ the .dat filename, and the envelope's `artifact_sha256` ≡ sha256 of the .dat bytes) instead of echoing the ref, pins every ledger input (the night AND the envelope), and emits one `tepna.verdict/1` per fixture under `--json`. Planted: a corrupted session_id reds `envelope` by name (selftest, and a real run against a scratch envelope → FAIL). | Inputs stay corpus-backed (gitignored, `.gitignore` excludes real recordings by policy); the fixture itself is committed and its envelopeRef is pinned on committed bytes in CI. |
| **Uncertainty is `null` on every emitted block** | assumed (§7: "no new estimators in this phase") | The block has a slot for uncertainty and nothing fills it. A reader gets "unknown, stated", which is honest and is also not a number. | An estimator per metric with a named method (bootstrap over windows, a coverage-weighted bound). Not built; a per-node unit each. |
| **One node emits; the Integrator consumes one node; fusion reasoning is unchanged** | assumed (§8: interface only) | The fusion **findings** still carry bare scalars in their `sources[]`; a confirmed-apnea finding cannot yet name the measurement instances behind its desat and its surge. The refs ride on the node cards, not on the findings. | Per-finding refs once ≥ 2 nodes emit; the generic `adaptEnvelopeNode` gains the `consumeMeasurements` call (one line) with the second emitter. Follow-up brief. |
| **The window is the whole night** | assumed | Lineage is per night-level metric. Per-window / per-epoch metrics (the rolling series, the crossnight block, every `research.*` field) have no instance lineage. | Blocks at window granularity — but §10's export boundary applies: the four whole-night blocks already added **+4.1–4.35 KB per night (+11–17 % of a summary export)**, because the shared window/evidence/reason objects serialise once per block. Measured 2026-09-21 on the three fixtures; a window-level emission needs the shared parts hoisted first. |
| **Code identity is per bundle, not per function** | assumed | A moved `computeHash` says "something in the compute closure changed", not what. The closure is a denylist and over-flags on purpose. | Finer identity is a different provenance model; not planned. |
| **§4's kernel-audit extension is not built** | not executed | The Integrator's `kernelAudit` asserts kernel-hash agreement across nodes; it does not yet assert ref integrity across the fusion. Fail-closed exists at the adapter only. | One unit, after per-finding refs. Follow-up brief. |
| **§10 performance is measured on one dimension only** | not executed (except size) | Export size delta is measured (above). Runtime and peak memory on a representative night were **not** measured for the emitter or the adapter. | The measurement is cheap; the acceptable deltas must be pre-stated before it runs. Follow-up brief. |
| **§11 interop is a table in a roadmap, not a doc** | not executed | No Tepna ↔ WFDB/PhysioNet concept mapping exists; EDF remains an ingest format only. | The doc is the deliverable; an adapter only if provably low-risk. Follow-up brief. |
| **Nothing here upgrades a tier** | assumed (H5) | ODI-4 stays `validated`, hypoxic burden stays `experimental`, the ECG R-peak stays where the registry puts it. Agreement with the firmware detector is a validation *result* recorded in a doc, not a citation, and the literature-use policy is explicit that only a checkable citation moves a badge. | — |

## 4 · Limits found versus limits assumed (H6, in one place)

**Found by running it:** the bimodal pairing (an instrument limit, rebuilt); the firmware stream's
delivery latency that *steps* at reconnections (0.2 → 4.6 s within a night — the fact that made
per-window anchoring necessary); the LoA shortfall and the four nights behind it; `validateRR`
comparing across gaps; the plateau-edge and refuse-before-halve defects in the coincidence search
(caught by plants before the corpus saw them); the export-size cost of per-block repetition.

**Assumed by design:** provenance ≠ accuracy; agreement ≠ truth; `contentId` ≠ file hash; no
uncertainty estimator; one emitter; night-level windows; per-bundle code identity; no tier moves.

The distinction matters because only the first list is evidence the programme *works as an
instrument* — a method that finds no limits has not been pointed at anything.

## 5 · What closes the roadmap

Two Done-when items remained when this page was written: this report, and the follow-up brief listing
the remaining node migrations and the open scientific questions (the right-hand column of §3 above is
its input). Everything else in the roadmap is either delivered with the gate named in §1, or listed
here as not executed — nothing is in a third state.
