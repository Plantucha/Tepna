<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# SYNTH-TEXTURE FOLLOW-UPS II — DSP-audit residue

**Status:** DONE — 2026-06-24 · **Created:** 2026-06-24 · **Supersedes:** none · **Parent:** `SYNTH-TEXTURE-FOLLOWUPS-2026-06-24-BRIEF.md` (DONE 2026-06-24) · **Follow-up:** `SYNTH-TEXTURE-FOLLOWUPS-III-2026-06-24-BRIEF.md` (entropy head-slice representativeness — residue)

> **Execution note (2026-06-24):** Both items resolved **verify-not-fix** — NO `*-dsp.js` change, so no fixture
> regen, no re-bundle, no GATE A churn. **Item 1:** `oxydex-dsp.js computeHREntropy` is NOT the unbounded
> full-night O(N²) the brief feared — it already head-slices `USE = Math.min(n, 1000)` / `clean.slice(0, USE)`
> BEFORE the O(N²) `countMatches`, so cost is O(1000²)≈10⁶ regardless of night length (companion
> `computeSpO2Entropy` is likewise capped at 800). Bounded as-shipped → no decimation cap added (adding one
> would only move the metric + force a fixture regen for zero perf gain). **Item 2:** ECG/PPG lombScargle
> global-peak port AUDITED and **declined as fixture-/contract-unsafe-and-redundant**, documented as
> intentional: (a) **PPGDex** `lombScargle` has NO peak/respRate path at all (band-power only; epoch
> `respRate:null`) → the sub-HF-blindness defect is **structurally absent**, nothing to port; (b) **ECGDex**
> tracks its peak in the HF branch BY DESIGN — its whole-record `respRate` is a **median of per-epoch EDR**
> (decoupled from any single-window peak, group-12 contract + committed fixtures) and sub-HF CSR/periodic-
> breathing is caught by a **dedicated apnea-band detector** (`detectCVHR`, ~0.022–0.05 Hz), so CSR never
> "vanishes" the way it can in PulseDex (which has no such channel). 5 new static guards in `tests/dex-tests.js`
> group 9 (f/g) lock both decisions; `Dex-Test-Suite.html` **all-green (812/54)**. Test-file-only change → no
> re-bundle, all fixtures untouched. Residue (entropy head-slice samples only the night's first ~16 min — a
> representativeness question, NOT the perf concern this brief raised) spun out to FOLLOWUPS-III.

> Residue surfaced while executing the DSP audit (parent brief). Nothing here is a regression from
> that pass; these are pre-existing items the audit exposed and deliberately left out of its
> tightly-scoped fixes. None gate anything currently. Detector-side (`*-dsp.js`), independent of the
> generator.

---

## 1 · `oxydex-dsp.js` `computeHREntropy` — the REAL full-night O(N²) — *verify / cap*
The parent brief's Item 2 capped `pulsedex-dsp.js sampEn` (whose sole caller already passes a bounded
`repSeg`, so the cap is inert). The genuinely unbounded SampEn-style cost is **OxyDex's own**
`computeHREntropy` (`oxydex-dsp.js` ~line 1077): it runs an O(N²) match-count (`countMatches`) over
the **motion-free FULL-night HR** array — for an 8 h O2Ring night that's ~20–26 k samples
(minus motion), i.e. ~10⁸–10⁹ ops on the main thread. **Do:** confirm whether motion-filtering +
the SpO₂-signal length already bounds it in practice; if a full clean night can reach it, add the
same deterministic decimation cap pattern used in `pulsedex-dsp.js sampEn` (documented, return-shape
unchanged). Metric-inert only if the cap sits above any real night's motion-free length — otherwise
it moves the SpO₂/HR SampEn values and the OxyDex fixture must be regenerated (re-run, not hand-edit)
+ `FIXTURE-PROVENANCE` re-recorded. Gate: `Dex-Test-Suite.html` green → re-bundle OxyDex → GATE A.

## 2 · `ecgdex-dsp.js` / `ppgdex-dsp.js` lombScargle — same HF-only-peak shape — *verify / port*
The parent brief fixed the **PulseDex** `lombScargle` global-peak tracking (Item 1) but scoped out the
ECG/PPG copies. `ecgdex-dsp.js:lombScargle` and `ppgdex-dsp.js`'s frequency path likely carry the
same "peak tracked only in the HF branch → respRate blind to sub-HF CSR/PB" shape. **Caution:** ECGDex
already has a deliberate respRate-aggregation fix (`tests/dex-tests.js` group 12 — "median, not
HF-peak", whole-record scalar) AND committed fixtures (`tests/fixtures/ecgdex.*`, `oxydex.summary`),
so a change there is **not** display-only — verify whether porting the global-peak fields moves any
asserted value before touching it. **Do:** audit both; port the additive `peakHz`/`peakBand`/
`peakBelowHF` exposure **iff** it can be done without disturbing the existing respRate contract /
fixtures; otherwise document why ECG/PPG stay HF-only (e.g. EDR-derived resp on ECG behaves
differently). Gate per node: test-suite green → re-bundle the touched node(s) → GATE A.

### Done when
- [x] Item 1: `computeHREntropy` **verified already-bounded** (head-slice `Math.min(n,1000)` before the
      O(N²) match-count; SpO₂ entropy capped at 800) — no cap added, no fixture regen, no re-bundle.
      Static guard (group 9·f) locks the cap.
- [x] Item 2: ECG/PPG lombScargle audited; global-peak port **declined & documented as intentional** —
      PPGDex has no peak/respRate path (defect absent); ECGDex is HF-peak-only by design with median-EDR
      respRate + dedicated `detectCVHR` apnea-band sub-HF channel. Static guards (group 9·g) lock it.
- [x] `Dex-Test-Suite.html` all-green (812/54). No node re-bundled (verify-not-fix, test-file-only change),
      so `verify-provenance.html` GATE A is untouched / still clean.
