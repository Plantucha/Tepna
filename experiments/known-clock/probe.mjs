// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const DexClock = require('/run/media/michal/647A504F7A50205A/wt-knownclock/clock.js');
const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
const hostMsOf = s => { const m = ISO.exec(s.trim()); return m ? Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6], m[7]?+m[7].padEnd(3,'0'):0) : null; };
const load = (f, mf) => readFileSync(f,'utf8').split('\n').slice(1).filter(Boolean).map(L=>L.split(';'))
  .filter(c=>c.length>=4 && (!mf||c[2]===mf)).map(c=>({hostMs:hostMsOf(c[0]), devMs:Number(c[3])/1e6}))
  .filter(x=>x.hostMs!==null && isFinite(x.devMs));

// ── A · why does the O2Ring read -1,000,074 ppm? ────────────────────────────
const o2 = load('/tmp/kc/Wellue_O2Ring-S_S8AW2100_20260813231713_PMDARRIVAL.csv', null);
const hSpan = o2[o2.length-1].hostMs - o2[0].hostMs;
const dSpan = o2[o2.length-1].devMs - o2[0].devMs;
console.log('O2RING');
console.log('  host span   ', (hSpan/1000).toFixed(1), 's');
console.log('  dev  span   ', (dSpan/1000).toFixed(1), 's   <-- the "clock"');
console.log('  dev/host    ', (dSpan/hSpan).toFixed(6));
const dd = [];
for (let i=1;i<o2.length;i++) dd.push(o2[i].devMs - o2[i-1].devMs);
const tally = new Map(); dd.forEach(v=>tally.set(v,(tally.get(v)||0)+1));
const top = [...tally.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
console.log('  modal dev deltas (ms:count):', top.map(([k,v])=>`${k}:${v}`).join('  '));
console.log('  modal share ', (top[0][1]/dd.length*100).toFixed(1), '%  <-- >=99% == DRAWN axis');

// ── B · THE HYPOTHESIS: if the rate were merely PLAUSIBLE, would `independent`
//        wave the drawn axis through? Rescale dev so ppm lands in-bound.
console.log('\nO2RING rescaled so the RATE is plausible (drawnness untouched):');
const d0 = o2[0].devMs;
for (const k of [1.0000, 0.9999]) {
  // map dev span onto host span => rate ~0 ppm, quantisation preserved
  const scaled = o2.map(x => ({ hostMs: x.hostMs, devMs: d0 + (x.devMs - d0) * (hSpan/dSpan) * k }));
  const r = DexClock.hostAxis(scaled);
  console.log(`  k=${k}  ` + (r.ok
    ? `ok:true  ppm=${r.ppm.toFixed(1)}  spreadMs=${r.spreadMs.toFixed(1)}  independent=${r.independent}  <-- ${r.independent?'FALSE POSITIVE on a non-clock':'correctly refused'}`
    : `ok:false ${r.reason}`));
}

// ── C · why did P4-loss bias Verity (+6.5 ppm) but not H10 (-0.6)? ──────────
console.log('\nP4-LOSS mechanism — is the stride aliasing against packet structure?');
for (const [nm, f, mf] of [['H10','/tmp/kc/Polar_H10_02849638_20260813231740_PMDARRIVAL.csv','ecg'],
                           ['Verity','/tmp/kc/Polar_VeritySense_0C301E3F_20260813231725_PMDARRIVAL.csv','ppg']]) {
  const a = load(f, mf);
  const base = DexClock.hostAxis(a).ppm;
  const out = [];
  // structured (stride) vs spread-out deterministic thinning at the same 30% rate
  const stride = a.filter((_,i)=> i%10 >= 3);
  const golden = a.filter((_,i)=> ((i*7)%10) >= 3);        // same count, different phase pattern
  const headTail = a.filter((_,i)=> !(i > a.length*0.35 && i < a.length*0.65)); // contiguous 30% gap
  out.push(['stride i%10>=3', stride], ['reordered phase', golden], ['contiguous mid-gap', headTail]);
  console.log(`  ${nm}  base=${base.toFixed(3)} ppm`);
  for (const [lbl, set] of out) {
    const r = DexClock.hostAxis(set);
    console.log(`    ${lbl.padEnd(20)} n=${String(set.length).padStart(6)}  ppm=${r.ppm.toFixed(3)}  dppm=${(r.ppm-base).toFixed(3)}`);
  }
}
