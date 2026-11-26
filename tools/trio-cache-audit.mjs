/*
 * tools/trio-cache-audit.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * THE TRIO FOLD CACHE, AUDITED AS A GATE.
 *
 * `tools/trio-batch.mjs` writes one `.trio-stamp` per folded night, and `--skip-existing` trusts that
 * stamp as the record that the night's exports are the ones this code wrote from these inputs. Every
 * gate that read the stamp before this tool checked PRESENCE: a stamp beside three trio exports
 * (`tools/trio-eligible-nights.mjs`, `tools/fold-generation.mjs`). None of them read the BYTES, so a
 * stamp could certify an export that no fold under its digest ever wrote, and every gate stayed green.
 *
 * The defect that made this concrete (2026-11-26): from #5711 on, `ecgdex-dsp.js` and `ppgdex-dsp.js`
 * threw in the fold realm because `sq-table.js` was absent from it. The fold does not clear a night
 * before it recomputes, so each failed leg left the PREVIOUS fold's export on disk. On the split path
 * the parent stamped a night when each child exited 0 and three trio exports existed on disk, and a
 * child whose node threw still exited 0. That stamp then bound new code to an old export. That is
 * silent data loss in the one form the verification machinery exists to prevent: the output a reader
 * trusts is not the output the stated code produced, and nothing says so.
 *
 * The fold now records the sha256 of every node-export it wrote that night in the stamp (`exports`).
 * This tool holds each stamped night against that record. A night FAILS when:
 *   stamp-unreadable              the stamp does not parse
 *   stamp-has-no-node-set         the stamp names no node set, so it certifies nothing checkable
 *   stamp-binds-no-bytes          the stamp carries no `exports` record (written before the binding)
 *   stamped-export-missing        a node the stamp names has no export file
 *   stamped-node-unbound          a node the stamp names is absent from its `exports` record
 *   bound-export-missing          a file the record binds is absent
 *   export-bytes-moved            a file's bytes no longer hash to the recorded value
 *   unbound-export-in-night       a node-export sits in a stamped night and the record does not bind it,
 *                                 so it has no recorded code era (a leftover of an earlier fold)
 * A night with no stamp is not a cache entry. The tool counts it and judges nothing about it.
 *
 *   node tools/trio-cache-audit.mjs                   # audit uploads/trio; exit 1 on FAIL
 *   node tools/trio-cache-audit.mjs --dir <out>       # audit another fold output tree
 *   node tools/trio-cache-audit.mjs --json            # the verdict object alone on stdout
 *   node tools/trio-cache-audit.mjs --verdict-sample  # the verdict over a scratch tree, no corpus
 *   node tools/trio-cache-audit.mjs --selftest        # known answers over synthetic nights, no corpus
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';
import { populationVerdict, snapshotNights } from './corpus-scope-core.mjs';
import { judgeRootOrDie } from './write-root.mjs';

const Verdict = createRequire(import.meta.url)('../verdict.js');
const STAMP = '.trio-stamp';
const NIGHT_DIR = /^\d{4}-\d{2}-\d{2}$/;
const EXPORT_FILE = /\.node-export\.json$/;

export const FAIL_REASONS = [
  'stamp-unreadable',
  'stamp-has-no-node-set',
  'stamp-binds-no-bytes',
  'stamped-export-missing',
  'stamped-node-unbound',
  'bound-export-missing',
  'export-bytes-moved',
  'unbound-export-in-night'
];

/* The one hash the fold writes and this tool reads: sha256 over the file's bytes, lowercase hex. */
export const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');

/* PURE. One night: its key, the stamp's text (null when there is no stamp), the node-export file names
   in the folder, and a hash reader. Returns { state: 'unstamped' | 'ok' | 'fail', reasons: [...] }. */
export function auditNight(key, stampText, exportFiles, hashOf) {
  if (stampText == null) return { key, state: 'unstamped', reasons: [] };
  let st;
  try {
    st = JSON.parse(stampText);
  } catch (_e) {
    return { key, state: 'fail', reasons: ['stamp-unreadable'] };
  }
  if (!st || typeof st !== 'object' || !Array.isArray(st.nodes) || !st.nodes.length) return { key, state: 'fail', reasons: ['stamp-has-no-node-set'] };
  const have = new Set(exportFiles);
  const reasons = [];
  const nodeFile = (n) => `${n}_${key}.node-export.json`;
  for (const n of st.nodes) if (!have.has(nodeFile(n))) reasons.push(`stamped-export-missing:${n}`);
  const bound = st.exports && typeof st.exports === 'object' && !Array.isArray(st.exports) ? st.exports : null;
  if (!bound) {
    reasons.push('stamp-binds-no-bytes');
    return { key, state: 'fail', reasons };
  }
  for (const n of st.nodes) if (!Object.hasOwn(bound, nodeFile(n))) reasons.push(`stamped-node-unbound:${n}`);
  for (const [f, want] of Object.entries(bound)) {
    if (!have.has(f)) reasons.push(`bound-export-missing:${f}`);
    else if (hashOf(f) !== want) reasons.push(`export-bytes-moved:${f}`);
  }
  for (const f of exportFiles) if (!Object.hasOwn(bound, f)) reasons.push(`unbound-export-in-night:${f}`);
  return { key, state: reasons.length ? 'fail' : 'ok', reasons };
}

/* PURE. The verdict over the per-night results. */
export function verdictFor(rows, { dir, commit = null, at = new Date().toISOString() } = {}) {
  const stamped = rows.filter((r) => r.state !== 'unstamped');
  const failed = stamped.filter((r) => r.state === 'fail');
  const tally = {};
  for (const r of failed)
    for (const x of r.reasons) {
      const k = x.split(':')[0];
      tally[k] = Object.hasOwn(tally, k) ? tally[k] + 1 : 1;
    }
  const status = !stamped.length ? 'NOT_RUN' : failed.length ? 'FAIL' : 'PASS';
  const reason = !stamped.length
    ? `no stamped night under ${dir}, so no cache entry was examined`
    : failed.length
      ? `${failed.length} of ${stamped.length} stamped night(s) fail the integrity audit: ` + failed.map((r) => `${r.key} (${r.reasons.join(', ')})`).join('; ')
      : null;
  return {
    schema: 'tepna.verdict/1',
    gate: 'trio-cache-integrity',
    status,
    scope: 'internal',
    population: { checked: stamped.length, eligible: stamped.length, excluded: 0 },
    criterion: { name: 'stamped_nights_failing_integrity', threshold: 0, unit: 'nights', direction: 'lte' },
    result: !stamped.length
      ? null
      : {
          nightFolders: rows.length,
          stamped: stamped.length,
          unstamped: rows.length - stamped.length,
          failed: failed.length,
          byReason: tally,
          failedNights: failed.map((r) => ({ night: r.key, reasons: r.reasons.slice() }))
        },
    evidence: ['tools/trio-cache-audit.mjs', `${dir}/<night>/.trio-stamp`, `${dir}/<night>/*.node-export.json`],
    reason,
    producedBy: { tool: 'tools/trio-cache-audit.mjs', commit, ...(commit ? {} : { commitReason: 'not run inside a git tree' }) },
    at
  };
}

/* I/O. Walk one fold output tree. */
export function auditTree(absDir) {
  const rows = [];
  if (!existsSync(absDir)) return rows;
  for (const key of readdirSync(absDir).sort()) {
    const nd = join(absDir, key);
    if (!NIGHT_DIR.test(key) || !statSync(nd).isDirectory()) continue;
    const sp = join(nd, STAMP);
    const stampText = existsSync(sp) ? readFileSync(sp, 'utf8') : null;
    const files = readdirSync(nd)
      .filter((f) => EXPORT_FILE.test(f))
      .sort();
    rows.push(auditNight(key, stampText, files, (f) => sha256Hex(readFileSync(join(nd, f)))));
  }
  return rows;
}

function headCommit(root) {
  try {
    return (
      execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || null
    );
  } catch (_e) {
    return null;
  }
}

/* The population this run walked. A snapshot of the night folders before the walk and one after it go to
   `populationVerdict`, so a night that appears or leaves during the audit is named, not silently absorbed.
   It is a second verdict beside the integrity one: that one answers "do the bound bytes hold", this one
   answers "which nights did this run cover". */
function build(dirArg, root) {
  const abs = resolve(root, dirArg);
  const rel = abs.startsWith(root + '/') ? abs.slice(root.length + 1) : abs;
  const before = snapshotNights(abs);
  const v = verdictFor(auditTree(abs), { dir: rel, commit: headCommit(root) });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`trio-cache-audit: the verdict is invalid under verdict.js — ${chk.errors.join(' | ')}`);
  const population = populationVerdict(before, snapshotNights(abs), { tool: 'tools/trio-cache-audit.mjs', evidence: ['tools/trio-cache-audit.mjs', 'tools/corpus-scope-core.mjs'] });
  return { v, population };
}

function selftest() {
  let legs = 0,
    fails = 0;
  const ok = (name, got, want) => {
    legs++;
    const pass = JSON.stringify(got) === JSON.stringify(want);
    if (!pass) fails++;
    console.log(`  ${pass ? '✓' : '✗'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  };
  const K = '2026-07-17';
  const F = (n) => `${n}_${K}.node-export.json`;
  const NODES = ['ECGDex', 'OxyDex', 'PpgDex'];
  const bytes = { [F('ECGDex')]: 'e', [F('OxyDex')]: 'o', [F('PpgDex')]: 'p', [F('PpgDexFinger')]: 'f' };
  const hashOf = (f) => sha256Hex(Buffer.from(bytes[f]));
  const bindAll = (files) => Object.fromEntries(files.map((f) => [f, hashOf(f)]));
  const trio = NODES.map(F);
  const stamp = (o) => JSON.stringify({ codeDigest: 'x', nodes: NODES, ...o });
  const state = (r) => [r.state, ...r.reasons.map((x) => x.split(':')[0])];

  ok('a night with no stamp is not a cache entry', state(auditNight(K, null, trio, hashOf)), ['unstamped']);
  ok('a bound night whose bytes match passes', state(auditNight(K, stamp({ exports: bindAll(trio) }), trio, hashOf)), ['ok']);
  ok('…with its site export bound too', state(auditNight(K, stamp({ exports: bindAll([...trio, F('PpgDexFinger')]) }), [...trio, F('PpgDexFinger')], hashOf)), ['ok']);
  ok('an unparseable stamp fails', state(auditNight(K, '{', trio, hashOf)), ['fail', 'stamp-unreadable']);
  ok('a stamp with no node set fails', state(auditNight(K, JSON.stringify({ codeDigest: 'x' }), trio, hashOf)), ['fail', 'stamp-has-no-node-set']);
  ok('🔴 a stamp that binds no bytes fails (the pre-binding stamp)', state(auditNight(K, stamp({}), trio, hashOf)), ['fail', 'stamp-binds-no-bytes']);
  ok('a stamped node with no export fails', state(auditNight(K, stamp({ exports: bindAll(trio) }), trio.slice(0, 2), hashOf)), ['fail', 'stamped-export-missing', 'bound-export-missing']);
  ok('a stamped node absent from the record fails', state(auditNight(K, stamp({ exports: bindAll(trio.slice(0, 2)) }), trio, hashOf)), ['fail', 'stamped-node-unbound', 'unbound-export-in-night']);
  const moved = bindAll(trio);
  moved[F('ECGDex')] = sha256Hex(Buffer.from('an older fold'));
  ok('🔴 an export whose bytes moved fails (the stale leg the split path stamped)', state(auditNight(K, stamp({ exports: moved }), trio, hashOf)), ['fail', 'export-bytes-moved']);
  ok('🔴 a leftover export the record does not bind fails', state(auditNight(K, stamp({ exports: bindAll(trio) }), [...trio, F('PpgDexFinger')], hashOf)), ['fail', 'unbound-export-in-night']);

  const rowsOk = [auditNight(K, stamp({ exports: bindAll(trio) }), trio, hashOf), auditNight('2026-07-18', null, [], hashOf)];
  const vOk = verdictFor(rowsOk, { dir: 'uploads/trio', commit: 'deadbeef', at: '2026-01-01T00:00:00Z' });
  ok('the verdict PASSes over one good stamped night', vOk.status, 'PASS');
  ok('…counts the unstamped folder without judging it', [vOk.result.stamped, vOk.result.unstamped, vOk.population.checked], [1, 1, 1]);
  ok('…and validates under verdict.js', Verdict.validate(vOk).ok, true);
  const vBad = verdictFor([auditNight(K, stamp({ exports: moved }), trio, hashOf)], { dir: 'uploads/trio', commit: 'deadbeef', at: '2026-01-01T00:00:00Z' });
  ok('a moved export FAILs the run', vBad.status, 'FAIL');
  ok('…tallies the reason', vBad.result.byReason, { 'export-bytes-moved': 1 });
  ok('…and still validates (a FAIL is a verdict, not an error)', Verdict.validate(vBad).ok, true);
  const vNone = verdictFor([auditNight(K, null, trio, hashOf)], { dir: 'uploads/trio', commit: 'deadbeef', at: '2026-01-01T00:00:00Z' });
  ok('no stamped night is NOT_RUN, never PASS over nothing', vNone.status, 'NOT_RUN');
  ok('…and validates', Verdict.validate(vNone).ok, true);

  console.log(fails ? `\ntrio-cache-audit --selftest: ${fails} FAILED of ${legs}` : `\ntrio-cache-audit --selftest: all ${legs} selftests passed`);
  return fails === 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      readFileSync(fileURLToPath(import.meta.url), 'utf8')
        .split('\n')
        .slice(7, 42)
        .join('\n')
    );
    return 0;
  }
  if (args.includes('--selftest')) return selftest() ? 0 : 1;
  if (args.includes('--verdict-sample')) {
    const K = '2026-01-01';
    const f = `ECGDex_${K}.node-export.json`;
    const h = sha256Hex(Buffer.from('{}'));
    const v = verdictFor([auditNight(K, JSON.stringify({ nodes: ['ECGDex'], exports: { [f]: h } }), [f], () => h)], { dir: 'scratch', commit: headCommit(judgeRootOrDie(import.meta.url)) });
    console.log(JSON.stringify(v, null, 2));
    return 0;
  }
  const di = args.indexOf('--dir');
  /* The checkout this run judges is the one the caller stands in, and `judgeRootOrDie` refuses (exit 2)
     when this file belongs to a different checkout than the cwd. */
  const { v, population } = build(di >= 0 && args[di + 1] ? args[di + 1] : 'uploads/trio', judgeRootOrDie(import.meta.url));
  if (args.includes('--json')) {
    console.log(JSON.stringify(v, null, 2));
    console.error('POPULATION ' + JSON.stringify(population));
    return v.status === 'FAIL' ? 1 : 0;
  }
  console.log('POPULATION ' + JSON.stringify(population));
  console.log(JSON.stringify({ ...v, reason: v.reason && v.reason.length > 600 ? v.reason.slice(0, 600) + ' … (--json prints the whole object)' : v.reason }));
  console.log(
    v.result
      ? `\ntrio-cache-audit: ${v.status} — ${v.result.stamped} stamped night(s) audited, ${v.result.failed} failed (${JSON.stringify(v.result.byReason)}), ${v.result.unstamped} unstamped folder(s) not judged`
      : `\ntrio-cache-audit: ${v.status} — ${v.reason}`
  );
  return v.status === 'FAIL' ? 1 : 0;
}

if (isCliEntry(import.meta.url)) process.exit(main());
