#!/usr/bin/env node
/*
 * tools/nsrr-stage-validate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * SCORE THE SHIPPED SLEEP STAGER AGAINST EXPERT PSG LABELS.
 *
 * REM-STAGING-FOLLOWUPS §2b: "the shipped conjunction scored against REAL PSG labels; REM
 * recall/precision recorded. That single number has never existed and is the thing every staging
 * decision has been guessing at."
 *
 * Two staging efforts ended in measured negatives for want of a label (`REM-STAGING-REDESIGN` §8/§9,
 * `DEEP-STAGE-DESAT-CONFOUND` §9). §2a then found the labels were never missing — `parseNsrrXml` was
 * reading every scored stage event and discarding the stage IDENTITY on the same line, keeping only a
 * scalar for total sleep time. This tool is the other half: it joins those labels to the shipped
 * stager's output and scores it.
 *
 * ── WHY THIS EXISTS EVEN THOUGH NO RECORDS ARE ON THIS MACHINE ─────────────────────────────────
 * NSRR/PhysioNet require a signed DUA and the suite is 100 % local by construction, so it cannot
 * fetch. §2b is therefore blocked on RECORDS, not on code — and the way to keep that true is to build
 * the path and PROVE it, so the day a record arrives the only new variable is the record.
 *
 * `--selftest` does exactly that: it synthesises an EDF + a profusion annotation XML in memory, with
 * an RR structure that plants a known REM-like signature, and drives the whole chain —
 *     EDF bytes → CpapEdf.readEDF → ECG channel → ECGDSP.analyze (Pan-Tompkins, epochs)
 *              → ECGDSP.stageSleep → join to expert 30 s labels → recall / precision / confusion
 * — end to end. A green self-test means every link works and the join is arithmetically right.
 *
 * ⚠️ **A GREEN SELF-TEST IS NOT A VALIDATION RESULT.** The synthetic record is scored by the same
 * assumptions the detector holds, which is precisely the circular oracle `REM-STAGING-FOLLOWUPS` §1
 * bans for staging claims: `genSynthetic` plants REM carrying the exact signature the rule looks for
 * and scores 92.6 % against planted truth while under-calling REM ~4× on real nights. The self-test
 * proves the PIPELINE, never the DETECTOR. Only `--dir` over real NSRR records produces a number that
 * may be quoted, and this tool refuses to print recall/precision from `--selftest` for that reason.
 *
 * ── THE JOIN, which is where a scorer usually goes quietly wrong ────────────────────────────────
 * Expert labels are 30 s epochs. The shipped stager's epochs are FIVE MINUTES (`epochs[].tMin`). They
 * are not the same grid and must not be compared elementwise. Each detector epoch is scored against
 * the MAJORITY expert stage over the wall-clock window it actually covers, and a window whose expert
 * labels are mostly missing (an unscored gap) is EXCLUDED rather than counted as a miss — the same
 * discipline as `pat-matchrate-strict`'s coverable-beat denominator.
 *
 * USAGE
 *   node tools/nsrr-stage-validate.mjs --selftest          # prove the path, no records needed
 *   node tools/nsrr-stage-validate.mjs --dir <psg-dir>     # score real records (EDF + XML pairs)
 *   node tools/nsrr-stage-validate.mjs --dir <psg-dir> --json
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join, basename } from 'node:path';
import vm from 'node:vm';

const DexBuild = createRequire(import.meta.url)('./build-core.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const EPOCH_SEC = 30; // the expert grid

/* ── headless realm ─────────────────────────────────────────────────────────────────────────────
   DOMParser is required by `parseNsrrXml` and Node has none, so the realm gets a minimal XML DOM
   backed by a regex scan. It is deliberately NOT a general parser: it supports exactly the shape
   `parseNsrrXml` queries (ScoredEvent elements with EventConcept/Start/Duration children), and it
   throws on anything else rather than silently returning an empty NodeList — a stub that quietly
   finds nothing would make every record score as "no labels" and look like a data problem. */
export function makeRealm() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.__DEX_NAMESPACED__ = true;
  sandbox.DOMParser = class {
    parseFromString(text) {
      if (!/<ScoredEvent[\s>]/.test(text)) throw new Error('nsrr-stage-validate: XML has no <ScoredEvent> elements — this minimal DOM supports profusion annotation files only');
      const blocks = text.match(/<ScoredEvent[\s\S]*?<\/ScoredEvent>/g) || [];
      const pick = (b, tag) => {
        const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(b);
        return m ? m[1] : null;
      };
      const nodes = blocks.map((b) => ({
        querySelector(sel) {
          for (const tag of sel.split(',').map((s) => s.trim())) {
            const v = pick(b, tag);
            if (v != null) return { textContent: v };
          }
          return null;
        },
        textContent: b
      }));
      return {
        querySelector: (s) => (s === 'parsererror' ? null : null),
        querySelectorAll: () => {
          const a = nodes.slice();
          a.forEach = Array.prototype.forEach.bind(a);
          return a;
        }
      };
    }
  };
  const ctx = vm.createContext(sandbox);
  /* `CpapEdf` lives in cpapdex-edf.js, NOT cpapdex-dsp.js — the DSP only side-effect-loads it. Only the
     EDF reader is needed here, so the DSP is not loaded at all. `nsrr-adapter.js` wants OxyDex for its
     `analyzeRecord`, but this tool calls only `parseNsrrXml`, which needs nothing but DOMParser. */
  for (const f of ['clock.js', 'kernel-constants.js', 'cpapdex-edf.js', 'ecgdex-dsp.js', 'nsrr-adapter.js']) {
    const p = join(ROOT, f);
    if (!existsSync(p)) throw new Error('module not found: ' + f);
    vm.runInContext(DexBuild.classicify(readFileSync(p, 'utf8')), ctx, { filename: f });
  }
  for (const [n, v] of Object.entries({ CpapEdf: ctx.CpapEdf, ECGDSP: ctx.ECGDSP, NSRR: ctx.NSRR })) if (!v) throw new Error('nsrr-stage-validate: ' + n + ' did not load into the headless realm');
  return ctx;
}

// see buildEdf: CpapEdf needs a true ArrayBuffer, never a Node Buffer
export function toArrayBuffer(b) {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

/* ── EDF → the record shape ECGDSP.analyze expects ──────────────────────────────────────────────
   `analyze` reads {int16, fs} plus rec.t0Ms / rec.durSec / rec.gaps. It does NOT need Polar text, so
   an EDF channel can drive the shipped detector directly — which is the whole reason §2b is reachable
   on the current stack. `gaps: []` is honest here: EDF is a contiguous format. */
const ECG_LABELS = ['ecg', 'ekg', 'ecgl', 'ecg1', 'ecg2', 'ecglecgr', 'ecgi', 'ecgii'];
function ecgChannel(edf) {
  const keys = Object.keys(edf.signals || {});
  for (const k of keys) {
    const norm = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (ECG_LABELS.some((l) => norm === l || norm.startsWith(l))) return k;
  }
  return null;
}
function edfToEcgRec(edf) {
  const key = ecgChannel(edf);
  if (!key) return { err: 'no ECG channel (labels: ' + Object.keys(edf.signals || {}).join(', ') + ')' };
  const sig = edf.signals[key];
  const data = sig.data;
  const int16 = new Int16Array(data.length);
  /* EDF carries physical units; ECGDSP works on raw int16 counts and its detector is scale-relative,
     but an amplitude far from the Polar range changes nothing about peak DETECTION only if the
     dynamic range survives the cast. So scale to fill int16 rather than truncating millivolts to 0. */
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < lo) lo = data[i];
    if (data[i] > hi) hi = data[i];
  }
  const span = hi - lo || 1;
  for (let i = 0; i < data.length; i++) int16[i] = Math.round(((data[i] - lo) / span) * 60000 - 30000);
  const t0Ms = edf.clock && edf.clock.t0Ms != null ? edf.clock.t0Ms : Date.UTC(2020, 0, 1, 22, 0, 0);
  return { rec: { int16, fs: sig.fs, t0Ms, durSec: Math.floor(data.length / (sig.fs || 1)), gaps: [] }, label: key };
}

/* ⚠️ A DETECTED STAGE IS AN OBJECT, NOT A STRING — and that silently zeroed every number this tool
   ever produced. `ECGDSP.stageSleep` returns `{ tMin, stage, y }`, and `scoreRecord` selects between
   `res.stages` and a direct `stageSleep` call — BOTH of which are that shape, so there was no
   string branch to fall back to. Used as a label, the object stringifies to `[object Object]`, which
   never equals 'REM': recall was STRUCTURALLY 0 and the confusion table keyed every expert stage to
   a single `[object Object]` column.

   Measured 2026-09-12 on real SHHS records — shhs1-200001/2/3 each reported REM recall 0.0 % against
   expert REM fractions of 11 / 5 / 10 %, which reads exactly like a stager that never fires.

   ⚠️ WHY NO GATE COULD SEE IT, which is the part worth keeping. `--selftest` REFUSES to compute
   recall/precision from synthetic input — deliberately, because a synthetic record scored by the
   detector's own assumptions is the circular oracle `REM-STAGING-FOLLOWUPS` §1 bans. That refusal is
   correct and stays. But it meant the one computation that would have exposed this was never
   exercised in the only mode that ever ran: a guard against a false POSITIVE created a blind spot for
   a false NEGATIVE. The fix is not to weaken it — the new assertions score the JOIN against PLANTED
   labels, which is arithmetic, never the detector. */
export function stageLabel(s) {
  if (s == null) return null;
  if (typeof s === 'string') return s;
  return typeof s.stage === 'string' ? s.stage : null;
}

/* ── the join: 5-min detector epochs ↔ 30 s expert epochs ───────────────────────────────────────
   Pure, and exported, so the gate can assert the arithmetic without an EDF. */
export function joinToExpert(detEpochs, detStages, expertEpochs, t0Ms, epochMin, minCoverage) {
  const cov = minCoverage == null ? 0.5 : minCoverage;
  const per = Math.round((epochMin * 60) / EPOCH_SEC); // expert epochs spanned by one detector epoch
  const pairs = [];
  for (let i = 0; i < detEpochs.length; i++) {
    const startSec = detEpochs[i].tMin * 60;
    const i0 = Math.round(startSec / EPOCH_SEC);
    const counts = {};
    let seen = 0;
    for (let k = 0; k < per; k++) {
      const lab = expertEpochs[i0 + k];
      if (!lab) continue; // an unscored gap is not a stage
      counts[lab] = (counts[lab] || 0) + 1;
      seen++;
    }
    // a window the scorer mostly did not label cannot grade a detector; exclude, do not count as miss
    if (seen < per * cov) continue;
    let best = null,
      bestN = -1;
    for (const s of Object.keys(counts))
      if (counts[s] > bestN) {
        bestN = counts[s];
        best = s;
      }
    pairs.push({ tMin: detEpochs[i].tMin, expert: best, detected: stageLabel(detStages[i]), coverage: seen / per });
  }
  return pairs;
}

/* Binary REM scoring + a full confusion table. `positive` is the detector's REM label. */
export function scoreREM(pairs, positive) {
  const P = positive || 'REM';
  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0;
  const confusion = {};
  for (const p of pairs) {
    const e = p.expert,
      d = p.detected;
    confusion[e] = confusion[e] || {};
    confusion[e][d || '—'] = (confusion[e][d || '—'] || 0) + 1;
    const eR = e === 'REM',
      dR = d === P;
    if (eR && dR) tp++;
    else if (!eR && dR) fp++;
    else if (eR && !dR) fn++;
    else tn++;
  }
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  return {
    n: pairs.length,
    tp,
    fp,
    fn,
    tn,
    recall,
    precision,
    f1: recall != null && precision != null && recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : null,
    expertRemFrac: pairs.length ? pairs.filter((p) => p.expert === 'REM').length / pairs.length : null,
    detectedRemFrac: pairs.length ? pairs.filter((p) => p.detected === P).length / pairs.length : null,
    confusion
  };
}

/* ── synthetic record, for --selftest ONLY ──────────────────────────────────────────────────────
   Minimal but REAL EDF bytes (the spec's fixed-width ASCII header + int16 samples), so the reader
   under test is the shipped one rather than a mock. */
function buildEdf(ecg, fs, label) {
  const recDur = 1; // one second per data record keeps the header arithmetic trivial
  const nRec = Math.floor(ecg.length / fs);
  const pad = (s, n) => String(s).slice(0, n).padEnd(n, ' ');
  let hdr = '';
  hdr += pad('0', 8) + pad('selftest', 80) + pad('synthetic PSG', 80);
  hdr += pad('01.01.20', 8) + pad('22.00.00', 8);
  hdr += pad(256 + 256, 8) + pad('', 44) + pad(nRec, 8) + pad(recDur, 8) + pad(1, 4);
  hdr += pad(label, 16) + pad('ECG', 80) + pad('uV', 8);
  hdr += pad(-32768, 8) + pad(32767, 8) + pad(-32768, 8) + pad(32767, 8);
  hdr += pad('', 80) + pad(fs * recDur, 8) + pad('', 32);
  const head = Buffer.from(hdr, 'ascii');
  const body = Buffer.alloc(nRec * fs * 2);
  for (let i = 0; i < nRec * fs; i++) body.writeInt16LE(Math.max(-32768, Math.min(32767, ecg[i] | 0)), i * 2);
  /* MUST be a true ArrayBuffer. `CpapEdf` reads fields via `new Uint8Array(buf, start, len)`, and a
     Node Buffer passed there is treated as an ARRAY-LIKE: start/len are ignored and every field reads
     from offset 0, so the header silently parses as ns=0. Caught by --selftest before this shipped —
     it would have failed on every real record too. */
  const out = Buffer.concat([head, body]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}
function syntheticNight(minutes) {
  const fs = 200,
    n = minutes * 60 * fs;
  const ecg = new Int16Array(n);
  const stages = []; // 30 s expert epochs
  let t = 0,
    nextBeat = 0;
  const nEp = (minutes * 60) / EPOCH_SEC;
  for (let e = 0; e < nEp; e++) stages.push(e % 20 < 4 ? 'REM' : e % 20 < 6 ? 'Wake' : 'N2');
  while (t < n) {
    const epoch = Math.floor(t / fs / EPOCH_SEC);
    const st = stages[Math.min(epoch, stages.length - 1)];
    // REM: faster + more variable RR; N2: slower + regular. A plausible signature, NOT ground truth.
    const baseRR = st === 'REM' ? 0.85 : st === 'Wake' ? 0.8 : 1.0;
    const jitter = st === 'REM' ? 0.12 : 0.02;
    const rr = baseRR + jitter * Math.sin(t / (fs * 7.3)) + 0.01 * Math.sin(t / (fs * 1.7));
    nextBeat = t + Math.max(1, Math.round(rr * fs));
    for (let k = t; k < Math.min(nextBeat, n); k++) {
      const d = k - t;
      ecg[k] = d < 4 ? 12000 * Math.sin((Math.PI * d) / 4) : d < 9 ? -3000 : Math.round(200 * Math.sin(k / 90));
    }
    t = nextBeat;
  }
  let xml = '<CMPStudyConfig><ScoredEvents>';
  for (let e = 0; e < stages.length; e++) {
    const code = stages[e] === 'REM' ? 5 : stages[e] === 'Wake' ? 0 : 2;
    xml += `<ScoredEvent><EventConcept>${stages[e]}|${code}</EventConcept><Start>${e * EPOCH_SEC}</Start><Duration>${EPOCH_SEC}</Duration></ScoredEvent>`;
  }
  xml += '</ScoredEvents></CMPStudyConfig>';
  return { edf: buildEdf(ecg, fs, 'ECG'), xml, stages, fs };
}

/* ── one record, end to end ─────────────────────────────────────────────────────────────────────*/
/* ── THE LIVE STATISTIC: pooled Cohen's kappa ─────────────────────────────────────────────────
   What `nsrr-score-pool.mjs` shows in its heartbeat and stops on. Pooled over every record scored so
   far, so a partial run of a hash-shuffled corpus carries a real kappa rather than a placeholder.

   ⚠️ THE TWO LABEL SETS ARE NOT THE SAME VOCABULARY, and this is the whole difficulty. The expert
   scores `Wake/N1/N2/N3/REM`; the detector emits `Wake/Light/Deep/REM`. A kappa computed over the
   union of those would be a 9-class agreement in which `N2` and `Light` are DIFFERENT categories that
   can never agree — the detector would score near zero no matter how right it was. The mapping is
   therefore declared, not inferred, and it is the standard AASM collapse. This is `same-name-two-
   populations` in its most expensive form: two label sets, one word "stage". */
export const EXPERT_TO_DET = { Wake: 'Wake', N1: 'Light', N2: 'Light', N3: 'Deep', N4: 'Deep', REM: 'REM' };
export const DET_CLASSES = ['Wake', 'Light', 'Deep', 'REM'];

/* Cohen's kappa over a pooled confusion matrix, with the standard large-sample SE so the pool can
   stop when it is precise enough. Returns null rather than a number when kappa is undefined —
   pe === 1 means one class swallowed everything, and (po-pe)/(1-pe) is 0/0 there, not "perfect". */
export function kappaFromMatrix(M) {
  let N = 0;
  const rs = {},
    cs = {};
  for (const e of DET_CLASSES)
    for (const d of DET_CLASSES) {
      const v = (M[e] && M[e][d]) || 0;
      N += v;
      rs[e] = (rs[e] || 0) + v;
      cs[d] = (cs[d] || 0) + v;
    }
  if (!N) return null;
  let po = 0,
    pe = 0;
  for (const c of DET_CLASSES) {
    po += ((M[c] && M[c][c]) || 0) / N;
    pe += (rs[c] / N) * (cs[c] / N);
  }
  if (!(pe < 1)) return null;
  const k = (po - pe) / (1 - pe);
  const se = Math.sqrt((po * (1 - po)) / (N * (1 - pe) * (1 - pe)));
  const recall = {};
  for (const c of DET_CLASSES) recall[c] = rs[c] ? +(((M[c] && M[c][c]) || 0) / rs[c]).toFixed(4) : null;
  return { kappa: +k.toFixed(4), halfWidth: +(1.96 * se).toFixed(4), nEpochs: N, po: +po.toFixed(4), recall };
}

/* Pool every record's confusion matrix into one, mapping expert labels into the detector's
   vocabulary on the way in. An expert label with no mapping is DROPPED and counted, never bucketed
   into a default class — §∅: an unmapped category is absent, not "Wake". */
export function poolConfusion(rows) {
  const M = {},
    unmapped = {};
  for (const e of DET_CLASSES) {
    M[e] = {};
    for (const d of DET_CLASSES) M[e][d] = 0;
  }
  for (const r of rows || []) {
    const c = r && r.score && r.score.confusion;
    if (!c) continue;
    for (const expert of Object.keys(c)) {
      const me = EXPERT_TO_DET[expert];
      if (!me) {
        unmapped[expert] = (unmapped[expert] || 0) + 1;
        continue;
      }
      for (const det of Object.keys(c[expert])) if (M[me][det] !== undefined) M[me][det] += c[expert][det];
    }
  }
  return { M, unmapped };
}

/* ⚠️ EPOCHS ARE NOT INDEPENDENT, AND THE POOLED SE PRETENDS THEY ARE — measured 2026-09-13.
   `kappaFromMatrix` returns the textbook large-sample SE, which assumes N independent observations.
   Epochs within one night are heavily correlated (a stager that mistakes a subject's N2 for Light
   does so for hundreds of consecutive epochs), so that SE is computed on an N that does not exist:
   10 records reported n=976 and a half-width of +/-0.046, a precision the sample cannot support.

   Left uncorrected, the pool's `--precision` would stop after a handful of records believing it had
   converged — the same failure as a stopping rule that reports its own floor as a criterion, one
   level deeper, because here the over-confidence is in the ARITHMETIC rather than in a guard.

   So the half-width published for STOPPING is the between-RECORD spread of per-record kappa, whose
   unit of independence is the night. The pooled kappa remains the headline estimate; only its
   uncertainty changes. Both are reported so the difference is visible rather than chosen silently. */
export function perRecordKappas(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!r || r.err || !r.score || !r.score.confusion) continue;
    const k = kappaFromMatrix(poolConfusion([r]).M);
    if (k && Number.isFinite(k.kappa)) out.push(k.kappa);
  }
  return out;
}

export function liveStat(rows) {
  const { M, unmapped } = poolConfusion(rows);
  const k = kappaFromMatrix(M);
  if (!k) return { label: "Cohen's kappa (stager vs expert)", value: null, halfWidth: null, n: 0 };
  /* between-record 95 % half-width: 1.96 * SE of the mean over nights. Below 5 nights it is null —
     a spread estimated from four numbers is not a precision, and publishing one would re-introduce
     exactly the false confidence this block exists to remove. */
  const ks = perRecordKappas(rows);
  let clusterHW = null;
  if (ks.length >= 5) {
    const mu = ks.reduce((a, b) => a + b, 0) / ks.length;
    const sd = Math.sqrt(ks.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (ks.length - 1));
    clusterHW = +((1.96 * sd) / Math.sqrt(ks.length)).toFixed(4);
  }
  const det = [
    'per-stage recall: ' + DET_CLASSES.map((c) => c + ' ' + (k.recall[c] != null ? (100 * k.recall[c]).toFixed(1) + '%' : '—')).join('  '),
    'epochs ' + k.nEpochs + '  ·  raw agreement ' + (100 * k.po).toFixed(1) + '%' + (Object.keys(unmapped).length ? '  ·  UNMAPPED expert labels: ' + Object.keys(unmapped).join(',') : '')
  ];
  det.push(
    'uncertainty: between-record +/-' +
      (clusterHW != null ? clusterHW.toFixed(4) : '— (needs >=5 records)') +
      '   [naive per-epoch +/-' +
      k.halfWidth.toFixed(4) +
      ' assumes independent epochs — it does not hold]'
  );
  /* `n` is the RECORD count, not the epoch count: it is what the stopping rule's floor must count. */
  return { label: "Cohen's kappa (stager vs expert)", value: k.kappa, halfWidth: clusterHW, n: ks.length, detail: det };
}

/* ── the pool adapter ─────────────────────────────────────────────────────────────────────────
   `tools/nsrr-score-pool.mjs` hands a worker `{ id, edf, xml }` PATHS and expects one row back; this
   file's own CLI already holds the bytes, so its `scoreRecord` takes buffers. Rather than change that
   signature (and every caller with it), expose the path-taking shape the pool asks for by name. The
   pool looks for this export explicitly and never sniffs arity — a sniff would quietly call the wrong
   function the day either signature gains an optional argument.

   This exists because 5136 records serially is ~5.9 h and the pool does it in ~37 min. */
export function poolScoreRecord(ctx, rec) {
  return { id: rec.id, ...scoreRecord(ctx, toArrayBuffer(readFileSync(rec.edf)), readFileSync(rec.xml, 'utf8')) };
}

/* ── ALIGNMENT DIAGNOSTIC ─────────────────────────────────────────────────────────────────────
   A near-chance kappa has two very different causes, and a confusion matrix at lag 0 cannot tell
   them apart: the detector genuinely disagrees, or it agrees but is SHIFTED in time. The second is a
   bug in the join or the anchor and is recoverable; the first is a finding about the detector. This
   tool previously reported only the lag-0 matrix, so it could grade agreement but never diagnose it.

   Recompute kappa over a small window of lags. If it peaks at zero, a low kappa is a real
   disagreement. If it peaks off zero — especially if it peaks HIGH — the grids are misaligned and
   every number the tool has ever printed for that record is about the wrong pairing.

   This is the counterpart to the brief's planted-shift control, and the two are not the same test:
   the plant proves the scorer REACTS to a shift; this finds a shift nobody planted. */
export function alignmentScan(pairs, maxLag) {
  const L = maxLag == null ? 3 : maxLag;
  const det = pairs.map((p) => p.detected);
  const exp = pairs.map((p) => p.expert);
  const out = [];
  for (let lag = -L; lag <= L; lag++) {
    const M = {};
    for (const e of DET_CLASSES) {
      M[e] = {};
      for (const d of DET_CLASSES) M[e][d] = 0;
    }
    for (let i = 0; i < pairs.length; i++) {
      const j = i + lag;
      if (j < 0 || j >= pairs.length) continue;
      const me = EXPERT_TO_DET[exp[i]] || (DET_CLASSES.includes(exp[i]) ? exp[i] : null);
      const md = det[j];
      if (!me || M[me][md] === undefined) continue;
      M[me][md]++;
    }
    const k = kappaFromMatrix(M);
    out.push({ lag, kappa: k ? k.kappa : null });
  }
  const scored = out.filter((o) => o.kappa != null);
  if (!scored.length) return { lags: out, bestLag: null, bestKappa: null, kappa0: null, misaligned: null };
  const best = scored.reduce((a, b) => (b.kappa > a.kappa ? b : a));
  const zero = scored.find((o) => o.lag === 0);
  /* ⚠️ THIS PER-RECORD FLAG OVER-FIRES AND MUST NOT BE COUNTED AS EVIDENCE — measured 2026-09-13.
     Taking the MAXIMUM kappa over 7 lags and comparing it to lag 0 is a selection over 7 noisy
     values: when true agreement is near chance, some lag beats lag 0 by >0.05 most of the time, for
     nothing but sampling. On 24 real records it fired 9 times while the population showed no shift
     at all. It is retained as a per-record HINT only; `populationMisalignment` below is the test.
     Same family as a threshold tuned on the data it judges — the margin is not wrong, the
     multiplicity is unaccounted for. */
  const misaligned = best.lag !== 0 && zero != null && best.kappa - zero.kappa > 0.05;
  return { lags: out, bestLag: best.lag, bestKappa: best.kappa, kappa0: zero ? zero.kappa : null, misaligned };
}

/* THE TEST THAT ACTUALLY DISCRIMINATES: a systematic misalignment is a property of the PIPELINE, so
   it shows up as every record peaking at the SAME non-zero lag. Sampling noise scatters the peak
   uniformly. Comparing the modal best-lag's share against the 1/(2L+1) a uniform scatter predicts
   separates the two without any per-record threshold at all. */
export function populationMisalignment(rows, maxLag) {
  const L = maxLag == null ? 3 : maxLag;
  const lags = (rows || []).map((r) => r && r.alignment && r.alignment.bestLag).filter((v) => v != null);
  if (lags.length < 10) return { n: lags.length, verdict: 'insufficient', modalLag: null, modalShare: null };
  const c = {};
  for (const l of lags) c[l] = (c[l] || 0) + 1;
  const modal = Object.entries(c).reduce((a, b) => (b[1] > a[1] ? b : a));
  const share = modal[1] / lags.length;
  const expected = 1 / (2 * L + 1);
  /* a genuine pipeline shift concentrates nearly everything on one lag; 2x the uniform expectation is
     the floor for calling it, and even that is stated as "suspect" rather than proven */
  const verdict = Number(modal[0]) === 0 ? 'aligned' : share > 2 * expected ? 'suspect-shift' : 'no-systematic-shift';
  return { n: lags.length, modalLag: Number(modal[0]), modalShare: +share.toFixed(3), uniformExpected: +expected.toFixed(3), verdict };
}

export function scoreRecord(ctx, edfBuffer, xmlText) {
  const { CpapEdf, ECGDSP, NSRR } = ctx;
  let edf;
  try {
    edf = CpapEdf.readEDF(edfBuffer);
  } catch (e) {
    return { err: 'readEDF: ' + e.message };
  }
  const conv = edfToEcgRec(edf);
  if (conv.err) return { err: conv.err };
  const ann = NSRR.parseNsrrXml(xmlText, conv.rec.t0Ms);
  if (ann.error) return { err: 'annotation: ' + ann.error };
  if (!ann.hasStageLabels) return { err: 'annotation carries no stage labels — nothing to score against' };

  let res;
  try {
    res = ECGDSP.analyze(conv.rec);
  } catch (e) {
    return { err: 'analyze: ' + e.message };
  }
  const epochs = res.epochs || [];
  if (!epochs.length) return { err: 'stager produced no epochs' };
  const stages = res.stages && res.stages.length ? res.stages : ECGDSP.stageSleep(epochs, null);
  const epochMin = epochs.length > 1 ? epochs[1].tMin - epochs[0].tMin : 5;
  const pairs = joinToExpert(epochs, stages, ann.epochs, conv.rec.t0Ms, epochMin, 0.5);
  if (!pairs.length) return { err: 'no detector epoch had ≥50 % expert coverage — grids do not overlap' };
  return {
    ecgLabel: conv.label,
    fs: conv.rec.fs,
    hours: +(conv.rec.durSec / 3600).toFixed(2),
    detEpochMin: epochMin,
    nExpertEpochs: ann.epochs.filter(Boolean).length,
    expertRemFrac: ann.remFrac,
    alignment: alignmentScan(pairs, 3),
    score: scoreREM(pairs, 'REM')
  };
}

/* ── CLI ────────────────────────────────────────────────────────────────────────────────────────*/
const IS_CLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_CLI) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const JSON_OUT = argv.includes('--json');
  const ctx = makeRealm();

  if (argv.includes('--selftest')) {
    const syn = syntheticNight(60);
    const out = scoreRecord(ctx, syn.edf, syn.xml);
    if (out.err) {
      console.error('SELFTEST FAILED: ' + out.err);
      process.exit(1);
    }
    console.log('\nSELF-TEST — the PATH, not the detector\n');
    console.log(`  EDF read            ✓  channel "${out.ecgLabel}" @ ${out.fs} Hz, ${out.hours} h`);
    console.log(`  expert labels       ✓  ${out.nExpertEpochs} × 30 s epochs, REM fraction ${(out.expertRemFrac * 100).toFixed(0)}%`);
    console.log(`  shipped stager      ✓  ${out.detEpochMin}-min epochs`);
    console.log(`  join → graded pairs ✓  ${out.score.n}`);

    /* ── THE JOIN'S ARITHMETIC, against PLANTED labels ──────────────────────────────────────────
       These are NOT a detector rate and must never be read as one: both sides are supplied here, so
       what is asserted is that the join maps labels correctly. That distinction is what lets them
       live inside `--selftest` without touching the circular-oracle refusal below.
       They exist because the refusal left a blind spot: recall was structurally 0 on every real
       record for as long as this tool has existed, and no mode that ever ran computed it. */
    let bad = 0;
    const A = (name, cond, detail) => {
      if (cond) console.log(`  ${name}  ✓`);
      else {
        bad++;
        console.log(`  ${name}  ✕  ${detail}`);
      }
    };
    A('stageLabel: unwraps stageSleep objects  ', stageLabel({ tMin: 0, stage: 'REM', y: 4 }) === 'REM');
    A('stageLabel: passes a bare string through', stageLabel('REM') === 'REM');
    A('stageLabel: refuses a shapeless value   ', stageLabel({ nope: 1 }) === null && stageLabel(null) === null);

    // 4 detector epochs of 5 min = 40 expert epochs of 30 s. Plant perfect agreement.
    const dEp = [{ tMin: 0 }, { tMin: 5 }, { tMin: 10 }, { tMin: 15 }];
    const truth = ['REM', 'N2', 'REM', 'Wake'];
    const exp = [];
    for (const t of truth) for (let k = 0; k < 10; k++) exp.push(t);
    // detected supplied as stageSleep's OBJECT shape — the exact shape that silently failed
    const detObj = truth.map((s, i) => ({ tMin: i * 5, stage: s, y: 0 }));
    const pPerfect = joinToExpert(dEp, detObj, exp, 0, 5, 0.5);
    A(
      'join: object-shaped stages yield string labels',
      pPerfect.every((p) => typeof p.detected === 'string'),
      JSON.stringify(pPerfect.map((p) => p.detected))
    );
    const sPerfect = scoreREM(pPerfect, 'REM');
    A('join: planted perfect agreement scores recall 1', sPerfect.recall === 1 && sPerfect.precision === 1, `recall=${sPerfect.recall} prec=${sPerfect.precision}`);

    // and the mirror, so the assertion above cannot pass vacuously
    const detWrong = truth.map((_, i) => ({ tMin: i * 5, stage: 'Wake', y: 0 }));
    const sWrong = scoreREM(joinToExpert(dEp, detWrong, exp, 0, 5, 0.5), 'REM');
    A('join: planted total disagreement scores recall 0', sWrong.recall === 0, `recall=${sWrong.recall}`);
    // the regression itself: a raw object must NOT survive into the confusion table
    const sRaw = scoreREM(
      joinToExpert(
        dEp,
        truth.map((s, i) => ({ tMin: i * 5, stage: s })),
        exp,
        0,
        5,
        0.5
      ),
      'REM'
    );
    A('join: no "[object Object]" reaches the confusion table', !JSON.stringify(sRaw.confusion).includes('object Object'), JSON.stringify(sRaw.confusion));
    if (bad) {
      console.error(`\nSELFTEST FAILED: ${bad} join assertion(s)\n`);
      process.exit(1);
    }

    console.log('\n  ⚠️  Recall/precision are DELIBERATELY NOT PRINTED here. The synthetic record is scored');
    console.log('     by the same assumptions the detector holds — the circular oracle REM-STAGING-FOLLOWUPS');
    console.log('     §1 bans for staging claims. This proves every link works; only --dir over real NSRR');
    console.log('     records produces a number that may be quoted.\n');
    process.exit(0);
  }

  const DIR = arg('--dir', null);
  if (!DIR) {
    console.error('usage: node tools/nsrr-stage-validate.mjs --selftest | --dir <psg-dir> [--json]');
    process.exit(2);
  }
  const base = DIR.startsWith('/') ? DIR : join(ROOT, DIR);
  if (!existsSync(base)) {
    console.error(`nsrr-stage-validate: ${DIR} not found.`);
    process.exit(2);
  }
  // pair an .edf with the .xml sharing its stem
  const files = readdirSync(base);
  const recs = files
    .filter((f) => /\.edf$/i.test(f))
    .map((f) => {
      const stem = basename(f).replace(/\.edf$/i, '');
      const xml = files.find(
        (g) =>
          /\.xml$/i.test(g) &&
          basename(g)
            .replace(/\.xml$/i, '')
            .replace(/-nsrr$/, '') === stem.replace(/-nsrr$/, '')
      );
      return xml ? { id: stem, edf: join(base, f), xml: join(base, xml) } : { id: stem, missing: true };
    });
  if (!recs.length) {
    console.error(
      `nsrr-stage-validate: no .edf files in ${DIR}.\n\nNSRR/PhysioNet require a signed DUA and this suite is 100 % local — it cannot fetch them.\nDrop EDF + annotation-XML pairs in and re-run. Prove the path first with --selftest.`
    );
    process.exit(2);
  }
  const rows = [];
  for (const r of recs) {
    if (r.missing) {
      rows.push({ id: r.id, err: 'no matching annotation XML' });
      continue;
    }
    rows.push({ id: r.id, ...scoreRecord(ctx, toArrayBuffer(readFileSync(r.edf)), readFileSync(r.xml, 'utf8')) });
  }
  const ok = rows.filter((r) => !r.err);
  if (JSON_OUT) console.log(JSON.stringify({ rows }, null, 2));
  else {
    console.log('\nSHIPPED STAGER vs EXPERT PSG LABELS — REM\n');
    console.log('record                     epochs  recall  precis    F1   expert%  detected%');
    console.log('─'.repeat(78));
    for (const r of rows) {
      if (r.err) {
        console.log(`${r.id.slice(0, 24).padEnd(26)}⊘ ${r.err}`);
        continue;
      }
      const s = r.score,
        p = (v) => (v == null ? '   — ' : (v * 100).toFixed(0).padStart(4) + '%');
      console.log(`${r.id.slice(0, 24).padEnd(26)}${String(s.n).padStart(6)}  ${p(s.recall)}  ${p(s.precision)}  ${p(s.f1)}  ${p(s.expertRemFrac)}  ${p(s.detectedRemFrac)}`);
    }
    if (ok.length) {
      const m = (f) => ok.map(f).filter((v) => v != null);
      const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
      console.log('─'.repeat(78));
      const mr = avg(m((r) => r.score.recall)),
        mp = avg(m((r) => r.score.precision));
      console.log(`${ok.length} record(s).  mean REM recall ${mr == null ? '—' : (mr * 100).toFixed(1) + '%'}, precision ${mp == null ? '—' : (mp * 100).toFixed(1) + '%'}`);
      console.log('\nCARRY THE DOMAIN SHIFT: NSRR is clinical PSG on a clinical population, not a consumer chest');
      console.log('strap on a healthy sleeper. A good number here does NOT retire the real-night falsifiers.');
    }
  }
}
