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

> **§1 MEASURED 2026-07-21 → FEASIBILITY: NO (both tiers STAY `emerging` — no flip).** The corpus supplied
> (`uploads/` + `Ecg nightly/`) does **not** contain the O2Ring **finger pleth WAVEFORM** the finger-HRV
> path needs. The O2Ring appears only as a **1 Hz SpO2/Pulse/Motion** stream: the `.dat` binaries are the
> byte-for-byte twin of `O2Ring S 2100_*.csv` — verified header `01 03 00 00 00 00 00 00 04 00` + 3-byte
> records `[SpO2][Pulse][Motion]` (`55 37 00` = SpO2 85 / pulse 55 / motion 0, matching the CSV). No
> `O2Ring/Wellue *_PPG.txt` exists anywhere in the corpus; the only PPG *waveforms* present are the 54
> `Polar_Sense *_PPG.txt` (Verity **wrist**, a different device+site — a tier is never inherited across
> sites, `CLAUDE.md` §🎫). The shipped `site:'finger'` path (`ppgdex-dsp.js:232 parsePPG`→foot-to-foot PPI→
> RMSSD/sdnnRobust/`cvhrFromNN`) throws on anything that isn't a ~125 Hz pleth text, and a 1 Hz integer
> pulse cannot be reconstructed into beat-to-beat NN intervals. So finger RMSSD/sdnnRobust/CVHR are
> **un-runnable on this corpus (n=0 usable finger nights)** — a valid negative result, not underpowered.
> The **ECG truth leg IS present** (50 `Polar_H10_*_ECG.txt`, ~20 nights would pair) — only the finger side
> is missing. **To unblock the flip:** a corpus of paired nights that each include a raw O2Ring **finger**
> `*_PPG.txt` pleth + a simultaneous H10 `*_ECG.txt` — i.e. the gitignored live-BLE tri-device captures
> (`O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md`), not these archived 1 Hz nightlies. (`docs/O2RING-FINGER-
> ROUNDTRIP-2026-07-20.md` already validated finger **HR** ≤ ~1 bpm on such live captures; what §1 asks for —
> **HRV**/CVHR agreement — remains unproven and needs that waveform corpus.)

> **§2 verifiedUnder re-stamp DONE 2026-07-21** (corpus supplied by the owner: `uploads/` 432 files + `Ecg nightly/` 777 nights). Ran `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs` after a **green** real-corpus suite (3657/3657, 0 skips — every committed fixture reproduces byte-identically on the real corpus). Both OxyDex fixtures (`_1056`/`_0439`) were already current; the ONLY stale fixture was `integrator_tch_golden` (`verifiedUnder` 1439511bb712, closure now ea5de4291e90 — moved by the §7.6 Integrator change, which `build.mjs` is forbidden to re-stamp). Re-stamped → **zero fixtures UNVERIFIED → `release.mjs`'s release wall is clear.** §1 (re-tier emerging→validated) + §3 (empirical pulse-agreement write-up) still open — both need a metric-tier decision / measurement write-up, not just a corpus run.

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
