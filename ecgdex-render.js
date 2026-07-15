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
  } catch (e) {
    return '';
  }
}

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
      // amplitude range (robust)
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
      const sy = (v) => padT + ((this.yHi - v) / (this.yHi - this.yLo)) * plotH;

      // baseline grid (major every 0.2 s on the time axis at this zoom)
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      const secStart = start / this.fs,
        secSpan = span / this.fs;
      let tick = secSpan / 8 > 1 ? Math.ceil(secSpan / 8) : secSpan / 8 > 0.2 ? 0.5 : 0.2;
      if (secSpan > 120) tick = Math.ceil(secSpan / 8 / 60) * 60;
      ctx.fillStyle = C.dim;
      ctx.font = 10 * dpr + 'px IBM Plex Mono, monospace';
      ctx.textAlign = 'center';
      for (let t = Math.ceil(secStart / tick) * tick; t < secStart + secSpan; t += tick) {
        const x = padL + ((t - secStart) / secSpan) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        const lbl = secSpan > 120 ? (t / 60).toFixed(0) + 'm' : secSpan > 12 ? t.toFixed(0) + 's' : t.toFixed(1) + 's';
        ctx.fillText(lbl, x, H - 5 * dpr);
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
      const samplesPerPx = (span / plotW) * dpr;
      const f = this._pickLevel(samplesPerPx);
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
    for (const p of pts) {
      if (opts.ymn == null && p.y < ymn) ymn = p.y;
      if (opts.ymx == null && p.y > ymx) ymx = p.y;
      if (p.x < xmn) xmn = p.x;
      if (p.x > xmx) xmx = p.x;
    }
    if (ymx === ymn) ymx = ymn + 1;
    if (xmx === xmn) xmx = xmn + 1;
    const sx = (x) => P.l + ((x - xmn) / (xmx - xmn)) * (W - P.l - P.r);
    const sy = (y) => H - P.b - ((y - ymn) / (ymx - ymn)) * (H - P.t - P.b);
    const line = pts.map((p, k) => (k ? 'L' : 'M') + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1)).join(' ');
    const area = `M${sx(pts[0].x).toFixed(1)} ${H - P.b} ` + pts.map((p) => 'L' + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1)).join(' ') + ` L${sx(pts[n - 1].x).toFixed(1)} ${H - P.b} Z`;
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
    const ex = (sd2v / (mx - mn)) * (W - 2 * P),
      ey = (sd1v / (mx - mn)) * (H - 2 * P);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" style="width:100%;height:auto;max-width:340px;margin:0 auto;display:block">
    <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${P}" stroke="${C.axis}" stroke-dasharray="3 3"/>
    <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="${C.axis}"/>
    <line x1="${P}" y1="${P}" x2="${P}" y2="${H - P}" stroke="${C.axis}"/>
    ${dots}
    <g transform="rotate(-45 ${cx} ${cy})"><ellipse cx="${cx}" cy="${cy}" rx="${Math.abs(ex).toFixed(1)}" ry="${Math.abs(ey).toFixed(1)}" fill="rgba(88,166,255,.10)" stroke="${C.blue}" stroke-width="1.4"/></g>
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
    for (let i = 0; i < n; i++) {
      const x0 = sx(stages[i].tMin),
        x1 = sx(i < n - 1 ? stages[i + 1].tMin : xmx),
        y = sy(yOf[stages[i].stage]);
      segs += `<rect x="${x0.toFixed(1)}" y="${(y - 3).toFixed(1)}" width="${Math.max(0.6, x1 - x0).toFixed(1)}" height="6" fill="${colOf[stages[i].stage]}" opacity=".85"/>`;
      path += (i ? 'L' : 'M') + x0.toFixed(1) + ' ' + y.toFixed(1) + ' L' + x1.toFixed(1) + ' ' + y.toFixed(1) + ' ';
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
      L = beat.length,
      fs = mb.fs;
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
    const msAt = (i) => ((i - mb.pre) / fs) * 1000;
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

  global.ECGUI = { ECGScope, lineChart, poincare, hypnogram, medianBeatChart, buildEnvelope, COLORS: C };
})(window);
