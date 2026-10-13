// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/* ════════════════════════════════════════════════════════════════════════
   tools/defect-bench.mjs — the frozen benchmark of past defects, built

       node tools/defect-bench.mjs --build              # enumerate, classify, write the set
       node tools/defect-bench.mjs --build --prove 8    # …and prove up to 8 more candidates
       node tools/defect-bench.mjs --build --prove 200 --reprove   # discard the proof cache and run it again
       node tools/defect-bench.mjs --build --json       # the verdict alone
       node tools/defect-bench.mjs --selftest
       node tools/defect-bench.mjs --verdict-sample

   Brief: `briefs/DEFECT-BENCHMARK-2026-10-12-BRIEF.md`. The tasks are defects this repo already
   found and fixed, so nobody writes a task by hand and nobody grades a model on a puzzle the fleet
   never met.

   ── THE POPULATION IS THE STATE CELL, NOT THE LINE ──────────────────────────────────────────────
   A closed residue row is one whose STATE cell reads exactly `fixed #N`. The brief's §population
   counted 367 closed rows and 295 fix PRs; a line-wide `fixed #\d+` match gives that number and it
   over-counts, because a row still OPEN can quote another row's closure in its defect or evidence
   text. Measured 2026-10-12 on 569 rows: 344 rows and 275 PRs by the state cell, 372 rows and 296
   PRs line-wide. The state cell is the field `docs-ledger` check8b validates, so it is the one with
   a gate behind it.

   ── THE ORACLE IS A SET OF TEST IDS, NOT A FILE'S EXIT CODE ─────────────────────────────────────
   A task is valid only when named tests FAIL on the parent commit and PASS on the fix commit. Both
   halves are run here, from `git archive` extracts rather than a checkout: a worktree would register
   in the shared repo and a `git checkout` would step on another session's tree (CLAUDE.md §👥.2).

   The first version of this tool graded the whole test FILE and threw away 38 of 91 proven-eligible
   candidates as `no-pass-at-fix`. Measured 2026-10-12: 19 of those 38 showed the SAME ~31 failures
   at the parent and at the fix, and the other 19 failed on tests that assert a property of the
   surrounding repository — a git-tracked file mode, a shebang on a root script, a module outside
   `capture-host/`. None of that is the task; all of it is what a bare extract cannot carry. So the
   oracle is the DIFFERENCE between the two id sets, and the background is counted and published
   beside each task instead of deciding it.

   `pytest`'s exit code still separates two things prose confuses:
     · 1 — tests FAILED and pytest named them. The ids that fail at the parent and not at the fix
           are the task; ids failing at both ends are background.
     · 2 — collection ERRORED, so pytest named no id. The fix's test cannot even import against the
           parent's source, which is a real task with the whole file as its grade — kept, with
           `granularity: 'file'`, and only when the file is green at the fix.
     · 0 — the file passes on the parent already. The fix changed no behaviour the test can see
           (a comment, a doc, a rename), so there is nothing to solve. Excluded.

   Every proven pair is then re-run on the ids ALONE at both commits. A test that fails only inside
   its file is order-dependent, and grading a solver on it would score the order rather than the fix.

   ── ONE ORACLE LANE IS IMPLEMENTED, AND THE REST ARE NAMED EXCLUSIONS ───────────────────────────
   `capture-host/tests/test_*.py` runs as `python3 -m pytest -q <files>` inside the extract, in about
   a second for most files. The JS lanes are excluded BY NAME rather than silently: `tests/dex-tests.js`
   is one shared file behind a 755-group runner, so its narrowest check is a group filter this tool
   cannot derive from a diff yet (`oracle-shared-suite`), and a `tests/*.mjs` oracle needs the whole
   tree plus `node_modules` in the extract (`oracle-js-tree`). An unimplemented lane that reports
   itself is a measurement; one that drops out of the count is the §🧾 "examined nothing" failure.

   ── THE SPLIT IS STATED BEFORE ANYTHING IS SCORED ───────────────────────────────────────────────
   `sha256(row key)[0:8]` as an integer: even → `dev`, odd → `heldout`. It depends on the key alone,
   so it is stable across rebuilds and across anyone who recomputes it, and no tuning pass can move a
   task between halves by changing the tool. Nobody tunes a hook, a skill or a prompt against the
   held-out half.
   ════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const Verdict = createRequire(import.meta.url)('../verdict.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DEFAULT = 'audits/DEFECT-BENCHMARK.json';
const SCHEMA = 'tepna.defect-bench/1';
const SPLIT_RULE = 'sha256(key)[0:8] as int — even → dev, odd → heldout';
const PYTEST_TIMEOUT_MS = 300000;

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd: cwd || ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error('git ' + args.slice(0, 2).join(' ') + ' failed: ' + String(r.stderr || '').slice(0, 200));
  return r.stdout;
};

/* ── 1 · THE ROWS ────────────────────────────────────────────────────────────────────────────────── */
export function closedRows(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.startsWith('| 20')) continue;
    const c = line
      .split('|')
      .slice(1, 7)
      .map((s) => s.trim());
    if (c.length < 6) continue;
    const m = /^fixed #(\d+)$/.exec(c[5]);
    if (!m) continue;
    out.push({ key: c[0], logged: c[1], source: c[2], defect: c[3], evidence: c[4], pr: Number(m[1]) });
  }
  return out;
}

/* The over-count the brief's population carries, measured rather than asserted. */
export function lineWideRows(text) {
  return String(text)
    .split('\n')
    .filter((l) => l.startsWith('| 20') && /fixed #\d+/.test(l)).length;
}

export function half(key) {
  return parseInt(createHash('sha256').update(String(key)).digest('hex').slice(0, 8), 16) % 2 === 0 ? 'dev' : 'heldout';
}

/* ── 2 · THE FIX COMMIT ──────────────────────────────────────────────────────────────────────────── */
export function prIndex(logText) {
  const by = new Map();
  for (const line of String(logText).split('\n')) {
    if (!line) continue;
    const i = line.indexOf('\0');
    if (i < 0) continue;
    const sha = line.slice(0, i);
    const m = /\(#(\d+)\)$/.exec(line.slice(i + 1).trim());
    if (!m) continue;
    const n = Number(m[1]);
    by.set(n, (by.get(n) || []).concat(sha));
  }
  return by;
}

const PYTEST_RE = /^capture-host\/tests\/test_[a-z0-9_]+\.py$/;

export function oracleFor(files) {
  const py = files.filter((f) => PYTEST_RE.test(f));
  if (py.length) return { kind: 'capture-host-pytest', testFiles: py };
  if (files.includes('tests/dex-tests.js')) return { kind: 'oracle-shared-suite', testFiles: ['tests/dex-tests.js'] };
  const mjs = files.filter((f) => /^tests\/.+\.(mjs|js)$/.test(f));
  if (mjs.length) return { kind: 'oracle-js-tree', testFiles: mjs };
  const other = files.filter((f) => f.startsWith('tests/') || f.startsWith('capture-host/tests/'));
  if (other.length) return { kind: 'oracle-other-test-path', testFiles: other };
  return { kind: 'no-test-in-fix', testFiles: [] };
}

/* ── 3 · THE PROOF — fail on the parent, pass on the fix ─────────────────────────────────────────── */
function extract(sha, paths, dir) {
  mkdirSync(dir, { recursive: true });
  const ar = spawnSync('git', ['archive', sha].concat(paths), { cwd: ROOT, maxBuffer: 1 << 30 });
  if (ar.status !== 0) throw new Error('git archive ' + sha + ' failed');
  const tar = spawnSync('tar', ['-x', '-C', dir], { input: ar.stdout, maxBuffer: 1 << 30 });
  if (tar.status !== 0) throw new Error('tar -x failed for ' + sha);
}

/* The short summary pytest prints under `-q` is the machine-readable half of the run: one
   `FAILED <id>` or `ERROR <id>` line per failure. Parsed here rather than tailed, because the tail
   holds three lines and a file can fail thirty (§4b). */
export function failingIds(stdout) {
  const seen = new Set();
  for (const line of String(stdout).split('\n')) {
    /* NOT `\S+`: a parametrized id carries its parameters, and a parameter carries spaces —
       `test_an_unusable_version_report_is_absence_never_a_sha[echo '']`. Cut at pytest's own ` - `
       separator instead, which is what divides the id from the message. A `\S+` cut selected
       `…_a_sha[echo` and pytest answered "no tests ran", which read as a task that does not
       reproduce (4 tasks, measured 2026-10-12). */
    const m = /^(?:FAILED|ERROR) (.+?)(?: - .*)?$/.exec(line);
    if (m) seen.add(m[1]);
  }
  return [...seen];
}

/* The oracle is the DIFFERENCE, not the file: the ids that fail on the parent and do not fail on the
   fix. An id failing at both ends is background — a test the bare extract cannot satisfy at either
   commit (one that reads a git-tracked file mode, or a path outside `capture-host/`) — and counting
   it against the task would throw the task away for a property of this harness. */
export function failToPass(parentIds, fixIds) {
  const f = new Set(fixIds);
  return parentIds.filter((id) => !f.has(id));
}

function runPytest(dir, targets) {
  const r = spawnSync('python3', ['-m', 'pytest', '-q', '-p', 'no:cacheprovider'].concat(targets.map((f) => f.replace(/^capture-host\//, ''))), {
    cwd: join(dir, 'capture-host'),
    encoding: 'utf8',
    timeout: PYTEST_TIMEOUT_MS,
    maxBuffer: 1 << 26
  });
  /* The CODE, read before any pipe (§4b): a `| tail` here would report tail's exit and the verdict
     would describe nothing. `null` is the timeout — spawnSync kills and leaves status null. */
  const stdout = String(r.stdout || '');
  return {
    code: r.status,
    timedOut: r.status === null,
    ids: r.status === null ? [] : failingIds(stdout),
    tail: stdout.trim().split('\n').slice(-3).join(' | ')
  };
}

export function proveTask(task, { keep } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'defect-bench-'));
  const fail = (reason, atParent, atFix, extra) => ({ ok: false, reason, atParent: atParent || null, atFix: atFix || null, ...(extra || {}) });
  try {
    const parentDir = join(base, 'parent');
    const fixDir = join(base, 'fix');
    extract(task.parentCommit, ['capture-host'], parentDir);
    extract(task.fixCommit, ['capture-host'], fixDir);
    /* The fix's TEST files on the parent's SOURCE — the task as a solver meets it. */
    extract(task.fixCommit, task.testFiles, parentDir);
    const atParent = runPytest(parentDir, task.testFiles);
    if (atParent.timedOut) return fail('oracle-timeout-at-parent', atParent, null);
    if (atParent.code === 0) return fail('no-fail-at-parent', atParent, null);
    if (atParent.code !== 1 && atParent.code !== 2) return fail('parent-run-error', atParent, null);
    const atFix = runPytest(fixDir, task.testFiles);
    if (atFix.timedOut) return fail('oracle-timeout-at-fix', atParent, atFix);

    /* Collection ERRORED on the parent, so pytest named no ids and the file itself is the oracle:
       the fix's test cannot even import against the parent's source. A solver's job then includes
       making it importable, and the grade is the whole file green. */
    if (atParent.code === 2) {
      if (atFix.code !== 0) return fail('file-not-green-at-fix', atParent, atFix);
      return {
        ok: true,
        reason: null,
        atParent,
        atFix,
        granularity: 'file',
        failToPass: task.testFiles.map((f) => f.replace(/^capture-host\//, '')),
        backgroundAtParent: 0,
        at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
      };
    }

    const ids = failToPass(atParent.ids, atFix.ids);
    const background = atParent.ids.length - ids.length;
    if (!ids.length) return fail('no-pass-at-fix', atParent, atFix, { backgroundAtParent: background });

    /* The pair re-run on the ids ALONE. A test that only fails inside its file is order-dependent,
       and grading a solver on it would score the order rather than the fix. */
    const isoFix = runPytest(fixDir, ids);
    if (isoFix.timedOut) return fail('oracle-timeout-at-fix', atParent, isoFix, { backgroundAtParent: background });
    if (isoFix.code !== 0) return fail('ids-not-green-at-fix', atParent, isoFix, { backgroundAtParent: background });
    const isoParent = runPytest(parentDir, ids);
    if (isoParent.timedOut) return fail('oracle-timeout-at-parent', isoParent, isoFix, { backgroundAtParent: background });
    if (isoParent.code === 0) return fail('ids-pass-alone-at-parent', isoParent, isoFix, { backgroundAtParent: background });
    return {
      ok: true,
      reason: null,
      atParent: isoParent,
      atFix: isoFix,
      granularity: 'ids',
      failToPass: ids,
      backgroundAtParent: background,
      at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    };
  } finally {
    if (!keep) rmSync(base, { recursive: true, force: true });
  }
}

/* ── 4 · THE BUILD ───────────────────────────────────────────────────────────────────────────────── */
function build() {
  const outPath = join(ROOT, opt('--out', OUT_DEFAULT));
  const proveN = Number(opt('--prove', '0')) || 0;
  const residue = readFileSync(join(ROOT, 'briefs/RESIDUE.md'), 'utf8');
  const rows = closedRows(residue);
  const allRows = residue.split('\n').filter((l) => l.startsWith('| 20')).length;
  const by = prIndex(git(['log', '--first-parent', '--format=%H%x00%s', 'HEAD']));
  const commit = git(['rev-parse', 'HEAD']).trim();

  /* THE SWEEP IS PAID ONCE. A failed proof is cached beside a passed one: without that, a re-run
     re-pays the ~6 s per excluded candidate for an answer the tool already has, and the 2026-10-12
     sweep over 138 candidates cost 13 minutes of which 10 were exclusions. `--reprove` discards the
     cache when the oracle itself changes. */
  const prior = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : null;
  const priorProof = new Map(Object.entries((prior && prior.proofs) || {}));
  if (has('--reprove')) priorProof.clear();

  const candidates = [];
  const excluded = [];
  for (const r of rows) {
    const shas = by.get(r.pr) || [];
    if (!shas.length) {
      excluded.push({ key: r.key, pr: r.pr, reason: 'no-commit-for-pr' });
      continue;
    }
    if (shas.length > 1) {
      excluded.push({ key: r.key, pr: r.pr, reason: 'ambiguous-commit-for-pr' });
      continue;
    }
    const fixCommit = shas[0];
    const files = git(['show', '--name-only', '--format=', '-m', '--first-parent', fixCommit])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const o = oracleFor(files);
    if (o.kind !== 'capture-host-pytest') {
      excluded.push({ key: r.key, pr: r.pr, reason: o.kind });
      continue;
    }
    candidates.push({
      key: r.key,
      pr: r.pr,
      half: half(r.key),
      fixCommit: fixCommit.slice(0, 12),
      parentCommit: git(['rev-parse', fixCommit + '^'])
        .trim()
        .slice(0, 12),
      oracle: { kind: o.kind, cmd: 'python3 -m pytest -q ' + o.testFiles.map((f) => f.replace(/^capture-host\//, '')).join(' ') },
      testFiles: o.testFiles,
      srcFiles: files.filter((f) => !f.startsWith('capture-host/tests/') && !f.startsWith('tests/')),
      defect: r.defect,
      evidence: r.evidence
    });
  }

  /* Cheapest first — fewest test files, then fewest changed files — so a bounded --prove run buys
     the most tasks per minute and a later run continues where this one stopped. */
  candidates.sort((a, b) => a.testFiles.length - b.testFiles.length || a.srcFiles.length - b.srcFiles.length || a.key.localeCompare(b.key));

  const tasks = [];
  const proofs = {};
  let ran = 0;
  for (const c of candidates) {
    let pr = priorProof.get(c.key);
    if (!pr) {
      if (ran >= proveN) {
        excluded.push({ key: c.key, pr: c.pr, reason: 'unproven' });
        continue;
      }
      ran++;
      const p = proveTask(c);
      pr = {
        ok: p.ok,
        reason: p.reason,
        granularity: p.granularity || null,
        failToPass: p.failToPass || null,
        backgroundAtParent: typeof p.backgroundAtParent === 'number' ? p.backgroundAtParent : null,
        atParent: p.atParent ? p.atParent.tail : null,
        atFix: p.atFix ? p.atFix.tail : null,
        at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
      };
      console.log(`  ${p.ok ? '✓' : '✗'} ${c.key} — ${p.ok ? (p.failToPass || []).length + ' id(s) fail-then-pass, ' + p.backgroundAtParent + ' background' : p.reason}`);
    }
    proofs[c.key] = pr;
    if (pr.ok) {
      /* The grade a solver is held to: these ids green, and the background no larger than it was. */
      const ids = pr.failToPass || c.testFiles.map((f) => f.replace(/^capture-host\//, ''));
      tasks.push({
        ...c,
        oracle: { ...c.oracle, granularity: pr.granularity || 'file', cmd: 'python3 -m pytest -q ' + ids.join(' ') },
        failToPass: ids,
        backgroundAtParent: pr.backgroundAtParent,
        proof: pr
      });
    } else
      excluded.push({
        key: c.key,
        pr: c.pr,
        reason: pr.reason,
        backgroundAtParent: typeof pr.backgroundAtParent === 'number' ? pr.backgroundAtParent : undefined,
        atParent: pr.atParent,
        atFix: pr.atFix
      });
  }

  const set = {
    schema: SCHEMA,
    _doc: 'A frozen benchmark of past defects. Tasks are residue rows closed `fixed #N` whose fix test FAILS on the parent commit and PASSES on the fix commit. Built by tools/defect-bench.mjs; brief briefs/DEFECT-BENCHMARK-2026-10-12-BRIEF.md.',
    builtAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    commit: commit.slice(0, 12),
    splitRule: SPLIT_RULE,
    population: { residueRows: allRows, closedRows: rows.length, closedRowsLineWide: lineWideRows(residue), closedPRs: new Set(rows.map((r) => r.pr)).size, candidates: candidates.length },
    tasks,
    excluded,
    proofs
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(set, null, 2) + '\n');

  const v = verdictFor(set, commit);
  const ok = Verdict.validate(v);
  if (!ok.ok) throw new Error('verdict invalid: ' + ok.errors.join('; '));
  if (has('--json')) console.log(JSON.stringify(v, null, 2));
  else {
    console.log(`\ndefect-bench: ${tasks.length} task(s) proven · ${excluded.length} excluded · ${candidates.length} candidate(s) over ${rows.length} closed row(s)`);
    const byReason = {};
    for (const e of excluded) byReason[e.reason] = (byReason[e.reason] || 0) + 1;
    for (const k of Object.keys(byReason).sort()) console.log(`  ${String(byReason[k]).padStart(4)}  ${k}`);
    console.log(`  split: ${tasks.filter((t) => t.half === 'dev').length} dev / ${tasks.filter((t) => t.half === 'heldout').length} heldout — ${SPLIT_RULE}`);
    console.log(`  → ${opt('--out', OUT_DEFAULT)}`);
    console.log(JSON.stringify(v));
  }
  return v.status === 'PASS' || v.status === 'SHORTFALL' ? 0 : 1;
}

/* Every INCLUDED task carries a proven fail-then-pass pair. The criterion is that property and not a
   task count: a count target would be a threshold read off the data it judges (§🧾). SHORTFALL is the
   honest status while the proof sweep is incomplete — the set is valid and not yet whole. */
export function verdictFor(set, commit) {
  const unproven = set.tasks.filter((t) => !(t.proof && t.proof.ok)).length;
  const pending = set.excluded.filter((e) => e.reason === 'unproven').length;
  return Verdict.make({
    gate: 'defect-bench-build',
    status: unproven > 0 ? 'FAIL' : pending > 0 ? 'SHORTFALL' : set.tasks.length ? 'PASS' : 'UNDERPOWERED',
    population: { checked: set.tasks.length, eligible: set.population.closedRows, excluded: set.excluded.length },
    criterion: { name: 'included_tasks_without_a_proven_fail_then_pass_pair', threshold: 0, unit: 'tasks', direction: 'lte' },
    result: {
      tasks: set.tasks.length,
      unproven,
      pendingProof: pending,
      candidates: set.population.candidates,
      dev: set.tasks.filter((t) => t.half === 'dev').length,
      heldout: set.tasks.filter((t) => t.half === 'heldout').length
    },
    evidence: ['tools/defect-bench.mjs', OUT_DEFAULT, 'briefs/DEFECT-BENCHMARK-2026-10-12-BRIEF.md'],
    reason:
      unproven > 0 ? unproven + ' included task(s) carry no proof' : pending > 0 ? pending + ' candidate(s) await the proof sweep' : set.tasks.length ? null : 'no task proved a fail-then-pass pair',
    producedBy: { tool: 'tools/defect-bench.mjs', commit: commit ? commit.slice(0, 12) : null }
  });
}

const DIRECT = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (DIRECT && has('--verdict-sample')) {
  const v = verdictFor({ tasks: [], excluded: [], population: { closedRows: 0, candidates: 0 } }, null);
  v.status = 'NOT_RUN';
  v.result = null;
  v.reason = 'sample only — this invocation built nothing';
  v.producedBy = { tool: 'tools/defect-bench.mjs', commit: null, commitReason: 'sample only' };
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}

if (DIRECT && has('--selftest')) {
  let bad = 0;
  let ran = 0;
  const ck = (name, got, want) => {
    ran++;
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g !== w) {
      bad++;
      console.log(`  ✗ ${name} — got ${g} want ${w}`);
    } else console.log(`  ✓ ${name}`);
  };

  /* THE POPULATION IS THE STATE CELL. The plant is the exact shape that over-counts: an OPEN row
     quoting another row's closure in its evidence text. */
  const plant = [
    '| 2026-01-01-a | 2026-01-01 | `tools/x.mjs` | d | e | fixed #11 |',
    '| 2026-01-02-b | 2026-01-02 | `tools/y.mjs` | d | the fix landed as fixed #11 | OPEN |',
    '| 2026-01-03-c | 2026-01-03 | `#9` | d | e | → `SOME-BRIEF.md` |'
  ].join('\n');
  ck(
    'only the state cell closes a row',
    closedRows(plant).map((r) => r.key),
    ['2026-01-01-a']
  );
  ck('…and the PR comes from that cell', closedRows(plant)[0].pr, 11);
  ck('a line-wide match over-counts, which is why it is reported', lineWideRows(plant), 2);

  /* THE SPLIT IS A FUNCTION OF THE KEY ALONE — stable across rebuilds and across recomputation. */
  ck('the split is stable', [half('2026-01-01-a'), half('2026-01-01-a')], [half('2026-01-01-a'), half('2026-01-01-a')]);
  ck('the split names one of two halves', ['dev', 'heldout'].includes(half('2026-09-02-respiration-fusion-no-fixture')), true);
  ck('a different key can land in the other half', new Set(['2026-01-01-a', '2026-01-02-b', '2026-01-03-c', '2026-01-04-d', '2026-01-05-e', '2026-01-06-f'].map(half)).size, 2);

  /* THE ORACLE LANE IS NAMED, NEVER GUESSED. */
  ck('a capture-host test file is the implemented lane', oracleFor(['capture-host/capture.py', 'capture-host/tests/test_hr_strap.py']).kind, 'capture-host-pytest');
  ck('the shared suite is excluded BY NAME', oracleFor(['oxydex-dsp.js', 'tests/dex-tests.js']).kind, 'oracle-shared-suite');
  ck('a standalone js oracle is excluded BY NAME', oracleFor(['tools/a.mjs', 'tests/verify-manifest.mjs']).kind, 'oracle-js-tree');
  ck('a fix with no test is excluded BY NAME', oracleFor(['docs/a.md']).kind, 'no-test-in-fix');
  ck('a non-test path under tests/ is not an oracle lane', oracleFor(['tests/fixtures/x.json']).kind, 'oracle-other-test-path');

  /* THE ORACLE IS THE DIFFERENCE OF TWO ID SETS, and the background is the intersection. */
  const pOut = [
    '........FF.....',
    'FAILED tests/test_a.py::test_one - AssertionError: 3 != 4',
    'FAILED tests/test_a.py::test_background - OSError: not a git repository',
    'ERROR tests/test_a.py::test_err',
    '2 failed, 13 passed in 1.21s'
  ].join('\n');
  ck('every named failure is read, not the last three lines', failingIds(pOut), ['tests/test_a.py::test_one', 'tests/test_a.py::test_background', 'tests/test_a.py::test_err']);
  ck('a passing run names nothing', failingIds('.....\n15 passed in 0.9s'), []);
  ck('a parametrized id keeps its parameters, spaces and all', failingIds("FAILED tests/test_vigil_update.py::test_absence_never_a_sha[echo ''] - AssertionError"), [
    "tests/test_vigil_update.py::test_absence_never_a_sha[echo '']"
  ]);
  ck('an id with no message is read whole', failingIds('ERROR tests/test_a.py::test_b[a b]'), ['tests/test_a.py::test_b[a b]']);
  ck('an id failing at both ends is background, not the task', failToPass(failingIds(pOut), ['tests/test_a.py::test_background', 'tests/test_a.py::test_err']), ['tests/test_a.py::test_one']);
  ck('a fix that repairs nothing leaves an empty oracle', failToPass(['a::b'], ['a::b']), []);
  ck('a failure the fix INTRODUCES is not subtracted from the task', failToPass(['a::b'], ['a::c']), ['a::b']);

  /* THE PR INDEX reads the subject, and only a trailing `(#N)`. */
  const log = ['aaa1\u0000fix(x): a thing (#11)', 'bbb2\u0000chore: no number', 'ccc3\u0000feat: another (#11)', 'ddd4\u0000docs: see (#12) in passing'].join('\n');
  ck('two commits for one PR are both recorded, so the caller can refuse', prIndex(log).get(11), ['aaa1', 'ccc3']);
  ck('a mid-subject reference is not a fix commit', prIndex(log).get(12), undefined);

  /* THE VERDICT STATUSES — the three a build can honestly reach. */
  const mk = (tasks, excluded, closed) => verdictFor({ tasks, excluded, population: { closedRows: closed, candidates: tasks.length + excluded.length } }, 'abcdef123456');
  ck('a whole set PASSes', mk([{ half: 'dev', proof: { ok: true } }], [], 1).status, 'PASS');
  ck('a set with candidates still to prove is a SHORTFALL', mk([{ half: 'dev', proof: { ok: true } }], [{ reason: 'unproven' }], 2).status, 'SHORTFALL');
  ck('an empty set is UNDERPOWERED, never a PASS over nothing', mk([], [{ reason: 'no-test-in-fix' }], 1).status, 'UNDERPOWERED');
  ck('an unproven INCLUSION is a FAIL', mk([{ half: 'dev', proof: null }], [], 1).status, 'FAIL');
  ck('the verdict validates', Verdict.validate(mk([{ half: 'dev', proof: { ok: true } }], [], 1)).ok, true);
  ck(
    'checked + excluded = eligible',
    (() => {
      const v = mk([{ half: 'dev', proof: { ok: true } }], [{ reason: 'unproven' }], 2);
      return v.population.checked + v.population.excluded === v.population.eligible;
    })(),
    true
  );

  console.log(bad ? `\n${bad} of ${ran} selftests FAILED` : `\nall ${ran} selftests passed`);
  process.exit(bad ? 1 : 0);
}

if (DIRECT && !has('--selftest') && !has('--verdict-sample')) process.exit(build());
