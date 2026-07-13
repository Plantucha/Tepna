#!/usr/bin/env node
/*
 * tools/release.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * CONTROLLED-RELEASES-2026-07-05 — cut a controlled Tepna release.
 * Reads pending changes/*.md, computes the aggregate SemVer bump, and (from a GREEN tree):
 *   1. stamps suite.manifest.json.version
 *   2. prepends a Keep-a-Changelog section to CHANGELOG.md + maintains its reference compare-links (F6)
 *   3. appends a RELEASE-MANIFEST.json record (with the current per-app manifestHash snapshot)
 *   4. prunes the consumed changesets and regenerates BOTH generated lists
 *      (tests/changes-list.txt AND tests/docs-ledger-list.txt — the pruned files leave the latter's
 *      path inventory stale, which reds docs-ledger just as surely as changes-list reds release-ledger)
 *   5. prints the git tag to create
 * The version is computed ONCE, here, at the end — parallel coders only ever drop changesets, so
 * they never collide on a number. NEVER hand-edit a version or a manifestHash snapshot.
 *
 *     node tools/release.mjs            # cut a release from the pending changesets
 *     node tools/release.mjs --dry-run  # preview; write nothing
 *     node tools/release.mjs --skip-gates   # dev only: skip the pre-flight gate run
 */
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const SKIP_GATES = args.includes('--skip-gates');
const p = (...a) => join(ROOT, ...a);
const readJSON = (f) => JSON.parse(readFileSync(p(f), 'utf8'));

const CHANGE_DIR = p('changes');
const isChangeset = (f) => f.endsWith('.md') && f !== 'README.md' && !/^[._]/.test(f);
const RANK = { patch: 1, minor: 2, major: 3 };

function readChangesets() {
  if (!existsSync(CHANGE_DIR)) return [];
  return readdirSync(CHANGE_DIR)
    .filter(isChangeset)
    .sort()
    .map((name) => {
      const text = readFileSync(join(CHANGE_DIR, name), 'utf8');
      const bump = (text.match(/^bump:\s*(patch|minor|major)\s*$/im) || [])[1];
      const type = (text.match(/^type:\s*(added|changed|fixed|removed|deprecated|security)\s*$/im) || [])[1];
      const brief = (text.match(/^brief:\s*(\S+)\s*$/im) || [])[1] || 'none';
      const body = text.replace(/^[\s\S]*?---[\s\S]*?---\s*/, '').trim() || text.trim();
      return { name, bump: (bump || '').toLowerCase(), type: (type || 'changed').toLowerCase(), brief, body };
    });
}

function bumpVersion(v, level) {
  const [maj, min, pat] = v.split('.').map(Number);
  if (level === 'major') return maj + 1 + '.0.0';
  if (level === 'minor') return maj + '.' + (min + 1) + '.0';
  return maj + '.' + min + '.' + (pat + 1);
}

function main() {
  const changesets = readChangesets();
  if (!changesets.length) {
    console.error('No pending changesets in changes/ — nothing to release.');
    process.exit(1);
  }
  const bad = changesets.filter((c) => !RANK[c.bump]);
  if (bad.length) {
    console.error('Malformed changesets (bad/missing bump): ' + bad.map((c) => c.name).join(', '));
    process.exit(2);
  }

  // Pre-flight — a controlled release is only cut from a green tree (IEC 62304 §5.8).
  if (!SKIP_GATES) {
    for (const cmd of [
      ['node', 'tests/run-tests.mjs'],
      ['node', 'tests/verify-manifest.mjs']
    ]) {
      const r = spawnSync(cmd[0], cmd.slice(1), { cwd: ROOT, stdio: 'inherit' });
      if (r.status !== 0) {
        console.error('\nGate failed: ' + cmd.join(' ') + ' — refusing to release. (--skip-gates is dev-only.)');
        process.exit(3);
      }
    }
  }

  const level = ['major', 'minor', 'patch'].find((l) => changesets.some((c) => c.bump === l));
  const manifest = readJSON('suite.manifest.json');
  const from = manifest.version,
    to = bumpVersion(from, level);
  const date = new Date().toISOString().slice(0, 10);

  // Build the new CHANGELOG section, grouped by Keep-a-Changelog category.
  const CATS = [
    ['added', 'Added'],
    ['changed', 'Changed'],
    ['deprecated', 'Deprecated'],
    ['removed', 'Removed'],
    ['fixed', 'Fixed'],
    ['security', 'Security']
  ];
  let section = '## [' + to + '] — ' + date + '\n\n';
  for (const [cat, head] of CATS) {
    const rows = changesets.filter((c) => c.type === cat);
    if (!rows.length) continue;
    section += '### ' + head + '\n';
    for (const c of rows) {
      const ref = c.brief && c.brief !== 'none' ? ' (`' + c.brief + '`)' : '';
      section += '- ' + c.body.split('\n')[0] + ref + '\n';
    }
    section += '\n';
  }

  // Per-app manifestHash snapshot (the check-7 anchor — "unreleased code needs an unreleased entry").
  const build = readJSON('BUILD-MANIFEST.json');
  const manifestHashes = {};
  for (const [k, v] of Object.entries(build.bundles || {})) manifestHashes[k.replace(/\.html$/, '')] = v.manifestHash;

  const record = { version: to, date, bump: level, name: '', manifestHashes, briefs: [...new Set(changesets.map((c) => c.brief).filter((b) => b && b !== 'none'))], notes: '' };

  if (DRY) {
    console.log('DRY RUN: ' + from + ' \u2192 ' + to + ' (' + level + ')\n\n' + section);
    console.log('Would consume: ' + changesets.map((c) => c.name).join(', '));
    return;
  }

  // 1 · stamp the canonical version
  manifest.version = to;
  writeFileSync(p('suite.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  // 1b · F4 — stamp CITATION.cff (a release-identity surface an academic citation pins; release-ledger
  //      check-6 asserts it == canonical). UPDATE the number in place; never touch any other field.
  const cffP = p('CITATION.cff');
  if (existsSync(cffP)) {
    const cff = readFileSync(cffP, 'utf8');
    const stamped = cff.replace(/^(version:\s*)["']?\d+\.\d+\.\d+["']?/m, `$1${to}`);
    if (stamped !== cff) writeFileSync(cffP, stamped);
  }
  // 2 · append the release record
  const release = readJSON('RELEASE-MANIFEST.json');
  release.releases.push(record);
  writeFileSync(p('RELEASE-MANIFEST.json'), JSON.stringify(release, null, 2) + '\n');
  // 3 · prepend the CHANGELOG section right after the [Unreleased] block
  let cl = readFileSync(p('CHANGELOG.md'), 'utf8');
  const anchor = /(##\s*\[Unreleased\][\s\S]*?\n---\n)/;
  cl = anchor.test(cl) ? cl.replace(anchor, '$1\n' + section + '---\n') : cl.replace(/(# Changelog\n)/, '$1\n' + section);
  // 3b · F6 — maintain the reference-style compare links at the file foot (Keep-a-Changelog convention):
  //      [Unreleased] compares from the new tag; the new version compares against its predecessor.
  //      Derive the repo base from the existing [Unreleased] link so no URL is hard-coded here.
  const unrel = cl.match(/^\[Unreleased\]:\s*(https?:\/\/\S+?)\/compare\/\S+\.\.\.HEAD\s*$/im);
  if (unrel) {
    const base = unrel[1]; // e.g. https://github.com/Plantucha/Tepna
    cl = cl.replace(/^\[Unreleased\]:.*$/im, '[Unreleased]: ' + base + '/compare/v' + to + '...HEAD');
    if (!new RegExp('^\\[' + to.replace(/\./g, '\\.') + '\\]:', 'm').test(cl)) {
      // idempotent — never double-add
      const newLink = '[' + to + ']: ' + base + '/compare/v' + from + '...v' + to;
      cl = cl.replace(/^(\[Unreleased\]:.*\n)/im, '$1' + newLink + '\n'); // insert directly under [Unreleased]
    }
  }
  writeFileSync(p('CHANGELOG.md'), cl);
  // 4 · prune consumed changesets, regenerate BOTH browser-lane lists.
  //     docs-ledger-list.txt carries a whole-tree path inventory, so pruning changes/ staleness-reds the
  //     docs-ledger gate too — not just changes-list.txt. Regenerating one without the other ships a red tree.
  for (const c of changesets) unlinkSync(join(CHANGE_DIR, c.name));
  for (const gen of ['tests/gen-changes-list.mjs', 'tests/gen-docs-ledger-list.mjs']) {
    const r = spawnSync('node', [gen], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('\n✗ ' + gen + ' failed (exit ' + r.status + ') — the ledgers are written but its list is STALE.');
      console.error('  Re-run it by hand before committing, or the docs-ledger/release-ledger gate will red.');
      process.exit(1);
    }
  }

  console.log(
    '\nReleased ' +
      to +
      '. Now:\n\n    node tools/build-docs.mjs   # project v' +
      to +
      ' into README + index.html + docs/about.json (check-6 surfaces)\n    git add -A && git commit -m "release: v' +
      to +
      '"\n    git tag v' +
      to +
      '\n'
  );
}

main();
