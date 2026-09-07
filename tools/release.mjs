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
import { pathToFileURL } from 'node:url';
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

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const fmtInt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/* The capture lane's test count, by COLLECTION only (no run — check.sh owns the run). Reported as
   "N,N00+" the way the README states it: a floor, so it stays true while the count grows. null when
   the venv is absent — "not measured" is printed, never a number. */
function countPyTests() {
  const py = p('capture-host', '.venv', 'bin', 'python');
  if (!existsSync(py)) return null;
  const r = spawnSync(py, ['-m', 'pytest', '--co', '-q'], { cwd: p('capture-host'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const m = (r.stdout || '').match(/(\d+) tests? collected/);
  return m ? +m[1] : null;
}

/* ── README ACCURACY — the front page's ledger-derivable numbers are checked and stamped AT THE CUT ──
   The version, badge and release count are build-docs' (its stampRules; do not copy them here). What
   nothing projected until 2026-09-07 was everything ELSE the front page counts: pending changesets and
   their split, assertions/groups, Python tests, and the "Since vX (dates, commits, changesets)" header of
   the release narrative — five numbers that had each drifted by the time the 2.10.0 cut was previewed
   (142→159 · 9,124→9,217 · 583→586 · 6,500+→6,800+ · 296→350). The rows below carry the README's
   current text beside the measured value; --dry-run prints them, the cut writes them. Prose claims
   inside the narrative are authored and are NOT checkable here — the last line says so every time. */
function readmeAudit(txt, ctx) {
  const rows = [];
  // readme = what the front page says · now = what is true as this runs · cut = what the cut writes
  const row = (what, readme, now, cut, apply) => rows.push({ what, readme, now, cut, apply: cut != null && apply ? apply : null });

  const split = ctx.pendingSplit; // { n, minor, patch, major, level } of the changesets being consumed
  const pend = txt.match(/with \*\*(\d+|no) changesets?\*\* pending since(?: \(([^)]*)\))?/);
  row(
    'pending changesets',
    pend ? pend[1] + (pend[2] ? ' (' + pend[2] + ')' : '') : '(marker missing)',
    split.n + ' (' + split.minor + ' minor · ' + split.patch + ' patch · ' + split.major + ' major — the next cut is a ' + split.level.toUpperCase() + ')',
    '0 (the tree is exactly the release)',
    pend ? (t) => t.replace(pend[0], 'with **0 changesets** pending since (the tree is exactly the release)') : null
  );
  const asr = txt.match(/\*\*([\d,]+) assertions\*\* across \*\*([\d,]+) groups\*\*/);
  const asrNow = ctx.assertions != null ? fmtInt(ctx.assertions) + ' / ' + ctx.groups : null;
  row(
    'assertions / groups',
    asr ? asr[1] + ' / ' + asr[2] : '(marker missing)',
    asrNow,
    asrNow,
    asr ? (t) => t.replace(asr[0], '**' + fmtInt(ctx.assertions) + ' assertions** across **' + ctx.groups + ' groups**') : null
  );
  const pyt = txt.match(/\*\*([\d,]+)\+ Python tests\*\*/);
  const pyFloor = ctx.pyTests != null ? fmtInt(Math.floor(ctx.pyTests / 100) * 100) + '+' : null;
  row('Python tests', pyt ? pyt[1] + '+' : '(marker missing)', pyFloor, pyFloor, pyt ? (t) => t.replace(pyt[0], '**' + pyFloor + ' Python tests**') : null);
  // The narrative header. "Since `X` (…)" is the between-releases form and is converted to the shipped
  // form "In `Y` (…)" at the cut. An "In" form already present means the narrative was never rewritten
  // after the LAST cut — it describes the previous release, and only its author can fix that.
  const since = txt.match(/\*\*Since `(\d+\.\d+\.\d+)` \((\d{4}-\d{2}-\d{2}) → (\d{4}-\d{2}-\d{2}), (\d+) commits, (\d+) changesets\)\.\*\*/);
  const inHdr = txt.match(/\*\*In `(\d+\.\d+\.\d+)` \(([^)]*)\)\.\*\*/);
  const span = ctx.fromDate + ' → ' + ctx.date + ', ' + (ctx.commits == null ? '?' : ctx.commits) + ' commits, ' + split.n + ' changesets';
  const cutHdr = 'In `' + ctx.to + '` (' + span + ')';
  row(
    'release narrative header',
    since
      ? 'Since `' + since[1] + '` (' + since[2] + ' → ' + since[3] + ', ' + since[4] + ' commits, ' + since[5] + ' changesets)'
      : inHdr
        ? 'In `' + inHdr[1] + '` (' + inHdr[2] + ')'
        : '(marker missing)',
    since ? 'Since `' + ctx.from + '` (' + span + ')' : inHdr ? 'STALE — describes ' + inHdr[1] + '; the ' + ctx.to + ' paragraph is authored prose, write it' : null,
    since ? cutHdr : null,
    since ? (t) => t.replace(since[0], '**' + cutHdr + '.**') : null
  );
  return rows;
}

function printReadmeAudit(rows, dry) {
  console.log('\nREADME.md accuracy (ledger-derivable numbers; version · badge · release count are build-docs’):');
  for (const r of rows) {
    const ok = r.now != null && r.readme === r.now;
    let line = '  ' + (r.now == null ? '?' : ok ? '=' : '≠') + ' ' + r.what.padEnd(25) + ' README: ' + r.readme;
    if (r.now == null) line += '   (not measured)';
    else if (!ok) line += '   → now: ' + r.now;
    if (r.cut != null && r.cut !== r.now) line += (dry ? '   → cut writes: ' : '   → written: ') + r.cut;
    console.log(line);
  }
  console.log('  ! prose claims in the release narrative are authored — re-read them; nothing here can check a sentence.');
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
  // The suite's own summary line is captured (and echoed) so the README's assertion count below is read
  // off THE run that gated this cut — not typed from memory, which is how it sat at 9,124 for a week.
  const measured = { assertions: null, groups: null, pyTests: null };
  if (!SKIP_GATES) {
    for (const cmd of [
      ['node', 'tests/run-tests.mjs'],
      ['node', 'tests/verify-manifest.mjs'],
      ['node', 'tools/verify-fixtures.mjs', '--check']
    ]) {
      const r = spawnSync(cmd[0], cmd.slice(1), { cwd: ROOT, stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
      process.stdout.write(r.stdout || '');
      if (r.status !== 0) {
        console.error('\nGate failed: ' + cmd.join(' ') + ' — refusing to release. (--skip-gates is dev-only.)');
        process.exit(3);
      }
      if (cmd[1] === 'tests/run-tests.mjs') {
        const m = stripAnsi(r.stdout || '').match(/✓ all (\d+) assertions passed.*?\((\d+) groups\)/);
        if (m) {
          measured.assertions = +m[1];
          measured.groups = +m[2];
        }
      }
    }
    measured.pyTests = countPyTests();
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

  // README accuracy rows — computed once, printed in both modes, written only on the cut.
  const releasesSoFar = readJSON('RELEASE-MANIFEST.json').releases;
  const prev = releasesSoFar.find((r) => r.version === from) || releasesSoFar[releasesSoFar.length - 1];
  const rl = spawnSync('git', ['rev-list', '--count', 'v' + from + '..HEAD'], { cwd: ROOT, encoding: 'utf8' });
  const commits = rl.status === 0 && /^\d+\s*$/.test(rl.stdout) ? +rl.stdout : null;
  const count = (b) => changesets.filter((c) => c.bump === b).length;
  const readmeText = existsSync(p('README.md')) ? readFileSync(p('README.md'), 'utf8') : null;
  const readmeRows = readmeText
    ? readmeAudit(readmeText, {
        from,
        to,
        date,
        fromDate: prev ? prev.date : '?',
        commits,
        pendingSplit: { n: changesets.length, minor: count('minor'), patch: count('patch'), major: count('major'), level },
        assertions: measured.assertions,
        groups: measured.groups,
        pyTests: measured.pyTests
      })
    : [];

  if (DRY) {
    console.log('DRY RUN: ' + from + ' \u2192 ' + to + ' (' + level + ')\n\n' + section);
    console.log('Would consume: ' + changesets.map((c) => c.name).join(', '));
    if (readmeRows.length) printReadmeAudit(readmeRows, true);
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
  // 3c · README — stamp the ledger-derivable counts (see readmeAudit); build-docs stamps the version.
  if (readmeRows.length) {
    let rd = readmeText;
    for (const r of readmeRows) if (r.apply) rd = r.apply(rd);
    if (rd !== readmeText) writeFileSync(p('README.md'), rd);
    printReadmeAudit(readmeRows, false);
  }
  // 4 · prune the consumed changesets. There are no committed list mirrors to regenerate: the
  //     docs-ledger / release-ledger gates read briefs/ + changes/ straight from the filesystem in
  //     the Node lane (the lane CI runs), so pruning changes/ needs no follow-up list write
  //     (CPAP-REAL-CORPUS-FOLLOWUPS-II §4).
  for (const c of changesets) unlinkSync(join(CHANGE_DIR, c.name));

  console.log(
    '\nReleased ' +
      to +
      '. Now:\n\n    node tools/build.mjs        # \u00a7\ud83d\udce6 re-stamps the fleet displayed version (manifestHash-INVARIANT: zero fixtures move); build:check reds until run\n    node tools/build-docs.mjs   # projects v' +
      to +
      ' into the deploy surfaces, then PRINTS the exact `git add` line for what it wrote\n' +
      '    # ↑ stage BOTH lists. The line below carries only what release.mjs itself wrote; every\n' +
      '    #   deploy path belongs to build-docs and comes from the paths build-docs just printed.\n' +
      '    #   Do not re-hardcode them here — a copy in this file drifted and silently omitted four.\n' +
      '    git add suite.manifest.json CHANGELOG.md RELEASE-MANIFEST.json CITATION.cff changes/ \\\n' +
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
/* ⚠️ ENTRY GUARD — WITHOUT IT THIS FILE RUNS ITS CLI THE MOMENT ANYTHING IMPORTS IT.
   Compared by RESOLVED PATH so it survives a symlink, a rename or a wrapper (the same reason
   `doc-search.mjs`'s `isEntryPoint` resolves rather than string-compares). Swept 2026-08-19 after
   `device-stability.mjs` was found unimportable for the sibling reason: of 143 `tools/*.mjs`, 48
   guarded, 90 have no entry point at all, and a handful executed on import. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
