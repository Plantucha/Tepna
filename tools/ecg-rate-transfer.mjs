#!/usr/bin/env node
/*
 * tools/ecg-rate-transfer.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * DOES PAN–TOMPKINS TRANSFER FROM 130 Hz TO 125 Hz? — experiment E3 of
 * `briefs/SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md`.
 *
 * Every HRV claim this suite makes on external 125 Hz polysomnography rests on an unstated premise:
 * that the detector tuned and validated at the Polar H10's **130 Hz** finds the same beats at the
 * **125 Hz** those recordings ship. Nobody had measured it. The brief says to run this FIRST, and the
 * reason it comes first is that it costs nothing to answer and everything to assume — it uses OUR
 * corpus, needs no external data-use decision, and if the answer were negative it would invalidate
 * any HRV arm built on top of it rather than merely weaken one.
 *
 * ── PRE-STATED BANDS (brief §4 E3, published before this ran) ────────────────────────────────
 *   median |Δ| ≤ 4 ms  AND  ≥99 % beat correspondence  ⇒  it transfers.
 * Stated here so the cut cannot be moved after seeing the number.
 *
 * ── WHAT IS COMPARED, AND WHY IT IS THE HONEST PAIRING ───────────────────────────────────────
 * One recording, detected twice: once at its native rate, once after resampling to the target. The
 * SAME signal, the SAME detector, the SAME beats in the world — so every difference in the output is
 * attributable to the rate change and nothing else. A comparison against a different recording, or
 * against a published beat list, would confound rate with everything else that differs.
 *
 * ⚠️ **Linear interpolation is the resampler, and that is a CHOICE with a stated justification, not
 * an oversight.** 130 → 125 Hz moves Nyquist from 65 Hz to 62.5 Hz. `ECGDSP`'s own front end
 * band-passes well below that before detection, so there is no energy in 62.5–65 Hz for an
 * anti-aliasing filter to protect — a polyphase resampler would be more correct in general and
 * indistinguishable here. What the choice DOES mean is that this measures the detector's sensitivity
 * to sample-grid placement, which is the thing in question, rather than the resampler's quality.
 *
 * ⚠️ **A NEGATIVE RESULT HERE HAS TWO CAUSES AND THEY ARE NOT THE SAME.** If beats move, it is
 * either (a) the detector genuinely resolves peaks differently on a coarser grid, or (b) the
 * resampling itself displaced the waveform. (b) is testable and this tool tests it: resampling a
 * record to its OWN rate must be an identity, and the same comparison run at 130 → 130 must return
 * exactly zero displacement. A tool that reported drift without that control could not tell its own
 * arithmetic from the finding.
 *
 * USAGE
 *   node tools/ecg-rate-transfer.mjs --selftest
 *   node tools/ecg-rate-transfer.mjs --dir <corpus-dir> [--to 125] [--limit N]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeVerdict } from './verdict-emit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* The pre-stated acceptance bands. Constants, so the report cannot quietly use different ones. */
export const BAND_MEDIAN_ABS_MS = 4;
export const BAND_CORRESPONDENCE = 0.99;
/* Matching window: generous relative to the effect being measured. A window near the band would
   itself decide the answer — a beat displaced 5 ms must still MATCH so its displacement can be
   counted, otherwise displacement silently converts into a correspondence failure and the two
   numbers stop being independent. */
export const MATCH_MS = 60;

/* ── resampling ───────────────────────────────────────────────────────────────────────────────
   Linear interpolation onto the target grid. `t` runs in samples of the SOURCE grid; each output
   sample is read at `i * fsFrom / fsTo`. Endpoints are clamped rather than extrapolated — an
   extrapolated edge sample is a fabricated measurement (§∅), and it would sit exactly where the
   detector is most likely to find a spurious first beat. */
export function resampleLinear(x, fsFrom, fsTo) {
  if (!(fsFrom > 0) || !(fsTo > 0)) return null;
  if (fsFrom === fsTo) return Float32Array.from(x); // identity, and the selftest asserts it
  const n = x.length;
  const m = Math.max(1, Math.floor((n * fsTo) / fsFrom));
  const out = new Float32Array(m);
  const step = fsFrom / fsTo;
  for (let i = 0; i < m; i++) {
    const t = i * step;
    const k = Math.floor(t);
    if (k >= n - 1) {
      out[i] = x[n - 1];
      continue;
    }
    const f = t - k;
    out[i] = x[k] * (1 - f) + x[k + 1] * f;
  }
  return out;
}

/* ── displacement ─────────────────────────────────────────────────────────────────────────────
   Beat times in ms from each detection, matched one-to-one, then the SIGNED displacement per pair.
   Signed, not absolute: a systematic lag and symmetric jitter are different findings, and |Δ| alone
   cannot tell them apart. The headline band is on the median of |Δ|, but the signed median is
   reported beside it so a constant offset is visible. */
export function displacement(refMs, detMs, matchBeats, windowMs) {
  /* `matchBeats` returns `{ pairs, tp, fn, fp, se, ppv }` and each pair already carries `errMs` —
     read from the function rather than recomputed from indices here. The first draft assumed it
     returned a bare array and destructured indices out of it; reusing a function is only cheaper
     than rewriting it if its actual signature is read, and an assumed shape is a rewrite with extra
     steps. */
  const m = matchBeats(refMs, detMs, windowMs == null ? MATCH_MS : windowMs);
  const d = (m.pairs || []).map((p) => p.errMs).filter(Number.isFinite);
  if (!d.length) return { n: 0, correspondence: 0, medianAbsMs: null, medianSignedMs: null, p95AbsMs: null, nRef: refMs.length, nDet: detMs.length };
  const abs = d.map(Math.abs).sort((a, b) => a - b);
  const sgn = [...d].sort((a, b) => a - b);
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(f * arr.length))];
  /* correspondence is against the LARGER side, so neither dropping nor inventing beats can inflate
     it — matching 90 of 100 against 90 detected would otherwise read as 100 % */
  const denom = Math.max(refMs.length, detMs.length);
  return {
    n: d.length,
    correspondence: denom ? +(d.length / denom).toFixed(5) : 0,
    medianAbsMs: +q(abs, 0.5).toFixed(3),
    medianSignedMs: +q(sgn, 0.5).toFixed(3),
    p95AbsMs: +q(abs, 0.95).toFixed(3),
    nRef: refMs.length,
    nDet: detMs.length
  };
}

/* ── tepna.verdict/1 (VERDICT-CONTRACT §1; wave-2 adopter) — E3's decision as ONE object ─────────
   The bands are the constants above, pre-stated in the brief: PASS = it transfers (both bands met over
   the pooled records) · FAIL = a band missed (which one, by how much, in `reason`) · UNKNOWN = no
   matched beats, so the bands could not be evaluated · NOT_RUN = no record found. Population = records
   measured, as an equality. The control row (same-rate identity) rides in `result` — a non-zero control
   means the number is the resampler, not the detector, and the reason says so. */
export function verdictObject(pooled, { records, found, dir, commit, commitReason, at } = {}) {
  const v = verdict(pooled);
  const status = !found ? 'NOT_RUN' : v.transfers === null ? 'UNKNOWN' : v.transfers ? 'PASS' : 'FAIL';
  const ctrlNote = pooled && pooled.ctrlMedianAbsMs != null && pooled.ctrlMedianAbsMs !== 0 ? ' (⚠ control median |Δ| ' + pooled.ctrlMedianAbsMs + ' ms ≠ 0 — the resampler displaces beats)' : '';
  return makeVerdict({
    gate: 'ecg-rate-transfer',
    status,
    population: { checked: status === 'NOT_RUN' ? 0 : records || 0, eligible: found || records || 0, excluded: status === 'NOT_RUN' ? found || 0 : (found || records || 0) - (records || 0) },
    // a CONJUNCTION of two pre-stated bands — counted as "bands missed", each band and its value in result
    criterion: { name: 'e3_bands_missed (median |Δ| ≤ ' + BAND_MEDIAN_ABS_MS + ' ms AND correspondence ≥ ' + 100 * BAND_CORRESPONDENCE + ' %)', threshold: 0, unit: 'bands missed', direction: 'eq' },
    result:
      status === 'NOT_RUN'
        ? null
        : {
            medianAbsMs: pooled.medianAbsMs,
            correspondence: pooled.correspondence,
            ctrlMedianAbsMs: pooled.ctrlMedianAbsMs,
            records: records || 0,
            bands: { medianAbsMs: BAND_MEDIAN_ABS_MS, correspondence: BAND_CORRESPONDENCE },
            bandsMissed: v.transfers === null ? null : (pooled.medianAbsMs <= BAND_MEDIAN_ABS_MS ? 0 : 1) + (pooled.correspondence >= BAND_CORRESPONDENCE ? 0 : 1)
          },
    evidence: ['tools/ecg-rate-transfer.mjs'].concat(dir ? [String(dir)] : []),
    reason: status === 'PASS' ? null : status === 'NOT_RUN' ? 'no H10 ECG record found under ' + dir : v.why + ctrlNote,
    tool: 'tools/ecg-rate-transfer.mjs',
    commit,
    commitReason,
    at
  });
}
/* What the adoption gate runs: pooled numbers of the shape E3 measured, through the real bands. */
export function verdictSample() {
  return verdictObject(
    { medianAbsMs: 1.2, correspondence: 0.998, ctrlMedianAbsMs: 0 },
    { records: 6, found: 6, commit: null, commitReason: '--verdict-sample: synthetic pooled numbers, no code identity claimed', at: '2026-09-22T00:00:00Z' }
  );
}

export function verdict(stat) {
  if (!stat || stat.medianAbsMs == null) return { transfers: null, why: 'no matched beats' };
  const okMed = stat.medianAbsMs <= BAND_MEDIAN_ABS_MS;
  const okCorr = stat.correspondence >= BAND_CORRESPONDENCE;
  return {
    transfers: okMed && okCorr,
    why:
      okMed && okCorr
        ? 'within both pre-stated bands'
        : [okMed ? null : `median |Δ| ${stat.medianAbsMs} ms > ${BAND_MEDIAN_ABS_MS}`, okCorr ? null : `correspondence ${(100 * stat.correspondence).toFixed(2)} % < ${100 * BAND_CORRESPONDENCE} %`]
            .filter(Boolean)
            .join(' · ')
  };
}

/* ── selftest ═════════════════════════════════════════════════════════════════════════════════ */
async function selftest() {
  let bad = 0,
    good = 0;
  const A = (n, c, d) => {
    if (c) {
      good++;
      console.log('  ✓ ' + n);
    } else {
      bad++;
      console.log('  ✕ ' + n + (d ? '  — ' + d : ''));
    }
  };
  console.log('▸ ecg-rate-transfer --selftest\n');

  /* the control that makes a negative interpretable: resampling to the SAME rate must be identity */
  const x = Float32Array.from({ length: 500 }, (_, i) => Math.sin(i / 7) * 100);
  const same = resampleLinear(x, 130, 130);
  A('resample: same-rate is an exact identity (the control a negative result needs)', same.length === x.length && same.every((v, i) => v === x[i]));
  const down = resampleLinear(x, 130, 125);
  A('resample: downsampling shortens by the rate ratio', down.length === Math.floor((500 * 125) / 130), String(down.length));
  A('resample: endpoints are clamped, never extrapolated', Number.isFinite(down[down.length - 1]));
  A('resample: a nonsense rate refuses rather than dividing by zero', resampleLinear(x, 0, 125) === null && resampleLinear(x, 130, -1) === null);
  /* interpolation must not invent amplitude: a resampled sine stays inside the source's range */
  let mn = Infinity,
    mx = -Infinity;
  for (const v of down) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  A('resample: interpolation stays inside the source range (invents no peak)', mn >= Math.min(...x) - 1e-3 && mx <= Math.max(...x) + 1e-3);

  const { matchBeats } = await import('./ecg-physionet-differential.mjs');
  const ref = [1000, 2000, 3000, 4000, 5000];
  A(
    'displacement: identical series → 0 ms, 100 % correspondence',
    (() => {
      const s = displacement(ref, [...ref], matchBeats);
      return s.medianAbsMs === 0 && s.correspondence === 1;
    })()
  );
  A(
    'displacement: a constant +3 ms lag is reported as SIGNED, not just absolute',
    (() => {
      const s = displacement(
        ref,
        ref.map((t) => t + 3),
        matchBeats
      );
      return s.medianSignedMs === 3 && s.medianAbsMs === 3;
    })()
  );
  A(
    'displacement: symmetric jitter has ~0 signed median but non-zero absolute',
    (() => {
      const s = displacement(
        ref,
        ref.map((t, i) => t + (i % 2 ? 4 : -4)),
        matchBeats
      );
      return Math.abs(s.medianSignedMs) <= 4 && s.medianAbsMs === 4;
    })()
  );
  A(
    'displacement: a missing beat lowers correspondence below 1',
    (() => {
      const s = displacement(ref, ref.slice(1), matchBeats);
      return s.correspondence < 1;
    })()
  );
  A(
    'displacement: correspondence uses the LARGER side, so extra beats cannot inflate it',
    (() => {
      const s = displacement(ref, [...ref, 6000, 7000], matchBeats);
      return s.correspondence < 1;
    })(),
    JSON.stringify(displacement(ref, [...ref, 6000, 7000], matchBeats).correspondence)
  );

  A('verdict: inside both bands transfers', verdict({ medianAbsMs: 1.2, correspondence: 0.998 }).transfers === true);
  A('verdict: a wide median fails even at perfect correspondence', verdict({ medianAbsMs: 9, correspondence: 1 }).transfers === false);
  A('verdict: poor correspondence fails even at zero displacement', verdict({ medianAbsMs: 0, correspondence: 0.5 }).transfers === false);
  A('verdict: it names WHICH band failed', /correspondence/.test(verdict({ medianAbsMs: 0, correspondence: 0.5 }).why));
  A('verdict: no matched beats refuses rather than passing', verdict({ medianAbsMs: null }).transfers === null);
  // ── the object: every status through the real bands ──
  const vo = (p, o) => verdictObject(p, { records: 6, found: 6, commit: null, commitReason: 'selftest', at: '2026-09-22T00:00:00Z', ...o });
  A(
    'object: inside both bands ⇒ PASS, reason null',
    vo({ medianAbsMs: 1.2, correspondence: 0.998, ctrlMedianAbsMs: 0 }).status === 'PASS' && vo({ medianAbsMs: 1.2, correspondence: 0.998, ctrlMedianAbsMs: 0 }).reason === null
  );
  A(
    'object: a missed band ⇒ FAIL naming it',
    vo({ medianAbsMs: 9, correspondence: 1, ctrlMedianAbsMs: 0 }).status === 'FAIL' && /median/.test(vo({ medianAbsMs: 9, correspondence: 1, ctrlMedianAbsMs: 0 }).reason)
  );
  A('object: a non-zero control is named in the FAIL reason', /resampler/.test(vo({ medianAbsMs: 9, correspondence: 1, ctrlMedianAbsMs: 3 }).reason));
  A('object: no matched beats ⇒ UNKNOWN, never PASS', vo({ medianAbsMs: null }).status === 'UNKNOWN');
  A(
    'object: no record found ⇒ NOT_RUN with result null',
    vo({ medianAbsMs: null }, { records: 0, found: 0 }).status === 'NOT_RUN' && vo({ medianAbsMs: null }, { records: 0, found: 0 }).result === null
  );
  A('object: the sample validates (makeVerdict throws otherwise)', verdictSample().status === 'PASS');

  console.log('\n' + (bad ? '✕ ' + bad + ' failed, ' : '✓ ') + good + ' assertions passed');
  return bad ? 1 : 0;
}

if (process.argv.includes('--selftest')) process.exit(await selftest());
if (process.argv.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}

/* ── the run ══════════════════════════════════════════════════════════════════════════════════ */
async function main(argv) {
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const dir = arg('--dir', '/srv/data/tepna-corpus/smoketest-captures');
  const to = Number(arg('--to', '125'));
  const limit = Number(arg('--limit', '6'));
  const maxSec = Number(arg('--sec', '900')); // per record; 15 min is ~1000 beats, ample

  const { makeRealm, matchBeats } = await import('./ecg-physionet-differential.mjs');
  const ctx = makeRealm();

  /* find H10 ECG records, newest-first so a truncated corpus still yields whole nights */
  const files = [];
  const walk = (d, depth) => {
    if (depth > 3) return;
    let ents = [];
    try {
      ents = readdirSync(d);
    } catch {
      return;
    }
    for (const e of ents) {
      const p = join(d, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (/_ECG\.txt$/i.test(e) && st.size > 1e6) files.push(p);
    }
  };
  walk(dir, 0);
  files.sort();
  if (!files.length) {
    console.error('✕ no *_ECG.txt under ' + dir);
    return 2;
  }

  console.log('▸ E3 · does Pan–Tompkins transfer across sample rates?');
  console.log('  corpus    ' + dir + '  (' + files.length + ' records found, using ' + Math.min(limit, files.length) + ')');
  console.log('  bands     median |Δ| ≤ ' + BAND_MEDIAN_ABS_MS + ' ms  AND  correspondence ≥ ' + 100 * BAND_CORRESPONDENCE + ' %   (pre-stated)');
  console.log('');

  const rows = [];
  for (const f of files.slice(0, limit)) {
    const name = f.split('/').pop();
    let rec;
    try {
      /* bounded read: the header plus maxSec of samples. A whole night is 4.2 M lines and the
         question needs beats, not duration. */
      const text = readFileSync(f, 'utf8');
      const lines = text.split(/\r?\n/, Math.ceil(maxSec * 140) + 2);
      /* `parseECGLines` is the exported name; `parseECGText` is internal and delegates to it. Read
         off the realm rather than guessed — the first draft called the internal one and every record
         reported "parse error", which reads like a corpus problem and is a caller problem. */
      rec = ctx.ECGDSP.parseECGLines(lines);
    } catch (e) {
      console.log('  ' + name.slice(0, 44).padEnd(46) + 'parse error: ' + String(e.message).slice(0, 40));
      continue;
    }
    const fs = rec && rec.fs;
    const sig = rec && (rec.int16 || rec.data);
    if (!fs || !sig || !sig.length) {
      console.log('  ' + name.slice(0, 44).padEnd(46) + 'no usable signal');
      continue;
    }

    const det = (x, rate) => {
      const out = ctx.ECGDSP.analyze({ int16: x, fs: rate, t0Ms: 0, durSec: x.length / rate, gaps: [] });
      /* ⚠️ `analyze().times` is in SECONDS. This cost a 1000x error once already. */
      return (out.times || []).map((s) => s * 1000);
    };

    const refMs = det(sig, fs);
    /* THE CONTROL FIRST: same-rate must be exactly zero, or the number below is measuring this tool */
    const ctrl = displacement(refMs, det(resampleLinear(sig, fs, fs), fs), matchBeats);
    const stat = displacement(refMs, det(resampleLinear(sig, fs, to), to), matchBeats);
    rows.push({ name, fs, to, ctrl, stat });

    console.log('  ' + name.slice(0, 44).padEnd(46) + fs.toFixed(2) + ' Hz → ' + to + ' Hz');
    console.log('      control ' + fs.toFixed(0) + '→' + fs.toFixed(0) + '   median |Δ| ' + String(ctrl.medianAbsMs).padStart(7) + ' ms   corr ' + (100 * ctrl.correspondence).toFixed(2) + ' %');
    console.log(
      '      MEASURED          median |Δ| ' +
        String(stat.medianAbsMs).padStart(7) +
        ' ms   corr ' +
        (100 * stat.correspondence).toFixed(2) +
        ' %   signed ' +
        stat.medianSignedMs +
        '   p95 ' +
        stat.p95AbsMs +
        '   beats ' +
        stat.nRef +
        '/' +
        stat.nDet
    );
  }

  if (!rows.length) {
    console.error('✕ no record produced a usable comparison');
    return 2;
  }

  const med = (a) => {
    const v = a.filter((x) => x != null).sort((x, y) => x - y);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  const pooled = {
    medianAbsMs: med(rows.map((r) => r.stat.medianAbsMs)),
    correspondence: med(rows.map((r) => r.stat.correspondence)),
    ctrlMedianAbsMs: med(rows.map((r) => r.ctrl.medianAbsMs))
  };
  const v = verdict(pooled);
  console.log('');
  console.log('  ── across ' + rows.length + ' records ──');
  console.log(
    '  control (same rate)   median |Δ| ' +
      pooled.ctrlMedianAbsMs +
      ' ms' +
      (pooled.ctrlMedianAbsMs === 0
        ? '   ✓ identity holds, so the measurement below is the detector, not this tool'
        : '   ⚠️ NOT ZERO — the resampler displaces beats; the number below is contaminated')
  );
  console.log('  measured              median |Δ| ' + pooled.medianAbsMs + ' ms   correspondence ' + (100 * pooled.correspondence).toFixed(2) + ' %');
  console.log('  VERDICT               ' + (v.transfers === true ? 'TRANSFERS — ' : v.transfers === false ? 'DOES NOT TRANSFER — ' : 'INCONCLUSIVE — ') + v.why);
  // the object IS the verdict (stdout under --json; the report above is its explanation)
  if (argv.includes('--json')) console.log(JSON.stringify(verdictObject(pooled, { records: rows.length, found: files.length, dir })));
  return 0;
}

if (!process.argv.includes('--selftest')) process.exit(await main(process.argv.slice(2)));
