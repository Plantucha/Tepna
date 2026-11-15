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
      P = { l: 46, r: 14, t: 14, b: 24 },
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
    <text x="${P.l - 6}" y="${(sy(ymx) + 4).toFixed(1)}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">${ymx.toFixed(0)}</text>
    <text x="${P.l - 6}" y="${(sy(ymn) + 4).toFixed(1)}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">${ymn.toFixed(0)}</text>
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
  var SQ_ROWS = [
    { k: 'coverage', id: 'coverage', label: 'Coverage' },
    { k: 'rail', id: 'sqRail', label: 'Rail census' },
    { k: 'flatline', id: 'sqFlatline', label: 'Flatline share' },
    { k: 'snr', id: 'sqSnr', label: 'In-band SNR' },
    { k: 'mains', id: 'sqMains', label: 'Mains ratio' },
    { k: 'nodeSqi', id: 'meanSQI', label: 'Mean SQI' },
    { k: 'timing', id: 'sqTiming', label: 'Axis rate' },
    { k: 'reference', id: 'sqReference', label: 'Reference Δ' },
    { k: 'epochs', id: 'sqEpochs', label: 'Epoch population' },
    { k: 'drift', id: 'sqDrift', label: 'Night drift' }
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
  function _sqNum(v) {
    if (v == null || typeof v !== 'number' || !isFinite(v)) return null;
    var a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1000) return v.toFixed(0);
    if (a >= 1) return v.toFixed(2);
    return v.toPrecision(3);
  }

  var _SQ_NO_REASON = 'no reason travelled with this absence, which is itself a defect';

  function _sqWhy(reason) {
    return '<div class="sq-why" style="font-size:10px;line-height:1.35;color:var(--text3);margin-top:3px">' + (reason || _SQ_NO_REASON) + '</div>';
  }

  /* The before-and-after pair of §6: a fact a sidecar changes shows both sides, and an absent side
     shows its own reason. Box 7's vendor case is exactly this — every AFTER side null. */
  function _sqBeforeAfter(cell) {
    var hasB = Object.prototype.hasOwnProperty.call(cell, 'before'),
      hasA = Object.prototype.hasOwnProperty.call(cell, 'after');
    if (!hasB && !hasA) return '';
    var b = _sqNum(cell.before),
      a = _sqNum(cell.after);
    return (
      '<div class="sq-ba" style="font-size:10px;line-height:1.35;color:var(--text3);margin-top:3px">' +
      'before ' +
      (b == null ? '<b>—</b> (' + (cell.beforeReason || _SQ_NO_REASON) + ')' : '<b>' + b + '</b>') +
      ' → after ' +
      (a == null ? '<b>—</b> (' + (cell.afterReason || _SQ_NO_REASON) + ')' : '<b>' + a + '</b>') +
      '</div>'
    );
  }

  function _sqValueCell(cell, badgeId) {
    var pad = 'padding:5px 8px;border-top:1px solid var(--border);vertical-align:top';
    if (!cell) return '<td class="sq-v" style="' + pad + '">' + _sqBadge(badgeId) + '<b>—</b>' + _sqWhy('this channel publishes no cell for this fact, so the table has nothing to read') + '</td>';
    var n = _sqNum(cell.value);
    return (
      '<td class="sq-v" style="' +
      pad +
      '">' +
      _sqBadge(badgeId) +
      (n == null ? '<b>—</b>' : '<b style="font-family:IBM Plex Mono,monospace">' + n + '</b>') +
      (cell.unit ? '<div class="sq-u" style="font-size:10px;color:var(--text3)">' + cell.unit + '</div>' : '') +
      (n == null ? _sqWhy(cell.reason) : '') +
      _sqBeforeAfter(cell) +
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
    var head =
      '<tr><th style="text-align:left;padding:5px 8px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--text3)">Fact</th>' +
      chans
        .map(function (ck) {
          var st = (sq.channels[ck] && sq.channels[ck].stream) || ck;
          return '<th style="text-align:left;padding:5px 8px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--text3)">' + st + '</th>';
        })
        .join('') +
      '</tr>';
    var rows = SQ_ROWS.map(function (row) {
      return (
        '<tr><td style="padding:5px 8px;border-top:1px solid var(--border);color:var(--text2);font-weight:600;white-space:nowrap">' +
        _sqBadge(row.id) +
        row.label +
        '</td>' +
        chans
          .map(function (ck) {
            return _sqValueCell(sq.channels[ck] ? sq.channels[ck][row.k] : null, row.id);
          })
          .join('') +
        '</tr>'
      );
    }).join('');
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
      '<div style="overflow-x:auto"><table class="sq-tbl" style="width:100%;border-collapse:collapse;font-size:12px">' +
      head +
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
      'and the line under it is the reason; a cell a sidecar changes shows the value before and after that sidecar applies.</div>'
    );
  }

  /* One panel: a header with the series badge, then the chart, or a named reason in place of it. */
  function _sqPanel(badgeId, label, sub, pts, color, opts, reason) {
    var finite = pts.filter(function (p) {
      return isFinite(p.y);
    }).length;
    var head = '<div class="mini-h" style="margin-top:10px">' + _sqBadge(badgeId) + label + ' <span class="mini-sub">' + sub + '</span></div>';
    if (finite < 2) return head + '<div class="q-note">' + (reason || _SQ_NO_REASON) + '</div>';
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
    /* τ is read on a LOG axis, because an Allan curve's whole shape lives in the decades. The
       helper scales x linearly, so the points carry log10(τ) and the tick formatter prints τ. */
    var allanPts = curve
      .filter(function (c) {
        return c && c.tauSec > 0 && isFinite(c.adevPpm);
      })
      .map(function (c) {
        return { x: Math.log(c.tauSec) / Math.LN10, y: c.adevPpm };
      });
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
      ? 'this recording publishes no host axis, so the divergence it would average does not exist'
      : ax.ok === false
        ? 'the host axis refused this recording: ' + (ax.reason || _SQ_NO_REASON)
        : ax.deviceDrawn === true
          ? 'no second timebase to average: ' + (ax.drawnReason || _SQ_NO_REASON)
          : ax.independent === false
            ? 'no second clock to average: ' + (ax.inertReason || _SQ_NO_REASON)
            : stab && stab.note
              ? stab.note
              : 'the axis published no Allan curve for this recording';
    var winWhy = refName ? 'no window of this recording holds the three anchors a rate needs' : noRef;
    return (
      '<div class="mini-h">Clock drift <span class="mini-sub">' +
      (refName ? 'reference ' + refName + (dp.reference.basis ? ' · ' + dp.reference.basis : '') : 'no reference named') +
      '</span></div>' +
      _sqPanel(
        SQ_DRIFT_SERIES.divergence,
        'Host divergence',
        'raw host − device residual per ' + (dp.epochSec || '?') + ' s window, ms',
        divPts,
        C.blue,
        {
          W: 680,
          H: 140,
          xfmt: function (x) {
            return (x / 60).toFixed(1) + 'h';
          }
        },
        winWhy
      ) +
      _sqPanel(
        SQ_DRIFT_SERIES.rate,
        'Per-window rate',
        'ppm from each window own raw residuals' + (dp.night == null ? '' : ' · night ' + dp.night.toFixed(1) + ' ppm'),
        ratePts,
        C.teal,
        {
          W: 680,
          H: 140,
          med: dp.night == null ? undefined : dp.night,
          xfmt: function (x) {
            return (x / 60).toFixed(1) + 'h';
          }
        },
        winWhy
      ) +
      _sqPanel(
        SQ_DRIFT_SERIES.allan,
        'Allan deviation',
        'σ(τ) of the raw divergence, ppm' + (stab && stab.noise ? ' · ' + stab.noise : ''),
        allanPts,
        C.amber,
        {
          W: 680,
          H: 140,
          xfmt: function (x) {
            var t = Math.pow(10, x);
            return t >= 3600 ? (t / 3600).toFixed(1) + 'h' : t >= 60 ? (t / 60).toFixed(0) + 'm' : t.toFixed(0) + 's';
          }
        },
        allanWhy
      ) +
      '<div class="q-note" style="margin-top:8px">The top two panels read the <b>raw</b> anchor residuals, never the smoothed correction: the running median exists to keep delivery jitter out of the correction, ' +
      'so a per-window cell taken from it would under-report a real step. The bottom panel says how far to trust a rate read over a given span; it is null when the host column carries no clock of its own.</div>'
    );
  }

  global.ECGUI = { ECGScope, lineChart, poincare, hypnogram, medianBeatChart, buildEnvelope, scopeAxisTick, scopeAxisLabel, sqTable, sqDriftPanels, SQ_ROWS, SQ_DRIFT_SERIES, SQ_LEDGER_ID, COLORS: C };
})(window);

// ESM-MIGRATION: dual-mode re-export so ecgdex-app.js can `import { ECGUI }`; the IIFE still attaches
// window.ECGUI for classic consumers (classicify sheds this line for the vm/harness).
export const ECGUI = window.ECGUI;
