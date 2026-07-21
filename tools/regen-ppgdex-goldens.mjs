/*
 * tools/regen-ppgdex-goldens.mjs — Tepna
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * Regenerate PpgDex's committed node-export fixtures by RE-RUNNING THE REAL MODULES on their
 * committed inputs, then re-recording each fixture. The shared diff/merge/rerecord/loop scaffolding
 * lives ONCE in tools/regen-goldens-core.mjs (FOLLOWUPS-III §3); this file supplies only PpgDex's
 * realm + fixture builders. Also reachable as `node tools/regen-goldens.mjs --node PpgDex`.
 *
 * PpgDex was a code-gated node WITHOUT a regenerator (CPAPDex/GlucoDex/PulseDex/MotionDex/OxyDex all
 * have one). When the integrator finger-PPG resourcing work (OXYDEX-PULSE-RESOURCING §2-4) taught the
 * PpgDex node-export to carry `recording.site`, its committed corpus golden went stale with no
 * sanctioned way to refresh it — this closes that gap, mirroring what DEEP-AUDIT-II §2.1 did for OxyDex.
 *
 * It drives the SAME seam the equivalence gate drives (tests/dex-tests.js Phase-9 `ppgdex` case) —
 * PpgDex.compute({ text }) — in a vm realm co-loaded in PpgDex.src.html order (headless subset — no
 * render/app/DOM shell). The gate's pick is the identity, so the golden IS the compute() result.
 *
 * FIXTURES
 *   PpgDex_2026-06-27_equiv   real Polar Verity Sense *_PPG.txt   [real recording, gitignored]
 *   synthetic_ppgdex_golden   committed synthetic Verity stream   [committed → runs in CI]
 *
 * USAGE
 *   node tools/regen-ppgdex-goldens.mjs           # regenerate + re-record + report what moved
 *   node tools/regen-ppgdex-goldens.mjs --check   # report only, write nothing (CI-safe)
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeRerecord, runRegen } from './regen-goldens-core.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UP = path.join(REPO, 'uploads');
const CHECK = process.argv.includes('--check');
const ManifestGate = createRequire(import.meta.url)(path.join(REPO, 'manifest-gate.js'));
const DexBuild = createRequire(import.meta.url)('./build-core.js');

/* ── the PpgDex.src.html script order (headless subset — no render/app/DOM shell) ── */
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
  // clock.js BEFORE ppgdex-dsp.js — the DSP aliases DexClock.parseTimestamp at load.
  for (const f of [
    'kernel-constants.js',
    'clock.js',
    'signal-frame.js',
    'dex-export.js',
    'metric-registry.js',
    'dex-profile.js',
    'crossnight-envelope.js',
    'ppgdex-registry.js',
    'ppgdex-dsp.js',
    'ppgdex-morph.js',
    'ppgdex-cross.js',
    'ppgdex-profile.js'
  ])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const { PpgDex } = realm();

/* Polar Verity *_PPG.txt → compute({ text }) → the node-export (the equiv gate's pick is identity),
   or null when the input is absent (gitignored recording). */
const fromPPG = (file) => {
  const p = path.join(UP, file);
  if (!fs.existsSync(p)) return null;
  return PpgDex.compute({ text: fs.readFileSync(p, 'utf8') });
};

const FIXTURES = [
  { name: 'PpgDex_2026-06-27_equiv.node-export.json', real: true, build: () => fromPPG('Polar_Sense_BBBBBBBB_20260621_060523_PPG.txt') },
  { name: 'synthetic_ppgdex_golden.node-export.json', build: () => fromPPG('synthetic_ppgdex_verity.txt') }
];

const rerecord = makeRerecord({ repo: REPO, node: 'PpgDex', bundle: 'PpgDex.html', uploadsDir: UP, ManifestGate });
await runRegen({ fixtures: FIXTURES, uploadsDir: UP, check: CHECK, rerecord, absentInputHint: 'copy the Polar Verity *_PPG.txt into uploads/ to regenerate' });
