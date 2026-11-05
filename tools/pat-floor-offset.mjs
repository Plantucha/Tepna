#!/usr/bin/env node
/*
 * tools/pat-floor-offset.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * RADIO-DELAY-FLOOR §5, the beat half: does the floor-mapped radio delay EXPLAIN the inter-device
 * offset PAT has to carry, or does it only sharpen a term it cannot predict?
 *
 * WHAT THIS READS. Every `*RADIOCLOCK*` sidecar the capture host writes beside a night carries two
 * clocks on the same row: `last_sensor_ns` (the device counter, ns since 2000-01-01) and `acl_rx_ns`
 * (the host's CLOCK_REALTIME at ACL receipt). Their difference is the delay the packet took to
 * arrive. The DELAY is noisy — retransmits, scheduling, a stalled link — but its FLOOR is the
 * physical path, so the floor is the clock pair worth fitting.
 *
 * WHY A FLOOR AND NOT A MEAN. `DexClock.hostAxis` takes a running median over every anchor and
 * refuses the night when the implied rate leaves ±50000 ppm. On 2026-11-01 one recorded clock seam
 * put the implied rate at -999914 ppm and the shipped path refused 5 h 49 min of clean ECG whole.
 * The floor is immune to that: a minimum per window ignores every late packet, and keying the line
 * by `conn_handle` makes a reconnect a NEW line rather than a step inside one. §🔒.7's rule — one
 * device clock per axis, anchors at or after the last resync — falls out of the key.
 *
 * WHAT IT DECIDES, AND WHAT IT REFUSES TO DECIDE. The floor gives each device a rate and an
 * intercept. The decisive question is whether the floor and the BEATS agree about how much the
 * inter-device offset MOVED between two nights: the floor states it in ms, the beat scan
 * (`tools/pat-host-offset.mjs --scan`) states it modulo one RR interval. A criterion nobody could
 * fit afterwards was posted to the fleet board before this tool existed, and it is the one below:
 *
 *   median absolute disagreement over the night pairs <= 90 ms
 *
 * 90 ms is `PAT-UNDER-PERBLOCK-ALIGNMENT` §3e's own alignment tolerance, which predates this
 * measurement. Above it the floor sharpens a term it cannot predict and §5 earns no band. Fewer
 * than four pairs reads UNDERPOWERED and never PASS — one pair agreeing is one coin landing heads.
 *
 * PRIVACY. The sidecar's `device` column and every sidecar FILENAME carry a BLE address. This tool
 * groups rows by that column and never prints it, never prints a sidecar filename, and labels a
 * device by the role its `meas` column names plus an ordinal. A night is keyed by its date.
 *
 * USAGE
 *   node tools/pat-floor-offset.mjs --dir uploads/vigil-archive/captures
 *   node tools/pat-floor-offset.mjs --dir <captures> --night 2026-10-30 --json
 *   node tools/pat-floor-offset.mjs --dir <captures> --beats <pat-host-offset --scan --json>
 *   node tools/pat-floor-offset.mjs --selftest
 *   node tools/pat-floor-offset.mjs --verdict-sample
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isCliEntry } from './argv-guard.mjs';
import { populationVerdict, ruleLine, snapshotNights } from './corpus-scope-core.mjs';
import { makeVerdict, printVerdict } from './verdict-emit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ── THE CONSTANTS ARE THE METHOD, so each one carries what fixes it ───────────────────────────── */
/* The device counter's epoch (2000-01-01T00:00:00Z) in ms, so the two clocks subtract. */
const EPOCH2000_MS = 946684800000;
/* The floor window. 300 s holds ~4000 packets at 130 Hz, enough that a minimum is a floor and not a
   single lucky arrival, and short enough that 8 h gives ~96 points to fit. */
const WIN_S = 300;
/* Theil-Sen pairs must straddle 20 min. A short baseline divides MAD-sized floor noise by a small
   number and reports a rate that is noise. */
const MIN_PAIR_GAP_S = 1200;
/* Three floor points is the fewest that can disagree with a line at all. */
const MIN_WINDOWS = 3;
/* A refusal bound, not a clamp, and NOT a vendor allowlist. A crystal drifts tens of ppm; 2000 ms/h
   is 556 ppm. One device in the archive reads 1e11 ms/h, so the bound names it rather than an OUI —
   an OUI is the first half of a BLE address and belongs in no tracked file. */
const RATE_BOUND_MS_PER_H = 2000;
/* A pair of lines needs a real overlap before an offset between them means anything. */
const MIN_OVERLAP_S = 3600;
/* THE PRE-STATED CRITERION (fleet board 2026-11-04, before the deciding data existed). */
const DISAGREE_MAX_MS = 90;
const MIN_PAIRS = 4;
/* The numeric PMD stream ids the capture host writes. 2 (acc) and 3 (ppi) are read and ignored. */
const MEAS_ROLE = { 0: 'ecg', 1: 'ppg' };

/* THE FLAG NAME IS A LITERAL AT THE CALL SITE, never composed here. A `indexOf('--' + n)` read is
   undecidable for the usage-line scan (`tests/dex-tests.js`, "a documented flag is read by the tool
   that documents it"), which then excludes the whole tool from the judged set instead of checking it. */
const arg = (flag, d) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* ── STREAMING, NOT SLURPING. One sidecar reaches 40 MB and a night holds three, so the file is read
   in 1 MB chunks with a carry. Splitting 40 MB into lines holds the whole night in strings for the
   life of the parse, which is the greedy shape that reaps other sessions' gates. ───────────────── */
export function forEachLine(path, cb) {
  const fd = openSync(path, 'r');
  const buf = Buffer.allocUnsafe(1 << 20);
  let carry = '';
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      const text = carry + buf.toString('utf8', 0, n);
      let from = 0;
      for (;;) {
        const nl = text.indexOf('\n', from);
        if (nl < 0) break;
        cb(text.slice(from, nl));
        from = nl + 1;
      }
      carry = text.slice(from);
    }
    if (carry) cb(carry);
  } finally {
    closeSync(fd);
  }
}

/* The host stamp is `YYYY-MM-DDTHH:MM:SS.sss` in the capture host's own floating wall clock, so
   seconds-of-day by regex per the Clock Contract §2.4 — never `new Date(str)`. */
const TS_RE = /T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/;
export function secOfDay(raw) {
  const m = TS_RE.exec(raw || '');
  if (!m) return null;
  const h = Number(m[1]),
    mi = Number(m[2]),
    s = Number(m[3]);
  if (h > 23 || mi > 59 || s >= 60) return null;
  return h * 3600 + mi * 60 + s;
}

/* ── THE AXIS IS THE CLOCK THE DELAY IS MEASURED AGAINST ────────────────────────────────────────
   x is `acl_rx_ns`, the host's CLOCK_REALTIME at ACL receipt, in seconds. Two reasons, and the
   second one was measured here.

   1. A delay line reads device-minus-host. Fitting it against a THIRD clock buys nothing and can
      only add that clock's faults to the fit. The window index is absolute epoch seconds, so every
      sidecar of a night shares one axis and the two devices' lines are read at the same instant.

   2. THE CIVIL STAMP REWOUND AN HOUR MID-RECORDING, AND THE NIGHT STILL LOOKED WELL-FORMED. The
      2026-10-31 session (22:40 -> 05:44) crosses the host zone's DST fall-back. Every stream of
      that night carries one backward step in `Phone timestamp`:
      `2026-11-01T01:59:59.436 -> 2026-11-01T01:00:01.686`, d_civil -3597.7 s against d_acl
      +2.25 s. So the written civil axis gives 7.04 h for an 8.04 h recording and repeats the
      01:00-02:00 hour, while `acl_rx_ns` runs monotone with zero backward steps. An earlier build
      of this tool fitted the civil stamp and read that night at -118.23 ms/h with a 28.15 ms floor
      MAD, against -101.76 ms/h and 6.48 ms on the same bytes here — a 16 ms/h error in a figure
      whose whole point is a per-device rate. The Clock Contract's own check ("22:00->06:00 = ~8 h
      monotonic") is what fails, on exactly the one night a year it was written for.

   So the civil stamp is READ but never fitted: each night reports its civil span beside its acl
   span, and a disagreement is named. A night whose stamps rewound is still measurable here; a
   consumer that SORTS on those stamps is not, which is a defect of its own and is logged as one. */
const CIVIL_REWIND_MIN_S = 60;
/* a difference of civil seconds-of-day against host epoch seconds, folded into (-12 h, +12 h] */
export const wrapDay = (d) => ((((d + 43200) % 86400) + 86400) % 86400) - 43200;

export function makeFolder() {
  const keys = new Map();
  /* THE CROSS-CHECK IS PER ROW, NOT PER SPAN. Both host columns sit on the SAME row, so their
     difference is a constant while the two clocks agree, and a span comparison is a weaker reading
     of the same thing: one stale row 24 h out moved a span by 24 h and reported a rewind on a night
     whose stamps never stepped. The skew's MOVEMENT is exact, and the count of rows that moved
     separates a zone change (half the stream) from a garbage row (a handful). */
  const civil = { backSteps: 0, prevSod: null, skew0: null, moved: 0, extreme: 0, pairs: 0 };
  let ix = null,
    aclLo = null,
    aclHi = null,
    rows = 0,
    used = 0;
  return {
    feed(line) {
      if (ix === null) {
        ix = {};
        line
          .replace(/\r$/, '')
          .split(';')
          .forEach((k, i) => {
            ix[k] = i;
          });
        return;
      }
      rows++;
      const p = line.replace(/\r$/, '').split(';');
      const role = MEAS_ROLE[Number(p[ix.meas])];
      if (role === undefined) return;
      const last = Number(p[ix.last_sensor_ns]),
        acl = Number(p[ix.acl_rx_ns]);
      if (!Number.isFinite(last) || !Number.isFinite(acl) || last === 0 || acl === 0) return;
      const d = (acl - last) / 1e6 - EPOCH2000_MS;
      if (!Number.isFinite(d)) return;
      const x = acl / 1e9;
      if (aclLo === null || x < aclLo) aclLo = x;
      if (aclHi === null || x > aclHi) aclHi = x;
      /* the civil stamp, read for the cross-check only */
      const sod = secOfDay(p[ix['Phone timestamp']]);
      if (sod !== null) {
        if (civil.prevSod !== null) {
          const dc = sod - civil.prevSod;
          /* a drop of about a day is midnight, not a rewind */
          if (dc < -CIVIL_REWIND_MIN_S && dc > -86400 + CIVIL_REWIND_MIN_S) civil.backSteps++;
        }
        civil.prevSod = sod;
        civil.pairs++;
        const skew = wrapDay(sod - (x % 86400));
        if (civil.skew0 === null) civil.skew0 = skew;
        else {
          const dd = wrapDay(skew - civil.skew0);
          if (Math.abs(dd) > CIVIL_REWIND_MIN_S) {
            civil.moved++;
            if (Math.abs(dd) > Math.abs(civil.extreme)) civil.extreme = dd;
          }
        }
      }
      const w = Math.floor(x / WIN_S);
      const dev = p[ix.device],
        conn = p[ix.conn_handle];
      const key = dev + '\u0000' + conn + '\u0000' + role;
      let rec = keys.get(key);
      if (!rec) {
        rec = { role, dev, conn, wins: new Map() };
        keys.set(key, rec);
      }
      const had = rec.wins.get(w);
      if (had === undefined || d < had) rec.wins.set(w, d);
      used++;
    },
    done() {
      return {
        keys,
        rows,
        used,
        aclSpanH: aclLo === null ? null : (aclHi - aclLo) / 3600,
        civilPairs: civil.pairs,
        civilSkewMoved: civil.moved,
        civilSkewExtremeS: civil.extreme,
        civilBackSteps: civil.backSteps
      };
    }
  };
}

/* `lines` is any iterable of raw sidecar lines, header first. The fold keeps ONE scalar per window
   per key, so a 40 MB sidecar costs kilobytes. */
export function floorWindows(lines) {
  const f = makeFolder();
  for (const line of lines) f.feed(line);
  return f.done();
}

/* ── THEIL-SEN over the floor points ─────────────────────────────────────────────────────────────
   The median of the pairwise slopes, then the median intercept. A least-squares fit would be pulled
   by the one window whose floor is a stall rather than a path. */
export function theilSen(pts, minGapS = MIN_PAIR_GAP_S) {
  const sl = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j][0] - pts[i][0];
      if (dx >= minGapS) sl.push((pts[j][1] - pts[i][1]) / dx);
    }
  }
  if (!sl.length) return null;
  const m = median(sl);
  const b = median(pts.map(([x, y]) => y - m * x));
  const resid = pts.map(([x, y]) => y - (m * x + b));
  const medR = median(resid);
  const mad = median(resid.map((r) => Math.abs(r - medR)));
  return { slopeMsPerS: m, interceptMs: b, pairs: sl.length, madMs: mad };
}

/* ── A FIT NEVER INTERPOLATES ACROSS UNOBSERVED TIME ─────────────────────────────────────────────
   `windowRuns(rec)` splits a key's floor windows at every EMPTY window and returns one array of
   `[windowIndex, floorMs]` pairs per continuous run, in time order.

   WHY AN EMPTY WINDOW IS A DISCONTINUITY AND NOT DROPOUT NOISE. Measured 2026-11-04 over the 14
   archived sidecars: of 65 device-handle-role keys, 63 hold NO empty window at all, over spans up to
   8.08 h and 97 windows. A window holds ~4000 packets at 130 Hz, so a 300 s window with none is the
   stream stopping rather than a late frame. The two keys that do hold holes carry 3 each at 5 min,
   and both already refuse on this tool's own rate bound.

   WHY THE FIT CANNOT SPAN ONE. Theil-Sen takes the median of pairwise slopes, so a pair straddling a
   hole divides an observed delay change by unobserved time. `anchor_us` is a controller counter whose
   epoch does not survive a link establishment (§🔒.7), and the archived nine-column sidecars carry no
   `anchor_epoch` to say whether one happened inside the hole — #4272 appended that column on
   2026-11-02, after these nights. `conn_handle` cannot stand in for it: #4378 measured 484 of 26 099
   over-bound anchor intervals on a row where the handle changed.

   SO A HOLE MAKES A NEW LINE, which is this tool's own idiom for a reconnect: the key already splits
   on `conn_handle` rather than carrying a step inside one line. Each run then meets the same floors —
   `MIN_WINDOWS`, `MIN_PAIR_GAP_S`, `RATE_BOUND_MS_PER_H` — so a run too short to fit refuses by name
   instead of borrowing a baseline from the other side of the hole. */
export function windowRuns(rec) {
  const ws = [...((rec && rec.wins) || new Map()).entries()].sort((a, b) => a[0] - b[0]);
  const runs = [];
  let cur = [];
  for (let i = 0; i < ws.length; i++) {
    if (i && ws[i][0] - ws[i - 1][0] > 1) {
      runs.push(cur);
      cur = [];
    }
    cur.push(ws[i]);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/* Every line a key yields, one per continuous run, each carrying what the key held around it. An
   empty key still yields one NAMED refusal: a key that folded no window must not vanish from both
   the lines and the refusals (§∅). */
export function floorLines(rec) {
  const runs = windowRuns(rec);
  const keyWindows = (rec.wins || new Map()).size;
  if (!runs.length)
    return [{ role: rec.role, conn: rec.conn, windows: 0, run: 1, runs: 0, holes: 0, keyWindows: 0, droppedWindows: 0, maxHoleMin: 0, ok: false, reason: 'no floor window folded for this key' }];
  const idx = [...(rec.wins || new Map()).keys()].sort((a, b) => a - b);
  let maxHole = 0;
  for (let i = 1; i < idx.length; i++) maxHole = Math.max(maxHole, idx[i] - idx[i - 1] - 1);
  return runs.map((run, i) => {
    const ln = floorLine({ role: rec.role, dev: rec.dev, conn: rec.conn, wins: new Map(run) });
    /* The coverage travels with the rate, so a reader never quotes one without the other. */
    return { ...ln, run: i + 1, runs: runs.length, holes: runs.length - 1, keyWindows, droppedWindows: keyWindows - run.length, maxHoleMin: (maxHole * WIN_S) / 60 };
  });
}

/* One line per continuous RUN, or a NAMED refusal. A refusal is a row in the report, never a dropped
   key. A rec holding a hole refuses here rather than fitting across it — `floorLines` is the caller
   that splits, and a caller that forgets to split gets told so by name. */
export function floorLine(rec) {
  const runs = windowRuns(rec);
  const base0 = { role: rec.role, conn: rec.conn, windows: (rec.wins || new Map()).size };
  if (runs.length > 1) return { ...base0, ok: false, reason: `${runs.length - 1} hole(s) in the floor windows — fit each run with floorLines()` };
  const pts = [...rec.wins.entries()].map(([w, d]) => [(w + 0.5) * WIN_S, d]).sort((a, b) => a[0] - b[0]);
  const base = { role: rec.role, conn: rec.conn, windows: pts.length };
  if (pts.length < MIN_WINDOWS) return { ...base, ok: false, reason: `only ${pts.length} floor window(s), need ${MIN_WINDOWS}` };
  const fit = theilSen(pts);
  if (!fit) return { ...base, ok: false, reason: `no window pair straddles ${MIN_PAIR_GAP_S} s` };
  const rateMsPerH = fit.slopeMsPerS * 3600;
  if (Math.abs(rateMsPerH) > RATE_BOUND_MS_PER_H) return { ...base, ok: false, reason: `implausible floor rate ${rateMsPerH.toFixed(0)} ms/h (bound +-${RATE_BOUND_MS_PER_H})` };
  return {
    ...base,
    ok: true,
    reason: null,
    rateMsPerH,
    madMs: fit.madMs,
    pairs: fit.pairs,
    t0S: pts[0][0],
    t1S: pts[pts.length - 1][0],
    spanH: (pts[pts.length - 1][0] - pts[0][0]) / 3600,
    at: (tS) => fit.slopeMsPerS * tS + fit.interceptMs
  };
}

/* ── THE OFFSET BETWEEN TWO LINES, read at the midpoint of their overlap ─────────────────────────
   Two rates that differ make the offset a function of time, so the pair reports the DRIFT across
   its own overlap beside the value. A reader who quotes the offset without the drift is quoting a
   constant the measurement does not offer. */
export function pairOffset(ecg, ppg) {
  const lo = Math.max(ecg.t0S, ppg.t0S),
    hi = Math.min(ecg.t1S, ppg.t1S);
  if (hi - lo < MIN_OVERLAP_S) return { ok: false, reason: `overlap ${Math.max(0, hi - lo).toFixed(0)} s under ${MIN_OVERLAP_S} s` };
  const mid = (lo + hi) / 2;
  return {
    ok: true,
    reason: null,
    overlapH: (hi - lo) / 3600,
    ppgMinusEcgMs: ppg.at(mid) - ecg.at(mid),
    driftOverOverlapMs: (ppg.rateMsPerH - ecg.rateMsPerH) * ((hi - lo) / 3600),
    ecgConn: ecg.conn,
    ppgConn: ppg.conn
  };
}

/* A beat offset is known only modulo one RR interval, so a difference of beat offsets is too. The
   reduction maps a disagreement into (-RR/2, RR/2] — the smallest it can honestly be. */
export function reduceModRR(d, rr) {
  if (!(rr > 0)) return null;
  const x = ((((d + rr / 2) % rr) + rr) % rr) - rr / 2;
  return x;
}

/* ── THE VERDICT ─────────────────────────────────────────────────────────────────────────────────
   `nights` is [{ night, floorMs }] and `beats` is [{ night, beatMs, rrMs }]. A pair is two nights
   that both carry a floor offset and a beat offset; the pair's disagreement is how far the two
   accounts of the MOVEMENT differ, modulo one RR. */
export function agreementPairs(nights, beats) {
  const bm = new Map(beats.map((b) => [b.night, b]));
  const fm = new Map(nights.map((f) => [f.night, f]));
  const all = [...new Set([...fm.keys(), ...bm.keys()])].sort();
  const pairs = [],
    excluded = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i],
        b = all[j];
      const fa = fm.get(a),
        fb = fm.get(b),
        ba = bm.get(a),
        bb = bm.get(b);
      if (!fa || !fb || !ba || !bb) {
        const why = [];
        if (!fa || !fb) why.push('no floor offset');
        if (!ba || !bb) why.push('no beat offset');
        excluded.push({ pair: `${a}/${b}`, reason: why.join(' and ') });
        continue;
      }
      const rr = (ba.rrMs + bb.rrMs) / 2;
      const dFloor = fb.floorMs - fa.floorMs;
      const dBeat = bb.beatMs - ba.beatMs;
      pairs.push({
        pair: `${a}/${b}`,
        floorMoveMs: dFloor,
        beatMoveMs: dBeat,
        rrMs: rr,
        disagreementMs: reduceModRR(dFloor - dBeat, rr)
      });
    }
  }
  return { pairs, excluded };
}

export function agreementVerdict({ pairs, excluded }, { tool = 'tools/pat-floor-offset.mjs', evidence = ['tools/pat-floor-offset.mjs'], at = undefined, commit = undefined } = {}) {
  const abs = pairs.map((p) => Math.abs(p.disagreementMs));
  const med = median(abs);
  let status, reason;
  if (!pairs.length) {
    status = 'NOT_RUN';
    reason = 'no night carries both a floor offset and a beat offset, so no pair was examined';
  } else if (pairs.length < MIN_PAIRS) {
    status = 'UNDERPOWERED';
    reason = `${pairs.length} pair(s) against a floor of ${MIN_PAIRS}; the median disagreement reads ${med.toFixed(1)} ms and decides nothing`;
  } else if (med <= DISAGREE_MAX_MS) {
    status = 'PASS';
    reason = null;
  } else {
    status = 'FAIL';
    reason = `median absolute disagreement ${med.toFixed(1)} ms over ${DISAGREE_MAX_MS} ms, so the floor sharpens a term it does not predict`;
  }
  return makeVerdict({
    gate: 'pat-floor-offset',
    status,
    population: { checked: pairs.length, eligible: pairs.length + excluded.length, excluded: excluded.length },
    criterion: { name: 'floor_beat_disagreement_median_abs', threshold: DISAGREE_MAX_MS, unit: 'ms', direction: 'lte' },
    /* The contract refuses a NOT_RUN that carries a result: nothing was examined, so nothing was
       measured, and an empty pair list is not a measurement of zero. */
    result: status === 'NOT_RUN' ? null : { medianAbsDisagreementMs: med, pairs, excludedPairs: excluded },
    evidence,
    reason,
    tool,
    at,
    commit
  });
}

/* The corpus-free sample the adoption gate runs: four synthetic nights whose beat account trails
   the floor account by 10 ms per step, so the six night pairs disagree by 10, 10, 10, 20, 20 and
   30 ms and the PASS branch is exercised where the captures are not. Its evidence names this
   function, so no reader can mistake the sample for a corpus result. */
export function verdictSample() {
  const step = 600,
    slip = 10;
  const dates = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'];
  const nights = dates.map((night, k) => ({ night, floorMs: step * k }));
  const beats = dates.map((night, k) => ({ night, beatMs: step * k - slip * k, rrMs: 1000 }));
  return agreementVerdict(agreementPairs(nights, beats), {
    evidence: ['tools/pat-floor-offset.mjs#verdictSample'],
    at: '2026-11-04T00:00:00Z'
  });
}

/* ── THE CORPUS WALK ─────────────────────────────────────────────────────────────────────────────
   A night directory holds one sidecar per device. Device ordinals are assigned by first appearance
   so the report can name two devices apart without printing either address. */
export function nightReport(dir) {
  const files = readdirSync(dir)
    .filter((f) => f.includes('RADIOCLOCK'))
    .sort();
  const keys = new Map();
  let rows = 0,
    used = 0,
    read = 0;
  const perFile = [];
  for (const f of files) {
    const p = join(dir, f);
    if (!statSync(p).isFile()) continue;
    read++;
    const folder = makeFolder();
    forEachLine(p, (line) => folder.feed(line));
    const r = folder.done();
    rows += r.rows;
    used += r.used;
    perFile.push(r);
    for (const [k, rec] of r.keys) {
      let cur = keys.get(k);
      if (!cur) {
        keys.set(k, rec);
        continue;
      }
      for (const [w, d] of rec.wins) {
        const had = cur.wins.get(w);
        if (had === undefined || d < had) cur.wins.set(w, d);
      }
    }
  }
  /* Device ordinals are assigned by first appearance, so the report names two devices apart without
     printing either address. */
  const ord = new Map();
  const lines = [],
    refusals = [];
  for (const rec of keys.values()) {
    if (!ord.has(rec.dev)) ord.set(rec.dev, ord.size + 1);
    for (const ln of floorLines(rec)) {
      ln.device = `dev#${ord.get(rec.dev)}`;
      (ln.ok ? lines : refusals).push(ln);
    }
  }
  const ecg = lines.filter((l) => l.role === 'ecg'),
    ppg = lines.filter((l) => l.role === 'ppg');
  const segments = [],
    segRefusals = [];
  for (const e of ecg)
    for (const g of ppg) {
      const o = pairOffset(e, g);
      /* The tag names the RUN only where the key holds more than one, so a hole-free night's report
         reads byte-identical to before this split landed. */
      const tag = { ecg: `${e.device}/${e.conn}${e.runs > 1 ? `r${e.run}` : ''}`, ppg: `${g.device}/${g.conn}${g.runs > 1 ? `r${g.run}` : ''}` };
      if (o.ok) segments.push({ ...tag, ...o });
      else segRefusals.push({ ...tag, reason: o.reason });
    }
  segments.sort((a, b) => b.overlapH - a.overlapH);
  /* A NAMED DISAGREEMENT, not a silent one. */
  const clock = {
    aclSpanH: perFile.reduce((a, f) => Math.max(a, f.aclSpanH ?? 0), 0),
    civilPairs: perFile.reduce((a, f) => a + f.civilPairs, 0),
    skewMoved: perFile.reduce((a, f) => a + f.civilSkewMoved, 0),
    skewExtremeS: perFile.reduce((a, f) => (Math.abs(f.civilSkewExtremeS) > Math.abs(a) ? f.civilSkewExtremeS : a), 0),
    civilBackSteps: perFile.reduce((a, f) => a + f.civilBackSteps, 0)
  };
  return { files: read, rows, used, clock, lines, refusals, segments, segRefusals };
}

/* ── THE BEAT SIDE ───────────────────────────────────────────────────────────────────────────────
   `tools/pat-host-offset.mjs --scan --json` writes one FLAT row per (night, window). A night's beat
   offset is the median of its windows, and the half-spread rides along as the scatter a reader needs
   to size the disagreement against. */
export function readBeats(path) {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  const by = new Map();
  for (const r of j.rows || []) {
    if (!Number.isFinite(r.bestOffsetModRR) || !Number.isFinite(r.medRRms)) continue;
    if (!by.has(r.night)) by.set(r.night, { offs: [], rrs: [] });
    const g = by.get(r.night);
    g.offs.push(r.bestOffsetModRR);
    g.rrs.push(r.medRRms);
  }
  return [...by.entries()]
    .map(([night, g]) => ({
      night,
      beatMs: median(g.offs),
      rrMs: median(g.rrs),
      windows: g.offs.length,
      spreadMs: g.offs.length > 1 ? Math.max(...g.offs) - Math.min(...g.offs) : 0
    }))
    .sort((a, b) => (a.night < b.night ? -1 : 1));
}

/* ── SELFTEST ────────────────────────────────────────────────────────────────────────────────────
   Five targets, one control that would pass a stub, and one anti-claim. */
export function selftest() {
  let n = 0;
  const ok = (cond, what) => {
    n++;
    if (!cond) {
      console.error(`FAIL: ${what}`);
      process.exitCode = 1;
      throw new Error(what);
    }
  };
  const near = (a, b, tol, what) => ok(Math.abs(a - b) <= tol, `${what} (got ${a}, want ${b} +-${tol})`);

  /* 1 — an exact line is recovered exactly */
  const clean = [0, 1800, 3600, 5400, 7200].map((t) => [t, 100 - 0.02 * t]);
  near(theilSen(clean).slopeMsPerS * 3600, -72, 1e-9, 'theilSen recovers an exact slope');

  /* 2 — one gross outlier does not move the slope (the whole reason for a median of slopes) */
  const dirty = [...clean, [4500, 9999]];
  near(theilSen(dirty).slopeMsPerS * 3600, -72, 1e-9, 'theilSen resists one gross outlier');

  /* 3 — no pair over the gap refuses, rather than fitting a short baseline */
  ok(
    theilSen([
      [0, 0],
      [60, 5]
    ]) === null,
    'theilSen refuses when no pair straddles the gap'
  );

  /* 4 — the window keeps the MINIMUM, and the key separates conn_handle */
  const head = 'Phone timestamp;device;meas;last_sensor_ns;conn_handle;event_counter;anchor_us;vs_rx_ns;acl_rx_ns';
  const row = (hhmmss, conn, meas, delayMs) => `2026-10-30T${hhmmss}.000;AA;${meas};1000000000;${conn};1;2;3;${(1000000000 + (EPOCH2000_MS + delayMs) * 1e6).toFixed(0)}`;
  const fw = floorWindows([head, row('22:00:00', 64, 0, 40), row('22:01:00', 64, 0, 12), row('22:02:00', 65, 0, 99)]);
  ok(fw.keys.size === 2, 'one device on two conn_handles gives two lines');
  const same = [...fw.keys.values()].find((r) => r.conn === '64');
  near([...same.wins.values()][0], 12, 1e-6, 'the window keeps the floor, not the last arrival');

  /* 4b — THE AXIS IS acl_rx_ns, NOT THE CIVIL STAMP. Two rows share one civil stamp and sit 10 min
     apart on the host realtime clock; they must land in different floor windows. Written against the
     civil stamp this assertion fails, which is the error the 2026-10-31 night carried. */
  const rowAt = (ts, conn, meas, delayMs, aclOffsetS) => `${ts};AA;${meas};1000000000;${conn};1;2;3;${(1e9 + (EPOCH2000_MS + delayMs) * 1e6 + aclOffsetS * 1e9).toFixed(0)}`;
  const axis = floorWindows([head, rowAt('2026-10-31T22:00:00.000', 64, 0, 10, 0), rowAt('2026-10-31T22:00:00.000', 64, 0, 20, 600)]);
  ok([...axis.keys.values()][0].wins.size === 2, 'the floor window follows acl_rx_ns, not the civil stamp');

  /* 4c — A CIVIL REWIND IS COUNTED, AND MIDNIGHT IS NOT. The DST fall-back the archive carries steps
     the stamp back an hour; the wrap at midnight steps it back a day and is no rewind at all. */
  const dst = floorWindows([head, rowAt('2026-11-01T01:59:59.000', 64, 0, 10, 0), rowAt('2026-11-01T01:00:01.000', 64, 0, 10, 2), rowAt('2026-11-01T01:30:00.000', 64, 0, 10, 1800)]);
  ok(dst.civilBackSteps === 1, `the civil rewind is counted once (got ${dst.civilBackSteps})`);
  ok(dst.civilSkewMoved === 2, `both post-rewind rows read a moved skew (got ${dst.civilSkewMoved})`);
  near(dst.civilSkewExtremeS, -3600, 2, 'the rewind reads as a one-hour skew step');
  const mid = floorWindows([head, rowAt('2026-10-31T23:59:58.000', 64, 0, 10, 0), rowAt('2026-11-01T00:00:01.000', 64, 0, 10, 3)]);
  ok(mid.civilBackSteps === 0, `the midnight wrap is not a rewind (got ${mid.civilBackSteps})`);
  ok(mid.civilSkewMoved === 0, `the midnight wrap moves no skew (got ${mid.civilSkewMoved})`);

  /* 5 — an implausible rate refuses by name. The windows are CONTIGUOUS, because a holed key now
     refuses for the hole first and would pass this assertion on the wrong reason. */
  const wild = {
    role: 'ecg',
    dev: 'AA',
    conn: '1',
    wins: new Map([
      [0, 0],
      [1, 1e9],
      [2, 2e9],
      [3, 3e9],
      [4, 4e9],
      [5, 5e9]
    ])
  };
  const wl = floorLine(wild);
  ok(wl.ok === false && /implausible floor rate/.test(wl.reason), 'an implausible floor rate refuses by name');

  /* 5b — A HOLE MAKES A NEW LINE, and `floorLine` refuses to span one. */
  const holed = {
    role: 'ecg',
    dev: 'AA',
    conn: '1',
    wins: new Map([
      [0, 100],
      [1, 94],
      [2, 88],
      [3, 82],
      [4, 76],
      [5, 70],
      [40, 10],
      [41, 4],
      [42, -2],
      [43, -8],
      [44, -14],
      [45, -20]
    ])
  };
  const hl = floorLine(holed);
  ok(hl.ok === false && /hole\(s\) in the floor windows/.test(hl.reason), 'a holed key refuses in floorLine by name');
  const hls = floorLines(holed);
  ok(hls.length === 2, `a one-hole key yields two lines (got ${hls.length})`);
  ok(
    hls.every((l) => l.ok && l.windows === 6 && l.runs === 2 && l.holes === 1 && l.keyWindows === 12 && l.droppedWindows === 6),
    'each run fits alone and carries the coverage the key held around it'
  );
  near(hls[0].maxHoleMin, 34 * 5, 1e-9, 'the largest hole reads in minutes of empty windows');
  near(hls[0].rateMsPerH, -72, 1e-9, 'the first run recovers its own rate');
  /* 5c — CONTROL: the same 12 windows with NO hole fit as one line, so 5b cannot pass on a stub that
     always splits. */
  const whole = { role: 'ecg', dev: 'AA', conn: '1', wins: new Map() };
  for (let w = 0; w < 12; w++) whole.wins.set(w, 100 - 6 * w);
  const wls = floorLines(whole);
  ok(wls.length === 1 && wls[0].ok && wls[0].runs === 1 && wls[0].holes === 0 && wls[0].droppedWindows === 0, 'CONTROL: a contiguous key stays one line with no coverage loss');
  near(wls[0].rateMsPerH, -72, 1e-9, 'CONTROL: the whole-key rate is the one each run recovers');
  /* 5d — a key that folded nothing is a NAMED refusal, never an absent row (§∅). */
  const empty = floorLines({ role: 'ppg', dev: 'AA', conn: '1', wins: new Map() });
  ok(empty.length === 1 && empty[0].ok === false && /no floor window folded/.test(empty[0].reason), 'an empty key yields one named refusal');

  /* 6 — the modulo reduction is the smallest honest disagreement */
  near(reduceModRR(657 - 629, 1040), 28, 1e-9, 'a small disagreement passes through unchanged');
  near(reduceModRR(1069, 1040), 29, 1e-9, 'a disagreement over one RR folds into it');

  /* 7 — CONTROL: the reduction does not simply return zero, so test 6 cannot pass on a stub */
  near(reduceModRR(500, 1040), 500, 1e-9, 'CONTROL: a half-RR disagreement stays large');

  /* 8 — one pair never reads PASS, however well it agrees */
  const one = agreementPairs(
    [
      { night: 'a', floorMs: 0 },
      { night: 'b', floorMs: 100 }
    ],
    [
      { night: 'a', beatMs: 0, rrMs: 1000 },
      { night: 'b', beatMs: 100, rrMs: 1000 }
    ]
  );
  const v1 = agreementVerdict(one);
  ok(v1.status === 'UNDERPOWERED', `one perfect pair reads UNDERPOWERED (got ${v1.status})`);

  /* 9 — nothing examined reads NOT_RUN, never PASS */
  ok(agreementVerdict({ pairs: [], excluded: [] }).status === 'NOT_RUN', 'no pair reads NOT_RUN');

  /* 10 — the posted criterion decides both ways at four pairs */
  const vs = verdictSample();
  ok(vs.status === 'PASS', `the sample passes the posted criterion (got ${vs.status})`);
  near(vs.result.medianAbsDisagreementMs, 15, 1e-9, 'the sample median is 15 ms');
  ok(vs.population.checked === 6, `the sample examines six pairs (got ${vs.population.checked})`);
  const bad = agreementVerdict({
    pairs: [100, 120, 140, 160].map((d, i) => ({ pair: `p${i}`, disagreementMs: d })),
    excluded: []
  });
  ok(bad.status === 'FAIL', `four disagreeing pairs read FAIL (got ${bad.status})`);

  /* 11 — ANTI-CLAIM: the population arithmetic the contract requires */
  const mixed = agreementPairs(
    [
      { night: 'a', floorMs: 0 },
      { night: 'b', floorMs: 1 },
      { night: 'c', floorMs: 2 }
    ],
    [
      { night: 'a', beatMs: 0, rrMs: 1000 },
      { night: 'b', beatMs: 1, rrMs: 1000 }
    ]
  );
  const vm = agreementVerdict(mixed);
  ok(vm.population.checked + vm.population.excluded === vm.population.eligible, 'checked + excluded = eligible');
  ok(vm.population.excluded === 2, `the two pairs touching the beat-less night are excluded (got ${vm.population.excluded})`);

  console.log(`all ${n} selftests passed`);
  return n;
}

const IS_CLI = isCliEntry(import.meta.url);
if (IS_CLI && process.argv.includes('--selftest')) {
  selftest();
} else if (IS_CLI && process.argv.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
} else if (IS_CLI) {
  const DIR = arg('--dir', 'uploads/vigil-archive/captures');
  const ONLY = arg('--night', null);
  const BEATS = arg('--beats', null);
  const JSON_OUT = process.argv.includes('--json');
  const base = DIR.startsWith('/') ? DIR : join(ROOT, DIR);
  if (!existsSync(base)) {
    console.error(`pat-floor-offset: ${DIR} not found. The raw corpus is gitignored — pass --dir.`);
    process.exit(2);
  }
  /* THE NIGHT POPULATION IS SNAPSHOTTED ACROSS THE READ. A run that opens over one night set and
     closes over another covers neither, so the movement verdict publishes beside this tool's own. */
  const popBefore = snapshotNights(base);
  /* THE SNAPSHOT IS THE LISTING. A second `readdirSync` here would describe one population and score
     another, so `--night` filters the snapshot's own nights and the count it leaves unread is named. */
  const nights = popBefore.nights.filter((d) => !ONLY || d === ONLY);
  const rows = [],
    floors = [];
  for (const night of nights) {
    const rep = nightReport(join(base, night));
    if (!rep.files) continue;
    rows.push({ night, ...rep, lines: rep.lines.map(({ at, ...rest }) => rest) });
    if (rep.segments.length) floors.push({ night, floorMs: rep.segments[0].ppgMinusEcgMs });
  }
  const beats = BEATS ? readBeats(BEATS) : [];
  const agreement = agreementPairs(floors, beats);
  const verdict = agreementVerdict(agreement, { evidence: ['tools/pat-floor-offset.mjs', DIR, ...(BEATS ? [BEATS] : [])] });
  const population = populationVerdict(popBefore, snapshotNights(base), { tool: 'tools/pat-floor-offset.mjs', evidence: ['tools/pat-floor-offset.mjs'] });
  if (JSON_OUT) {
    console.log(JSON.stringify({ dir: DIR, nights: rows, floors, beats, agreement, verdict, population }, null, 2));
  } else {
    for (const r of rows) {
      console.log(`\n${r.night} — ${r.files} sidecar(s), ${r.rows} rows, ${r.used} folded`);
      const c = r.clock;
      const share = c.civilPairs ? (100 * c.skewMoved) / c.civilPairs : 0;
      console.log(
        `  clock: civil-vs-acl skew moved on ${c.skewMoved}/${c.civilPairs} rows (${share.toFixed(1)} %), extreme ${c.skewExtremeS.toFixed(1)} s, civil backward steps ${c.civilBackSteps}` +
          (c.civilBackSteps > 0 && Math.abs(c.skewExtremeS) > CIVIL_REWIND_MIN_S ? ' — THE CIVIL STAMP REWOUND MID-RECORDING' : '')
      );
      /* THE COVERAGE PRINTS BESIDE THE RATE, never behind a flag: a rate over a run is a rate over
         part of the key wherever `holes` reads above 0. */
      for (const l of r.lines)
        console.log(
          `  ${l.device} ${l.role} conn=${l.conn} windows=${l.windows} rate=${l.rateMsPerH.toFixed(2)} ms/h MAD=${l.madMs.toFixed(2)} ms span=${l.spanH.toFixed(2)} h` +
            ` run=${l.run}/${l.runs} holes=${l.holes}` +
            (l.holes > 0 ? ` dropped=${l.droppedWindows} window(s), largest hole ${l.maxHoleMin.toFixed(0)} min` : '')
        );
      for (const l of r.refusals) console.log(`  ${l.device} ${l.role} conn=${l.conn} REFUSED — ${l.reason}` + (l.runs > 1 ? ` [run ${l.run}/${l.runs}]` : ''));
      for (const s of r.segments) console.log(`  offset ppg-ecg = ${s.ppgMinusEcgMs.toFixed(2)} ms over ${s.overlapH.toFixed(2)} h, drift ${s.driftOverOverlapMs.toFixed(2)} ms [${s.ecg} x ${s.ppg}]`);
      for (const s of r.segRefusals) console.log(`  offset REFUSED — ${s.reason} [${s.ecg} x ${s.ppg}]`);
    }
    if (beats.length) {
      console.log('\nbeat offsets (median over scored windows):');
      for (const b of beats) console.log(`  ${b.night} beat=${b.beatMs.toFixed(0)} ms RR=${b.rrMs.toFixed(0)} ms windows=${b.windows} spread=${b.spreadMs.toFixed(0)} ms`);
    }
    for (const p of agreement.pairs)
      console.log(`\n${p.pair}: floor moved ${p.floorMoveMs.toFixed(2)} ms, beats moved ${p.beatMoveMs.toFixed(0)} ms mod RR ${p.rrMs.toFixed(0)} — disagreement ${p.disagreementMs.toFixed(1)} ms`);
    /* MOVEMENT, NEVER COVERAGE: the night counts beside it are what the run actually read. */
    console.log(
      `\npopulation: ${popBefore.n} night(s) offered under the root · ${nights.length} selected · ${rows.length} folded · movement ${population.status}` +
        (ONLY ? ` · --night left ${popBefore.n - nights.length} offered night(s) unread` : '') +
        (population.reason ? ` — ${population.reason}` : '')
    );
    const rl = ruleLine(population);
    if (rl) console.log(rl);
    console.log('POPULATION ' + JSON.stringify(population));
    printVerdict(verdict);
  }
}
