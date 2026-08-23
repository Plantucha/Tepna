#!/usr/bin/env node
/*
 * tools/o2ring-dat-timefit.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * PIN THE O2RING'S STORED-SESSION CLOCK TO HOST TIME by fitting the onboard .dat against the live
 * SPO2.csv — the SAME 1 Hz session from the SAME ring, one stored, one delivered live and host-stamped.
 *
 * WHY. The live SPO2.csv arrives host-stamped (its rows carry the phone arrival time); the onboard .dat
 * is stamped only by the ring's free-running RTC (measured ~+151 s drift, resets on any battery event —
 * oxyii.set_time_frame). Both record SpO2/pulse/motion at 1 Hz, so the SpO2 series is a shared fingerprint.
 * Cross-correlate → the integer-second offset that aligns them IS `dat_clock − live_clock`; the live side
 * is already host time, so the offset transfers HOST TIME onto every stored session.
 *
 * A RULER at 1 Hz: the ceiling is ±1 s (the .dat is second-quantised), 50x coarser than the tap/buzz
 * marker — but it is AUTOMATIC, RETROSPECTIVE, needs no hardware, and runs on every night on disk. It also
 * VALIDATES the 0xC0 time-push (does the RTC write land? how far does it drift per night?) which nothing
 * else measures.
 *
 * .dat layout (framing per trio-batch.mjs; values decoded here, physiology-verified 2026-08-19):
 *   10-byte header · 3-byte records [spo2, pulse, motion] at 1 Hz · 0xFF 0xFF trailer.
 * SpO2 93-99, pulse 54-82, motion 0-5 on a real night — the byte roles are unambiguous from their ranges.
 *
 * Usage: node tools/o2ring-dat-timefit.mjs --dat <_STORED.dat> --spo2 <_SPO2.csv> [--maxlag 600]
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};

/** Decode the onboard .dat → per-second [{spo2,pr,motion}]. PURE-ish (reads a path). */
export function readDat(path) {
  const b = fs.readFileSync(path);
  const out = [];
  for (let off = 10; off + 2 < b.length; off += 3) {
    if (b[off] === 0xff && b[off + 1] === 0xff) break;
    out.push({ spo2: b[off], pr: b[off + 1], motion: b[off + 2] });
  }
  return out;
}

/** Parse the ViHealth SPO2.csv → [{tMs, spo2, pr, motion}]. Time col is `HH:MM:SS DD/MM/YYYY` local. */
export function readSpo2Csv(path) {
  const L = fs.readFileSync(path, 'utf8').split('\n');
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const ln = L[i];
    if (!ln || ln.startsWith('Time') || ln[0] === '#') continue;
    const p = ln.split(',');
    if (p.length < 3) continue;
    const m = /^(\d{2}):(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(p[0]);
    if (!m) continue;
    // Clock Contract §5: components verbatim → Date.UTC (floating wall clock), read back with getUTC*.
    const tMs = Date.UTC(+m[6], +m[5] - 1, +m[4], +m[1], +m[2], +m[3]);
    const spo2 = Number(p[1]);
    out.push({ tMs, spo2: Number.isFinite(spo2) ? spo2 : null, pr: Number(p[2]) });
  }
  return out;
}

/** Integer-second lag that best aligns two 1 Hz series (by minimum SAD over the overlap). Generic over
 *  the matched column — SpO2 OR pulse; both slide the same way. PURE. */
export function bestLag(datSpo2, csvSpo2, maxLag) {
  // both are 1 Hz; index k of each is one second. Slide the .dat against the csv.
  let best = Infinity,
    bestK = 0,
    bestN = 0;
  for (let k = -maxLag; k <= maxLag; k++) {
    let sad = 0,
      n = 0;
    for (let i = 0; i < csvSpo2.length; i++) {
      const j = i + k;
      if (j < 0 || j >= datSpo2.length) continue;
      const a = csvSpo2[i],
        d = datSpo2[j];
      if (a == null || d == null || a <= 0 || d <= 0) continue;
      sad += Math.abs(a - d);
      n++;
    }
    if (n < 60) continue; // need at least a minute of overlap to trust a lag
    const mean = sad / n;
    if (mean < best) {
      best = mean;
      bestK = k;
      bestN = n;
    }
  }
  return Number.isFinite(best) ? { lagS: bestK, meanAbsErr: best, n: bestN } : null;
}

/** Do two independent fits agree to within `tol` seconds? null if either fit is missing. PURE.
 *  SpO2 is a coarse 1%-integer observable; pulse (bpm) is finer, so an agreeing pulse lag CONFIRMS the
 *  SpO2 lag with a sharper column — and a disagreement means one of the two fits is spurious. */
export function lagsAgree(a, b, tol = 1) {
  if (!a || !b) return null;
  return Math.abs(a.lagS - b.lagS) <= tol;
}

function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (nm, c, d = '') => {
    if (c) {
      pass++;
      console.log(`  ok   ${nm}`);
    } else {
      fail++;
      console.log(`  FAIL ${nm}${d ? ' — ' + d : ''}`);
    }
  };
  // a synthetic SpO2 walk, then the "dat" is the same series shifted by a KNOWN lag → recover it.
  const base = [];
  let v = 97;
  for (let i = 0; i < 1200; i++) {
    v += i % 7 === 0 ? -1 : i % 11 === 0 ? 1 : 0;
    v = Math.max(90, Math.min(99, v));
    base.push(v);
  }
  const LAG = 37;
  const dat = new Array(LAG).fill(97).concat(base); // dat leads csv by 37 s
  const r = bestLag(dat, base, 120);
  ok('recovers a planted +37 s lag', r.lagS === LAG, `got ${r.lagS}`);
  ok('a perfect match has ~0 error', r.meanAbsErr < 0.01, `err ${r.meanAbsErr}`);
  // a DIFFERENT lag is recovered (not hard-coded)
  const dat2 = new Array(10).fill(97).concat(base);
  ok('recovers a different lag (+10)', bestLag(dat2, base, 120).lagS === 10);
  // no overlap → refuse
  ok('too little overlap refuses', bestLag([97, 97], base, 5) === null);
  // dropouts (0/null) are skipped, not matched as equal
  const withGap = base.slice();
  for (let i = 100; i < 300; i++) withGap[i] = 0;
  ok('zero-SpO2 dropouts do not fake a match', bestLag(new Array(LAG).fill(97).concat(withGap), base, 120).lagS === LAG);
  // the SAME machinery on a PULSE-like series (50–80 bpm) recovers a planted lag — pulse is a valid column
  const pbase = [];
  let pr = 62;
  for (let i = 0; i < 1200; i++) {
    pr += i % 5 === 0 ? -1 : i % 8 === 0 ? 2 : 0;
    pr = Math.max(50, Math.min(80, pr));
    pbase.push(pr);
  }
  const pdat = new Array(23).fill(62).concat(pbase);
  ok('pulse series recovers a planted +23 s lag', bestLag(pdat, pbase, 120)?.lagS === 23);
  // the SpO2↔pulse cross-check
  ok('agreeing lags → true', lagsAgree({ lagS: 37 }, { lagS: 37 }) === true);
  ok('lags within tol agree', lagsAgree({ lagS: 37 }, { lagS: 38 }) === true);
  ok('disagreeing lags → false', lagsAgree({ lagS: 37 }, { lagS: 50 }) === false);
  ok('a missing fit → null (not a false agreement)', lagsAgree(null, { lagS: 37 }) === null);
  /* FINISHED-WORK-IMPROVEMENTS §B4 (2026-08-23) — machine-readable summary. */
  const fakeDat = new Array(37).fill({ spo2: 97, pr: 62, motion: 0 }).concat(Array.from({ length: 600 }, (_, i) => ({ spo2: 95 + ((i * 7) % 5), pr: 60 + ((i * 3) % 8), motion: 0 })));
  const fakeCsv = Array.from({ length: 600 }, (_, i) => ({ tMs: 1000000 + i * 1000, spo2: 95 + ((i * 7) % 5), pr: 60 + ((i * 3) % 8) }));
  const jf = fitDatToSpo2Csv({ dat: fakeDat, csv: fakeCsv, maxLag: 120 });
  ok('fitDatToSpo2Csv returns ok=true on a fittable pair', jf.ok === true, JSON.stringify(jf));
  ok('…and recovers the planted lag on the chosen column', jf.chosen && jf.chosen.lagS === 37, 'chosen.lagS=' + (jf.chosen && jf.chosen.lagS));
  ok('…and datStartHostMs = anchor − chosenLag·1000', jf.datStartHostMs === 1000000 - 37 * 1000, 'got ' + jf.datStartHostMs);
  ok('…and the two-column agree flag is honoured on a real match', jf.agree === true);
  const empty = fitDatToSpo2Csv({ dat: [], csv: [], maxLag: 120 });
  ok('an empty pair returns ok=false with a reason', empty.ok === false && typeof empty.reason === 'string', JSON.stringify(empty));
  ok('…and no fabricated chosen/anchor', empty.chosen == null && empty.anchorMs == null && empty.datStartHostMs == null);
  console.log(fail ? `\n${fail} FAILURE(S)` : `\n${pass} assertions — all green`);
  return fail ? 1 : 0;
}

/* FINISHED-WORK-IMPROVEMENTS §B4 (2026-08-23) — the tool's HEADER claimed it *"runs on every night on
   disk"* while nothing invoked it; downstream hooks (`nightqc` beside the RTC digest, trio-batch beside
   the arrival sidecar) need a machine-readable summary, not the human-readable console dump.
   `fitDatToSpo2Csv({dat, csv, maxLag}) → { spo2, pulse, agree, chosen, anchorMs, datStartHostMs, ok, reason }`
   is a PURE-ish function over parsed inputs (paths are handled by callers via readDat/readSpo2Csv, so this
   sits atop the same primitives without new I/O). `ok` is true only when a fit was recovered; on refusal
   `reason` names why. `--json` on the CLI serialises this shape and skips the human render. */
export function fitDatToSpo2Csv({ dat, csv, maxLag = 600 }) {
  const spo2 = bestLag(
    dat.map((x) => x.spo2),
    csv.map((x) => x.spo2),
    maxLag
  );
  const pulse = bestLag(
    dat.map((x) => x.pr),
    csv.map((x) => x.pr),
    maxLag
  );
  if (!spo2 && !pulse) {
    return { ok: false, reason: 'no lag with enough overlap — same session?', spo2: null, pulse: null, agree: null, chosen: null, anchorMs: null, datStartHostMs: null };
  }
  const agree = lagsAgree(spo2, pulse);
  const chosen = pulse && (agree === true || !spo2) ? pulse : spo2;
  const anchorMs = csv.length ? csv[0].tMs : null;
  const datStartHostMs = anchorMs != null && chosen ? anchorMs - chosen.lagS * 1000 : null;
  return { ok: !!chosen, reason: chosen ? null : 'neither column yielded a fit', spo2, pulse, agree, chosen, anchorMs, datStartHostMs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  const datP = arg('--dat'),
    csvP = arg('--spo2');
  if (!datP || !csvP) {
    console.log('usage: --dat <_STORED.dat> --spo2 <_SPO2.csv>');
    process.exit(2);
  }
  const maxLag = Number(arg('--maxlag') || 600);
  const dat = readDat(datP),
    csv = readSpo2Csv(csvP);
  const fit = fitDatToSpo2Csv({ dat, csv, maxLag });
  if (process.argv.includes('--json')) {
    // Callers (nightqc's RTC digest hook, a trio-batch enrichment pass) parse this shape directly.
    // The two input sizes travel too so a caller can flag "session too short" without re-decoding.
    process.stdout.write(
      JSON.stringify({
        ok: fit.ok,
        reason: fit.reason,
        datSec: dat.length,
        csvSec: csv.length,
        spo2: fit.spo2,
        pulse: fit.pulse,
        agree: fit.agree,
        chosenLagS: fit.chosen ? fit.chosen.lagS : null,
        anchorMs: fit.anchorMs,
        datStartHostMs: fit.datStartHostMs
      }) + '\n'
    );
    process.exit(fit.ok ? 0 : 1);
  }
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  console.log(`  dat : ${dat.length} s   spo2 median ${med(dat.map((r) => r.spo2))}  pulse median ${med(dat.map((r) => r.pr))}`);
  console.log(`  csv : ${csv.length} s   host-stamped ${new Date(csv[0]?.tMs).toISOString().slice(11, 19)}–${new Date(csv[csv.length - 1]?.tMs).toISOString().slice(11, 19)} (floating)`);
  if (!fit.ok && !fit.spo2 && !fit.pulse) {
    console.log('  no lag with enough overlap — is this the same session?');
    process.exit(1);
  }
  const report = (nm, r, unit) => console.log(r ? `  ${nm} lag: dat leads csv by ${r.lagS} s   (mean |Δ${unit}| ${r.meanAbsErr.toFixed(3)} over ${r.n} s)` : `  ${nm} lag: no fit`);
  console.log('');
  report('SpO₂ ', fit.spo2, 'SpO₂');
  report('pulse', fit.pulse, 'bpm');
  if (fit.agree === true) console.log(`  ✓ the two columns AGREE — the lag is confirmed by an independent, finer observable`);
  else if (fit.agree === false)
    console.log(`  ⚠ SpO₂ ${fit.spo2.lagS}s vs pulse ${fit.pulse.lagS}s DISAGREE by ${Math.abs(fit.spo2.lagS - fit.pulse.lagS)}s — one fit is spurious; treat as unconfirmed`);
  if (fit.spo2 && fit.spo2.meanAbsErr > 1.5) console.log('  ⚠ SpO₂ mean error > 1.5 % — that fit is weak on its own');
  if (fit.datStartHostMs != null) {
    console.log(`  ⇒ .dat sample 0 sits at host ${new Date(fit.datStartHostMs).toISOString().slice(11, 19)} (floating) — its RTC stamp can now be checked against this`);
  }
}
