#!/usr/bin/env node
/*
 * tools/rebase-safe.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * REBASE ONTO origin/main WITHOUT SILENTLY REVERTING SOURCE.
 *
 * WHY THIS EXISTS. Several sessions work this repo at once and `main` moves during every review
 * cycle, so almost every PR must rebase at least once. When it does, the conflicts are nearly always
 * in GENERATED artifacts — the two orchestrator bundles in particular are re-bundled by any change to
 * any inlined module, so they collide between PRs that share no source at all.
 *
 * The obvious shortcut is fatal:
 *
 *     git checkout origin/main -- $(git diff --name-only --diff-filter=U)   # ← NEVER
 *
 * It is correct for a generated file and DESTRUCTIVE for a source one, and it fails SILENTLY: the
 * rebase completes, the tree is clean, the branch pushes. Measured here on 2026-08-05 — that one line
 * reverted a test group, a DSP fix and a provenance entry out of a commit whose message still
 * described all three. The push succeeded. Only `git show HEAD:<file> | grep` caught it.
 *
 * THE RULE THIS ENCODES. A generated file's correct content is a FUNCTION OF SOURCE, so neither side
 * of a conflict in one is authoritative — the answer is to take either and REBUILD. A source file has
 * no such function; its conflict must be resolved by a human/agent reading both sides. So:
 *
 *     conflict in a GENERATED path  →  auto-resolve, then rebuild from source, then verify
 *     conflict in ANY other path    →  STOP. Abort the rebase. Name the files. Exit non-zero.
 *
 * THE GENERATED SET IS ASKED FOR, NEVER GUESSED. A glob would be the second version of this bug:
 * `*.html` would match the authored `*.src.html`, every hand-written reference guide and `Science.html`
 * — and auto-resolving one of those is exactly the silent revert this tool exists to prevent. The set
 * is read from the builders that own it (`manifest-gate.js` MANIFEST_BUNDLES, build.mjs's
 * ORCHESTRATORS, build-analysis.mjs's TOOLS, plus `docs/` and `provenance/`), so a bundle added to the
 * fleet joins this tool by construction. If a set cannot be read, the tool treats EVERYTHING as source
 * and stops — it fails CLOSED, because a tool that fails open here reverts work.
 *
 *   node tools/rebase-safe.mjs                 # rebase onto origin/main, rebuild, verify
 *   node tools/rebase-safe.mjs --onto <ref>    # some other base
 *   node tools/rebase-safe.mjs --classify <p…> # print the verdict for paths (used by the self-test)
 *   node tools/rebase-safe.mjs --no-build      # skip the rebuild (classification + rebase only)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const C = { red: '[31m', grn: '[32m', yel: '[33m', bold: '[1m', off: '[0m' };
const paint = (s, c) => (process.stdout.isTTY ? c + s + C.off : s);
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
/* UNTRIMMED. `--porcelain` encodes the index/worktree state in TWO leading columns, so an unstaged
   modification legitimately begins with a space and `.trim()` destroys it — silently, and only on the
   first line. Any caller parsing column-oriented git output must use this, never `git()`. */
const gitRaw = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const gitQuiet = (...a) => {
  try {
    return { ok: true, out: git(...a) };
  } catch (e) {
    return { ok: false, out: String((e && (e.stdout || e.message)) || '') };
  }
};

/* ── THE GENERATED SET, read from the builders that own it ──────────────────────────────────────
   Returns null if any source cannot be read — the caller then treats everything as source. */
export function generatedSet() {
  const bundles = new Set();
  try {
    const MG = require(join(ROOT, 'manifest-gate.js'));
    const list = MG && MG.MANIFEST_BUNDLES;
    if (!Array.isArray(list) || !list.length) return null;
    list.forEach((b) => bundles.add(b));
  } catch {
    return null;
  }
  // Orchestrators + analysis tools are declared as literals inside their builders; read them out of
  // the source text rather than re-typing them here, so a change there reaches this tool.
  const grab = (file, decl) => {
    if (!existsSync(join(ROOT, file))) return null;
    const t = readFileSync(join(ROOT, file), 'utf8');
    const m = t.match(new RegExp('const\\s+' + decl + '\\s*=\\s*\\[([\\s\\S]*?)\\]'));
    if (!m) return null;
    const items = m[1].match(/['"]([^'"]+\.html)['"]/g) || [];
    return items.map((s) => s.slice(1, -1));
  };
  const orch = grab('tools/build.mjs', 'ORCHESTRATORS');
  const tools = grab('tools/build-analysis.mjs', 'TOOLS');
  if (!orch || !tools) return null;
  orch.forEach((b) => bundles.add(b));
  tools.forEach((b) => bundles.add(b));
  /* ASK build-docs WHICH docs/ PATHS IT OWNS — do not assume the prefix (adversarial pass
     2026-08-05). This used to be `startsWith('docs/')`, and that was FALSE and dangerous:
     build-docs writes a docs/ file only where a ROOT TWIN exists, plus six artifacts, and `.md` is
     filtered out of its asset list — so the 30 archival docs (`docs/COMPLIANCE/*`,
     `EVENT-LEXICON.md`, `LEXICON.md`, `docs/papers/*`, …) are AUTHORED and owned by nobody.
     Measured before the fix: `--classify docs/EVENT-LEXICON.md` said GENERATED, while
     `build-docs --check` reported "current" after that file was modified and a full run did not
     restore it. A conflict there would have been auto-resolved by discarding your side, left
     unrestorable by the rebuild, and reported `✓` — this tool committing the exact silent revert it
     exists to prevent. `--list-owned` implies `--check`, so asking cannot write. */
  const owned = askBuildDocs();
  if (!owned) return null; // FAIL CLOSED — an unanswerable builder means we know nothing
  owned.forEach((p) => bundles.add(p));
  return bundles;
}

function askBuildDocs() {
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'tools/build-docs.mjs'), '--list-owned'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const list = out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    return list.length ? list : null;
  } catch {
    return null;
  }
}

/* ── `git status --porcelain` → paths ──────────────────────────────────────────────────────────────
   Every line is `XY PATH`: two status columns, one space, then the path. Three ways to get this
   wrong, and the shipped version had two of them. All three are gate-pinned by value.

   1 · DO NOT `.trim()` THE OUTPUT FIRST. A worktree modification that is not staged has a LEADING
       SPACE in column 1 (`" M path"`) — exactly what `rebuild()` leaves behind. `.trim()` strips it
       from the FIRST line only, so a `.slice(3)` then eats `M`, ` ` and the path's first character.
       Measured: `" M OverDex.html"` → `verDex.html`. Only ever the first entry, which is why it read
       as a typo rather than a parser fault and survived. `git()` trims by default, so this function
       takes the RAW string and must keep it raw.
   2 · A QUOTED PATH IS C-QUOTED, NOT JUST QUOTE-WRAPPED. git quotes any path with a space or a
       non-ASCII byte and escapes the bytes: `Data Unifier.html` → `"Data Unifier.html"`, and
       `café.html` → `"caf\303\251.html"`. Stripping the outer quotes with a regex leaves the octal
       escapes in place, producing a plausible-looking name that does not exist. This matters here
       specifically: **`Data Unifier.html` is one of the two orchestrator bundles this tool rebuilds**,
       and it sorts first, so the most likely first entry is a quoted one.
   3 · The two defects CANCEL on a quoted first entry — the character (1) eats is the opening quote,
       and the trailing-quote strip removes its partner. So the bug is INVISIBLE precisely when the
       first artifact is `Data Unifier.html` and visible when it is `OverDex.html`. A fixture whose
       first entry is quoted, staged (`"M  path"`) or untracked (`"?? path"`) passes while the bug is
       present, because none of those carries a leading space. The gate pins one of each. */
function _unquote(s) {
  if (s.length < 2 || s[0] !== '"') return s;
  const body = s.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') {
      bytes.push(...Buffer.from(body[i], 'utf8'));
      continue;
    }
    const c = body[++i];
    const oct = /[0-7]/.test(c) ? body.slice(i, i + 3) : null;
    if (oct && /^[0-7]{3}$/.test(oct)) {
      bytes.push(parseInt(oct, 8));
      i += 2;
      continue;
    }
    const simple = { n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, a: 7 };
    bytes.push(...Buffer.from(c in simple ? String.fromCharCode(simple[c]) : c, 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

export function parsePorcelain(raw) {
  return String(raw == null ? '' : raw)
    .split('\n')
    .filter((l) => l.length > 3)
    .map((l) => {
      const status = l.slice(0, 2);
      let rest = l.slice(3);
      /* A rename/copy reads `R  old -> new`; the destination is the path that exists now, and it is
         the one a caller must stage. git quotes any path containing the separator, so an UNQUOTED
         ` -> ` is unambiguously the separator. A rebuild cannot rename, so this is belt-and-braces —
         but a parser that silently returned `old -> new` would hand back a path that never exists. */
      if (/^[RC]/.test(status) && rest.includes(' -> ')) rest = rest.slice(rest.lastIndexOf(' -> ') + 4);
      return _unquote(rest);
    });
}

/* A path is GENERATED iff a builder owns it. Everything else — including every *.src.html, every
   authored guide, tests/, uploads/ goldens and all *.js — is SOURCE. */
export function classify(path, gen) {
  if (!gen) return 'source'; // fail CLOSED
  /* A path that traverses is not a path we understand, so it is SOURCE. `provenance/../oxydex-dsp.js`
     matched the `provenance/` prefix and classified GENERATED in the first version — found by an
     adversarial pass. Git does not emit traversing paths from `--diff-filter=U`, so this was not
     reachable in practice; it is fixed anyway, because the whole value of this classifier is that it
     is wrong in the SAFE direction and a prefix test that can be walked out of is not. */
  const p = String(path == null ? '' : path);
  if (!p || p.startsWith('/') || p.split('/').includes('..') || p.split('/').includes('.')) return 'source';
  if (gen.has(p)) return 'generated';
  // NO `docs/` PREFIX RULE — see askBuildDocs(). The owned docs/ paths are in `gen` by name.
  /* provenance/ IS a whole-prefix rule, and that is verified rather than assumed: the directory holds
     exactly the per-app ledger fragments plus `_meta.json` and `index.json`, every one written by
     build.mjs, and nothing authored lives there. If an authored file is ever added under it, this
     line becomes the same defect `docs/` just had — so enumerate before extending it. */
  if (p.startsWith('provenance/')) return 'generated';
  return 'source';
}

function rebuild() {
  const steps = [
    ['tools/build.mjs', ['--all']],
    ['tools/build-analysis.mjs', []],
    ['tools/build-docs.mjs', []]
  ];
  for (const [script, args] of steps) {
    if (!existsSync(join(ROOT, script))) continue;
    process.stdout.write('  ▸ ' + script + ' … ');
    try {
      execFileSync(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, stdio: 'pipe' });
      console.log(paint('ok', C.grn));
    } catch (e) {
      console.log(paint('FAILED', C.red));
      console.error(String((e && (e.stdout || e.message)) || ''));
      process.exit(1);
    }
  }
  process.stdout.write('  ▸ build.mjs --check … ');
  try {
    execFileSync(process.execPath, [join(ROOT, 'tools/build.mjs'), '--check'], { cwd: ROOT, stdio: 'pipe' });
    console.log(paint('clean', C.grn));
  } catch (e) {
    console.log(paint('STALE', C.red));
    console.error(String((e && (e.stdout || e.message)) || ''));
    process.exit(1);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const gen = generatedSet();

  if (argv[0] === '--classify') {
    for (const p of argv.slice(1)) console.log(classify(p, gen) + '\t' + p);
    return;
  }
  if (!gen) {
    console.error(paint('✕ cannot read the builders’ owned sets — refusing to classify anything as generated.', C.red));
    console.error('  This tool fails CLOSED on purpose: guessing here reverts work. Rebase by hand.');
    process.exit(2);
  }

  const onto = argv.includes('--onto') ? argv[argv.indexOf('--onto') + 1] : 'origin/main';
  const doBuild = !argv.includes('--no-build');

  if (git('status', '--porcelain')) {
    console.error(paint('✕ working tree is not clean — commit or stash your own work first.', C.red));
    process.exit(2);
  }
  console.log(paint('▸ rebase-safe → ' + onto, C.bold));
  if (onto.startsWith('origin/')) gitQuiet('fetch', 'origin', onto.slice('origin/'.length));

  const behind = git('rev-list', '--count', 'HEAD..' + onto);
  if (behind === '0') {
    console.log('  already up to date with ' + onto + ' — nothing to rebase.');
    if (doBuild) rebuild();
    return;
  }
  console.log('  ' + behind + ' commit(s) behind ' + onto);

  const r = gitQuiet('rebase', onto);
  if (!r.ok) {
    const conflicts = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
    const source = conflicts.filter((p) => classify(p, gen) === 'source');
    const generated = conflicts.filter((p) => classify(p, gen) === 'generated');

    if (source.length) {
      console.error(paint('\n✕ SOURCE CONFLICT — stopping. These need real resolution, never a wholesale checkout:', C.red));
      source.forEach((p) => console.error('    ' + p));
      if (generated.length) {
        console.error(paint('  (also conflicted, and safe to auto-resolve once the above are done:', C.yel));
        generated.forEach((p) => console.error('    ' + p));
        console.error(paint('  )', C.yel));
      }
      console.error('\n  For tests/dex-tests.js specifically: restore ' + onto + "'s copy and RE-RUN your insertion.");
      console.error('  Never keep one side wholesale — that is how a test group is silently dropped.');
      console.error('  Aborting the rebase so your branch is exactly as it was.');
      gitQuiet('rebase', '--abort');
      process.exit(1);
    }

    // Generated-only: neither side is authoritative — take one and rebuild below.
    console.log(paint('  auto-resolving ' + generated.length + ' generated artifact(s) (rebuilt below):', C.yel));
    generated.forEach((p) => console.log('    ' + p));
    for (const p of generated) gitQuiet('checkout', onto, '--', p);
    gitQuiet('add', ...generated);
    const cont = execFileSync('git', ['-c', 'core.editor=true', 'rebase', '--continue'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    void cont;
  }
  console.log(paint('  rebase complete', C.grn));

  if (doBuild) {
    console.log(paint('▸ rebuilding every generated tree from source', C.bold));
    rebuild();
    /* RAW, not `git()` — `git()` trims, and the leading space of an unstaged entry is load-bearing.
       See parsePorcelain's header: trimming it corrupts the first path. */
    const dirty = parsePorcelain(gitRaw('status', '--porcelain'));
    if (dirty.length) {
      console.log(paint('▸ the rebuild moved ' + dirty.length + ' artifact(s) — AMEND them into your commit:', C.yel));
      dirty.forEach((p) => console.log('    ' + p));
      console.log('\n  git add ' + dirty.map((p) => (/[ ]/.test(p) ? '"' + p + '"' : p)).join(' ') + ' && git commit --amend --no-edit');
    } else {
      console.log(paint('  no artifact moved — nothing to amend', C.grn));
    }
  }
  console.log(paint('\n✓ rebase-safe done. VERIFY YOUR OWN CHANGES SURVIVED before pushing, e.g.', C.bold));
  console.log('    git show HEAD:<file> | grep -c <an identifier your change adds>');
}

if (process.argv[1] && process.argv[1].endsWith('rebase-safe.mjs')) main();
