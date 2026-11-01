/*
 * tools/mutation-draft-py.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE PYTHON LANE'S DRAFTER — a local model proposes the INPUT, and this harness decides everything
 * else. Owner order 2026-10-31 (board #2562, relayed by Kestrel): qwen must do useful work, with a
 * machine check on every draft.
 *
 * ── WHAT THE MODEL IS ASKED FOR, AND WHAT IT IS NEVER ASKED FOR ───────────────────────────────────
 * It is asked for ONE thing: a fixture — the python that builds a night folder and calls the function
 * under test. It is never asked for an expected value, never for a projection, and never for a
 * verdict. Those three come from running the REAL module and its MUTANT and diffing the two recorded
 * outputs (`diffPaths`, reused from the JS lane's `mutation-suite.mjs`). So a draft that reaches this
 * file's output has been machine-verified to discriminate the real code from a specific surviving
 * mutant, and every number in it is the real code's own recorded output.
 *
 * ⚠️ VERIFIED IS NOT ENDORSED. A projection can discriminate and still pin a BUG in place: the
 * assertion states what the code DOES, never what it SHOULD do. Every draft carries that warning in
 * its own docstring, and the model's prose rides along marked as model-written provenance.
 *
 * ── WHERE THE WORK COMES FROM ─────────────────────────────────────────────────────────────────────
 * `mutation-survivors.json`, read through `capture-host/mutation_diff.baseline_from_ledger` so the
 * selection has ONE definition: the same per-function baseline the `mutation (diff-scoped)` gate
 * inherits debt from (#4173). Nothing here re-implements that filter.
 *
 * ── THE RAILS ─────────────────────────────────────────────────────────────────────────────────────
 *   · NIGHT WINDOW. A model call outside 00:00–08:00 local refuses (owner constraint: `bge-m3` is the
 *     fleet's Rule 0 embedder and ollama holds one model at a time, so a 30B model during working
 *     hours slows every session's doc-search). `--dry-run` needs no window because it calls nothing.
 *   · `keep_alive: 30s` ON EVERY REQUEST, so bge-m3 comes back seconds after the last draft rather
 *     than after ollama's 30-minute default.
 *   · THE CANDIDATE RUNS IN A SUBPROCESS, under a fresh temp dir, with a timeout. It is generated
 *     code: it gets no repo write path and no network, and a crash is journalled, never repaired.
 *   · THE LOADED MODULE IS ASSERTED. A mutant run that silently imported the real module would
 *     report "does not discriminate" over a measurement that never happened — the runner compares
 *     `nightqc.__file__` against the file it meant to load and exits 3 if they differ.
 *   · APPEND, NEVER OVERWRITE. The drafts file keeps every earlier section byte-for-byte.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────────────────────────
 *   node tools/mutation-draft-py.mjs --selftest            # pure parts, no python, no model
 *   node tools/mutation-draft-py.mjs --dry-run --candidate <f.py>   # harness end to end, no model
 *   node tools/mutation-draft-py.mjs --limit 4             # night window only
 *   node tools/mutation-draft-py.mjs --verdict-sample      # the verdict object alone
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { diffPaths } from './mutation-suite.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CH = join(ROOT, 'capture-host');
const LEDGER = join(ROOT, 'mutation-survivors.json');
const STATE = join(ROOT, '.mutation-crawl', 'pydraft');
const DRAFTS = join(CH, 'tests', 'test_nightqc_mutation_drafts.py');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const log = (s) => process.stdout.write(s + '\n');

const LOCAL_HOST = 'http://127.0.0.1:11434';
const MODEL = opt('--model', 'qwen3-coder:30b');
const CTX = Number(opt('--ctx', '12288'));
const KEEP_ALIVE = opt('--keep-alive', '30s');
const ATTEMPTS = Number(opt('--attempts', '3'));
/* A greedy retry is a re-run, not a second try (the JS lane measured this), so each attempt samples
   differently. */
const SAMPLING = [{ temperature: 0 }, { temperature: 0.7, top_p: 0.8, top_k: 20 }, { temperature: 1.0, top_p: 0.95, top_k: 20 }];
const NIGHT_FROM = Number(opt('--window-from', '0'));
const NIGHT_TO = Number(opt('--window-to', '8'));
const RUN_TIMEOUT_MS = Number(opt('--run-timeout', '120')) * 1000;
const ZONES = ['UTC', 'America/New_York', 'Asia/Kolkata'];
const MAX_ASSERT_PATHS = 3;

/* ══ THE RUNNER ════════════════════════════════════════════════════════════════════════════════════
   Written to the scratch dir and executed with `-I`, so neither the cwd nor PYTHONPATH can inject a
   module (a stray `grp.py` in a scratch directory shadowed the stdlib during this unit's own build).
   The paths it needs arrive as argv. */
export const RUNNER_PY = `# generated by tools/mutation-draft-py.mjs — scratch, not a repo file
import json, os, sys, tempfile, textwrap, time, traceback
from pathlib import Path

MUT, CH, CAND, TZ = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
os.environ["TZ"] = TZ
time.tzset()
if MUT != "-":
    sys.path.insert(0, MUT)
sys.path.insert(1 if MUT != "-" else 0, CH)
sys.path.append(os.path.join(CH, "tests"))
try:
    import nightqc as N
    loaded = os.path.realpath(N.__file__)
    want = os.path.realpath(os.path.join(CH if MUT == "-" else MUT, "nightqc.py"))
    if loaded != want:
        print("@@ERROR@@the wrong nightqc loaded: " + loaded + " wanted " + want)
        raise SystemExit(3)
    import test_nightqc as H
    code = Path(CAND).read_text()
    g = {"N": N, "H": H, "json": json, "os": os, "Path": Path, "time": time}
    exec(compile("def _candidate(TMP, N, H):\\n" + textwrap.indent(code, "    "), "<candidate>", "exec"), g)
    TMP = Path(tempfile.mkdtemp(prefix="cand-", dir=os.environ.get("TEPNA_CAND_TMP") or None))
    res = g["_candidate"](TMP, N, H)
    print("@@RESULT@@" + json.dumps(res, default=str, sort_keys=True))
except SystemExit:
    raise
except BaseException:
    print("@@ERROR@@" + traceback.format_exc()[-900:])
    raise SystemExit(4)
`;

/* ══ PURE PARTS (all --selftest'd) ═════════════════════════════════════════════════════════════════ */

/** `[start, end)` over the source lines of a top-level `def <fn>(`. `null` when it is not there. */
export function functionSpan(lines, fn) {
  const start = lines.findIndex((l) => l.startsWith('def ' + fn + '('));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('def ') || lines[i].startsWith('class ')) {
      end = i;
      break;
    }
  }
  return [start, end];
}

/** The mutmut key `- <before> | + <after>` split into its two halves. `null` when it is not a key. */
export function splitKey(key) {
  const s = String(key || '');
  const at = s.indexOf(' | + ');
  if (!s.startsWith('- ') || at < 0) return null;
  return { before: s.slice(2, at), after: s.slice(at + 5) };
}

/** Every line index inside `[start,end)` whose text equals `before`, compared without indentation. */
export function locate(lines, span, before) {
  const want = String(before).trim();
  if (!span || !want) return [];
  const out = [];
  for (let i = span[0]; i < span[1]; i++) if (lines[i].trim() === want) out.push(i);
  return out;
}

/**
 * Why a recorded line does not match: `'edited'` or `'gone'`.
 *
 * The baseline pins the line's TEXT, so `locate` compares whole trimmed lines and misses a line that
 * merely GREW. Measured 2026-10-31 over the 30 open rows: `_span_reason = None` still occurs inside
 * `_span_reason = None if span else "..."`. Reporting that as deleted code would be a false claim
 * about the repo, and the two states owe different remedies — an edited line wants a re-recorded
 * mutant id, a deleted one wants the row withdrawn.
 */
export function whyAbsent(lines, span, before) {
  const want = String(before).trim();
  if (!span || !want) return 'gone';
  for (let i = span[0]; i < span[1]; i++) if (lines[i].includes(want)) return 'edited';
  return 'gone';
}

/** The mutant source: line `idx` becomes `after`, keeping the original line's own indentation. */
export function mutantSource(lines, idx, after) {
  const indent = lines[idx].match(/^\s*/)[0];
  const copy = lines.slice();
  copy[idx] = indent + String(after).trim();
  return copy.join('\n');
}

/** `.a[0].b` → `["a"][0]["b"]`, so a diff path can be written as python subscripts. */
export function pyAccess(path) {
  return String(path || '').replace(/\.([A-Za-z_$][\w$]*)/g, (_m, k) => '["' + k + '"]');
}

/** The value at a `diffPaths` path inside a recorded result. `{ ok, value }`. */
export function valueAt(obj, path) {
  let cur = obj;
  const s = String(path || '');
  let consumed = 0;
  for (const m of s.matchAll(/\.([A-Za-z_$][\w$]*)|\["([^"]*)"\]|\[(\d+)\]/g)) {
    if (m.index !== consumed) return { ok: false, value: null };
    consumed = m.index + m[0].length;
    const k = m[1] ?? m[2] ?? Number(m[3]);
    if (cur === null || typeof cur !== 'object' || !(k in cur)) return { ok: false, value: null };
    cur = cur[k];
  }
  if (consumed !== s.length) return { ok: false, value: null };
  return { ok: true, value: cur };
}

/** A python literal for a recorded JSON value — the expected side of every drafted assertion. */
export function pyLiteral(v) {
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'float("' + String(v) + '")';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(pyLiteral).join(', ') + ']';
  return (
    '{' +
    Object.entries(v)
      .map(([k, x]) => JSON.stringify(k) + ': ' + pyLiteral(x))
      .join(', ') +
    '}'
  );
}

/**
 * The decision, as a pure function of what was recorded. A draft is kept only when the real run
 * succeeded in every zone, every mutant run produced a result, and at least one path differs between
 * the real output and EVERY mutant sharing this key.
 *
 * ⚠️ A KEY WITH TWO OCCURRENCES NEEDS BOTH DEAD. `baseline_from_ledger` keeps a LIST per key because
 * two mutants in one function can share one diff, and the gate counts survivors by key — so a
 * fixture that kills one occurrence and not the other leaves the key surviving.
 */
export function decide(real, mutants, excluded = [], record = null) {
  if (!real || !real.ok) return { keep: false, why: 'the real run failed: ' + ((real && real.why) || 'no result') };
  if (!mutants.length) return { keep: false, why: 'no mutant was generated' };
  const bad = mutants.find((m) => !m.ok);
  if (bad) return { keep: false, why: 'a mutant run failed: ' + bad.why };
  const dead = new Set(excluded);
  let common = null;
  let droppedAll = false;
  for (const m of mutants) {
    const raw = diffPaths(real.result, m.result, { max: 60 })
      .map((d) => d.path)
      .filter((p) => p !== '');
    const paths = raw.filter((p) => !dead.has(p));
    if (raw.length && !paths.length) droppedAll = true;
    const set = new Set(paths);
    common = common === null ? set : new Set([...common].filter((p) => set.has(p)));
    if (!common.size) {
      return {
        keep: false,
        why: droppedAll
          ? 'every differing path is a control artefact (volatile between two runs, or sensitive to where the module file sits)'
          : 'the fixture does not discriminate every mutant on this key'
      };
    }
  }
  const against = record || real.result;
  const usable = [...common].filter((p) => valueAt(against, p).ok).slice(0, MAX_ASSERT_PATHS);
  if (!usable.length) return { keep: false, why: 'the differing paths do not resolve in the output the draft will assert on' };
  return { keep: true, paths: usable };
}

/**
 * THE CONTROL SET — every path a draft may NOT asserted on, measured rather than assumed.
 *
 * 🔴 WHY THIS EXISTS, MEASURED 2026-11-01 ON THIS TOOL'S FIRST DRY RUN. 26 of 26 survivors came back
 * "killed on `.system_files`" from one generic fixture, which is not a kill: `summarize` publishes a
 * scan of the box's managed files, and the scan finds its root from the module's own location. Every
 * mutant module sits in a scratch dir, so that field differs for EVERY mutant whatever the fixture
 * does. A harness that compares the repo's module against a module in /tmp measures its own plumbing.
 *
 * Two controls, both named, both run per fixture because the output shape is the fixture's:
 *   · VOLATILE — the same module in the same place, twice. Any path that moves between two runs of
 *     identical code cannot evidence a mutation.
 *   · LOCATION — the repo's module against a byte-identical copy in the scratch dir. Any path that
 *     moves is the copy's address, not the code's behaviour.
 */
export function controlPaths(scratchA, scratchB, inRepo) {
  const out = new Set();
  if (scratchA?.ok && scratchB?.ok) for (const d of diffPaths(scratchA.result, scratchB.result, { max: 60 })) out.add(d.path);
  if (scratchA?.ok && inRepo?.ok) for (const d of diffPaths(inRepo.result, scratchA.result, { max: 60 })) out.add(d.path);
  out.delete('');
  return [...out];
}

/** The hour rail. Pure so the selftest can state both sides of it. */
export function inNightWindow(hour, from = NIGHT_FROM, to = NIGHT_TO) {
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

/* ══ THE PYTHON SIDE ═══════════════════════════════════════════════════════════════════════════════ */

function scratch() {
  const d = mkdtempSync(join(tmpdir(), 'pydraft-'));
  writeFileSync(join(d, 'runner.py'), RUNNER_PY);
  return d;
}

function runCandidate(dir, mutDir, candFile, tz) {
  const r = spawnSync('python3', ['-I', join(dir, 'runner.py'), mutDir || '-', CH, candFile, tz], {
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    env: { ...process.env, TEPNA_CAND_TMP: dir }
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const hit = out.indexOf('@@RESULT@@');
  if (hit >= 0) {
    try {
      return { ok: true, result: JSON.parse(out.slice(hit + 10).split('\n')[0]) };
    } catch (e) {
      return { ok: false, why: 'the result was not JSON: ' + String(e.message).slice(0, 80) };
    }
  }
  const err = out.indexOf('@@ERROR@@');
  if (err >= 0)
    return {
      ok: false,
      why: out
        .slice(err + 9)
        .trim()
        .split('\n')
        .slice(-2)
        .join(' ')
        .slice(0, 220)
    };
  if (r.error) return { ok: false, why: 'python did not run: ' + r.error.message.slice(0, 120) };
  return { ok: false, why: 'no result and no error marker (exit ' + r.status + ')' };
}

/** The baseline, read through the gate's own filter so there is one definition of the selection. */
function baseline() {
  const py = [
    'import json, sys',
    'sys.path.insert(0, ' + JSON.stringify(CH) + ')',
    'import mutation_diff as M',
    'raw = json.load(open(' + JSON.stringify(LEDGER) + '))',
    'print(json.dumps(M.baseline_from_ledger(raw)))'
  ].join('; ');
  const r = spawnSync('python3', ['-I', '-c', py], { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error('the baseline could not be read through mutation_diff: ' + String(r.stderr || '').slice(-300));
  return JSON.parse(r.stdout);
}

/** The ledger rows behind one `module.py::function` identity, so a journal line can name its mutant. */
function rowsFor(ident) {
  const raw = JSON.parse(readFileSync(LEDGER, 'utf8'));
  return (raw.entries || []).filter(
    (e) =>
      e.lane === 'py' &&
      e.state === 'open' &&
      String(e.module || '')
        .split('/')
        .pop() +
        '::' +
        e.function ===
        ident
  );
}

/* ══ THE MODEL ═════════════════════════════════════════════════════════════════════════════════════ */

function promptFor(row, before, context) {
  return [
    'You write ONE pytest fixture body for the python function `nightqc.summarize(night_dir, devices, wear=None, writer_offset=None)`.',
    '',
    'GOAL: choose inputs that make this line of `summarize` MATTER. A mutation testing run changed',
    'the line and no existing test noticed. Your fixture must make the two versions behave differently.',
    '',
    '  the real line :  ' + before,
    '  the mutant    :  ' + (splitKey(row.key) || {}).after,
    '',
    'THE CODE AROUND IT:',
    '```python',
    context,
    '```',
    '',
    'HELPERS you may use (they are module-level in capture-host/tests/test_nightqc.py, reachable as `H.`):',
    '  H._cap(night, name, rows, header=None) -> path    writes a capture file with `rows` data lines',
    '  H._utime(path, epoch)                             sets a file mtime',
    '  H._stamp_epoch(stamp=...)                         the epoch of the standard 2026-07-19 22:00 stamp',
    '  H._devices()                                      two declared devices: H10 (ecg,acc,hr), Ring (spo2,ppg)',
    '  H._summarize_floating(night, devices, wear=None)  calls summarize with a declared writer offset',
    '  H._summarize(night, devices, wear=None)           the same, declared from the reader frame',
    '  N                                                 the nightqc module itself (N._MIN_SPAN_SEC = 300.0,',
    '                                                    N._SESSION_GAP_SEC = 3600.0)',
    '',
    'RULES:',
    '  · Write ONLY the body. It receives `TMP` (a fresh pathlib.Path), `N` and `H`, and must `return`',
    '    the dict that summarize gave back. `os` and `Path` are already imported.',
    '  · A capture file name looks like `Polar_H10_02849638_20260719220000_ECG.txt` —',
    '    `<vendor>_<model>_<device_id>_<YYYYMMDDHHMMSS>_<STREAM>.<ext>`.',
    '  · Build the night folder under TMP, e.g. `night = str(TMP / "2026-07-19"); os.makedirs(night)`.',
    '  · Assert NOTHING and print NOTHING. Do not invent an expected value: the harness records the',
    '    real output itself and compares it against the mutant.',
    '',
    'Reply with the python body inside one ```python fence and nothing else.'
  ].join('\n');
}

async function askLocal(prompt, attempt) {
  const res = await fetch(LOCAL_HOST + '/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      think: false,
      keep_alive: KEEP_ALIVE,
      options: { num_ctx: CTX, num_predict: 700, ...SAMPLING[Math.min(attempt, SAMPLING.length - 1)] }
    })
  });
  const j = await res.json();
  return j.response || '';
}

/** The fenced python body, or a named refusal. The model's reply is never trusted beyond this. */
export function parseFixture(reply) {
  const m = /```(?:python)?\s*\n([\s\S]*?)```/.exec(String(reply || ''));
  const body = m ? m[1] : '';
  if (!body.trim()) return { ok: false, why: 'no fenced python body in the reply' };
  if (!/\breturn\b/.test(body)) return { ok: false, why: 'the body returns nothing, so there is no output to compare' };
  if (/\bimport\s+(subprocess|socket|urllib|requests|shutil)\b/.test(body)) return { ok: false, why: 'the body reaches outside the fixture (refused unread)' };
  return { ok: true, body };
}

/**
 * Does the drafts file already hold a draft for this mutant?
 *
 * The file is APPEND-ONLY, so a second run over the same baseline would write a second copy of the
 * same test. Measured 2026-10-31: two runs left duplicate defs, `ruff` reded F811 twice and the mypy
 * count rose from 0 to 2 — a gate failure produced by the harness, not by a mutant.
 */
export function hasDraft(draftsText, slug) {
  return new RegExp('^def test_draft_' + slug + '\\(', 'm').test(String(draftsText || ''));
}

/* ══ RENDERING ═════════════════════════════════════════════════════════════════════════════════════ */

export function renderDraft(row, fixture, paths, real, note) {
  const slug = String(row.mutant)
    .replace(/[^\w]+/g, '_')
    .toLowerCase();
  const body = fixture
    .replace(/\bTMP\b/g, 'tmp_path')
    .replace(/\bH\._/g, '_')
    .replace(/\bN\./g, 'nightqc.')
    .replace(/^(\s*)return\s+/m, '$1s = ');
  /* `is`, NOT `==`, FOR THE THREE SINGLETONS — ruff's E711/E712 red `== None` and `== True`, and
     capture-host's gate runs ruff. The comparison is also the right one: these are identities. */
  const asserts = paths.map((p) => {
    const lit = pyLiteral(valueAt(real, p).value);
    const op = lit === 'None' || lit === 'True' || lit === 'False' ? ' is ' : ' == ';
    return '    assert s' + pyAccess(p) + op + lit;
  });
  return [
    '',
    '',
    'def test_draft_' + slug + '(tmp_path, _draft_utc):',
    '    """DRAFT — machine-verified to kill ' + row.mutant + '.',
    '',
    '    The mutant: `' + String(row.key).replace(/"""/g, '"') + '`',
    '    Recorded by #' + row.pr + '; survived every test in the suite until this fixture.',
    '',
    '    ⚠️ THIS ASSERTS WHAT THE CODE DOES, NOT WHAT IT SHOULD DO. Every value below is the real',
    "    module's own recorded output under TZ=UTC, and the projection is the harness's diff of the",
    "    real output against the mutant's — so it discriminates by construction and endorses nothing.",
    note ? '\n    Model-written provenance (unreviewed): ' + note.replace(/"""/g, '"') : null,
    '    """',
    body.replace(/^/gm, '    ').replace(/^\s+$/gm, ''),
    ...asserts
  ]
    .filter((l) => l !== null && l !== undefined)
    .join('\n');
}

const DRAFTS_HEADER = [
  '# tepna-capture — tests/test_nightqc_mutation_drafts.py',
  '# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0',
  '#',
  '# MACHINE-VERIFIED MUTATION DRAFTS — generated by `tools/mutation-draft-py.mjs`, appended never',
  '# overwritten. Each test below kills one survivor from `mutation-survivors.json`: a local model',
  "# proposed the fixture, and the harness recorded the real module's output and the mutant's and",
  "# kept only the fixtures whose outputs differ. Every expected value is the real code's own",
  '# recorded output.',
  '#',
  '# ⚠️ A DRAFT STATES BEHAVIOUR, NOT INTENT. One of these can pin a bug in place; read the docstring',
  '# before treating an assertion as a requirement.',
  'import os',
  'import time',
  '',
  'import pytest',
  '',
  'import nightqc  # noqa: F401  — the drafts reach the module through the test helpers below',
  '',
  'from test_nightqc import (  # noqa: F401',
  '    _cap,',
  '    _devices,',
  '    _stamp_epoch,',
  '    _summarize,',
  '    _summarize_floating,',
  '    _utime,',
  ')',
  '',
  '',
  '@pytest.fixture',
  'def _draft_utc():',
  '    """Pin the zone for a draft: CI runs UTC and the rig runs EDT.',
  '',
  '    Declared here rather than imported from test_nightqc._utc, because a test whose parameter is',
  '    named after an imported fixture shadows the import and ruff reds it (F811). The pin is the',
  '    whole body, so this states it rather than mirroring logic.',
  '    """',
  '    old_tz = os.environ.get("TZ")',
  '    os.environ["TZ"] = "UTC"',
  '    time.tzset()',
  '    try:',
  '        yield "UTC"',
  '    finally:',
  '        if old_tz is None:',
  '            os.environ.pop("TZ", None)',
  '        else:',
  '            os.environ["TZ"] = old_tz',
  '        time.tzset()',
  ''
].join('\n');

/**
 * `ruff format` over the generated file, through an interpreter that HAS ruff.
 *
 * A worktree carries no `.venv`, so a bare `python3` here is the absent-tool trap `check.sh`'s own
 * preflight exists for: ruff's missing-module exit is indistinguishable from a finding. This probes
 * the interpreters in order and SAYS which one answered, because an unformatted draft reds the
 * capture-host gate later and "could not look" must never read as "formatted".
 */
function rufffmt(file) {
  const cands = [process.env.PYTHON, join(CH, '.venv', 'bin', 'python'), 'python3'].filter(Boolean);
  for (const py of cands) {
    if (spawnSync(py, ['-c', 'import ruff'], { timeout: 60000 }).status !== 0) continue;
    const r = spawnSync(py, ['-m', 'ruff', 'format', file], { encoding: 'utf8', timeout: 120000 });
    if (r.status !== 0) return 'ruff format FAILED under ' + py + ': ' + String(r.stderr || '').slice(0, 200);
    return 'ruff format (' + py + '): ' + String(r.stdout || '').trim();
  }
  return '⚠ no interpreter on this PATH carries ruff, so the generated file is UNFORMATTED — an absent tool, not a pass; run `ruff format` before committing';
}

/* ══ THE KILL CHECK ════════════════════════════════════════════════════════════════════════════════
   The drafting loop proves discrimination by CALLING the function; this proves it through pytest, in
   the suite, the way the drafted test will actually run. Both halves are needed: the first decides
   what to write, the second decides whether what was written is a test.

   ONE PRIVATE COPY OF THE TREE, re-patched per mutant. Not a hardlink farm: a hardlinked copy shares
   the repo's inode, so writing `nightqc.py` through it would edit the checkout. And not `/tmp`, which
   is a separate device here — `cp -al` cannot cross it, and the box's tmpfs is shared with every other
   session's gate. */
const KILL_CACHE = join(process.env.HOME || ROOT, '.cache', 'tepna-pydraft');

function pytestIn(dir, target, timeoutS = 600) {
  const r = spawnSync('python3', ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', '-x', target], {
    cwd: dir,
    encoding: 'utf8',
    timeout: timeoutS * 1000
  });
  const out = ((r.stdout || '') + (r.stderr || '')).trim().split('\n');
  return { status: r.status, tail: out.slice(-2).join(' ').slice(0, 200) };
}

function verifyKills() {
  const ident = opt('--function', 'nightqc.py::summarize');
  const journal = join(STATE, ident.replace(/[^\w]+/g, '_') + '.jsonl');
  if (!existsSync(DRAFTS)) {
    log('✗ no drafts file at ' + DRAFTS.replace(ROOT + '/', '') + ' — draft first (a refusal, not an empty result)');
    process.exitCode = 2;
    return;
  }
  /* 🔴 THE JOURNAL IS APPEND-ONLY, SO IT OUTLIVES THE FILE. Its KEPT lines include drafts an earlier
     run wrote and a later run replaced — measured on this tool's own first kill check, which reported
     26 kills over a file holding 2 tests, because pytest exits NON-ZERO for "no tests collected" too
     and every absent draft read as a kill. The drafts FILE is the population; the journal only
     explains it. */
  const draftText = readFileSync(DRAFTS, 'utf8');
  const kept = [];
  for (const l of readFileSync(journal, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try {
      const r = JSON.parse(l);
      const slug = String(r.mutant)
        .replace(/[^\w]+/g, '_')
        .toLowerCase();
      if (r.v !== 'KEPT' || kept.some((k) => k.mutant === r.mutant)) continue;
      if (!draftText.includes('def test_draft_' + slug + '(')) continue;
      kept.push(r);
    } catch {
      /* a torn last line from a crash — skipped, never repaired */
    }
  }
  if (!kept.length) {
    log('✗ the journal holds no KEPT draft for ' + ident);
    process.exitCode = 2;
    return;
  }
  const srcFile = join(CH, ident.split('::')[0]);
  const lines = readFileSync(srcFile, 'utf8').split('\n');
  const span = functionSpan(lines, ident.split('::')[1]);
  const rows = rowsFor(ident);

  mkdirSync(KILL_CACHE, { recursive: true });
  const tree = join(KILL_CACHE, 'ch');
  spawnSync('rm', ['-rf', tree]);
  const cp = spawnSync('cp', ['-a', CH, tree], { encoding: 'utf8', timeout: 300000 });
  if (cp.status !== 0) {
    log('✗ the private tree could not be copied: ' + String(cp.stderr).slice(0, 200));
    process.exitCode = 2;
    return;
  }
  const realSrc = readFileSync(srcFile, 'utf8');
  const target = join(tree, 'nightqc.py');

  log('KILL CHECK — ' + kept.length + ' draft(s) through pytest, in a private copy of the tree\n');
  const green = pytestIn(tree, 'tests/' + DRAFTS.split('/').pop());
  log((green.status === 0 ? '  ✓' : '  ✗') + ' every draft passes against the real module — ' + green.tail);
  let killed = 0;
  const alive = [];
  for (const k of kept) {
    const row = rows.find((r) => r.mutant === k.mutant);
    const parts = row && splitKey(row.key);
    const occ = parts ? locate(lines, span, parts.before) : [];
    if (!occ.length) {
      alive.push({
        mutant: k.mutant,
        why:
          whyAbsent(lines, span, parts ? parts.before : '') === 'edited'
            ? 'the recorded line was EDITED since the mutant was recorded, so the mutant id no longer locates it'
            : "the recorded line is GONE from today's source"
      });
      continue;
    }
    const slug = String(k.mutant)
      .replace(/[^\w]+/g, '_')
      .toLowerCase();
    let diedOnEvery = true;
    let last = '';
    for (const idx of occ) {
      writeFileSync(target, mutantSource(lines, idx, parts.after));
      const r = pytestIn(tree, 'tests/' + DRAFTS.split('/').pop() + '::test_draft_' + slug);
      last = r.tail;
      /* EXIT 1 IS THE KILL, AND NOTHING ELSE IS. pytest exits 4 on a usage error and 5 when it
         collected nothing, so "non-zero" would count a test that never ran as a dead mutant. */
      if (r.status !== 1) diedOnEvery = false;
      if (r.status !== 1 && r.status !== 0) last = 'pytest exit ' + r.status + ' (it did not run the draft): ' + last;
    }
    writeFileSync(target, realSrc);
    if (diedOnEvery) {
      killed++;
      log('  ✓ ' + k.mutant + ' dies under its draft' + (occ.length > 1 ? ' at both occurrences' : ''));
    } else {
      alive.push({ mutant: k.mutant, why: 'the draft passes with the mutant in place: ' + last });
      log('  ✗ ' + k.mutant + ' SURVIVES its own draft — ' + last);
    }
  }
  const v = verdict({
    status: green.status === 0 && !alive.length ? 'PASS' : 'FAIL',
    checked: kept.length,
    eligible: kept.length,
    kept: killed,
    rejected: alive.length,
    gone: 0,
    evidence: [DRAFTS.replace(ROOT + '/', ''), journal.replace(ROOT + '/', '')],
    reason: green.status !== 0 ? 'a draft does not pass against the real module' : alive.length ? alive.length + ' draft(s) do not kill their mutant' : null,
    commit: headCommit()
  });
  if (v.status === 'FAIL') process.exitCode = 1;
  log('\nVERDICT (tepna.verdict/1): ' + JSON.stringify(v));
}

/* ══ MAIN ══════════════════════════════════════════════════════════════════════════════════════════ */

function verdict(o) {
  return {
    schema: 'tepna.verdict/1',
    gate: 'mutation-draft-py',
    status: o.status,
    scope: 'internal',
    population: { checked: o.checked, eligible: o.eligible, excluded: o.eligible - o.checked },
    criterion: { name: 'drafts_written_without_a_machine_check', threshold: 0, unit: 'drafts', direction: 'lte' },
    /* NOT_RUN examined nothing, so it measures nothing: the contract wants `result: null` there,
       not a row of zeros that reads like a measurement. */
    result: o.status === 'NOT_RUN' ? null : { kept: o.kept, rejected: o.rejected, gone: o.gone, alreadyDrafted: o.dup ?? 0, unverified: 0 },
    evidence: o.evidence,
    reason: o.reason ?? null,
    producedBy: { tool: 'tools/mutation-draft-py.mjs', commit: o.commit, ...(o.commit ? {} : { commitReason: 'not a git checkout' }) },
    at: new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  };
}

/* A REFUSAL IS A READING TOO. A caller that polls this tool must tell "it never looked" from "it
   looked and wrote nothing", and three prose lines cannot carry that. Both refusals print the
   NOT_RUN object and keep exit 2 — exit 1 stays reserved for a draft that failed its own check. */
export function refusalVerdict(reason, commit) {
  return verdict({
    status: 'NOT_RUN',
    checked: 0,
    eligible: 0,
    kept: 0,
    rejected: 0,
    gone: 0,
    evidence: ['tools/mutation-draft-py.mjs'],
    reason,
    commit
  });
}

function headCommit() {
  const r = spawnSync('git', ['-C', ROOT, 'rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

async function main() {
  if (has('--verdict-sample')) {
    log(
      JSON.stringify(
        verdict({
          status: 'NOT_RUN',
          checked: 0,
          eligible: 0,
          kept: 0,
          rejected: 0,
          gone: 0,
          evidence: ['tools/mutation-draft-py.mjs'],
          reason: 'the sample flag prints the shape and examines nothing',
          commit: headCommit()
        })
      )
    );
    return;
  }
  const dry = has('--dry-run');
  const candFile = opt('--candidate', '');
  if (!dry) {
    const hour = new Date().getHours();
    if (!inNightWindow(hour)) {
      log('✗ REFUSED — local hour ' + hour + ' is outside the ' + NIGHT_FROM + ':00–' + NIGHT_TO + ':00 night window.');
      log("  A 30B model evicts bge-m3, and bge-m3 is every session's Rule 0 search (owner, 2026-10-04).");
      log('  `--dry-run --candidate <f.py>` exercises the whole harness and calls no model.');
      log(JSON.stringify(refusalVerdict('local hour ' + hour + ' is outside the ' + NIGHT_FROM + ':00-' + NIGHT_TO + ':00 night window', headCommit())));
      process.exitCode = 2;
      return;
    }
  }
  const base = baseline();
  const ident = opt('--function', 'nightqc.py::summarize');
  const keys = base[ident];
  if (!keys) {
    log('✗ ' + ident + ' carries no open survivor in the baseline — nothing to draft (a refusal, not an empty result)');
    log(JSON.stringify(refusalVerdict(ident + ' carries no open survivor in the baseline', headCommit())));
    process.exitCode = 2;
    return;
  }
  const rows = rowsFor(ident);
  const srcFile = join(CH, ident.split('::')[0]);
  const lines = readFileSync(srcFile, 'utf8').split('\n');
  const span = functionSpan(lines, ident.split('::')[1]);
  if (!span) throw new Error('the function ' + ident + ' is not in ' + srcFile);

  const limit = Number(opt('--limit', '0')) || rows.length;
  const pick = rows.slice(0, limit);
  mkdirSync(STATE, { recursive: true });
  const journal = join(STATE, ident.replace(/[^\w]+/g, '_') + '.jsonl');
  const jrec = (r) => appendFileSync(journal, JSON.stringify({ at: new Date().toISOString(), model: dry ? 'dry-run' : MODEL, ...r }) + '\n');

  log('PY-LANE DRAFTING — ' + ident);
  log('  ' + rows.length + ' open survivor(s) in the baseline (' + Object.keys(keys).length + ' distinct key(s)); working ' + pick.length);
  log('  ' + (dry ? 'DRY RUN — no model call; the fixture comes from ' + candFile : 'model ' + MODEL + ' · keep_alive ' + KEEP_ALIVE + ' · ctx ' + CTX));
  log('  the model proposes the INPUT only; the projection and every expected value are recorded here.\n');

  const dir = scratch();
  const twinDir = join(dir, 'twin');
  mkdirSync(twinDir, { recursive: true });
  writeFileSync(join(twinDir, 'nightqc.py'), lines.join('\n'));
  const kept = [];
  const already = existsSync(DRAFTS) ? readFileSync(DRAFTS, 'utf8') : '';
  let rejected = 0;
  let gone = 0;
  let dup = 0;
  for (const row of pick) {
    const parts = splitKey(row.key);
    const tag = row.mutant.replace(/^.*__mutmut_/, '#') + '  ' + String(parts ? parts.before : row.key).slice(0, 58);
    const mslug = String(row.mutant)
      .replace(/[^\w]+/g, '_')
      .toLowerCase();
    if (hasDraft(already, mslug)) {
      jrec({ mutant: row.mutant, v: 'DUP', why: 'the drafts file already holds a draft for this mutant' });
      log('  ⊘ ' + tag);
      log('      a draft for this mutant is already in the file — appending a second copy would red ruff and mypy');
      dup++;
      continue;
    }
    if (!parts) {
      jrec({ mutant: row.mutant, v: 'UNREADABLE-KEY' });
      log('  ⊘ ' + tag + ' — the ledger key is not a mutmut diff');
      gone++;
      continue;
    }
    const occ = locate(lines, span, parts.before);
    if (!occ.length) {
      const state = whyAbsent(lines, span, parts.before);
      jrec({ mutant: row.mutant, v: 'GONE', state, why: 'the recorded line is ' + state + " in today's " + ident });
      log('  ⊘ ' + tag);
      log(
        state === 'edited'
          ? '      the recorded line was EDITED since #' + row.pr + ' recorded it — the text survives inside a longer line, so the mutant id no longer locates it'
          : "      the recorded line is GONE from today's source — this row inherits debt no run can reproduce"
      );
      gone++;
      continue;
    }
    const mutDirs = occ.map((idx, n) => {
      const d = join(dir, 'm' + row.mutant.replace(/[^\w]+/g, '_') + '_' + n);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'nightqc.py'), mutantSource(lines, idx, parts.after));
      return d;
    });

    let fixture = null;
    let note = '';
    let why = '';
    if (dry) {
      if (!candFile || !existsSync(candFile)) {
        log('✗ --dry-run needs --candidate <file.py>');
        process.exitCode = 2;
        return;
      }
      fixture = readFileSync(candFile, 'utf8');
      note = 'hand-written dry-run candidate, no model involved';
    } else {
      const ctxLines = lines.slice(Math.max(span[0], occ[0] - 14), Math.min(span[1], occ[0] + 8)).join('\n');
      for (let a = 0; a < ATTEMPTS && !fixture; a++) {
        let reply = '';
        try {
          reply = await askLocal(promptFor(row, parts.before, ctxLines), a);
        } catch (e) {
          log('✗ the local model is unreachable at ' + LOCAL_HOST + ' — stopping. No drafts are produced (a refusal, not an empty result).');
          log('  ' + String(e.message).slice(0, 140));
          return;
        }
        const p = parseFixture(reply);
        if (p.ok) {
          fixture = p.body;
          note = 'proposed by ' + MODEL + ' on attempt ' + (a + 1);
        } else why = p.why;
      }
      if (!fixture) {
        jrec({ mutant: row.mutant, v: 'NO-FIXTURE', why });
        log('  ✗ ' + tag + ' — ' + why);
        rejected++;
        continue;
      }
    }

    const cf = join(dir, 'cand.py');
    writeFileSync(cf, fixture);
    /* THE MUTANT IS COMPARED AGAINST AN UNMUTATED COPY IN THE SAME KIND OF PLACE, never against the
       repo's own module — see `controlPaths`. The repo run still happens, because the drafted test
       will run there and its recorded values must be the ones it will see. */
    const twin = runCandidate(dir, twinDir, cf, 'UTC');
    const twin2 = runCandidate(dir, twinDir, cf, 'UTC');
    const inRepo = runCandidate(dir, null, cf, 'UTC');
    const muts = mutDirs.map((d) => runCandidate(dir, d, cf, 'UTC'));
    const control = controlPaths(twin, twin2, inRepo);
    if (!inRepo.ok) {
      jrec({ mutant: row.mutant, v: 'NO-KILL', why: 'the fixture failed against the repo module: ' + inRepo.why });
      log('  ✗ ' + tag);
      log('      the fixture failed against the repo module: ' + inRepo.why);
      rejected++;
      continue;
    }
    const d = decide(twin, muts, control, inRepo.result);
    if (!d.keep) {
      jrec({ mutant: row.mutant, v: 'NO-KILL', why: d.why });
      log('  ✗ ' + tag);
      log('      ' + d.why);
      rejected++;
      continue;
    }
    /* A zone-dependent projection would pass here and fail in CI, which runs UTC while the rig runs
       EDT. The draft declares UTC either way; this records whether the value is zone-free. */
    const zoneStable = ZONES.every((tz) => {
      const r = runCandidate(dir, null, cf, tz);
      return r.ok && d.paths.every((p) => JSON.stringify(valueAt(r.result, p).value) === JSON.stringify(valueAt(inRepo.result, p).value));
    });
    jrec({ mutant: row.mutant, v: 'KEPT', paths: d.paths, zoneStable, occurrences: occ.length, controlDropped: control.length });
    kept.push({
      row,
      text: renderDraft(
        row,
        fixture,
        d.paths,
        inRepo.result,
        note + (zoneStable ? '; the asserted value is the same in all three zones' : '; the asserted value is zone-dependent, so the draft declares UTC')
      )
    });
    log('  ✓ ' + tag);
    log('      killed on ' + d.paths.join(', ') + (occ.length > 1 ? '  (both occurrences of this key)' : '') + '  [' + control.length + ' control path(s) dropped]');
  }

  if (kept.length) {
    const head = existsSync(DRAFTS) ? readFileSync(DRAFTS, 'utf8') : DRAFTS_HEADER;
    const section = '\n\n# ── appended ' + new Date().toISOString().slice(0, 16) + ' · ' + (dry ? 'dry run' : 'model ' + MODEL + ' ctx ' + CTX) + ' ──\n';
    /* Exactly ONE trailing newline: `ruff format --check` reds a file that ends without one, and
       capture-host's gate runs it. The draft texts open with two blank lines, so the append side
       stays correct whichever way the previous section ended. */
    const text = (head + section + kept.map((k) => k.text).join('\n')).replace(/\n*$/, '\n');
    writeFileSync(DRAFTS, text);
    log('\n  ' + kept.length + ' draft(s) → ' + DRAFTS.replace(ROOT + '/', ''));
    log('  ' + rufffmt(DRAFTS));
    log('  NEXT: `python3 -m pytest -q tests/test_nightqc_mutation_drafts.py` in capture-host, then the full check.sh.');
  } else log('\n  no draft survived the machine check — nothing was written');

  const v = verdict({
    status: pick.length === 0 ? 'NOT_RUN' : 'PASS',
    /* `checked` is what the harness actually RAN: a gone line and a mutant that already has a draft
       were both excluded before any fixture ran, so §🧾's checked + excluded = eligible holds. */
    checked: pick.length - gone - dup,
    eligible: pick.length,
    kept: kept.length,
    rejected,
    gone,
    dup,
    evidence: ['mutation-survivors.json', 'tools/mutation-draft-py.mjs', journal.replace(ROOT + '/', '')],
    reason: pick.length === 0 ? 'the baseline named no survivor to work' : null,
    commit: headCommit()
  });
  log('\nVERDICT (tepna.verdict/1): ' + JSON.stringify(v));
}

/* ══ SELFTEST ══════════════════════════════════════════════════════════════════════════════════════ */

function selftest() {
  let n = 0;
  const eq = (a, b, what) => {
    n++;
    const A = JSON.stringify(a);
    const B = JSON.stringify(b);
    if (A !== B) {
      log('✗ ' + what + ': ' + A + ' !== ' + B);
      process.exitCode = 1;
    }
  };
  const src = ['def f(a):', '    x = None', '    if x < 3:', '        x = None', '    return x', '', 'def g():', '    x = None'];
  eq(functionSpan(src, 'f'), [0, 6], 'functionSpan stops at the next top-level def');
  eq(functionSpan(src, 'nope'), null, 'functionSpan refuses a function it cannot find');
  eq(splitKey('- a = None | + a = ""'), { before: 'a = None', after: 'a = ""' }, 'splitKey splits a mutmut key');
  eq(splitKey('a = None'), null, 'splitKey refuses a non-key');
  eq(locate(src, [0, 6], 'x = None'), [1, 3], 'locate finds both occurrences inside the span only');
  eq(locate(src, [0, 6], 'absent'), [], 'locate returns no occurrence for a line that is gone');
  eq(locate(['x = None if span else "r"'], [0, 1], 'x = None'), [], 'locate does not match a line that merely grew');
  eq(whyAbsent(['x = None if span else "r"'], [0, 1], 'x = None'), 'edited', 'whyAbsent calls a grown line edited');
  eq(whyAbsent(['y = 1'], [0, 1], 'x = None'), 'gone', 'whyAbsent calls an absent line gone');
  eq(hasDraft('def test_draft_a_b(tmp_path, _draft_utc):\n', 'a_b'), true, 'hasDraft sees a draft already in the file');
  eq(hasDraft('def test_draft_a_bc(tmp_path):\n', 'a_b'), false, 'hasDraft does not match a longer slug');
  eq(hasDraft('', 'a_b'), false, 'hasDraft reads an absent file as no draft');
  eq(mutantSource(src, 2, 'if x <= 3:').split('\n')[2], '    if x <= 3:', 'mutantSource keeps the original indentation');
  eq(pyAccess('.devices[0].streams.ecg'), '["devices"][0]["streams"]["ecg"]', 'pyAccess writes python subscripts');
  eq(valueAt({ a: [{ b: 2 }] }, '.a[0].b'), { ok: true, value: 2 }, 'valueAt walks a diff path');
  eq(valueAt({ a: 1 }, '.a.b'), { ok: false, value: null }, 'valueAt refuses a path that does not resolve');
  eq(valueAt({ a: 1 }, '.a junk'), { ok: false, value: null }, 'valueAt refuses a path it cannot fully consume');
  eq(pyLiteral({ a: [null, true, 1.5, 'x'] }), '{"a": [None, True, 1.5, "x"]}', 'pyLiteral writes a python literal');
  eq(inNightWindow(0), true, 'the window includes its first hour');
  eq(inNightWindow(8), false, 'the window excludes its last hour');
  eq(inNightWindow(20), false, 'the window excludes the working evening');
  eq(inNightWindow(23, 22, 2), true, 'a wrapping window includes an hour before midnight');
  eq(inNightWindow(1, 22, 2), true, 'a wrapping window includes an hour after midnight');
  eq(decide({ ok: false, why: 'boom' }, []).keep, false, 'decide refuses when the real run failed');
  eq(decide({ ok: true, result: { a: 1 } }, []).keep, false, 'decide refuses with no mutant');
  eq(decide({ ok: true, result: { a: 1 } }, [{ ok: false, why: 'x' }]).keep, false, 'decide refuses when a mutant run failed');
  eq(decide({ ok: true, result: { a: 1 } }, [{ ok: true, result: { a: 1 } }]).keep, false, 'decide refuses a fixture that discriminates nothing');
  eq(decide({ ok: true, result: { a: 1 } }, [{ ok: true, result: { a: 2 } }]), { keep: true, paths: ['.a'] }, 'decide keeps a discriminating fixture');
  eq(
    decide({ ok: true, result: { a: 1, b: 1 } }, [
      { ok: true, result: { a: 2, b: 1 } },
      { ok: true, result: { a: 1, b: 2 } }
    ]).keep,
    false,
    'decide refuses when no single path kills BOTH occurrences of one key'
  );
  eq(
    decide({ ok: true, result: { a: 1, b: 1 } }, [
      { ok: true, result: { a: 2, b: 2 } },
      { ok: true, result: { a: 2, b: 1 } }
    ]),
    { keep: true, paths: ['.a'] },
    'decide keeps the path common to every occurrence'
  );
  eq(
    decide({ ok: true, result: { a: 1, v: 1 } }, [{ ok: true, result: { a: 1, v: 2 } }], ['.v']).why,
    'every differing path is a control artefact (volatile between two runs, or sensitive to where the module file sits)',
    'decide refuses a kill that lives only on a control path'
  );
  eq(decide({ ok: true, result: { a: 1, v: 1 } }, [{ ok: true, result: { a: 2, v: 2 } }], ['.v']), { keep: true, paths: ['.a'] }, 'decide keeps the real path and drops the control path beside it');
  eq(decide({ ok: true, result: { a: 1 } }, [{ ok: true, result: { a: 2 } }], [], { b: 1 }).keep, false, 'decide refuses when the differing path is absent from the output the draft asserts on');
  eq(
    controlPaths({ ok: true, result: { a: 1, v: 1 } }, { ok: true, result: { a: 1, v: 2 } }, { ok: true, result: { a: 1, w: 1, v: 1 } }),
    ['.v', '.w'],
    'controlPaths unions the volatile and the location-sensitive paths'
  );
  eq(controlPaths({ ok: false }, { ok: false }, { ok: false }), [], 'controlPaths examines nothing when no control ran');
  eq(parseFixture('```python\nreturn 1\n```').ok, true, 'parseFixture takes a fenced body');
  eq(parseFixture('no fence here').why, 'no fenced python body in the reply', 'parseFixture names an unfenced reply');
  eq(parseFixture('```python\nx = 1\n```').why, 'the body returns nothing, so there is no output to compare', 'parseFixture refuses a body that returns nothing');
  eq(parseFixture('```python\nimport socket\nreturn 1\n```').ok, false, 'parseFixture refuses a body reaching outside the fixture');
  const dr = renderDraft({ mutant: 'nightqc.x_summarize__mutmut_1', key: '- a | + b', pr: 3188 }, 'night = str(TMP / "n")\nreturn H._summarize(night, H._devices())', ['.ok'], { ok: true }, 'note');
  eq(/def test_draft_nightqc_x_summarize__mutmut_1\(tmp_path, _draft_utc\):/.test(dr), true, 'renderDraft names the mutant in the test name');
  eq(/    s = _summarize\(night, _devices\(\)\)/.test(dr), true, 'renderDraft binds the result and drops the helper prefix');
  eq(/    assert s\["ok"\] is True/.test(dr), true, 'renderDraft asserts the recorded value at the differing path');
  const dr2 = renderDraft({ mutant: 'm2', key: '- a | + b', pr: 1 }, 'return H._summarize("n", [])', ['.files'], { files: 6 }, null);
  eq(/    assert s\["files"\] == 6/.test(dr2), true, 'renderDraft compares a number with ==, never with is');
  eq(/^\n\ndef test_draft_m2/.test(dr2), true, 'renderDraft opens with the two newlines that give a joined file its blank lines');
  eq(/tmp_path \/ "n"/.test(dr), true, "renderDraft hands the fixture pytest's own tmp_path");
  const rv = refusalVerdict('local hour 20 is outside the 0:00-8:00 night window', 'abcdef12');
  eq(rv.status, 'NOT_RUN', 'a refusal reports NOT_RUN, never a zero result that reads as a measurement');
  eq(rv.result, null, 'a NOT_RUN refusal carries result null');
  eq(rv.population, { checked: 0, eligible: 0, excluded: 0 }, 'a refusal examined nothing and says so');
  eq(typeof rv.reason === 'string' && rv.reason.length > 0, true, 'every non-PASS verdict names its reason');
  /* THE COUNT IS THE HELPER'S, NEVER A LITERAL — `selftest-all.mjs` reads this line as this tool's
     assertion total, and a typed figure would keep printing after an assertion was deleted. */
  log(process.exitCode ? 'SELFTEST FAILED after ' + n + ' assertions' : n + ' assertions passed');
}

if (has('--selftest')) selftest();
else if (has('--verify-kills')) verifyKills();
else await main();
