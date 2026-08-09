/*
 * tools/regen-ppgdex-goldens.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
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
import { makeRerecord, resolveCorpus, runRegen } from './regen-goldens-core.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Committed fixtures are TRACKED artifacts of this checkout — never redirected (see resolveCorpus).
const UP = path.join(REPO, 'uploads');
// Raw recordings are gitignored and may live elsewhere; DEX_UPLOADS-aware, shared with verify-fixtures.
const CORPUS = resolveCorpus(REPO);
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
  const p = path.join(CORPUS, file);
  if (!fs.existsSync(p)) return null;
  return PpgDex.compute({ text: fs.readFileSync(p, 'utf8') });
};

/* The RICH export — `compute(input, { rich: true })`. Only `signal-orchestrate.emitPpgNodeExport`
   passes that flag in production, and it is the shape the INTEGRATOR consumes. */
const fromPPGRich = (file) => {
  const p = path.join(CORPUS, file);
  if (!fs.existsSync(p)) return null;
  return PpgDex.compute({ text: fs.readFileSync(p, 'utf8') }, { rich: true });
};

const FIXTURES = [
  { name: 'PpgDex_2026-06-27_equiv.node-export.json', real: true, build: () => fromPPG('Polar_Sense_BBBBBBBB_20260621_060523_PPG.txt') },
  { name: 'synthetic_ppgdex_golden.node-export.json', build: () => fromPPG('synthetic_ppgdex_verity.txt') },
  /* The FRAGMENTED twin (INTEGRATOR-GAP-AWARE-OVERLAP-FOLLOWUPS §2.2) — the same argument the ECGDex
     `_gapped` fixture makes, one node over. Every other committed PpgDex input is CONTIGUOUS, so
     `coverage()` returned null on all of them and `recording.coverage` — the field the Integrator's
     overlap denominator rests on — had no committed leg at all. A regression that stopped emitting
     it, or emitted the envelope instead of the segments, reproduced byte-identically on both clean
     twins. Committed input ⇒ CI re-runs it from committed bytes every push. */
  {
    name: 'synthetic_ppgdex_gapped_golden.node-export.json',
    build: () => fromPPG('synthetic_ppgdex_verity_gapped.txt'),
    newRecord: {
      added: '2026-07-31',
      inputs: ['synthetic_ppgdex_verity_gapped.txt'],
      note: 'INTEGRATOR-GAP-AWARE-OVERLAP-FOLLOWUPS §2.2 — the FRAGMENTED committed Verity twin. Two arm-off holes (6 s + 4 s) cut out of the clean 40 s twin, so recording.coverage must declare 3 segments / ~30 s recorded inside a 40 s envelope, source ble-dropout. Every other PpgDex equiv input is gapless, so the coverage emitter had no committed leg; the clean twin is retained as the control that must still declare nothing.'
    }
  },
  /* The RICH export, which is what the INTEGRATOR actually reads — and had NO committed fixture at all
     (INTEGRATOR-OXYDEX-ADAPTER-GAP-FOLLOWUPS §1, carried over from the parent's §5). Every other PpgDex
     golden is the LIGHT export: `compute({text})` emits `recording` + `ganglior_events` and NOTHING else,
     so `hrv.time.*`, `apnea.cvhrIndex` and the whole OXYDEX-PULSE-RESOURCING §Phase 2-4 wiring built on
     them were exercised only by in-test recompute. A drift in the rich block reproduced byte-identically
     on all three existing goldens, because none of them contains it. Same committed input as the clean
     twin — only the `rich` flag differs, which makes this fixture a pure test of that flag's output. */
  /* The O2Ring FINGER golden (O2RING-ADAPTIVE-TIMEBASE Stage 3b) — pins PpgDex's device-crystal DEFAULT.
     Every other committed PpgDex golden is a Verity (wrist, site !== 'finger'), so the crystal marker-aware
     axis — which now SHIPS as the default for a finger recording — had no committed golden. This reuses the
     COMMITTED finger twin that already backs the O2RING-FINGER-SITE test group: compute({text}) with no
     timebase opt ⇒ the crystal default, so the golden records quality.timebase 'device-crystal', fs 125.000
     and the marker-deflated axis. */
  {
    name: 'synthetic_ppgdex_o2ring_finger_golden.node-export.json',
    build: () => fromPPGRich('synthetic_ppgdex_o2ring_finger.txt'),
    newRecord: {
      added: '2026-08-08',
      inputs: ['synthetic_ppgdex_o2ring_finger.txt'],
      note: "O2RING-ADAPTIVE-TIMEBASE Stage 3b — the O2Ring FINGER golden, pinning PpgDex's device-crystal DEFAULT (parsePPG defaults a finger recording to the 125.000 marker-aware axis). Reuses the committed finger twin from the O2RING-FINGER-SITE group. The RICH export (compute(input,{rich:true})) so the golden records quality.timebase 'device-crystal' explicitly, with NO timebase opt ⇒ the DEFAULT. Every other PpgDex golden is a Verity, so the crystal path had no committed leg."
    }
  },
  {
    name: 'synthetic_ppgdex_rich_golden.node-export.json',
    build: () => fromPPGRich('synthetic_ppgdex_verity.txt'),
    newRecord: {
      added: '2026-08-01',
      inputs: ['synthetic_ppgdex_verity.txt'],
      note: 'INTEGRATOR-OXYDEX-ADAPTER-GAP-FOLLOWUPS §1 — the INTEGRATOR-FACING rich export (compute(input,{rich:true})), which had no committed fixture. Pins hrv.time.{sdnn,rmssd,sdnnRobust}, hrv.frequency, hrv.confidence, apnea.cvhrIndex and recording.site — every field integrator-dsp adaptPpgDex reads. Shares the clean twin input with synthetic_ppgdex_golden.node-export.json, so the pair isolates exactly what opts.rich adds.'
    }
  }
];

const rerecord = makeRerecord({ repo: REPO, node: 'PpgDex', bundle: 'PpgDex.html', fixturesDir: UP, corpusDir: CORPUS, ManifestGate });
await runRegen({ fixtures: FIXTURES, fixturesDir: UP, corpusDir: CORPUS, check: CHECK, rerecord, absentInputHint: 'copy the Polar Verity *_PPG.txt into uploads/ to regenerate' });
