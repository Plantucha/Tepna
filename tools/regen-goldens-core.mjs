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
import { execFileSync } from 'node:child_process';
import { fmtDuration, progressLine } from './run-progress.mjs';
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

/* ── WHERE THE CORPUS IS — the ONE resolver, shared with `tools/verify-fixtures.mjs`
   (REGEN-CORPUS-PATH-FOLLOWUPS §3.1). These two tools are the two halves of the sanctioned fixture
   workflow, and they used to disagree: verify-fixtures honored `DEX_UPLOADS` and the regen family
   hardcoded `<repo>/uploads`, so a regen run from a worktree reported `INPUT ABSENT` for a recording
   that was sitting in the main checkout with `DEX_UPLOADS` pointed straight at it. Importing this from
   both files is what stops them drifting apart a third time (gated by a source scan in dex-tests.js).

   ⚠ CORPUS ≠ FIXTURES, and conflating them is a WORSE bug than the one this fixes. `uploads/` holds
   two different kinds of file: gitignored raw recordings (what DEX_UPLOADS redirects) and 133
   git-TRACKED committed artifacts, including every `*_equiv.node-export.json` a regen WRITES. Routing
   the write side through DEX_UPLOADS would make a worktree regen silently rewrite a tracked file in
   ANOTHER checkout — invisible to the worktree's git, and the shared-tree failure CLAUDE.md §👥 exists
   to prevent. So: raw inputs resolve through `resolveCorpus`; fixture outputs are always written to the
   `uploads/` of the checkout you are running in. Callers pass both, named. ── */
export function resolveCorpus(repo) {
  if (process.env.DEX_UPLOADS) return path.resolve(process.env.DEX_UPLOADS);
  return corpusSearch(repo).dir;
}

/* ── THE CHECKOUT YOU ARE STANDING IN IS NOT THE CHECKOUT THE CORPUS IS IN
   (FIXTURE-CORPUS-REACHABILITY-2026-08-09 §1/§2). CLAUDE.md §👥.1 mandates a worktree for any DSP
   change; CLAUDE.md §🔏 mandates a `verify-fixtures` re-run for that same change. Those two mandates
   were mutually exclusive, because `uploads/` is 653 files of which 435 are GITIGNORED — a fresh
   worktree off origin/main gets the 134 tracked ones, and every corpus-backed fixture input is in the
   other 80 %. The failure presented as "the corpus is absent", which reads like a fact about the
   MACHINE while being a fact about the CHECKOUT, and that is the reading that stops you looking.

   `git rev-parse --git-common-dir` names the PRIMARY checkout's `.git` from inside any linked
   worktree, so its parent is where the corpus actually is. It degrades correctly: in a normal checkout
   it returns that checkout's own `.git`, making the candidate identical to `<repo>/uploads` rather
   than wrong, and outside git it throws and the candidate is simply skipped.

   Ordering is DEX_UPLOADS → primary checkout → this checkout, per the brief. Reading a git-TRACKED
   input from the primary checkout when the two differ is a real behaviour change, and it FAILS CLOSED:
   the input is hashed by GATE B and re-run by the equiv leg, so a mismatch reds the suite and
   `verify-fixtures` refuses to stamp. The alternative was not running at all.

   Returns every candidate WITH its verdict so a caller can SHOW the search — "absent" must be a
   conclusion the reader can check, not a guess they have to trust. ── */
export function corpusSearch(repo) {
  const cands = [];
  const push = (label, dir) => {
    if (!dir || cands.some((c) => c.dir === dir)) return;
    let exists = false;
    try {
      exists = fs.statSync(dir).isDirectory();
    } catch {
      exists = false;
    }
    cands.push({ label, dir, exists });
  };
  if (process.env.DEX_UPLOADS) push('$DEX_UPLOADS', path.resolve(process.env.DEX_UPLOADS));
  let common = null;
  try {
    common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    common = null; // no git, or not a checkout — this candidate simply does not exist
  }
  if (common) push('primary checkout (git --git-common-dir)', path.join(path.dirname(common), 'uploads'));
  push('this checkout', path.join(repo, 'uploads'));
  const hit = cands.find((c) => c.exists);
  const dir = hit ? hit.dir : path.join(repo, 'uploads');
  for (const c of cands) c.chosen = c.dir === dir;
  return { dir, candidates: cands };
}

/* Render the search as lines a reader can act on. Printed on REFUSAL, where the old message said only
   `DEX_UPLOADS=/path/to/uploads` — a placeholder, read by someone standing in a checkout that HAS an
   `uploads/`. See docs/CORPUS-LOCATIONS.md for where the four real corpora live. */
export function formatCorpusSearch(search) {
  return search.candidates.map((c) => '    ' + (c.chosen ? '→ ' : '  ') + c.label + ': ' + c.dir + (c.exists ? '' : '  (absent)')).join('\n');
}

/* ── ledger re-record: outputHash (+ inputHashes) hashed with the gates' OWN sha16, never hand-typed.
   `node`/`bundle` scope it to provenance/<Node>.json; a fixture carrying `newRecord` may be MINTED if
   its ledger record is absent (a first generation), rather than skipped. ── */
export function makeRerecord({ repo, node, bundle, fixturesDir, corpusDir, ManifestGate }) {
  const fragPath = path.join(repo, 'provenance', node + '.json');
  // The OUTPUT is a tracked artifact of this checkout; the INPUTS may live in a redirected corpus.
  const sha16Out = (file) => ManifestGate.sha16(new Uint8Array(fs.readFileSync(path.join(fixturesDir, file))));
  const sha16In = (file) => ManifestGate.sha16(new Uint8Array(fs.readFileSync(path.join(corpusDir, file))));
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
    const outputHash = await sha16Out(fixtureName);
    const inputHashes = {};
    for (const f of rec.inputs || []) inputHashes[f] = await sha16In(f);
    const wasOut = rec.outputHash;
    // Already-true ledger ⇒ write nothing and say nothing. This makes rerecord() safe to call on
    // EVERY fixture each run (including ones whose output did not move), which is what lets an
    // INPUT-ONLY change reach the ledger — see the caller in runRegen().
    const inputsSame = !Object.keys(inputHashes).length || JSON.stringify(rec.inputHashes || {}) === JSON.stringify(inputHashes);
    /* CODE IDENTITY IS REFRESHED HERE TOO, and it has to be. `build.mjs` owns manifestHash but writes
       it only when the BUNDLE MOVES (`if (oldHash === newHash) return`), so a fixture minted against
       an already-stale hash can never be repaired by a rebuild — the bundle is not going to move
       again on its own. That is not hypothetical: PR #616 minted the PpgDex rich golden recording
       dc938e0c20d2 while the shipped bundle was already 60d6dbf38dcb (#615 had re-bundled it), and
       GATE B read code-drift on a green tree with a correct fixture.
       This function has just RE-RUN the real modules under the CURRENT bundle, so the current
       manifestHash is the honest answer to "which code produced these bytes" — the one thing a
       regeneration is actually entitled to assert. */
    const mhNow = frag.manifestHash || null;
    const mhSame = !mhNow || rec.manifestHash === mhNow;
    if (wasOut === outputHash && inputsSame && mhSame) return;
    const wasMh = rec.manifestHash;
    rec.outputHash = outputHash;
    if (Object.keys(inputHashes).length) rec.inputHashes = inputHashes;
    if (mhNow) rec.manifestHash = mhNow;
    fs.writeFileSync(fragPath, JSON.stringify(frag, null, 2) + '\n');
    console.log(
      `      ↻ ledger re-recorded — outputHash ${wasOut}${wasOut === outputHash ? ' (unchanged)' : ' → ' + outputHash}${inputsSame ? '' : ' · inputHashes updated'}${mhSame ? '' : ` · manifestHash ${wasMh} → ${mhNow}`}`
    );
  };
}

/* The regenerate/check loop shared by every node. `fixtures`: [{ name, real?, build:()=>export|null,
   newRecord? }]. Absent committed file + no newRecord ⇒ skip; + newRecord ⇒ mint. build()→null ⇒ input
   absent (gitignored recording). Preserves the exact read→build→diff→merge→write→rerecord flow. */
export async function runRegen({ fixtures, fixturesDir, corpusDir, check, rerecord, absentInputHint }) {
  let moved = 0,
    minted = 0,
    skipped = 0,
    /* §3.3 — an ABSENT INPUT IS A HOLE, a missing committed fixture is a known exemption, and one
       `skipped` count conflated them. That conflation is what let a run which regenerated only the
       synthetic fixtures read as a normal, complete pass. Counted and reported apart. */
    absent = 0;
  /* ── PROGRESS. Regenerating a golden re-runs the real modules over a real corpus, so this loop is
     minutes of silence per node and the operator cannot tell a slow fixture from a wedged one.

     ⚠️ RESUME IS DELIBERATELY NOT ADDED HERE, unlike the mutation tools. A mutation verdict is a
     read-only observation, so resuming one is free; a regeneration WRITES the fixture set, and a
     resumed regeneration would leave that set half-updated — some files from this code, some from
     whatever ran before. That is exactly the mixed-provenance state the resume fingerprint exists
     to prevent, and these runs are minutes rather than hours, so the trade is not worth taking. */
  const regenT0 = Date.now();
  let regenDone = 0;
  for (const F of fixtures) {
    /* Reported at the START of each item, not the end: the loop leaves via several `continue`
       paths (absent fixture, build threw, historical record) and an end-of-body report would
       silently skip exactly the items a reader most wants to see counted. */
    const perItem = regenDone > 0 ? (Date.now() - regenT0) / 1000 / regenDone : 0;
    console.log(progressLine(regenDone, fixtures.length, 1, perItem, F.name.slice(0, 22)));
    regenDone++;
    const p = path.join(fixturesDir, F.name);
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
      // §3.2 — "does not exist" and "is not at this path" license opposite next actions. Say which.
      console.log(
        `  ⊘ ${F.name} — INPUT ABSENT${F.real ? ' (real recording, gitignored' + (absentInputHint ? ' — ' + absentInputHint : '') + ')' : ''}` +
          `\n      looked in ${corpusDir}${process.env.DEX_UPLOADS ? ' (from DEX_UPLOADS)' : ' — set DEX_UPLOADS=<corpus> if yours is elsewhere'}`
      );
      absent++;
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
      // An UNCHANGED OUTPUT DOES NOT MEAN AN UNCHANGED RECORD. The ledger triple is
      // {manifestHash, inputHashes, outputHash}, so a fixture whose INPUT moved while its output
      // stayed byte-identical still owes a re-record — and this branch used to `continue` straight
      // past it, leaving GATE B reading a stale inputHash and failing with `input-drift`.
      // Hit for real on 2026-07-20: flipping the MotionDex twin's Z sign AND the classifier cancels
      // exactly, so the golden held while its input changed. rerecord() no-ops when already true.
      if (!check) await rerecord(F.name, F);
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
  console.log(
    `\n${check ? 'check' : 'regen'}: ${moved} fixture(s) moved, ${minted} minted, ${skipped} skipped` + (absent ? `, ${absent} NOT REACHED (input absent — this run did not cover them)` : '')
  );
  if (check && (moved || minted)) process.exitCode = 1;
}
