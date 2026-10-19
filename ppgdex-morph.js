/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   PpgDex · PULSE-WAVE MORPHOLOGY  (ppgdex-morph.js)
   ────────────────────────────────────────────────────────────────────────
   The optical analog of ECGDex's QRS/QT morphology block — something neither
   OxyDex nor ECGDex can produce. From a clean median pulse (foot→peak→notch→
   diastolic) and per-window:
     · rise / crest time      (foot → systolic peak)
     · dicrotic-notch detect  (2nd-derivative inflection on the downslope)
     · augmentation index     (reflected/diastolic vs systolic amplitude)
     · reflection index       (diastolic peak ÷ systolic peak)
     · pulse width            (at half systolic amplitude)
     · perfusion index        (AC ÷ DC, %)
   Exposes window.PPGMorph.  Pure functions; no UI.  Operates on the band-
   passed signal `bp` (systolic peaks point UP after DSP orientation).
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  const median = (a) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y),
      n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

  // ── build a foot-aligned median pulse from high-SQI beats ──────────────────
  function medianPulse(bp, det, fs, sqi) {
    const { peaks, feet } = det;
    const n = peaks.length;
    if (n < 4) return null;
    // window: from a little before the foot to ~80% of a beat after the peak
    /* PPGDEX-ALGORITHM-DEEP-DIVE §4 item 8 (owner-approved 2026-09-06: PpgDex's exported values may
       move). `pre` was 0.15 s — SHORTER than the foot-to-peak rise it has to contain (~296 ms on this
       device), so `riseTimeMs` could never exceed ms(pre) and reported a 147.4 ms ceiling instead of a
       measurement. 0.50 s holds the rise with headroom.
       Widening ALONE would relocate the defect rather than remove it: the template-level foot used to
       be a global minimum over [0, sysI), and once RR < pre + rise (above ~80 bpm, which a sports
       armband reaches) the PREVIOUS beat's foot enters that window and wins the minimum — the same
       pinning, at a number physiologically plausible enough to hide. So the search is gone too, and
       `footOff` below carries the detector's own feet, which this function already trusts for the
       amplitude normalisation a few lines down. See the brief's precondition (2026-08-19) and its
       resolved design call (2026-08-20). */
    const pre = Math.round(fs * 0.5); // before systolic peak — must contain the foot-to-peak rise
    const post = Math.round(fs * 0.55); // capture notch + diastolic + decay
    const L = pre + post;
    // collect amplitude-normalised, peak-aligned beats (clean only)
    const cols = [];
    for (let j = 0; j < L; j++) cols.push([]);
    let used = 0;
    const footOffs = [];
    for (let k = 1; k < n - 1; k++) {
      if (sqi && sqi[k] < 0.5) continue;
      const p = peaks[k];
      if (p - pre < 0 || p + post >= bp.length) continue;
      // normalise this beat foot→peak so amplitude differences don't smear the template
      const fi = Math.round(feet[k]);
      const footV = bp[Math.max(0, fi)];
      const pkV = bp[p];
      const amp = pkV - footV || 1;
      for (let j = 0; j < L; j++) cols[j].push((bp[p - pre + j] - footV) / amp);
      /* This beat's own foot, in samples before its peak. A foot that is non-finite, at or after the
         peak, or outside the template window contributes NOTHING — never a clamp and never a default
         (CLAUDE.md §∅), because a fabricated offset here would read as a measured rise time. */
      const off = p - fi;
      if (Number.isFinite(off) && off >= 1 && off <= pre) footOffs.push(off);
      used++;
      if (used >= 600) break;
    }
    if (used < 4) return null;
    /* The template's foot sits at the MEDIAN of those offsets, over the same beats the template is
       built from. Under four surviving offsets there is no foot to carry, so it travels as null and
       `delineate` refuses with a named reason rather than inventing one. */
    const footOff = footOffs.length >= 4 ? Math.round(median(footOffs)) : null;
    const beat = new Float64Array(L);
    for (let j = 0; j < L; j++) beat[j] = median(cols[j]);
    return { beat, pre, post, L, fs, nUsed: used, footOff };
  }

  // ── delineate the median pulse → fiducials + indices ───────────────────────
  function delineate(mp) {
    if (!mp || !mp.beat) return { valid: false };
    const { beat, pre, fs, L } = mp;
    // systolic peak = global max (alignment put it near `pre`)
    let sysI = pre,
      sysV = beat[pre];
    for (let i = Math.max(0, pre - Math.round(fs * 0.05)); i < Math.min(L, pre + Math.round(fs * 0.05)); i++) {
      if (beat[i] > sysV) {
        sysV = beat[i];
        sysI = i;
      }
    }
    /* foot = the detector's own foot, mapped into template coordinates (§4 item 8). The minimum
       search this replaces could be won by the previous beat's foot at any RR shorter than the
       window; a derived offset cannot be, at any heart rate. */
    if (!Number.isFinite(mp.footOff)) return { valid: false, reason: 'foot-offset-absent' };
    const footI = pre - mp.footOff;
    if (footI < 0 || footI >= sysI) return { valid: false, reason: 'foot-outside-template' };
    const footV = beat[footI];
    const amp = sysV - footV || 1;
    // first & second derivative
    const d1 = new Float64Array(L),
      d2 = new Float64Array(L);
    for (let i = 1; i < L; i++) d1[i] = beat[i] - beat[i - 1];
    for (let i = 1; i < L; i++) d2[i] = d1[i] - d1[i - 1];
    // dicrotic notch: on the downslope after the peak, the notch is the local minimum
    // of the slope's recovery — strongest positive 2nd-derivative peak (inflection).
    const ds = sysI + Math.round(fs * 0.06),
      de = Math.min(L - 2, sysI + Math.round(fs * 0.4));
    let notchI = -1,
      notchScore = -Infinity;
    for (let i = ds; i < de; i++) {
      // notch = a positive d2 bump where d1 swings from negative back toward 0
      if (d2[i] > notchScore && d1[i] < ((0.4 * Math.abs(amp)) / fs) * 5) {
        notchScore = d2[i];
        notchI = i;
      }
    }
    // diastolic (reflected) peak = local maximum after the notch
    let diaI = -1,
      diaV = -Infinity;
    if (notchI > 0) {
      for (let i = notchI; i < Math.min(L - 1, notchI + Math.round(fs * 0.3)); i++) {
        if (beat[i] > diaV) {
          diaV = beat[i];
          diaI = i;
        }
      }
    }
    const notchPresent = notchI > 0 && diaI > notchI && diaV - beat[notchI] > 0.015 * amp;
    // half-amplitude pulse width
    const halfV = footV + amp * 0.5;
    let l = sysI,
      rgt = sysI;
    for (let i = sysI; i >= footI; i--) {
      if (beat[i] <= halfV) {
        l = i;
        break;
      }
    }
    for (let i = sysI; i < L - 1; i++) {
      if (beat[i] <= halfV) {
        rgt = i;
        break;
      }
    }
    const ms = (s) => (s / fs) * 1000;
    const riseTimeMs = ms(sysI - footI);
    const pulseWidthMs = ms(rgt - l);
    // augmentation index = (P2 − P1)/PP  where P1=systolic, P2=reflected
    let aiPct = null,
      reflectionIndex = null;
    if (notchPresent) {
      const P1 = sysV - footV;
      const P2 = diaV - footV;
      aiPct = r1((100 * (P2 - P1)) / P1); // type-A/B AI (commonly negative at young, rises with stiffness)
      reflectionIndex = r2(P2 / P1);
    }
    // ── SDPPG / APG aging index (Takazawa 1998) — from the 2nd derivative ───────
    // The acceleration-PPG shows 5 waves a,b,c,d,e. a = early-systolic positive
    // spike; b = the following deep negative. The b/a ratio is the single most
    // age/stiffness-correlated SDPPG index: strongly negative in young compliant
    // arteries (~−0.8), rising toward 0 as arteries stiffen. The full aging index
    // AGI = (b−c−d−e)/a likewise rises with vascular age. Both are scale-free
    // because `beat` is already foot→peak amplitude-normalised. Reflective wrist
    // PPG makes the late waves (c,d,e) noisy → AGI is emitted only when all five
    // fiducials resolve in order; b/a needs just a and b.
    let sdppgBA = null,
      sdppgAGI = null;
    let aI = -1,
      aV = -Infinity,
      bI = -1,
      bV = Infinity,
      cI = -1,
      dI = -1,
      eI = -1;
    const aEnd = Math.min(L - 1, sysI + Math.round(fs * 0.03));
    for (let i = Math.max(1, footI); i <= aEnd; i++) {
      if (d2[i] > aV) {
        aV = d2[i];
        aI = i;
      }
    }
    if (aI > 0) {
      const bEnd = Math.min(L - 1, sysI + Math.round(fs * 0.22));
      for (let i = aI; i <= bEnd; i++) {
        if (d2[i] < bV) {
          bV = d2[i];
          bI = i;
        }
      }
    }
    if (aI > 0 && bI > aI && aV > 0) sdppgBA = r2(bV / aV); // negative; rises toward 0 with stiffness
    if (bI > aI) {
      let cV = -Infinity;
      const cEnd = Math.min(L - 1, bI + Math.round(fs * 0.12));
      for (let i = bI; i <= cEnd; i++) {
        if (d2[i] > cV) {
          cV = d2[i];
          cI = i;
        }
      }
      let dV = Infinity;
      const dEnd = cI > 0 ? Math.min(L - 1, cI + Math.round(fs * 0.12)) : -1;
      for (let i = cI > 0 ? cI : 0; i <= dEnd; i++) {
        if (d2[i] < dV) {
          dV = d2[i];
          dI = i;
        }
      }
      let eV = -Infinity;
      const eEnd = dI > 0 ? Math.min(L - 1, dI + Math.round(fs * 0.14)) : -1;
      for (let i = dI > 0 ? dI : 0; i <= eEnd; i++) {
        if (d2[i] > eV) {
          eV = d2[i];
          eI = i;
        }
      }
      if (aI > 0 && bI > aI && cI > bI && dI > cI && eI > dI && aV > 0) sdppgAGI = r2((bV - cV - dV - eV) / aV);
    }
    return {
      valid: true,
      beat: Array.from(beat),
      pre,
      fs,
      L,
      marks: { footI, sysI, notchI: notchPresent ? notchI : -1, diaI: notchPresent ? diaI : -1, halfL: l, halfR: rgt, footV, sysV, halfV, aI, bI, cI, dI, eI },
      riseTimeMs: r1(riseTimeMs),
      crestTimeMs: r1(riseTimeMs),
      pulseWidthMs: r1(pulseWidthMs),
      dicroticNotchPresent: notchPresent,
      augmentationIndexPct: aiPct,
      reflectionIndex,
      notchTimeMs: notchPresent ? r1(ms(notchI - footI)) : null,
      sdppgBA,
      sdppgAGI
    };
  }

  // ── per-window AI/PI trend (stiffness/tone drift) ──────────────────────────
  function perWindowMorph(bp, raw, det, fs, sqi, winSec, amb) {
    winSec = winSec || 60;
    const { peaks } = det;
    if (peaks.length < 8) return [];
    const out = [];
    const tEndSamp = peaks[peaks.length - 1];
    const winSamp = winSec * fs;
    for (let w0 = 0; w0 < tEndSamp; w0 += winSamp) {
      const idx = [];
      for (let k = 0; k < peaks.length; k++) {
        if (peaks[k] >= w0 && peaks[k] < w0 + winSamp) idx.push(k);
      }
      if (idx.length < 4) continue;
      const sub = { peaks: idx.map((k) => det.peaks[k]), feet: idx.map((k) => det.feet[k]) };
      const subSqi = idx.map((k) => (sqi ? sqi[k] : 1));
      const mp = medianPulse(bp, sub, fs, subSqi);
      const d = mp ? delineate(mp) : null;
      // PI within this window: AC (std of bp) ÷ DC (|mean raw|)
      // s0/s1 MUST be integers: winSamp = winSec*fs and fs is the median sensor-ns delta, so on a real
      // Polar capture it is never integral (176.26 → winSamp 10575.6). Indexing a Float32Array at a
      // fractional index returns undefined, so from the 2nd window on dc/ac went NaN and pi silently
      // became null — the surfaced per-window PI trend was plotting only the windows where w0 happened
      // to land on an integer (2 of 18 on a real night). Round ONLY the sample bounds: w0 stays a float
      // for the peak-assignment comparisons above, so beat→window assignment (and ai/ri/beats) is
      // untouched and pi is the only value that moves. (EFFICIENCY-AUDIT-FINDINGS-2026-07-12 §C1.)
      let pi = null;
      const s0 = Math.round(w0),
        s1 = Math.min(raw.length, Math.round(w0 + winSamp));
      if (s1 - s0 > fs) {
        let acc = 0,
          c = 0;
        for (let i = s0; i < s1; i++) {
          // DC is referenced to the detector's zero-light (ambient) phase — see `perfusionIndex`
          const d = amb ? raw[i] - amb[i] : raw[i];
          if (!Number.isFinite(d)) continue;
          acc += d < 0 ? -d : d;
          c++;
        }
        const dc = c ? acc / c : 0;
        let m = 0;
        for (let i = s0; i < s1; i++) m += bp[i];
        m /= s1 - s0;
        let v = 0;
        for (let i = s0; i < s1; i++) {
          const dd = bp[i] - m;
          v += dd * dd;
        }
        const ac = Math.sqrt(v / (s1 - s0));
        if (dc > 0) pi = r2((100 * ac) / dc);
      }
      out.push({
        tMin: r1(w0 / fs / 60),
        beats: idx.length,
        riseTimeMs: d && d.valid ? d.riseTimeMs : null,
        ai: d && d.valid ? d.augmentationIndexPct : null,
        ri: d && d.valid ? d.reflectionIndex : null,
        pi,
        notch: d && d.valid ? d.dicroticNotchPresent : false
      });
    }
    return out;
  }

  /* ── perfusion index over the whole record ─────────────────────────────────
     `amb` is the detector's zero-light (ambient) phase, aligned sample-for-sample with `raw`, and the
     DC term is `mean|raw - amb|`. The ambient phase sits ~650,000 counts from zero on every Verity
     file (0.038 % spread over 27 real nights), so `mean|raw|` is a pedestal plus the light and divides
     the perfusion index down by the whole pedestal — 0.78x-3.90x on those nights, median 2.02x.
     `amb` is a NEW TRAILING OPTIONAL param: without it this keeps the pedestal denominator, which is
     the right answer for the one layout that carries no ambient column (the O2Ring finger site, whose
     ring already applies the subtraction on-device). */
  function perfusionIndex(bp, raw, amb) {
    let acc = 0,
      c = 0;
    for (let i = 0; i < raw.length; i++) {
      const d = amb ? raw[i] - amb[i] : raw[i];
      if (!Number.isFinite(d)) continue;
      acc += d < 0 ? -d : d;
      c++;
    }
    if (!c) return null; // §∅ — nothing finite to divide by reports nothing, not a 0
    const dc = acc / c;
    let m = 0;
    for (let i = 0; i < bp.length; i++) m += bp[i];
    m /= bp.length;
    let v = 0;
    for (let i = 0; i < bp.length; i++) {
      const d = bp[i] - m;
      v += d * d;
    }
    const ac = Math.sqrt(v / bp.length);
    return dc > 0 ? r2((100 * ac) / dc) : null;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ORCHESTRATOR
  // ════════════════════════════════════════════════════════════════════════
  function analyze(bp, raw, det, fs, sqi, amb) {
    const mp = medianPulse(bp, det, fs, sqi);
    const del = mp ? delineate(mp) : { valid: false };
    const perWindow = perWindowMorph(bp, raw, det, fs, sqi, 60, amb);
    const pi = perfusionIndex(bp, raw, amb);
    return {
      medianBeat: mp ? { beat: Array.from(mp.beat), pre: mp.pre, fs: mp.fs, L: mp.L, nUsed: mp.nUsed, footOff: mp.footOff } : null,
      delin: del,
      riseTimeMs: del.valid ? del.riseTimeMs : null,
      crestTimeMs: del.valid ? del.crestTimeMs : null,
      dicroticNotchPresent: del.valid ? del.dicroticNotchPresent : false,
      augmentationIndexPct: del.valid ? del.augmentationIndexPct : null,
      reflectionIndex: del.valid ? del.reflectionIndex : null,
      notchTimeMs: del.valid ? del.notchTimeMs : null,
      sdppgBA: del.valid ? del.sdppgBA : null,
      sdppgAGI: del.valid ? del.sdppgAGI : null,
      pulseWidthMs: del.valid ? del.pulseWidthMs : null,
      perfusionIndexPct: pi,
      perWindow
    };
  }

  global.PPGMorph = { analyze, medianPulse, delineate, perWindowMorph, perfusionIndex };
})(window);
