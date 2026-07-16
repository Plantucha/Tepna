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
 *   4. prunes the consumed changesets
 *   5. prints the git tag to create
 * The version is computed ONCE, here, at the end — parallel coders only ever drop changesets, so
 * they never collide on a number. NEVER hand-edit a version or a manifestHash snapshot.
 *
 *     node tools/release.mjs            # cut a release from the pending changesets
 *     node tools/release.mjs --dry-run  # preview; write nothing
 *     node tools/release.mjs --skip-gates   # dev only: skip the pre-flight gate run
 */
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
// P3 — the per-app manifestHash snapshot comes from the reassembled provenance/ fragments.
const ProvenanceLedger = require(join(ROOT, 'provenance-ledger.js'));
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
  //
  // `verify-fixtures --check` is THE WALL (FIXTURE-VERIFICATION-GATE §3.2). A corpus-backed fixture
  // whose producing code moved but which nothing has re-run since is an UNVERIFIED reproducibility
  // claim — and a release is the moment such a claim reaches real users. This is deliberately the
  // choke point rather than CI: harm materialises on SHIP, and the person cutting the release is the
  // one party who HAS the corpus and can discharge the obligation. It needs no corpus to FAIL (it
  // compares the ledger against computeHash, both committed) — only to be fixed.
  //
  // This exact gate would have blocked v1.10.1, which shipped a GlucoDex fixture that current code no
  // longer reproduced, and with it a pre-fix DSP that reached real users' CGM data.
  if (!SKIP_GATES) {
    for (const cmd of [
      ['node', 'tests/run-tests.mjs'],
      ['node', 'tests/verify-manifest.mjs'],
      ['node', 'tools/verify-fixtures.mjs', '--check']
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
  const build = ProvenanceLedger.loadNode({ readFileSync }, { join }, ROOT).buildManifest;
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
  // 4 · prune the consumed changesets. There are no committed list mirrors to regenerate: the
  //     docs-ledger / release-ledger gates read briefs/ + changes/ straight from the filesystem in
  //     the Node lane (the lane CI runs), so pruning changes/ needs no follow-up list write
  //     (CPAP-REAL-CORPUS-FOLLOWUPS-II §4).
  for (const c of changesets) unlinkSync(join(CHANGE_DIR, c.name));

  console.log(
    '\nReleased ' +
      to +
      '. Now:\n\n    node tools/build-docs.mjs   # project v' +
      to +
      ' into README + index.html + docs/about.json (check-6 surfaces)\n' +
      '    git add suite.manifest.json CHANGELOG.md RELEASE-MANIFEST.json CITATION.cff README.md index.html docs/about.json changes/ \\\n' +
      '      && git commit -m "release: v' +
      to +
      '"\n    git tag -s v' +
      to +
      ' -m "v' +
      to +
      '"   # -s = SIGNED → GitHub shows "Verified" (needs a GPG/SSH signing key; v1.8.0 was the last signed tag)\n' +
      '    git push && git push origin v' +
      to +
      '\n'
  );
}

main();
