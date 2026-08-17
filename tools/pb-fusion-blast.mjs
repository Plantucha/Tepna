#!/usr/bin/env node
/*
 * tools/pb-fusion-blast.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * DOES OXYDEX'S ALWAYS-ON `periodic_breathing` CHANNEL INFLATE AN INTEGRATOR CORROBORATION COUNT?
 * (OXYDEX-PB-OVERCALL-2026-07-31-BRIEF §3.4 / §4 item 4.)
 *
 * The parent brief established (§5.2) that OxyDex emits `periodic_breathing` on 36 of 37 nights and
 * that the detector is, to a good approximation, measuring mild hypoxemia burden rather than
 * periodicity. §3.4 then asks the fusion-layer question, by analogy with `integrator-dsp` §3.1 (a
 * second oximeter must not double the apnea index): what does a channel that is on almost every
 * night do to a rule whose whole job is counting how many independent signals agree?
 *
 * THE MEASUREMENT IS A COUNTERFACTUAL, NOT A HEAD-COUNT. Reporting "PB corroborated on N nights"
 * answers nothing — the informative quantity is how many of those N survive REMOVING the always-on
 * observer. So each night is fused TWICE against the SHIPPED `fusePeriodicBreathing`:
 *   (a) as recorded;
 *   (b) with OxyDex's `periodic_breathing` events stripped and nothing else changed.
 * The gap between (a) and (b) is the leg's entire contribution to the decision. `conf` is reported
 * the same way — the noisy-OR uplift the always-on leg adds to every block it joins.
 *
 * NO REIMPLEMENTATION. It co-loads `integrator-dsp.js` and drives `adaptEnvelopeNode` +
 * `fusePeriodicBreathing` — the same seam `tests/dex-tests.js` and `tools/regen-integrator-goldens.mjs`
 * reach them through. A private copy of the fusion rule would measure the copy.
 *
 * SCOPE, STATED SO IT IS NOT OVER-READ. `_pbObserver` admits three nodes; this pairs OxyDex with
 * CPAPDex only. The ECGDex cardiac-CVHR leg reads `apnea.cvhrIndex`, and the committed trio ECGDex
 * exports (generated 2026-07-12) carry NO `apnea` block at all — that block landed 2026-07-23
 * (`11091ef`), so its absence here is corpus staleness, NOT a dead leg. A re-run of
 * `tools/trio-batch.mjs` would exercise it; until then this tool reports the ECGDex leg as
 * unexercised rather than as inert, and says so in the output.
 *
 * USAGE
 *   node tools/pb-fusion-blast.mjs --cpap <cpap-exports.json> [--dir uploads/trio] [--json]
 *     --selftest   known-answer checks on synthetic records (no corpus, no I/O)
 *
 * `--cpap` takes the CPAPDex export corpus in the shape `tools/pb-agreement.mjs` consumes:
 * `{ exports: [ <ganglior.node-export>, … ] }`, each carrying a `_day` key (YYYYMMDD or YYYY-MM-DD).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const AS_JSON = argv.includes('--json');
const SELFTEST = argv.includes('--selftest');
const DIR = opt('--dir', join(ROOT, 'uploads', 'trio'));
const CPAP = opt('--cpap', null);

/* ── the Integrator realm ────────────────────────────────────────────────────────────────────
   Identical recipe to `tools/regen-integrator-goldens.mjs`: classicify + run the spine in load
   order (clock.js BEFORE integrator-dsp.js — the delegating DSP aliases DexClock.parseTimestamp at
   load), then read the fusion functions off the context the way the equivalence gate's runner does.
   `dataset: {}` on the element stub is load-bearing: metric-registry.js sets `b.dataset.mode`. */
function realm() {
  const DexBuild = require(join(ROOT, 'tools/build-core.js'));
  const el = () => ({
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {},
    addEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    insertAdjacentHTML() {},
    get textContent() {
      return '';
    },
    set textContent(v) {},
    get innerHTML() {
      return '';
    },
    set innerHTML(v) {},
    getContext: () => null
  });
  const sb = {
    console,
    Date,
    Math,
    JSON,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    Object,
    Array,
    String,
    Number,
    Error,
    Float32Array,
    Float64Array,
    Int16Array,
    Int32Array,
    Uint8Array,
    ArrayBuffer,
    DataView,
    TextDecoder,
    TextEncoder,
    setTimeout,
    clearTimeout,
    performance,
    URL,
    crypto,
    RegExp,
    Map,
    Set,
    Symbol,
    Promise,
    document: {
      createElement: el,
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      head: el(),
      body: el(),
      documentElement: el()
    },
    navigator: { userAgent: 'node' },
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
    }
  };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  const ctx = vm.createContext(sb);
  ctx.__DEX_NAMESPACED__ = true;
  for (const f of ['kernel-constants.js', 'clock.js', 'signal-frame.js', 'dex-export.js', 'metric-registry.js', 'event-coupling.js', 'integrator-tch.js', 'integrator-dsp.js'])
    if (existsSync(join(ROOT, f))) vm.runInContext(DexBuild.classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const dayKey = (d) => String(d).replace(/^(\d{4})(\d\d)(\d\d)$/, '$1-$2-$3');
const stripPB = (json) => {
  const c = JSON.parse(JSON.stringify(json));
  c.ganglior_events = (c.ganglior_events || []).filter((e) => e.impulse !== 'periodic_breathing');
  return c;
};
const blockOf = (fused) => (fused && Array.isArray(fused.blocks) && fused.blocks.length ? fused.blocks[0] : null);

/* One night → the counterfactual pair. `adapt`/`fpb` are the SHIPPED functions. */
function probeNight(adapt, fpb, oxyJson, cpapJson) {
  const cpapRecs = adapt(cpapJson, 'CPAPDex', 'cpap.json');
  const asRecorded = blockOf(fpb(adapt(oxyJson, 'OxyDex', 'oxy.json').concat(cpapRecs)));
  const withoutOxyPB = blockOf(fpb(adapt(stripPB(oxyJson), 'OxyDex', 'oxy.json').concat(cpapRecs)));
  const oxyLeg = asRecorded ? (asRecorded.sources || []).find((s) => s.node === 'OxyDex') : null;
  const otherLegs = asRecorded ? (asRecorded.sources || []).filter((s) => s.node !== 'OxyDex') : [];
  return {
    corroborated: !!asRecorded,
    nObservers: asRecorded ? asRecorded.nObservers : 0,
    conf: asRecorded ? asRecorded.conf : null,
    corroboratedWithoutOxyPB: !!withoutOxyPB,
    confWithoutOxyPB: withoutOxyPB ? withoutOxyPB.conf : null,
    oxyEpisodes: (oxyJson.ganglior_events || []).filter((e) => e.impulse === 'periodic_breathing').length,
    oxyLegConf: oxyLeg ? oxyLeg.conf : null,
    otherNodes: otherLegs.map((s) => s.node)
  };
}

/* ── selftest: known answers, no corpus ──────────────────────────────────────────────────────
   Three cases pin exactly the property the corpus run measures, so the tool's own logic is
   checkable on a machine with no medical data (the FIXTURE-VERIFICATION-GATE discipline: a
   committed adversarial twin beats a real file nothing else can re-run). */
function selftest(ctx) {
  const adapt = ctx.adaptEnvelopeNode,
    fpb = ctx.fusePeriodicBreathing;
  let fail = 0;
  const ok = (name, cond, detail) => {
    console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail != null && !cond ? '  — ' + detail : ''));
    if (!cond) fail++;
  };
  if (typeof adapt !== 'function' || typeof fpb !== 'function') {
    console.log('  FAIL Integrator realm did not expose adaptEnvelopeNode / fusePeriodicBreathing');
    return 1;
  }
  const t0 = Date.UTC(2026, 5, 25, 22, 0, 0);
  const oxy = (n) => ({
    schema: { node: 'OxyDex' },
    recording: { startEpochMs: t0, durationMin: 480, offsetMin: null },
    ganglior_events: Array.from({ length: n }, (_, i) => ({ t: '22:30:00', tMs: t0 + 1800000 + i * 60000, impulse: 'periodic_breathing', node: 'OxyDex', conf: 0.5, meta: { cycleLen: 50 } }))
  });
  const cpap = (fires) => ({
    schema: { node: 'CPAPDex' },
    recording: { startEpochMs: t0, durationMin: 480, offsetMin: null, sessions: [{ mode: 'CPAP' }] },
    metrics: { residualAHI: 5, periodicBreathingPct: fires ? 7.5 : 0 },
    ganglior_events: fires ? [{ t: '22:35:00', tMs: t0 + 2100000, impulse: 'periodic_breathing', node: 'CPAPDex', conf: 0.8, meta: {} }] : []
  });

  // (1) OxyDex on, CPAPDex fires → corroborated; strip the OxyDex leg and it collapses.
  const a = probeNight(adapt, fpb, oxy(5), cpap(true));
  ok('OxyDex + firing CPAPDex corroborates at 2 observers', a.corroborated && a.nObservers === 2, JSON.stringify(a));
  ok('removing the OxyDex leg collapses that corroboration', a.corroboratedWithoutOxyPB === false, JSON.stringify(a));

  // (2) OxyDex on, CPAPDex silent → no corroboration. Held with (1) this is the whole finding:
  //     with OxyDex on in both, the verdict tracks CPAPDex and nothing else.
  const b = probeNight(adapt, fpb, oxy(5), cpap(false));
  ok('OxyDex + silent CPAPDex does NOT corroborate', b.corroborated === false, JSON.stringify(b));

  // (3) the noisy-OR uplift the always-on leg adds. Device leg = 0.8 x weight 1.0; OxyDex leg =
  //     median(0.5) x weight 0.6 = 0.30; 1 - (1-0.8)(1-0.30) = 0.86. Pinned as a number because
  //     "it raises confidence" is exactly the kind of claim this repo requires to be computed.
  ok('always-on leg lifts block conf 0.80 -> 0.86', a.conf === 0.86, 'conf=' + a.conf);
  ok('the OxyDex leg reports its own conf', a.oxyLegConf === 0.5, 'oxyLegConf=' + a.oxyLegConf);
  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all green');
  return fail;
}

/* ── corpus run ──────────────────────────────────────────────────────────────────────────── */
function run(ctx) {
  const adapt = ctx.adaptEnvelopeNode,
    fpb = ctx.fusePeriodicBreathing;
  if (!CPAP || !existsSync(CPAP)) {
    console.error('need --cpap <cpap-exports.json> (see tools/cpap-corpus.mjs); --selftest runs without a corpus');
    process.exit(2);
  }
  const cpapDoc = JSON.parse(readFileSync(CPAP, 'utf8'));
  const cpapArr = Array.isArray(cpapDoc) ? cpapDoc : cpapDoc.exports || [];
  const byDay = new Map();
  for (const c of cpapArr) if (c && c._day) byDay.set(dayKey(c._day), c);

  const rows = [];
  let oxyNights = 0,
    ecgSeen = 0,
    ecgWithApnea = 0;
  for (const d of readdirSync(DIR)
    .filter((x) => /^\d{4}-\d\d-\d\d$/.test(x))
    .sort()) {
    const op = join(DIR, d, `OxyDex_${d}.node-export.json`);
    if (!existsSync(op)) continue;
    oxyNights++;
    const ep = join(DIR, d, `ECGDex_${d}.node-export.json`);
    if (existsSync(ep)) {
      ecgSeen++;
      const e = JSON.parse(readFileSync(ep, 'utf8'));
      if (e.apnea && e.apnea.cvhrIndex != null) ecgWithApnea++;
    }
    const c = byDay.get(d);
    if (!c) continue;
    rows.push(Object.assign({ night: d }, probeNight(adapt, fpb, JSON.parse(readFileSync(op, 'utf8')), c)));
  }

  const n = rows.length;
  const oxyOn = rows.filter((r) => r.oxyEpisodes > 0).length;
  const corr = rows.filter((r) => r.corroborated);
  const survives = rows.filter((r) => r.corroboratedWithoutOxyPB).length;
  const uplift = corr.filter((r) => r.conf != null && r.oxyLegConf != null);
  const out = {
    pairedNights: n,
    oxyDexPBNights: oxyOn,
    oxyDexPBRate: n ? +(oxyOn / n).toFixed(3) : null,
    corroboratedNights: corr.length,
    corroboratedWithoutOxyDexPB: survives,
    decisionsOwedToTheAlwaysOnLeg: corr.length - survives,
    blockConf: uplift.map((r) => r.conf),
    ecgDexExportsSeen: ecgSeen,
    ecgDexExportsCarryingCvhrIndex: ecgWithApnea,
    nights: rows
  };
  if (AS_JSON) {
    console.log(JSON.stringify(out, null, 2));
    return 0;
  }
  console.log('PB FUSION BLAST RADIUS — OXYDEX-PB-OVERCALL §3.4\n');
  console.log('  OxyDex nights in ' + DIR + ' : ' + oxyNights + '   paired with a CPAPDex export: ' + n);
  console.log('  OxyDex emits periodic_breathing : ' + oxyOn + ' / ' + n + (n ? '  (' + Math.round((oxyOn / n) * 100) + ' %)' : ''));
  console.log('  fusePeriodicBreathing corroborates : ' + corr.length + ' / ' + n);
  console.log('  …still corroborates with the OxyDex leg removed : ' + survives + ' / ' + n);
  console.log('  → corroboration decisions owed entirely to the always-on leg : ' + (corr.length - survives));
  if (uplift.length) console.log('  block conf on corroborated nights : ' + uplift.map((r) => r.conf).join(', '));
  console.log('\n  ECGDex leg: ' + ecgWithApnea + ' of ' + ecgSeen + ' ECGDex exports carry apnea.cvhrIndex.');
  /* The caveat below used to print UNCONDITIONALLY, so once the corpus was regenerated the output read
     "18 of 18 carry apnea.cvhrIndex" immediately followed by an explanation of what "0 of N" means —
     a stale note contradicting the line above it, which is worse than no note: a reader skimming for
     the scope caveat finds one and concludes the leg is still unexercised. Print the state that
     actually holds. */
  if (!ecgWithApnea) {
    console.log('  (0 of N means UNEXERCISED, not inert — the apnea block landed 2026-07-23, after this corpus');
    console.log('   was generated. Re-run tools/trio-batch.mjs to bring the third observer into scope.)\n');
  } else if (ecgWithApnea < ecgSeen) {
    console.log('  (PARTIAL — the nights without the block predate 2026-07-23; the third observer is in scope');
    console.log('   only for the ' + ecgWithApnea + ' that carry it.)\n');
  } else {
    console.log('  (The third observer IS in scope on every night here — this run is not OxyDex×CPAPDex only.)\n');
  }
  for (const r of rows)
    console.log(
      '  ' +
        r.night +
        '  oxyPB=' +
        String(r.oxyEpisodes).padStart(3) +
        '  corroborated=' +
        (r.corroborated ? 'yes' : 'no ') +
        '  nObs=' +
        r.nObservers +
        '  conf=' +
        (r.conf == null ? '—' : r.conf) +
        '  withoutOxyPB=' +
        (r.corroboratedWithoutOxyPB ? 'yes' : 'no')
    );
  return 0;
}

const ctx = realm();
process.exit(SELFTEST ? selftest(ctx) : run(ctx));
