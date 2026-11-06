/*
 * derive-sigma-window.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Headless derivation of the two raw-signal 1-Hz HR series a three-device σ
 * window needs (VERITY-SIGMA-CORNER-BRIEF / SIGMA-WINDOW-DERIVATION.md):
 *   • Verity HR  ← raw PPG  via the suite's PPGDSP (SQI-gated)
 *   • H10 HR     ← raw ECG  via the suite's ECGDSP (Pan-Tompkins QRS)
 * It REUSES the production detectors unchanged — it only runs them on more data. Each part is
 * parsed on its own and the records fold through `tools/trio-fold-merge.mjs`, the merge the
 * production fold runs, so part order on the command line does not matter: the merge sorts by
 * `t0Ms` and the silence between two parts stays visible as a gap rather than closing up.
 * Run it where the raw Polar Sensor Logger files live (your machine): they are
 * ~150–350 MB each and exceed this project's 30 MiB ingest limit, so the
 * derivation must happen locally, then the small 1-Hz outputs drop into uploads/.
 *
 * USAGE (Node ≥ 18, run from the project root so it can load the *-dsp.js):
 *   node tools/derive-sigma-window.mjs \
 *        --ppg  "Ecg nightly/Polar_Sense_..._PPG.txt"   (repeat --ppg for each part) \
 *        --ecg  "Ecg nightly/Polar_H10_..._ECG.txt"     (repeat --ecg for each part) \
 *        --date 2026-06-16                              (morning date → output filenames) \
 *        --out  uploads
 *   # PPG-only or ECG-only is fine — pass just the legs you want to derive.
 *
 * Output (the exact format the analysis tools ingest — columns are read BY HEADER NAME):
 *   uploads/verity-ppg-derived-<date>-HR.txt   "tMs;hr;sqiMean;c"
 *   uploads/h10-ecg-derived-<date>-HR.txt      "tMs;hr;src;c"
 * `c` (added 2026-09-26, TCH-FUSED-ROBUST-HAT's `ms;hr;c` re-derivation) is the DSP tier's own
 * per-second `beatConfidence` (density × SQI, AF-safe) — the weight the fused-weight three-cornered
 * hat multiplies in (`analysis-stats.js tchSigmasFused`). It is computed here, at derivation time,
 * because the folded node exports summarise the per-beat confidence away (DRAIN 2026-09-06). A
 * Verity night carrying a clock seam gets NO `c` column rather than a column of 1s: a seam is a
 * change of clock (Clock Contract §7) and an unmeasured weight must stay visible as absent (§∅) —
 * the consumers then run the classic hat for that file, exactly as they did before this column.
 *
 * Then append a TRIOS entry in sigma-no-reference-analysis.js (commented stubs
 * for 06-10/11/13/15 are already staged there) and re-run the tool.
 *
 * Clock Contract: both legs take their timing from the DSP modules' own parseTimestamp. No
 * new Date(str) on a vendor stamp, and no parser of this tool's own: a local ECG reader took no
 * host-axis `fs` correction and saw no clock resync, and it is gone (residue
 * 2026-11-06-the-sigma-window-ecg-leg-duplicates-the-dsp-parser).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readLinesBounded } from './read-lines-bounded.mjs';
import { mergeEcg, mergePpg } from './trio-fold-merge.mjs';
import { readRunsSidecar, validityLine } from './trio-fold-validity.mjs';

// ── tiny arg parser ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const ppg = [],
  ecg = [];
let date = null,
  out = 'uploads',
  sqiGate = 0.5;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--ppg') ppg.push(args[++i]);
  else if (a === '--ecg') ecg.push(args[++i]);
  else if (a === '--date') date = args[++i];
  else if (a === '--out') out = args[++i];
  else if (a === '--sqi-gate') sqiGate = +args[++i];
}
if (!date) {
  console.error('need --date YYYY-MM-DD (morning date of the overnight window)');
  process.exit(1);
}

// ── load the production detectors (IIFEs that assign global.PPGDSP/ECGDSP) ──
// The modules close over `window`; in Node we point that at globalThis.
globalThis.window = globalThis;
async function load(p) {
  await import(pathToFileURL(p).href);
}
// the spine FIRST: both DSPs alias DexClock at load (A5, 2026-07-03 — `dex-coload.js shared:`); without it
// this tool died at import with `DexClock is not defined` (found 2026-09-26, the first run since A5).
await load('./clock.js');
await load('./ppgdex-dsp.js');
await load('./ecgdex-dsp.js');
const PPGDSP = globalThis.PPGDSP,
  ECGDSP = globalThis.ECGDSP;

const sFloorMs = (ms) => Math.floor(ms / 1000) * 1000;
/* ── ONE PART, ONE PARSE, THEN THE PRODUCTION MERGE ───────────────────────────────────────────────
   Residue 2026-11-06-the-sigma-window-concat-joins-a-nights-parts-as-text. This tool used to join a
   night's parts as TEXT and keep the first part's header, so the record carried one `t0Ms` and no
   entry for the silence between two parts. A break between parts then reached both detectors as
   continuous signal, which is the §∅ discontinuity case rather than a coverage one. It now parses
   each part on its own and folds the records through `tools/trio-fold-merge.mjs`, the merge the
   production fold runs: the inter-part silence becomes an ECG `gaps[]` entry and a PPG `relSec` jump,
   each fragment's gaps and clock resyncs are rebased onto the merged axis, and no time is fabricated.

   The sidecar rebase went with the concatenation. A part's `…RUNS.txt` indices are written in THAT
   part's frame, so handing each parse its own part's sidecar needs no rebase at all — the one axis
   fact the old join had to reconstruct. Four things can still happen per part and the tally printed
   at the end names which: absent, unreadable or unnamed is validity UNKNOWN over that part's stretch,
   never a clean one, because passing the sidecar is not reporting its absence. */
const validity = {};
function sidecarFor(path, stream) {
  const sc = readRunsSidecar(path, stream, { tally: validity });
  if (sc.state !== 'read' && sc.reason) console.log(`[${stream}] ${sc.reason}`);
  return sc.runsText;
}

// bucket per-beat (timeMs, hr, sqi) → 1-Hz mean rows
function toOneHz(beats) {
  const m = new Map();
  for (const b of beats) {
    if (!(b.hr >= 30 && b.hr <= 220)) continue;
    const k = sFloorMs(b.tMs),
      a = m.get(k) || { h: 0, q: 0, n: 0 };
    a.h += b.hr;
    a.q += b.sqi == null ? 1 : b.sqi;
    a.n++;
    m.set(k, a);
  }
  return [...m.keys()]
    .sort((x, y) => x - y)
    .map((k) => {
      const a = m.get(k);
      return { tMs: k, hr: a.h / a.n, sqi: a.q / a.n };
    });
}

// ── Verity: raw PPG → PPGDSP → SQI-gated 1-Hz HR ───────────────────────────
if (ppg.length) {
  console.log(`[PPG] ${ppg.length} part(s) → PPGDSP…`);
  /* The sidecar reaches each part's parse as a WITNESS against that part's own pinned-run derivation
     (`ppgdex-dsp.js` §P5 clause 2 — the box's run detector and this node's rail detector answer
     different questions, and the comparison is the point). */
  const precs = ppg.map((f) => {
    const runsText = sidecarFor(f, 'PPG');
    const text = readFileSync(f, 'utf8');
    return runsText ? PPGDSP.parsePPG(text, { runsText }) : PPGDSP.parsePPG(text);
  });
  const rec = mergePpg(precs);
  if (!rec) {
    console.error('[PPG] no part parsed into a record — nothing written');
    process.exit(2);
  }
  if (precs.length > 1) console.log(`[PPG] ${precs.length} part(s) folded on parsed records · fs=${rec.fs} · ${rec.n} sample(s) · ${(rec.durSec / 3600).toFixed(2)} h`);
  const res = PPGDSP.analyze(rec);
  const peakSec = res.beatTimes || [],
    sqi = res.sqi || [],
    t0 = res.t0Ms ?? rec.t0Ms;
  // per-second fused-hat confidence over the detected pulse indices + per-beat SQI (the DSP's own
  // beatConfidence, keyed by absolute second). Omitted — not defaulted — across a clock seam.
  const ppgSeam = !!(rec.clockResyncs && rec.clockResyncs.length);
  const ppgConf = ppgSeam ? null : PPGDSP.beatConfidence(res.peakSamp || [], sqi, rec.fs, t0 || 0);
  if (ppgSeam) console.log('[PPG] clock seam(s) in this night — `c` column OMITTED (classic hat downstream)');
  const beats = [];
  for (let i = 1; i < peakSec.length; i++) {
    const pp = peakSec[i] - peakSec[i - 1];
    if (!(pp > 0.27 && pp < 2.0)) continue; // 30–220 bpm
    const q = sqi[i];
    if (q != null && q < sqiGate) continue; // SQI gate
    beats.push({ tMs: t0 + peakSec[i] * 1000, hr: 60 / pp, sqi: q });
  }
  const rows = toOneHz(beats);
  const f = `${out}/verity-ppg-derived-${date}-HR.txt`;
  const cOf = (r) => (ppgConf ? ';' + (ppgConf.has(r.tMs / 1000) ? ppgConf.get(r.tMs / 1000) : 1).toFixed(3) : '');
  writeFileSync(f, 'tMs;hr;sqiMean' + (ppgConf ? ';c' : '') + '\n' + rows.map((r) => `${r.tMs};${r.hr.toFixed(2)};${r.sqi.toFixed(2)}${cOf(r)}`).join('\n') + '\n');
  if (ppgConf) {
    let low = 0;
    for (const r of rows) if (ppgConf.has(r.tMs / 1000) && ppgConf.get(r.tMs / 1000) < 0.5) low++;
    console.log(`[PPG] c: ${low} of ${rows.length} s below 0.5`);
  }
  console.log(
    `[PPG] meanSQI≈${res.meanSQI} · ${rows.length} 1-Hz s · ${rows.length ? new Date(rows[0].tMs).toISOString().slice(11, 19) : '—'}…${rows.length ? new Date(rows[rows.length - 1].tMs).toISOString().slice(11, 19) : ''} → ${f}`
  );
}

// ── H10: raw ECG → ECGDSP (Pan-Tompkins) → 1-Hz HR ─────────────────────────
/* ── H10: raw ECG → ECGDSP.parseECGLines → Pan-Tompkins → 1-Hz HR ────────────────────────────────
   Residue 2026-11-06-the-sigma-window-ecg-leg-duplicates-the-dsp-parser. This leg used to parse with
   a local ISO-regex reader, so it took no host-axis `fs` correction, detected no clock resync, and
   derived its rate from the first and last `relMs` of the whole concatenation — the quantity a device
   clock step moves most. It now runs `ECGDSP.parseECGLines`, the DSP's own additive entry point, over
   the bounded line reader the production fold uses, one part at a time. `opts.runsText` is that
   part's `_ECGRUNS.txt` bytes when the box wrote one: the spans ride the record as `blankingSpans`,
   where `analyze` reads recorded absence, because 0 µV is a legal ECG sample and validity can only
   travel out of band (§∅). */
if (ecg.length) {
  console.log(`[ECG] ${ecg.length} part(s) → ECGDSP.parseECGLines + the production fold…`);
  const erecs = ecg.map((f) => {
    const runsText = sidecarFor(f, 'ECG');
    const lines = readLinesBounded(f);
    return runsText ? ECGDSP.parseECGLines(lines, { runsText }) : ECGDSP.parseECGLines(lines);
  });
  /* `mergeEcg` REFUSES a night whose fragments disagree on `fs` by more than 0.05 Hz, because one
     sample index would then mean two durations. A refusal writes no file: a wrong HR series is worse
     than an absent one, and the next reader cannot tell a wrong one from a right one. */
  let rec = null;
  try {
    rec = mergeEcg(erecs);
  } catch (e) {
    console.error(`[ECG] REFUSED: ${e.message} — no file written for ${date}`);
    process.exit(2);
  }
  if (!rec) {
    console.error('[ECG] no part parsed into a record — nothing written');
    process.exit(2);
  }
  if (erecs.length > 1) {
    const gapMs = (rec.gaps || []).reduce((t, g) => t + (g.ms > 0 ? g.ms : 0), 0);
    console.log(`[ECG] ${erecs.length} part(s) folded on parsed records · ${(rec.gaps || []).length} gap(s), ${(gapMs / 1000).toFixed(1)} s of real off-link silence`);
  }
  if (rec.blankingSpansReason) console.log(`[ECG] blanking: no span was placed — ${rec.blankingSpansReason}`);
  else if (Array.isArray(rec.blankingSpans)) {
    const bs = rec.blankingSpans.reduce((a, b) => a + (b && b.n > 0 ? b.n : 0), 0);
    console.log(`[ECG] blanking: ${rec.blankingSpans.length} recorded span(s), ${bs} sample(s) of ${rec.int16.length}${rec.int16.length ? ` (${((100 * bs) / rec.int16.length).toFixed(2)} %)` : ''}`);
  }
  const res = ECGDSP.analyze(rec);
  const tt = res.tt || [],
    nn = res.nn || [],
    t0 = res.t0Ms ?? rec.t0Ms; // tt = beat times (s), nn = NN (ms)
  const beats = [];
  for (let i = 0; i < tt.length; i++) {
    const hr = 60000 / nn[i];
    if (hr >= 30 && hr <= 220) beats.push({ tMs: t0 + tt[i] * 1000, hr, sqi: 1 });
  }
  const rows = toOneHz(beats);
  // per-second fused-hat confidence: the same call ECGDex's own HRV path makes (A-peak sample
  // indices + per-beat SQI from computeSQI), keyed by absolute second.
  /* OMITTED, never defaulted, across a clock seam — the rule the PPG leg above has carried since the
     `c` column arrived. The local parser could not see a seam, so this leg wrote a weight over a
     changed clock; `parseECGLines` reports one, and an unmeasured weight stays visible as absent
     (§∅, Clock Contract §7). The consumers then run the classic hat for that file. */
  const ecgSeam = !!(rec.clockResyncs && rec.clockResyncs.length);
  const ecgConf = ecgSeam ? null : ECGDSP.beatConfidence(res.peaks || [], res.sqi || [], rec.fs, t0 || 0);
  if (ecgSeam) console.log(`[ECG] ${rec.clockResyncs.length} clock seam(s) in this night — \`c\` column OMITTED (classic hat downstream)`);
  const f = `${out}/h10-ecg-derived-${date}-HR.txt`;
  const cOfE = (r) => (ecgConf ? ';' + (ecgConf.has(r.tMs / 1000) ? ecgConf.get(r.tMs / 1000) : 1).toFixed(3) : '');
  writeFileSync(f, 'tMs;hr;src' + (ecgConf ? ';c' : '') + '\n' + rows.map((r) => `${r.tMs};${r.hr.toFixed(2)};ecg${cOfE(r)}`).join('\n') + '\n');
  if (ecgConf) {
    let lowE = 0;
    for (const r of rows) if (ecgConf.has(r.tMs / 1000) && ecgConf.get(r.tMs / 1000) < 0.5) lowE++;
    console.log(`[ECG] c: ${lowE} of ${rows.length} s below 0.5`);
  }
  console.log(`[ECG] fs≈${rec.fs} · ${rows.length} 1-Hz s → ${f}`);
}

/* Passing the sidecar is not reporting its absence (§∅): most of this corpus predates the writer, so
   most parts read `absent` and an absent sidecar is validity UNKNOWN over that stretch. */
const _validityLine = validityLine(validity);
if (_validityLine) console.log(_validityLine);
console.log('done. Append a TRIOS entry in sigma-no-reference-analysis.js and re-run the analysis tool.');
