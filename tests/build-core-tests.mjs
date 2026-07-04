/*
 * tests/build-core-tests.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 */
/* ════════════════════════════════════════════════════════════════════════
   tests/build-core-tests.mjs — gate the OWNED build (OWN-THE-BUILD Part A, A.4)
   ────────────────────────────────────────────────────────────────────────
   Pure-Node, zero deps. Four properties:
     1. SHA-256 KAT — the pure-JS sync sha256 in build-core.js IS SHA-256 (equals the
        published FIPS-180-4 vectors, hence equals crypto.subtle everywhere).
     2. DETERMINISM — building a bundle twice from identical source is byte-identical, and
        mutating one source byte MOVES the manifestHash.
     3. CROSS-RUNNER / CROSS-HASHER PARITY — the whole point of a shared core. For every OWNED
        (plain-inline) bundle: (a) build-core.js's SYNC manifestHash === manifest-gate.js's
        ASYNC (crypto.subtle) manifestHashFromText over the same bundle text — so the Node CLI,
        the browser driver, and the provenance gate can never disagree; (b) the freshly-built
        html === the committed .html (this IS `build.mjs --check`: committed bundle ≡ build(src)).
        Legacy __bundler/manifest bundles are SKIPPED (not yet migrated).
   Exit 0 = pass, 1 = failure, 2 = setup error. Wired into tests.yml alongside run-tests.mjs.
   ════════════════════════════════════════════════════════════════════════ */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

if (!globalThis.crypto) globalThis.crypto = webcrypto;   // manifest-gate.js async sha256 needs subtle

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const DexBuild = require(join(ROOT, 'tools', 'build-core.js'));
const ManifestGate = require(join(ROOT, 'manifest-gate.js'));

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m' };
const paint = (s, c) => (process.stdout.isTTY ? c + s + C.reset : s);
let fails = 0;
function ok(cond, name, detail) {
  if (cond) console.log(paint('  \u2713 ', C.green) + name + (detail ? paint('  ' + detail, C.dim) : ''));
  else { console.log(paint('  \u2715 ', C.red) + name + (detail ? paint('  ' + detail, C.dim) : '')); fails++; }
}
const readT = (p) => readFileSync(join(ROOT, p), 'utf8');
const srcFor = (b) => b.replace(/\.html$/, '.src.html');

function buildOne(bundleFile) {
  const srcHtml = readT(srcFor(bundleFile));
  const refs = DexBuild.scanRefs(srcHtml);
  const assets = {};
  for (const p of [...refs.styles, ...refs.scripts]) assets[p] = readT(p);
  return DexBuild.build({ srcHtml, assets });
}

async function main() {
  // 1) SHA-256 known-answer
  console.log(paint('\u25b8 SHA-256 known-answer (pure-JS \u2261 FIPS-180-4 \u2261 crypto.subtle)', C.bold));
  ok(DexBuild.sha256hex('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'sha256("")');
  ok(DexBuild.sha256hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256("abc")');
  ok(DexBuild.sha256hex('The quick brown fox jumps over the lazy dog') === 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592', 'sha256(fox)');
  // non-ASCII (UTF-8 path): °₂ etc. must match crypto.subtle
  const uni = 'SpO\u2082 \u00b0C \u2192 \ud83d\udd2c';
  ok(DexBuild.sha256hex(uni) === await ManifestGate.sha256hex(uni), 'sha256(non-ASCII) \u2261 crypto.subtle');

  const BUNDLES = ManifestGate.MANIFEST_BUNDLES;
  const owned = BUNDLES.filter(b => existsSync(join(ROOT, b)) && DexBuild.isPlainInline(readT(b)));
  console.log('\n' + paint('\u25b8 owned (plain-inline) bundles: ' + (owned.length ? owned.join(', ') : '(none yet)'), C.bold));

  for (const b of owned) {
    console.log(paint('  \u2500 ' + b, C.dim));
    const r1 = buildOne(b), r2 = buildOne(b);
    ok(r1.html === r2.html && r1.manifestHash === r2.manifestHash, b + ' deterministic (build \u00d72 byte-identical)', r1.manifestHash);
    // mutate one executed-code byte -> manifestHash must move (fingerprint sensitivity)
    const s = readT(srcFor(b)); const rf = DexBuild.scanRefs(s); const a = {};
    for (const p of [...rf.styles, ...rf.scripts]) a[p] = readT(p);
    const firstScript = rf.scripts[0];
    a[firstScript] = a[firstScript] + '\n;/*drift*/';
    const rMut = DexBuild.build({ srcHtml: s, assets: a });
    ok(rMut.manifestHash !== r1.manifestHash, b + ' manifestHash moves on an executed-code change');
    // CROSS-HASHER PARITY: sync core === async manifest-gate (crypto.subtle)
    const async = await ManifestGate.manifestHashFromText(r1.html);
    ok(async === r1.manifestHash, b + ' build-core sync hash \u2261 manifest-gate async hash', async + ' \u2261 ' + r1.manifestHash);
    // --check: committed bundle === fresh build(source)
    ok(r1.html === readT(b), b + ' committed \u2261 fresh build(' + srcFor(b) + ')');
  }
  if (!owned.length) console.log(paint('  \u2218 no owned bundles yet \u2014 core KAT + determinism still gate; parity legs activate as bundles migrate', C.dim));

  console.log('');
  if (fails) { console.error(paint('\u2715 build-core tests: ' + fails + ' failure(s)', C.red)); process.exit(1); }
  console.log(paint('\u2713 build-core tests PASS', C.green));
  process.exit(0);
}
main().catch(e => { console.error(paint('\u2715 setup: ' + ((e && e.stack) || e), C.red)); process.exit(2); });
