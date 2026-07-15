/*
 * hrvdex-chart.js — minimal, dependency-free canvas chart engine for HRVDex
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * Drop-in replacement for the slice of the Chart.js API that HRVDex uses
 * (line / bar / scatter, multi-dataset, dual y-axis, band & area fill, stacked
 * bars, per-point colours/radii, categorical or numeric axes, legend). Renders
 * straight to the existing <canvas> elements via the native 2D context — no
 * third-party code, no network, no licence. Exposes `window.Chart` with a
 * constructor `new Chart(canvasOrCtx, config)` returning an instance with
 * `.destroy()/.update()/.resize()`, plus an assignable `Chart.defaults`.
 * This makes the suite 100% first-party (matches every other node's
 * hand-authored SVG charts; see THIRD-PARTY.md).
 */
(function (global) {
  'use strict';

  var TICK_FONT = "9px ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";
  var LEG_FONT = "10px ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";
  var GRID = 'rgba(30,45,66,0.6)';
  var TICKC = '#6e85a8';
  var registry = [];

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }
  function first(c) {
    return Array.isArray(c) ? c[0] || '#58A6FF' : c || '#58A6FF';
  }
  function at(c, i, d) {
    return Array.isArray(c) ? (c[i] != null ? c[i] : d) : c != null ? c : d;
  }
  function get(o, path, dflt) {
    var cur = o;
    for (var i = 0; i < path.length; i++) {
      if (cur == null) return dflt;
      cur = cur[path[i]];
    }
    return cur == null ? dflt : cur;
  }
  function fmt(v) {
    var a = Math.abs(v);
    if (a >= 1000) return Math.round(v).toString();
    if (a >= 100) return Math.round(v).toString();
    if (a >= 10) return Math.round(v).toString();
    if (a >= 1) return v.toFixed(1);
    if (a === 0) return '0';
    return v.toFixed(2);
  }
  // produce ~count "nice" tick values spanning [lo,hi]
  function ticks(lo, hi, count) {
    if (!(hi > lo)) {
      hi = lo + 1;
    }
    var span = hi - lo,
      step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = (count * step) / span;
    if (err <= 0.15) step *= 10;
    else if (err <= 0.35) step *= 5;
    else if (err <= 0.75) step *= 2;
    var out = [],
      start = Math.ceil(lo / step) * step;
    for (var t = start; t <= hi + step * 0.5; t += step) out.push(Math.round(t / step) * step);
    return out;
  }
  function range(datasets, pick) {
    var lo = Infinity,
      hi = -Infinity;
    datasets.forEach(function (d) {
      if (pick && !pick(d)) return;
      (d.data || []).forEach(function (v) {
        var n = v && typeof v === 'object' ? v.y : v;
        if (isNum(n)) {
          if (n < lo) lo = n;
          if (n > hi) hi = n;
        }
      });
    });
    if (lo === Infinity) {
      lo = 0;
      hi = 1;
    }
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    return [lo, hi];
  }

  function Chart(target, config) {
    if (!(this instanceof Chart)) return new Chart(target, config);
    var canvas = target && target.canvas ? target.canvas : target;
    if (!canvas || !canvas.getContext) {
      this._dead = true;
      return;
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.config = config || {};
    this._dead = false;
    this._pending = false;
    canvas._chart = this;
    var self = this;
    this._ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(function () {
        if (!self._dead) self._raf();
      });
      try {
        this._ro.observe(canvas.parentElement || canvas);
      } catch (e) {}
    }
    registry.push(this);
    this.draw();
  }

  Chart.defaults = { animation: false, color: TICKC, font: {} };

  Chart.prototype._raf = function () {
    var self = this;
    if (self._pending) return;
    self._pending = true;
    (global.requestAnimationFrame || setTimeout)(function () {
      self._pending = false;
      if (!self._dead) self.draw();
    });
  };
  Chart.prototype.update = function () {
    if (!this._dead) this.draw();
  };
  Chart.prototype.resize = function () {
    if (!this._dead) this.draw();
  };
  Chart.prototype.destroy = function () {
    this._dead = true;
    if (this._ro) {
      try {
        this._ro.disconnect();
      } catch (e) {}
      this._ro = null;
    }
    if (this.canvas && this.ctx) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (this.canvas._chart === this) this.canvas._chart = null;
    }
    var i = registry.indexOf(this);
    if (i >= 0) registry.splice(i, 1);
  };

  Chart.prototype.draw = function () {
    var canvas = this.canvas,
      ctx = this.ctx,
      cfg = this.config,
      opts = cfg.options || {};
    var data = cfg.data || {},
      datasets = data.datasets || [],
      labels = data.labels || [];
    var type = cfg.type || (datasets[0] && datasets[0].type) || 'line';

    var dpr = global.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 0;
    if (!cssW) return; // hidden card; ResizeObserver redraws once visible
    var cssH;
    if (opts.maintainAspectRatio === false) cssH = canvas.clientHeight || 220;
    else cssH = Math.max(150, Math.min(300, cssW / (type === 'scatter' ? 1.5 : 2)));
    canvas.style.width = '100%';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.textBaseline = 'alphabetic';

    // legend
    var leg = get(opts, ['plugins', 'legend'], {});
    var showLeg = leg.display !== false;
    var legColor = get(leg, ['labels', 'color'], Chart.defaults.color);
    var filt = get(leg, ['labels', 'filter'], null);
    var items = datasets.map(function (d, i) {
      return { text: d.label || 'Series ' + (i + 1), color: type === 'line' ? first(d.borderColor) : first(d.backgroundColor || d.borderColor) };
    });
    if (filt)
      items = items.filter(function (it) {
        try {
          return filt(it);
        } catch (e) {
          return true;
        }
      });

    var legH = 0,
      legRows = [];
    if (showLeg && items.length) {
      ctx.font = LEG_FONT;
      var row = [],
        w = 0,
        maxW = cssW - 8;
      items.forEach(function (it) {
        var iw = 14 + ctx.measureText(it.text).width + 14;
        if (w + iw > maxW && row.length) {
          legRows.push(row);
          row = [];
          w = 0;
        }
        row.push(it);
        w += iw;
      });
      if (row.length) legRows.push(row);
      legH = legRows.length * 16 + 6;
    }

    var hasY2 =
      datasets.some(function (d) {
        return d.yAxisID === 'y2';
      }) || !!get(opts, ['scales', 'y2'], null);
    var xTitle = get(opts, ['scales', 'x', 'title', 'display'], false) && get(opts, ['scales', 'x', 'title', 'text'], '');
    var yTitle = get(opts, ['scales', 'y', 'title', 'display'], false) && get(opts, ['scales', 'y', 'title', 'text'], '');
    var padL = yTitle ? 54 : 44,
      padR = hasY2 ? 46 : 14,
      padT = legH + 8,
      padB = xTitle ? 34 : 24;
    var X = padL,
      Y = padT,
      W = Math.max(10, cssW - padL - padR),
      H = Math.max(10, cssH - padT - padB);

    // draw legend
    if (legH) {
      ctx.font = LEG_FONT;
      ctx.textBaseline = 'middle';
      legRows.forEach(function (r, ri) {
        var tw = 0;
        ctx.font = LEG_FONT;
        r.forEach(function (it) {
          tw += 14 + ctx.measureText(it.text).width + 14;
        });
        var cx = (cssW - (tw - 14)) / 2;
        if (cx < 4) cx = 4;
        var cy = 8 + ri * 16 + 6;
        r.forEach(function (it) {
          ctx.fillStyle = it.color;
          ctx.fillRect(cx, cy - 4, 9, 9);
          ctx.fillStyle = legColor;
          ctx.textAlign = 'left';
          ctx.fillText(it.text, cx + 13, cy);
          cx += 14 + ctx.measureText(it.text).width + 14;
        });
      });
      ctx.textBaseline = 'alphabetic';
    }

    if (type === 'scatter') this._scatter(ctx, datasets, opts, X, Y, W, H, xTitle, yTitle);
    else if (type === 'bar') this._bar(ctx, datasets, labels, opts, X, Y, W, H, xTitle, yTitle);
    else this._line(ctx, datasets, labels, opts, X, Y, W, H, hasY2, xTitle, yTitle);
  };

  function axisGrid(ctx, X, Y, W, H, lo, hi, gridC, tickC, side, title) {
    var tk = ticks(lo, hi, 5);
    ctx.font = TICK_FONT;
    tk.forEach(function (v) {
      if (v < lo - (hi - lo) * 0.001 || v > hi + (hi - lo) * 0.001) return;
      var py = Y + H - ((v - lo) / (hi - lo)) * H;
      if (side === 'left') {
        ctx.strokeStyle = gridC;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(X, py + 0.5);
        ctx.lineTo(X + W, py + 0.5);
        ctx.stroke();
        ctx.fillStyle = tickC;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(fmt(v), X - 6, py);
      } else {
        ctx.fillStyle = tickC;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(fmt(v), X + W + 6, py);
      }
    });
    ctx.textBaseline = 'alphabetic';
    if (title && side === 'left') {
      ctx.save();
      ctx.translate(11, Y + H / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = tickC;
      ctx.textAlign = 'center';
      ctx.font = TICK_FONT;
      ctx.fillText(title, 0, 0);
      ctx.restore();
    }
  }

  Chart.prototype._line = function (ctx, datasets, labels, opts, X, Y, W, H, hasY2, xTitle, yTitle) {
    var gridC = get(opts, ['scales', 'y', 'grid', 'color'], GRID);
    var tickC = get(opts, ['scales', 'y', 'ticks', 'color'], TICKC);
    var n =
      labels.length ||
      Math.max.apply(
        null,
        datasets
          .map(function (d) {
            return (d.data || []).length;
          })
          .concat([1])
      );
    var rL = range(datasets, function (d) {
      return d.yAxisID !== 'y2';
    });
    var yMin = get(opts, ['scales', 'y', 'min'], null),
      yMax = get(opts, ['scales', 'y', 'max'], null);
    var lo = yMin != null ? yMin : rL[0] - (rL[1] - rL[0]) * 0.06;
    var hi = yMax != null ? yMax : rL[1] + (rL[1] - rL[0]) * 0.06;
    var rR = hasY2
      ? range(datasets, function (d) {
          return d.yAxisID === 'y2';
        })
      : null;
    var lo2 = rR ? rR[0] - (rR[1] - rR[0]) * 0.06 : 0,
      hi2 = rR ? rR[1] + (rR[1] - rR[0]) * 0.06 : 1;

    axisGrid(ctx, X, Y, W, H, lo, hi, gridC, tickC, 'left', yTitle);
    if (hasY2) axisGrid(ctx, X, Y, W, H, lo2, hi2, gridC, tickC, 'right', null);

    var xAt = function (i) {
      return n > 1 ? X + (i / (n - 1)) * W : X + W / 2;
    };
    var yAt = function (v, y2) {
      var a = y2 ? lo2 : lo,
        b = y2 ? hi2 : hi;
      return Y + H - ((v - a) / (b - a)) * H;
    };

    // x ticks
    var maxT = get(opts, ['scales', 'x', 'ticks', 'maxTicksLimit'], 8);
    var xC = get(opts, ['scales', 'x', 'ticks', 'color'], '#3d5070');
    ctx.font = TICK_FONT;
    ctx.fillStyle = xC;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var step = Math.max(1, Math.ceil(n / maxT));
    for (var i = 0; i < n; i += step) {
      if (labels[i] == null) continue;
      ctx.fillText(String(labels[i]), xAt(i), Y + H + 6);
    }
    ctx.textBaseline = 'alphabetic';
    if (xTitle) {
      ctx.fillStyle = tickC;
      ctx.textAlign = 'center';
      ctx.fillText(xTitle, X + W / 2, Y + H + 24);
    }

    function pts(d) {
      var y2 = d.yAxisID === 'y2',
        out = [];
      (d.data || []).forEach(function (v, i) {
        out.push(isNum(v) ? { x: xAt(i), y: yAt(v, y2), v: v } : null);
      });
      return out;
    }

    datasets.forEach(function (d, di) {
      var p = pts(d);
      // band fill to next dataset
      if (d.fill === '+1' && datasets[di + 1]) {
        var q = pts(datasets[di + 1]);
        ctx.beginPath();
        var started = false;
        for (var i = 0; i < p.length; i++) {
          if (!p[i]) continue;
          if (!started) {
            ctx.moveTo(p[i].x, p[i].y);
            started = true;
          } else ctx.lineTo(p[i].x, p[i].y);
        }
        for (var j = q.length - 1; j >= 0; j--) {
          if (!q[j]) continue;
          ctx.lineTo(q[j].x, q[j].y);
        }
        ctx.closePath();
        ctx.fillStyle = d.backgroundColor || 'rgba(120,120,120,0.1)';
        ctx.fill();
      } else if (d.fill === true) {
        ctx.beginPath();
        var s2 = false,
          fx0 = null,
          fx1 = null;
        for (var k = 0; k < p.length; k++) {
          if (!p[k]) continue;
          if (!s2) {
            ctx.moveTo(p[k].x, Y + H);
            ctx.lineTo(p[k].x, p[k].y);
            s2 = true;
            fx0 = p[k].x;
          } else ctx.lineTo(p[k].x, p[k].y);
          fx1 = p[k].x;
        }
        if (s2) {
          ctx.lineTo(fx1, Y + H);
          ctx.closePath();
          ctx.fillStyle = d.backgroundColor || 'rgba(120,120,120,0.1)';
          ctx.fill();
        }
      }
      // stroke
      ctx.lineWidth = d.borderWidth || 1.5;
      ctx.strokeStyle = d.borderColor || '#58A6FF';
      ctx.setLineDash(d.borderDash || []);
      ctx.beginPath();
      var pen = false;
      for (var m = 0; m < p.length; m++) {
        if (!p[m]) {
          pen = false;
          continue;
        }
        if (!pen) {
          ctx.moveTo(p[m].x, p[m].y);
          pen = true;
        } else ctx.lineTo(p[m].x, p[m].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // points
      var prDef = get(opts, ['elements', 'point', 'radius'], 2);
      for (var z = 0; z < p.length; z++) {
        if (!p[z]) continue;
        var pr = at(d.pointRadius, z, d.pointRadius != null ? d.pointRadius : prDef);
        if (!pr) continue;
        ctx.fillStyle = at(d.pointBackgroundColor, z, d.borderColor || '#58A6FF');
        ctx.beginPath();
        ctx.arc(p[z].x, p[z].y, pr, 0, 6.2832);
        ctx.fill();
      }
    });
  };

  Chart.prototype._bar = function (ctx, datasets, labels, opts, X, Y, W, H, xTitle, yTitle) {
    var gridC = get(opts, ['scales', 'y', 'grid', 'color'], GRID);
    var tickC = get(opts, ['scales', 'y', 'ticks', 'color'], TICKC);
    var stacked =
      get(opts, ['scales', 'x', 'stacked'], false) ||
      datasets.some(function (d) {
        return d.stack;
      });
    var n = labels.length || (datasets[0] && datasets[0].data.length) || 1;

    var lo, hi;
    var yMin = get(opts, ['scales', 'y', 'min'], null),
      yMax = get(opts, ['scales', 'y', 'max'], null);
    if (stacked) {
      var sums = [];
      for (var i = 0; i < n; i++) {
        var s = 0;
        datasets.forEach(function (d) {
          var v = d.data[i];
          if (isNum(v)) s += v;
        });
        sums.push(s);
      }
      lo = Math.min(0, Math.min.apply(null, sums));
      hi = Math.max(0, Math.max.apply(null, sums));
    } else {
      var r = range(datasets, null);
      lo = Math.min(0, r[0]);
      hi = Math.max(0, r[1]);
    }
    if (yMin != null) lo = yMin;
    if (yMax != null) hi = yMax;
    if (lo === hi) hi = lo + 1;

    axisGrid(ctx, X, Y, W, H, lo, hi, gridC, tickC, 'left', yTitle);
    var yAt = function (v) {
      return Y + H - ((v - lo) / (hi - lo)) * H;
    };
    var band = W / n,
      base = yAt(lo);

    var xC = get(opts, ['scales', 'x', 'ticks', 'color'], '#3d5070');
    var maxT = get(opts, ['scales', 'x', 'ticks', 'maxTicksLimit'], 8);
    ctx.font = TICK_FONT;
    ctx.fillStyle = xC;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var step = Math.max(1, Math.ceil(n / maxT));
    for (var t = 0; t < n; t += step) {
      if (labels[t] == null) continue;
      ctx.fillText(String(labels[t]), X + band * (t + 0.5), Y + H + 6);
    }
    ctx.textBaseline = 'alphabetic';
    if (xTitle) {
      ctx.fillStyle = tickC;
      ctx.textAlign = 'center';
      ctx.fillText(xTitle, X + W / 2, Y + H + 24);
    }

    if (stacked) {
      var acc = new Array(n).fill(0);
      datasets.forEach(function (d) {
        var bw = band * 0.7,
          off = (band - bw) / 2;
        for (var i = 0; i < n; i++) {
          var v = d.data[i];
          if (!isNum(v)) continue;
          var y0 = yAt(acc[i]),
            y1 = yAt(acc[i] + v);
          ctx.fillStyle = at(d.backgroundColor, i, 'rgba(88,166,255,0.7)');
          ctx.fillRect(X + band * i + off, Math.min(y0, y1), bw, Math.abs(y1 - y0));
          acc[i] += v;
        }
      });
    } else {
      var nd = datasets.length,
        bw2 = (band * 0.7) / nd;
      datasets.forEach(function (d, di) {
        for (var i = 0; i < n; i++) {
          var v = d.data[i];
          if (!isNum(v)) continue;
          var x0 = X + band * i + band * 0.15 + di * bw2,
            yv = yAt(v);
          ctx.fillStyle = at(d.backgroundColor, i, 'rgba(88,166,255,0.7)');
          ctx.fillRect(x0, Math.min(base, yv), bw2, Math.abs(yv - base));
          if (d.borderWidth) {
            ctx.lineWidth = d.borderWidth;
            ctx.strokeStyle = at(d.borderColor, i, 'rgba(88,166,255,1)');
            ctx.strokeRect(x0, Math.min(base, yv), bw2, Math.abs(yv - base));
          }
        }
      });
    }
  };

  Chart.prototype._scatter = function (ctx, datasets, opts, X, Y, W, H, xTitle, yTitle) {
    var gridC = get(opts, ['scales', 'y', 'grid', 'color'], 'rgba(48,54,61,0.5)');
    var tickC = get(opts, ['scales', 'y', 'ticks', 'color'], TICKC);
    var xC = get(opts, ['scales', 'x', 'ticks', 'color'], '#3d5070');
    var xs = [],
      ys = [];
    datasets.forEach(function (d) {
      (d.data || []).forEach(function (p) {
        if (p && isNum(p.x) && isNum(p.y)) {
          xs.push(p.x);
          ys.push(p.y);
        }
      });
    });
    if (!xs.length) {
      xs = [0, 1];
      ys = [0, 1];
    }
    var xlo = get(opts, ['scales', 'x', 'min'], null),
      xhi = get(opts, ['scales', 'x', 'max'], null);
    var ylo = get(opts, ['scales', 'y', 'min'], null),
      yhi = get(opts, ['scales', 'y', 'max'], null);
    xlo = xlo != null ? xlo : Math.min.apply(null, xs);
    xhi = xhi != null ? xhi : Math.max.apply(null, xs);
    ylo = ylo != null ? ylo : Math.min.apply(null, ys);
    yhi = yhi != null ? yhi : Math.max.apply(null, ys);
    if (xlo === xhi) {
      xlo -= 1;
      xhi += 1;
    }
    if (ylo === yhi) {
      ylo -= 1;
      yhi += 1;
    }
    var px = (xhi - xlo) * 0.06,
      py = (yhi - ylo) * 0.06;
    xlo -= px;
    xhi += px;
    ylo -= py;
    yhi += py;

    axisGrid(ctx, X, Y, W, H, ylo, yhi, gridC, tickC, 'left', yTitle);
    var xtk = ticks(xlo, xhi, 5);
    ctx.font = TICK_FONT;
    ctx.fillStyle = xC;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var xAt = function (v) {
      return X + ((v - xlo) / (xhi - xlo)) * W;
    };
    var yAt = function (v) {
      return Y + H - ((v - ylo) / (yhi - ylo)) * H;
    };
    xtk.forEach(function (v) {
      if (v < xlo || v > xhi) return;
      ctx.fillText(fmt(v), xAt(v), Y + H + 6);
    });
    ctx.textBaseline = 'alphabetic';
    if (xTitle) {
      ctx.fillStyle = tickC;
      ctx.textAlign = 'center';
      ctx.fillText(xTitle, X + W / 2, Y + H + 24);
    }

    datasets.forEach(function (d) {
      var r = d.pointRadius || 4;
      (d.data || []).forEach(function (p, i) {
        if (!p || !isNum(p.x) || !isNum(p.y)) return;
        ctx.fillStyle = at(d.backgroundColor, i, 'rgba(34,211,238,0.7)');
        ctx.beginPath();
        ctx.arc(xAt(p.x), yAt(p.y), r, 0, 6.2832);
        ctx.fill();
        if (d.borderColor) {
          ctx.lineWidth = 1;
          ctx.strokeStyle = at(d.borderColor, i, 'rgba(34,211,238,1)');
          ctx.stroke();
        }
      });
    });
  };

  if (!Math.log10)
    Math.log10 = function (x) {
      return Math.log(x) / Math.LN10;
    };
  global.Chart = Chart;
})(typeof window !== 'undefined' ? window : this);
