// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const DexClock = require('/run/media/michal/647A504F7A50205A/wt-knownclock/clock.js');
const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
const hostMsOf = (s) => {
  const m = ISO.exec(s.trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0) : null;
};
const o2 = readFileSync('/tmp/kc/Wellue_O2Ring-S_S8AW2100_20260813231713_PMDARRIVAL.csv', 'utf8')
  .split('\n')
  .slice(1)
  .filter(Boolean)
  .map((L) => L.split(';'))
  .filter((c) => c.length >= 4)
  .map((c) => ({ hostMs: hostMsOf(c[0]), devMs: Number(c[3]) / 1e6 }))
  .filter((x) => x.hostMs !== null && isFinite(x.devMs));

// find the reset and take the LONGEST monotonic run
let runs = [],
  cur = [o2[0]];
for (let i = 1; i < o2.length; i++) {
  if (o2[i].devMs >= o2[i - 1].devMs) cur.push(o2[i]);
  else {
    runs.push(cur);
    cur = [o2[i]];
  }
}
runs.push(cur);
runs.sort((a, b) => b.length - a.length);
const seg = runs[0];
console.log(`monotonic runs: ${runs.length}  longest=${seg.length} of ${o2.length} packets`);
const hS = seg[seg.length - 1].hostMs - seg[0].hostMs,
  dS = seg[seg.length - 1].devMs - seg[0].devMs;
console.log(`  segment host span ${(hS / 1000).toFixed(1)} s   dev span ${(dS / 1000).toFixed(1)} s   ratio ${(dS / hS).toFixed(6)}`);
const raw = DexClock.hostAxis(seg);
console.log('  as-is            :', raw.ok ? `ok ppm=${raw.ppm.toFixed(1)} spread=${raw.spreadMs.toFixed(1)} independent=${raw.independent}` : `REFUSED ${raw.reason}`);

// THE TEST: force the RATE plausible, leave the 1 s quantisation (the drawnness) intact.
const d0 = seg[0].devMs;
const scaled = seg.map((x) => ({ hostMs: x.hostMs, devMs: d0 + (x.devMs - d0) * (hS / dS) }));
const r = DexClock.hostAxis(scaled);
console.log('  rate-normalised  :', r.ok ? `ok ppm=${r.ppm.toFixed(2)}  spreadMs=${r.spreadMs.toFixed(1)}  independent=${r.independent}` : `REFUSED ${r.reason}`);
if (r.ok) console.log(`  >>> VERDICT: ${r.independent ? 'FALSE POSITIVE — a 1 s-quantised DRAWN counter is reported as an independent second clock.' : 'correctly reported independent:false'}`);

// drawn-share of this segment, the quantity ppgdex-dsp gates at >=99%
const dd = [];
for (let i = 1; i < seg.length; i++) dd.push(seg[i].devMs - seg[i - 1].devMs);
const t = new Map();
dd.forEach((v) => t.set(v, (t.get(v) || 0) + 1));
const top = [...t.entries()].sort((a, b) => b[1] - a[1])[0];
console.log(`  modal delta ${top[0]} ms  share ${((top[1] / dd.length) * 100).toFixed(2)} %  (drawn detector fires at >=99%)`);
