<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-03 (§1 measured NO 2026-07-21 — the finger-waveform corpus the re-tier needs does not exist, both tiers stay `emerging`; §2 re-stamped 2026-07-21; §3 ANSWERED 2026-08-03 — 614 paired epochs, bias +0.84 bpm, median Δ 0.00 on all six nights) · **Created:** 2026-07-20

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

**◐ ATTEMPTED 2026-08-01 — NOT ANSWERED, and the reason is worth more than a number would have been.**

The data exists: **7 nights** of real O2Ring finger PPG (2026-07-25…31), **117 fragments**, all with real
samples, each with an SpO₂ CSV carrying the 1 Hz vendor `Pulse Rate` on the same date. `tools/pulse-agreement.mjs`
ships with this note.

**What it can honestly report today: ONE validly-compared night, Δ = −3 bpm.** Five were skipped because
the PPG fragment and the vendor file share **zero** overlapping samples — they are *different capture
sessions on the same date*. Per-night pairing is not enough; this needs **session-level** alignment across
the 117 fragments.

**Two wrong answers were produced on the way, and both looked fine:**

1. Comparing the largest PPG fragment against the **whole-night** vendor median gave bias **−0.83 bpm,
   SD 4.58, LoA −9.8…+8.1** — a publishable-looking Bland–Altman from series covering *different spans*.
2. Restricting to a matched window appeared to change nothing, because the window filter used
   `Date.parse` on the O2Ring's `HH:MM:SS DD/MM/YYYY` stamp. That returns **NaN**, matched zero samples,
   and fell silently back to (1). The Clock Contract §2.4 forbids exactly this, and the tool now uses
   `DexClock.parseTimestamp` on both sides.

The tool therefore **skips** a night it cannot window-match and reports the skip count, rather than
estimating. A silent fallback converts *"these files do not overlap"* into a bias — the same shape as
reporting a sentinel-filled file as coverage, which `CPAP-SA2-OXIMETRY-SOURCE` was refuted for the same day.

**What a sound answer needs:** session-level pairing (the `pairCompanions` / `trio-batch` fold already
solves this shape for the trio corpus), then the bias distribution over however many nights survive. Until
then §3 stays open, and **no bias figure from this corpus should be quoted** — including the two above.

### ✅ ANSWERED 2026-08-03 — and the pairing needed no inference at all

**The cause was one line of file selection, not "different capture sessions".** The ring writes ONE
`_SPO2.csv` per `_PPG.txt`, sharing a 14-digit session stamp:

```
Wellue_O2Ring-S_S8AW2100_20260727001113_PPG.txt
Wellue_O2Ring-S_S8AW2100_20260727001113_SPO2.csv
```

Pass 2 took `find … _SPO2.csv | head -1` (an arbitrary session) and the **largest** `_PPG.txt` (usually a
different one), so on almost every night it window-matched two unrelated sessions and correctly found no
overlap. Its diagnosis — *"they are different capture sessions on the same date"* — described the symptom
of its own file selection. **The pairing key was in the filename all along**; no `trio-batch`-style
session inference was required.

**The comparison is now per 5-min EPOCH, not one median per session.** `PPGDSP.analyze` already yields
`epochs[].hr` from its own beat detection, so each epoch is matched against the median vendor pulse over
that epoch's own wall-clock window. That turns a handful of session medians into the paired series a
Bland–Altman actually needs.

#### The result — 614 paired epochs, 6 nights, 43 sessions

| | |
|---|---|
| bias (ppg − vendor) | **+0.84 bpm** |
| SD | 3.34 bpm |
| 95 % LoA | **−5.72 … +7.39 bpm** |
| median Δ | **0.00 bpm** |
| range | −7 … +34 bpm |

**Per-night median Δ is 0.00 on all six nights** (n = 19 · 163 · 134 · 103 · 99 · 96), so the pooled
figure is not an artefact of whichever night contributed most epochs — the check that would have caught
exactly that was run and passed.

This is the **legitimate negative result** §3 allowed for: the vendor's 1 Hz smoothed pulse and an HR
derived from the ring's own raw finger waveform agree to a median of zero, with a bias under 1 bpm. It
corroborates the synthetic's Δ≈2 and the parent §7's "vendor smoothing costs little" — measured this
time. The +34 bpm tail is a handful of epochs, not a central tendency; the median is the honest summary
and the LoA carries the spread.

**The `--min-cov` inclusion rule does not drive it.** An epoch is paired only when its 300 s window
carries enough vendor samples; re-run at 0.25 / 0.50 / 0.75 the answer is bias **0.82 / 0.84 / 0.83**,
SD **3.35 / 3.34 / 3.37** (n 632 / 614 / 601). Reported rather than assumed away, because a threshold
nobody varied is an invented constant.

#### A silent drop found on the way, and it had produced a plausible answer

The first complete run reported **155 epochs across 5 nights, bias 0.80, SD 2.00** — and was wrong,
because the seven LARGEST sessions (the actual overnight recordings, 92–142 MB) were being counted as
`analyse failed`. The child process wrote its ~500 KB JSON with `process.stdout.write` and then called
`process.exit(0)`; stdout to a **pipe** is async, so every payload was truncated at exactly **146176
bytes** — a pipe-buffer boundary — and the parent's `JSON.parse` failed. Nothing errored; the run simply
summarised the short reconnect fragments and printed a tighter, healthier-looking SD.

Two things make this worth recording. **It only reproduces through a pipe** — redirecting the child to a
file writes synchronously and looks fine, which is how the earlier spot-check passed. And **removing the
`exit()` is not the fix**: the vm realm keeps the event loop alive and the child hangs. The fix is a
synchronous `writeSync(1, …)` loop over partial writes, then a deliberate exit.

Accounting for the shipped run: 117 sessions · 2 with no sibling CSV · **0 analyse failures** · 8 with no
usable epoch · 77 epochs dropped for thin vendor coverage · **43 sessions contributing 614 epochs**.

## Cross-references
- Parent: `OXYDEX-PULSE-RESOURCING-2026-07-18-BRIEF.md` (DONE 2026-07-20).
- Method reuse: `ecgdex-dsp.js` `detectCVHR` (CVHR), the audited PulseDex HRV path.
- Corpus: `CLAUDE.md` §🎙️ (the 20-night tri-device corpus).
