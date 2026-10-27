#!/usr/bin/env node
/*
 * tools/oracle-ppg-device-beats.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE ORACLE HARNESS, PPG LEG — PpgDex's foot detector against the RING'S OWN beat markers
 *
 * The twin of `tools/oracle-ecg-firmware-rr.mjs`, and it deliberately differs in exactly one place.
 *
 * ── WHAT THE `156` ROWS ARE, BY THE DEVICE'S OWN WORD ────────────────────────────────────────────
 * The O2Ring firmware inserts one `156` row per detected beat into the raw `_PPG.txt`. Wren settled
 * this on 2026-10-04 without relying on inference: across three nights, **304/304 PLETHA `156`s carry
 * `beat=1`, and every `beat=1` sits on a `156`**, at 48–53/min against a pulse rate of 48–60.
 * Cross-stream alignment was tried FIRST and is NOT identifiable — PLETHA is a separately beat-marked
 * waveform with its own `156`s and no device clock, so it is not a subsequence of `_PPG.txt`. The
 * device's own flag is what decides it; the alignment could not have.
 *
 * ── THE ONE PLACE THIS DIFFERS FROM THE ECG LEG: IT PAIRS BY TIME ───────────────────────────────
 * The H10's `_RR.txt` carries ARRIVAL stamps (median −79 ms, SD 299 ms against the device-reported
 * intervals), so the ECG leg must ignore the axis and align the interval trains by INDEX. Here both
 * trains are rows of the SAME file on the SAME device-crystal grid, so the axis is shared by
 * construction, time pairing is identifiable, and it is the ONLY pairing that can see the firmware's
 * detection lag at all — an index pairing is invariant to it. Everything else is the ECG leg's
 * discipline kept: re-fit per window, report the fan, and an absolute floor of one sample period.
 *
 * ── THE CRITERION IS PRE-STATED FROM THE INSTRUMENT, NOT FROM THE DATA (§🧾) ─────────────────────
 * One ADC sample at the ring's 125.000 Hz crystal is **8.000 ms**, and two detectors reading one
 * waveform cannot disagree by less than the sampling interval in any meaningful sense — a beat lands
 * on a sample. That number is the crystal's, fixed before any night was read, and it is numerically
 * the same 8 ms the ECG leg uses for the same reason at a different rate. A threshold derived from the
 * data it judges would be UNKNOWN by the verdict contract; this one is derived from the hardware.
 *
 * ⚠️ THE HEADLINE IS THE INTERVAL DELTA, NOT THE LAG. The marker records the firmware's DETECTION
 * instant, so it sits a FIXED lag after our foot — ~184–200 ms measured on the real corpus. That lag
 * is a DEVICE PROPERTY and scoring it would report a working detector as broken. So the criterion is
 * `ppi_delta_median`, which differences both trains and is therefore latency-invariant and directly
 * comparable to the ECG leg's `rr_delta_median <= 8 ms`; the lag is reported beside it as a latency,
 * with its MAD as the agreement about when a beat is called.
 *
 * ⚠️ NOT A SECOND SENSOR (`R5-HR-TRIPLET-REFERENCE` §4, standing). This is a second ESTIMATOR on one
 * sensor and one stream. Its value is precisely that: no inter-device clock offset and no
 * cross-channel common mode, which is the blind spot that let the optical polarity defect hide. It is
 * NOT a fourth corner for the σ work and must never be read as evidence of device independence.
 *
 * A REFERENCE IS A REFERENCE, NOT GROUND TRUTH. Disagreement opens an investigation, never an
 * auto-fix, and agreement between two detectors on one waveform proves nothing physiological — both
 * can be wrong the same way, on the same optics, on the same night.
 *
 * USAGE
 *   node tools/oracle-ppg-device-beats.mjs --dir <captures>   # score every ring night that carries _PPG.txt
 *   node tools/oracle-ppg-device-beats.mjs --verdict-sample   # the tepna.verdict/1 object over SYNTHETIC
 *                                                            # input — no corpus, no DSP; what the
 *                                                            # adoption gate runs in CI
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';
import { notANight, populationVerdict, ruleLine, snapshotNights } from './corpus-scope-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
/* The ring's crystal, and therefore the floor. 32 MHz ÷8 ÷32000 = 125.000 Hz exactly (TI AFE4403, no
   internal RC) — `ppgdex-dsp.js O2_ADC_HZ`. Stated here rather than imported so the criterion is
   readable without loading a bundle, and asserted equal to the DSP's in the selftest below. */
const O2_ADC_HZ = 125.0;
const SAMPLE_MS = 1000 / O2_ADC_HZ;
/* Bound by the CLI before any night is scored; `scoreNight` takes an override so a caller (and the
   selftest) can inject one without loading the DSP realm. */
let ppgFootTimes = null;

/* ── THE BANDS, STATED BEFORE THE FIRST NIGHT WAS READ ──────────────────────────────────────────
   [pass, shortfall] — the headline is `ppiDeltaMedianMs`, latency-invariant. `latencyMadMs` shares the
   sample floor for the same reason. `matchedPct` is a POPULATION band, not an agreement one: a night
   where few beats pair has not disagreed, it has failed to be comparable, and that is a SHORTFALL
   rather than a FAIL. The latency itself has NO band by design — see the header. */
export const BANDS = {
  ppiDeltaMedianMs: [SAMPLE_MS, 20],
  latencyMadMs: [SAMPLE_MS, 20],
  matchedPct: [97, 90]
};
export const MIN_NIGHTS = 10; // below this the pooled median is UNDERPOWERED, not a verdict

export function median(a) {
  if (!a.length) return Number.NaN;
  const b = a.slice().sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}

/* One night → one row, or a refusal carrying its reason. The DSP does the comparison (`validateBeats`);
   this harness only selects nights, pools rows and bands the pooled median. Forking the comparison
   here would make the oracle and the shipped export two things that can be corrected differently —
   the defect the ECG leg's note warns about. */
export function scoreNight(PPGDSP, ppgText, opts = {}) {
  /* ⚠️ `parsePPG` THROWS on a file it cannot read; it does not return null. My first version guarded
     `if (!rec)` and nothing else, so the first unreadable file in the corpus aborted the whole run —
     43 nights of scoring lost to one 0-row `_PPG.txt`, with the pooled verdict never printed. A
     harness over a corpus must survive its worst file: an unreadable one is a REFUSAL with a reason,
     which is a row, not a crash. (§4c's shape one layer up: a run that dies has no verdict, and no
     verdict is not a result.) */
  let rec;
  try {
    rec = PPGDSP.parsePPG(ppgText);
  } catch (e) {
    return { ok: false, reason: 'unparsed: ' + String((e && e.message) || e).slice(0, 90) };
  }
  if (!rec) return { ok: false, reason: 'unparsed' };
  if (!rec.beatMarkerSec || !rec.beatMarkerSec.length) return { ok: false, reason: 'no-device-markers' };
  /* OUR OWN FEET COME FROM `ppgFootTimes`, NOT FROM A LOCAL RE-DERIVATION. It is the one helper that
     applies the node's CONSENSUS POLARITY — `pat-matchrate-strict.mjs`'s own note records a whole tool
     chain measuring PAT on per-channel polarity guesses the shipping node would have overruled, with a
     dissenting channel detected upside down and its "feet" landing on peaks. Re-deriving feet here
     would be a second copy of that decision, free to drift the same way.
     ⚠️ UNITS. `ppgFootTimes` returns EPOCH MILLISECONDS; `beatMarkerSec` is seconds on the recording's
     own `relSec` grid. My first version passed them straight into the comparator and every night
     refused `no-own-beats` or would have paired nothing — so the feet are brought onto `relSec` here,
     which is the axis the markers live on and the only one on which the two are comparable. */
  let ft;
  try {
    ft = opts.footTimes || (opts.ppgFootTimes || ppgFootTimes)(ppgText);
  } catch (e) {
    // `ppgFootTimes` throws when the file carries no phone timestamp — same discipline as above.
    return { ok: false, reason: 'no-own-beats: ' + String((e && e.message) || e).slice(0, 90) };
  }
  const times = ft && ft.times;
  if (!times || !times.length) return { ok: false, reason: 'no-own-beats' };
  if (rec.t0Ms == null) return { ok: false, reason: 'no-t0' };
  const footSec = Array.from(times, (ms) => (ms - rec.t0Ms) / 1000).filter((v) => Number.isFinite(v));
  if (!footSec.length) return { ok: false, reason: 'no-own-beats' };
  const v = PPGDSP.validateBeats(footSec, Array.from(rec.beatMarkerSec), { fs: O2_ADC_HZ });
  if (!v.ok) return v;
  return {
    ok: true,
    reason: null,
    matched: v.matched,
    matchedPct: +((100 * v.matched) / Math.max(1, v.nSelf)).toFixed(2),
    unmatchedSelf: v.unmatchedSelf,
    unmatchedDevice: v.unmatchedDevice,
    latencyMedianMs: v.latencyMedianMs,
    latencyMadMs: v.latencyMadMs,
    latencySpreadMs: v.latencySpreadMs,
    ppiDeltaMedianMs: v.ppiDeltaMedianMs,
    madWithinOneSample: v.madWithinOneSample,
    ppiDeltaWithinOneSample: v.ppiDeltaWithinOneSample
  };
}

export function pool(rows) {
  const ok = rows.filter((r) => r.ok);
  /* ⚠️ A SESSION FILE IS NOT A NIGHT, and the first version of this pooled them as if it were. The ring
     writes one `_PPG.txt` per BLE session, so a single night yields many files — the 4-night subset this
     was first run on produced 25 scored files, and reporting `nights: 25` against a floor of 10 would
     have called a 4-night sample powered. Files from one night share the strap, the placement and the
     perfusion, so they are not independent in the way the floor assumes. The floor therefore counts
     DISTINCT NIGHTS and the file count is published beside it, never instead of it. */
  const nights = new Set(ok.map((r) => r.night).filter((v) => v != null));
  return {
    nights: nights.size || ok.length,
    files: ok.length,
    ppiDeltaMedianMs: median(ok.map((r) => r.ppiDeltaMedianMs).filter((v) => Number.isFinite(v))),
    latencyMedianMs: median(ok.map((r) => r.latencyMedianMs).filter((v) => Number.isFinite(v))),
    latencyMadMs: median(ok.map((r) => r.latencyMadMs).filter((v) => Number.isFinite(v))),
    matchedPct: median(ok.map((r) => r.matchedPct).filter((v) => Number.isFinite(v)))
  };
}

export function verdictObject(pooled, rows, meta = {}) {
  const head = pooled.ppiDeltaMedianMs;
  const files = pooled.files != null ? pooled.files : rows.filter((r) => r.ok).length;
  let status, reason, population, result;
  /* NOT_RUN EXAMINED NOTHING; UNDERPOWERED EXAMINED TOO FEW (VERDICT-CONTRACT §1). With no ring
     `_PPG.txt` anywhere under the root this oracle scored no night at all, and the band arithmetic
     reads that as UNDERPOWERED — a claim that it looked at nights and found too few of them. So the
     arithmetic sits in the `else` below, which a run that examined nothing cannot enter. `meta.notRun`
     carries the real reason and the count of night directories the walk OFFERED, so an absent corpus
     (`eligible: 0`) and a corpus holding no session file (`eligible: N`) stop reading alike. The twin
     `oracle-ecg-firmware-rr.mjs` publishes the same shape for the same reason. */
  if (meta.notRun) {
    const offered = meta.notRun.eligible || 0;
    status = 'NOT_RUN';
    reason = meta.notRun.reason;
    population = { checked: 0, eligible: offered, excluded: offered };
    result = null;
  } else {
    /* THE POPULATION IS IN NIGHTS, THE UNIT ITS OWN FLOOR IS WRITTEN IN. `pool()` counts DISTINCT
       NIGHTS because files from one night share strap, placement and perfusion, and `MIN_NIGHTS`
       judges that count — but `checked` published the scored FILE count, so the field and the floor
       beside it spoke different units (61 against a floor of 10). The file count is already inside
       `result`. `eligible` is the night directories the walk offered, the same unit the NOT_RUN
       branch publishes. A walk cannot offer fewer nights than it scored; the clamp keeps
       `checked + excluded = eligible` true rather than publishing a negative if one ever does. */
    const checked = pooled.nights;
    population = { checked, eligible: Math.max(meta.nightsOffered == null ? checked : meta.nightsOffered, checked), excluded: 0 };
    population.excluded = population.eligible - checked;
    result = null;
    if (pooled.nights < MIN_NIGHTS || !Number.isFinite(head)) {
      status = 'UNDERPOWERED';
      reason = `${pooled.nights} usable night(s) across ${files} session file(s)${meta.filesRead != null && meta.filesRead !== files ? ` of ${meta.filesRead} read` : ''} against a floor of ${MIN_NIGHTS} nights — a file is not a night (files from one night share strap, placement and perfusion), so the pooled median is not a verdict below it`;
    } else if (head <= BANDS.ppiDeltaMedianMs[0] && pooled.latencyMadMs <= BANDS.latencyMadMs[0]) {
      status = 'PASS';
      reason = null;
    } else if (head <= BANDS.ppiDeltaMedianMs[1]) {
      status = 'SHORTFALL';
      reason = `pooled ppi_delta_median ${head.toFixed(2)} ms exceeds one ADC sample (${SAMPLE_MS.toFixed(3)} ms) but stays inside the ${BANDS.ppiDeltaMedianMs[1]} ms shortfall band`;
    } else {
      status = 'FAIL';
      reason = `pooled ppi_delta_median ${head.toFixed(2)} ms exceeds the ${BANDS.ppiDeltaMedianMs[1]} ms band`;
    }
    if (!(status === 'UNDERPOWERED' && !Number.isFinite(head))) result = pooled;
  }
  return {
    schema: 'tepna.verdict/1',
    gate: 'oracle-ppg-device-beats',
    status,
    // `internal`: this is a detector cross-check on ONE sensor, so its numbers are not quotable
    // outside the repo as independent validation (R5 §4 — a second estimator, not a second sensor).
    scope: 'internal',
    population,
    criterion: { name: 'ppi_delta_median', threshold: +BANDS.ppiDeltaMedianMs[0].toFixed(3), unit: 'ms', direction: 'lte' },
    result,
    evidence: ['tools/oracle-ppg-device-beats.mjs', ...(meta.roots || []).map((r) => `${r}/**/*_PPG.txt`)],
    reason,
    producedBy: {
      tool: 'tools/oracle-ppg-device-beats.mjs',
      commit: meta.commit || null,
      /* 🔴 THE REASON MUST BE THE REAL ONE. No real run passed `meta.commit`, so every published
         object claimed `not run inside a git checkout` from inside this checkout. The CLI now stamps
         `gitCommit()`, and this line is reached only when that returned null — or for the sample,
         which claims no code identity by design. */
      ...(meta.commit ? {} : { commitReason: meta.sample ? '--verdict-sample: synthetic input, no code identity claimed' : 'not run inside a git checkout' })
    },
    at: (meta.at || new Date().toISOString()).replace(/\.\d{3}Z$/, 'Z')
  };
}

/* The synthetic pooled input the adoption gate reads — corpus-free and DSP-free by contract
   (VERDICT-CONTRACT §3b: CI runs this, so it must be cheap). The numbers are the real corpus's shape,
   which is the point: a sample that could not occur would assert nothing about the real object. */
const SAMPLE_POOLED = { nights: 12, files: 61, ppiDeltaMedianMs: 2.24, latencyMedianMs: 189.9, latencyMadMs: 1.98, matchedPct: 99.1 };
const SAMPLE_ROWS = Array.from({ length: 12 }, () => ({ ok: true }));

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    /* not a checkout → commit null, and THEN the commitReason above is the true one */
    return null;
  }
}

/* The population beside the verdict, from the SAME snapshot the scored set was drawn from — never a
   second walk, which would let the two disagree (Magpie, #3850). `snap` is the offer, the scored
   nights are the read, and the gap between them is what a reader needs to chase a figure that moved. */
/* THE OTHER HALF OF A RULE WIDER THAN NIGHT-SHAPED now comes from `corpus-scope.mjs`, which is where
   that row said the shared home was (2026-10-22-the-removal-namer-is-duplicated-in-two-oracles). The
   sentence stays here — below, where it says the directory held no scorable Wellue `_PPG.txt` — and
   so do the legs that accept the shared namer against THIS tool's shape: rows carrying the read's own
   `ok`, where a night whose read failed is removed rather than counted as covered. */

function printPopulation(pop, snap, rows) {
  if (pop) console.log(`\n  population: ${pop.status} — ${pop.population.checked} night(s) the run can report over, of ${pop.population.eligible} it saw${pop.reason ? ` · ${pop.reason}` : ''}`);
  else console.log(`\n  population: ${snap.n} night director${snap.n === 1 ? 'y' : 'ies'} offered under ${snap.root}${snap.ok ? '' : ` · ${snap.reason}`}`);
  const rl = ruleLine({ result: { rule: snap.rule, ruleRejectedNightShaped: snap.rejectedNightShaped, ruleAdmittedNonNight: snap.admittedNonNight } });
  if (rl) console.log(rl);
  const bare = notANight(snap, rows);
  if (bare.length)
    console.log(`  the read removed ${bare.length} of ${snap.n}, holding no scorable Wellue _PPG.txt: ${bare.slice(0, 12).join(', ')}${bare.length > 12 ? `, … (+${bare.length - 12})` : ''}`);
}

const IS_CLI = isCliEntry(import.meta.url);
if (IS_CLI) {
  const argv = process.argv.slice(2);
  const arg = (n, d) => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  if (argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(verdictObject(SAMPLE_POOLED, SAMPLE_ROWS, { roots: ['/corpus'], commit: null, at: '2026-10-04T00:00:00Z', sample: true }), null, 2));
    process.exit(0);
  }
  if (argv.includes('--selftest')) {
    const V = createRequire(import.meta.url)('../verdict.js');
    const fail = [];
    let ran = 0;
    const chk = (what, cond) => {
      ran++;
      if (!cond) fail.push(what);
    };
    chk('the sample verdict validates against verdict.js', V.validate(verdictObject(SAMPLE_POOLED, SAMPLE_ROWS, { sample: true })).ok !== false);
    chk('one ADC sample is 8.000 ms and that is the threshold', Math.abs(SAMPLE_MS - 8) < 1e-9);
    chk('a 12-night corpus at the corpus shape PASSES', verdictObject(SAMPLE_POOLED, SAMPLE_ROWS, {}).status === 'PASS');
    chk('fewer nights than the floor is UNDERPOWERED, never a PASS', verdictObject({ ...SAMPLE_POOLED, nights: 3 }, SAMPLE_ROWS.slice(0, 3), {}).status === 'UNDERPOWERED');
    // THE POPULATION TRAP, pinned: many FILES from few NIGHTS must not clear the floor.
    chk('25 session files from 4 nights is UNDERPOWERED, not powered', verdictObject({ ...SAMPLE_POOLED, nights: 4, files: 25 }, SAMPLE_ROWS, {}).status === 'UNDERPOWERED');
    chk('…and its reason says a file is not a night', /a file is not a night/.test(verdictObject({ ...SAMPLE_POOLED, nights: 4, files: 25 }, SAMPLE_ROWS, {}).reason || ''));
    chk('a median past one sample but inside the band is a SHORTFALL', verdictObject({ ...SAMPLE_POOLED, ppiDeltaMedianMs: 12 }, SAMPLE_ROWS, {}).status === 'SHORTFALL');
    chk('past the band it FAILS', verdictObject({ ...SAMPLE_POOLED, ppiDeltaMedianMs: 44 }, SAMPLE_ROWS, {}).status === 'FAIL');
    chk('a clean median with a blown LATENCY MAD is not a PASS', verdictObject({ ...SAMPLE_POOLED, latencyMadMs: 31 }, SAMPLE_ROWS, {}).status !== 'PASS');
    /* 🔴 THIS LEG EXAMINED NOTHING. It read
       `['UNDERPOWERED','SHORTFALL','FAIL'].every((st) => true) && verdictObject(…).reason`: the
       `.every` maps three status NAMES onto the literal `true`, never builds a verdict for any of
       them, and cannot fail. Only the one FAIL object after the `&&` was ever tested, so two of the
       three named statuses rode on an assertion that could not see them. The question needs one real
       verdict per status, which is what this does. */
    const nonPass = [
      ['UNDERPOWERED', verdictObject({ ...SAMPLE_POOLED, nights: 3 }, SAMPLE_ROWS.slice(0, 3), {})],
      ['SHORTFALL', verdictObject({ ...SAMPLE_POOLED, ppiDeltaMedianMs: 12 }, SAMPLE_ROWS, {})],
      ['FAIL', verdictObject({ ...SAMPLE_POOLED, ppiDeltaMedianMs: 44 }, SAMPLE_ROWS, {})],
      ['NOT_RUN', verdictObject({ nights: 0 }, [], { notRun: { eligible: 3, reason: 'three offered, none holding a session file' } })]
    ];
    chk('each of the four non-PASS statuses is reachable, in order', nonPass.map(([, v]) => v.status).join(',') === nonPass.map(([st]) => st).join(','));
    chk(
      'every non-PASS verdict carries a reason',
      nonPass.every(([, v]) => typeof v.reason === 'string' && v.reason.length > 0)
    );
    chk(
      '…and every one of them validates against verdict.js',
      nonPass.every(([, v]) => V.validate(v).ok !== false)
    );
    chk('a PASS carries none', verdictObject(SAMPLE_POOLED, SAMPLE_ROWS, {}).reason === null);
    // NOT_RUN EXAMINED NOTHING: a refusal publishes a verdict, and the two refusals differ.
    const nrAbsent = verdictObject({ nights: 0 }, [], { notRun: { eligible: 0, reason: 'no corpus root' } });
    const nrOffered = nonPass[3][1];
    chk('an absent root and a root offering nights stop reading alike', nrAbsent.population.eligible === 0 && nrOffered.population.eligible === 3);
    chk('a NOT_RUN verdict publishes no result', nrAbsent.result === null && nrOffered.result === null);
    chk('NOT_RUN keeps checked + excluded = eligible', nrOffered.population.checked + nrOffered.population.excluded === nrOffered.population.eligible);
    chk('an unscorable corpus is never UNDERPOWERED, which would claim it looked', nrOffered.status === 'NOT_RUN' && nrAbsent.status === 'NOT_RUN');
    // THE POPULATION IS IN NIGHTS — the unit MIN_NIGHTS is written in, not the session-file count.
    const withOffer = verdictObject({ ...SAMPLE_POOLED, nights: 12, files: 61 }, SAMPLE_ROWS, { nightsOffered: 14 });
    chk('population.checked counts nights, not the 61 session files', withOffer.population.checked === 12);
    chk('…eligible is what the walk offered, and excluded is the gap', withOffer.population.eligible === 14 && withOffer.population.excluded === 2);
    chk('…and the file count stays published, inside result', withOffer.result.files === 61);
    chk('with no offered count the population closes on itself', verdictObject(SAMPLE_POOLED, SAMPLE_ROWS, {}).population.excluded === 0);
    /* THE REMOVAL IS NAMED, NOT COUNTED. The rule here is `/./`, so the walk admits any directory
       and only the read can say which held nothing. */
    const plantedSnap = { n: 3, nights: ['2026-07-25', '2026-07-26', 'logs'] };
    chk('the read removes two directories, and names them rather than counting them', notANight(plantedSnap, [{ night: '2026-07-25', ok: true }]).join(',') === '2026-07-26,logs');
    chk('a night whose read failed is removed, never counted as covered', notANight(plantedSnap, [{ night: '2026-07-25', ok: false }]).length === 3);
    chk('CONTROL · a root that offered nothing names no removal', notANight({ n: 0, nights: [] }, []).length === 0);
    if (fail.length) {
      console.error('oracle-ppg-device-beats --selftest FAILED:\n  ' + fail.join('\n  '));
      process.exit(1);
    }
    // `all <N> selftests passed` is the line `tools/selftest-all.mjs` parses. A selftest whose count
    // cannot be read is one the gate cannot distinguish from a selftest that asserted nothing.
    console.log(`oracle-ppg-device-beats: threshold = one ADC sample = ${SAMPLE_MS.toFixed(3)} ms`);
    console.log(`all ${ran} selftests passed`);
    process.exit(0);
  }
  const dir = arg('--dir', join(ROOT, 'uploads', 'captures'));
  /* A REFUSAL IS A RESULT, SO IT CARRIES A VERDICT. This printed one line and exited 2 with no
     `tepna.verdict/1` object at all, so an unattended caller collecting verdicts saw the run simply
     missing, and could not tell an absent root from a root holding no ring night. Both now publish
     NOT_RUN, and `population.eligible` separates them. */
  if (!existsSync(dir)) {
    console.error(`oracle-ppg-device-beats: ${dir} not found. The raw corpus is gitignored — pass --dir.`);
    console.log(
      JSON.stringify(
        verdictObject({ nights: 0 }, [], { roots: [dir], commit: gitCommit(), notRun: { eligible: 0, reason: `no corpus root at ${dir} — the raw corpus is gitignored, so pass --dir` } }),
        null,
        2
      )
    );
    process.exit(2);
  }
  const PM = await import('./pat-matchrate-strict.mjs');
  const { PPGDSP } = PM.getDsps();
  ppgFootTimes = PM.ppgFootTimes;
  const rows = [];
  /* `/./` — every directory under the root is OFFERED to this oracle, because a ring night is named
     by the capture host and this tool must not decide what a night looks like. The snapshot records
     that wide rule and names what it swallowed, which is the only form a reader can chase. */
  const snap = snapshotNights(dir, { re: /./ });
  /* 🔴 STAMP THE CODE THAT RAN, NOT THE CODE AT THE END OF THE RUN. Scoring takes minutes, and this
     tool read `a60f2102f` on a run that opened at 02:47 under an earlier tree and closed at 02:55
     after a commit landed in this worktree. Node loaded the module at the start, so the identity of
     what produced the figures is the identity HERE — the later sha names a tree the run never ran. */
  const commit = gitCommit();
  for (const night of snap.nights) {
    const nd = join(dir, night);
    let files = [];
    try {
      files = readdirSync(nd).filter((f) => /Wellue.*_PPG\.txt$/.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      const r = scoreNight(PPGDSP, readFileSync(join(nd, f), 'utf8'));
      rows.push({ night, file: f, ...r });
      console.log(r.ok ? `  ✓ ${night} ${f}  matched ${r.matchedPct}%  lag ${r.latencyMedianMs} ms (MAD ${r.latencyMadMs})  ppiΔ ${r.ppiDeltaMedianMs} ms` : `  ⊘ ${night} ${f}  ${r.reason}`);
    }
  }
  if (!rows.length) {
    const v = verdictObject({ nights: 0 }, [], {
      roots: [dir],
      commit: gitCommit(),
      notRun: {
        eligible: snap.n,
        reason: !snap.ok
          ? `root not enumerable: ${snap.reason}`
          : snap.n === 0
            ? 'the root holds no directory at all, so no night was offered and none was scored'
            : `${snap.n} night director${snap.n === 1 ? 'y' : 'ies'} offered under the root and not one holds a Wellue _PPG.txt, so no night was scored`
      }
    });
    printPopulation(null, snap, rows);
    console.log(JSON.stringify(v, null, 2));
    /* A RUN THAT SCORED NOTHING IS NOT A SUCCESSFUL RUN, and exit 0 is the only thing an unattended
       caller reads (row 2026-09-04-respacc-empty-run-exits-zero, closed by #2269). 2 keeps FAIL's 1
       distinct: 1 means nights were scored and the criterion missed, 2 means none were scored. The
       absent-root path above already exited 2, so the two refusals now agree. */
    process.exit(2);
  }
  const pooled = pool(rows);
  const v = verdictObject(pooled, rows, { roots: [dir], commit, nightsOffered: snap.n, filesRead: rows.length });
  /* THE SET MAY HAVE MOVED WHILE THIS RAN. Scoring 54 session files takes minutes and
     `tepna-corpus-tier.service` re-tiers daily, so the opening walk and the last file read can see
     different nights. The population verdict is that comparison, and without it a figure that moved
     because the corpus moved reads exactly like a figure that moved because the detector changed. */
  const population = populationVerdict(snap, snapshotNights(dir, { re: /./ }), {
    commit,
    tool: 'tools/oracle-ppg-device-beats.mjs',
    evidence: ['tools/oracle-ppg-device-beats.mjs', 'tools/corpus-scope.mjs']
  });
  console.log('\nA REFERENCE IS A REFERENCE, NOT GROUND TRUTH — disagreement opens an investigation, never an auto-fix.');
  console.log("The lag is the firmware's DETECTION LATENCY, a device property. The agreement is its MAD and the interval delta.");
  printPopulation(population, snap, rows);
  console.log(JSON.stringify({ ...v, detail: { corpusPopulation: population } }, null, 2));
  process.exit(v.status === 'FAIL' ? 1 : 0);
}
