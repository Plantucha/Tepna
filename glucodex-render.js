/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   GlucoDex · RENDER  (glucodex-render.js)
   ────────────────────────────────────────────────────────────────────────
   · GlucoScope — canvas glucose-trace explorer: TIR background bands, greyed
     gap/warm-up spans, pan/zoom + minimap. Decimation is render-only (the
     ECGDex envelope-pyramid idea, applied to one CGM channel).
   · hand-rolled inline-SVG charts: AGP percentile envelope · TIR stacked bar ·
     daily overlay · glucose distribution · the autonomic⟷glycemic fusion plot.
   Exposes window.GLUUI.
   ════════════════════════════════════════════════════════════════════════ */

// ── evidence badge hook (System-Cohesion) — resolves a badge from a rendered
// label via GlucoRegistry (glucodex-registry.js). Zero-touch; safe no-op if the
// registry is unloaded. Global so app.js can call it directly.
function evBadge(label, fallback) {
  try {
    return (window.GlucoRegistry && window.GlucoRegistry.badgeForLabel(label, fallback !== false)) || '';
  } catch (e) {
    return '';
  }
}

// ESM-MIGRATION Phase 1: render is an ES module (import-wired by glucodex-app.js). evBadge stays a
// window global so the co-loaded classic profile + the app's remaining bare `evBadge` refs resolve.
window.evBadge = evBadge;

(function (global) {
  'use strict';

  const C = { teal: '#3DE0D0', blue: '#58A6FF', green: '#39D98A', amber: '#FFB84D', red: '#FF6B7A', purple: '#a78bfa', grid: 'rgba(255,255,255,.07)', axis: 'rgba(255,255,255,.14)', dim: '#6F8096' };
  // TIR band fills (consensus AGP colours, mapped into the ANS palette)
  const BAND = { vlow: '#B0454E', low: '#FF6B7A', tir: '#39D98A', high: '#FFB84D', vhigh: '#E08A3C' };
  const CUT = { vlow: 54, low: 70, high: 180, vhigh: 250 };

  // ── GluDisp — read-only DISPLAY-unit layer (DEEP-AUDIT-FIXES §3 · executes DEEP-AUDIT-FINDINGS
  //    Finding 3). Compute + storage STAY mg/dL (the CGM consensus + LBGI/HBGI/GMI/J-index constants
  //    are all authored in mg/dL); this converts ONLY at the render boundary. mg/dL is the default
  //    (it is itself a metric unit); mmol/L is the SI molar alternate. Band-edge labels use the
  //    internationally STANDARDIZED consensus mmol/L cutoffs (3.0/3.9/10.0/13.9 …), not a naive
  //    ÷18.018 of the mg/dL number, so bands read as clinicians expect. Persisted in localStorage. ──
  const _GLU_MMOL = 18.018;
  const _GLU_MMOL_LABEL = { 54: '3.0', 69: '3.8', 70: '3.9', 100: '5.6', 140: '7.8', 180: '10.0', 181: '10.1', 200: '11.1', 250: '13.9', 300: '16.7' };
  let _gluDispUnit = 'mgdl';
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('glucodex_dispUnit') === 'mmol') _gluDispUnit = 'mmol';
  } catch (e) {}
  const GluDisp = {
    get unit() {
      return _gluDispUnit;
    },
    isMmol() {
      return _gluDispUnit === 'mmol';
    },
    set(u) {
      _gluDispUnit = u === 'mmol' ? 'mmol' : 'mgdl';
      try {
        localStorage.setItem('glucodex_dispUnit', _gluDispUnit);
      } catch (e) {}
      return _gluDispUnit;
    },
    label() {
      return _gluDispUnit === 'mmol' ? 'mmol/L' : 'mg/dL';
    },
    // concentration value (stored mg/dL) -> display number (mg/dL integer · mmol/L 1 dp)
    val(mgdl) {
      if (mgdl == null || !isFinite(+mgdl)) return mgdl;
      return _gluDispUnit === 'mmol' ? +(+mgdl / _GLU_MMOL).toFixed(1) : +mgdl;
    },
    // dispersion value (SD / MAGE / CONGA / MODD — same linear scale)
    spread(mgdl) {
      return GluDisp.val(mgdl);
    },
    // signed delta (dawn rise, sensor bias) — sign preserved
    delta(mgdl) {
      if (mgdl == null || !isFinite(+mgdl)) return mgdl;
      const sg = +mgdl < 0 ? -1 : 1;
      return sg * GluDisp.val(Math.abs(+mgdl));
    },
    // canonical band-edge / axis-tick label (standardized mmol cutoffs)
    tick(mgdl) {
      return _gluDispUnit === 'mmol' ? _GLU_MMOL_LABEL[mgdl] || (+mgdl / _GLU_MMOL).toFixed(1) : String(mgdl);
    },
    range(lo, hi) {
      return GluDisp.tick(lo) + '–' + GluDisp.tick(hi);
    },
    cmp(op, mgdl) {
      return op + GluDisp.tick(mgdl);
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  //  GlucoScope — interactive canvas glucose trace
  // ════════════════════════════════════════════════════════════════════════
  class GlucoScope {
    constructor(canvas, mini) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.mini = mini;
      this.mctx = mini ? mini.getContext('2d') : null;
      this.data = null;
      this.light = false;
      this.view = { start: 0, span: 0 }; // cell-domain viewport
      this._bind();
    }
    setData(r) {
      const s = r.series;
      this.s = s;
      this.N = s.N;
      this.cad = s.cadence;
      this.gT = s.gT;
      this.gV = s.gV;
      this.gF = s.gF;
      this.FLAG = s.FLAG;
      this.yLo = 40;
      this.yHi = Math.max(260, r.max + 20);
      // default view: last 24h (or all if shorter)
      const dayCells = Math.min(this.N, Math.round(1440 / this.cad));
      this.view = { start: Math.max(0, this.N - dayCells), span: dayCells };
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
    draw() {
      if (!this.data && !this.gV) return;
      const ctx = this.ctx,
        W = this.canvas.width,
        H = this.canvas.height,
        dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, W, H);
      const padL = 44 * dpr,
        padR = 10 * dpr,
        padT = 8 * dpr,
        padB = 20 * dpr;
      const plotW = W - padL - padR,
        plotH = H - padT - padB;
      const { start, span } = this.view;
      const sy = (v) => padT + ((this.yHi - v) / (this.yHi - this.yLo)) * plotH;
      const sxCell = (c) => padL + ((c - start) / span) * plotW;

      // ── TIR background bands ──
      const bands = [
        [this.yLo, CUT.vlow, BAND.vlow],
        [CUT.vlow, CUT.low, BAND.low],
        [CUT.low, CUT.high, BAND.tir],
        [CUT.high, CUT.vhigh, BAND.high],
        [CUT.vhigh, this.yHi, BAND.vhigh]
      ];
      for (const [lo, hi, col] of bands) {
        const y0 = sy(Math.min(hi, this.yHi)),
          y1 = sy(Math.max(lo, this.yLo));
        ctx.fillStyle = col;
        ctx.globalAlpha = this.light ? 0.1 : 0.07;
        ctx.fillRect(padL, y0, plotW, y1 - y0);
        ctx.globalAlpha = 1;
      }
      // target lines 70 / 180
      ctx.strokeStyle = 'rgba(57,217,138,.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      for (const t of [CUT.low, CUT.high]) {
        const y = sy(t);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // y labels
      ctx.fillStyle = C.dim;
      ctx.font = 10 * dpr + 'px IBM Plex Mono, monospace';
      ctx.textAlign = 'right';
      for (const v of [54, 70, 180, 250]) {
        if (v < this.yLo || v > this.yHi) continue;
        ctx.fillText(GluDisp.tick(v), padL - 5 * dpr, sy(v) + 3 * dpr);
      }

      // x time grid (hour ticks)
      ctx.textAlign = 'center';
      const secStart = this.gT[Math.max(0, Math.floor(start))],
        spanMin = span * this.cad;
      let tickMin = spanMin > 2880 ? 360 : spanMin > 1440 ? 180 : spanMin > 360 ? 60 : 30;
      // tick grid anchored to civil midnight of the FLOATING clock (getUTC* — Clock Contract;
      // local setMinutes() mis-placed ticks in half-hour zones and never aligned 3h/6h grids to 00:00)
      const _sd = new Date(secStart),
        _step = tickMin * 60000;
      const _mid = Date.UTC(_sd.getUTCFullYear(), _sd.getUTCMonth(), _sd.getUTCDate());
      for (let tm = _mid + Math.ceil((secStart - _mid) / _step) * _step; ; tm += _step) {
        const cell = (tm - this.gT[0]) / (this.cad * 60000);
        if (cell > start + span) break;
        if (cell < start) continue;
        const x = sxCell(cell);
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        const d = new Date(tm);
        const lbl =
          spanMin > 1440
            ? d.getUTCMonth() + 1 + '/' + d.getUTCDate() + (tickMin >= 360 ? ' ' + String(d.getUTCHours()).padStart(2, '0') + 'h' : '')
            : String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
        ctx.fillStyle = C.dim;
        ctx.fillText(lbl, x, H - 6 * dpr);
      }

      // ── greyed excluded spans (gap / warm-up / compression) ──
      const i0 = Math.max(0, Math.floor(start)),
        i1 = Math.min(this.N - 1, Math.ceil(start + span));
      // GAP_LONG is shaded like a gap (a long dropout the sensor never saw) — DEEP-AUDIT §5.
      const exCol = {
        [this.FLAG.GAP]: 'rgba(150,160,175,.16)',
        [this.FLAG.GAP_LONG]: 'rgba(150,160,175,.16)',
        [this.FLAG.WARMUP]: 'rgba(255,184,77,.13)',
        [this.FLAG.COMPRESSION]: 'rgba(167,139,250,.16)'
      };
      let runS = null,
        runFlag = null;
      for (let i = i0; i <= i1; i++) {
        const f = this.gF[i];
        const ex = f === this.FLAG.GAP || f === this.FLAG.GAP_LONG || f === this.FLAG.WARMUP || f === this.FLAG.COMPRESSION;
        if (ex && runS === null) {
          runS = i;
          runFlag = f;
        }
        if ((!ex || f !== runFlag || i === i1) && runS !== null) {
          const x0 = sxCell(runS),
            x1 = sxCell(i);
          ctx.fillStyle = exCol[runFlag] || 'rgba(150,160,175,.14)';
          ctx.fillRect(Math.max(padL, x0), padT, Math.min(padL + plotW, x1) - Math.max(padL, x0), plotH);
          runS = ex ? i : null;
          runFlag = ex ? f : null;
        }
      }

      // ── glucose trace (colour by zone) ──
      ctx.lineWidth = 1.8 * dpr;
      ctx.lineJoin = 'round';
      let pen = false,
        prevCol = null;
      const colOf = (v) => (v < CUT.vlow ? BAND.vlow : v < CUT.low ? BAND.low : v <= CUT.high ? C.teal : v <= CUT.vhigh ? BAND.high : BAND.vhigh);
      // decimate: at most ~2px per sample
      const stepDraw = Math.max(1, Math.floor(((span / plotW) * dpr) / 1.2));
      ctx.beginPath();
      for (let i = i0; i <= i1; i += stepDraw) {
        const x = sxCell(i),
          y = sy(this.gV[i]);
        const isGap = this.gF[i] === this.FLAG.WARMUP;
        if (isGap) {
          if (pen) {
            ctx.stroke();
            pen = false;
          }
          continue;
        }
        const col = colOf(this.gV[i]);
        if (!pen) {
          ctx.beginPath();
          ctx.strokeStyle = col;
          ctx.moveTo(x, y);
          pen = true;
          prevCol = col;
        } else if (col !== prevCol) {
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.beginPath();
          ctx.strokeStyle = col;
          ctx.moveTo(x, y);
          prevCol = col;
        } else ctx.lineTo(x, y);
      }
      if (pen) ctx.stroke();
    }
    drawMini() {
      if (!this.mctx) return;
      const ctx = this.mctx,
        W = this.mini.width,
        H = this.mini.height;
      ctx.clearRect(0, 0, W, H);
      const sy = (v) => 2 + ((this.yHi - v) / (this.yHi - this.yLo)) * (H - 4);
      // tir band
      ctx.fillStyle = 'rgba(57,217,138,.10)';
      ctx.fillRect(0, sy(CUT.high), W, sy(CUT.low) - sy(CUT.high));
      ctx.strokeStyle = 'rgba(61,224,208,.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const step = Math.max(1, Math.floor(this.N / W));
      let pen = false;
      for (let px = 0; px < W; px++) {
        const i = Math.floor((px / W) * this.N);
        if (this.gF[i] === this.FLAG.WARMUP) {
          pen = false;
          continue;
        }
        const y = sy(this.gV[i]);
        if (!pen) {
          ctx.moveTo(px, y);
          pen = true;
        } else ctx.lineTo(px, y);
      }
      ctx.stroke();
      const x0 = (this.view.start / this.N) * W,
        x1 = ((this.view.start + this.view.span) / this.N) * W;
      ctx.fillStyle = 'rgba(88,166,255,.18)';
      ctx.fillRect(x0, 0, Math.max(2, x1 - x0), H);
      ctx.strokeStyle = C.blue;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0, 0.5, Math.max(2, x1 - x0), H - 1);
    }
    zoom(factor, frac) {
      const c = this.view.start + this.view.span * (frac == null ? 0.5 : frac);
      let span = Math.max(Math.round(120 / this.cad), Math.min(this.N, this.view.span * factor));
      let start = Math.max(0, Math.min(this.N - span, c - span * (frac == null ? 0.5 : frac)));
      this.view = { start, span };
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
    setSpanMin(min) {
      const c = this.view.start + this.view.span / 2;
      let span = Math.max(2, Math.min(this.N, Math.round(min / this.cad)));
      let start = Math.max(0, Math.min(this.N - span, c - span / 2));
      this.view = { start, span };
      this.draw();
      this.drawMini();
      this._emit();
    }
    _emit() {
      if (this.onView) this.onView(this.view, this.cad, this.N, this.gT);
    }
    _bind() {
      const cv = this.canvas;
      cv.addEventListener(
        'wheel',
        (e) => {
          if (!this.gV) return;
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
        if (!drag || !this.gV) return;
        const r = cv.getBoundingClientRect();
        const dSamp = (-(e.clientX - drag.x) / r.width) * this.view.span;
        this.view.start = Math.max(0, Math.min(this.N - this.view.span, drag.start + dSamp));
        this.draw();
        this.drawMini();
        this._emit();
      });
      const end = () => {
        drag = null;
        cv.style.cursor = 'grab';
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      if (this.mini) {
        const jump = (e) => {
          const r = this.mini.getBoundingClientRect();
          const frac = (e.clientX - r.left) / r.width;
          this.view.start = Math.max(0, Math.min(this.N - this.view.span, frac * this.N - this.view.span / 2));
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
        if (this.gV) {
          this.resize();
          this.draw();
          this.drawMini();
        }
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  SVG CHARTS
  // ════════════════════════════════════════════════════════════════════════
  const xfmtHour = (h) => (h % 24 === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : h - 12 + 'p');

  // AGP percentile envelope — median line, IQR band, 10–90 band across the 24h clock
  function agpChart(hourly, opts) {
    opts = opts || {};
    const W = opts.W || 720,
      H = opts.H || 230,
      P = { l: 42, r: 14, t: 14, b: 24 };
    const pts = hourly.filter((b) => b.p50 != null);
    if (pts.length < 4) return '<div style="padding:30px;text-align:center;color:var(--text3);font-size:12px">Not enough coverage across the 24-h clock to build an AGP envelope yet.</div>';
    const ymn = 40,
      ymx = Math.max(260, Math.ceil((Math.max(...pts.map((b) => b.p90)) + 20) / 20) * 20);
    const sx = (h) => P.l + (h / 24) * (W - P.l - P.r);
    const sy = (v) => H - P.b - ((Math.min(ymx, Math.max(ymn, v)) - ymn) / (ymx - ymn)) * (H - P.t - P.b);
    const band = (key0, key1) => {
      let d = 'M';
      const up = [],
        dn = [];
      for (const b of pts) {
        up.push(sx(b.h).toFixed(1) + ' ' + sy(b[key1]).toFixed(1));
      }
      for (let i = pts.length - 1; i >= 0; i--) {
        dn.push(sx(pts[i].h).toFixed(1) + ' ' + sy(pts[i][key0]).toFixed(1));
      }
      return 'M' + up.join(' L') + ' L' + dn.join(' L') + ' Z';
    };
    const line = (key) => pts.map((b, k) => (k ? 'L' : 'M') + sx(b.h).toFixed(1) + ' ' + sy(b[key]).toFixed(1)).join(' ');
    // target band shading 70-180
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:auto">
    <rect x="${P.l}" y="${sy(180).toFixed(1)}" width="${W - P.l - P.r}" height="${(sy(70) - sy(180)).toFixed(1)}" fill="${C.green}" opacity=".06"/>
    <line x1="${P.l}" y1="${sy(180).toFixed(1)}" x2="${W - P.r}" y2="${sy(180).toFixed(1)}" stroke="${C.green}" stroke-dasharray="4 4" opacity=".45"/>
    <line x1="${P.l}" y1="${sy(70).toFixed(1)}" x2="${W - P.r}" y2="${sy(70).toFixed(1)}" stroke="${C.green}" stroke-dasharray="4 4" opacity=".45"/>
    <path d="${band('p10', 'p90')}" fill="${C.blue}" opacity=".12"/>
    <path d="${band('p25', 'p75')}" fill="${C.blue}" opacity=".22"/>
    <path d="${line('p50')}" fill="none" stroke="${C.teal}" stroke-width="2.4" stroke-linejoin="round"/>
    <line x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}" stroke="${C.axis}"/>
    <line x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${H - P.b}" stroke="${C.axis}"/>
    ${[54, 70, 180, 250]
      .filter((v) => v >= ymn && v <= ymx)
      .map((v) => `<text x="${P.l - 6}" y="${(sy(v) + 3).toFixed(1)}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">${GluDisp.tick(v)}</text>`)
      .join('')}
    ${[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => `<text x="${sx(h).toFixed(1)}" y="${H - 7}" fill="${C.dim}" font-size="9" text-anchor="middle" font-family="IBM Plex Mono,monospace">${xfmtHour(h)}</text>`).join('')}
  </svg>`;
  }

  // TIR stacked horizontal bar (HTML — crisp text, easy legend)
  function tirBar(tir) {
    const segs = [
      { k: 'tar2', v: tir.tar2, col: BAND.vhigh, lbl: 'Very High', sub: GluDisp.cmp('>', 250) },
      { k: 'tar1', v: tir.tar1, col: BAND.high, lbl: 'High', sub: GluDisp.range(181, 250) },
      { k: 'tir', v: tir.tir, col: BAND.tir, lbl: 'In Range', sub: GluDisp.range(70, 180) },
      { k: 'tbr1', v: tir.tbr1, col: BAND.low, lbl: 'Low', sub: GluDisp.range(54, 69) },
      { k: 'tbr2', v: tir.tbr2, col: BAND.vlow, lbl: 'Very Low', sub: GluDisp.cmp('<', 54) }
    ];
    const bar = segs.map((s) => `<div class="tir-seg" style="flex:${Math.max(0.0001, s.v)};background:${s.col}" title="${s.lbl} ${s.v}%">${s.v >= 7 ? `<span>${s.v}%</span>` : ''}</div>`).join('');
    const legend = segs
      .map(
        (s) =>
          `<div class="tir-leg"><span class="tir-dot" style="background:${s.col}"></span><span class="tir-leg-l">${s.lbl}</span><span class="tir-leg-s">${s.sub} ${GluDisp.label()}</span><b>${s.v}%</b></div>`
      )
      .join('');
    return `<div class="tir-bar">${bar}</div><div class="tir-legend">${legend}</div>`;
  }

  // generic line chart (for daily trend / fusion overlays)
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
    const sx = (x) => P.l + ((x - xmn) / (xmx - xmn)) * (W - P.l - P.r),
      sy = (y) => H - P.b - ((y - ymn) / (ymx - ymn)) * (H - P.t - P.b);
    const line = pts.map((p, k) => (k ? 'L' : 'M') + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1)).join(' ');
    const area = `M${sx(pts[0].x).toFixed(1)} ${H - P.b} ` + pts.map((p) => 'L' + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1)).join(' ') + ` L${sx(pts[n - 1].x).toFixed(1)} ${H - P.b} Z`;
    const xt = [];
    for (let i = 0; i <= 5; i++) xt.push(xmn + (i * (xmx - xmn)) / 5);
    const gid = 'g' + Math.random().toString(36).slice(2, 7);
    const bands = opts.tirBands
      ? `<rect x="${P.l}" y="${sy(Math.min(ymx, 180)).toFixed(1)}" width="${W - P.l - P.r}" height="${Math.max(0, sy(Math.max(ymn, 70)) - sy(Math.min(ymx, 180))).toFixed(1)}" fill="${C.green}" opacity=".07"/>`
      : '';
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:auto">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${bands}
    <line x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}" stroke="${C.axis}"/>
    <line x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${H - P.b}" stroke="${C.axis}"/>
    ${opts.med != null ? `<line x1="${P.l}" y1="${sy(opts.med).toFixed(1)}" x2="${W - P.r}" y2="${sy(opts.med).toFixed(1)}" stroke="${color}" stroke-dasharray="4 4" opacity=".5"/>` : ''}
    <text x="${P.l - 6}" y="${(sy(ymx) + 4).toFixed(1)}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">${ymx.toFixed(0)}</text>
    <text x="${P.l - 6}" y="${(sy(ymn) + 4).toFixed(1)}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">${ymn.toFixed(0)}</text>
    ${xt.map((x) => `<text x="${sx(x).toFixed(1)}" y="${H - 7}" fill="${C.dim}" font-size="9" text-anchor="middle" font-family="IBM Plex Mono,monospace">${opts.xfmt ? opts.xfmt(x) : x.toFixed(0)}</text>`).join('')}
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>
  </svg>`;
  }

  // daily small-multiple overlay — every day's 24h trace, faint, with median day bold
  function dayOverlay(daysCells, opts) {
    opts = opts || {};
    const W = opts.W || 720,
      H = opts.H || 200,
      P = { l: 42, r: 14, t: 12, b: 22 };
    const ymn = 40,
      ymx = opts.ymx || 300;
    const sx = (h) => P.l + (h / 24) * (W - P.l - P.r),
      sy = (v) => H - P.b - ((Math.min(ymx, Math.max(ymn, v)) - ymn) / (ymx - ymn)) * (H - P.t - P.b);
    const traces = daysCells
      .map((d) => {
        if (d.pts.length < 3) return '';
        return `<path d="${d.pts.map((p, k) => (k ? 'L' : 'M') + sx(p.h).toFixed(1) + ' ' + sy(p.v).toFixed(1)).join(' ')}" fill="none" stroke="${C.teal}" stroke-width="1" opacity=".18"/>`;
      })
      .join('');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:auto">
    <rect x="${P.l}" y="${sy(180).toFixed(1)}" width="${W - P.l - P.r}" height="${(sy(70) - sy(180)).toFixed(1)}" fill="${C.green}" opacity=".06"/>
    ${[70, 180].map((v) => `<line x1="${P.l}" y1="${sy(v).toFixed(1)}" x2="${W - P.r}" y2="${sy(v).toFixed(1)}" stroke="${C.green}" stroke-dasharray="4 4" opacity=".4"/>`).join('')}
    ${traces}
    <line x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}" stroke="${C.axis}"/>
    ${[54, 70, 180, 250].map((v) => `<text x="${P.l - 6}" y="${(sy(v) + 3).toFixed(1)}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">${GluDisp.tick(v)}</text>`).join('')}
    ${[0, 6, 12, 18, 24].map((h) => `<text x="${sx(h).toFixed(1)}" y="${H - 6}" fill="${C.dim}" font-size="9" text-anchor="middle" font-family="IBM Plex Mono,monospace">${xfmtHour(h)}</text>`).join('')}
  </svg>`;
  }

  // glucose distribution histogram with TIR zones
  function distribution(vals, opts) {
    opts = opts || {};
    const W = opts.W || 340,
      H = opts.H || 200,
      P = { l: 34, r: 10, t: 10, b: 24 };
    const lo = 40,
      hi = Math.max(260, Math.ceil(Math.max(...vals.slice(0, 1), ...[opts.max || 280]) / 20) * 20);
    const nb = 28,
      bins = new Array(nb).fill(0);
    for (const v of vals) {
      const b = Math.min(nb - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * nb)));
      bins[b]++;
    }
    const mx = Math.max(...bins) || 1;
    const bw = (W - P.l - P.r) / nb;
    const colOf = (v) => (v < CUT.vlow ? BAND.vlow : v < CUT.low ? BAND.low : v <= CUT.high ? BAND.tir : v <= CUT.vhigh ? BAND.high : BAND.vhigh);
    const bars = bins
      .map((c, i) => {
        const v = lo + ((i + 0.5) / nb) * (hi - lo);
        const h = (c / mx) * (H - P.t - P.b);
        const x = P.l + i * bw;
        const y = H - P.b - h;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${colOf(v)}" opacity=".85"/>`;
      })
      .join('');
    const sx = (v) => P.l + ((v - lo) / (hi - lo)) * (W - P.l - P.r);
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    ${bars}
    <line x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}" stroke="${C.axis}"/>
    ${[70, 180].map((v) => `<line x1="${sx(v).toFixed(1)}" y1="${P.t}" x2="${sx(v).toFixed(1)}" y2="${H - P.b}" stroke="${C.green}" stroke-dasharray="3 3" opacity=".5"/>`).join('')}
    ${[54, 100, 180, 250]
      .filter((v) => v <= hi)
      .map((v) => `<text x="${sx(v).toFixed(1)}" y="${H - 7}" fill="${C.dim}" font-size="8.5" text-anchor="middle" font-family="IBM Plex Mono,monospace">${GluDisp.tick(v)}</text>`)
      .join('')}
  </svg>`;
  }

  // ── FUSION scatter: autonomic-risk vector (x) vs glycemic variability (y) ──
  function fusionScatter(items, opts) {
    opts = opts || {};
    const W = opts.W || 340,
      H = opts.H || 300,
      P = 38;
    // items: {x,y,label,col}
    const xs = items.map((i) => i.x),
      ys = items.map((i) => i.y);
    const xmn = Math.min(...xs, opts.xmn ?? 0),
      xmx = Math.max(...xs, opts.xmx ?? 1);
    const ymn = Math.min(...ys, opts.ymn ?? 0),
      ymx = Math.max(...ys, opts.ymx ?? 50);
    const sx = (v) => P + ((v - xmn) / (xmx - xmn || 1)) * (W - 2 * P),
      sy = (v) => H - P - ((v - ymn) / (ymx - ymn || 1)) * (H - 2 * P);
    const dots = items
      .map(
        (i) =>
          `<g><circle cx="${sx(i.x).toFixed(1)}" cy="${sy(i.y).toFixed(1)}" r="6" fill="${i.col || C.teal}" opacity=".9"/>${i.label ? `<text x="${sx(i.x).toFixed(1)}" y="${(sy(i.y) - 10).toFixed(1)}" fill="${C.dim}" font-size="9" text-anchor="middle" font-family="IBM Plex Mono,monospace">${i.label}</text>` : ''}</g>`
      )
      .join('');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-width:360px;margin:0 auto;display:block">
    <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="${C.axis}"/>
    <line x1="${P}" y1="${P}" x2="${P}" y2="${H - P}" stroke="${C.axis}"/>
    ${dots}
    <text x="${W / 2}" y="${H - 8}" fill="${C.dim}" font-size="10" text-anchor="middle" font-family="IBM Plex Mono,monospace">${opts.xlab || 'autonomic risk →'}</text>
    <text x="12" y="${H / 2}" fill="${C.dim}" font-size="10" text-anchor="middle" font-family="IBM Plex Mono,monospace" transform="rotate(-90 12 ${H / 2})">${opts.ylab || 'glycemic variability →'}</text>
  </svg>`;
  }

  // risk gauge bar (directional IR-risk band)
  function riskGauge(pct, band, col) {
    return `<div class="rg-track"><div class="rg-fill" style="width:${Math.max(3, Math.min(100, pct))}%;background:${col}"></div><div class="rg-marker" style="left:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
  }

  global.GLUUI = { GlucoScope, agpChart, tirBar, lineChart, dayOverlay, distribution, fusionScatter, riskGauge, COLORS: C, BAND, CUT, disp: GluDisp };
  global.GluDisp = GluDisp;
})(window);

// ESM-MIGRATION Phase 1: the node's UI surface, consumed by glucodex-app.js via `import { GLUUI }`.
// (GluDisp/evBadge stay window globals — read there by the still-classic profile + app's other refs.)
export const GLUUI = window.GLUUI;
