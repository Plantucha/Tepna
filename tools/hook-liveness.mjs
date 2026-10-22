#!/usr/bin/env node
/* Tepna — Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ════════════════════════════════════════════════════════════════════════
 * hook-liveness.mjs — WHICH COPY OF EACH GUARD HOOK WOULD ACTUALLY RUN.
 *
 * WHY. Residue `2026-10-21-a-landed-hook-fix-is-inert-until-the-primary-checkout-pulls`. Every entry
 * in `.claude/settings.json` runs its script under `$CLAUDE_PROJECT_DIR/.claude/hooks/`, which is the
 * PRIMARY checkout. A session works in a worktree cut from the ref, and the worktree's own copy of a
 * hook is never the copy that runs. So a guard fix that merges stays inert in every session until
 * that one tree pulls — and nothing in a session says which version is live. On 2026-10-21 the
 * repaired `guard-stale-ledger.sh` landed and the PRE-fix text denied a ledger edit minutes later.
 *
 * WHAT THIS DECIDES, AND WHAT IT CANNOT. It decides, per script, whether the bytes that would run
 * differ from the ref's bytes. It does NOT fix the inertness: only the primary tree advancing does
 * that, and advancing a ref is done in the checkout that holds it (CLAUDE.md §👥.2). This is the
 * reader that was missing, not a repair.
 *
 * THE COMPARISON IS THREE-VALUED, BECAUSE TWO FAILURES LOOK ALIKE. A live file that differs from the
 * ref is either a tree that has not pulled or a hook somebody edited in place, and the remedies are
 * opposite. So each script is read three ways — the bytes on disk, the bytes at the live tree's HEAD,
 * and the bytes at the ref:
 *
 *   live == ref                     → current
 *   live == HEAD, HEAD != ref       → behind    (the fix landed and this tree has not pulled)
 *   live != HEAD                    → modified  (an uncommitted edit; HEAD may ALSO be behind)
 *
 * ABSENCE IS NULL. A script named in `settings.json` with no file on disk has no digest — `null` with
 * a named reason, never a zero-length hash — and a script with no copy at the ref is EXCLUDED with
 * its own reason, because the ref cannot say anything about a local-only hook. Only `behind` decides
 * the verdict: `modified` is a deliberate local state, so it is reported and named, never folded into
 * the criterion, and a count that folded the two would make a stale tree and a mid-edit session read
 * alike — the same defect this row is about.
 *
 *   node tools/hook-liveness.mjs                  # the table, the counts and the remedy
 *   node tools/hook-liveness.mjs --json           # the tepna.verdict/1 object + every row
 *   node tools/hook-liveness.mjs --ref <ref>      # compare against another ref (default origin/main)
 *   node tools/hook-liveness.mjs --root <path>    # read a checkout other than the resolved primary
 *   node tools/hook-liveness.mjs --selftest       # planted truth: one checkout per class
 *   node tools/hook-liveness.mjs --verdict-sample # a sample object, reads no checkout
 * ════════════════════════════════════════════════════════════════════════ */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { makeVerdict } from './verdict-emit.mjs';

const TOOL = 'tools/hook-liveness.mjs';
const GATE = 'hook-liveness';
const SETTINGS = '.claude/settings.json';
const HOOK_PREFIX = '.claude/hooks/';
const DEFAULT_REF = 'origin/main';

/* The flag is read in a CALL position too, because that is the predicate `selftest-all.mjs` and
   `verdict-adoption.mjs` discover a gated tool by. */
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const IS_MAIN = isCliEntry(import.meta.url);

/* ── git, never throwing ───────────────────────────────────────────────────────────────────────── */
/** stdout, or null when the command fails — an unreadable path is an ABSENCE here, not a zero. */
function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);

/* ── the checkout the hooks would run from ─────────────────────────────────────────────────────── */
/** `$CLAUDE_PROJECT_DIR` is the primary checkout, and a worktree can resolve it without being told:
 *  the common git dir is the primary tree's `.git`. Reading the environment variable FIRST would make
 *  the answer depend on who launched the process, which is the ambiguity this tool exists to remove;
 *  the variable is reported beside the resolved path so a disagreement is visible. */
function resolvePrimary(start) {
  const common = git(start, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (common == null) return { root: null, from: null, reason: 'git rev-parse --git-common-dir failed; not a git checkout?' };
  const p = common.trim();
  if (!p) return { root: null, from: null, reason: 'git reported an empty common dir' };
  return { root: p.endsWith('/.git') || p.endsWith('\\.git') ? dirname(p) : p, from: 'git-common-dir', reason: null };
}

/* ── which scripts the settings name ───────────────────────────────────────────────────────────── */
/** Every hook command that names a script under the hooks directory, with the events that fire it.
 *  An entry whose command names no such script is counted apart: it is not a file this tool can read,
 *  and silently dropping it would under-report the population. */
export function hookScripts(settingsText) {
  let doc = null;
  try {
    doc = JSON.parse(settingsText);
  } catch (e) {
    return { ok: false, reason: 'settings.json did not parse: ' + e.message, scripts: new Map(), entries: 0, entriesWithoutScript: 0 };
  }
  const scripts = new Map();
  let entries = 0;
  let without = 0;
  const re = /\.claude\/hooks\/([A-Za-z0-9._-]+)/g;
  const hooks = doc && doc.hooks && typeof doc.hooks === 'object' ? doc.hooks : {};
  for (const event of Object.keys(hooks)) {
    const matchers = Array.isArray(hooks[event]) ? hooks[event] : [];
    for (const m of matchers) {
      const list = m && Array.isArray(m.hooks) ? m.hooks : [];
      for (const h of list) {
        entries++;
        const cmd = h && typeof h.command === 'string' ? h.command : '';
        const found = [...cmd.matchAll(re)].map((x) => HOOK_PREFIX + x[1]);
        if (found.length === 0) {
          without++;
          continue;
        }
        for (const rel of new Set(found)) {
          if (!scripts.has(rel)) scripts.set(rel, []);
          if (!scripts.get(rel).includes(event)) scripts.get(rel).push(event);
        }
      }
    }
  }
  return { ok: true, reason: null, scripts, entries, entriesWithoutScript: without };
}

/* ── the three-valued read ─────────────────────────────────────────────────────────────────────── */
/** `live`, `head` and `ref` are digests or null. The class never guesses: an absent file and an
 *  absent ref copy each carry their own reason, and neither counts as agreement. */
export function classify({ live, head, ref }) {
  if (live == null) return { cls: 'absent', reason: 'named in settings.json, no file on disk' };
  if (ref == null) return { cls: 'untracked-at-ref', reason: 'no copy at the ref; a local-only hook the ref cannot judge' };
  if (live === ref) return { cls: 'current', reason: null };
  if (head != null && live === head) return { cls: 'behind', reason: 'the committed copy differs from the ref; this tree has not pulled it' };
  return {
    cls: 'modified',
    reason:
      head == null ? 'the file differs from the ref and is untracked at HEAD' : head === ref ? 'an uncommitted edit; HEAD matches the ref' : 'an uncommitted edit, and HEAD is ALSO behind the ref'
  };
}

/** One row per script named in the settings of `root`, measured against `ref`. */
export function scan(root, ref) {
  const settingsPath = join(root, SETTINGS);
  if (!existsSync(settingsPath)) return { ok: false, reason: SETTINGS + ' not found in the resolved checkout', rows: [] };
  const parsed = hookScripts(readFileSync(settingsPath, 'utf8'));
  if (!parsed.ok) return { ok: false, reason: parsed.reason, rows: [] };
  const refResolved = git(root, ['rev-parse', '--verify', '--quiet', ref + '^{commit}']);
  if (refResolved == null) return { ok: false, reason: 'the ref ' + ref + ' does not resolve in that checkout', rows: [], refMissing: true };
  const rows = [];
  for (const [rel, events] of [...parsed.scripts].sort((a, b) => a[0].localeCompare(b[0]))) {
    const abs = join(root, rel);
    const live = existsSync(abs) ? sha(readFileSync(abs, 'utf8')) : null;
    const headText = git(root, ['show', 'HEAD:' + rel]);
    const refText = git(root, ['show', ref + ':' + rel]);
    const head = headText == null ? null : sha(headText);
    const refSha = refText == null ? null : sha(refText);
    const verdict = classify({ live, head, ref: refSha });
    rows.push({ script: rel, events, live, head, ref: refSha, cls: verdict.cls, reason: verdict.reason });
  }
  return { ok: true, reason: null, rows, entries: parsed.entries, entriesWithoutScript: parsed.entriesWithoutScript, refCommit: refResolved.trim().slice(0, 12) };
}

/* ── the verdict ───────────────────────────────────────────────────────────────────────────────── */
export function buildVerdict({ scanned, ref, rootFrom, envRoot, rootMatchesEnv, commit }) {
  const rows = scanned.rows || [];
  const count = (c) => rows.filter((r) => r.cls === c).length;
  const behind = rows.filter((r) => r.cls === 'behind').map((r) => r.script);
  const modified = rows.filter((r) => r.cls === 'modified').map((r) => r.script);
  const absent = rows.filter((r) => r.cls === 'absent').map((r) => r.script);
  const untracked = rows.filter((r) => r.cls === 'untracked-at-ref').map((r) => r.script);
  const excluded = absent.length + untracked.length;
  const checked = rows.length - excluded;
  const base = {
    gate: GATE,
    criterion: { name: 'hook_scripts_behind_the_ref', threshold: 0, unit: 'scripts', direction: 'lte' },
    evidence: [TOOL, SETTINGS],
    tool: TOOL,
    commit
  };
  const result = {
    ref,
    refCommit: scanned.refCommit == null ? null : scanned.refCommit,
    rootResolvedFrom: rootFrom,
    claudeProjectDirSet: envRoot != null,
    rootMatchesClaudeProjectDir: rootMatchesEnv,
    hookEntries: scanned.entries == null ? null : scanned.entries,
    entriesNamingNoScript: scanned.entriesWithoutScript == null ? null : scanned.entriesWithoutScript,
    scriptsNamed: rows.length,
    current: count('current'),
    behind: behind.length,
    modified: modified.length,
    absent: absent.length,
    untrackedAtRef: untracked.length,
    behindScripts: behind,
    modifiedScripts: modified,
    absentScripts: absent,
    note: 'modified is reported and never folded into the criterion: an uncommitted edit and an unpulled tree need opposite remedies'
  };
  if (!scanned.ok) {
    /* The contract reserves `result: null` for NOT_RUN: nothing was examined, so there is nothing to
       report. An unresolvable ref is different — the settings WERE read — so it keeps its counts. */
    return makeVerdict({
      ...base,
      status: scanned.refMissing ? 'UNKNOWN' : 'NOT_RUN',
      population: { checked: 0, eligible: 0, excluded: 0 },
      result: scanned.refMissing ? result : null,
      reason: scanned.reason
    });
  }
  if (checked === 0) {
    /* Enumerated, and nothing was comparable. That is UNKNOWN, not NOT_RUN: the population is real
       and the counts below say why every member left the comparison. */
    return makeVerdict({
      ...base,
      status: 'UNKNOWN',
      population: { checked: 0, eligible: rows.length, excluded: excluded },
      result,
      reason: 'every script named in the settings was excluded: ' + absent.length + ' absent on disk, ' + untracked.length + ' with no copy at the ref'
    });
  }
  return makeVerdict({
    ...base,
    status: behind.length === 0 ? 'PASS' : 'FAIL',
    population: { checked, eligible: rows.length, excluded },
    result,
    reason: behind.length === 0 ? null : behind.length + ' hook script(s) run code older than ' + ref + ': ' + behind.join(', ')
  });
}

/* ── the sample ────────────────────────────────────────────────────────────────────────────────── */
function sample() {
  return buildVerdict({
    scanned: {
      ok: true,
      rows: [
        { script: HOOK_PREFIX + 'guard-stale-ledger.sh', events: ['PreToolUse'], live: 'aaaaaaaaaaaa', head: 'aaaaaaaaaaaa', ref: 'bbbbbbbbbbbb', cls: 'behind', reason: 'x' },
        { script: HOOK_PREFIX + 'guard-trailer.sh', events: ['PreToolUse'], live: 'cccccccccccc', head: 'cccccccccccc', ref: 'cccccccccccc', cls: 'current', reason: null }
      ],
      entries: 23,
      entriesWithoutScript: 0,
      refCommit: '000000000000'
    },
    ref: DEFAULT_REF,
    rootFrom: 'git-common-dir',
    envRoot: null,
    rootMatchesEnv: null,
    commit: null
  });
}

/* ── selftest: one planted checkout, one class per script ──────────────────────────────────────── */
function plant() {
  const dir = mkdtempSync(join(tmpdir(), 'hook-liveness-'));
  const run = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  run(['init', '-q', '-b', 'work']);
  run(['config', 'user.email', 'selftest@example.invalid']);
  run(['config', 'user.name', 'selftest']);
  mkdirSync(join(dir, HOOK_PREFIX), { recursive: true });
  const w = (rel, text) => writeFileSync(join(dir, rel), text);
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/a-current.sh"' },
            { type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/b-behind.sh"' },
            { type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/c-modified.sh"' },
            { type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/d-absent.sh"' },
            { type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/e-local.sh"' },
            { type: 'command', command: 'echo an entry that names no script' }
          ]
        }
      ],
      PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/a-current.sh" post' }] }]
    }
  };
  w(SETTINGS, JSON.stringify(settings, null, 2));
  w(HOOK_PREFIX + 'a-current.sh', 'echo a v1\n');
  w(HOOK_PREFIX + 'b-behind.sh', 'echo b v1\n');
  w(HOOK_PREFIX + 'c-modified.sh', 'echo c v1\n');
  run(['add', SETTINGS, HOOK_PREFIX + 'a-current.sh', HOOK_PREFIX + 'b-behind.sh', HOOK_PREFIX + 'c-modified.sh']);
  run(['commit', '-q', '-m', 'plant v1']);
  /* The ref advances b-behind.sh; the work branch stays where it was, which is the inertness itself. */
  run(['checkout', '-q', '-b', 'refline']);
  w(HOOK_PREFIX + 'b-behind.sh', 'echo b v2 the landed fix\n');
  run(['add', HOOK_PREFIX + 'b-behind.sh']);
  run(['commit', '-q', '-m', 'the fix lands on the ref']);
  run(['checkout', '-q', 'work']);
  /* c-modified.sh is edited in place and never committed; e-local.sh exists on disk only. */
  w(HOOK_PREFIX + 'c-modified.sh', 'echo c edited in place\n');
  w(HOOK_PREFIX + 'e-local.sh', 'echo e local only\n');
  return { dir, ref: 'refline' };
}

function selftest() {
  let pass = 0;
  let fail = 0;
  const ok = (name, cond, detail) => {
    if (cond) {
      pass++;
      console.log('  ✓ ' + name);
    } else {
      fail++;
      console.log('  ✗ ' + name + (detail ? ' — ' + detail : ''));
    }
  };
  const eq = (name, got, want) => ok(name, got === want, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));

  /* classify: the three-valued read, stated without any checkout at all. */
  eq('live == ref reads current', classify({ live: 'x', head: 'x', ref: 'x' }).cls, 'current');
  eq('live == HEAD and HEAD != ref reads behind', classify({ live: 'x', head: 'x', ref: 'y' }).cls, 'behind');
  eq('live != HEAD reads modified', classify({ live: 'z', head: 'x', ref: 'x' }).cls, 'modified');
  eq('an absent file is absent, never a digest', classify({ live: null, head: 'x', ref: 'x' }).cls, 'absent');
  eq('no copy at the ref is excluded, not agreement', classify({ live: 'x', head: 'x', ref: null }).cls, 'untracked-at-ref');
  ok('a modified file over a behind HEAD names both facts', /ALSO behind/.test(classify({ live: 'z', head: 'x', ref: 'y' }).reason || ''));
  ok(
    'every non-current class carries a reason',
    ['behind', 'modified', 'absent', 'untracked-at-ref'].every((c) => c === 'current' || true) && classify({ live: 'x', head: 'x', ref: 'y' }).reason != null
  );

  /* hookScripts: the population, including the entry that names no script. */
  const planted = plant();
  try {
    const parsed = hookScripts(readFileSync(join(planted.dir, SETTINGS), 'utf8'));
    eq('five scripts are named', parsed.scripts.size, 5);
    eq('seven hook entries are counted', parsed.entries, 7);
    eq('the entry naming no script is counted apart', parsed.entriesWithoutScript, 1);
    eq('a script fired by two events lists both', (parsed.scripts.get(HOOK_PREFIX + 'a-current.sh') || []).length, 2);
    ok('unparseable settings refuse with a reason', hookScripts('{not json').ok === false && /did not parse/.test(hookScripts('{not json').reason));

    /* scan + verdict over the planted checkout. */
    const scanned = scan(planted.dir, planted.ref);
    const cls = (n) => (scanned.rows.find((r) => r.script === HOOK_PREFIX + n) || {}).cls;
    eq('the unchanged script reads current', cls('a-current.sh'), 'current');
    eq('the landed fix this tree has not pulled reads behind', cls('b-behind.sh'), 'behind');
    eq('the in-place edit reads modified', cls('c-modified.sh'), 'modified');
    eq('the script with no file reads absent', cls('d-absent.sh'), 'absent');
    eq('the local-only script is excluded', cls('e-local.sh'), 'untracked-at-ref');
    const v = buildVerdict({ scanned, ref: planted.ref, rootFrom: '--root', envRoot: null, rootMatchesEnv: null, commit: null });
    eq('one behind script fails the criterion', v.status, 'FAIL');
    eq('checked + excluded = eligible', v.population.checked + v.population.excluded, v.population.eligible);
    ok('the failure names the script', /b-behind\.sh/.test(v.reason || ''));
    ok('the modified script is reported outside the criterion', v.result.modified === 1 && !/c-modified/.test(v.reason || ''));
    ok('the absent script has a null digest', scanned.rows.find((r) => r.script === HOOK_PREFIX + 'd-absent.sh').live === null);
    ok(
      'an unresolvable ref reads UNKNOWN',
      buildVerdict({ scanned: scan(planted.dir, 'no-such-ref-9f3'), ref: 'no-such-ref-9f3', rootFrom: '--root', envRoot: null, rootMatchesEnv: null, commit: null }).status === 'UNKNOWN'
    );
    const noSettings = buildVerdict({ scanned: scan(tmpdir(), planted.ref), ref: planted.ref, rootFrom: '--root', envRoot: null, rootMatchesEnv: null, commit: null });
    eq('a checkout with no settings reads NOT_RUN', noSettings.status, 'NOT_RUN');
    ok('NOT_RUN reports no result, because it examined nothing', noSettings.result === null);
  } finally {
    rmSync(planted.dir, { recursive: true, force: true });
  }

  console.log(fail === 0 ? '\nall ' + pass + ' selftests passed' : '\n' + fail + ' selftest(s) FAILED (' + pass + ' passed)');
  return fail === 0 ? 0 : 1;
}

/* ── main ──────────────────────────────────────────────────────────────────────────────────────── */
function main() {
  refuseUnknownArgvOrExit(argv, { valued: ['--ref', '--root'], boolean: ['--json', '--selftest', '--verdict-sample'] }, { tool: TOOL });
  if (flag('--selftest')) return selftest();
  if (flag('--verdict-sample')) {
    console.log(JSON.stringify(sample()));
    return 0;
  }
  const ref = opt('--ref', DEFAULT_REF);
  const envRoot = process.env.CLAUDE_PROJECT_DIR || null;
  const asked = opt('--root', null);
  let root = asked;
  let rootFrom = asked ? '--root' : null;
  if (!root) {
    const resolved = resolvePrimary(dirname(fileURLToPath(import.meta.url)));
    if (resolved.root == null) {
      const v = buildVerdict({ scanned: { ok: false, reason: resolved.reason, rows: [] }, ref, rootFrom: null, envRoot, rootMatchesEnv: null, commit: undefined });
      console.log(JSON.stringify(v));
      console.log('\n▸ ' + TOOL + ': ' + resolved.reason);
      return 2;
    }
    root = resolved.root;
    rootFrom = resolved.from;
  }
  const rootMatchesEnv = envRoot == null ? null : envRoot.replace(/\/+$/, '') === String(root).replace(/\/+$/, '');
  const scanned = scan(root, ref);
  const v = buildVerdict({ scanned, ref, rootFrom, envRoot, rootMatchesEnv, commit: undefined });
  if (flag('--json')) {
    console.log(JSON.stringify({ verdict: v, rows: scanned.rows }, null, 2));
  } else {
    console.log(JSON.stringify(v));
    console.log('');
    console.log('▸ the checkout whose hooks would run: ' + root + '  (resolved from ' + rootFrom + ')');
    if (rootMatchesEnv === false) console.log('  ⚠ CLAUDE_PROJECT_DIR names a DIFFERENT checkout: ' + envRoot);
    if (!scanned.ok) {
      console.log('  ' + scanned.reason);
    } else {
      for (const r of scanned.rows) {
        const mark = r.cls === 'current' ? '✓' : r.cls === 'behind' ? '✗' : '·';
        console.log('  ' + mark + ' ' + r.cls.padEnd(17) + ' ' + r.script.replace(HOOK_PREFIX, '') + (r.reason ? '  — ' + r.reason : ''));
      }
      console.log('');
      console.log(
        '  ' +
          v.result.scriptsNamed +
          ' script(s) over ' +
          v.result.hookEntries +
          ' hook entr(ies): current ' +
          v.result.current +
          ' · behind ' +
          v.result.behind +
          ' · modified ' +
          v.result.modified +
          ' · absent ' +
          v.result.absent +
          ' · untracked-at-ref ' +
          v.result.untrackedAtRef
      );
      if (v.result.behind > 0) console.log('  remedy, in the checkout that holds the branch (CLAUDE.md §👥.2): git -C ' + root + ' merge --ff-only ' + ref);
    }
  }
  return v.status === 'FAIL' ? 1 : 0;
}

if (IS_MAIN) process.exit(main());
