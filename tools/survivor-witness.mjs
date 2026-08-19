/*
 * tools/survivor-witness.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * ── A WITNESS INPUT FOR EVERY SURVIVOR THAT HAS ONE ─────────────────────────────────────────────
 *
 * 4708 operator mutants survive the JS sweeps unresolved. Each needs either a killing test or a
 * written equivalence proof, and the expensive human step is the FIRST one: staring at a mutant and
 * thinking of an input that separates it from the original. This proposes candidates and CHECKS them.
 *
 * ── WHY A LOCAL MODEL IS ALLOWED HERE, HAVING FAILED TWICE ELSEWHERE ────────────────────────────
 * Measured on this box: ranking assertion strength produced 0 useful flags of 3 and missed a planted
 * control; auditing code against the deep-audit charter produced 0 confirmed findings across 7 prompt
 * variants, including one claim three variants agreed on. Both asked the model to JUDGE CORRECTNESS,
 * where a wrong answer is confident, specific, and costs a verification run to disprove.
 *
 * This asks for a VALUE, and the falsifier is two expression evaluations:
 *
 *     model proposes   `var v = Infinity;`
 *     harness computes  A(v) !== B(v)   ← a wrong proposal is discarded in microseconds
 *
 * Nothing the model says is recorded unless the check passes. It cannot produce a false witness, only
 * a useless one.
 *
 * ⚠️ A WITNESS IS CONDITION-LEVEL, NOT FUNCTION-LEVEL. It proves the mutant is not equivalent AT THE
 * EXPRESSION. Whether the enclosing function can REACH that binding is a separate question this tool
 * does not answer, and a witness is therefore a lead for a test author, never a kill.
 *
 * ⚠️ AND IT CANNOT JUDGE EQUIVALENCE. Asked about a mutant with no distinguishing input it invented
 * one rather than answering NONE — 0 NONEs in 12 probes including a known-equivalent control. The
 * survivors that need an equivalence PROOF, which is where the manual hours actually go, get no help
 * from this at all.
 *
 *   node tools/survivor-witness.mjs --minutes 15
 *   node tools/survivor-witness.mjs --minutes 60 --resume    # continues, does not restart
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveStatePath, stateDirs, stateJsonFiles } from './mutation-map.mjs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { ResumeLedger, etaFromThroughput, fingerprint, fmtDuration } from './run-progress.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* MUTATION-SUITE-FOLLOWUPS §1: reads UNION both state dirs (shared git-common location first,
   legacy in-tree as fallback); writes land in the SHARED dir so every worktree sees them. */
const STATE_DIRS = stateDirs(ROOT);
const WRITE_DIR = STATE_DIRS[0];
const OLLAMA = process.env.DEX_OLLAMA || 'http://localhost:11434';
const MODEL = process.env.DEX_MODEL || 'qwen3.8:27b';

/* Balanced scan, not a regex: `if (a(b), c)` has a paren a regex cannot pair, and a wrong extraction
   would silently probe an expression that is not the one that mutated. */
export function condOf(line) {
  const i = String(line || '').indexOf('if (');
  if (i < 0) return null;
  let d = 0;
  for (let k = i + 3; k < line.length; k++) {
    if (line[k] === '(') d++;
    else if (line[k] === ')') {
      d--;
      if (d === 0) return line.slice(i + 4, k);
    }
  }
  return null;
}

/* ⚠️ DEDUPE BY CONDITION PAIR. A first pilot reported 9 of 12 without this and the 12 contained the
   same probe three times — that measures the model's consistency on one question, not its coverage
   of many. 266 of 2113 eligible survivors share a probe with another. */
export function probesFrom(files) {
  const seen = new Map();
  for (const { file, survivors } of files) {
    for (const r of survivors || []) {
      const a = condOf(r.before),
        b = condOf(r.after);
      if (!a || !b || a === b || a.length > 110) continue;
      const key = a + '||' + b;
      if (!seen.has(key)) seen.set(key, { file, line: r.line, op: r.op, a, b, key });
    }
  }
  return [...seen.values()];
}

export function checkWitness(a, b, decl) {
  try {
    const ctx = vm.createContext({ isFinite, Number, String, Array, Object, Math, JSON, parseFloat, parseInt, Date, Boolean });
    vm.runInContext(decl, ctx);
    const va = !!vm.runInContext('(' + a + ')', ctx);
    const vb = !!vm.runInContext('(' + b + ')', ctx);
    return { ok: va !== vb, va, vb };
  } catch (e) {
    return { ok: false, err: String(e.message).slice(0, 60) };
  }
}

async function ask(c) {
  const prompt = [
    'Two JavaScript boolean expressions differ. Give ONE assignment of their variables that makes them',
    'evaluate DIFFERENTLY, or answer NONE if none can exist.',
    '',
    'A: ' + c.a,
    'B: ' + c.b,
    '',
    'Answer with a single line of JavaScript declaring the variables, e.g.  var v = "x", n = 3;',
    'Nothing else. Or the word NONE.'
  ].join('\n');
  const r = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, stream: false, think: false, prompt, options: { temperature: 0.2, num_predict: 90 } })
  });
  const j = await r.json();
  return (
    String(j.response || '')
      .trim()
      .split('\n')
      .filter((l) => l.trim())[0] || ''
  );
}

const IS_MAIN = (() => {
  try {
    return process.argv[1] && join(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (IS_MAIN && process.argv.includes('--selftest')) {
  let pass = 0,
    fail = 0;
  const ok = (n, c, d) => {
    if (c) {
      pass++;
      console.log('  ✓ ' + n);
    } else {
      fail++;
      console.log('  ✗ ' + n + (d ? '  — ' + d : ''));
    }
  };
  ok('a condition is extracted with balanced parens', condOf('if (f(a, b) && c) return 1;') === 'f(a, b) && c', condOf('if (f(a, b) && c) return 1;'));
  ok('a line without an if yields null', condOf('var x = 1;') === null);
  ok('a witness that separates the two is accepted', checkWitness('!x || !x.length', '!x && !x.length', 'var x = [];').ok);
  ok('a witness that does NOT separate them is rejected', !checkWitness('a > 1', 'a >= 1', 'var a = 5;').ok);
  ok('a throwing proposal is rejected, not counted as a witness', !checkWitness('x.y', 'x.z', 'var x = null;').ok);
  /* the dedupe that a first pilot lacked */
  const p = probesFrom([
    {
      file: 'f.js',
      survivors: [
        { line: 1, op: 'o', before: 'if (!a || !a.length) return;', after: 'if (!a && !a.length) return;' },
        { line: 9, op: 'o', before: 'if (!a || !a.length) return;', after: 'if (!a && !a.length) return;' }
      ]
    }
  ]);
  ok('identical condition pairs collapse to one probe', p.length === 1, String(p.length));
  /* §1 migration contract: the shared git-common location is tried FIRST. */
  ok('state dirs try the shared tepna-mutation location first', /tepna-mutation$/.test(STATE_DIRS[0]) && /\.mutation-sweeps$/.test(STATE_DIRS[1]));
  ok('writes land in the shared dir', WRITE_DIR === STATE_DIRS[0]);

  console.log(fail ? '\n✗ ' + fail + ' failed, ' + pass + ' passed' : '\n✓ all ' + pass + ' selftests passed');
  process.exit(fail ? 1 : 0);
}

if (IS_MAIN && !process.argv.includes('--selftest')) {
  const argv = process.argv.slice(2);
  const opt = (f, d) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
  };
  const minutes = Number(opt('--minutes', '15')) || 15;
  const files = [];
  /* An absent sweep directory is a SETUP problem, not an empty result. It is gitignored, so a fresh
     worktree has none — and crashing with a readdir stack trace tells the operator nothing about
     what to do, while an empty run would have been worse: indistinguishable from 'nothing is
     killable'. */
  const sweepEntries = stateJsonFiles(ROOT);
  if (!sweepEntries.length && !STATE_DIRS.some((d) => existsSync(d))) {
    console.error('✗ no state directory at either candidate — run the operator sweeps first, or point');
    console.error('  at a checkout that has them. This is a missing INPUT, not a finding of zero.');
    console.error('  tried: ' + STATE_DIRS.join('  then  '));
    process.exit(2);
  }
  for (const e of sweepEntries) {
    try {
      const j = JSON.parse(readFileSync(e.path, 'utf8'));
      const s = j.survivors || j.results || j.mutants;
      if (Array.isArray(s)) files.push({ file: j.file || e.name, survivors: s });
    } catch {}
  }
  const probes = probesFrom(files);
  if (!probes.length) {
    console.error('✗ no probes — .mutation-sweeps holds no survivor records with an `if (…)` condition.');
    console.error('  An empty run here is indistinguishable from "nothing is killable", which is the');
    console.error('  one answer this tool must never fake.');
    process.exit(2);
  }
  /* Append-only, streamed: a kill costs ONE probe, not the whole run. The previous harness wrote its
     witnesses once at the end and would have lost 423 of them to a Ctrl-C. */
  const out = join(WRITE_DIR, 'survivor-witnesses.jsonl');
  mkdirSync(WRITE_DIR, { recursive: true });
  const led = new ResumeLedger(argv.includes('--resume') ? resolveStatePath(ROOT, 'witness-progress.jsonl') : null, fingerprint({ tool: 'survivor-witness@1', model: MODEL, n: probes.length })).load();
  if (led.stale) process.stderr.write('  ⚠ ledger describes different inputs — starting from zero\n');
  led.begin();
  const todo = probes.filter((p) => !led.has(p.key));
  process.stderr.write(`  ${probes.length} distinct probes · ${led.size} already done · ${todo.length} to go · budget ${minutes} min\n\n`);
  const t0 = Date.now();
  const deadline = t0 + minutes * 60000;
  let hit = 0,
    none = 0,
    no = 0,
    threw = 0,
    n = 0;
  for (const c of todo) {
    if (Date.now() > deadline) {
      process.stderr.write('\n  ⏱ budget reached — stopping cleanly\n');
      break;
    }
    let raw;
    try {
      raw = (await ask(c)).replace(/^```\w*|```$/g, '').trim();
    } catch (e) {
      process.stderr.write('  ⚠ model call failed: ' + e.message + '\n');
      break;
    }
    n++;
    let rec;
    if (/^NONE$/i.test(raw)) {
      none++;
      rec = { verdict: 'NONE' };
    } else {
      const v = checkWitness(c.a, c.b, raw);
      if (v.ok) {
        hit++;
        rec = { verdict: 'WITNESS', witness: raw, a: v.va, b: v.vb };
        /* PRINTED IN FULL, so a reader can verify it by eye without opening a file — and so a kill
           cannot take it with them. */
        console.log(`✓ ${c.file}:${c.line}  ${c.op}`);
        console.log(`    A  ${c.a}`);
        console.log(`    B  ${c.b}`);
        console.log(`    ${raw}   ⇒  A=${v.va}  B=${v.vb}\n`);
        appendFileSync(out, JSON.stringify({ ...c, witness: raw, A: v.va, B: v.vb }) + '\n');
      } else if (v.err) {
        threw++;
        rec = { verdict: 'THREW', err: v.err };
      } else {
        no++;
        rec = { verdict: 'NO-SEPARATION', tried: raw };
      }
    }
    led.record(c.key, rec);
    if (n % 20 === 0) {
      const el = (Date.now() - t0) / 1000;
      const eta = etaFromThroughput(n, todo.length, el);
      process.stderr.write(`    ${led.size}/${probes.length} · ${hit} witnesses · ${fmtDuration(Math.min(eta ?? 0, (deadline - Date.now()) / 1000))} left of budget\n`);
    }
  }
  console.log(`\n▸ ${n} probed this run · ${led.size}/${probes.length} total`);
  console.log(`  WITNESS found      : ${hit}`);
  console.log(`  no separation      : ${no}`);
  console.log(`  proposal threw     : ${threw}`);
  console.log(`  model said NONE    : ${none}`);
  console.log(`\n  witnesses appended to ${out.replace(ROOT + '/', '')} — every line re-checkable.`);
  console.log('  ⚠ A witness is CONDITION-level. Whether the function can reach that binding is a');
  console.log('    separate question, so each is a lead for a test author, never a kill.');
}
