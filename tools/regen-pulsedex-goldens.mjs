#!/usr/bin/env node
/*
 * tools/regen-pulsedex-goldens.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Regenerate PulseDex's committed node-export fixtures by RE-RUNNING THE REAL MODULES on their
 * committed inputs and re-exporting — never by hand-editing a value (CLAUDE.md §🔏). Third sibling
 * of tools/regen-cpap-goldens.mjs / tools/regen-glucodex-goldens.mjs; copy this pair for a new node.
 *
 * It drives the SAME seam the equivalence gate drives — RR text → PulseDex.parseRRInput(frame) →
 * PulseDex.compute({intervals,tsMs,t0Ms,offsetMin}) — in a vm realm co-loaded like PulseDex.src.html.
 * No re-implemented parser, no hand-typed number:
 *
 *   PulseDex_2026-06-25_equiv   real Polar H10 *_RR.txt          [real recording, gitignored]
 *   PulseDex_2026-06-25_events  real Polar H10 events *_RR.txt    [real recording, gitignored]
 *   synthetic_pulsedex_golden   committed synthetic RR twin       [committed — runs in CI]
 *
 * VOLATILE FIELDS ARE PRESERVED, NOT REGENERATED — file / provenance / kernel / generated are the keys
 * the equivalence gate EXCLUDES from its diff. The merge takes the RECOMPUTED value for every computed
 * field and keeps the COMMITTED value for those keys. It also RE-RECORDS the ledger (outputHash /
 * inputHashes via ManifestGate.sha16) — build.mjs only re-stamps manifestHash, and only when the bundle
 * hash moves, so a pure output regeneration under new code needs this to close GATE B.
 *
 *   node tools/regen-pulsedex-goldens.mjs           # regenerate + re-record + report what moved
 *   node tools/regen-pulsedex-goldens.mjs --check   # report only, write nothing (CI-safe)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UP = path.join(REPO, 'uploads');
const CHECK = process.argv.includes('--check');
const ManifestGate = createRequire(import.meta.url)(path.join(REPO, 'manifest-gate.js'));
// ESM-MIGRATION: pulsedex-dsp.js is a dual-mode ES module — shed its top-level export/import via the
// single classicify source before vm-loading it (else "Unexpected token 'export'"). No-op on classic files.
const DexBuild = createRequire(import.meta.url)('./build-core.js');

/* ── the PulseDex.src.html script order (headless subset — no render/app/profile) ── */
function realm() {
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    append: noop,
    removeChild: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop
  });
  const sb = {
    document: {
      getElementById: () => null,
      createElement: el,
      createTextNode: () => ({}),
      querySelector: () => null,
      querySelectorAll: () => [],
      head: el(),
      body: el(),
      documentElement: el(),
      addEventListener: noop,
      readyState: 'complete'
    },
    localStorage: {
      _m: new Map(),
      getItem(k) {
        return this._m.has(k) ? this._m.get(k) : null;
      },
      setItem(k, v) {
        this._m.set(k, String(v));
      },
      removeItem(k) {
        this._m.delete(k);
      },
      clear() {
        this._m.clear();
      }
    },
    console,
    setTimeout,
    clearTimeout
  };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  const ctx = vm.createContext(sb);
  ctx.__DEX_NAMESPACED__ = true;
  // clock.js BEFORE pulsedex-dsp.js — the delegating DSP aliases DexClock.parseTimestamp at load.
  for (const f of ['kernel-constants.js', 'clock.js', 'signal-frame.js', 'dex-export.js', 'metric-registry.js', 'pulsedex-dsp.js'])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const ctx = realm();
const { PulseDex } = ctx;

/* ── the volatile keys the equivalence gate EXCLUDES — preserved verbatim from the committed file. ── */
const VOLATILE = new Set(['file', 'provenance', 'kernel', 'generated', 'vo2est', 'karv']);

function merge(fresh, old) {
  if (Array.isArray(fresh)) {
    return fresh.map((v, i) => merge(v, Array.isArray(old) ? old[i] : undefined));
  }
  if (fresh && typeof fresh === 'object') {
    const out = {};
    for (const k of Object.keys(fresh)) {
      const oldHas = old && typeof old === 'object' && Object.prototype.hasOwnProperty.call(old, k);
      out[k] = VOLATILE.has(k) && oldHas ? old[k] : merge(fresh[k], oldHas ? old[k] : undefined);
    }
    return out;
  }
  return fresh;
}

/* physiological diff (volatile excluded) — what actually MOVED */
function diff(a, b, p, out) {
  if (out.length > 30) return;
  if (a === b) return;
  const ta = typeof a,
    tb = typeof b;
  if (ta === 'number' && tb === 'number') {
    if (!(Number.isNaN(a) && Number.isNaN(b)) && Math.abs(a - b) > 1e-9 * (1 + Math.abs(a))) out.push(`${p}: ${b} → ${a}`);
    return;
  }
  if (a == null || b == null || ta !== 'object' || tb !== 'object') {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${p}: ${JSON.stringify(b)} → ${JSON.stringify(a)}`);
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (VOLATILE.has(k)) continue;
    diff(a[k], b[k], p ? `${p}.${k}` : k, out);
  }
}

/* RR text → parsed frame → compute(), or null when the input is absent (gitignored recording) */
const fromRR = (file) => {
  const p = path.join(UP, file);
  if (!fs.existsSync(p)) return null;
  const fr = PulseDex.parseRRInput(fs.readFileSync(p, 'utf8'));
  if (!fr) return null;
  return PulseDex.compute({ intervals: fr.vals, tsMs: fr.tsMs, t0Ms: fr.t0Ms, offsetMin: fr.offsetMin });
};

/* ── ledger re-record: outputHash + inputHashes, hashed with the gates' OWN sha16 (never hand-typed) ── */
const sha16Of = (file) => ManifestGate.sha16(new Uint8Array(fs.readFileSync(path.join(UP, file))));

async function rerecord(fixtureName) {
  // P3 — PulseDex fixtures live in provenance/PulseDex.json; re-record into that fragment only.
  const fragPath = path.join(REPO, 'provenance', 'PulseDex.json');
  const frag = JSON.parse(fs.readFileSync(fragPath, 'utf8'));
  const rec = frag.fixtures && frag.fixtures[fixtureName];
  if (!rec) return console.log(`      ⚠ no provenance record for ${fixtureName} — ledger NOT re-recorded`);
  if (rec.historical) return console.log(`      ∘ ${fixtureName} is historical (byte-pinned, not code-gated) — ledger left alone`);
  const outputHash = await sha16Of(fixtureName);
  const inputHashes = {};
  for (const f of rec.inputs || []) inputHashes[f] = await sha16Of(f);
  const wasOut = rec.outputHash;
  rec.outputHash = outputHash;
  if (Object.keys(inputHashes).length) rec.inputHashes = inputHashes;
  fs.writeFileSync(fragPath, JSON.stringify(frag, null, 2) + '\n');
  console.log(`      ↻ ledger re-recorded — outputHash ${wasOut} → ${outputHash}`);
}

const FIXTURES = [
  { name: 'PulseDex_2026-06-25_equiv.node-export.json', real: true, build: () => fromRR('Polar_H10_AAAAAAAA_20260613_204448_RR.txt') },
  { name: 'PulseDex_2026-06-25_events.node-export.json', real: true, build: () => fromRR('PulseDex_2026-06-25_events_RR.txt') },
  { name: 'synthetic_pulsedex_golden.node-export.json', build: () => fromRR('synthetic_pulsedex_rr.txt') }
];

let moved = 0,
  skipped = 0;
for (const F of FIXTURES) {
  const p = path.join(UP, F.name);
  if (!fs.existsSync(p)) {
    console.log(`  ⊘ ${F.name} — committed fixture absent`);
    skipped++;
    continue;
  }
  const old = JSON.parse(fs.readFileSync(p, 'utf8'));

  let fresh;
  try {
    fresh = F.build();
  } catch (e) {
    console.log(`  ✗ ${F.name} — build threw: ${e.message}`);
    skipped++;
    continue;
  }
  if (!fresh) {
    console.log(`  ⊘ ${F.name} — INPUT ABSENT${F.real ? ' (real recording, gitignored — copy the *_RR.txt into uploads/ to regenerate)' : ''}`);
    skipped++;
    continue;
  }
  fresh = JSON.parse(JSON.stringify(fresh));

  const d = [];
  diff(fresh, old, '', d);
  if (!d.length) {
    console.log(`  = ${F.name} — content unchanged`);
    continue;
  }

  const out = merge(fresh, old);
  if (!CHECK) fs.writeFileSync(p, JSON.stringify(out, null, 2) + '\n');
  moved++;
  console.log(`  ${CHECK ? '!' : '✓'} ${F.name} — ${d.length} field(s) moved`);
  for (const line of d.slice(0, 8)) console.log(`      ${line}`);
  if (d.length > 8) console.log(`      … +${d.length - 8} more`);
  if (!CHECK) await rerecord(F.name);
}

console.log(`\n${CHECK ? 'check' : 'regen'}: ${moved} fixture(s) moved, ${skipped} skipped`);
if (CHECK && moved) process.exitCode = 1;
