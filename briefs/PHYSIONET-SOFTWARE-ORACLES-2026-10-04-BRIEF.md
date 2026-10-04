<!--
  PHYSIONET-SOFTWARE-ORACLES-2026-10-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-10-04 ·

# PhysioNet's software as ORACLES — seven packages, one rule, no new runtime dependency

**SIZED, NOT BUILT** (owner, 2026-10-04: "anything here can be used by Tepna?" → "write it up"). PhysioNet lists 56
software packages (https://physionet.org/about/software/). Seven are worth a unit each; the other forty-nine are MATLAB
toolboxes, clinical-text tools or simulators the suite has no lane for. One rule governs all seven, and it is the rule the
existing QRS differential already follows.

## 0 · The rule: reference material on the tools side, never a dependency in a bundle

`tools/ecg-physionet-differential.mjs` (`docs/ECG-PHYSIONET-DIFFERENTIAL-README.md`) scores ECGDex's Pan–Tompkins against
MIT-BIH expert annotations under the EC57 150 ms window with its **own** WFDB reader (formats 212 and 16, the `ecgcodes.h`
beat set, the `WFDB_INVALID_SAMPLE` sentinel) and **no PhysioNet code inside the repository**. That is the shape every
package below keeps:

- A package runs **off-tree** — a dev/analysis tool under `tools/` or a capture-host dev dependency that `check.sh` never
  imports at runtime — and the gate compares its output to ours. Nothing is inlined into a `Foo.html` (runtime SOUP stays
  empty by design, `docs/COMPLIANCE/`), nothing is added to `THIRD-PARTY.md` as a shipped component.
- **Licences bind the placement, not the use**: most PhysioNet packages are GPL-2.0/3.0 or BSD. A GPL tool invoked as a
  separate process to produce a reference number is an oracle; a GPL function copied into Apache-2.0 source is a licence
  violation. The literature policy's three hard lines apply (`LITERATURE-USE-POLICY-2026-07-11-BRIEF.md`): a reference
  value that reaches runtime is inlined as a cited constant, never fetched; attribution is author·year·DOI in the doc and
  a source comment in code.
- Every oracle emits ONE `tepna.verdict/1` with a **pre-stated** criterion, and its population is the set of public records
  it actually read (`VERDICT-CONTRACT-2026-09-21-BRIEF.md`).
- Public PhysioNet records are **open-access** for everything below. The **credentialing** the owner is completing (CITI
  training approved 2026-10-04 16:38; the credential application still owes a reference) is needed for the **deposit**
  path named in `CAPTURE-NIGHT-SEAL-2026-09-21-BRIEF.md` §(targets) and for protected sets such as MIMIC — not for any
  oracle here.

## 1 · The seven, by what each settles

| # | package (PhysioNet name) | licence (verify on fetch) | what it settles for Tepna | placement | size |
|---|---|---|---|---|---|
| 1 | **ECG-Derived Respiration** | GPL | the canonical EDR reference. ECGDex's EDR rate was lag-quantised at 4 Hz (unit in flight, Magpie) and the agreement panel compares two ESTIMATES; the CPAP `RespRate` is the measured reference where a CPAP night exists, and this package is the published algorithm to compare against where it does not. Oracle criterion pre-stated from the existing RRacc validation: MAE ≤ 1.1 brpm against the CPAP flow reference, with the reference's 0.74 brpm floor stated | `tools/oracle-edr-reference.mjs`, runs on MIT-BIH / Fantasia records with respiration channels | 1 unit |
| 2 | **ECGPUWAVE** + the WFDB detectors (`gqrs`, `sqrs`, `wqrs`) | GPL | more INDEPENDENT detectors for the QRS differential, so a Pan–Tompkins miss is attributed to the detector or to the record, not guessed. The differential already has the harness and the EC57 window; adding a detector is a column | extend `ecg-physionet-differential.mjs` to read a second annotation set | 1 unit |
| 3 | **Sample Entropy Estimation** (Costa / Goldberger `sampen`) | GPL | the reference implementation of the statistic PulseDex computes with a 20 000-beat uniform decimation (`pulsedex-dsp.js sampEn`). A known-answer oracle on a public RR series answers the open question whether the decimated figure IS sample entropy; the row that follows decides window-vs-cap | `tools/oracle-sampen-reference.mjs` | ½ unit |
| 4 | **Software for computing Heart Rate Fragmentation** (Costa 2017) | GPL | the published definition behind the suite's "fragmentation" vocabulary (PIP, IALS, PNNSS, PSS); a check that PulseDex/HRVDex figures match the paper's on a public record, with the citation the literature policy demands | oracle, same shape as 3 | ½ unit |
| 5 | **ECGSYN** and **Model for Simulating ECG and PPG Signals with Arrhythmia** | GPL | SYNTHETIC records whose beat times and rhythms are known BY CONSTRUCTION — the fixture every plant this week wanted (rounding mutants survive on round numbers; a synthetic record with known 14.6 brpm respiration or a known RR series distinguishes them). The GENERATOR stays off-tree; its OUTPUT is committed as a fixture with the generator's parameters in the fixture's provenance record | `tools/gen-*-fixture.mjs` off-tree, fixtures under `uploads/synthetic/` with provenance | 1 unit |
| 6 | **edf-anonymize** | GPL | required before any CPAP EDF leaves the box for a PhysioNet deposit (`CAPTURE-NIGHT-SEAL` §deposit); also the measured answer to "which EDF header fields carry identity" for the fixture-provenance census | capture-host deploy tooling, run on the rig, never on vigil | ½ unit, after the seal's phase B |
| 7 | **Apnea Detection from the ECG** (the 2000 Challenge entry) | GPL | a published single-lead apnea detector to compare against the CPAP machine's own event log on nights where both exist — a second estimator for the CPAP-night validation, badged `emerging` | analysis tool, after 1 | 1 unit, later |

**Not taken, and why:** the MATLAB toolboxes (ECG-Kit, Cardiovascular Signal Toolbox, R-DECO, WFDB for MATLAB) — no Octave
lane and the project keeps one runtime; the cardiovascular simulators beyond #5; the de-identification and clinical-text
tools (no clinical text exists here); PhysioTag (an annotation platform, a service); `record`/`Digital Data Real-Time
Ingestion` (HP monitor capture — a different device class).

## 2 · Order

1. **#1 EDR reference**, because Magpie's EDR unit and the Integrator's CPAP comparator are being built now and need the
   published algorithm as their third leg. Lands as the oracle plus a `papers/` note of the number it produced.
2. **#5 synthetic fixtures**, because every drain this week paid for fixtures that could not distinguish a mutant.
3. **#3 and #4** together, one PR: the two PulseDex/HRVDex reference checks.
4. **#2** when the differential next moves.
5. **#6** with the night-seal's deposit phase; **#7** after a CPAP-night validation brief exists.

## 3 · Done when

- [ ] Each adopted oracle is a tool under `tools/` with a `TOOLS-INDEX` row, invoked as a separate process, emitting one
  `tepna.verdict/1` whose `evidence` names the public records read and whose `producedBy` names the package and version.
- [ ] `THIRD-PARTY.md` lists each package under a "reference tools (not shipped)" heading with licence and URL; no bundle's
  `manifestHash` moves because of any of them (`computeHash` unchanged — quote it).
- [ ] The citation ledger carries each package's paper (author·year·journal·DOI) and the reader-facing docs cite it.
- [ ] One measured number per oracle written into the brief that owns the figure (EDR → the ECGDex reference; SampEn and
  fragmentation → the PulseDex reference; the differential → its README).
