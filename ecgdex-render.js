/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   ECGDex · RENDER  (ecgdex-render.js)
   ────────────────────────────────────────────────────────────────────────
   · ECGScope — canvas waveform explorer with a multi-resolution min/max
     envelope pyramid (NEVER subsample — that aliases away R-peaks), pan/zoom,
     R-peak markers, and greyed SQI-excluded spans.
   · hand-rolled inline-SVG charts (tachogram · Poincaré · hypnogram ·
     CVHR HR-cycling · rMSSD trend) — the PulseDex template-string pattern.
   Exposes window.ECGUI
   ════════════════════════════════════════════════════════════════════════ */

// ── evidence badge hook (System-Cohesion) — resolves a badge from a rendered
// label via EcgRegistry (ecgdex-registry.js). Zero-touch: any emit site that
// passes a known metric label gets a badge automatically. Safe no-op if the
// registry is unloaded. Global so app.js can call it directly.
function evBadge(label, fallback) {
  try {
    return (window.EcgRegistry && window.EcgRegistry.badgeForLabel(label, fallback !== false)) || '';
  } catch {
    return '';
  }
}
// ESM-MIGRATION: this module scopes evBadge away from the global — publish it so the classic profile
// and the ESM app's bare `evBadge(...)` calls still resolve (mirrors glucodex-render).
window.evBadge = evBadge;

(function (global) {
  'use strict';

  const C = { teal: '#3DE0D0', blue: '#58A6FF', green: '#39D98A', amber: '#FFB84D', red: '#FF6B7A', purple: '#a78bfa', grid: 'rgba(255,255,255,.07)', axis: 'rgba(255,255,255,.14)', dim: '#6F8096' };

  // ─── envelope pyramid ─────────────────────────────────────────────────────────
  function buildEnvelope(int16, factor) {
    const n = Math.ceil(int16.length / factor);
    const mins = new Int16Array(n),
      maxs = new Int16Array(n);
    for (let b = 0; b < n; b++) {
      let lo = 32767,
        hi = -32768;
      const s = b * factor,
        e = Math.min(s + factor, int16.length);
      for (let i = s; i < e; i++) {
        const v = int16[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      mins[b] = lo;
      maxs[b] = hi;
    }
    return { mins, maxs, factor };
  }

  /* ── ECGScope time-axis arithmetic, hoisted out of the canvas draw ──────────────────────────────
     DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS §RN's last open finding. Both of these lived INSIDE
     `ECGScope.draw()`, between a `getContext('2d')` and a `fillText`, so no assertion could reach them
     and a wrong divisor — `t/60 → t/30`, doubling every minute label — shipped green. They are pure
     functions of `secSpan`/`t`, so the fix is the EXTRACTION path §RN wave 2 already used three times
     (tanakaHRmax · hrvRmssdClass · oxySpo2NightCV) rather than a canvas shim for one LOW finding.
     Behaviour-identical: same expressions, same call sites, so this is compute-inert. */
  function scopeAxisTick(secSpan) {
    // Aim for ~8 gridlines. Past 120 s the axis switches to MINUTES, so the tick is rounded up to a
    // whole minute — otherwise the labels below would read the same integer twice in a row.
    if (secSpan > 120) return Math.ceil(secSpan / 8 / 60) * 60;
    return secSpan / 8 > 1 ? Math.ceil(secSpan / 8) : secSpan / 8 > 0.2 ? 0.5 : 0.2;
  }
  function scopeAxisLabel(t, secSpan) {
    // `t` is ALWAYS seconds; only the presentation changes. The /60 is the seconds→minutes conversion
    // that §RN planted a defect in — it is the whole reason this function exists.
    if (secSpan > 120) return (t / 60).toFixed(0) + 'm';
    return secSpan > 12 ? t.toFixed(0) + 's' : t.toFixed(1) + 's';
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ECGScope — interactive canvas
  // ════════════════════════════════════════════════════════════════════════
  class ECGScope {
    constructor(canvas, mini) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.mini = mini;
      this.mctx = mini ? mini.getContext('2d') : null;
      this.data = null;
      this.view = { start: 0, span: 0 }; // sample-domain viewport
      this._bindEvents();
    }

    setData(rec) {
      this.data = rec;
      this.fs = rec.fs;
      this.N = rec.int16.length;
      // pyramid factors
      const factors = [1, 8, 64, 512, 4096];
      this.pyr = {};
      for (const f of factors) {
        this.pyr[f] = f === 1 ? null : buildEnvelope(rec.int16, f);
      }
      this.factors = factors;
      // peak times (sec) and sqi for overlays
      this.peakSamp = rec.refIdx ? Array.from(rec.refIdx) : rec.peaks || [];
      this.times = rec.times || [];
      this.sqi = rec.sqi || [];
      this.types = rec.morph ? rec.morph.types : null; // N/V/S ectopy classes
      // whole-recording amplitude range — the MINI-MAP's scale only (the main view scales per
      // window; see `_viewScale`)
      let lo = 32767,
        hi = -32768,
        step = Math.max(1, Math.floor(this.N / 40000));
      for (let i = 0; i < this.N; i += step) {
        const v = rec.int16[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const pad = (hi - lo) * 0.08 || 100;
      this.yLo = lo - pad;
      this.yHi = hi + pad;
      // default view: first ~10 s (or whole if short)
      const tenS = Math.min(this.N, 10 * this.fs);
      this.view = { start: 0, span: tenS };
      this.resize();
      this.draw();
      this.drawMini();
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      for (const cv of [this.canvas, this.mini]) {
        if (!cv) continue;
        const r = cv.getBoundingClientRect();
        cv.width = Math.max(2, Math.round(r.width * dpr));
        cv.height = Math.max(2, Math.round(r.height * dpr));
      }
    }

    _pickLevel(samplesPerPx) {
      // choose factor so factor ≈ samplesPerPx (one envelope cell per pixel)
      let best = 1;
      for (const f of this.factors) {
        if (f <= samplesPerPx) best = f;
      }
      return best;
    }

    /* ── THE Y SCALE IS PER-WINDOW, NOT PER-RECORDING ──────────────────────────────────────────
       `setData` measures the whole recording's min/max, and this used to be the scale for every
       view. One end-of-recording artifact spike therefore set the scale for the entire session, so
       a normal QRS drew as a small bump while the R-peak dots still sat in the right places —
       detection was never wrong, only the drawing (owner report 2026-10-18).
       The scale now comes from the window the view actually draws, read from the SAME source the
       trace reads: raw int16 at factor 1, the envelope's `mins`/`maxs` above it. What the scale
       covers is then what the path paints, at every zoom level.
       Percentile-clipped at 0.5/99.5 so an artifact INSIDE the window cannot flatten the beats
       beside it, and `draw` clips to the plot box so a clipped excursion stops at the axis. A
       degenerate window (every sample equal) keeps the old ±100 pad rather than dividing by zero.
       The MINI-MAP deliberately keeps the whole-recording scale: its job is the overview that shows
       where the spike is.
       Cached by `start|span|factor`, so re-drawing one view is identical every time and panning
       cannot jitter the baseline. */
    _viewScale(start, span, f) {
      const key = start + '|' + span + '|' + f;
      if (this._vsKey === key) return this._vs;
      const CAP = 20000;
      const lows = [],
        highs = [];
      if (f === 1) {
        const i0 = Math.max(0, Math.floor(start)),
          i1 = Math.min(this.N - 1, Math.ceil(start + span));
        const step = Math.max(1, Math.floor((i1 - i0 + 1) / CAP));
        for (let i = i0; i <= i1; i += step) {
          const v = this.data.int16[i];
          lows.push(v);
          highs.push(v);
        }
      } else {
        const env = this.pyr[f];
        const b0 = Math.max(0, Math.floor(start / f)),
          b1 = Math.min(env.mins.length - 1, Math.ceil((start + span) / f));
        const step = Math.max(1, Math.floor((b1 - b0 + 1) / CAP));
        for (let b = b0; b <= b1; b += step) {
          lows.push(env.mins[b]);
          highs.push(env.maxs[b]);
        }
      }
      let out;
      if (!lows.length) {
        out = { lo: this.yLo, hi: this.yHi };
      } else {
        lows.sort((a, b) => a - b);
        highs.sort((a, b) => a - b);
        const q = (arr, pr) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(pr * (arr.length - 1))))];
        let lo = q(lows, 0.005),
          hi = q(highs, 0.995);
        if (!(hi > lo)) {
          lo = lows[0];
          hi = highs[highs.length - 1];
        }
        const pad = (hi - lo) * 0.08 || 100;
        out = { lo: lo - pad, hi: hi + pad };
      }
      this._vsKey = key;
      this._vs = out;
      return out;
    }

    draw() {
      if (!this.data) return;
      const ctx = this.ctx,
        W = this.canvas.width,
        H = this.canvas.height;
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, W, H);
      const padL = 4 * dpr,
        padR = 4 * dpr,
        padT = 6 * dpr,
        padB = 18 * dpr;
      const plotW = W - padL - padR,
        plotH = H - padT - padB;
      const { start, span } = this.view;
      const samplesPerPx = (span / plotW) * dpr;
      const f = this._pickLevel(samplesPerPx);
      const vs = this._viewScale(start, span, f);
      const sy = (v) => padT + ((vs.hi - v) / (vs.hi - vs.lo)) * plotH;

      // baseline grid (major every 0.2 s on the time axis at this zoom)
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      const secStart = start / this.fs,
        secSpan = span / this.fs;
      const tick = scopeAxisTick(secSpan);
      ctx.fillStyle = C.dim;
      ctx.font = 10 * dpr + 'px IBM Plex Mono, monospace';
      ctx.textAlign = 'center';
      for (let t = Math.ceil(secStart / tick) * tick; t < secStart + secSpan; t += tick) {
        const x = padL + ((t - secStart) / secSpan) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        ctx.fillText(scopeAxisLabel(t, secSpan), x, H - 5 * dpr);
      }

      // ── greyed SQI-excluded spans ──
      if (this.sqi.length && this.times.length) {
        ctx.fillStyle = 'rgba(255,107,122,.10)';
        let runS = null;
        for (let k = 0; k < this.sqi.length; k++) {
          const bad = this.sqi[k] < 0.3;
          const ts = this.times[k];
          if (bad && runS === null) runS = ts;
          if ((!bad || k === this.sqi.length - 1) && runS !== null) {
            const te = ts;
            const x0 = padL + ((runS - secStart) / secSpan) * plotW;
            const x1 = padL + ((te - secStart) / secSpan) * plotW;
            if (x1 > padL && x0 < padL + plotW) ctx.fillRect(Math.max(padL, x0), padT, Math.min(padL + plotW, x1) - Math.max(padL, x0), plotH);
            runS = null;
          }
        }
      }

      // ── waveform via envelope ──
      /* CLIPPED to the plot box. The window scale can leave a sample outside it — a percentile-clipped
         artifact, or an ectopy label at the top edge — and without the clip the path paints over the
         time axis instead of stopping at it. */
      ctx.save();
      ctx.beginPath();
      ctx.rect(padL, padT, plotW, plotH);
      ctx.clip();
      ctx.strokeStyle = C.teal;
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      if (f === 1) {
        // direct polyline
        const i0 = Math.max(0, Math.floor(start)),
          i1 = Math.min(this.N - 1, Math.ceil(start + span));
        let first = true;
        for (let i = i0; i <= i1; i++) {
          const x = padL + ((i - start) / span) * plotW;
          const y = sy(this.data.int16[i]);
          if (first) {
            ctx.moveTo(x, y);
            first = false;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        const env = this.pyr[f];
        const b0 = Math.max(0, Math.floor(start / f)),
          b1 = Math.min(env.mins.length - 1, Math.ceil((start + span) / f));
        for (let b = b0; b <= b1; b++) {
          const x = padL + ((b * f - start) / span) * plotW;
          ctx.moveTo(x, sy(env.maxs[b]));
          ctx.lineTo(x, sy(env.mins[b]));
        }
        ctx.stroke();
      }

      // ── R-peak markers (only when zoomed enough that they're distinguishable) ──
      if (span < 40 * this.fs && this.peakSamp.length) {
        for (let k = 0; k < this.peakSamp.length; k++) {
          const ps = this.peakSamp[k];
          if (ps < start || ps > start + span) continue;
          const x = padL + ((ps - start) / span) * plotW;
          const good = !this.sqi.length || this.sqi[k] >= 0.3;
          const typ = this.types ? this.types[k] : 'N';
          let col = good ? C.amber : C.red;
          if (typ === 'V')
            col = C.purple; // PVC
          else if (typ === 'S') col = C.blue; // PAC
          const yTop = sy(this.data.int16[Math.round(ps)] || 0) - 6 * dpr;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(x, yTop, (typ === 'N' ? 2.4 : 3.2) * dpr, 0, 2 * Math.PI);
          ctx.fill();
          if (typ !== 'N') {
            // label ectopic beats
            ctx.fillStyle = col;
            ctx.font = 9 * dpr + 'px IBM Plex Mono, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(typ === 'V' ? 'PVC' : 'PAC', x, yTop - 5 * dpr);
          }
        }
      }
      ctx.restore();
    }

    drawMini() {
      if (!this.mctx) return;
      const ctx = this.mctx,
        W = this.mini.width,
        H = this.mini.height;
      ctx.clearRect(0, 0, W, H);
      const env = this.pyr[4096] || this.pyr[512];
      if (!env) return;
      const sy = (v) => 2 + ((this.yHi - v) / (this.yHi - this.yLo)) * (H - 4);
      ctx.strokeStyle = 'rgba(61,224,208,.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const nB = env.mins.length;
      for (let px = 0; px < W; px++) {
        const b = Math.floor((px / W) * nB);
        ctx.moveTo(px, sy(env.maxs[b]));
        ctx.lineTo(px, sy(env.mins[b]));
      }
      ctx.stroke();
      // viewport rect
      const x0 = (this.view.start / this.N) * W,
        x1 = ((this.view.start + this.view.span) / this.N) * W;
      ctx.fillStyle = 'rgba(88,166,255,.18)';
      ctx.fillRect(x0, 0, Math.max(2, x1 - x0), H);
      ctx.strokeStyle = C.blue;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0, 0.5, Math.max(2, x1 - x0), H - 1);
    }

    zoom(factor, centerFrac) {
      const c = this.view.start + this.view.span * (centerFrac == null ? 0.5 : centerFrac);
      let span = this.view.span * factor;
      span = Math.max(this.fs * 0.5, Math.min(this.N, span));
      let start = c - span * (centerFrac == null ? 0.5 : centerFrac);
      start = Math.max(0, Math.min(this.N - span, start));
      this.view = { start, span };
      this.draw();
      this.drawMini();
      this._emit();
    }
    pan(dSamples) {
      let start = this.view.start + dSamples;
      start = Math.max(0, Math.min(this.N - this.view.span, start));
      this.view.start = start;
      this.draw();
      this.drawMini();
      this._emit();
    }
    fitAll() {
      this.view = { start: 0, span: this.N };
      this.draw();
      this.drawMini();
      this._emit();
    }
    goToSec(sec) {
      let start = sec * this.fs - this.view.span / 2;
      start = Math.max(0, Math.min(this.N - this.view.span, start));
      this.view.start = start;
      this.draw();
      this.drawMini();
      this._emit();
    }
    setSpanSec(sec) {
      const c = this.view.start + this.view.span / 2;
      let span = Math.max(this.fs * 0.5, Math.min(this.N, sec * this.fs));
      let start = Math.max(0, Math.min(this.N - span, c - span / 2));
      this.view = { start, span };
      this.draw();
      this.drawMini();
      this._emit();
    }
    _emit() {
      if (this.onView) this.onView(this.view, this.fs, this.N);
    }

    _bindEvents() {
      const cv = this.canvas;
      cv.addEventListener(
        'wheel',
        (e) => {
          if (!this.data) return;
          e.preventDefault();
          const r = cv.getBoundingClientRect();
          const frac = (e.clientX - r.left) / r.width;
          this.zoom(e.deltaY > 0 ? 1.25 : 0.8, frac);
        },
        { passive: false }
      );
      let drag = null;
      cv.addEventListener('pointerdown', (e) => {
        drag = { x: e.clientX, start: this.view.start };
        cv.setPointerCapture(e.pointerId);
        cv.style.cursor = 'grabbing';
      });
      cv.addEventListener('pointermove', (e) => {
        if (!drag || !this.data) return;
        const r = cv.getBoundingClientRect();
        const dPx = e.clientX - drag.x;
        const dSamp = (-dPx / r.width) * this.view.span;
        let start = Math.max(0, Math.min(this.N - this.view.span, drag.start + dSamp));
        this.view.start = start;
        this.draw();
        this.drawMini();
        this._emit();
      });
      const end = (e) => {
        drag = null;
        cv.style.cursor = 'grab';
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      // click on minimap to jump
      if (this.mini) {
        const jump = (e) => {
          const r = this.mini.getBoundingClientRect();
          const frac = (e.clientX - r.left) / r.width;
          let start = Math.max(0, Math.min(this.N - this.view.span, frac * this.N - this.view.span / 2));
          this.view.start = start;
          this.draw();
          this.drawMini();
          this._emit();
        };
        let md = false;
        this.mini.addEventListener('pointerdown', (e) => {
          md = true;
          jump(e);
        });
        this.mini.addEventListener('pointermove', (e) => {
          if (md) jump(e);
        });
        window.addEventListener('pointerup', () => (md = false));
      }
      window.addEventListener('resize', () => {
        if (this.data) {
          this.resize();
          this.draw();
          this.drawMini();
        }
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  SVG CHARTS  (template strings — PulseDex pattern)
  // ════════════════════════════════════════════════════════════════════════
  function lineChart(pts, color, opts) {
    opts = opts || {};
    const W = opts.W || 680,
      H = opts.H || 150,
      P = { l: opts.yfmt ? 62 : 46, r: 14, t: 14, b: 24 },
      n = pts.length;
    if (!n) return '';
    let ymn = opts.ymn != null ? opts.ymn : Infinity,
      ymx = opts.ymx != null ? opts.ymx : -Infinity,
      xmn = Infinity,
      xmx = -Infinity;
    /* §∅ — A NULL IS A GAP, NOT A ZERO. Absent samples now reach this helper (the CVHR series marks
       the seconds inside a beat dropout), and every arm below had to learn it at once: `null < ymn`
       coerces to `0 < ymn` and would drag the domain to zero, and `sy(null)` renders the literal
       `LNaN NaN` into the path, which silently voids the whole SVG. Non-finite points are excluded
       from the domain and BREAK the path, so a dropout draws as a gap rather than as a straight line
       ruled across it — a line between two real samples an hour apart is a claim about the hour. */
    let anyY = false;
    for (const p of pts) {
      if (Number.isFinite(p.y)) {
        anyY = true;
        if (opts.ymn == null && p.y < ymn) ymn = p.y;
        if (opts.ymx == null && p.y > ymx) ymx = p.y;
      }
      if (p.x < xmn) xmn = p.x;
      if (p.x > xmx) xmx = p.x;
    }
    if (!anyY) return '';
    if (ymx === ymn) ymx = ymn + 1;
    if (xmx === xmn) xmx = xmn + 1;
    const sx = (x) => P.l + ((x - xmn) / (xmx - xmn)) * (W - P.l - P.r);
    const sy = (y) => H - P.b - ((y - ymn) / (ymx - ymn)) * (H - P.t - P.b);
    /* One subpath per CONTIGUOUS run of finite samples — the line lifts across a gap and the area
       fill closes at the gap's edges instead of spanning it. */
    const runs = [];
    let cur = [];
    for (const p of pts) {
      if (Number.isFinite(p.y)) cur.push(p);
      else if (cur.length) {
        runs.push(cur);
        cur = [];
      }
    }
    if (cur.length) runs.push(cur);
    const line = runs.map((r) => r.map((p, k) => (k ? 'L' : 'M') + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1)).join(' ')).join(' ');
    const area = runs
      .map((r) => `M${sx(r[0].x).toFixed(1)} ${H - P.b} ` + r.map((p) => 'L' + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1)).join(' ') + ` L${sx(r[r.length - 1].x).toFixed(1)} ${H - P.b} Z`)
      .join(' ');
    const xt = [];
    const xstep = (xmx - xmn) / 5;
    for (let i = 0; i <= 5; i++) xt.push(xmn + i * xstep);
    const med = opts.med;
    const marks = (opts.marks || []).map((m) => `<line x1="${sx(m).toFixed(1)}" y1="${P.t}" x2="${sx(m).toFixed(1)}" y2="${H - P.b}" stroke="${C.red}" stroke-width="1" opacity=".5"/>`).join('');
    const gid = 'g' + Math.random().toString(36).slice(2, 7);
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" style="width:100%;height:auto">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <line x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}" stroke="${C.axis}"/>
    <line x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${H - P.b}" stroke="${C.axis}"/>
    ${med != null ? `<line x1="${P.l}" y1="${sy(med).toFixed(1)}" x2="${W - P.r}" y2="${sy(med).toFixed(1)}" stroke="${color}" stroke-dasharray="4 4" opacity=".5"/>` : ''}
    <text x="${P.l - 6}" y="${(sy(ymx) + 4).toFixed(1)}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">${opts.yfmt ? opts.yfmt(ymx) : ymx.toFixed(0)}</text>
    <text x="${P.l - 6}" y="${(sy(ymn) + 4).toFixed(1)}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">${opts.yfmt ? opts.yfmt(ymn) : ymn.toFixed(0)}</text>
    ${xt.map((x) => `<text x="${sx(x).toFixed(1)}" y="${H - 7}" fill="${C.dim}" font-size="9" text-anchor="middle" font-family="IBM Plex Mono,monospace">${opts.xfmt ? opts.xfmt(x) : x.toFixed(0)}</text>`).join('')}
    ${marks}
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
  }

  // Poincaré scatter with SD1/SD2 ellipse
  function poincare(nn, sd1v, sd2v) {
    const W = 320,
      H = 300,
      P = 34;
    const n = nn.length;
    if (n < 3) return '';
    const xs = [],
      ys = [];
    for (let i = 1; i < n; i++) {
      xs.push(nn[i - 1]);
      ys.push(nn[i]);
    }
    let mn = Math.min(arrMinL(xs), arrMinL(ys)),
      mx = Math.max(arrMaxL(xs), arrMaxL(ys));
    const pad = (mx - mn) * 0.06 || 30;
    mn -= pad;
    mx += pad;
    const sc = (v) => P + ((v - mn) / (mx - mn)) * (W - 2 * P);
    const scY = (v) => H - P - ((v - mn) / (mx - mn)) * (H - 2 * P);
    const m = meanL(nn);
    // sample for performance
    const stepP = Math.max(1, Math.floor(xs.length / 2600));
    let dots = '';
    for (let i = 0; i < xs.length; i += stepP) {
      dots += `<circle cx="${sc(xs[i]).toFixed(1)}" cy="${scY(ys[i]).toFixed(1)}" r="1.1" fill="${C.teal}" opacity=".5"/>`;
    }
    // identity line + ellipse (rotated 45°)
    const cx = sc(m),
      cy = scY(m);
    /* ∅ — AN ABSENT AXIS DRAWS NO ELLIPSE. `null / (mx - mn)` is 0 in JS, so a refused SD1/SD2
       pair rendered rx=0 ry=0: a zero-area ellipse at the cloud's centre, which a reader takes for a
       measured collapse of variability rather than for "nobody measured it". The cloud is real data
       and stays drawn; the ellipse is the part that was not measured, so it is omitted and the stats
       line beside the chart names the absence. */
    const haveAxes = sd1v != null && sd2v != null && isFinite(sd1v) && isFinite(sd2v);
    const ex = (sd2v / (mx - mn)) * (W - 2 * P),
      ey = (sd1v / (mx - mn)) * (H - 2 * P);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" style="width:100%;height:auto;max-width:340px;margin:0 auto;display:block">
    <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${P}" stroke="${C.axis}" stroke-dasharray="3 3"/>
    <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="${C.axis}"/>
    <line x1="${P}" y1="${P}" x2="${P}" y2="${H - P}" stroke="${C.axis}"/>
    ${dots}
    ${haveAxes ? `<g transform="rotate(-45 ${cx} ${cy})"><ellipse cx="${cx}" cy="${cy}" rx="${Math.abs(ex).toFixed(1)}" ry="${Math.abs(ey).toFixed(1)}" fill="rgba(88,166,255,.10)" stroke="${C.blue}" stroke-width="1.4"/></g>` : ''}
    <text x="${W / 2}" y="${H - 8}" fill="${C.dim}" font-size="10" text-anchor="middle" font-family="IBM Plex Mono,monospace">RRₙ (ms)</text>
    <text x="12" y="${H / 2}" fill="${C.dim}" font-size="10" text-anchor="middle" font-family="IBM Plex Mono,monospace" transform="rotate(-90 12 ${H / 2})">RRₙ₊₁ (ms)</text>
  </svg>`;
  }

  // hypnogram — stepped sleep stages
  function hypnogram(stages) {
    const W = 680,
      H = 160,
      P = { l: 54, r: 14, t: 14, b: 24 };
    const n = stages.length;
    if (!n) return '';
    const lvls = ['Deep', 'Light', 'REM', 'Wake'];
    const yOf = { Deep: 0, Light: 1, REM: 2, Wake: 3 };
    const colOf = { Deep: C.blue, Light: C.teal, REM: C.purple, Wake: C.amber };
    const xmx = stages[n - 1].tMin + 5,
      xmn = 0;
    const sx = (x) => P.l + ((x - xmn) / (xmx - xmn)) * (W - P.l - P.r);
    const sy = (l) => H - P.b - (l / 3) * (H - P.t - P.b);
    let path = '',
      segs = '';
    // AN UNSTAGED EPOCH DRAWS NOTHING. `yOf[null]` is undefined, so this drew y="NaN" with
    // fill="undefined" — a rect the browser discards, which is the right picture reached the wrong
    // way and leaves the connecting path jumping across the gap as though a stage were there. The
    // band is left empty and the path BREAKS, and the unstaged minutes are stated on the card.
    let penDown = false;
    for (let i = 0; i < n; i++) {
      if (stages[i].stage == null) {
        penDown = false;
        continue;
      }
      const x0 = sx(stages[i].tMin),
        x1 = sx(i < n - 1 ? stages[i + 1].tMin : xmx),
        y = sy(yOf[stages[i].stage]);
      segs += `<rect x="${x0.toFixed(1)}" y="${(y - 3).toFixed(1)}" width="${Math.max(0.6, x1 - x0).toFixed(1)}" height="6" fill="${colOf[stages[i].stage]}" opacity=".85"/>`;
      path += (penDown ? 'L' : 'M') + x0.toFixed(1) + ' ' + y.toFixed(1) + ' L' + x1.toFixed(1) + ' ' + y.toFixed(1) + ' ';
      penDown = true;
    }
    return `<svg viewBox="0 0 ${W} ${H}" role="img" style="width:100%;height:auto">
    ${lvls.map((l, i) => `<text x="${P.l - 8}" y="${(sy(i) + 3).toFixed(1)}" fill="${C.dim}" font-size="9.5" text-anchor="end" font-family="IBM Plex Mono,monospace">${l}</text><line x1="${P.l}" y1="${sy(i).toFixed(1)}" x2="${W - P.r}" y2="${sy(i).toFixed(1)}" stroke="${C.grid}"/>`).join('')}
    <path d="${path}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1"/>
    ${segs}
    ${[0, 0.25, 0.5, 0.75, 1]
      .map((f) => {
        const x = xmn + f * (xmx - xmn);
        return `<text x="${sx(x).toFixed(1)}" y="${H - 7}" fill="${C.dim}" font-size="9" text-anchor="middle" font-family="IBM Plex Mono,monospace">${(x / 60).toFixed(1)}h</text>`;
      })
      .join('')}
  </svg>`;
  }

  // small array helpers (avoid spread on huge arrays)
  function arrMinL(a) {
    let m = Infinity;
    for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i];
    return m;
  }
  function arrMaxL(a) {
    let m = -Infinity;
    for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
    return m;
  }
  function meanL(a) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }

  // median-beat with delineation markers (P-QRS-T intervals)
  function medianBeatChart(mb, del) {
    const W = 680,
      H = 260,
      P = { l: 48, r: 16, t: 18, b: 30 };
    const beat = mb.beat,
      L = beat.length;
    let ymn = Infinity,
      ymx = -Infinity;
    for (const v of beat) {
      if (v < ymn) ymn = v;
      if (v > ymx) ymx = v;
    }
    const pad = (ymx - ymn) * 0.1 || 50;
    ymn -= pad;
    ymx += pad;
    const sx = (i) => P.l + (i / (L - 1)) * (W - P.l - P.r);
    const sy = (v) => H - P.b - ((v - ymn) / (ymx - ymn)) * (H - P.t - P.b);
    const path = beat.map((v, i) => (i ? 'L' : 'M') + sx(i).toFixed(1) + ' ' + sy(v).toFixed(1)).join(' ');
    const m = del.marks,
      B = m.B;
    const vline = (i, col, lbl, dash) =>
      `<line x1="${sx(i).toFixed(1)}" y1="${P.t}" x2="${sx(i).toFixed(1)}" y2="${H - P.b}" stroke="${col}" stroke-width="1" ${dash ? 'stroke-dasharray="3 3"' : ''} opacity=".6"/><text x="${sx(i).toFixed(1)}" y="${P.t - 5}" fill="${col}" font-size="9" text-anchor="middle" font-family="IBM Plex Mono,monospace">${lbl}</text>`;
    const dot = (i, col) => `<circle cx="${sx(i).toFixed(1)}" cy="${sy(beat[Math.round(i)] || B).toFixed(1)}" r="2.6" fill="${col}"/>`;
    // interval span bars under the trace
    const span = (i0, i1, col, lbl, yoff) => {
      const y = H - P.b + yoff;
      return `<line x1="${sx(i0).toFixed(1)}" y1="${y}" x2="${sx(i1).toFixed(1)}" y2="${y}" stroke="${col}" stroke-width="2"/><line x1="${sx(i0).toFixed(1)}" y1="${y - 3}" x2="${sx(i0).toFixed(1)}" y2="${y + 3}" stroke="${col}"/><line x1="${sx(i1).toFixed(1)}" y1="${y - 3}" x2="${sx(i1).toFixed(1)}" y2="${y + 3}" stroke="${col}"/><text x="${((sx(i0) + sx(i1)) / 2).toFixed(1)}" y="${y - 4}" fill="${col}" font-size="8.5" text-anchor="middle" font-family="IBM Plex Mono,monospace">${lbl}</text>`;
    };
    return `<svg viewBox="0 0 ${W} ${H}" role="img" style="width:100%;height:auto">
    <line x1="${P.l}" y1="${sy(B).toFixed(1)}" x2="${W - P.r}" y2="${sy(B).toFixed(1)}" stroke="${C.axis}" stroke-dasharray="2 4"/>
    <text x="${P.l - 6}" y="${(sy(B) + 3).toFixed(1)}" fill="${C.dim}" font-size="8.5" text-anchor="end" font-family="IBM Plex Mono,monospace">0µV</text>
    ${m.pPresent !== false ? vline(m.Pon, C.purple, 'P', true) + dot(m.Ppk, C.purple) : ''}
    ${vline(m.Qon, C.blue, 'Q')}
    ${vline(m.Joff, C.blue, 'J')}
    ${vline(m.Tend, C.amber, 'Tend', true)}
    ${dot(m.R, C.teal)}${dot(m.Tpk, C.amber)}
    <path d="${path}" fill="none" stroke="${C.teal}" stroke-width="1.8" stroke-linejoin="round"/>
    ${del.pr != null ? span(m.Pon, m.Qon, C.purple, 'PR ' + del.pr + 'ms', 14) : ''}
    ${span(m.Qon, m.Joff, C.blue, 'QRS ' + del.qrsDur + 'ms', 26)}
    ${span(m.Qon, m.Tend, C.amber, 'QT ' + del.qt + 'ms', 38)}
  </svg>`;
  }

  // §RN render-harness: the two ECGScope axis helpers are exposed so the node lane can pin the
  // surfaced tick spacing and label text without a canvas shim (see the note above their definitions).
  /* ════════════════════════════════════════════════════════════════════════════════════════════
     SIGNAL QUALITY TABLE AND DRIFT PANELS — SIGNAL-QUALITY-TABLE-2026-11-14 §6 (boxes 6, 7, 8)
     ────────────────────────────────────────────────────────────────────────────────────────────
     The table draws the `signalQuality` object the node export carries, so the page and the
     exported bytes are ONE measurement read twice. The app reads it through
     `ECGDSP.buildNodeExport`, which is the published surface — `ecgSignalQuality` is not on
     `ECGDSP`, and EXPORT-PATH-UNREACHABLE-2026-08-01 is the brief about reaching for a function
     that the DSP only holds in lexical scope.

     §∅ — A NULL CELL PRINTS ITS REASON, never a bare dash. A dash alone reads as a rounding or a
     zero; the reason is the part a reader needs, and `_sqCell` already carries one on every null.
     A cell whose reason is absent prints that fact rather than an empty space.
     ════════════════════════════════════════════════════════════════════════════════════════════ */

  // One row per fact of §3, in the order the brief states them. `label` is also the badge key:
  // `evBadge` resolves it through the registry's own declared labels, so a typo here would
  // fabricate an `experimental` disc — the test asserts each one resolves to a `measured` entry.
  /* One row per quality fact: `k` is the key the export publishes, `id` is the metric this row
     DRAWS and `label` is what the reader sees. The badge resolves through `id`, never through
     `label`: `badgeForLabel` FABRICATES an `experimental` disc for anything it cannot resolve and
     that branch prints no warning, so a prose label is a silent under-grade waiting to happen,
     while an id is the registry's own key. It also states, in this file, which metric each series
     is — the binding the undeclared-metric gate reads. */
  /* ORDER: the score first, then what the score speaks for, then the clock, then the inputs the
     score is built from. The old order opened the table with its two TALLEST rows — coverage and
     flatline share are the only two carrying a before-and-after pair — so a reader met two blocks
     of prose before the first quality number. `kind: 'count'` marks the two rows that count things
     rather than measure a rate (§📏 is about units; this is about the decimals a count may claim).
     A row no channel measured sinks below the rule at render time, so a device that DOES report
     in-band SNR lifts that row back up without an edit here. */
  var SQ_ROWS = [
    { k: 'nodeSqi', id: 'meanSQI', label: 'Mean SQI' },
    { k: 'coverage', id: 'coverage', label: 'Coverage' },
    { k: 'epochs', id: 'sqEpochs', label: 'Epoch population', kind: 'count' },
    { k: 'timing', id: 'sqTiming', label: 'Axis rate' },
    { k: 'drift', id: 'sqDrift', label: 'Night drift' },
    { k: 'reference', id: 'sqReference', label: 'Reference Δ' },
    { k: 'flatline', id: 'sqFlatline', label: 'Flatline share' },
    { k: 'rail', id: 'sqRail', label: 'Rail census', kind: 'count' },
    { k: 'snr', id: 'sqSnr', label: 'In-band SNR' },
    { k: 'mains', id: 'sqMains', label: 'Mains ratio' }
  ];

  /* The three §3d series, each naming the metric it draws for the same reason. */
  var SQ_DRIFT_SERIES = { divergence: 'sqDivergence', rate: 'sqWindowRate', allan: 'sqAllan' };
  var SQ_LEDGER_ID = 'sqSidecarState';

  function _sqBadge(label) {
    /* The MODULE-LOCAL `evBadge` of this file, never `global.evBadge`. The two are the same function
       in a browser, because line 27 publishes it — but a realm that loads this module without that
       publication reaching it would draw a table with no disc in it, and the badge rule calls an
       unbadged number a bug of wrong-unit severity. The lexical name cannot be absent. */
    return evBadge(label);
  }

  /* A number for a reader. `null` stays null here — the CALLER decides what an absence prints,
     because only the caller holds the reason that must travel with it. */
  /* A COUNT IS NOT A RATE, AND TWO DECIMALS ON ONE IS A CLAIM THE NODE NEVER MADE. The rail census
     counts samples and the epoch population counts windows, so `161` and `94` printed as `161.00`
     and `94.00` read as measured hundredths of a sample. `kind: 'count'` prints the integer. A
     non-integer reaching a count row is a producer defect, so it falls through to the general
     formatter and SHOWS its fraction rather than being rounded into a tidy lie. */
  function _sqNum(v, kind) {
    if (v == null || typeof v !== 'number' || !isFinite(v)) return null;
    if (kind === 'count' && v === Math.round(v)) return String(v);
    var a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1000) return v.toFixed(0);
    if (a >= 1) return v.toFixed(2);
    return v.toPrecision(3);
  }

  var _SQ_NO_REASON = 'no reason travelled with this absence, which is itself a defect';

  /* The reason is the LAST thing in a cell and the quietest: a hairline rule on the left marks it as
     subordinate to the number above it, and a measure cap keeps the line length readable when the
     column is wide. Spacing is the point of the rule, not decoration — the old 3 px gap between the
     value, the unit and two prose blocks of the same size and colour made one grey slab of all four. */
  var _SQ_PROSE = 'font-size:10.5px;line-height:1.55;color:var(--text3);max-width:46ch;margin-top:8px;padding-left:9px;border-left:1px solid var(--border)';

  function _sqWhy(reason) {
    return '<div class="sq-why" style="' + _SQ_PROSE + '">' + (reason || _SQ_NO_REASON) + '</div>';
  }

  /* The before-and-after pair of §6: a fact a sidecar changes shows both sides, and an absent side
     shows its own reason. Box 7's vendor case is exactly this — every AFTER side null. */
  function _sqBeforeAfter(cell, book, site) {
    var hasB = Object.prototype.hasOwnProperty.call(cell, 'before'),
      hasA = Object.prototype.hasOwnProperty.call(cell, 'after');
    if (!hasB && !hasA) return '';
    var b = _sqNum(cell.before),
      a = _sqNum(cell.after);
    /* ONE LINE PER SIDE. The single run `before — (long reason) → after — (long reason)` put two
       nested parentheticals between the reader and the arrow, and the arrow is the only part that
       carries meaning. A labelled row per side reads as a pair and keeps each reason beside its own
       side. The `sq-ba-k` / `sq-ba-v` markers are what a leg reads, so an absent side stays
       machine-visible. */
    return (
      '<div class="sq-ba" style="font-size:10.5px;line-height:1.5;color:var(--text3);margin-top:7px">' +
      _sqBaRow('before', b, cell.beforeReason, book, site) +
      _sqBaRow('after', a, cell.afterReason, book, site) +
      '</div>'
    );
  }

  /* `data-ba` and `data-abs` ARE THE MACHINE-READABLE HALF of this pair. The pair used to be one
     run of prose (`123 → after —`), so the only way to count it was a substring search that also
     matched the reasons around it. A test that counts prose measures the prose. The two attributes
     say which side a row is and whether that side holds a number, so a leg reads the structure. */
  function _sqBaRow(key, num, reason, book, site) {
    return (
      '<div class="sq-ba-row" data-ba="' +
      key +
      '" data-abs="' +
      (num == null ? '1' : '0') +
      '" style="display:flex;gap:7px;align-items:baseline;margin-top:2px">' +
      '<span class="sq-ba-k" style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--text4,var(--text3));min-width:38px;flex:0 0 auto">' +
      key +
      '</span>' +
      '<span class="sq-ba-v" style="font-family:IBM Plex Mono,monospace;color:var(--text2);flex:0 0 auto">' +
      (num == null ? '—' : num) +
      '</span>' +
      (num == null ? '<span class="sq-ba-r" style="max-width:40ch">' + (book ? book('the ' + key + ' side of ' + site, null, reason) : reason || _SQ_NO_REASON) + '</span>' : '') +
      '</div>'
    );
  }

  /* A RATE NEVER TRAVELS ALONE. Clock Contract §7: `ppm` is a diagnostic, and quoting one without
     its anchor count and its span states a precision the measurement does not hold. Both cells that
     publish a ppm here — the host-axis rate and the night drift — already carried `anchors`, `spanMs`
     and, for the drift, `ppmUncertainty` in their own data; the TABLE dropped all three and printed
     the bare figure (measured 2026-11-15: `-6.67` under `ppm of the device rate against the host
     axis`, with nothing beside it). This reads whatever the cell published and stays silent when the
     cell published none of it, so it adds no fact of its own. */
  function _sqSpanTxt(ms) {
    if (!isFinite(ms) || ms <= 0) return null;
    if (ms >= 3600000) return (ms / 3600000).toFixed(ms >= 36000000 ? 0 : 1) + ' h';
    if (ms >= 60000) return Math.round(ms / 60000) + ' min';
    return Math.round(ms / 1000) + ' s';
  }

  function _sqQualifier(cell) {
    var bits = [];
    if (typeof cell.anchors === 'number' && isFinite(cell.anchors)) bits.push('from ' + cell.anchors + (cell.anchors === 1 ? ' anchor' : ' anchors'));
    var span = typeof cell.spanMs === 'number' ? _sqSpanTxt(cell.spanMs) : null;
    if (span) bits.push('over ' + span);
    if (typeof cell.ppmUncertainty === 'number' && isFinite(cell.ppmUncertainty)) bits.push('\u00b1 ' + _sqNum(cell.ppmUncertainty, 'ppm') + ' ppm at this span');
    /* NAME WHAT LIMITS THE NUMBER, because a short span reads high for a reason the estimator does
       not own. This block used to say the figure is an end-point read against the FIRST anchor's own
       raw residual, and that `r0` origin gives the rate an additive bias of about jitter / span. The
       repair it asked for has landed in `clock.js`, and measuring it corrected the reason. Two
       separate terms sat behind the one sentence, and which one dominates depends on ANCHOR DENSITY:

         · `r0`'s jitter — VARIANCE, not bias. One raw sample sets the origin, so its full jitter
           reaches the rate. It is zero-mean, so it cannot lean, and re-drawing the noise is what
           shows that. Cancelling `r0` removes it.
         · the running median's END CLAMP — a deterministic LOW bias of 5/(n−1) relative, because the
           old numerator stopped 5 anchors short of the end while the denominator ran the full span.
           Dividing by the distance between the two end windows' centres removes it exactly.

       `clock.js` now does both, and publishes `ppmEstimator` to name the arm. Measured 2026-11-16
       with zero jitter, so only the clamp term is left, against a PLANTED 50 ppm:

         n            16      22      31      41     101     451
         before   33.333  38.095  41.667  43.750  47.500  49.444   ← exactly 50·(n−1−5)/(n−1)
         after    33.333  50.000  50.000  50.000  50.000  50.000

       ⚠ THE TABLE THAT USED TO SIT HERE PLANTED 50 ppm AT 5 ms OF JITTER, and that is why it read a
       bias of the wrong sign. Over 60 s a 50 ppm drift is 3 ms against ±5 ms of jitter, so the figure
       there is noise and a single draw of it says nothing about a lean. Those rows reported one draw
       each, and the repair's own first measurement repeated the mistake.

       WHAT STILL LIMITS A SHORT SPAN, measured the same day over 400 draws at the node's own
       391-anchor geometry: the published rate reads 56.80 ± 1.25 before the repair and 53.60 ± 1.56
       after it, against the same planted 50. The clamp term is only 1.28 % of the span at that
       density, so almost all of what is left is host jitter swamping a 3 ms drift. A node cannot fix
       that by estimating better. It needs a longer span, and the §∅ question of whether `ok` should be
       true at all over an unresolvable rate is logged and not answered here.

       So this clause names the LIMIT rather than the estimator's origin. It rides the two cells whose
       unit names the host axis, which are the two the measurement covers. The §3d night-drift cell
       runs a different estimator and says nothing here. */
    if (cell.unit === 'ppm of the device rate against the host axis' && bits.length) bits.push('a median read, so a span this short is limited by host jitter rather than by drift');
    if (!bits.length) return '';
    return '<div class="sq-qual" style="font-size:10px;color:var(--text3);margin-top:2px">' + bits.join(' \u00b7 ') + '</div>';
  }

  /* THE READING ORDER IS THE INFORMATION ORDER: value, then what it is measured in, then the pair a
     sidecar moves, then — last and quietest — the reason. The reason used to sit BETWEEN the number
     and its own before-and-after pair, which split one fact across a paragraph. */
  function _sqValueCell(cell, badgeId, kind, hoisted, book, site) {
    var pad = 'padding:11px 14px 13px;border-top:1px solid var(--border);vertical-align:top';
    if (!cell) return '<td class="sq-v" style="' + pad + '">' + _sqBadge(badgeId) + '<b>—</b>' + _sqWhy('this channel publishes no cell for this fact, so the table has nothing to read') + '</td>';
    var n = _sqNum(cell.value, kind);
    return (
      '<td class="sq-v" style="' +
      pad +
      '">' +
      '<div class="sq-val-line" style="display:flex;gap:6px;align-items:baseline">' +
      _sqBadge(badgeId) +
      (n == null ? '<b>—</b>' : '<b style="font-family:IBM Plex Mono,monospace;font-size:13.5px;color:var(--text)">' + n + '</b>') +
      '</div>' +
      (cell.unit ? '<div class="sq-u" style="font-size:10px;color:var(--text3);margin-top:3px">' + cell.unit + '</div>' : '') +
      (n == null ? '' : _sqQualifier(cell)) +
      _sqBeforeAfter(cell, book, site) +
      (n == null && (hoisted || []).indexOf(cell.reason || _SQ_NO_REASON) < 0 ? _sqWhy(cell.reason) : '') +
      '</td>'
    );
  }

  var _SQ_STATE_COLOR = { read: 'var(--green)', 'not-applicable': 'var(--text3)', 'not-read': 'var(--amber)' };

  /* sqTable(sq) → HTML for the per-channel table and the sidecar ledger.
     Returns a named absence rather than '' when the object is not there: an empty card is a
     question a reader cannot answer. */
  function sqTable(sq, why) {
    if (!sq || !sq.channels)
      return (
        '<div class="mini-h">Signal quality table</div>' +
        '<div class="q-note">No cell of this table can be drawn, and here is why: <b>' +
        (why || _SQ_NO_REASON) +
        '</b>. The table reads the <code>signalQuality</code> object of the node export and computes nothing of its own, ' +
        'so a reason stands here rather than an empty card (EXPORT-PATH-UNREACHABLE-2026-08-01: an export path no one watches rots unseen).</div>'
      );
    var chans = [];
    for (var ck in sq.channels) if (Object.prototype.hasOwnProperty.call(sq.channels, ck)) chans.push(ck);
    /* THE REASON THAT GOVERNS A COLUMN BELONGS AT THE TOP OF IT. A channel this node does not ingest
       publishes one sentence on most facts of the table: measured 2026-11-15 on the committed
       synthetic, 8 of the 11 absent cells of the motion column read "this node ingests no motion
       channel on this recording", beside 8 dashes. A reader has to read the whole column to learn
       that it holds one finding. §∅ asks that an absence carry its named reason, and every absence
       still does: the governing reason is stated ONCE, at the head of the column, with the count it
       covers, and only the cells carrying THAT reason go bare. The other cells of the column keep
       their own text, so a differing absence is never folded into a reason that is not its own.
       The MAJORITY test, not an equality test, is what makes this work on a real column: an
       equality test hoisted nothing here, because two cells of the eleven said something else. */
    /* THE BEFORE-AND-AFTER REASONS REPEAT TOO, and for the same cause: one finding about the sidecar
       answers several facts, so two cells of the motion column carried the identical two-sentence
       pair (measured 2026-11-15, 8 lines of the card). The book prints the pair at the first cell
       that owes it and names that cell afterwards. The pair stays machine-readable either way: a
       leg reads `data-ba` and `data-abs`, never this prose. */
    var baBook = _sqReasonBook();
    var colWhy = {},
      hoisted = {};
    chans.forEach(function (ck) {
      var seen = Object.create(null),
        absentCells = 0,
        top = null,
        topN = 0;
      SQ_ROWS.forEach(function (row) {
        var c = sq.channels[ck] ? sq.channels[ck][row.k] : null;
        if (!c || _sqNum(c.value, row.kind) != null) return;
        absentCells++;
        var b = c.reason || _SQ_NO_REASON,
          n = (seen[b] = (seen[b] || 0) + 1);
        if (n > topN) {
          topN = n;
          top = b;
        }
      });
      colWhy[ck] = topN >= 3 && topN * 2 >= absentCells ? { body: top, n: topN, of: absentCells } : null;
      /* A CELL SAYS NOTHING THE COLUMN HEAD ALREADY SAID. The head carries the majority hoist and
         the channel-level notes, so each of those bodies is struck from every cell below it. The
         ACC column printed `inputNote` in full twice: once at the head and once inside the
         coverage cell, because the first version of this suppression held ONE body. */
      var ch0 = sq.channels[ck] || {};
      hoisted[ck] = [colWhy[ck] ? colWhy[ck].body : null, ch0.scopeNote || null, ch0.inputNote || null].filter(function (x) {
        return x;
      });
    });
    var TH = 'text-align:left;vertical-align:top;padding:7px 14px 8px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--text3)';
    var head =
      '<tr><th style="' +
      TH +
      '">Fact</th>' +
      chans
        .map(function (ck) {
          return '<th style="' + TH + '">' + ((sq.channels[ck] || {}).stream || ck) + '</th>';
        })
        .join('') +
      '</tr>';
    /* THE CHANNEL NOTES RIDE THEIR OWN ROW, NOT THE HEADER. Each note is a paragraph, and a
       paragraph inside a `<th>` drove the header to about 200 px tall while the Fact cell and every
       channel without a note stayed one word tall. That reads as a hole in the table rather than as
       space. The note now sits directly under the header, in its own column, above every cell it
       governs — so what governs what did not change — and the first column carries a SCOPE label,
       which gives the widest empty cell something to say.

       A CHANNEL-LEVEL NOTE OUTRANKS A CELL-LEVEL ONE. The node publishes `scopeNote` for a channel
       whose facts are bounded by how this node derives them, and `inputNote` for an input that did
       not arrive. Both govern the whole column. The majority hoist (`colWhy`) speaks only for the
       cells that still share one sentence, so it follows them.

       ONE LINE PER FACT: the scope of the channel and the arrival of its input are two different
       statements, and run together they read as one paragraph a reader skims. */
    var _sqNoteCell = function (ck) {
      var ch = sq.channels[ck] || {};
      var notes = [];
      if (ch.scopeNote) notes.push(ch.scopeNote);
      if (ch.inputNote) notes.push(ch.inputNote);
      var body =
        notes
          .map(function (n, i) {
            return '<div class="sq-col-note" style="' + _SQ_PROSE + ';white-space:normal' + (i ? ';margin-top:7px' : '') + '">' + n + '</div>';
          })
          .join('') +
        (colWhy[ck]
          ? '<div class="sq-col-why" style="' +
            _SQ_PROSE +
            ';white-space:normal;margin-top:7px">' +
            (colWhy[ck].n === colWhy[ck].of ? 'every absence here' : colWhy[ck].n + ' of the ' + colWhy[ck].of + ' absences here') +
            ' \u2014 ' +
            colWhy[ck].body +
            '</div>'
          : '');
      return body;
    };
    var _sqNoteBodies = chans.map(_sqNoteCell);
    var scopeRow = _sqNoteBodies.some(function (b) {
      return b;
    })
      ? '<tr><td style="' +
        TH +
        ';border-top:1px solid var(--border)">Scope</td>' +
        _sqNoteBodies
          .map(function (b) {
            return '<td style="padding:7px 14px 9px;border-top:1px solid var(--border);vertical-align:top">' + b + '</td>';
          })
          .join('') +
        '</tr>'
      : '';
    /* A FACT NO CHANNEL MEASURED SINKS BELOW THE RULE. It is still drawn, with its own reason — an
       absence is a result (§∅) — but it stops standing between two rows that carry numbers. The
       split is computed from the cells of THIS recording, so nothing here hardcodes which facts
       this node happens to compute today. */
    var measured = [],
      absent = [];
    SQ_ROWS.forEach(function (row) {
      var any = false;
      for (var i = 0; i < chans.length; i++) {
        var c = sq.channels[chans[i]] ? sq.channels[chans[i]][row.k] : null;
        if (c && _sqNum(c.value, row.kind) != null) {
          any = true;
          break;
        }
      }
      (any ? measured : absent).push(row);
    });
    function _sqRowHtml(row, i) {
      /* The zebra is 1.6 % white: enough to carry the eye across a wide row, far below the contrast
         of any text or rule on the card. The label cell is TOP-aligned, because a one-line label
         centred against an eight-line cell floats away from the number it names. */
      var bg = i % 2 ? 'background:rgba(255,255,255,.016);' : '';
      return (
        '<tr>' +
        '<td style="' +
        bg +
        'padding:11px 14px 13px;border-top:1px solid var(--border);color:var(--text2);font-weight:600;white-space:nowrap;vertical-align:top">' +
        _sqBadge(row.id) +
        row.label +
        '</td>' +
        chans
          .map(function (ck) {
            return _sqValueCell(
              sq.channels[ck] ? sq.channels[ck][row.k] : null,
              row.id,
              row.kind,
              hoisted[ck],
              baBook,
              row.label + ' in ' + String((sq.channels[ck] && sq.channels[ck].stream) || ck).toUpperCase()
            ).replace('<td class="sq-v" style="', '<td class="sq-v" style="' + bg);
          })
          .join('') +
        '</tr>'
      );
    }
    /* TWO ROWS, ONE NUMBER. `ecgdex-dsp.js` sets the axis-rate cell to `hostAxis.ppm` and builds
       the night figure as `night.ppm = hostAxis.ppm`, so on every recording that resolves a host
       axis the two rows print the same rate and differ only in what they attribute it to: the axis
       row names the host column, the night row names the §3d reference the profile selected. A
       reader who meets two rates with two labels reads two measurements and takes the agreement as
       corroboration, which is the one thing it cannot be. The table states the identity rather than
       hiding one row, because the ATTRIBUTION of each is a separate fact worth reading — and it
       states it only for the channels where the two numbers are in fact equal, measured here, so a
       future node that computes an independent night rate silences this line by itself. */
    var dupChans = chans.filter(function (ck) {
      var c = sq.channels[ck];
      if (!c || !c.timing || !c.drift) return false;
      var t = c.timing.value,
        d = c.drift.value;
      return t != null && d != null && isFinite(t) && isFinite(d) && t === d;
    });
    var dupNote =
      dupChans.length === 0
        ? ''
        : ' <b>Axis rate and Night drift are one measurement on ' +
          (dupChans.length === chans.length ? 'every channel here' : dupChans.join(', ')) +
          '</b>: the night rate is the host-axis rate, attributed to the reference the drift profile named. Their agreement corroborates nothing.';
    var rows = measured.map(_sqRowHtml).join('');
    if (absent.length && measured.length)
      rows +=
        '<tr class="sq-split"><td colspan="' +
        (chans.length + 1) +
        '" style="padding:16px 14px 6px;border-top:1px solid var(--border);font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--text4,var(--text3))">' +
        'not measured on any channel of this recording</td></tr>';
    rows += absent
      .map(function (row, i) {
        return _sqRowHtml(row, i + measured.length);
      })
      .join('');
    var sc = Array.isArray(sq.sidecars) ? sq.sidecars : [];
    var scRows = sc
      .map(function (r) {
        var col = _SQ_STATE_COLOR[r.state] || 'var(--text3)';
        return (
          '<tr><td style="padding:4px 8px;border-top:1px solid var(--border);font-family:IBM Plex Mono,monospace;font-size:11px;color:var(--text2)">' +
          r.file +
          '</td>' +
          '<td style="padding:4px 8px;border-top:1px solid var(--border);font-size:11px;color:var(--text3)">' +
          r.label +
          '</td>' +
          '<td class="sq-state" style="padding:4px 8px;border-top:1px solid var(--border);font-size:11px;color:' +
          col +
          ';white-space:nowrap">' +
          _sqBadge(SQ_LEDGER_ID) +
          r.state +
          '</td>' +
          '<td style="padding:4px 8px;border-top:1px solid var(--border);font-size:10px;color:var(--text3)">' +
          (r.state === 'read' ? '' : r.reason || _SQ_NO_REASON) +
          '</td></tr>'
        );
      })
      .join('');
    var nRead = sc.filter(function (r) {
      return r.state === 'read';
    }).length;
    var nNA = sc.filter(function (r) {
      return r.state === 'not-applicable';
    }).length;
    return (
      '<div class="mini-h">Signal quality per channel <span class="mini-sub">' +
      (sq.epochSec ? sq.epochSec + ' s windows' : 'window grid not stated') +
      '</span></div>' +
      '<div style="overflow-x:auto"><table class="sq-tbl" style="width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed">' +
      '<colgroup><col style="width:170px">' +
      chans
        .map(function () {
          return '<col style="width:' + (100 / chans.length).toFixed(2) + '%">';
        })
        .join('') +
      '</colgroup>' +
      head +
      scopeRow +
      rows +
      '</table></div>' +
      '<div class="mini-h" style="margin-top:12px">Validity sidecars <span class="mini-sub">' +
      sc.length +
      ' listed · ' +
      nRead +
      ' read · ' +
      nNA +
      ' not-applicable</span></div>' +
      '<div style="overflow-x:auto;max-height:260px;overflow-y:auto"><table class="sq-sidecars" style="width:100%;border-collapse:collapse">' +
      scRows +
      '</table></div>' +
      '<div class="q-note" style="margin-top:8px">Every cell above is the byte the node export carries. A <b>—</b> is a fact no one measured, ' +
      'and the line under it is the reason; a cell a sidecar changes shows the value before and after that sidecar applies.' +
      dupNote +
      '</div>'
    );
  }

  /* How many points a panel can actually draw. `_sqPanel` and its caller must agree on this, because
     the caller decides WHICH reason text to hand in from whether the panel will print one at all. */
  function _sqFinite(pts) {
    return pts.filter(function (p) {
      return isFinite(p.y);
    }).length;
  }

  /* ONE FINDING, PRINTED ONCE PER GROUP. On a phone capture `referenceReason`, `nightReason` and the
     axis's `inertReason` are the SAME finding — the host column is the device stamp rounded — so the
     three drift panels quoted one 180-character sentence four times, twice of them inside the rate
     panel alone (measured 2026-11-15 on the committed synthetic). A repeat teaches a reader nothing
     and buries the panel it sits under. §∅ asks that an absence carry its named reason, and it does:
     the reason is placed ONCE, at the first site that owes it, and every later site names that site
     instead of restating it. A back-reference is therefore only ever recorded for a site that really
     printed the text, which is why the caller asks the book only when the panel is empty. */
  function _sqReasonBook() {
    var seen = Object.create(null);
    /* `quietRepeat` is for a site whose own prefix already carries the fact, and which sits directly
       above a second site that will point at the same finding anyway. Two adjacent pointers to one
       sentence are the repeat this book exists to remove, so such a site states its prefix and stops. */
    return function (label, prefix, reason, quietRepeat) {
      var body = reason || _SQ_NO_REASON,
        first = seen[body];
      if (first === undefined) {
        seen[body] = label;
        return prefix ? prefix + ' \u2014 ' + body : body;
      }
      if (quietRepeat) return prefix || '';
      var back = 'the same finding as ' + first + ' above';
      return prefix ? prefix + ' \u2014 ' + back : back;
    };
  }

  /* One panel: a header with the series badge, then the chart, or a named reason in place of it. */
  function _sqPanel(badgeId, label, sub, pts, color, opts, reason) {
    var finite = _sqFinite(pts);
    var head = '<div class="mini-h" style="margin-top:10px">' + _sqBadge(badgeId) + label + ' <span class="mini-sub">' + sub + '</span></div>';
    /* AN EMPTY PANEL'S REASON IS DRESSED LIKE AN EMPTY CELL'S. Both say the same kind of thing — this
       was not measured, and here is why — so they share one treatment: the hairline rule on the left
       marks the text as subordinate to the title above it, and the measure cap keeps it readable on
       a wide card. A flush-left `q-note` read as body copy of the panel instead. */
    if (finite < 2) return head + _sqWhy(reason);
    return head + lineChart(pts, color, opts);
  }

  /* sqDriftPanels(dp, ax) → the three §3d series: the raw divergence, the per-window rate, and the
     Allan deviation of the divergence. Each carries its own badge, and an empty series states why
     rather than drawing an axis with no line on it. */
  function sqDriftPanels(dp, ax) {
    if (!dp)
      return (
        '<div class="mini-h">Clock drift</div>' +
        '<div class="q-note">This recording carries no drift profile, so none of the three series exists. ' +
        'The profile needs a device clock and a host column from the same rows.</div>'
      );
    var wins = Array.isArray(dp.windows) ? dp.windows : [];
    var refName = dp.reference && dp.reference.name ? dp.reference.name : null;
    var noRef = dp.referenceReason || 'this recording names no §3d time reference';
    var divPts = wins.map(function (w) {
      return { x: w.tMin, y: w.residFirstMs == null ? null : w.residFirstMs };
    });
    var ratePts = wins.map(function (w) {
      return { x: w.tMin, y: w.ppm == null ? null : w.ppm };
    });
    var stab = ax && ax.stability ? ax.stability : null;
    var curve = stab && Array.isArray(stab.curve) ? stab.curve : [];
    /* BOTH AXES ARE LOG, because the only thing this curve is read FOR is its SLOPE: `clock.js`
       classifies the noise by a log-log least squares (`CK_ALLAN_NOISE`, boundaries at −0.75, −0.25,
       +0.25, +0.75). On the linear y this panel drew before, every slope looked like the same smooth
       decay and the printed class could not be checked against the picture it sat under.
       σ is a deviation, so a non-positive term has no logarithm. Such a term is EXCLUDED and counted
       rather than clamped, and the count rides in the caption (§∅: a dropped sample is stated). */
    var allanAll = curve.filter(function (c) {
      return c && c.tauSec > 0 && isFinite(c.adevPpm);
    });
    var allanPts = allanAll
      .filter(function (c) {
        return c.adevPpm > 0;
      })
      .map(function (c) {
        return { x: Math.log(c.tauSec) / Math.LN10, y: Math.log(c.adevPpm) / Math.LN10 };
      });
    var allanDropped = allanAll.length - allanPts.length;
    /* THE NOISE LABEL IS A CONCLUSION OF A FIT, so it never travels alone. `clock.js` publishes the
       unrounded `slope` with its standard error and the τ count the fit read, and it publishes
       `meaning` exactly when the slope sits within 1.96 SE of a category boundary — which says the
       noise TYPE is not supported by this fit. A panel that prints the label alone presents an
       unsupported category as a measurement, so the label here always carries slope ± SE over the
       τ count, and the unsupported case says so in place of the label. */
    var slopeTxt = null;
    if (stab && stab.slope != null && isFinite(stab.slope)) {
      slopeTxt =
        'slope ' +
        stab.slope.toFixed(2) +
        (stab.slopeSE != null && isFinite(stab.slopeSE) ? ' ± ' + stab.slopeSE.toFixed(2) : ' (no SE published)') +
        (stab.nTau == null ? '' : ' over ' + stab.nTau + ' τ');
    }
    var allanSub =
      'σ(τ) of the raw divergence · averaging time τ on the x axis · both axes log' +
      (slopeTxt == null ? '' : ' · ' + slopeTxt) +
      (stab && stab.meaning ? ' · class unsupported by this fit' : stab && stab.noise ? ' · ' + stab.noise : '') +
      (allanDropped > 0 ? ' · ' + allanDropped + ' τ dropped: σ is not positive there, so it has no logarithm' : '');
    /* THE AXIS PUBLISHES ITS OWN REASONS, so this ladder QUOTES them and writes no prose over them
       (§∅: the named reason must be the node's own). `deviceDrawn` is read BEFORE `independent`,
       because the two answer different questions: `drawnReason` says the DEVICE column is a
       synthesised counter and not a clock, while `inertReason` says the HOST column is the device
       stamp rounded. clock.js publishes the two separately, because both can be non-null and neither
       implies the other — and a drawn axis still reads `independent: true`, so a ladder gating on
       `independent` alone prints the wrong reason for a drawn stream. That shape is what the
       drawn-axis provenance gate reds. Either reason may be absent on a hand-made axis, and then the
       panel says so rather than inventing one. */
    var allanWhy = !ax
      ? { p: null, b: 'this recording publishes no host axis, so the divergence it would average does not exist' }
      : ax.ok === false
        ? { p: 'the host axis refused this recording', b: ax.reason || _SQ_NO_REASON }
        : ax.deviceDrawn === true
          ? { p: 'no second timebase to average', b: ax.drawnReason || _SQ_NO_REASON }
          : ax.independent === false
            ? { p: 'no second clock to average', b: ax.inertReason || _SQ_NO_REASON }
            : stab && stab.note
              ? { p: null, b: stab.note }
              : { p: null, b: 'the axis published no Allan curve for this recording' };
    /* THE NIGHT FIGURE IS AN OBJECT, NEVER A NUMBER. `ecgdex-dsp.js` builds
       `{ppm, spanPpm, spanMs, anchors, ppmUncertainty, uncertaintyReason}`, and it is non-null
       whenever the recording names a host reference — which is every capture-host night, and no
       committed fixture. A `== null` guard passes that object to a numeric site, so `night.toFixed(1)`
       threw on the first real night, and the throw took down every section after this one, because
       it aborts `renderAll`. Read `.ppm`, and read it finite.
       §🔒.7 forbids a quoted `ppm` without its anchor count and its span, so the label carries both,
       and §7 forbids a rate that travels without the size of its own uncertainty. §∅: each absence
       states the node's own reason rather than printing nothing. */
    var winWhy = refName ? 'no window of this recording holds the three anchors a rate needs' : noRef;
    var nightObj = dp.night && typeof dp.night === 'object' ? dp.night : null;
    var nightPpm = nightObj && nightObj.ppm != null && isFinite(nightObj.ppm) ? nightObj.ppm : null;
    var nightUnc = nightObj && nightObj.ppmUncertainty != null && isFinite(nightObj.ppmUncertainty) ? nightObj.ppmUncertainty : null;
    var nightSpanH = nightObj && nightObj.spanMs != null && isFinite(nightObj.spanMs) ? nightObj.spanMs / 3600000 : null;
    /* THE FOUR REASON SITES OF THIS GROUP, IN DOCUMENT ORDER: the divergence panel's empty state, the
       rate panel's subtitle, the rate panel's empty state, the Allan panel's empty state. The book is
       asked in that order, and only for a site that will really print. A panel that DRAWS a line
       prints no reason, so its text never enters the book and no later site points at it. */
    var book = _sqReasonBook(),
      divDrawn = _sqFinite(divPts) >= 2,
      rateDrawn = _sqFinite(ratePts) >= 2,
      allanDrawn = _sqFinite(allanPts) >= 2;
    var whyDiv = divDrawn ? winWhy : book('Host divergence', null, winWhy);
    var nightTxt;
    if (nightPpm == null) {
      var nightWhy = nightObj ? 'the host axis published none for this recording' : dp.nightReason || null;
      nightTxt = nightWhy == null ? '' : ' · ' + book('the night rate line', 'no night rate', nightWhy, true);
    } else {
      nightTxt =
        ' · night ' +
        nightPpm.toFixed(1) +
        (nightUnc == null ? ' ppm (no uncertainty: ' + (nightObj.uncertaintyReason || _SQ_NO_REASON) + ')' : ' ± ' + nightUnc.toFixed(1) + ' ppm') +
        ' · ' +
        (nightObj.anchors == null ? '?' : nightObj.anchors) +
        ' anchors' +
        (nightSpanH == null ? ' · span absent' : ' over ' + nightSpanH.toFixed(1) + ' h');
    }
    return (
      '<div class="mini-h">Clock drift <span class="mini-sub">' +
      (refName ? 'reference ' + refName + (dp.reference.basis ? ' · ' + dp.reference.basis : '') : 'no reference named') +
      '</span></div>' +
      _sqPanel(
        SQ_DRIFT_SERIES.divergence,
        'Host divergence',
        'raw host − device residual per ' + (dp.epochSec || '?') + ' s window · hours from the first sample on the x axis',
        divPts,
        C.blue,
        {
          W: 680,
          H: 140,
          xfmt: function (x) {
            return (x / 60).toFixed(1) + 'h';
          },
          yfmt: function (y) {
            return y.toFixed(0) + ' ms';
          }
        },
        whyDiv
      ) +
      _sqPanel(
        SQ_DRIFT_SERIES.rate,
        'Per-window rate',
        'each window own raw residuals · hours from the first sample on the x axis' + nightTxt,
        ratePts,
        C.teal,
        {
          W: 680,
          H: 140,
          med: nightPpm == null ? undefined : nightPpm,
          xfmt: function (x) {
            return (x / 60).toFixed(1) + 'h';
          },
          yfmt: function (y) {
            return y.toFixed(1) + ' ppm';
          }
        },
        rateDrawn ? winWhy : book('Per-window rate', null, winWhy)
      ) +
      _sqPanel(
        SQ_DRIFT_SERIES.allan,
        'Allan deviation',
        allanSub,
        allanPts,
        C.amber,
        {
          W: 680,
          H: 140,
          xfmt: function (x) {
            var t = Math.pow(10, x);
            return t >= 3600 ? (t / 3600).toFixed(1) + 'h' : t >= 60 ? (t / 60).toFixed(0) + 'm' : t.toFixed(0) + 's';
          },
          yfmt: function (y) {
            /* the SERIES is log10(σ), so the tick exponentiates back to the ppm the reader wants */
            var v = Math.pow(10, y);
            return (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toPrecision(2)) + ' ppm';
          }
        },
        allanDrawn ? allanWhy.b : book('Allan deviation', allanWhy.p, allanWhy.b)
      ) +
      '<div class="q-note" style="margin-top:8px">The top two panels read the <b>raw</b> anchor residuals, never the smoothed correction: the running median exists to keep delivery jitter out of the correction, ' +
      'so a per-window cell taken from it would under-report a real step. The bottom panel says how far to trust a rate read over a given span; it is null when the host column carries no clock of its own. ' +
      'Both of its axes are logarithmic, because the noise class is the slope of that log-log curve and a reader has to be able to check the printed class against the line.' +
      (stab && stab.meaning ? ' ' + stab.meaning : '') +
      '</div>'
    );
  }

  global.ECGUI = { ECGScope, lineChart, poincare, hypnogram, medianBeatChart, buildEnvelope, scopeAxisTick, scopeAxisLabel, sqTable, sqDriftPanels, SQ_ROWS, SQ_DRIFT_SERIES, SQ_LEDGER_ID, COLORS: C };
})(window);

// ESM-MIGRATION: dual-mode re-export so ecgdex-app.js can `import { ECGUI }`; the IIFE still attaches
// window.ECGUI for classic consumers (classicify sheds this line for the vm/harness).
export const ECGUI = window.ECGUI;
