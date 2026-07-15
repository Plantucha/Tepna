/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   synth-gen.js — Synthetic Overnight Corpus generator for the Dex Suite
   ----------------------------------------------------------------------------
   ONE virtual subject ("Subject A", 45M, BMI 31, untreated moderate OSA),
   FIVE consecutive nights, every device recording the SAME nights on the SAME
   floating wall-clock (CLOCK CONTRACT — see CLAUDE.md). A single master event
   timeline per night is rendered into each device's native file format, so every
   app loads the corpus UNCHANGED and the Integrator can fuse across nodes.

   Single source of truth: both synth-gen.html (the UI tool) and the project
   build step eval this file and call SYNTH.*.  Pure JS, no deps, deterministic
   (seeded mulberry32). Exposes window.SYNTH.
   ════════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  // ─── deterministic RNG ─────────────────────────────────────────────────────
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // gaussian from a uniform rng
  function gaussFrom(rng) {
    let u = 0,
      v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ─── CLOCK CONTRACT helpers — floating wall-clock ms via Date.UTC ───────────
  const P2 = (n) => (n < 10 ? '0' : '') + n;
  const P3 = (n) => (n < 10 ? '00' : n < 100 ? '0' : '') + n;
  function civilMs(y, mo, d, h, mi, s, ms) {
    return Date.UTC(y, mo - 1, d, h, mi, s || 0, ms || 0);
  }
  // formatters (read back with getUTC* so output is viewer-timezone independent)
  function fmtOxy(ms) {
    const d = new Date(ms); // "HH:MM:SS DD/MM/YYYY"  (O2Ring, DMY)
    return P2(d.getUTCHours()) + ':' + P2(d.getUTCMinutes()) + ':' + P2(d.getUTCSeconds()) + ' ' + P2(d.getUTCDate()) + '/' + P2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
  }
  function fmtISO(ms, withMs) {
    // "YYYY-MM-DDTHH:MM:SS(.mmm)"  (Polar/phone, no zone)
    const d = new Date(ms);
    let s = d.getUTCFullYear() + '-' + P2(d.getUTCMonth() + 1) + '-' + P2(d.getUTCDate()) + 'T' + P2(d.getUTCHours()) + ':' + P2(d.getUTCMinutes()) + ':' + P2(d.getUTCSeconds());
    if (withMs) s += '.' + P3(d.getUTCMilliseconds());
    return s;
  }
  function fmt14(ms) {
    // "YYYYMMDDHHMMSS" for filenames
    const d = new Date(ms);
    return d.getUTCFullYear() + P2(d.getUTCMonth() + 1) + P2(d.getUTCDate()) + P2(d.getUTCHours()) + P2(d.getUTCMinutes()) + P2(d.getUTCSeconds());
  }
  function fmtFileClock(ms) {
    // "YYYY-MM-DD HH-MM-SS" RR filename
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + P2(d.getUTCMonth() + 1) + '-' + P2(d.getUTCDate()) + ' ' + P2(d.getUTCHours()) + '-' + P2(d.getUTCMinutes()) + '-' + P2(d.getUTCSeconds());
  }
  function fmtGluco(ms, zone) {
    // "YYYY-MM-DDTHH:MM-04:00"  (Lingo, zoned)
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + P2(d.getUTCMonth() + 1) + '-' + P2(d.getUTCDate()) + 'T' + P2(d.getUTCHours()) + ':' + P2(d.getUTCMinutes()) + zone;
  }
  const MGDL = 18.018; // mg/dL per mmol/L
  const mmol2mg = (v) => Math.round(v * MGDL);

  // ─── the 5-night clinical arc (LOCKED — see SYNTHETIC-CORPUS-BRIEF §1) ──────
  // bedtime as civil [Y,M,D,h,m]; AHI target; glucose & HRV story per night.
  const NIGHTS = [
    { n: 1, date: '2026-05-11', bed: [2026, 5, 11, 23, 10], durSec: 27600, ahi: 22, cpap: false, gluc: 'flat', rmssd: 24, rsaGain: 1.199, story: 'Baseline untreated OSA' },
    {
      n: 2,
      date: '2026-05-12',
      bed: [2026, 5, 12, 23, 55],
      durSec: 26400,
      ahi: 38,
      cpap: false,
      gluc: 'hypo',
      rmssd: 18,
      rsaGain: 0.866,
      story: 'Worse — alcohol, supine, fragmented; nocturnal hypo + CSR run'
    },
    { n: 3, date: '2026-05-13', bed: [2026, 5, 13, 22, 50], durSec: 28200, ahi: 7, cpap: true, gluc: 'flat', rmssd: 30, rsaGain: 1.523, story: 'CPAP started (intervention) — residual events only' },
    { n: 4, date: '2026-05-14', bed: [2026, 5, 14, 23, 5], durSec: 27600, ahi: 4, cpap: true, gluc: 'dawn', rmssd: 38, rsaGain: 1.95, story: 'CPAP adherent + dawn phenomenon' },
    { n: 5, date: '2026-05-15', bed: [2026, 5, 15, 23, 20], durSec: 27000, ahi: 3, cpap: true, gluc: 'dawn', rmssd: 44, rsaGain: 2.268, story: 'CPAP stable, best night' }
  ];
  const SUBJECT = { id: 'SubjectA', age: 45, sex: 'M', bmi: 31, polarId: 'BBBBBBBB', glucoZone: '-04:00' };
  // texture/calibration version — read by cohort-runner's provenance pin.
  const VERSION = 'synth-gen/2.1'; // 2.1: HRV-level-scaled fast-variability floor (texF) in buildRR + dropped the τ=2 relaxor + white-noise 3→1.0 → the low-HRV RR tail renders below the old ~17.6 ms floor and SPREADS instead of stacking a flat line (paired with cohort-gen/1.9 rsaGainFor re-fit); DFA-α1 preserved ≈0.76. NIGHTS rsaGain re-fit to the new gain→rMSSD transfer. 2.0: broadband 1/f RR texture (octave-OU relaxor bank τ≈2..256 beats + RSA freq wander; DFA-α1 0.53→0.85) + re-fit NIGHTS rsaGain. Pre-2.0 = single-relaxor texture, no VERSION string.

  function nightT0(cfg) {
    return civilMs(cfg.bed[0], cfg.bed[1], cfg.bed[2], cfg.bed[3], cfg.bed[4], 0, 0);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  MASTER TIMELINE — define ONCE per night, render per device.
  //  Returns { t0Ms, durSec, events:[{relSec,t0Ms,durSec,type,severity,meta}],
  //            pb:[...], gluc:{...} }.  All times floating wall-clock.
  // ════════════════════════════════════════════════════════════════════════
  function masterTimeline(cfg, seed) {
    const rng = mulberry32(seed);
    const t0Ms = nightT0(cfg);
    const durSec = cfg.durSec;
    const cycleLen = 95 * 60; // ~90-min sleep cycle
    // sleep stage at rel sec → REM fraction high near end of each cycle
    function remWeight(t) {
      const ph = (t % cycleLen) / cycleLen;
      // descending into deep early, REM-rich in last third; first cycle mostly light
      const cyc = Math.floor(t / cycleLen);
      const remBoost = ph > 0.78 ? 1.0 : ph > 0.6 ? 0.5 : 0.12;
      return remBoost * Math.min(1, 0.4 + cyc * 0.18); // REM lengthens through the night
    }

    // —— apnea / hypopnea events, clustered in REM-ish bouts to hit target AHI ——
    const durHours = durSec / 3600;
    const targetCount = Math.round(cfg.ahi * durHours);
    const events = [];
    const SOL = 6 * 60; // sleep onset latency ~6 min
    const usable = durSec - SOL - 120;
    // base spacing slightly under target so we reliably reach the count, then truncate
    const base = usable / (targetCount * 1.06);
    const severe = cfg.ahi >= 25;
    let tt = SOL,
      placed = 0,
      guard = 0;
    while (placed < targetCount && guard++ < targetCount * 4 + 50) {
      const w = remWeight(tt);
      const dur = Math.round((severe ? 18 : 12) + rng() * (severe ? 22 : 16)); // 10–40 s
      const isApnea = rng() < (severe ? 0.62 : 0.4);
      const depthBase = (dur / 38) * (isApnea ? 13 : 9.5) * (cfg.cpap ? 0.5 : 1);
      const depth = Math.max(3.5, Math.min(15, depthBase + gaussFrom(rng) * 1.2));
      events.push({
        relSec: tt,
        t0Ms: t0Ms + tt * 1000,
        durSec: dur,
        type: isApnea ? 'apnea' : 'hypopnea',
        severity: +depth.toFixed(1),
        meta: { rem: +w.toFixed(2), supine: cfg.n === 2 || rng() < 0.5 }
      });
      placed++;
      // clustered spacing: mostly short intra-bout gaps, occasional long inter-bout gap;
      // stretch gaps where REM weight is low so events bunch into REM-ish bouts.
      const intra = rng() < 0.62;
      let gap = (intra ? base * 0.3 + dur : base * 1.9) * (1.45 - 0.6 * w);
      tt += Math.max(dur + 8, gap);
      if (tt > durSec - 120) tt = SOL + rng() * usable * 0.05; // wrap to fill remaining count
    }
    events.sort((a, b) => a.relSec - b.relSec);

    // —— periodic-breathing / CSR-like runs (smooth crescendo–decrescendo) ——
    const pb = [];
    function addPB(relStart, cycleSec, nCyc, ampPct) {
      pb.push({ relSec: relStart, t0Ms: t0Ms + relStart * 1000, cycleSec, nCyc, durSec: cycleSec * nCyc, ampPct });
    }
    if (cfg.n === 2) {
      // a clear CSR run on the severe night
      addPB(3 * 3600 + 12 * 60, 58, 8, 3.5); // ~03:0x range relative depends on bedtime
      addPB(5 * 3600 + 5 * 60, 64, 5, 2.6);
    } else if (!cfg.cpap) {
      addPB(2 * 3600 + 40 * 60, 70, 4, 2.2);
    } else if (cfg.n === 3) {
      addPB(1 * 3600 + 30 * 60, 80, 3, 1.6); // residual on the night CPAP starts
    }

    // —— glucose event spec (rendered by renderGluco against absolute civil time) ——
    let gluc = { kind: cfg.gluc };
    return { cfg, t0Ms, durSec, events, pb, gluc, remWeight, seed };
  }

  // helper: is rel time inside any apnea event window (+arousal tail)? returns {inApnea, arousal, depth}
  function apneaStateAt(tl, relSec) {
    let inApnea = false,
      arousal = 0,
      depth = 0;
    // linear scan is fine (events sorted, few hundred)
    for (const e of tl.events) {
      if (relSec < e.relSec - 1) break;
      const end = e.relSec + e.durSec;
      if (relSec >= e.relSec && relSec < end) {
        inApnea = true;
        depth = Math.max(depth, e.severity);
      }
      // arousal rebound window 0..9 s after event end
      if (relSec >= end && relSec < end + 9) {
        arousal = Math.max(arousal, 1 - (relSec - end) / 9);
      }
    }
    return { inApnea, arousal, depth };
  }
  function pbStateAt(tl, relSec) {
    // periodic-breathing phase amplitude (−1..1)*ampPct
    for (const r of tl.pb) {
      if (relSec >= r.relSec && relSec < r.relSec + r.durSec) {
        const ph = (relSec - r.relSec) / r.cycleSec;
        // crescendo–decrescendo envelope across the run
        const env = Math.sin((Math.PI * (relSec - r.relSec)) / r.durSec);
        return { amp: Math.sin(2 * Math.PI * ph) * r.ampPct * (0.5 + 0.5 * env), active: true };
      }
    }
    return { amp: 0, active: false };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  OxyDex — O2Ring CSV  (1 Hz · "Time,Oxygen Level,Pulse Rate,Motion")
  // ════════════════════════════════════════════════════════════════════════
  function renderOxy(tl) {
    const cfg = tl.cfg;
    const r = mulberry32(tl.seed + 101);
    const lines = ['Time,Oxygen Level,Pulse Rate,Motion'];
    const N = tl.durSec;
    const baseSpo2 = 96;
    let spo2f = baseSpo2,
      prf = 58;
    // circulatory delay: desat begins ~8 s after event onset → use a delayed apnea probe
    for (let s = 0; s < N; s++) {
      const ms = tl.t0Ms + s * 1000;
      const probe = apneaStateAt(tl, s - 8); // SpO2 lags onset
      const pb = pbStateAt(tl, s);
      // SpO2 target
      let target = baseSpo2 + gaussFrom(r) * 0.25;
      if (probe.inApnea) target = baseSpo2 - probe.depth * (0.4 + 0.6 * Math.min(1, 1));
      const arouse = apneaStateAt(tl, s - 8).arousal;
      if (arouse > 0) target += 1.2 * arouse; // mild recovery overshoot
      target += pb.amp * 0.7; // periodic-breathing ripple
      // glide spo2 toward target (desat fast, resaturate a touch slower)
      const k = target < spo2f ? 0.28 : 0.16;
      spo2f += (target - spo2f) * k;
      let spo2 = Math.round(Math.max(60, Math.min(100, spo2f)));
      // pulse rate: nocturnal floor + arousal/apnea surges + drift
      const cyc = tl.remWeight(s);
      let prT = 56 + cyc * 8 - Math.min(6, (s / N) * 6) + gaussFrom(r) * 0.6;
      const st = apneaStateAt(tl, s);
      if (st.inApnea) prT -= 3; // bradycardia during apnea
      if (st.arousal > 0) prT += 12 * st.arousal; // tachy surge on arousal
      prf += (prT - prf) * 0.25;
      let pr = Math.round(Math.max(35, Math.min(140, prf)));
      // motion: spikes at arousals + position changes; mostly 0
      let motion = 0;
      if (st.arousal > 0.35 && r() < 0.5) motion = 1 + Math.floor(r() * 3);
      // injected finger-off dropout spans (sensor realism) — leave a clean span intact
      const inDrop = dropoutAt(cfg, s, 'oxy');
      if (inDrop) {
        lines.push(fmtOxy(ms) + ',--,--,0');
        continue;
      }
      lines.push(fmtOxy(ms) + ',' + spo2 + ',' + pr + ',' + motion);
    }
    return lines.join('\n') + '\n';
  }

  // shared dropout schedule (deterministic per night) — keeps ≥1 clean span/night
  function dropoutAt(cfg, relSec, dev) {
    // one finger-off / contact-loss span per night, away from key events
    const spans =
      {
        oxy: [[Math.round(cfg.durSec * 0.46), 70]], // ~70 s blanks mid-night
        ppg: [[Math.round(cfg.durSec * 0.0), 0]]
      }[dev] || [];
    for (const [st, len] of spans) {
      if (relSec >= st && relSec < st + len) return true;
    }
    return false;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  RR engine — beat-by-beat NN series (shared by ECGDex deviceRR + PulseDex)
  //  Output: delimited "ISOnozone;RRms" so PulseDex captures the wall-clock t0Ms.
  // ════════════════════════════════════════════════════════════════════════
  function buildRR(tl) {
    const cfg = tl.cfg;
    const r = mulberry32(tl.seed + 202);
    // Non-RSA fast-variability scale, tied to the night's HRV level (rsaGain). Bulk/high-HRV
    // nights (gain ≥ 0.9, target ≳ 22 ms) keep FULL broadband texture — DFA-α1 is measured
    // there and must not move. Low-HRV nights (severe-apnea/elderly tail) get proportionally
    // less fast variability, so their rendered rMSSD floor drops and the low tail SPREADS
    // instead of stacking on a hard line — physiological (low vagal tone ⇒ less complex RR).
    const texF = Math.min(1, Math.max(0.3, 0.3 + (0.7 * (cfg.rsaGain || 1)) / 0.9));
    const beats = []; // {tMs, rr, type}
    let tRel = 0.4; // sec
    let lf = 0,
      lfT = 0,
      bw = 0,
      sinus = 1000,
      pendComp = 0,
      cvhrS = 0;
    // RSA phase is integrated in real time with a slowly-WANDERING respiratory
    // frequency (not a fixed 0.235 Hz metronome). A locked frequency rings in the
    // autocorrelation for 15+ beats on clean (low-apnea) nights; letting it wander
    // broadens the HF band so the autocorrelation damps within ~2 cycles, as real RSA does.
    let respPh = r() * 2 * Math.PI,
      zRespF = gaussFrom(r),
      lastTRel = 0;
    // Broadband 1/f background (octave-spaced OU relaxors, τ ≈ 3..256 beats) in place of
    // the old single slow relaxor. Real RR is pink at short scales (DFA-α1 ≈ 1.02–1.30,
    // measured across 13 real H10 nights); a single slow OU left the 4–16-beat band white
    // (α1 ≈ 0.5). Spreading 1/f power across that band lifts α1 to ≈0.85 and also pulls
    // SampEn and SDNN/RMSSD toward the real distribution.
    // PARTIAL: α1 reaches ≈0.85, not the real ≈1.16 — the narrowband RSA (its amplitude
    // pinned by the per-night rMSSD targets) caps short-scale α1; closing the last ~0.3
    // needs a multifractal RSA model, not a parameter (a multiplicative 1/f coupling was
    // tested against the real corpus and made α1 worse, so it was rejected).
    const bwTau = [3, 4, 6, 8, 12, 16, 24, 32, 64, 128, 256];
    const bwA = bwTau.map((t) => Math.exp(-1 / t)),
      bwS = bwA.map((a) => Math.sqrt(1 - a * a));
    const bwNorm = Math.sqrt(bwTau.length);
    const bwBank = bwTau.map(() => gaussFrom(r));
    // hypo window (N2): compensatory tachycardia + rMSSD collapse + a few ectopics
    const hypo = cfg.gluc === 'hypo';
    const hypoStart = 3 * 3600 + 6 * 60 - (cfg.bed[3] * 3600 + cfg.bed[4] * 60 - 23 * 3600 - 55 * 60); // align ~03:06 civil
    // simpler: compute hypo nadir civil 03:00..03:40 → rel via t0Ms
    const hypoNadirRel = (civilMs(2026, 5, cfg.bed[2] + 1, 3, 6, 0) - tl.t0Ms) / 1000;
    // base HR curve: deep-sleep dip, REM rise, slow circadian fall
    function baseRR(relSec) {
      const cyc = (relSec % (95 * 60)) / (95 * 60);
      let base;
      if (cyc < 0.12)
        base = 980; // light onset
      else if (cyc < 0.5)
        base = 1135; // deep (N3) — slow HR, high RR
      else if (cyc < 0.78)
        base = 1050; // N2
      else base = 915; // REM — faster HR
      base += Math.min(55, (relSec / tl.durSec) * 50); // circadian downward HR drift → RR up
      return base;
    }
    while (tRel < tl.durSec) {
      const vagal = (() => {
        const cyc = (tRel % (95 * 60)) / (95 * 60);
        return cyc < 0.5 ? 0.85 : cyc < 0.78 ? 0.65 : 0.42;
      })();
      // respiratory sinus arrhythmia — per-night rsaGain sets the beat-to-beat (rMSSD) scale.
      // Frequency wanders around 0.235 Hz (breathing is not metronomic; REM loosens it),
      // integrated as phase over real elapsed time so the HF band broadens and won't ring;
      // the wander also de-narrows RSA enough that it no longer fully caps short-scale α1.
      const remIrr = vagal < 0.5 ? 1.6 : 1; // looser, more variable breathing in REM
      zRespF = 0.95 * zRespF + gaussFrom(r) * Math.sqrt(1 - 0.95 * 0.95);
      respPh += 2 * Math.PI * (0.235 * Math.exp(0.35 * remIrr * zRespF)) * (tRel - lastTRel);
      lastTRel = tRel;
      const resp = Math.sin(respPh) * 22 * (1.1 - vagal * 0.4) * (cfg.rsaGain || 1);
      lfT = (r() - 0.5) * 2;
      lf = 0.9 * lf + 0.1 * lfT;
      const lfMs = lf * 22 * (1.1 - vagal * 0.5);
      bw = 0;
      for (let j = 0; j < bwA.length; j++) {
        bwBank[j] = bwA[j] * bwBank[j] + gaussFrom(r) * bwS[j];
        bw += bwBank[j];
      }
      bw = (bw / bwNorm) * 30 * texF; // broadband 1/f background (see buildRR head), HRV-level-scaled
      // CVHR: bradycardia in apnea, tachy rebound at arousal — SMOOTHED over ~6 beats so
      // it loads SDNN/VLF (a slow cyclic oscillation) without spuriously inflating rMSSD.
      const st = apneaStateAt(tl, tRel);
      let cvhrTgt = 0;
      if (st.inApnea) cvhrTgt += 70 + st.depth * 4; // RR rises (HR slows)
      if (st.arousal > 0) cvhrTgt -= (110 + st.depth * 3) * st.arousal; // rebound tachy
      cvhrS = 0.8 * cvhrS + 0.2 * cvhrTgt;
      const cvhr = cvhrS;
      // periodic breathing sinusoid on RR
      const pb = pbStateAt(tl, tRel);
      const pbMs = pb.active ? pb.amp * 30 : 0;
      // hypo coupling (N2): tachycardia + suppressed beat-to-beat variability near nadir
      let hypoMs = 0,
        hypoSupp = 1;
      if (hypo) {
        const d = Math.abs(tRel - hypoNadirRel);
        if (d < 25 * 60) {
          const w = Math.max(0, 1 - d / (25 * 60));
          hypoMs = -120 * w;
          hypoSupp = 1 - 0.5 * w;
        }
      }
      let rr = baseRR(tRel) + (resp + lfMs) * hypoSupp + bw + cvhr + pbMs + hypoMs + gaussFrom(r) * 1.0 * texF;
      let type = 'N';
      if (pendComp > 0) {
        rr += pendComp;
        pendComp = 0;
      } else if (hypo && Math.abs(tRel - hypoNadirRel) < 12 * 60 && r() < 0.0016) {
        type = 'V';
        const c = rr * (0.5 + 0.12 * r());
        pendComp = 2 * rr - c - rr;
        rr = c; // PVC
      } else if (r() < 0.0006) {
        type = 'S';
        const c = rr * (0.58 + 0.12 * r());
        pendComp = rr * 0.35;
        rr = c; // PAC
      }
      rr = Math.max(360, Math.min(1700, rr));
      beats.push({ tMs: tl.t0Ms + Math.round(tRel * 1000), rr: Math.round(rr), type });
      tRel += rr / 1000;
    }
    return beats;
  }
  function renderRR(tl) {
    // "ISO;RR" per line (no header)
    const beats = buildRR(tl);
    const out = [];
    for (const b of beats) out.push(fmtISO(b.tMs, true) + ';' + b.rr);
    return out.join('\n') + '\n';
  }

  // ════════════════════════════════════════════════════════════════════════
  //  GlucoDex — CGM CSV (Lingo), ONE continuous file across all 5 nights/days.
  //  5-min sampling, mg/dL, zoned ISO timestamps.
  // ════════════════════════════════════════════════════════════════════════
  function renderGlucoAll(timelines) {
    const r = mulberry32(9090);
    const header = 'Time of Glucose Reading [T=(local time) +/- (time zone offset)], Measurement(mg/dL)';
    const rows = [header];
    // continuous worn sensor: span from first bedtime −2 h to last morning +3 h, 5-min cadence
    const startMs = timelines[0].t0Ms - 2 * 3600 * 1000;
    const endMs = timelines[timelines.length - 1].t0Ms + (timelines[timelines.length - 1].durSec + 3 * 3600) * 1000;
    // baseline fasting glucose (mmol/L) — a patient-level knob. Optional
    // cfg.glucBaseMmol lets a caller raise the whole series (e.g. pre-diabetes
    // ~6.6) WITHOUT touching the frozen corpus, whose cfgs omit the field →
    // +undefined||5.4 → 5.4 → byte-identical legacy output.
    let baseMmol = +(timelines[0] && timelines[0].cfg && timelines[0].cfg.glucBaseMmol) || 5.4,
      drift = 0;
    for (let ms = startMs; ms <= endMs; ms += 5 * 60 * 1000) {
      const d = new Date(ms);
      const hod = d.getUTCHours() + d.getUTCMinutes() / 60;
      // slow ultradian drift + improving TIR across the arc
      drift = 0.985 * drift + gaussFrom(r) * 0.06;
      let mmol = baseMmol + drift;
      // daytime postprandial bumps (coarse) — gentle, not the focus
      if (hod > 7 && hod < 22) mmol += 0.8 * Math.max(0, Math.sin(((hod - 7) / 15) * Math.PI)) + (r() < 0.04 ? 1.5 + r() * 2 : 0);
      // which night are we inside?
      for (const tl of timelines) {
        const rel = (ms - tl.t0Ms) / 1000;
        if (rel < -3600 || rel > tl.durSec + 3600) continue;
        // apnea-coupled slow sympathetic elevation over heavy bouts
        if (rel > 0 && rel < tl.durSec) {
          const burden = tl.cfg.ahi / 40;
          mmol += burden * 0.5 * Math.max(0, Math.sin((rel / tl.durSec) * Math.PI));
        }
        // night-2 nocturnal hypo (~03:00) + Somogyi rebound to ~7.5 by 05:00
        if (tl.cfg.gluc === 'hypo') {
          const nadir = civilMs(2026, 5, tl.cfg.bed[2] + 1, 3, 6, 0) - 0; // civil ms
          const t = ms;
          if (t > nadir - 60 * 60000 && t < nadir + 120 * 60000) {
            const dm = (t - nadir) / 60000; // minutes from nadir
            if (dm < 0) mmol = 5.4 + (3.2 - 5.4) * Math.min(1, (dm + 40) / 40 < 0 ? 0 : (40 + dm) / 40);
            if (dm >= -40 && dm < 0) mmol = 5.4 + (3.2 - 5.4) * ((40 + dm) / 40);
            else if (dm >= 0 && dm < 20)
              mmol = 3.2; // plateau
            else if (dm >= 20 && dm < 114) mmol = 3.2 + (7.5 - 3.2) * ((dm - 20) / 94); // rebound
          }
        }
        // night-4/5 dawn phenomenon (~05:00→07:00 rise +1.5–2.5 mmol)
        if (tl.cfg.gluc === 'dawn') {
          const dawn0 = civilMs(2026, 5, tl.cfg.bed[2] + 1, 5, 0, 0);
          if (ms > dawn0) {
            const amp = tl.cfg.n === 5 ? 2.4 : 1.8;
            mmol += amp * Math.min(1, (ms - dawn0) / (150 * 60000)); // rise over 2.5 h, then plateau
          }
        }
      }
      mmol = Math.max(2.5, mmol);
      let mg = mmol2mg(mmol) + Math.round(gaussFrom(r) * 2); // sensor noise ±0.1–0.3 mmol
      rows.push(fmtGluco(ms, SUBJECT.glucoZone) + ',' + Math.max(40, mg));
    }
    return rows.join('\n') + '\n';
  }

  // ════════════════════════════════════════════════════════════════════════
  //  HRVDex — Welltory summary CSV (one row per night, derived from that
  //  night's RR series so HRVDex agrees with PulseDex/ECGDex).
  // ════════════════════════════════════════════════════════════════════════
  function hrvMetrics(beats) {
    // artifact-clean first (mirror PulseDex/ECGDex: clip 300-2200, >20% off local median)
    const raw = beats.map((b) => b.rr);
    const rr = raw.slice();
    for (let i = 0; i < raw.length; i++) {
      const lo = Math.max(0, i - 5),
        hi = Math.min(raw.length, i + 6),
        seg = [];
      for (let j = lo; j < hi; j++) if (j !== i) seg.push(raw[j]);
      seg.sort((a, b) => a - b);
      const med = seg[seg.length >> 1] || raw[i];
      if (raw[i] < 300 || raw[i] > 2200 || (med && Math.abs(raw[i] - med) / med > 0.2)) rr[i] = med;
    }
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const meanRR = mean(rr);
    const sdnn = Math.sqrt(mean(rr.map((v) => (v - meanRR) ** 2)));
    let sd = 0;
    for (let i = 1; i < rr.length; i++) sd += (rr[i] - rr[i - 1]) ** 2;
    const rmssd = Math.sqrt(sd / (rr.length - 1));
    let nn50 = 0;
    for (let i = 1; i < rr.length; i++) if (Math.abs(rr[i] - rr[i - 1]) > 50) nn50++;
    const pnn50 = (nn50 / (rr.length - 1)) * 100;
    const hr = 60000 / meanRR;
    const sorted = rr.slice().sort((a, b) => a - b);
    const mxdmn = (sorted[sorted.length - 1] - sorted[0]) / 1000; // seconds (Welltory units)
    // mode (most common RR bucket) in seconds
    const f = {};
    rr.forEach((v) => {
      const k = Math.round(v / 25) * 25;
      f[k] = (f[k] || 0) + 1;
    });
    const mode = +Object.entries(f).sort((a, b) => b[1] - a[1])[0][0] / 1000;
    const amo50 = (rr.filter((v) => Math.abs(v - mode * 1000) <= 25).length / rr.length) * 100;
    const cv = (sdnn / meanRR) * 100;
    const sd1 = rmssd / Math.sqrt(2);
    const sd2 = Math.sqrt(Math.max(0, 2 * sdnn * sdnn - sd1 * sd1));
    return { meanRR, sdnn, rmssd, pnn50, hr, mxdmn, mode, amo50, cv, sd1, sd2 };
  }
  function renderHRVAll(timelines) {
    const cols = [
      'Date',
      'Time',
      'Stress(HRV)',
      'Energy(HRV)',
      'Focus',
      'ANS balance(SNS)',
      'ANS balance(PSNS)',
      'Coherence index',
      'HRV Score',
      'CV',
      'Measurement HR',
      'Mean RR',
      'SDNN',
      'rMSSD',
      'MxDMn',
      'pNN50',
      'AMo50',
      'Mode',
      'Total power',
      'HF',
      'LF',
      'VLF',
      'Health'
    ];
    const rows = [cols.join(',')];
    for (const tl of timelines) {
      const beats = buildRR(tl);
      const m = hrvMetrics(beats);
      // stress/energy/balance follow the arc (worse early, recovering post-CPAP)
      const stress = Math.round(Math.max(10, 70 - (m.rmssd - 18) * 2.0));
      const energy = Math.round(Math.min(90, 30 + (m.rmssd - 18) * 1.8));
      const sns = Math.round(Math.max(15, 75 - (m.rmssd - 18) * 1.6));
      const psns = Math.round(Math.min(85, 100 - sns + (m.rmssd - 30) * 0.4));
      const hf = Math.round(120 + m.rmssd * 9);
      const lf = Math.round(hf * (1.2 + (70 - stress) / 100));
      const vlf = Math.round((hf + lf) * (1.3 + tl.cfg.ahi / 60));
      const tp = hf + lf + vlf;
      // the row's wall-clock = a morning read just after wake
      const wake = tl.t0Ms + tl.durSec * 1000;
      const iso = fmtISO(wake, false);
      const r2 = (v, d) => (+v).toFixed(d == null ? 1 : d);
      rows.push(
        [
          iso,
          iso,
          stress,
          energy,
          Math.round(60 - stress * 0.2),
          sns,
          psns,
          Math.round(40 + (m.rmssd - 18) * 1.2),
          Math.round(25 + (m.rmssd - 18) * 1.4),
          r2(m.cv),
          r2(m.hr),
          r2(m.meanRR),
          r2(m.sdnn),
          r2(m.rmssd),
          r2(m.mxdmn, 3),
          r2(m.pnn50),
          r2(m.amo50),
          r2(m.mode, 3),
          tp,
          hf,
          lf,
          vlf,
          100
        ].join(',')
      );
    }
    return rows.join('\n') + '\n';
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PpgDex — Polar Sense raw set (windowed ~WIN_MIN min covering an apnea
  //  cluster + a clean span). PPG ~176 Hz, ACC/GYRO ~52 Hz, PPI clean-span, MARKER.
  // ════════════════════════════════════════════════════════════════════════
  const WIN_MIN = 9; // window length (minutes) per night

  function pickWindow(tl) {
    // start at the first apnea cluster well into the night, clamp to bounds
    let start = Math.round(tl.durSec * 0.3);
    if (tl.events.length) {
      const mid = tl.events[Math.floor(tl.events.length / 2)];
      start = Math.max(120, Math.min(tl.durSec - WIN_MIN * 60 - 60, mid.relSec - 120));
    }
    return { startRel: Math.round(start), lenSec: WIN_MIN * 60 };
  }

  function renderPPG(tl, win) {
    const r = mulberry32(tl.seed + 303);
    const fs = 176,
      dtNs = Math.round(1e9 / fs);
    const t0Ms = tl.t0Ms + win.startRel * 1000;
    const beats = buildRR(tl).filter((b) => b.tMs >= t0Ms - 2000 && b.tMs <= t0Ms + win.lenSec * 1000 + 2000);
    function pulse(ph) {
      // ph 0..1 within a beat
      // Realistic Polar-Sense wrist-PPG morphology: ONE dominant systolic lobe, a broad
      // diastolic decay, and only a SUBTLE dicrotic shoulder. The previous form rendered
      // the dicrotic as a prominent separate Gaussian (~35% of systolic at ph 0.42), which
      // drove the real optical beat detector into a 2:1 beat-halving lock on the clean
      // synthetic train (the identical detector tracks REAL Polar PPG fine). See the
      // PpgDex-yield entry in papers/papers.html (root-caused to this morphology).
      const sys = -Math.exp(-((ph - 0.14) ** 2) / (2 * 0.052 ** 2)); // dominant systolic lobe
      const dia = -0.4 * Math.exp(-((ph - 0.3) ** 2) / (2 * 0.16 ** 2)); // broad diastolic reservoir (slow decay, valley stays elevated)
      // Dicrotic: pulled EARLIER (0.46→0.42) onto the diastolic tail, HALVED (0.12→0.06) and a
      // touch WIDER (0.07→0.09) so it reads as a faint inflection on the decay rather than a
      // distinct secondary lobe. The previous form (a separate 0.12 hump at 0.46) re-deflected the
      // band-passed signal enough that the optical detector's positive-slope-energy pass caught it
      // as an extra beat once the heart rate quickened (T shrank toward the refractory window) —
      // a residual ~6% OVER-detection that inflated PPG rMSSD on the FULL lane. Blending it into
      // the diastolic shoulder removes that without flattening real perfusion morphology (the
      // identical detector still tracks REAL Polar PPG, which carries a true dicrotic notch).
      // See the PpgDex-yield entry in papers/papers.html + papers/qrs-yield.html.
      const dic = -0.04 * Math.exp(-((ph - 0.42) ** 2) / (2 * 0.09 ** 2)); // faint dicrotic shoulder, blended into the decay
      return 0.8 * (sys + dia + dic); // ≈ unit systolic peak (preserves amp scaling)
    }
    const base0 = -490000,
      base1 = -481000,
      base2 = -491000,
      amb0 = -650000;
    const header = 'Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient';
    const lines = [header];
    let ns = 834363814065321088n,
      dtNsB = BigInt(dtNs); // exact 18-digit monotonic ns (BigInt)
    const N = Math.round(win.lenSec * fs);
    let bi = 0;
    for (let i = 0; i < N; i++) {
      const ms = t0Ms + Math.round((i / fs) * 1000);
      const rel = win.startRel + i / fs;
      // advance to current beat
      while (bi < beats.length - 1 && beats[bi + 1].tMs <= ms) bi++;
      const bcur = beats[bi],
        bnext = beats[Math.min(bi + 1, beats.length - 1)];
      const span = Math.max(300, bnext.tMs - bcur.tMs) || 900;
      const ph = Math.max(0, Math.min(1, (ms - bcur.tMs) / span));
      // amplitude attenuation during apnea (perfusion/pulse-amplitude dip). Deepened 0.55→0.35:
      // a severe perfusion drop pushes the in-event pulse close to the detector's RELATIVE
      // amplitude floor, so apnea pulses adjacent to full-perfusion beats fall below the local
      // upslope-energy threshold and are MISSED — a genuine perfusion-yield gap. The per-beat SQI
      // is template-correlation × motion (no amplitude term), so the apnea beats that ARE detected
      // still read high quality: SQI stays green while yield falls (the QRS-yield-paper finding,
      // now driven by perfusion physics rather than by the old oversized motion artifact).
      const st = apneaStateAt(tl, rel);
      const amp = 2300 * (st.inApnea ? 0.3 : 1) * (1 + 0.04 * gaussFrom(r));
      const w = pulse(ph);
      const slow = 1800 * Math.sin((2 * Math.PI * rel) / 12); // baseline wander
      // motion-artifact span + a contact-loss dropout to exercise the QC gate
      const motion = motionBurstAt(tl, rel) ? 950 * gaussFrom(r) : 0;
      const drop = rel > win.startRel + win.lenSec * 0.62 && rel < win.startRel + win.lenSec * 0.66;
      let c0, c1, c2;
      if (drop) {
        // contact loss → the pulsatile AC vanishes (flatline), but the channel HOLDS its
        // huge DC baseline rather than teleporting to ~0. The old form jumped to ≈-10 — a
        // ~490k step (≈200× the pulse) that, after the detector's 0.5–8 Hz band-pass, rings
        // as a low-frequency transient large enough to hijack the beat-detector's
        // autocorrelation period estimate and lock it into 2:1 beat-halving across the whole
        // window. A baseline-level flatline still trips the SQI/flatline QC gate (zero AC
        // variance) without the pathological step. (See PpgDex-yield entry in papers/papers.html.)
        c0 = Math.round(base0 + gaussFrom(r) * 40);
        c1 = Math.round(base1 + gaussFrom(r) * 40);
        c2 = Math.round(base2 + gaussFrom(r) * 40);
      } else {
        // Per-sample optical noise reduced (60/70/65 → 30/34/32). At the apnea perfusion floor
        // the pulse AC is ×0.55, so the old noise sat at ~4–5% of pulse amplitude and seeded
        // spurious in-band slope-energy that the optical detector occasionally caught as extra
        // beats (the residual low-perfusion OVER-detection; ~6% on the FULL lane → PPG rMSSD
        // inflation). Halving it lifts the in-event pulse:noise ratio without making the signal
        // unrealistically clean (real Polar Sense PPG SNR is comfortably above this). The genuine
        // perfusion YIELD gap (smaller apnea pulses missed below the detection floor) is preserved.
        c0 = Math.round(base0 + w * amp + slow + motion + gaussFrom(r) * 30);
        c1 = Math.round(base1 + w * amp * 0.92 + slow * 0.9 + motion * 0.8 + gaussFrom(r) * 34);
        c2 = Math.round(base2 + w * amp * 1.05 + slow * 1.1 + motion * 1.1 + gaussFrom(r) * 32);
      }
      const amb = Math.round(amb0 + 400 * Math.sin((2 * Math.PI * rel) / 40) + gaussFrom(r) * 90);
      lines.push(fmtISO(ms, true) + ';' + ns + ';' + c0 + ';' + c1 + ';' + c2 + ';' + amb + ';');
      ns += dtNsB;
    }
    return lines.join('\n') + '\n';
  }

  // motion bursts at arousals + position changes within the night
  function motionBurstAt(tl, relSec) {
    const st = apneaStateAt(tl, relSec);
    if (st.arousal > 0.5) return true;
    // a couple of position changes
    const posChanges = [tl.durSec * 0.22, tl.durSec * 0.55, tl.durSec * 0.78];
    for (const p of posChanges) {
      if (Math.abs(relSec - p) < 2.5) return true;
    }
    return false;
  }

  function renderXYZ(tl, win, kind) {
    // kind 'ACC' | 'GYRO'
    const r = mulberry32(tl.seed + (kind === 'ACC' ? 404 : 505));
    const fs = 52,
      dtNs = Math.round(1e9 / fs);
    const t0Ms = tl.t0Ms + win.startRel * 1000;
    const header = kind === 'ACC' ? 'Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]' : 'Phone timestamp;sensor timestamp [ns];X [dps];Y [dps];Z [dps]';
    const lines = [header];
    let ns = 834363823499951360n,
      dtNsB = BigInt(dtNs);
    const N = Math.round(win.lenSec * fs);
    // resting posture: gravity mostly on Y (~ -960 mg) like the real sample
    for (let i = 0; i < N; i++) {
      const ms = t0Ms + Math.round((i / fs) * 1000);
      const rel = win.startRel + i / fs;
      const burst = motionBurstAt(tl, rel);
      if (kind === 'ACC') {
        const g = burst ? 60 : 4;
        const x = Math.round(6 + gaussFrom(r) * g);
        const y = Math.round(-958 + gaussFrom(r) * g);
        const z = Math.round(108 + gaussFrom(r) * g);
        lines.push(fmtISO(ms, true) + ';' + ns + ';' + x + ';' + y + ';' + z);
      } else {
        const g = burst ? 30 : 1.2;
        const x = (gaussFrom(r) * g).toFixed(5);
        const y = (gaussFrom(r) * g).toFixed(5);
        const z = (gaussFrom(r) * g).toFixed(5);
        lines.push(fmtISO(ms, true) + ';' + ns + ';' + x + ';' + y + ';' + z);
      }
      ns += dtNsB;
    }
    return lines.join('\n') + '\n';
  }

  function renderPPI(tl, win, empty) {
    // device PPI on clean spans
    const header = 'Phone Data RX timestamp;PP-interval [ms];error estimate [ms];blocker;contact;contact;hr [bpm]';
    if (empty) return header + '\n'; // one night emits header-only (fallback test)
    const r = mulberry32(tl.seed + 606);
    const t0Ms = tl.t0Ms + win.startRel * 1000;
    const beats = buildRR(tl).filter((b) => b.tMs >= t0Ms && b.tMs <= t0Ms + win.lenSec * 1000);
    const lines = [header];
    for (const b of beats) {
      const rel = (b.tMs - tl.t0Ms) / 1000;
      const st = apneaStateAt(tl, rel);
      const motion = motionBurstAt(tl, rel);
      const blocker = motion ? 1 : 0; // device flags motion-blocked beats
      const contact = 1; // skin contact good
      const err = +(2 + r() * 6 + (st.inApnea ? 4 : 0)).toFixed(3);
      const hr = Math.round(60000 / b.rr);
      lines.push(fmtISO(b.tMs, true) + ';' + b.rr + ';' + err + ';' + blocker + ';' + contact + ';' + contact + ';' + hr);
    }
    return lines.join('\n') + '\n';
  }

  function renderMarker(tl, win) {
    const header = 'Phone timestamp;Marker start/stop';
    const lines = [header];
    const startMs = tl.t0Ms + win.startRel * 1000;
    lines.push(fmtISO(startMs, true) + ';MARKER_START ');
    // position-change markers inside the window
    [0.22, 0.55, 0.78].forEach((f) => {
      const p = tl.durSec * f;
      if (p >= win.startRel && p < win.startRel + win.lenSec) {
        lines.push(fmtISO(tl.t0Ms + Math.round(p * 1000), true) + ';MARKER_STOP ');
        lines.push(fmtISO(tl.t0Ms + Math.round(p * 1000) + 1200, true) + ';MARKER_START ');
      }
    });
    lines.push(fmtISO(startMs + win.lenSec * 1000, true) + ';MARKER_STOP ');
    return lines.join('\n') + '\n';
  }

  // ════════════════════════════════════════════════════════════════════════
  //  GROUND TRUTH — machine-readable event list for detector scoring.
  // ════════════════════════════════════════════════════════════════════════
  function groundTruth(tl) {
    return JSON.stringify(
      {
        schema: 'ganglior.ground-truth/1.0',
        subject: SUBJECT.id,
        night: tl.cfg.n,
        date: tl.cfg.date,
        story: tl.cfg.story,
        t0Ms: tl.t0Ms,
        durSec: tl.durSec,
        ahiTarget: tl.cfg.ahi,
        cpap: tl.cfg.cpap,
        glucEvent: tl.cfg.gluc,
        events: tl.events.map((e) => ({ t0Ms: e.t0Ms, relSec: +e.relSec.toFixed(1), type: e.type, durSec: e.durSec, desatPct: e.severity, meta: e.meta })),
        periodicBreathing: tl.pb.map((p) => ({ t0Ms: p.t0Ms, cycleSec: p.cycleSec, nCyc: p.nCyc, ampPct: p.ampPct }))
      },
      null,
      1
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  //  TOP-LEVEL — build a manifest of {path, content} for the whole corpus.
  // ════════════════════════════════════════════════════════════════════════
  function buildTimelines(seedBase) {
    seedBase = seedBase || 424242;
    return NIGHTS.map((cfg, i) => masterTimeline(cfg, seedBase + i * 1000));
  }

  // device files for ONE night (lighter set). PPG handled separately (heavy).
  function nightFilesLight(tl) {
    const t0 = tl.t0Ms;
    const oxyName = 'O2Ring S 2100_' + fmt14(t0) + '.csv';
    const rrName = fmtFileClock(t0) + '.txt';
    return [
      { path: oxyName, content: renderOxy(tl) },
      { path: rrName, content: renderRR(tl) },
      { path: 'ground_truth_night' + tl.cfg.n + '.json', content: groundTruth(tl) }
    ];
  }
  function nightFilesPPG(tl, emptyPPI) {
    const win = pickWindow(tl);
    const stamp = fmt14(tl.t0Ms + win.startRel * 1000);
    const pre = 'Polar_Sense_' + SUBJECT.polarId + '_' + stamp;
    return [
      { path: pre + '_PPG.txt', content: renderPPG(tl, win) },
      { path: pre + '_ACC.txt', content: renderXYZ(tl, win, 'ACC') },
      { path: pre + '_GYRO.txt', content: renderXYZ(tl, win, 'GYRO') },
      { path: pre + '_PPI.txt', content: renderPPI(tl, win, emptyPPI) },
      { path: 'MARKER_' + stamp + '.txt', content: renderMarker(tl, win) }
    ];
  }

  // ════════════════════════════════════════════════════════════════════════
  //  DAYTIME AMBULATORY WALK  (AMBULATORY-MODE-BRIEF — the corpus gap)
  //  The corpus is overnight-biased, which is why four misfires shipped at once.
  //  This adds ONE daytime ambulatory recording (a ~2.4 h afternoon walk) coherent
  //  with the arc's wall-clock: exercise HR, sustained gait cadence, NO sleep/apnea.
  //  Loaded into ECGDex (RR primary + ACC companion) it must classify as `ambulatory`
  //  — NOT overnight — and suppress sleep staging + the CVHR/AHI screen with a reason.
  //  Guards the 2026-06-13 afternoon-walk misfire (walk scored as an overnight study).
  // ════════════════════════════════════════════════════════════════════════
  function buildWalkRR(t0Ms, durSec, seed) {
    const r = mulberry32(seed);
    const beats = [];
    let tRel = 0.4,
      lf = 0,
      lfT = 0,
      bw = 0,
      pendComp = 0;
    while (tRel < durSec) {
      const frac = tRel / durSec;
      const macro = (tRel % 600) / 600; // 10-min macro-cycle
      const paused = macro < 0.12; // standing pause → HR eases
      // exercise HR: sustained ~92 → ~105 bpm climb (RR 652→571); pauses ease toward ~87 bpm
      const base = paused ? 690 : 652 - 80 * Math.min(1, frac * 1.1);
      const resp = Math.sin(2 * Math.PI * 0.28 * tRel) * 10; // reduced RSA under exercise
      lfT = (r() - 0.5) * 2;
      lf = 0.9 * lf + 0.1 * lfT;
      const lfMs = lf * 12;
      bw = 0.992 * bw + gaussFrom(r) * 0.7; // 1/f drift
      let rr = base + resp + lfMs + bw * 2 + gaussFrom(r) * 6;
      let type = 'N';
      if (pendComp > 0) {
        rr += pendComp;
        pendComp = 0;
      } else if (r() < 0.0004) {
        type = 'S';
        const c = rr * (0.6 + 0.1 * r());
        pendComp = rr * 0.3;
        rr = c;
      } // rare PAC
      rr = Math.max(380, Math.min(1200, rr));
      beats.push({ tMs: t0Ms + Math.round(tRel * 1000), rr: Math.round(rr), type });
      tRel += rr / 1000;
    }
    return beats;
  }
  function renderWalkRR(t0Ms, durSec, seed) {
    // "ISO;RR" per line (ECGDex primary input)
    return (
      buildWalkRR(t0Ms, durSec, seed)
        .map((b) => fmtISO(b.tMs, true) + ';' + b.rr)
        .join('\n') + '\n'
    );
  }
  function renderWalkACC(t0Ms, durSec, seed) {
    // Polar ACC @ 26 Hz with real walking steps
    const r = mulberry32(seed);
    const fs = 26,
      dtNs = Math.round(1e9 / fs);
    const header = 'Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]';
    const lines = [header];
    let ns = 834363823499951360n;
    const dtNsB = BigInt(dtNs);
    const N = Math.round(durSec * fs);
    for (let i = 0; i < N; i++) {
      const ms = t0Ms + Math.round((i / fs) * 1000),
        rel = i / fs;
      const macro = (rel % 600) / 600;
      let stepHz,
        moving = true;
      if (macro < 0.12) {
        moving = false;
        stepHz = 0;
      } // standing pause (~12% → sedentary)
      else if (macro < 0.39) {
        stepHz = 1.83;
      } // brisk walk ~110 spm (~27%)
      else {
        stepHz = 1.5;
      } // light walk ~90 spm
      // step oscillation ON the gravity (z) axis so the vector-magnitude swings at step rate
      const step = moving ? 190 * Math.sin(2 * Math.PI * stepHz * rel) : 0;
      const sway = moving ? 80 * Math.sin(2 * Math.PI * stepHz * rel * 0.5) : 0;
      const nz = moving ? 26 : 6;
      const x = Math.round(40 + sway + gaussFrom(r) * nz);
      const y = Math.round(120 + sway * 0.6 + gaussFrom(r) * nz);
      const z = Math.round(980 + step + gaussFrom(r) * nz);
      lines.push(fmtISO(ms, true) + ';' + ns + ';' + x + ';' + y + ';' + z);
      ns += dtNsB;
    }
    return lines.join('\n') + '\n';
  }
  function walkGroundTruth(t0Ms, durSec) {
    return (
      JSON.stringify(
        {
          kind: 'ambulatory-daytime-walk',
          subject: SUBJECT.id,
          startEpochMs: t0Ms,
          durationSec: durSec,
          startClock: fmtISO(t0Ms, false),
          activity: { stepsApprox: '~6000–12000', briskWalkPct: '~27', cadenceSpm: '~90–110', exerciseHRbpm: '~90–105' },
          expected: {
            mode: 'ambulatory',
            overnightVeto: true,
            sleepStaging: 'suppressed (suppressed:true, stages:null)',
            cvhrApnea: 'suppressed (reportable:false, estimatedAHI:null, cvhrIndex:null)',
            stillValid: ['hr', 'hrv-under-activity (caveated)', 'gait']
          },
          note: 'Daytime ambulatory recording — guards the 2026-06-13 afternoon-walk misfire (a 2.4 h walk scored as an overnight sleep study). See AMBULATORY-MODE-BRIEF.md.'
        },
        null,
        2
      ) + '\n'
    );
  }
  // ECGDex file set: RR primary (no _RR suffix → ingested as the signal) + ACC companion + truth.
  function ambulatoryFiles(seedBase) {
    const s = seedBase || 424242;
    const t0 = civilMs(2026, 5, 13, 12, 14, 28); // daytime walk, same civil day as arc night 3
    const durSec = Math.round(2.4 * 3600);
    const id = 'AAAAAAAA';
    return [
      { path: fmtFileClock(t0) + '.txt', content: renderWalkRR(t0, durSec, s + 777) },
      { path: 'Polar_H10_' + id + '_' + fmt14(t0) + '_ACC.txt', content: renderWalkACC(t0, durSec, s + 778) },
      { path: 'ground_truth_ambulatory.json', content: walkGroundTruth(t0, durSec) }
    ];
  }

  global.SYNTH = {
    VERSION,
    NIGHTS,
    SUBJECT,
    WIN_MIN,
    mulberry32,
    masterTimeline,
    buildTimelines,
    renderOxy,
    buildRR,
    renderRR,
    renderGlucoAll,
    renderHRVAll,
    hrvMetrics,
    pickWindow,
    renderPPG,
    renderXYZ,
    renderPPI,
    renderMarker,
    groundTruth,
    nightFilesLight,
    nightFilesPPG,
    fmt14,
    fmtFileClock,
    buildWalkRR,
    renderWalkRR,
    renderWalkACC,
    walkGroundTruth,
    ambulatoryFiles
  };
})(typeof window !== 'undefined' ? window : this);
