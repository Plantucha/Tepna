#!/usr/bin/env node
/*
 * tools/pat-buzz-stability.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE MEASUREMENT THE ΔPAT DIP INDEX NEEDS AND THE SIDECAR CANNOT GIVE:
 *   is the cross-device timing offset CONSTANT within a connection?
 *
 * WHY THIS TOOL EXISTS. The relative-PAT dip index (PAT-RELATIVE-REFRAME) rests on one assumption stated
 * at pat-align.js:335 — the per-connection BLE offset is constant within a connection, so a within-
 * connection *difference* (a dip) cancels it. `pat-connection-stability.mjs` tries to test that from the
 * arrival sidecar by splitting a connection in half, but the corpus yields only 2 scorable connections
 * (they disagree 2.7×) because connections fragment. A commanded APERIODIC buzz settles it directly: it
 * is one mechanical event both devices record, immune to the BLE scheduler and to beat pairing. Fire a
 * schedule within ONE connection; each buzz gives an independent cross-device offset; the SPREAD of those
 * offsets over the ~20 s IS the within-connection stability the dip index needs.
 *
 * Both device streams are HOST-stamped from the SAME host clock, so a buzz at real time T lands at
 * T+delay_A in device A and T+delay_B in device B; offset = delay_A − delay_B is exactly the inter-device
 * timing error, and its drift across the buzz sequence is the instability. A stable offset (small spread)
 * says the dip assumption holds for that connection; a drifting one localises how much of the sub-chance
 * dip result is a real clock defect vs beat-detection noise.
 *
 * Usage: node tools/pat-buzz-stability.mjs --a <H10_ACC.txt> --b <ring_PPG2W.txt> [--tol 0.5]
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};

/** PSL/PPG2W stamp `YYYY-MM-DDThh:mm:ss.mmm` → floating seconds (Clock Contract). PURE. */
export function parseHostS(s) {
  const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})/.exec(s || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) / 1000 : null;
}

/** Median of a numeric array. PURE. null when empty. */
export function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Rising-edge onsets: the leading edge of each run where the signal exceeds a data-driven level after
 *  being quiet, with a refractory gap. series: [{t, v}] (v >= 0, a buzz-energy signal). PURE.
 *  Level = median + `k`·(max − median): a still baseline is ~0, so this is forgiving; a buzz spikes it. */
export function detectOnsets(series, { k = 0.35, refractoryS = 0.5 } = {}) {
  if (series.length === 0) return [];
  const v = series.map((r) => r.v);
  const sorted = [...v].sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  const max = sorted[sorted.length - 1];
  const level = med + k * (max - med);
  const onsets = [];
  let armed = true;
  let last = -Infinity;
  for (const r of series) {
    if (armed && r.v > level && r.t - last >= refractoryS) {
      onsets.push(r.t);
      last = r.t;
      armed = false;
    } else if (!armed && r.v <= level) {
      armed = true;
    }
  }
  return onsets;
}

/** Pair each onset in A with the NEAREST onset in B within `tolS`; the offset is a − b. Because both
 *  streams share the host clock, a well-aligned pair's offset is small; the SPREAD over the sequence is
 *  the within-connection instability. Unpaired onsets (a buzz one device missed) are dropped, not forced.
 *  Returns [{a, b, offset}]. PURE. */
export function crossDeviceOffsets(onsetsA, onsetsB, tolS = 0.5) {
  const out = [];
  for (const a of onsetsA) {
    let best = null;
    let bestD = Infinity;
    for (const b of onsetsB) {
      const d = Math.abs(a - b);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (best !== null && bestD <= tolS) out.push({ a, b: best, offset: a - best });
  }
  return out;
}

/** The verdict: median offset (the per-connection level, which a dip cancels) and its SPREAD (the
 *  within-connection instability, which a dip does NOT cancel). `stable` when the spread sits under the
 *  arousal dip it must not swamp (~15 ms) — the reframe's own budget. PURE. null when < 2 paired buzzes:
 *  a spread needs at least two points, and one point is a level, not a stability. */
export function stabilityReport(matches, { arousalDipMs = 15 } = {}) {
  if (matches.length < 2) return null;
  const offs = matches.map((m) => m.offset);
  const s = [...offs].sort((a, b) => a - b);
  const spreadMs = (s[s.length - 1] - s[0]) * 1000;
  return {
    n: matches.length,
    medianOffsetMs: median(offs) * 1000,
    spreadMs,
    stable: spreadMs <= arousalDipMs,
    arousalDipMs
  };
}

/** Read a PPG2W-format capture → [{t, v}] using the motion column (index 4) as the buzz-energy signal. */
export function readPpg2wMotion(path) {
  const L = fs.readFileSync(path, 'utf8').trim().split('\n').slice(1);
  const out = [];
  for (const ln of L) {
    const p = ln.split(';');
    const t = parseHostS(p[0]);
    const v = Math.abs(Number(p[4]));
    if (t != null && Number.isFinite(v)) out.push({ t, v });
  }
  return out;
}

/** Read a Polar ACC-format capture → [{t, v}] where v is a high-passed acceleration-magnitude ENERGY (a
 *  buzz is a high-frequency vibration; gravity is DC and is removed by differencing consecutive samples).
 *  The physical coupling (ring touching the H10 pod) is what puts the buzz into this stream at all. */
export function readAccEnergy(path) {
  const L = fs.readFileSync(path, 'utf8').trim().split('\n').slice(1);
  const rows = [];
  for (const ln of L) {
    const p = ln.split(';');
    const t = parseHostS(p[0]);
    const x = Number(p[2]),
      y = Number(p[3]),
      z = Number(p[4]);
    if (t != null && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      rows.push({ t, mag: Math.sqrt(x * x + y * y + z * z) });
    }
  }
  const out = [];
  for (let i = 1; i < rows.length; i++) out.push({ t: rows[i].t, v: Math.abs(rows[i].mag - rows[i - 1].mag) });
  return out;
}

function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (nm, c, d = '') => {
    c ? (pass++, console.log(`  ok   ${nm}`)) : (fail++, console.log(`  FAIL ${nm}${d ? ' — ' + d : ''}`));
  };

  ok('parseHostS floating seconds', Math.abs(parseHostS('2026-08-19T23:39:09.065') - Date.UTC(2026, 7, 19, 23, 39, 9, 65) / 1000) < 1e-9);
  ok('parseHostS rejects junk', parseHostS('x') === null);
  ok('median of evens averages', median([1, 3, 5, 7]) === 4);
  ok('median empty → null', median([]) === null);

  // build two device signals: aperiodic buzzes, device B offset from A by OFF, with optional drift
  const build = (buzzTimes, offsets) => {
    const A = [],
      B = [];
    for (let t = 0; t < 40; t += 0.01) {
      let a = 0,
        b = 0;
      buzzTimes.forEach((c, i) => {
        if (t >= c && t < c + 1.1) a = 20;
        const cb = c + offsets[i];
        if (t >= cb && t < cb + 1.1) b = 20;
      });
      A.push({ t, v: a });
      B.push({ t, v: b });
    }
    return { A, B };
  };
  const buzz = [10, 12.5, 16.5, 19.5, 25.5]; // gaps 2.5,4,3,6 — all > 1.1 s buzz width, aperiodic
  // STABLE: constant 40 ms offset → spread ~0 → stable
  {
    const { A, B } = build(
      buzz,
      buzz.map(() => 0.04)
    );
    const m = crossDeviceOffsets(detectOnsets(A), detectOnsets(B), 0.5);
    ok('every buzz is paired across the two devices', m.length === buzz.length, `got ${m.length}`);
    const r = stabilityReport(m);
    ok('a constant offset reads as its level', Math.abs(r.medianOffsetMs - -40) < 5, `${r.medianOffsetMs?.toFixed(1)}`);
    ok('a constant offset is STABLE (spread ≪ 15 ms)', r.stable === true && r.spreadMs < 5, JSON.stringify(r));
  }
  // DRIFTING: offset ramps 0 → 80 ms across the sequence → spread ~80 ms → NOT stable (the sub-chance cause)
  {
    const offs = buzz.map((_c, i) => (i / (buzz.length - 1)) * 0.08);
    const { A, B } = build(buzz, offs);
    const r = stabilityReport(crossDeviceOffsets(detectOnsets(A), detectOnsets(B), 0.5));
    ok('a within-connection drift is DETECTED', r.stable === false && r.spreadMs > 60, JSON.stringify(r));
  }
  // CONTROL: a device that saw no buzz → no pairs → null verdict (never a false "stable")
  {
    const { A } = build(
      buzz,
      buzz.map(() => 0)
    );
    const flat = A.map((r) => ({ t: r.t, v: 0 }));
    ok('one silent device → no pairs → null (not a false stable)', stabilityReport(crossDeviceOffsets(detectOnsets(A), detectOnsets(flat), 0.5)) === null);
  }
  // CONTROL: an unpaired buzz beyond tol is dropped, not force-matched
  ok('an onset with no partner within tol is dropped', crossDeviceOffsets([10], [12], 0.5).length === 0);
  // a single paired buzz is a LEVEL, not a stability → null
  ok('one paired buzz → null (a spread needs two)', stabilityReport(crossDeviceOffsets([10], [10.04], 0.5)) === null);

  console.log(fail ? `\n${fail} FAILURE(S)` : `\n${pass} assertions — all green`);
  return fail ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  const aP = arg('--a'),
    bP = arg('--b');
  if (!aP || !bP) {
    console.log('usage: --a <H10_ACC.txt> --b <ring_PPG2W.txt> [--tol 0.5]');
    process.exit(2);
  }
  const tol = Number(arg('--tol') || 0.5);
  const A = detectOnsets(readAccEnergy(aP));
  const B = detectOnsets(readPpg2wMotion(bP));
  console.log(`  device A (ACC): ${A.length} buzz onset(s) · device B (motion): ${B.length}`);
  const matches = crossDeviceOffsets(A, B, tol);
  const r = stabilityReport(matches);
  if (!r) {
    console.log(`  ✗ fewer than 2 paired buzzes (${matches.length}) — cannot measure stability. Was the buzz`);
    console.log(`    fired into BOTH devices (ring touching the H10 pod), aperiodic, within one connection?`);
    process.exit(1);
  }
  console.log(`  cross-device offsets (ms): ${matches.map((m) => (m.offset * 1000).toFixed(0)).join(', ')}`);
  console.log(`  median offset ${r.medianOffsetMs.toFixed(1)} ms · WITHIN-CONNECTION SPREAD ${r.spreadMs.toFixed(1)} ms (n=${r.n})`);
  console.log(
    r.stable
      ? `  ✓ STABLE — spread ≤ the ${r.arousalDipMs} ms arousal dip; the dip index's constancy assumption holds here.`
      : `  ✗ UNSTABLE — spread > the ${r.arousalDipMs} ms arousal dip; a dip would be swamped. This is a real clock defect, not beat noise.`
  );
}
