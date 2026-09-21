#!/usr/bin/env node
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
//
// verify-draft-kills.mjs — does a drafted assertion, AS WRITTEN, actually kill its mutant?
//
// WHY. Every drafts file is stamped: "Every PROJECTION below was machine-verified to discriminate the
// real code from its mutant." That guarantee is enforced by `projectionDiscriminates`, which is
// CORRECT — but it runs over `(projection, c.orig, c.mutant)` recorded during PROBING, not over the
// assertion that is rendered. Measured 2026-09-19: `ECGCross.crossNight([])` with `n < 2` -> `n <= 2`
// ships as a draft, and that same guard REJECTS it when re-run on the call's real outputs ("both sides
// give null") — on a file with ZERO commits since the probe. A draft can carry the stamp and pin
// nothing.
//
// This closes the gap by checking the ARTIFACT instead of an intermediate: plant the mutant into the
// real source, run the drafted call, compare the drafted projection. 2 of 15 adopted drafts fail it,
// and both are non-discriminating BY CONSTRUCTION (a short-circuited disjunct; `0 < 2` vs `0 <= 2`) —
// neither fixable by re-recording. See QWEN-ENGINEERING-PROGRAM section 7-ter.
//
// FAILS CLOSED, ALWAYS. The journal truncates before/after to 100 chars, so the mutant is re-applied
// from LINE NUMBER + OPERATOR. If the operator's token is not UNIQUE on that line the draft is reported
// UNPLANTABLE and never SURVIVED — a first-occurrence replace is how a plant silently mutates a
// different function 2000 lines away, which happened while measuring this very defect. UNPLANTABLE and
// UNPAIRED are counted separately: they are not failures and they are not passes.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { buildRealm, parseDrafts } from './verify-drafts.mjs';

/* The journal packs `line | op | before | after` into one string with a NUL separator. Written as a
   char code so no control character ever appears in this source. */
const SEP = String.fromCharCode(0);

/** Source token each operator rewrites, and what it becomes. */
const OPS = {
  'bool || → &&': ['||', '&&'],
  'bool && → ||': ['&&', '||'],
  'eq === → !==': ['===', '!=='],
  'eq !== → ===': ['!==', '==='],
  'cmp < → <=': ['<', '<='],
  'cmp > → >=': ['>', '>='],
  'cmp <= → <': ['<=', '<'],
  'cmp >= → >': ['>=', '>']
};

/** Occurrences of `tok` in `line` that are NOT part of a longer operator containing it. */
export function tokenSites(line, tok) {
  const out = [];
  const longer = ['===', '!==', '<=', '>=', '==', '!=', '&&', '||', '<<', '>>'];
  for (let i = 0; i <= line.length - tok.length; i++) {
    if (line.slice(i, i + tok.length) !== tok) continue;
    let inside = false;
    for (const L of longer) {
      if (L === tok || !L.includes(tok)) continue;
      for (let s = Math.max(0, i - L.length + 1); s <= i; s++) {
        if (line.slice(s, s + L.length) === L && i >= s && i + tok.length <= s + L.length) {
          inside = true;
          break;
        }
      }
      if (inside) break;
    }
    if (!inside) out.push(i);
  }
  return out;
}

/** Apply one mutant to one line. Returns the new line, or a reason it refuses. */
export function plantOnLine(line, op) {
  if (op === 'num → 0') {
    const nums = [...line.matchAll(/(?<![\w.])\d+(?:\.\d+)?/g)].filter((m) => m[0] !== '0');
    if (nums.length !== 1) return { ok: false, why: 'num -> 0 needs exactly one non-zero literal, found ' + nums.length };
    return { ok: true, line: line.slice(0, nums[0].index) + '0' + line.slice(nums[0].index + nums[0][0].length) };
  }
  if (op === 'negate: drop !') {
    const sites = [...line.matchAll(/!(?![=])/g)];
    if (sites.length !== 1) return { ok: false, why: "drop ! needs exactly one '!', found " + sites.length };
    return { ok: true, line: line.slice(0, sites[0].index) + line.slice(sites[0].index + 1) };
  }
  const pair = OPS[op];
  if (!pair) return { ok: false, why: 'operator not supported: ' + op };
  const sites = tokenSites(line, pair[0]);
  if (sites.length !== 1) return { ok: false, why: "'" + pair[0] + "' is not unique on this line (" + sites.length + ' sites)' };
  return { ok: true, line: line.slice(0, sites[0]) + pair[1] + line.slice(sites[0] + pair[0].length) };
}

/** KEPT journal records for one module: { line, op, beforePrefix, projection }. */
export function readJournal(dir, mod, { read = readFileSync, exists = existsSync } = {}) {
  const p = join(dir, mod + '.draft-journal.jsonl');
  if (!exists(p)) return [];
  const out = [];
  for (const l of String(read(p, 'utf8')).split('\n')) {
    if (!l.trim()) continue;
    let r;
    try {
      r = JSON.parse(l);
    } catch {
      continue;
    }
    if (r.v !== 'KEPT' || typeof r.k !== 'string') continue;
    const f = r.k.split(SEP);
    if (f.length < 4) continue;
    out.push({ line: Number(f[0]), op: f[1], beforePrefix: f[2], projection: r.projection });
  }
  return out;
}

/** Pair a parsed draft with its journal record. The draft comment TRUNCATES `before`, so match on the
    operator AND the projection AND a prefix overlap — never on the projection alone, which repeats
    within a file. A pairing that is not unique returns null and the draft is reported UNPAIRED. */
export function pairDraft(d, journal) {
  const m = String(d.mutant).match(/^(.*?)\s+@\s+([\s\S]*)$/);
  if (!m) return null;
  const op = m[1].trim();
  const before = m[2].trim();
  const cands = journal.filter((j) => j.op === op && j.projection === d.projection && (j.beforePrefix.startsWith(before.slice(0, 40)) || before.startsWith(j.beforePrefix.slice(0, 40))));
  return cands.length === 1 ? cands[0] : null;
}

const evalIn = (ctx, call, proj) => {
  try {
    return vm.runInContext('(function(){var out=' + call + ';return JSON.stringify(' + proj + ');})()', ctx, { timeout: 5000 });
  } catch (e) {
    return 'THREW:' + String(e && e.message).slice(0, 60);
  }
};

export function checkFile(root, dir, file, { log = console.log } = {}) {
  const mod = file.replace(/\.drafts\.js$/, '');
  const drafts = parseDrafts(readFileSync(join(dir, file), 'utf8'));
  const journal = readJournal(dir, mod);
  const base = buildRealm(root);
  const res = { killed: 0, survived: 0, unplantable: 0, unpaired: 0, rows: [] };
  for (const d of drafts) {
    const j = pairDraft(d, journal);
    if (!j) {
      res.unpaired++;
      res.rows.push({ v: 'UNPAIRED', call: d.call });
      continue;
    }
    const want = evalIn(base.ctx, d.call, d.projection);
    let planted = null;
    const rf = (p, enc) => {
      const t = readFileSync(p, enc);
      if (!String(p).endsWith(mod)) return t;
      const L = t.split('\n');
      const cur = L[j.line - 1] ?? '';
      /* 🔴 THE LINE NUMBER IS FROM PROBE TIME AND THE FILE MAY HAVE MOVED SINCE. Confirm the line
         still carries the recorded text before mutating it. Without this the plant lands on a
         DIFFERENT line that happens to be mutatable, and the run reports a false SURVIVED — which is
         exactly the defect this tool exists to detect, committed by the tool. Caught by the
         known-answer test: `parseDeviceHR(0)` read SURVIVED against a hand-measured KILL, because
         `ecgdex-dsp.js` has changed since 2026-08-27 while `ecgdex-cross.js` has not. */
      const anchor = String(j.beforePrefix).trim().slice(0, 40);
      if (anchor && !cur.includes(anchor)) {
        planted = 'line ' + j.line + ' no longer carries the probed text — the file moved since drafting';
        return t;
      }
      const r = plantOnLine(cur, j.op);
      if (!r.ok) {
        planted = r.why;
        return t;
      }
      planted = true;
      L[j.line - 1] = r.line;
      return L.join('\n');
    };
    const got = evalIn(buildRealm(root, { readFile: rf }).ctx, d.call, d.projection);
    if (planted !== true) {
      res.unplantable++;
      res.rows.push({ v: 'UNPLANTABLE', call: d.call, why: planted || 'line absent' });
      continue;
    }
    const kills = got !== want;
    if (kills) res.killed++;
    else res.survived++;
    res.rows.push({ v: kills ? 'KILLED' : 'SURVIVED', call: d.call, proj: d.projection, want, line: j.line, op: j.op });
  }
  for (const r of res.rows) {
    if (r.v === 'SURVIVED') log('  SURVIVED  ' + r.call + ' -> ' + r.proj + '  (line ' + r.line + ', ' + r.op + ')  both give ' + String(r.want).slice(0, 40));
    else if (r.v === 'UNPLANTABLE') log('  UNPLANTABLE ' + r.call + ' - ' + r.why);
    else if (r.v === 'UNPAIRED') log('  UNPAIRED  ' + r.call + ' - no single journal record matches');
  }
  log(file + ': KILLED ' + res.killed + ' · SURVIVED ' + res.survived + ' · UNPLANTABLE ' + res.unplantable + ' · UNPAIRED ' + res.unpaired);
  return res;
}

export function selftest() {
  let p = 0;
  let f = 0;
  const ok = (n, c, d) => {
    if (c) {
      p++;
      console.log('  ✓ ' + n);
    } else {
      f++;
      console.log('  ✗ ' + n + (d ? ' - ' + d : ''));
    }
  };
  ok('tokenSites does not match "<" inside "<="', tokenSites('a <= b', '<').length === 0, JSON.stringify(tokenSites('a <= b', '<')));
  ok('tokenSites finds a bare "<"', tokenSites('a < b', '<').length === 1);
  ok('two bare "<" on a line -> plantOnLine REFUSES', plantOnLine('a < b && c < d', 'cmp < → <=').ok === false);
  ok('plantOnLine rewrites a unique "<"', plantOnLine('if (n < 2) x', 'cmp < → <=').line === 'if (n <= 2) x');
  ok('plantOnLine refuses "||" appearing twice', plantOnLine('a || b || c', 'bool || → &&').ok === false);
  ok('num -> 0 refuses when two literals are present', plantOnLine('f(20, 260)', 'num → 0').ok === false);
  ok('num -> 0 rewrites a single literal', plantOnLine('hr < 20', 'num → 0').line === 'hr < 0');
  ok('num -> 0 ignores an existing 0', plantOnLine('a[0] < 20', 'num → 0').line === 'a[0] < 0');
  ok('drop ! refuses two negations', plantOnLine('!a && !b', 'negate: drop !').ok === false);
  ok('drop ! rewrites a single negation', plantOnLine('!isFinite(x)', 'negate: drop !').line === 'isFinite(x)');
  ok('an unsupported operator refuses rather than guessing', plantOnLine('a', 'mystery op').ok === false);
  ok('readJournal on a missing directory returns [] rather than throwing', readJournal('/nonexistent-dir', 'x').length === 0);
  /* A draft whose journal match is ambiguous must be UNPAIRED, never silently paired to the first. */
  const dup = [
    { line: 1, op: 'cmp < → <=', beforePrefix: 'if (n < 2) return A', projection: 'out.x' },
    { line: 9, op: 'cmp < → <=', beforePrefix: 'if (n < 2) return A', projection: 'out.x' }
  ];
  ok('an ambiguous journal match returns null (UNPAIRED), never the first', pairDraft({ mutant: 'cmp < → <=  @ if (n < 2) return A', projection: 'out.x' }, dup) === null);
  console.log(f === 0 ? '\n✓ all ' + p + ' selftests passed' : '\n✗ selftest - ' + p + ' passed, ' + f + ' failed');
  return f === 0 ? 0 : 1;
}

export function main(argv = []) {
  if (argv.includes('--selftest')) return selftest();
  const root = process.cwd();
  const dirArg = argv.find((a) => a.startsWith('--dir='));
  const dir = dirArg ? dirArg.slice(6) : join(root, '.git', 'tepna-mutation');
  const only = argv.find((a) => a.startsWith('--file='));
  let files = readdirSync(dir).filter((x) => x.endsWith('.drafts.js'));
  if (only) files = files.filter((x) => x.includes(only.slice(7)));
  let k = 0;
  let s = 0;
  let u = 0;
  let np = 0;
  for (const f of files) {
    const r = checkFile(root, dir, f);
    k += r.killed;
    s += r.survived;
    u += r.unplantable;
    np += r.unpaired;
  }
  console.log('\nTOTAL  KILLED ' + k + ' · SURVIVED ' + s + ' · UNPLANTABLE ' + u + ' · UNPAIRED ' + np);
  console.log("SURVIVED = the drafted assertion does NOT kill its mutant; the header's guarantee does not hold for it.");
  console.log('UNPLANTABLE/UNPAIRED are NOT passes: the check could not run, and says so rather than reporting green.');
  return argv.includes('--strict') && s > 0 ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith('verify-draft-kills.mjs')) process.exit(main(process.argv.slice(2)));
