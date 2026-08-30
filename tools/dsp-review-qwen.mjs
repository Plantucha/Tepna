/*
  dsp-review-qwen.mjs — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0

  IDLE-TIME DSP REVIEW — the local model loops through DSP files proposing improvements:
  inefficiencies, logical problems, signal-flow violations, and concrete refactors.
  Owner-directed 2026-08-27: "if there is nothing to do for qwen ... loop through DSPs and
  ... propose code improvements, discover inefficiencies, logical problems and correct
  signal flow, then report."

  ⚠️ INVARIANT (MUTATION-FLEET-EXPANSION §0, unchanged here): the model PROPOSES, it never
  decides. Every finding is a proposal for coordinator triage; this tool changes no code,
  and nothing downstream may treat a finding as established. The review criteria ARE the
  house rules (Clock Contract, honest-null, no fabricated defaults), so findings arrive
  pre-aimed at what this repo actually considers a defect.

  PRIORITY YIELD: refuses to start — and pauses BETWEEN functions — while mutation
  sweep/crawl/probe processes are running. Pipeline work owns the box; review is the idle
  filler, never a competitor. (Bracketed pgrep per the §4 self-match rule.)

  Usage:
    node tools/dsp-review-qwen.mjs                    # default DSP fleet, resumable
    node tools/dsp-review-qwen.mjs --file X.js        # one file (repeatable)
    node tools/dsp-review-qwen.mjs --report           # regenerate the markdown report only
    node tools/dsp-review-qwen.mjs --selftest
  Output:
    .git/tepna-mutation/dsp-review/<file>.review.jsonl   (journal, resumable by function hash)
    .git/tepna-mutation/dsp-review/REVIEW-REPORT.md      (aggregated, per-run regenerated)
*/
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { addFinding } from './findings-ledger.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OLLAMA = 'http://127.0.0.1:11434';
const _mi = process.argv.indexOf('--model');
/* --model: the retired-lane verdicts are MODEL-VERSIONED (0/60 belongs to qwen3-coder:30b, the
   hardcoded default below). A re-audition under a different model MUST both override this AND use
   --tag for a fresh journal namespace — otherwise resume-by-function-hash silently skips every
   already-answered function and an empty run reads as "the new model found nothing". */
const MODEL = _mi >= 0 && process.argv[_mi + 1] ? process.argv[_mi + 1] : 'qwen3-coder:30b';
const _ti = process.argv.indexOf('--tag');
const TAG = _ti >= 0 && process.argv[_ti + 1] ? '-' + process.argv[_ti + 1] : '';
const FLEET = [
  'clock.js',
  'oxydex-dsp.js',
  'hrvdex-dsp.js',
  'pulsedex-dsp.js',
  'glucodex-dsp.js',
  'ecgdex-dsp.js',
  'cpapdex-dsp.js',
  'motiondex-dsp.js',
  'ppgdex-dsp.js',
  'integrator-dsp.js',
  'manifest-gate.js'
];

function stateDir() {
  // shared-state resolution: prefer the primary checkout's .git (same rule the sweep tools use)
  for (const c of [join(ROOT, '.git'), '/home/michal/Tepna/.git']) {
    if (existsSync(c)) {
      const d = existsSync(join(c, 'tepna-mutation')) ? join(c, 'tepna-mutation', 'dsp-review') : null;
      if (d) {
        mkdirSync(d, { recursive: true });
        return d;
      }
    }
  }
  const d = join(ROOT, '.dsp-review');
  mkdirSync(d, { recursive: true });
  return d;
}

/* Pipeline detection — bracketed patterns so this process never matches itself (§4). */
export function pipelineBusy(psOutput) {
  return /[m]utate\.mjs --file|[m]utation-crawl\.mjs|[m]utation-ai-probe\.mjs|[m]utation-suite\.mjs --draft/.test(psOutput);
}
function busyNow() {
  // GPU-aware (2026-08-27, matches qwen-idle-driver.sh): a pipeline process alone is not
  // "busy" — the crawl's sweep phase is CPU-bound and leaves the GPU empty for hours. Yield
  // only when pipeline procs exist AND a model is actually loaded; any overlap race just
  // queues on ollama's serializer, which is latency, not corruption.
  try {
    if (!pipelineBusy(execFileSync('ps', ['ax', '-o', 'args'], { encoding: 'utf8' }))) return false;
    const ps = execFileSync('curl', ['-sf', '--max-time', '5', OLLAMA + '/api/ps'], { encoding: 'utf8' });
    return ps.includes('"model"');
  } catch {
    return false;
  }
}

/* Function chunker — top-level `function name(...)` blocks with balanced braces, capped. */
export function chunkFunctions(src, maxLines = 160) {
  const out = [];
  const re = /^ {0,4}(?:export )?(?:async )?function\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index;
    let depth = 0,
      i = src.indexOf('{', start);
    if (i < 0) continue;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') {
        depth--;
        if (depth === 0) {
          i = j + 1;
          break;
        }
      }
    }
    const text = src.slice(start, i);
    const startLine = src.slice(0, start).split('\n').length;
    const lines = text.split('\n').length;
    if (lines < 4) continue; // trivial accessors: skip
    if (lines > maxLines) {
      // review the head; note the cut honestly
      out.push({ name: m[1], startLine, lines, text: text.split('\n').slice(0, maxLines).join('\n') + '\n/* …TRUNCATED FOR REVIEW at ' + maxLines + ' of ' + lines + ' lines… */', truncated: true });
    } else out.push({ name: m[1], startLine, lines, text, truncated: false });
  }
  return out;
}

/* Python chunker for capture-host lenses: top-level def/class blocks by indentation. */
export function chunkPyFunctions(src, maxLines = 160) {
  const out = [];
  const lines = src.split('\n');
  let cur = null;
  const flush = (endIdx) => {
    if (!cur) return;
    const body = lines.slice(cur.start, endIdx);
    if (body.length >= 4)
      out.push({
        name: cur.name,
        startLine: cur.start + 1,
        lines: body.length,
        text: body.length > maxLines ? body.slice(0, maxLines).join('\n') + '\n# …TRUNCATED FOR REVIEW at ' + maxLines + ' of ' + body.length + ' lines…' : body.join('\n'),
        truncated: body.length > maxLines
      });
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:def|class)\s+([A-Za-z_]\w*)/);
    if (m) {
      flush(i);
      cur = { name: m[1], start: i };
    }
  }
  flush(lines.length);
  return out;
}

/* NARROW LENSES (program §3, charter §3/§4/§7): one worker, one question. Findings from lens
   runs go to the findings ledger, where per-lens precision is tracked — a lens below the
   pre-stated band gets narrowed or retired (program brief §2.5). */
export const LENSES = {
  'resource-leak': {
    scope: /^capture-host\/.*\.py$|^tools\/.*\.mjs$/,
    q: 'ONE question only: find resources acquired and not released on EVERY path — files, sockets, BLE connections, locks, subprocesses, tasks. A leak on the error path counts. Report ONLY leaks you can trace: name the acquisition line and the path that skips the release.'
  },
  'silent-stop': {
    scope: /^capture-host\/.*\.py$/,
    q: 'ONE question only: find paths where acquisition can STOP while the process stays apparently healthy — a poller loop that exits on an unhandled condition, a task that dies without setting an error flag, a retry ladder that gives up permanently without surfacing it. Name the exit path and what stops being done.'
  },
  'no-recovery': {
    scope: /^capture-host\/.*\.py$/,
    q: 'ONE question only: find state transitions with no recovery route — a state reachable on failure from which no code path leads back to normal operation without a restart. Name the entering transition and show the absence of the leaving one.'
  },
  'swallowed-exc': {
    scope: /^capture-host\/.*\.py$|^tools\/.*\.mjs$/,
    q: 'ONE question only: find exceptions that can terminate or corrupt an operation SILENTLY — bare except/catch that discards, error paths that log nothing and set no flag, finally blocks that mask the original error. A deliberate documented suppression is NOT a finding.'
  },
  'dup-state': {
    scope: /^capture-host\/.*\.py$/,
    q: 'ONE question only: find DUPLICATE or CONTRADICTORY state — the same fact stored in two places that can disagree (two flags for one condition, a cached value beside its source, parallel dicts keyed differently). Name both storage sites and the sequence that desynchronizes them.'
  },
  'clock-misuse': {
    scope: /^capture-host\/.*\.py$|\.js$/,
    q: 'ONE question only: find Clock Contract violations — locale/implicit date parsing of vendor strings, a missing timestamp becoming now() or a default instead of null/None, display via local-time getters, naive-vs-aware datetime mixing, epoch seconds/ms/ns unit confusion. Cite the exact call.'
  }
};

const ADVERSARY_RULES = `You are an ADVERSARIAL auditor attacking DSP code from Tepna, a physiological signal suite. Your job is to BREAK it — construct concrete inputs or states under which a function LIES: returns a plausible-looking but wrong value, fabricates a measurement from absent input, silently violates a timing contract, or lets a malformed record corrupt downstream state. Attack lenses, in priority order:
1. FABRICATION: inputs (empty, null-holed, all-zero, single-element) for which the function returns a confident number instead of null/refusal.
2. POISON PROPAGATION: NaN, Infinity, negative time, year-1970 timestamps, reversed order, duplicate timestamps — does garbage become a clean-looking output?
3. CLOCK ATTACKS: inputs that make a fabricated instant (silent Date rolls, epoch/ms confusion, timezone-dependent results, a missing stamp becoming "now").
4. BOUNDARY EXPLOITS: exact-threshold values, off-by-one window edges, w/√12-style artifacts where a window masquerades as a measurement.
5. GUARD EVASION: shapes that slip past validation (a string where an array is checked only for .length, an object with the right keys and wrong types).
Only report attacks you can state CONCRETELY — the input and the wrong output it produces. Do NOT report theoretical concerns without an input, and do NOT report crashes on absurd types unless the crash corrupts state (a clean throw is acceptable behavior).`;

const HOUSE_RULES = `You are reviewing DSP code from Tepna, a local-first physiological signal suite. Review ONLY against these house rules and general correctness:
1. CLOCK: timestamps are FLOATING wall-clock ms (Date.UTC of components); display must use getUTC*; parsing must be regex-per-format, never new Date(string); a missing timestamp must yield null, NEVER a fabricated now/default.
2. HONESTY: a value that cannot be measured is null, not 0, not a default. A count of zero events is honest; a metric fabricated from absent input is a defect. Refusals must not carry fabricated sub-statistics.
3. SIGNAL FLOW: units must be consistent (ms vs s vs ns; mmHg; bpm); sample-rate assumptions must come from data, not constants, where data exists; array index vs time axis confusions; off-by-one at window boundaries; NaN/Infinity propagating into outputs.
4. EFFICIENCY: O(n^2) over per-sample arrays where O(n) exists; repeated sorts/copies in loops; allocations inside hot per-sample loops. Only flag when n is per-sample scale.
5. LOGIC: dead branches, conditions that cannot fire, guards reading the wrong source, boundary conditions contradicting comments.
Do NOT flag style, naming, formatting, or missing comments. Do NOT propose rewrites for taste.`;

/* Per-function repo context via bge doc-search: the documented INTENT beside the code, so the
   reviewer judges against what the repo SAYS the function is for, not just what it does. Fails
   soft — no context beats no review. */
function docContext(fn, file) {
  try {
    const out = execFileSync('node', [join(HERE, 'doc-search.mjs'), `${file.replace(/\.js$/, '')} ${fn.name}`], { encoding: 'utf8', timeout: 30000 });
    const lines = out
      .split('\n')
      .filter((l) => /^ {2}0\./.test(l) || /::/.test(l))
      .slice(0, 4);
    return lines.length ? '\nREPO CONTEXT (top doc-search hits — documented intent, may be stale):\n' + lines.join('\n').slice(0, 600) + '\n' : '';
  } catch {
    return '';
  }
}

export function buildPrompt(fn, file, mode = 'review') {
  const lens = LENSES[mode];
  const rules = lens
    ? `You are a NARROW-LENS auditor for Tepna (local-first physiological acquisition + analysis). ${lens.q}\nDo NOT report anything outside this one question. Do NOT report style. An empty result is a good result.`
    : mode === 'adversary'
      ? ADVERSARY_RULES
      : HOUSE_RULES;
  return (
    rules +
    `

${docContext(fn, file)}\nFILE: ${file}  FUNCTION: ${fn.name}  (starts at line ${fn.startLine}${fn.truncated ? ', shown truncated' : ''})

\`\`\`js
${fn.text}
\`\`\`

Reply with ONLY a JSON array (no prose). Each finding: {"line": <absolute line number, computed as ${fn.startLine} + offset-in-shown-text - 1>, "kind": "inefficiency"|"logic"|"signal-flow"|"improvement"|"defect", "claim": "<one sentence, specific>", "scenario": "<concrete input/state that shows it, one sentence>", "confidence": "low"|"medium"|"high", "fix": "<the SPECIFIC proposed replacement code for the affected lines, verbatim JS, or empty string if you cannot write one you would stand behind>"}
In adversary mode, "scenario" MUST be the concrete attacking input (literal JS value) and "fix" the minimal guard that defeats it. The fix is a PROPOSAL for a human coordinator to review — write it as you would a patch: minimal, in the file's own style, no commentary inside the code. A wrong fix is worse than an empty one.
If nothing meets the bar, reply exactly: []`
  );
}

export function parseFindings(reply) {
  const m = String(reply).match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return null;
    return arr
      .filter((f) => f && typeof f.claim === 'string' && typeof f.line === 'number' && ['inefficiency', 'logic', 'signal-flow', 'improvement', 'defect'].includes(f.kind))
      .map((f) => ({ ...f, fix: typeof f.fix === 'string' ? f.fix.slice(0, 4000) : '' }));
  } catch {
    return null;
  }
}

async function askQwen(prompt) {
  const res = await fetch(OLLAMA + '/api/generate', {
    method: 'POST',
    body: JSON.stringify({ model: MODEL, prompt, think: false, stream: false, options: { temperature: 0.2, num_predict: 900, num_ctx: 8192 } })
  });
  if (!res.ok) throw new Error('ollama HTTP ' + res.status);
  return (await res.json()).response || '';
}

export function fnKey(file, fn, mode = 'review') {
  return createHash('sha256')
    .update(mode + '\0' + file + '\0' + fn.name + '\0' + fn.text)
    .digest('hex')
    .slice(0, 16);
}

function doneKeys(journalPath) {
  const done = new Set();
  if (existsSync(journalPath))
    for (const l of readFileSync(journalPath, 'utf8').split('\n')) {
      if (!l) continue;
      try {
        done.add(JSON.parse(l).key);
      } catch {}
    }
  return done;
}

async function reviewFile(file, dir, mode) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const fns = file.endsWith('.py') ? chunkPyFunctions(src) : chunkFunctions(src);
  const suffix = (LENSES[mode] ? `.lens-${mode}` : mode === 'adversary' ? '.adversary' : '.review') + TAG + '.jsonl';
  const journal = join(dir, file.replace(/\//g, '__') + suffix);
  const done = doneKeys(journal);
  let asked = 0,
    found = 0,
    skipped = 0;
  for (const fn of fns) {
    const key = fnKey(file, fn, mode);
    if (done.has(key)) {
      skipped++;
      continue;
    }
    while (busyNow()) {
      // pipeline preempts review
      process.stderr.write('  ⏸ pipeline busy — review yields for 120s\n');
      await new Promise((r) => setTimeout(r, 120000));
    }
    let findings = null,
      err = null;
    try {
      findings = parseFindings(await askQwen(buildPrompt(fn, file, mode)));
    } catch (e) {
      err = String(e).slice(0, 120);
    }
    appendFileSync(
      journal,
      JSON.stringify({ key, mode, fn: fn.name, startLine: fn.startLine, lines: fn.lines, truncated: fn.truncated, at: 'run', findings: findings || [], parseFailed: findings === null && !err, err }) +
        '\n'
    );
    for (const fi of findings || []) {
      try {
        addFinding({
          model: MODEL,
          lens: LENSES[mode] ? mode : `dsp-${mode}`,
          file,
          line: fi.line,
          component: fn.name,
          category: fi.kind,
          claim: fi.claim,
          scenario: fi.scenario,
          confidence: fi.confidence,
          fix: fi.fix || undefined
        });
      } catch (e) {
        /* Ledger failure must not kill the run — the journal line above already holds the
           finding — but it must not be SILENT either: this exact catch ate ENOTDIR for a whole
           review pass (worktree .git-is-a-file, 2026-08-27) and the ledger quietly recorded
           nothing. Once per run, say so. */
        if (!globalThis.__ledgerWarned) {
          globalThis.__ledgerWarned = true;
          process.stderr.write('  ⚠ findings-ledger write failed (journal still has the findings): ' + String(e).slice(0, 100) + '\n');
        }
      }
    }
    asked++;
    found += (findings || []).length;
    process.stderr.write(`  [${asked}] ${fn.name} → ${findings === null ? (err ? 'ERR' : 'unparseable') : findings.length + ' finding(s)'}\n`);
  }
  return { file, fns: fns.length, asked, skipped, found };
}

function report(dir) {
  const rows = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.review.jsonl') || x.endsWith('.adversary.jsonl') || /\.lens-[\w-]+\.jsonl$/.test(x))) {
    for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!l) continue;
      let o;
      try {
        o = JSON.parse(l);
      } catch {
        continue;
      }
      for (const fi of o.findings || []) rows.push({ file: f.replace(/\.(review|adversary|lens-[\w-]+)\.jsonl$/, '').replace(/__/g, '/'), mode: o.mode || 'review', fn: o.fn, ...fi });
    }
  }
  const order = { high: 0, medium: 1, low: 2 };
  rows.sort((a, b) => (order[a.confidence] ?? 3) - (order[b.confidence] ?? 3) || a.file.localeCompare(b.file));
  let md = `# DSP review report — qwen idle-loop proposals\n\n⚠️ **Every row is a MODEL PROPOSAL, untriaged and unverified.** Nothing here is established;\nthe coordinator triages against the code before anything is acted on. Criteria were the house\nrules (Clock Contract, honest-null, signal flow, per-sample efficiency), not style.\n\n| conf | mode | kind | file:line | function | claim | scenario/attack |\n|---|---|---|---|---|---|\n`;
  for (const r of rows)
    md += `| ${r.confidence} | ${r.mode || 'review'} | ${r.kind} | ${r.file}:${r.line} | ${r.fn} | ${String(r.claim).replace(/\|/g, '/')} | ${String(r.scenario || '').replace(/\|/g, '/')} |\n`;
  const withFix = rows.filter((r) => r.fix);
  if (withFix.length) {
    md += `\n## Proposed fixes (model-written DRAFT CODE — coordinator triage required, never apply blind)\n`;
    for (const r of withFix) md += `\n### ${r.file}:${r.line} · ${r.fn} · ${r.kind} (${r.confidence})\n${r.claim}\n\n\`\`\`js\n${r.fix}\n\`\`\`\n`;
  }
  md += `\n${rows.length} proposal(s), ${withFix.length} with draft fixes · generated ${new Date().toISOString()}\n`;
  writeFileSync(join(dir, 'REVIEW-REPORT.md'), md);
  return rows.length;
}

function selftest() {
  let ok = 0,
    fail = 0;
  const ck = (name, cond) => {
    cond ? ok++ : (fail++, console.error('✗ ' + name));
  };
  const src = 'function tiny(){return 1;}\n  function real(a){\n let s=0;\n for(const x of a){s+=x;}\n return s;\n}\n';
  const fns = chunkFunctions(src);
  ck('chunker skips trivial, keeps real', fns.length === 1 && fns[0].name === 'real');
  ck('startLine computed', fns[0].startLine === 2);
  ck('parse: clean array', (parseFindings('[{"line":3,"kind":"logic","claim":"x","scenario":"y","confidence":"high"}]') || []).length === 1);
  ck('parse: prose-wrapped array', (parseFindings('Here you go:\n[{"line":3,"kind":"logic","claim":"x","confidence":"low"}]\nDone.') || []).length === 1);
  ck('parse: empty ok', Array.isArray(parseFindings('[]')) && parseFindings('[]').length === 0);
  ck('parse: junk → null', parseFindings('I think this code is fine') === null);
  ck('parse: bad kind filtered', (parseFindings('[{"line":1,"kind":"style","claim":"x"}]') || []).length === 0);
  ck('parse: fix passthrough', (parseFindings('[{"line":1,"kind":"logic","claim":"x","fix":"return null;"}]') || [])[0].fix === 'return null;');
  ck('parse: missing fix → empty string', (parseFindings('[{"line":1,"kind":"logic","claim":"x"}]') || [])[0].fix === '');
  ck('busy: matches crawl', pipelineBusy('node tools/mutation-crawl.mjs --max-hours 40'));
  ck('busy: matches sweep', pipelineBusy('node tools/mutate.mjs --file x.js --limit 5'));
  ck('busy: ignores itself', !pipelineBusy('node tools/dsp-review-qwen.mjs'));
  const k1 = fnKey('a.js', fns[0]);
  const k2 = fnKey('a.js', fns[0]);
  ck('key stable', k1 === k2);
  ck('key differs by mode', fnKey('a.js', fns[0], 'adversary') !== fnKey('a.js', fns[0], 'review'));
  ck('adversary prompt selected', buildPrompt(fns[0], 'a.js', 'adversary').includes('ADVERSARIAL auditor'));
  ck('review prompt default', buildPrompt(fns[0], 'a.js').includes('house rules') || buildPrompt(fns[0], 'a.js').includes('reviewing DSP code'));
  const py = 'def tiny():\n    pass\ndef real(a):\n    s = 0\n    for x in a:\n        s += x\n    return s\nclass Thing:\n    x = 1\n    y = 2\n    z = 3\n';
  const pfns = chunkPyFunctions(py);
  ck('py chunker keeps real + class, skips tiny', pfns.length === 2 && pfns[0].name === 'real' && pfns[1].name === 'Thing');
  ck('py startLine 1-based', pfns[0].startLine === 3);
  ck('six lenses defined', Object.keys(LENSES).length === 6);
  ck('lens scope discriminates', LENSES['silent-stop'].scope.test('capture-host/oxy_pull.py') && !LENSES['silent-stop'].scope.test('oxydex-dsp.js'));
  ck('lens prompt is narrow', buildPrompt(fns[0], 'a.js', 'resource-leak').includes('ONE question only') && !buildPrompt(fns[0], 'a.js', 'resource-leak').includes('ADVERSARIAL'));
  console.log(`selftest: ${ok} ok, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();
  const dir = stateDir();
  if (argv.includes('--report')) {
    console.log(report(dir) + ' proposals in REVIEW-REPORT.md');
    return;
  }
  const files = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--file' && argv[i + 1]) files.push(argv[++i]);
  const mi = argv.indexOf('--mode');
  const li = argv.indexOf('--lens');
  const lensId = li >= 0 ? argv[li + 1] : null;
  if (lensId && !LENSES[lensId]) {
    console.error(`unknown lens ${lensId} — have: ${Object.keys(LENSES).join(' ')}`);
    process.exit(2);
  }
  const mode = lensId || (mi >= 0 && argv[mi + 1] === 'adversary' ? 'adversary' : 'review');
  if (argv.includes('--diff')) {
    // diff-scoped: files changed on origin/main in the last 24 h, filtered by the lens scope
    // (or by "is a repo js/py file" for review/adversary). Program §3 job 2.
    const changed = execFileSync('git', ['log', '--since=24 hours ago', '--name-only', '--pretty=format:', 'origin/main'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const scope = LENSES[mode] ? LENSES[mode].scope : /\.(js|mjs|py)$/;
    const uniq = [...new Set(changed)].filter((f) => scope.test(f) && existsSync(join(ROOT, f)));
    files.length = 0;
    files.push(...uniq);
    if (!files.length) {
      console.log(`--diff: no changed files in scope for ${mode} in the last 24 h — nothing to do`);
      return;
    }
  } else if (lensId && !files.length) {
    console.error('--lens requires --diff or explicit --file targets (a whole-tree lens run is a deliberate act)');
    process.exit(2);
  }
  const targets = files.length ? files : FLEET;
  if (busyNow() && !argv.includes('--force')) {
    console.error('pipeline busy — review is the idle filler, not a competitor. It will be retried by its runner.');
    process.exit(3);
  }
  console.log(`DSP ${argv.indexOf('--mode') >= 0 && argv[argv.indexOf('--mode') + 1] === 'adversary' ? 'ADVERSARY AUDIT' : 'REVIEW'} — ${targets.length} file(s), model ${MODEL}, journal in ${dir}`);
  for (const f of targets) {
    if (!existsSync(join(ROOT, f))) {
      console.error('  missing: ' + f);
      continue;
    }
    const r = await reviewFile(f, dir, mode);
    console.log(`  ${f}: ${r.asked} reviewed (+${r.skipped} cached) → ${r.found} proposal(s)`);
  }
  console.log(report(dir) + ' total proposal(s) → REVIEW-REPORT.md');
}
if (fileURLToPath(import.meta.url) === process.argv[1] || (process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url)))) main();
