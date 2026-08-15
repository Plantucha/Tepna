// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const req = createRequire('/run/media/michal/647A504F7A50205A/wt-knownclock/x.js');
const C = req('/run/media/michal/647A504F7A50205A/wt-knownclock/clock.js');
const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
const hs = (s) => {
  const m = ISO.exec(s.trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0) : null;
};
function* files(root) {
  for (const d of readdirSync(root).sort()) {
    const p = join(root, d);
    if (statSync(p).isDirectory()) for (const f of readdirSync(p).sort()) if (f.endsWith('_PMDARRIVAL.csv')) yield join(p, f);
  }
}
const mono = (a) => {
  let b = [],
    c = a.length ? [a[0]] : [];
  for (let i = 1; i < a.length; i++) {
    if (a[i].devMs >= a[i - 1].devMs) c.push(a[i]);
    else {
      if (c.length > b.length) b = c;
      c = [a[i]];
    }
  }
  return c.length > b.length ? c : b;
};
const SPANS = [300, 600, 1200, 2400, 4800, 9600, 19200, 28800]; // s — 2400 is the shipped ECGDex gate
const rows = [];
for (const f of files('/tmp/kc-corpus')) {
  const dev = /O2Ring/i.test(f) ? 'O2Ring' : /Verity/i.test(f) ? 'Verity' : /H10/i.test(f) ? 'H10' : 'other';
  if (dev === 'O2Ring') continue; // drawn axis — not a clock, excluded by construction
  const byM = new Map();
  for (const ln of readFileSync(f, 'utf8').split('\n').slice(1)) {
    const c = ln.split(';');
    if (c.length < 4) continue;
    const h = hs(c[0]),
      n = Number(c[3]);
    if (h === null || !isFinite(n)) continue;
    (byM.get(c[2]) ?? byM.set(c[2], []).get(c[2])).push({ hostMs: h, devMs: n / 1e6 });
  }
  for (const [meas, raw] of byM) {
    if (meas === 'ppi') continue; // 100 % drawn (measured)
    const a = mono(raw);
    if (a.length < 200) continue;
    const full = (a[a.length - 1].devMs - a[0].devMs) / 1000;
    if (full < SPANS[0]) continue;
    for (const S of SPANS) {
      if (full < S) continue;
      const t0 = a[0].devMs,
        sub = a.filter((x) => x.devMs - t0 <= S * 1000);
      if (sub.length < 50) continue;
      const r = C.hostAxis(sub);
      if (!r.ok || !r.stability) continue;
      rows.push({ dev, meas, spanS: S, n: sub.length, ppm: r.ppm, sig: r.stability.ppmUncertainty, resolved: Math.abs(r.ppm) > r.stability.ppmUncertainty });
    }
  }
}
writeFileSync('/tmp/span-sweep.json', JSON.stringify(rows));
const q = (x, p) => {
  const s = [...x].sort((u, v) => u - v);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
console.log(`within-stream truncation sweep — ${rows.length} (stream,span) points, O2Ring + ppi excluded\n`);
console.log('span      n   med|ppm|   med sigma_y   med ratio   RESOLVED');
for (const S of SPANS) {
  const s = rows.filter((r) => r.spanS === S);
  if (!s.length) continue;
  const rat = s.map((r) => Math.abs(r.ppm) / r.sig);
  const res = s.filter((r) => r.resolved).length;
  const mark = S === 2400 ? '  <-- shipped ECGDex gate' : '';
  console.log(
    `${String(S).padStart(5)}s ${String(s.length).padStart(4)} ${q(
      s.map((r) => Math.abs(r.ppm)),
      0.5
    )
      .toFixed(2)
      .padStart(9)} ${q(
      s.map((r) => r.sig),
      0.5
    )
      .toFixed(2)
      .padStart(13)} ${q(rat, 0.5).toFixed(3).padStart(11)} ${((res / s.length) * 100).toFixed(0).padStart(8)}%${mark}`
  );
}
console.log('\nper device:');
for (const d of ['H10', 'Verity']) {
  console.log(` ${d}:`);
  for (const S of SPANS) {
    const s = rows.filter((r) => r.spanS === S && r.dev === d);
    if (s.length < 3) continue;
    console.log(
      `   ${String(S).padStart(5)}s n=${String(s.length).padStart(3)}  resolved ${((s.filter((r) => r.resolved).length / s.length) * 100).toFixed(0).padStart(3)}%  med sigma_y=${q(
        s.map((r) => r.sig),
        0.5
      ).toFixed(1)} ppm`
    );
  }
}
