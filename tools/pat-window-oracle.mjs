/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * pat-window-oracle.mjs — PAT-ROOT-CAUSE-FORENSICS §11/§13: is there signal under the window?
 *
 * PAT-FORENSICS-WINDOW-REGIMES measured that on 37 % of channel-nights the accepted-lag distribution
 * is indistinguishable from UNIFORM over the acceptance window `[PHYS_LO, PHYS_HI] = [200, 650]` —
 * SD matches 450/√12 = 129.9, the median sits on the window midpoint, and a channel broken by two
 * orders of magnitude reports the same SD as a healthy one. That says the reported SD is a constant
 * of the estimator. It does NOT say whether a real, narrow lag exists underneath it.
 *
 * ┌─ THE CIRCULARITY THIS DESIGN EXISTS TO AVOID ────────────────────────────────────────────────┐
 * │ The tempting experiment — find each night's lag mode, put a narrow window round it, report the │
 * │ resulting SD — is RIGGED. Fitting a window to the data's own mode and then measuring spread    │
 * │ inside that window guarantees a smaller number whether or not any signal exists. It would      │
 * │ "recover" a lag from pure noise.                                                              │
 * │                                                                                              │
 * │ So the window is chosen OUT OF SAMPLE: the mode is estimated on the night's FIRST half and     │
 * │ applied, untouched, to the SECOND half. A narrow SD in the second half is then earned rather   │
 * │ than fitted — no beat used to place the window contributes to the statistic scoring it.        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * TWO CONTROLS, both required for the result to mean anything:
 *   · FULL-WINDOW on the SAME second half — the status quo, so the comparison is within-night.
 *   · CIRCULAR-SHIFT NULL — the PPG train rotated by a large offset destroys any true R↔foot
 *     correspondence while preserving every marginal (beat rate, foot density, artefact structure).
 *     If the narrow window "recovers" a tight lag from the shifted train too, it is fitting noise
 *     and the whole design is refuted. THIS IS THE ASSERTION THAT MATTERS.
 *
 *     ⚠️ THE SHIFT NULL RELIES ON BEAT-INTERVAL IRREGULARITY, and the selftest found this the hard
 *     way. Against a PERFECTLY PERIODIC beat train a rotation is not a null at all: with RR = 900 ms
 *     and a 37000 ms shift, 37000 mod 900 = 100, so every foot lands a constant 100 ms from its R and
 *     the "destroyed" correspondence is perfectly intact. The first version of this selftest planted
 *     a metronome and the null beat the real arm. Real HRV supplies the irregularity that makes the
 *     rotation valid — but the assumption is load-bearing, so it is stated rather than assumed, and
 *     the selftest now plants an irregular train on purpose.
 *
 * PRE-STATED BANDS (closed, declared before the first run):
 *   out-of-sample SD <= 20 ms  -> SIGNAL RECOVERED (above the ~11 ms sensor floor this campaign
 *                                 measured, and well under the 60 ms bar)
 *              20 < SD < 60    -> PARTIAL
 *                   SD >= 60   -> NO RECOVERY
 *   AND the null must be beaten: a night counts as recovered only if its real SD is lower than its
 *   own shifted-null SD. A band pass with no null separation is reported as NOT recovered.
 *
 * MODE SEARCH IS DELIBERATELY WIDER THAN THE PHYS WINDOW (0–2000 ms). Searching inside [200, 650]
 * would inherit the very censoring under test — the mode has to be free to land outside it, which is
 * the case PAT-WINDOW-CENSORING records (one night at a median lag of 831 ms, 95.9 % above PHYS_HI).
 *
 * Usage:
 *   node tools/pat-window-oracle.mjs --selftest
 *   node tools/pat-window-oracle.mjs --dir <captures root> [--half-width 100] [--fiducial foot|cfd|half] [--ecg-axis linear|piecewise]
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PHYS_LO = 200;
export const PHYS_HI = 650;
export const MODE_SEARCH_MAX = 2000; // wider than the PHYS window ON PURPOSE — see header
export const BIN_MS = 10;
export const BAND_RECOVERED = 20;
export const BAND_PARTIAL = 60;

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
export function sd(a) {
  if (a.length < 2) return Number.NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}

/* All R→foot lags in [0, MODE_SEARCH_MAX], nearest-forward foot only (no window applied). */
export function rawLags(rTimes, fTimes) {
  const out = [];
  let j = 0;
  for (const r of rTimes) {
    while (j < fTimes.length && fTimes[j] < r) j++;
    if (j < fTimes.length) {
      const lag = fTimes[j] - r;
      if (lag >= 0 && lag <= MODE_SEARCH_MAX) out.push(lag);
    }
  }
  return out;
}

/* Histogram mode over BIN_MS bins, smoothed by a 3-bin box so a single spike cannot win. */
export function lagMode(lags) {
  if (lags.length < 30) return null;
  const nb = Math.ceil(MODE_SEARCH_MAX / BIN_MS);
  const h = new Float64Array(nb);
  for (const l of lags) h[Math.min(nb - 1, Math.floor(l / BIN_MS))]++;
  let best = -1;
  let bestI = -1;
  for (let i = 1; i < nb - 1; i++) {
    const v = h[i - 1] + h[i] + h[i + 1];
    if (v > best) {
      best = v;
      bestI = i;
    }
  }
  return bestI < 0 ? null : (bestI + 0.5) * BIN_MS;
}

export function acceptWithin(lags, lo, hi) {
  return lags.filter((l) => l >= lo && l <= hi);
}

/* Rotate the foot train by `shiftMs`, wrapping within its own span: destroys R<->foot
   correspondence while preserving every marginal. */
export function circShift(fTimes, shiftMs) {
  if (!fTimes.length) return [];
  const t0 = fTimes[0];
  const span = fTimes[fTimes.length - 1] - t0 || 1;
  return fTimes.map((t) => t0 + ((((t - t0 + shiftMs) % span) + span) % span)).sort((a, b) => a - b);
}

export function band(x, nullSd) {
  if (!(x >= 0)) return 'UNDEFINED';
  const beatsNull = Number.isFinite(nullSd) ? x < nullSd : false;
  if (!beatsNull) return 'NO RECOVERY (null not beaten)';
  if (x <= BAND_RECOVERED) return 'SIGNAL RECOVERED';
  if (x < BAND_PARTIAL) return 'PARTIAL';
  return 'NO RECOVERY';
}

/* One channel-night. Refuses — never throws — so a bad night cannot kill a corpus run.
   ⚠️ A refusal is NAMED: `{ refusal: '<reason>' }`, never a bare null. The bare-null era printed one
   fixed message ("too few beats") for five different causes, and the catch-swallowed variant of the
   same defect ate 2026-08-18's 8.6 s mid-file step on H_axis P2's first run (#2047) — a refusal
   eaten by a catch, in the tool whose #2044 verdict layer exists to stop exactly that class. The
   success shape is unchanged; a caller that must skip checks `res.refusal` (truthy object!). */
export function oracleNight(rTimes, fTimes, halfWidth) {
  if (rTimes.length < 200 || fTimes.length < 200) return { refusal: `too few beats (r=${rTimes.length}, f=${fTimes.length}; need 200 each)` };
  /* 🔴 SPLIT ON THE OVERLAP, NOT ON THE ECG'S OWN EXTENT.
     This used to take `mid` from the middle of `rTimes` and score out-of-sample on everything after it.
     Out-of-sample scoring is right; splitting on ONE stream's extent while scoring against the OTHER is
     not — the quantity this tool measures is a cross-device relationship, and that exists only where
     both streams exist.
     Measured 2026-09-01, and it silently zeroed six corpus nights: where the PPG covers only the early
     part of a long ECG record, the entire scored half lands AFTER the PPG ended.
       2026-08-12  split@00:39:56  PPG ends@23:40:24  rB=12967 beats, 0 inside the PPG span
       2026-08-15  split@02:25:35  PPG ends@00:14:40  rB=12513 beats, 0 inside the PPG span
       2026-08-13  split@01:48:08  PPG ends@04:03:26  rB= 7844 beats, 7794 inside  (this one worked)
     Those six reported `UNDEFINED (n=0)`, which reads as a data verdict and was a TOOL REFUSAL. The
     discriminator was the span ratio: ~1.0 keeps the scored half inside, 0.25–0.45 puts it wholly
     outside. */
  const lo = Math.max(rTimes[0], fTimes[0]);
  const hi = Math.min(rTimes[rTimes.length - 1], fTimes[fTimes.length - 1]);
  if (!(hi > lo)) {
    /* SELF-EVIDENCING REFUSAL (FOLLOWUPS §5). "no overlap" used to be the bare phrase, and it was
       read as a capture-session fact when it was in fact this tool pairing the LARGEST fragment of
       each stream instead of the most-overlapping pair. The pairing is fixed above; this line now
       carries the measurement that distinguishes the two, so nobody has to re-derive it: the two
       trains' own extents and the gap between them. A reader can see at a glance whether the streams
       are genuinely disjoint (2026-08-20: R 04:27–05:12 against feet 00:55–04:25, and the only other
       PPG fragment holds 2 feet) or whether a better pair existed. */
    const hhmm = (t) => new Date(t).toISOString().slice(11, 16);
    const gapMin = Math.round((lo - hi) / 60000);
    return {
      refusal: `no overlap between the two trains (R ${hhmm(rTimes[0])}–${hhmm(rTimes[rTimes.length - 1])} vs feet ${hhmm(fTimes[0])}–${hhmm(fTimes[fTimes.length - 1])}; disjoint by ${gapMin} min)`
    };
  }
  const rIn = rTimes.filter((t) => t >= lo && t <= hi);
  if (rIn.length < 200) return { refusal: `too few R beats in the overlap (${rIn.length}; need 200)` };
  const mid = rIn[Math.floor(rIn.length / 2)];
  const rA = rIn.filter((t) => t < mid);
  const rB = rIn.filter((t) => t >= mid);
  if (rA.length < 100 || rB.length < 100) return { refusal: `too few beats per half (A=${rA.length}, B=${rB.length}; need 100 each)` };

  const mode = lagMode(rawLags(rA, fTimes)); // FIRST half only — out of sample
  if (mode == null) return { refusal: 'no mode — fewer than 30 first-half lags in the search range' };

  const lagsB = rawLags(rB, fTimes);
  const narrow = acceptWithin(lagsB, mode - halfWidth, mode + halfWidth);
  const full = acceptWithin(lagsB, PHYS_LO, PHYS_HI);

  /* NULL: same procedure end to end on a rotated foot train — mode re-estimated on its first half
     too, so the null gets exactly the advantages the real arm gets. */
  const shifted = circShift(fTimes, 37000);
  const modeN = lagMode(rawLags(rA, shifted));
  const narrowN = modeN == null ? [] : acceptWithin(rawLags(rB, shifted), modeN - halfWidth, modeN + halfWidth);

  /* SECOND-half mode, diagnostic only (scores nothing): the out-of-sample invariance check a
     consumer can read off the verdict line. The mode itself is w-INVARIANT by construction — it is
     estimated from raw lags before any window is applied — which is exactly why it, and not the
     w-dependent band label, is the quotable location statistic (#2029's consumer hazard: 2026-08-17
     read NO RECOVERY at w=300 while recovering the identical 215 ms). */
  const modeB = lagMode(lagsB);

  return {
    /* THE SPLIT TRAVELS WITH THE RESULT (2026-09-02). #2034 moved this split onto the OVERLAP of the
       two trains, but only inside this function — it was not returned, so every sibling tool kept
       computing the pre-fix `R[floor(R.length/2)]` on the ECG's extent alone and silently diverged
       from the oracle it was reading `mode` from. Returning the split is the repair; a consumer
       recomputing it is the defect, because the next fix here would desynchronise them again. */
    lo,
    mid,
    hi,
    mode,
    modeB,
    nB: rB.length,
    narrowN: narrow.length,
    narrowSd: sd(narrow),
    fullN: full.length,
    fullSd: sd(full),
    nullN: narrowN.length,
    nullSd: sd(narrowN),
    modeInPhys: mode >= PHYS_LO && mode <= PHYS_HI
  };
}

/* ── THE VERDICT LAYER — a recovered mode outside PHYS is REFUSED, not scored ─────────────────────
   PAT-FORENSICS-WINDOW-ORACLE §"The 5 out-of-window modes" recorded the class as a candidate and
   left refuse-vs-flag to the owner-decision layer; decided 2026-09-01 (owner's deputy): REFUSE.
   A 25 ms or 1245 ms "PAT" is not a transit time — chest-ECG→arm transit cannot physically sit
   outside [PHYS_LO, PHYS_HI] — so whatever the narrow window recovered there is an ALIGNMENT
   artifact, and handing it a band verdict is fabricated authority: the same discipline `hostAxis`
   applies when CK_AXIS_MAX_PPM is exceeded. The mode is still QUOTED in the refusal (diagnostic —
   the number a debugger needs), it just cannot be consumed as a PAT verdict. The refusal keys on the
   PHYS band [200, 650], NOT the ratified 200–500 acceptance rail: the rail is the acceptance layer's
   sanity band for signal nights, while this refusal is about physical impossibility — a mode in
   (500, 650] is suspect but arguable, and stays the acceptance layer's call. */
export function oracleVerdict(res) {
  if (!res) return null;
  /* A named refusal propagates AS its name — the whole point. It gets its own tally bucket so a
     corpus report says how many nights refused and why, instead of folding them into a data verdict
     or (worse) into silence. */
  if (res.refusal) return { refused: true, label: `⊘ REFUSED — ${res.refusal}`, tallyKey: 'REFUSED', halves: null };
  const halves = res.modeB == null ? 'halves: B-mode n/a' : Math.abs(res.modeB - res.mode) <= BIN_MS ? 'halves ≡' : `halves ${res.mode.toFixed(0)}→${res.modeB.toFixed(0)} ⚠`;
  if (!res.modeInPhys)
    return {
      refused: true,
      label: `ARTIFACT REFUSAL — mode ${res.mode.toFixed(0)} ms outside PHYS ${PHYS_LO}–${PHYS_HI} (alignment artifact; mode diagnostic only, not a PAT)`,
      tallyKey: 'ARTIFACT REFUSAL',
      halves
    };
  const b = band(res.narrowSd, res.nullSd);
  return { refused: false, label: `${b} · mode ${res.mode.toFixed(0)} ms (w-invariant, ${halves}); band label is w-dependent`, tallyKey: b, halves };
}

function selftest() {
  const fails = [];
  const ok = (c, m) => {
    if (!c) fails.push(m);
  };
  /* A PLANTED TRUE LAG of 300 ms with 8 ms jitter must be recovered. */
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2;
  /* IRREGULAR on purpose — a metronome defeats the circular-shift null (see header). */
  const R = [];
  let t = 0;
  for (let i = 0; i < 1200; i++) {
    t += 900 + rnd() * 260;
    R.push(t);
  }
  const F = R.map((r) => r + 300 + rnd() * 14).sort((a, b) => a - b);
  const res = oracleNight(R, F, 100);
  ok(res !== null, 'planted night yields a result');
  ok(Math.abs(res.mode - 300) <= 15, `mode found near 300, got ${res?.mode}`);
  ok(res.narrowSd < 20, `planted 8 ms jitter must recover under 20 ms, got ${res?.narrowSd?.toFixed(2)}`);
  ok(band(res.narrowSd, res.nullSd) === 'SIGNAL RECOVERED', `planted signal must read RECOVERED, got ${band(res.narrowSd, res.nullSd)}`);

  /* THE CONTROL THAT MATTERS: feet with NO relation to R must NOT be recovered. */
  const Fnoise = R.map((r, i) => r + ((i * 6151) % 1900)).sort((a, b) => a - b);
  const res2 = oracleNight(R, Fnoise, 100);
  ok(res2 !== null, 'noise night yields a result');
  ok(
    band(res2.narrowSd, res2.nullSd) !== 'SIGNAL RECOVERED',
    `pure noise must NOT read RECOVERED, got ${band(res2.narrowSd, res2.nullSd)} (sd ${res2?.narrowSd?.toFixed(1)} vs null ${res2?.nullSd?.toFixed(1)})`
  );

  /* Uniform fill over the full window must reproduce 450/sqrt12, or the comparison arm is broken. */
  const u = [];
  for (let i = 0; i < 20000; i++) u.push(200 + (450 * i) / 20000);
  ok(Math.abs(sd(u) - 450 / Math.sqrt(12)) < 1.0, `uniform fill SD must be ~129.9, got ${sd(u).toFixed(2)}`);

  /* circShift preserves count and ordering. */
  const s = circShift([0, 100, 200, 300], 150);
  ok(s.length === 4 && s.every((x, i) => i === 0 || x >= s[i - 1]), 'circShift keeps count and sort order');

  /* ── ARTIFACT REFUSAL: a TIGHT lag outside PHYS must refuse, not read as a quotable verdict. ──
     The low plant is the load-bearing control, and it is asserted from BOTH sides: the band layer
     WOULD have said SIGNAL RECOVERED (proving the plant is tight enough that only the refusal — not
     an incidental score failure — is what catches it), and the verdict layer refuses it anyway. */
  const Flow = R.map((r) => r + 100 + rnd() * 14).sort((a, b) => a - b); // 100 ms < PHYS_LO
  const resLow = oracleNight(R, Flow, 100);
  ok(resLow !== null, 'low-plant night yields a result');
  ok(
    resLow !== null && band(resLow.narrowSd, resLow.nullSd) === 'SIGNAL RECOVERED',
    `low plant must be tight enough that the BAND layer alone would quote it (plant is seen), got ${resLow && band(resLow.narrowSd, resLow.nullSd)}`
  );
  const vLow = oracleVerdict(resLow);
  ok(vLow !== null && vLow.refused === true && /ARTIFACT REFUSAL/.test(vLow.label), `mode ${resLow?.mode?.toFixed(0)} < PHYS_LO must REFUSE, got ${vLow?.label}`);
  ok(vLow !== null && vLow.label.includes(`${resLow.mode.toFixed(0)} ms`), 'the refusal quotes the mode as diagnostic');
  /* The high plant needs lag < min RR or nearest-forward matching aliases it mod RR (beat trains
     align only mod one heartbeat): lag 1240 against RR 900±260 modes at ~285, not 1240. A slower
     train (RR 1500±300) makes a 700 ms lag — outside PHYS_HI, inside every interval — reachable. */
  const R2 = [];
  let t2 = 0;
  for (let i = 0; i < 900; i++) {
    t2 += 1500 + rnd() * 300;
    R2.push(t2);
  }
  const Fhigh = R2.map((r) => r + 700 + rnd() * 14).sort((a, b) => a - b); // 700 ms > PHYS_HI
  const resHigh = oracleNight(R2, Fhigh, 100);
  const vHigh = oracleVerdict(resHigh);
  ok(vHigh !== null && vHigh.refused === true, `mode ${resHigh?.mode?.toFixed(0)} > PHYS_HI must REFUSE, got ${vHigh?.label}`);
  /* In-band verdicts carry the mode + halves-invariance, and are NOT refused. */
  const vGood = oracleVerdict(res);
  ok(vGood !== null && vGood.refused === false && vGood.label.includes('mode') && vGood.label.includes('halves'), `in-PHYS verdict carries mode + invariance status, got ${vGood?.label}`);
  ok(res.modeB != null && Math.abs(res.modeB - res.mode) <= BIN_MS, `planted night's halves agree within one bin, got ${res.mode}→${res.modeB}`);

  /* ── NAMED REFUSALS: a refusing night must propagate its NAME, not a generic skip. ──
     The planted refusal is disjoint trains (feet 10^8 ms after the last R): structurally
     unscoreable, and the assertion is on the REASON STRING reaching the verdict layer — the
     silent-swallow class (#2047's 08-18) is precisely a real reason dying before the report. */
  const Ffar = R.map((r) => r + 1e8);
  const resFar = oracleNight(R, Ffar, 100);
  ok(
    resFar !== null && /^no overlap between the two trains \(R .* vs feet .*; disjoint by \d+ min\)$/.test(resFar.refusal || ''),
    `disjoint trains refuse BY NAME **with both extents and the gap**, got ${JSON.stringify(resFar)}`
  );
  const vFar = oracleVerdict(resFar);
  ok(
    vFar !== null && vFar.refused === true && vFar.tallyKey === 'REFUSED' && vFar.label.includes('no overlap between the two trains'),
    `the refusal NAME survives to the verdict line, got ${vFar?.label}`
  );
  const resShort = oracleNight(R.slice(0, 50), F.slice(0, 50), 100);
  ok(resShort !== null && /^too few beats \(r=50, f=50/.test(resShort.refusal || ''), `a short night names its counts, got ${JSON.stringify(resShort)}`);
  ok(resShort.mode === undefined && resShort.narrowSd === undefined, 'a refusal carries NO score fields a caller could mistakenly consume');

  /* ── Root-layout refusals (2026-09-02). Anti-vacuity: these four assertions cannot pass against
     the pre-fix tool, which exports no `rootLayoutVerdict` at all — verified by running this exact
     selftest against origin/main's copy before the fix landed. */
  const vFlat = rootLayoutVerdict([], ['Polar_H10_02849638_20260627_235834_ECG.txt']);
  ok(vFlat.ok === false && /ZERO night directories/.test(vFlat.reason) && /_ECG\.txt/.test(vFlat.reason), `a flat root refuses and names what it looked for, got ${JSON.stringify(vFlat)}`);
  const vMixed = rootLayoutVerdict(['2026-07-24'], ['a_ECG.txt', 'b_PPG.txt']);
  ok(vMixed.ok === false && /MIXED layout/.test(vMixed.reason) && /silently drop/.test(vMixed.reason), `a MIXED root refuses rather than scoring the dirs, got ${JSON.stringify(vMixed)}`);
  ok(rootLayoutVerdict(['2026-07-24', '2026-08-17'], []).ok === true, 'a well-formed root passes');
  ok(rootLayoutVerdict([], []).ok === true, 'a genuinely empty root is NOT a layout refusal');

  /* The SPLIT must travel with the result (2026-09-02). Without this, a consumer has no way to score
     the same half the mode was fitted against except by recomputing it — which is the defect that
     survived #2034 in two sibling tools for a week. Asserted on the success object AND on a refusal,
     because the consumers' guard is `orc.refusal` and a refusal carrying score-shaped fields would
     let a caller read a split that was never computed. */
  ok(
    Number.isFinite(res.lo) && Number.isFinite(res.mid) && Number.isFinite(res.hi) && res.lo <= res.mid && res.mid <= res.hi,
    `the overlap split travels with the result, got lo=${res?.lo} mid=${res?.mid} hi=${res?.hi}`
  );
  ok(resShort.lo === undefined && resShort.mid === undefined && resShort.hi === undefined, 'a refusal carries NO split fields — the refusal object stays field-free');

  const TOTAL = 25;
  console.log(fails.length ? `SELFTEST FAIL (${fails.length}/${TOTAL})\n  ${fails.join('\n  ')}` : `SELFTEST PASS (${TOTAL}/${TOTAL})`);
  return fails.length === 0;
}

/* ── Root layout: a root holding RECORDINGS but no night directories must REFUSE ──────────────
   `nights` below filters `readdirSync(DIR)` on /^2026-/, so a root whose recordings sit FLAT
   (`Polar_H10_<serial>_YYYYMMDD_HHMMSS_ECG.txt`) yields an empty night list, an empty TALLY and
   **exit 0** — the tool reporting success about a tree it never examined. Measured 2026-09-02 on
   `uploads/Ecg nightly`: 50 `_ECG.txt` present, `TALLY: {}`, exit 0. This brief's own status header
   already documented the identical shape one directory level up (`uploads/trio` -> `TALLY: {}`), so
   the warning existed as prose and the failure recurred anyway; hence a refusal in the tool.

   ⚠️ The MIXED case (loose recordings BESIDE night dirs) refuses too, and that is the more dangerous
   half: scoring the dirs and dropping the files yields a PLAUSIBLE tally over part of the tree,
   where the flat case at least yields an obviously empty one. Green-and-wrong beats red-and-blind
   only in the wrong direction. `uploads/Ecg nightly` is in fact mixed (3 subdirectories beside its
   flat files), so this is the live case, not a hypothetical.

   NOT decided here: whether a flat root should be ACCEPTED as a corpus. It holds 36 distinct dates,
   so "flat root = one night" would fuse 36 nights' beat trains and manufacture a cross-night overlap
   that never existed — a fabricated timebase, not a lenient reader. Accepting the layout is a
   separate change keyed off the YYYYMMDD token; refusing is a correctness fix and stands alone. */
export function rootLayoutVerdict(nightDirs, looseRecordings) {
  if (looseRecordings.length === 0) return { ok: true };
  const shown = looseRecordings.slice(0, 3).join(', ');
  const more = looseRecordings.length > 3 ? `, +${looseRecordings.length - 3} more` : '';
  if (nightDirs.length === 0)
    return {
      ok: false,
      reason:
        `root holds ${looseRecordings.length} recording file(s) at depth 1 and ZERO night ` +
        `directories — looked for entries matching /^2026-/ containing *_ECG.txt/*_PPG.txt. ` +
        `Found loose: ${shown}${more}. This layout is not scored; it is not an empty corpus.`
    };
  return {
    ok: false,
    reason:
      `MIXED layout — ${nightDirs.length} night director(ies) BESIDE ${looseRecordings.length} ` +
      `recording file(s) at depth 1. Scoring the directories would silently drop the loose files ` +
      `and report a plausible tally over part of the tree. Found loose: ${shown}${more}.`
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);
  const DIR = argv[argv.indexOf('--dir') + 1];
  const HW = Number(argv.includes('--half-width') ? argv[argv.indexOf('--half-width') + 1] : 100);
  /* --fiducial: which PPG train the oracle scores. `foot` (default) is byte-identical to the
     pre-flag tool; `cfd` / `half` are the alternative fiducials `ppgFootTimes` computes on the
     same beats (PPG-FOOT-PLACEMENT §3 / EXTERNAL-METHODS-SURVEY §1). The alternatives are
     index-parallel-with-NaN by contract; the oracle scores a train of event TIMES, so the NaNs
     (edge-unusable beats) are dropped here — order is preserved, no correspondence is consumed. */
  const FID = argv.includes('--fiducial') ? argv[argv.indexOf('--fiducial') + 1] : 'foot';
  /* --ecg-axis: which time axis the ECG train rides (H_axis P2, PPG-FOOT-PLACEMENT-FOLLOWUPS §1
     frozen pre-registration). `linear` (default) is byte-identical to the pre-flag tool; `piecewise`
     asks ecgRpeakTimes for the DSP's host-disciplined tMsAt map. Per the frozen conditions the
     correction is consumed ONLY when the DSP reports it live (`tMsCorrected` — which already
     requires an independent second clock); otherwise the night is ANNOTATED and skipped, never
     scored on a silent zero-correction axis wearing the piecewise label. */
  const AXIS = argv.includes('--ecg-axis') ? argv[argv.indexOf('--ecg-axis') + 1] : 'linear';
  if (!DIR || !existsSync(DIR) || !['foot', 'cfd', 'half'].includes(FID) || !['linear', 'piecewise'].includes(AXIS)) {
    console.error('usage: node tools/pat-window-oracle.mjs --selftest | --dir <captures root> [--half-width 100] [--fiducial foot|cfd|half] [--ecg-axis linear|piecewise]');
    process.exit(2);
  }
  const { getDsps, ecgRpeakTimes, ppgFootTimes } = await import(join(HERE, 'pat-matchrate-strict.mjs'));
  getDsps();
  const entries = readdirSync(DIR);
  const nights = entries.filter((n) => /^2026-/.test(n)).sort();
  /* Refuse a root whose recordings sit outside night directories — see rootLayoutVerdict. */
  const loose = entries.filter((e) => /_(ECG|PPG)\.txt$/i.test(e) && statSync(join(DIR, e)).isFile());
  const layout = rootLayoutVerdict(nights, loose);
  if (!layout.ok) {
    console.error(`\u26d4 REFUSED (${DIR}): ${layout.reason}`);
    process.exit(3);
  }
  console.log(
    `half-width ±${HW} ms · fiducial ${FID} · ecg-axis ${AXIS} · mode search 0–${MODE_SEARCH_MAX} ms · bands: <=${BAND_RECOVERED} RECOVERED, <${BAND_PARTIAL} PARTIAL, else NO RECOVERY; null must be beaten\n`
  );
  console.log('night        mode    n     narrowSD    fullSD     nullSD   verdict');
  const tally = {};
  /* EVERY skip path is NAMED and TALLIED. The bare `continue`s this replaces are the silent-swallow
     class in this tool's own report: a refusal eaten by a catch (2026-08-18's 8.6 s mid-file step
     vanished from H_axis P2's first run, #2047), a missing-file night that never printed at all, and
     one fixed "too few beats" line covering five different oracleNight causes. A corpus line count
     that doesn't reconcile with the directory count is a filter nobody stated. */
  const refuse = (n, reason) => {
    console.log(`${n}  ⊘ REFUSED — ${reason}`);
    tally.REFUSED = (tally.REFUSED || 0) + 1;
  };
  for (const n of nights) {
    const dir = join(DIR, n);
    let files;
    try {
      files = readdirSync(dir);
    } catch (e) {
      refuse(n, `unreadable night dir (${String(e.message).slice(0, 60)})`);
      continue;
    }
    /* ── PAIR THE FRAGMENTS BY TIME, NOT BY SIZE (FOLLOWUPS §5 lead, inverted) ──────────────────
       This used to take the LARGEST `_ECG.txt` and the LARGEST Verity `_PPG.txt` in two INDEPENDENT
       size-sorts. On a fragmented night the two winners are from different hours, so the trains do
       not overlap and `oracleNight` refuses "no overlap between the two trains" — a TOOL artifact
       reported as a data verdict. Measured on the 48-night box tree: 15 nights refused that way, and
       EVERY one has an overlapping pair available (2026-08-28: largest-pair 0.00 h, best-pair
       6.31 h; 08-16: 0.00 vs 6.02 across 237 PPG fragments). #2052 made those refusals visible and I
       then filed them as a capture-session fact; they were this function.

       So: choose the (ECG, PPG) pair with the greatest temporal OVERLAP. Spans come from the first
       and last timestamp in each file — an 8 KB read at each end, never a parse.

       ⚠️ NOT concatenating fragments per stream: a concatenated train spans the inter-fragment gaps
       and a lag computed across a gap is meaningless. Per-pair scoring is the honest shape;
       gap-aware segmentation would be its own unit.
       ⚠️ A night whose best pair is genuinely 0 still refuses by the same name — the fix removes the
       artifact, not the refusal. And it cannot manufacture beats: 2026-08-20's best pair is 0.04 h
       (~140 R at 60 bpm) and is expected to refuse on the ≥200-in-overlap bar instead, which is a
       different and defensible reason. */
    const fragSpan = (p) => {
      try {
        const sz = statSync(p).size;
        if (!sz) return null;
        const fd = openSync(p, 'r');
        const CH = 8192;
        const head = Buffer.alloc(Math.min(CH, sz));
        readSync(fd, head, 0, head.length, 0);
        const tail = Buffer.alloc(Math.min(CH, sz));
        readSync(fd, tail, 0, tail.length, Math.max(0, sz - tail.length));
        closeSync(fd);
        const stamp = (s) => {
          const m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
          return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
        };
        const hs = head
          .toString('latin1')
          .split('\n')
          .filter((l) => /\d{4}-\d{2}-\d{2}/.test(l));
        const ts = tail
          .toString('latin1')
          .split('\n')
          .filter((l) => /\d{4}-\d{2}-\d{2}/.test(l));
        if (!hs.length || !ts.length) return null;
        const a = stamp(hs[0]);
        const b = stamp(ts[ts.length - 1]);
        return a != null && b != null && b >= a ? { path: p, a, b, size: sz } : null;
      } catch {
        return null;
      }
    };
    /* `statSync(p).size`, not `readFileSync(p).length`: the old comparator FULLY READ every candidate
       O(n log n) times just to learn its length — 237 PPG fragments on 2026-08-16, read repeatedly. */
    const cands = (re) =>
      files
        .filter((f) => re.test(f))
        .map((f) => join(dir, f))
        .sort((a, b) => statSync(b).size - statSync(a).size);
    const eC = cands(/_ECG\.txt$/);
    // Verity-first preference preserved exactly: fall back to any _PPG.txt only when no Verity exists.
    const pC = cands(/Verity.*_PPG\.txt$/i).length ? cands(/Verity.*_PPG\.txt$/i) : cands(/_PPG\.txt$/);
    if (!eC.length || !pC.length) {
      refuse(n, `missing ${eC.length ? '' : '_ECG.txt'}${!eC.length && !pC.length ? ' and ' : ''}${pC.length ? '' : '_PPG.txt'}`);
      continue;
    }
    /* Default: the largest of each, i.e. exactly today's choice — so a single-fragment night, and a
       night whose spans cannot be read, are byte-identical to the old behaviour. */
    let eF = eC[0];
    let pF = pC[0];
    if (eC.length > 1 || pC.length > 1) {
      const eS = eC.map(fragSpan).filter(Boolean);
      const pS = pC.map(fragSpan).filter(Boolean);
      let bestOv = 0; // only a POSITIVE overlap displaces the default
      let bestSize = -1;
      for (const e of eS) {
        for (const p of pS) {
          const ov = Math.min(e.b, p.b) - Math.max(e.a, p.a);
          const size = e.size + p.size;
          // strictly greater overlap wins; equal overlap breaks on combined size, so the pick is
          // deterministic across runs and independent of readdir order
          if (ov > bestOv || (ov === bestOv && ov > 0 && size > bestSize)) {
            bestOv = ov;
            bestSize = size;
            eF = e.path;
            pF = p.path;
          }
        }
      }
    }
    let E;
    let P;
    try {
      E = ecgRpeakTimes(readFileSync(eF, 'utf8'), AXIS === 'piecewise' ? { axis: 'piecewise' } : undefined);
      P = ppgFootTimes(readFileSync(pF, 'utf8'));
    } catch (e) {
      /* The catch cannot narrow WHAT the parse/transform layer throws (it is another module's
         surface), so it narrows what it is allowed to DO with it: name the night, quote the message,
         count it. Under --ecg-axis piecewise this is additionally a P2 denominator exclusion (e.g.
         the sortedness assertion on a large mid-file step), which the wording preserves. */
      refuse(n, `${AXIS === 'piecewise' ? 'piecewise-axis exclusion: ' : ''}${String(e.message).slice(0, 70)}`);
      continue;
    }
    if (AXIS === 'piecewise' && !E.tMsCorrected) {
      refuse(n, `piecewise axis refused (tMsCorrected=false, independent=${E.independent}) — excluded from the P2 denominator`);
      continue;
    }
    const train = FID === 'foot' ? P.times : FID === 'cfd' ? P.cfdTimes : P.halfTimes;
    const fTimes = Array.from(train).filter(Number.isFinite);
    const res = oracleNight(Array.from(E.times), fTimes, HW);
    const v = oracleVerdict(res);
    if (v.refused && v.tallyKey === 'REFUSED') {
      refuse(n, res.refusal);
      continue;
    }
    tally[v.tallyKey] = (tally[v.tallyKey] || 0) + 1;
    /* maxStepMs beside every piecewise row (frozen condition c): a mid-file step smears across one
       anchor gap under piecewise and can itself move a half-mode — discovered here, not post-hoc. */
    const axisNote = AXIS === 'piecewise' ? `  [maxStep ${E.maxStepMs == null ? 'n/a' : E.maxStepMs.toFixed(0) + ' ms'}]` : '';
    console.log(
      `${n}  ${res.mode.toFixed(0).padStart(5)}  ${String(res.narrowN).padStart(5)}  ${res.narrowSd.toFixed(1).padStart(8)}  ${res.fullSd.toFixed(1).padStart(8)}  ${res.nullSd.toFixed(1).padStart(8)}   ${v.label}${axisNote}`
    );
  }
  console.log('\nTALLY:', JSON.stringify(tally));
}

if (process.argv[1]?.endsWith('pat-window-oracle.mjs')) await main();
