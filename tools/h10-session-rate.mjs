#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * h10-session-rate.mjs — what moves the ECG sample rate between sessions of ONE chest strap
 * ------------------------------------------------------------------------------------------------
 * Residue `2026-10-20-h10-session-fs-moves-hundreds-of-ppm-between-sessions`, the `ecgdex-dsp.js`
 * half. The row reports the per-session rate estimate moving by hundreds of ppm on one device, which
 * two repo figures say a crystal cannot do. This tool decides WHICH of two causes produces that
 * movement, and it decides nothing about the right rate.
 *
 * THE TWO CANDIDATES.
 *   (1) THE CRYSTAL. The device's own oscillator differs between sessions, by temperature or by age.
 *       Then no filter narrows the spread, and the estimator reports a real thing.
 *   (2) THE ADMITTED SUB-GAP STEPS. `ecgTimingScan` runs two independent axes over one file and
 *       guards them DIFFERENTLY. The device-counter axis admits every step `0 < dn < SAMPLE_MAX_MS`
 *       (50 ms) into the mean it divides. The host `[ms]` axis first latches `msStep` from the first
 *       delta under 50 ms, then treats anything `> msStep * 2.5` (≈19.2 ms at 130 Hz) as a DROPOUT
 *       CANDIDATE and keeps it out of its own mean. So a step of 19.2–50 ms is a dropout on one axis
 *       and a sample interval on the other, and `ecgTimingResolve` prefers the axis that admits it.
 *       A session carrying more short dropouts then reads a LOWER rate, with no crystal involved.
 *
 * ⚠️ THE SHIPPED COMMENT DESCRIBES THE GUARD IT DOES NOT USE. `ecgdex-dsp.js:4961` reads "the same
 * `< 50` guard the `[ms]` path uses excludes dropout rows from the rate". The `[ms]` path's dropout
 * exclusion is `msStep * 2.5`, which is 2.6x tighter; `< 50` is only that path's SECOND filter, and
 * it applies to deltas that already passed the first. A reader costing the rate off that sentence
 * believes the two axes agree on what a dropout is.
 *
 * THE CRITERION IS PRE-STATED AND IT DISCRIMINATES. Across sessions of one device, if the admitted
 * band explains the movement, excluding it collapses the spread: `tight_fs_spread_ppm <= 100`, a
 * figure three times the ~30 ppm a crystal of this class holds and a fifth of the widest published
 * per-session spread. The premise needs the shipped spread to exceed 300 ppm first — below that
 * there is no movement to explain and the run says so instead of passing.
 *
 * WHAT THE REPO ALREADY MEASURED, so no figure here is confused with another.
 *   · `briefs/H10-ECG-RATE-CORPUS-CHECK-2026-08-04-BRIEF.md` §2, over 50 exported files: mean rate
 *     median 129.9888 Hz, min 129.8869, max 130.0883 — a ~1550 ppm total spread, and §4 refuses a
 *     re-calibration. That brief measured the SPREAD; it did not ask what produces it.
 *   · `tools/trio-batch.mjs:2953` sizes its 0.05 Hz merge refusal against "~30 ppm" of crystal and a
 *     "52 ppm" widest per-night spread. That bound stays: nothing here changes a constant.
 *   · `ecgdex-dsp.js:5141`'s 77 ppm window is the span of ONE claim — 129.9866–129.9966 Hz — and the
 *     run below names which quantity it describes.
 *
 * THE POPULATION IS SESSIONS, NOT NIGHTS. One exported stream is one session, and the row's defect
 * is between sessions. A stream with no device-counter column cannot take the preferred axis at all,
 * so it is excluded BY NAME and counted, never folded in on the fallback.
 *
 * THE ROUNDING IS THE THIRD FINDING AND IT IS FREE. Both host-axis branches of the estimator wrap
 * their result in `Math.round`, so they emit an integer rate. 300 ppm at 130 Hz is 0.039 Hz, so
 * every movement this row is about lands inside one rounding step: a session on either host branch
 * reports exactly 130 and the whole question disappears. The run reports how many sessions would
 * take that branch and how much each one's rounding discards.
 *
 *   node tools/h10-session-rate.mjs                 # per-session table on stderr, one verdict on stdout
 *   node tools/h10-session-rate.mjs --json          # the object alone
 *   node tools/h10-session-rate.mjs --limit 6       # the six largest streams, for a quick pass
 *   node tools/h10-session-rate.mjs --selftest      # the scanner's own properties, no corpus
 *   node tools/h10-session-rate.mjs --verdict-sample
 *
 * MEMORY. Each stream is read in 4 MiB chunks and reduced to scalars plus one bounded step-count
 * map, so a 67 MiB file costs its chunk and nothing else. Nothing holds a sample.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

import { execSync } from 'node:child_process';
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpusSearch } from './regen-goldens-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
/* The verdict's provenance. A null commit must say WHY it is null (§∅): an absent value is never a
   silent one, and `verdict-adoption --check` reds a sample that omits the reason. */
const COMMIT = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
})();
export const PRODUCED_BY = COMMIT ? { tool: 'tools/h10-session-rate.mjs', commit: COMMIT } : { tool: 'tools/h10-session-rate.mjs', commit: null, commitReason: 'the tree is not a git checkout' };

/* ## MEASURED — 2026-10-20, every exported ECG stream the corpus root holds
   Reading the first 100 000 admitted step(s) of each (the bound's own cost is priced below).
   642 streams by name, 54 excluded by name, 588 read, 271 of them byte-equal copies of another,
   so the criterion ran on **317 distinct sessions** over 58 nights. 50 further names turned away:
   `_partNNofNN` slices and one `_clip`, which are pieces of a session and not sessions.

   THE PRE-STATED CRITERION FAILED, AND THE MECHANISM IS REFUTED. The band the two axes disagree
   about carries **0 steps on all 317 sessions**. `tightSpreadPpm` therefore equals `shippedSpreadPpm`
   to the digit, 1745.9 ppm, and the guard asymmetry accounts for none of the movement. A refutation,
   not a defect: the band is empty by count, which no read bound can bias.

   WHAT DOES MOVE, and what it is not:
     · between-session spread **1745.9 ppm** (129.886432–130.113383 Hz), three orders above a crystal;
     · it is not our own nominal — 12 distinct sessions fail the Clock Contract's drawn bound and come
       out, and the spread does not move a digit. Their modal share runs 70.1–84.7 %, and their
       nominal share is **0**: not one step of our 7 692 307 ns, so these are not pre-80e05501
       captures but a third shape, coarse enough to fail a 67 % bound and pass a 99 % one;
     · it is not the short sessions — the 1000-step floor takes 10 distinct sessions out, and the
       spread without the floor is **1745.9 ppm**, the same figure;
     · it is not an averaging artefact — the MODAL step moves with the mean, 1763.9 ppm.

   NIGHTS, against the two bounds the repo already ships:
     · **28 of 30** multi-session nights exceed `MAX_CRYSTAL_SPREAD_PPM = 50`, the bound whose own
       comment reads "A crystal does not change rate between fragments of one night" and whose
       refusal in `dual-clock-rate.mjs:346` reads "this is not a rate";
     · **7 of 30** exceed `mergeEcg`'s 0.05 Hz = 385 ppm and would throw `ECG sessions disagree on
       fs`, the widest pair at **1524.3 ppm**;
     · so 21 nights sit in the gap between two shipped numbers for one quantity.

   THE SHIPPED COMMENT'S WINDOW. `ecgdex-dsp.js:5141` quotes 129.9866–129.9966 Hz, 77 ppm wide. It
   holds **77 of 317** sessions; 137 sit above it, by up to 898.4 ppm, and 103 below, by up to
   770.6 ppm. The window describes neither the population nor its centre.

   THE ROUNDING FALLBACK. Every one of the 317 sessions sits off the nominal by more than the host
   branches' `Math.round` can carry: **up to 873.6 ppm** would quantise away if a stream arrived
   without its counter column. The counter is what keeps the estimate; the fallbacks cannot.

   🔴 THE BOUND COSTS FAR MORE THAN A 17-STREAM SAMPLE SAID, AND IT NARROWS THE SPREAD. A whole-file
   pass over the 115 LARGEST sessions, every one of them truncated by the bound, puts the
   prefix-against-whole disagreement at median **55.5 ppm** and worst **1278.8 ppm**, with **30 of
   115 over this tool's own 100 ppm ceiling**. The 17-stream stride control below priced the same
   bound at 166.4 ppm, eight times smaller, because an unbiased 17-stream sample held only three
   sessions long enough to truncate — so the stride control under-prices a cost that falls ONLY on
   long sessions, and the lesson is that the sample must be drawn on the quantity at issue.
   The direction matters as much as the size: read whole, those 115 span 129.822430–130.041730 Hz,
   **1686.9 ppm**, and their minimum sits BELOW the bounded pass's global minimum of 129.886432. The
   bound understates the movement. Every figure above is therefore a FLOOR, and the mechanism
   refutation is untouched, because the band is empty by count on both passes.

   WITHIN A SESSION, and the bound's own cost. Over the prefix the within-session spread reads
   median 8.8 ppm, max 257.8 ppm — so a session is nearly one rate and the movement is between them.
   But the bound costs precision exactly there: on an unbiased 17-stream stride sample, read whole and
   read bounded, the two disagree by **up to 166.4 ppm**, all of it on the three sessions over 1.9 M
   samples. That is above this tool's own 100 ppm ceiling, so a per-session rate claim needs the full
   read, and the within-session figures above are a FLOOR. The 1745.9 ppm headline survives the bound
   at 10x its worst bias, and the band emptiness is exact. */

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const JSON_OUT = has('--json');
const say = (s) => {
  if (!JSON_OUT) console.error(s);
};

/* ═══════════════════════════ THE NODE'S OWN CONSTANTS, NOT NEW ONES ════════════════════════════ */
/* `ecgdex-dsp.js:4898` — above this a delta is a dropout candidate, never a sample interval. */
export const SAMPLE_MAX_MS = 50;
export const SAMPLE_MAX_NS = SAMPLE_MAX_MS * 1e6;
/* `ecgdex-dsp.js:4985` — the host axis's gap threshold, a multiple of its own latched step. */
export const GAP_MULT = 2.5;
/* `ecgdex-dsp.js:5170` — the rate a stream with neither axis falls back to. */
export const FS_ASSUMED = 130;
/* ⚠️ THE COUNTER COLUMN WAS NOT ALWAYS THE DEVICE'S, and a pooled rate cannot see that.
   `DEVICE-RATE-TRUTH-2026-08-05` §4.1: before commit `80e05501` the capture host built `sensor_ns`
   off the NOMINAL rate, so a pre-break session's counter steps are OUR OWN 7 692 307 ns on 98.63 % of
   samples, reading 130.00001 Hz. After the break the same column reads 129.951–130.072 with a nominal
   share of 0.02 %. So a pre-break stream is a DRAWN axis — never a clock, by the Clock Contract's own
   rule — and folding one into a rate spread measures our fallback, not the strap. Two independent
   tests exclude it, each the one its own source states.
     · `clock.js CK_AXIS_DRAWN_SHARE = 0.67` — a stream whose inter-sample deltas are ≥ 67 % one value
       was drawn. Post-break sessions measure 12–30 % here, so the test has real margin.
     · THE NOMINAL SHARE, which that brief's method note demands be reported beside every rate: "a
       share above a few percent means the number is ours, not the device's". 2 % sits between 0.02 %
       and 98.63 % with three orders of margin either way. */
export const DRAWN_SHARE = 0.67;
export const NOMINAL_SHARE_MAX = 0.02;
export const NOMINAL_STEP_NS = Object.freeze([7692307, 7692308]);
/* A RATE NEEDS A SESSION. 1000 admitted steps is 7.7 s of signal, and the mean step's standard error
   over that few samples approaches the criterion itself, so a shorter stream is excluded by name and
   counted. The run also reports the spread WITHOUT this floor, so the floor's own effect is visible. */
export const MIN_STEPS = 1000;
/* ⚠️ A SECOND SHIPPED BOUND ON THE SAME QUANTITY, and it is 7.7x tighter than the merge's.
   `device-stability.mjs MAX_CRYSTAL_SPREAD_PPM = 50` is imported rather than copied, because its
   comment states the rule this unit is measuring against: "A crystal does not change rate between
   fragments of one night", and `dual-clock-rate.mjs:346` REFUSES such a night in those words — "this
   is not a rate". `mergeEcg` admits the same night until the pair exceeds 0.05 Hz, which is 385 ppm.
   So the repo already disagrees with itself about what a night's fragments may do, and this run says
   how many nights fall in the gap.
   The same module carries the OTHER drawn threshold: `DRAWN_MODAL_SHARE = 0.99`, against the Clock
   Contract's `CK_AXIS_DRAWN_SHARE = 0.67`. This tool excludes at the Contract's bound, which is the
   conservative choice, and reports the modal share of every session it turns away so the gap between
   the two bounds is visible rather than assumed. */
import { DRAWN_MODAL_SHARE, MAX_CRYSTAL_SPREAD_PPM } from './device-stability.mjs';
import { isCliEntry } from './argv-guard.mjs';
/* THE WINDOW THE SHIPPED COMMENT QUOTES. `ecgdex-dsp.js:5141` reads "measured over the box corpus
   the H10's real rate is 129.9866–129.9966 Hz" — a 77 ppm window, and the run reports how many
   sessions of that same corpus sit inside it. Nothing here edits the comment or the constant. */
export const COMMENT_WINDOW_HZ = Object.freeze([129.9866, 129.9966]);
/* THE PRE-STATED CRITERION, and the premise it needs. */
export const TIGHT_SPREAD_CEIL_PPM = 100;
export const SHIPPED_SPREAD_FLOOR_PPM = 300;
/* The step map is bounded: a stream whose counter column is junk must not become a heap. */
export const STEP_KEYS_MAX = 400000;
/* A resync is a CHANGE OF CLOCK, not a dropout (Clock Contract §7), and the two must not be summed:
   one real seam in this corpus moves the host column by 2.4e11 ms, which would swamp every dropout
   in the same total. Anything past a minute is counted as a seam and kept out of the gap total. */
export const SEAM_MS = 60000;
/* The within-session rate is read over blocks of admitted steps, so one pass answers both questions:
   how far sessions sit apart, and how far ONE session moves inside itself. 100 000 steps is about
   13 min at 130 Hz, and a 4.9-million-row stream carries 49 of them. */
export const BLOCK_STEPS = 100000;
const CHUNK = 4 << 20;

/* ═════════════════════════════════════════ THE SCANNER ═════════════════════════════════════════
   A mirror of `ecgTimingScan`'s two axes, with ONE addition: every admitted device-counter step is
   counted by value, so the same pass yields the shipped mean, the modal step, the median step and
   the mean over any narrower band — without a second read of the file. The mirror is deliberate and
   it is the point: a reimplementation that guarded the axes the same way could not measure the
   asymmetry between them. */
export function scanner(opts = {}) {
  /* The block width is injectable for the selftest ALONE: a battery that had to feed 100 000 rows to
     reach the second block would be slow enough that nobody would run it, and the rule under test is
     the splitting, not the width. */
  const BS = opts.blockSteps || BLOCK_STEPS;
  let nsCol = null,
    msCol = 2;
  let prevNs = null,
    nsStepSum = 0,
    nsStepN = 0;
  let prevMs = null,
    msStep = null,
    stepSum = 0,
    stepN = 0,
    gaps = 0,
    gapTotal = 0,
    firstMs = null,
    lastMs = null;
  let rows = 0,
    nsRows = 0,
    seams = 0,
    seamTotal = 0;
  const steps = new Map();
  const blocks = [];
  let blockN = 0,
    blockSum = 0;
  let keysFull = false;
  return {
    /* BY HEADER NAME, as the node does: a positional guess is silently wrong on a layout it was not
       written for. The `[ms]` column is located the same way, and falls back to the node's own
       position-2 reading when the header does not name it. */
    header(cols) {
      for (let i = 0; i < cols.length; i++) {
        if (/sensor\s*timestamp/i.test(cols[i])) nsCol = i;
        else if (/^\s*timestamp\s*\[ms\]/i.test(cols[i])) msCol = i;
      }
    },
    row(p) {
      rows++;
      if (nsCol !== null && p.length > nsCol) {
        const raw = p[nsCol];
        const ns = raw === '' || raw == null ? NaN : Number(raw);
        if (isFinite(ns)) {
          nsRows++;
          if (prevNs !== null) {
            /* THE ONE DELIBERATE DEVIATION FROM THE NODE, and it is why the map works. The node
               divides each counter reading by 1e6 and subtracts the quotients, so a step of one
               fixed device period arrives as a few hundred distinct floats — cancellation at a
               magnitude of 1e6 ms leaves about 1e-10 of noise. Subtracting the INTEGER readings
               first is exact (both sit far below 2^53), so one device period is one map key. The
               rate the two produce agrees to about 1e-13, and the guard is the same test in ns. */
            const dn = ns - prevNs;
            if (dn > 0 && dn < SAMPLE_MAX_NS) {
              nsStepSum += dn;
              nsStepN++;
              blockSum += dn;
              if (++blockN >= BS) {
                blocks.push({ n: blockN, sumNs: blockSum });
                blockN = 0;
                blockSum = 0;
              }
              if (!keysFull || steps.has(dn)) {
                steps.set(dn, (steps.get(dn) || 0) + 1);
                if (steps.size >= STEP_KEYS_MAX) keysFull = true;
              }
            }
          }
          prevNs = ns;
        }
      }
      if (p.length > msCol) {
        const ms = parseFloat(p[msCol]);
        if (isFinite(ms)) {
          if (firstMs === null) firstMs = ms;
          lastMs = ms;
          if (prevMs !== null) {
            const d = ms - prevMs;
            if (d > 0) {
              if (msStep === null && d < SAMPLE_MAX_MS) msStep = d;
              if (msStep && d > msStep * GAP_MULT) {
                if (d > SEAM_MS) {
                  seams++;
                  seamTotal += d;
                } else {
                  gaps++;
                  gapTotal += d;
                }
              } else if (d < SAMPLE_MAX_MS) {
                stepSum += d;
                stepN++;
              }
            }
          }
          prevMs = ms;
        }
      }
    },
    done() {
      /* The final partial block counts only when it holds enough steps to carry a rate: a block of
         nine steps would read as a 100 000 ppm outlier and the within-session spread is a MAXIMUM. */
      if (blockN >= BS / 10) blocks.push({ n: blockN, sumNs: blockSum });
      return { nsCol, msCol, rows, nsRows, nsStepSum, nsStepN, msStep, stepSum, stepN, gaps, gapTotal, seams, seamTotal, blocks, firstMs, lastMs, steps, keysFull };
    }
  };
}

/* ═══════════════════════════════════ THE ESTIMATOR, VERBATIM ═══════════════════════════════════
   `ecgdex-dsp.js:5169-5182`'s chain, kept in its own function so the comparison below is against
   what ships and not against a paraphrase of it. The two host branches round; the preferred one
   does not. */
export function shippedFs(s) {
  if (s.nsStepN > 0) return { fs: (1e9 * s.nsStepN) / s.nsStepSum, fsSource: 'ns-counter' };
  if (s.stepN > 0) return { fs: Math.round((1000 * s.stepN) / s.stepSum), fsSource: 'ms-step' };
  if (s.msStep && s.msStep > 0) return { fs: Math.round(1000 / s.msStep), fsSource: 'ms-delta' };
  return { fs: FS_ASSUMED, fsSource: 'assumed' };
}

/* The band the two axes disagree about: a step the host axis calls a dropout and the counter axis
   spends as a sample interval. Its edges are the node's, read off the file's own latched step. */
export function bandOf(s) {
  const lo = s.msStep ? s.msStep * GAP_MULT * 1e6 : null;
  return { loNs: lo, hiNs: SAMPLE_MAX_NS };
}

/* Everything the step map answers: the mode, the median, and the mean over the band's complement.
   Sorting the DISTINCT values is what keeps this cheap — a 345 000-row stream carries a few hundred
   of them, not a few hundred thousand. */
export function stepStats(s) {
  const keys = [...s.steps.keys()].sort((a, b) => a - b);
  let total = 0,
    modal = null,
    modalN = 0;
  for (const k of keys) {
    const n = s.steps.get(k);
    total += n;
    if (n > modalN) {
      modalN = n;
      modal = k;
    }
  }
  let median = null,
    seen = 0;
  for (const k of keys) {
    seen += s.steps.get(k);
    if (median === null && seen >= total / 2) median = k;
  }
  const band = bandOf(s);
  let tightN = 0,
    tightSum = 0,
    bandN = 0,
    bandSum = 0;
  for (const k of keys) {
    const n = s.steps.get(k);
    if (band.loNs !== null && k > band.loNs) {
      bandN += n;
      bandSum += k * n;
    } else {
      tightN += n;
      tightSum += k * n;
    }
  }
  let nominalN = 0;
  for (const k of NOMINAL_STEP_NS) if (s.steps.has(k)) nominalN += s.steps.get(k);
  return {
    distinct: keys.length,
    nominalShare: total ? nominalN / total : null,
    modalStepMs: modal === null ? null : modal / 1e6,
    modalShare: total ? modalN / total : null,
    medianStepMs: median === null ? null : median / 1e6,
    bandLoMs: band.loNs === null ? null : band.loNs / 1e6,
    bandN,
    bandTotalMs: bandSum / 1e6,
    tightFs: tightN > 0 ? (1e9 * tightN) / tightSum : null,
    keysFull: s.keysFull
  };
}

/* ═════════════════════════════════════ THE POPULATION ON DISK ══════════════════════════════════
   Selection is by NAME — an exported ECG stream — and the HEADER does the excluding: a file with no
   device-counter column is reported as excluded with that reason, never folded in on a fallback. */
/* ⚠️ THE NAME IS THE POPULATION, and a loose one admits four other kinds of file. The capture tree
   holds, beside the raw per-stream export, its own `_ECGSEAMS` / `_ECGRUNS` sidecars, derived HR and
   RR files, a clip, and a synthetic fixture — a case-insensitive `ecg` sweep took 709 files where 641
   are exports. The sidecars and derived files would have been excluded by the header check and
   counted, but the SYNTHETIC FIXTURE carries the real header and would have been folded in as a
   session. So selection is the exact export suffix, and a copy GitHub-renamed with ` (1)` counts. */
export const ECG_RE = /_ECG(?: \(\d+\))?\.txt$/;
/* THE NAME IS THE POPULATION RULE, and the names it turns away are counted, not silently dropped.
   Beside the 641 `*_ECG.txt` exports the corpus root carries 15 `_partNNofNN` slices of two sessions,
   one `_clip`, and the `SEAMS`/`RUNS` sidecars. A part file is a SLICE of one session: its counter
   continues the previous part's, so admitting the five parts of one night as five sessions would
   report one session's internal spread as between-session movement — exactly the quantity under test.
   They are out by name, and `namesTurnedAway` says how many. */
export function inputs(root, depth = 4) {
  const seen = new Map();
  let turnedAway = 0;
  const walk = (dir, d) => {
    let kids = [];
    try {
      kids = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const k of kids) {
      const p = join(dir, k.name);
      if (k.isDirectory()) {
        if (d > 0) walk(p, d - 1);
      } else if (!ECG_RE.test(k.name)) {
        if (/_ECG/.test(k.name)) turnedAway++;
      } else {
        try {
          const st = statSync(p);
          const key = st.dev + ':' + st.ino;
          if (!seen.has(key)) seen.set(key, { path: p, bytes: st.size });
        } catch {
          /* a dangling symlink into a corpus this machine does not mount */
        }
      }
    }
  };
  walk(root, depth);
  const out = [...seen.values()].sort((a, b) => b.bytes - a.bytes);
  out.namesTurnedAway = turnedAway;
  return out;
}

/* One stream, streamed. The row splitter writes field offsets into a reused array, so no row
   allocates: 68 million `split(';')` calls is the whole cost of a pass, and this pass has none. */
export function readStream(path, maxSteps = 0) {
  return new Promise((resolve, reject) => {
    const sc = scanner();
    let stopped = false;
    let first = true,
      tail = '';
    const fields = [];
    const feed = (line) => {
      if (!line) return;
      fields.length = 0;
      let at = 0;
      for (;;) {
        const i = line.indexOf(';', at);
        if (i < 0) {
          fields.push(line.slice(at));
          break;
        }
        fields.push(line.slice(at, i));
        at = i + 1;
      }
      if (first) {
        first = false;
        /* The node's rule: the first line is a header when its LAST column is not numeric. */
        const last = fields[fields.length - 1];
        if (!(last !== '' && isFinite(Number(last)))) {
          sc.header(fields);
          return;
        }
      }
      sc.row(fields);
    };
    const rs = createReadStream(path, { encoding: 'latin1', highWaterMark: CHUNK });
    rs.on('data', (chunk) => {
      let at = 0;
      const buf = tail + chunk;
      for (;;) {
        const nl = buf.indexOf('\n', at);
        if (nl < 0) break;
        let end = nl;
        if (end > at && buf.charCodeAt(end - 1) === 13) end--;
        feed(buf.slice(at, end));
        at = nl + 1;
      }
      tail = buf.slice(at);
      /* THE BOUNDED READ, and the bound is in STEPS, not bytes: one block of admitted steps is a
         stated estimand (≈13 min of signal at 130 Hz), where "the first 8 MiB" is a byte count whose
         meaning changes with the row width. The control for it is a full read of a stride sample. */
      if (maxSteps > 0 && sc.done().nsStepN >= maxSteps && !stopped) {
        stopped = true;
        rs.destroy();
        resolve({ ...sc.done(), truncated: true });
      }
    });
    rs.on('end', () => {
      if (stopped) return;
      feed(tail.replace(/\r$/, ''));
      resolve({ ...sc.done(), truncated: false });
    });
    rs.on('error', (e) => {
      if (!stopped) reject(e);
    });
  });
}

const ppm = (x, base) => (base ? ((x - base) / base) * 1e6 : null);
/* THE RATE THE MERGE COMPARES: `tools/trio-batch.mjs:2953` refuses two fragments of one night whose
   `fs` differ by more than 0.05 Hz, a bound its own comment sizes at 385 ppm. */
export const MERGE_REFUSE_HZ = 0.05;
const spreadPpm = (xs) => {
  if (xs.length < 2) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s[(s.length - 1) >> 1];
  return ((s[s.length - 1] - s[0]) / mid) * 1e6;
};
const r2 = (x, n = 4) => (x === null || x === undefined ? null : Number(x.toFixed(n)));

/* ═══════════════════════════════════════════ SELFTEST ══════════════════════════════════════════ */
function selftest() {
  let fail = 0,
    n = 0;
  const ok = (c, m) => {
    n++;
    if (!c) fail++;
    console.log(`${c ? 'ok  ' : 'FAIL'}  ${m}`);
  };
  const NS = 7692672; // the modal device step the DONE corpus brief measured, in ns
  /* The feeder builds BOTH columns off ONE integer counter, so the host column is the counter's own
     reading and carries no second clock. `noNs` blanks the counter column, `noMs` the host one. */
  const feed = (nsSteps, opts = {}) => {
    const sc = scanner();
    sc.header(['Phone timestamp', 'sensor timestamp [ns]', 'timestamp [ms]', 'ecg [uV]']);
    const ns0 = 1e12;
    let ns = ns0;
    const push = () => sc.row(['', opts.noNs ? '' : String(ns), opts.noMs ? '' : String((ns - ns0) / 1e6), '0']);
    push();
    for (const d of nsSteps) {
      ns += d;
      push();
    }
    return sc.done();
  };
  const clean = (k, step = NS) => new Array(k).fill(step);

  const flat = feed(clean(400));
  ok(flat.nsStepN === 400 && flat.gaps === 0, 'a clean grid admits every step and finds no gap');
  ok(Math.abs(shippedFs(flat).fs - 1e9 / NS) < 1e-9, 'and the preferred axis reports its own rate');
  ok(shippedFs(flat).fsSource === 'ns-counter', 'the counter axis wins whenever it has a step');
  ok(stepStats(flat).tightFs === shippedFs(flat).fs, 'with no step in the band the two estimates are the same number');
  ok(stepStats(flat).distinct === 1, 'and one device period is ONE map key, because the keys are exact');

  /* THE ASYMMETRY ITSELF: one 30 ms step is a gap on the host axis and a sample on the counter axis. */
  const one = feed([...clean(200), 30e6, ...clean(200)]);
  ok(one.gaps === 1 && r2(one.gapTotal, 1) === 30, 'the host axis calls a 30 ms step a dropout candidate');
  ok(one.nsStepN === 401, 'and the counter axis spends it as a sample interval');
  ok(stepStats(one).bandN === 1 && r2(stepStats(one).bandTotalMs, 1) === 30, 'the band holds exactly that step');
  ok(shippedFs(one).fs < stepStats(one).tightFs, 'so the shipped rate reads LOW and the tight one does not');
  ok(Math.abs(ppm(shippedFs(one).fs, stepStats(one).tightFs) + 7180) < 5, 'one admitted 30 ms step in 400 moves the rate by 7180 ppm, measured here and not pre-stated');
  ok(Math.abs(stepStats(one).tightFs - 1e9 / NS) < 1e-9, 'and excluding it recovers the device period exactly');

  const big = feed([...clean(200), 60e6, ...clean(200)]);
  ok(big.gaps === 1 && big.nsStepN === 400, 'a 60 ms step is a dropout on BOTH axes, as the shared 50 ms guard intends');
  ok(stepStats(big).bandN === 0, 'and it is outside the band, which ends where that guard does');

  /* The boundary is tested on an 8 ms grid, where every host value is exact: on the device's own
     7.692672 ms period the host column's float cancellation decides a strictly-greater test. */
  const edge = feed([...clean(50, 8e6), 20e6, ...clean(50, 8e6)]);
  ok(edge.gaps === 0, 'a step at exactly 2.5x the latched one is not yet a gap: the host test is strictly greater');
  const over = feed([...clean(50, 8e6), 20e6 + 1e3, ...clean(50, 8e6)]);
  ok(over.gaps === 1, 'one microsecond beyond it is');
  ok(r2(stepStats(over).bandLoMs, 6) === 20, 'the band opens at the file\u2019s OWN latched step times 2.5, not at a constant');
  ok(stepStats(over).bandN === 1, 'and that step is what the two axes disagree about');

  const hostOnly = feed(clean(300), { noNs: true });
  ok(hostOnly.nsStepN === 0 && shippedFs(hostOnly).fsSource === 'ms-step', 'a stream whose counter column holds no number falls to the host branch');
  ok(Number.isInteger(shippedFs(hostOnly).fs), 'which rounds, so it can report no fraction of a Hz at all');
  const slow = feed(clean(300, 7696000), { noNs: true });
  ok(shippedFs(slow).fs === 130 && Math.abs(1e9 / 7696000 - 130) > 0.05, 'a 430 ppm offset rounds to exactly 130 on that branch: the whole movement is quantised away');
  const noMs = feed(clean(300), { noMs: true });
  ok(noMs.gaps === 0 && noMs.msStep === null && stepStats(noMs).bandLoMs === null, 'a stream with no host column has no band, because the band edge is the host axis\u2019s own');
  ok(stepStats(noMs).tightFs === shippedFs(noMs).fs, 'so nothing is excluded and the two estimates agree');

  const bare = scanner();
  bare.header(['t', 'x']);
  ok(bare.done().nsCol === null, 'a header naming no counter column locates none');
  const moved = scanner();
  moved.header(['sensor timestamp [ns]', 'Phone timestamp', 'timestamp [ms]']);
  ok(moved.done().nsCol === 0 && moved.done().msCol === 2, 'and a layout that moves the columns is read by NAME');

  const st = stepStats(feed([...clean(10), ...clean(3, NS + 364), ...clean(2, NS - 100)]));
  ok(st.modalStepMs === NS / 1e6 && st.distinct === 3, 'the map names the modal step and how many distinct ones there are');
  ok(st.medianStepMs === NS / 1e6 && st.modalShare === 10 / 15, 'with its share and the median beside it');
  ok(spreadPpm([130, 130.013]) !== null && Math.abs(spreadPpm([130, 130.013]) - 100) < 1, 'a 0.013 Hz spread at 130 Hz is 100 ppm, the criterion\u2019s own ceiling');
  ok(spreadPpm([130]) === null, 'and one session has no spread');

  /* THE SEAM SPLIT. A resync is a change of clock, and summing it into the dropout total would hide
     every real dropout behind it — the corpus carries one seam of 2.4e11 ms. */
  const seam = feed([...clean(50), 240e6 * 1e3, ...clean(50)]);
  ok(seam.seams === 1 && seam.gaps === 0 && seam.gapTotal === 0, 'a host step past a minute is a seam, and the gap total stays clean');
  ok(r2(seam.seamTotal / 1000, 1) === 240 && seam.nsStepN === 100, 'the seam keeps its own total, and the counter axis excluded it too');
  const drop = feed([...clean(50), 30e6, ...clean(50)]);
  ok(drop.gaps === 1 && drop.seams === 0, 'and a 30 ms step is a dropout candidate, not a seam');

  /* THE BLOCKS, which answer whether ONE session holds one rate. */
  const bf = (nsSteps) => {
    const sc = scanner({ blockSteps: 100 });
    sc.header(['Phone timestamp', 'sensor timestamp [ns]', 'timestamp [ms]', 'ecg [uV]']);
    const ns0 = 1e12;
    let ns = ns0;
    sc.row(['', String(ns), String(0), '0']);
    for (const d of nsSteps) {
      ns += d;
      sc.row(['', String(ns), String((ns - ns0) / 1e6), '0']);
    }
    return sc.done();
  };
  ok(feed(clean(400)).blocks.length === 0, 'a stream too short for a tenth of a block reports no block at all');
  ok(bf(clean(250)).blocks.length === 3, 'two full blocks and a tail of 50 make three');
  ok(bf(clean(105)).blocks.length === 1, 'and a tail under a tenth of a block is dropped, so no block reads as an outlier');
  const two = bf([...clean(100), ...clean(100, NS + 7692)]);
  const rates = two.blocks.map((b) => (1e9 * b.n) / b.sumNs);
  ok(two.blocks.length === 2 && Math.abs(spreadPpm(rates) - 1000) < 2, 'a session whose second half runs 1000 ppm slower reports that spread WITHIN itself');
  ok(spreadPpm(bf(clean(200)).blocks.map((b) => (1e9 * b.n) / b.sumNs)) === 0, 'and a steady session reports none');

  /* THE DRAWN TEST, on the axis the capture host used to draw: one value on 98.6 % of steps. */
  const drawn = feed([...new Array(986).fill(7692307), ...new Array(14).fill(7692307 + 128)]);
  const dst = stepStats(drawn);
  ok(dst.modalShare > DRAWN_SHARE, 'a pre-break axis is DRAWN by the clock module’s own 67 % bound');
  ok(Math.abs(dst.nominalShare - 0.986) < 0.001, 'and its nominal share is 98.6 %, which the 2 % bound also catches');
  ok(stepStats(feed([...clean(300), 7692307])).nominalShare < NOMINAL_SHARE_MAX, 'a post-break session carrying one nominal step is not nominal-fed');
  ok(stepStats(flat).nominalShare === 0, 'and a session on the device’s own period carries none at all');
  ok(Math.abs(1e9 / 7692307 - 130.00001) < 1e-5, 'the drawn step is exactly our own 130.00001 Hz, which is why it must not enter a spread');

  /* THE TWO SHIPPED BOUNDS, asserted as the relation the prose claims and not as copied numbers. */
  ok(DRAWN_SHARE < DRAWN_MODAL_SHARE, 'the Clock Contract’s drawn bound is the conservative one — it turns away a session the stability tool keeps');
  ok(0.9863 > DRAWN_SHARE && 0.9863 < DRAWN_MODAL_SHARE, 'and a pre-break capture at 98.63 % falls BETWEEN them, so which bound a tool picks decides it');
  ok(MAX_CRYSTAL_SPREAD_PPM < (MERGE_REFUSE_HZ / FS_ASSUMED) * 1e6, 'the crystal bound is tighter than the merge’s 0.05 Hz, so a night can pass the merge and still have no rate');
  ok(Math.abs((MERGE_REFUSE_HZ / FS_ASSUMED) * 1e6 - 385) < 1, 'the merge’s 0.05 Hz is 385 ppm at 130 Hz — the figure the two bounds are compared on');

  ok(COMMENT_WINDOW_HZ[1] > COMMENT_WINDOW_HZ[0] && Math.abs(ppm(COMMENT_WINDOW_HZ[1], COMMENT_WINDOW_HZ[0]) - 77) < 1, 'the window the shipped comment quotes is 77 ppm wide');

  console.log(fail ? `\n✕ ${fail} of ${n} failed` : `\n✓ all ${n} selftests passed`);
  return fail ? 1 : 0;
}

/* ═══════════════════════════════════════════ MAIN ══════════════════════════════════════════════ */
async function main() {
  if (has('--selftest')) return selftest();
  /* What the adoption gate reads: a real run needs a corpus the gate does not have, so the sample
     carries the pre-stated criterion and the only status true of a run that examined nothing. */
  if (has('--verdict-sample')) {
    console.log(
      JSON.stringify(
        Verdict.make({
          gate: 'h10-session-rate',
          status: 'NOT_RUN',
          population: { checked: 0, eligible: 0, excluded: 0 },
          criterion: { name: 'tight_fs_spread_ppm', threshold: TIGHT_SPREAD_CEIL_PPM, unit: 'ppm', direction: 'lte' },
          result: null,
          evidence: ['tools/h10-session-rate.mjs'],
          reason: 'no corpus here — this sample states the criterion, it measures nothing',
          producedBy: PRODUCED_BY
        }),
        null,
        2
      )
    );
    return 0;
  }

  const root = arg('--uploads', null) || corpusSearch(ROOT).dir;
  const all = inputs(root, Number(arg('--depth', 5)));
  const limit = Number(arg('--limit', 0));
  const stride = Number(arg('--stride', 0));
  const maxSteps = Number(arg('--max-steps', 0));
  /* TWO SAMPLING RULES, both stated in the verdict. `--limit` takes the LARGEST streams and is for a
     quick pass, so it is biased toward long sessions by construction. `--stride` takes every Kth of
     the PATH-sorted population, which is unbiased in length and is what the full-read control uses. */
  let take = all;
  if (stride > 0) take = [...all].sort((a, b) => (a.path < b.path ? -1 : 1)).filter((_, i) => i % stride === 0);
  if (limit > 0) take = take.slice(0, limit);
  say(
    `  streams found: ${all.length}${stride > 0 ? `, every ${stride}th by path` : ''}${limit > 0 ? `, capped at ${take.length}` : ''}` +
      `${maxSteps > 0 ? `, reading the first ${maxSteps} admitted step(s) of each` : ', reading each in full'}`
  );
  if (!take.length) {
    const v = Verdict.make({
      gate: 'h10-session-rate',
      status: 'NOT_RUN',
      population: { checked: 0, eligible: 0, excluded: 0 },
      criterion: { name: 'tight_fs_spread_ppm', threshold: TIGHT_SPREAD_CEIL_PPM, unit: 'ppm', direction: 'lte' },
      result: null,
      evidence: ['tools/h10-session-rate.mjs'],
      reason: 'no exported ECG stream under the corpus root this machine mounts',
      producedBy: PRODUCED_BY
    });
    console.log(JSON.stringify(v, null, 2));
    return 0;
  }

  const rows = [],
    excluded = [];
  /* A NIGHT IS THE DIRECTORY, and it is an INDEX in every output. The merge question is per night:
     `mergeEcg` only ever compares fragments of one recording. The path itself never leaves here. */
  const nights = new Map();
  const nightOf = (path) => {
    const d = dirname(path);
    if (!nights.has(d)) nights.set(d, `n${String(nights.size + 1).padStart(2, '0')}`);
    return nights.get(d);
  };
  let i = 0;
  for (const f of take) {
    i++;
    const s = await readStream(f.path, maxSteps);
    /* The session's IDENTITY in every output is its index. No corpus path, name or stamp leaves this
       tool: the repo is public and the capture tree is not. */
    const id = `s${String(i).padStart(2, '0')}`;
    if (s.nsCol === null || s.nsStepN === 0) {
      excluded.push({ id, reason: s.nsCol === null ? 'no device-counter column in the header' : 'a counter column with no admitted step', rows: s.rows });
      say(`  ${id}  excluded — ${excluded[excluded.length - 1].reason}`);
      continue;
    }
    const st = stepStats(s);
    /* THE THREE EXCLUSIONS, each by name and each counted. A drawn axis and a nominal-fed one are the
       same defect seen two ways, so both tests run and the first to fire names itself. */
    const why =
      st.modalShare >= DRAWN_SHARE
        ? `device axis is DRAWN — ${(st.modalShare * 100).toFixed(2)} % of steps are one value, at or above the ${DRAWN_SHARE * 100} % bound`
        : st.nominalShare >= NOMINAL_SHARE_MAX
          ? `the counter carries OUR nominal on ${(st.nominalShare * 100).toFixed(2)} % of steps — a pre-80e05501 capture, so the rate would be ours`
          : s.nsStepN < MIN_STEPS
            ? `${s.nsStepN} admitted step(s), under the ${MIN_STEPS} a rate claim needs`
            : null;
    if (why) {
      excluded.push({
        id,
        reason: why,
        rows: s.rows,
        fsWouldHaveRead: r2(shippedFs(s).fs, 6),
        /* THE SAME CONTENT KEY THE CRITERION DEDUPS ON, so an exclusion census counts SESSIONS and
           not copies. Measured here: 32 excluded FILES are 6 distinct recordings. */
        key: `${f.bytes}|${s.rows}|${r2(s.nsStepSum / s.nsStepN / 1e6, 6)}`,
        nominalShare: r2(st.nominalShare, 6),
        modalShare: r2(st.modalShare, 4)
      });
      say(`  ${id}  excluded — ${why}`);
      continue;
    }
    const sh = shippedFs(s);
    const hostUnrounded = s.stepN > 0 ? (1000 * s.stepN) / s.stepSum : null;
    rows.push({
      id,
      samples: s.rows,
      gaps: s.gaps,
      gapTotalMs: r2(s.gapTotal, 1),
      seams: s.seams,
      seamTotalMs: r2(s.seamTotal, 1),
      durMs: s.firstMs !== null ? r2(s.lastMs - s.firstMs, 1) : null,
      distinctSteps: st.distinct,
      modalStepMs: r2(st.modalStepMs, 6),
      modalShare: r2(st.modalShare, 4),
      nominalShare: r2(st.nominalShare, 6),
      medianStepMs: r2(st.medianStepMs, 6),
      meanStepMs: r2(s.nsStepSum / s.nsStepN / 1e6, 6),
      bandLoMs: r2(st.bandLoMs, 4),
      bandN: st.bandN,
      bandTotalMs: r2(st.bandTotalMs, 1),
      fsShipped: r2(sh.fs, 6),
      fsSource: sh.fsSource,
      fsTight: r2(st.tightFs, 6),
      fsModal: r2(1000 / st.modalStepMs, 6),
      hostUnroundedFs: r2(hostUnrounded, 6),
      hostRoundedFs: hostUnrounded === null ? null : Math.round(hostUnrounded),
      hostQuantisedPpm: hostUnrounded === null ? null : r2(Math.abs(ppm(hostUnrounded, Math.round(hostUnrounded))), 1),
      truncated: s.truncated,
      bytes: f.bytes,
      blocks: s.blocks.length,
      withinSpreadPpm: r2(spreadPpm(s.blocks.map((b) => (1e9 * b.n) / b.sumNs)), 1),
      stepKeysFull: st.keysFull,
      night: nightOf(f.path)
    });
    say(
      `  ${id}  samples ${s.rows}  gaps ${s.gaps} (${r2(s.gapTotal / 1000, 1)} s)  band ${st.bandN} step(s) / ${r2(st.bandTotalMs / 1000, 2)} s  ` +
        `fs ${r2(sh.fs, 5)} (${sh.fsSource})  tight ${r2(st.tightFs, 5)}  modal ${r2(1000 / st.modalStepMs, 5)}`
    );
  }

  /* ⚠️ THE CORPUS HOLDS COPIES, and a copy is not a session. Three of the streams read in one pass
     reported the same sample count and the same counter sum to the digit, at three distinct inodes —
     the inode dedup in `inputs` cannot see a byte-identical copy. A duplicate does not widen a
     spread, it overweights one session inside it, so the criterion runs on DISTINCT CONTENT and the
     population census names both counts. The key is the file size with the two scan totals, which
     two different recordings of the same device cannot collide on. */
  const byContent = new Map();
  for (const r of rows) {
    const k = `${r.bytes}|${r.samples}|${r.meanStepMs}`;
    if (!byContent.has(k)) byContent.set(k, r);
  }
  const uniq = [...byContent.values()];

  /* THE MERGE'S OWN TEST, run on the sessions a night actually holds. `mergeEcg` takes the longest
     fragment's `fs` and refuses any other fragment further than 0.05 Hz from it, so the figure that
     decides is the night's widest pair. */
  const byNight = new Map();
  for (const r of uniq) {
    if (!byNight.has(r.night)) byNight.set(r.night, []);
    byNight.get(r.night).push(r);
  }
  const multi = [...byNight.entries()].filter(([, rs]) => rs.length > 1);
  const nightPairs = multi.map(([night, rs]) => {
    const fss = rs.map((r) => r.fsShipped);
    const widestHz = Math.max(...fss) - Math.min(...fss);
    const ppmWide = spreadPpm(fss);
    return {
      night,
      sessions: rs.length,
      widestHz: r2(widestHz, 6),
      widestPpm: r2(ppmWide, 1),
      wouldRefuse: widestHz > MERGE_REFUSE_HZ,
      overCrystalBound: ppmWide > MAX_CRYSTAL_SPREAD_PPM
    };
  });
  const shippedSpread = spreadPpm(uniq.map((r) => r.fsShipped));
  const tightSpread = spreadPpm(uniq.map((r) => r.fsTight));
  const modalSpread = spreadPpm(uniq.map((r) => r.fsModal));
  const bandCarriers = uniq.filter((r) => r.bandN > 0).length;
  const hostBranch = uniq.filter((r) => r.hostUnroundedFs !== null && Math.abs(ppm(r.hostUnroundedFs, 130)) > 0).length;
  const quantisedMax = uniq.reduce((m, r) => (r.hostQuantisedPpm !== null && r.hostQuantisedPpm > m ? r.hostQuantisedPpm : m), 0);

  let status, reason;
  if (uniq.length < 2) {
    status = 'UNDERPOWERED';
    reason = `${uniq.length} distinct session(s) — a spread needs two`;
  } else if (shippedSpread < SHIPPED_SPREAD_FLOOR_PPM) {
    status = 'NOT_APPLICABLE';
    reason = `the shipped estimator's spread is ${r2(shippedSpread, 1)} ppm, under the ${SHIPPED_SPREAD_FLOOR_PPM} ppm premise — there is no movement here to explain`;
  } else if (tightSpread > TIGHT_SPREAD_CEIL_PPM) {
    status = 'FAIL';
    reason = `excluding the band leaves ${r2(tightSpread, 1)} ppm of spread, above the ${TIGHT_SPREAD_CEIL_PPM} ppm ceiling — the admitted sub-gap steps do not account for the movement`;
  } else {
    status = 'PASS';
    reason = null;
  }

  const inWin = uniq.filter((r) => r.fsShipped >= COMMENT_WINDOW_HZ[0] && r.fsShipped <= COMMENT_WINDOW_HZ[1]);
  const aboveWin = uniq.filter((r) => r.fsShipped > COMMENT_WINDOW_HZ[1]);
  const belowWin = uniq.filter((r) => r.fsShipped < COMMENT_WINDOW_HZ[0]);
  const withinMax = uniq.reduce((m, r) => (r.withinSpreadPpm !== null && r.withinSpreadPpm > m ? r.withinSpreadPpm : m), 0);
  const withinMed = (() => {
    const xs = uniq
      .map((r) => r.withinSpreadPpm)
      .filter((x) => x !== null)
      .sort((a, b) => a - b);
    return xs.length ? xs[(xs.length - 1) >> 1] : null;
  })();
  /* THE FLOOR'S OWN EFFECT, so the criterion is not read off a population the floor shaped. The
     short streams are already out of `uniq`; this is what the drawn and nominal tests left behind
     before the floor, and the two figures are printed together. */
  const shortOut = excluded.filter((e) => /admitted step\(s\), under/.test(e.reason));
  const noFloorSpread = spreadPpm([...uniq.map((r) => r.fsShipped), ...shortOut.map((e) => e.fsWouldHaveRead)]);
  const census = {};
  const censusKeys = {};
  for (const e of excluded) {
    const k = /DRAWN/.test(e.reason) ? 'drawnAxis' : /nominal/.test(e.reason) ? 'nominalFed' : /admitted step/.test(e.reason) ? 'tooShort' : /header/.test(e.reason) ? 'noCounterColumn' : 'other';
    census[k] = (census[k] || 0) + 1;
    if (!censusKeys[k]) censusKeys[k] = new Set();
    censusKeys[k].add(e.key || e.id);
  }
  const censusDistinct = {};
  for (const k of Object.keys(censusKeys)) censusDistinct[k] = censusKeys[k].size;
  /* THE DRAWN SESSIONS ARE NOT THE PRE-BREAK ONES, and the only way to say so is to print what they
     actually carry. A pre-80e05501 capture is our nominal on 98.63 % of steps; these sit far below
     that and carry no nominal step at all, so they are a THIRD shape — an axis quantised coarsely
     enough to fail the Clock Contract's 67 % bound while passing `device-stability.mjs`'s 99 % one. */
  const drawnShares = excluded.filter((e) => /DRAWN/.test(e.reason)).map((e) => e.modalShare);
  const drawnNominal = excluded.filter((e) => /DRAWN/.test(e.reason)).map((e) => e.nominalShare);
  const result = {
    sessions: uniq.length,
    namesTurnedAway: all.namesTurnedAway ?? null,
    excludedByReasonFiles: census,
    excludedByReasonDistinct: censusDistinct,
    drawnModalShareRange: drawnShares.length ? [Math.min(...drawnShares), Math.max(...drawnShares)] : null,
    drawnNominalShareMax: drawnNominal.length ? Math.max(...drawnNominal) : null,
    spreadWithoutTheStepFloorPpm: r2(noFloorSpread, 1),
    streamsRead: rows.length,
    duplicateCopies: rows.length - uniq.length,
    readBound: maxSteps > 0 ? { maxSteps, truncated: rows.filter((r) => r.truncated).length } : null,
    sampling: stride > 0 ? `every ${stride}th of ${all.length} by path` : limit > 0 ? `the ${take.length} largest of ${all.length}` : `all ${all.length}`,
    nights: byNight.size,
    nightsWithTwoOrMoreSessions: multi.length,
    nightsOverTheCrystalBound: nightPairs.filter((n) => n.overCrystalBound).length,
    crystalBoundPpm: MAX_CRYSTAL_SPREAD_PPM,
    mergeBoundPpmAt130Hz: r2((MERGE_REFUSE_HZ / FS_ASSUMED) * 1e6, 0),
    drawnBoundUsed: DRAWN_SHARE,
    drawnBoundTheStabilityToolUses: DRAWN_MODAL_SHARE,
    nightsTheMergeWouldRefuse: nightPairs.filter((n) => n.wouldRefuse).length,
    widestWithinNightPpm: nightPairs.length ? Math.max(...nightPairs.map((n) => n.widestPpm)) : null,
    withinSessionSpreadPpmMedian: withinMed,
    withinSessionSpreadPpmMax: r2(withinMax, 1),
    seamsTotal: rows.reduce((a, r) => a + r.seams, 0),
    samplesMin: uniq.length ? Math.min(...uniq.map((r) => r.samples)) : null,
    commentWindowHz: COMMENT_WINDOW_HZ,
    sessionsInsideCommentWindow: inWin.length,
    sessionsAboveCommentWindow: aboveWin.length,
    sessionsBelowCommentWindow: belowWin.length,
    ppmAboveCommentWindowTopMax: aboveWin.length ? r2(Math.max(...aboveWin.map((r) => ppm(r.fsShipped, COMMENT_WINDOW_HZ[1]))), 1) : null,
    ppmBelowCommentWindowFloorMax: belowWin.length ? r2(Math.abs(Math.min(...belowWin.map((r) => ppm(r.fsShipped, COMMENT_WINDOW_HZ[0])))), 1) : null,
    shippedSpreadPpm: r2(shippedSpread, 1),
    tightSpreadPpm: r2(tightSpread, 1),
    modalSpreadPpm: r2(modalSpread, 1),
    sessionsCarryingBandSteps: bandCarriers,
    bandStepsTotal: rows.reduce((a, r) => a + r.bandN, 0),
    gapsTotal: rows.reduce((a, r) => a + r.gaps, 0),
    hostBranchWouldRoundAway: quantisedMax,
    hostBranchSessionsOffNominal: hostBranch,
    fsShippedMin: uniq.length ? Math.min(...uniq.map((r) => r.fsShipped)) : null,
    fsShippedMax: uniq.length ? Math.max(...uniq.map((r) => r.fsShipped)) : null,
    fsTightMin: uniq.length ? Math.min(...uniq.map((r) => r.fsTight)) : null,
    fsTightMax: uniq.length ? Math.max(...uniq.map((r) => r.fsTight)) : null
  };
  say(
    `\n  shipped spread ${result.shippedSpreadPpm} ppm · band-excluded ${result.tightSpreadPpm} ppm · modal-step ${result.modalSpreadPpm} ppm` +
      `\n  ${bandCarriers} of ${uniq.length} session(s) carry a step the two axes disagree about` +
      `\n  within one session the rate moves ${withinMed} ppm (median) and ${r2(withinMax, 1)} ppm (worst)` +
      `\n  ${result.nightsTheMergeWouldRefuse} of ${multi.length} multi-session night(s) exceed the 0.05 Hz merge bound, widest ${result.widestWithinNightPpm} ppm` +
      `\n  the host branch would round away up to ${quantisedMax} ppm` +
      `\n  the comment's 77 ppm window holds ${inWin.length} of ${uniq.length} session(s): ${aboveWin.length} sit above it, ${belowWin.length} below\n`
  );

  const v = Verdict.make({
    gate: 'h10-session-rate',
    status,
    population: { checked: uniq.length, eligible: rows.length + excluded.length, excluded: excluded.length + (rows.length - uniq.length) },
    criterion: { name: 'tight_fs_spread_ppm', threshold: TIGHT_SPREAD_CEIL_PPM, unit: 'ppm', direction: 'lte' },
    result,
    evidence: ['tools/h10-session-rate.mjs', 'ecgdex-dsp.js'],
    reason,
    producedBy: PRODUCED_BY
  });
  if (!JSON_OUT) console.error(JSON.stringify({ sessions: uniq, nightPairs, excluded }, null, 1));
  console.log(JSON.stringify(v, null, 2));
  return status === 'PASS' || status === 'NOT_APPLICABLE' || status === 'UNDERPOWERED' || status === 'FAIL' ? 0 : 1;
}

/* Importing this file must not read a corpus: a tool with no main-module guard consumes the
   importer's argv and prints its own report instead. */
const isMain = isCliEntry(import.meta.url);

if (isMain)
  main().then(
    (c) => process.exit(c),
    (e) => {
      console.error(e);
      process.exit(1);
    }
  );
