<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-03 (**§3 executed, §8 + §8.6.** Verdict recorded in `docs/PPGDEX-FINGER-HRV-VALIDATION-2026-08-03.md`: **NO metric promoted** — sdnnRobust +10.6 %, RMSSD +37.7 %, jitter 8.16 ms, every §4 bar failed on a measurement rather than a deferral. The finger is NOT noisier than the wrist (0.2 ms apart; §1's prediction refuted), and two published reference figures do not reproduce under the committed apparatus. CVHR remains unrun → follow-up.) · **Created:** 2026-07-21

# O2Ring finger-PPI HRV — ECG validation, and the emerging→validated tier call

> **What this brief is.** The executable validation that `OXYDEX-PULSE-RESOURCING-FOLLOWUPS §1` asks for:
> does the **O2Ring finger** PPI HRV (`site:'finger'` PpgDex — whole-record RMSSD, sdnnRobust, and
> `cvhrFromNN`) reproduce paired **Polar H10 chest-ECG** HRV closely enough to lift
> `Integrator.fuseHrvResource` / `fuseCvhrCorroboration` from `emerging` to `validated`? It records a
> **preliminary n=2 measurement** already taken (§2), then specifies the **rigorous method** — borrowed
> from the Verity deep-dive — to settle it on the overnight tri-device corpus (§4), the **decision
> criteria** (§5), and the **acceptance gates** (§6). Every number below is `[CORPUS]` (measured here),
> `[CODE]` (read from source), `[LIT]` (literature), or `[OPEN]`.
>
> ⚠️ **Scope guard — this is the O2Ring FINGER, not the Verity WRIST.** `PPGDEX-ALGORITHM-DEEP-DIVE` and its
> ranked `ppgdex-dsp.js` change list (#1–12) are the **Verity Sense (upper-arm, 3 green-LED pairs)** and are
> owned by that work-unit. This brief consumes that brief's **methodology** (§2.1 jitter theory, §2.2
> per-epoch alignment, §5 endpoint) but touches **no** `ppgdex-dsp.js` compute path and proposes **no**
> Verity change. A tier is never inherited across sites (`CLAUDE.md` §🎫); the finger must earn it on its
> own numbers.

---

## 0 · Why this is its own brief

`OXYDEX-PULSE-RESOURCING-FOLLOWUPS §1` is corpus-gated and decision-laden (a tier flip), and the archived
nightly corpus could not run it at all — the O2Ring appears there only as a **1 Hz** SpO₂/Pulse `.dat`/CSV,
never a pleth waveform (recorded in that brief's §1 note, 2026-07-21). It only became runnable when the
**live-BLE capture** (`vigil` / `capture.py`, `O2RING-LIVE-PPG-WAVEFORM`) began streaming the O2Ring's raw
finger pleth as a real waveform. So the validation is not a one-line tier edit — it is a measurement
programme with an alignment method, a primary endpoint, a minimum-nights bar, and an explicit
promote/hold rule. Hence a brief.

## 1 · The device (settled) — a single-channel finger reflectance pleth

- **Wire format** `[CORPUS][CODE]`. The live O2Ring PPG file is `Wellue_O2Ring-S_<serial>_<ts>_PPG.txt`,
  header `Phone timestamp;sensor timestamp [ns];channel 0` — **one** optical channel (no ambient, no
  second/third LED). Sensor-ns Δ ≈ **7.95 ms → ~125.7 Hz**, monotonic. `parsePPG` (`ppgdex-dsp.js:232`)
  parses it; `nCh === 1 ⇒ site:'finger'` (`:347`); foot-to-foot PPI → whole-record RMSSD/sdnnRobust +
  `cvhrFromNN` (`:1172`).
- **Consequence — expect it to be NOISIER than the Verity wrist.** The deep-dive's validated *wrist*
  baseline (rMSSD bias **+4.24 %**, SDNN **+2.46 %**, PPI jitter sd **5.92 ms**) is earned partly by a
  **3-LED event-level consensus** (≥2 of 3 within ±50 ms; 1-of-3 dropped, never filled). The finger has
  **no consensus vote** — a single reflectance path — so its foot jitter, and therefore its RMSSD error,
  should be strictly worse. This is a prediction to test, not an excuse.
- **Autogain + coverage.** The O2Ring, like the Verity, applies LED autogain; expect abrupt DC steps and
  missing-beat gaps. The shipped path already surfaces this: `hrvLowConfidence`, per-epoch coverage, Malik
  `correctRR`. Do **not** hand-filter around it — the flags ARE the honest quality signal (`CLAUDE.md`
  §🎙️/§🎫).

## 2 · Preliminary measurement (n=2, waking evening) — recorded, NOT sufficient to decide

Measured 2026-07-21 on the first two **completed** live-capture segments (read-only; the active capture was
untouched), shipped DSPs only (`PPGDSP.parsePPG→analyze` finger leg, cross-checked byte-identical against
`PpgDex.compute({text},{rich})`; `ECGDSP.parseECG→analyze` + `detectCVHR` ECG leg), overlap-window trimmed:

| metric | Pair 1 (~19:51, 34.5 min) | Pair 2 (~20:27, 25.6 min) | read |
|---|---|---|---|
| **RMSSD** finger / ECG / Δ | 77.3 / 26.9 / **+187 %** | 62.9 / 32.9 / **+91 %** | ❌ fails |
| **sdnnRobust** / ECG SDNN / Δ | 61.5 / 58.9 / **+4.4 %** | 71.9 / 72.4 / **−0.7 %** | ✅ within offset |
| whole-record **sdnn** / ECG SDNN | 88.0 / 58.9 (+49 %) | 74.0 / 72.4 (+2 %) | (inflates as documented) |
| **CVHR /h** finger / ECG | 15.7 / 0.0 (FP) | 9.4 / 9.4 (exact) | ⚠️ inconsistent |
| mean HR finger / ECG | 65 / 64.9 | 59 / 59.3 | ✅ ≤ 0.4 bpm |
| coverage / Malik-corrected | 93 % / 23.8 % | 95 % / 24.5 % | high correction |

Both segments raised the shipped **`hrvLowConfidence`** flag. `[CORPUS]`

**Interpretation.** The finger recovers **rate** near-perfectly (Δ ≤ 0.4 bpm) but **over-reads beat-to-beat
variability** — the classic single-channel foot-jitter signature. This is exactly the deep-dive's closed
form (§2.1): `rMSSD²_ppg ≈ rMSSD²_ecg + k·σ²`, so RMSSD is the metric most sensitive to jitter and the first
to break. `sdnnRobust` survives because it is jitter-resistant by construction and lands within the
**~+3.5 %** PPG-vs-ECG offset the code already documents (`ppgdex-dsp.js:2780-2782` `sdnnNote`).

**Why n=2 cannot decide.** (a) Both are **short, waking, evening** segments from **one session** — CVHR is
a *sleep*-domain metric and is meaningless awake; (b) the alignment was a **wall-clock overlap trim**, which
the deep-dive §2.2 shows "fails deceptively" for any beat-matched quantity; (c) whole-record short-term HRV
is precisely what `hrvLowConfidence` says to distrust — the per-5-min `epochs[]` series is the honest unit.

### §2.1 · Night 1 — overnight SLEEP (the first real read), 2026-07-22

Full overnight live capture **2026-07-21 21:00 → 2026-07-22 04:05** (single night, single subject), run to
the brief's §3 method: shipped DSPs (`PPGDSP.parsePPG→analyze` every segment `site:'finger'`/`ledSingleChannel`,
cross-checked `PpgDex.compute`; `ECGDSP.parseECG→analyze` + `detectCVHR`), read-only on **finalized** segments
(> 15 min old; the still-writing tail + the capture process untouched), and — unlike n=2 — the required
**per-epoch alignment** (instantaneous-HR cross-correlation → match-count lag refine → foot-to-R centering →
±75 ms one-to-one matching). **53 five-minute epochs, ~4.4 h** across 8 paired O2Ring-finger `_PPG.txt` × H10
`_ECG.txt` segments. Absolute offset was dominated by a ~1 s BLE-buffer latency (finger lags ECG) + ~53 ms
within-epoch wander; PTT was not cleanly isolable under the buffer latency, but that differences out of
foot-to-foot intervals. `[CORPUS]`

**Headline — two regimes, and the shipped flag caught them.** A restless **sleep-onset** period (21:00–23:45)
then **consolidated sleep** (23:45–04:05). `hrvLowConfidence` fired **TRUE on exactly the 3 restless segments**
(coverage 91–93 %, Malik 28–39 %) and **FALSE on all 5 clean-sleep segments** (coverage 99–100 %, Malik 4–9 %)
— it discriminated correctly. So the honest comparison is on consolidated sleep.

**PRIMARY endpoint — PPI-jitter sd** (finger foot-to-foot vs matched ECG RR; deep-dive table format):

| epoch set | n (h) | PPI-jitter sd med · IQR (ms) | vs Verity wrist 5.92 ms |
|---|---|---|---|
| all sleep epochs | 53 (4.4 h) | 9.13 · 3.18–32.34 | inflated by the flagged onset |
| restless onset (< 23:45, flagged) | 27 (2.3 h) | 29.56 · 12.26–40.47 | correctly flagged |
| **consolidated sleep (≥ 23:45)** | 26 (2.2 h) | **3.18** · 2.80–3.58 | **BEATS 5.92** |
| analyzable (well-aligned) | 25 (2.1 h) | 3.16 · 2.74–3.31 | BEATS 5.92 |

On consolidated sleep the single-channel finger's PPI jitter (**≈3.16 ms**) is **below the Verity wrist AND
below the deep-dive's ≤3.51 ms "1 % RMSSD bias" budget** — which **contradicts §1's prediction** that a single
channel cannot reach the budget. The all-epoch 9.13 is dominated by the 2.3 h restless onset that
`hrvLowConfidence` down-weights. `[CORPUS]`

**Secondary — matched 5-min windows** (the honest unit; whole-record `sdnnRobust` vs whole-file ECG SDNN is
**NOT usable** here — −60 % apparent, because the 5.7 h ECG SDNN carries circadian range the 25-min PPG windows
don't: the "whole-record fails deceptively" case the brief warns of):

| metric | consolidated sleep (≥ 23:45) | restless (flagged) |
|---|---|---|
| **RMSSD bias %** | med **−0.5 %** (IQR −1.3/+5.3) | +454 % |
| **SDNN bias %** | med **−2.4 %** (IQR −6.1/+0.5) | +134 % |
| beat sensitivity @ ±75 / ±150 ms | 0.749 / 0.903 | 0.393 / 0.626 |
| beat PPV @ ±75 ms | 0.82 | 0.45 |

RMSSD −0.5 % / SDNN −2.4 % on clean sleep are inside the documented **~±3.5 %** offset. The ±75 ms beat
sensitivity (0.749) understates true detection — the finger *detects* ~90 % of beats (0.903 @ ±150 ms) but
their absolute timestamps wander ~53 ms (BLE/timestamp jitter), a timing-anchor artifact that does not touch
interval quality (jitter still 3.2 ms); still, at the deep-dive's ±75 ms spec the finger is materially below
the wrist's 1.0000. `[CORPUS]`

**CVHR (sleep domain) — does NOT reproduce.** Finger `cvhrIndex` agrees where ECG is quiet (0.0/h on clean
sleep where ECG ≈ 0), but **misses real ECG CVHR clusters** (ECG ~10/h at 01:38–02:00 and at 02:53 → finger
0.0, false negatives) and **false-positives on motion** (restless 8.9–16.6/h). Mixed both directions. `[CORPUS]`

**Night-1 per-metric read** (recommendations for the owner; nothing enacted):
- **`sdnnRobust` / the jitter-robust HRV family → strong single-night evidence TOWARD `validated`** (matched-window
  SDNN −2.4 %, jitter 3.16 ms). Still `emerging` until the ≥ 10-night bar (§4); this is **night 1 of ≥ 10**.
- **Whole-record short-term RMSSD → stays `emerging`.** Excellent on clean sleep (−0.5 %, jitter in budget) but
  the *un-flagged whole-record* number is dominated by the onset — so the promotable object is the
  **jitter-robust / epoch-gated** family, not raw whole-record RMSSD (as §4 anticipated). Consider surfacing only
  the robust family for the finger.
- **CVHR → stays `emerging`** (misses real clusters + false-positives on motion).

**Caveats.** One night, one subject; ~2.3 h restless onset degraded all-epoch medians (correctly flagged);
alignment dominated by a ~1 s BLE-buffer offset so PTT unisolable and strict ±75 ms sensitivity understates
detection; single optical channel + autogain (no 3-LED consensus). A partial promotion (robust family only) is
the honest trajectory. `/tmp` harness (throwaway) reproduced it; nothing committed to the capture tree.

## 3 · The rigorous method (execute on the overnight corpus)

Adopt the deep-dive's validated apparatus verbatim; only the *device* differs.

1. **Corpus.** Paired nights, each with a raw O2Ring **finger** `*_PPG.txt` (~125 Hz) **and** a simultaneous
   H10 `*_ECG.txt` (~130 Hz), from the live-BLE captures (`/home/michal/tepna-smoketest/captures/<date>/`,
   or wherever `VIGIL-O2RING-AUTOPULL` finalises them). **Minimum ≥ 10 nights** for a median+IQR claim
   (matching the deep-dive's ≥10-night bar). Prefer full sleep-context nights, not evening slices.
   **Never read a file being actively written** (mtime guard; only finalised segments).
2. **Reference.** H10 raw-ECG Pan–Tompkins with sub-sample refinement (the deep-dive validated it at 0.244 ms
   residual jitter / 0.47 ms interval agreement). Derive HR from `_ECG.txt`, **never** `_HR.txt`.
3. **Alignment — per epoch, not global** (deep-dive §2.2, non-negotiable): coarse lag by instantaneous-HR
   cross-correlation (no periodicity at the beat interval ⇒ cannot alias by a whole beat), local refinement,
   ±75 ms one-to-one matching. A single global affine map yields a deceptive ~F1 0.26 and a −1 ms PTT — do
   not use it. Expect ~5–6 ppm clock drift and ~150–170 ms PTT.
4. **Endpoints.**
   - **Primary: PPI-jitter sd** (finger foot-to-foot vs matched ECG RR), **median across ≥10 nights + IQR** —
     reported as the deep-dive's table row so it is directly comparable to the Verity wrist's 5.92 ms.
   - **Secondary:** RMSSD bias %, `sdnnRobust` vs ECG SDNN %, and CVHR events/h agreement — computed on the
     shipped `site:'finger'` export, and on the **per-5-min `epochs[]`** series (the `hrvLowConfidence`
     honest unit), not only whole-record.
5. **Shipped code only.** No reimplemented HRV math. Co-load `PPGDSP`/`ECGDSP` in a `vm` realm mirroring
   `tests/run-tests.mjs`. Leave the shipped artifact/quality gating intact.
6. **Fit the jitter budget** (optional but decisive): fit `rMSSD²_ppg = rMSSD²_ecg + k·σ²` per night; if the
   finger's `k` and `σ` sit where §2.1 predicts, the RMSSD error is *understood* (jitter), which itself
   informs whether whole-record RMSSD can ever be `validated` on this hardware, or only `sdnnRobust`/epochs.

## 4 · The tier decision (criteria — a person still ratifies the flip)

Promote **per metric**, only on the ≥10-night corpus, and only via a documented validation write-up routed
to the node's validation doc (`LITERATURE-USE-POLICY`); the tier string is the ONLY code change and it lives
in `integrator-dsp.js` (`fuseHrvResource` / `fuseCvhrCorroboration` `tier`).

- **`sdnnRobust` → `validated`** IF its median bias vs ECG SDNN sits within the documented PPG-vs-ECG offset
  (~±3.5 %) across ≥10 nights with a bounded IQR. (Preliminary n=2 is +1.85 %/MAE 2.55 % — promising.)
- **Whole-record short-term RMSSD → stays `emerging`** UNLESS the finger PPI-jitter sd drops into the
  deep-dive's design budget (§2.1: ≤ 4.98 ms ⇒ 2 % RMSSD bias). Preliminary evidence says it will not on a
  single channel — so expect RMSSD to stay flagged/down-weighted, and consider surfacing only the
  jitter-robust family for the finger.
- **CVHR → `validated`** IF finger `cvhrFromNN` events/h agree with ECGDex `detectCVHR` within the
  corroboration band on **sleep** nights (n=2 waking is not evidence — one exact match, one false positive).
- **Any metric that fails its bar STAYS `emerging`.** A partial promotion (e.g. `sdnnRobust` only) is a
  legitimate, honest outcome. Do NOT promote on "same algorithm as PulseDex" — measure it.

## 5 · Non-goals / constraints

- **Do not touch the running capture** (`/home/michal/tepna-smoketest/` is `capture.py`'s live tree —
  read-only, finalised segments only, never lock/move/delete).
- **Do not touch `ppgdex-dsp.js`'s compute path or the Verity change-list (#1–12)** — that is
  `PPGDEX-ALGORITHM-DEEP-DIVE`'s work-unit. This brief is measurement + a tier string, nothing else.
- **No fabricated authority** (`LITERATURE-USE-POLICY`): a `validated` tier needs the real corpus write-up,
  not a synthetic and not the wrist's grade.

## 5b · 2026-08-02 — the corpus is sufficient, and the tool that reads it was DEAD

**The blocker was never the data.** `tools/o2ring-finger-validate-batch.mjs` — the sweep this brief and
`PPGDEX-O2RING-FINGER-SITE` §6 both point at — hardcoded `ROOT` to the author's throwaway worktree
(`…/wt-fingerval`). That worktree was removed the day it was made, so the tool had thrown
`ERR_MODULE_NOT_FOUND` on its first import **since the commit that added it**, for everyone including its
author. Its sibling `o2ring-finger-roundtrip.mjs` carried the same defect (`…/wt-fingerrt`).

Nothing caught it: both are operator sweeps over gitignored captures, so no gate runs them — and a tool no
gate runs is a tool nobody notices is dead. `ROOT` is now derived from the file's own location. A second
defect surfaced on first use: the batch tool assumed every argument was a directory, so the obvious
`captures/*` invocation died on `ENOTDIR` against the `status.json` beside the session folders, before one
row printed.

**Repaired, then run over the whole capture corpus:**

| | |
|---|---|
| paired finger + H10-ECG nights | **12** |
| comparison windows | 237 |
| total compared time | **64.4 h** |
| verdict | **222 PASS / 15 FAIL (93.7 %)** |
| ΔHR vs ECG on PASS rows | median **0.40 bpm**, IQR 0.10–0.80, max 3.00 |
| ΔHR vs the ring's own 1 Hz field | median **0.50 bpm**, IQR 0.20–0.90, max 2.60 |

**§6's first Done-when box is about DATA, and the data is there: 12 nights ≥ 10.** The 15 failures are
concentrated in short windows and in two high-HR/motion segments (2026-07-25 and -26 read ΔECG 17–22 bpm),
which is the expected finger-pleth failure mode, not a surprise.

**What this does NOT do, stated plainly.** This is the **three-way HR round-trip** (`PPGDEX-O2RING-FINGER-SITE`
§6's endpoint), **not** §3's per-epoch RMSSD/SDNN alignment, and **not** the PPI-jitter sd that §6 names as
*the primary endpoint*. HR agreement at 0.4 bpm says the beat detector finds the right beats; it says
nothing about whether the *intervals between them* reproduce chest-ECG HRV, which is the entire question
this brief exists to answer. **No box below is ticked and no tier moves on this.** What changed is that the
≥10-night precondition is satisfied and the instrument to process those nights now executes — the two
things that were blocking §3 from being run at all.

## 6 · Done-when

- [x] ≥ 10 paired finger+ECG nights processed with the §3 per-epoch alignment — **DONE 2026-08-03 (§8):
      16 finger nights, and 15 Verity nights through the SAME instrument.** The apparatus is committed as
      `tools/ppi-jitter-vs-ecg.mjs`; §2.2's was never committed, which is why 5.92 ms cannot be re-derived.
- [x] **PPI-jitter sd** reported as median + IQR — **DONE (§8.1): finger 8.16 ms (IQR 6.52–21.46) over 16
      nights.** RMSSD bias reported. `sdnnRobust` vs SDNN is **WITHHELD, not measured** (§8.3) — the two are
      different quantities and this tool cannot adjudicate a ±3.5 % bar with them. CVHR not yet run.
- [x] A per-metric tier verdict recorded in a validation write-up — **DONE 2026-08-03:**
      `docs/PPGDEX-FINGER-HRV-VALIDATION-2026-08-03.md` (routed per `LITERATURE-USE-POLICY` §3, node-specific
      validation → the node's write-up). **Verdict: NO metric promoted.** `sdnnRobust` +10.6 % (bar ±3.5 %),
      whole-record RMSSD +37.7 % (bar ~2 %), jitter 8.16 ms (budget ≤ 4.98 ms) — all FAIL, measured. CVHR
      not run, recorded as open. No flip, so no tier string in `integrator-dsp.js` changes.
- [x] If a tier string moves: … — **N/A, nothing moved.** Every criterion failed, so there is no flip to
      gate. The `computeHash` question this item raises is therefore untested and stays open for whenever a
      tier does move — it is a real question and it should not be inherited as answered.
- [x] Follow-up brief spawned per `CLAUDE.md` §📌 — `PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS-2026-08-03-BRIEF.md`
      (CVHR, the two non-reproducing reference figures, and the jitter-at-source budget).

## 7 · References

- `OXYDEX-PULSE-RESOURCING-FOLLOWUPS-2026-07-20-BRIEF.md` §1 (the ask) · `OXYDEX-PULSE-RESOURCING-2026-07-18`
  (parent, Phases 3–4 DONE).
- `PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md` §2.1 (rMSSD=jitter closed form), §2.2 (per-epoch
  alignment), §2.3 (what to keep), §5 (endpoint/gates). Method-parent; Verity-owned.
- `O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md` (how the finger pleth is captured) ·
  `VIGIL-O2RING-AUTOPULL-2026-07-21-BRIEF.md` (auto-pull/finalise) · `PPGDEX-O2RING-FINGER-SITE-2026-07-18`
  (site detection).
- `docs/O2RING-FINGER-ROUNDTRIP-2026-07-20.md` (prior on-hardware finger **HR** validation ≤ ~1 bpm — HRV was
  never established, which is exactly this brief's gap).
- `CLAUDE.md` §🎙️ (derive HR from raw ECG, not `_HR.txt`), §🎫 (tier is a node fact, never inherited),
  `LITERATURE-USE-POLICY`, memory `tepna-three-stage-build`.


---

## §8 · EXECUTED 2026-08-03 — §3 run, on an apparatus that is now committed

`tools/ppi-jitter-vs-ecg.mjs`, corpus-free `--selftest`, both devices through the **same** instrument.

### 8.1 · The primary endpoint

| | nights | PPI-jitter sd (median) | IQR | beat match rate |
|---|---|---|---|---|
| **O2Ring FINGER** | 16 | **8.16 ms** | 6.52 – 21.46 | 99.3 % (IQR 94.7–100) |
| **Verity WRIST** | 15 | **8.36 ms** | 4.63 – 31.61 | 100 % (IQR 86.7–100) |

**The finger is not noisier than the wrist.** §1 predicted it would be — *"expect it to be NOISIER than
the Verity wrist"*, on the reasoning that a single channel cannot vote. Measured on the same nights with
the same instrument, the two medians differ by **0.2 ms**, and the finger's IQR is *tighter*. That
prediction is refuted, and the single-channel argument does not survive contact with the corpus.

### 8.2 · This tool does NOT reproduce the deep-dive's 5.92 ms — and that is the honest headline

Run against the **Verity**, the leg the 5.92 ms describes, this apparatus reads **8.36 ms**: 41 % higher.
Either the corpora differ (different nights, and this one runs to 2026-08), or the apparatus does, or
5.92 ms was optimistic. **I cannot attribute it**, because §2.2's instrument was never committed — the
brief names the method and no tool, so there is nothing to diff against.

That is exactly why both legs were run here. Had I quoted the finger's 8.16 ms against a 5.92 ms produced
by a different, unverifiable instrument, the comparison would have read as *"the finger is 38 % worse than
the wrist"* — when measured like-for-like it is **0.2 ms better**. The cross-instrument comparison would
have inverted the conclusion.

### 8.3 · One endpoint WITHHELD — **and §8.6 corrects this: it was measurable all along**

§6 asks for `sdnnRobust` vs ECG SDNN against a **±3.5 %** bar. This tool reports it as withheld:

- `sdnnRobust` is a quality-gated **median of per-5-min SDNN**;
- ECGDex publishes only **whole-record `sdnn`**, which includes the between-epoch (SDANN) variance the
  per-5-min median excludes;
- the raw pairing reads **−29 % on the finger and −29 % on the wrist** — a constant offset of
  construction, not a property of either device;
- PpgDex's own export note puts `sdnnRobust` at ~+3.5 % vs *"ECG truth"*, meaning the ECG's per-5-min
  equivalent, which nothing currently computes.

Constructing that reference here would be reimplemented HRV math (§5 forbids it) and approximate exactly
where the bar is ±3.5 %. **The blocker is that ECGDex does not publish a comparable statistic** — that,
not more nights, is what §4's `sdnnRobust` criterion needs.

> **WRONG — corrected in §8.6.** ECGDex *does* publish it, as `dispSd`. The reasoning above was right
> about the symptom (a constant −29 % on both devices is an offset of construction) and wrong about the
> cause: the field existed and I read the neighbouring one.

### 8.4 · RMSSD, and why no tier moves

RMSSD bias vs ECG: finger **+37.7 %** (IQR 29.7–59.7), Verity **+15.3 %**. Both far outside §4's budget
(σ ≤ 4.98 ms ⇒ 2 %), and both far above the deep-dive's +4.24 %. §4's expectation that **whole-record
RMSSD stays `emerging`** is supported on both devices.

**No tier is flipped and none is recommended yet.** §4 reserves ratification for a person, `sdnnRobust`'s
criterion is unmeasurable as specified (§8.3), and the primary endpoint cannot yet be reconciled with the
reference it is supposed to be compared against (§8.2).

### 8.5 · Two apparatus defects, found by running it

Recorded because both produced plausible numbers before they were caught:

1. **No local lag refinement (§3.3).** The HR envelope bins at 1000 ms while the matching tolerance is
   ±75 ms — the alignment was **13× coarser than the thing it feeds**. Every reported lag was exactly
   1000 or 2000 ms, physically impossible for a 150–250 ms transit, and match rates split by whether the
   true lag happened to sit near a bin edge (95–99 % when it did, 47–55 % when it did not). The first
   finger median came out at **26 ms**; after refinement the same nights read **8.16 ms**. The 26 ms
   described the binning, not the finger. A selftest leg now asserts the **coarse stage is insufficient**
   (`|coarse − true| ≥ 75 ms`), so a version that drops refinement fails rather than reporting quietly.
2. **The reference was unrefined.** `ECGDSP.analyze().peaks` returns INTEGER sample indices; at 130 Hz
   that is 2.22 ms per peak and **3.14 ms per interval**, landing in the reference leg of every
   comparison. §3.2 requires sub-sample refinement and the shipped detector does not provide it. Now
   refined by parabolic vertex on `ECGDSP.bandpass` — shipped code, not a reimplementation. Measured
   effect at the finger's jitter: **0.08 ms** (quadrature makes 3.14 invisible against 26); at the
   Verity's ~6 ms it would be ~13 %. The tool reports the figure per run, because "negligible" is a claim
   about one device's noise floor, not a property of the method.


---

## §8.6 · CORRECTION 2026-08-03 — §8.3 was wrong; the endpoint is measured, and it FAILS the bar

§8.3 concluded that ECGDex publishes no per-5-min SDNN and withheld the endpoint. **It publishes it as
`dispSd`** — `median(epochs[].sdnn)`, verified equal to the reported decimal — and that is what the
export already emits as `hrv.time.sdnn` for a long record. I read `eres.sdnn`, the whole-record field,
which carries the between-epoch (SDANN) variance a per-5-min median excludes.

The −29 %-on-both-devices tell was read correctly and reasoned from incorrectly: it does prove an offset
of construction, but the cause was the field I chose, not a gap in ECGDex.

| pairing | one night | across devices |
|---|---|---|
| `sdnnRobust` vs whole-record `sdnn` | −35.0 % | ≈ −29 % on BOTH ← the artifact |
| `sdnnRobust` vs `dispSd` | **+13.7 %** | the like-for-like pair |

**Measured on the corpus, with the corrected pairing:**

| | `sdnnRobust` vs ECG `dispSd` | IQR | §4 bar |
|---|---|---|---|
| O2Ring **finger** | **+10.6 %** | −5.2 – +17.0 | ±3.5 % |
| Verity **wrist** | **+18.7 %** | +3.2 – +28.4 | ±3.5 % |

**§4's `sdnnRobust → validated` criterion FAILS on both devices** — this is now a measurement rather than
a withholding, which is a materially different claim for a validation brief to carry. And once again the
**finger is the better of the two** (+10.6 % vs +18.7 %), consistent with §8.1.

### 8.6.1 · A shipped user-facing claim this does not reproduce

`ppgdex-dsp.js`'s export note states, in `hrv.time.sdnnNote`, that `sdnnRobust` runs

> *"~+3.5 % vs ECG truth — use sdnnRobust for cross-node SDNN comparison"*

Measured here on the **Verity** — the device that number was derived from — it is **+18.7 %**, and the
IQR (+3.2 – +28.4) only just reaches 3.5 % at its lower edge. That string ships to users as an accuracy
claim.

**Stated carefully:** this does not establish that +3.5 % is wrong. It is the same situation as §8.2's
5.92 ms — the original apparatus was never committed, so the discrepancy **cannot be attributed** between
corpus, method, and the original figure. What it does establish is that the claim **does not reproduce
under the only committed instrument that exists**, and therefore owes a re-derivation before it keeps
being shipped as guidance. Routed as a finding, not a fix: changing that string is a compute-path edit to
a user-facing accuracy claim, and it belongs to whoever ratifies §4.

### 8.6.2 · The pattern, recorded because it repeated three times in one unit

Every wrong number in this work came from the apparatus, not the data, and each looked plausible:

1. **26 ms** finger jitter — coarse 1 s lag binning against a ±75 ms tolerance (§8.5.1).
2. **3.14 ms** of reference quantization — integer R-peak indices, §3.2's refinement missing (§8.5.2).
3. **−29 %** SDNN bias — the wrong ECG field, read as a missing capability (this section).

Two of the three were caught only because the same instrument was pointed at a **second device**: an
artifact of construction shows up as a constant across devices, where a real device property does not.
Running the reference leg was not diligence, it was the detector.