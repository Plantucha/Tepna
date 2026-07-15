#!/usr/bin/env node
/*
 * tools/regen-glucodex-goldens.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Regenerate GlucoDex's two committed node-export fixtures by RE-RUNNING THE REAL MODULES on
 * their committed inputs and re-exporting — never by hand-editing a value (CLAUDE.md §🔏).
 *
 * WHY THIS EXISTS. Sibling of `tools/regen-cpap-goldens.mjs`, for the same reason: `build.mjs`
 * re-stamps a fixture's `manifestHash` when the bundle moves, but it does NOT recompute the
 * fixture's OUTPUT bytes. DEEP-AUDIT-2026-07-14 §1 (long-gap interpolation excluded from EVERY
 * distribution metric) MOVED GlucoDex's export content, so the committed equiv fixture still
 * carried pre-fix daypart stats while the ledger asserted it was reproducible under the new code
 * — exactly the GATE-C gap CLAUDE.md warns about, and precisely what the Dex-Test-Suite
 * equivalence leg red-flagged (`GlucoDex.compute() ≡ committed export`).
 *
 * It drives the SAME seam the equivalence gate drives — `GlucoDex.compute({text})`, whose return
 * value IS the node-export (glucoBuildNodeExport) — in a vm realm co-loaded like GlucoDex.src.html.
 * No re-implemented parser, no hand-typed number:
 *
 *   GlucoDex_2026-06-27_equiv   compute({text: real Abbott Lingo CSV})      [real recording, gitignored]
 *   synthetic_glucodex_golden   compute({text: committed synthetic Lingo})  [committed — runs in CI]
 *
 * VOLATILE FIELDS ARE PRESERVED, NOT REGENERATED — `file` / `provenance` / `kernel` / `generated`
 * are exactly the keys the equivalence gate EXCLUDES from its diff (per-run metadata; the headless
 * path leaves provenance null where the app populated it). The merge takes the RECOMPUTED value for
 * every computed field and keeps the COMMITTED value for those keys. Same precedent as the CPAP tool.
 *
 * IT ALSO RE-RECORDS THE LEDGER. `build.mjs` re-stamps a fixture's `manifestHash`, but only when the
 * bundle hash MOVES — so a pure output regeneration under UNCHANGED code (this case: the fix was already
 * bundled upstream, 92a7dff75aca either side) leaves FIXTURE-PROVENANCE.json asserting the OLD
 * `outputHash`, and GATE B reds. There was no writer for that, and CLAUDE.md forbids hand-editing a
 * fixture hash — so this tool closes the loop the same way `build.mjs` does: it recomputes
 * `outputHash`/`inputHashes` (ManifestGate.sha16, the exact function the gates hash with) from the bytes
 * it just wrote and rewrites the record. Nothing is hand-typed; the ledger stays a BUILD OUTPUT.
 *
 *   node tools/regen-glucodex-goldens.mjs           # regenerate + re-record + report what moved
 *   node tools/regen-glucodex-goldens.mjs --check   # report only, write nothing (CI-safe)
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

/* ── the GlucoDex.src.html script order (headless subset — no render/app/profile) ── */
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
  for (const f of ['kernel-constants.js', 'signal-frame.js', 'dex-export.js', 'metric-registry.js', 'glucodex-registry.js', 'glucodex-dsp.js'])
    vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f });
  return ctx;
}

const ctx = realm();
const { GlucoDex } = ctx;

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

/* compute({text}) off a committed input, or null when the input is absent (gitignored recording) */
const fromCsv = (file) => {
  const p = path.join(UP, file);
  if (!fs.existsSync(p)) return null;
  return GlucoDex.compute({ text: fs.readFileSync(p, 'utf8') });
};

/* ── ledger re-record: outputHash + inputHashes, hashed with the gates' OWN sha16 (never hand-typed) ── */
const sha16Of = (file) => ManifestGate.sha16(new Uint8Array(fs.readFileSync(path.join(UP, file))));

async function rerecord(fixtureName, spec) {
  // P3 — GlucoDex fixtures live in provenance/GlucoDex.json; that fragment already carries GlucoDex's
  // committed manifestHash, so the mint path reads the code identity from it (no separate BUILD-MANIFEST).
  const fragPath = path.join(REPO, 'provenance', 'GlucoDex.json');
  const frag = JSON.parse(fs.readFileSync(fragPath, 'utf8'));
  frag.fixtures = frag.fixtures || {};
  let rec = frag.fixtures[fixtureName];
  // A BRAND-NEW fixture gets its record MINTED here, not hand-typed. Hand-authoring a ledger record means
  // hand-typing a manifestHash — the one thing CLAUDE.md §🔏 forbids — so the tool reads the bundle's
  // committed code identity from the fragment and hashes the bytes it just wrote.
  if (!rec && spec && spec.newRecord) {
    const mh = frag.manifestHash;
    if (!mh) return console.log(`      ⚠ provenance/GlucoDex.json has no manifestHash — record NOT minted`);
    rec = { bundle: 'GlucoDex.html', manifestHash: mh, added: spec.newRecord.added, note: spec.newRecord.note, inputs: spec.newRecord.inputs, outputHash: '', inputHashes: {} };
    frag.fixtures[fixtureName] = rec;
    console.log(`      + minted provenance/GlucoDex.json record (manifestHash ${mh})`);
  }
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

/* ── the two fixtures (the pair `tests/run-tests.mjs` wires as equiv.glucodex / .glucodex_synth) ── */
const FIXTURES = [
  {
    name: 'GlucoDex_2026-06-27_equiv.node-export.json',
    real: true,
    build: () => fromCsv('lingo-glucose-data-2026-MAY-23.csv')
  },
  {
    name: 'synthetic_glucodex_golden.node-export.json',
    build: () => fromCsv('synthetic_glucodex_lingo.csv')
  },
  // The ADVERSARIAL twin — a committed 14 h sensor-change gap (FIXTURE-VERIFICATION-GATE §4). The clean
  // golden above trips NO FLAG.GAP_LONG, which is exactly how DEEP-AUDIT-2026-07-14 §1 could call itself
  // export-inert on its evidence and ship a moved real export. This golden pins the GAP_LONG path in CI,
  // with no corpus: it separates current code (daypart n = 697) from pre-§1 code (864).
  {
    name: 'synthetic_glucodex_gap_golden.node-export.json',
    build: () => fromCsv('synthetic_glucodex_lingo_gap.csv'),
    // `newRecord` = this fixture may be MINTED if absent (a first generation), rather than skipped.
    // Without it, standing up a new fixture would mean hand-writing an export + a ledger record — the
    // two things §🔏 forbids outright. With it, the bytes come from the app and the hashes from the gates.
    newRecord: {
      added: '2026-07-14',
      inputs: ['synthetic_glucodex_lingo_gap.csv'],
      note: "ADDED 2026-07-14 (FIXTURE-VERIFICATION-GATE-2026-07-14 §4 — the GlucoDex adversarial twin that DEEP-AUDIT-FOLLOWUPS-2026-07-12 §A never shipped). The CLEAN synthetic Lingo trips NO FLAG.GAP_LONG, so the whole long-gap path was unexercised by any COMMITTED input — which is precisely how DEEP-AUDIT-2026-07-14 §1 could declare itself EXPORT-INERT on the clean golden's evidence, move the REAL Lingo night's export, and ship: the real-recording equiv leg SKIPS wherever uploads/ is absent (CI, and the executing session's machine). This input is a synthetic 3-day Lingo CSV with a 14 h sensor-change gap (readings stop on the post-lunch decay at 143 mg/dL, resume 14 h later at 100), so clean() draws 168 GAP_LONG cells that are NEVER measured glucose. It is COMMITTED, so it runs in CI with no corpus. It SEPARATES THE TWO CODES: current code excludes the drawn cells (daypart n = 168+216+169+144 = 697); pre-§1 code counted them as measured (n = 216+216+216+216 = 864). Generated by re-running the real modules via tools/regen-glucodex-goldens.mjs (GlucoDex.compute({text}) — the seam the equiv gate drives), never hand-edited."
    }
  }
];

let moved = 0,
  minted = 0,
  skipped = 0;
for (const F of FIXTURES) {
  const p = path.join(UP, F.name);
  const isNew = !fs.existsSync(p);
  if (isNew && !F.newRecord) {
    console.log(`  ⊘ ${F.name} — committed fixture absent`);
    skipped++;
    continue;
  }
  const old = isNew ? null : JSON.parse(fs.readFileSync(p, 'utf8'));

  let fresh;
  try {
    fresh = F.build();
  } catch (e) {
    console.log(`  ✗ ${F.name} — build threw: ${e.message}`);
    skipped++;
    continue;
  }
  if (!fresh) {
    console.log(`  ⊘ ${F.name} — INPUT ABSENT${F.real ? ' (real recording, gitignored — copy the CSV into uploads/ to regenerate)' : ''}`);
    skipped++;
    continue;
  }
  fresh = JSON.parse(JSON.stringify(fresh));

  if (isNew) {
    if (CHECK) {
      console.log(`  ! ${F.name} — ABSENT (would be minted) — run without --check`);
      minted++;
      continue;
    }
    fs.writeFileSync(p, JSON.stringify(fresh, null, 2) + '\n');
    minted++;
    console.log(`  + ${F.name} — MINTED (first generation, from the app's own export path)`);
    await rerecord(F.name, F);
    continue;
  }

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
  // the bytes moved ⇒ the recorded outputHash is now stale (GATE B would red). Re-record it from
  // the bytes just written — `build.mjs` only re-stamps manifestHash, and only when the bundle moves.
  if (!CHECK) await rerecord(F.name, F);
}

console.log(`\n${CHECK ? 'check' : 'regen'}: ${moved} fixture(s) moved, ${minted} minted, ${skipped} skipped`);
if (CHECK && (moved || minted)) process.exitCode = 1;
