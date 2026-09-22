#!/usr/bin/env node
/*
 * tools/verdict-adoption.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE VERDICT-CONTRACT ADOPTION GATE — every producer of a verdict word, enumerated and binned,
 * as an EQUALITY (VERDICT-CONTRACT §3 / §3b step 2).
 *
 * The brief's first adopter list was a recency sample (eleven tools); enumerated, the population is
 * ~150 files across both lanes. A list written from memory is the one-of-N trap
 * (`PARTIAL-ADOPTION-DETECTION`) — so the population is COMPUTED (the grep below, on the tree), every
 * member is BINNED in a committed manifest (`tools/verdict-adoption.json`), and the gate holds the two
 * equal: a producer the grep finds that the manifest does not name is a red WITH ITS NAME, and so is a
 * manifest row for a file that no longer prints the word.
 *
 * Bins (the manifest's `bin`), each with what the gate demands of it:
 *   decides       the output is a decision someone acts on → must adopt tepna.verdict/1; `status`
 *                 is `pending` or `adopted`; an `adopted` row names how it EMITS the object
 *                 (`emits: { cmd: [...] }` printing JSON, or `emits: { file }`), and the gate RUNS or
 *                 READS it and validates under verdict.js — the object is asserted, never the prose
 *   already-json  has --json / writes a record → converge the record (same rule as decides once adopted)
 *   word-only     the word occurs in a comment, a label, a log line that decides nothing → exempt,
 *                 WITH `reason` — an exemption without a reason is a silent adoption gap
 *   test          a test file asserting on verdict words is a READER, not a producer — exempt by class
 *
 * ADOPTION IS A RATCHET, and the gate holds it against the MERGE BASE. Measured 2026-09-22: this
 * manifest conflicts as ONE whole-file hunk on nearly every adoption PR (two sides rewrite one dict),
 * and the obvious resolution — take main, substitute every key where MY side differs — silently put
 * #2888's `tools/pb-agreement.mjs` back to `word-only`/`exempt`. The merge committed clean and this
 * gate stayed GREEN, because an exempt row is a legal row. So `checkRatchet` reads the manifest at
 * `git merge-base HEAD <base>` and reds on any tool that was `adopted` there and is not `adopted`
 * here — the row absent, or its status moved — unless the tool's FILE is gone from the tree (a
 * retired tool is not a de-adoption). Population is an equality: adoptedAtBase = kept + retired +
 * deAdopted. A branch that is merely BEHIND has de-adopted nothing (its merge base predates the new
 * adoption); a branch that MERGED main and lost the row has, and that is the case this catches.
 *
 * The companion procedure for resolving that conflict, so the gate is the backstop and not the plan:
 * compute BOTH deltas from the merge base (`changed by me` · `changed by main` · `by both`, and a
 * key both changed is resolved by hand), rebuild from main's dict plus your own keys, and round-trip
 * main's bytes through `JSON.stringify(obj, null, 2) + '\n'` FIRST so the rewrite cannot smuggle a
 * reformat. Then `git diff --stat <base> -- tools/verdict-adoption.json` must show only your rows.
 *
 *   node tools/verdict-adoption.mjs --check          # the gate (npm run check step; exit 1 on any red)
 *   node tools/verdict-adoption.mjs --check --base <ref>   # ratchet base (default origin/main; merge-base with HEAD)
 *   node tools/verdict-adoption.mjs --triage         # first-pass suggestions for UNBINNED files; writes nothing
 *   node tools/verdict-adoption.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'tools', 'verdict-adoption.json');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

export const WORDS = /\b(PASS|FAIL|VERDICT|UNDERPOWERED|SHORTFALL|CONSISTENT|INCONCLUSIVE)\b/;
export const BINS = ['decides', 'already-json', 'word-only', 'test'];
export const STATUSES = ['pending', 'adopted', 'exempt'];

/* The population, computed: every tracked file in the two lanes that prints a verdict word. `git grep`
   on the INDEX/tree so a stale checkout of a file cannot hide or invent a producer. */
export function enumerate(root) {
  let out;
  try {
    /* tests/*.mjs joined 2026-09-22 (Kestrel): a RUNNER that emits the object but sits outside the
       population is the one-of-N shape from the other side — tests/run-tests.mjs adopted §3d (#2835)
       and the gate could not see it. Non-recursive, like tools/. */
    out = execFileSync('git', ['grep', '-lE', WORDS.source, '--', 'tools/*.mjs', 'capture-host/*.py', 'tests/*.mjs'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
  return out
    .split('\n')
    .filter(Boolean)
    .filter((p) => !p.startsWith('tools/') || !p.slice(6).includes('/')) // tools/*.mjs non-recursive, like the two tool gates
    .filter((p) => !p.startsWith('tests/') || !p.slice(6).includes('/')) // tests/*.mjs non-recursive too
    .sort();
}

/* Pure: judge a manifest against an enumerated population. Returns { ok, errors[], counts }. */
export function check(enumerated, manifest, validator, runner) {
  const errors = [];
  const rows = (manifest && manifest.producers) || {};
  const named = Object.keys(rows).sort();
  const enumSet = new Set(enumerated);
  const namedSet = new Set(named);
  for (const p of enumerated) if (!namedSet.has(p)) errors.push(`UNBINNED producer: ${p} prints a verdict word and is in no bin — add it to tools/verdict-adoption.json`);
  for (const p of named) if (!enumSet.has(p)) errors.push(`STALE row: ${p} is in the manifest but no longer prints a verdict word (or is untracked) — remove or re-bin it`);
  const counts = { enumerated: enumerated.length, named: named.length, decides: 0, 'already-json': 0, 'word-only': 0, test: 0, adopted: 0, pending: 0, validated: 0 };
  for (const p of named) {
    const r = rows[p] || {};
    if (!BINS.includes(r.bin)) {
      errors.push(`${p}: bin must be one of ${BINS.join('|')}, got ${JSON.stringify(r.bin)}`);
      continue;
    }
    counts[r.bin]++;
    if (r.bin === 'word-only' || r.bin === 'test') {
      if (r.bin === 'word-only' && !(typeof r.reason === 'string' && r.reason.trim())) errors.push(`${p}: word-only without a reason — an exemption without a reason is a silent adoption gap`);
      if (r.status && r.status !== 'exempt') errors.push(`${p}: ${r.bin} rows are status "exempt", got ${JSON.stringify(r.status)}`);
      continue;
    }
    if (!['pending', 'adopted'].includes(r.status)) {
      errors.push(`${p}: ${r.bin} rows carry status pending|adopted, got ${JSON.stringify(r.status)}`);
      continue;
    }
    counts[r.status]++;
    if (r.status === 'adopted') {
      if (!r.emits || (!Array.isArray(r.emits.cmd) && typeof r.emits.file !== 'string')) {
        errors.push(`${p}: adopted without \`emits\` ({cmd:[…]} printing the object, or {file}) — an adoption the gate cannot read is a claim`);
        continue;
      }
      if (!validator || !runner) continue; // the pure core; the CLI passes both
      let obj;
      try {
        obj = runner(r.emits);
      } catch (e) {
        errors.push(`${p}: emits could not be read — ${String(e.message || e).slice(0, 120)}`);
        continue;
      }
      const v = validator(obj);
      counts.validated++;
      if (!v.ok) errors.push(`${p}: the emitted object is NOT a valid tepna.verdict/1 — ${v.errors.slice(0, 3).join(' | ')}`);
    }
  }
  return { ok: errors.length === 0, errors, counts };
}

/* ── EVERY CHECK IS GATED — a static population equality over the `decides` set ──────────────────
   Residue `2026-09-12-fix-for-ungated-check-lands-ungated`: a CHECK shipped with no test (#2321), its
   fix shipped with no test (#2402), and the test arrived two PRs later (#2404) — the repair's own
   boundary survived only as a comment. The row's candidate rule (a tool change with no test hunk)
   was measured to death by its sibling `2026-09-12-ungated-tool-fix-rule-not-viable`: 41–68 % of
   commits flagged at every narrowing, an invariant convicting working practice. So the gate is NOT a
   diff rule. It is a property of the tree: every producer this manifest bins as `decides` — the
   repo's enumerated set of checks — is GATED, meaning it declares `--selftest` (in a call position,
   the same predicate selftest-all.mjs discovers by) OR a file under tests/ or capture-host/tests/
   names it. A check with no test is caught the day it is binned, not by guessing which PRs fix it.
   `UNGATED_RATCHET` names the decides producers that were ungated when this landed — DEBT, not
   approval, and it may only SHRINK: a new decides producer with no test reds by name; a ratchet
   entry that gains a test reds until it is removed; a producer whose test disappears reds.
   ⚠️ The population is the manifest's decides set, not every tool: the row's own instance
   (`tools/wt-done.mjs`, a queue action, `word-only`) sits outside it by design. Widening to every
   tools/*.mjs that declares a check is the owner's call, with a measured count (see the PR body). */
export const UNGATED_RATCHET = new Set(['tools/pat-ppg-ppg-control.mjs', 'tools/pulse-agreement.mjs', 'tools/tch-estimator-bakeoff.mjs', 'tools/tch-per-epoch-rho.mjs']);
const SELFTEST_CALL = /\(\s*['"]--selftest['"]\s*\)/;

/* What gates a producer, or null. `readSource(p)` returns the file text; `testRefs(stem)` the list of
   test files naming it — injected so the invariant is testable without a tree. */
export function gatedBy(p, readSource, testRefs) {
  const src = readSource(p);
  if (src != null && SELFTEST_CALL.test(src)) return 'selftest';
  const stem = path.basename(p).replace(/\.(mjs|py)$/, '');
  const refs = (testRefs(stem) || []).filter((f) => f !== p);
  return refs.length ? 'tests:' + refs.slice(0, 2).join(',') : null;
}

/* ── A WORD-ONLY ROW MAKES A CLAIM, AND THE CLAIM GOES STALE ──────────────────────────────────
   `bin: "word-only"` is an assertion ABOUT THE SOURCE — that the verdict vocabulary in the file is
   prose, not an emitted decision. Nothing checked it after it was written, so it rots two ways:
   copy-paste (47 of 85 rows carry one reason string verbatim) and, worse, DRIFT — a row's reason is
   true when written and false once the tool gains a decision. Measured 2026-09-22 on my own work:
   #2851 gave `tools/buzz-fiducial-correlate.mjs` a daemon-capture refusal that morning; its row
   still said "not a verdict about data" that afternoon, and no gate could see it, because the bin is
   ASSERTED in the manifest rather than DERIVED from the source.

   ⚠️ THE POPULATION IS THE DESIGN, NOT A CAVEAT. This check tests the CLAIM A ROW MAKES, and a row
   that CONCEDES emission is outside its population by construction. Three reason-classes assert that
   nothing is emitted (`CLAIM_REASONS`, 71 of 85 rows); the other 14 concede the words are emitted and
   explain why they are not a decision over a criterion — `land-pr.mjs`'s queue vocabulary,
   `mutation-reach.mjs`'s fail-closed classification. Those are judgement calls the gate must not
   adjudicate, and including them is what took the false-positive rate from 0 to 18 %: measured over
   all 85 rows the discriminator flags 11, two of them wrong, and BOTH are conceding rows.

   Measured before shipping (the bands are pre-stated): 71 checked · 9 flagged · 0 false positives.
   The 9 are handed to the follow-up adoptions through `WO_CLAIM_RATCHET`, which may only SHRINK —
   the same shape as `UNGATED_RATCHET` above, and for the same reason: an entry removed is a
   demonstration the check has teeth on a real file. */
export const CLAIM_REASONS = ['selftest assertion printer', 'verdict words appear only in comments', 'not as an emitted verdict'];

/* A DECISION word. Kept narrower than `WORDS`: these are what a tool prints when it decides, not
   what it prints as a log level. */
const DECISION_WORDS = /\b(REFUSED|VERDICT|TALLY|RECOVERED|UNDERPOWERED|SHORTFALL|NOT_RUN|NOT_APPLICABLE|REALM-FAIL|PASS|FAIL)\b/;

/* The named exclusions — the twelve false positives measured 2026-09-22, every one of them selftest
   INFRASTRUCTURE living at module scope, outside the function body: the `cond ? 'ok' : 'FAIL'`
   assertion printer, the `SELFTEST FAIL:` handler, and calls to the `ok(` helper itself. */
const NOT_A_DECISION = [/\?\s*'ok\s*'?\s*:\s*'?FAIL/, /SELF-?TEST\s+FAIL/, /\bok\s*\(/];

/* ⚠️ AN ESCAPE GLUES TO THE WORD AND KILLS `\b` — `console.log('\nTALLY:', …)` reads as `nTALLY` and
   was MISSED on this check's first run (`tools/pat-residual-structure.mjs`, found only because the
   flag count moved 10 → 11 when it was fixed). The unescaping below is why; the selftest plants it
   permanently, because a detector whose sensitivity was assumed once will be assumed again. */
const unescape = (s) => s.replace(/\\[nrt]/g, ' ');

/** The span of a `selftest` body, or null when no locator matches (then the WHOLE file is scanned,
 *  which biases toward false positives, never toward misses — 33 of the 71 rows, named in the
 *  output so the bias travels with the number). PURE. */
export function selftestSpan(src, isPy) {
  const m = isPy ? /\ndef\s+selftest\w*\s*\(/.exec(src) : /\n(?:export\s+)?(?:async\s+)?function\s+selftest\w*\s*\(/.exec(src);
  if (!m) return null;
  const from = m.index;
  if (isPy) {
    const j = src.indexOf('\ndef ', m.index + m[0].length);
    return [from, j < 0 ? src.length : j];
  }
  const b = src.indexOf('{', m.index + m[0].length - 1);
  let depth = 0;
  for (let k = b; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return [from, k + 1];
  }
  return [from, src.length];
}

/** Lines where the tool PRINTS a decision word outside its selftest body. PURE. */
export function emittedDecisionLines(src, isPy) {
  const span = selftestSpan(src, isPy);
  const scanned = span ? src.slice(0, span[0]) + src.slice(span[1]) : src;
  const out = [];
  for (const raw of scanned.split('\n')) {
    const s = unescape(raw.trim());
    if (!/console\.(log|error)\(|\bprint\(/.test(s)) continue;
    if (!DECISION_WORDS.test(s)) continue;
    if (NOT_A_DECISION.some((r) => r.test(s))) continue;
    out.push(raw.trim().slice(0, 120));
  }
  return { lines: out, hasLocator: span !== null };
}

/* The nine rows whose claim was already false when this check landed (2026-09-22). DEBT, not
   approval: each is owed an adoption with its own criterion, and the ratchet may only SHRINK — a
   row that stops emitting, or that leaves `word-only`, reds until it is removed here. */
export const WO_CLAIM_RATCHET = new Set([
  /* ⚠️ `beat-leg-closure` carries the "prose inside code" reason, NOT the copy-pasted one — which
     is why this check keys on EMISSION and never on the reason text. A sweep keyed on the 47
     duplicated strings would have found eight of these nine and left this one behind, still
     asserting in the manifest something its source had stopped supporting. */
  'tools/beat-leg-closure.mjs',
  'tools/buzz-fiducial-correlate.mjs',
  'tools/formula-constant-audit.mjs',
  'tools/pat-fiducial-jitter.mjs',
  /* `tools/pat-window-oracle.mjs` was the ninth; it ADOPTED, so the ratchet shrank by one. */
  'tools/probe-clock-equivalence.mjs',
  'tools/probe-equivalence.mjs'
]);

/** Judge every `word-only` row that CLAIMS nothing is emitted. Returns the population as an
 *  EQUALITY (checked + conceded = word-only rows) so a row moving between reason-classes moves the
 *  numbers rather than sliding out of view. PURE — `readSource(p)` is injected. */
export function checkWordOnlyClaim(manifest, readSource, ratchet = WO_CLAIM_RATCHET) {
  const rows = (manifest && manifest.producers) || {};
  const wordOnly = Object.keys(rows)
    .filter((p) => rows[p] && rows[p].bin === 'word-only')
    .sort();
  const claims = wordOnly.filter((p) => CLAIM_REASONS.some((c) => (rows[p].reason || '').includes(c)));
  const conceded = wordOnly.filter((p) => !claims.includes(p));
  const errors = [];
  const flagged = [];
  let noLocator = 0;
  for (const p of claims) {
    const src = readSource(p);
    if (src == null) {
      errors.push(`${p}: word-only row whose source could not be read — an unreadable claim is not a held claim`);
      continue;
    }
    const e = emittedDecisionLines(src, p.endsWith('.py'));
    if (!e.hasLocator) noLocator++;
    if (e.lines.length === 0) {
      if (ratchet.has(p)) errors.push(`${p}: no longer emits a decision — REMOVE it from WO_CLAIM_RATCHET (the ratchet may only go down)`);
      continue;
    }
    flagged.push({ path: p, lines: e.lines });
    if (!ratchet.has(p)) errors.push(`${p}: its row claims no emitted verdict ("${(rows[p].reason || '').slice(0, 48)}…") but it PRINTS a decision outside its selftest — ${e.lines[0]}`);
  }
  for (const p of ratchet) if (!claims.includes(p)) errors.push(`${p}: in WO_CLAIM_RATCHET but is not a word-only row claiming no emission — remove the stale entry`);
  return { ok: errors.length === 0, errors, checked: claims.length, conceded: conceded.length, wordOnly: wordOnly.length, noLocator, flagged };
}

/* Pure: judge the decides set against the ratchet. Returns { ok, errors[], gated, ungated }. */
export function checkGated(manifest, readSource, testRefs, ratchet = UNGATED_RATCHET) {
  const errors = [];
  const rows = (manifest && manifest.producers) || {};
  const decides = Object.keys(rows)
    .filter((p) => rows[p] && rows[p].bin === 'decides')
    .sort();
  const gated = {};
  const ungated = [];
  for (const p of decides) {
    const g = gatedBy(p, readSource, testRefs);
    if (g) {
      gated[p] = g;
      if (ratchet.has(p)) errors.push(`${p}: now GATED (${g}) — REMOVE it from UNGATED_RATCHET (the ratchet may only go down)`);
    } else {
      ungated.push(p);
      if (!ratchet.has(p))
        errors.push(
          `${p}: a \`decides\` producer with NO test — no --selftest and nothing under tests/ or capture-host/tests/ names it. A check with no test is the #2321 shape; add its selftest (or a test) in the same PR that bins it`
        );
    }
  }
  for (const p of ratchet) if (!decides.includes(p)) errors.push(`${p}: in UNGATED_RATCHET but not a \`decides\` producer — remove the stale entry`);
  return { ok: errors.length === 0, errors, gated, ungated, decides: decides.length };
}

/* ── ADOPTION IS A RATCHET — a population equality over the base's `adopted` set ─────────────────
   Pure. `baseManifest` is the manifest at the merge base, `headManifest` the tree's, `fileExists(p)`
   answers for the HEAD tree. Returns { ok, errors[], adoptedAtBase, kept, retired, deAdopted[] } with
   adoptedAtBase === kept + retired.length + deAdopted.length. */
export function checkRatchet(baseManifest, headManifest, fileExists) {
  const base = (baseManifest && baseManifest.producers) || {};
  const head = (headManifest && headManifest.producers) || {};
  const adopted = Object.keys(base)
    .filter((p) => base[p] && base[p].status === 'adopted')
    .sort();
  const errors = [];
  const retired = [];
  const deAdopted = [];
  let kept = 0;
  for (const p of adopted) {
    const h = head[p];
    if (h && h.status === 'adopted') {
      kept++;
      continue;
    }
    if (!h && !fileExists(p)) {
      retired.push(p); // the tool left the tree with its row — not a de-adoption
      continue;
    }
    deAdopted.push(p);
    errors.push(
      `${p}: ADOPTED on the base and ${h ? `${JSON.stringify(h.bin)}/${JSON.stringify(h.status)}` : 'ABSENT'} here while the file still exists — ` +
        'adoption is a ratchet. This is the #2888 shape: a whole-file manifest conflict resolved mine-vs-main reverts the other side; ' +
        'compute both deltas from the merge base (header) and restore the row'
    );
  }
  return { ok: errors.length === 0, errors, adoptedAtBase: adopted.length, kept, retired, deAdopted };
}

/* The base manifest, read from git at `merge-base HEAD <baseRef>`. Mirrors tools/residue-ids.mjs:
   a shallow clone or an unresolvable base REFUSES (exit 2) rather than comparing against nothing —
   a ratchet judged against an empty base reports 0 de-adoptions because it sees 0 adoptions. */
function baseManifestAt(root, baseRef) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const refuse = (msg, detail) => {
    process.stderr.write(`verdict-adoption: REFUSING — ${msg}\n`);
    for (const d of detail) process.stderr.write(`  ${d}\n`);
    process.exit(2);
  };
  if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    refuse('shallow clone, the base manifest is not present.', ['The ratchet would report 0 de-adoptions because it sees 0 adoptions. Set `fetch-depth: 0` on actions/checkout.']);
  }
  let mergeBase;
  try {
    git(['rev-parse', '--verify', baseRef]);
    mergeBase = git(['merge-base', 'HEAD', baseRef]).trim() || baseRef;
  } catch {
    refuse(`cannot resolve base ref \`${baseRef}\`.`, ['Fetch it (`git fetch origin main`) or pass --base <ref>.']);
  }
  let text;
  try {
    text = git(['show', `${mergeBase}:tools/verdict-adoption.json`]);
  } catch {
    refuse(`tools/verdict-adoption.json does not exist at the merge base ${mergeBase.slice(0, 12)}.`, [
      'The manifest has been committed since the adoption wave began; pass --base <a ref that carries it>.'
    ]);
  }
  return { mergeBase, manifest: JSON.parse(text) };
}

function treeReaders(root) {
  const readSource = (p) => {
    try {
      return fs.readFileSync(path.join(root, p), 'utf8');
    } catch (_) {
      return null;
    }
  };
  const testRefs = (stem) => {
    try {
      return execFileSync('git', ['grep', '-l', '-e', stem, '--', 'tests/', 'capture-host/tests/'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split('\n')
        .filter(Boolean);
    } catch (e) {
      if (e.status === 1) return [];
      throw e;
    }
  };
  return { readSource, testRefs };
}

/* An emitter whose stdout is a LARGER payload carrying the object under a key (tests/run-tests.mjs
   --json: `{ totalGroups, groups, verdict, … }`) names it as `emits.key`; the gate then validates
   THAT object. Absent key ⇒ the whole payload is the object. A named key that is missing is a read
   failure, never a silent pass over the wrapper. */
export function pickEmitted(payload, emits) {
  if (!emits || !emits.key) return payload;
  if (!payload || typeof payload !== 'object' || !(emits.key in payload)) throw new Error(`emits.key "${emits.key}" is not in the payload`);
  return payload[emits.key];
}

/* Read what an adopted producer emits: run its cmd (stdout must be the object, or a payload carrying
   it under `emits.key`) or read its file. */
function runEmits(emits, root) {
  let text;
  if (Array.isArray(emits.cmd)) {
    const r = spawnSync(emits.cmd[0], emits.cmd.slice(1), { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 });
    if (r.error) throw r.error;
    text = r.stdout;
  } else text = fs.readFileSync(path.join(root, emits.file), 'utf8');
  const first = text.indexOf('{');
  return pickEmitted(JSON.parse(text.slice(first)), emits);
}

/* First-pass triage: for each unbinned file, where the words occur (code vs comment lines) and a sample,
   so the human bins with evidence rather than memory. Writes nothing. */
export function triage(root, files) {
  const out = [];
  for (const p of files) {
    const src = fs.readFileSync(path.join(root, p), 'utf8').split('\n');
    let code = 0;
    let comment = 0;
    const samples = [];
    src.forEach((line, i) => {
      if (!WORDS.test(line)) return;
      const s = line.trim();
      const isComment = p.endsWith('.py') ? s.startsWith('#') : s.startsWith('//') || s.startsWith('*') || s.startsWith('/*');
      if (isComment) comment++;
      else {
        code++;
        if (samples.length < 3) samples.push(`${i + 1}: ${s.slice(0, 110)}`);
      }
    });
    const json = /--json/.test(src.join('\n'));
    const suggest = p.includes('/tests/') || /\/test_[^/]+\.py$/.test(p) ? 'test' : code === 0 ? 'word-only (comments only)' : json ? 'already-json' : 'decides?';
    out.push({ path: p, code, comment, json, suggest, samples });
  }
  return out;
}

function selftest() {
  const fails = [];
  const ok = (c, m) => (c ? null : fails.push(m));
  const V = createRequire(import.meta.url)(path.join(ROOT, 'verdict.js'));
  const good = V.make({
    gate: 'g',
    status: 'PASS',
    population: { checked: 1, eligible: 1, excluded: 0 },
    criterion: { name: 'x', threshold: 1, unit: '', direction: 'lte' },
    result: { x: 0 },
    evidence: ['a'],
    producedBy: { tool: 't', commit: 'abcdef1' }
  });
  const runner = (e) =>
    e.file === 'good.json'
      ? good
      : e.file === 'bad.json'
        ? { schema: 'tepna.verdict/1', status: 'PASSED' }
        : (() => {
            throw new Error('unreadable');
          })();
  const M = (producers) => ({ schema: 'tepna.verdict-adoption/1', producers });
  // equality both ways
  let r = check(['tools/a.mjs', 'tools/b.mjs'], M({ 'tools/a.mjs': { bin: 'word-only', reason: 'label', status: 'exempt' } }), V.validate, runner);
  ok(!r.ok && r.errors.some((e) => /UNBINNED producer: tools\/b.mjs/.test(e)), 'an enumerated producer missing from the manifest is a red WITH ITS NAME');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'word-only', reason: 'label', status: 'exempt' }, 'tools/gone.mjs': { bin: 'decides', status: 'pending' } }), V.validate, runner);
  ok(!r.ok && r.errors.some((e) => /STALE row: tools\/gone.mjs/.test(e)), 'a manifest row for a non-producer is a red with its name');
  // exemptions need reasons
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'word-only', status: 'exempt' } }), V.validate, runner);
  ok(!r.ok && /without a reason/.test(r.errors[0]), 'word-only without a reason is a red');
  ok(check(['capture-host/tests/test_x.py'], M({ 'capture-host/tests/test_x.py': { bin: 'test', status: 'exempt' } }), V.validate, runner).ok, 'a test file is exempt by class, no reason needed');
  // adoption is READ, never believed
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'adopted' } }), V.validate, runner);
  ok(!r.ok && /adopted without `emits`/.test(r.errors[0]), 'adopted without emits is a claim, red');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'adopted', emits: { file: 'good.json' } } }), V.validate, runner);
  ok(r.ok && r.counts.validated === 1 && r.counts.adopted === 1, 'adopted + a valid emitted object → green, counted as validated');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'adopted', emits: { file: 'bad.json' } } }), V.validate, runner);
  ok(!r.ok && /NOT a valid tepna.verdict\/1/.test(r.errors[0]) && /no eighth value/.test(r.errors[0]), 'adopted but the object is invalid → red naming the validator error');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'adopted', emits: { file: 'missing.json' } } }), V.validate, runner);
  ok(!r.ok && /could not be read/.test(r.errors[0]), 'adopted but unreadable → red, not silently green');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'pending' } }), V.validate, runner);
  ok(r.ok && r.counts.pending === 1 && r.counts.validated === 0, 'pending is honest and green — the count says how many are still owed');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'maybe' } }), V.validate, runner);
  ok(!r.ok && /bin must be one of/.test(r.errors[0]), 'an unknown bin is a red');
  ok(
    check([], M({}), V.validate, runner).ok && check([], M({}), V.validate, runner).counts.enumerated === 0,
    'an empty population against an empty manifest is trivially equal (and says enumerated 0)'
  );
  // every check is gated — a static population equality over the decides set, ratcheted
  {
    const M2 = M({ 'tools/a.mjs': { bin: 'decides', status: 'pending' }, 'tools/b.mjs': { bin: 'decides', status: 'pending' }, 'tools/c.mjs': { bin: 'word-only', status: 'exempt', reason: 'x' } });
    const src = { 'tools/a.mjs': "if (argv.includes('--selftest')) selftest();", 'tools/b.mjs': '// a check with no test at all' };
    const refs = () => [];
    let g = checkGated(M2, (p) => src[p], refs, new Set());
    ok(!g.ok && g.errors.length === 1 && /tools\/b.mjs: a `decides` producer with NO test/.test(g.errors[0]), 'a decides producer with no selftest and no test reference is a red WITH ITS NAME');
    ok(g.gated['tools/a.mjs'] === 'selftest' && g.ungated.length === 1, 'the gated map names what gates each producer; the ungated list names the rest');
    g = checkGated(M2, (p) => src[p], refs, new Set(['tools/b.mjs']));
    ok(g.ok, 'the same producer in the ratchet is debt, not a red');
    g = checkGated(
      M2,
      (p) => src[p],
      (stem) => (stem === 'b' ? ['tests/dex-tests.js'] : []),
      new Set(['tools/b.mjs'])
    );
    ok(!g.ok && /now GATED \(tests:tests\/dex-tests.js\) — REMOVE it from UNGATED_RATCHET/.test(g.errors[0]), 'a ratchet entry that gains a test reds until removed — the ratchet only goes down');
    g = checkGated(
      M2,
      (p) => src[p],
      (stem) => (stem === 'b' ? ['tests/dex-tests.js'] : []),
      new Set()
    );
    ok(g.ok && g.gated['tools/b.mjs'] === 'tests:tests/dex-tests.js', 'a test file naming the producer gates it');
    g = checkGated(M2, (p) => (p === 'tools/a.mjs' ? '/* usage: node tools/a.mjs --selftest */' : src[p]), refs, new Set(['tools/b.mjs']));
    ok(
      !g.ok && /tools\/a.mjs: a `decides` producer with NO test/.test(g.errors[0]),
      "a --selftest that appears only in a usage COMMENT does not gate (the call-position predicate, like selftest-all's)"
    );
    g = checkGated(M2, (p) => src[p], refs, new Set(['tools/b.mjs', 'tools/c.mjs']));
    ok(!g.ok && /tools\/c.mjs: in UNGATED_RATCHET but not a `decides` producer/.test(g.errors[0]), 'a stale ratchet entry (not decides) is a red');
    ok(checkGated(M({}), () => null, refs, new Set()).ok, 'an empty decides set is trivially gated');
    // the real tree: the ratchet is exact today
    const { readSource, testRefs } = treeReaders(ROOT);
    const real = checkGated(JSON.parse(fs.readFileSync(MANIFEST, 'utf8')), readSource, testRefs);
    ok(real.ok, 'the committed manifest: every decides producer is gated or in the ratchet, and nothing in the ratchet is gated (' + real.errors.join(' | ') + ')');
  }
  // emits.key — the object under a key of a larger payload
  ok(pickEmitted({ a: 1 }, {}).a === 1 && pickEmitted({ a: 1 }, { cmd: ['x'] }).a === 1, 'no key ⇒ the payload is the object');
  ok(pickEmitted({ verdict: good, groups: [] }, { key: 'verdict' }) === good, 'a key picks the object out of the payload');
  let threw = false;
  try {
    pickEmitted({ groups: [] }, { key: 'verdict' });
  } catch (_) {
    threw = true;
  }
  ok(threw, 'a named key missing from the payload is a read failure, not a pass over the wrapper');
  // triage helper on a synthetic file
  const tmp = fs.mkdtempSync('/tmp/verdict-adoption-');
  fs.mkdirSync(path.join(tmp, 'tools'));
  fs.writeFileSync(path.join(tmp, 'tools', 'x.mjs'), "// prints PASS in a comment\nconsole.log('VERDICT: PASS');\nconst j = argv.includes('--json');\n");
  fs.writeFileSync(path.join(tmp, 'tools', 'y.mjs'), '// only a comment says FAIL\n');
  const t = triage(tmp, ['tools/x.mjs', 'tools/y.mjs']);
  ok(t[0].code === 1 && t[0].comment === 1 && t[0].json && t[0].suggest === 'already-json' && t[1].suggest.startsWith('word-only'), 'triage separates code hits from comment hits and reads --json');
  fs.rmSync(tmp, { recursive: true, force: true });
  // the real tree: the enumeration runs and is non-empty
  const en = enumerate(ROOT);
  ok(en.length > 50 && en.every((p) => p.startsWith('tools/') || p.startsWith('capture-host/') || p.startsWith('tests/')), 'enumerate() finds the population on the real tree (' + en.length + ')');
  ok(en.includes('tests/run-tests.mjs') && !en.some((p) => /^tests\/.+\//.test(p)), 'tests/*.mjs is in the population, non-recursive (the runner is no longer outside the gate)');
  /* ── word-only rows make a CLAIM, and the claim is checked (2026-09-22) ─────────────────────
     Plants for each arm, including the one that matters most: the detector's own SENSITIVITY. */
  {
    const W = (producers) => ({ schema: 'tepna.verdict-adoption/1', producers });
    const claim = { bin: 'word-only', status: 'exempt', reason: 'selftest assertion printer — not a verdict about data' };
    const concede = { bin: 'word-only', status: 'exempt', reason: 'a QUEUE decision about a PR state, in its own vocabulary — not a gate over data' };
    const SRC = {
      // emits a decision on a reachable path — the claim is FALSE
      'tools/emitter.mjs': "function selftest() { ok('x', true); }\nconsole.log('  ⊘ REFUSED — ' + why);\n",
      // ⚠️ THE SENSITIVITY PLANT: the only decision word is glued to a `\n` escape, which kills \b.
      // This exact shape was MISSED on this check's first run (pat-residual-structure.mjs).
      'tools/escaped.mjs': "function selftest() { ok('x', true); }\nconsole.log('\\nTALLY:', JSON.stringify(tally));\n",
      // selftest INFRASTRUCTURE at module scope — the twelve measured false positives
      'tools/printer.mjs': "const ok = (n, c) => console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${n}`);\nfunction selftest() { ok('a', true); }\n",
      'tools/handler.mjs': "function selftest() { return 0; }\nprocess.on('x', (m) => console.error('SELFTEST FAIL:', m));\n",
      // prose only
      'tools/quiet.mjs': "// this one REFUSED nothing, the word is in a comment\nfunction selftest() { ok('a', true); }\n"
    };
    const read = (q) => SRC[q] ?? null;
    let w = checkWordOnlyClaim(W({ 'tools/emitter.mjs': claim }), read, new Set());
    ok(!w.ok && /tools\/emitter\.mjs: its row claims no emitted verdict/.test(w.errors[0]), `an emitting word-only row reds BY NAME, got ${w.errors[0]}`);
    ok(w.errors[0].includes('REFUSED'), 'the red quotes the line that falsifies the claim, not just the path');
    /* PLANT — permanent, not a fixed bug: an escape adjacent to the word must still be FOUND. */
    w = checkWordOnlyClaim(W({ 'tools/escaped.mjs': claim }), read, new Set());
    ok(!w.ok && /tools\/escaped\.mjs/.test(w.errors[0]), 'PLANT: a decision word glued to a \\n escape is still found (the measured false negative)');
    /* The named exclusions must NOT fire — an invariant that convicts working code is the wrong rule. */
    ok(checkWordOnlyClaim(W({ 'tools/printer.mjs': claim }), read, new Set()).ok, "a module-scope `cond ? 'ok' : 'FAIL'` assertion printer is not a decision");
    ok(checkWordOnlyClaim(W({ 'tools/handler.mjs': claim }), read, new Set()).ok, 'a SELFTEST FAIL: handler is not a decision');
    ok(checkWordOnlyClaim(W({ 'tools/quiet.mjs': claim }), read, new Set()).ok, 'a word in a comment is not an emission');
    /* THE POPULATION IS THE DESIGN: a row that CONCEDES emission is outside it, even though its
       source prints the same line that reds the claiming row above. */
    w = checkWordOnlyClaim(W({ 'tools/emitter.mjs': concede }), read, new Set());
    ok(w.ok && w.checked === 0 && w.conceded === 1 && w.wordOnly === 1, `a conceding row is outside the population by construction, got ${JSON.stringify({ c: w.checked, x: w.conceded })}`);
    /* The population is an EQUALITY, so a row moving between classes moves the numbers. */
    w = checkWordOnlyClaim(W({ 'tools/quiet.mjs': claim, 'tools/emitter.mjs': concede }), read, new Set());
    ok(w.checked + w.conceded === w.wordOnly, 'checked + conceded = word-only rows, an equality');
    /* The ratchet may only SHRINK — a clean row still listed is a red. */
    w = checkWordOnlyClaim(W({ 'tools/quiet.mjs': claim }), read, new Set(['tools/quiet.mjs']));
    ok(!w.ok && /no longer emits a decision — REMOVE it/.test(w.errors[0]), 'a ratchet entry that stopped emitting reds until it is removed');
    w = checkWordOnlyClaim(W({ 'tools/emitter.mjs': claim }), read, new Set(['tools/gone.mjs']));
    ok(
      w.errors.some((e) => /tools\/gone\.mjs: in WO_CLAIM_RATCHET but is not a word-only row/.test(e)),
      'a stale ratchet entry is a red'
    );
    /* An unreadable source is not a held claim. */
    w = checkWordOnlyClaim(W({ 'tools/absent.mjs': claim }), read, new Set());
    ok(!w.ok && /could not be read/.test(w.errors[0]), 'an unreadable word-only source reds rather than passing');
    /* The real tree: the ratchet is exact today, and the population is the measured one. */
    const { readSource } = treeReaders(ROOT);
    const realW = checkWordOnlyClaim(JSON.parse(fs.readFileSync(MANIFEST, 'utf8')), readSource);
    ok(realW.ok, 'the committed manifest: every claiming word-only row holds, or is in WO_CLAIM_RATCHET (' + realW.errors.join(' | ') + ')');
    ok(realW.checked + realW.conceded === realW.wordOnly && realW.checked > 0, `the real population is an equality, got ${realW.checked}+${realW.conceded}=${realW.wordOnly}`);
  }

  /* ── ADOPTION IS A RATCHET — the #2888 revert, planted ───────────────────────────────────── */
  {
    const A = (bin, status, extra) => Object.assign({ bin, status }, extra || {});
    const BASE = {
      producers: {
        'tools/x.mjs': A('decides', 'adopted', { emits: { cmd: ['node', 'tools/x.mjs'] } }),
        'tools/y.mjs': A('decides', 'adopted', { emits: { cmd: ['node', 'tools/y.mjs'] } }),
        'tools/gone.mjs': A('decides', 'adopted', { emits: { cmd: ['node', 'tools/gone.mjs'] } }),
        'tools/w.mjs': A('word-only', 'exempt', { reason: 'label' }),
        'tools/p.mjs': A('decides', 'pending')
      }
    };
    const exists = (p) => p !== 'tools/gone.mjs';
    /* the measured defect: y was adopted on main, the merge put it back to word-only/exempt */
    const reverted = { producers: { ...BASE.producers, 'tools/y.mjs': A('word-only', 'exempt', { reason: 'selftest assertion printer' }) } };
    delete reverted.producers['tools/gone.mjs'];
    const rv = checkRatchet(BASE, reverted, exists);
    ok(!rv.ok && rv.deAdopted.length === 1 && rv.deAdopted[0] === 'tools/y.mjs', 'ratchet FIRES on the planted #2888 revert (adopted on base → word-only/exempt on head), naming the tool');
    ok(
      rv.errors.length === 1 && /ratchet/.test(rv.errors[0]) && /"word-only"\/"exempt"/.test(rv.errors[0]),
      'the red names the head bin/status it found, so the reader sees the revert, not a generic mismatch'
    );
    ok(rv.retired.length === 1 && rv.retired[0] === 'tools/gone.mjs', 'a tool whose FILE left the tree with its row is RETIRED, not de-adopted');
    ok(
      rv.adoptedAtBase === 3 && rv.kept + rv.retired.length + rv.deAdopted.length === rv.adoptedAtBase,
      `the population is an equality: ${rv.kept}+${rv.retired.length}+${rv.deAdopted.length}=${rv.adoptedAtBase}`
    );
    /* a row DELETED while the file remains is a de-adoption, not a retirement */
    const dropped = { producers: { ...BASE.producers } };
    delete dropped.producers['tools/x.mjs'];
    const dv = checkRatchet(BASE, dropped, exists);
    ok(
      !dv.ok && dv.deAdopted.length === 1 && dv.deAdopted[0] === 'tools/x.mjs' && /ABSENT/.test(dv.errors[0]),
      'a row removed while the file still exists is DE-ADOPTED (the file, not the row, decides retirement)'
    );
    /* the clean cases: identical manifests, and a head that ADDS an adoption (the ratchet only goes up) */
    const grown = { producers: { ...BASE.producers, 'tools/p.mjs': A('decides', 'adopted', { emits: { cmd: ['node', 'tools/p.mjs'] } }) } };
    const gv = checkRatchet(BASE, grown, exists);
    ok(gv.ok && gv.kept === 3 && gv.deAdopted.length === 0, 'head that KEEPS every base adoption and adds one passes (pending → adopted is the direction the ratchet allows)');
    ok(
      checkRatchet(BASE, BASE, () => true).ok && checkRatchet({ producers: {} }, BASE, () => true).adoptedAtBase === 0,
      'identical manifests pass; an empty base has nothing to hold and says so with adoptedAtBase 0'
    );
    /* the real leg: the committed manifest against ITSELF is all kept — non-vacuous by count */
    const realM = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const sv = checkRatchet(realM, realM, (p) => fs.existsSync(path.join(ROOT, p)));
    ok(sv.ok && sv.kept === sv.adoptedAtBase && sv.adoptedAtBase > 0, `the committed manifest holds its own ${sv.adoptedAtBase} adoptions (kept ${sv.kept})`);
  }

  const N = 47;
  if (fails.length) {
    console.log(fails.map((f) => '  ✗ ' + f).join('\n'));
    console.log(`${fails.length} failed of ${N}`);
    process.exit(1);
  }
  console.log(`all ${N} selftests passed`);
}

function main() {
  if (has('--selftest')) return selftest();
  const en = enumerate(ROOT);
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { schema: 'tepna.verdict-adoption/1', producers: {} };
  if (has('--triage')) {
    const unbinned = en.filter((p) => !manifest.producers[p]);
    for (const t of triage(ROOT, unbinned)) console.log(`${t.path}  code:${t.code} comment:${t.comment} json:${t.json}  → ${t.suggest}\n${t.samples.map((s) => '      ' + s).join('\n')}`);
    console.log(`\n${unbinned.length} unbinned of ${en.length} enumerated`);
    return;
  }
  const V = createRequire(import.meta.url)(path.join(ROOT, 'verdict.js'));
  const r = check(en, manifest, V.validate, (e) => runEmits(e, ROOT));
  const c = r.counts;
  console.log(
    `verdict-adoption: ${c.enumerated} producer(s) enumerated · ${c.named} binned — decides ${c.decides} · already-json ${c['already-json']} · word-only ${c['word-only']} · test ${c.test} · adopted ${c.adopted} (validated ${c.validated}) · pending ${c.pending}`
  );
  const { readSource, testRefs } = treeReaders(ROOT);
  const g = checkGated(manifest, readSource, testRefs);
  const w = checkWordOnlyClaim(manifest, readSource);
  const bi = argv.indexOf('--base');
  const baseRef = bi >= 0 && argv[bi + 1] ? argv[bi + 1] : 'origin/main';
  const { mergeBase, manifest: baseManifest } = baseManifestAt(ROOT, baseRef);
  const rt = checkRatchet(baseManifest, manifest, (p) => fs.existsSync(path.join(ROOT, p)));
  console.log(
    `verdict-adoption: ${w.checked} word-only row(s) CLAIM nothing is emitted \u00b7 ${w.conceded} concede emission and say why ` +
      `= ${w.wordOnly} word-only \u2014 ${w.flagged.length} still print a decision outside their selftest, all in WO_CLAIM_RATCHET (debt, may only shrink)`
  );
  console.log(
    `verdict-adoption: ${w.noLocator} of the ${w.checked} have no recognisable selftest locator, so their WHOLE file is scanned \u2014 ` + `that bias runs toward false positives, never toward misses`
  );
  console.log(
    `verdict-adoption: ${g.decides} \`decides\` producer(s) — ${Object.keys(g.gated).length} gated (a selftest or a test names them) · ${g.ungated.length} ungated, all in UNGATED_RATCHET (debt, may only shrink)`
  );
  console.log(
    `verdict-adoption: ${rt.adoptedAtBase} adopted at the merge base ${mergeBase.slice(0, 12)} (${baseRef}) — ${rt.kept} kept · ${rt.retired.length} retired with their file · ${rt.deAdopted.length} DE-ADOPTED (adoption is a ratchet; must be 0)`
  );
  const errors = [...r.errors, ...g.errors, ...w.errors, ...rt.errors];
  if (errors.length) {
    console.log(errors.map((e) => '  ✗ ' + e).join('\n'));
    console.log(`\n✗ ${errors.length} red(s) — the population and the manifest are not equal, an adoption does not hold, or a check has no test`);
    process.exit(1);
  }
  console.log('✓ the manifest partitions the enumerated population; every adoption read and valid; every check is gated or in the ratchet; nothing adopted on the base was de-adopted');
}
main();
