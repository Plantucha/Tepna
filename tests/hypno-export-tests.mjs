// Tepna — tests/hypno-export-tests.mjs
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
/* The shared hypnogram shape and its two files (hypno-export.js): confidence is the posterior of the
   SHOWN stage, a stager without posteriors reports null, a refused window stays null, the 30 s viewer
   raster samples each epoch at the slot midpoint, the CSV's unmeasured columns are empty (never 0), and
   a night with no anchor or no scored epoch is refused. */
import { fromEpochList, fromIndexed, summarize, toJson, toViewerCsv, VIEWER_HEADER, viewerSlots, wallClock } from '../hypno-export.js';

let pass = 0;
const fails = [];
const ok = (cond, msg) => {
  if (cond) pass++;
  else fails.push(msg);
};
const throws = (fn, re, msg) => {
  try {
    fn();
    fails.push(msg + ' (did not throw)');
  } catch (e) {
    ok(re.test(e.message), msg + ' — ' + e.message);
  }
};
const T0 = Date.UTC(2026, 10, 2, 23, 0, 0); // floating 2026-11-02 23:00:00

// ── fromIndexed: the decoded path's stage carries ITS posterior, not the arg-max's ──
{
  // epoch 1: arg-max is Light (0.6) but the decoded path shows Wake (0.4) — confidence must be 0.4
  const proba = [0.9, 0.05, 0.03, 0.02, 0.4, 0.6, 0, 0, 0.1, 0.1, 0.7, 0.1];
  const h = fromIndexed([0, 0, 2], { proba, K: 4, startMs: T0, epochSec: 30 });
  ok(h.stages.join() === 'Wake,Wake,Deep', 'indexed stages map through the stage names');
  ok(h.confidence[0] === 0.9 && h.confidence[1] === 0.4 && h.confidence[2] === 0.7, 'confidence = posterior of the shown stage');
  throws(() => fromIndexed([0, 1], { proba: [1, 0, 0, 0], K: 4 }), /shorter than T/, 'a short posterior is refused');
  ok(fromIndexed([0, 1], {}).confidence === null, 'no posterior → confidence null, never a constant');
}

// ── fromEpochList: a refused window is a null stage, never its neighbour's ──
{
  const h = fromEpochList(
    [
      { tMin: 10, stage: 'Light' },
      { tMin: 15, stage: 'Deep' },
      { tMin: 25, stage: 'REM' }
    ],
    { startMs: T0, epochSec: 300 }
  );
  ok(h.stages.length === 4 && h.stages[2] === null && h.stages[3] === 'REM', 'the missing 20-min window stays null');
  ok(h.startMs === T0 + 10 * 60000, 'the anchor moves to the first epoch');
  ok(h.confidence === null, 'the rule set carries no confidence');
  ok(fromEpochList([], { startMs: T0 }).stages.length === 0, 'an empty list is an empty night');
}

// ── summarize: onset, awakenings (a wake bout BETWEEN sleep, not the final getting-up) ──
{
  const st = ['Wake', 'Wake', 'Light', 'Wake', 'Deep', 'REM', 'Wake', 'Light', 'Wake', 'Wake'];
  const idx = st.map((s) => ['Wake', 'Light', 'Deep', 'REM'].indexOf(s));
  const s = summarize(fromIndexed(idx, { startMs: T0, epochSec: 30 }));
  ok(s.sleepOnsetMin === 1, 'sleep onset after two wake epochs = 1 min');
  ok(s.awakenings === 2, 'two awakenings; the final wake is not one');
  ok(s.minutes.Wake === 3 && s.sleepMin === 2, 'minutes from epochs');
  ok(s.meanConfidence === null && s.lowConfidencePct === null, 'no confidence → its read is null');
}

// ── the viewer raster: 5-min epochs → ten 30 s slots each, null → 0 ──
{
  const h = fromEpochList(
    [
      { tMin: 0, stage: 'Light' },
      { tMin: 10, stage: 'REM' }
    ],
    { startMs: T0, epochSec: 300 }
  );
  const sl = viewerSlots(h);
  ok(sl.length === 30, '15 min → 30 slots');
  ok(sl.slice(0, 10).every((c) => c === 3) && sl.slice(10, 20).every((c) => c === 0) && sl.slice(20).every((c) => c === 2), 'Light=3, gap=0, REM=2 by midpoint');
}

// ── the viewer CSV: header, wall clock via getUTC*, empty unmeasured columns ──
{
  const idx = [0, 1, 1, 2, 3, 0, 1];
  const h = fromIndexed(idx, { startMs: T0, epochSec: 30 });
  const csv = toViewerCsv(h);
  const [hdr, row] = csv.trim().split('\n');
  ok(hdr === VIEWER_HEADER, 'the header is the importer layout');
  const f = row.split(',');
  ok(f[0] === '2026-11-02 23:00:00' && f[1] === '2026-11-02 23:03:30', 'start/end as floating wall clock');
  ok(f[3] === '' && f[10] === '', 'quality score and morning feel are EMPTY, never 0');
  ok(f[4] === '1' || f[4] === '0', 'time to sleep in whole minutes');
  ok(/^"1 3 3 4 2 1 3"$/.test(f[11]), 'detailed graph codes 1 Wake · 3 Light · 4 Deep · 2 REM');
  ok(f[12] === '"3"', 'the 5-min column is the majority code');
  ok(wallClock(Date.UTC(2026, 0, 1, 0, 0, 0)) === '2026-01-01 00:00:00', 'wallClock pads');
  throws(() => toViewerCsv({ ...h, startMs: null }), /no start time/, 'no anchor → refused');
  throws(() => toViewerCsv(fromIndexed([], { startMs: T0 })), /no scored epoch/, 'nothing scored → refused');
}

// ── the JSON: lossless, schema-stamped ──
{
  const h = fromIndexed([0, 3], { proba: [0.8, 0.1, 0.05, 0.05, 0.1, 0.1, 0.1, 0.7], K: 4, startMs: T0, epochSec: 30, source: { node: 'OxyDex' } });
  const j = toJson(h);
  ok(j.schema === 'tepna.hypnogram/1' && j.start === '2026-11-02T23:00:00', 'schema and floating start');
  ok(j.stages.join() === 'Wake,REM' && j.confidence.join() === '0.8,0.7', 'stages and confidence verbatim');
  ok(j.summary.meanConfidence === 0.75 && j.summary.lowConfidencePct === 0, 'confidence read in the summary');
  ok(toJson({ ...h, startMs: null }).start === null, 'no anchor → start null');
}

if (fails.length) {
  for (const f of fails) console.error('  ✗ ' + f);
  console.error(`hypno-export: ${fails.length} failed, ${pass} ok`);
  process.exit(1);
}
console.log(`hypno-export: all ${pass} checks ok`);
