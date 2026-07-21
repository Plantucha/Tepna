<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-20

Follow-ups discovered while executing `OXYDEX-PULSE-RESOURCING-2026-07-18-BRIEF.md` (all 4 phases
DONE 2026-07-20). Nothing here blocks the shipped work — each item is **corpus-gated**: it needs the real
tri-device corpus (O2Ring + Polar H10 + Verity Sense, 20 nights; see `CLAUDE.md` §🎙️) that is absent on
CI and on the author's machine. They are parked here so the emerging-tier claims can be settled honestly
rather than upgraded on a synthetic.

## 1 · Re-tier the `emerging` metrics to `validated` (corpus-gated)

Phases 3–4 shipped the finger-waveform HRV re-source and the finger-PPI CVHR at **`emerging`**, per the
parent brief's rule ("`validated` **only** if they reproduce the audited PulseDex HRV path — otherwise
`emerging`"). To earn `validated`:

- **HRV (§Phase 3).** Show the finger-PPI whole-record RMSSD / `sdnnRobust` reproduce the audited PulseDex
  RR-interval HRV path on paired nights (finger PpgDex vs the H10 ECG-derived truth). If reproduced within
  the documented optical-vs-ECG offset, flip `Integrator.fuseHrvResource`'s `tier` to `validated`; else it
  stays `emerging`. Do **not** inherit PulseDex's grade on "same algorithm" (`CLAUDE.md` §🎫).
- **CVHR (§Phase 4).** Compare `cvhrFromNN` (finger PPI) against ECGDex `detectCVHR` (cardiac) AND, where
  available, a PSG apnea reference on the same nights. If the events/hour agree within the corroboration
  band across the corpus, flip `fuseCvhrCorroboration`'s `tier` to `validated`; else keep `emerging`.

The tier string is the ONLY change — the compute paths are frozen. Gate the flip on a documented
corpus-run write-up (route to the node's validation doc per `LITERATURE-USE-POLICY`).

## 2 · OxyDex `verifiedUnder` re-stamp (corpus-gated, release-blocking)

Carried from Phase 1: `tools/release.mjs` refuses to cut a release while any corpus-backed fixture is
UNVERIFIED. Run `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs` on the curated corpus to stamp
`verifiedUnder`. Also re-verify the **PpgDex** compute-path move from §Phase 4 (`cvhrFromNN` + the rich
`apnea` block moved `computeHash`; the light golden is byte-identical, confirmed by the equiv leg, so no
regen — but a corpus run should re-stamp `verifiedUnder` to close the claim).

## 3 · Record the empirical pulse agreement on the real corpus (§7 of the parent)

The parent's §7 asks for the *measured* agreement between the ring's 1 Hz pulse and the finger waveform.
On the committed synthetic it lands within ±3 bpm (Δ≈2), consistent with "vendor smoothing costs little",
but that is a synthetic, not a measurement. Run `fusePulseCrossCheck` across the corpus's finger nights
and record the real bias distribution — a legitimate negative result if they agree
(`papers/dead-ends.html` precedent).

## Cross-references
- Parent: `OXYDEX-PULSE-RESOURCING-2026-07-18-BRIEF.md` (DONE 2026-07-20).
- Method reuse: `ecgdex-dsp.js` `detectCVHR` (CVHR), the audited PulseDex HRV path.
- Corpus: `CLAUDE.md` §🎙️ (the 20-night tri-device corpus).
