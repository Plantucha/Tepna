#!/usr/bin/env node
/*
 * tools/regen-cpap-goldens.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Regenerate CPAPDex's five committed fixtures by RE-RUNNING THE REAL MODULES on their
 * committed inputs and re-exporting — never by hand-editing a hash or a value (CLAUDE.md §🔏).
 *
 * WHY THIS EXISTS. `tools/build.mjs` re-stamps a fixture's `manifestHash` when the bundle moves,
 * but it does NOT recompute the fixture's OUTPUT bytes. So after a code change that MOVES an
 * export's content, re-stamping alone would leave the ledger asserting "this output is
 * reproducible under this code" while the committed bytes still carry the OLD content — a false
 * claim, and precisely the GATE-C gap CLAUDE.md warns about. GATE B (static) cannot catch it.
 * This tool closes the loop: regenerate the content, then re-record the hashes.
 *
 * It drives the SAME chains the Dex-Test-Suite equivalence/golden gates drive, in a vm realm
 * co-loaded exactly as CPAPDex.src.html does — no re-implemented parser, no hand-typed number:
 *
 *   cpapdex_synthetic_golden            _synthEdfSet → buildSessionFromEdf → buildNight → cpapBuildExport
 *   cpapdex_synthetic_edf_golden        readEDF(5 committed .edf) → CPAPDex.compute({edfSets})
 *   cpapdex_synthetic_multinight_golden 3 day-shifted nights → cpapBuildMultiNightExport
 *   cpapdex-2026-06-12 / -06-16         readEDF(real .edf) → buildSessionFromEdf → buildNight → cpapBuildExport
 *
 * VOLATILE FIELDS ARE PRESERVED, NOT REGENERATED. `file` / `provenance` / `kernel` / `generated`
 * are exactly the keys the equivalence gate EXCLUDES from its diff (they are per-run metadata, and
 * the headless path leaves provenance null where the app populated it). Rewriting them would churn
 * bytes with no physiological meaning and would discard the original app-run provenance. So the
 * merge takes the RECOMPUTED value for every computed field and keeps the COMMITTED value for those
 * keys — the same "patch the content, keep the volatile" precedent the earlier CPAPDex regenerations
 * followed (EXPORT-IDENTITY-FOLLOWUPS-II).
 *
 * The two REAL-night fixtures need their real EDF inputs present in uploads/ (gitignored personal
 * recordings). Absent → they are SKIPPED with a loud notice, never silently left stale.
 *
 *   node tools/regen-cpap-goldens.mjs           # regenerate + report what moved
 *   node tools/regen-cpap-goldens.mjs --check   # report only, write nothing (CI-safe)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// ESM-MIGRATION: cpapdex-dsp.js is a dual-mode ES module — shed its top-level export/import via the
// single classicify source before vm-loading it (else "Unexpected token 'export'"). No-op on classic files.
const DexBuild = createRequire(import.meta.url)('./build-core.js');
const UP = path.join(REPO, 'uploads');
const CHECK = process.argv.includes('--check');

/* ── the CPAPDex.src.html script order (headless subset — no render/app) ── */
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
  for (const f of [
    'kernel-constants.js',
    'clock.js',
    'signal-frame.js',
    'dex-export.js',
    'metric-registry.js',
    'crossnight-envelope.js',
    'cpapdex-registry.js',
    'cpapdex-edf.js',
    'cpapdex-dsp.js',
    'cpapdex-cross.js',
    'cpapdex-fusion.js'
  ])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const ctx = realm();
const { CpapEdf, CpapDsp, CpapFusion } = ctx;

const ab = (p) => {
  const b = fs.readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const KINDS = ['BRP', 'PLD', 'SA2', 'EVE', 'CSL'];

/* Read one session set from a `<stamp>_<TYPE>.edf` group. */
function readSet(stamps) {
  const set = {};
  for (const [type, file] of Object.entries(stamps)) {
    const p = path.join(UP, file);
    if (!fs.existsSync(p)) return null;
    set[type] = CpapEdf.readEDF(ab(p));
  }
  return set;
}

/* ── the volatile keys the equivalence gate EXCLUDES — preserved verbatim from the committed
      file rather than regenerated (see the header). ── */
const VOLATILE = new Set(['file', 'provenance', 'kernel', 'generated', 'vo2est', 'karv']);

/* recomputed content + committed volatile. Structure follows the RECOMPUTED tree (that is the
   truth); a volatile key present in the committed tree at the same path keeps its old value. */
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

/* ── the five fixtures ─────────────────────────────────────────────────────────────────── */
const DAY = 86400000;
const nightOf = (sets) => CpapDsp.buildNight(sets.map((s) => CpapDsp.buildSessionFromEdf(s, {})));

const FIXTURES = [
  {
    name: 'cpapdex_synthetic_golden.node-export.json',
    build: () => CpapFusion.cpapBuildExport(nightOf([CpapDsp._synthEdfSet({ oxi: true, cs: true })]))
  },
  {
    name: 'cpapdex_synthetic_edf_golden.node-export.json',
    build: () => {
      const stamps = {};
      for (const k of KINDS) stamps[k] = `20260613_231433_${k}.edf`;
      const set = readSet(stamps);
      if (!set) return null;
      return ctx.CPAPDex.compute({ edfSets: [set] });
    }
  },
  {
    name: 'cpapdex_synthetic_multinight_golden.node-export.json',
    build: () => {
      const mk = (delta) => {
        const set = CpapDsp._synthEdfSet({ oxi: true, cs: true });
        for (const k of KINDS) {
          if (set[k] && set[k].clock && set[k].clock.t0Ms != null) set[k].clock.t0Ms += delta;
          if (set[k] && set[k].annotations) {
            for (const a of set[k].annotations) if (a.tMs != null) a.tMs += delta;
          }
        }
        return nightOf([set]);
      };
      const chrono = [mk(0), mk(DAY), mk(2 * DAY)].sort((a, b) => (a.t0Ms || 0) - (b.t0Ms || 0));
      return CpapFusion.cpapBuildMultiNightExport(chrono);
    }
  },
  {
    // REAL night — two sessions (22:28 + 04:55). Inputs are gitignored personal recordings.
    name: 'cpapdex-2026-06-12.node-export.json',
    real: true,
    build: () => {
      const a = readSet({ BRP: '20260612_222830_BRP.edf', PLD: '20260612_222830_PLD.edf', SA2: '20260612_222830_SA2.edf', EVE: '20260612_222819_EVE.edf', CSL: '20260612_222819_CSL.edf' });
      const b = readSet({ BRP: '20260613_045505_BRP.edf', PLD: '20260613_045505_PLD.edf', SA2: '20260613_045505_SA2.edf', EVE: '20260613_045457_EVE.edf', CSL: '20260613_045457_CSL.edf' });
      if (!a || !b) return null;
      return CpapFusion.cpapBuildExport(nightOf([a, b]));
    }
  },
  {
    // REAL night — single session.
    name: 'cpapdex-2026-06-16.json',
    real: true,
    build: () => {
      const s = readSet({ BRP: '20260616_213618_BRP.edf', PLD: '20260616_213618_PLD.edf', SA2: '20260616_213618_SA2.edf', EVE: '20260616_213611_EVE.edf', CSL: '20260616_213611_CSL.edf' });
      if (!s) return null;
      return CpapFusion.cpapBuildExport(nightOf([s]));
    }
  }
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
    console.log(`  ⊘ ${F.name} — INPUTS ABSENT${F.real ? ' (real recording, gitignored — copy the EDFs into uploads/ to regenerate)' : ''}`);
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
}

console.log(`\n${CHECK ? 'check' : 'regen'}: ${moved} fixture(s) moved, ${skipped} skipped`);
if (CHECK && moved) process.exitCode = 1;
