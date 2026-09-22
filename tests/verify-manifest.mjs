/*
 * tests/verify-manifest.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 */
/* ════════════════════════════════════════════════════════════════════════
   tests/verify-manifest.mjs — headless GATE A + GATE B (provenance, pure-Node)
   ────────────────────────────────────────────────────────────────────────
   EXPORT-IDENTITY-FOLLOWUPS-IV §1 (GATE A) + SIGNAL-ADAPTER-AND-FRONTIER Phase 7
   (GATE B). The PROVENANCE lane's pure-Node sibling of verify-provenance.html:
   GATE A — for all 8 bundles, recompute the executed-code manifestHash (SHA-256
   [0:12] of the bundle FILE's `__bundler/manifest` projection) and assert it equals
   BUILD-MANIFEST.json. GATE B — the CONTENT-ADDRESSED known-answer audit: for each
   FIXTURE-PROVENANCE.json record, recompute sha256[0:16] of every committed input +
   the committed output and assert the known-answer triple (input + manifestHash ->
   output) still holds. Exit 0 = all pass, 1 = drift / missing / stale-manifest, 2 =
   setup error.

   GATE B is BEST-EFFORT in Node: uploads/ is gitignored (personal health data), so
   its committed fixtures/inputs may be ABSENT in CI — those rows SKIP (not fail),
   mirroring the equiv-gate's existsSync self-skip. Where uploads/ IS present (local /
   this environment) GATE B fully verifies. The browser page (uploads/ served) is the
   authoritative GATE-B surface; this lane adds a fast Node check with no buildHash.

   WHY THIS EXISTS — EXPORT-IDENTITY-FOLLOWUPS-II FOUND a pre-existing CPAPDex /
   Integrator drift (BUILD-MANIFEST recorded one hash, the on-disk bundles hashed
   another) that had been verify-provenance GATE-A red for an unknown window. It
   was caught ONLY because that pass happened to recompute every bundle's hash by
   hand. Nothing caught the class CONTINUOUSLY: GATE A bit only when a human opened
   verify-provenance.html (the heavier Playwright browser-gates lane aside). This
   wires that exact recompute into the FAST pure-Node lane (tests.yml), so
   "re-bundled but forgot BUILD-MANIFEST" (or edited the manifest without
   re-bundling) reds automatically on every push/PR.

   GATE SEPARATION (CLAUDE.md): this is a PROVENANCE / content recompute, NOT a
   behavior assertion — it stays OUT of dex-tests.js / Dex-Test-Suite.html
   ("Behavior is gated separately"). It SHARES both gate cores (manifest extraction
   + hash + compare for GATE A; sha16 + gateBFiles + gateBEvaluate for GATE B) with
   the verify-provenance PAGE via manifest-gate.js, so the page and CI can't drift
   (the provenance-banner.js precedent). Zero npm deps; uses Node's Web Crypto
   (globalThis.crypto), the same algorithm the browser runs, so digests are
   byte-identical to the page's.
   ════════════════════════════════════════════════════════════════════════ */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guarantee the shared module's globalThis.crypto.subtle resolves on any Node >= 16. It is a
// global from v18 (CI pins node 20); this is belt-and-suspenders and uses the SAME Web Crypto
// SHA-256, so it introduces no algorithm drift vs the browser path.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const ManifestGate = require(join(ROOT, 'manifest-gate.js'));
// P3 (ARCHITECTURE-DEBT-REDUCTION §P3): the two monolith ledgers are split into per-app
// provenance/<App>.json fragments; ProvenanceLedger.loadNode reassembles the identical
// { buildManifest:{bundles}, fixtureProvenance:{fixtures} } shape the gate cores expect.
const ProvenanceLedger = require(join(ROOT, 'provenance-ledger.js'));
import { aggregateChildren, makeVerdict } from '../tools/verdict-emit.mjs';

/* ── VERDICT-CONTRACT §3d — one tepna.verdict/1 object over the two gates ─────────────────────────
   Population = the bundles GATE A checks + the fixtures GATE B audits (+ the page-wiring guard).
   Children: a bundle whose manifestHash matches ⇒ PASS, drifted/missing/unrecorded ⇒ FAIL; a fixture
   reproducible or historical-ok ⇒ PASS, drifted ⇒ FAIL, absent/unloaded (uploads/ is gitignored —
   the header's declared SKIP class) ⇒ NOT_APPLICABLE: checked, not binding, never green evidence.
   `--bundle=` is a declared exclusion ⇒ filtered:true with the consumer rule. A setup error (exit 2)
   is NOT_RUN with the reason. `--json` prints the object on stdout (report → stderr); the exit code
   stays. Pure, so `--selftest` can plant every row without hashing a bundle. */
export function provenanceVerdict({ gateA, gateB, wiring = null, totalBundles, bundleFilter = null, setupError = null }, { commit, commitReason, at } = {}) {
  const criterion = {
    name: 'children_failing (GATE A: every bundle manifestHash equals its committed value; GATE B: every fixture reproduces its content-addressed triple; an absent fixture input is NOT_APPLICABLE; --bundle= is a declared exclusion)',
    threshold: 0,
    unit: 'failing children',
    direction: 'eq'
  };
  const base = { gate: 'verify-manifest', criterion, evidence: ['provenance/*.json', 'manifest-gate.js'], tool: 'tests/verify-manifest.mjs', commit, commitReason, at };
  if (setupError) return makeVerdict({ ...base, status: 'NOT_RUN', population: { checked: 0, eligible: 0, excluded: 0 }, result: null, reason: 'setup error — ' + setupError });
  const children = [];
  for (const r of gateA.results || []) children.push({ name: `GATE A · ${r.file}`, provenance: 'hash', status: r.status === 'match' ? 'PASS' : 'FAIL', why: r.status });
  if (wiring) children.push({ name: 'GATE A · verify-provenance.html sources manifest-gate.js', provenance: 'source-scan', status: wiring.ok ? 'PASS' : 'FAIL' });
  for (const r of gateB.results || []) {
    const st = r.status === 'reproducible' || r.status === 'historical-ok' ? 'PASS' : /-absent$|unloaded$/.test(r.status) ? 'NOT_APPLICABLE' : 'FAIL';
    children.push({ name: `GATE B · ${r.name}`, provenance: 'hash', status: st, why: r.status });
  }
  const excludedBundles = bundleFilter ? Math.max(0, totalBundles - (gateA.results || []).length) : 0;
  const agg = aggregateChildren(children, { eligible: children.length + excludedBundles, declaredExcluded: excludedBundles, excludedBy: bundleFilter ? `--bundle=${bundleFilter}` : null });
  let { status, reason, result } = agg;
  if (result)
    result = {
      ...result,
      gateA: { checked: gateA.checked, fail: gateA.fail, missing: gateA.missing || 0 },
      gateB: { checked: gateB.checked, fail: gateB.fail, absent: gateB.absent },
      children: result.children.map((c, i) => ({ ...c, ...(children[i].why ? { why: children[i].why } : {}) }))
    };
  if (bundleFilter && excludedBundles === 0 && result) {
    /* a filter that matched every bundle excluded nothing, but it is still a scoped invocation */
    result.filtered = true;
    result.excludedBy = `--bundle=${bundleFilter}`;
  }
  return makeVerdict({ ...base, status, population: agg.population, result, reason });
}

export function verdictSample() {
  const gateA = {
    checked: 9,
    fail: 0,
    missing: 0,
    results: ['OxyDex', 'HRVDex', 'PulseDex', 'GlucoDex', 'ECGDex', 'CPAPDex', 'MotionDex', 'PpgDex', 'Integrator'].map((b) => ({ file: b + '.html', status: 'match' }))
  };
  const gateB = {
    checked: 2,
    fail: 0,
    absent: 1,
    results: [
      { name: 'scratch_golden_a', status: 'reproducible' },
      { name: 'scratch_golden_b', status: 'historical-ok' },
      { name: 'scratch_real_night', status: 'input-absent' }
    ]
  };
  return provenanceVerdict(
    { gateA, gateB, wiring: { ok: true }, totalBundles: 9 },
    { commit: null, commitReason: '--verdict-sample: a scratch ledger, no bundle hashed, no code identity claimed', at: '2026-09-22T00:00:00Z' }
  );
}

function selftest() {
  let n = 0;
  const eq = (a, b, msg) => {
    n++;
    if (a !== b) {
      console.log(`✗ ${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
      process.exit(1);
    }
    console.log(`✓ ${msg}`);
  };
  const AT = { commit: null, commitReason: 'selftest', at: '2026-09-22T00:00:00Z' };
  const A = (...st) => ({ checked: st.filter((x) => x === 'match').length, fail: st.filter((x) => x !== 'match').length, missing: 0, results: st.map((x, i) => ({ file: `B${i}.html`, status: x })) });
  const B = (...st) => ({
    checked: st.filter((x) => /reproducible|historical/.test(x)).length,
    fail: st.filter((x) => /drift/.test(x)).length,
    absent: st.filter((x) => /absent|unloaded/.test(x)).length,
    results: st.map((x, i) => ({ name: `f${i}`, status: x }))
  });
  const green = provenanceVerdict({ gateA: A('match', 'match'), gateB: B('reproducible', 'input-absent'), wiring: { ok: true }, totalBundles: 2 }, AT);
  eq(green.status, 'PASS', '§3d · every bundle matches, one fixture reproducible, one input absent ⇒ PASS');
  eq(JSON.stringify(green.population), JSON.stringify({ checked: 5, eligible: 5, excluded: 0 }), '§3d · population = 2 bundles + wiring + 2 fixtures');
  eq(green.result.notApplicable, 1, '§3d · the absent-input fixture is NOT_APPLICABLE — checked, never green evidence');
  eq(provenanceVerdict({ gateA: A('match', 'drift'), gateB: B('reproducible'), totalBundles: 2 }, AT).status, 'FAIL', '§3d plant · a drifted bundle ⇒ FAIL (GATE A)');
  eq(/GATE A · B1\.html/.test(provenanceVerdict({ gateA: A('match', 'drift'), gateB: B('reproducible'), totalBundles: 2 }, AT).reason), true, '§3d plant · …named');
  eq(provenanceVerdict({ gateA: A('match'), gateB: B('output-drift'), totalBundles: 1 }, AT).status, 'FAIL', '§3d plant · a drifted fixture ⇒ FAIL (GATE B)');
  eq(provenanceVerdict({ gateA: A('match'), gateB: B('reproducible'), wiring: { ok: false }, totalBundles: 1 }, AT).status, 'FAIL', '§3d plant · the page not sourcing the shared core ⇒ FAIL');
  const filt = provenanceVerdict({ gateA: A('match'), gateB: B('reproducible'), totalBundles: 9, bundleFilter: 'oxydex' }, AT);
  eq(
    filt.status === 'PASS' && filt.result.filtered === true && filt.result.excludedBy === '--bundle=oxydex' && filt.population.excluded === 8,
    true,
    '§3d plant · --bundle= ⇒ filtered PASS, the 8 other bundles excluded by declaration'
  );
  eq(/NOT the gate/.test(filt.result.consumerRule || ''), true, '§3d plant · …with the consumer rule');
  const allAbsent = provenanceVerdict({ gateA: A('match'), gateB: B('input-absent', 'unloaded'), totalBundles: 1 }, AT);
  eq(allAbsent.status === 'PASS' && allAbsent.result.notApplicable === 2, true, '§3d · GATE B fully skipped (fresh clone) ⇒ PASS on GATE A alone, the skips visible as NOT_APPLICABLE');
  const nr = provenanceVerdict({ setupError: 'provenance/ ledger failed to load' }, AT);
  eq(nr.status === 'NOT_RUN' && nr.result === null, true, '§3d plant · a setup error ⇒ NOT_RUN with result null');
  eq(verdictSample().status === 'PASS' && verdictSample().producedBy.commit === null, true, '§3d · --verdict-sample is a PASS over a scratch ledger, no commit');
  console.log(`all ${n} selftests passed`);
}

const ARGV = process.argv.slice(2);
if (ARGV.includes('--selftest')) {
  selftest();
  process.exit(0);
}
if (ARGV.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}
const JSON_OUT = ARGV.includes('--json');

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const paint = (s, c) => (process.stdout.isTTY ? c + s + C.reset : s);
const out = (...a) => (JSON_OUT ? console.error(...a) : console.log(...a)); // --json: stdout carries ONE object
const die = (code, msg) => {
  console.error(paint('\u2715 ' + msg, C.red));
  if (JSON_OUT && code === 2) console.log(JSON.stringify(provenanceVerdict({ setupError: msg.split('\n')[0] })));
  process.exit(code);
};

/* Section filter (SECTION-SCOPED-RUNS 2026-07-01) — `node tests/verify-manifest.mjs --bundle=oxydex`
   (aliases --only / --group / -b, or the DEX_BUNDLE env var) scopes BOTH gates to the matching
   bundle(s): compute + compare only those manifestHashes, and audit only the fixtures they produced.
   Same comma=OR, regex-or-substring grammar as verify-provenance.html's ?bundle= and the suite's
   --group. A DEV CONVENIENCE, never the merge gate — prints a FILTERED banner; a zero-match filter is
   a hard error, not a pass. */
const BUNDLE_FILTER = (() => {
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const m = a[i].match(/^--?(?:bundle|bundles|only|group|b)=(.+)$/i);
    if (m) return m[1];
    if (/^--?(?:bundle|only|group|b)$/i.test(a[i]) && a[i + 1]) return a[i + 1];
  }
  return process.env.DEX_BUNDLE || process.env.DEX_GROUP || '';
})();
function bundleMatcher(filter) {
  if (!filter) return () => true;
  const tests = String(filter)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => {
      let rx = null;
      try {
        rx = new RegExp(t, 'i');
      } catch (_) {
        rx = null;
      }
      const lc = t.toLowerCase();
      return (s) => {
        s = String(s == null ? '' : s);
        return rx ? rx.test(s) : s.toLowerCase().indexOf(lc) >= 0;
      };
    });
  return (name) => tests.some((fn) => fn(name));
}

async function main() {
  // committed truth — reassembled from the per-app provenance/ fragments (P3)
  let ledger;
  try {
    ledger = ProvenanceLedger.loadNode({ readFileSync }, { join }, ROOT);
  } catch (e) {
    return die(2, 'provenance/ ledger failed to load/parse: ' + e.message);
  }
  const committed = (ledger.buildManifest && ledger.buildManifest.bundles) || null;
  if (!committed) return die(2, 'provenance/ fragments produced no `bundles` map');

  // P3 — provenance/ fragment-set consistency: index.json must list EXACTLY the canonical bundle set,
  // and the on-disk *.json fragment files must equal that list. Without this, an app fragment added
  // without an index entry would be silently un-gated (the failure the denylist philosophy forbids),
  // and an index entry with no fragment would already have thrown in loadNode above.
  const canonical = ManifestGate.MANIFEST_BUNDLES.map((b) => b.replace(/\.html$/, '')).sort();
  const idxApps = [...(ledger.apps || [])].sort();
  const onDisk = readdirSync(join(ROOT, 'provenance'))
    .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== '_meta.json')
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
  if (JSON.stringify(idxApps) !== JSON.stringify(canonical)) return die(2, 'provenance/index.json apps ≠ canonical bundles\n  index: ' + idxApps.join(', ') + '\n  canon: ' + canonical.join(', '));
  if (JSON.stringify(onDisk) !== JSON.stringify(idxApps)) return die(2, 'provenance/ fragment files ≠ index.json apps\n  on-disk: ' + onDisk.join(', ') + '\n  index:   ' + idxApps.join(', '));
  out(paint('  ✓ provenance/ fragment set consistent with index.json (' + onDisk.length + ' apps)', C.dim));

  // scope (SECTION-SCOPED-RUNS): which bundles this run checks — all, or the --bundle= filtered set
  const _bmatch = bundleMatcher(BUNDLE_FILTER);
  const BUNDLES = BUNDLE_FILTER ? ManifestGate.MANIFEST_BUNDLES.filter(_bmatch) : ManifestGate.MANIFEST_BUNDLES;
  if (BUNDLE_FILTER) {
    out(
      paint('▸ FILTERED RUN', C.yellow) +
        paint('  --bundle="' + BUNDLE_FILTER + '"  →  ' + BUNDLES.length + ' of ' + ManifestGate.MANIFEST_BUNDLES.length + ' bundle(s)  (dev convenience — NOT the full provenance gate)', C.dim)
    );
    if (!BUNDLES.length) return die(2, 'filter matched ZERO bundles — check the pattern (nothing was checked; a scoped run that checks nothing is not a pass)');
  }

  // recompute each bundle's CURRENT manifestHash via the SAME core the page uses
  const current = {};
  for (const f of BUNDLES) {
    const p = join(ROOT, f);
    if (!existsSync(p)) {
      current[f] = null;
      continue;
    }
    current[f] = await ManifestGate.manifestHashFromText(readFileSync(p, 'utf8'));
  }

  const g = ManifestGate.gateACompare(current, committed, BUNDLES);

  out(paint('\u25b8 GATE A — manifestHash \u2194 BUILD-MANIFEST.json', C.bold) + paint('  (' + g.checked + '/' + BUNDLES.length + ' checked)', C.dim));
  for (const r of g.results) {
    if (r.status === 'match') out(paint('  \u2713', C.green) + ' ' + r.file + paint('  ' + r.current, C.dim));
    else if (r.status === 'drift') out(paint('  \u2715', C.red) + ' ' + r.file + paint('  current ' + r.current + ' \u2260 committed ' + r.committed, C.yellow));
    else if (r.status === 'missing-current') out(paint('  \u2715', C.red) + ' ' + r.file + paint('  bundle missing / no __bundler/manifest (committed ' + r.committed + ')', C.yellow));
    else out(paint('  \u2715', C.red) + ' ' + r.file + paint('  no committed manifestHash in BUILD-MANIFEST.json', C.yellow));
  }

  // Single-source guard (kept in THIS provenance-lane runner, NOT the behavior suite): the page
  // must CONSUME manifest-gate.js rather than re-inline a copy that could drift from this check.
  let wiring = null;
  const vpPath = join(ROOT, 'verify-provenance.html');
  if (existsSync(vpPath)) {
    const vp = readFileSync(vpPath, 'utf8');
    const wired = /<script src="manifest-gate\.js"><\/script>/.test(vp) && /ManifestGate\.manifestHashFromText/.test(vp);
    const reInlinedHash = /\.match\(\/<script type="__bundler\\\/manifest">/.test(vp);
    if (!wired || reInlinedHash) {
      console.error(paint('  \u2715 verify-provenance.html does not source the shared GATE-A core (manifest-gate.js) — page and CI could drift', C.red));
      g.ok = false;
      g.fail++;
      wiring = { ok: false };
    } else {
      out(paint('  \u2713 verify-provenance.html sources the shared GATE-A core (manifest-gate.js)', C.green));
      wiring = { ok: true };
    }
  }

  // ── GATE B — content-addressed known-answer audit (Phase 7), best-effort (uploads/ may be gitignored) ──
  let gb = { fail: 0, checked: 0, absent: 0, ok: true, results: [] };
  const fixprov = ledger.fixtureProvenance;
  const fixturesAll = (fixprov && fixprov.fixtures) || null;
  if (!fixturesAll) return die(2, 'provenance/ fragments produced no `fixtures` map');
  // scope GATE B to the filtered bundle(s) too, so --bundle audits only their fixtures
  const fixtures = BUNDLE_FILTER ? Object.fromEntries(Object.entries(fixturesAll).filter(([, v]) => v && v.bundle && _bmatch(v.bundle))) : fixturesAll;
  // sha256[0:16] of each referenced committed file's RAW bytes (uploads/<f>); null = absent (CI skip).
  const fileHashes = {};
  for (const f of ManifestGate.gateBFiles(fixtures)) {
    const p = join(ROOT, 'uploads', f);
    fileHashes[f] = existsSync(p) ? await ManifestGate.sha16(new Uint8Array(readFileSync(p))) : null;
  }
  gb = ManifestGate.gateBEvaluate(fixtures, current, fileHashes);
  out(
    '\n' +
      paint('\u25b8 GATE B — content-addressed known-answer audit (input + manifestHash \u2192 output)', C.bold) +
      paint('  (' + gb.checked + ' reproducible, ' + gb.fail + ' drift, ' + gb.absent + ' skipped — uploads/ not served)', C.dim)
  );
  for (const r of gb.results) {
    if (r.status === 'reproducible' || r.status === 'historical-ok') out(paint('  \u2713', C.green) + ' ' + r.name + paint('  ' + r.status, C.dim));
    else if (/-absent$|unloaded$/.test(r.status)) out(paint('  \u2218', C.yellow) + ' ' + r.name + paint('  ' + r.status + ' (skip) — ' + r.detail, C.dim));
    else out(paint('  \u2715', C.red) + ' ' + r.name + paint('  ' + r.status + ' — ' + r.detail, C.yellow));
  }
  if (gb.fail === 0 && gb.checked > 0) out(paint('  \u2713 GATE B PASS — ' + gb.checked + ' fixture(s) content-addressed reproducible' + (gb.absent ? ' (' + gb.absent + ' skipped)' : ''), C.green));
  else if (gb.checked === 0 && gb.absent > 0) out(paint('  \u2218 GATE B skipped — uploads/ not served (gitignored); browser verify-provenance.html is the authoritative GATE-B surface', C.yellow));

  /* §3d — the object, built before the verdict prose so both lanes see the same thing; the exit
     code below is unchanged. */
  const verdict = provenanceVerdict({ gateA: g, gateB: gb, wiring, totalBundles: ManifestGate.MANIFEST_BUNDLES.length, bundleFilter: BUNDLE_FILTER || null });
  if (JSON_OUT) console.log(JSON.stringify(verdict));
  else {
    const p = verdict.population;
    out(
      paint(
        `  tepna.verdict/1: ${verdict.status}  ·  ${p.checked} checked / ${p.eligible} eligible / ${p.excluded} excluded${verdict.result && verdict.result.filtered ? '  ·  FILTERED (' + verdict.result.excludedBy + ') — not the gate' : ''}`,
        verdict.status === 'PASS' ? C.green : verdict.status === 'FAIL' ? C.red : C.yellow
      )
    );
  }
  if (!g.ok || gb.fail > 0) {
    const why = [];
    if (g.fail) why.push(g.fail + ' bundle(s) drifted/missing (GATE A)');
    if (g.missing) why.push(g.missing + ' bundle(s) with no committed manifestHash');
    if (!g.complete) why.push('manifest incomplete (' + g.checked + '/' + BUNDLES.length + ')');
    if (gb.fail) why.push(gb.fail + ' fixture(s) drifted (GATE B: code/input/output content hash)');
    return die(
      1,
      'PROVENANCE GATE FAILED — ' +
        (why.join(', ') || 'see above') +
        '.\n  GATE A fix: re-bundle the drifted app(s) and hand-update BUILD-MANIFEST.json with the new manifestHash.\n' +
        '  GATE B fix: re-run the producing app on its committed inputs + re-export (never hand-edit), then re-record the\n' +
        '  fixture (manifestHash + inputHashes + outputHash) in FIXTURE-PROVENANCE.json.'
    );
  }
  out(
    '\n' + paint('\u2713 PROVENANCE PASS — GATE A all ' + g.checked + ' bundles match; GATE B ' + gb.checked + ' fixture(s) reproducible' + (gb.absent ? ' (' + gb.absent + ' skipped)' : ''), C.green)
  );
  process.exit(0);
}

main().catch((e) => die(2, 'unexpected: ' + ((e && e.stack) || e)));
