#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * NO-NETWORK SURFACE PARITY — the gate's scope is closed, not remembered.
 *
 * `no-network.html` scans a surface list written by hand. A page added to the
 * repo joins no list, so the gate keeps passing and never looks at it. Measured
 * (row 2026-11-08-the-no-network-gate-reads-26-surfaces-of-a-wider-shipped-set):
 * the gate read 26 of 69 root pages, and a fetch planted in
 * `OxyDex Reference.html` passed it.
 *
 * This check reds when a root `*.html` sits in none of the gate's declared sets.
 * It never widens the gate itself — it refuses to let the repo grow past it.
 *
 *   node tools/no-network-surface-parity.mjs
 *   node tools/no-network-surface-parity.mjs --selftest
 *   node tools/no-network-surface-parity.mjs --verdict-sample
 *
 * A declared exclusion carries a REASON, because an exclusion is how a gate
 * stops examining something. A reason-less key reds as loudly as a missing page.
 * ════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { isCliEntry } from './argv-guard.mjs';
import { escapeRe } from './regex-escape-core.mjs';

const Verdict = createRequire(import.meta.url)('../verdict.js');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const GATE = 'no-network.html';

/** Pure. Pull an array literal of single-quoted strings out of the gate's source. */
export function parseList(src, name) {
  const m = new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];').exec(String(src || ''));
  if (!m) return null; // null, never [] — an unreadable list must fail closed
  return (m[1].match(/'[^']+'/g) || []).map((s) => s.slice(1, -1));
}

/** Pure. Pull the `{ 'key': 'reason' }` exclusion map out of the gate's source. */
export function parseExclusions(src) {
  const m = /const SURFACE_EXCLUDED = \{([\s\S]*?)\n\};/.exec(String(src || ''));
  if (!m) return null;
  const out = {};
  const re = /'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g;
  let e;
  while ((e = re.exec(m[1]))) out[e[1]] = e[2];
  return out;
}

/** Pure. Bundle page names from `provenance/index.json`'s `apps` array. */
export function bundleNames(index) {
  const apps = index && Array.isArray(index.apps) ? index.apps : null;
  if (!apps) return null;
  return apps.map((a) => (String(a).endsWith('.html') ? String(a) : String(a) + '.html'));
}

/**
 * Pure, and the whole decision. Returns every root page the gate's sets do not
 * account for, plus every exclusion key that carries no reason.
 *
 * An exclusion key may be a literal filename or a single `*` glob (`*.src.html`).
 */
export function classify(rootPages, sets, exclusions) {
  const declared = new Set();
  for (const list of Object.values(sets)) for (const n of list) declared.add(n);
  const globs = [];
  const literals = new Set();
  const reasonless = [];
  for (const [k, why] of Object.entries(exclusions)) {
    if (!String(why || '').trim()) reasonless.push(k);
    if (k.includes('*')) globs.push(new RegExp('^' + k.split('*').map(escapeRe).join('.*') + '$'));
    else literals.add(k);
  }
  const excluded = [];
  const unclassified = [];
  const scanned = [];
  for (const f of rootPages) {
    if (declared.has(f)) scanned.push(f);
    else if (literals.has(f) || globs.some((g) => g.test(f))) excluded.push(f);
    else unclassified.push(f);
  }
  return { scanned, excluded, unclassified, reasonless };
}

function headCommit() {
  try {
    return execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().slice(0, 9);
  } catch {
    return null;
  }
}

export function readRepo(root = ROOT) {
  const src = fs.readFileSync(path.join(root, GATE), 'utf8');
  const index = JSON.parse(fs.readFileSync(path.join(root, 'provenance/index.json'), 'utf8'));
  const sets = {
    bundles: bundleNames(index),
    orchestrators: parseList(src, 'ORCHESTRATORS'),
    analysis: parseList(src, 'ANALYSIS_PAGES'),
    site: parseList(src, 'SITE_PAGES')
  };
  const exclusions = parseExclusions(src);
  const unreadable = Object.entries(sets)
    .filter(([, v]) => v === null)
    .map(([k]) => k);
  if (exclusions === null) unreadable.push('SURFACE_EXCLUDED');
  const rootPages = fs
    .readdirSync(root)
    .filter((f) => /\.html$/.test(f))
    .sort();
  /* An unreadable declaration classifies nothing: it must not read as "every page is undeclared",
     and it must not read as a pass either. `classify` runs over the lists that WERE readable, and
     `unreadable` drives the verdict to UNKNOWN below (§🧾: it could not look). */
  const readable = Object.fromEntries(Object.entries(sets).filter(([, v]) => v !== null));
  const c = classify(rootPages, readable, exclusions || {});
  return { sets, exclusions: exclusions || {}, unreadable, rootPages, ...c };
}

export function buildVerdict(r, { commit, at } = {}) {
  const eligible = r.rootPages.length;
  const bad = r.unclassified.length + r.reasonless.length;
  const reasons = [];
  if (r.unreadable.length) reasons.push('unreadable declaration(s): ' + r.unreadable.join(', '));
  if (r.unclassified.length) reasons.push(r.unclassified.length + ' root page(s) in no declared set: ' + r.unclassified.join(', '));
  if (r.reasonless.length) reasons.push('exclusion(s) with no reason: ' + r.reasonless.join(', '));
  const status = r.unreadable.length ? 'UNKNOWN' : bad ? 'FAIL' : 'PASS';
  return Verdict.make({
    gate: 'no-network-surface-parity',
    status,
    population: { checked: r.scanned.length, eligible, excluded: eligible - r.scanned.length },
    criterion: { name: 'root_pages_in_no_declared_set', threshold: 0, unit: 'pages', direction: 'lte' },
    result: { unclassified: r.unclassified.length, reasonless: r.reasonless.length, scanned: r.scanned.length, excluded: r.excluded.length },
    evidence: ['no-network.html', 'tools/no-network-surface-parity.mjs', 'provenance/index.json'],
    reason: reasons.length ? reasons.join(' · ') : null,
    producedBy: { tool: 'tools/no-network-surface-parity.mjs', commit: commit === undefined ? headCommit() : commit, commitReason: commit === null ? 'not a git checkout' : undefined },
    at
  });
}

/* `isCliEntry` answers on the path AS WRITTEN, so a symlink to this tool still reads as the entry;
   a raw argv[1] comparison does not (tools/argv-guard.mjs, row on the retired exemption). */
const IS_MAIN = isCliEntry(import.meta.url);

if (IS_MAIN && process.argv.includes('--selftest')) {
  let pass = 0;
  let total = 0;
  const ok = (name, cond, detail) => {
    total++;
    if (cond) pass++;
    console.log((cond ? '  ✓ ' : '  ✕ ') + name + (cond || !detail ? '' : ' — ' + detail));
  };

  ok('parseList reads a declared array', (parseList("const A = ['x.html','y.html'];", 'A') || []).join(',') === 'x.html,y.html');
  ok('parseList FAILS CLOSED on an absent list (null, never [])', parseList('const B = 1;', 'A') === null);
  ok('parseExclusions reads key and reason', (parseExclusions("const SURFACE_EXCLUDED = {\n 'a.html': 'because'\n};") || {})['a.html'] === 'because');
  ok('parseExclusions fails closed when the map is absent', parseExclusions('nothing here') === null);
  ok('bundleNames appends .html once', (bundleNames({ apps: ['OxyDex', 'X.html'] }) || []).join(',') === 'OxyDex.html,X.html');
  ok('bundleNames fails closed on a non-array', bundleNames({ apps: { 0: 'OxyDex' } }) === null);

  const sets = { a: ['in.html'] };
  const exc = { 'out.html': 'a reason', '*.src.html': 'a build input' };
  const c1 = classify(['in.html', 'out.html', 'thing.src.html', 'NEW.html'], sets, exc);
  ok('a declared page counts as scanned', c1.scanned.join(',') === 'in.html');
  ok('a literal exclusion counts as excluded', c1.excluded.includes('out.html'));
  ok('a glob exclusion matches by suffix', c1.excluded.includes('thing.src.html'));
  ok('AN UNDECLARED PAGE IS NAMED, which is the whole check', c1.unclassified.join(',') === 'NEW.html');
  ok('a reason-less exclusion is named too', classify([], {}, { 'x.html': '  ' }).reasonless.join(',') === 'x.html');
  ok('a glob never swallows a different suffix', !classify(['a.src.htm'], {}, { '*.src.html': 'r' }).excluded.length);

  /* THE PLANT: the real repo must read clean, and one invented page must red it. A check that
     passes on both sides has measured nothing (§4b). */
  const real = readRepo();
  const vReal = buildVerdict(real, { commit: 'deadbeef', at: '2026-01-01T00:00:00Z' });
  ok('the real repo classifies every root page', vReal.status === 'PASS', vReal.reason || '');
  const planted = { ...real, rootPages: real.rootPages.concat('planted-surface.html'), unclassified: ['planted-surface.html'] };
  const vPlant = buildVerdict(planted, { commit: 'deadbeef', at: '2026-01-01T00:00:00Z' });
  ok('a planted page reds the verdict and names itself', vPlant.status === 'FAIL' && /planted-surface\.html/.test(vPlant.reason || ''));
  ok('an unreadable declaration is UNKNOWN, never PASS', buildVerdict({ ...real, unreadable: ['site'] }, { commit: 'deadbeef' }).status === 'UNKNOWN');

  const val = Verdict.validate(vReal);
  ok('the verdict object validates against tepna.verdict/1', val.ok === true, (val.errors || []).join('; '));

  console.log('\nPASS (' + pass + '/' + total + ')');
  process.exit(pass === total ? 0 : 1);
}

if (IS_MAIN && !process.argv.includes('--selftest')) {
  const sample = process.argv.includes('--verdict-sample');
  const r = readRepo();
  const v = buildVerdict(r);
  if (sample) {
    console.log(JSON.stringify(v));
    process.exit(0);
  }
  console.log(JSON.stringify(v));
  console.log(
    '\n▸ no-network surface parity: ' +
      r.scanned.length +
      ' of ' +
      r.rootPages.length +
      ' root page(s) declared, ' +
      r.excluded.length +
      ' excluded with a reason, ' +
      r.unclassified.length +
      ' in no set'
  );
  if (r.unclassified.length) {
    console.log('  ✕ add each page below to a set in no-network.html, or exclude it with a reason:');
    for (const f of r.unclassified) console.log('      ' + f);
  }
  if (r.reasonless.length) console.log('  ✕ exclusion(s) with no reason: ' + r.reasonless.join(', '));
  if (r.unreadable.length) console.log('  ⏱ UNEXAMINED declaration(s): ' + r.unreadable.join(', '));
  process.exit(v.status === 'PASS' ? 0 : r.unreadable.length ? 2 : 1);
}
