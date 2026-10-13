// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// Solver runner for audits/DEFECT-BENCHMARK.json. Measures the BENCHMARK
// METHOD with a local model, never the fleet. Writes nothing into a tracked file.
//
// Mode: file-localised. The solver is handed the definitions the row's own text names,
// inside the files the fix touched, so a score measures PATCH WRITING, not localisation.

import { execFileSync, execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = (name) => argv.includes(`--${name}`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
// The checkout whose history the benchmark names. Defaults to the one this tool lives in, so a
// reclaimed worktree cannot silently become the subject.
const REPO = opt('repo', ROOT);
const BENCH = opt('bench', path.join(REPO, 'audits/DEFECT-BENCHMARK.json'));
const PYSPAN = opt('pyspan', path.join(HERE, 'defect-bench-pyspan.py'));
const OUT = opt('out', '');
const MODEL = opt('model', 'qwen3-coder:30b');
const NUM_CTX = Number(opt('num-ctx', '16384'));
const NUM_PREDICT = Number(opt('num-predict', '2200'));
const CTX_BUDGET = Number(opt('ctx-budget', '20000'));
const HALF = opt('half', 'all');
const LIMIT = Number(opt('limit', '0'));
const ONLY = opt('task', '');
const MODE = opt('mode', 'defs'); // defs = row-localised definition rewrite · edit = oracle-localised SEARCH/REPLACE
const CONTROLS_ONLY = flag('controls-only'); // no model call: prove the harness
// HEADROOM: splice the FIX's own text for the definitions the solver is shown. Green bounds what
// this mode can score at all; red means the fix also changed code the solver never sees.
const SPLICE_CONTROL = flag('splice-control');
// POSITIVE CONTROL for the scoring path: apply the fix's own python hunks to the parent extract.
// Green proves extract + test overlay + oracle can score a pass; red bounds what any python-only
// solver can reach.
const APPLY_CONTROL = flag('apply-control');
const PYTEST_TIMEOUT_MS = 300000;
const ENDPOINT = 'http://127.0.0.1:11434';

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

// ---------- the row's own identifiers ----------
// Backticked tokens in `defect` + `evidence`. A name is kept only when the parent file
// actually declares it, so a prose word in backticks costs nothing.
function namesFromRow(task) {
  const text = `${task.defect || ''}\n${task.evidence || ''}`;
  const out = new Set();
  for (const m of text.matchAll(/`([^`\n]{2,80})`/g)) {
    let tok = m[1].trim();
    tok = tok.replace(/\(\s*\)$/, '').replace(/\(.*$/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(tok)) continue;
    const parts = tok.split('.').filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last || last.length < 2) continue;
    out.add(last);
    if (parts.length > 1) out.add(parts.slice(-2).join('.'));
  }
  return [...out];
}

function pySpans(src, names) {
  const res = spawnSync('python3', ['-I', PYSPAN], {
    input: JSON.stringify({ src, names }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  if (res.status !== 0) return { ok: false, reason: `pyspan-failed: ${(res.stderr || '').slice(0, 160)}` };
  return JSON.parse(res.stdout);
}

function gitShow(rev, file, cwd) {
  try {
    return execFileSync('git', ['show', `${rev}:${file}`], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

// ---------- context ----------
// A definition is reached either because the row DECLARES its name, or because the row names
// something the definition mentions. A name mentioned in more than MAX_REF_DEFS definitions does
// not localise, so it is dropped rather than widened.
const MAX_REF_DEFS = 3;

function buildContext(task) {
  const pyFiles = (task.srcFiles || []).filter((f) => f.startsWith('capture-host/') && f.endsWith('.py'));
  if (pyFiles.length === 0) return { ok: false, reason: 'no-capture-host-source' };
  const names = namesFromRow(task);
  if (names.length === 0) return { ok: false, reason: 'row-names-no-identifier' };

  const units = [];
  for (const f of pyFiles) {
    const src = gitShow(task.parentCommit, f, REPO);
    if (src == null) {
      const atFix = gitShow(task.fixCommit, f, REPO);
      return { ok: false, reason: atFix == null ? `source-absent-at-both: ${f}` : `source-added-by-fix: ${f}` };
    }
    const lines = src.split('\n');
    const sp = pySpans(src, names);
    if (!sp.ok) return { ok: false, reason: sp.reason };

    let spans = sp.spans;
    let localisedBy = 'declaration';
    if (spans.length === 0) {
      const seen = new Map();
      for (const r of sp.refSpans || []) {
        if (r.defs.length > MAX_REF_DEFS) continue;
        for (const d of r.defs) seen.set(d.qual, d);
      }
      spans = [...seen.values()];
      localisedBy = 'reference';
    }
    if (spans.length === 0) continue;
    // Drop a class whose own method is already shown; the method is the narrower target.
    spans = spans.filter((s) => s.kind !== 'ClassDef' || !spans.some((o) => o !== s && o.qual.startsWith(`${s.qual}.`))).sort((a, b) => a.start - b.start);
    units.push({ file: f, headerEnd: Math.min(sp.headerEnd, 60), spans, lines, total: lines.length, localisedBy });
  }
  if (units.length === 0) return { ok: false, reason: 'row-names-no-definition' };

  // Budget by DEFINITION, smallest first: a definition is shown whole or not at all, because the
  // answer replaces it whole.
  const cand = [];
  for (const u of units) for (const s of u.spans) cand.push({ u, s, cost: u.lines.slice(s.start - 1, s.end).join('\n').length + 1 });
  cand.sort((a, b) => a.cost - b.cost);
  let spent = 0;
  const keep = new Set();
  let elided = 0;
  for (const c of cand) {
    if (spent + c.cost <= CTX_BUDGET) {
      keep.add(c);
      spent += c.cost;
    } else elided++;
  }
  if (keep.size === 0) return { ok: false, reason: `definition-exceeds-budget: ${cand[0].cost} chars` };

  let text = '';
  const shown = [];
  for (const u of units) {
    const mine = cand
      .filter((c) => c.u === u && keep.has(c))
      .map((c) => c.s)
      .sort((a, b) => a.start - b.start);
    if (mine.length === 0) continue;
    let block = `FILE ${u.file} (${u.total} lines; everything not shown is unchanged)\n\`\`\`python\n`;
    let prev = 0;
    if (u.headerEnd > 0) {
      block += `${u.lines.slice(0, u.headerEnd).join('\n')}\n`;
      prev = u.headerEnd;
    }
    for (const s of mine) {
      if (s.start <= prev) continue;
      if (s.start > prev + 1) block += `\n# … lines ${prev + 1}–${s.start - 1} elided …\n\n`;
      block += `${u.lines.slice(s.start - 1, s.end).join('\n')}\n`;
      prev = s.end;
      shown.push(`${u.file} :: ${s.qual}`);
    }
    if (prev < u.total) block += `\n# … lines ${prev + 1}–${u.total} elided …\n`;
    block += '\`\`\`\n\n';
    text += block;
  }
  if (shown.length === 0) return { ok: false, reason: 'row-names-no-definition' };
  return {
    ok: true,
    text,
    shown,
    names,
    pyFiles,
    truncated: elided > 0,
    definitionsElided: elided,
    localisedBy: [...new Set(units.map((u) => u.localisedBy))].join('+'),
    chars: text.length
  };
}

function prompt(task, ctx) {
  return `You repair a defect in a Python module. Rewrite only the definitions you are shown.

DEFECT REPORT
${(task.defect || '').slice(0, 2600)}

EVIDENCE
${(task.evidence || '').slice(0, 1400)}

THE TESTS THAT MUST PASS AFTER YOUR FIX (you cannot see them; they currently fail)
${(task.failToPass || []).slice(0, 12).join('\n')}

SOURCE AT THE DEFECTIVE COMMIT
${ctx.text}
ANSWER FORMAT — nothing else, no prose, no explanation:

### FUNCTION <file path> :: <qualified name>
\`\`\`python
<the complete replacement definition, including its decorators and full body>
\`\`\`

Repeat that pair for every definition you change. Copy the qualified name exactly as it appears above (${ctx.shown.slice(0, 6).join(', ')}). Keep the signature compatible. Do not add imports outside a definition. Do not emit a diff.`;
}

// ---------- oracle-localised context (mode=edit) ----------
// The solver is shown the REGIONS the real fix touches: the enclosing definition of every changed
// line, or a window around a module-level change. That LEAKS THE LOCATION of the defect and nothing
// of its content, and it is the only context strategy this corpus supports — a whole capture-host
// source file is 166 KB at the median.
const WINDOW = 8;
const EDIT_BUDGET = Number(opt('edit-budget', '36000'));

function allDefs(src) {
  const res = spawnSync('python3', ['-I', PYSPAN], {
    input: JSON.stringify({ src, names: [], all: true }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  if (res.status !== 0) return null;
  const j = JSON.parse(res.stdout);
  return j.ok ? j : null;
}

function touchedFiles(task) {
  const out = execFileSync('git', ['diff', '--name-only', `${task.parentCommit}..${task.fixCommit}`, '--', 'capture-host'], { cwd: REPO, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.startsWith('capture-host/tests/'));
  return out;
}

function oldSideRanges(task, file) {
  const diff = execFileSync('git', ['diff', '-U0', `${task.parentCommit}..${task.fixCommit}`, '--', file], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });
  const ranges = [];
  for (const line of diff.split('\n')) {
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!m) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    // a pure insertion has count 0 and -start is the line BEFORE it
    ranges.push(count === 0 ? [start, start + 1] : [start, start + count - 1]);
  }
  return ranges;
}

function buildEditContext(task) {
  const files = touchedFiles(task);
  if (files.length === 0) return { ok: false, reason: 'fix-changes-no-capture-host-source' };
  const nonPy = files.filter((f) => !f.endsWith('.py'));
  const pyFiles = files.filter((f) => f.endsWith('.py'));
  if (pyFiles.length === 0) return { ok: false, reason: 'fix-changes-no-capture-host-python' };

  const units = [];
  for (const f of pyFiles) {
    const src = gitShow(task.parentCommit, f, REPO);
    if (src == null) return { ok: false, reason: `source-added-by-fix: ${f}` };
    const lines = src.split('\n');
    const info = allDefs(src);
    if (!info) return { ok: false, reason: `unparseable-source: ${f}` };
    const regions = [];
    for (const [a, b] of oldSideRanges(task, f)) {
      const enclosing = info.spans.filter((d) => d.start <= a && b <= d.end).sort((x, y) => y.depth - x.depth)[0];
      if (enclosing) regions.push([enclosing.start, enclosing.end]);
      else regions.push([Math.max(1, a - WINDOW), Math.min(lines.length, b + WINDOW)]);
    }
    if (info.headerEnd > 0) regions.push([1, Math.min(info.headerEnd, 40)]);
    regions.sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const r of regions) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1] + 2) last[1] = Math.max(last[1], r[1]);
      else merged.push([...r]);
    }
    units.push({ file: f, lines, merged, total: lines.length });
  }

  let text = '';
  let chars = 0;
  for (const u of units) {
    let block = `FILE ${u.file} (${u.total} lines; only the parts you may change are shown)\n\`\`\`python\n`;
    let prev = 0;
    for (const [a, b] of u.merged) {
      if (a > prev + 1) block += `# ---- lines ${prev + 1}-${a - 1} not shown ----\n`;
      block += `${u.lines.slice(a - 1, b).join('\n')}\n`;
      prev = b;
    }
    if (prev < u.total) block += `# ---- lines ${prev + 1}-${u.total} not shown ----\n`;
    block += '\`\`\`\n\n';
    chars += block.length;
    text += block;
  }
  if (chars > EDIT_BUDGET) return { ok: false, reason: `context-exceeds-budget: ${chars} chars` };
  return { ok: true, text, chars, files: units.map((u) => u.file), nonPyAlsoChanged: nonPy, regions: units.reduce((n, u) => n + u.merged.length, 0), shown: units.map((u) => u.file) };
}

function editPrompt(task, ctx) {
  return `You repair a defect in Python source. You edit by exact search and replace.

DEFECT REPORT
${(task.defect || '').slice(0, 2600)}

EVIDENCE
${(task.evidence || '').slice(0, 1400)}

THE TESTS THAT MUST PASS AFTER YOUR FIX (you cannot see them; they currently fail)
${(task.failToPass || []).slice(0, 12).join('\n')}

SOURCE AT THE DEFECTIVE COMMIT — the regions you may change
${ctx.text}
ANSWER FORMAT — nothing else, no prose, no explanation. One or more blocks:

### EDIT <file path>
<<<<<<< SEARCH
<lines copied EXACTLY from the source above, enough to be unique>
=======
<the replacement lines>
>>>>>>> REPLACE

Rules: copy the SEARCH lines character for character, including indentation. Never put a \`# ---- lines … not shown ----\` marker inside a block. To add a function, SEARCH for a nearby line and REPLACE it with itself plus the new code. Keep every signature compatible.`;
}

function parseEdits(content) {
  const out = [];
  const re = /#{2,4}\s*EDIT\s+([^\n]+)\n+<<<<<<<\s*SEARCH\s*\n([\s\S]*?)\n?=======\s*\n([\s\S]*?)\n?>>>>>>>\s*REPLACE/g;
  for (const m of content.matchAll(re)) out.push({ file: m[1].trim().replace(/^[`'"]|[`'"]$/g, ''), search: m[2], replace: m[3] });
  return out;
}

function applyEdits(extract, edits) {
  const norm = (l) => l.replace(/\s+$/, '');
  const applied = [];
  for (const e of edits) {
    if (/# ---- lines \d+-\d+ not shown ----/.test(e.search)) return { ok: false, reason: 'search-block-contains-elision' };
    const rel = e.file.replace(/^capture-host\//, '');
    const abs = path.join(extract, 'capture-host', rel);
    if (!fs.existsSync(abs)) return { ok: false, reason: `edit-names-unknown-file: ${e.file}` };
    const src = fs.readFileSync(abs, 'utf8');
    const sLines = e.search.split('\n').map(norm);
    while (sLines.length && sLines[sLines.length - 1] === '') sLines.pop();
    if (sLines.length === 0) return { ok: false, reason: 'search-block-empty' };
    const fLines = src.split('\n');
    const hits = [];
    for (let i = 0; i + sLines.length <= fLines.length; i++) {
      let ok = true;
      for (let k = 0; k < sLines.length; k++)
        if (norm(fLines[i + k]) !== sLines[k]) {
          ok = false;
          break;
        }
      if (ok) hits.push(i);
    }
    if (hits.length === 0) return { ok: false, reason: 'search-block-not-found' };
    if (hits.length > 1) return { ok: false, reason: 'search-block-ambiguous' };
    const rLines = e.replace.split('\n');
    while (rLines.length && rLines[rLines.length - 1] === '') rLines.pop();
    const next = [...fLines.slice(0, hits[0]), ...rLines, ...fLines.slice(hits[0] + sLines.length)].join('\n');
    const check = spawnSync('python3', ['-I', '-c', 'import ast,sys;ast.parse(sys.stdin.read())'], { input: next, encoding: 'utf8' });
    if (check.status !== 0) return { ok: false, reason: 'edited-file-unparseable' };
    fs.writeFileSync(abs, next);
    applied.push(`${e.file} @${hits[0] + 1}+${sLines.length}`);
  }
  return { ok: true, applied };
}

// CONTROL 3 (mode=edit) — applying only the fix's python hunks must green the oracle. A task that
// needs a shell, YAML or JSON change too is outside what a python patch can reach, and scoring it
// would charge the solver for a defect it was never shown.
function pythonOnlySuffices(task, row) {
  const ora = oracleArgv(task);
  const diff = execFileSync('git', ['diff', `${task.parentCommit}..${task.fixCommit}`, '--', 'capture-host/*.py', ':!capture-host/tests'], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (diff.trim() === '') {
    row.reason = 'fix-changes-no-capture-host-python';
    return false;
  }
  const dir = extractAt(task.parentCommit, task.testFiles, task.fixCommit);
  try {
    const ap = spawnSync('patch', ['-p1', '-s', '-d', dir], { input: diff, encoding: 'utf8' });
    if (ap.status !== 0) {
      row.reason = 'fix-hunks-do-not-apply';
      return false;
    }
    const after = runOracle(dir, ora.argv);
    row.control3 = after.status;
    if (after.status !== 0) {
      row.reason = 'python-only-fix-is-not-enough';
      return false;
    }
    return true;
  } finally {
    rm(dir);
  }
}

// ---------- model ----------
async function ask(text) {
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: text }],
    stream: false,
    think: false,
    keep_alive: '30m',
    options: { temperature: 0.2, num_ctx: NUM_CTX, num_predict: NUM_PREDICT }
  };
  const t0 = Date.now();
  const res = await fetch(`${ENDPOINT}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const j = await res.json();
  return {
    content: j.message?.content ?? '',
    ms: Date.now() - t0,
    evalCount: j.eval_count ?? null,
    promptEvalCount: j.prompt_eval_count ?? null
  };
}

function parseAnswer(content, shown) {
  const out = [];
  const re = /#{2,4}\s*FUNCTION\s+([^\s:]+)\s*::\s*([A-Za-z0-9_.]+)[^\n]*\n+```(?:python|py)?\n([\s\S]*?)```/g;
  for (const m of content.matchAll(re)) out.push({ file: m[1].trim(), qual: m[2].trim(), code: m[3] });
  if (out.length === 0) {
    const blocks = [...content.matchAll(/```(?:python|py)?\n([\s\S]*?)```/g)];
    if (blocks.length === 1 && shown.length === 1) {
      const [file, qual] = shown[0].split(' :: ');
      out.push({ file, qual, code: blocks[0][1], inferred: true });
    }
  }
  return out;
}

// ---------- splice ----------
function reindent(code, indent) {
  const lines = code.replace(/\s+$/, '').split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return null;
  const have = lines[i].match(/^\s*/)[0].length;
  if (have === indent) return lines.slice(i).join('\n');
  if (have > indent) {
    const cut = have - indent;
    return lines
      .slice(i)
      .map((l) => (l.startsWith(' '.repeat(cut)) ? l.slice(cut) : l.replace(/^\s+/, ' '.repeat(indent))))
      .join('\n');
  }
  const pad = ' '.repeat(indent - have);
  return lines
    .slice(i)
    .map((l) => (l.trim() === '' ? l : pad + l))
    .join('\n');
}

function splice(extract, patches, names) {
  const applied = [];
  for (const p of patches) {
    const rel = p.file.replace(/^capture-host\//, '');
    const abs = path.join(extract, 'capture-host', rel);
    if (!fs.existsSync(abs)) return { ok: false, reason: `patch-names-unknown-file: ${p.file}` };
    const src = fs.readFileSync(abs, 'utf8');
    const sp = pySpans(src, [...new Set([p.qual, p.qual.split('.').pop(), ...names])]);
    if (!sp.ok) return { ok: false, reason: sp.reason };
    const hit = sp.spans.find((s) => s.qual === p.qual) || sp.spans.find((s) => s.qual.endsWith(`.${p.qual}`) || s.name === p.qual.split('.').pop());
    if (!hit) return { ok: false, reason: `patch-names-unknown-definition: ${p.qual}` };
    const lines = src.split('\n');
    const indent = lines[hit.start - 1].match(/^\s*/)[0].length;
    const body = reindent(p.code, indent);
    if (body == null) return { ok: false, reason: 'patch-body-empty' };
    const next = [...lines.slice(0, hit.start - 1), ...body.split('\n'), ...lines.slice(hit.end)].join('\n');
    const check = spawnSync('python3', ['-I', '-c', 'import ast,sys;ast.parse(sys.stdin.read())'], { input: next, encoding: 'utf8' });
    if (check.status !== 0) return { ok: false, reason: 'patched-file-unparseable' };
    fs.writeFileSync(abs, next);
    applied.push(`${p.file} :: ${hit.qual}`);
  }
  return { ok: true, applied };
}

// ---------- oracle ----------
function extractAt(rev, testFiles, testRev) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbench-'));
  execSync(`git -C ${REPO} archive ${rev} capture-host | tar -x -C ${dir}`, { stdio: 'pipe' });
  if (testRev) {
    for (const tf of testFiles) {
      const src = gitShow(testRev, tf, REPO);
      if (src == null) throw new Error(`test file absent at ${testRev}: ${tf}`);
      const abs = path.join(dir, tf);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, src);
    }
  }
  return dir;
}

// The oracle's input is an ARRAY of test ids; `oracle.cmd` is a shell-quoted view of it (the
// unquoted join that preceded it split a parametrized id on its spaces and ran over nothing).
// `oracle.ids` is the truth where the set carries it; a set built before it falls back to the
// per-granularity source, and either way the reconstruction is asserted against the stored string.
function oracleArgv(task) {
  const ids =
    Array.isArray(task.oracle.ids) && task.oracle.ids.length
      ? task.oracle.ids
      : task.oracle.granularity === 'ids'
        ? task.failToPass
        : (task.testFiles || []).map((f) => f.replace(/^capture-host\//, ''));
  const idsAreStored = Array.isArray(task.oracle.ids) && task.oracle.ids.length > 0;
  return {
    argv: ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', ...ids],
    cmdMatches: cmdIdsOf(task.oracle.cmd).join('\u0000') === ids.join('\u0000'),
    idsAreStored,
    n: ids.length
  };
}

// The reader half of the quoting, so this runner can check a `cmd` it did not write.
function cmdIdsOf(cmd) {
  const words = [];
  let i = 0;
  let cur = null;
  while (i < cmd.length) {
    const c = cmd[i];
    if (/\s/.test(c)) {
      if (cur !== null) {
        words.push(cur);
        cur = null;
      }
      i += 1;
    } else if (c === "'") {
      cur = cur ?? '';
      i += 1;
      while (i < cmd.length && cmd[i] !== "'") {
        cur += cmd[i];
        i += 1;
      }
      i += 1;
    } else if (c === '"') {
      cur = cur ?? '';
      i += 1;
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === '\\' && i + 1 < cmd.length && '"\\$`'.includes(cmd[i + 1])) {
          cur += cmd[i + 1];
          i += 2;
        } else {
          cur += cmd[i];
          i += 1;
        }
      }
      i += 1;
    } else if (c === '\\' && i + 1 < cmd.length) {
      cur = (cur ?? '') + cmd[i + 1];
      i += 2;
    } else {
      cur = (cur ?? '') + c;
      i += 1;
    }
  }
  if (cur !== null) words.push(cur);
  const head = ['python3', '-m', 'pytest', '-q'];
  return head.every((h, k) => words[k] === h) ? words.slice(head.length) : [];
}

function runOracle(dir, argv) {
  const res = spawnSync('python3', argv, {
    cwd: path.join(dir, 'capture-host'),
    encoding: 'utf8',
    timeout: PYTEST_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
  });
  const tail = `${res.stdout || ''}${res.stderr || ''}`.slice(-1200);
  return { status: res.status, timedOut: res.error?.code === 'ETIMEDOUT' || res.status === null, tail };
}

const rm = (d) => {
  try {
    fs.rmSync(d, { recursive: true, force: true });
  } catch {}
};

// ---------- main ----------
async function main() {
  const bench = JSON.parse(fs.readFileSync(BENCH, 'utf8'));
  let tasks = bench.tasks;
  if (ONLY) tasks = tasks.filter((t) => t.key === ONLY);
  else if (HALF !== 'all') tasks = tasks.filter((t) => t.half === HALF);
  if (LIMIT > 0) tasks = tasks.slice(0, LIMIT);

  log(
    `mode ${MODE} · bench ${bench.commit} · ${bench.tasks.length} tasks · running ${tasks.length} · ${CONTROLS_ONLY ? 'controls only' : APPLY_CONTROL ? 'scoring-path control (fix hunks applied)' : SPLICE_CONTROL ? 'headroom (fix spliced)' : `model ${MODEL}`}`
  );
  const sink = OUT ? fs.createWriteStream(OUT, { flags: 'a' }) : null;
  const rows = [];

  for (const [i, task] of tasks.entries()) {
    const row = { key: task.key, pr: task.pr, half: task.half, at: new Date().toISOString() };
    let dir = null;
    try {
      const ctx = MODE === 'edit' ? buildEditContext(task) : buildContext(task);
      if (!ctx.ok && !APPLY_CONTROL) {
        row.outcome = 'excluded';
        row.reason = ctx.reason;
      } else {
        row.ctxExcluded = ctx.ok ? null : ctx.reason;
        row.ctxChars = ctx.chars;
        row.contextTruncated = ctx.truncated;
        row.definitionsElided = ctx.definitionsElided;
        row.localisedBy = ctx.localisedBy;
        row.shown = ctx.shown;

        const ora = oracleArgv(task);
        row.oracleIds = ora.n;
        row.oracleCmdStringMatches = ora.cmdMatches;

        // CONTROL 1 — the fix commit's sources must PASS the oracle.
        dir = extractAt(task.fixCommit, task.testFiles, null);
        const atFix = runOracle(dir, ora.argv);
        rm(dir);
        dir = null;
        // CONTROL 2 — the untouched parent, with the fix's tests, must FAIL.
        dir = extractAt(task.parentCommit, task.testFiles, task.fixCommit);
        const atParent = runOracle(dir, ora.argv);
        row.controls = { atFix: atFix.status, atParent: atParent.status };
        if (atFix.status !== 0 || atParent.status === 0 || atFix.timedOut || atParent.timedOut) {
          row.outcome = 'excluded';
          row.reason = `control-violation: atFix=${atFix.status} atParent=${atParent.status}`;
          row.tail = atParent.tail.slice(-300);
        } else if (MODE === 'edit' && !pythonOnlySuffices(task, row)) {
          row.outcome = 'excluded';
          row.reason = row.reason || 'python-only-fix-is-not-enough';
        } else if (CONTROLS_ONLY) {
          row.outcome = 'control-ok';
        } else if (APPLY_CONTROL) {
          const diff = execFileSync('git', ['diff', `${task.parentCommit}..${task.fixCommit}`, '--', 'capture-host/*.py', ':!capture-host/tests'], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });
          row.diffBytes = diff.length;
          if (diff.trim() === '') {
            row.outcome = 'apply-no';
            row.reason = 'fix-changes-no-capture-host-python';
          } else {
            const ap = spawnSync('patch', ['-p1', '-s', '-d', dir], { input: diff, encoding: 'utf8' });
            if (ap.status !== 0) {
              row.outcome = 'apply-no';
              row.reason = `patch-refused: ${(ap.stdout || ap.stderr || '').slice(0, 120)}`;
            } else {
              const after = runOracle(dir, ora.argv);
              row.oracleStatus = after.status;
              row.outcome = after.status === 0 ? 'apply-yes' : 'apply-no';
              if (after.status !== 0) {
                row.reason = after.timedOut ? 'oracle-timeout' : 'python-only-fix-is-not-enough';
                row.tail = after.tail.slice(-300);
              }
            }
          }
        } else if (SPLICE_CONTROL) {
          const patches = [];
          for (const label of ctx.shown) {
            const [file, qual] = label.split(' :: ');
            const src = gitShow(task.fixCommit, file, REPO);
            if (src == null) {
              patches.length = 0;
              row.reason = `headroom-file-absent-at-fix: ${file}`;
              break;
            }
            const sp = pySpans(src, [qual, qual.split('.').pop()]);
            if (!sp.ok) {
              patches.length = 0;
              row.reason = sp.reason;
              break;
            }
            const hit = (sp.spans || []).find((x) => x.qual === qual);
            if (!hit) {
              patches.length = 0;
              row.reason = `headroom-definition-absent-at-fix: ${qual}`;
              break;
            }
            patches.push({
              file,
              qual,
              code: src
                .split('\n')
                .slice(hit.start - 1, hit.end)
                .join('\n')
            });
          }
          if (patches.length === 0) {
            row.outcome = 'headroom-no';
            row.reason = row.reason || 'headroom-nothing-to-splice';
          } else {
            const sp2 = splice(dir, patches, ctx.names);
            if (!sp2.ok) {
              row.outcome = 'headroom-no';
              row.reason = sp2.reason;
            } else {
              const after = runOracle(dir, ora.argv);
              row.oracleStatus = after.status;
              row.outcome = after.status === 0 ? 'headroom-yes' : 'headroom-no';
              if (after.status !== 0) {
                row.reason = after.timedOut ? 'oracle-timeout' : 'fix-touches-code-not-shown';
                row.tail = after.tail.slice(-300);
              }
            }
          }
        } else {
          const ans = await ask(MODE === 'edit' ? editPrompt(task, ctx) : prompt(task, ctx));
          row.modelMs = ans.ms;
          row.evalCount = ans.evalCount;
          row.promptEvalCount = ans.promptEvalCount;
          const patches = MODE === 'edit' ? parseEdits(ans.content) : parseAnswer(ans.content, ctx.shown);
          row.patchCount = patches.length;
          if (patches.length === 0) {
            row.outcome = 'fail';
            row.reason = 'unparseable-response';
            row.sample = ans.content.slice(0, 220);
          } else {
            const sp = MODE === 'edit' ? applyEdits(dir, patches) : splice(dir, patches, ctx.names);
            if (!sp.ok) {
              row.outcome = 'fail';
              row.reason = sp.reason;
            } else {
              row.applied = sp.applied;
              const after = runOracle(dir, ora.argv);
              row.oracleStatus = after.status;
              row.outcome = after.status === 0 ? 'pass' : 'fail';
              if (after.status !== 0) {
                row.reason = after.timedOut ? 'oracle-timeout' : 'oracle-red';
                row.tail = after.tail.slice(-300);
              }
            }
          }
        }
      }
    } catch (err) {
      row.outcome = 'error';
      row.reason = String(err.message || err).slice(0, 200);
    } finally {
      if (dir) rm(dir);
    }
    rows.push(row);
    if (sink) sink.write(`${JSON.stringify(row)}\n`);
    log(`${i + 1}/${tasks.length} ${task.half} ${task.key} → ${row.outcome}${row.reason ? ` (${row.reason})` : ''}${row.modelMs ? ` ${(row.modelMs / 1000).toFixed(0)}s` : ''}`);
  }

  const tally = (pred) => rows.filter(pred).length;
  const sum = {
    tasks: rows.length,
    pass: tally((r) => r.outcome === 'pass'),
    fail: tally((r) => r.outcome === 'fail'),
    excluded: tally((r) => r.outcome === 'excluded'),
    error: tally((r) => r.outcome === 'error'),
    controlOk: tally((r) => r.outcome === 'control-ok'),
    headroomYes: tally((r) => r.outcome === 'headroom-yes'),
    applyYes: tally((r) => r.outcome === 'apply-yes'),
    applyNo: tally((r) => r.outcome === 'apply-no'),
    headroomNo: tally((r) => r.outcome === 'headroom-no'),
    controlViolations: tally((r) => (r.reason || '').startsWith('control-violation')),
    dev: { pass: tally((r) => r.half === 'dev' && r.outcome === 'pass'), scored: tally((r) => r.half === 'dev' && (r.outcome === 'pass' || r.outcome === 'fail')) },
    heldout: { pass: tally((r) => r.half === 'heldout' && r.outcome === 'pass'), scored: tally((r) => r.half === 'heldout' && (r.outcome === 'pass' || r.outcome === 'fail')) },
    excludedReasons: rows.filter((r) => r.outcome === 'excluded').reduce((a, r) => ((a[r.reason.split(':')[0]] = (a[r.reason.split(':')[0]] || 0) + 1), a), {})
  };
  log('SUMMARY', JSON.stringify(sum));
  if (sink) sink.end();
  // A run writes its result beside the log it was given, never into a tracked file.
  if (OUT) fs.writeFileSync(`${OUT}.summary.json`, `${JSON.stringify(sum, null, 2)}\n`);
  const v = benchVerdict(sum, { commit: headCommit(), bench: BENCH, out: OUT });
  console.log(JSON.stringify(v));
  return v.status === 'PASS' ? 0 : 1;
}

// ---------- the run as ONE tepna.verdict/1 object ----------
/* The criterion is pre-stated, and it is deliberately NOT the solver's score. A score is a
   measurement; a threshold read off the data it judges is UNKNOWN under the contract. What this
   runner DECIDES is whether the harness that produced the score is sound — every task that reached
   a decision passed both controls, the fix's own sources green against the oracle and the untouched
   parent red. The score rides along in `result`, where a reader can see it without it deciding
   anything.
     PASS          no control violation among the tasks that reached a decision
     FAIL          at least one, so the numbers beside it describe a harness, not a solver
     UNDERPOWERED  every selected task was excluded before a decision
     NOT_RUN       no task matched the selection */
function headCommit() {
  try {
    return execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().slice(0, 12);
  } catch {
    return null;
  }
}

export function benchVerdict(sum, { commit = null, bench = null, out = '' } = {}) {
  const Verdict = createRequire(import.meta.url)(path.join(ROOT, 'verdict.js'));
  const decided = sum.pass + sum.fail + sum.controlOk + sum.headroomYes + sum.headroomNo + sum.applyYes + sum.applyNo;
  const excluded = sum.tasks - decided;
  const status = sum.tasks === 0 ? 'NOT_RUN' : sum.controlViolations > 0 ? 'FAIL' : decided === 0 ? 'UNDERPOWERED' : 'PASS';
  const reason =
    status === 'PASS'
      ? null
      : status === 'NOT_RUN'
        ? 'no task matched the selection'
        : status === 'FAIL'
          ? `${sum.controlViolations} task(s) violated a control — the fix's sources must pass the oracle and the parent's must fail it`
          : `0 of ${sum.tasks} selected task(s) reached a decision, and 1 is the minimum a verdict needs`;
  const v = Verdict.make({
    gate: 'defect-bench-solver',
    status,
    scope: 'internal',
    population: { checked: decided, eligible: sum.tasks, excluded },
    criterion: { name: 'control_violations', threshold: 0, unit: 'tasks', direction: 'lte' },
    // The contract: NOT_RUN examined nothing, so it measured nothing either.
    result: status === 'NOT_RUN' ? null : { ...sum },
    evidence: ['tools/defect-bench-solve.mjs', ...(bench ? [path.relative(ROOT, bench) || bench] : []), ...(out ? [out] : [])],
    reason,
    producedBy: {
      tool: 'tools/defect-bench-solve.mjs',
      commit,
      ...(commit ? {} : { commitReason: 'REPO is not a git checkout this run could read' })
    }
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`defect-bench-solve: verdict invalid under verdict.js — ${chk.errors.join(' | ')}`);
  return v;
}

/** The corpus-free summary the adoption gate's sample is built from: two tasks decided, one
 *  excluded, no control violated. It touches no benchmark file and calls no model. */
export function sampleSummary() {
  return {
    tasks: 3,
    pass: 1,
    fail: 1,
    excluded: 1,
    error: 0,
    controlOk: 0,
    headroomYes: 0,
    applyYes: 0,
    applyNo: 0,
    headroomNo: 0,
    controlViolations: 0,
    dev: { pass: 1, scored: 2 },
    heldout: { pass: 0, scored: 0 },
    excludedReasons: { 'no-definition-localised': 1 }
  };
}

// ---------- selftest ----------
function selftest() {
  let pass = 0;
  let fail = 0;
  const eq = (cond, label) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log(`  ✗ ${label}`);
    }
  };

  // the row's own words
  const names = namesFromRow({ defect: '`poll_loss()` drops a row when `census.tally` is empty', evidence: '`loss_audit`' });
  eq(names.includes('poll_loss'), 'namesFromRow keeps a backticked call, parens stripped');
  eq(names.includes('tally') && names.includes('census.tally'), 'namesFromRow keeps the bare name and its one-level qualifier');
  eq(!names.includes('drops'), 'namesFromRow takes only backticked tokens, not prose');
  eq(namesFromRow({ defect: '`a run of zeros`', evidence: '' }).length === 0, 'a backticked phrase is not an identifier');

  // the stored oracle command is a VIEW of an argv array
  const spaced = 'tests/test_mutation_diff.py::test_names[classify:an absent mutant was REFUTED]';
  eq(cmdIdsOf(`python3 -m pytest -q '${spaced}'`)[0] === spaced, 'cmdIdsOf round-trips an id that legally contains spaces');
  eq(cmdIdsOf(`python3 -m pytest -q ${spaced}`)[0] !== spaced, 'an UNQUOTED id does not round-trip — that is the defect the quoting fixed');
  eq(cmdIdsOf('pytest -q tests/t.py').length === 0, 'a command with a different head yields no ids rather than a guess');
  const ora = oracleArgv({
    oracle: { ids: ['tests/t.py::test_a', spaced], granularity: 'ids', cmd: `python3 -m pytest -q tests/t.py::test_a '${spaced}'` },
    testFiles: ['capture-host/tests/t.py']
  });
  eq(ora.cmdMatches && ora.n === 2 && ora.idsAreStored, 'oracleArgv reconstructs the stored command from the stored ids');
  eq(ora.argv.slice(0, 5).join(' ') === '-m pytest -q -p no:cacheprovider', 'oracleArgv disables the cache provider');

  // the two answer shapes
  const edits = parseEdits('## EDIT `capture-host/loss_audit.py`\n<<<<<<< SEARCH\nx = 1\n=======\nx = 2\n>>>>>>> REPLACE\n');
  eq(edits.length === 1 && edits[0].file === 'capture-host/loss_audit.py' && edits[0].replace === 'x = 2', 'parseEdits reads one SEARCH/REPLACE block');
  eq(parseEdits('here is some prose with no block').length === 0, 'parseEdits returns nothing rather than half a patch');
  const ans = parseAnswer('### FUNCTION capture-host/loss_audit.py :: audit.tally\n```python\ndef tally(self):\n    return 1\n```', []);
  eq(ans.length === 1 && ans[0].qual === 'audit.tally', 'parseAnswer reads a labelled definition');
  const inferred = parseAnswer('```python\ndef tally(self):\n    return 1\n```', ['capture-host/loss_audit.py :: audit.tally']);
  eq(inferred.length === 1 && inferred[0].inferred === true, 'a single unlabelled block is inferred only when a single definition was shown');
  eq(parseAnswer('```python\npass\n```', ['a :: b', 'c :: d']).length === 0, 'two definitions shown ⇒ an unlabelled block is ambiguous, so nothing is applied');

  // re-indentation, both directions
  eq(reindent('    def f():\n        return 1', 0) === 'def f():\n    return 1', 'reindent outdents a block to column 0');
  eq(reindent('def f():\n    return 1', 4) === '    def f():\n        return 1', 'reindent indents a block into a class body');
  eq(reindent('   \n  \n', 0) === null, 'an all-blank patch body is null, never an empty definition');

  // applying an edit to a real extract
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbench-selftest-'));
  try {
    fs.mkdirSync(path.join(dir, 'capture-host'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'capture-host', 'loss_audit.py'), 'def tally(rows):\n    return 0\n');
    const okEdit = applyEdits(dir, [{ file: 'capture-host/loss_audit.py', search: '    return 0', replace: '    return len(rows)' }]);
    eq(okEdit.ok && /return len\(rows\)/.test(fs.readFileSync(path.join(dir, 'capture-host', 'loss_audit.py'), 'utf8')), 'applyEdits rewrites the one matching span');
    const absent = applyEdits(dir, [{ file: 'capture-host/loss_audit.py', search: '    return 99', replace: '    return 1' }]);
    eq(!absent.ok && absent.reason === 'search-block-not-found', 'a search block that matches nothing refuses rather than guessing a site');
    const broken = applyEdits(dir, [{ file: 'capture-host/loss_audit.py', search: 'def tally(rows):', replace: 'def tally(rows:' }]);
    eq(!broken.ok && broken.reason === 'edited-file-unparseable', 'an edit that breaks the parse refuses before the oracle ever runs');
  } finally {
    rm(dir);
  }

  // the verdict
  const green = benchVerdict(sampleSummary(), { commit: '0123456789ab', bench: path.join(ROOT, 'audits/DEFECT-BENCHMARK.json') });
  eq(green.status === 'PASS' && green.population.checked === 2 && green.population.excluded === 1, 'a clean run is PASS over the tasks that reached a decision');
  eq(green.population.checked + green.population.excluded === green.population.eligible, 'checked + excluded = eligible');
  eq(green.criterion.name === 'control_violations' && green.criterion.threshold === 0, "the criterion is the harness's soundness, pre-stated");
  const red = benchVerdict({ ...sampleSummary(), controlViolations: 1 }, {});
  eq(red.status === 'FAIL' && typeof red.reason === 'string', 'one control violation fails the run and says why');
  eq(red.producedBy.commitReason != null, 'an unreadable checkout gives a commitReason rather than a fabricated sha');
  const none = benchVerdict({ ...sampleSummary(), tasks: 0, pass: 0, fail: 0, excluded: 0, dev: { pass: 0, scored: 0 }, heldout: { pass: 0, scored: 0 } }, {});
  eq(none.status === 'NOT_RUN', 'a selection that matched nothing examined nothing');
  const allExcluded = benchVerdict({ ...sampleSummary(), pass: 0, fail: 0, excluded: 3 }, {});
  eq(allExcluded.status === 'UNDERPOWERED', 'every task excluded ⇒ UNDERPOWERED, never a PASS over zero');

  // Phrased for tools/selftest-all.mjs's summary parser, which reads an assertion COUNT.
  console.log(fail === 0 ? `\n  all ${pass} selftests passed` : `\n  ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

if (argv.includes('--selftest')) {
  process.exit(selftest());
} else if (argv.includes('--verdict-sample')) {
  // The object ALONE on stdout — tools/verdict-adoption.mjs parses this.
  console.log(JSON.stringify(benchVerdict(sampleSummary(), { commit: headCommit(), bench: BENCH }), null, 2));
} else {
  process.exit(await main());
}
