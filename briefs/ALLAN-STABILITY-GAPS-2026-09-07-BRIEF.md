**Status:** PROPOSED (**core BUILT — this brief is a GAP LIST over existing machinery, not a build; verified 2026-09-11 (Osprey) in the tree, not from the prose.** `capture-host/allan.py` exists and implements the overlapping estimators (`adev`/`mdev`/`tdev`/`hdev`/`gcov`/`mtie`), each returning its own `n` per tau, and `stability(phase, tau0, tdev_tau=None)` already returns the curve, the slope, the noise type and `optimal_tau`. `clock.js` forwards `stability` (4 sites) and `ppgdex-dsp.js` references `tau0` at 18 sites, so §2.1 — the permanent-`null` export it records as ✅ FIXED 2026-09-07 — is confirmed fixed rather than merely claimed. What remains is the brief's OWN named gaps 2.2–2.5 (gap/unequal-spacing segmentation with Sesia–Tavella deferred, provenance ON the `stability()` result, one human-readable line in the night report, and the tests §2.5 names), each a small unit against live code. No one should size any of this as "build the Allan machinery" — §1 exists precisely to stop that, and this header now says so where a reader looks first.) · **Created:** 2026-09-07 · 🔴 **tau_max MEASURED 2026-09-13 (Osprey) — §2.6: the item is MIS-SHAPED, not unexecuted.** `allan.py` stops at T/8 (>=4 INDEPENDENT spans), `clock.js` at ~T/2 (a count of OVERLAPPING terms). On the two longest contiguous segments of 2026-09-12 H10 ECG, every octave tau to **T/3.5** reproduces within 1.5x, so T/8 discards two octaves two disjoint hours agree on — but the cross-segment ratio is **tau-INDEPENDENT** (1.06-1.30, no trend), which measures how the two hours differ in noise LEVEL, not how the estimator degrades, so it cannot license T/2 either. **Do not unify these constants:** the supportable tau_max is a function of the noise type the curve reports, so one constant is the wrong shape. The discriminating experiment needs a tau^0/tau^+1 stream and **none exists in that night** — H10 ECG -0.379+-0.100 and ACC -0.400+-0.096 (classifier REFUSES both), Verity ACC -0.940 / PPG -0.971 (white/flicker-phase); the O2Ring is excluded by construction (§🔒.7, a drawn axis is not a clock). ⚠️ §2.2 gained one stream of Step 1 evidence on the way: that night carries **33 device-counter gaps of 44-74 s** against a 7.69 ms median — `max_gap/median ~ 9600` against the `<= 4` band, agreeing with #2461's independent -2522.8 s `tMsAt` error on the same night. · **Residue:** 2026-09-07-hostaxis-stability-ntau-not-forwarded

# Allan stability — the gaps that remain after eight PRs (and the ones that were never gaps)

## §0 Origin, and the verdict on the prompt that produced this

A 22-phase external prompt ("Integrate Allan-deviation clock stability analysis into the CURRENT Tepna
codebase") was analysed against `main` on 2026-09-07 with `tools/doc-search.mjs` + a line-level audit
of `capture-host/allan.py`, `clock.js`, `nightqc.py`, `pat-gate.js`, both node exports and
`tests/test_allan.py`. **Its premise is inverted.** The branch it names as "existing work to reconcile"
(`claude/allan-deviation`) is #1188's own pre-squash history (merge-base `e2df2965`, 2026-08-12); `main`
is the superset by eight later PRs — #1227 (core moved to the spine `clock.js`), #1255 (MDEV/TDEV/HDEV),
#1329, #1333 (Groslambert covariance), #1382 (lag-1 `noise_id`), #1392 (MTIE), #1429 (`tau0_uniformity`),
#1587 (σ fields in ppm). Merging that branch would revert them and drop `pat-gate.js`'s DRAWN-AXIS guard.
Phase 21 of the prompt ("compare with the branch") is therefore answered: **ancestral; nothing to merge.**

Of the prompt's 22 phases, **17 are already on `main`** (§1). This brief carries only what the audit
found genuinely missing, sized, with the prerequisites the repo's own rulings impose. It is the
[`ALLAN-DEVIATION`](ALLAN-DEVIATION-2026-08-12-BRIEF.md) /
[`HOSTAXIS-STABILITY`](HOSTAXIS-STABILITY-2026-08-13-BRIEF.md) residue in one place; it does **not**
reopen either.

## §1 What exists — read this before sizing anything below

| capability (prompt phase) | where | note |
|---|---|---|
| overlapping ADEV, phase form, τ = m·τ₀ (3–4) | `allan.py:76-112`, `clock.js:293-320 _ckAllanFromPhase` | verbatim-matched across lanes by the three-way parity gate |
| octave τ ladder, terms ≥ 8, span ≥ 4τ, per-point `n` (4) | `allan.py:40-42, 197-210 _octave_taus` | |
| noise classification with SE refusal (5) | `allan.py:613 classify`, `clock.js:380-429 _ckClassifyAllan` | refuses to `noise: None` + `candidates` inside 1.96·SE — **a string sentinel is forbidden by the JS side's own comment (`clock.js:366`)** |
| lag-1 identifier beside the slope (5) | `allan.py:575 noise_id` (Riley & Greenhall 2004) | ships *beside* `classify`, per HOSTAXIS-STABILITY-FOLLOWUPS §3 |
| `optimal_tau` = argmin, documented as such (7) | `allan.py:797`, `clock.js:669 optimalTauSec` | |
| explicit refusal, no NaN/div-zero path (4, 6) | `allan.py:794 {"ok":False,"reason":"too-few-taus"}` | |
| accuracy ≠ stability (10) | `test_allan.py:68` constant offset + constant rate invisible to ADEV | |
| real-data path (11) | `nightqc.py:1167 arrival_quality` → `allan.stability(diffs, _tau0_of(pairs), 300)` per `(device, meas)` → `QC-SUMMARY.json["stability"]`; `tau0_uniformity` beside it (`:1303`) | |
| node lane on the raw host−device residual (11) | `clock.js:630-675 hostAxis.stability`, refuses when `independent` is false | |
| PAT does not consume stability (15) | `pat-gate.js:102-143` reads only `independent` / `timingSource` | the prompt's "evidence only" rule already holds by *absence* |
| PAT cannot alter clock evidence (16) | structurally: `hostAxis` is computed by the DSP before any PAT code runs | **not pinned by a test** — §2.5 |
| the family (MDEV/TDEV/HDEV/MTIE/gcov), O(N log N) sparse tables (17) | `allan.py` | pure Python — the box carries no numpy, **by design** |
| allantools parity 4.8e-14, 395 sidecars / 21 nights / 3 devices (13) | `papers/known-clock-recovery.html` | |
| tests B C D E G, seeded fixtures (14) | `capture-host/tests/test_allan.py` (~110) | F, J and most of A/H are the gaps — §2.5 |

## §2 Units — what is missing and worth building

### 2.1 ✅ FIXED 2026-09-07 — PpgDex exported `hostAxis.stability.tau0` and `.noiseType` as permanent `null`

**EXECUTED (Brief runner).** Source keys corrected to `tau0Sec` / `noise`; the exported NAMES `tau0` and
`noiseType` are kept, so consumers already reading them are unaffected. Verified both ways against the real
export path (`buildNodeExport`, which carries the block only under `opts.rich`): before, `tau0:null` and
`noiseType:null`; after, `tau0` 0.1 s and `noiseType` `white/flicker-phase` on a planted independent pair.
Four fields added alongside — `slopeSE`, `candidates`, `optimalTauSec`, `atLongestPpm` — **each checked to
be published on the spine object first**. ⚠️ **`nTau` was deliberately NOT exported by this unit** — the
classifier computed it (`cls.nTau`) but `hostAxis.stability` did not forward it, so exporting it would have
re-created this very defect one field over. It was logged as residue
`2026-09-07-hostaxis-stability-ntau-not-forwarded` and **the spine forward has since landed**: the field is
now published on `hostAxis.stability` and exported by both host-axis consumers (PpgDex, ECGDex), with a gate
pinning that it is the FIT's n and not `taus` (the fit drops any τ whose `adev` is exactly zero).
Gated by a new Node-lane group that drives the EXPORT (not the spine, where the names were always right —
which is why this survived): 9 assertions, **5 red without the fix**, including the honest-absence invariant
that `noiseType:null` must never coincide with `candidates:null`. 11 bundles clean, verify:docs +
verify:analysis OK, verify-fixtures green with one PpgDex fixture re-stamped.

⚠️ **TWO MECHANICS THAT COST AN HOUR EACH — read them before touching this export again.** (1) The
hostAxis block is inside `if (opts.rich)`, so `buildNodeExport(r, {})` omits it entirely: a probe that
passes `{}` gets `undefined` and that reads exactly like *the fix did not work*. Pass `{rich: true}`.
(2) `node tools/build.mjs --app PpgDex` is NOT enough — `Data Unifier.html` and `OverDex.html` inline
`ppgdex-dsp.js`, so both drift until `--all` runs. `npm run build:check` catches it; reasoning about
which bundles "use" the file does not. Bare `build.mjs` with no args is a usage error, not a full build.

`ppgdex-dsp.js:5217-5218` reads `r.hostAxis.stability.tau0` and `.noiseType`; the spine publishes
`tau0Sec` (`clock.js:645`) and `noise` (`:650`). Both keys are therefore `null` in every PpgDex export
that has a stability block at all. The *other* PpgDex stability site — the detector-disagreement block at
`:5075-5082` — reads `tau0Sec`/`noise` correctly, so this is a one-block slip, not a naming convention.

**Why every gate is green:** `grep -l '"hostAxis"' uploads/*.json` returns four ECGDex files and **no
PpgDex export**. `stability` is `null` whenever `independent` is false, and every committed PpgDex input
is phone-captured, so no committed fixture can *express* a non-null block (memory
`fixtures-falsify-only-what-they-express`). The bug is invisible by construction.

- Fix: source the right spine keys. Keep the exported names `tau0` / `noiseType` (consumers may read
  them) and add, in the same block, what ECGDex's fuller block already carries and the prompt asks for:
  `slopeSE`, `nTau`, `candidates`, `optimalTauSec`, `atLongestPpm`. Additive → MINOR-compatible; the
  null→value change is a PATCH fix.
- This is **compute-path**: `ppgdex-dsp.js` sits in PpgDex's closure, so `computeHash` moves → re-bundle
  PpgDex + every analysis tool that inlines it (`tools/build-analysis.mjs`) + `build-docs` +
  `node tools/verify-fixtures.mjs` on the primary checkout (6 PpgDex fixtures). Changeset: `patch`.
- **Done when:** a Node-lane test drives the PpgDex export path on a synthetic input with an
  *independent* host column (the `hostaxis-stability` group at `dex-tests.js:1328` already builds such a
  pair) and asserts `recording.hostAxis.stability.tau0 > 0` and `noiseType` is a string **or** `null`
  with non-empty `candidates` — never `null` with `candidates: null`. Without that test the fix is as
  invisible as the bug.

### 2.2 Gaps and unequal spacing — MEASURE first, then segment; Sesia–Tavella stays deferred until the ratio says otherwise

`allan.py:53 _clean` drops every non-finite sample and **compacts** the series: a hole in the arrival
record becomes two adjacent samples one τ₀ apart. `test_allan.py:112-118` and `:570-576` pin that as the
*current* behaviour ("a NaN does not misalign the pair"), which is correct for a stray NaN and wrong for
a 48 s BLE dropout — the phase jumps across the hole read as a step at τ₀, and a step is τ^+1 energy
the classifier will name "drift". Nothing on `main` segments; `tau0_uniformity` (#1429) only *reports*
`max_gap` beside the curve, deliberately not correcting (`allan.py:417-422`).

Two distinct defects hide under "non-uniform sampling", and INTERDISCIPLINARY-LITERATURE §13b.4 already
ruled on both: the **unbiased-AVAR estimator (Sesia & Tavella 2008) is ADOPTED for the arrival lane but
must FOLLOW the ratio measurement**, and is REJECTED for the node lane (uniform to ≤ 0.7 %). That
prerequisite is now cheap: #1429 publishes `tau0_uniformity = {ratio, median, max_gap, n}` into every
`QC-SUMMARY.json`, so the measurement is a read over files that already exist on vigil — no re-run.

- **Step 1 — measurement (Kestrel or Heron over ssh; read-only).** Over every `QC-SUMMARY.json` on the
  box, per `(device, meas)` stream: distribution of `ratio` (mean/median interval) and of
  `max_gap / median`. **Bands, stated before the read:**
  - `ratio ≤ 1.05` on ≥ 95 % of streams → spacing is uniform enough; Sesia–Tavella closes as *not
    material* with the number, in this brief's header.
  - `max_gap / median ≤ 4` on ≥ 95 % of streams → holes are not material; §2.2 step 2 closes the same way.
  - Either band fails → step 2 for that defect only.
- **Step 2a — segmentation (holes).** Split the phase series at any interval > k·median (k from the
  measured distribution, pre-stated; default 4), compute overlapping ADEV per contiguous segment, pool
  per τ as the `n`-weighted mean of σ² (the estimator is an average of squared second differences, so
  pooling is exact, not a heuristic), and publish `segments`, `dropped_intervals` and `pooled: true` on
  the result. A τ that no segment can support is *absent*, not extrapolated. This is dependency-free
  and ~40 lines; it is **not** the Sesia–Tavella estimator.
- **Step 2b — Sesia–Tavella (spacing)** only if the `ratio` band fails; the brief cites the DOI at
  `allan.py:420` and it needs a `CITATION-VERIFICATION` entry before any reader-facing surface.
- **Test F** (both steps): white FM with a planted 50·τ₀ hole must classify white FM with `pooled: true`,
  and the same series *compacted* must be shown to misclassify — a test that passes on both is not
  testing the hole. Test H beyond the existing uniform-rescale invariance (`:1197`): a genuinely jittered
  τ₀ series must report its `ratio` and the curve must not move by more than the SE band.
- Changeset: `patch` (QC-SUMMARY gains fields; nothing existing changes meaning).

### 2.3 Provenance on `stability()` — the result does not say what it was computed from

`allan.stability` returns `{ok, taus, tau_min, tau_max, adev_min, optimal_tau, at_longest,
classification, lag1_noise, mtie, phase_noise, mdev_classification, tdev, slope_se, curve}` and **not**
`tau0`, `n`, the span, or which estimator/version produced it; `nightqc` bolts `tau0_uniformity` on
beside it. A curve without its τ₀ and `n` is exactly the "ppm without its span" that Clock Contract §7
forbids, one level up. Add, additively: `tau0`, `n` (samples after `_clean`), `span_s`,
`estimator: "overlapping-adev"`, `min_terms`, `span_multiple`, `version` (a module constant, bumped
when any estimator changes). Series identity (`device`, `meas`) stays at the `nightqc` level where it
already is. Done when `test_allan.py` asserts the keys on a seeded fixture and a QC-SUMMARY produced
from a fixture night carries them. Changeset: `patch`. Lands with §2.5's Python tests as one PR.

### 2.4 One human-readable line — in the night report, not a new consumer

`stability` reaches `QC-SUMMARY.json` / `STATUS["qc"]` and stops: `qc_digest` (`nightqc.py:2433`) never
mentions it, `writers.py` and `monitor.html` do not read it. Owner ruling #2 (2026-09-07) builds a
per-night report as a separate timer unit (Heron) that is the *single* consumer for QC; the stability
line belongs there, not in the one-line webhook digest. Format, per stream:
`clock <dev>/<meas>: <noise|refused(<candidates>)> · σ_y(τ_opt=<τ> s)=<x> ppm · n=<n> · max_gap=<g>×median`.
Done when the line appears in the report file for a night whose QC-SUMMARY carries `stability`; the
ntfy line is untouched. **Owned by the night-report unit — do not build a second reporter.**

### 2.5 Tests the prompt is right about, and one direction nobody pinned

- **J — determinism:** `stability(x, τ₀)` called twice, and on a copy of `x`, is `==`; no test does this.
- **A — degenerate input:** a long all-equal series. Today `slope` drops zero-ADEV points via
  `p.get(key, 0) > 0` (`allan.py:461`), so the honest series falls through to `too-few-taus` — a refusal
  reason that is *wrong* about why. Pre-decided outcome: `ok: True`, every `adev == 0`, `classification.noise
  is None` with `meaning: "no measurable instability"`. Pin that.
- **Reverse-direction independence (prompt Phase 16):** `dex-tests.js:9327-9387` (`pat-align · regression`) pins clock → PAT
  (a bad clock refuses PAT). Nothing pins PAT ↛ clock. Two cheap legs: (i) run the ECGDex/PpgDex compute
  twice with different PAT options and `deepEqual` the two `recording.hostAxis` blocks; (ii) a source
  scan that `pat-gate.js` and `pat-*.js` never assign into `hostAxis`, `stability`, `independent` or
  `timingSource`. Node lane; no changeset.
- **Runtime (Phase 17):** one number, measured on the box: `allan.stability` on the longest real
  arrival series of a night (H10 ECG packets ≈ 2·10⁵/night). Pre-stated band: ≤ 60 s on vigil is fine
  for an end-of-night job; above it, decimate the *phase* series (not the τ ladder) and record the
  bias. Record the number in this brief's header.

### 2.6 Residue (not built here)

- Neither node exports the ADEV **curve** — only scalars (`ppgdex-dsp.js:5215`, `ecgdex-dsp.js:5263`).
  The prompt is right that the curve carries more than `optimal_tau`; an export-shape change on two
  nodes, owed a consumer first. → `briefs/RESIDUE.md` row on pickup.

## §2.6 — tau_max: MEASURED 2026-09-13 (Osprey), and the item is MIS-SHAPED, not unexecuted

**The question.** The two lanes disagree on how far out the curve may be reported, and neither cites the
other:

| lane | rule | effective ceiling |
|---|---|---|
| `capture-host/allan.py:207` | `m <= n / (2 * _MIN_SPAN_MULTIPLE)` — demands >= 4 **independent** spans | **T/8** |
| `clock.js:314-316` | `cnt >= CK_ALLAN_MIN_TERMS` where `cnt` counts **overlapping** terms | **~T/2** |

The hypothesis was that `clock.js` is wrong in a way its own source already names: it warns, of its
slope SE, that *"Overlapping ADEV points are CORRELATED"*, and then uses a correlated count as if it
were independent for the ceiling. **The measurement did not support that hypothesis.**

**A prerequisite had to be handled first, and it is §2.2's own evidence.** The 2026-09-12 H10 ECG night
(2 691 292 rows, 6.45 h) carries **33 device-counter gaps of 44-74 s** against a **7.69 ms** median
interval — `max_gap / median ~ 9600`, where §2.2 Step 1's band is `<= 4`. Nothing on `main` segments, so
a whole-night ADEV would have been computed across 33 fabricated phase steps, each tau^+1 energy the
classifier names "drift". **This is one stream's worth of §2.2 Step 1 and it fails the band by three
orders of magnitude.** It also agrees with #2461 from an independent instrument: ECGDex's `tMsAt` was
pure index arithmetic and did not count the wall-clock those same dropouts consumed, reading
**-2522.8 s** by the end of this very night. Two instruments, one conclusion — the 09-12 gaps are large
enough to invalidate anything computed across them unsegmented.

Measured instead on the two longest **contiguous** segments (3558 s and 3556 s, adjacent disjoint hours),
using `allan.adev` with explicit taus on both sides so that **only the ceiling varies**. Reliability is
reproducibility across disjoint segments; bands fixed before the read at 1.5x / 2.0x.

| tau_s | ADEV_A | ADEV_B | ratio | verdict |
|---|---|---|---|---|
| 8 | 1.355e+02 | 1.235e+02 | 1.10 | RELIABLE — `allan.py`'s ceiling is 445 s |
| 128 | 2.312e+01 | 1.800e+01 | 1.28 | RELIABLE |
| 512 | 5.754e+00 | 4.427e+00 | 1.30 | RELIABLE — past T/8, still reproducible |
| 1024 | 2.696e+00 | 2.291e+00 | 1.18 | RELIABLE — T/3.5, the largest octave the segment supports |

Every octave to **T/3.5** reproduces within 1.5x; `allan.py`'s T/8 discards **two octaves** that two
disjoint hours agree on.

**Why this does NOT become a constant change — both reasons are limits on the experiment, not hedges.**

1. **The ratio is tau-INDEPENDENT** (1.06-1.30, no trend with tau). A disagreement that does not move
   with the parameter being swept is not estimator variance — it is the two hours genuinely differing in
   noise LEVEL, appearing identically at every tau. So this licenses *"agreement does not degrade out to
   T/3.5"* and **cannot** license *"the estimator is sound at T/2"*. The experiment separates neither.
2. **The subject is the favourable case.** Over tau >= 32 s the H10 curve halves as tau doubles
   (slope -1, jitter that averages away). Failing to falsify a ceiling on the noise type where
   falsification is hardest is close to no evidence.

**Verdict: a single constant is the wrong SHAPE.** The supportable `tau_max` is a function of the noise
type the curve itself reports, so unifying to either current value picks a lane rather than measuring
one. Recorded here so the next triage does not re-derive that this item is mis-shaped rather than
unexecuted.

### The discriminating experiment has no subject in this night

The test that WOULD separate the two ceilings needs a stream whose slope is tau^0 (a floor) or tau^+1
(drift), where long-tau estimates are ill-conditioned. Measured over every stream in 2026-09-12 that
carries two clocks, on each one's longest contiguous segment:

| stream | segments | best segment | slope | slope SE | `allan.py` classification |
|---|---|---|---|---|---|
| H10 ECG | 34 | 3558 s | **-0.379** | 0.100 | **refused** — CI straddles a boundary |
| H10 ACC | 34 | 3558 s | **-0.400** | 0.096 | **refused** |
| Verity ACC | 3 | 10 139 s | -0.940 | 0.022 | white/flicker-phase |
| Verity PPG | 3 | 10 140 s | -0.971 | 0.008 | white/flicker-phase |

**No tau^0 or tau^+1 subject exists here** — all four slopes are negative. The H10 pair is nearest a
floor at ~ -0.39 and the classifier still refuses it, which is the honest answer for a slope whose
+-1.96 SE band crosses a category boundary.

⚠️ This also corrects a claim made earlier the same day: the H10 ECG stream is **not** cleanly
"white-phase". It is tau^-1 only over tau >= 32 s; the full curve is non-monotone (128.5, 93.6, 102.0,
135.5, 142.8, 90.0 ms at tau = 1..32) and unclassifiable, which is exactly why `allan.py` returns
`None`. The long-tau half is what makes point 2 above a real limit; the whole curve is not one noise type.

⚠️ **Scope of this negative.** One night, two devices. The O2Ring — the obvious third candidate — is
excluded **by construction**, not by measurement: CLAUDE.md §🔒.7 rules that a drawn axis is not a clock,
so it can never serve as the second clock this test needs. A corpus-wide answer is the §2.2 Step 1
`QC-SUMMARY.json` survey on the box, which is assigned there and not duplicated here. Until that runs,
the honest status is **"not decidable on the streams measured; needs a stream this night does not
contain"** — which is a result, not an open task.

## §3 What the prompt asks for that is NOT done, and the ruling that decides it

| prompt asks | ruling | source |
|---|---|---|
| "prefer NumPy / vectorize" | **no** — `capture-host/requirements.txt` is four runtime packages, none numeric; `allan.py` is dependency-free by design and already O(N log N) | `requirements.txt`, `allan.py` docstring |
| "make `allan.py` a clean reusable module" | already is; a fourth implementation is forbidden | HOSTAXIS-STABILITY §4.3 |
| `noise_class = "insufficient_evidence"` | **no** — `None` + `candidates`, because a truthy sentinel passes every consumer's guard | `clock.js:366`, three-way parity gate |
| handle irregular timestamps natively | after the measurement, arrival lane only | INTERDISCIPLINARY-LITERATURE §13b.4 → §2.2 |
| replace the SE band with the lag-1 identifier | **no** — both ship, side by side | HOSTAXIS-STABILITY-FOLLOWUPS §3 |
| stability as PAT evidence at "a relevant τ" | permitted (evidence in `why`, never a gate) but **unowed** — PAT's two refusals are on independence and drawn axes, the failures that actually occur | ALLAN-DEVIATION §4; `pat-gate.js:102-143` |
| "never subtract fitted drift from PAT" | already true — tier is decided on `driftSource:'raw'`; the ACC-fitted `cpCorr` is display-only. Do not remove it | `pat-gate.js:35, :345` |
| merge / reconcile `claude/allan-deviation` | ancestral — **do not merge** | §0 |
| a pass/fail on stability anywhere | **never** — "a module and a report, NOT a gate" | ALLAN-DEVIATION §4 |

## §4 Sequencing

1. **§2.1 alone, now** — a defect, compute-path, one PR (re-bundle + verify-fixtures on the corpus machine).
2. **§2.2 step 1** — one ssh read over the box's QC-SUMMARY files; result stamped into this header.
   Decides whether steps 2a/2b exist.
3. **§2.3 + §2.5 (Python legs)** — one capture-host PR, `./check.sh`, changeset `patch`.
4. **§2.5 Node legs** — one PR, no changeset.
5. **§2.4** — a line in Heron's night-report unit when it lands (ruling #2).

Done when 1–4 are merged, step 2's bands are answered with numbers in this header, and §2.6 has its
residue row.

## §5 Evidence trail (2026-09-07)

- `ppgdex-dsp.js:5215-5222` vs `clock.js:645,650` — the key mismatch; `:5075-5082` the correct sibling.
- `grep -l '"hostAxis"' uploads/*.json` → ECGDex only, no PpgDex.
- `allan.py:53` `_clean` compaction; `test_allan.py:112-118, :570-576` pin it.
- `nightqc.py:1260, :1292, :1303` — the arrival-lane call sites; `:2433 qc_digest` no stability.
- `capture.py` — `stability` appears only in the optical-calibration comments (`:2822, :3188`), not as a consumer.
- `pat-gate.js:102-143` — the two PAT refusals; no read of `stability`.
- `claude/allan-deviation` merge-base `e2df2965`; `claude/allan-sigma-units-916` superseded by #1587.
