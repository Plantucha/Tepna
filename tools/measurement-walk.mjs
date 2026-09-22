#!/usr/bin/env node
/*
 * tools/measurement-walk.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * WALK A MEASUREMENT BACK TO ITS RAW INPUT — the roadmap §3 backward walk-through, as a check.
 *
 * MEASUREMENT-PROVENANCE-ROADMAP §3's done-when asks for "a written walk-through tracing ODI-4 →
 * window → channel → envelope → raw .dat" that is CHECKABLE. Prose that names hashes is a claim; this
 * tool re-derives every hop of the chain from the artifacts on disk and reports each one ✓/✗:
 *
 *   value        the block's number IS the element's number (stats.meanSpo2 / stats.t90pct /
 *                odi4.rate / hypoxicBurden.rate) — lineage added, nothing recomputed
 *   window       startTMs = t0Ms, endTMs = the input's last stamped row, re-read from the input
 *   channel      sourceChannel is device:stream
 *   code         code.manifestHash / code.computeHash ≡ the SHIPPED OxyDex.html, by manifest-gate.js's
 *                projection, and manifestHash ≡ provenance/OxyDex.json (the GATE-A ledger)
 *   inputHash    evidence.inputHash ≡ the fixture's contentId ≡ SignalFrame.computeContentId
 *                RECOMPUTED from the committed input by the real parser
 *   envelope     evidence.envelopeRef, or the stated reason it is absent (a CSV has no envelope; the
 *                join is on the .dat session_id)
 *   raw file     the ledger's inputHashes[file] ≡ sha256[0:16] of the input bytes on disk, and its
 *                outputHash ≡ sha256[0:16] of the fixture bytes
 *
 * Every hop is derived, never read off the fixture and echoed back. A ✗ on `code` after a rebuild
 * means the fixtures were not regenerated (`node tools/regen-oxydex-goldens.mjs`); a ✗ on `inputHash`
 * means the committed input no longer decodes to the samples the block was computed over.
 *
 *   node tools/measurement-walk.mjs                       # all three OxyDex fixtures (real ones need the corpus)
 *   node tools/measurement-walk.mjs --fixture <name.json> # one
 *   node tools/measurement-walk.mjs --json                # machine-readable
 *   node tools/measurement-walk.mjs --selftest            # the plants: a wrong value / hash / contentId is CAUGHT
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveCorpus } from './regen-goldens-core.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UP = path.join(REPO, 'uploads');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : null;
};
const req = createRequire(import.meta.url);
const ManifestGate = req(path.join(REPO, 'manifest-gate.js'));
const DexBuild = req('./build-core.js');

const FIXTURES = [
  { name: 'OxyDex_2026-06-13_1056_summary.json', input: 'O2Ring S 2100_20260612230016.csv' },
  { name: 'OxyDex_2026-06-25_0439_summary.json', input: 'O2Ring S 2100_20260624222730.csv' },
  { name: 'synthetic_oxydex_golden.node-export.json', input: 'synthetic_oxydex_o2ring.csv' },
  /* The stored .dat night WITH its acquisition envelope — the one fixture whose envelope hop is
     RE-DERIVED rather than read off the fixture (residue 2026-09-21-measurement-envelope-hop-unexercised). */
  { name: 'OxyDex_2026-09-19_2245_stored_summary.json', input: 'Wellue_O2Ring-S_20260919224526_STORED.dat', envelope: 'Wellue_O2Ring-S_20260919224526_STORED.dat.meta.json' }
];
const IDS = {
  meanSpo2: (el) => el.stats && el.stats.meanSpo2,
  t90: (el) => el.stats && el.stats.t90pct,
  odi4: (el) => el.odi4 && el.odi4.rate,
  hypoxicBurden: (el) => el.hypoxicBurden && el.hypoxicBurden.rate
};

/* The headless OxyDex realm, in OxyDex.src.html order (same recipe as regen-oxydex-goldens). */
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
    addEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    value: '',
    checked: false
  });
  const doc = {
    getElementById: () => el(),
    querySelector: () => el(),
    querySelectorAll: () => [],
    createElement: () => el(),
    addEventListener: noop,
    body: el(),
    head: el(),
    documentElement: { dataset: {} }
  };
  const sb = {
    document: doc,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: { userAgent: 'node' },
    location: { search: '', href: '' },
    console,
    setTimeout,
    clearTimeout,
    addEventListener: noop
  };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  const ctx = vm.createContext(sb);
  ctx.__DEX_NAMESPACED__ = true;
  for (const f of [
    'kernel-constants.js',
    'signal-frame.js',
    'dex-export.js',
    'oxydex-util.js',
    'crossnight-envelope.js',
    'metric-registry.js',
    'dex-profile.js',
    'oxydex-registry.js',
    'oxydex-cross.js',
    'clock.js',
    'oxydex-profile.js',
    'oxydex-dsp.js'
  ])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

/* ── the walk, as a pure function over what the caller hands it ──
   `art` = { fixtureEl, inputText, bundle:{manifestHash,computeHash}|null, ledgerManifestHash, ledgerRec,
             inputSha16, outputSha16, recomputed:{contentId,t0Ms,tEndMs}|null }
   Returns [{ hop, id?, ok, detail }]. Pure so the selftest can plant a wrong artifact and watch it fail. */
export function walk(art) {
  const out = [];
  const el = art.fixtureEl;
  const m = el && el.measurement;
  const push = (hop, ok, detail, id) => out.push({ hop, id: id || null, ok: !!ok, detail });
  if (!m || typeof m !== 'object') {
    push('blocks', false, 'the fixture carries no measurement map — regenerate (node tools/regen-oxydex-goldens.mjs)');
    return out;
  }
  for (const id of Object.keys(IDS)) {
    const b = m[id];
    if (!b) {
      push('value', false, 'no block', id);
      continue;
    }
    const v = IDS[id](el);
    push('value', b.value === v, `${b.value} ≡ element ${v}`, id);
    push('channel', typeof b.sourceChannel === 'string' && b.sourceChannel.indexOf(':') > 0, b.sourceChannel, id);
    push('basis', ['measured', 'derived', 'estimated'].includes(b.basis), b.basis, id);
  }
  const b = m.odi4 || m[Object.keys(m)[0]];
  // window — re-read from the input, not from the fixture's own t0Ms
  if (art.recomputed) {
    push(
      'window',
      b.window && b.window.startTMs === art.recomputed.t0Ms && b.window.endTMs === art.recomputed.tEndMs,
      `${b.window && b.window.startTMs}→${b.window && b.window.endTMs} ≡ input ${art.recomputed.t0Ms}→${art.recomputed.tEndMs}`
    );
    push(
      'inputHash',
      b.evidence && b.evidence.inputHash === art.recomputed.contentId && el.contentId === art.recomputed.contentId,
      `${b.evidence && b.evidence.inputHash} ≡ contentId recomputed from the input ${art.recomputed.contentId}`
    );
  } else {
    push('window', null, 'input absent — not re-derived');
    push('inputHash', null, 'input absent — not re-derived');
  }
  // code — against the shipped artifact AND the ledger
  if (art.bundle) {
    push('code.computeHash', b.code && b.code.computeHash === art.bundle.computeHash, `${b.code && b.code.computeHash} ≡ OxyDex.html ${art.bundle.computeHash}`);
    push('code.manifestHash', b.code && b.code.manifestHash === art.bundle.manifestHash, `${b.code && b.code.manifestHash} ≡ OxyDex.html ${art.bundle.manifestHash}`);
    push('ledger.manifestHash', art.ledgerManifestHash === art.bundle.manifestHash, `provenance/OxyDex.json ${art.ledgerManifestHash} ≡ OxyDex.html ${art.bundle.manifestHash}`);
  } else push('code', null, 'OxyDex.html absent — not re-derived');
  // envelope — RE-DERIVED when the envelope file is on disk (art.envelope), never echoed off the fixture.
  // The join the DSP makes (_attachAcqEvidence) is session_id ∈ the .dat filename; the envelope also
  // carries its own claim about the raw bytes (artifact_sha256), which the walk holds it to.
  const ev = b.evidence || {};
  if (art.envelope) {
    const env = art.envelope;
    const sid = env.sessionId;
    const joins = !!sid && typeof art.inputName === 'string' && art.inputName.indexOf(sid) >= 0;
    if (!ev.envelopeRef) push('envelope', false, 'envelope on disk (session_id ' + sid + ') but the fixture carries envelopeRef null — the join did not attach');
    else if (!joins) push('envelope', false, 'envelope session_id ' + sid + ' is not in the input filename ' + art.inputName + ' — the DSP join would not attach it');
    else push('envelope', ev.envelopeRef === sid, 'envelopeRef ' + ev.envelopeRef + ' ≡ envelope session_id ' + sid + ' (joined on the .dat filename)');
    if (env.artifactSha256 && art.inputSha256)
      push(
        'envelope.artifactSha256',
        env.artifactSha256 === art.inputSha256,
        'envelope artifact_sha256 ' + env.artifactSha256.slice(0, 16) + '… ≡ sha256(input bytes) ' + art.inputSha256.slice(0, 16) + '…'
      );
    else push('envelope.artifactSha256', null, 'input absent — not re-derived');
  } else if (ev.envelopeRef)
    push(
      'envelope',
      art.envelopeExpected ? null : true,
      art.envelopeExpected ? 'envelope file absent — not re-derived (envelopeRef ' + ev.envelopeRef + ' unverified)' : 'envelopeRef ' + ev.envelopeRef + ' (join on the .dat session_id)'
    );
  else push('envelope', typeof ev.envelopeReason === 'string' && ev.envelopeReason.length > 0, ev.envelopeReason ? 'null — ' + ev.envelopeReason : 'null WITHOUT a reason (∅ violation)');
  // raw file ↔ ledger
  if (art.ledgerRec) {
    const rec = art.ledgerRec;
    if (art.inputSha16) {
      // EVERY ledger input, not the first: a .dat fixture pins two (the night and its envelope).
      const files = Object.keys(rec.inputHashes || {});
      const have = art.inputSha16ByFile || (files.length ? { [files[0]]: art.inputSha16 } : {});
      for (const f of files) {
        if (have[f] == null) push('raw.inputHash', null, `ledger inputHashes[${f}] — input absent — not re-derived`);
        else push('raw.inputHash', rec.inputHashes[f] === have[f], `ledger inputHashes[${f}] ${rec.inputHashes[f]} ≡ sha256[0:16](input bytes) ${have[f]}`);
      }
      if (!files.length) push('raw.inputHash', false, 'ledger record pins NO inputs');
    } else push('raw.inputHash', null, 'input absent — not re-derived');
    push('raw.outputHash', rec.outputHash === art.outputSha16, `ledger outputHash ${rec.outputHash} ≡ sha256[0:16](fixture bytes) ${art.outputSha16}`);
  } else push('ledger', false, 'no provenance/OxyDex.json record for this fixture');
  return out;
}

/* ── ONE VERDICT PER FIXTURE — `tepna.verdict/1` (VERDICT-CONTRACT-2026-09-21 §1; this tool is a wave-1
   adopter). The ✓/∘/✗ table above is the prose; this is the API. A ✗ hop ⇒ FAIL naming the hop; a ∘ hop
   (not re-derived — input absent, bundle absent) ⇒ NOT_RUN for the fixture, naming the hop, result null
   (nothing examined there is not a pass); all ✓ ⇒ PASS. Population is the hop count as an EQUALITY:
   checked + excluded = eligible, excluded = the ∘ hops. Pure, so the selftest can plant against it.
   The validator (`verdict.js`) is not on main yet — this writes to §1's shape; wire the call when it lands. */
export function verdictFor(fixture, hops, opts = {}) {
  const isAbsent = (h) => h.ok === false && /absent/.test(h.detail);
  const broken = hops.filter((h) => h.ok === false && !isAbsent(h));
  const notDerived = hops.filter(isAbsent);
  const walked = hops.filter((h) => h.ok === true);
  const name = (h) => h.hop + (h.id ? '[' + h.id + ']' : '');
  const status = broken.length ? 'FAIL' : notDerived.length ? 'NOT_RUN' : 'PASS';
  const reason =
    status === 'FAIL'
      ? broken.length + ' hop(s) do not walk back: ' + broken.map(name).join(', ')
      : status === 'NOT_RUN'
        ? notDerived.length + ' hop(s) not re-derived: ' + notDerived.map((h) => name(h) + ' (' + h.detail + ')').join('; ')
        : null;
  return {
    schema: 'tepna.verdict/1',
    gate: 'measurement-walk',
    status,
    scope: 'internal', // P5 — a walk over committed fixtures is repo-internal evidence, never a publishable claim
    population: { checked: walked.length + broken.length, eligible: hops.length, excluded: notDerived.length },
    criterion: { name: 'every-derived-hop-walks-back', threshold: 0, unit: 'broken hops', direction: 'eq' },
    result: status === 'NOT_RUN' ? null : { broken: broken.length, walked: walked.length, hops: hops.map((h) => ({ hop: name(h), ok: h.ok })) },
    evidence: ['tools/measurement-walk.mjs', 'uploads/' + fixture, 'provenance/OxyDex.json'].concat(opts.inputs || []),
    reason,
    producedBy: opts.commit
      ? { tool: 'tools/measurement-walk.mjs', commit: opts.commit }
      : { tool: 'tools/measurement-walk.mjs', commit: null, commitReason: 'git unavailable in this checkout (tarball or no .git)' },
    at: opts.at || new Date().toISOString()
  };
}

async function gather(fx, ctx) {
  const fxPath = path.join(UP, fx.name);
  if (!fs.existsSync(fxPath)) return null;
  const fixture = JSON.parse(fs.readFileSync(fxPath, 'utf8'));
  const fixtureEl = Array.isArray(fixture) ? fixture[0] : fixture;
  const corpus = resolveCorpus(REPO);
  const inPath = [path.join(corpus, fx.input), path.join(UP, fx.input)].find((p) => fs.existsSync(p)) || null;
  const bundlePath = path.join(REPO, 'OxyDex.html');
  const bundleText = fs.existsSync(bundlePath) ? fs.readFileSync(bundlePath, 'utf8') : null;
  const bundle = bundleText ? { manifestHash: await ManifestGate.manifestHashFromText(bundleText), computeHash: await ManifestGate.computeHashFromText(bundleText) } : null;
  const frag = JSON.parse(fs.readFileSync(path.join(REPO, 'provenance', 'OxyDex.json'), 'utf8'));
  let recomputed = null;
  let inputSha16 = null;
  let inputSha256 = null;
  const inputSha16ByFile = {};
  if (inPath) {
    const bytes = fs.readFileSync(inPath);
    inputSha16 = await ManifestGate.sha16(new Uint8Array(bytes));
    inputSha16ByFile[fx.input] = inputSha16;
    inputSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    // A stored .dat decodes through the SAME function the app's drop path uses; a CSV is text.
    const text = /\.dat$/i.test(fx.input) ? ctx.OxyDex.decodeO2RingBinToCSV(new Uint8Array(bytes), fx.input, null) : bytes.toString('utf8');
    const night = ctx.OxyDex.computeNight({ text }, fx.input);
    if (night) recomputed = { contentId: night.contentId, t0Ms: night.t0Ms, tEndMs: night.tEndMs };
  }
  // The acquisition envelope, read from disk so the hop is DERIVED: session_id (the join key) and the
  // envelope's own sha256 claim about the raw artifact.
  let envelope = null;
  if (fx.envelope) {
    const envPath = [path.join(corpus, fx.envelope), path.join(UP, fx.envelope)].find((p) => fs.existsSync(p)) || null;
    if (envPath) {
      const envBytes = fs.readFileSync(envPath);
      inputSha16ByFile[fx.envelope] = await ManifestGate.sha16(new Uint8Array(envBytes));
      const meta = JSON.parse(envBytes.toString('utf8'));
      const acq = (meta && meta.acquisition_evidence) || {};
      envelope = { sessionId: acq.session_id != null ? String(acq.session_id) : null, artifactSha256: acq.artifact_sha256 || null };
    }
  }
  return {
    fixtureEl,
    inputPath: inPath,
    inputName: fx.input,
    bundle,
    ledgerManifestHash: frag.manifestHash,
    ledgerRec: frag.fixtures && frag.fixtures[fx.name],
    inputSha16,
    inputSha16ByFile,
    inputSha256,
    outputSha16: await ManifestGate.sha16(new Uint8Array(fs.readFileSync(fxPath))),
    recomputed,
    envelope,
    envelopeExpected: !!fx.envelope
  };
}

function selftest() {
  const mk = () => {
    const code = { manifestHash: 'aaaaaaaaaaaa', computeHash: 'bbbbbbbbbbbb' };
    const block = (id, value, basis) => ({
      metricId: id,
      value,
      window: { startTMs: 1000, endTMs: 5000 },
      sourceChannel: 'O2Ring:spo2',
      code,
      evidence: { envelopeRef: null, inputHash: 'c0ffee000000', envelopeReason: 'no envelope (selftest)' },
      basis
    });
    const el = {
      contentId: 'c0ffee000000',
      stats: { meanSpo2: 96.1, t90pct: 0.3 },
      odi4: { rate: 2.5 },
      hypoxicBurden: { rate: 1.1 },
      measurement: { meanSpo2: block('meanSpo2', 96.1, 'measured'), t90: block('t90', 0.3, 'measured'), odi4: block('odi4', 2.5, 'derived'), hypoxicBurden: block('hypoxicBurden', 1.1, 'derived') }
    };
    return {
      fixtureEl: el,
      bundle: { manifestHash: 'aaaaaaaaaaaa', computeHash: 'bbbbbbbbbbbb' },
      ledgerManifestHash: 'aaaaaaaaaaaa',
      ledgerRec: { inputHashes: { 'in.csv': '0123456789abcdef' }, outputHash: 'fedcba9876543210' },
      inputSha16: '0123456789abcdef',
      outputSha16: 'fedcba9876543210',
      recomputed: { contentId: 'c0ffee000000', t0Ms: 1000, tEndMs: 5000 }
    };
  };
  const fails = [];
  const check = (name, cond) => {
    if (!cond) fails.push(name);
  };
  const allOk = (r) => r.every((x) => x.ok === true);
  const failsOn = (r, hop) => r.some((x) => x.hop === hop && x.ok === false);
  // 1 · anti-vacuity: a consistent chain walks green on every hop, and every hop RAN
  const clean = walk(mk());
  check('consistent chain → every hop ✓', allOk(clean));
  check(
    'every hop ran (denominator)',
    ['value', 'window', 'inputHash', 'code.computeHash', 'code.manifestHash', 'ledger.manifestHash', 'envelope', 'raw.inputHash', 'raw.outputHash'].every((h) => clean.some((x) => x.hop === h))
  );
  // 2 · plants — each hop must be the one that catches its own corruption
  let a = mk();
  a.fixtureEl.measurement.odi4.value = 2.6;
  check('PLANT value drift → value ✗', failsOn(walk(a), 'value'));
  a = mk();
  a.bundle.computeHash = 'dddddddddddd';
  check('PLANT rebuilt bundle without regen → code.computeHash ✗', failsOn(walk(a), 'code.computeHash') && !failsOn(walk(a), 'value'));
  a = mk();
  a.recomputed.contentId = 'deadbeef0000';
  check('PLANT input no longer decodes to the same samples → inputHash ✗', failsOn(walk(a), 'inputHash'));
  a = mk();
  a.recomputed.tEndMs = 6000;
  check('PLANT window edge off the input → window ✗', failsOn(walk(a), 'window'));
  a = mk();
  a.inputSha16 = '0000000000000000';
  check('PLANT raw bytes changed under the ledger → raw.inputHash ✗', failsOn(walk(a), 'raw.inputHash'));
  a = mk();
  a.inputSha16ByFile = { 'in.csv': '0123456789abcdef', 'in.meta.json': '0000000000000000' };
  a.ledgerRec.inputHashes['in.meta.json'] = '1111111111111111';
  check(
    'PLANT a SECOND ledger input (the envelope) changed → raw.inputHash ✗ on that file, not only the first',
    walk(a).some((x) => x.hop === 'raw.inputHash' && x.ok === false && /in\.meta\.json/.test(x.detail))
  );
  a = mk();
  a.outputSha16 = '0000000000000000';
  check('PLANT fixture bytes changed under the ledger → raw.outputHash ✗', failsOn(walk(a), 'raw.outputHash'));
  a = mk();
  a.ledgerManifestHash = 'eeeeeeeeeeee';
  check('PLANT ledger ≠ bundle → ledger.manifestHash ✗', failsOn(walk(a), 'ledger.manifestHash'));
  a = mk();
  delete a.fixtureEl.measurement.odi4.evidence.envelopeReason;
  check('PLANT null envelopeRef without a reason → envelope ✗ (∅)', failsOn(walk(a), 'envelope'));
  a = mk();
  a.fixtureEl.measurement.odi4.evidence.envelopeRef = 'S8AW2100-20260612';
  check(
    'an attached envelope walks ✓ by its session_id',
    walk(a).some((x) => x.hop === 'envelope' && x.ok && x.detail.includes('S8AW2100'))
  );
  // 3 · the DERIVED envelope hop — an envelope on disk is held to the join AND to its own sha256 claim
  const mkEnv = () => {
    const e = mk();
    e.inputName = 'Wellue_O2Ring-S_20260919224526_STORED.dat';
    e.inputSha256 = 'ab'.repeat(32);
    e.envelope = { sessionId: '20260919224526', artifactSha256: 'ab'.repeat(32) };
    e.envelopeExpected = true;
    e.fixtureEl.measurement.odi4.evidence.envelopeRef = '20260919224526';
    return e;
  };
  const envClean = walk(mkEnv());
  check(
    'an envelope on disk walks ✓ by re-derivation (session_id joins the filename)',
    envClean.some((x) => x.hop === 'envelope' && x.ok === true && /≡ envelope session_id/.test(x.detail))
  );
  check(
    "…and the envelope's artifact_sha256 is held to the input bytes",
    envClean.some((x) => x.hop === 'envelope.artifactSha256' && x.ok === true)
  );
  a = mkEnv();
  a.envelope.sessionId = '20260919999999';
  check('PLANT corrupted envelope session_id → envelope ✗ (the join would not attach)', failsOn(walk(a), 'envelope'));
  a = mkEnv();
  a.fixtureEl.measurement.odi4.evidence.envelopeRef = null;
  a.fixtureEl.measurement.odi4.evidence.envelopeReason = 'no envelope';
  check('PLANT envelope on disk but fixture carries envelopeRef null → envelope ✗ (the join did not attach)', failsOn(walk(a), 'envelope'));
  a = mkEnv();
  a.envelope.artifactSha256 = 'cd'.repeat(32);
  check('PLANT envelope claims a different artifact sha256 → envelope.artifactSha256 ✗', failsOn(walk(a), 'envelope.artifactSha256'));
  a = mkEnv();
  a.envelope = null;
  check(
    'envelope EXPECTED but file absent → envelope ∘ (not re-derived), never ✓',
    walk(a).some((x) => x.hop === 'envelope' && x.ok === false && /absent/.test(x.detail))
  );
  // 4 · the verdict object — FAIL names the hop, NOT_RUN names the hop, PASS carries no reason
  const vPass = verdictFor('x.json', envClean, { commit: 'abc1234', at: '2026-09-21T00:00:00Z' });
  try {
    const Verdict = req(path.join(REPO, 'verdict.js'));
    const vv = Verdict.validate(vPass);
    check('VERDICT the PASS object validates under verdict.js: ' + (vv.errors || []).join(' | '), vv.ok);
    const vn = Verdict.validate(
      verdictFor(
        'x.json',
        envClean.map((h) => (h.hop === 'envelope' ? { ...h, ok: false, detail: 'input absent — not re-derived' } : h)),
        { commit: null }
      )
    );
    check('VERDICT a NOT_RUN object validates under verdict.js (commit null carries commitReason): ' + (vn.errors || []).join(' | '), vn.ok);
  } catch (e) {
    check('verdict.js loadable for the selftest: ' + e.message, false);
  }
  check(
    'VERDICT clean walk → PASS with reason null and an equality population',
    vPass.status === 'PASS' && vPass.reason === null && vPass.population.checked + vPass.population.excluded === vPass.population.eligible && vPass.population.excluded === 0
  );
  a = mkEnv();
  a.envelope.sessionId = '20260919999999';
  const vFail = verdictFor('x.json', walk(a));
  check('VERDICT a ✗ hop → FAIL naming the hop', vFail.status === 'FAIL' && /envelope/.test(vFail.reason) && vFail.result && vFail.result.broken === 1);
  a = mkEnv();
  a.envelope = null;
  const vNotRun = verdictFor('x.json', walk(a));
  check(
    'VERDICT a ∘ hop → NOT_RUN naming the hop, result null, excluded counted',
    vNotRun.status === 'NOT_RUN' && /envelope/.test(vNotRun.reason) && vNotRun.result === null && vNotRun.population.excluded === 1
  );
  a = mk();
  delete a.fixtureEl.measurement;
  check('PLANT no blocks → blocks ✗, nothing else claimed', failsOn(walk(a), 'blocks') && walk(a).length === 1);
  a = mk();
  a.recomputed = null;
  check(
    'absent input → window/inputHash NOT claimed (null, not ✓)',
    walk(a)
      .filter((x) => x.hop === 'window' || x.hop === 'inputHash')
      .every((x) => x.ok === false && /absent/.test(x.detail))
  );
  const N = 25;
  if (fails.length) {
    console.log(fails.map((f) => '  ✗ ' + f).join('\n'));
    console.log(`${fails.length} failed of ${N}`);
    process.exit(1);
  }
  console.log(`all ${N} selftests passed`);
}

async function main() {
  if (has('--selftest')) return selftest();
  const only = arg('--fixture');
  const ctx = realm();
  const report = [];
  let bad = 0;
  for (const fx of FIXTURES) {
    if (only && fx.name !== only) continue;
    const art = await gather(fx, ctx);
    if (!art) {
      console.log(`∘ ${fx.name} — committed fixture absent`);
      continue;
    }
    const hops = walk(art);
    report.push({ fixture: fx.name, input: art.inputPath, inputs: [fx.input].concat(fx.envelope ? [fx.envelope] : []).map((f) => 'uploads/' + f), hops });
    if (has('--json')) continue;
    console.log(`\n▸ ${fx.name}  ←  ${art.inputPath ? path.basename(art.inputPath) : fx.input + ' (ABSENT — real recording, gitignored)'}`);
    for (const h of hops) {
      const mark = h.ok === true ? '✓' : h.ok === false && /absent/.test(h.detail) ? '∘' : '✗';
      if (mark === '✗') bad++;
      console.log(`  ${mark} ${h.hop}${h.id ? ' [' + h.id + ']' : ''}  ${h.detail}`);
    }
  }
  if (has('--json')) {
    let commit = null;
    try {
      commit = req('node:child_process').execSync('git rev-parse --short HEAD', { cwd: REPO, encoding: 'utf8' }).trim();
    } catch (_) {
      /* no git ⇒ commit null, stated as such */
    }
    const verdicts = report.map((r) => verdictFor(r.fixture, r.hops, { inputs: r.inputs, commit }));
    // ONE fixture ⇒ ONE object (what a manifest `emits.cmd` reads); several ⇒ an array of objects.
    console.log(JSON.stringify(only && verdicts.length === 1 ? verdicts[0] : verdicts, null, 2));
    bad = verdicts.filter((v) => v.status === 'FAIL').length;
  }
  // Under --json stdout is ONE parseable document (the verdicts); the human line goes to stderr.
  (has('--json') ? console.error : console.log)(
    bad ? `\n✗ ${bad} ${has('--json') ? 'fixture(s) FAIL' : 'hop(s) do not walk back'} — the chain is broken` : '\n✓ every derived hop walks back to the artifacts on disk'
  );
  process.exit(bad ? 1 : 0);
}
main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(2);
});
