/*
 * tools/regen-goldens-core.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Shared scaffolding for the per-node golden regenerators (CPAP-REAL-CORPUS-FOLLOWUPS-III §3).
 * The three per-node tools (regen-cpap/glucodex/pulsedex-goldens.mjs) had BYTE-IDENTICAL diff() and
 * merge() and near-identical rerecord()/loop copy-pasted three times. This is the ONE copy; each tool
 * now supplies only the node-specific realm + fixture builders and calls runRegen(). Unified entry:
 * `node tools/regen-goldens.mjs --node <Name>`.
 *
 * Nothing here hashes or writes a value by hand: outputHash/inputHashes come from ManifestGate.sha16
 * (the exact function the gates hash with), the merge preserves the equivalence gate's VOLATILE keys
 * verbatim, and the diff reports only what physiologically MOVED. build.mjs re-stamps manifestHash but
 * never outputHash, so a pure output regeneration under new code needs this to close GATE B.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

/* The volatile keys the equivalence gate EXCLUDES — preserved verbatim from the committed file. */
export const VOLATILE = new Set(['file', 'provenance', 'kernel', 'generated', 'vo2est', 'karv']);

/* Recursively rebuild `fresh` but keep the COMMITTED value for every VOLATILE key. */
export function merge(fresh, old) {
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
export function diff(a, b, p, out) {
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

/* ── ledger re-record: outputHash (+ inputHashes) hashed with the gates' OWN sha16, never hand-typed.
   `node`/`bundle` scope it to provenance/<Node>.json; a fixture carrying `newRecord` may be MINTED if
   its ledger record is absent (a first generation), rather than skipped. ── */
export function makeRerecord({ repo, node, bundle, uploadsDir, ManifestGate }) {
  const fragPath = path.join(repo, 'provenance', node + '.json');
  const sha16Of = (file) => ManifestGate.sha16(new Uint8Array(fs.readFileSync(path.join(uploadsDir, file))));
  return async function rerecord(fixtureName, fixture) {
    const frag = JSON.parse(fs.readFileSync(fragPath, 'utf8'));
    frag.fixtures = frag.fixtures || {};
    let rec = frag.fixtures[fixtureName];
    // A BRAND-NEW fixture gets its record MINTED here, not hand-typed — reading the bundle's committed
    // code identity (manifestHash) from the fragment and hashing the bytes just written.
    if (!rec && fixture && fixture.newRecord) {
      const mh = frag.manifestHash;
      if (!mh) return console.log(`      ⚠ provenance/${node}.json has no manifestHash — record NOT minted`);
      rec = { bundle, manifestHash: mh, added: fixture.newRecord.added, note: fixture.newRecord.note, inputs: fixture.newRecord.inputs, outputHash: '', inputHashes: {} };
      frag.fixtures[fixtureName] = rec;
      console.log(`      + minted provenance/${node}.json record (manifestHash ${mh})`);
    }
    if (!rec) return console.log(`      ⚠ no provenance/${node}.json record for ${fixtureName} — ledger NOT re-recorded`);
    if (rec.historical) return console.log(`      ∘ ${fixtureName} is historical (byte-pinned, not code-gated) — ledger left alone`);
    const outputHash = await sha16Of(fixtureName);
    const inputHashes = {};
    for (const f of rec.inputs || []) inputHashes[f] = await sha16Of(f);
    const wasOut = rec.outputHash;
    rec.outputHash = outputHash;
    if (Object.keys(inputHashes).length) rec.inputHashes = inputHashes;
    fs.writeFileSync(fragPath, JSON.stringify(frag, null, 2) + '\n');
    console.log(`      ↻ ledger re-recorded — outputHash ${wasOut} → ${outputHash}`);
  };
}

/* The regenerate/check loop shared by every node. `fixtures`: [{ name, real?, build:()=>export|null,
   newRecord? }]. Absent committed file + no newRecord ⇒ skip; + newRecord ⇒ mint. build()→null ⇒ input
   absent (gitignored recording). Preserves the exact read→build→diff→merge→write→rerecord flow. */
export async function runRegen({ fixtures, uploadsDir, check, rerecord, absentInputHint }) {
  let moved = 0,
    minted = 0,
    skipped = 0;
  for (const F of fixtures) {
    const p = path.join(uploadsDir, F.name);
    const isNew = !fs.existsSync(p);
    if (isNew && !F.newRecord) {
      console.log(`  ⊘ ${F.name} — committed fixture absent`);
      skipped++;
      continue;
    }
    let fresh;
    try {
      fresh = F.build();
    } catch (e) {
      console.log(`  ✗ ${F.name} — build threw: ${e.message}`);
      skipped++;
      continue;
    }
    if (!fresh) {
      console.log(`  ⊘ ${F.name} — INPUT ABSENT${F.real ? ' (real recording, gitignored' + (absentInputHint ? ' — ' + absentInputHint : '') + ')' : ''}`);
      skipped++;
      continue;
    }
    fresh = JSON.parse(JSON.stringify(fresh));

    if (isNew) {
      // MINT — a first generation of a fixture that carries a newRecord spec.
      if (check) {
        console.log(`  ! ${F.name} — ABSENT (would be minted) — run without --check`);
      } else {
        fs.writeFileSync(p, JSON.stringify(fresh, null, 2) + '\n');
        console.log(`  + ${F.name} — minted`);
        await rerecord(F.name, F);
      }
      minted++;
      continue;
    }

    const old = JSON.parse(fs.readFileSync(p, 'utf8'));
    const d = [];
    diff(fresh, old, '', d);
    if (!d.length) {
      console.log(`  = ${F.name} — content unchanged`);
      continue;
    }
    const out = merge(fresh, old);
    if (!check) fs.writeFileSync(p, JSON.stringify(out, null, 2) + '\n');
    moved++;
    console.log(`  ${check ? '!' : '✓'} ${F.name} — ${d.length} field(s) moved`);
    for (const line of d.slice(0, 8)) console.log(`      ${line}`);
    if (d.length > 8) console.log(`      … +${d.length - 8} more`);
    if (!check) await rerecord(F.name, F);
  }
  console.log(`\n${check ? 'check' : 'regen'}: ${moved} fixture(s) moved, ${minted} minted, ${skipped} skipped`);
  if (check && (moved || minted)) process.exitCode = 1;
}
