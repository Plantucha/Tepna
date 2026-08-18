// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/**
 * mutation-ai-probe.mjs — ask the local model for an input that separates a survivor from the real
 * code, then CHECK whether it does by running both.
 *
 * ┌─ WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────┐
 * │ The fleet crawl leaves 5813 survivors for which NO distinguishing input is known. They are   │
 * │ not known-equivalent — `mutation-crawl.mjs`'s own header is careful about this: a survivor    │
 * │ the generic battery could not separate is "not distinguished by the generic battery", which  │
 * │ is a different statement from "equivalent". The battery is the limit, not the mutant.        │
 * │ Measured there: where a hand-built battery replaced the generic one, the same function went  │
 * │ from 0 to 17 killable.                                                                       │
 * │                                                                                              │
 * │ Hand-building a battery per function does not scale to 5813. Proposing inputs is exactly the │
 * │ regime the local model is good at — it is a guess, and a guess is free when something else   │
 * │ checks it.                                                                                   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * THE SAFETY ARGUMENT IS THE SAME ONE `--draft` USES, AND IT IS THE ONLY REASON A MODEL CALIBRATED
 * 0/4 ON CODE CORRECTNESS MAY BE POINTED AT THIS. The model proposes an INPUT. It never says what
 * the code should do, never supplies an expected value, and is never believed: the input is run
 * against the real module and against the mutant, and only a MEASURED difference counts. A bad
 * proposal is not a wrong answer, it is a wasted millisecond.
 *
 * ⚠️ MODEL OUTPUT IS PARSED WITH `JSON.parse`, NEVER `eval`/`Function`. `--draft` needed a charset
 * allowlist because a projection is an expression that must be evaluated; here the model's entire
 * contribution is DATA, so it is parsed as data and the code-execution question never arises. If a
 * future edit reaches for `eval` to accept richer arguments, it is trading the whole safety argument
 * for convenience — build the value from JSON instead.
 *
 * ⚠️ A DIFFERENCE IS NOT AUTOMATICALLY A KILL. Two filters, both learned the hard way:
 *   - the real code THROWING is not a distinguishing input. `--draft` shipped one such draft: it
 *     asserted `detectPeriodicity([1,2,3])` throws a TypeError, which pins a crash as the contract
 *     and emits a test that cannot even run (the throw happens before the assertion). The crash was
 *     a wrong-TYPE input from the generic battery, not an OxyDex defect.
 *   - a difference only visible through a realm artefact is not a difference in the subject.
 *     `isRealmArtefact` is reused rather than re-derived.
 *
 * Usage:
 *   node tools/mutation-ai-probe.mjs --file oxydex-dsp.js [--limit N] [--per-mutant K]
 *   node tools/mutation-ai-probe.mjs --selftest
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadRealm, isRealmArtefact } from './mutation-crawl.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const log = (s) => process.stderr.write(s + '\n');
const ROOT = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
})();

const HOST = 'http://127.0.0.1:11434';
const MODEL = opt('--model', 'qwen3-coder:30b');
const CTX = Number(opt('--ctx', '2048')); // larger than --draft's: the prompt carries function source

/**
 * Parse the model's proposed inputs. Each line is a JSON ARRAY OF ARGUMENTS.
 *
 * Anything that is not a JSON array is dropped rather than repaired — a "fixed up" proposal is a
 * proposal nobody wrote, and there is no shortage of them. Returns [] rather than throwing: an
 * unusable reply is a wasted attempt, not an error.
 */
export function parseProposedInputs(text, max = 12) {
  const out = [];
  for (const raw of String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .split('\n')) {
    const line = raw.trim().replace(/^[-*\d.)\s]+/, '');
    if (!line.startsWith('[')) continue;
    let v;
    try {
      v = JSON.parse(line);
    } catch {
      continue; // not valid JSON ⇒ dropped, never repaired
    }
    if (!Array.isArray(v)) continue;
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/** A stable, comparable string for a call result — the same shape mutation-crawl records. */
export function resultString(fn, args, timeoutNote = 'THREW') {
  try {
    const v = fn.apply(null, args);
    if (v === undefined) return 'undefined';
    try {
      return JSON.stringify(v);
    } catch {
      return '[unserialisable ' + typeof v + ']';
    }
  } catch (e) {
    return timeoutNote + ':' + String((e && e.message) || e).slice(0, 120);
  }
}

/**
 * Decide whether a proposed input actually separates the two — and whether that separation is worth
 * anything. Pure over the two result strings so it can be tested without a realm.
 */
export function verdictFor(origStr, mutStr) {
  if (origStr === mutStr) return { kill: false, why: 'identical output' };
  if (/^THREW/.test(origStr)) return { kill: false, why: 'the REAL code throws on this input — a crash is not a contract, and the assertion would not even run' };
  if (/^THREW/.test(mutStr) && /^THREW/.test(origStr)) return { kill: false, why: 'both threw' };
  if (origStr.length > 100000) return { kill: false, why: 'output too large to record honestly' };
  return { kill: true, why: 'measured difference' };
}

function promptFor(fnName, fnSrc, before, after, op) {
  return (
    'Here is a JavaScript function and a single-line change made to it (a mutation).\n\n' +
    'FUNCTION ' +
    fnName +
    ':\n' +
    String(fnSrc).slice(0, 2200) +
    '\n\n' +
    'THE MUTATION (' +
    op +
    '):\n' +
    '  original: ' +
    before +
    '\n' +
    '  mutated:  ' +
    after +
    '\n\n' +
    'Propose concrete ARGUMENTS that would make the original and the mutated version return ' +
    'DIFFERENT values. Aim at the changed line: pick values that sit exactly on the boundary it tests.\n\n' +
    'Output ONLY lines, each a JSON array of the arguments, most promising first. No prose, no ' +
    'comments, no trailing text. Example for a two-argument function:\n' +
    '[[250,300,250],null]\n' +
    '[[],{"fs":130}]\n'
  );
}

async function ask(prompt, attempt = 0) {
  const sampling = [{ temperature: 0 }, { temperature: 0.7, top_p: 0.8, top_k: 20 }, { temperature: 1.0, top_p: 0.95, top_k: 20 }];
  const res = await fetch(HOST + '/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, stream: false, think: false, options: { num_ctx: CTX, num_predict: 300, ...sampling[Math.min(attempt, 2)] } })
  });
  const j = await res.json();
  return j.response || '';
}

/**
 * Apply a mutation AT ITS RECORDED LINE.
 *
 * ⚠️ `src.replace(before, after)` IS WRONG AND SILENTLY SO — it rewrites the FIRST occurrence in the
 * file, which is very often not the mutant's. `before` is routinely a common line (`T: 1`, a guard
 * clause, a bounds check), so the wrong site gets mutated, the subject under test is untouched, and
 * every probe against it reports "none separated". Caught by the positive control, which replayed
 * inputs the crawl had PROVED distinguishing and detected only 2 of 6: two came back "identical
 * output" against a crawl record that showed a clear difference, and one mutant would not even load.
 * Nothing else would have surfaced it — a probe that mutates the wrong line looks exactly like a
 * model that cannot guess, and it is the model that would have been blamed.
 *
 * Returns null when the recorded text is not on the recorded line, rather than falling back to a
 * whole-file replace: a fallback here re-introduces the bug in the one case that needs it most.
 */
export function mutateAtLine(src, line, before, after) {
  const lines = src.split('\n');
  const i = Number(line) - 1;
  if (!(i >= 0 && i < lines.length)) return null;
  const b = String(before).trim();
  if (!b || !lines[i].includes(b)) return null;
  lines[i] = lines[i].replace(b, String(after).trim());
  return lines.join('\n');
}

/** Extract a named function's source text, best-effort. Used only to inform the model. */
export function functionSource(src, name) {
  const re = new RegExp('(?:function\\s+' + name + '\\s*\\(|(?:const|var|let)\\s+' + name + '\\s*=\\s*function\\s*\\(|' + name + '\\s*[:=]\\s*function\\s*\\()');
  const m = re.exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index);
  if (i < 0) return null;
  let depth = 0;
  for (let k = i; k < src.length && k < i + 20000; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') {
      depth--;
      if (depth === 0) return src.slice(m.index, k + 1);
    }
  }
  return src.slice(m.index, i + 2000);
}

/**
 * Map a source LINE to its enclosing top-level function name. Built once per file.
 *
 * Line-based because that is what the journal key carries. A survivor whose line falls in no known
 * function gets no call handle and is skipped as UNREACHABLE — the same verdict `mutation-crawl`
 * reaches, and deliberately not a guess.
 */
export function functionIndex(src) {
  const lines = src.split('\n');
  const spans = [];
  const re = /^\s*(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|var|let)\s+([A-Za-z_$][\w$]*)\s*=\s*function\s*\()/;
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const name = m[1] || m[2];
    let depth = 0,
      started = false,
      end = i;
    for (let k = i; k < lines.length; k++) {
      for (const ch of lines[k]) {
        if (ch === '{') {
          depth++;
          started = true;
        } else if (ch === '}') depth--;
      }
      if (started && depth <= 0) {
        end = k;
        break;
      }
    }
    spans.push({ name, from: i + 1, to: end + 1 });
  }
  /* INNERMOST WINS: nested declarations produce overlapping spans, and the enclosing one is not the
     function the mutation is in. Sorting by width and taking the narrowest match is the whole fix. */
  spans.sort((a, b) => a.to - a.from - (b.to - b.from));
  return (line) => {
    for (const s2 of spans) if (line >= s2.from && line <= s2.to) return s2.name;
    return null;
  };
}

function selftest() {
  let fail = 0,
    ran = 0;
  const ck = (n, got, want) => {
    ran++;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log((ok ? '  ✓ ' : '  ✕ ') + n + (ok ? '' : '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
    if (!ok) fail++;
  };

  console.log('mutation-ai-probe — the model proposes DATA; nothing it says is believed');
  ck('a JSON array line is accepted', parseProposedInputs('[[1,2],null]'), [[[1, 2], null]]);
  ck('…several, in order', parseProposedInputs('[1]\n[2]\n[3]').length, 3);
  ck('…list bullets are tolerated', parseProposedInputs('- [1]\n2. [2]').length, 2);
  ck('prose is dropped, not repaired', parseProposedInputs('Here are the inputs:\n[1]'), [[1]]);
  ck('a non-array JSON value is dropped', parseProposedInputs('{"a":1}\n[1]'), [[1]]);
  ck('malformed JSON is dropped, never fixed up', parseProposedInputs('[1,\n[2]'), [[2]]);
  ck('an empty reply yields nothing rather than throwing', parseProposedInputs(''), []);
  ck('<think> blocks are stripped', parseProposedInputs('<think>[9]</think>\n[1]'), [[1]]);
  ck('the cap is honoured', parseProposedInputs('[1]\n[2]\n[3]\n[4]', 2).length, 2);
  /* ⚠️ THE WHOLE SAFETY ARGUMENT: model output is DATA, parsed as data. A line that is code and not
     JSON must be dropped by the parser, not filtered afterwards. */
  ck('an expression is not JSON, so it never reaches execution', parseProposedInputs('[process.exit(1)]'), []);
  ck('…nor does a function literal', parseProposedInputs('[function(){}]'), []);

  console.log('\nverdictFor — a difference is not automatically a kill');
  ck('a measured difference is a kill', verdictFor('{"a":1}', '{"a":2}').kill, true);
  ck('identical output is not', verdictFor('{"a":1}', '{"a":1}').kill, false);
  /* `--draft` shipped exactly one draft asserting the real code throws; it pinned a crash as the
     contract and emitted a test that could not run. Refused here at the source. */
  ck('the REAL code throwing is NOT a distinguishing input', verdictFor('THREW:boom', 'null').kill, false);
  ck('…and says why, in terms that name the defect', /crash is not a contract/.test(verdictFor('THREW:x', 'null').why), true);
  ck('only the MUTANT throwing is a legitimate kill', verdictFor('null', 'THREW:boom').kill, true);
  ck('both throwing is not', verdictFor('THREW:a', 'THREW:b').kill, false);

  console.log('\nmutateAtLine — the bug the positive control caught');
  const dup = 'var T = 1;\nfunction f() {\n  var T = 1;\n  return T;\n}';
  /* The SAME text on two lines: a whole-file replace hits line 1, the mutant is on line 3. */
  ck('mutates the RECORDED line, not the first match', mutateAtLine(dup, 3, 'var T = 1;', 'var T = 0;').split('\n')[2], '  var T = 0;');
  ck('…leaving the earlier identical line untouched', mutateAtLine(dup, 3, 'var T = 1;', 'var T = 0;').split('\n')[0], 'var T = 1;');
  ck('a line that does not carry the text is null, NOT a whole-file replace', mutateAtLine(dup, 2, 'var T = 1;', 'var T = 0;'), null);
  ck('an out-of-range line is null', mutateAtLine(dup, 99, 'var T = 1;', 'var T = 0;'), null);

  console.log('\nfunctionIndex — a survivor with no call handle is skipped, never guessed');
  const idxSrc = 'function outer(a) {\n  function inner(b) {\n    return b;\n  }\n  return a;\n}\nvar loose = 1;';
  const at = functionIndex(idxSrc);
  ck('a line inside the nested function maps to the INNERMOST', at(3), 'inner');
  ck('…a line in the outer one maps to the outer', at(5), 'outer');
  ck('…and a line in no function is null, not a nearby guess', at(7), null);

  console.log('\nfunctionSource');
  const src = 'function foo(a) {\n  if (a < 3) return null;\n  return a;\n}\nfunction bar() {}';
  ck('extracts a declaration with balanced braces', /return a;/.test(functionSource(src, 'foo')), true);
  ck('…and stops at its own end', /function bar/.test(functionSource(src, 'foo')), false);
  ck('an absent function is null, not an empty string', functionSource(src, 'nope'), null);

  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all ' + ran + ' selftests passed');
  return fail ? 1 : 0;
}

async function main() {
  const file = opt('--file', '');
  if (!file) return log('need --file <name>-dsp.js');
  const crawlDir = opt('--crawl-dir', join(ROOT, '.mutation-crawl'));
  const cp = join(crawlDir, basename(file) + '.crawl.json');
  if (!existsSync(cp)) return log('no crawl result at ' + cp + ' — this is a refusal, not an empty result');
  const srcPath = join(ROOT, file);
  if (!existsSync(srcPath)) return log('no source at ' + srcPath);
  const src = readFileSync(srcPath, 'utf8');
  const crawl = JSON.parse(readFileSync(cp, 'utf8'));

  /* ⚠️ SURVIVORS LIVE IN THE JOURNAL, NOT THE CRAWL JSON. The crawl records a `mutants` array only
     for findings it PROBED, and only the KILLABLE entries in it — so reading survivors from
     `crawl.findings[].mutants` finds nothing at all and the tool reports "no survivor to probe" for
     a file with 379 of them. That empty result reads exactly like success, which is the failure this
     repo keeps paying for; it is why this comment names the source explicitly. */
  const jp = join(opt('--journal-dir', join(ROOT, '.mutate-journal')), basename(file) + '.jsonl');
  if (!existsSync(jp)) return log('no journal at ' + jp + ' — survivors are recorded there, not in the crawl JSON (refusal, not an empty result)');
  const fnAt = functionIndex(src);
  const callFor = new Map();
  for (const fi of crawl.findings || []) if (fi.fn && fi.callPath) callFor.set(fi.fn, fi.callPath);

  const targets = [];
  for (const line of readFileSync(jp, 'utf8').split('\n')) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.v !== 'SURVIVED' || !o.k) continue;
    const [ln, op, before, after] = String(o.k).split(String.fromCharCode(0));
    if (!before || !after) continue;
    const fn = fnAt(Number(ln));
    const call = fn && callFor.get(fn);
    if (!call) continue; // no handle to call it with — UNREACHABLE, same verdict the crawl gives
    targets.push({ fn, call, line: Number(ln), op, before, after });
  }
  const limit = Number(opt('--limit', '0')) || targets.length;
  const pick = targets.slice(0, limit);
  if (!pick.length) return log('no undistinguished survivor carries enough context to probe in ' + file);

  log('AI PROBE — ' + file);
  log('  ' + targets.length + ' undistinguished survivor(s); probing ' + pick.length + ' with ' + MODEL);
  log('  the model proposes INPUTS ONLY. Every one is RUN against real and mutant; nothing is believed.\n');

  const realm = loadRealm(src);
  const t0 = Date.now();
  const found = [];
  let tried = 0,
    noProposal = 0;

  for (let i = 0; i < pick.length; i++) {
    const t = pick[i];
    const fnSrc = functionSource(src, t.fn) || t.before;
    let inputs = [];
    for (let a = 0; a < 2 && !inputs.length; a++) {
      try {
        inputs = parseProposedInputs(await ask(promptFor(t.fn, fnSrc, t.before, t.after, t.op), a), Number(opt('--per-mutant', '8')));
      } catch {
        log('✗ local model unreachable at ' + HOST + ' — stopping (a refusal, not an empty result)');
        break;
      }
    }
    const el = (Date.now() - t0) / 1000;
    const rate = (i + 1) / (el / 60);
    const prog =
      '[' + String(i + 1).padStart(4) + '/' + pick.length + '  ' + rate.toFixed(1) + '/min  ETA ' + Math.round((pick.length - i - 1) / Math.max(rate, 0.01)) + 'm  found ' + found.length + ']';
    if (!inputs.length) {
      noProposal++;
      log(prog + ' — ' + t.call + ' [' + t.op + ']  no parseable proposal');
      continue;
    }

    const mutSrc = mutateAtLine(src, t.line, t.before, t.after);
    if (!mutSrc) {
      log(prog + ' — ' + t.call + '  recorded text is not on line ' + t.line + ' (source moved) — skipped, NOT whole-file replaced');
      continue;
    }
    let mutRealm;
    try {
      mutRealm = loadRealm(mutSrc);
    } catch {
      log(prog + ' — ' + t.call + '  mutant does not load');
      continue;
    }
    const path = String(t.call).split('.');
    const get = (ctx) => path.reduce((o, k) => (o == null ? o : o[k]), ctx);
    const fnA = get(realm),
      fnB = get(mutRealm);
    if (typeof fnA !== 'function' || typeof fnB !== 'function') {
      log(prog + ' — ' + t.call + '  not reachable as a function');
      continue;
    }

    let hit = null;
    for (const args of inputs) {
      tried++;
      const a = resultString(fnA, args);
      const b = resultString(fnB, args);
      const v = verdictFor(a, b);
      if (!v.kill) continue;
      if (isRealmArtefact && isRealmArtefact(a, b, () => true) === true) continue;
      hit = { input: JSON.stringify(args), orig: a.slice(0, 2000), mutant: b.slice(0, 2000) };
      break;
    }
    if (!hit) {
      log(prog + ' — ' + t.call + ' [' + t.op + ']  ' + inputs.length + ' input(s), none separated');
      continue;
    }
    found.push({ fn: t.fn, callPath: t.call, line: t.line, op: t.op, before: t.before, after: t.after, status: 'KILLABLE', ...hit });
    log(prog + ' ✓ ' + t.call + ' [' + t.op + ']  NOW KILLABLE');
    log('        input ' + hit.input.slice(0, 70));
    log('        real=' + hit.orig.slice(0, 46) + '   mutant=' + hit.mutant.slice(0, 46));
  }

  const outDir = join(ROOT, '.mutation-crawl');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, basename(file) + '.ai-probe.json');
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        file,
        generatedAt: new Date().toISOString(),
        model: MODEL,
        probed: pick.length,
        inputsRun: tried,
        noProposal,
        newlyKillable: found.length,
        findings: [{ fn: 'ai-probe', callPath: file, status: 'PROBED', battery: 'ai', mutants: found }]
      },
      null,
      1
    )
  );
  const mins = (Date.now() - t0) / 60000;
  log('\n  ' + found.length + ' newly KILLABLE of ' + pick.length + ' probed (' + tried + ' inputs run, ' + noProposal + ' with no parseable proposal) in ' + mins.toFixed(1) + ' min');
  log('  → ' + outPath + '   (feed to `mutation-suite.mjs --draft --crawl-dir <dir>`)');
}

const INVOKED_DIRECTLY = (() => {
  try {
    return !!process.argv[1] && fileURLToPath(import.meta.url).endsWith(basename(process.argv[1]));
  } catch {
    return false;
  }
})();
if (INVOKED_DIRECTLY) {
  if (has('--selftest')) process.exit(selftest());
  else await main();
}
