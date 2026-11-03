#!/usr/bin/env node
/*
 * tools/consensus-refpick-dissent.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * A DISSENTING LED CAN WIN THE REFERENCE PICK, AND NOBODY HAD READ THE WINNER.
 *
 * `consensusBeats(perChannel, refIdx, fs)` votes in the peak domain and then derives EVERY foot on
 * the single channel `refIdx` names. Row 2026-11-01-a-dissenting-led-can-win-the-consensus-reference-pick
 * says the pick can land on a channel detected upside down, which turns a lost vote into feet taken
 * from the opposite phase of the pulse. Its sibling row
 * 2026-11-01-the-consensus-polarity-wiring-reached-one-of-ten-callers holds the wiring half.
 *
 * TWO QUESTIONS, AND THE FIRST ONE DECIDES WHO THE SECOND IS ABOUT.
 *
 *   --census   WHICH RULE picks the reference at each `consensusBeats` call site. The row cites one
 *              rule (an argmax over per-channel peak counts). The shipped path uses another
 *              (`pickChannel`, which ranks by pulse-band SNR). Both are live, so a figure measured
 *              on one rule says nothing about a caller using the other.
 *   --dir      HOW OFTEN the pick lands on a dissenter, measured per rule on the real nights, with
 *              the channels detected the way a caller that applies no polarity decision sees them.
 *
 * THE POPULATION IS THE CALL SITE, AND IT IS NOT RE-DERIVED HERE. `scanFiles`, `findCalls` and
 * `argAt` come from `tools/consensus-polarity-wiring.mjs`, which already owns this population: two
 * listers over one `SCAN` would be the drift that module's own limits section warns about.
 *
 * THE BINDING IS THE BOUND. A pick rule is read between the binding of the reference identifier and
 * the call that consumes it — never over a fixed character window, which reads the next function
 * (row 2026-11-01-the-flag-arity-scan-bounds-a-helper-body-at-column-0, and the same trap measured
 * on a 2200-char window in a badge sweep). A pick this scan cannot name reads `unknown` and FAILS
 * rather than passing quietly: an unnamed rule is a pick nobody has checked.
 *
 * ∅ THE MEASUREMENT REPORTS PRE-CORRECTION STATE ON PURPOSE. `applyConsensusPolarity` makes the
 * signs unanimous BY CONSTRUCTION, so a dissenter read after it has run is a dissenter nobody can
 * see. Every figure here is taken from `detectChannel` on each channel's own orientation, which is
 * exactly what the nine non-applying callers hold when they pick.
 *
 * CLI: --census (default) · --dir <captures> [--max N] · --json · --selftest · --verdict-sample
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { maskNonCode } from './argv-reads.mjs';
import { argAt, findCalls, scanFiles } from './consensus-polarity-wiring.mjs';
import { gitCommitOf, populationVerdict, ruleLine, snapshotEntries } from './corpus-scope-core.mjs';
import { runsSidecarPath } from './trio-fold-validity.mjs';
import { makeVerdict, printVerdict } from './verdict-emit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = 'tools/consensus-refpick-dissent.mjs';
const GATE = 'consensus-refpick';
const CONSUMER = 'consensusBeats';
/* The reference is the SECOND argument of `consensusBeats(perChannel, refIdx, fs)`. */
const REF_ARG = 1;
const PPG_RE = /(?:VeritySense|Polar_Sense).*_PPG\.txt$/i;
const PPG_UNIT = 'PPG files';
const MAX_NIGHTS = 18;

/* ── the pick rules, named ───────────────────────────────────────────────────────────────────── */

/* The vocabulary is CLOSED, and `unknown` is a member of it rather than an absence: a site whose
   rule cannot be read must be visible in the census, never dropped from it. */
export const PICK_RULES = ['peak-argmax', 'variance-argmax', 'snr-pick', 'snr-pick-guarded', 'literal', 'unknown'];
/* A rebinding guard may sit between the pick and the consumer; four hops is far more than any live
   caller writes, and a cap is what keeps a cycle from spinning. */
export const CHAIN_HOPS = 4;

/* 🔴 AN ARGMAX IS A COMPARISON THAT ASSIGNS THE INDEX, NOT A MENTION OF THE SCORE. A first cut read
   `.peaks.length >` anywhere in the region and called `ppgdex-dsp.js` a peak-count pick, because the
   harmonic guard's own input computes `pc.peaks.length > 10` — a THRESHOLD. Requiring the running
   best to be an identifier drops that, and requiring the index to be assigned AFTER the comparison
   drops the binding statement itself, which otherwise satisfies the assignment test vacuously. */
const ARGMAX_SCORES = [
  { rule: 'peak-argmax', re: /\.peaks\.length\s*>\s*[A-Za-z_$]/g },
  { rule: 'variance-argmax', re: /\bv\s*>\s*[A-Za-z_$]/g }
];
const SNR_PICK_RE = /\bsel\.idx\b|\bpickChannel\s*\(/;
const GUARD_SRC = 'harmonicOutlierRefIdx';

/* The last binding of `name` that sits before `before`, on the masked copy so a binding inside a
   string or a comment cannot win. Returns null when the file binds the name nowhere earlier — a
   parameter, a worker message or a destructured field, all of which this scan declines to guess. */
export function bindingBefore(masked, name, before) {
  const re = new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`, 'g');
  let last = null;
  for (let m = re.exec(masked); m && m.index < before; m = re.exec(masked)) last = m.index;
  return last;
}

/* Which running maximum assigns `name`, and over which score. The assignment must follow the
   comparison: `name` is bound before the region opens, so a binding-statement assignment proves
   nothing about a maximum. */
export function argmaxOf(region, name) {
  const assign = new RegExp(`\\b${name}\\s*=[^=]`, 'g');
  for (const score of ARGMAX_SCORES) {
    score.re.lastIndex = 0;
    for (let m = score.re.exec(region); m; m = score.re.exec(region)) {
      assign.lastIndex = m.index + m[0].length;
      if (assign.exec(region)) return { rule: score.rule, why: `a running maximum over \`${m[0].trim()}\` assigns the reference` };
    }
  }
  return null;
}

/* Which rule chose the reference this call consumes. `region` is the text between the binding and
   the consumer — a bound the SOURCE draws, so it can neither overshoot into the next function nor
   stop short of the loop that assigns the index.

   🔴 IT FOLLOWS THE BINDING CHAIN, BECAUSE A GUARD REBINDS. `ppgdex-dsp.js` passes
   `harmonicOutlierRefIdx(refIdx, …)`, so the identifier the call consumes is bound AFTER the pick
   that chose it, and the pick sits outside its region. Widening the region to find it would be the
   fixed window this module refuses; following the guard's own argument reads the real chain. */
export function classifyPick(text, masked, call) {
  const expr = argAt(text, masked, call.open, REF_ARG);
  if (expr === null) return { rule: 'unknown', expr: null, why: `the call carries no argument at position ${REF_ARG}` };
  if (/^\d+$/.test(expr)) return { rule: 'literal', expr, why: 'the reference is written as a constant' };
  if (!/^[A-Za-z_$][\w$]*$/.test(expr)) {
    const rule = SNR_PICK_RE.test(expr) ? 'snr-pick' : 'unknown';
    return { rule, expr, why: rule === 'snr-pick' ? 'the expression names the SNR pick inline' : 'the reference is an expression this scan does not read' };
  }
  let name = expr;
  let before = call.index;
  let guarded = false;
  for (let hop = 0; hop < CHAIN_HOPS; hop++) {
    const at = bindingBefore(masked, name, before);
    if (at === null) return { rule: 'unknown', expr, why: `\`${name}\` is bound nowhere earlier in this file` };
    const region = masked.slice(at, before);
    const stmtEnd = region.indexOf('\n');
    const stmt = stmtEnd === -1 ? region : region.slice(0, stmtEnd);
    const hop2 = stmt.match(new RegExp(`${GUARD_SRC}\\s*\\(\\s*([A-Za-z_$][\\w$]*)`));
    if (hop2) {
      guarded = true;
      name = hop2[1];
      before = at;
      continue;
    }
    const am = argmaxOf(region, name);
    if (am) return { rule: am.rule, expr, why: am.why + (guarded ? ', then moved by the harmonic-outlier guard' : '') };
    if (SNR_PICK_RE.test(region))
      return {
        rule: guarded ? 'snr-pick-guarded' : 'snr-pick',
        expr,
        why: guarded ? 'the SNR pick, moved onto a coherent majority by the harmonic-outlier guard' : 'the channel with the best pulse-band SNR wins'
      };
    return { rule: 'unknown', expr, why: `\`${name}\` is bound at line ${lineAt(text, at)} by a rule this scan does not read` };
  }
  return { rule: 'unknown', expr, why: `the binding chain from \`${expr}\` is longer than ${CHAIN_HOPS} hops` };
}

function lineAt(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') n++;
  return n;
}

export function censusRows(root) {
  const rows = [];
  for (const rel of scanFiles(root)) {
    const text = readFileSync(join(root, rel), 'utf8');
    if (!text.includes(CONSUMER)) continue;
    const masked = maskNonCode(text);
    for (const call of findCalls(text, CONSUMER)) {
      const p = classifyPick(text, masked, call);
      rows.push({ in: rel, line: call.line, callee: call.callee, ...p });
    }
  }
  return rows;
}

export function censusVerdictOf(rows, opts = {}) {
  const unknown = rows.filter((r) => r.rule === 'unknown');
  const byRule = {};
  for (const r of PICK_RULES) {
    const n = rows.filter((x) => x.rule === r).length;
    if (n) byRule[r] = n;
  }
  const status = rows.length === 0 ? 'NOT_RUN' : unknown.length ? 'FAIL' : 'PASS';
  return makeVerdict({
    gate: GATE,
    status,
    population: { checked: rows.length, eligible: rows.length, excluded: 0 },
    criterion: { name: 'consensus_calls_whose_reference_pick_rule_cannot_be_named', threshold: 0, unit: 'call sites', direction: 'lte' },
    result: rows.length === 0 ? null : { byRule, mode: 'census' },
    evidence: [TOOL, 'tools/consensus-polarity-wiring.mjs', ...new Set(rows.map((r) => r.in))],
    reason:
      rows.length === 0
        ? `no file in the scanned trees calls \`${CONSUMER}\`, so no reference pick was read`
        : unknown.length
          ? `${unknown.length} call site(s) pick a reference by a rule this scan cannot name: ${unknown.map((r) => `${r.in}:${r.line} — ${r.why}`).join(' · ')}`
          : null,
    tool: TOOL,
    ...opts
  });
}

/* ── the corpus measurement ──────────────────────────────────────────────────────────────────── */

/* The dissenter set as a NON-APPLYING caller holds it: each channel detected on its own orientation,
   the majority sign taken across them, and the minority named. A unanimous record has no dissenter
   and no majority, which is `maj: 0` rather than an empty set over a majority of one.

   ∅ UNANIMOUS AND TIED ARE NOT ONE CLASS. Both leave `maj: 0` and no dissenter, and only one of
   them means the observers agreed: a 1–1 split is a record with NO majority to dissent from, where
   `applyConsensusPolarity` also abstains. `shape` keeps them apart so a tally cannot report a tie as
   agreement. */
export function dissentOf(signs) {
  let neg = 0,
    pos = 0;
  for (const s of signs) {
    if (s === -1) neg++;
    else if (s === 1) pos++;
  }
  if (neg === pos) return { maj: 0, dissenters: [], shape: neg === 0 ? 'unsigned' : 'tie' };
  if (neg === 0 || pos === 0) return { maj: 0, dissenters: [], shape: 'unanimous' };
  const maj = neg > pos ? -1 : 1;
  const dissenters = [];
  for (let i = 0; i < signs.length; i++) if (signs[i] !== maj) dissenters.push(i);
  return { maj, dissenters, shape: 'majority' };
}

/* The two live rules, computed on one detection pass so the comparison is between RULES and not
   between runs. `first max wins` matches the `>` every caller writes. */
export function picksOf(peakCounts, snrs) {
  let pk = 0,
    best = -1;
  for (let i = 0; i < peakCounts.length; i++)
    if (peakCounts[i] > best) {
      best = peakCounts[i];
      pk = i;
    }
  let sn = 0,
    bestS = -Infinity;
  for (let i = 0; i < snrs.length; i++) {
    const s = snrs[i];
    if (s != null && Number.isFinite(s) && s > bestS) {
      bestS = s;
      sn = i;
    }
  }
  return { peakArgmax: pk, snrPick: sn };
}

/* THE POPULATION IS NOT RESTATED HERE. `populationVerdict` publishes the walked population and
   whether the tree moved under the run, as its own `corpus-population` object beside this one, so
   this verdict answers only the question it pre-stated. Two statements of one count is drift. */
/* The sidecar states present, each with its count. A state nothing hit is left out, so the tally
   cannot print four zeros and read like a clean sweep. */
export function tallyOf(nights) {
  const t = {};
  for (const st of RUNS_STATES) {
    const n = nights.filter((x) => x.validity === st).length;
    if (n) t[st] = n;
  }
  return Object.keys(t).length ? t : null;
}

export function corpusVerdictOf(nights, opts = {}) {
  const read = nights.filter((n) => n.ok);
  const withDissent = read.filter((n) => n.dissenters.length > 0);
  const pkOnDissent = withDissent.filter((n) => n.dissenters.includes(n.peakArgmax));
  const snOnDissent = withDissent.filter((n) => n.dissenters.includes(n.snrPick));
  const hit = pkOnDissent.length + snOnDissent.length;
  const status = read.length === 0 ? 'NOT_RUN' : hit ? 'FAIL' : 'PASS';
  return makeVerdict({
    gate: GATE,
    status,
    population: { checked: read.length, eligible: nights.length, excluded: nights.length - read.length },
    criterion: { name: 'nights_whose_reference_pick_lands_on_a_dissenting_channel', threshold: 0, unit: 'nights', direction: 'lte' },
    result:
      read.length === 0
        ? null
        : {
            mode: 'corpus',
            nightsUnanimous: read.filter((n) => n.shape === 'unanimous').length,
            nightsTied: read.filter((n) => n.shape === 'tie').length,
            nightsWithADissenter: withDissent.length,
            /* The two rules disagree on WHICH channel is the reference far more often than a
               dissenter exists, and that disagreement is the reason a figure measured on one rule
               cannot be quoted for a caller using the other. */
            nightsTheTwoRulesPickDifferentChannels: read.filter((n) => n.peakArgmax !== n.snrPick).length,
            peakArgmaxOnDissenter: pkOnDissent.length,
            snrPickOnDissenter: snOnDissent.length,
            /* The sidecar state of every file the run parsed, by name. A run that read no sidecar
               says so here rather than reporting a validity it never had. */
            validity: tallyOf(nights)
          },
    evidence: [TOOL, 'ppgdex-dsp.js'],
    reason:
      read.length === 0
        ? 'no readable Verity PPG file under the given root, so no pick was measured'
        : hit
          ? `the reference pick lands on a dissenting channel on ${pkOnDissent.length} night(s) under the peak-count rule and ${snOnDissent.length} night(s) under the SNR rule, of ${withDissent.length} night(s) carrying a dissenter`
          : null,
    tool: TOOL,
    ...opts
  });
}

/* ── io ──────────────────────────────────────────────────────────────────────────────────────── */

const walk = (d, o = []) => {
  try {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, o);
      else o.push({ p, size: st.size });
    }
  } catch (_e) {}
  return o;
};

/* 🔴 IT MUST NOT SWALLOW AN UNREADABLE ROOT. `walk` catches every error, so a root nobody can open
   returns `[]` and a snapshot over it would publish a MEASUREMENT of zero (§∅). The root's own
   readdir runs OUTSIDE that catch, so an unreadable root refuses instead. */
export function listVerityPpg(root) {
  readdirSync(root);
  return walk(root)
    .filter((f) => PPG_RE.test(f.p))
    .map((f) => relative(root, f.p));
}

function realm(files) {
  const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  sb.window = sb;
  sb.globalThis = sb;
  sb.self = sb;
  sb.document = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, appendChild() {} }),
    head: { appendChild() {} },
    addEventListener() {},
    documentElement: { outerHTML: '' }
  };
  sb.navigator = { userAgent: 'v' };
  sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = vm.createContext(sb);
  for (const f of files) vm.runInContext(classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  return sb;
}

/* The bundler's classic-script rewrite, loaded through the file's OWN checkout root rather than a
   relative specifier: a piped invocation sets `import.meta.url` to the working directory and a
   static relative import then resolves against the wrong tree. */
let classicify = null;

/* THE VALIDITY SIDECAR, IN FOUR STATES — AND AN ABSENT ONE IS NOT AN EMPTY ONE.
   `parsePPG` accepts the box's `…_PPGRUNS.txt` as `opts.runsText`, and the path rule is
   `runsSidecarPath` so no caller guesses a name. §∅: an EMPTY `runsText` reads as a stream with no
   blanking runs, which is the opposite of nobody having recorded whether there were any — so only a
   sidecar with content travels, and every other state travels as a NAME. The Polar Sensor Logger
   exports measured here carry no sidecar at all (`absent` ×54), which is a fact about the input and
   not a clean sweep. */
export function readRunsFor(streamPath) {
  const p = runsSidecarPath(streamPath, 'PPG');
  if (!p) return { state: 'unnamed', runsText: null };
  let t;
  try {
    t = readFileSync(p, 'utf8');
  } catch (e) {
    return { state: e && e.code === 'ENOENT' ? 'absent' : 'unreadable', runsText: null };
  }
  return t.trim() ? { state: 'read', runsText: t } : { state: 'empty', runsText: null };
}

export const RUNS_STATES = ['read', 'empty', 'absent', 'unreadable', 'unnamed'];

export function measureNight(P, file) {
  const out = { file, ok: false, nCh: 0, maj: 0, shape: null, validity: null, dissenters: [], peakArgmax: null, snrPick: null, why: null };
  const runs = readRunsFor(file);
  out.validity = runs.state;
  let rec;
  try {
    const text = readFileSync(file, 'utf8');
    rec = runs.runsText ? P.parsePPG(text, { runsText: runs.runsText }) : P.parsePPG(text);
  } catch (e) {
    out.why = `parse refused: ${e.message}`;
    return out;
  }
  if (!rec || !rec.ch || rec.ch.length === 0 || !(rec.fs > 0)) {
    out.why = 'no channel or no sample rate';
    return out;
  }
  const keepIdx = P.distinctChannelIdx(rec.ch);
  out.nCh = keepIdx.length;
  if (keepIdx.length < 2) {
    out.why = `${keepIdx.length} distinct channel(s) — a pick over one channel is not a pick`;
    return out;
  }
  /* ∅ EVERY FIGURE IS PRE-CORRECTION. No `applyConsensusPolarity` runs here, because after it the
     signs are unanimous by construction and the dissenter is gone. */
  const per = keepIdx.map((c) => P.detectChannel(rec.ch[c], rec.fs));
  const sel = P.pickChannel(rec);
  const { maj, dissenters, shape } = dissentOf(per.map((pc) => (pc ? pc.sign : null)));
  const peaks = per.map((pc) => (pc && pc.peaks ? pc.peaks.length : -1));
  const snrs = keepIdx.map((c) => (sel.scores && sel.scores[c] ? sel.scores[c].snr : null));
  const picks = picksOf(peaks, snrs);
  out.ok = true;
  out.maj = maj;
  out.shape = shape;
  out.dissenters = dissenters;
  out.peakArgmax = picks.peakArgmax;
  out.snrPick = picks.snrPick;
  out.peakCounts = peaks;
  return out;
}

/* ── selftest ────────────────────────────────────────────────────────────────────────────────── */

let ASSERTED = 0;
function ok(cond, what) {
  ASSERTED++;
  console.log(`${cond ? '  ✓' : '  ✗'} ${what}`);
  return cond ? 0 : 1;
}

function pickOf(src) {
  const masked = maskNonCode(src);
  const call = findCalls(src, CONSUMER)[0];
  return classifyPick(src, masked, call);
}

function selftest() {
  let fail = 0;
  const ARGMAX =
    'let refIdx = 0, best = -1;\nper.forEach(function (p, i) { if (p.peaks.length > best) { best = p.peaks.length; refIdx = i; } });\nconst cons = PPGDSP.consensusBeats(per, refIdx, rec.fs);\n';
  const SNR = 'const sel = P.pickChannel(rec0);\nconst refIdx = Math.max(0, keepIdx.indexOf(sel.idx));\nconst cons = P.consensusBeats(perChannel, refIdx, rec0.fs);\n';
  const GUARDED =
    'const sel = P.pickChannel(rec);\nconst refIdx = Math.max(0, keepIdx.indexOf(sel.idx));\nconst refIdxUsed = harmonicOutlierRefIdx(refIdx, _chRates, _chSnr);\nconst cons = consensusBeats(perChannel, refIdxUsed, rec.fs);\n';
  fail += ok(pickOf(ARGMAX).rule === 'peak-argmax', 'the peak-count argmax is named');
  fail += ok(pickOf(SNR).rule === 'snr-pick', 'the SNR pick is named');
  fail += ok(pickOf(GUARDED).rule === 'snr-pick-guarded', 'the guarded SNR pick is named apart from the bare one');
  fail += ok(pickOf('const cons = consensusBeats(per, 0, rec.fs);\n').rule === 'literal', 'a constant reference reads as a literal');
  fail += ok(pickOf('const cons = consensusBeats(per, ri, rec.fs);\n').rule === 'unknown', 'an unbound identifier reads unknown, never a guess');
  /* CONTROL · THE BOUND IS THE BINDING, NOT A WINDOW. The argmax loop below belongs to the FIRST
     call; a scan bounded by characters rather than by the binding would carry it into the second. */
  const TWO = ARGMAX + '\nlet ri2 = pickFromSomewhereElse();\nconst cons2 = PPGDSP.consensusBeats(per2, ri2, rec.fs);\n';
  const masked = maskNonCode(TWO);
  const calls = findCalls(TWO, CONSUMER);
  fail += ok(calls.length === 2, 'both call sites are found');
  fail += ok(classifyPick(TWO, masked, calls[0]).rule === 'peak-argmax', 'CONTROL · the first call keeps its own rule');
  fail += ok(classifyPick(TWO, masked, calls[1]).rule === 'unknown', "CONTROL · the second call does not inherit the first's loop");
  /* A STRING IS NOT A BINDING. */
  const STR = 'const s = "const refIdx = 0; p.peaks.length > best";\nconst cons = consensusBeats(per, refIdx, rec.fs);\n';
  fail += ok(pickOf(STR).rule === 'unknown', 'a binding written inside a string does not name a rule');
  /* The dissent rule, both ways. */
  fail += ok(dissentOf([1, 1, -1]).dissenters.join() === '2', 'the lone negative channel is the dissenter');
  fail += ok(dissentOf([1, 1, 1]).maj === 0, 'a unanimous record has no majority and no dissenter');
  fail += ok(dissentOf([1, -1]).maj === 0, 'a two-channel tie names no dissenter');
  fail += ok(dissentOf([1, 1, 1]).shape === 'unanimous', 'agreement reads unanimous');
  fail += ok(dissentOf([1, -1]).shape === 'tie', 'a tie is its own shape, never agreement');
  fail += ok(dissentOf([null, null]).shape === 'unsigned', 'a record whose channels carry no sign reads unsigned');
  /* The picks, including the finiteness trap `null > -Infinity`. */
  fail += ok(picksOf([10, 30, 20], [1, 2, 3]).peakArgmax === 1, 'the most peaks wins the peak rule');
  fail += ok(picksOf([10, 30, 20], [1, 2, 3]).snrPick === 2, 'the best SNR wins the SNR rule');
  fail += ok(picksOf([10, 10, 10], [null, null, null]).snrPick === 0, 'an unscored channel never wins the SNR pick');
  fail += ok(picksOf([5, 5, 5], [0, 0, 0]).peakArgmax === 0, 'a tie keeps the first channel, as every caller writes it');
  /* The verdicts refuse to pass over nothing. */
  fail += ok(readRunsFor('/nope/x_PPG.txt').state === 'absent' && readRunsFor('/nope/x_PPG.txt').runsText === null, 'an absent sidecar arrives as a NAME, never as empty text');
  fail += ok(readRunsFor('/nope/not-a-stream.csv').state === 'unnamed', 'a path the rule cannot name reaches no disk');
  fail += ok(tallyOf([{ validity: 'absent' }, { validity: 'absent' }]).absent === 2, 'the sidecar tally counts the state it saw');
  fail += ok(tallyOf([{ validity: null }]) === null, 'a tally of nothing is null, never four zeros reading as a clean sweep');
  fail += ok(censusVerdictOf([]).status === 'NOT_RUN', 'a census over no call site examined nothing');
  fail += ok(corpusVerdictOf([]).status === 'NOT_RUN', 'a corpus run over no night examined nothing');
  const hit = corpusVerdictOf([{ ok: true, shape: 'majority', dissenters: [2], peakArgmax: 2, snrPick: 0 }]);
  fail += ok(hit.status === 'FAIL' && hit.result.peakArgmaxOnDissenter === 1 && hit.result.snrPickOnDissenter === 0, 'a pick on the dissenter reads FAIL and names which rule landed there');
  const split = corpusVerdictOf([{ ok: true, shape: 'unanimous', dissenters: [], peakArgmax: 2, snrPick: 1 }]);
  fail += ok(split.status === 'PASS' && split.result.nightsTheTwoRulesPickDifferentChannels === 1, 'the two rules disagreeing on a clean night is counted, not a failure');
  const clean = corpusVerdictOf([{ ok: true, shape: 'majority', dissenters: [2], peakArgmax: 0, snrPick: 0 }]);
  fail += ok(clean.status === 'PASS' && clean.result.nightsWithADissenter === 1, 'a dissenting night whose pick lands elsewhere still counts as a night with a dissenter');
  console.log(fail ? `\nselftest: ${fail} FAILURE(S) of ${ASSERTED}` : `\nselftest: all ${ASSERTED} assertions passed`);
  return fail;
}

export function verdictSample() {
  const at = '2026-11-03T00:00:00Z';
  return censusVerdictOf([{ in: 'ppgdex-dsp.js', line: 1, callee: 'consensusBeats', rule: 'snr-pick-guarded', expr: 'refIdxUsed', why: 'sample' }], { at });
}

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { valued: ['--dir', '--max'], boolean: ['--census', '--json', '--selftest', '--verdict-sample'] }, { tool: 'consensus-refpick-dissent' });
  const has = (f) => argv.includes(f);
  const val = (f, d) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  if (has('--selftest')) process.exit(selftest() ? 1 : 0);
  if (has('--verdict-sample')) {
    console.log(JSON.stringify(verdictSample()));
    process.exit(0);
  }
  const DIR = val('--dir', null);
  if (!DIR) {
    const rows = censusRows(ROOT);
    const v = censusVerdictOf(rows, { commit: gitCommitOf(ROOT).commit, commitReason: gitCommitOf(ROOT).reason });
    if (has('--json')) console.log(JSON.stringify({ rows, verdict: v }, null, 2));
    else {
      console.log(`${CONSUMER} reference-pick census — which rule chooses the channel every foot is derived on\n`);
      console.log('file                                            line  rule                expr');
      for (const r of rows) console.log(`${r.in.padEnd(46)}  ${String(r.line).padStart(4)}  ${r.rule.padEnd(18)}  ${r.expr || '—'}`);
      console.log('');
      printVerdict(v);
    }
    process.exit(v.status === 'PASS' ? 0 : 1);
  }
  const B = await import(pathToFileURL(join(ROOT, 'tools/build-core.js')).href);
  classicify = B.classicify || B.default?.classicify;
  const P = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ppgdex-registry.js', 'ppgdex-morph.js', 'ppgdex-dsp.js']).PPGDSP;
  const commitOf = gitCommitOf(ROOT);
  const snapBefore = snapshotEntries(DIR, { list: listVerityPpg, unit: PPG_UNIT });
  const files = walk(DIR)
    .filter((f) => PPG_RE.test(f.p))
    .sort((a, b) => b.size - a.size)
    .slice(0, Number(val('--max', MAX_NIGHTS)));
  console.log(`${CONSUMER} reference pick vs the polarity dissenter — ${files.length} Verity PPG file(s), pre-correction\n`);
  console.log('file                                                nCh  shape       dissenters  peak-argmax  snr-pick');
  const nights = [];
  for (const f of files) {
    const n = measureNight(P, f.p);
    nights.push(n);
    const name = relative(DIR, f.p);
    console.log(
      `${name.padEnd(50)}  ${String(n.nCh).padStart(3)}  ${(n.shape || '—').padEnd(10)}  ${(n.dissenters.join(',') || '—').padEnd(10)}  ${String(n.peakArgmax ?? '—').padStart(11)}  ${String(n.snrPick ?? '—').padStart(8)}${n.ok ? '' : `   (${n.why})`}`
    );
  }
  const population = populationVerdict(snapBefore, snapshotEntries(DIR, { list: listVerityPpg, unit: PPG_UNIT }), {
    tool: TOOL,
    commit: commitOf.commit,
    commitReason: commitOf.reason,
    evidence: [TOOL]
  });
  const v = corpusVerdictOf(nights, { commit: commitOf.commit, commitReason: commitOf.reason });
  if (has('--json')) console.log(JSON.stringify({ nights, population, verdict: v }, null, 2));
  else {
    console.log('');
    console.log(ruleLine(population));
    console.log(`POPULATION (tepna.verdict/1): ${JSON.stringify(population)}`);
    console.log('');
    printVerdict(v);
  }
  process.exit(v.status === 'PASS' ? 0 : 1);
}
