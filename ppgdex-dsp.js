/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   PpgDex · DSP  (ppgdex-dsp.js)
   ────────────────────────────────────────────────────────────────────────
   Raw wrist-PPG → systolic feet/peaks → PP intervals (self-PPI) → HRV.
   PpgDex is ECGDex's optical twin: once the waveform becomes a beat-to-beat
   interval series, the downstream HRV is identical. NEW here vs ECGDex:
     · optical beat detection (soft upstroke — Pan-Tompkins does NOT apply)
     · ACC+GYRO motion gate (the signature feature)
     · pulse-wave morphology (see ppgdex-morph.js)
   Exposes window.PPGDSP. parseTimestamp duplicated locally (Clock Contract).
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  // ════════════════════════════════════════════════════════════════════════
  //  CLOCK CONTRACT — floating wall-clock parseTimestamp (mirror of ECGDex)
  // ════════════════════════════════════════════════════════════════════════
  function tzOffset(instantMs) {
    return new Date(instantMs).getTimezoneOffset() * 60000;
  }
  // Clock Contract §2.7 (DEEP-AUDIT-II §12.3) — Date.UTC SILENTLY ROLLS out-of-range components onto a
  // plausible WRONG instant (month 13 → next January, day 45/Feb 30/Apr 31 → next month, 25:99 → +1 day
  // 1 h 39 m). `_ckMk` builds the floating tMs ONLY if every component is in range: the date must
  // round-trip (rejects month>12, day>31, Feb 30, Apr 31…) and the time must be 0–23 : 0–59 : 0–59 .
  // 0–999. The ONE legitimate overflow is ISO-8601 `24:00:00` (end-of-day) → next-day 00:00 (do not add
  // a bare `h>23` guard). Returns a number, or null on any out-of-range component. Mirrors clock.js
  // `_ckMk` (PpgDex is a deliberate node-local Clock variant — do not force onto DexClock).
  function _ckMk(y, mo0, d, h, mi, se, ms) {
    se = se || 0;
    ms = ms || 0;
    const day0 = Date.UTC(y, mo0, d),
      dd = new Date(day0);
    if (dd.getUTCFullYear() !== y || dd.getUTCMonth() !== mo0 || dd.getUTCDate() !== d) return null; // date rolled ⇒ invalid
    if (h === 24 && mi === 0 && se === 0 && ms === 0) return day0 + 86400000; // ISO end-of-day → next 00:00:00
    if (h < 0 || h > 23 || mi < 0 || mi > 59 || se < 0 || se > 59 || ms < 0 || ms > 999) return null;
    return Date.UTC(y, mo0, d, h, mi, se, ms);
  }
  function parseTimestamp(raw, opts) {
    opts = opts || {};
    if (raw == null) return null;
    const s = String(raw)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (!s) return null;
    let m;
    // 1 — numeric epoch
    if (/^\d{10,13}$/.test(s)) {
      let x = parseInt(s, 10);
      if (x < 1e11) x *= 1000;
      if (x < 1e11 || x > 4e12) return null;
      return { tMs: x - tzOffset(x), offsetMin: -tzOffset(x) / 60000 };
    }
    // 2/3 — ISO-8601 (zone authoritative if present, else components verbatim)
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
    if (m) {
      /* §1.3 — TRUNCATE, never round. `Math.round(parseFloat('0.'+frac)*1000)` yields 1000 for any
         fraction >= .9995, and `_ckMk`'s `ms > 999` guard then returns null: a perfectly valid ISO
         stamp became an honest-null. The four sibling parsers (clock.js, glucodex-dsp, cpapdex-dsp,
         ecgdex-dsp) all do `+(m[7]+'00').slice(0,3)`, which cannot overflow. PpgDex is a sanctioned
         node-local variant, so this is a bug INSIDE the variant, not a call to unify it. */
      const ms = m[7] ? +(m[7] + '00').slice(0, 3) : 0;
      const tMs = _ckMk(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, ms);
      if (tMs == null) return null; // §2.7 — out-of-range component → honest null, never a rolled instant
      let offsetMin = null;
      if (m[8]) {
        if (m[8] === 'Z') offsetMin = 0;
        else {
          const z = m[8].replace(':', '');
          offsetMin = (z[0] === '-' ? -1 : 1) * (parseInt(z.slice(1, 3), 10) * 60 + parseInt(z.slice(3, 5), 10));
        }
      }
      return { tMs, offsetMin };
    }
    return null;
  }

  // ── small numeric helpers (duplicated locally, suite convention) ──
  function mean(a) {
    if (!a.length) return NaN;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }
  /* §2.6 — the sample SD of fewer than two observations is UNDEFINED, not zero: the denominator is
     `n - 1 = 0`. Returning `0` claims "no variability" from data that cannot support the claim, and on
     an HRV surface an SDNN of 0 ms reads as a perfectly regular heart — the fabricated-defaults class
     (FABRICATED-DEFAULTS-FLEET-2026-08-16 §7).
     NaN, NOT null, and the choice is load-bearing. This file's own `mean` already returns NaN for an
     empty array, and every caller that can decline already tests with `isNaN` or an `|| fallback`.
     `null` would pass BOTH — `isFinite(null)` and `isNaN(null)` are `false` — so switching to null
     would convert a visible refusal into an invisible one. Match the file's existing honest answer.
     ⚠️ DEFENSIVE, and measured to be so: no current caller can reach it. */
  function std(a) {
    if (a.length < 2) return NaN;
    const m = mean(a);
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - m;
      s += d * d;
    }
    return Math.sqrt(s / (a.length - 1));
  }
  function median(a) {
    if (!a.length) return NaN;
    const b = a.slice().sort((x, y) => x - y);
    const h = b.length >> 1;
    return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2;
  }
  function quantile(a, q) {
    if (!a.length) return NaN;
    const b = a.slice().sort((x, y) => x - y);
    const p = (b.length - 1) * q,
      lo = Math.floor(p),
      hi = Math.ceil(p);
    return lo === hi ? b[lo] : b[lo] + (b[hi] - b[lo]) * (p - lo);
  }
  function r2(v) {
    return Math.round(v * 100) / 100;
  }
  function r1(v) {
    return Math.round(v * 10) / 10;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  BIQUAD filtering (RBJ cookbook) + zero-phase filtfilt
  // ════════════════════════════════════════════════════════════════════════
  function biquad(type, f0, fs, Q) {
    const w0 = (2 * Math.PI * f0) / fs,
      c = Math.cos(w0),
      s = Math.sin(w0),
      alpha = s / (2 * Q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') {
      b0 = (1 - c) / 2;
      b1 = 1 - c;
      b2 = (1 - c) / 2;
      a0 = 1 + alpha;
      a1 = -2 * c;
      a2 = 1 - alpha;
    } else {
      b0 = (1 + c) / 2;
      b1 = -(1 + c);
      b2 = (1 + c) / 2;
      a0 = 1 + alpha;
      a1 = -2 * c;
      a2 = 1 - alpha;
    } // hp
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }
  function applyBiquad(x, c) {
    const y = new Float32Array(x.length);
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const xn = x[i];
      const yn = c.b0 * xn + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1;
      x1 = xn;
      y2 = y1;
      y1 = yn;
      y[i] = yn;
    }
    return y;
  }
  function reverse(x) {
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) y[i] = x[x.length - 1 - i];
    return y;
  }
  /* ODD-REFLECTED PADDING — PPGDEX-ALGORITHM-DEEP-DIVE §4 #1.
     `applyBiquad` starts from zero state (x1=x2=y1=y2=0), so the first samples of a record whose
     baseline sits far from zero are filtered against a step the size of that baseline. filtfilt
     then runs the same filter BACKWARDS, so the transient appears at BOTH ends, and `bandpass`
     repeats the whole thing for the low-pass. Unpadded, that edge energy is what produced a
     spurious terminal beat, a 65x `orient` skew and a 6.18x `std(bp)`.

     ODD reflection — 2*x[0] - x[k] — continues the signal's slope through the boundary instead of
     mirroring it. A MIRROR (x[k]) creates an artificial peak at each end, which is the defect in a
     different costume; odd reflection is what SciPy's filtfilt uses for the same reason.

     `pad` is supplied by the caller because the length that matters is set by the SLOWEST corner
     the filter must settle, which `filtfilt` cannot see from `c` alone. It is clamped to the record
     so a short segment degrades to the old behaviour instead of reading past its own ends. */
  function filtfilt(x, c, pad) {
    const n = x.length;
    const p = Math.max(0, Math.min(pad | 0, n - 1));
    if (p === 0) return reverse(applyBiquad(reverse(applyBiquad(x, c)), c));
    const ext = new Float32Array(n + 2 * p);
    for (let i = 0; i < p; i++) ext[i] = 2 * x[0] - x[p - i];
    ext.set(x, p);
    for (let i = 0; i < p; i++) ext[p + n + i] = 2 * x[n - 1] - x[n - 2 - i];
    const y = reverse(applyBiquad(reverse(applyBiquad(ext, c)), c));
    return y.slice(p, p + n);
  }
  function bandpass(x, fs, lo, hi) {
    if (!x.length) return new Float32Array(0);
    /* PAD = 3 * fs / lo — three periods of the high-pass corner, the slowest component the
       cascade has to settle. The low-pass settles far faster, so the same length covers both.

       ⚠ #1 ALSO PRESCRIBED "subtract record median". It was implemented, MEASURED, and DROPPED:
       padding alone already takes the edge/mid SD ratio from 12.07x to 1.00x on a synthetic raw
       channel (DC 120000, 1.1 Hz pulse, 0.02 Hz wander) — the median adds nothing on top — while it
       DID flip a gated behaviour, `cadenceSamples`'s 120 bpm + notch-1.2 case from ratio 1.040 to
       2.000 (reading the HR half). That is the sub-harmonic defect the gate exists to catch. The
       effect is deterministic and length-independent (identical at 60/120/180/300 s), so it is not
       a resolution artefact. Do not re-add it without re-running that group. */
    const pad = Math.round((3 * fs) / lo);
    let y = filtfilt(x, biquad('hp', lo, fs, 0.707), pad);
    y = filtfilt(y, biquad('lp', hi, fs, 0.707), pad);
    return y;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PARSE  — Polar Sense *_PPG.txt
  //  Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient
  // ════════════════════════════════════════════════════════════════════════
  // PPG channel columns from the header. Ours read `ppg0;ppg1;ppg2;ambient` before 2026-07-18 11:43
  // and `channel 0;channel 1;channel 2;ambient` after — which is what Polar Sensor Logger itself
  // emits. Same lesson as the XYZ streams: resolve by NAME, fall back to the tail, never to a fixed
  // index (the pre-11:43 files carry an extra `timestamp [ms]` column that shifts everything by one).
  //
  //  TWO OPTICAL LAYOUTS (PPGDEX-O2RING-FINGER-SITE §3). Resolution returns `chIdx` — an array of
  //  1 OR 3 optical column indices — and the caller reads `chIdx.length` as the real sensor count:
  //    • 3 columns → Polar Verity Sense / OH1 UPPER-ARM band. The three channels are three
  //      diametrically-opposed pairs of GREEN (~520 nm) LEDs, time-multiplexed onto ONE shared
  //      photodiode — NOT three photodiodes, and NOT three wavelengths. Settled from the manufacturer
  //      record (polar-ble-sdk #52 "The three separate values are LED pairs"; #188 "Opposite leds form
  //      a pair"; #445; #671 "All 3 PPG channels are using green light"; FCC INW4J internal photos show
  //      six LED packages in a hexagon around one central photodiode die). The 4th column is a raw
  //      LEDs-off AMBIENT slot and is NOT pre-subtracted on-chip (PPGDEX-ALGORITHM-DEEP-DIVE §1.3).
  //      Consequence: no wavelength-dependent method (SpO2, ratio-of-ratios, CHROM/POS/PBV,
  //      multi-wavelength ICA) is physically possible on this device, and the three channels are
  //      spatially-diverse views of ONE source, correlated 0.95-1.00 at zero lag.
  //    • 1 column  → Wellue O2Ring finger site (ONE reflectance path; no ambient column, because the
  //      ring AC-couples + gain-normalises on-device, so ambient subtraction is already applied and a
  //      committed 0 would be a fabricated measurement rather than a reading).
  //  A 2-column file resolves to null on purpose: no device we ingest emits one, and silently
  //  treating it as a 2-LED sensor would let a shifted/truncated 3-LED file vote with itself.
  function ppgColsFromHeader(headerLine) {
    const p = String(headerLine || '').split(';');
    const ch = [];
    let amb = -1,
      ns = -1,
      phone = -1;
    for (let i = 0; i < p.length; i++) {
      const h = p[i].trim().toLowerCase();
      if (/^(channel\s*\d|ppg\d)/.test(h)) ch.push(i);
      else if (/ambient/.test(h)) amb = i;
      else if (/sensor\s+timestamp/.test(h)) ns = i;
      else if (/phone\s+timestamp/.test(h)) phone = i;
    }
    if (ch.length >= 3) return { chIdx: [ch[0], ch[1], ch[2]], amb, ns, phone };
    if (ch.length === 1) return { chIdx: [ch[0]], amb, ns, phone };
    return null;
  }
  function ppgColsByTail(p) {
    // Headerless fallback, resolved by TRAILING numeric columns (never a fixed index — the pre-2026-07-18
    // captures carry an extra `timestamp [ms]` column that shifts everything by one).
    //   ≥5 numeric → ...;ch0;ch1;ch2;ambient   (Verity)
    //    3 numeric → phone;ns;ch0              (O2Ring finger — no ambient to trail)
    const nums = [];
    for (let k = 0; k < p.length; k++) if (isFinite(parseFloat(p[k]))) nums.push(k);
    const n = nums.length;
    if (n >= 5) return { chIdx: [nums[n - 4], nums[n - 3], nums[n - 2]], amb: nums[n - 1], ns: 1, phone: 0 };
    if (n === 3) return { chIdx: [nums[n - 1]], amb: -1, ns: 1, phone: 0 };
    return null;
  }

  /* ── O2Ring `156` BEAT MARKER (DEVICE-RATE-TRUTH §2; was "PPG_INVALID sentinel", §2.4 / PR #212) ──
     156 (0x9C) is a row the firmware INSERTS once per detected beat — it is NOT a missing-sample
     sentinel, and the old name asserted the opposite. The distinction is not cosmetic: a sentinel
     means "data was lost here", a marker means "a beat happened here", and the second is a
     MEASUREMENT that was being discarded.

     What does NOT change: the marker row is still excluded from the waveform, because an inserted row
     is not an ADC sample. It is never median-filled or interpolated (the vendor interpolates; we do
     not — PR #212 declined that explicitly). On the device-crystal path it correctly advances no time.

     156 is **IN-BAND** — a legal amplitude — so it cannot be classified on value alone, and an
     isolation test against real neighbours splits the two populations. That test was built from
     amplitude statistics on a 90 s probe (156 occurs 61× where neighbours 152–160 occur 2–10×; split
     57 isolated / 4 trend-consistent). It is now corroborated by a criterion it was never tuned
     against — the regularity of the intervals it yields — on two full nights:

       subset      n        median interval        within 0.5–2× median
       ISOLATED    18 039   1152 ms = 52.1 bpm     97.7 %   ← the beat train
       TREND-OK       147   5296 ms = 11.3 bpm      3.4 %   ← real signal that happens to equal 156

     So the isolated set (99.2 % of all 156s) is a firmware beat fiducial, published below as `beats`.
     Its value is that it is SAME-DEVICE and SAME-STREAM: no inter-device clock offset, no
     cross-channel common mode — precisely the blind spot that let the optical polarity defect hide.
     ⚠️ It records the firmware's DETECTION instant, so it carries an unknown fixed latency: sound for
     intervals (PPI/HRV) and for detector timing VARIABILITY, never for absolute PAT. */
  const O2_BEAT_MARKER = 156;
  const O2_MARKER_ISOLATION = 25; // LSB from the local trend; measured separation, §2.4
  // The O2Ring's crystal ADC sample rate — 32 MHz ÷8 ÷32000 = 125.000 Hz exactly (TI AFE4403, no
  // internal RC). This is the DEVICE-CRYSTAL timebase (O2RING-ADAPTIVE-TIMEBASE §2, DEVICE-RATE-TRUTH
  // §2): the honest sample clock, distinct from the ~125.7 ROW rate the ns column carries (which is
  // 125.000 + one inserted `156` beat marker per beat). Used only on the opt-in device-crystal path.
  const O2_ADC_HZ = 125.0;
  function markO2BeatMarkers(x) {
    const gap = new Uint8Array(x.length);
    const beats = [];
    let rejected = 0,
      kept = 0;
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== O2_BEAT_MARKER) continue;
      // Judge against REAL neighbours only — a marker run must not vote for its own legitimacy.
      let sum = 0,
        cnt = 0;
      for (let k = i - 2; k <= i + 2; k++) {
        if (k === i || k < 0 || k >= x.length) continue;
        if (x[k] === O2_BEAT_MARKER) continue;
        sum += x[k];
        cnt++;
      }
      // No real neighbour to judge against ⇒ a run of the marker value ⇒ inserted, not signal.
      if (!cnt || Math.abs(O2_BEAT_MARKER - sum / cnt) > O2_MARKER_ISOLATION) {
        gap[i] = 1;
        beats.push(i);
        rejected++;
      } else kept++;
    }
    // `rejected`/`kept` keep their names: they are a published contract (trio-batch, ppg-gap-bridge-scan,
    // the crystal-timebase gate). `beats` is additive — the same rows, as positions rather than a count.
    return { gap, rejected, kept, beats };
  }
  // Host-anchor spacing, in accepted rows. 500 ≈ 2.8 s at 176 Hz, giving ~2400 anchors on a 190 min
  // file — the geometry the running-median window was tuned against (clock.js CK_AXIS_WIN).
  const PPG_AXIS_EVERY = 500;
  /* opts.timebase (O2RING-ADAPTIVE-TIMEBASE Stage 2):
       undefined / 'host-disciplined'  the device ns axis disciplined to the capture host (today's path,
                                        and the default — behaviour is byte-identical when unset).
       'device-crystal'                 O2Ring finger ONLY: real ADC samples on the 125.000 crystal grid,
                                        the inserted `156` beat markers NOT counted as samples, contiguous
                                        SEGMENTS re-anchored to the host so genuine losses are preserved.
     The choice is Stage 3's to make per stamped clock provenance; Stage 2 only builds + tests the path,
     so no production caller passes it yet and the default is unchanged. */
  function parsePPG(text, opts) {
    opts = opts || {};
    const lines = text.split(/\r?\n/);
    /* EMBEDDED TIMEBASE (O2RING-ADAPTIVE-TIMEBASE Stage 3b). The capture host stamps its per-capture
       timebase decision into the O2Ring PPG file as a `# timebase=…` header comment (host_clock
       .timebase_decision → device-crystal | host-disciplined), so the choice travels WITH the data and
       PpgDex needs no sidecar. A `#` line fails the row filter below, so it is invisible to parsing; this
       pre-scan is the only reader. Comments precede the `timestamp` header, so stop once that is seen. */
    let embeddedTimebase = null;
    for (let li = 0; li < lines.length && li < 12; li++) {
      const s = lines[li].trim();
      if (!s) continue;
      const m = /^#\s*timebase\s*=\s*(device-crystal|host-disciplined)\b/i.exec(s);
      if (m) {
        embeddedTimebase = m[1].toLowerCase();
        break;
      }
      if (/timestamp/i.test(s)) break;
    }
    const ch0 = [],
      ch1 = [],
      ch2 = [],
      amb = [];
    const nsArr = []; // BigInt deltas avoided — store as Number of (ns - ns0)/1 via BigInt math
    const axisAnchors = []; // { devMs, hostMs } — host-disciplined axis, see PPG_AXIS_EVERY
    let ns0 = null,
      t0Ms = null,
      firstTs = null; // lastTs is resolved lazily in the fs fallback (§P1)
    let pcols = null;
    // Minimum data-row field count. 6 for the Verity layout; a single-optical-column file
    // (`phone;ns;ch0`) has only 3, so the floor drops once a 1-channel header resolves. Until
    // the layout is known the Verity floor applies, which keeps every existing file's row
    // filter byte-identical.
    let minFields = 6;
    let nCh = 3,
      ch0Col = 2;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li].trim();
      if (!line) continue;
      const p = line.split(';');
      if (/timestamp/i.test(line) && !pcols) {
        const hc = ppgColsFromHeader(line);
        if (hc) {
          pcols = hc;
          if (hc.chIdx.length === 1) minFields = 3;
          continue;
        }
      }
      if (p.length < minFields) continue;
      const pc = pcols || ppgColsByTail(p);
      if (!pc) continue;
      // The layout the ACCEPTED rows actually carry (a headerless file resolves per-row via the tail).
      nCh = pc.chIdx.length;
      ch0Col = pc.chIdx[0];
      if (nCh === 1) minFields = 3;
      const v0 = parseFloat(p[pc.chIdx[0]]);
      if (!isFinite(v0)) {
        continue;
      } // header / junk
      // ROW-ATOMIC COLUMN VALIDATION (PPGDEX-ALGORITHM-DEEP-DIVE §4 #4). Only ch0 was validated; ch1,
      // ch2 and ambient were pushed unchecked, so a row carrying a good ch0 beside a junk companion
      // column admitted NaN straight into the typed arrays. That failure is SILENT and DEGRADING, not
      // loud: filtfilt propagates NaN across the whole channel, the detector then finds zero peaks on
      // it, and the 3-LED vote silently becomes a 2-LED vote reporting a structurally impossible
      // `ledAgreementPct: 67` at `measured` tier with no warning anywhere — the same class of
      // fabricated-quality claim the §4 degenerate-channel guard exists to prevent. Validate every
      // column THIS layout claims to carry, and drop the whole row if any of them is unreadable;
      // never admit a partial row, because the channel arrays are positional and must stay in step.
      let v1 = 0,
        v2 = 0;
      if (pc.chIdx.length === 3) {
        v1 = parseFloat(p[pc.chIdx[1]]);
        v2 = parseFloat(p[pc.chIdx[2]]);
        if (!isFinite(v1) || !isFinite(v2)) continue;
      }
      // Ambient is DELIBERATELY NaN when the layout carries no ambient column (the O2Ring finger site,
      // which AC-couples on-device). Only a column that EXISTS and fails to parse makes the row bad —
      // committing a 0 there would be a fabricated measurement, per the layout note above.
      const va = pc.amb >= 0 ? parseFloat(p[pc.amb]) : NaN;
      if (pc.amb >= 0 && !isFinite(va)) continue;
      ch0.push(v0);
      if (pc.chIdx.length === 3) {
        ch1.push(v1);
        ch2.push(v2);
      }
      amb.push(va);
      // sensor ns → relative seconds (BigInt: values exceed Number safe range)
      let relNs = 0;
      try {
        const b = BigInt(p[pcols && pcols.ns >= 0 ? pcols.ns : 1].trim());
        if (ns0 === null) ns0 = b;
        relNs = Number(b - ns0);
      } catch (e) {
        relNs = NaN;
      }
      nsArr.push(relNs);
      // Clock Contract: the FIRST stamp is load-bearing (t0Ms + offsetMin). The LAST stamp is
      // read ONLY by the degenerate `deltas.length<=20` fs fallback below, which a real capture (190k
      // valid ns deltas) never takes — so resolve it lazily there instead of parsing every one of ~190k
      // rows for a value that is then discarded. parseTimestamp was ~half of parsePPG's entire cost.
      // (EFFICIENCY-AUDIT-FINDINGS-2026-07-12 §P1.)
      if (t0Ms === null) {
        const ts = parseTimestamp(p[0]);
        if (ts) {
          t0Ms = ts.tMs;
          firstTs = ts;
        }
      }
      // HOST-DISCIPLINED AXIS (WEARABLE-HOST-AXIS-2026-08-02 §2) — sample the host clock as we go.
      // §P1 above removed the per-row parseTimestamp because it was ~half of parsePPG; this restores
      // it on 1 row in PPG_AXIS_EVERY (0.2 %), so that finding stands. Without these anchors the
      // exported axis is the DEVICE crystal alone: −0.34 s/night on a Verity and −18.49 s on an
      // O2Ring, whose error is non-linear and therefore not removable by any single rate.
      if (t0Ms !== null && (nsArr.length === 1 || nsArr.length % PPG_AXIS_EVERY === 0)) {
        const at = parseTimestamp(p[0]);
        if (at && isFinite(relNs)) axisAnchors.push({ devMs: relNs / 1e6, hostMs: at.tMs - t0Ms });
      }
    }
    const n = ch0.length;
    if (n < 10)
      throw new Error(
        'No PPG samples parsed — expected Polar Sense `*_PPG.txt` (Phone timestamp;sensor ns;ch0;ch1;ch2;ambient) or an O2Ring finger `*_PPG.txt` (Phone timestamp;sensor ns;channel 0).'
      );
    // fs from median ns delta (precise) — fall back to phone-clock span
    let fs = 176;
    const deltas = [];
    for (let i = 1; i < n; i++) {
      const d = nsArr[i] - nsArr[i - 1];
      if (isFinite(d) && d > 0) deltas.push(d);
    }
    /* ── IS THIS AXIS DRAWN OR MEASURED? (WEARABLE-HOST-AXIS-FOLLOWUPS §F1) ──────────────────────
       An O2Ring session up to 2026-07-27 does not report a clock: its `sensor timestamp [ns]` is
       `sample_index × 7,953,045 ns` — a CONSTANT increment standing in for an assumed 125.738 Hz. Such
       an axis has no timing information in it at all, so its apparent drift is the error in that
       assumption rather than anything about the device, and it must not be spent as a clock (a
       three-cornered hat fed a drawn leg is measuring a constant, not a third source).

       ⛔ THE PROPOSED TEST `first sensor timestamp == 0` DOES NOT WORK — measured, not assumed. Every
       O2Ring fragment starts at 0, including the post-2026-07-28 ones carrying 1574–1861 distinct
       deltas. It separates O2Ring from Polar (relative vs absolute epoch), NOT drawn from measured, so
       it would condemn the good nights too.

       What DOES separate them is how much of the delta distribution sits on ONE value:
         drawn (16 files, ≤07-27) …… 100.0 %      measured (07-28 →) …… 0.6 – 8.8 %
       Reported as a NUMBER, with `drawn` asserted only at ≥99 %. The middle of that range is genuinely
       ambiguous on short fragments (a 15-min file has few deltas to be diverse with), and a binary that
       pretends otherwise would be the same over-claim this whole brief family exists to remove. */
    let quantizedShare = null;
    /* Scan BACKWARD for the last row the main loop would have ACCEPTED and whose stamp parses —
       byte-identical to an eager `lastTs`, but paid for only where it is read. The row filter must
       mirror the main loop's exactly (>= minFields fields, finite ch0); both `minFields` and `ch0Col`
       are the values the main loop RESOLVED, so a single-column finger file is filtered on its own
       layout rather than the Verity's. §P1 removed the per-row parseTimestamp because it was ~half of
       parsePPG's cost; this keeps that win — one backward scan, ≤40 rows on a real file. */
    let _lastTsMemo;
    const _ppgLastTs = () => {
      if (_lastTsMemo !== undefined) return _lastTsMemo;
      let t = null;
      for (let li = lines.length - 1; li >= 0 && !t; li--) {
        const line = lines[li].trim();
        if (!line) continue;
        const p = line.split(';');
        if (p.length < minFields) continue;
        if (!isFinite(parseFloat(p[ch0Col]))) continue;
        t = parseTimestamp(p[0]);
      }
      _lastTsMemo = t;
      return t;
    };
    if (deltas.length > 20) {
      const md = median(deltas);
      if (md > 0) fs = 1e9 / md;
      if (md > 0) {
        let same = 0;
        for (let i = 0; i < deltas.length; i++) if (deltas[i] === md) same++;
        quantizedShare = same / deltas.length;
      }
    } else {
      /* Lazy `lastTs` (§P1): the backward scan is paid for only where it is needed — this degenerate fs
         fallback, and `endEpochMs` below. See `_ppgLastTs`. */
      const lastTs = _ppgLastTs();
      if (firstTs && lastTs && lastTs.tMs > firstTs.tMs) {
        fs = (n - 1) / ((lastTs.tMs - firstTs.tMs) / 1000);
      }
    }
    // `fs` is derived from the DEVICE's ns deltas, so it is samples per DEVICE second. Once relSec is
    // host-disciplined, it must become samples per HOST second or `1/fs` no longer matches the spacing
    // of the very axis it indexes. ≤0.03 % on a Polar, 0.16 % on the O2Ring — small, but a self-
    // inconsistent rec is the kind of thing that is only ever found much later, in something else.
    const hostAx = typeof DexClock !== 'undefined' && DexClock.hostAxis ? DexClock.hostAxis(axisAnchors, {}) : { ok: false };
    if (hostAx.ok && isFinite(hostAx.ppm)) fs = fs / (1 + hostAx.ppm / 1e6);
    fs = Math.round(fs * 100) / 100;
    /* `timingSource` is the field a consumer should actually branch on, and the reason this is computed
       rather than assumed. DRAWN + host anchors ⇒ every bit of real timing came from the host, and the
       device contributed only sample ORDER. DRAWN + no anchors ⇒ `'none'`: the recording carries no
       timing information whatsoever and must never be spent as a clock leg — closure, three-cornered hat
       and PAT all silently accept such a leg today and measure a constant. */
    const axisDrawn = quantizedShare != null && quantizedShare >= 0.99;
    // relSec per sample from ns, DISCIPLINED to the host clock (WEARABLE-HOST-AXIS §2); else index/fs.
    // The device crystal keeps the fine structure (the correction's own slope is ~30 ppm, i.e. 30 µs
    // per second, so RR/PPI intervals are untouched) while its RATE error is removed. If too few
    // anchors resolved, `ok:false` and the raw device axis is kept — an uncorrected axis is honest,
    // a fabricated correction is not.
    let relSec = new Float64Array(n);
    if (deltas.length > 20) {
      for (let i = 0; i < n; i++) {
        if (!isFinite(nsArr[i])) {
          relSec[i] = i / fs;
          continue;
        }
        const devMs = nsArr[i] / 1e6;
        relSec[i] = (devMs + (hostAx.ok ? hostAx.correctionAt(devMs) : 0)) / 1000;
      }
    } else {
      for (let i = 0; i < n; i++) relSec[i] = i / fs;
    }
    const chArr = nCh === 1 ? [Float32Array.from(ch0)] : [Float32Array.from(ch0), Float32Array.from(ch1), Float32Array.from(ch2)];
    // SITE is a layout fact, not a guess — but COLUMN COUNT ALONE IS NOT THE LAYOUT. The O2Ring emits
    // BOTH a 1-column pleth and a 3-column file whose three columns are the SAME reading replicated
    // (`124;124;124;0`), and column-count-only classification therefore called the ring a Verity on
    // every 3-column night. Measured over the 2026-07-16..25 corpus, with channels read BY HEADER NAME
    // (two namings exist: `channel 0..2` and `ppg0..2`):
    //
    //     O2Ring   526 three-column files   100.0 % of rows identical across channels   (min = max)
    //     Verity   261 three-column files     0.0 % of rows identical across channels   (min = max)
    //
    // Perfect separation, no overlap. Replication is therefore the discriminator, and it is decided on
    // the DATA rather than the header, so a future vendor renaming its columns changes nothing.
    //
    // Why it matters: site drives the morphology evidence tier (PPGDEX-O2RING-FINGER-SITE §5) and the
    // O2Ring sentinel pass below. Three of five audited nights were graded under the wrong site, and
    // the ring's 156-sentinel handling was skipped on every 3-column file it ever wrote.
    //
    // The scan is exact and stops at the first mismatch — with 0 % of Verity rows identical that is
    // the first sample, so the common case costs one comparison.
    /* The scan itself now lives in `deriveSiteFromLayout` (just below this function) so the
       SignalFrame ingest path can apply the IDENTICAL rule. It used to sit inline here, and a
       frame-routed recording therefore carried no `site` at all — it fell through to
       `rec.site || 'wrist'` in the export. That was invisible while only the 3-LED Verity could
       route (wrist is right for it, by luck) and became wrong the moment the O2Ring finger pleth
       got an adapter (ENGINE-VERIFICATION-FINDINGS §1.4). One rule, two callers. */
    /* THE LAYOUT NAMES THE DEVICE, NOT THE LIMB. A one-channel replicated stream is an O2Ring and a
       three-LED stream is a Verity — that much IS decided on the data and is reliable. What follows
       from it does not: this value is then spent as an ANATOMICAL fact. It selects the morphology
       evidence tier (dicrotic notch, augmentation index, reflection index, Takazawa b/a — every one
       of them site-sensitive and graded against WRIST-validated literature) and it gates three
       Integrator fusion paths.

       A strap goes where the wearer puts it. On this deployment the Verity is worn on the LEFT ANKLE
       and has been labelled 'wrist' throughout — so its pulse-wave morphology has been carrying a tier
       justified by wrist studies, at a site much further from the heart with an entirely different
       reflection profile. That is a metric holding a grade it never earned, which is the one thing
       this suite's evidence ladder exists to prevent.

       The site cannot be recovered from the waveform, so it is not guessed. `site` keeps its derived
       value (consumers gate on it and the sentinel pass genuinely is a device property), and
       `siteSource` now says where that value came from — so a reader can tell a DECLARED limb from a
       device default, and a grader can decline to award a site-validated tier to a default. */
    const site = deriveSiteFromLayout(chArr, n);
    // Sentinel pass runs ONLY on the finger layout — 156 is the O2Ring's marker and carries no meaning
    // in a Verity count stream (where it would be an ordinary, and astronomically rare, raw ADC value).
    // Keyed on SITE, not on nCh: a replicated 3-column O2Ring file is still an O2Ring, and keying on
    // the column count skipped the sentinel pass on 526 of its files in this corpus alone.
    const sent = site === 'finger' ? markO2BeatMarkers(chArr[0]) : null;
    /* See the hostAxis block below (DA-V §2.7 F17). `axisDrawn` is the STATISTICAL signature; this is
       the PROVENANCE fact — an O2Ring finger layout carries a host-synthesised axis whether or not the
       writer's rate estimator happens to have left it quantized. Named separately from `axisDrawn` so
       the two stay distinguishable: `quantizedShare` is still published raw, and a reader can still
       see that the fingerprint is absent while the verdict is drawn. */
    const axisSynthetic = axisDrawn || site === 'finger';
    /* ── DEVICE-CRYSTAL TIMEBASE (O2RING-ADAPTIVE-TIMEBASE Stage 2) ─────────────────────────────────
       O2Ring finger only, opt-in. Rebuild relSec on the 125.000 crystal grid instead of the
       host-disciplined ROW-rate axis: real ADC samples advance by 1/125.000, the inserted `156` beat
       markers (the sentinel `gap` rows) advance NOTHING, and each contiguous SEGMENT is re-anchored to
       the host-disciplined axis at every genuine loss (a `relSec` jump beyond TIME_GAP_STEPS/fs). So:
         · on a clean night this is exactly "cumulative-real-samples / 125.000 from the host t0" — the
           construction validated against H10 chest ECG (crystal +0.17 bpm / −0.4 ms rMSSD vs ECG);
         · genuine losses are PRESERVED (the segment anchors keep the host's honest gap timing), so
           intervalsSpanningTimeGap / coverage still see every discontinuity;
         · the RATE that accumulates error across a night is the crystal, never a possibly-untrusted host
           clock — which is the whole point (safe when the host is good, protective when it is not).
       host t0 is unchanged (t0Ms already the host anchor); only the intra-segment RATE and the marker
       deflation change. fs becomes 125.000 so 1/fs matches the real-sample spacing it indexes. */
    /* THE EFFECTIVE TIMEBASE for an O2Ring FINGER recording, by precedence (Stage 3b):
         1. opts.timebase — an explicit caller override (tests, signal-orchestrate)
         2. embeddedTimebase — the `# timebase=…` the capture host stamped into the file (Stage 3a decision)
         3. DEFAULT 'device-crystal' — the safe 125.000 floor. THIS is the default-FLIP: an O2Ring finger
            recording is analysed on its crystal unless the host EARNED discipline (stratum ≤ 1, tight skew)
            and said so via the embed. A Verity ignores all of this (not a finger either/or) → null. */
    const wantTimebase = opts.timebase === 'device-crystal' || opts.timebase === 'host-disciplined' ? opts.timebase : embeddedTimebase || 'device-crystal';
    let timebase = site === 'finger' ? wantTimebase : null;
    if (timebase === 'device-crystal' && site === 'finger' && n > 0) {
      const gapMask = sent ? sent.gap : null;
      const maxStep = TIME_GAP_STEPS / (fs > 0 ? fs : O2_ADC_HZ); // gap detector, on the host axis just built
      const rc = new Float64Array(n);
      let realCount = 0;
      let segAnchorSec = relSec.length ? relSec[0] : 0; // host t0 for segment 0
      for (let i = 0; i < n; i++) {
        if (i > 0 && relSec[i] - relSec[i - 1] > maxStep) {
          /* RE-ANCHOR, BUT NEVER BACKWARD (2026-08-14). Snapping to the host value assumed the host is
             ahead — at a genuine loss it is. It is not always, and the shortfall is systematic rather
             than noise: this file's ns axis is DRAWN at ~127.51 rows/s while the true row rate is
             125.000 + HR/60 ≈ 125.9, so host time under-counts by ~1.3 %. The crystal, counting real
             samples at the ADC rate, therefore gains ~64 ms over a 5 s segment — and every re-anchor
             dragged the axis back by whatever it had gained.
             Measured on one 5.9 h night: 1548 backward steps, median −4.73 ms, worst −336.62 ms,
             −20.4 s of backward time in total, on the DEFAULT path for every O2Ring finger recording.
             Invisible to every gate: `intervalsSpanningTimeGap` tests `relSec[i] − relSec[i−1] > maxStep`,
             strictly greater, so a NEGATIVE difference is never counted at any magnitude — and the
             fast-path `if (run === 0) return out;` then returns all-false through the branch documented
             as the clean case.
             The guard keeps the loss-preserving intent exactly: where the host really did jump ahead,
             `relSec[i]` still wins and the genuine gap survives. It only binds where the host is BEHIND,
             which is the case that was fabricating negative time. One ADC tick, not zero, so two
             consecutive samples never share an instant. */
          /* ADVANCE BY THE HOST'S GAP, DO NOT SNAP TO ITS ABSOLUTE VALUE. Both preserve the loss;
             only this one preserves its DURATION. Snapping (`max(relSec[i], …)`) silently shortened
             every genuine gap by however much the crystal had gained over the preceding segment —
             measured, two real losses on one night fell from 455→281 ms and 337→233 ms, i.e. below the
             314 ms detector and out of the gap count entirely. Trading fabricated backward time for
             undetected dropouts is not a fix.
             `relSec[i] − relSec[i−1]` is what the host actually observed elapsing across the loss, and
             adding it to the crystal's own position keeps the axis monotone (the difference exceeds
             `maxStep` by construction) while reproducing the gap exactly. */
          segAnchorSec = rc[i - 1] + (relSec[i] - relSec[i - 1]);
          realCount = 0;
        }
        rc[i] = segAnchorSec + realCount / O2_ADC_HZ;
        if (!gapMask || gapMask[i] === 0) realCount++; // a `156` marker row consumes no ADC time
      }
      relSec = rc;
      fs = O2_ADC_HZ;
      timebase = 'device-crystal';
    }
    return {
      ch: chArr,
      amb: Float32Array.from(amb),
      relSec,
      fs,
      timebase,
      n,
      t0Ms: t0Ms != null ? t0Ms : null,
      offsetMin: firstTs ? firstTs.offsetMin : null,
      /* NODE-EXPORT-DURATION-SEMANTICS §3 — the CLOCK position of the last sample, READ from the file,
         never derived. Null when no row carries a parseable stamp (Clock Contract §2.6: a value we do
         not have is null, never fabricated). Kept ALONGSIDE durSec, not instead of it: durSec answers
         "how much signal do I have", endEpochMs answers "where does this recording end on the clock" —
         two questions one scalar cannot both answer.

         The brief's §1 table lists PpgDex's durSec as "effectively wall span", on the reasoning that the
         grid is gap-filled. Measured on the capture corpus that is not quite true: `t0Ms + durSec` lands
         SHORT of the last stamp by up to 6.6 min on the gappiest O2Ring night (nGapSpanIntervals 6317),
         1.0 min on the next, and ~0 on contiguous nights — the gap-fill does not recover all lost time,
         so the shortfall scales with gap burden. Small next to ECGDex's measured +8…+326 min, but the
         same defect class, and the reason this field is read rather than computed. */
      endEpochMs: (function () {
        const lt = _ppgLastTs();
        return lt && lt.tMs != null ? lt.tMs : null;
      })(),
      durSec: (n - 1) / fs,
      site,
      // 'device-default' until someone declares otherwise — see the block above.
      siteSource: 'device-default',
      // Per-sample missing mask (1 = rejected sentinel). Null for the wrist layout. Never filled.
      gap: sent ? sent.gap : null,
      sentinelRejected: sent ? sent.rejected : 0,
      sentinelKept: sent ? sent.kept : 0,
      /* The firmware's own beat fiducials, as TIMES on the published axis. Positions, not a count —
         the same rows `sentinelRejected` tallies. Seconds rather than row indices deliberately: the
         crystal path rebuilds `relSec` underneath, so an index would not survive the rebuild, and a
         consumer wants an instant anyway. Null for the wrist layout (no O2Ring, no markers). */
      beatMarkerSec: sent && sent.beats.length ? Float64Array.from(sent.beats, (i) => relSec[i]) : null,
      /* What the host discipline actually did, so a consumer can SEE it rather than infer it.
         `maxStepMs` is the one to read: a large value is a real clock STEP smeared across one anchor
         gap, not a rate — the 2026-07-26 corpus carries a 1.90 s O2Ring step and a 3.22 s H10 one. */
      /* THE O2RING AXIS IS DRAWN BY CONSTRUCTION, WHATEVER `quantizedShare` SAYS (DA-V §2.7 F17).
         `axisDrawn` infers synthesis from ONE signature — ≥99 % of inter-sample deltas identical —
         which is what a `sample_index × assumed_rate` grid looks like. On 2026-07-27 capture-host
         gained a rate-SLEW estimator (`capture.py` `_O2PPG_EST_SLEW`): `step_s` now moves as the
         measured rate drifts, so the accumulated column stopped being a singleton delta set and
         `quantizedShare` collapsed from ~1.0 to **0.00083** on a real night. The axis became MORE
         synthetic and the detector went blind, so every O2Ring night since has certified itself
         `timingSource:'device+host'` — the TOP provenance tier, the one that says a real second clock
         disciplined this recording.

         There is no second clock. `capture.py`'s `_O2PpgGrid` accumulates `self.ns += step_ns` from a
         step it ESTIMATES against host arrival times (`arr`); the ring contributes sample ORDER and
         nothing else. That is `CLAUDE.md` §7's "a device whose axis was DRAWN is not a clock", and it
         is true of the O2Ring layout unconditionally — so key on the LAYOUT, which is observable in
         the file, rather than on a statistical fingerprint the writer can erase.

         `site === 'finger'` is exactly the O2Ring layout here (`deriveSiteFromLayout`: one channel, or
         several carrying byte-identical samples). Kept as an OR with `axisDrawn` so a genuinely
         quantized axis from any other source is still caught. Both branches covered — the `ok:false`
         branch matters more, not less: with no host anchors an O2Ring has NO timing at all, and it
         used to report `'device'`. */
      /* …AND THE HOST COLUMN MUST BE A SECOND CLOCK BEFORE WE CLAIM ONE (DA-V §2.4 F13).
         `DexClock.hostAxis` already answers this — it publishes `independent` (residual spread beyond
         one stamp quantum), `spreadMs` and an `inertReason` naming the verdict — and all three were
         DROPPED here, so `timingSource` was decided by `axisSynthetic` alone. On a phone-captured
         Verity night DexClock returned `independent:false` with *"host ≡ device — residual spread
         0.94 ms ≤ 2 ms (one stamp quantum); this host column is not an independent clock"*, and the
         export said `device+host` — both clocks contributed. That is `CLAUDE.md` §7's explicit
         instruction ("read `independent`, never a ~0 ppm") discarded one line after it was computed.

         The split is bimodal and real, not a tuned threshold: box captures measure 621–5930 ms of
         residual spread (BLE delivery jitter), phone captures 0.94 ms — one stamp quantum, because the
         phone's host column IS the device time rounded. So only phone-captured nights change.

         The lattice, stated once:
           synthetic + anchors  → 'host'         all timing came from the host clock
           synthetic + none     → 'none'         no timing information exists at all
           real axis + independent host → 'device+host'   genuinely two clocks
           real axis + inert host       → 'device'        the host column added NOTHING
         Note `independent` is about the two COLUMNS, not about whether the host clock is any good —
         which is why a DRAWN axis with an inert host column is still `'host'`: the device contributed
         nothing, so whatever the host column is, it is all the timing there is. */
      hostAxis: hostAx.ok
        ? {
            ok: true,
            anchors: hostAx.n,
            totalMs: hostAx.totalMs,
            ppm: hostAx.ppm,
            maxStepMs: hostAx.maxStepMs,
            drawn: axisSynthetic,
            quantizedShare,
            // Forwarded so a consumer can SEE the verdict instead of inferring it from a ~0 ppm.
            independent: hostAx.independent === undefined ? null : hostAx.independent,
            spreadMs: hostAx.spreadMs === undefined ? null : hostAx.spreadMs,
            inertReason: hostAx.inertReason || null,
            /* FORWARDED, because this block is a RESHAPE and anything not named here is dropped. That
               is not hypothetical: `stability` was computed in `clock.js` and vanished exactly here on
               the first real-data run — the same shape as the `buildV2` defect, one layer down. A node
               summary that renames fields must forward the ones it does not rename.
               Null on a DRAWN axis even when `clock.js` produced a curve: the ns column is then
               synthesised from the host, so its "divergence" is the writer's own arithmetic and a
               stability figure over it would describe capture-host code, not a clock. */
            stability: axisSynthetic ? null : hostAx.stability || null,
            timingSource: axisSynthetic ? 'host' : hostAx.independent === false ? 'device' : 'device+host'
          }
        : { ok: false, reason: hostAx.reason || 'no host anchors', drawn: axisSynthetic, quantizedShare, timingSource: axisSynthetic ? 'none' : 'device' }
    };
  }

  /* THE LAYOUT→SITE RULE, SINGLE-SOURCED (ENGINE-VERIFICATION-FINDINGS §1.4).
     `parsePPG` (text ingest) and `compute`'s SignalFrame branch (adapter ingest) must agree, because
     `site` is spent as an evidence-tier decision: it selects the morphology tier and gates three
     Integrator fusion paths. It lived only inside `parsePPG`, so a frame-routed recording arrived at
     `ppgBuildNodeExport` with no `site` and took the `|| 'wrist'` default. Nothing caught it — the
     only adapter that could produce a ppg frame was `polar-sense-ppg`, whose recordings really are
     3-LED, so the default agreed with the truth for the wrong reason. Adding `o2ring-ppg.js` made a
     FINGER layout reachable through that branch, where the same default would have stamped a
     wrist-validated tier onto a fingertip pleth.

     One channel, or several carrying byte-identical samples, is the O2Ring (its 3-column files
     replicate one reading — measured 100 % identical across 526 O2Ring files vs 0 % across 261
     Verity files, perfect separation). Decided on the DATA, never the header, so a vendor renaming
     its columns changes nothing. Exact scan, stops at the first mismatch. */
  function deriveSiteFromLayout(chArr, n) {
    const nCh = chArr ? chArr.length : 0;
    if (!nCh) return 'wrist';
    let replicated = nCh > 1;
    for (let c = 1; replicated && c < nCh; c++) {
      const a = chArr[0],
        b = chArr[c];
      const len = Math.min(n || 0, a ? a.length : 0, b ? b.length : 0);
      for (let i = 0; i < len; i++) {
        if (a[i] !== b[i]) {
          replicated = false;
          break;
        }
      }
    }
    return nCh === 1 || replicated ? 'finger' : 'wrist';
  }

  // ════════════════════════════════════════════════════════════════════════
  //  CHANNEL RANKING — best-SNR optical path (REFERENCE-channel selection)
  //  pulsatility = power in 0.7–3 Hz band ÷ power in 4–8 Hz band (after BP).
  //  PPGDEX-BEAT-DETECTION-PERF §2: score on a representative ~90 s WINDOW, not the
  //  whole record. SNR is a ratio of band powers, so a mid-recording window ranks the
  //  3 LEDs identically to the whole night; the old scorer ran TWO whole-record
  //  filtfilt bandpasses (4 biquad passes each) on EVERY channel — ~6 whole-record
  //  filter passes before detection even started. Under §1 all three channels are now
  //  DETECTED on (3-LED consensus), so this is only a RANKING to pick the reference
  //  waveform for the scope/morphology/SQI — never a discard.
  // ════════════════════════════════════════════════════════════════════════
  function channelSNR(sig, fs) {
    // representative mid-recording window (SNR is scale- & length-invariant); touches
    // ≤ ~90 s·fs samples per channel per band instead of the whole night.
    const win = Math.min(sig.length, Math.max(Math.round(fs * 90), Math.round(fs * 20)));
    let s0 = Math.floor((sig.length - win) / 2);
    if (s0 < 0) s0 = 0;
    const slice = s0 === 0 && win === sig.length ? sig : sig.subarray(s0, s0 + win);
    const pulse = bandpass(slice, fs, 0.7, 3.0);
    const noise = bandpass(slice, fs, 4.0, 8.0);
    const ps = std(pulse),
      ns = std(noise) || 1e-6;
    return { snr: ps / ns, amp: ps };
  }
  // ── DEGENERATE-CHANNEL GUARD (PPGDEX-MULTICHANNEL-FUSION §4, ENGINE-VERIFICATION §1.3) ──
  //  Two analog photodiodes CANNOT produce bit-identical streams over a recording — even the
  //  same LED sampled twice differs by ADC noise — so an identical pair is ONE sensor reported
  //  twice. Returns the indices of the DISTINCT channels; the caller treats that count as the
  //  real sensor count, so a replicated channel can never manufacture optical agreement.
  //
  //  Why "distinct count" and not "3 bit-identical": the capture host replicates the O2Ring's
  //  single ~125.7 Hz finger pleth across ppg0/1/2 so it routes through the Polar PSL layout
  //  with no new parser branch (capture.py). That is (v,v,v) → 1 distinct. But a pre-2026-07-18
  //  capture also carried an extra `timestamp [ms]` column, shifting every index by one, so the
  //  SAME ring reads as (ms-ramp, v, v) → 2 distinct. A 3-of-3 test would miss that second shape
  //  and pass it as a legitimate 2-LED sensor — fabricating exactly the quality claim this guard
  //  exists to prevent. Counting distinct channels fires on both, and on shapes nobody has met yet.
  //    → array of indices into ch[], length 1..n, holding the FIRST occurrence of each distinct
  //      stream (so a caller's reference index maps onto a channel that really exists).
  function sameChannel(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function distinctChannelIdx(chans) {
    const keep = [];
    for (let c = 0; c < chans.length; c++) {
      if (!keep.some((k) => sameChannel(chans[c], chans[k]))) keep.push(c);
    }
    return keep;
  }

  function pickChannel(rec) {
    let best = 0,
      bestScore = -Infinity,
      scores = [];
    for (let c = 0; c < rec.ch.length; c++) {
      const s = channelSNR(rec.ch[c], rec.fs);
      scores.push(s);
      if (s.snr > bestScore) {
        bestScore = s.snr;
        best = c;
      }
    }
    return { idx: best, scores };
  }

  // ── HARMONIC-OUTLIER REFERENCE GUARD (PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE §1 residual) ──
  // pickChannel ranks by pulse-band SNR, which is BLIND to harmonic counting — a channel counting the
  // dicrotic notch at 2× the true rate keeps full pulse-band energy (a doubled 48 bpm = 1.6 Hz is still
  // in-band) and can WIN the pick, making a corrupted LED the reference the PPI spine measures. The
  // adaptive refractory (§1) de-doubles detection at the source, so on the real trio corpus every
  // channel already reads the true cadence and this guard NEVER fires (verified inert on all 17 nights,
  // including the four all-LED-double ones — where it correctly does nothing, there being no clean
  // majority to fall back to). It is a belt-and-suspenders guard for a LONE channel that still doubles
  // where a clean majority does not: it moves the reference ONTO the coherent majority, never off it, so
  // it cannot regress a night whose channels agree. Given `rates` (per-channel detected bpm, null =
  // undetectable) and `snr` (per-channel pulse-band SNR, for the re-pick), it returns the reference idx.
  function harmonicOutlierRefIdx(refIdx, rates, snr) {
    const refRate = rates[refIdx];
    if (refRate == null || !isFinite(refRate) || refRate <= 0) return refIdx;
    const others = [];
    for (let i = 0; i < rates.length; i++) if (i !== refIdx && rates[i] != null && isFinite(rates[i]) && rates[i] > 0) others.push(rates[i]);
    if (others.length < 2) return refIdx; // need a majority of OTHER channels to trust a re-pick
    const medOther = median(others);
    if (!(medOther > 0)) return refIdx;
    const spread = (Math.max.apply(null, others) - Math.min.apply(null, others)) / medOther;
    // the OTHER channels must COHERE (a real shared cadence) AND the reference must sit at a near-integer
    // multiple (≥1.5×) of them — the harmonic-counting signature. Anything else: leave the SNR pick.
    if (!(spread < 0.15 && refRate / medOther >= 1.5)) return refIdx;
    // re-pick the best-SNR channel whose rate MATCHES the clean majority (within 15%).
    let pick = -1,
      bestSnr = -Infinity;
    for (let i = 0; i < rates.length; i++) {
      if (rates[i] == null || Math.abs(rates[i] / medOther - 1) >= 0.15) continue;
      const s = snr && snr[i] != null ? snr[i] : 0;
      if (s > bestSnr) {
        bestSnr = s;
        pick = i;
      }
    }
    return pick >= 0 ? pick : refIdx;
  }

  /* ── POLARITY BY UPSTROKE DURATION (PPG-FOOT-PLACEMENT §0, 2026-08-13) ────────────────────────
     `orient` below decides polarity from the SKEWNESS OF THE FIRST DERIVATIVE. The reasoning is right
     — a fast upstroke and slow decay do give positive derivative skew — but it is a THIRD MOMENT on a
     noisy derivative, and it flips under low-frequency contamination. Measured on the box corpus it is
     WRONG ON 10 OF 20 NIGHTS (0 of 22 phone nights).

     When it flips, the pulse is processed upside down and every downstream number is silently wrong:
     the ensemble minimum lands AFTER the peak (t = +290 ms rather than −300 ms), the "systolic
     upstroke" becomes a ~1000 ms near-linear ramp instead of a 160 ms rise, and the foot is placed
     ~900 ms early. Inter-LED scatter goes 1.7 ms → 25–42 ms.

     ⚠️ THE CONSENSUS-POLARITY PASS CANNOT CATCH THIS, BY CONSTRUCTION. It acts only on a DISSENTER —
     a strict majority with at least one channel disagreeing — and returns 0 when the channels are
     unanimous, deliberately, to stay export-inert. On every affected night all three channels agree on
     the WRONG sign, and unanimously-wrong is indistinguishable from unanimously-right to that rule.
     That is also why the error is COMMON-MODE across the three LEDs, and so invisible to any
     inter-channel agreement metric.

     THE RULE HERE IS PHYSIOLOGICAL RATHER THAN STATISTICAL, and has no threshold, no moment and no
     amplitude term:

         the correct polarity is the one whose median foot→peak rise is a SMALLER FRACTION of the
         beat interval, because systole is faster than diastole in every cardiac waveform.

     Measured, it returns −1 on all 31 nights across both corpora, takes good nights from 6/20 to 18/20
     and the worst night from 204.80 ms (70 beats paired) to 3.48 ms (22 335 paired).

     Polarity is a property of the DEVICE and constant for a recording, so it is decided from a bounded
     sample rather than the whole night — two extra `detectBeats` calls over ~2 minutes, not two over
     eight hours. The sample is taken from the MIDDLE: the start of a recording is where the sensor is
     being put on, and donning artefact is exactly the low-frequency contamination that breaks `orient`.

     Falls back to `orient` when the sample carries too few beats to decide, so a channel that cannot be
     measured keeps the previous behaviour instead of guessing. */
  /* ⚠️ DECLARE THESE WITH `const`, NOT `var`. They are shipped to the Web-Worker realm through the
     `consts` map in `_buildWorkerURL`, and dex-tests.js rebuilds that realm by regex-matching
     `^const NAME = …` out of this file's own text. A `var` is found by neither, so the worker throws
     `ReferenceError` at RUNTIME while every static check still passes — which is exactly how this
     was caught, and exactly the drift the `consts` comment below already records once. */
  const ORIENT_SAMPLE_SEC = 120; // ~100 beats at 50 bpm — enough for a stable median, cheap to detect
  const ORIENT_MIN_BEATS = 5; // below this a median rise means nothing; defer to `orient`

  function riseFraction(bp, fs) {
    // median (peak − foot) as a fraction of the beat interval, for ONE already-oriented waveform.
    var det = detectBeats(bp, fs);
    var n = Math.min(det.peaks.length, det.feet.length);
    if (n < ORIENT_MIN_BEATS || !(det.T > 0)) return null;
    var r = [];
    for (var k = 0; k < n; k++) {
      var d = det.peaks[k] - det.feet[k];
      if (isFinite(d) && d > 0) r.push(d);
    }
    if (r.length < ORIENT_MIN_BEATS) return null;
    return median(r) / det.T;
  }

  function orientByRise(bp, fs) {
    var n = bp.length;
    var want = Math.round(fs * ORIENT_SAMPLE_SEC);
    var seg;
    if (!(want > 0) || n <= want) {
      seg = bp;
    } else {
      var lo = Math.floor((n - want) / 2); // the MIDDLE — the start is donning artefact
      seg = bp.subarray ? bp.subarray(lo, lo + want) : bp.slice(lo, lo + want);
    }
    var up = riseFraction(seg, fs);
    var dn = riseFraction(negate(seg), fs);
    if (up == null && dn == null) return orient(bp); // undecidable → previous behaviour
    if (up == null) return -1;
    if (dn == null) return 1;
    return dn < up ? -1 : 1;
  }

  // ── orientation: systolic upstroke should be the steep, sharp deflection ──
  // ⚠️ SUPERSEDED as the default by `orientByRise` above — kept as its fallback for the
  //    undecidable case, and because it is still the right idea when beats cannot be found.
  function orient(bp) {
    // PPG upstroke (systole→peak) is steeper than the diastolic decay.
    // skewness of the derivative is positive when peaks point "up" correctly.
    const d = new Float32Array(bp.length);
    for (let i = 1; i < bp.length; i++) d[i] = bp[i] - bp[i - 1];
    let s = 0,
      n = 0;
    const m = mean(d),
      sd = std(d) || 1e-9;
    for (let i = 1; i < d.length; i++) {
      const z = (d[i] - m) / sd;
      s += z * z * z;
      n++;
    }
    const skew = s / n;
    // positive derivative-skew → sharp rises dominate → peaks already "up"
    return skew >= 0 ? 1 : -1;
  }

  /* The device-wide polarity a set of per-channel `orient` guesses implies — the rule behind the
     consensus-polarity pass in `analyze` (PPGDEX-ALGORITHM-DEEP-DIVE §6.2 / E-5). Extracted so the
     rule is directly testable rather than buried in a 300-line function.
       → +1 / −1  a STRICT majority of channels agrees on that polarity AND at least one dissents
       →  0       nothing to do: already unanimous, no strict majority (a 1-1 split), or < 2 channels
     Returning 0 for "unanimous" is what keeps the pass export-inert on every record that is already
     consistent — the caller does no work at all, so no re-detection and no fixture movement. A 1-1
     split also returns 0 on purpose: there is nothing to prefer between two equally-confident
     channels, and inventing a winner would be worse than the condition being corrected. */
  /* Apply the consensus polarity to a channel set. Split out from `analyze` for the same reason
     `consensusSign` was: the WIRING is where a fix silently stops being applied. `redetect(i, sign)`
     returns a replacement channel for dissenter `i`; injecting it keeps this function free of the
     record/gap plumbing and lets a test assert that EXACTLY the dissenters are re-detected, with the
     majority sign, and that a unanimous set is touched not at all.
     → the number of channels replaced (0 whenever there is no strict majority to adopt). */
  function applyConsensusPolarity(perChannel, redetect) {
    if (!perChannel || !perChannel.length) return 0;
    const signs = perChannel.map((pc) => (pc ? pc.sign : null));
    const maj = consensusSign(signs);
    if (maj === 0) return 0;
    let changed = 0;
    for (let i = 0; i < perChannel.length; i++) {
      if (signs[i] !== maj) {
        perChannel[i] = redetect(i, maj);
        changed++;
      }
    }
    return changed;
  }

  function consensusSign(signs) {
    if (!signs || signs.length < 2) return 0;
    let neg = 0,
      pos = 0;
    for (let i = 0; i < signs.length; i++) {
      if (signs[i] === -1) neg++;
      else if (signs[i] === 1) pos++;
    }
    if (neg === 0 || pos === 0) return 0; // unanimous (or no usable signs) — nothing dissents
    if (neg === pos) return 0; // no strict majority
    return neg > pos ? -1 : 1;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  OPTICAL BEAT DETECTION — O(N) TERMA (Elgendi 2013, "the Pan-Tompkins of PPG")
  //  PPGDEX-BEAT-DETECTION-PERF §1. Two event-related moving averages + a beat-
  //  adaptive offset threshold → systolic peaks in ONE forward pass. NO whole-record
  //  autocorrelation and NO global period. The old detector swept ~235 lags × N
  //  (~1.07e9 mul-adds on a 4.6 M-sample night) to estimate ONE scalar period T, then
  //  used that single period + a fixed 0.30 threshold to segment a whole drifting-HR
  //  night — which both janked the main thread AND dropped beats where amplitude/shape
  //  wandered (the ~19 % missed-beat root cause). TERMA's threshold is LOCAL (tracks
  //  MA_beat), adapting beat-to-beat with no tuned period. Strictly O(N) (running-sum
  //  moving averages + a single block scan). Feet stay the intersecting-tangent
  //  refinement (PPI = foot-to-foot), fed from the new peaks.
  // ════════════════════════════════════════════════════════════════════════
  /* ── CADENCE PRIOR — windowed autocorrelation of the pulse band ────────────────────────────────
   * Local beat period in SAMPLES for every sample index (Float32Array), or null if the record is too
   * short to window.
   *
   * WHY (the dicrotic-notch double-count — PPGDEX-OPTICAL-DETECTOR §1): TERMA calls a beat wherever the
   * short upstroke-energy average exceeds the long one — a bare `maPeak > maBeat`, with no amplitude
   * discrimination. A prominent DIASTOLIC (reflected) wave is a genuine positive-slope event, so it
   * raises its own block and is detected as a second "beat" about half a cycle after systole. At the
   * sleeping ~48 bpm of the real corpus that is ~625 ms — far outside the fixed 0.30 s refractory, so
   * nothing suppressed it and the optical HR read exactly 2× true. On 2026-06-29 / 07-02 / 07-05 ALL
   * THREE LEDs doubled together, so the 3-LED vote ratified it (2-of-3 agreement on a harmonic is still
   * 2-of-3) and no cross-channel check could see it either.
   *
   * The fundamental is immune to this: a dicrotic notch is a HARMONIC (it sits at T/2), while the
   * autocorrelation still peaks at the true beat T. Against paired chest-ECG on the whole trio corpus the
   * ACF cadence is right on EVERY night — including the four where peak-counting doubles (07-01 47.9 vs
   * ECG 48.0 · 06-29 49.2 vs 49.7 · 07-02 47.9 vs 48.4 · 07-05 56.6 vs 57.8); worst error 1.2 bpm.
   *
   * ⚠️ NOT a return to the retired global-period detector. THAT one used a WHOLE-RECORD autocorrelation
   * period to GATE detection, and was the missed-beat root cause (see the note below). Here the cadence is
   * (a) WINDOWED — it tracks HR drift across a night, arousals included — and (b) used ONLY to size the
   * refractory. TERMA still finds every peak; the cadence only says how close two peaks may legitimately be.
   */
  // How strong a sub-multiple lag must be, relative to the winning lag, before the cadence is divided
  // down to it (§3.2). MEASURED on synthetic ground truth, both directions — the two populations are
  // cleanly separated, and by SIGN as much as by size:
  //
  //   pulsus alternans   corr[T]/corr[2T]   15% → 0.95 · 25% → 0.88 · 35% → 0.78 · 50% → 0.60 · 60% → 0.47
  //   dicrotic notch     corr[T/2]/corr[T]  0.3 → −0.83 · 0.45 → −0.66 · 0.6 → −0.47 · 0.9 → −0.10 · 1.2 → +0.18
  //
  // A notch harmonic is ANTI-correlated at T/2 (the notch sits in antiphase with systole), so it does
  // not merely score lower — it usually scores NEGATIVE. 0.40 catches alternans out to ~62 % while
  // keeping better than 2× margin above the worst (most extreme-notch) false-positive case.
  // Raise it and the halving comes back; lower it toward 0.18 and a monstrous notch could DOUBLE the
  // HR, which is the worse error — that is the failure PPGDEX-OPTICAL-DETECTOR §1 was written about.
  const SUBH_FRAC = 0.4;
  function cadenceSamples(bp, fs) {
    const n = bp.length;
    const WIN = Math.round(fs * 30),
      HOP = Math.round(fs * 15);
    if (n < WIN + HOP) return null;
    // Pulse band only (0.5–3.0 Hz = 30–180 bpm) — drops the harmonics the notch lives in, so the ACF is
    // dominated by the fundamental. Decimate to ~25 Hz first: the ACF is O(win × lags) and needs no more
    // resolution than that (a 25 Hz lag step is 40 ms, and the period is smoothed across windows anyway).
    const lp = bandpass(bp, fs, 0.5, 3.0);
    const D = Math.max(1, Math.round(fs / 25)),
      fsd = fs / D;
    const m = Math.floor(n / D),
      x = new Float32Array(m);
    for (let i = 0; i < m; i++) x[i] = lp[i * D];
    const lagMin = Math.max(2, Math.round(fsd * 0.33)); // 180 bpm ceiling
    const lagMax = Math.round(fsd * 2.0); //  30 bpm floor
    const wd = Math.round(WIN / D),
      hd = Math.round(HOP / D);
    const ts = [],
      ws = [];
    for (let s = 0; s + wd <= m; s += hd) {
      let mu = 0;
      for (let i = s; i < s + wd; i++) mu += x[i];
      mu /= wd;
      // MEAN product per lag, not the raw sum (DEEP-AUDIT-II §3.2). A longer lag sums FEWER terms, so
      // raw sums are not comparable across lags — and the sub-harmonic test below is a comparison
      // between lags, so it would be meaningless on unnormalised sums.
      let best = -Infinity,
        bl = 0;
      const corr = new Float64Array(lagMax + 1);
      for (let L = lagMin; L <= lagMax; L++) {
        let c = 0,
          cnt = 0;
        for (let i = s; i + L < s + wd; i++) {
          c += (x[i] - mu) * (x[i + L] - mu);
          cnt++;
        }
        const r = cnt ? c / cnt : 0;
        corr[L] = r;
        if (r > best) {
          best = r;
          bl = L;
        }
      }
      // ── SUB-HARMONIC REJECTION (DEEP-AUDIT-II §3.2) ──────────────────────────────────────────
      // An ACF peaks at the true period T *and* at every multiple 2T, 3T… When consecutive beats
      // differ in amplitude — pulsus alternans, or plain perfusion/motion variation making every
      // other beat weaker — the 2T peak can EXCEED the T peak, because at 2T like-sized beats line
      // up. The window then reports 2T, the refractory is sized from a doubled period, and the HR
      // reads exactly HALF. Measured before this fix: 75 bpm → 37.5, 100 bpm → 50.0.
      //
      // Why it was invisible: the search ceiling is lagMax = 2.0 s, so 2T only FITS inside the
      // window when T ≤ 1.0 s — i.e. HR ≥ 60. The whole trio corpus sleeps at ~48 bpm (2T = 2.5 s,
      // out of range), so every validated night sat below the threshold where this can happen.
      //
      // The test is deliberately asymmetric. Dividing is only allowed when the shorter lag is
      // NEARLY AS STRONG (≥ SUBH_FRAC), because the opposite error is the one this whole ACF exists
      // to prevent: a dicrotic notch is a harmonic at T/2, and dividing onto it would DOUBLE the HR
      // — the failure that doubled whole nights (PPGDEX-OPTICAL-DETECTOR §1). A notch harmonic
      // scores far below its fundamental, so a strict fraction separates the two cleanly; the gate
      // pins both directions.
      if (bl && best > 0) {
        for (let k = 3; k >= 2; k--) {
          const cand = Math.round(bl / k);
          if (cand < lagMin) continue;
          // Search a ±1-lag neighbourhood, not the exact quotient. The ACF runs on a ~25 Hz decimated
          // signal, so one lag step is 40 ms and bl/k lands OFF the true period whenever T is not a
          // whole number of steps — at 120 bpm (T = 12.5 steps) the quotient misses by 4 %, the
          // correlation there is degraded, the test fails, and the cadence stays doubled. Measured:
          // without this, 120 bpm still read 60.
          let bc = cand,
            bv = corr[cand];
          for (let d = -1; d <= 1; d++) {
            const c2 = cand + d;
            if (c2 >= lagMin && c2 <= lagMax && corr[c2] > bv) {
              bv = corr[c2];
              bc = c2;
            }
          }
          if (bv >= SUBH_FRAC * best) {
            bl = bc;
            break; // smallest passing divisor wins: 3T→T directly, never 3T→1.5T (not a period)
          }
        }
      }
      if (bl) {
        ts.push(bl * D);
        ws.push(s * D + WIN / 2);
      } // period in ORIGINAL samples, at the window centre
    }
    if (!ts.length) return null;
    // Piecewise-linear across window centres (HR drifts smoothly); flat outside the first/last centre.
    const out = new Float32Array(n);
    let k = 0;
    for (let i = 0; i < n; i++) {
      while (k < ws.length - 2 && i > ws[k + 1]) k++;
      if (i <= ws[0]) out[i] = ts[0];
      else if (i >= ws[ws.length - 1]) out[i] = ts[ts.length - 1];
      else {
        const f = (i - ws[k]) / Math.max(1, ws[k + 1] - ws[k]);
        out[i] = ts[k] * (1 - f) + ts[k + 1] * f;
      }
    }
    return out;
  }
  // A systolic peak cannot follow the previous one sooner than this fraction of a beat — an interval
  // below it is the reflected/diastolic wave, not a heartbeat. 0.60 clears the observed intruder (~0.5 × T:
  // a 600–700 ms mode against a 1250 ms beat) while still admitting a genuine beat-to-beat acceleration of
  // up to ~1.67×, which no real sinus rhythm exceeds between ADJACENT beats.
  const REFR_CADENCE_FRAC = 0.6;
  function detectBeats(bp, fs) {
    const n = bp.length;
    const peaks = [];
    if (n < 3) return { peaks, feet: [], T: Math.round(fs * 0.85) };
    // FEATURE = positive-slope (systolic-upstroke) energy. The derivative removes any DC
    // offset AND slow baseline wander (≈0 slope), so — unlike a clipped-amplitude square —
    // it is robust to the large baseline drift + supra-physiologic transients real optical
    // channels carry (a transient inflates only the LOCAL long average, suppressing just its
    // own neighbourhood, not the whole record). Fed into TERMA's dual moving-average block
    // logic, which replaces the old autocorrelation-derived GLOBAL period (the missed-beat
    // root cause) with a LOCAL adaptive threshold.
    const z = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const dv = bp[i] - bp[i - 1];
      z[i] = dv > 0 ? dv * dv : 0;
    }
    const W1 = Math.max(3, Math.round(fs * 0.111)); // systolic-upstroke window (~111 ms)
    const W2 = Math.max(W1 + 2, Math.round(fs * 0.667)); // one-beat window (~667 ms)
    const maPeak = movavg(z, W1);
    const maBeat = movavg(z, W2);
    const minW = Math.max(2, Math.round(fs * 0.05)); // min systolic-block width (noise reject)
    const refrFloor = Math.round(fs * 0.3); // 200 bpm ceiling — absolute physiologic floor
    // ADAPTIVE refractory: 0.60 × the LOCAL beat (windowed-ACF cadence), floored at the 0.30 s physiologic
    // ceiling. A fixed 0.30 s cannot reject a diastolic wave at a sleeping 48 bpm (it lands ~625 ms out,
    // twice the refractory) — which is exactly how the optical HR came to read 2× true. Null cadence (a
    // clip too short to window) ⇒ the floor, i.e. the old behaviour.
    const cad = cadenceSamples(bp, fs);
    // blocks of interest where the short upstroke-energy average exceeds the LOCAL long
    // average — LOCAL threshold, so no global period and no outlier-inflated global offset;
    // it adapts beat-to-beat as HR/amplitude drift. Kept only if wider than minW.
    let i = 1;
    while (i < n) {
      if (maPeak[i] > maBeat[i]) {
        let j = i;
        while (j < n && maPeak[j] > maBeat[j]) j++;
        if (j - i >= minW) {
          // valid systolic block
          // systolic peak = max of the ORIGINAL waveform across the upstroke block + a short tail
          let sp = i,
            sv = -Infinity;
          const hi = Math.min(n, j + Math.round(fs * 0.12));
          for (let k = i; k < hi; k++) {
            const v = bp[k];
            if (v > sv) {
              sv = v;
              sp = k;
            }
          }
          // Refractory sized by the LOCAL cadence. On a conflict the TALLER peak wins (unchanged) — and
          // that is what separates systole from its reflection: the diastolic wave is the smaller of the
          // two, so it loses the arbitration instead of being counted as an extra beat.
          const refr = cad ? Math.max(refrFloor, Math.round(REFR_CADENCE_FRAC * cad[sp])) : refrFloor;
          if (peaks.length === 0 || sp - peaks[peaks.length - 1] >= refr) peaks.push(sp);
          else if (bp[sp] > bp[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = sp;
        }
        i = j;
      } else i++;
    }
    // nominal period (samples) from the DETECTED cadence — back-compat scalar for callers
    // + the first-foot lower bound. NOT used to gate detection any more.
    let T = Math.round(fs * 0.85);
    if (peaks.length > 2) {
      const dd = [];
      for (let k = 1; k < peaks.length; k++) dd.push(peaks[k] - peaks[k - 1]);
      const md = median(dd);
      if (md > 0) T = Math.round(md);
    }
    const feet = refineFeet(bp, peaks, T);
    return { peaks, feet, T };
  }
  // intersecting-tangent systolic foot per peak (PPI timing point). Extracted so BOTH
  // the single-channel detectBeats and the 3-LED consensus (feet re-derived on the
  // reference channel) share ONE implementation.
  function refineFeet(bp, peaks, T) {
    const feet = [];
    for (let k = 0; k < peaks.length; k++) {
      const p = peaks[k];
      const lo = k > 0 ? peaks[k - 1] : Math.max(0, p - T);
      let mi = p,
        mv = bp[p];
      for (let j = p; j > lo; j--) {
        if (bp[j] < mv) {
          mv = bp[j];
          mi = j;
        }
      }
      let ms = mi,
        msv = -Infinity;
      for (let j = mi; j < p; j++) {
        const dv = bp[j + 1] - bp[j];
        if (dv > msv) {
          msv = dv;
          ms = j;
        }
      }
      let foot = mi;
      if (msv > 1e-9) {
        const cross = ms - (bp[ms] - mv) / msv;
        foot = Math.max(lo, Math.min(p, cross));
      }
      feet.push(foot);
    }
    return feet;
  }
  function negate(x) {
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) y[i] = -x[i];
    return y;
  }
  // bandpass + orient + O(N) detect for ONE optical channel. PURE + self-contained
  // (closes over nothing but the module's pure helpers) so the §2b Web-Worker pool can
  // run it verbatim off its own .toString() — serial + worker paths are then byte-
  // identical by construction. Returns the reference-usable band-passed waveform too.
  /* `forceSign` (OPTIONAL, added LAST per CLAUDE.md §🧪) replaces `orient`'s per-channel guess with a
     polarity decided across the WHOLE device — see the consensus-polarity pass in `analyze`. Omitted or
     not ±1 ⇒ byte-identical to before, so every existing caller is unaffected, INCLUDING the worker:
     `_buildWorkerURL` serialises this function's own `.toString()` and calls it with two arguments, so
     the serial and worker paths stay identical by construction (the property the comment above pins). */
  function detectChannel(chan, fs, forceSign) {
    const bp0 = bandpass(chan, fs, 0.5, 8.0);
    const sign = forceSign === 1 || forceSign === -1 ? forceSign : orientByRise(bp0, fs);
    const bp = sign === 1 ? bp0 : negate(bp0);
    const det = detectBeats(bp, fs);
    return { bp, sign, peaks: det.peaks, feet: det.feet, T: det.T };
  }
  // ════════════════════════════════════════════════════════════════════════
  //  3-LED CONSENSUS (PPGDEX-BEAT-DETECTION-PERF §1/§5) — optical bSQI
  //  The Polar Sense streams THREE co-located optical paths (ch0/ch1/ch2). Detect
  //  independently on each (detectChannel), then keep a beat only where ≥ 2 of 3
  //  channels place a systolic peak within ±50 ms — the optical analog of ECGDex's
  //  two-detector agreement. A 1/3 beat is almost always motion / poor perfusion:
  //  it is DROPPED (a gap), NEVER median-filled — median-fill fabricates regularity
  //  and was a prime reason the old whole-record RMSSD read implausibly high. Feet are
  //  re-derived on the reference channel so PPI stays foot-to-foot on the best waveform.
  //    perChannel : [{ bp, peaks, feet }, …]  (1..3 channels)
  //    refIdx     : reference channel index (best windowed SNR, §2)
  //  → { peaks, feet, agree:[frac∈{2/3,3/3} per kept beat|null], clusters:[{s,nAgree}],
  //      nDropped, kept33, kept22, singleChannel }
  // ════════════════════════════════════════════════════════════════════════
  function consensusBeats(perChannel, refIdx, fs) {
    const nCh = perChannel.length;
    const refBp = perChannel[refIdx].bp;
    // single channel (companion LEDs unavailable) → no consensus possible: pass the
    // reference channel's own beats through, agreement unknown (null ⇒ ribbon hidden).
    if (nCh < 2) {
      const pk = perChannel[refIdx].peaks.slice();
      return { peaks: pk, feet: perChannel[refIdx].feet.slice(), agree: pk.map(() => null), clusters: pk.map((s) => ({ s, nAgree: 1 })), nDropped: 0, kept33: 0, kept22: 0, singleChannel: true };
    }
    const tol = Math.max(1, Math.round(0.05 * fs)); // ±50 ms agreement window
    const ev = [];
    for (let c = 0; c < nCh; c++) {
      const pks = perChannel[c].peaks;
      for (let k = 0; k < pks.length; k++) ev.push({ s: pks[k], c });
    }
    ev.sort((a, b) => a.s - b.s);
    // cluster events within ±tol — one heartbeat's peaks across channels fall inside tol;
    // the next beat is ≥ refr(0.3 s) away, so a tol(50 ms) window cleanly splits heartbeats.
    const rawPeaks = [],
      rawAgree = [],
      clusters = [];
    let nDropped = 0,
      kept33 = 0,
      kept22 = 0;
    let i = 0;
    while (i < ev.length) {
      const chans = {};
      const ss = [];
      let j = i;
      chans[ev[j].c] = 1;
      ss.push(ev[j].s);
      j++;
      // CHAIN by gap: extend while consecutive events are within tol. One heartbeat's peaks
      // across channels form a chain ≤ tol wide; the next beat is ≥ refr(0.3 s) away, so a beat
      // whose 3 channel-peaks spread slightly (localisation noise) stays ONE cluster instead of
      // boundary-splitting into a spurious 1/3 drop.
      while (j < ev.length && ev[j].s - ev[j - 1].s <= tol) {
        chans[ev[j].c] = 1;
        ss.push(ev[j].s);
        j++;
      }
      const nAgree = Object.keys(chans).length;
      const cs = Math.round(median(ss));
      clusters.push({ s: cs, nAgree });
      if (nAgree >= 2) {
        rawPeaks.push(cs);
        rawAgree.push(nAgree / nCh);
        if (nAgree >= 3) kept33++;
        else kept22++;
      } else nDropped++;
      i = j;
    }
    // enforce refractory on the merged spine (a boundary split could double a beat)
    const refr = Math.round(fs * 0.3);
    const peaks = [],
      agree = [];
    for (let k = 0; k < rawPeaks.length; k++) {
      if (peaks.length && rawPeaks[k] - peaks[peaks.length - 1] < refr) {
        if (refBp[rawPeaks[k]] > refBp[peaks[peaks.length - 1]]) {
          peaks[peaks.length - 1] = rawPeaks[k];
          agree[agree.length - 1] = rawAgree[k];
        }
      } else {
        peaks.push(rawPeaks[k]);
        agree.push(rawAgree[k]);
      }
    }
    let T = Math.round(fs * 0.85);
    if (peaks.length > 2) {
      const dd = [];
      for (let k = 1; k < peaks.length; k++) dd.push(peaks[k] - peaks[k - 1]);
      const md = median(dd);
      if (md > 0) T = Math.round(md);
    }
    const feet = refineFeet(refBp, peaks, T);
    return { peaks, feet, agree, clusters, nDropped, kept33, kept22, singleChannel: false };
  }
  function movavg(x, w) {
    const y = new Float32Array(x.length);
    let s = 0;
    for (let i = 0; i < x.length; i++) {
      s += x[i];
      if (i >= w) s -= x[i - w];
      y[i] = s / Math.min(i + 1, w);
    }
    return y;
  }
  function localMax(a, i0, i1) {
    let m = -Infinity;
    for (let i = i0; i < i1; i++) if (a[i] > m) m = a[i];
    return m;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PER-BEAT SQI  — template correlation × amplitude × motion gate
  // ════════════════════════════════════════════════════════════════════════
  // `regular` (OPTIONAL, added LAST for back-compat per CLAUDE.md §🧪) is the single-channel
  // cadence axis — consulted ONLY where the LED agreement axis is unavailable, never in addition
  // to it, so a 3-LED session's SQI is byte-unchanged.
  function beatSQI(bp, peaks, fs, motionAt, agree, regular) {
    const n = peaks.length;
    if (!n) return [];
    const pre = Math.round(fs * 0.2),
      post = Math.round(fs * 0.45),
      L = pre + post;
    // build amplitude-normalised beats around peaks
    const beats = [];
    for (let k = 0; k < n; k++) {
      const p = peaks[k];
      const seg = new Float32Array(L);
      let ok = true;
      for (let j = 0; j < L; j++) {
        const idx = p - pre + j;
        if (idx < 0 || idx >= bp.length) {
          ok = false;
          break;
        }
        seg[j] = bp[idx];
      }
      beats.push(ok ? seg : null);
    }
    // template = median across valid beats (normalised)
    const norm = (b) => {
      if (!b) return null;
      const mn = Math.min.apply(null, b),
        mx = Math.max.apply(null, b);
      const r = mx - mn || 1;
      const o = new Float32Array(b.length);
      for (let j = 0; j < b.length; j++) o[j] = (b[j] - mn) / r;
      return o;
    };
    const nb = /** @type {Float32Array[]} */ (beats.map(norm).filter(Boolean));
    const tmpl = new Float32Array(L);
    if (nb.length) {
      for (let j = 0; j < L; j++) {
        const col = [];
        for (const b of nb) col.push(b[j]);
        tmpl[j] = median(col);
      }
    }
    const sqi = [];
    for (let k = 0; k < n; k++) {
      const b = norm(beats[k]);
      let corr = 0;
      if (b) {
        corr = pearson(b, tmpl);
      }
      const mot = motionAt ? motionAt(peaks[k]) : 0; // 0..1 motion index at beat
      const motFactor = 1 - Math.min(1, mot); // high motion → low conf
      let q = Math.max(0, corr) * (0.4 + 0.6 * motFactor);
      // §5: fold the 3-LED consensus agreement as a multiplicative axis — a 2/3 beat is
      // down-weighted vs a 3/3 beat (1/3 beats were already dropped in consensus). A
      // single-channel session has agree[k]==null → no LED axis (unchanged, back-compat).
      if (agree && agree[k] != null) {
        q *= 0.5 + 0.5 * agree[k];
      } // 2/3→0.83×, 3/3→1.0×
      else if (regular && regular[k] != null) {
        q *= regular[k];
      } // single-channel: cadence corroboration stands in for the absent vote (§4)
      sqi.push(Math.max(0, Math.min(1, q)));
    }
    return sqi;
  }
  // ════════════════════════════════════════════════════════════════════════
  //  SINGLE-CHANNEL CONFIDENCE AXIS (PPGDEX-O2RING-FINGER-SITE §4)
  //  With ONE LED there is no 2-of-3 vote, so beatSQI's multiplicative agreement axis has nothing
  //  to carry. Do NOT fabricate a second detector. The honest substitute is the beat's own
  //  INTER-BEAT REGULARITY: a beat whose flanking intervals sit near the local median PPI is
  //  corroborated by cadence, while a halved or doubled interval is exactly where a single-channel
  //  optical detector fails (a missed beat, or a dicrotic notch double-counted as a second systole
  //  — the failure mode PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE §1 found doubling whole nights).
  //  The MIN of the two flanking deviations is deliberate: a spurious beat splits one interval into
  //  two short ones, so BOTH its flanks deviate and it is penalised, while the genuine beats either
  //  side keep one good flank each and are not punished for their neighbour's error.
  //  This axis is strictly weaker than a real vote and is scored as such — it floors at 0.6 and is
  //  never a free 1.0 — which is why finger morphology enters at `experimental` (§5) rather than
  //  inheriting the wrist site's `emerging`.
  //  → per-beat multiplier in [0.6, 1], or null where cadence is unknowable (too few beats).
  function beatRegularity(peaks, fs) {
    const n = peaks.length;
    if (n < 4) return peaks.map(() => null); // no local cadence to judge against — unknown, NOT perfect
    const iv = [];
    for (let k = 1; k < n; k++) iv.push(peaks[k] - peaks[k - 1]);
    const med = median(iv);
    if (!(med > 0)) return peaks.map(() => null);
    const out = [];
    for (let k = 0; k < n; k++) {
      const devs = [];
      if (k > 0) devs.push(Math.abs(iv[k - 1] - med) / med);
      if (k < n - 1) devs.push(Math.abs(iv[k] - med) / med);
      const d = devs.length ? Math.min.apply(null, devs) : 1;
      // 0 % deviation → 1.0 · ≥50 % (a halved/doubled interval) → the 0.6 floor
      out.push(Math.max(0.6, 1 - Math.min(1, d / 0.5) * 0.4));
    }
    return out;
  }

  // ── SENTINEL GAPS vs THE FILTER (PPGDEX-O2RING-FINGER-SITE §3) ──
  //  A rejected sentinel is known-invalid, so it must not reach the biquad AS AN AMPLITUDE — left in,
  //  156 is a step away from the local trend and rings the filter around every gap. But a biquad has
  //  no concept of "missing": some number must occupy the slot. We hold the last good sample (a
  //  zero-order hold — the least inventive choice available; explicitly NOT a median filter and NOT
  //  interpolation, both of which invent a trajectory the device never reported).
  //  The honesty guarantee is NOT in this substitution — it is that no REPORTED measurement rests on
  //  it: `gapBeats` below drops every beat whose foot→peak span touches a gap, so a held sample can
  //  shape a filter tail but can never produce a PPI, an HRV interval, or a morphology fiducial.
  //  The held values are never surfaced and never exported.
  function holdOverGaps(x, gap) {
    const y = Float32Array.from(x);
    let last = null;
    for (let i = 0; i < y.length; i++) {
      if (!gap[i]) {
        last = y[i];
        continue;
      }
      if (last !== null) y[i] = last;
    }
    // leading gaps have no prior good sample — backfill from the first good one so the array is
    // finite; those beats are dropped by gapBeats anyway.
    if (gap[0]) {
      let first = null;
      for (let i = 0; i < y.length && first === null; i++) if (!gap[i]) first = y[i];
      for (let i = 0; i < y.length && gap[i]; i++) y[i] = first !== null ? first : 0;
    }
    return y;
  }
  // Indices of beats whose defining span [foot−2, peak+2] overlaps ANY rejected sentinel sample.
  // Those beats' timing rests on held values, so they are dropped rather than reported.
  // ── TIME-DISCONTINUITY INTERVALS (O2RING-PPG-GAP §2) ────────────────────────────────────────────
  //  `rec.gap` above is the SENTINEL mask — samples the device marked invalid. It says nothing about
  //  MISSING TIME, and until the capture host learned to record honest gaps there was none to find:
  //  the O2Ring's synthesized grid was contiguous by construction, so a lost BLE frame silently
  //  COMPRESSED the record instead of leaving a hole.
  //
  //  Now that the host advances the grid across a loss, `relSec` can genuinely jump — and an interval
  //  spanning that jump is NOT a measurement. Real time passed with no signal, so one or more beats
  //  may simply be absent; the foot-to-foot difference across the hole is the sum of an unknown number
  //  of true intervals. Left in, it reads as a large beat-to-beat excursion and INFLATES rMSSD — the
  //  exact fabrication the honest gap exists to prevent (measured: correcting a night's gaps without
  //  this exclusion moved rMSSD 59.9 → 70.9 ms, i.e. the wrong way).
  //
  //  So: drop the interval, never fill it — the same discipline as a 1-of-3 beat and a sentinel beat.
  //  Returns a boolean per INTERVAL i (between feet[i] and feet[i+1]), true when it straddles a jump.
  //  A step is a jump when it exceeds TIME_GAP_STEPS sample periods. Two is deliberately loose: a real
  //  loss is ≥ 5 samples (the host's 40 ms floor), while a healthy stream's steps are uniform to well
  //  under one period (Verity sensor-ns spread is ±370 ns on a 5.67 ms step), so nothing legitimate
  //  lands in between. O(n + beats) via a prefix count — no per-interval rescan.
  /* MULTINIGHT-CORPUS-FINDINGS §2 — an interval series is ALTERNATING, not autonomic, when its
     successive-difference dispersion exceeds its overall dispersion. Over a whole night that
     ordering is impossible physiologically: rMSSD measures beat-to-beat change, sdnnRobust the
     spread those beats live in, so rMSSD > sdnnRobust means consecutive intervals swing further
     than the distribution they are drawn from — the signature of a detector emitting short/long
     pairs (intermittent dicrotic-notch locking), not of a heart.

     Compared against `sdnnRobust` rather than `sdnn` on purpose: whole-record `sdnn` runs high on
     optical through SDANN/baseline-wander inflation, which would mask the very violation this
     looks for. Returns FALSE when either input is absent — a record too short for the robust
     median gets no verdict, because an absent comparand is not evidence of good shape. Pure, so
     the gate is testable without driving the whole analyze pipeline. */
  function hrvShapeViolates(rmssdMs, sdnnRobustMs) {
    if (rmssdMs == null || sdnnRobustMs == null) return false;
    if (!isFinite(rmssdMs) || !isFinite(sdnnRobustMs) || sdnnRobustMs <= 0) return false;
    return rmssdMs > sdnnRobustMs;
  }

  const TIME_GAP_STEPS = 2;
  function intervalsSpanningTimeGap(relSec, fs, feet, nIntervals) {
    const out = new Array(nIntervals).fill(false);
    if (!relSec || !feet || feet.length < 2 || !(fs > 0)) return out;
    const n = relSec.length;
    const maxStep = (TIME_GAP_STEPS * 1) / fs;
    // prefix[i] = number of discontinuities at or before sample i
    const prefix = new Int32Array(n);
    let run = 0;
    for (let i = 1; i < n; i++) {
      if (relSec[i] - relSec[i - 1] > maxStep) run++;
      prefix[i] = run;
    }
    if (run === 0) return out; // fast path: no jumps anywhere (every pre-fix file, and every Verity file)
    for (let k = 0; k < nIntervals; k++) {
      const a = feet[k],
        b = feet[k + 1];
      if (a == null || b == null) continue;
      const i0 = Math.max(0, Math.min(n - 1, Math.floor(a)));
      const i1 = Math.max(0, Math.min(n - 1, Math.ceil(b)));
      if (i1 > i0 && prefix[i1] > prefix[i0]) out[k] = true;
    }
    return out;
  }

  /* recording.coverage for a PPG recording — INTEGRATOR-GAP-AWARE-OVERLAP part 2.
     The SAME discontinuities `intervalsSpanningTimeGap` drops intervals across are the recording's
     session boundaries — a `relSec` jump is real time in which no signal arrived. That function
     answers "is THIS beat interval untrustworthy"; this one answers "where was this node actually
     recording", which is what a fusion denominator needs. One threshold (`TIME_GAP_STEPS`) governs
     both, deliberately: a hole big enough to invalidate an interval is a hole big enough to leave out
     of the recorded time, and two constants would eventually disagree.

     Verity is the worst offender in the corpus — 24 segments in a single night against the H10's 3 —
     and PpgDex declared none of them. Null when the stream is contiguous (every pre-capture-host file
     and every clean Verity file), so a clean export stays byte-identical. */
  function ppgCoverage(rec) {
    if (!rec || rec.t0Ms == null || !isFinite(rec.t0Ms)) return null;
    const relSec = rec.relSec,
      fs = rec.fs;
    if (!relSec || !relSec.length || !(fs > 0)) return null;
    const n = relSec.length,
      maxStep = TIME_GAP_STEPS / fs,
      base = relSec[0];
    const segs = [];
    let segStart = 0; // rel seconds from the first sample
    for (let i = 1; i < n; i++) {
      if (relSec[i] - relSec[i - 1] > maxStep) {
        segs.push([rec.t0Ms + segStart * 1000, rec.t0Ms + (relSec[i - 1] - base) * 1000]);
        segStart = relSec[i] - base;
      }
    }
    if (!segs.length) return null; // fast path: contiguous ⇒ no claim to make
    segs.push([rec.t0Ms + segStart * 1000, rec.t0Ms + (relSec[n - 1] - base) * 1000]);
    return typeof DexExport !== 'undefined' && DexExport && DexExport.coverageFromSegments ? DexExport.coverageFromSegments(segs, { source: 'ble-dropout' }) : null;
  }

  // FOOT-ANCHORED, not foot→peak-spanning (O2RING-PPG-GAP §3). The old window ran the WHOLE upstroke,
  // `[min(foot,peak)−2, max(foot,peak)+2]` — 12–25 samples at 125.7 Hz — so a sentinel ANYWHERE in the
  // systolic rise condemned the beat. On a real O2Ring night (2026-07-20, finger, paired H10 ECG) the
  // wide window deleted 727 of ~3350 detected beats over 63 min and drove a 34.2 % correctRR fill rate;
  // the foot-anchored window below dropped that to 12 % with ZERO beats lost — validated against paired
  // chest ECG (see the brief). What actually rests on held samples is the TIMING POINT, and for PPI that
  // is the foot alone: the intersecting-tangent crossing is built from the trough and the steepest rise
  // around it and reads nothing near the peak. A sentinel by the peak can spoil MORPHOLOGY (graded
  // separately, per-site) but cannot move the foot. So gate on a tight window about the foot.
  // ±3 samples (~24 ms) is deliberate: it covers the tangent's own support without reaching the peak.
  // Do NOT widen past ±5 — retention falls off a cliff (≈77 % at ±10) for no honesty gain.
  const GAP_FOOT_SPAN = 3;
  function gapBeats(peaks, feet, gap) {
    const bad = new Set();
    for (let k = 0; k < peaks.length; k++) {
      const p = peaks[k];
      const f = feet && feet[k] != null ? Math.floor(feet[k]) : p;
      const lo = Math.max(0, f - GAP_FOOT_SPAN),
        hi = Math.min(gap.length - 1, f + GAP_FOOT_SPAN);
      for (let i = lo; i <= hi; i++)
        if (gap[i]) {
          bad.add(k);
          break;
        }
    }
    return bad;
  }

  function pearson(a, b) {
    const n = Math.min(a.length, b.length);
    const ma = mean(a),
      mb = mean(b);
    let sa = 0,
      sb = 0,
      sab = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - ma,
        db = b[i] - mb;
      sa += da * da;
      sb += db * db;
      sab += da * db;
    }
    const den = Math.sqrt(sa * sb) || 1e-9;
    return sab / den;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PER-SECOND ARTIFACT CONFIDENCE  (TCH-FUSED-ROBUST-HAT-2026-07-14)
  //  Byte-for-byte MIRROR of ECGDSP.beatConfidence — signal-agnostic (feet/beats + per-beat SQI →
  //  per-second trust c = density_trust × quality_trust, AND-ed via min for AF-safety). For the
  //  Verity corner it catches any residual PPG over-detection (e.g. diastolic-notch doubling the
  //  optical-refractory fix leaves) exactly as it catches the ECG spurious-QRS burst: a window that
  //  is BOTH a beat-density upper-outlier (vs the record's own median) AND SQI-depressed (below the
  //  record's own median SQI) → c→0; high rate with clean beats (real tachycardia) keeps SQI high →
  //  c=1. Self-calibrating; only universal constants. peaks: foot/beat sample indices · sqi: beatSQI.
  // ════════════════════════════════════════════════════════════════════════
  function beatConfidence(peaks, sqi, fs, t0Ms, winSec) {
    winSec = winSec || 60;
    const n = peaks.length,
      out = new Map();
    const t0 = t0Ms || 0;
    const secAbs = (k) => Math.floor((t0 + (peaks[k] / fs) * 1000) / 1000);
    if (n < 20) {
      for (let k = 0; k < n; k++) out.set(secAbs(k), 1);
      return out;
    } // too short to calibrate
    const s0 = secAbs(0),
      s1 = secAbs(n - 1),
      S = s1 - s0 + 1;
    if (S < 1) return out;
    const cnt = new Float64Array(S),
      qsum = new Float64Array(S);
    for (let k = 0; k < n; k++) {
      const s = secAbs(k) - s0;
      if (s >= 0 && s < S) {
        cnt[s]++;
        qsum[s] += sqi && Number.isFinite(sqi[k]) ? sqi[k] : 1;
      }
    }
    const half = Math.max(1, Math.round(winSec / 2));
    const winCnt = new Float64Array(S),
      winSqi = new Float64Array(S);
    let cAcc = 0,
      qAcc = 0,
      lo = 0,
      hi = -1;
    for (let i = 0; i < S; i++) {
      const a = Math.max(0, i - half),
        b = Math.min(S - 1, i + half);
      while (hi < b) {
        hi++;
        cAcc += cnt[hi];
        qAcc += qsum[hi];
      }
      while (lo < a) {
        cAcc -= cnt[lo];
        qAcc -= qsum[lo];
        lo++;
      }
      winCnt[i] = cAcc;
      winSqi[i] = cAcc > 0 ? qAcc / cAcc : 0;
    }
    const active = [];
    for (let i = 0; i < S; i++) if (winCnt[i] > 0) active.push(i);
    const medOf = (idx) => {
      const a = idx.map((i) => winCnt[i]).sort((x, y) => x - y),
        m = a.length;
      return m ? (m % 2 ? a[(m - 1) / 2] : (a[m / 2 - 1] + a[m / 2]) / 2) : 0;
    };
    const medQ = (idx) => {
      const a = idx.map((i) => winSqi[i]).sort((x, y) => x - y),
        m = a.length;
      return m ? (m % 2 ? a[(m - 1) / 2] : (a[m / 2 - 1] + a[m / 2]) / 2) : 0;
    };
    const cMed = medOf(active),
      qMed = medQ(active);
    const cAbs = active.map((i) => Math.abs(winCnt[i] - cMed)).sort((x, y) => x - y);
    const qAbs = active.map((i) => Math.abs(winSqi[i] - qMed)).sort((x, y) => x - y);
    const madC = 1.4826 * (cAbs.length ? cAbs[cAbs.length >> 1] : 0) || 1;
    const madQ = 1.4826 * (qAbs.length ? qAbs[qAbs.length >> 1] : 0) || 1e-6;
    const C = 6; // universal redescending cut (Tukey-style)
    const trust = (z) => (z <= 0 ? 1 : z >= C ? 0 : (1 - (z / C) * (z / C)) * (1 - (z / C) * (z / C)));
    for (let i = 0; i < S; i++) {
      if (winCnt[i] <= 0) continue;
      const sD = Math.max(0, (winCnt[i] - cMed) / madC); // density upper-outlier suspicion
      const sQ = Math.max(0, (qMed - winSqi[i]) / madQ); // SQI-depressed-below-median suspicion
      out.set(s0 + i, trust(Math.min(sD, sQ))); // AF-safe AND: both cues must fire
    }
    return out;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PPI + correction (Malik-style) and HRV suite
  // ════════════════════════════════════════════════════════════════════════
  // Foot-spine displacement margin, in PERCENTAGE POINTS of correctRR() correction rate. The peak spine
  // replaces the (preferred) foot spine ONLY when it needs at least this much LESS Malik repair.
  //
  // Why the correction rate and not a "do the two medians agree" threshold: an agreement test detects
  // only THAT the halves disagree, never WHICH one is right — and both directions occur in the real
  // corpus (2026-06-30 needs peaks, 2026-06-15 needs feet, and both look like "disagreement"). An
  // agreement cutoff therefore has to be wrong on one of them; a 0.90 cutoff duly regressed 2026-06-15
  // (correct feet at 49.1 bpm → wrong peaks at 57.5). The correction rate is a PHYSIOLOGICAL arbiter
  // instead: correctRR rejects impossible/outlier intervals, so a coherent beat series needs few repairs
  // while a doubled/corrupted one needs many. Measured on the real trio corpus the separation is stark —
  // the good half needs 1–29% correction, the corrupted half 43–98%.
  //
  // The MARGIN (not a bare `<`) protects clean records: there both spines need the SAME repair (3.6% vs
  // 3.6%), and a hair's-width float difference must not flip the spine and churn the committed fixture.
  // 10 pp is far below the observed corrupted-vs-good gap (≥ 35 pp) and far above clean-record noise (0 pp).
  const PPI_SPINE_MARGIN_PP = 10;
  function buildPPI(footSec) {
    const rr = [],
      tt = [];
    for (let i = 1; i < footSec.length; i++) {
      const d = (footSec[i] - footSec[i - 1]) * 1000;
      rr.push(d);
      tt.push(footSec[i]);
    }
    return { rr, tt };
  }
  function correctRR(rr, tt) {
    // reject physiologically impossible + local-median outliers; interpolate.
    // Gate against a robust running median of ACCEPTED intervals (not the
    // immediately-previous value, which can itself be a false detection and
    // cascade the whole series to a constant).
    const out = [],
      ot = [],
      flags = [];
    let nCorr = 0;
    // robust global baseline from in-range intervals
    const inRange = rr.filter((v) => v >= 300 && v <= 2000);
    const globalMed = inRange.length ? median(inRange) : 800;
    const accepted = []; // recent accepted intervals (window)
    const localRef = () => (accepted.length ? median(accepted.slice(-7)) : globalMed);
    // PPI artifact threshold, deliberately looser than the 0.20 Malik rule ECGDex/
    // PulseDex apply to ECG/RR: optical pulse-arrival-time jitter is larger than
    // R-peak jitter, so 0.20 would over-reject clean PPG beats. Per-signal by
    // design (WP-D audit / DEX-DSP-AUDIT-BEATS-ARTIFACT.md), not accidental drift.
    const PPI_ECTOPY_THR = 0.3;
    /* ── THE REFERENCE MUST BE ABLE TO RE-LOCK (PPGDEX-CORRECTRR-LOCKIN, 2026-08-13) ──────────────
       Only an ACCEPTED interval updates `accepted`, and a rejected one is replaced by the reference
       itself. That is a FEEDBACK LOOP: if `ref` ever drifts — one motion burst is enough — every
       CORRECT interval can sit outside the 30 % band, so it is rejected, replaced by the stale ref,
       and `accepted` never gains a true value. The reference then cannot recover and the series
       emits a CONSTANT for as long as the condition holds.

       Measured on the real corpus: a 25-minute run locked at 786 ms while the true interval was
       1143 ms — 1143/786 = 1.454, and the epochs reported 76 bpm against ECG's 52.4 and the ring's
       52, with rmssd and sdnn rounding to 0 because every value was the same substitute. It affects
       ~2.6 % of epochs across 29 of 49 nights, and PpgDex is the outlier in 98 % of three-way
       adjudicated disagreements.

       THE FIX IS TO NOTICE THE LOOP, NOT TO WIDEN THE BAND. A long run of consecutive rejections is
       evidence about the REFERENCE, not about the data: real ectopy is sporadic, and an interval
       series does not legitimately go 30 % off its own median for minutes at a time. After
       `RESEED_AFTER` consecutive rejections the reference is re-seeded from the RAW local intervals
       — the same robust median, computed over what actually arrived rather than over what the old
       reference was willing to accept — and `accepted` is re-primed so the normal path resumes.
       Widening PPI_ECTOPY_THR instead would let genuine ectopy through everywhere to fix a fault
       that only occurs after the reference is already wrong. */
    /* 8 is a middle value, NOT a tuned one: sweeping it 4 / 8 / 16 / 32 on a real night moves the
       mean absolute error against the simultaneous ECG by 2.30 / 2.31 / 2.34 / 2.37 bpm, with zero
       epochs made worse at any setting. An 8x span that changes the answer by 3 % is not a knife
       edge, so this does not need calibrating per corpus. */
    const RESEED_AFTER = 8; // consecutive rejections that indict the REFERENCE rather than the data
    let runBad = 0;
    for (let i = 0; i < rr.length; i++) {
      let v = rr[i];
      let ref = localRef();
      if (runBad >= RESEED_AFTER) {
        // Re-seed from the RAW neighbourhood, the values the old reference kept refusing.
        const lo = Math.max(0, i - 6);
        const raw = [];
        for (let k = lo; k <= i && k < rr.length; k++) if (rr[k] >= 300 && rr[k] <= 2000) raw.push(rr[k]);
        if (raw.length) {
          ref = median(raw);
          accepted.length = 0;
          accepted.push(ref); // re-prime so localRef() returns the recovered value, not the stale one
        }
        runBad = 0;
      }
      let bad = false;
      if (v < 300 || v > 2000) bad = true;
      else if (Math.abs(v - ref) / ref > PPI_ECTOPY_THR) bad = true; // >30% off the local median
      if (bad) {
        v = ref;
        nCorr++;
        runBad++;
        flags.push(1);
      } else {
        accepted.push(v);
        runBad = 0;
        flags.push(0);
      }
      out.push(v);
      ot.push(tt[i]);
    }
    return { nn: out, tt: ot, nCorr, flags };
  }
  // CVHR — Cyclic Variation of Heart Rate (Hayano), the autonomic cardiac correlate of
  // apnea/hypopnea recovery. OXYDEX-PULSE-RESOURCING §Phase 4: a FINGER PPG capture is the O2Ring's
  // own single-channel pleth, so its whole-record NN series can carry a real CVHR the ring's 1 Hz
  // pulse cannot. This is a FAITHFUL port of the audited ECGDex `detectCVHR(nn, tt)` (ecgdex-dsp.js) —
  // SAME apnea-band (~20–45 s ≈ 0.022–0.05 Hz) moving-average band-pass, SAME envelope gate + dip→rebound
  // detector + events-per-hour index. Reusing the ECGDex algorithm (not re-deriving one) is deliberate:
  // the Integrator corroborates finger CVHR against ECGDex cardiac CVHR, so they MUST share a method.
  // `nn` in ms, `tt` cumulative times in SECONDS (buildPPI/correctRR units). Returns { index, events }.
  /* ── §2.6: NOT MEASURABLE IS NOT ZERO ────────────────────────────────────────────────────────
     Both guards below used to return `index: 0`, and `0` is not free to mean "could not measure"
     here — this file spends it explicitly at the export site (§"cvhrIndex=0 = none detected"), and
     the suite asserts that meaning on a flat-HR record that DID resolve. One value cannot carry
     both "the detector looked and found no cyclic variation" and "the detector could not look",
     and the second silently reads as the first: a reassuring finding on a record too short to have
     produced one.
     Measured 2026-08-18: latent on real data (0 of 44 corpus nights trip it, because cvhrFromNN
     runs once per RECORD, not per epoch) but ACTIVE in the committed fixtures —
     `synthetic_ppgdex_inverted_golden.node-export.json` is 39.99 s, so `M = 39 < 120`, and its
     `cvhrIndex: 0` is this guard's fabricated value, byte-pinned and enforced by GATE-B.
     `events` stays `[]`: the event list genuinely is empty, and a list's absence is not a number
     awaiting measurement. Only the INDEX becomes null. */
  // DEEP-AUDIT-VI F10 — upper bound on a beat-time span before a consumer sizes arrays from it. TWO
  // consumers: `cvhrFromNN` below (the port of ECGDex detectCVHR that shipped WITHOUT the #1800 guard)
  // and the `beatConfidence` call in analyze(), which is fed TIME-derived pseudo-indices
  // (`round(footSec·fs)`) — so unlike the ECG original it is NOT bounded by beat count. `tt`/`footSec`
  // are gap-ACCUMULATED, so one mid-file sensor-clock rebase (+2792 days, the real H10 shape ECGDex
  // measured) survives parsePPG into relSec — hostAxis refuses at ±50000 ppm, so the raw jump stays —
  // and analyze() died allocating span-sized arrays (RangeError at 7.7 GB; >50 GB before OOM in
  // #1800), killing the whole night's export. 48 h, as ECGDex `CVHR_MAX_SPAN_S`: over twice any real
  // recording, so a gappy night still fits. Refusal ⇒ null with a reason, never a fabricated 0.
  const PPG_MAX_SPAN_S = 48 * 3600;
  /* `activeSec` (OPTIONAL, added LAST for back-compat per CLAUDE.md §🧪) is the beat-COVERED time the
     caller measured — inter-beat deltas ≤ PPG_CVHR_GAP_S summed. When it is > 0 it is the index's
     denominator; absent or 0 falls back to the wall span, which is exact for a gap-free series.
     Ports the ECGDex fix of the same defect (DEEP-AUDIT-VI F3/F10): both nodes now count events per
     hour OF OBSERVED RECORDING, so the two `apnea.cvhrIndex` values the Integrator corroborates
     against each other are on the same basis. Divide one by wall span and the other by covered time
     and the corroboration measures the dropouts, not the physiology. */
  function cvhrFromNN(nn, tt, activeSec) {
    const N = nn.length;
    if (N < 60 || !tt || tt.length !== N) return { events: [], index: null };
    const tEnd = tt[N - 1];
    // F10 — refuse an implausible SPAN before `M` sizes six arrays from it (see PPG_MAX_SPAN_S).
    if (!isFinite(tEnd) || tEnd > PPG_MAX_SPAN_S) return { events: [], index: null, reason: 'implausible-span' };
    const M = Math.floor(tEnd);
    if (M < 120) return { events: [], index: null }; // < 2 min → no apnea-band train can be RESOLVED, so no index exists
    const hr = new Float64Array(M);
    let j = 0;
    for (let s = 0; s < M; s++) {
      while (j < N - 1 && tt[j + 1] < s) j++;
      hr[s] = 60000 / nn[Math.min(j, N - 1)];
    }
    const sm = new Float64Array(M); // 5 s smoothing
    for (let s = 0; s < M; s++) {
      let a = 0,
        c = 0;
      for (let k = -2; k <= 2; k++) {
        const u = s + k;
        if (u >= 0 && u < M) {
          a += hr[u];
          c++;
        }
      }
      sm[s] = a / c;
    }
    // apnea-band band-pass: wide MA (45 s) removes LF/circadian trend, narrow (9 s) removes RSA/HF.
    const ma = (src, half) => {
      const o2 = new Float64Array(M);
      for (let s = 0; s < M; s++) {
        let a = 0,
          n = 0;
        for (let k = -half; k <= half; k++) {
          const u = s + k;
          if (u >= 0 && u < M) {
            a += src[u];
            n++;
          }
        }
        o2[s] = a / n;
      }
      return o2;
    };
    const lo = ma(sm, 23),
      hiCut = ma(sm, 4);
    const res = new Float64Array(M);
    for (let s = 0; s < M; s++) res[s] = hiCut[s] - lo[s];
    const env = new Float64Array(M); // envelope → only sustained oscillation trains count
    for (let s = 0; s < M; s++) {
      let a = 0,
        n = 0;
      for (let k = -12; k <= 12; k++) {
        const u = s + k;
        if (u >= 0 && u < M) {
          a += Math.abs(res[u]);
          n++;
        }
      }
      env[s] = a / n;
    }
    const ENV_ON = 2.6; // bpm — sustained-oscillation gate (matches ECGDex)
    const events = [];
    let lastT = -100;
    for (let s = 8; s < M - 8; s++) {
      if (env[s] < ENV_ON) continue;
      if (res[s] < res[s - 1] && res[s] <= res[s + 1] && res[s] < -2.4) {
        let pk = -Infinity,
          pkAt = -1;
        for (let u = s + 8; u < Math.min(M, s + 48); u++) {
          if (res[u] > pk) {
            pk = res[u];
            pkAt = u;
          }
        }
        const amp = pk - res[s];
        const period = pkAt - s;
        if (amp >= 5 && period >= 14 && period <= 46 && s - lastT > 14) {
          events.push({ sec: s, ampBpm: +amp.toFixed(1), periodSec: period });
          lastT = s;
        }
      }
    }
    /* CVHR index = events per hour OF OBSERVED RECORDING (DEEP-AUDIT-VI F3, ported from ECGDex).
       This divided by the wall span `tEnd`, so sensor DEAD TIME sat in the denominator of a metric
       the Integrator corroborates against ECGDex's — and the Verity is the fleet's worst offender for
       dropouts (24 segments in one corpus night against the H10's 3), so the PPG leg carried the
       larger error of the two. Events can only arise in covered seconds: the 1 Hz resample above
       holds the last beat's HR flat across a hole, so `res` decays to 0 there and the ENV_ON gate
       stays shut. `denomSec` is returned so a consumer can see the basis instead of inferring it. */
    const denomSec = activeSec > 0 ? activeSec : tEnd;
    const hours = denomSec / 3600;
    const index = hours > 0 ? +(events.length / hours).toFixed(1) : 0;
    return { events, index, denomSec };
  }
  // `omit` (OPTIONAL, added LAST for back-compat per CLAUDE.md §🧪) marks intervals that are NOT
  // MEASUREMENTS AT ALL — currently only those straddling a time discontinuity (O2RING-PPG-GAP §2).
  // That is a stronger statement than `cleanMask`, which merely says an interval is too noisy to
  // trust for beat-to-beat work: a NN measured across lost time spans an unknown number of absent
  // beats, so it must leave the whole-record dispersion too, not just rMSSD. Omitting it is not a
  // quality judgement, it is declining to invent a number. Absent/empty ⇒ byte-identical behaviour.
  function timeDomain(nn, cleanMask, omit) {
    if (nn.length < 2) return null;
    const keep = omit ? nn.filter((_, i) => !omit[i]) : nn;
    const base = keep.length >= 2 ? keep : nn; // never let the omission empty the record
    const meanRR = mean(base),
      sdnn = std(base); // dispersion: over ALL accepted NN (whole-record), minus non-measurements
    // §4 (PPGDEX-BEAT-DETECTION-PERF): the beat-to-beat metrics (rMSSD/pNN50) are computed
    // over adjacent HIGH-SQI CLEAN pairs only, so sub-ectopy-threshold optical PAT jitter +
    // gap boundaries don't inflate them (the whole-record 137 ms → truth). The ectopy/gap
    // band (correctRR PPI_ECTOPY_THR) stays loose to avoid over-rejecting; this is the SEPARATE
    // robust jitter pass the brief asks for. No mask (epoch/back-compat) → all adjacent pairs.
    let sumSq = 0,
      cnt = 0,
      nn50 = 0;
    for (let i = 1; i < nn.length; i++) {
      if (cleanMask && !(cleanMask[i - 1] && cleanMask[i])) continue;
      const d = nn[i] - nn[i - 1];
      sumSq += d * d;
      cnt++;
      if (Math.abs(d) > 50) nn50++;
    }
    if (cnt < 1) {
      for (let i = 1; i < nn.length; i++) {
        const d = nn[i] - nn[i - 1];
        sumSq += d * d;
        cnt++;
        if (Math.abs(d) > 50) nn50++;
      }
    } // no clean pair → fall back
    const rmssd = Math.sqrt(sumSq / cnt),
      pnn50 = (100 * nn50) / cnt;
    const hr = 60000 / meanRR;
    // triangular index
    const bins = {};
    for (const v of nn) {
      const b = Math.round(v / 7.8125);
      bins[b] = (bins[b] || 0) + 1;
    }
    let mx = 0;
    for (const k in bins) if (bins[k] > mx) mx = bins[k];
    const triIdx = mx ? nn.length / mx : null;
    return { meanRR: Math.round(meanRR), sdnn: r1(sdnn), rmssd: r1(rmssd), pnn50: r1(pnn50), hr: Math.round(hr), lnRMSSD: r2(Math.log(rmssd)), triIdx: triIdx ? r1(triIdx) : null };
  }
  function poincare(nn, cleanMask) {
    if (nn.length < 3) return null;
    // §4: SD1 (≈ short-term beat-to-beat) from the clean adjacent-pair successive
    // differences; SD2 keeps the whole-record SDNN identity. Mask absent → all pairs.
    const d = [];
    for (let i = 1; i < nn.length; i++) {
      if (cleanMask && !(cleanMask[i - 1] && cleanMask[i])) continue;
      d.push(nn[i] - nn[i - 1]);
    }
    if (d.length < 2) {
      d.length = 0;
      for (let i = 1; i < nn.length; i++) d.push(nn[i] - nn[i - 1]);
    } // fallback
    const sd1 = Math.sqrt(0.5) * std(d);
    const sdnn = std(nn);
    const sd2 = Math.sqrt(Math.max(0, 2 * sdnn * sdnn - 0.5 * std(d) * std(d)));
    return { sd1: r1(sd1), sd2: r1(sd2), sd1sd2: r2(sd1 / (sd2 || 1)), ellArea: Math.round(Math.PI * sd1 * sd2) };
  }
  // Lomb–Scargle on irregular RR for frequency-domain HRV
  function lombScargle(tt, nn) {
    if (nn.length < 8) return null;
    const t = tt.map((x) => x);
    const y = nn.slice();
    // Linear detrend (Task Force) — parity with ECGDex/PulseDex; stops slow drift
    // leaking into VLF/LF. Was mean-only before 2026-06-21 (external-review WP-C).
    const N = y.length;
    let st = 0,
      sy = 0,
      stt = 0,
      sty = 0;
    for (let i = 0; i < N; i++) {
      st += t[i];
      sy += y[i];
      stt += t[i] * t[i];
      sty += t[i] * y[i];
    }
    const den = N * stt - st * st || 1e-9;
    const slope = (N * sty - st * sy) / den,
      icpt = (sy - slope * st) / N;
    for (let i = 0; i < N; i++) y[i] -= slope * t[i] + icpt;
    const bands = { vlf: [0.003, 0.04], lf: [0.04, 0.15], hf: [0.15, 0.4] };
    const fmin = 0.003,
      fmax = 0.4,
      df = 0.002;
    /* DEEP-AUDIT-II §3.1 — Parseval calibrates against the FULL spectral support, not the band.
       `variance / total` with `total` summed over [fmin, fmax] only asserts that the in-band integral
       equals the WHOLE signal variance — true only when no power sits outside the band. When it does,
       the bands absorb it one-directionally. PpgDex inherited this from the same audit doc that
       prescribed it for ECGDex/PulseDex and then recommended PpgDex adopt it, which is how one defect
       reached three nodes.
       The calibration grid now runs to the beat series' mean-Nyquist, 1/(2·meanPPI), while the
       REPORTED bands keep their Task-Force ranges. `df` here is a fixed 0.002 Hz, so extending the
       ceiling leaves spectral resolution untouched by construction. */
    const _meanPPIs = (function () {
      let s2 = 0;
      for (let i2 = 0; i2 < N; i2++) s2 += nn[i2];
      return N ? s2 / N / 1000 : 0;
    })();
    const fNyq = _meanPPIs > 0 ? 1 / (2 * _meanPPIs) : fmax;
    const fCal = Math.max(fmax, Math.min(fNyq, 2));
    let vlf = 0,
      hfPeakP = 0,
      hfPeakF = null,
      lf = 0,
      hf = 0,
      totalFull = 0; // full-support total — the Parseval denominator
    for (let f = fmin; f <= fCal; f += df) {
      const w = 2 * Math.PI * f;
      let ss = 0,
        sc = 0;
      for (let i = 0; i < t.length; i++) {
        ss += Math.sin(2 * w * t[i]);
        sc += Math.cos(2 * w * t[i]);
      }
      const tau = Math.atan2(ss, sc) / (2 * w);
      let c1 = 0,
        c2 = 0,
        s1 = 0,
        s2 = 0;
      for (let i = 0; i < t.length; i++) {
        const wt = w * (t[i] - tau);
        const co = Math.cos(wt),
          si = Math.sin(wt);
        c1 += y[i] * co;
        c2 += co * co;
        s1 += y[i] * si;
        s2 += si * si;
      }
      const P = 0.5 * ((c1 * c1) / (c2 || 1e-9) + (s1 * s1) / (s2 || 1e-9));
      const pw = P * df;
      totalFull += pw; // every evaluated bin — the Parseval denominator
      // The band arms are explicit ranges, so they stay bounded without further guarding.
      if (f >= bands.vlf[0] && f < bands.vlf[1]) vlf += pw;
      else if (f >= bands.lf[0] && f < bands.lf[1]) lf += pw;
      else if (f >= bands.hf[0] && f < bands.hf[1]) {
        hf += pw;
        /* ENGINE-VERIFICATION §1.6 link 1 — RETAIN THE HF ARGMAX, not just its power.
           This loop accumulated band power and threw the frequency away, so `respRate` was null on
           every PpgDex export while the modulation was demonstrably present: executed on synthetic
           135 Hz PPG with RSA planted at 0.25 Hz, respRate came back null on all 3 epochs with
           hf = 5758 / 5729 / 5657 ms². The information was measured and discarded at the last step.
           Argmax on the RAW periodogram bin `P` — deliberately not on `pw = P * df`, nor on the
           Parseval-scaled band. `df` is constant across bins and `scF` is a single scalar applied
           afterwards, so neither can change WHICH bin is largest; comparing pre-scaling keeps the peak
           independent of a calibration whose job is to make POWERS comparable, not to rank bins. */
        if (P > hfPeakP) {
          hfPeakP = P;
          hfPeakF = f;
        }
      }
    }
    let total = vlf + lf + hf;
    // Parseval calibration — ∫PSD = signal variance, so band powers land in ms²
    // and are comparable to ECGDex/PulseDex (external-review WP-C). Ratios
    // (lfhf/lfnu/hfnu) are scale-invariant, so they are unchanged by this.
    let variance = 0;
    for (let i = 0; i < N; i++) variance += y[i] * y[i];
    variance /= N;
    const scF = totalFull > 0 ? variance / totalFull : 1; // §3.1 — full support, not the band
    vlf *= scF;
    lf *= scF;
    hf *= scF;
    total *= scF;
    const lfhf = hf > 0 ? lf / hf : null;
    const lfnu = lf + hf > 0 ? (100 * lf) / (lf + hf) : null,
      hfnu = lf + hf > 0 ? (100 * hf) / (lf + hf) : null;
    /* Task-Force identity: round the BANDS first and define totalPower as their sum, so
       vlf+lf+hf == totalPower holds EXACTLY rather than to within rounding — the same treatment
       ecgdex-dsp.js and pulsedex-dsp.js already apply. Rounding a separately-accumulated `total`
       could differ by 1 from the sum of the rounded parts, which is what it just did. */
    const _v = Math.round(vlf),
      _l = Math.round(lf),
      _h = Math.round(hf);
    return {
      vlf: _v,
      lf: _l,
      hf: _h,
      totalPower: _v + _l + _h,
      lfhf: lfhf != null ? r2(lfhf) : null,
      lfnu: lfnu != null ? Math.round(lfnu) : null,
      hfnu: hfnu != null ? Math.round(hfnu) : null,
      /* §1.6 link 1 — the HF peak as a RESPIRATION RATE, breaths/min. Same method and same name as
         ECGDex's (`RSA (HF-peak of RR spectrum)`), so the Integrator's existing
         `summary.respRateBrpm = _hf.respRate` branch picks PpgDex up with no consumer change — link 3
         was already in place and had nothing to read. null when the HF band held no bin at all. */
      respRate: hfPeakF != null ? r2(hfPeakF * 60) : null,
      respRateMethod: hfPeakF != null ? 'RSA (HF-peak of RR spectrum)' : null
    };
  }
  function dfaAlpha1(nn) {
    if (nn.length < 50) return null;
    const N = nn.length;
    const m = mean(nn);
    const y = new Float64Array(N);
    let acc = 0;
    for (let i = 0; i < N; i++) {
      acc += nn[i] - m;
      y[i] = acc;
    }
    const scales = [];
    for (let s = 4; s <= 16; s++) scales.push(s);
    const xs = [],
      ys = [];
    for (const s of scales) {
      const nWin = Math.floor(N / s);
      if (nWin < 1) continue;
      let F = 0;
      for (let w = 0; w < nWin; w++) {
        const o = w * s;
        let sx = 0,
          sy = 0,
          sxx = 0,
          sxy = 0;
        for (let i = 0; i < s; i++) {
          sx += i;
          sy += y[o + i];
          sxx += i * i;
          sxy += i * y[o + i];
        }
        const den = s * sxx - sx * sx || 1e-9;
        const b = (s * sxy - sx * sy) / den,
          a = (sy - b * sx) / s;
        let e = 0;
        for (let i = 0; i < s; i++) {
          const r = y[o + i] - (a + b * i);
          e += r * r;
        }
        F += e;
      }
      F = Math.sqrt(F / (nWin * s));
      xs.push(Math.log(s));
      ys.push(Math.log(F || 1e-9));
    }
    // slope
    const mx = mean(xs),
      myy = mean(ys);
    let num = 0,
      den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - myy);
      den += (xs[i] - mx) * (xs[i] - mx);
    }
    return den ? r2(num / den) : null;
  }
  function sampEn(nn, m, r) {
    m = m || 2;
    let N = nn.length;
    if (N < 60) return null;
    const sd = std(nn);
    const tol = (r || 0.2) * sd;
    // O(N²) pair-counting CAP — mirror pulsedex-dsp.js MAXN (PPGDEX-FOLLOWUPS §4 / SYNTH-TEXTURE-FOLLOWUPS §2).
    // analyze() calls this on the WHOLE corrected interval series. Deterministic uniform decimation to MAXN
    // preserves the interval distribution; tol stays scaled to the ORIGINAL SD (computed above,
    // pre-decimation), matching PulseDex.
    //
    // The "FUTURE caller that hands SampEn a full overnight *_PPG.txt" this cap was written for has
    // ARRIVED: tools/trio-batch.mjs runs analyze() over whole nights. A CPU profile of one real night
    // (2026-07-27, 2.86 M samples) put **76.7 % of the entire PpgDex runtime inside this one function**
    // — 45.8 s of 59.7 s — because the cap still leaves N = 20 000, i.e. ~10⁹ comparisons.
    const MAXN = 20000;
    if (N > MAXN) {
      const stride = Math.ceil(N / MAXN),
        dec = [];
      for (let i = 0; i < N; i += stride) dec.push(nn[i]);
      nn = dec;
      N = nn.length;
    }
    /* countPairs — B = phi(m) and A = phi(m+1) in ONE pass, with an EXACT prune. Not an approximation:
       it returns the same integers the nested-loop form did, verified against it on 18 966 real H10 RR
       intervals at N = 2 000 / 6 000 / 12 000 / 18 966 (identical B and A at every size, 7.8–8.7× faster).

       (1) SORT-PRUNE. A Chebyshev match needs EVERY k within tol, so |nn[i]−nn[j]| <= tol at k=0 is a
           NECESSARY condition for a match. Walking the indices ordered by nn[index] makes the only
           possible partners of i a CONTIGUOUS run, so the scan can `break` at the first j beyond tol —
           every pair skipped provably fails. On a physiological interval series with tol = 0.2·SD the
           overwhelming majority of pairs fail exactly there, which is where the speedup comes from.
       (2) ONE PASS FOR BOTH. A pair matching at m+1 necessarily matches at m, and m+1's index range is a
           subset of m's, so A is counted as a refinement of B instead of walking every pair a second time.

       The single index valid for B but not for A (N−m−1) is counted in its own small pass, which is why
       the ranges below are not off by one. */
    function countPairs() {
      const nA = N - m - 1, // valid indices for phi(m+1)
        nB = N - m; // valid indices for phi(m)
      let A = 0,
        B = 0;
      if (nA > 0) {
        const ord = new Array(nA);
        for (let i = 0; i < nA; i++) ord[i] = i;
        ord.sort(function (x, y) {
          return nn[x] - nn[y];
        });
        for (let a = 0; a < nA; a++) {
          const i = ord[a];
          for (let b = a + 1; b < nA; b++) {
            const j = ord[b];
            if (nn[j] - nn[i] > tol) break; // ordered ⇒ every later j is further still
            let ok = true;
            for (let k = 1; k < m; k++) {
              if (Math.abs(nn[i + k] - nn[j + k]) > tol) {
                ok = false;
                break;
              }
            }
            if (!ok) continue;
            B++;
            if (Math.abs(nn[i + m] - nn[j + m]) <= tol) A++;
          }
        }
      }
      const t = nB - 1; // the index B has and A does not
      for (let j = 0; j < t; j++) {
        let ok = true;
        for (let k = 0; k < m; k++) {
          if (Math.abs(nn[t + k] - nn[j + k]) > tol) {
            ok = false;
            break;
          }
        }
        if (ok) B++;
      }
      return { A: A, B: B };
    }
    const pairs = countPairs(),
      B = pairs.B,
      A = pairs.A;
    if (!B || !A) return null;
    return r2(-Math.log(A / B));
  }

  // ════════════════════════════════════════════════════════════════════════
  //  MOTION GATE  — ACC + GYRO → per-time motion index (0..1)
  // ════════════════════════════════════════════════════════════════════════
  // ── Column indices come from the HEADER, never from fixed positions ──────────────────────────────
  // Layouts legitimately vary and will keep varying. Our capture host emitted an extra
  // `timestamp [ms]` column before 2026-07-18 11:43 and not after; Polar Sensor Logger's own PPG
  // header reads `channel 0..2` where ours once read `ppg0..2`; and per-stream RATE SELECTION means
  // more variants are expected, not exceptional. A fixed index silently SHIFTS when a column appears:
  // measured on 478 real pre-11:43 files, `x` received the millisecond value, `y` received true X,
  // `z` received true Y, and true Z was discarded — with no error anywhere.
  function xyzColsFromHeader(headerLine) {
    var p = String(headerLine || '').split(';');
    var idx = { x: -1, y: -1, z: -1, ns: -1, phone: -1 };
    for (var i = 0; i < p.length; i++) {
      var h = p[i].trim().toLowerCase();
      if (/^x(\s|\[|$)/.test(h)) idx.x = i;
      else if (/^y(\s|\[|$)/.test(h)) idx.y = i;
      else if (/^z(\s|\[|$)/.test(h)) idx.z = i;
      else if (/sensor\s+timestamp/.test(h)) idx.ns = i;
      else if (/phone\s+timestamp/.test(h)) idx.phone = i;
    }
    return idx.x >= 0 && idx.y >= 0 && idx.z >= 0 ? idx : null;
  }
  // Fallback for a headerless/unknown file: the LAST THREE numeric columns. Correct for BOTH the 5-
  // and 6-column layouts and for any future LEADING column, because XYZ is always the tail.
  function xyzColsByTail(p) {
    var nums = [];
    for (var k = 0; k < p.length; k++) {
      if (isFinite(parseFloat(p[k]))) nums.push(k);
    }
    if (nums.length < 3) return null;
    return { x: nums[nums.length - 3], y: nums[nums.length - 2], z: nums[nums.length - 1], ns: 1, phone: 0 };
  }
  function parseSensorXYZ(text) {
    const lines = text.split(/\r?\n/);
    const out = [];
    let ns0 = null;
    let cols = null;
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (/timestamp/i.test(t) && !cols) {
        cols = xyzColsFromHeader(t);
        if (cols) continue;
      }
      const p = t.split(';');
      if (p.length < 5) continue;
      const c = cols || xyzColsByTail(p);
      if (!c) continue;
      const x = parseFloat(p[c.x]);
      if (!isFinite(x)) continue;
      let relNs = NaN;
      try {
        const b = BigInt(p[c.ns >= 0 ? c.ns : 1].trim());
        if (ns0 === null) ns0 = b;
        relNs = Number(b - ns0);
      } catch (e) {}
      const ts = parseTimestamp(p[c.phone >= 0 ? c.phone : 0]);
      out.push({ relNs, tMs: ts ? ts.tMs : null, x, y: parseFloat(p[c.y]), z: parseFloat(p[c.z]) });
    }
    return out;
  }
  /* DISCRETE MOVEMENT ONSETS from a motion grid — the fiducial an apnea's terminating arousal leaves
     on an accelerometer.

     WHY THIS EXISTS SEPARATELY FROM `motion_artifact_segment`. That impulse is emitted per BEAT, so it
     requires the PPG to still be detectable — and it is precisely a large movement that destroys the
     optical signal. The quality flag therefore thins out exactly where the movement was biggest. This
     reads the inertial grid directly, so a movement that blinds the PPG still produces an onset.

     WHY ONSETS AND NOT THE INDEX. A cross-device clock fit needs INSTANTS to correlate, not a
     continuous level: `motionIndex` is already exported per epoch and cannot locate anything to better
     than the epoch. Measured on the real corpus, onsets derived this way from four inertial streams
     (chest ACC, arm ACC/GYRO/MAG) independently agreed on the same clock offset to within 12 s.

     Three conditions, all necessary — the same shape `PATAlign.findAnchors` uses and for the same
     reason: a bare threshold fires repeatedly across one long turn, and every extra hit on the SAME
     movement is a correlated vote, not an independent one. Amplitude alone is not an event. */
  function movementOnsets(grid, dtSec, opts) {
    opts = opts || {};
    const kSigma = opts.sigma != null ? opts.sigma : 3;
    const localBins = opts.localBins != null ? opts.localBins : Math.max(1, Math.round(5 / dtSec));
    const minGapSec = opts.minGapSec != null ? opts.minGapSec : 30;
    if (!grid || !grid.length || !(dtSec > 0)) return [];
    const n = grid.length;
    /* mean + k·SD. A MAD-based threshold was tried and REJECTED: MAD tracks the quiet baseline, which
       on a differenced (jerk) grid is almost zero, so the threshold collapses and the detector fired
       713 times in one night instead of 29. The tail this distribution carries is the SIGNAL, and a
       threshold that ignores it is not robust, it is blind. */
    let m = 0;
    for (let i = 0; i < n; i++) m += grid[i];
    m /= n;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const d = grid[i] - m;
      v += d * d;
    }
    const sd = Math.sqrt(v / n) || 1;
    const thr = m + kSigma * sd;
    const out = [];
    let last = -Infinity;
    for (let c = 0; c < n; c++) {
      if (grid[c] < thr) continue;
      let isMax = true;
      for (let k = c - localBins; k <= c + localBins; k++) {
        if (k >= 0 && k < n && grid[k] > grid[c]) {
          isMax = false;
          break;
        }
      }
      if (!isMax) continue;
      const sec = c * dtSec;
      if (sec - last < minGapSec) continue;
      out.push(sec);
      last = sec;
    }
    return out;
  }

  /* Full-scale points for the 0-1 motion index. NAMED because the gyro's zero-rate floor is capped at
     a fraction of GY_FULL: as two bare literals the cap and the normaliser could drift apart, and the
     failure would be silent — a cap that no longer matches the scale it is a fraction of. */
  const ACC_FULL = 120; // mg of DYNAMIC (de-gravitated) acceleration = full motion
  const GY_FULL = 40; // dps = full motion

  function analyzeMotion(accRows, gyroRows, t0Ms, durSec, magRows) {
    // magRows is LAST + optional so the historical 4-arg contract analyzeMotion(acc,gyro,t0,dur)
    // (and the shared regression suite) keeps working unchanged.
    const has = (accRows && accRows.length > 5) || (gyroRows && gyroRows.length > 5);
    if (!has) return { hasData: false };
    // build a uniform 4 Hz motion-index grid over [0, durSec]
    const dt = 0.25,
      nG = Math.max(1, Math.ceil(durSec / dt));
    const grid = new Float32Array(nG);
    /* `relNs` is the DEVICE counter and it RESTARTS AT 0 in every capture fragment. Preferring it
       blindly is a trap: hand this function a night assembled from several sessions and every fragment
       folds onto the first one's window, silently. That is not hypothetical — `trio-batch` did exactly
       this, and 99 % of a night's inertial data (229 MB of Verity ACC, of which 2.2 MB was used) was
       discarded on every fold, taking motionIndex, posture, the magnetometer features and
       movement_onset with it. Nothing errored; the numbers simply described the first two minutes.

       So the CALLER is no longer trusted to have re-based it. If `relNs` ever steps BACKWARDS across
       the input, it is per-fragment and unusable as a night-relative clock, and the absolute per-row
       stamp is used instead. Checked once, on the rows actually passed. */
    const _relNsUsable = (rows) => {
      if (!rows || rows.length < 2) return true;
      let prev = -Infinity;
      for (let i = 0; i < rows.length; i++) {
        const v = rows[i] && rows[i].relNs;
        if (!isFinite(v)) continue;
        if (v < prev) return false;
        prev = v;
      }
      return true;
    };
    const _useRelNs = _relNsUsable(accRows) && _relNsUsable(gyroRows) && _relNsUsable(magRows);
    // ACC dynamic magnitude (de-gravitated)
    function relSecOf(r) {
      if (_useRelNs && isFinite(r.relNs)) return r.relNs / 1e9;
      if (r.tMs != null && t0Ms != null) return (r.tMs - t0Ms) / 1000;
      return null;
    }
    /* NATIVE sample rate = MEDIAN inter-sample interval, never count ÷ span (DEEP-AUDIT-III §4.1,
       re-found here as DEEP-AUDIT-V F19). `count / durSec` divides by the PPG duration, so it is the
       AVERAGE over a span the stream may not cover: a dropout stretches the span without adding
       samples, and packet loss on this hardware is routine. On one real file MotionDex read 52.00 Hz
       and PpgDex read 19 Hz for THE SAME accelerometer; a corpus scan found 103 of 386 pairs below
       0.9 of native, 68 below 0.7, worst ~12 Hz.
       Two consequences, and the second is the one that moves numbers: the surfaced KPI is labelled
       plainly "ACC Hz" and the node-export field is plain `accFs` — neither says "effective", so both
       are read as the native rate. And the rate SIZES the ~1 s gravity window below, so an
       under-stated rate makes that window too SHORT in real time and shifts the de-gravitated
       magnitude every motion metric is built on. */
    function _nativeHz(rows) {
      if (!rows || rows.length < 3) return null;
      const d = [];
      let prev = null;
      for (let i = 0; i < Math.min(rows.length, 4000); i++) {
        const t = relSecOf(rows[i]);
        if (t == null) continue;
        if (prev != null && t > prev) d.push(t - prev);
        prev = t;
      }
      if (!d.length) return null;
      d.sort((a, b) => a - b);
      const dm = d[d.length >> 1];
      return isFinite(dm) && dm > 0 ? 1 / dm : null;
    }
    const _accHz = _nativeHz(accRows),
      _gyroHz = _nativeHz(gyroRows),
      _magHz = _nativeHz(magRows);
    let accMag = [];
    if (accRows && accRows.length > 5) {
      const mags = accRows.map((r) => Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z));
      // gravity baseline via slow moving average — sized off the NATIVE rate (see _nativeHz above);
      // count/durSec under-states it under packet loss, which shortens this window in real time.
      const w = Math.max(3, Math.round(_accHz != null ? _accHz : accRows.length / durSec)); // ~1s
      const base = movavg(Float32Array.from(mags), w);
      accMag = accRows.map((r, i) => ({ s: relSecOf(r), v: Math.abs(mags[i] - base[i]) }));
    }
    /* ── THE GYRO'S ZERO-RATE BIAS IS NOT MOTION ──────────────────────────────────────────────────
       ACC is de-gravitated three lines up — `|mag - movavg(mag, ~1s)|` — because a raw accelerometer
       magnitude is dominated by a constant it must not be credited for. The gyroscope had no such
       treatment and has exactly the same problem: a MEMS gyro at rest does not read zero.

       MEASURED on a real 4.19 h night (Verity `0C301E3F`, 2026-08-09, 780k samples):

           gyroMag [dps]   p1 3.469   p50 3.854   p90 3.983   p99 12.405   max 353.9

       p1→p90 spans half a dps. That is not a distribution of movement, it is a FLOOR — the arm is
       still and the sensor reads ~3.85 dps regardless. Against `gyNorm`'s 40 dps full scale that
       normalises to 0.096 while de-gravitated ACC's median is 0.012, so `max(accNorm, gyNorm)` picked
       the gyro in **99.18 %** of cells and every quiet epoch carried ~0.1 of motion it had not earned.
       Mean motion index over that night: 0.110 with the pedestal, 0.044 without.

       Not cosmetic: the index gates per-pulse SQI, which becomes the `conf` on every Ganglior beat
       event — so a stationary gyroscope was quietly discounting beat confidence all night.

       WHY A FLOOR AND NOT A MOVING AVERAGE. Gravity is slowly-varying (posture), so ACC subtracts a
       ~1 s baseline. A gyro's zero-rate bias is a STATIC offset, and high-passing it the same way
       would erase sustained rotation — which is real motion and must survive. So: one robust floor per
       recording, subtracted, clamped at zero.

       ⚠️ THE FLOOR IS CAPPED, because the estimator can be wrong in the direction that hurts. On a
       recording that is mostly movement a low percentile is no longer the bias, and subtracting it
       would erase the very thing being measured. Past `GY_FULL / 4` the "floor" is motion, so it stops
       being treated as bias — the cap can only ever let MORE motion through, never less.

       NO `Math.max(0, …)` HERE, DELIBERATELY. Subtracting a 10th-percentile floor leaves ~10 % of
       samples negative, and clamping them looks prudent — but `gyroMag` has exactly ONE consumer, the
       grid accumulation below, which does `Math.max(gyCell[g], v)` into a ZERO-INITIALISED array. A
       negative can never win that comparison, so the clamp is unreachable by construction: it was
       written, the mutation check could not kill it, and dead defensive code is worse than none.
       ⚠️ That invariant is what makes this safe — a SECOND consumer of `gyroMag` must re-establish it
       or clamp for itself. */
    let gyroMag = [];
    let gyroBias = 0;
    if (gyroRows && gyroRows.length > 5) {
      const rawGy = gyroRows.map((r) => Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z));
      const sortedGy = Array.from(rawGy).sort((a, b) => a - b);
      const p10 = sortedGy[Math.floor(sortedGy.length * 0.1)];
      gyroBias = Math.min(isFinite(p10) && p10 > 0 ? p10 : 0, GY_FULL / 4);
      gyroMag = gyroRows.map((r, i) => ({ s: relSecOf(r), v: rawGy[i] - gyroBias }));
    }
    // accumulate into grid (max within each 0.25s cell)
    const accCell = new Float32Array(nG),
      gyCell = new Float32Array(nG);
    /* WHICH CELLS ACTUALLY RECEIVED A SAMPLE (bug class 3a — MULTI-SENSOR-DERIVATIONS-FOLLOWUPS §1).
       `accCell`/`gyCell` are zero-initialised, so a cell no sample ever landed in is indistinguishable
       from a cell whose sensor said "not moving" — and `motionAtSec` then reports a hard 0, which is a
       real reading. Measured before fixing: a 60-min session whose ACC stops at 30 min reads a
       saturated 1.0000 up to the cut and exactly 0.0000 after it, with the subject moving identically
       throughout; 359 of 360 post-cut samples score as low-motion. That is the MotionDex `actigraphy()`
       defect (a recording gap fabricating stillness, which then inflated a motion-gated HRV confidence)
       reproduced here. Coverage is tracked separately so absence can be reported AS absence. */
    const covCell = new Uint8Array(nG);
    for (const a of accMag) {
      if (a.s == null) continue;
      const g = Math.floor(a.s / dt);
      if (g >= 0 && g < nG) {
        accCell[g] = Math.max(accCell[g], a.v);
        covCell[g] = 1;
      }
    }
    for (const a of gyroMag) {
      if (a.s == null) continue;
      const g = Math.floor(a.s / dt);
      if (g >= 0 && g < nG) {
        gyCell[g] = Math.max(gyCell[g], a.v);
        covCell[g] = 1;
      }
    }
    // normalise: accel in mg (dynamic), gyro in dps. Scale so "still" ≈ 0.
    const accNorm = (v) => Math.min(1, v / ACC_FULL); // ~120 mg dynamic = full motion
    const gyNorm = (v) => Math.min(1, v / GY_FULL); // ~40 dps = full motion
    /* `onsetGrid` is the SAME quantity WITHOUT the clip. `grid` saturates at 1.0 by design — it is a
       0-1 motion INDEX for epoch reporting and quality gating, where "moving hard" and "moving very
       hard" are usefully the same. For ONSET detection that clip is fatal: on a normal night many
       movements peg at 1.0, the peaks flatten into an indistinguishable plateau, and a sigma-threshold
       local-maximum test loses them. Measured: the clipped grid yielded 4 onsets on a night where the
       chest ACC found 29, which is below the fit's own minimum and would have made the Verity's three
       inertial streams useless to it. Unclipped, the peak structure survives. */
    const onsetGrid = new Float32Array(nG);
    for (let i = 0; i < nG; i++) {
      grid[i] = Math.max(accNorm(accCell[i]), gyNorm(gyCell[i]));
      onsetGrid[i] = Math.max(accCell[i] / ACC_FULL, gyCell[i] / GY_FULL);
    }
    // smooth
    const sm = movavg(grid, 3);
    const motionAtSec = (sec) => {
      const g = Math.floor(sec / dt);
      return g >= 0 && g < nG ? sm[g] : 0;
    };
    /* The tri-state companion `motionAtSec` cannot be (§3a). `motionAtSec` keeps its numeric contract —
       it is called on every beat in two hot loops and several callers compare it against a threshold —
       so the honesty is added ALONGSIDE it rather than by changing its return type: ask this first, and
       treat a `false` as "no evidence", never as "no motion". */
    const motionCoveredAtSec = (sec) => {
      const g = Math.floor(sec / dt);
      return g >= 0 && g < nG && covCell[g] === 1;
    };
    let _nCov = 0;
    for (let i = 0; i < nG; i++) if (covCell[i]) _nCov++;
    const motionCoveredFrac = nG ? _nCov / nG : 0;
    const meanMI = mean(Array.from(sm));
    // display series (downsampled, per ~minute or per cell)
    const series = [];
    const stride = Math.max(1, Math.floor(nG / 600));
    for (let i = 0; i < nG; i += stride) series.push({ x: (i * dt) / 60, y: r2(sm[i]) });
    // ── posture (LIMB orientation) — gravity vector per axis via slow moving average.
    //    NOTE: Polar Sense is worn on the WRIST or the ANKLE (ankle is common for the
    //    arterial-stiffness proxy). The wear site is NOT auto-detected, so this is the
    //    limb's orientation — an approximate, lower-reliability proxy for true body
    //    position (a chest strap / ECGDex is far better). Exposed for cross-node parity
    //    but tagged positionSource:'limb-acc' so the Integrator down-weights it heavily.
    //    null when no ACC (gyro-only sessions).
    let postureAtSec = null,
      postureDetailAtSec = null,
      gAxis = null;
    // ── MAGNETOMETER (optional, additive) — Polar Sense 3-axis mag, Gauss, ~10 Hz, ±50 G
    //    range, ~0.0015 G (0.15 µT) LSB. EARTH-FIELD-SCALE ONLY: heading + left/right-lateral
    //    disambiguation + a calibration-free interference flag. NEVER biomagnetic HR — the
    //    cardiac field (~50 pT) is ~3000× below one LSB (see project assessment), and any
    //    pulse-rate peak in MAGN is limb micro-motion aliased through Earth's field, which the
    //    ACC/GYRO gate already captures better. magInterference is exposed as an informational
    //    SQI channel; it does NOT alter beat SQI / conf here (left to the Integrator to weight).
    const magHas = !!(magRows && magRows.length > 5);
    let magState = { has: magHas };
    if (magHas) {
      magState.ss = magRows.map(relSecOf);
      magState.mx = magRows.map((r) => r.x);
      magState.my = magRows.map((r) => r.y);
      magState.mz = magRows.map((r) => r.z);
      magState.mag = magRows.map((r) => Math.hypot(r.x, r.y, r.z));
      magState.base = median(magState.mag.filter(isFinite)) || 0; // session |B| baseline (Gauss)
    }
    // tilt-compensated heading (deg) from a window-median mag vector + gravity vector (Gauss/mg)
    function tiltHeading(Mx, My, Mz, g) {
      if (g) {
        const gn = Math.hypot(g.x, g.y, g.z) || 1,
          ux = g.x / gn,
          uy = g.y / gn,
          uz = g.z / gn;
        const dot = Mx * ux + My * uy + Mz * uz; // remove field component along gravity
        const hx = Mx - dot * ux,
          hy = My - dot * uy,
          hz = Mz - dot * uz; // → horizontal field
        let ax = 0,
          ay = 0,
          az = 0;
        if (Math.abs(ux) < 0.9) ax = 1;
        else ay = 1; // ref axis ∦ gravity
        let e1x = uy * az - uz * ay,
          e1y = uz * ax - ux * az,
          e1z = ux * ay - uy * ax;
        const e1n = Math.hypot(e1x, e1y, e1z) || 1;
        e1x /= e1n;
        e1y /= e1n;
        e1z /= e1n;
        const e2x = uy * e1z - uz * e1y,
          e2y = uz * e1x - ux * e1z,
          e2z = ux * e1y - uy * e1x; // e2 = ĝ × e1
        return (Math.atan2(hx * e2x + hy * e2y + hz * e2z, hx * e1x + hy * e1y + hz * e1z) * 180) / Math.PI;
      }
      return (Math.atan2(My, Mx) * 180) / Math.PI;
    }
    if (accRows && accRows.length > 5) {
      const w = Math.max(3, Math.round((accRows.length / durSec) * 2.0)); // ~2s low-pass → gravity
      const gx = movavg(Float32Array.from(accRows.map((r) => r.x)), w);
      const gy = movavg(Float32Array.from(accRows.map((r) => r.y)), w);
      const gz = movavg(Float32Array.from(accRows.map((r) => r.z)), w);
      const ss = accRows.map(relSecOf);
      gAxis = { gx, gy, gz, ss };
      const gStride = Math.max(1, Math.floor(ss.length / 5000));
      function gravMed(s0, s1) {
        const ex = [],
          ey = [],
          ez = [];
        for (let i = 0; i < ss.length; i += gStride) {
          if (ss[i] != null && ss[i] >= s0 && ss[i] < s1) {
            ex.push(gx[i]);
            ey.push(gy[i]);
            ez.push(gz[i]);
          }
        }
        return ex.length ? { x: median(ex), y: median(ey), z: median(ez), n: ex.length } : null;
      }
      // window-median heading (relative, uncalibrated for absolute north)
      function headingAtSec(s0, s1) {
        if (!magState.has) return null;
        const sx = [],
          sy = [],
          sz = [];
        for (let i = 0; i < magState.ss.length; i++) {
          const s = magState.ss[i];
          if (s != null && s >= s0 && s < s1) {
            sx.push(magState.mx[i]);
            sy.push(magState.my[i]);
            sz.push(magState.mz[i]);
          }
        }
        if (sx.length < 3) return null;
        const g = gravMed(s0, s1);
        return tiltHeading(median(sx), median(sy), median(sz), g);
      }
      // calibration-free interference: field wobble within a (still) window, or |B| off baseline
      function magInterfAtSec(s0, s1) {
        if (!magState.has) return false;
        const v = [];
        for (let i = 0; i < magState.ss.length; i++) {
          const s = magState.ss[i];
          if (s != null && s >= s0 && s < s1) v.push(magState.mag[i]);
        }
        if (v.length < 3) return false;
        const sd = std(v),
          md = median(v),
          bg = magState.base || 1;
        return !!(sd > Math.max(0.03, 0.04 * bg) || Math.abs(md - bg) / bg > 0.25); // ~>4 µT wobble or >25% off baseline
      }
      // reference heading from the longest non-lateral (supine/prone/upright) spans → L/R datum.
      // Relative datum: the L/R *labels* may be mirrored without a calibration gesture (tagged).
      let refHeading = null;
      if (magState.has) {
        let sumS = 0,
          sumC = 0,
          cnt = 0;
        for (let s = 0; s < durSec; s += 30) {
          const g = gravMed(s, s + 30);
          if (!g) continue;
          const base = _posturePPG(g.x, g.y, g.z);
          if (base === 'supine' || base === 'prone' || base === 'upright') {
            const h = headingAtSec(s, s + 30);
            if (h != null) {
              const rad = (h * Math.PI) / 180;
              sumS += Math.sin(rad);
              sumC += Math.cos(rad);
              cnt++;
            }
          }
        }
        if (cnt > 0) refHeading = (Math.atan2(sumS, sumC) * 180) / Math.PI;
      }
      magState.refHeading = refHeading;
      // Rich per-window posture: { position, conf, heading, magInterf }. postureAtSec (below)
      // returns just the position STRING — the stable contract consumed by the test suite.
      postureDetailAtSec = (s0, s1) => {
        const g = gravMed(s0, s1);
        const need = (accRows.length / durSec) * 30; // need ≥30 s of gravity samples
        if (!g || g.n < need / gStride) return { position: 'unknown', conf: 0, heading: null, magInterf: false };
        let base = _normPositionPPG(_posturePPG(g.x, g.y, g.z));
        const heading = magState.has ? headingAtSec(s0, s1) : null;
        const magInterf = magState.has ? magInterfAtSec(s0, s1) : false;
        // split merged 'lateral' into L/R using heading offset from the supine/upright datum
        if (base === 'lateral' && heading != null && refHeading != null && !magInterf) {
          let d = heading - refHeading;
          while (d > 180) d -= 360;
          while (d < -180) d += 360;
          if (Math.abs(d) >= 30) base = d >= 0 ? 'lateral_R' : 'lateral_L';
        }
        // confidence: axis dominance × coverage × mag bonus / interference penalty
        const gn = Math.hypot(g.x, g.y, g.z) || 1,
          dom = Math.max(Math.abs(g.x / gn), Math.abs(g.y / gn), Math.abs(g.z / gn));
        let conf = Math.max(0, Math.min(1, (dom - 0.577) / (1 - 0.577)));
        conf *= Math.max(0.3, Math.min(1, (g.n * gStride) / need));
        if (magState.has && !magInterf && (base === 'lateral_L' || base === 'lateral_R')) conf = Math.min(1, conf * 1.05 + 0.05);
        if (magInterf) conf *= 0.6;
        return { position: base, conf: r2(conf), heading: heading != null ? Math.round(((heading % 360) + 360) % 360) : null, magInterf };
      };
      postureAtSec = (s0, s1) => postureDetailAtSec(s0, s1).position; // string contract (back-compat)
    }
    return {
      hasData: true,
      grid: sm,
      onsetGrid,
      dt,
      motionAtSec,
      motionCoveredAtSec,
      motionCoveredFrac: r2(motionCoveredFrac),
      postureAtSec,
      postureDetailAtSec,
      meanMotionIndex: r2(meanMI),
      series,
      accFs: _accHz != null ? Math.round(_accHz) : null,
      gyroFs: _gyroHz != null ? Math.round(_gyroHz) : null,
      // The zero-rate floor subtracted from this recording's gyro, in dps. Reported because a silent
      // correction cannot be checked: ~3.9 on the measured night, and a value at the GY_FULL/4 cap
      // means the estimator hit its guard rail and the recording is mostly movement.
      gyroBiasDps: gyroRows && gyroRows.length > 5 ? r2(gyroBias) : null,
      nAcc: accRows ? accRows.length : 0,
      nGyro: gyroRows ? gyroRows.length : 0,
      hasMag: magState.has,
      nMag: magRows ? magRows.length : 0,
      magFs: _magHz != null ? Math.round(_magHz) : null,
      magBaseG: magState.has ? r2(magState.base) : null,
      refHeadingDeg: magState.has && magState.refHeading != null ? Math.round(((magState.refHeading % 360) + 360) % 360) : null
    };
  }
  // classify body position from a gravity vector (mg). Mount-independent tilt is the robust
  // axis (supine/prone ≈ flat, upright ≈ vertical). Left/right fold into 'lateral'. Mirrors
  // ECGDex's _posture/_normPosition (duplicated locally — these nodes don't share modules).
  function _posturePPG(gx, gy, gz) {
    const g = Math.hypot(gx, gy, gz) || 1,
      ux = gx / g,
      uy = gy / g,
      uz = gz / g;
    if (Math.abs(uz) >= 0.7) return uz > 0 ? 'supine' : 'prone';
    if (Math.abs(uy) >= 0.55) return 'upright';
    return 'lateral';
  }
  function _normPositionPPG(p) {
    return ['supine', 'prone', 'lateral', 'upright'].indexOf(p) >= 0 ? p : 'unknown';
  }

  // ════════════════════════════════════════════════════════════════════════
  //  DEVICE-PPI VALIDATION  — self-PPI vs Polar *_PPI.txt (validation lane only)
  // ════════════════════════════════════════════════════════════════════════
  function parseDevicePPI(text) {
    const lines = text.split(/\r?\n/);
    const out = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      const p = t.split(';');
      if (p.length < 2) continue;
      const ppi = parseFloat(p[1]);
      if (!isFinite(ppi)) continue;
      const ts = parseTimestamp(p[0]);
      const err = parseFloat(p[2]);
      const blocker = parseFloat(p[3]);
      const contact = parseFloat(p[4]);
      out.push({
        tMs: ts ? ts.tMs : null,
        ppi,
        err: isFinite(err) ? err : null,
        blocker: isFinite(blocker) ? blocker : null,
        contact: isFinite(contact) ? contact : null,
        hr: parseFloat(p[p.length - 1])
      });
    }
    return out;
  }
  /* ABSENT AND EMPTY ARE DIFFERENT SITUATIONS, and the caller could not tell them apart.
     `hasData:false` covered both "no *_PPI.txt was loaded" and "one was loaded and the device wrote
     nothing into it", so the UI said "load the device PPI file to cross-validate" — advice that is
     actionable in the first case and misleading in the second, because the user already did.

     It WAS the second case, categorically, and that is no longer true — the claim is corrected here
     rather than deleted, because the reason it changed is the useful part. Re-measured 2026-08-13 over
     132 `_PPI.txt` in the capture corpus: 108 are header-only and 17 carry real intervals, up to
     29 329 unblocked in one night. The split is not random and it is not firmware version — it is
     CAPTURE MODE. Every header-only file is phone-captured; every file with data is a box capture from
     2026-08-05 onward. (Consistent with the Verity's known SDK-mode behaviour, where PPI reports
     permanently invalid.) So `filePresent` still distinguishes "you have nothing to compare" from
     "your device produced nothing to compare", and the second is now a statement about HOW the night
     was captured, not about the hardware. Do not re-derive "the Verity never emits PPI" from an
     all-phone sample — that inference was made once already and this paragraph is its correction. */

  /* THE COMPARISON MUST CORRECT BOTH SIDES, or it measures our artifact rejection instead of the two
     detectors (mirrors ECGDex `validateRR`, which Malik-corrects self AND device before comparing).
     The asymmetry is large and it points the WRONG WAY, which is what makes it worth a comment rather
     than a line of code. Measured through the real pipeline on 2026-08-08: `nn` reaching this function
     is already corrected (rMSSD 59.3), while the raw firmware series reads 103.6 — so an uncorrected
     comparison shows the device 75 % HIGHER and invites exactly one conclusion, that our detector is
     over-smoothing. Correcting the device the same way costs 306 beats and brings it to 53.6, i.e.
     dRMSSD 10.7 %: the firmware series carried MORE artifact, not less. The uncorrected reading does
     not merely exaggerate the disagreement, it inverts its direction.
     rMSSD is a first-difference statistic, which is precisely where unequal artifact handling lands;
     the MEANS agreed to 8 ms (0.74 %) the whole time. Correction uses PpgDex's own optical threshold
     on both sides, not ECGDex's 0.20 Malik rule — pulse-arrival jitter is larger than R-peak jitter
     (see `correctRR`). Note SDNN stays looser than rMSSD (14.8 / 22.5 % on two nights): it is a
     whole-record spread, so it also absorbs genuine coverage differences between the two series. */
  function _ppiCorrect(vals) {
    // correctRR wants a time axis; the intervals ARE the axis, so accumulate them.
    const tt = [];
    let acc = 0;
    for (let i = 0; i < vals.length; i++) {
      acc += vals[i] / 1000;
      tt.push(acc);
    }
    const c = correctRR(vals, tt);
    return { out: c.nn, nc: c.nCorr };
  }

  /* ── DETECTOR STABILITY vs AVERAGING TIME (overlapping Allan deviation) ────────────────────────
     WHAT THIS IS, because the method is borrowed and the application is not obvious. Allan deviation
     is clock metrology's standard answer to "does this error shrink if I average longer?" — a single
     SD cannot answer it, because for several common noise types SD DIVERGES as N grows (NIST/Riley
     SP 1065). Here it is applied not to a clock but to the DISAGREEMENT between two beat detectors
     watching the same heart: our optical foot detector and the device's own firmware detector. The
     physiology is common to both, so it cancels in the difference, and what remains is detector noise
     alone. That difference series is a genuine two-oscillator comparison, which is ADEV's native case.

     ⚠️ The input must be PHASE (a time-error series), not intervals. RR/PPI intervals are a FREQUENCY
     series, and a heart is not an oscillator with stationary noise — run raw intervals through this
     and the curve is dominated by respiratory sinus arrhythmia and sleep-stage drift, i.e. it measures
     HRV with an instrument built to make HRV disappear. Measured on 2026-08-08: the detector
     difference gives slope −1.007 (pure jitter, 45.8 ms/beat → 0.02 ms at 40 min), while the same
     night's beat times against a uniform grid give −0.307 and stall at 27 ms. Different questions.

     WHY THE SLOPE IS THE ANSWER and the magnitude is not: −1 jitter that averages away · −½ benign ·
     0 A FLOOR that averaging cannot remove · +½ wander · +1 deterministic drift. A −1 slope with no
     floor is what licenses treating a SUSTAINED divergence as a real fault rather than accumulated
     noise — without it that inference is an assumption.

     THREE IMPLEMENTATIONS, DELIBERATELY, AND GATED AGAINST EACH OTHER. `capture-host/allan.py` works
     in the phase domain via the second difference; `integrator-tch.js allanDeviation` works in the
     frequency domain via overlapping averages; this is the frequency form again because PpgDex cannot
     reach either (Python is a different lane, and inlining the Integrator's TCH module into this
     bundle for one function is not worth it — while promoting it to the shared spine would re-stamp
     all 8 provenance fragments, §👥.3, for that same one function). The two formulations are
     algebraically equivalent and were verified to agree to every reported digit across all 12 τ on a
     real night; `tests/dex-tests.js` pins this against BOTH siblings so a third variant cannot drift. */
  const ALLAN_MIN_PAIRS = 64; // below this the octave ladder has too few τ to fit a slope at all
  function allanFromPhase(phaseMs, tau0Sec) {
    // PHASE → FRACTIONAL FREQUENCY: y[i] = (x[i+1] − x[i]) / tau0. This is the change of variable that
    // makes the overlapping-average form apply; it is why this matches the phase-domain sibling.
    const y = [];
    for (let i = 1; i < phaseMs.length; i++) {
      const v = (phaseMs[i] - phaseMs[i - 1]) / tau0Sec;
      if (!isFinite(v)) return [];
      y.push(v);
    }
    const N = y.length;
    if (N < 3) return [];
    const pre = new Float64Array(N + 1);
    for (let j = 0; j < N; j++) pre[j + 1] = pre[j] + y[j];
    const out = [];
    for (let m = 1; 2 * m + 1 <= N; m *= 2) {
      let sum = 0,
        cnt = 0;
      for (let i = 0; i + 2 * m <= N; i++) {
        const d = (pre[i + 2 * m] - pre[i + m]) / m - (pre[i + m] - pre[i]) / m;
        sum += d * d;
        cnt++;
      }
      if (cnt < 8) break; // an estimate from a handful of terms is wider than the answer it gives
      out.push({ tau: m * tau0Sec, adev: Math.sqrt(sum / (2 * cnt)), n: cnt });
    }
    return out;
  }
  /* Slope midpoints between the canonical exponents, and the SAME vocabulary as capture-host/allan.py
     `_NOISE`. Kept verbatim on purpose: two lanes naming the same curve differently is a defect a
     reader cannot see. Drift is the open-ended top, so it is the fall-through rather than a table edge
     — an edge no slope can fail makes the fall-through unreachable. */
  const ALLAN_NOISE = [
    [-0.75, 'white/flicker-phase', 'jitter — averages away fast'],
    [-0.25, 'white-frequency', 'benign; averaging helps as √N'],
    [0.25, 'flicker-frequency', 'A FLOOR — more averaging buys nothing'],
    [0.75, 'random-walk-frequency', 'wanders; a longer fit is worse than a short one']
  ];
  /* The OLS fit WITH its uncertainty. Mirrors `clock.js _ckAllanSlope` term for term — this node
     cannot delegate to it: `PpgDex.html` inlines no `clock.js`, so `DexClock` is undefined in the
     shipped bundle. The duplication is structural, which is why the parity gate pins the two lanes'
     ANSWERS rather than trusting them to stay equal by inspection.
     ⚠️ The SE is a LOWER BOUND — overlapping ADEV points are correlated (adjacent taus reuse most of
     the same samples) while OLS assumes independent residuals. Do not tighten 1.96 to 1 SE believing
     that is the more rigorous choice; it is the less rigorous one. */
  function allanSlopeFit(points) {
    const pts = (points || []).filter((p) => p.adev > 0 && p.tau > 0);
    if (pts.length < 3) return null; // two points fit any line and cannot be checked
    const xs = pts.map((p) => Math.log10(p.tau)),
      ys = pts.map((p) => Math.log10(p.adev));
    const k = xs.length;
    const mx = mean(xs),
      my = mean(ys);
    let sxy = 0,
      sxx = 0;
    for (let i = 0; i < k; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) * (xs[i] - mx);
    }
    if (!(sxx > 0)) return null;
    const b = sxy / sxx,
      a = my - b * mx;
    let ss = 0;
    for (let i = 0; i < k; i++) {
      const e = ys[i] - (a + b * xs[i]);
      ss += e * e;
    }
    return { slope: b, se: Math.sqrt(ss / (k - 2) / sxx), nTau: k };
  }
  /* The scalar form, KEPT: `channelStability` consumes a bare slope and rounds at its own call site,
     and that output sits in a committed fixture. New data arrives through `allanSlopeFit`, per the
     back-compat rule — never by changing an existing return shape. */
  function allanSlope(points) {
    const f = allanSlopeFit(points);
    return f ? f.slope : null;
  }
  /* NAME THE NOISE TYPE — OR REFUSE TO. Resolved 2026-08-16; this was the THIRD copy of the rule and
     the one the joint fix missed (it landed in `clock.js` and `capture-host/allan.py` as #1227).

     The old form tested a strict `<` against a POINT ESTIMATE and ROUNDED the slope in the returned
     record, so the digit that decided the answer was not even in the output: -0.7501 classified as
     white/flicker-phase and -0.7500 as white-frequency, both reporting slope -0.75, with `meaning`
     flipping between "averages away" and "helps as √N" — the field a consumer branches on. Our own
     ECGDex pair sits exactly there (slope -0.7500, OLS SE 0.0204, so the -0.75 edge is INSIDE the CI).

     Now: given `se`, an edge within 1.96·SE leaves `noise` as **null** and names the candidates
     instead. `null`, never a string like 'ambiguous' — a truthy sentinel passes the guard callers
     actually write (`if (cls.noise)`), which would reintroduce the bug inside its own fix. `slope` is
     returned UNROUNDED; round at display.

     `se`/`nTau` are optional and LAST, so every pre-existing caller keeps the pre-SE contract by
     construction rather than by promise.

     WHY 1.96·SE AND NOT RILEY EDF: equivalent degrees of freedom is a function of THE NOISE TYPE, so
     computing a confidence interval in order to DECIDE the noise type is circular exactly at a
     boundary. See the brief for the lag-1 autocorrelation route, which removes the circle rather than
     bounding it — and note that adopting it moves all three lanes or none. */
  function classifyAllan(sl, se, nTau) {
    if (sl == null || !isFinite(sl)) return null; // an unknown is not a noise type
    /* Number(): the table rows are mixed tuples `[edge, name, meaning]`, so TS reads `r[0]` as
       `string | number`. The old signature took an untyped `sl` and the comparison went unchecked;
       narrowing `sl` to a number is what surfaced it. Coerce at the boundary, once. */
    const edges = ALLAN_NOISE.map((r) => Number(r[0]));
    /* `se > 0` alone: null/undefined/NaN all compare false. se === 0 and se == null both skip the
       refusal, and that is a DECISION — no SE means the pre-SE contract, while an SE of exactly 0
       means the log-log points fall exactly on a line, the one case where the exponent IS known
       exactly. Do not read 0 as "measured and perfectly certain" on real data. */
    const half = se > 0 ? 1.96 * se : 0;
    const straddled = edges.filter((e) => sl - half < e && e < sl + half);
    let name = null,
      meaning = null;
    for (let i = 0; i < ALLAN_NOISE.length; i++) {
      if (sl < Number(ALLAN_NOISE[i][0])) {
        name = ALLAN_NOISE[i][1];
        meaning = ALLAN_NOISE[i][2];
        break;
      }
    }
    if (name == null) {
      name = 'drift';
      meaning = 'deterministic — fit and remove it, never average through it';
    }
    if (straddled.length) {
      const cands = [];
      for (let i = 0; i < ALLAN_NOISE.length; i++) {
        const lo = i === 0 ? -Infinity : Number(ALLAN_NOISE[i - 1][0]);
        if (sl - half < Number(ALLAN_NOISE[i][0]) && sl + half > lo) cands.push(ALLAN_NOISE[i][1]);
      }
      if (sl + half > Number(ALLAN_NOISE[ALLAN_NOISE.length - 1][0])) cands.push('drift');
      return {
        slope: sl,
        slopeSE: se == null ? null : se,
        nTau: nTau == null ? null : nTau,
        noise: null,
        candidates: cands,
        meaning: 'the slope sits within 1.96 SE of a category boundary — the noise TYPE is not supported by this fit; branch on `slope`, not on a label'
      };
    }
    return { slope: sl, slopeSE: se == null ? null : se, nTau: nTau == null ? null : nTau, noise: name, candidates: null, meaning: meaning };
  }
  /* Pairs two beat-time series (SECONDS, on the same axis) and returns the stability of their
     disagreement. `maxPairSec` rejects a beat with no counterpart rather than pairing it across a
     dropout — a fabricated pair injects a step the curve would read as wander. */
  function detectorStability(selfSec, fwSec, maxPairSec) {
    if (!selfSec || !fwSec || selfSec.length < ALLAN_MIN_PAIRS || fwSec.length < 3) return null;
    const tol = maxPairSec || 0.3;
    const ph = [],
      bt = [];
    for (let k = 0; k < selfSec.length; k++) {
      const t = selfSec[k];
      let lo = 0,
        hi = fwSec.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (fwSec[mid] < t) lo = mid + 1;
        else hi = mid;
      }
      let bi = lo,
        best = Math.abs(fwSec[lo] - t);
      if (lo > 0 && Math.abs(fwSec[lo - 1] - t) < best) {
        bi = lo - 1;
        best = Math.abs(fwSec[lo - 1] - t);
      }
      if (best < tol) {
        ph.push((t - fwSec[bi]) * 1000);
        bt.push(t);
      }
    }
    if (ph.length < ALLAN_MIN_PAIRS) return null;
    const tau0 = (bt[bt.length - 1] - bt[0]) / (bt.length - 1);
    if (!(tau0 > 0)) return null;
    const curve = allanFromPhase(ph, tau0);
    if (curve.length < 3) return null;
    const fit = allanSlopeFit(curve);
    const cls = classifyAllan(fit && fit.slope, fit && fit.se, fit && fit.nTau);
    if (!cls) return null;
    let best = curve[0];
    for (const p of curve) if (p.adev < best.adev) best = p;
    return {
      nPaired: ph.length,
      pairedPct: r1((100 * ph.length) / selfSec.length),
      tau0Sec: r2(tau0),
      taus: curve.length,
      /* UNROUNDED — rounding the slope in the DATA is what made the boundary case invisible: two
         records printing -0.75 with opposite noise types. Round at display. */
      slope: cls.slope,
      slopeSE: cls.slopeSE,
      nTau: cls.nTau,
      noise: cls.noise,
      /* Present and null on the success path too, matching the two sibling lanes. A key that appears
         only on failure forces every consumer into a defensive read and makes the three records
         differently shaped for no reason — parity is the property the cross-lane gate protects. */
      candidates: cls.candidates,
      meaning: cls.meaning,
      /* ⚠️ `…Ms` IS A MISNOMER, kept for back-compat — see the same note in `clock.js`. Phase is fed
         in ms and τ in seconds, so `adev` is ms/s: a RATE. PpgDex keeps its own copy of this because
         it does not inline `clock.js` (CLAUDE.md §✅), so the two must stay in step by hand. */
      atShortestMs: r2(curve[0].adev),
      atLongestMs: curve[curve.length - 1].adev,
      atShortestPpm: r2(curve[0].adev * 1000),
      atLongestPpm: curve[curve.length - 1].adev * 1000,
      tauMaxSec: Math.round(curve[curve.length - 1].tau),
      /* The averaging window a measurement built on this pair should actually use — the principled
         replacement for a window length chosen by intuition. On a pure-jitter pair it is simply the
         longest τ measured, and saying so is more honest than implying a minimum was found. */
      optimalTauSec: Math.round(best.tau),
      curve: curve.map((p) => ({ tau: r2(p.tau), adev: p.adev, n: p.n }))
    };
  }
  /* ── PER-CHANNEL DETECTOR AGREEMENT, REFERENCE-FREE (three-cornered hat) ─────────────────────────
     The Verity streams THREE optical channels in the SAME ROWS. Detect independently on each and you
     have three observers of one pulse on one axis, so the shared physiology cancels in every pairwise
     difference and what remains is detector disagreement. Allan deviation of each pairwise difference
     gives the SUM of two channels' noise; the classic three-cornered-hat split then separates them:

         sigma_i(tau)^2 = 1/2 ( AVAR(i-j,tau) + AVAR(i-k,tau) - AVAR(j-k,tau) )

     That is per-channel noise WITH NO REFERENCE — nothing here is assumed to be correct, which is the
     whole point and why it works where no gold standard exists. (Same identity `integrator-tch.js`
     applies across NODES; this applies it across CHANNELS of one sensor.)

     ⚠️ NOISE, NOT CORRECTNESS — AND THIS SUITE HAS ALREADY BEEN BITTEN BY THE DIFFERENCE.
     A three-cornered hat is blind to anything that moves all three corners together. The concrete
     case is not hypothetical: PPGDEX-OPTICAL-POLARITY (#1200) shipped for three weeks with `orient()`
     choosing the wrong sign, and ALL THREE CHANNELS AGREED ON THE WRONG SIGN — feet ~900 ms early on
     every channel simultaneously. Under that failure the mutual differences stay small, the noise
     stays independent, the non-negativity check stays clean, and this function reports three healthy
     channels at slope -1. It would have been green on every night the polarity was wrong.
     So: a clean result says the three observers disagree with each other by very little. It says
     NOTHING about whether all three are looking at the right feature of the waveform. `polarity` is
     carried in the return for exactly that reason — never publish the agreement without it.

     ⚠️ AND THE CHANNELS ARE NOT INDEPENDENT OPTICS — THE HARDWARE SAYS SO. The Verity Sense carries
     SIX LEDs of ONE wavelength (green) in a symmetric ring around a central detector. So the three
     exported channels do not differ in wavelength, and they are not three separate sensors: they
     differ in ILLUMINATION GEOMETRY over largely the same tissue volume, read through a shared
     optical front end. (Consistent with VIGIL-DEEP-ANALYSIS §6, which refuted multi-wavelength motion
     fusion for this device on the "near-identical green channels" ground — the ring geometry is why.)
     Everything common to that front end therefore CANCELS in the pairwise differences: motion at the
     site, contact pressure, ambient leakage, perfusion change. The per-channel sigma below is the
     INDEPENDENT RESIDUAL — a LOWER BOUND on a channel's true timing noise, never an estimate of it,
     and the bound is loose in exactly the conditions that matter most (a moving or poorly-coupled
     wrist). Do not read a small sigma as a quiet channel; read it as "this channel adds little of its
     OWN noise on top of whatever all three share".
     This is NOT the refuted fusion idea re-proposed: that combined channels to cancel motion, which
     the shared wavelength makes impossible. This decomposes noise, and is explicit that it cannot see
     the motion term at all.

     Validity is COMPUTED, not assumed: a negative split variance means the sources are not independent
     enough for the identity to hold, so `negativeVarianceTaus` is published and a tau that goes
     negative yields null for that channel rather than a clamped zero pretending to be a measurement. */
  const TCH_MIN_TRIPLES = 200; // below this the octave ladder cannot support a slope fit
  const TCH_PAIR_TOL_SEC = 0.15; // a beat with no counterpart within this is not a triple
  function detectorAgreementTriplet(trains, opts) {
    if (!trains || trains.length !== 3) return null;
    for (const t of trains) if (!t || t.length < TCH_MIN_TRIPLES) return null;
    const tol = (opts && opts.tolSec) || TCH_PAIR_TOL_SEC;
    const near = (arr, t) => {
      let lo = 0,
        hi = arr.length - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (arr[m] < t) lo = m + 1;
        else hi = m;
      }
      let bi = lo,
        b = Math.abs(arr[lo] - t);
      if (lo > 0 && Math.abs(arr[lo - 1] - t) < b) {
        bi = lo - 1;
        b = Math.abs(arr[lo - 1] - t);
      }
      return { t: arr[bi], d: b };
    };
    /* Roll-call on channel 0. Legitimate ONLY because all three are in the same rows: correspondence
       is exact, not an alignment estimate, so there is no offset to fit and none to decay. (The ECGDex
       attempt paired 63.6 % against 99.8 % here for precisely that reason.) A beat missing from either
       other channel is DROPPED, never matched across a gap. */
    const A = [],
      B = [],
      C = [];
    for (const t of trains[0]) {
      const b = near(trains[1], t),
        c = near(trains[2], t);
      if (b.d < tol && c.d < tol) {
        A.push(t);
        B.push(b.t);
        C.push(c.t);
      }
    }
    if (A.length < TCH_MIN_TRIPLES) return null;
    const tau0 = (A[A.length - 1] - A[0]) / (A.length - 1);
    if (!(tau0 > 0)) return null;
    const ph = (X, Y) => X.map((v, i) => (v - Y[i]) * 1000);
    const ab = allanFromPhase(ph(A, B), tau0),
      ac = allanFromPhase(ph(A, C), tau0),
      bc = allanFromPhase(ph(B, C), tau0);
    const nT = Math.min(ab.length, ac.length, bc.length);
    if (nT < 3) return null;
    /** @type {{tau:number, adev:number|null}[][]} — an empty literal infers as never[][] under checkJs */
    const per = [[], [], []];
    let neg = 0;
    for (let i = 0; i < nT; i++) {
      const v = [ab[i].adev * ab[i].adev, ac[i].adev * ac[i].adev, bc[i].adev * bc[i].adev];
      const split = [0.5 * (v[0] + v[1] - v[2]), 0.5 * (v[0] + v[2] - v[1]), 0.5 * (v[1] + v[2] - v[0])];
      let bad = false;
      for (let c = 0; c < 3; c++) if (split[c] < 0) bad = true;
      if (bad) neg++;
      for (let c = 0; c < 3; c++) per[c].push({ tau: ab[i].tau, adev: split[c] >= 0 ? Math.sqrt(split[c]) : null });
    }
    const chans = per.map((curve) => {
      /* Built explicitly rather than filtered: `.filter(p => p.adev > 0)` does not NARROW the type
         (a filter is not a type predicate), so the nulls a refused tau legitimately produces stay in
         the signature and every downstream read is "possibly null". */
      const pts = [];
      for (const q of curve) if (q.adev != null && q.adev > 0) pts.push({ tau: q.tau, adev: q.adev });
      const sl = allanSlope(pts);
      return {
        sigmaShortestMs: pts.length ? r2(pts[0].adev) : null,
        sigmaLongestMs: pts.length ? pts[pts.length - 1].adev : null,
        slope: sl == null ? null : r2(sl),
        curve: curve.map((p) => ({ tau: r2(p.tau), adev: p.adev }))
      };
    });
    return {
      /* The PAIRWISE curves the split was derived from. Published for two reasons: a reader can see
         the input to the identity rather than only its output, and it makes the reconstruction
         checkable — sigma_i^2 + sigma_j^2 must equal AVAR(i-j) EXACTLY, which holds only when the
         split coefficients are exactly 1/2. That is the one assertion able to catch a wrong
         coefficient: scaling all three sigma equally leaves the ORDERING intact and log-log SLOPE is
         scale-invariant, so every other property survives a mis-scaled split unchanged. */
      pairwise: { AB: ab.map((p) => p.adev), AC: ac.map((p) => p.adev), BC: bc.map((p) => p.adev) },
      nTriples: A.length,
      triplePct: r1((100 * A.length) / trains[0].length),
      tau0Sec: r2(tau0),
      taus: nT,
      negativeVarianceTaus: neg,
      /* The identity's own independence check. Non-zero ⇒ the three channels are not independent
         enough at those tau and the split there is not a measurement. Published, never hidden. */
      independent: neg === 0,
      channels: chans,
      /* Carried so the agreement can never be read without it — see the polarity warning above. */
      polarity: (opts && opts.signs) || null,
      polarityUnanimous: opts && opts.signs ? opts.signs.every((s) => s === opts.signs[0]) : null,
      scope: 'per-channel detector NOISE (independent residual only); says nothing about whether all three channels are reading the correct waveform feature'
    };
  }
  function sdnnOf(rr) {
    if (!rr || rr.length < 2) return 0;
    const m = mean(rr);
    let s = 0;
    for (let i = 0; i < rr.length; i++) s += (rr[i] - m) * (rr[i] - m);
    return Math.sqrt(s / (rr.length - 1));
  }
  function validatePPI(selfNN, devicePPI, opts) {
    if (!devicePPI) return { hasData: false, filePresent: false };
    if (!devicePPI.length) return { hasData: false, filePresent: true };
    /* `source` names WHICH firmware produced the comparison series, because PpgDex now has two and
       they are not interchangeable: the Verity `_PPI.txt` is a wrist device's own interval estimate,
       while `o2ring-marker` is the finger ring's inserted `156` beat rows. A reader who cannot tell
       them apart cannot judge the result — different sensor, different site, different detector. */
    const source = (opts && opts.source) || 'device-ppi';
    const dev = devicePPI.filter((d) => d.ppi > 300 && d.ppi < 2000 && (d.blocker == null || d.blocker === 0)).map((d) => d.ppi);
    if (dev.length < 3 || selfNN.length < 3) return { hasData: true, filePresent: true, usable: false, source, nDevice: dev.length };
    const devRaw = rmssdOf(dev);
    const sC = _ppiCorrect(selfNN),
      dC = _ppiCorrect(dev);
    const self = sC.out,
      devc = dC.out;
    if (self.length < 3 || devc.length < 3) return { hasData: true, filePresent: true, usable: false, source, nDevice: dev.length };
    const sM = mean(self),
      dM = mean(devc);
    const sR = rmssdOf(self),
      dR = rmssdOf(devc);
    const sS = sdnnOf(self),
      dS = sdnnOf(devc);
    const pct = (a, b) => (b ? r1((100 * Math.abs(a - b)) / b) : null);
    const agree = 100 * (1 - Math.min(1, Math.abs(sM - dM) / dM));
    return {
      hasData: true,
      filePresent: true,
      usable: true,
      source,
      nSelf: self.length,
      nDevice: devc.length,
      selfMean: Math.round(sM),
      devMean: Math.round(dM),
      meanAbsDevMs: Math.round(Math.abs(sM - dM)),
      selfRMSSD: r1(sR),
      devRMSSD: r1(dR),
      selfSDNN: r1(sS),
      devSDNN: r1(dS),
      // Δ as a PERCENT of the device value, the shape ECGDex's verdict pills read.
      dMean: r2(dM ? (100 * Math.abs(sM - dM)) / dM : 0),
      dRMSSD: pct(sR, dR),
      dSDNN: pct(sS, dS),
      // How much artifact each side carried, so a reader can see the correction rather than trust it.
      selfEctopyCorrected: sC.nc,
      devEctopyCorrected: dC.nc,
      devRawRMSSD: r1(devRaw),
      deviceAgreementPct: r1(agree)
    };
  }
  function rmssdOf(rr) {
    let s = 0,
      c = 0;
    for (let i = 1; i < rr.length; i++) {
      const d = rr[i] - rr[i - 1];
      s += d * d;
      c++;
    }
    return Math.sqrt(s / c);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  EPOCHS — 5-min windows over the corrected interval series
  // ════════════════════════════════════════════════════════════════════════
  function buildEpochs(nn, tt, motion, perfWindow, cleanMask, agreeI) {
    const epochs = [];
    if (nn.length < 2) return epochs;
    const epLen = 300; // sec
    const tEnd = tt[tt.length - 1];
    for (let e0 = 0; e0 < tEnd; e0 += epLen) {
      const idx = [];
      for (let i = 0; i < tt.length; i++) {
        if (tt[i] >= e0 && tt[i] < e0 + epLen) idx.push(i);
      }
      if (idx.length < 5) continue;
      const seg = idx.map((i) => nn[i]);
      const segMask = cleanMask ? idx.map((i) => cleanMask[i]) : null; // §4: per-epoch clean adjacency
      const td = timeDomain(seg, segMask);
      if (!td) continue;
      const ls = lombScargle(
        idx.map((i) => tt[i]),
        seg
      );
      /* §3a: average only over beats the inertial stream actually COVERED. `motion.hasData` is a
         SESSION-level fact, so without this an epoch past the end of a short ACC stream averaged a
         run of fabricated zeros into a confident "still" reading. No coverage in this epoch ⇒ null
         (the sensor was off), which then leaves the confidence denominators below. */
      let mi = null;
      if (motion && motion.hasData) {
        const covT = motion.motionCoveredAtSec ? idx.filter((i) => motion.motionCoveredAtSec(tt[i])) : idx;
        if (covT.length) mi = r2(mean(covT.map((i) => motion.motionAtSec(tt[i]))));
      }
      const pi = perfWindow ? perfWindow(e0 + epLen / 2) : null;
      const post = motion && motion.postureDetailAtSec ? motion.postureDetailAtSec(e0, e0 + epLen) : null;
      const position = post ? post.position : 'unknown';
      // §5: mean 3-LED agreement across this epoch's beats (null when single-channel session)
      let ledAgreementPct = null;
      if (agreeI) {
        const av = idx.map((i) => agreeI[i]).filter((v) => v != null);
        if (av.length) ledAgreementPct = Math.round(100 * mean(av));
      }
      epochs.push({
        tMin: Math.round(e0 / 60),
        beats: idx.length,
        hr: td.hr,
        /* Same STATISTIC as ECGDex (60000/mean(RR)) but a different PRECISION: `td.hr` is
           `Math.round(hr)`, so every epoch here is an integer where ECGDex keeps a decimal. A ±0.5
           uniform rounding is SD 0.289 bpm on a hat leg resolving σ≈1.5. Labelled, not changed —
           un-rounding moves every epoch and the fleet has not chosen a precision (R5-FOLLOWUPS). */
        hrStat: 'rate-of-mean',
        meanRR: td.meanRR,
        rmssd: td.rmssd,
        sdnn: td.sdnn,
        pnn50: td.pnn50,
        lf: ls ? ls.lf : null,
        hf: ls ? ls.hf : null,
        vlf: ls ? ls.vlf : null,
        tp: ls ? ls.totalPower : null,
        lfhf: ls ? ls.lfhf : null,
        // §1.6 link 2 — was a hardcoded `null` sitting among computed siblings, which is why the
        // modulation showed up as hf power on every epoch and never as a rate.
        respRate: ls ? ls.respRate : null,
        pi,
        motionIndex: mi,
        ledAgreementPct,
        position,
        positionConf: post ? post.conf : null,
        headingDeg: post ? post.heading : null,
        /* §3a tri-state: `false` used to mean BOTH "the magnetometer saw a clean field" and "there is
           no posture datum for this epoch", and the second reading sat in `magInterferencePct`'s
           denominator as evidence of cleanliness. null = not measured. */
        magInterference: post ? !!post.magInterf : null
      });
    }
    return epochs;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  fmt helpers (Clock Contract — always getUTC*)
  // ════════════════════════════════════════════════════════════════════════
  function pad2(x) {
    return (x < 10 ? '0' : '') + x;
  }
  function fmtClock(ms) {
    if (ms == null) return '—';
    const d = new Date(ms);
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }
  function fmtClockSec(ms) {
    if (ms == null) return '—';
    const d = new Date(ms);
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
  }
  function fmtDate(ms) {
    if (ms == null) return '—';
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function fmtDateTime(ms) {
    if (ms == null) return '—';
    return fmtDate(ms) + ' ' + fmtClock(ms);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  MAIN PIPELINE
  // ════════════════════════════════════════════════════════════════════════
  function analyze(rec, progress) {
    const P = progress || function () {};
    P(45, 'Ranking optical channels…');
    const sel = pickChannel(rec);
    const raw = rec.ch[sel.idx];

    // §1/§2b: detect on ALL channels (3-LED consensus). rec._preChannels lets the app hand
    // in results already computed in the Web-Worker pool — byte-identical to this serial path
    // (the workers run detectChannel's own source). compute()/tests never set it, so this
    // in-thread detect is the numeric source of truth the gates verify.
    P(55, 'Optical beat detection · 3-LED (systolic feet)…');
    // Sentinel gaps (finger site only) are held over BEFORE the biquad — see holdOverGaps: a
    // known-invalid 156 left in as an amplitude rings the filter around every gap. Beats that
    // actually touch a gap are dropped below, so nothing reported rests on a held sample.
    const chIn = rec.gap ? rec.ch.map((c) => holdOverGaps(c, rec.gap)) : rec.ch;
    const perChannelAll = rec._preChannels && rec._preChannels.length === rec.ch.length ? rec._preChannels : chIn.map((c) => detectChannel(c, rec.fs));
    // Degenerate-channel guard: collapse bit-identical duplicates BEFORE the consensus vote, so a
    // replicated single-sensor stream (the O2Ring finger pleth) takes consensusBeats' honest
    // `nCh < 2` path — beats pass through, agreement reports null — instead of voting with itself
    // and scoring a structurally-guaranteed 100%. Genuine 3-LED Verity captures are untouched
    // (three real photodiodes are never bit-identical), so this is export-inert for them.
    const keepIdx = distinctChannelIdx(rec.ch);
    const perChannel = keepIdx.map((c) => perChannelAll[c]);
    /* ── CONSENSUS POLARITY (PPGDEX-ALGORITHM-DEEP-DIVE §6.2 / E-5) ────────────────────────────────
       `orient` decides each channel's polarity ALONE, from the sign of its derivative-skewness with a
       hard threshold at zero. Three co-located photodiodes on one device share a polarity convention,
       so a channel whose skew sits near zero can flip against two confident siblings on noise.

       When that happens the consequence is silent and total: the inverted channel's "systolic peaks"
       land on the opposite phase of the pulse — measured at a fixed ~236 ms, 4.7x the ±50 ms vote
       window — so it joins NO cluster. `kept3/3` is 0 for the entire night, every surviving beat is
       2-of-3, and the 3-LED vote runs as a 2-LED vote with no third opinion left to outvote a later
       failure. Measured on 3 of 18 real Verity nights (16.7 %); the exports stayed CORRECT throughout,
       because the two agreeing channels carry the record — what was lost was the redundancy, plus the
       honesty of two statistics (a ~51 % "drop rate" that is a phase offset, not a detection failure,
       and a 2/3 agreement ribbon on a healthy 3-LED capture).

       So a STRICT majority of channels decides the sign for all of them, and dissenters are re-detected
       under it. Deliberately conservative in three ways:
         · only a STRICT majority acts — a 1-1 split on two channels has no majority and is left alone,
           because there is nothing to prefer and inventing a winner would be worse than the symptom;
         · unanimous records (the overwhelming majority, and ALL four committed fixtures) take the
           `size > 1` early-out and are byte-identical — no re-detection, no export movement;
         · it re-runs the SHIPPED detector on the corrected orientation rather than shifting timestamps,
           so nothing is compensated after the fact.
       Measured effect on the three affected nights: kept3/3 0 → 21818 / 15486 / 7925 and 1-of-3 drops
       23202 → 795, 15662 → 67, 8305 → 187, with every inter-channel peak offset collapsing to 0.0 ms. */
    /* The RETURN VALUE matters and was being discarded. It is the number of channels whose polarity
       disagreed with the majority and were re-detected — the only record that the three observers did
       not originally agree, since after this call the signs are unanimous BY CONSTRUCTION. A
       post-consensus unanimity check is therefore vacuous; this count is not. It travels into the
       detector-agreement result below, where it is the one field that can hint at the failure that
       tool is structurally blind to. */
    const polarityFlipped = applyConsensusPolarity(perChannel, (i, sgn) => detectChannel(chIn[keepIdx[i]], rec.fs, sgn));
    // remap the reference channel onto the deduped set; if the best-SNR channel was itself a
    // duplicate, its first occurrence carries the identical waveform, so the reference is preserved.
    const refIdx = Math.max(
      0,
      keepIdx.findIndex((c) => sameChannel(rec.ch[c], rec.ch[sel.idx]))
    );
    // §1 residual: the SNR pick is blind to harmonic counting. If the picked reference doubles where a
    // clean channel majority does not, move the reference onto the majority (inert unless that happens —
    // the adaptive refractory de-doubles every channel on the real corpus, so this is defense-in-depth).
    const _chRates = perChannel.map((pc) => (pc && pc.peaks && pc.peaks.length > 10 && rec.durSec > 0 ? (pc.peaks.length / rec.durSec) * 60 : null));
    const _chSnr = keepIdx.map((c) => (sel.scores && sel.scores[c] ? sel.scores[c].snr : 0));
    const refIdxUsed = harmonicOutlierRefIdx(refIdx, _chRates, _chSnr);
    const bp = perChannel[refIdxUsed].bp; // reference-channel band-passed waveform
    const cons = consensusBeats(perChannel, refIdxUsed, rec.fs);
    /* PER-CHANNEL DETECTOR AGREEMENT (three-cornered hat). Only meaningful with three genuinely
       distinct channels in the same rows — a deduped 1- or 2-channel record, or a replicated one, has
       no third corner and gets null rather than a two-corner approximation. Runs on the CONSENSUS-
       CORRECTED per-channel feet, i.e. the beats the node actually uses. */
    let channelStability = null;
    if (perChannel.length === 3) {
      const toSec = (pc) => Array.from(pc.feet, (i) => rec.relSec[Math.max(0, Math.min(rec.n - 1, Math.round(i)))]).filter(Number.isFinite);
      channelStability = detectorAgreementTriplet([toSec(perChannel[0]), toSec(perChannel[1]), toSec(perChannel[2])], {
        signs: perChannel.map((pc) => pc.sign),
        polarityFlipped: polarityFlipped
      });
      if (channelStability) channelStability.polarityFlipped = polarityFlipped;
    }
    // A beat whose foot→peak span touches a rejected sentinel is a GAP, not a measurement — its
    // timing would rest on held values. Drop it. This is the same discipline the 3-LED path applies
    // to a 1-of-3 beat: dropped, never median-filled, never interpolated.
    let nGapBeats = 0;
    /* §4 — per-INTERVAL: true where the interval BRIDGES one or more beats §3 removed. Null until a
       drop actually happens, so a file with no gap allocates nothing and behaves exactly as before. */
    let bridged = null;
    if (rec.gap) {
      const bad = gapBeats(cons.peaks, cons.feet, rec.gap);
      nGapBeats = bad.size;
      if (bad.size) {
        /* A dropped beat leaves its two surviving NEIGHBOURS adjacent in the array but NOT adjacent in
           TIME — the interval between them silently spans the removed beat and reads ~2x true. That
           bridge is a fabrication: `correctRR` sees a doubled interval, flags it, and median-fills, so a
           guard meant to protect the record ends up inventing a value for every beat it removes.
           Recorded here so the interval can be EXCLUDED downstream rather than corrected into a
           plausible lie — the same discipline the 3-LED path applies to a 1-of-3 beat (§3).

           Note `bridged` is indexed by INTERVAL over the SURVIVING beats: one entry per adjacent pair
           of kept beats, which is exactly `nn`'s indexing after the filter below. */
        bridged = [];
        for (let k = 0, prevKept = -1; k < cons.peaks.length; k++) {
          if (bad.has(k)) continue;
          if (prevKept >= 0) bridged.push(k - prevKept > 1); // >= 1 beat removed between them
          prevKept = k;
        }
        const keep = (arr) => (arr ? arr.filter((_, k) => !bad.has(k)) : arr);
        cons.peaks = keep(cons.peaks);
        cons.feet = keep(cons.feet);
        cons.agree = keep(cons.agree);
      }
    }
    const det = { peaks: cons.peaks, feet: cons.feet, T: 0 };

    P(62, 'Motion gate (ACC + GYRO)…');
    const motion = analyzeMotion(rec.acc, rec.gyro, rec.t0Ms, rec.durSec, rec.magn);
    const motionAt = motion.hasData ? (samp) => /** @type {any} */ (motion).motionAtSec(rec.relSec[Math.max(0, Math.min(rec.n - 1, Math.round(samp)))]) : null;

    P(68, 'Per-beat SQI (× 3-LED agreement)…');
    // Single channel ⇒ no vote to fold in; cadence corroboration stands in for it (§4), and only
    // there — a 3-LED session passes `regular = null` and its SQI is byte-unchanged.
    const regular = cons.singleChannel ? beatRegularity(det.peaks, rec.fs) : null;
    const sqi = beatSQI(bp, det.peaks, rec.fs, motionAt, cons.agree, regular);

    // foot times (sec, absolute rel) — interpolate relSec at fractional foot index
    const footSec = det.feet.map((f) => {
      const i0 = Math.floor(f),
        i1 = Math.min(rec.n - 1, i0 + 1),
        fr = f - i0;
      return rec.relSec[i0] * (1 - fr) + rec.relSec[i1] * fr;
    });
    const peakSec = det.peaks.map((p) => rec.relSec[Math.max(0, Math.min(rec.n - 1, p))]);

    P(74, 'PPI + HRV…');
    // ── PPI SPINE — foot-to-foot by default, 3-LED-VOTED peak-to-peak as the fallback ──────────
    // Foot-to-foot is the PREFERRED interval (systolic feet are amplitude-invariant, so PPI does not
    // ride pulse-amplitude drift) and stays the default. But the two halves of a beat are NOT equally
    // trustworthy: `cons.peaks` is the 3-LED CONSENSUS spine (a beat survives only where ≥2 of 3
    // channels agree within ±50 ms — reference-INDEPENDENT), while `cons.feet` is `refineFeet(refBp…)`
    // re-derived on the SINGLE reference channel that pickChannel scored highest. pickChannel ranks by
    // pulse-band SNR (0.7–3.0 Hz) over ONE 90 s mid-record window — and a channel counting HARMONICS
    // still lands in that band (a doubled 48 bpm = 96 bpm = 1.6 Hz), so a corrupted LED can be chosen
    // as the reference. When that happens the vote's robustness is thrown away exactly where it counts:
    // the peak spine stays correct while the feet collapse, and foot-to-foot PPI reads 2–3× the true HR.
    // Observed on the real trio corpus (2026-06-30): consensus peaks → 50.6 bpm (chest ECG: 50.0) while
    // every reference channel's feet → 80–132 bpm.
    // So: measure BOTH off the same spine and cross-check. Agreement ⇒ keep feet (clean records are
    // byte-identical to before — no fixture churn). Disagreement ⇒ the SINGLE-channel half is the
    // unreliable one; fall back to the VOTED peak spine. `ppiAgreementPct` is surfaced either way, so a
    // record where BOTH halves are broken (all 3 LEDs mis-detecting) is visibly flagged rather than
    // silently shipping a plausible-looking wrong HR.
    // Build BOTH spines off the same consensus beats, Malik-correct each, and let the CORRECTION RATE
    // arbitrate (see PPI_SPINE_MARGIN_PP): the spine that needs less repair is the physiologically
    // coherent one. Feet stay the default and are displaced only by a clear margin, so a clean record —
    // where both halves need identical repair — keeps its foot spine and its export stays byte-identical.
    // `ppiAgreementPct` is reported alongside: it does not DECIDE the spine, but a low value means the two
    // halves disagree, and when the WINNING spine still needs heavy correction the optical HR is not
    // trustworthy at all (both halves broken — all 3 LEDs mis-detecting). That is the honest flag.
    const _ppiFoot = buildPPI(footSec),
      _ppiPeak = buildPPI(peakSec);
    const _corrFoot = correctRR(_ppiFoot.rr, _ppiFoot.tt),
      _corrPeak = correctRR(_ppiPeak.rr, _ppiPeak.tt);
    const _rateFoot = _ppiFoot.rr.length ? (100 * _corrFoot.nCorr) / _ppiFoot.rr.length : 100;
    const _ratePeak = _ppiPeak.rr.length ? (100 * _corrPeak.nCorr) / _ppiPeak.rr.length : 100;
    const footSpineOK = !(_ratePeak < _rateFoot - PPI_SPINE_MARGIN_PP);
    const _mFoot = median(_corrFoot.nn),
      _mPeak = median(_corrPeak.nn);
    const ppiAgreement = _mFoot > 0 && _mPeak > 0 ? Math.min(_mFoot, _mPeak) / Math.max(_mFoot, _mPeak) : 0;
    const ppiSpine = footSpineOK ? 'foot' : 'peak';
    const { rr, tt } = footSpineOK ? _ppiFoot : _ppiPeak;
    const corr = footSpineOK ? _corrFoot : _corrPeak;
    const nn = corr.nn;
    /* PER-BEAT FUSED-HAT CONFIDENCE for the emitted spine (TRIO-ARTIFACT-GATE — the `ms;hr;c` corpus).
       `beatConfidence` keys by ABSOLUTE second via `peaks[k]/fs`, so beat TIMES are handed back as
       pseudo-sample indices (`round(sec*fs)`) — the same conversion `sensor-trio-worker.js` does, and
       necessary because `rec.relSec` is not a uniform i/fs grid once a stream has gaps.
       ⚠ ONE DELIBERATE DIVERGENCE FROM THE WORKER, stated because it moves published numbers slightly:
       the worker re-derived its own SQI at FEET with no motion gate (`beatSQI(bp, cons.feet, fs, null,
       agree)`) because the export gave it nothing to read. This uses the node's OWN authoritative
       per-beat `sqi` — motion-gated, cadence-corroborated on single-channel — which is the number this
       node stands behind. `beatConfidence` normalises against the record's own median SQI, so a
       constant offset between the two largely cancels; the residual difference is real and is why the
       re-fitted σ is not expected to reproduce the old figure to the last decimal. */
    const _confSpine = footSpineOK ? footSec : peakSec;
    /* DEEP-AUDIT-VI F10 — `beatConfidence` sizes four Float64Array(S) from the SPAN of what it is
       handed, and here it is handed time-derived pseudo-indices (`round(footSec·fs)`), not sample
       indices — so the ECGDex note "beatConfidence is safe by construction" is true for ECG and false
       at this call. One in-file sensor-clock rebase stretches footSec by years and the allocation
       killed the whole night's export. Refuse the span here rather than inside the mirror (which is
       genuinely count-bounded on ECG): ppiConf becomes null, which the export site already tolerates
       (`conf: … : null`), and the rest of the record survives. */
    const _confSpanS = _confSpine.length > 1 ? _confSpine[_confSpine.length - 1] - _confSpine[0] : 0;
    const _confSpanOK = isFinite(_confSpanS) && _confSpanS <= PPG_MAX_SPAN_S;
    const _pConfMap = _confSpanOK
      ? beatConfidence(
          _confSpine.map((s) => Math.round(s * rec.fs)),
          sqi,
          rec.fs,
          rec.t0Ms || 0
        )
      : null;
    const _t0 = rec.t0Ms || 0;
    const ppiConf = _pConfMap
      ? corr.tt.map((s) => {
          const c = _pConfMap.get(Math.floor((_t0 + s * 1000) / 1000));
          return Number.isFinite(c) ? +c.toFixed(3) : 1;
        })
      : null;
    // OXYDEX-PULSE-RESOURCING §Phase 4: whole-record CVHR from the corrected NN series (autonomic
    // apnea correlate). Emitted for every PPG record; the Integrator only corroborates the FINGER one
    // (the O2Ring's own pleth) against ECGDex cardiac CVHR. index = events/hour (0 = none detected).
    /* OBSERVED seconds for the index's denominator (DEEP-AUDIT-VI F3 port). Measured here with the
       SAME rule ECGDex applies to its own beat series — inter-beat deltas over the gap cut are dead
       time, not a long interval — rather than reusing `ppgCoverage`, which answers the neighbouring
       question about the SAMPLE stream: a hole in the samples and a hole in the accepted beat series
       are not the same set, and the denominator has to match the series the events came from. */
    const PPG_CVHR_GAP_S = 10; // ECGDex `GAP_S` — one cut, so the two nodes' indices stay comparable
    let _cvhrActiveSec = 0;
    for (let k = 1; k < corr.tt.length; k++) {
      const _d = corr.tt[k] - corr.tt[k - 1];
      if (_d > 0 && _d <= PPG_CVHR_GAP_S) _cvhrActiveSec += _d;
    }
    const _cvhr = cvhrFromNN(corr.nn, corr.tt, _cvhrActiveSec);
    // §4: per-interval CLEAN-adjacency mask — interval i (between beat i & i+1) is clean when it
    // was NOT correction-flagged AND both endpoint beats cleared SQI≥0.5 (SQI folds the 3-LED
    // agreement, §5). rMSSD/pNN50/SD1 are computed over clean adjacent pairs so sub-ectopy optical
    // jitter + gap boundaries can't inflate them; SDNN stays whole-record dispersion.
    // …and an interval that STRADDLES A TIME DISCONTINUITY is not a measurement at all (§2 above):
    // real time passed with no signal, so the foot-to-foot difference across the hole may span one or
    // more absent beats. Excluded here rather than corrected, because there is nothing to correct to.
    // Fires on nothing without an honest gap in the source — every legacy file's grid is contiguous.
    const spansTime = intervalsSpanningTimeGap(rec.relSec, rec.fs, footSpineOK ? det.feet : det.peaks, nn.length);
    /* §4 — an interval that BRIDGES a beat §3 removed is the same kind of non-measurement, arrived at a
       different way: the beat between its endpoints was deleted, so the difference spans ~2 true
       intervals. It is invisible to `intervalsSpanningTimeGap`, which reads the SOURCE grid — and a
       dropped beat leaves no discontinuity in `relSec`, every sample is still present. (That blindness
       is by design, and is why §4 sat deferred behind `nGapSpanIntervals: 0 -> 0`: the counter watched
       to decide whether §4 fires is the one quantity guaranteed not to respond. §4a.) */
    const spansGap = new Array(nn.length);
    for (let i = 0; i < nn.length; i++) spansGap[i] = !!spansTime[i] || !!(bridged && bridged[i]);
    let nGapSpanIntervals = 0;
    const cleanMask = new Array(nn.length);
    for (let i = 0; i < nn.length; i++) {
      const q0 = sqi[i] != null ? sqi[i] : 1,
        q1 = sqi[i + 1] != null ? sqi[i + 1] : 1;
      if (spansGap[i]) nGapSpanIntervals++;
      cleanMask[i] = corr.flags[i] === 0 && q0 >= 0.5 && q1 >= 0.5 && !spansGap[i];
    }
    // §5: per-interval mean LED agreement (null when single-channel) for the per-epoch ribbon
    const agreeI = cons.singleChannel ? null : new Array(nn.length);
    if (agreeI) {
      for (let i = 0; i < nn.length; i++) {
        const a0 = cons.agree[i],
          a1 = cons.agree[i + 1];
        agreeI[i] = a0 != null && a1 != null ? (a0 + a1) / 2 : a0 != null ? a0 : a1 != null ? a1 : null;
      }
    }
    const td = /** @type {any} */ (timeDomain(nn, cleanMask, spansGap) || {});
    const poin = poincare(nn, cleanMask);
    /* ── #2 treatment (1): the frequency domain must not see correctRR's substitutes ──────────────
       A rejected interval is replaced by the local-median reference and pushed into `nn`, so at this
       file's own correction rates a real share of the series is a repeated constant. `timeDomain`
       and `poincare` already refuse those via `cleanMask`; `lombScargle` did not, and a constant run
       is not spectrally neutral — it is power at DC that the detrend spreads across the band.

       Dropping is the RIGHT treatment here and only here. Lomb-Scargle exists to analyse
       IRREGULARLY sampled series: it consumes (time, value) pairs and has no notion of adjacency, so
       removing a sample removes exactly that sample. `dfaAlpha1` and `sampEn` below read SEQUENCE
       STRUCTURE, where the same removal would splice two non-adjacent beats together and fabricate a
       pattern — a fabricated ADJACENCY in place of a fabricated value. They are deliberately left
       alone; see the brief's "#2 RE-SCOPED" block.

       Sparse-clean records degrade HONESTLY rather than silently: `lombScargle` already refuses
       under 8 samples (`return null`), and every frequency consumer already handles a null block. */
    const _fqT = [],
      _fqV = [];
    for (let i = 0; i < nn.length; i++) {
      if (cleanMask[i]) {
        _fqT.push(corr.tt[i]);
        _fqV.push(nn[i]);
      }
    }
    const freq = lombScargle(_fqT, _fqV);
    const dfa1 = dfaAlpha1(nn);
    const se = sampEn(nn);

    // perfusion index over windows (AC/DC) for epochs/morph hand-off
    const dc = mean(Array.from(raw).map(Math.abs));
    const acAmp = std(bp);
    const perfWindow = () => (dc > 0 ? r2((100 * acAmp) / dc) : null);

    P(80, 'Epochs…');
    const epochs = buildEpochs(nn, corr.tt, motion, perfWindow, cleanMask, agreeI);

    // quality
    const meanSQI = sqi.length ? r2(mean(sqi)) : 0;
    const cleanBeats = sqi.filter((s) => s >= 0.5).length;
    const cleanBeatPct = sqi.length ? Math.round((100 * cleanBeats) / sqi.length) : 0;
    const motionRejected = motion.hasData ? det.peaks.filter((p, k) => /** @type {any} */ (motionAt)(p) > 0.5).length : 0;
    const motionRejectedPct = det.peaks.length ? r1((100 * motionRejected) / det.peaks.length) : 0;
    const correctionRate = rr.length ? r1((100 * corr.nCorr) / rr.length) : 0;
    const analyzablePct = Math.round(cleanBeatPct * (1 - motionRejectedPct / 100));
    // magnetometer interference coverage (informational — does not alter SQI/conf)
    // §3a: epochs with no posture datum leave the DENOMINATOR — they are not evidence of a clean field.
    const magKnown = epochs.filter((e) => e.magInterference != null);
    const magEpochs = magKnown.filter((e) => e.magInterference).length;
    const magInterferencePct = motion.hasMag && magKnown.length ? Math.round((100 * magEpochs) / magKnown.length) : null;

    // ── Segment-wise SDNN (SDNN-VS-ECG-GROUND-TRUTH, validated on the 2026-07-07 paired night) ──
    // Whole-record SDNN folds in SDANN (drift BETWEEN 5-min means) + a few motion/artifact epochs,
    // which optical baseline-wander/PTT inflates most → +26% vs chest ECG. Segment-wise aggregation
    // removes both: sdnnIndex (mean per-5-min SDNN, Task-Force); the QUALITY-GATED MEDIAN of per-5-min
    // SDNN removes the most. These are additive; whole-record `sdnn` is unchanged.
    //
    // THE BIAS MAGNITUDES ARE NOT QUOTED, deliberately (PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS §1,
    // owner-ratified 2026-08-04). The former +26/+18/+3.5% came from ONE paired night (2026-07-07).
    // Re-derived with the committed apparatus on the multi-night corpus, sdnnRobust reads +10.8%
    // (finger) and +18.7% (Verity) against ECGDex's dispSd — so +3.5% does not reproduce, and it was
    // shipping to users inside `sdnnNote` as an accuracy claim. The gap is NOT attributable (corpus,
    // method and the original figure are indistinguishable with no committed original), so the number
    // is withdrawn rather than replaced: swapping one unverifiable constant for another repeats the
    // defect in fresher paint. The ORDERING — whole > index > robust — is what was actually observed
    // and is what the note now states.
    // Same gate extends to the long-term-dominated metrics that inherit the SDANN inflation:
    // SD2 (whole +54% → robust +4%), LF/HF band power (whole totalPower +89% → gated-median LF+HF +7%).
    // VLF is deliberately NOT robust-corrected — a 5-min epoch can't resolve <0.04 Hz — it stays
    // flagged. Residual HF (+17%) is genuine respiratory PTT — but its excess is MOTION-DRIVEN
    // (+43% high-motion vs +12% low-motion on the paired night), so a low-motion HF + a GRADED
    // per-metric confidence (below) turn the blanket flag into an earned, continuous score.
    let sdnnIndex = null,
      sdnnRobust = null,
      sdnnRobustNEpochs = 0,
      sdnnRobustBasis = null,
      sd2Robust = null,
      lfRobust = null,
      hfRobust = null,
      vlfRobust = null,
      tpRobust = null,
      lfhfRobust = null,
      hfRobustLowMotion = null,
      hrvConfidence = null;
    if (epochs.length) {
      const segAll = epochs.map((e) => e.sdnn).filter((v) => v != null && isFinite(v));
      if (segAll.length) {
        sdnnIndex = r1(mean(segAll));
        /* THE QUALITY GATE MUST NOT ADMIT AN EPOCH IT NEVER MEASURED (DEEP-AUDIT-IV §1 — bug class 3a).
           This read `e.motionIndex == null || e.motionIndex <= 0.5`, and `motionIndex` is null for
           exactly one reason: the inertial stream was NOT RECORDING during that epoch (:2536-2539
           averages only beats the ACC actually covered). So a night whose ACC ends early fed
           UNOBSERVED epochs into every robust HRV metric as if they had been verified still — while
           genuinely-moving VERIFIED epochs were correctly excluded. Measured on a 40-min synthetic
           whose ACC covers the first 25 min:
               shipped gate → 6 epochs → sdnnRobust 39.0 ms
               honest  gate → 3 epochs → sdnnRobust 15.8 ms   (2.5x)
           and the same run split `hfRobust` 932 vs `hfRobustLowMotion` 115 — the fixed sibling 25
           lines below (:2902 `motKnown`) and this unfixed one disagreeing 8x on identical input.

           WHY FOUR PRIOR PASSES MISSED IT, including the §3a fix that shipped in this very file:
           MULTI-SENSOR-DERIVATIONS-FOLLOWUPS §1 measured on the committed twins, NEITHER OF WHICH
           CARRIES ACC — and with zero coverage the buggy and honest gates return the IDENTICAL number
           (every epoch null → `<3` → the ungated fallback). The defect exists only under PARTIAL
           coverage, which no committed fixture could express.

           The LED half's `== null` exemption stays: it is deliberate and documented (a single-channel
           session has no agreement to report). Only the motion half was never meant to be there. */
        const gatedEp = epochs.filter((e) => e.sdnn != null && isFinite(e.sdnn) && e.motionIndex != null && e.motionIndex <= 0.5 && (e.ledAgreementPct == null || e.ledAgreementPct >= 67));
        const usable = gatedEp.length >= 3 ? gatedEp : epochs.filter((e) => e.sdnn != null && isFinite(e.sdnn));
        /* NAME THE FALLBACK, or the fix trades a wrong number for an unattributable one. With the
           null epochs excluded a partial-ACC night lands under the `<3` threshold more often and
           silently falls back to the UNGATED median — a different quantity wearing the same field
           name. Publish which one produced it, exactly as `apnea.overlapCoverage.basis`
           ('recorded'/'envelope') already does for the Integrator's overlapHours. */
        sdnnRobustBasis = gatedEp.length >= 3 ? 'gated' : 'ungated-fallback';
        const pool = usable.map((e) => e.sdnn);
        sdnnRobust = r1(median(pool));
        sdnnRobustNEpochs = pool.length;
        // SD2 from the robust dispersion + whole-record clean SD1 (beat-to-beat, already un-inflated)
        const sd1 = poin ? poin.sd1 : null;
        if (sd1 != null && sdnnRobust != null) sd2Robust = r1(Math.sqrt(Math.max(0, 2 * sdnnRobust * sdnnRobust - sd1 * sd1)));
        // robust frequency = gated-median of per-epoch bands (per-epoch spectrum drops the SDANN/VLF drift)
        const lfA = usable.map((e) => e.lf).filter((v) => v != null && isFinite(v));
        const hfA = usable.map((e) => e.hf).filter((v) => v != null && isFinite(v));
        const lhA = usable.map((e) => e.lfhf).filter((v) => v != null && isFinite(v));
        const vlA = usable.map((e) => e.vlf).filter((v) => v != null && isFinite(v));
        if (lfA.length >= 3) lfRobust = r1(median(lfA));
        if (hfA.length >= 3) hfRobust = r1(median(hfA));
        if (lhA.length >= 3) lfhfRobust = r2(median(lhA));
        if (vlA.length >= 3) vlfRobust = r1(median(vlA));
        // DEEP-AUDIT §10: totalPower is DEFINED as the sum of the reported bands, so vlf+lf+hf == tp exactly.
        if (vlfRobust != null && lfRobust != null && hfRobust != null) tpRobust = r1(vlfRobust + lfRobust + hfRobust);
      }
      // (a) MOTION-GATED HF — HF excess is motion-driven, so a low-motion-only median approaches the
      // clean floor (~+12% vs ECG) rather than the mixed +17%. Stricter gate than the shared 0.5.
      const MOT_STRICT = 0.15;
      /* §3a — THE DENOMINATOR. `motionIndex == null` used to be admitted here as low motion, so a
         session with no accelerometer scored `lowMotionFrac: 1` ("perfectly still all night") off a
         sensor that never recorded, and `hfRobustLowMotion` — a metric whose NAME is its gate —
         was the median over every epoch, unfiltered. Measured on both committed twins, neither of
         which carries ACC: lowMotionFrac 1, postureStableFrac 1, hf confidence 0.97 / 0.56 with the
         motion term contributing a phantom 1.0. Unmeasured epochs now leave the pool AND the count.  */
      const motKnown = epochs.filter((e) => e.motionIndex != null);
      const lowMot = motKnown.filter((e) => e.motionIndex <= MOT_STRICT);
      const hfLM = lowMot.map((e) => e.hf).filter((v) => v != null && isFinite(v));
      if (hfLM.length >= 3) hfRobustLowMotion = r1(median(hfLM));
      // (b) GRADED per-metric confidence (0..1) from measured drivers — replaces the binary flag.
      // Each metric family is scored by the cause that predicts ITS error (validated on paired night):
      // motion→hf, posture/baseline drift→vlf/sdnn, coverage+correction→beat-to-beat.
      const qCov = Math.max(0, Math.min(1, analyzablePct / 100));
      const qCorr = Math.max(0, 1 - correctionRate / 25);
      // §3a: the rate among epochs that HAVE motion evidence — null when none do.
      const qLowMotion = motKnown.length ? lowMot.length / motKnown.length : null;
      /* Posture stability over ADJACENT PAIRS THAT ARE BOTH KNOWN. Counting `'unknown'` as a position
         was wrong in both directions at once: a session with no posture data at all had zero
         transitions and scored a perfect 1.0 ("never shifted"), while a session that merely LOST the
         sensor mid-night scored two spurious shifts on the way out of and back into `'unknown'`. */
      let posShift = 0,
        posPairs = 0;
      for (let i = 1; i < epochs.length; i++) {
        if (epochs[i].position === 'unknown' || epochs[i - 1].position === 'unknown') continue;
        posPairs++;
        if (epochs[i].position !== epochs[i - 1].position) posShift++;
      }
      const qPosture = posPairs ? 1 - posShift / posPairs : null;
      const durFactor = Math.max(0, Math.min(1, rec.durSec / 60 / 60)); // VLF needs a long record
      const c = (v) => r2(Math.max(0, Math.min(1, v)));
      /* A CONFIDENCE WHOSE DRIVER WAS NEVER MEASURED IS `null`, NOT A NUMBER (§3a, top severity).
         These are documented as "graded per-metric confidence from MEASURED drivers"; letting an
         absent driver multiply in as 1.0 published exactly the manufactured grade that phrase denies —
         0.97 HF confidence, "motion-graded", on a recording with no accelerometer. `null` = unknown,
         the same currency the rest of this module uses, and `evidence` below says which driver is
         missing so the null is diagnosable rather than merely blank. Note this is deliberately NOT a
         re-calibration: no weight was retuned and no constant invented — a term that cannot be
         evaluated makes its metric unknown. */
      const evidence = {
        motion: motKnown.length === 0 ? 'none' : motKnown.length < epochs.length ? 'partial' : 'full',
        posture: posPairs === 0 ? 'none' : posPairs < epochs.length - 1 ? 'partial' : 'full',
        motionEpochs: motKnown.length,
        posturePairs: posPairs,
        epochs: epochs.length
      };
      hrvConfidence = {
        beatToBeat: c(qCov * qCorr), // rmssd, sd1, pnn50 — already ECG-accurate; no inertial driver
        // + sd2 (robust); posture-drift aware
        sdnn: qPosture == null ? null : c(qCov * qCorr * (0.6 + 0.4 * qPosture)),
        lf: c(qCov * qCorr),
        hf: qLowMotion == null ? null : c(qLowMotion * qCov), // motion-graded (the earned part)
        // capped: single-site optical VLF inherently baseline-limited
        vlf: qPosture == null ? null : c(Math.min(0.7, qPosture * durFactor)),
        evidence,
        drivers: {
          analyzableFrac: r2(qCov),
          correctionOK: r2(qCorr),
          lowMotionFrac: qLowMotion == null ? null : r2(qLowMotion),
          postureStableFrac: qPosture == null ? null : r2(qPosture),
          motionCoveredFrac: motion.hasData && motion.motionCoveredFrac != null ? motion.motionCoveredFrac : null
        },
        note: '0..1 per-metric confidence from measured drivers (motion\u2192hf, posture/baseline\u2192vlf/sdnn, coverage+correction\u2192beat-to-beat). vlf capped 0.7 — single-site optical VLF stays baseline-wander-limited even when clean; not a defect to "fix". A metric is null when its driver was NOT MEASURED (see `evidence`): a session with no accelerometer has no motion-graded hf, and publishing one would be a grade resting on nothing.'
      };
    }

    // §5: whole-record 3-LED agreement + the per-5-min ribbon series (all clusters incl dropped 1/3)
    let ledAgreementPct = null,
      ledAgree3of3Pct = null,
      ledSeries = null;
    if (!cons.singleChannel) {
      const kept = cons.agree.filter((a) => a != null);
      ledAgreementPct = kept.length ? Math.round(100 * mean(kept)) : null;
      ledAgree3of3Pct = cons.kept33 + cons.kept22 > 0 ? Math.round((100 * cons.kept33) / (cons.kept33 + cons.kept22)) : null;
      const epLen = 300,
        bins = {},
        relOf = (s) => rec.relSec[Math.max(0, Math.min(rec.n - 1, Math.round(s)))];
      cons.clusters.forEach((c) => {
        const e = Math.floor(relOf(c.s) / epLen);
        if (!bins[e]) bins[e] = { c1: 0, c2: 0, c3: 0 };
        if (c.nAgree >= 3) bins[e].c3++;
        else if (c.nAgree === 2) bins[e].c2++;
        else bins[e].c1++;
      });
      ledSeries = Object.keys(bins)
        .map((e) => {
          const b = bins[e],
            tot = b.c1 + b.c2 + b.c3 || 1;
          return { tMin: +e * 5, f3: r2(b.c3 / tot), f2: r2(b.c2 / tot), f1: r2(b.c1 / tot), n: tot };
        })
        .sort((a, b) => a.tMin - b.tMin);
    }
    /* §3: coverage/SQI gate — a sparse / heavily-corrected record must not publish an
       unqualified whole-record short-term HRV (it would feed the Integrator consensus axis a
       jitter-inflated number). Keep the values but STAMP low-confidence + reason (option b),
       applied consistently to hrv.time/poincare/frequency in the exports. Inert on good data.

       MULTINIGHT-CORPUS-FINDINGS §2 — the coverage test alone CANNOT see the failure it most
       needs to. Six of 37 corpus nights published whole-record rMSSD of 91–188 ms against a chest
       ECG reading 26–42 ms on the same night, all six with `lowConfidence: false`, because every
       coverage field was healthy: analyzable 96–100 %, correction 2.5–13 %, LED agreement 96–100,
       motion-rejected ≤ 1.7. The contamination is not missing data, it is a SHAPE — an alternating
       short/long interval sequence (epoch lf/hf collapses to 0.1–0.6 against 0.4–5.4 on a clean
       night: energy piled at the RR-series Nyquist), most likely intermittent dicrotic-notch
       locking in the foot detector. No threshold on coverage reaches it without also rejecting
       good nights.

       The shape test is free and needs no new statistic: over a whole night, successive-difference
       dispersion cannot exceed overall dispersion, so `rmssd > sdnnRobust` is not a physiological
       state — it is a detector artifact. It holds on all six and on none of the other 31, and the
       two next-most-divergent nights (2026-07-01 61.7 vs 64.1, 07-02 52.0 vs 57.9) sit just under
       the line, so the ordering is real rather than a coincidence of six.

       `sdnnRobust` is the right comparand rather than `sdnn`: whole-record `sdnn` runs high on
       optical through SDANN/baseline-wander inflation (see sdnnNote below), which would mask the
       violation. Both are already computed above; nothing new is measured. Guarded on presence —
       a record too short for the robust median (`sdnnRobust` null) simply does not get the test,
       because an absent comparand is not evidence of good shape. */
    const hrvShapeViolation = hrvShapeViolates(td.rmssd, sdnnRobust);
    const hrvLowConfidence = analyzablePct < 60 || correctionRate > 20 || hrvShapeViolation;
    const hrvLowConfidenceReason = hrvShapeViolation
      ? 'interval-shape violation — rMSSD ' +
        r1(td.rmssd) +
        ' ms exceeds sdnnRobust ' +
        r1(sdnnRobust) +
        ' ms, which a whole night cannot do physiologically; the interval series is alternating (detector artifact, not autonomic tone) → whole-record short-term HRV unusable; use per-5-min epochs[] and prefer a chest-ECG leg'
      : hrvLowConfidence
        ? 'low coverage — analyzable ' + analyzablePct + '% / correction ' + correctionRate + '% → whole-record short-term HRV down-weighted; use per-5-min epochs[] + ledAgreementPct'
        : null;

    // tier (mirror ECGDex)
    const durMin = rec.durSec / 60;
    let tier = 'short',
      tierMsg = '';
    if (durMin < 1) {
      tier = 'ultra-short';
    } else if (durMin < 5) {
      tier = 'ultra-short';
    } else if (durMin < 90) {
      tier = 'short';
    } else tier = 'overnight';
    const longRec = durMin >= 90;
    tierMsg = {
      'ultra-short': 'Ultra-short — rMSSD/pNN50/SD1/HF valid; SDNN/LF/VLF withheld',
      short: '5-min standard window — full short-term suite valid',
      overnight: 'Overnight — CVHR & per-epoch medians unlocked'
    }[tier];

    // morphology (ppgdex-morph.js)
    let morph = null;
    if (global.PPGMorph) {
      try {
        morph = global.PPGMorph.analyze(bp, raw, det, rec.fs, sqi);
      } catch (e) {
        morph = null;
      }
    }

    /* Per-channel detector agreement (three-cornered hat). Null unless the record has three distinct
       channels — see `detectorAgreementTriplet`, and read its `scope` before drawing a conclusion:
       this is per-channel NOISE, not per-channel correctness. */
    // PPI validation lane
    /* TWO firmware sources, and the O2Ring one needs no companion file. A Verity night brings its own
       `_PPI.txt` (when box-captured); an O2Ring finger night brings nothing — but its `156` beat rows
       ARE a firmware interval series, carried in-band in the PPG file itself. Preferring the explicit
       `_PPI.txt` keeps existing behaviour byte-identical wherever one exists; the markers fill the case
       that previously rendered "no device PPI loaded" on every single O2Ring recording.
       Shaped as parseDevicePPI's output so ONE comparison path serves both — a second path would be a
       second place for the two sides to be corrected differently, which is the defect above. */
    let ppiSource = 'device-ppi',
      ppiSeries = rec.devicePPI;
    if ((!ppiSeries || !ppiSeries.length) && rec.beatMarkerSec && rec.beatMarkerSec.length > 3) {
      const mk = [];
      for (let i = 1; i < rec.beatMarkerSec.length; i++) {
        // blocker:0 — the ring publishes no quality flag per marker, and inventing one would be a
        // fabricated field. The range gate inside validatePPI is the only filter these get.
        mk.push({ ppi: (rec.beatMarkerSec[i] - rec.beatMarkerSec[i - 1]) * 1000, blocker: 0 });
      }
      ppiSeries = mk;
      ppiSource = 'o2ring-marker';
    }
    const validation = validatePPI(nn, ppiSeries, { source: ppiSource });
    /* The stability leg needs BOTH detectors' beat TIMES on ONE axis, which is true only for the
       marker source: those rows sit in the same file, on the same `relSec`, as the feet we detected.
       A `_PPI.txt` carries intervals plus the host's ARRIVAL stamps, so differencing against it would
       measure BLE transport jitter on top of detector jitter and report the sum as detector noise —
       a worse answer than none. Null there, and the card says why rather than showing a number that
       does not mean what it appears to. */
    if (validation && validation.usable && ppiSource === 'o2ring-marker' && rec.beatMarkerSec) {
      validation.stability = detectorStability(footSec, Array.from(rec.beatMarkerSec));
    }

    // markers
    const markers = (rec.markers || []).map((mk) => ({ relSec: mk.relSec, type: mk.type }));

    // events (Stage scaffold — autonomic_surge / perfusion_drop / motion_artifact)
    const events = buildEvents({ epochs, nn, tt: corr.tt, t0Ms: rec.t0Ms, motion, det, sqi, peakSec, morph });

    P(92, 'Finalising…');
    const dispHr = longRec && epochs.length ? median(epochs.map((e) => e.hr)) : td.hr;

    return {
      source: rec.source || 'file',
      fname: rec.fname || '',
      /* NODE-EXPORT-DURATION-SEMANTICS §3 — carried through analyze because it is a property of the
         RECORDING, not of the analysis (the same reasoning ECGDex applies to `offsetMin`). Read from
         parsePPG; null propagates as null and is never back-filled from durSec. */
      endEpochMs: rec.endEpochMs != null ? rec.endEpochMs : null,
      fs: rec.fs,
      n: rec.n,
      t0Ms: rec.t0Ms,
      offsetMin: rec.offsetMin,
      durSec: rec.durSec,
      // The SEGMENTS inside that span (INTEGRATOR-GAP-AWARE-OVERLAP part 2) — a property of the
      // recording, not of the analysis, so analyze carries it rather than re-deriving it downstream.
      coverage: ppgCoverage(rec),
      durMin: r1(durMin),
      tier,
      tierMsg,
      longRec,
      relSec: rec.relSec,
      channel: sel.idx,
      channelScores: sel.scores,
      disp: bp,
      peakSamp: det.peaks,
      footSamp: det.feet,
      beatTimes: peakSec,
      footSec,
      sqi,
      nPulses: det.peaks.length,
      nBeats: det.peaks.length,
      hr: td.hr,
      dispHr,
      dispRm: td.rmssd,
      dispSd: td.sdnn,
      dispPn: td.pnn50,
      meanRR: td.meanRR,
      sdnn: td.sdnn,
      rmssd: td.rmssd,
      pnn50: td.pnn50,
      lnRMSSD: td.lnRMSSD,
      triIdx: td.triIdx,
      sdnnIndex,
      sdnnRobust,
      sdnnRobustNEpochs,
      // DA-IV §1 — which pool produced sdnnRobust: the quality gate, or the ungated fallback.
      sdnnRobustBasis,
      cvhrIndex: _cvhr.index, // §Phase 4 — CVHR events/hour from the finger PPI NN series (autonomic apnea correlate)
      cvhrEvents: _cvhr.events.length,
      // The index's BASIS travels with it (F3 port) — present only when one was computed, so a
      // refusal path stays byte-stable and no committed fixture moves for an inert key.
      ...(_cvhr.denomSec > 0 ? { cvhrDenomSec: _cvhr.denomSec } : {}),
      // F10 — present ONLY when the span refusal fired, so a refused null is told apart from a
      // too-short one; absent otherwise (no committed fixture moves for an inert key).
      ...(_cvhr.reason ? { cvhrReason: _cvhr.reason } : {}),
      sd2Robust,
      lfRobust,
      hfRobust,
      vlfRobust,
      tpRobust,
      lfhfRobust,
      hfRobustLowMotion,
      hrvConfidence,
      nn,
      tt: corr.tt,
      // Aligned with nn/tt: correctRR returns flags for exactly the series it emitted.
      ppiFlags: corr.flags,
      // Aligned with nn/tt the same way — the fused-hat per-beat weight (see the block above).
      ppiConf,
      ...(_confSpanOK ? {} : { ppiConfReason: 'implausible-span' }), // F10 — see the beatConfidence call
      poincareNN: nn,
      sd1: poin ? poin.sd1 : null,
      sd2: poin ? poin.sd2 : null,
      sd1sd2: poin ? poin.sd1sd2 : null,
      ellArea: poin ? poin.ellArea : null,
      freq,
      dfa1,
      sampen: se,
      epochs,
      meanSQI,
      cleanBeatPct,
      analyzablePct,
      coveragePct: cleanBeatPct,
      correctionRate,
      nCorrected: corr.nCorr,
      // PPI-spine cross-check (see the PPI SPINE note in analyze()). Export BOTH spines' correction rates,
      // not just the winner's: the loser's rate is the most discriminating number the node has, and a
      // consumer that throws it away cannot re-derive it. `correctionRate` above is the WINNING spine's.
      //   ppiSpine            'foot' (default) | 'peak' (single-channel feet displaced by the voted spine)
      //   ppiAgreementPct     how closely the two corrected medians agree (100 = the halves concur)
      //   ppiCorrFootPct      correctRR repair rate on the foot spine   ┐ the arbiter's own evidence —
      //   ppiCorrPeakPct      correctRR repair rate on the peak spine   ┘ a coherent series needs few
      // NOTE the WINNING rate alone does NOT cleanly separate good records from bad (2026-06-25 is
      // CORRECT at 28.8% while 2026-06-29 is WRONG at 30.5% — they overlap), so do not gate on it in
      // isolation. The decisive test is CROSS-NODE: compare this HR against a paired chest-ECG corner
      // (Integrator / ECGDex). On the real trio corpus that ratio is 0.99–1.01 on good nights vs 1.6–2.9
      // on records where all 3 LEDs mis-detect — bimodal, with nothing in between. These four fields are
      // what let that consumer make the call with evidence instead of a guess.
      ppiSpine,
      ppiAgreementPct: Math.round(100 * ppiAgreement),
      ppiCorrFootPct: r1(_rateFoot),
      ppiCorrPeakPct: r1(_ratePeak),
      ledAgreementPct,
      ledAgree3of3Pct,
      ledSeries,
      ledSingleChannel: cons.singleChannel,
      // WHICH confidence axis produced `sqi`. Surfaced because the two are not interchangeable and a
      // silent swap is invisible in the number itself: 'led' is a real 2-of-3 optical vote, 'cadence'
      // is the weaker single-channel regularity stand-in (§4). A consumer comparing SQI across sites
      // must know which one it is holding — and a gate can pin it, which a bare SQI cannot.
      // (Added after mutation-testing this brief's own gate: faking a vote on the single-channel path
      // left every other assertion green, because ledAgreementPct is gated on `singleChannel` and
      // never consults the vector, while beatSQI silently swapped axes.)
      beatConfidenceAxis: cons.singleChannel ? 'cadence' : 'led',
      nDroppedBeats: cons.nDropped,
      // ── FINGER SITE (PPGDEX-O2RING-FINGER-SITE) ──
      // `site` is a layout fact from the parser ('wrist' 3-LED Verity | 'finger' 1-channel O2Ring),
      // NOT an inference. Consumers grade morphology by site (§5) instead of inheriting the wrist's.
      site: rec.site || 'wrist',
      /* WHERE THAT VALUE CAME FROM. The layout identifies the DEVICE reliably; it cannot identify the
         LIMB, and a strap goes where the wearer puts it. 'device-default' means nobody has said, so a
         grader must not award a site-validated morphology tier on the strength of it. */
      siteSource: rec.siteSource || 'device-default',
      /* ── WHERE THIS RECORDING'S TIMING CAME FROM (WEARABLE-HOST-AXIS-FOLLOWUPS §F1) ──
         Additive, so no consumer breaks; but a consumer that spends this export as a CLOCK LEG —
         three-cornered hat, three-source closure, PAT — must read `timingSource` first:
           'device+host'  the device reported real timestamps, host-disciplined. Usable as a clock.
           'host'         the device's column was DRAWN (a constant increment standing in for an
                          assumed rate); ALL timing here came from the capture host, and the device
                          contributed sample ORDER only.
           'none'         drawn AND no host anchors — the recording carries no timing information at
                          all. Never use it as a clock leg: TCH assumes three INDEPENDENT sources and
                          a drawn axis is a constant, so it would be measuring its own assumption.
         `axisQuantizedShare` is the evidence (fraction of inter-sample deltas on one value: ~1.0 drawn,
         0.001-0.088 measured), reported as a number so a reader can judge the borderline rather than
         inherit a verdict. */
      timingSource: (rec.hostAxis && rec.hostAxis.timingSource) || null,
      // Which RATE reference governed this recording (O2RING-ADAPTIVE-TIMEBASE): 'device-crystal' (the
      // 125.000 ADC clock, markers deflated) or 'host-disciplined' (the host-referenced row axis) for an
      // O2Ring finger recording; null for a Verity (a real multi-oscillator device, not an either/or).
      timebase: rec.timebase || null,
      axisDrawn: rec.hostAxis ? rec.hostAxis.drawn === true : null,
      axisQuantizedShare: rec.hostAxis && rec.hostAxis.quantizedShare != null ? +rec.hostAxis.quantizedShare.toFixed(4) : null,
      // Sentinel bookkeeping — BOTH classes surfaced, because rejecting every 156 would punch ~7 %
      // of holes into valid signal and reporting only rejections would hide that judgement call.
      sentinelRejected: rec.sentinelRejected || 0,
      sentinelKept: rec.sentinelKept || 0,
      // Beats dropped because their foot→peak span touched a gap (never filled, never interpolated).
      nGapBeats,
      // Intervals excluded because they STRADDLE a time discontinuity — real time the capture lost, so
      // the foot-to-foot difference may span absent beats (O2RING-PPG-GAP §2). Surfaced rather than
      // silently dropped: a night with many of these had a lossy link, and the reader should know.
      nGapSpanIntervals,
      hrvLowConfidence,
      hrvLowConfidenceReason,
      // §2 — WHY the confidence dropped, as a field rather than a substring of the reason. Coverage
      // and shape call for different consumer responses: a sparse night can still be down-weighted
      // and pooled, an alternating one must be discarded outright.
      hrvShapeViolation,
      motion,
      motionRejectedPct,
      magHasData: motion.hasMag,
      magInterferencePct,
      validation,
      /* Per-channel detector agreement, three-cornered hat over the 3 optical channels. Null unless
         the record carries three distinct channels. ⚠️ Read `scope` before concluding anything: this
         is per-channel NOISE (the independent residual), not per-channel correctness — it is blind to
         any error that moves all three channels together, which is the failure that actually shipped
         (#1200, wrong polarity, all three agreeing). `polarity` and `polarityFlipped` travel with it
         so the agreement is never read without the orientation it was computed under. */
      channelStability,
      markers,
      morph,
      perfusionIndex: perfWindow(),
      events,
      // clock fmt helpers exposed for render/export
      _fmt: { fmtClock, fmtClockSec, fmtDate, fmtDateTime }
    };
  }

  function buildEvents(ctx) {
    const ev = [];
    const { epochs, t0Ms, motion, det, sqi, peakSec, nn, tt } = ctx;
    const node = 'PpgDex';
    // local PPG signal quality near a time (mean SQI of beats within ±5 s)
    function sqiAt(relSec) {
      if (!sqi || !sqi.length || !peakSec) return null;
      let a = 0,
        c = 0;
      for (let k = 0; k < peakSec.length; k++) {
        if (peakSec[k] != null && Math.abs(peakSec[k] - relSec) < 5) {
          a += sqi[k];
          c++;
        }
      }
      return c ? r2(a / c) : null;
    }
    // surge magnitude (HR jump, bpm) → likelihood, mirroring ECGDex's mapping so the
    // two cardiac nodes are calibrated alike (R7). SQI rides alongside, not inside conf.
    const surgeConf = (ampBpm) => r2(Math.max(0.45, Math.min(0.9, 0.45 + Math.min(ampBpm || 0, 24) / 48)));
    function evt(relSec, impulse, conf, meta, sqiVal) {
      const tMs = t0Ms != null ? t0Ms + Math.round(relSec * 1000) : null;
      ev.push({ t: fmtClockSec(tMs != null ? tMs : relSec * 1000), tMs, impulse, node, conf: r2(conf), sqi: sqiVal !== undefined ? sqiVal : null, meta: meta || undefined });
    }
    // hrv_drop / autonomic_surge between consecutive epochs
    for (let i = 1; i < epochs.length; i++) {
      const a = epochs[i - 1],
        b = epochs[i];
      if (a.rmssd && b.rmssd) {
        const drop = (a.rmssd - b.rmssd) / a.rmssd;
        if (drop > 0.35)
          evt(
            b.tMin * 60,
            'hrv_drop',
            0.7,
            {
              rmssdFrom: a.rmssd,
              rmssdTo: b.rmssd,
              position: b.position && b.position !== 'unknown' ? b.position : null,
              positionConf: b.positionConf != null ? b.positionConf : undefined,
              magInterference: b.magInterference ? true : undefined
            },
            sqiAt(b.tMin * 60)
          );
      }
      if (a.hr && b.hr && b.hr - a.hr > 8) {
        const amp = Math.round(b.hr - a.hr);
        evt(
          b.tMin * 60,
          'autonomic_surge',
          surgeConf(amp),
          {
            ampBpm: amp,
            position: b.position && b.position !== 'unknown' ? b.position : null,
            positionConf: b.positionConf != null ? b.positionConf : undefined,
            magInterference: b.magInterference ? true : undefined
          },
          sqiAt(b.tMin * 60)
        );
      }
    }
    // motion_artifact_segment — contiguous high-motion beats (quality flag; conf is its own low prior)
    if (motion && motion.hasData) {
      let runStart = null;
      for (let k = 0; k < det.peaks.length; k++) {
        const hi = peakSec[k] != null && motion.motionAtSec(peakSec[k]) > 0.5;
        if (hi && runStart === null) runStart = peakSec[k];
        if ((!hi || k === det.peaks.length - 1) && runStart !== null) {
          evt(runStart, 'motion_artifact_segment', 0.3, {}, sqiAt(runStart));
          runStart = null;
        }
      }
    }
    /* movement_onset — the AROUSAL fiducial, straight off the inertial grid.

       WHICH INSTANT THIS STAMPS (POOLED-CLOCK-FIT-FOLLOWUPS §6.2): a local MAXIMUM of the jerk grid
       above mean+3·SD, i.e. the PEAK of the movement, not the moment it began. The name is
       historical. `movementOnsets` suppresses within ±5 s and enforces a 30 s minimum gap, so the
       stamp is the strongest sample of a movement burst — which for a burst with a fast rise is
       close to its start, and for a slow roll can trail it by seconds. Any cross-channel latency
       quoted against this channel inherits that, and should say so.

       Independent of beat detection on purpose (see movementOnsets): a movement large enough to matter
       is a movement large enough to blind the PPG, so anything gated on beats thins out exactly where
       the signal is strongest. Carries which inertial streams contributed, because a cross-device fit
       that cannot say WHICH sensor found an offset cannot be audited. */
    if (motion && motion.hasData && motion.grid && motion.dt) {
      const onsets = movementOnsets(motion.onsetGrid || motion.grid, motion.dt, {});
      const streams = [];
      if (motion.nAcc) streams.push('acc');
      if (motion.nGyro) streams.push('gyro');
      if (motion.hasMag) streams.push('mag');
      for (const sec of onsets) evt(sec, 'movement_onset', 0.6, { streams: streams.length ? streams : undefined, motionIndex: r2(motion.motionAtSec(sec)) }, sqiAt(sec));
    }
    // CHRONOLOGICAL ORDER IS PART OF THE EXPORT CONTRACT — sort before returning.
    // The blocks above are each internally ordered but are appended per KIND, so the
    // motion_artifact_segment run (which restarts at t0) landed AFTER the last hrv_drop.
    // Clock Contract §6 has a `t`-only consumer rebuild absolute tMs by rolling the
    // wall-clock string forward past midnight, MONOTONICALLY: one backwards step makes it
    // roll a whole day, and every event after it inherits the +24 h. Measured on the real
    // capture corpus that was 393 of 404 events on 2026-07-17. Our own exports carry tMs so
    // the Integrator is unaffected, but §6 says the t-only path must stay tolerable.
    // Stable sort, nulls last (a stampless export keeps its emission order).
    ev.sort((a, b) => (a.tMs == null ? 1 : b.tMs == null ? -1 : a.tMs - b.tMs));
    return ev;
  }

  // ── multi-part split files (Polar Sensor Logger) ───────────────────────────
  // Polar writes long streams as `…_PPG_part01of15.txt` … `of15`; each part
  // repeats the header. Group by the part-stripped base and concatenate in numeric
  // part order (header from part 1 only) so a split capture becomes ONE stream
  // instead of N fragmentary sessions. Pure + DOM-free → unit-tested in BOTH
  // runners; the PpgDex app (and ECGDex's companion text path) delegate here.
  function partKey(name) {
    const m = String(name || '').match(/^(.*)_part(\d+)of(\d+)(\.[^.]*)?$/i);
    return m ? { base: m[1] + (m[4] || ''), part: +m[2], total: +m[3] } : null;
  }
  function mergeMultipart(parsed) {
    // parsed = [{name,text,kind?,stampMs?}]
    const groups = new Map(),
      singles = [];
    for (const f of parsed) {
      const pk = partKey(f.name);
      if (!pk) {
        singles.push(f);
        continue;
      }
      if (!groups.has(pk.base)) groups.set(pk.base, []);
      groups.get(pk.base).push(Object.assign({}, f, { _part: pk.part }));
    }
    const merged = [];
    groups.forEach((arr, base) => {
      arr.sort((a, b) => a._part - b._part); // numeric → part2 before part10
      let text = arr[0].text;
      for (let i = 1; i < arr.length; i++) {
        const lines = arr[i].text.split(/\r?\n/);
        lines.shift(); // drop repeated header
        text += (text.endsWith('\n') ? '' : '\n') + lines.join('\n');
      }
      merged.push({ name: base, text, kind: arr[0].kind, stampMs: arr[0].stampMs, parts: arr.length });
    });
    return singles.concat(merged);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  §2b — WEB-WORKER per-channel detection pool (SCHEDULING optimisation ONLY)
  //  The three LEDs are independent until the consensus merge, so bandpass+orient+
  //  detect on ch0/ch1/ch2 run concurrently in a small pool (one Worker per channel,
  //  ≤3), each channel transferred via a transferable ArrayBuffer (no copy). The
  //  worker runs detectChannel's OWN source (+ its pure deps) rebuilt from
  //  Function.toString(), so the result is BYTE-IDENTICAL to the serial detectChannel
  //  path — workers change WHEN the work runs, never WHAT it computes. 100% offline:
  //  the worker is a blob: URL minted from an INLINED source string (no external
  //  script, honours the no-CDN rule). analyze()/compute() stay SYNCHRONOUS + serial
  //  (the gated numeric truth); only the live APP awaits this, stashes rec._preChannels,
  //  then calls the same analyze(). ANY Worker failure/absence (the headless test/equiv
  //  path) → resolve via the serial detectChannel path → identical numbers.
  // ════════════════════════════════════════════════════════════════════════
  var _ppgWorkerURL = null,
    _ppgWorkerTriedURL = false;
  function _buildWorkerURL() {
    if (_ppgWorkerTriedURL) return _ppgWorkerURL;
    _ppgWorkerTriedURL = true;
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return null;
    // ONE source of truth: the worker re-declares the SAME pure functions from their own
    // .toString() — no algorithm is duplicated as a string literal, so it can't drift.
    // ⚠️ This list is the worker realm's ENTIRE universe — it starts empty, so a function called by
    // anything here but NOT listed is a ReferenceError the moment that path runs. It is hand-maintained,
    // and it DRIFTED: the optical-detector fix gave detectBeats an adaptive refractory sourced from
    // cadenceSamples(), which was never added — so every PPG detection threw
    // `ReferenceError: cadenceSamples is not defined` in the worker, fell back to the serial path via
    // w.onerror, and the numbers stayed right while the worker pool sat dead and the console filled up.
    // The drift is now gate-backed: dex-tests.js's `PpgDex worker source is CLOSED` group re-derives the
    // call graph from this file's own text and reds if any callee is missing. ADD A FUNCTION HERE
    // whenever a worker-reachable path starts calling it.
    var deps = [biquad, applyBiquad, reverse, filtfilt, bandpass, mean, std, median, movavg, orient, riseFraction, orientByRise, negate, cadenceSamples, refineFeet, detectBeats, detectChannel];
    // Module-level CONSTANTS the shipped functions close over. Functions carry their own source via
    // .toString(), but a `const` at module scope does NOT travel with them — detectBeats reads
    // REFR_CADENCE_FRAC, so without this the worker throws `REFR_CADENCE_FRAC is not defined` even once
    // every FUNCTION it calls is shipped. (That is the second half of the same drift, and the static
    // call-graph check alone did not see it — only running the worker realm did.) Still single-sourced:
    // the VALUE is read from the live module here, never retyped.
    var consts = { REFR_CADENCE_FRAC: REFR_CADENCE_FRAC, SUBH_FRAC: SUBH_FRAC, ORIENT_SAMPLE_SEC: ORIENT_SAMPLE_SEC, ORIENT_MIN_BEATS: ORIENT_MIN_BEATS };
    var constSrc = Object.keys(consts)
      .map(function (k) {
        return 'const ' + k + '=' + JSON.stringify(consts[k]) + ';';
      })
      .join('\n');
    var src =
      constSrc +
      '\n' +
      deps
        .map(function (f) {
          return f.toString();
        })
        .join('\n') +
      '\nself.onmessage=function(e){var d=e.data;var chan=new Float32Array(d.buf);' +
      'var r=detectChannel(chan,d.fs);' +
      'self.postMessage({idx:d.idx,peaks:r.peaks,feet:r.feet,sign:r.sign,T:r.T,bp:r.bp.buffer},[r.bp.buffer]);};';
    try {
      _ppgWorkerURL = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    } catch (e) {
      _ppgWorkerURL = null;
    }
    return _ppgWorkerURL;
  }
  function _detectSerial(rec) {
    return rec.ch.map(function (c) {
      return detectChannel(c, rec.fs);
    });
  }
  function detectChannelsAsync(rec) {
    return new Promise(function (resolve) {
      var chans = rec.ch,
        nCh = chans.length;
      var url = typeof Worker !== 'undefined' ? _buildWorkerURL() : null;
      if (!url || !nCh) {
        resolve(_detectSerial(rec));
        return;
      }
      var out = new Array(nCh),
        done = 0,
        settled = false,
        workers = [];
      function serialFallback() {
        if (settled) return;
        settled = true;
        workers.forEach(function (w) {
          try {
            w.terminate();
          } catch (e) {}
        });
        resolve(_detectSerial(rec));
      }
      try {
        for (var c = 0; c < nCh; c++) {
          (function (ci) {
            var w = new Worker(url);
            workers.push(w);
            w.onmessage = function (e) {
              var m = e.data;
              out[m.idx] = { bp: new Float32Array(m.bp), sign: m.sign, peaks: m.peaks, feet: m.feet, T: m.T };
              try {
                w.terminate();
              } catch (_) {}
              if (++done === nCh && !settled) {
                settled = true;
                resolve(out);
              }
            };
            w.onerror = function () {
              serialFallback();
            };
            var buf = new Float32Array(chans[ci]).buffer; // COPY → transfer (leaves rec.ch intact for the serial raw/dc path)
            w.postMessage({ idx: ci, buf: buf, fs: rec.fs }, [buf]);
          })(c);
        }
      } catch (e) {
        serialFallback();
      }
      setTimeout(function () {
        if (!settled) serialFallback();
      }, 20000); // stall guard
    });
  }

  global.PPGDSP = {
    parsePPG,
    parseSensorXYZ,
    parseDevicePPI,
    analyze,
    analyzeMotion,
    movementOnsets,
    validatePPI,
    // Exposed for the cross-implementation parity gate (allan.py / integrator-tch.js) — see the
    // DETECTOR STABILITY block above. Not part of any node contract.
    allanFromPhase,
    allanSlopeFit,
    classifyAllan,
    detectorStability,
    detectorAgreementTriplet,
    bandpass,
    detectBeats,
    detectChannel,
    consensusBeats,
    consensusSign,
    /* PPG-FOOT-PLACEMENT §0 — exported so the polarity RULE is directly testable rather than reachable
       only through a full `detectChannel` run, the same reason `consensusSign` is exported. */
    orientByRise,
    riseFraction,
    applyConsensusPolarity,
    distinctChannelIdx,
    intervalsSpanningTimeGap,
    hrvShapeViolates,
    gapBeats,
    pickChannel,
    harmonicOutlierRefIdx,
    cadenceSamples,
    beatRegularity,
    markO2BeatMarkers,
    markO2Sentinels: markO2BeatMarkers, // back-compat alias — the old name asserted the wrong semantics
    refineFeet,
    detectChannelsAsync,
    buildPPI,
    correctRR,
    beatSQI,
    beatConfidence,
    /* ADDITIVE EXPORT (DEEP-AUDIT-VI F3 port), mirroring ECGDex, which exports `detectCVHR` for the
       same reason: the denominator and the refusal guards become directly assertable, and — the part
       only an export makes possible — the two nodes' implementations can be run on IDENTICAL input in
       one assertion. The Integrator corroborates `apnea.cvhrIndex` across them, so "same quantity" is
       a contract between the nodes, not an internal detail of either. No existing caller reaches it
       through this surface; `analyze` still calls it directly. */
    cvhrFromNN,
    timeDomain,
    poincare,
    lombScargle,
    dfaAlpha1,
    /* Additive export. DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS §EP-rest could not reach this function's
       DEFAULT tolerance (`r = 0.2·SD`, Richman–Moorman): the only call site is `sampEn(nn)` deep inside
       `analyze`, and the brief looked for "a tolerance-sensitive synthetic" — a series whose SampEn moves
       enough under a 0.2→0.15 slip to surface — and did not find one.
       That search was unnecessary. A DEFAULT is pinned by EQUALITY against the explicit argument
       (`sampEn(nn)` ≡ `sampEn(nn, 2, 0.2)`, and ≠ `sampEn(nn, 2, 0.15)`), which holds on ANY series with
       enough texture — no sensitivity hunt required. The ECGDSP sibling is already exported for the same
       reason. Export-only: no call site changes, so this is compute-inert. */
    sampEn,
    parseTimestamp,
    fmtClock,
    fmtClockSec,
    fmtDate,
    fmtDateTime,
    mean,
    std,
    median,
    quantile,
    partKey,
    mergeMultipart
  };

  // ════════════════════════════════════════════════════════════════════════
  //  PHASE-9 SIGNAL-ADAPTER — namespaced node surface (PpgDex.compute)
  //  Shared node-export builder: ONE event source (analyze→buildEvents→r.events)
  //  feeds BOTH the app's exportGanglior() and the headless compute(). DOM-free
  //  and self-contained — kernel/provenance arrive via opts (typeof-guarded by the
  //  caller), never reached off window here (CONTRIBUTING.md §6 / brief §1B).
  // ════════════════════════════════════════════════════════════════════════
  function ppgBuildNodeExport(r, opts) {
    opts = opts || {};
    // PPGDEX-FOLLOWUPS §3: preserve the per-event sqi axis (R7 — "SQI rides ALONGSIDE conf", a SEPARATE
    // quality axis, not folded into conf). buildEvents stamps sqi on EVERY event (a number for the per-beat-
    // quality impulses e.g. motion_artifact_segment via sqiAt(); null where it doesn't apply). The old
    // explicit field-list here DROPPED sqi, so the PpgDex node-export silently diverged from ECGDex (whose
    // ecgBuildNodeExport copies all keys → its export carries sqi). Carry it through so the sqi round-trip is
    // REAL and fleet-consistent. 0-event exports (e.g. the equiv fixture) are byte-identical (empty array).
    var events = (r.events || []).map(function (e) {
      return { t: e.t, tMs: e.tMs, impulse: e.impulse, node: e.node, conf: e.conf, sqi: e.sqi !== undefined ? e.sqi : null, meta: e.meta };
    });
    // Chronological order is part of the export contract, enforced at the boundary where the
    // contract applies — buildEvents already sorts, but an app-supplied r.events reaches here too.
    // Clock Contract §6: a `t`-only consumer rebuilds tMs by rolling the wall-clock string forward
    // MONOTONICALLY, so one backwards step costs a full day for that event and every one after it.
    // Stable, nulls last (a stampless export keeps its emission order).
    events.sort(function (a, b) {
      return a.tMs == null ? 1 : b.tMs == null ? -1 : a.tMs - b.tMs;
    });
    var out = {
      // DEEP-AUDIT-2026-07-11 §16: NORMALIZE the stamp to the contract shape {version, hash}. Passing
      // opts.kernel through raw exported the DexKernel object itself ({K, VERSION, HASH}), and the
      // Integrator reads the lowercase keys — so this node always audited as kernel 'missing'.
      kernel: opts.kernel
        ? { version: (opts.kernel.version != null ? opts.kernel.version : opts.kernel.VERSION) || null, hash: (opts.kernel.hash != null ? opts.kernel.hash : opts.kernel.HASH) || null }
        : null,
      schema: {
        name: 'ganglior.node-export',
        version: '2.0',
        node: 'PpgDex',
        nodeVersion: '1.0',
        bus: 'ganglior',
        generated: opts.generated || new Date().toISOString(),
        provenance: opts.provenance || null,
        doc: 'PpgDex PPG-derived events → Ganglior bus. t/tMs = floating wall-clock ms (UTC getters). null = unknown, never fabricated.'
      },
      // EXPORT-IDENTITY §2.1 / -FOLLOWUPS-II §1: identity-free contentId, single-sourced in this
      // shared builder (both app exportGanglior + headless compute reach it). Folds the NN beat series.
      recording: {
        source: 'ppg',
        contentId:
          typeof SignalFrame !== 'undefined' && SignalFrame && SignalFrame.computeContentId && r.nn && r.nn.length
            ? SignalFrame.computeContentId({ signalType: 'ppg', kind: 'intervals', intervals: r.nn, t0Ms: r.t0Ms != null ? r.t0Ms : null, usable: true })
            : null,
        startEpochMs: r.t0Ms != null ? r.t0Ms : null,
        /* NODE-EXPORT-DURATION-SEMANTICS §3 — where the recording ENDS on the clock, beside how much
           signal it holds. `integrator-dsp normalizeFile` already prefers `endEpochMs` over every
           duration key, so this is additive: a node that gains it is honoured immediately, a node that
           has not gained it behaves exactly as today. Measured reason it is not redundant with
           `t0 + durSec` here: on the gappiest O2Ring night in the capture corpus that sum lands 6.6 min
           SHORT of the last stamp (1.0 min on the next, ~0 on contiguous nights) — PpgDex's gap-filled
           grid does not recover all lost time, so the shortfall scales with gap burden. */
        endEpochMs: r.endEpochMs != null ? r.endEpochMs : null,
        // Declare the recording LENGTH so the Integrator can place a real window on this leg. The
        // identical key and the identical reason already sit in ecgdex-dsp.js — the fix was applied
        // to ECG and never to PPG, and the two build their `recording` block the same way.
        // Without a duration key, integrator-dsp adaptEnvelopeNode derives endMs from the LAST EVENT
        // only, so an event-sparse PPG segment collapses to a zero-length window at t0Ms and is
        // excluded from the fold's overlap intersection — the leg is dropped even though its raw PPG
        // genuinely overlapped the other nodes. Measured over the 2026-07-16..24 fold, PpgDex was the
        // one node of three carrying NO duration at all (ECGDex durSec, OxyDex durationMin, PpgDex
        // neither), so its window depended entirely on having events to bound it.
        // `durSec` is the key the adapter already honors generically (DEEP-AUDIT-II §7.6) — additive
        // and back-compat, exactly as it was for ECGDex.
        durSec: r.durSec != null && isFinite(r.durSec) ? r.durSec : null,
        sessions: 1,
        events: events.length,
        // Optical site (OXYDEX-PULSE-RESOURCING §Phase 2): 'finger' = O2Ring single-channel pleth,
        // 'wrist' = Polar Verity. The Integrator needs it to identify the O2Ring's OWN waveform leg
        // for the finger-waveform-vs-ring-1 Hz-pulse cross-check (a self-check, not cross-device).
        site: r.site || 'wrist',
        /* 'device-default' = inferred from the optical layout, NOT observed. On this deployment the
           Verity is ankle-worn and defaults to 'wrist', so a morphology tier justified by wrist
           literature is unearned wherever this reads 'device-default'. */
        siteSource: r.siteSource || 'device-default'
      },
      ganglior_events: events,
      reserved: { doc: 'Awaiting other fleet nodes; null until available.' }
    };
    /* SPARSE COVERAGE — INTEGRATOR-GAP-AWARE-OVERLAP part 2. `durSec` above is the ENVELOPE this node
       records over; it does not say where inside that envelope the signal is. The Verity is the
       fleet's most fragmented stream — 24 segments in one night against the H10's 3 — and its envelope
       was feeding `apnea.overlapHours` as if it were continuous. Assigned conditionally so a clean
       export stays byte-identical (see the identical note in ecgdex-dsp). */
    if (r.coverage) out.recording.coverage = r.coverage;
    /* SELF vs FIRMWARE — ON THE INTEGRATOR-FACING SURFACE. This is a DEFECT FIX, not a new feature:
       `validation` (with its `stability` leg) was added to `ppgdex-app.js buildV2` and the Integrator's
       `readDetectorStability()` was written to read `nodeExport.validation.stability` — but `buildV2` is
       the AI-readable export, NOT what `buildNodeExport` emits. A real `ganglior.node-export` carries
       apnea · ganglior_events · hrv · kernel · quality · recording · reserved · schema · timeseries and
       nothing else, so the reader returned null on every genuine export. Its unit tests passed because
       they construct the export shape BY HAND — they proved the reader worked, never that anything fed
       it. The gate could not catch it either: the equivalence legs re-run `buildNodeExport`, so a field
       added to `buildV2` is outside what they examine.
       Attached only when usable, for the same reason as the sibling above — a `validation: null` key is
       still a changed export shape, and no committed fixture reaches `usable`. */
    if (r.validation && r.validation.usable) {
      const _v = r.validation;
      out.validation = {
        source: _v.source,
        beatsCompared: _v.nSelf,
        nDevice: _v.nDevice,
        dMeanPct: _v.dMean,
        dRMSSDPct: _v.dRMSSD,
        dSDNNPct: _v.dSDNN,
        devEctopyCorrected: _v.devEctopyCorrected,
        devRawRMSSD: _v.devRawRMSSD,
        deviceAgreementPct: _v.deviceAgreementPct,
        /* The field `readDetectorStability()` actually consumes. `slope` is load-bearing: -1 means the
           disagreement is jitter that averages away, so a SUSTAINED divergence is a real fault; 0 would
           be a floor no averaging removes. Present only for the marker source, where both detectors sit
           on one axis — see the DSP note on why a `_PPI.txt` cannot supply this. */
        stability: _v.stability
          ? {
              slope: _v.stability.slope,
              slopeSE: _v.stability.slopeSE,
              nTau: _v.stability.nTau,
              noise: _v.stability.noise,
              candidates: _v.stability.candidates,
              meaning: _v.stability.meaning,
              beatsPaired: _v.stability.nPaired,
              tau0Sec: _v.stability.tau0Sec,
              atShortestMs: _v.stability.atShortestMs,
              atLongestMs: _v.stability.atLongestMs,
              atShortestPpm: _v.stability.atShortestPpm,
              atLongestPpm: _v.stability.atLongestPpm,
              tauMaxSec: _v.stability.tauMaxSec,
              optimalTauSec: _v.stability.optimalTauSec,
              /* KEPT, with corrected text rather than deleted: a consumer may key on its presence, and
                 removing a published field is a contract change for a string that only needed to stop
                 lying. Before 2026-08-16 it warned that the label was unreliable near a boundary;
                 `noise` is now null there instead, so the warning has become a description. */
              knownLimitation:
                'noise is null when a category boundary (±0.75, ±0.25) lies within 1.96·slopeSE — `candidates` then names what the fit cannot separate. slope is unrounded; the SE is a LOWER bound (overlapping ADEV points are correlated), so branch on slope when noise is null'
            }
          : null,
        note: 'self-PPI vs firmware PPI; both sides artifact-corrected. Validation lane only — PPI is never handed to PulseDex'
      };
    }
    // Per-channel three-cornered-hat noise, same surface and same reason. ⚠️ Read `scope`: NOISE, not
    // correctness — it is blind to any error common to all three channels (#1200 polarity).
    if (r.channelStability) {
      out.validation = out.validation || { source: 'channel-tch' };
      out.validation.channelStability = {
        channels: r.channelStability.channels.map((c) => ({ sigmaShortestMs: c.sigmaShortestMs, slope: c.slope })),
        beatsTripled: r.channelStability.nTriples,
        negativeVarianceTaus: r.channelStability.negativeVarianceTaus,
        independent: r.channelStability.independent,
        polarity: r.channelStability.polarity,
        polarityFlipped: r.channelStability.polarityFlipped,
        scope: r.channelStability.scope
      };
    }
    // ── RICH export (gated: opts.rich) — ECG-PPG-FOLLOWUPS-HANDOFF §1 option (a) / PPGDEX-FOLLOWUPS §1 ──
    // By DEFAULT this builder emits the LIGHT export above and the app's exportGanglior() calls WITHOUT
    // opts.rich → the app's Ganglior stream stays BYTE-IDENTICAL. Only the orchestrate emitter
    // (signal-orchestrate.emitPpgNodeExport) passes opts.rich, so a Unifier/OverDex-routed PPG file
    // additionally carries the slice the Integrator's adaptEnvelopeNode('PpgDex') consumes: hrv.time
    // .{rmssd,sdnn} (single-site PPG → these ARE whole-record, the consensus axis directly), hrv.frequency
    // .lfhf, quality.analyzablePct, and the per-5-min timeseries.epochs[].position grid (limb-acc posture —
    // populated once companions land, §1b). Field math MIRRORS ppgdex-app.js buildV2 (same `r`, same numbers).
    // SHARED SHAPE with ecgBuildNodeExport (ECGDEX-FOLLOWUPS-II §2) — keep the two aligned (handoff no-divergence).
    if (opts.rich) {
      var nz = function (v) {
        return v == null || (typeof v === 'number' && !isFinite(v)) ? null : v;
      };
      var fq = r.freq || {};
      out.quality = {
        analyzablePct: nz(r.analyzablePct),
        cleanBeatPct: nz(r.cleanBeatPct),
        coveragePct: nz(r.coveragePct),
        motionRejectedPct: nz(r.motionRejectedPct),
        correctionRatePct: nz(r.correctionRate),
        ledAgreementPct: nz(r.ledAgreementPct),
        ppiSpine: r.ppiSpine || null,
        ppiAgreementPct: nz(r.ppiAgreementPct),
        ppiCorrFootPct: nz(r.ppiCorrFootPct),
        ppiCorrPeakPct: nz(r.ppiCorrPeakPct),
        /* ── TIMING PROVENANCE (WEARABLE-HOST-AXIS-FOLLOWUPS §F1) — additive, contract-safe ──
           A consumer that spends this export as a CLOCK LEG (three-cornered hat, three-source closure,
           PAT) must branch on `timingSource` BEFORE using ppi.tSec as a time base:
             'device+host'  device reported real timestamps, host-disciplined — usable as a clock.
             'host'         the device column was DRAWN (a constant increment standing in for an
                            assumed rate); all real timing came from the capture host and the device
                            contributed sample ORDER only.
             'none'         drawn AND no host anchors — NO timing information exists in this recording.
           TCH assumes three INDEPENDENT sources; a drawn axis is a constant, so feeding one in measures
           the assumption rather than a third clock. That is exactly how six nights of closure failed.
           `axisQuantizedShare` is the evidence (deltas on one value: ~1.0 drawn, 0.001-0.088 measured),
           reported as a NUMBER so a reader judges the borderline instead of inheriting a verdict. */
        timingSource: r.timingSource || null,
        axisDrawn: r.axisDrawn == null ? null : r.axisDrawn,
        axisQuantizedShare: nz(r.axisQuantizedShare),
        // Which RATE reference governed an O2Ring finger recording ('device-crystal' = the 125.000 ADC
        // clock with the `156` beat markers deflated; 'host-disciplined' = the host-referenced row axis).
        // O2RING-ADAPTIVE-TIMEBASE. Additive + CONDITIONAL: a Verity (r.timebase == null) omits the key,
        // so every committed Verity export stays byte-identical; only a finger export carries it.
        ...(r.timebase ? { timebase: r.timebase } : {})
      };
      /* ── THE AXIS MEASUREMENTS, NOT ONLY ITS VERDICT (Heron's cross-family trace, 2026-09-02) ──
         `quality` above published the CONCLUSION — `timingSource`, `axisDrawn`, `axisQuantizedShare`
         — and dropped every number that produced it. A consumer could read `'device+host'` and had
         no way to check whether the host column was actually a second clock, which is precisely what
         CLAUDE.md §7 instructs it to read ("read `independent`, never a ~0 ppm"). ECGDex has emitted
         the full block at `ecgdex-dsp.js:5210+` all along; PpgDex computed the same values (`:760`)
         and this reshape named none of them.
         ⚠️ The comment at `:740` predicted this exact failure — `independent`/`spreadMs`/`inertReason`
         "DROPPED here … discarded one line after it was computed" — and the block one layer down warns
         that a reshape drops anything it does not name, citing `stability` vanishing at this very seam
         on the first real-data run. The file documented the defect and nothing read the file.
         Field set mirrors ECGDex so the two are comparable by construction; CONDITIONAL on an axis
         existing, so a night without one omits the block and every committed export stays
         byte-identical rather than gaining a wall of nulls. */
      if (r.hostAxis && r.hostAxis.ok) {
        out.recording.hostAxis = {
          anchors: r.hostAxis.anchors != null ? r.hostAxis.anchors : null,
          ppm: nz(r.hostAxis.ppm),
          maxStepMs: nz(r.hostAxis.maxStepMs),
          totalMs: nz(r.hostAxis.totalMs),
          /* The three §7 discriminators. `independent` is the verdict on whether the host column is a
             SECOND CLOCK at all; `spreadMs` is the residual it was decided on; `inertReason` is the
             sentence DexClock wrote when it said no. Publishing the reason means a reader sees WHY,
             not just false. */
          independent: r.hostAxis.independent == null ? null : r.hostAxis.independent,
          spreadMs: nz(r.hostAxis.spreadMs),
          inertReason: r.hostAxis.inertReason || null,
          drawn: r.hostAxis.drawn == null ? null : r.hostAxis.drawn,
          quantizedShare: nz(r.hostAxis.quantizedShare),
          timingSource: r.timingSource || null,
          stability: r.hostAxis.stability
            ? {
                tau0: nz(r.hostAxis.stability.tau0),
                noiseType: r.hostAxis.stability.noiseType || null,
                slope: nz(r.hostAxis.stability.slope),
                ppmUncertainty: nz(r.hostAxis.stability.ppmUncertainty)
              }
            : null
        };
      }
      out.hrv = {
        time: {
          meanRR: nz(r.meanRR),
          hr: nz(r.dispHr),
          sdnn: nz(r.sdnn),
          rmssd: nz(r.rmssd),
          pnn50: nz(r.pnn50),
          sdnnIndex: nz(r.sdnnIndex),
          sdnnRobust: nz(r.sdnnRobust),
          sd2Robust: nz(r.sd2Robust),
          window: 'wholeRecord',
          units: 'ms',
          lowConfidence: !!r.hrvLowConfidence,
          lowConfidenceReason: r.hrvLowConfidenceReason || null,
          // \u00a72 \u2014 additive: absent on every clean night, so no existing export moves.
          ...(r.hrvShapeViolation ? { shapeViolation: true } : {}),
          windowNote: 'sdnn/rmssd are whole-record (single-site PPG); per-5-min values live in epochs[]. Directly comparable to another node\u2019s wholeRecord SDNN/RMSSD.',
          sdnnNote:
            'whole-record sdnn runs high on optical — SDANN/baseline-wander inflation the chest ECG does not carry. sdnnIndex (mean of per-5-min SDNN) and sdnnRobust (quality-gated MEDIAN of per-5-min SDNN) both remove it, sdnnRobust the most; use sdnnRobust for cross-node SDNN comparison. Bias magnitudes are deliberately not quoted here: the earlier figures came from a single paired night and did not reproduce on the multi-night corpus.'
        },
        /* DEEP-AUDIT-2026-07-11 §10/§11: export the 5-MIN EPOCH-MEDIAN spectrum as the primary band set —
         PpgDex already computed it (the *Robust twins) but shipped the WHOLE-RECORD Lomb–Scargle instead.
         Two problems, both gone with one change:
           §11 the whole-record band split is a GRID LOTTERY. df is hard-coded at 0.002 Hz regardless of
               record length, while a night's intrinsic resolution is 1/T ≈ 3.8e-5 Hz — ~50× finer — so
               the Riemann sum samples a spiky periodogram at arbitrary points and the split does not
               converge. (Parseval pins the TOTAL to the variance, which is why it looked fine.)
           §10 it also put PpgDex on a DIFFERENT time scale from ECGDex's epoch-median lfhf, so the
               Integrator's cross-node HRV divergence was inflated by a pure definition mismatch.
         At the 5-min scale df = 0.002 Hz is finer than the epoch's own 1/300 s = 0.0033 Hz resolution, so
         the grid is adequate by construction. totalPower is the SUM of the reported bands, so the
         Task-Force identity vlf+lf+hf == totalPower holds exactly. `window` names the scale so a consumer
         can refuse to compare it against a whole-record value. The whole-record numbers are kept under
         explicit wholeRecord* keys — labelled, not silently mixed in. */
        frequency: (function () {
          const epochScale = r.lfRobust != null && r.hfRobust != null;
          return {
            vlf: epochScale ? nz(r.vlfRobust) : nz(fq.vlf),
            lf: epochScale ? nz(r.lfRobust) : nz(fq.lf),
            hf: epochScale ? nz(r.hfRobust) : nz(fq.hf),
            totalPower: epochScale ? nz(r.tpRobust) : nz(fq.totalPower),
            lfhf: epochScale ? nz(r.lfhfRobust) : nz(fq.lfhf),
            window: epochScale ? 'epochMedian5min' : 'wholeRecord',
            method: 'Lomb-Scargle',
            lowConfidence: !!r.hrvLowConfidence,
            hfRobustLowMotion: nz(r.hfRobustLowMotion),
            wholeRecordLf: nz(fq.lf),
            wholeRecordHf: nz(fq.hf),
            wholeRecordLfhf: nz(fq.lfhf),
            /* §1.6 link 2 — the field the Integrator already reads. `integrator-dsp` has assigned
               `summary.respRateBrpm = _hf.respRate` all along (link 3 was never missing); it simply had
               nothing to read, because this block carried no frequency-valued key at any level.
               🔴 CORRECTED 2026-09-02 — the two sentences above are WRONG and this key alone was never
               enough. The Integrator's assignment they name lives inside `if (node === 'ECGDex')`
               (`integrator-dsp.js:365`); the whole file assigns that field at exactly two sites, the
               other being MotionDex's. The branch PpgDex actually flows through never read it, so this
               export published a respiration rate that reached no fusion for a month. Wired on the
               consumer side 2026-09-02 and gated. Left standing rather than deleted because a producer
               asserting its consumer is wired is the failure worth seeing: nothing here could have
               detected it, since the claim is about a file this one does not read.
               WHOLE-RECORD deliberately, not the epoch median: respiration is being reported as ONE
               number for the recording, and `fq` is the whole-record spectrum — the same scale ECGDex
               reports its `respRate` on, which is what makes the two comparable in the fusion. The
               epoch-scale values stay available per-epoch in `timeseries.epochs[].respRate`. */
            respRate: nz(fq.respRate),
            respRateMethod: fq && fq.respRate != null ? 'RSA (HF-peak of RR spectrum)' : null
          };
        })(),
        confidence: r.hrvConfidence || null
      };
      // OXYDEX-PULSE-RESOURCING §Phase 4 — CVHR (autonomic apnea correlate) from the finger PPI NN
      // series, same block name the Integrator already reads for ECGDex (`json.apnea.cvhrIndex`). This
      // is NOT an AHI and never becomes one: the Integrator corroborates it and NAMES the source; the
      // ONLY published AHI stays OxyDex's ahiEst (§3.1 (b) owner decision). cvhrIndex=0 = none detected
      // (a real reading, not "absent"), so it is emitted verbatim, never nulled to a sentinel.
      out.apnea = {
        cvhrIndex: r.cvhrIndex != null ? r.cvhrIndex : null,
        cvhrEvents: r.cvhrEvents != null ? r.cvhrEvents : null,
        /* WHICH HOURS the index divided by (F3 port) — attached only when the index was computed, so
           a refusal carries no basis it does not have. The Integrator reads this block from BOTH
           nodes; without the denominator a consumer cannot tell a 5 /h from a 40 % covered night
           apart from a 5 /h from a clean one. */
        ...(r.cvhrIndex != null && r.cvhrDenomSec > 0 ? { cvhrHours: +(r.cvhrDenomSec / 3600).toFixed(2) } : {}),
        cvhrMethod: 'CVHR events/h from finger PPI NN (Hayano apnea-band 20–45 s; ports ECGDex detectCVHR)',
        cvhrTier: 'emerging'
      };
      /* PER-BEAT INTERVALS ON THE BUS (INTERVAL-SERIES-EXPORT).
         PpgDex computed PPI twice — once from pulse FEET, once from PEAKS — voted a spine between
         them, Malik-corrected it, and exported neither. Unlike ECGDex there was not even an app
         button: the only interval series this sensor has was unreachable except by re-running the DSP.
         That is worse than it sounds, because the device's own `_PPI.txt` is often header-only and its
         `_HR.txt` is all-zero, so the computed series is not a second opinion — it is the ONLY one.

         Same motivation as ECGDex's block: the published joint clock-skew framework — Abdessalem K.
         (2026), "A software-only framework for synchronization of independently clocked cardiac-linked
         biomedical signals", Meas Sci Technol
         (doi:10.1088/1361-6501/ae6a09) — reaches 0.2-0.4 ms between independently-clocked sensors from
         IBI sequences alone, and this suite exported none of its three. */
      out.timeseries = {
        doc: '5-min epochs — primary cross-node feed (posture rides on epochs[].position).',
        epochs: (r.epochs || []).map(function (e) {
          return {
            tMin: e.tMin,
            hr: nz(e.hr),
            /* Repeated at the EXPORT seam, not only on the internal epoch — this projection is a
               whitelist, so a label added upstream never leaves the node. That is exactly how the
               first attempt shipped inert: the bundle carried the string, every golden read
               `hrStat: undefined`. `rate-of-mean`, same statistic as ECGDex — but note this leg is
               integer-rounded where ECGDex keeps a decimal (R5-HR-TRIPLET-FOLLOWUPS). */
            hrStat: 'rate-of-mean',
            rmssd: nz(e.rmssd),
            sdnn: nz(e.sdnn),
            lfhf: nz(e.lfhf),
            motionIndex: nz(e.motionIndex),
            ledAgreementPct: nz(e.ledAgreementPct),
            position: e.position || 'unknown',
            positionConf: nz(e.positionConf),
            headingDeg: nz(e.headingDeg),
            // §3a: `!!` collapsed "no posture datum" into "clean field". Tri-state survives the export.
            magInterference: e.magInterference == null ? null : !!e.magInterference
          };
        })
      };
      /* ATTACHED ONLY WHEN NON-EMPTY, so a record without beats carries no field rather than an empty
         array a consumer would read as "measured, and flat" — and so existing fixtures stay inert. */
      if (r.nn && r.nn.length && r.tt && r.tt.length === r.nn.length) {
        out.timeseries.ppi = {
          doc: 'Per-beat PPI from the SELF-COMPUTED optical spine (3-LED consensus → buildPPI → Malik correctRR) — the device _PPI.txt is often header-only and its _HR.txt all-zero, so this is the ONLY interval series for this sensor, not a second opinion. `spine` names which fiducial won (foot or peak). tSec[i] is the beat time in seconds from startEpochMs; ms[i] is the interval ENDING at that beat. Beat times are EXPLICIT, never reconstructed by cumulative sum — a dropout would otherwise be closed silently and every later beat shifted.',
          spine: r.ppiSpine || null,
          n: r.nn.length,
          tSec: r.tt.map(function (v) {
            return +v.toFixed(3);
          }),
          ms: r.nn.map(function (v) {
            return Math.round(v);
          }),
          /* WHICH INTERVALS ARE MEASUREMENTS. 1 = interpolated by correctRR, not observed. Without it
             the series mixes the two and a consumer cannot tell — and rMSSD over interpolated beats is
             not a measurement of anything. This one is not hypothetical here: the first four PPI of a
             real night read 1190, 1190, 1190, 1190 — the running median, not four identical heartbeats. */
          corrected:
            r.ppiFlags && r.ppiFlags.length === r.nn.length
              ? Array.prototype.map.call(r.ppiFlags, function (f) {
                  return f ? 1 : 0;
                })
              : null,
          /* HOW MUCH TO TRUST EACH BEAT — the fused-weight hat's `c` (TCH-FUSED-ROBUST-HAT).
             density × SQI vs the record's own medians, AF-safe; low only where beat-density is an
             upper outlier AND SQI is depressed — i.e. residual optical over-detection (the dicrotic
             notch counted as a second beat), which on this corpus is the dominant Verity failure.
             Distinct from `corrected` (an interpolation FLAG) and from epochs[].sqi (a 5-min mean):
             this is the per-beat weight `analysis-stats.js tchSigmasFused` multiplies in. Unlike
             ECGDex's twin, NO beat is dropped on this value here — the full spine ships and the
             consumer weights it, so a low-c stretch stays visible rather than becoming a silent gap. */
          conf: r.ppiConf && r.ppiConf.length === r.nn.length ? r.ppiConf.slice() : null
        };
      }
    }
    return out;
  }

  // Headless public surface — parse → analyze (REAL pipeline) → shared node-export.
  // Accepts a Polar Sense `*_PPG.txt` string, {text}, an already-parsed rec {ch:[…]},
  // or the canonical ppg SignalFrame (samples PACKS the multi-channel optical waveform).
  function compute(input, opts) {
    opts = opts || {};
    var rec;
    if (input && input.samples && input.samples.ch && Array.isArray(input.samples.ch)) {
      // Canonical ppg SignalFrame (signal-frame.js): samples PACKS the parsed optical waveform
      // ({ch:[F32×3], amb, relSec, n, durSec, length:n}). PPG is 100+ Hz, so per-sample row
      // objects would be millions — the typed-array channels ride through `samples` instead, with
      // fs/t0Ms/offsetMin on the frame (ECG-like). signal-orchestrate.emitPpgNodeExport hands this
      // shape STRAIGHT to compute(), so rebuild the parsePPG-shaped rec DIRECTLY from the frame's
      // own already-parsed channels (the polar-sense-ppg adapter already ran PpgDex.parsePPG — do
      // NOT re-parse). Without this branch the orchestrate PPG path throws (the {text}/rec branches
      // below both miss a samples frame — the §1 compute()-shape gap that bit GlucoDex).
      var s = input.samples;
      var n = s.n != null ? s.n : s.ch[0] ? s.ch[0].length : 0;
      var fs = input.fs != null ? input.fs : s.fs;
      var relSec = s.relSec;
      if (!relSec) {
        relSec = new Float64Array(n);
        for (var i = 0; i < n; i++) relSec[i] = i / (fs || 1);
      }
      rec = {
        ch: s.ch,
        amb: s.amb || null,
        relSec: relSec,
        n: n,
        fs: fs,
        t0Ms: input.t0Ms != null ? input.t0Ms : s.t0Ms != null ? s.t0Ms : null,
        offsetMin: input.offsetMin != null ? input.offsetMin : null,
        durSec: s.durSec != null ? s.durSec : n > 1 ? (n - 1) / (fs || 1) : 0,
        /* §1.4 — derive site here too, by the SAME rule as the text path. Omitting it let the export's
           `rec.site || 'wrist'` fallback stamp every frame-routed recording 'wrist'. A declared site
           (`s.site`) wins if an adapter ever carries one; otherwise it is the layout fact, and
           `siteSource` stays 'device-default' so a grader can still tell a default from a declaration. */
        site: s.site || deriveSiteFromLayout(s.ch, n),
        siteSource: s.siteSource || 'device-default',
        acc: input.acc || null,
        gyro: input.gyro || null,
        magn: input.magn || null,
        devicePPI: input.devicePPI || null,
        markers: input.markers || null
      };
    } else if (input && Array.isArray(input.ch)) {
      rec = input; // already a parsed rec (app / test path)
    } else {
      var text =
        typeof input === 'string' ? input : input && typeof input.text === 'string' ? input.text : input && input.samples && typeof input.samples.text === 'string' ? input.samples.text : null;
      if (text == null) throw new Error('PpgDex.compute: need a Polar Sense *_PPG.txt string, {text}, a parsed rec {ch:[…]}, or a ppg SignalFrame {samples:{ch:[…]}}.');
      rec = parsePPG(text, { timebase: opts.timebase });
    }
    if (opts.source) rec.source = opts.source;
    if (opts.fname && !rec.fname) rec.fname = opts.fname;
    var r = analyze(rec, null);
    return ppgBuildNodeExport(r, opts);
  }

  global.PPGDSP.compute = compute;
  global.PPGDSP.buildNodeExport = ppgBuildNodeExport;
  // ONE namespaced global (brief §1A). PpgDex leaks nothing bare (the whole DSP is in this
  // IIFE) → no __DEX_NAMESPACED__ suppression gate needed; this is an explicit named global,
  // collision-free in the co-load realm. Standalone bundles still read PPGDSP.
  // ═══ SELF-INGEST — reload PpgDex's OWN ganglior.node-export as a review-mode clinical VIEW
  // (SELF-INGEST-FOLLOWUPS · PpgDex pass, EXPORT-INERT). PpgDex already emits a RICH node-export
  // (buildV2/exportSummary: recording + hrv{time,frequency,nonlinear} + personalization + apnea) AND a
  // light one (exportGanglior). This reader accepts EITHER, single or a sessions[] multi wrapper, and
  // returns whatever derived layer is present VERBATIM. PURE + DOM-FREE; never recomputes, never re-stamps. ═══
  function ppgLoadOwnExport(json) {
    if (!(json && json.schema && json.schema.name === 'ganglior.node-export'))
      return { ok: false, reason: 'not-node-export', message: 'Not a node-export \u2014 drop a raw Polar Verity *_PPG.txt, or PpgDex\u2019s own .json export.' };
    var node = ((json.schema.node || '') + '').trim();
    if (node !== 'PpgDex')
      return {
        ok: false,
        reason: 'foreign-node',
        node: node,
        message: 'This is a ' + (node || 'non-PpgDex') + ' export \u2014 open it in ' + (node || 'its own node') + ', or drop it into the Integrator to fuse.'
      };
    var carrier = Array.isArray(json.sessions) ? json.sessions : [json];
    var elements = carrier.map(function (el) {
      var e = JSON.parse(JSON.stringify(el));
      e._fromExport = true;
      e._reviewMode = true;
      return e;
    });
    var evAll = Array.isArray(json.ganglior_events) ? json.ganglior_events.slice() : [];
    if (!evAll.length)
      carrier.forEach(function (el) {
        if (Array.isArray(el.ganglior_events)) evAll = evAll.concat(el.ganglior_events);
      });
    evAll.sort(function (a, b) {
      return ((a && a.tMs) || 0) - ((b && b.tMs) || 0);
    });
    return {
      ok: true,
      reviewMode: true,
      node: node,
      elements: elements,
      events: evAll,
      provenance: (json.schema && json.schema.provenance) || null,
      generated: (json.schema && json.schema.generated) || null,
      derivedFrom: (json.schema && json.schema.derivedFrom) || null,
      kernel: json.kernel || null,
      recording: (carrier[0] && carrier[0].recording) || json.recording || null,
      hrv: (carrier[0] && carrier[0].hrv) || json.hrv || null,
      quality: (carrier[0] && carrier[0].quality) || json.quality || null,
      personalization: (carrier[0] && carrier[0].personalization) || json.personalization || null,
      crossNight: json.crossNight || null,
      scrubbed: !!(json.schema && json.schema.scrubbed),
      multiNight: elements.length > 1,
      raw: json
    };
  }

  global.PpgDex = global.PpgDex || { compute: compute, parsePPG: parsePPG, analyze: analyze, buildNodeExport: ppgBuildNodeExport, _build: ppgBuildNodeExport, coverage: ppgCoverage };
  global.PpgDex.loadOwnExport = ppgLoadOwnExport; // SELF-INGEST reload (review-mode clinical view)
  // scrub-for-sharing → the SHARED dexScrubExport (D1); lazy delegate, co-load order irrelevant.
  global.PpgDex.scrubExport = function (env) {
    if (global.DexExport && typeof global.DexExport.scrubExport === 'function') return global.DexExport.scrubExport(env);
    if (typeof global.dexScrubExport === 'function') return global.dexScrubExport(env);
    return env;
  };
})(window);

// ESM-MIGRATION: ppgdex-dsp is now a DUAL-MODE module. The IIFE above still attaches window.PPGDSP /
// window.PpgDex — the headless node API AND every classic co-load consumer (the orchestrators, both
// test runners, and the raw analysis workers, which classic-load this file via tools/build-core.js
// `classicify`). These re-exports let the owned ESM bundle's ppgdex-app.js `import { PPGDSP }` instead
// of reading window. IMPORTANT: only these two module-scope exports are added — the worker `deps`
// functions + REFR_CADENCE_FRAC const stay classic declarations INSIDE the IIFE, so _buildWorkerURL's
// `f.toString()` serialization (and the "worker source is CLOSED" gate) is byte-unchanged.
export const PPGDSP = window.PPGDSP;
export const PpgDex = window.PpgDex;
