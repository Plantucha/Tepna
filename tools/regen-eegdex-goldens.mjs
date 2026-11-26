#!/usr/bin/env node
/*
 * tools/regen-eegdex-goldens.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Regenerate EEGDex's committed node-export fixture by RE-RUNNING THE REAL MODULES on the
 * committed input and re-exporting — never by hand-editing a value (CLAUDE.md §🔏). The shared
 * scaffolding (diff/merge/rerecord/loop) lives ONCE in tools/regen-goldens-core.mjs; this file
 * supplies only EEGDex's vm realm + fixture builder.
 *
 * It drives the SAME seam the equivalence gate drives —
 *   EEGDSP.buildNodeExport(EEGDSP.compute(EEGDSP.ingest*(bytes))) — in a vm realm co-loaded like
 * EEGDex.src.html (headless subset, no render/app). THIS NODE HAS TWO INGESTS AND BOTH ARE HELD:
 *   synthetic_eegdex_golden        committed synthetic single-channel EEG EDF  [runs in CI]
 *   synthetic_eegdex_frames_golden committed synthetic headband raw frames     [runs in CI]
 *
 * The EDF input is BINARY, written by tools/make-synthetic-eeg-edf.mjs, so that fixture is the
 * first thing in the repo that holds EEGDex's header arithmetic, record decode and channel pick.
 *
 * The raw-frame input is TEXT, written by tools/make-synthetic-raw-frames.mjs, and it holds the
 * only two-clock road this node has: the frame tokeniser, the 14-bit unpack, the tick unwrap
 * across the 2^28 ns fold, DexClock.hostAxis over the row anchors, and the epoch placement that
 * spends it. The EDF road carries no host column at all, so no EDF fixture can reach any of it.
 *
 *   node tools/regen-eegdex-goldens.mjs           # regenerate + re-record + report what moved
 *   node tools/regen-eegdex-goldens.mjs --check   # report only, write nothing (CI-safe)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
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
// eegdex-dsp.js is a dual-mode ES module; classic-load it into the vm realm.
const DexBuild = createRequire(import.meta.url)('./build-core.js');

/* ── the EEGDex.src.html script order (headless subset — no render/app) ── */
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
    console,
    setTimeout,
    clearTimeout
  };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  const ctx = vm.createContext(sb);
  ctx.__DEX_NAMESPACED__ = true;
  // cpapdex-edf.js BEFORE eegdex-dsp.js: the DSP reads its EDF through that reader, by design.
  // clock.js AND muse-frame.js ARE LOAD-BEARING FOR THE RAW-FRAME FIXTURE, for the same reason the
  // two stage modules are below: `ingestMuseRaw` reads both off the realm at CALL time and refuses
  // BY NAME — `clock-absent`, `frame-reader-absent` — so a realm without them would throw a named
  // refusal rather than mint anything, and clock.js must load BEFORE the DSP (CLAUDE.md §✅).
  // THE TWO STAGE MODULES ARE LOAD-BEARING HERE. The DSP's one stage path reads them off the realm
  // at CALL time and refuses by name when either is absent, so a realm without them would mint a
  // fixture whose every epoch reads null — a known answer about nothing.
  for (const f of [
    'kernel-constants.js',
    'signal-frame.js',
    'dex-export.js',
    'metric-registry.js',
    'codegen/generated/eegdex-registry.js',
    'cpapdex-edf.js',
    'clock.js',
    'muse-frame.js',
    'eegdex-stage-features.js',
    'eegdex-stage-model.js',
    'eegdex-dsp.js'
  ])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const { EEGDSP, CpapEdf, MuseFrame, DexClock } = realm();

/* THE MODEL THE PAGE ITSELF CARRIES, and the fixture is a known answer OVER IT. It is tracked in
   the repository, so CI reads the same bytes; the first 16 characters of its hash reach the export
   through `stageSource`, so a fixture scored by another model cannot pass for this one. The one-pass
   file is the page's default for the reason the brief states: the two-pass file refuses an import
   shorter than 160 epochs. */
const MODEL = JSON.parse(fs.readFileSync(path.join(REPO, 'eeg-stage-model-base-2026-11-17.json'), 'utf8'));

/* buildNodeExport(compute(ingestEDF(bytes))) off the committed EDF, or null when it is absent.
   `edf` is passed EXPLICITLY: the DSP's default reads a `global.CpapEdf` this realm does not
   declare, and a null here would read downstream as "this file holds no EEG". */
const fromEdf = (file) => {
  const p = path.join(UP, file);
  if (!fs.existsSync(p)) return null;
  const b = fs.readFileSync(p);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const frame = EEGDSP.ingestEDF(ab, { edf: CpapEdf });
  if (!frame || !frame.ok) throw new Error(`ingestEDF refused ${file}: ${frame ? frame.reason : 'no answer'}`);
  const res = EEGDSP.compute(frame, { model: MODEL });
  if (!res || res.err) throw new Error(`compute refused ${file}: ${res ? res.err : 'no answer'}`);
  return EEGDSP.buildNodeExport(res);
};

/* buildNodeExport(compute(ingestMuseRaw(text))) off the committed raw-frame capture, or null when
   it is absent. The two libraries are passed EXPLICITLY for the same reason `edf` is above: the
   DSP's defaults read globals off `global`, which this realm does not declare, and the ingest would
   then refuse by name on a file that is perfectly readable. */
const fromRaw = (file) => {
  const p = path.join(UP, file);
  if (!fs.existsSync(p)) return null;
  const frame = EEGDSP.ingestMuseRaw(fs.readFileSync(p, 'utf8'), { frame: MuseFrame, clock: DexClock });
  if (!frame || !frame.ok) throw new Error(`ingestMuseRaw refused ${file}: ${frame ? frame.reason : 'no answer'}`);
  /* THE TWO-CLOCK ROAD IS THE POINT OF THIS FIXTURE, so a frame that lost it stops the regen rather
     than minting a known answer that silently pins the degraded path. `hostCorr` absent means
     `compute` would publish `tMsBasis: 'device-index'`, which is a different contract. */
  if (!frame.hostCorr || typeof frame.hostCorr.correctionAt !== 'function')
    throw new Error(`ingestMuseRaw read ${file} with no host-disciplined axis (independent ${frame.hostAxis && frame.hostAxis.independent}), so the epoch times would ride the device index`);
  const res = EEGDSP.compute(frame, { model: MODEL });
  if (!res || res.err) throw new Error(`compute refused ${file}: ${res ? res.err : 'no answer'}`);
  if (res.tMsBasis !== 'host-disciplined') throw new Error(`compute placed ${file}'s epochs on ${res.tMsBasis} (${res.tMsBasisReason}), not on the host axis`);
  return EEGDSP.buildNodeExport(res);
};

/* ── the fixtures tests/run-tests.mjs wires as equiv.eegdex ── */
const FIXTURES = [
  {
    name: 'synthetic_eegdex_golden.node-export.json',
    build: () => fromEdf('synthetic_eegdex_c4.edf'),
    // `newRecord` = this fixture may be MINTED if absent (a first generation), rather than skipped.
    // EEGDex's fragment carried `fixtures: {}` until this record, so the mint IS the unit.
    newRecord: {
      added: '2026-11-15',
      inputs: ['synthetic_eegdex_c4.edf'],
      note: "EEGDex's first known answer. The input is a single-channel EEG EDF written by tools/make-synthetic-eeg-edf.mjs around EEGDSP.genSynthetic's own 1800 s signal: closed-form sines plus a seeded LCG, no RNG, no Date.now(), header identity fields 'X', no recording of any person. It is therefore committed by exact-name negation in .gitignore, so this leg runs in CI with no corpus. It is also the first fixture that puts ingestEDF in the gated path at all: the header clock, the int16 record decode, the physical scaling and the channel pick out of the header."
    }
  },
  {
    name: 'synthetic_eegdex_frames_golden.node-export.json',
    build: () => fromRaw('synthetic_eegdex_frames_RAW.txt'),
    newRecord: {
      added: '2026-11-26',
      inputs: ['synthetic_eegdex_frames_RAW.txt'],
      note: "EEGDex's second ingest, and the only committed input in the repo that carries TWO clocks. The input is a 60 s synthetic headband raw-frame capture written by tools/make-synthetic-raw-frames.mjs: a declared sum of sines plus a seeded LCG packed into genuine 14-bit frame bytes, a device tick that folds every 2^28 ns, and a host stamp column with up to 12 ms of delivery jitter and a planted rate offset of -49.9 ppm (the measured value for this device). No RNG, no Date.now(), no recording of any person, so it is committed by exact-name negation in .gitignore and this leg runs in CI with no corpus. WHAT IT PINS: the frame tokeniser, the 14-bit unpack, the tick unwrap, DexClock.hostAxis over the row anchors reporting independent true and deviceDrawn false (the realistic device axis clock.js asks a deviceDrawn adopter to re-cut its fixtures to), tMsBasis host-disciplined, the placed epoch time (epoch 1 lands 2 ms off its device-index time), and timingSource device+host. WHAT IT DOES NOT PIN: a rate, because 12 ms of jitter over 60 s swamps the 3.0 ms the plant moves; and nothing clinical, because the stage model declares needs_whole_night and two epochs make its night features degenerate by construction. The 1800 s EDF fixture beside it is the one that stages a plausible night."
    }
  }
];

const rerecord = makeRerecord({ repo: REPO, node: 'EEGDex', bundle: 'EEGDex.html', fixturesDir: UP, corpusDir: CORPUS, ManifestGate });
await runRegen({
  fixtures: FIXTURES,
  fixturesDir: UP,
  corpusDir: CORPUS,
  check: CHECK,
  rerecord,
  absentInputHint: 'both committed synthetic inputs are git-tracked; regenerate them byte-identically with `node tools/make-synthetic-eeg-edf.mjs` and `node tools/make-synthetic-raw-frames.mjs`'
});
