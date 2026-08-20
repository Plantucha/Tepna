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
const gitQuiet = (...a) => {
  try {
    return { ok: true, out: git(...a) };
  } catch (e) {
    return { ok: false, out: String((e && (e.stdout || e.message)) || '') };
  }
};

/* ── THE GENERATED SET, read from the builders that own it ──────────────────────────────────────
   Returns null if any source cannot be read — the caller then treats everything as source. */
function generatedSet() {
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
  return bundles;
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
  /* `docs/` IS NOT WHOLLY GENERATED, and treating it as such was destructive in exactly the way this
     classifier exists to prevent. Measured 2026-08-05: the tree holds 149 files and `build-docs.mjs
     --check` accounts for 119 (53 pages · 59 assets · 6 artifacts · 1 preserved). The 30 it does not
     manage are precisely the `.md` — authored specs and narrative, among them `docs/EVENT-LEXICON.md`,
     which CLAUDE.md names as a file the suite reads, and `docs/CROSSNIGHT-ENVELOPE-SPEC.md`, a
     published contract. Auto-resolving one of those took a side and then "rebuilt" with a builder that
     never writes `.md`, so the discarded side vanished silently — the whole failure mode this tool
     exists to stop, carried out with its blessing.
     ⚠ RESIDUAL, stated rather than buried: 119 accounted-for leaves the json/xml/txt artifacts here
     unverified individually — build-docs reports six artifacts and eleven such files exist. They stay
     classified generated. If one of them is authored it has the same hole; the `.md` set is the part
     that is measured. */
  if (p.startsWith('docs/')) return p.endsWith('.md') ? 'source' : 'generated';
  if (p.startsWith('provenance/')) return 'generated'; // ledger fragments, written by build.mjs
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
    const dirty = git('status', '--porcelain')
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3).replace(/^"|"$/g, ''));
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
