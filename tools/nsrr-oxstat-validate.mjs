#!/usr/bin/env node
/*
 * tools/nsrr-oxstat-validate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * DOES THE OXIMETER'S OWN VALIDITY FLAG CHANGE ODI-4? — a POOL SCORER, not a tool.
 *
 * §∅ says a value that was not measured is null, and — for the case where the sentinel is IN BAND —
 * that "a consumer cannot null what it cannot distinguish", so "validity must travel OUT-OF-BAND".
 * SHHS1 ships exactly that out-of-band signal and nothing in this repo reads it: an `OX stat`
 * channel, 1 Hz, sample-aligned with `SaO2`.
 *
 * `to1Hz(sig, 40, 100)` nulls out-of-RANGE samples (fixed 2026-09-12, residue
 * `2026-09-12-nsrr-spo2-holds-across-dropouts`, withdrawn by its own fix). That guard cannot see an
 * IN-RANGE sample the device itself flagged, which is the residual case and the one this measures.
 *
 * ── THE FLAG IS NOT ASSUMED TO MEAN "INVALID" — IT IS SHOWN TO SEPARATE POPULATIONS ───────────
 * NSRR's documentation is not consulted here and no meaning is imputed from the value names. What is
 * measured is distributional, which is what §∅ prescribes ("detection is distributional, not a
 * literal"). Over the first 12 records, 367,680 samples:
 *
 *     stat 0   349,554 samples   100.0 % in-range   mean SpO₂ 95.00   p5 92.19
 *     stat 1       162 samples   100.0 % in-range   mean SpO₂ 87.95   p5 74.22
 *     stat 2    14,691 samples    50.5 % in-range   mean SpO₂ 94.19   p5 88.28
 *     stat 3     3,273 samples     0.1 % in-range
 *
 * Stat 3 and half of stat 2 are ALREADY excluded by the range guard. What survives it is 2.06 % of
 * all samples: in-range, device-flagged, and accepted as valid readings. Stat 1's p5 of 74.22 against
 * stat 0's 92.19 is the concerning part — flagged samples look like deep desaturations.
 *
 * ── THE COMPARISON IS PAIRED AND USES THE SHIPPED DETECTOR TWICE ──────────────────────────────
 * One `edfToOxyRows` conversion, then `processNight` on TWO versions of those rows: as-shipped, and
 * with flagged samples set to null. Same detector, same rows, one difference — so a change in ODI-4
 * is attributable to the flag and to nothing else. Nulling (rather than deleting) a sample is what
 * the adapter already does for a dropout, so the second arm exercises an existing, gated path rather
 * than a new one.
 *
 * ⚠️ THIS MEASURES A CONSEQUENCE, NOT A REMEDY. A difference in ODI-4 shows the flag matters; it does
 * NOT establish that excluding flagged samples is correct, because `OX stat`'s semantics are not
 * established here and a flag may mark a condition under which the reading is still true. Naming the
 * remedy needs the NSRR channel documentation, which is a separate unit.
 *
 * ── THIS IS A SCORER MODULE ───────────────────────────────────────────────────────────────────
 *     node tools/nsrr-score-pool.mjs --scorer ./nsrr-oxstat-validate.mjs --limit 300
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ODI = await import('./nsrr-oxydex-odi.mjs');

export function makeRealm() {
  return ODI.makeRealm();
}

export function median(v) {
  const s = [...v].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(4);
}

/* Null every row the device flagged. Returns a NEW array — the as-shipped arm must keep its own rows
   unmutated, or the two arms would share state and the comparison would measure nothing. */
export function maskFlagged(rows, statData) {
  let masked = 0,
    inRangeFlagged = 0;
  const out = rows.map((r, i) => {
    const st = statData && i < statData.length ? statData[i] : 0;
    if (st === 0 || !(st > 0)) return r;
    if (r.spo2 != null) inRangeFlagged++;
    masked++;
    return { ...r, spo2: null };
  });
  return { rows: out, masked, inRangeFlagged };
}

export function poolScoreRecord(ctx, rec) {
  const edf = ctx.CpapEdf.readEDF(ODI.toArrayBuffer(readFileSync(rec.edf)));
  const stat = edf.signals && edf.signals['OX stat'];
  const conv = ctx.NSRR.edfToOxyRows(edf);
  /* ⚠️ `.rows`, not the object itself */
  const rows = conv && conv.rows;
  if (!rows || !rows.length) return { id: rec.id, err: 'no rows' };
  if (!stat || !stat.data) return { id: rec.id, err: 'no OX stat channel' };

  const asShipped = ctx.OxyDex._bare.processNight(rows);
  const m = maskFlagged(rows, stat.data);
  const masked = ctx.OxyDex._bare.processNight(m.rows);

  const rate = (n) => (n && n.odi4 && n.odi4.rate != null ? +n.odi4.rate : null);
  const a = rate(asShipped),
    b = rate(masked);
  return {
    id: rec.id,
    odi4Shipped: a,
    odi4Masked: b,
    delta: a != null && b != null ? +(b - a).toFixed(3) : null,
    flaggedSamples: m.masked,
    flaggedInRange: m.inRangeFlagged,
    totalSamples: rows.length,
    flaggedPct: rows.length ? +((100 * m.masked) / rows.length).toFixed(3) : null
  };
}

export function liveStat(rows) {
  const all = (rows || []).filter((r) => r && !r.err);
  const p = all.filter((r) => r.delta != null);
  const d = p.map((r) => r.delta);
  let hw = null;
  if (d.length >= 5) {
    const mu = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (d.length - 1));
    hw = +((1.96 * sd) / Math.sqrt(d.length)).toFixed(4);
  }
  const det = [];
  if (p.length) {
    det.push('ODI-4 median — as shipped ' + median(p.map((r) => r.odi4Shipped)) + '   flag-masked ' + median(p.map((r) => r.odi4Masked)));
    const moved = p.filter((r) => Math.abs(r.delta) >= 0.1).length;
    det.push('records whose ODI-4 moves >= 0.1/h: ' + moved + '/' + p.length);
    det.push('device-flagged samples: median ' + median(p.map((r) => r.flaggedPct)) + '% of the night; in-range (accepted today) median ' + median(p.map((r) => r.flaggedInRange)));
  }
  const noStat = (rows || []).filter((r) => r && r.err === 'no OX stat channel').length;
  if (noStat) det.push(noStat + ' record(s) carry no OX stat channel at all');
  return { label: 'median ODI-4 change when device-flagged samples are nulled, events/h', value: median(d), halfWidth: hw, n: d.length, detail: det };
}

/* ── selftest ═════════════════════════════════════════════════════════════════════════════════ */
function selftest() {
  let bad = 0,
    good = 0;
  const A = (n, c, d) => {
    if (c) {
      good++;
      console.log('  ✓ ' + n);
    } else {
      bad++;
      console.log('  ✗ ' + n + (d ? '  — ' + d : ''));
    }
  };

  const rows = [
    { tMs: 0, spo2: 97, hr: 60 },
    { tMs: 1000, spo2: 74, hr: 61 },
    { tMs: 2000, spo2: 96, hr: 60 },
    { tMs: 3000, spo2: null, hr: 60 }
  ];
  const r = maskFlagged(rows, [0, 1, 0, 2]);
  A('maskFlagged: nulls the flagged sample', r.rows[1].spo2 === null);
  A('maskFlagged: leaves unflagged samples untouched', r.rows[0].spo2 === 97 && r.rows[2].spo2 === 96);
  A('maskFlagged: counts flagged samples', r.masked === 2);
  A('maskFlagged: counts only those that WERE in-range (the ones accepted today)', r.inRangeFlagged === 1);
  A('maskFlagged: does NOT mutate the caller’s rows — the two arms must not share state', rows[1].spo2 === 74);
  A('maskFlagged: an all-clean night masks nothing', maskFlagged(rows, [0, 0, 0, 0]).masked === 0);
  A('maskFlagged: an absent stat channel masks nothing rather than everything', maskFlagged(rows, null).masked === 0);

  const mk = (a, b, pct) => ({ odi4Shipped: a, odi4Masked: b, delta: +(b - a).toFixed(3), flaggedPct: pct, flaggedInRange: 5 });
  const st = liveStat([mk(10, 8, 2), mk(12, 9, 2), mk(14, 11, 2), mk(11, 9, 2), mk(13, 10, 2)]);
  A('liveStat: negative when masking REMOVES events', st.value < 0);
  A('liveStat: publishes a half-width once n>=5', st.halfWidth != null);
  A('liveStat: positive when masking ADDS events (the statistic has a sign)', liveStat([mk(8, 10, 2), mk(9, 12, 2), mk(11, 14, 2), mk(9, 11, 2), mk(10, 13, 2)]).value > 0);
  A('liveStat: exactly zero when the flag changes nothing', liveStat([mk(10, 10, 0), mk(12, 12, 0), mk(9, 9, 0), mk(8, 8, 0), mk(7, 7, 0)]).value === 0);
  A(
    'liveStat: reports records with no OX stat rather than dropping them silently',
    liveStat([mk(10, 10, 0), { err: 'no OX stat channel' }]).detail.some((x) => /no OX stat/.test(x))
  );

  console.log('\n' + (bad ? '✗ ' + bad + ' failed' : '✓ all ' + good + ' assertions passed'));
  return bad ? 1 : 0;
}

const IS_CLI = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_CLI) process.exit(selftest());
