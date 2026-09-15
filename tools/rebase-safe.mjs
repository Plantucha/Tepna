#!/usr/bin/env node
/*
 * tools/rebase-safe.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * REBASE ONTO origin/main WITHOUT SILENTLY REVERTING SOURCE.
 *
 * WHY THIS EXISTS. Several sessions work this repo at once and `main` moves during every review
 * cycle, so almost every PR must rebase at least once. When it does, the conflicts are nearly always
 * in GENERATED artifacts — the two orchestrator bundles in particular are re-bundled by any change to
 * any inlined module, so they collide between PRs that share no source at all.
 *
 * The obvious shortcut is fatal:
 *
 *     git checkout origin/main -- $(git diff --name-only --diff-filter=U)   # ← NEVER
 *
 * It is correct for a generated file and DESTRUCTIVE for a source one, and it fails SILENTLY: the
 * rebase completes, the tree is clean, the branch pushes. Measured here on 2026-08-05 — that one line
 * reverted a test group, a DSP fix and a provenance entry out of a commit whose message still
 * described all three. The push succeeded. Only `git show HEAD:<file> | grep` caught it.
 *
 * THE RULE THIS ENCODES. A generated file's correct content is a FUNCTION OF SOURCE, so neither side
 * of a conflict in one is authoritative — the answer is to take either and REBUILD. A source file has
 * no such function; its conflict must be resolved by a human/agent reading both sides. So:
 *
 *     conflict in a GENERATED path  →  auto-resolve, then rebuild from source, then verify
 *     conflict in ANY other path    →  STOP. Abort the rebase. Name the files. Exit non-zero.
 *
 * ⚠️ THAT SECOND LINE IS NOT ABSOLUTE, AND READING IT AS ABSOLUTE IS HOW A LEDGER GETS CORRUPTED.
 * The whole model above is CONFLICT-DRIVEN: it enumerates `--diff-filter=U` and can only act on paths
 * git reports as unmerged. A path carrying `merge=union` in `.gitattributes` NEVER CONFLICTS — the
 * driver keeps both sides — so it cannot appear in that list, the STOP branch cannot fire, and this
 * tool sails through reporting success. `.gitattributes` already says so at the `briefs/RESIDUE.md`
 * rule ("rebase-safe treats the file as source and now finds no conflict"); it is restated here because
 * a reader trusting the contract above will not go and open `.gitattributes`.
 *
 * A union driver cannot represent an EDIT. Appends merge fine, which is what the attribute is for; but
 * editing a line — closing a RESIDUE row's state cell — leaves BOTH the old and the new line, and the
 * ledger then contradicts itself about whether a defect is live. A REBASE replays your diff through the
 * same driver, so it is not a way around this: measured 2026-09-15, `#2506`'s own rebase duplicated a
 * row. For those paths the safe move is to REBUILD the edit on a fresh branch off the target, which
 * sends the file through no merge driver at all.
 *
 * `checkUnionPaths` below turns that from a footnote into a local failure.
 *
 * THE GENERATED SET IS ASKED FOR, NEVER GUESSED. A glob would be the second version of this bug:
 * `*.html` would match the authored `*.src.html`, every hand-written reference guide and `Science.html`
 * — and auto-resolving one of those is exactly the silent revert this tool exists to prevent. The set
 * is read from the builders that own it (`manifest-gate.js` MANIFEST_BUNDLES, build.mjs's
 * ORCHESTRATORS, build-analysis.mjs's TOOLS, plus `docs/` and `provenance/`), so a bundle added to the
 * fleet joins this tool by construction. If a set cannot be read, the tool treats EVERYTHING as source
 * and stops — it fails CLOSED, because a tool that fails open here reverts work.
 *
 *   node tools/rebase-safe.mjs                 # rebase onto origin/main, rebuild, verify
 *   node tools/rebase-safe.mjs --onto <ref>    # some other base
 *   node tools/rebase-safe.mjs --classify <p…> # print the verdict for paths (used by the self-test)
 *   node tools/rebase-safe.mjs --no-build      # skip the rebuild (classification + rebase only)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* 🔴 THIS TOOL ACTS ON THE CHECKOUT IT LIVES IN, NOT THE ONE YOU ARE STANDING IN — and every git call
   below is bound to `ROOT`, including `git rebase --continue` and the builders. So invoking ANOTHER
   checkout's copy does not merely read the wrong tree, it would REBASE the wrong tree and run
   `build.mjs --check` inside it.

   Measured 2026-09-15: `node /home/michal/Tepna/tools/rebase-safe.mjs` run from a worktree refused
   with "working tree is not clean" while that worktree was spotless — it was reporting the SHARED
   ROOT's cleanliness. That refusal is permanent, because the shared root is essentially never clean,
   and a permanent refusal looks like a tool bug, so the natural response is to work around it.

   ⚠️ IT FAILS SAFE *BECAUSE* THE SHARED ROOT IS DIRTY, WHICH IS WHAT MAKES IT DANGEROUS. The luck is
   load-bearing and inverts the moment someone tidies the root: on a CLEAN shared root the guard
   passes and the tool proceeds to rebase `main` in the checkout five other sessions are standing in.
   That is CLAUDE.md §👥.2b's hazard reached through a different door — not a hand ref-move, but a tool
   operating on its own checkout instead of yours.

   THE FIX IS TO REFUSE, NOT TO RETARGET. Deriving `ROOT` from `git rev-parse --show-toplevel` would
   make `node /other/checkout/tools/rebase-safe.mjs` silently act on the cwd instead — surprising in
   the opposite direction, and a tool that quietly retargets itself is its own hazard. An ambiguous
   invocation reports as ambiguous and names both paths, which is the same honest-absence rule §∅
   applies to a missing measurement. `--show-toplevel` is used to DETECT the mismatch, never to
   resolve it. */
{
  let cwdTop = null;
  try {
    /* stderr IGNORED: outside a checkout git writes a multi-line 'fatal: not a git repository'
       before this catch can run, and a guard that is silent by design must not leak the probe it used
       to decide it had nothing to say. */
    cwdTop = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    /* not a git checkout at all ⇒ let the normal paths report it; this guard only speaks to the
       TWO-CHECKOUT case, and inventing a second failure mode here would obscure the first. */
  }
  if (cwdTop) {
    let rootTop = ROOT;
    try {
      rootTop = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: ROOT, encoding: 'utf8' }).trim();
    } catch {
      /* unreadable ⇒ compare the literal paths below rather than skipping the check entirely */
    }
    if (rootTop !== cwdTop) {
      process.stderr.write(
        `rebase-safe: REFUSED — you are standing in one checkout and ran another one's copy.\n` +
          `  your checkout : ${cwdTop}\n` +
          `  this script's : ${rootTop}\n` +
          `Every git call in this tool is bound to the script's own checkout, so continuing would\n` +
          `rebase ${rootTop} and run its builders — not the tree you are in. Run YOUR copy:\n` +
          `  cd ${cwdTop} && node tools/rebase-safe.mjs\n`
      );
      process.exit(4);
    }
  }
}

const require = createRequire(import.meta.url);
const C = { red: '[31m', grn: '[32m', yel: '[33m', bold: '[1m', off: '[0m' };
const paint = (s, c) => (process.stdout.isTTY ? c + s + C.off : s);
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
/* UNTRIMMED. `--porcelain` encodes the index/worktree state in TWO leading columns, so an unstaged
   modification legitimately begins with a space and `.trim()` destroys it — silently, and only on the
   first line. Any caller parsing column-oriented git output must use this, never `git()`. */
const gitRaw = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const gitQuiet = (...a) => {
  try {
    return { ok: true, out: git(...a) };
  } catch (e) {
    return { ok: false, out: String((e && (e.stdout || e.message)) || '') };
  }
};

/* ── THE GENERATED SET, read from the builders that own it ──────────────────────────────────────
   Returns null if any source cannot be read — the caller then treats everything as source. */
export function generatedSet() {
  const bundles = new Set();
  try {
    const MG = require(join(ROOT, 'manifest-gate.js'));
    const list = MG && MG.MANIFEST_BUNDLES;
    if (!Array.isArray(list) || !list.length) return null;
    list.forEach((b) => bundles.add(b));
  } catch {
    return null;
  }
  // Orchestrators + analysis tools are declared as literals inside their builders; read them out of
  // the source text rather than re-typing them here, so a change there reaches this tool.
  const grab = (file, decl) => {
    if (!existsSync(join(ROOT, file))) return null;
    const t = readFileSync(join(ROOT, file), 'utf8');
    const m = t.match(new RegExp('const\\s+' + decl + '\\s*=\\s*\\[([\\s\\S]*?)\\]'));
    if (!m) return null;
    const items = m[1].match(/['"]([^'"]+\.html)['"]/g) || [];
    return items.map((s) => s.slice(1, -1));
  };
  const orch = grab('tools/build.mjs', 'ORCHESTRATORS');
  const tools = grab('tools/build-analysis.mjs', 'TOOLS');
  if (!orch || !tools) return null;
  orch.forEach((b) => bundles.add(b));
  tools.forEach((b) => bundles.add(b));
  /* ASK build-docs WHICH docs/ PATHS IT OWNS — do not assume the prefix (adversarial pass
     2026-08-05). This used to be `startsWith('docs/')`, and that was FALSE and dangerous:
     build-docs writes a docs/ file only where a ROOT TWIN exists, plus six artifacts, and `.md` is
     filtered out of its asset list — so the 30 archival docs (`docs/COMPLIANCE/*`,
     `EVENT-LEXICON.md`, `LEXICON.md`, `docs/papers/*`, …) are AUTHORED and owned by nobody.
     Measured before the fix: `--classify docs/EVENT-LEXICON.md` said GENERATED, while
     `build-docs --check` reported "current" after that file was modified and a full run did not
     restore it. A conflict there would have been auto-resolved by discarding your side, left
     unrestorable by the rebuild, and reported `✓` — this tool committing the exact silent revert it
     exists to prevent. `--list-owned` implies `--check`, so asking cannot write. */
  const owned = askBuildDocs();
  if (!owned) return null; // FAIL CLOSED — an unanswerable builder means we know nothing
  owned.forEach((p) => bundles.add(p));
  return bundles;
}

function askBuildDocs() {
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'tools/build-docs.mjs'), '--list-owned'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const list = out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    return list.length ? list : null;
  } catch {
    return null;
  }
}

/* ── `git status --porcelain` → paths ──────────────────────────────────────────────────────────────
   Every line is `XY PATH`: two status columns, one space, then the path. Three ways to get this
   wrong, and the shipped version had two of them. All three are gate-pinned by value.

   1 · DO NOT `.trim()` THE OUTPUT FIRST. A worktree modification that is not staged has a LEADING
       SPACE in column 1 (`" M path"`) — exactly what `rebuild()` leaves behind. `.trim()` strips it
       from the FIRST line only, so a `.slice(3)` then eats `M`, ` ` and the path's first character.
       Measured: `" M OverDex.html"` → `verDex.html`. Only ever the first entry, which is why it read
       as a typo rather than a parser fault and survived. `git()` trims by default, so this function
       takes the RAW string and must keep it raw.
   2 · A QUOTED PATH IS C-QUOTED, NOT JUST QUOTE-WRAPPED. git quotes any path with a space or a
       non-ASCII byte and escapes the bytes: `Data Unifier.html` → `"Data Unifier.html"`, and
       `café.html` → `"caf\303\251.html"`. Stripping the outer quotes with a regex leaves the octal
       escapes in place, producing a plausible-looking name that does not exist. This matters here
       specifically: **`Data Unifier.html` is one of the two orchestrator bundles this tool rebuilds**,
       and it sorts first, so the most likely first entry is a quoted one.
   3 · The two defects CANCEL on a quoted first entry — the character (1) eats is the opening quote,
       and the trailing-quote strip removes its partner. So the bug is INVISIBLE precisely when the
       first artifact is `Data Unifier.html` and visible when it is `OverDex.html`. A fixture whose
       first entry is quoted, staged (`"M  path"`) or untracked (`"?? path"`) passes while the bug is
       present, because none of those carries a leading space. The gate pins one of each. */
function _unquote(s) {
  if (s.length < 2 || s[0] !== '"') return s;
  const body = s.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') {
      bytes.push(...Buffer.from(body[i], 'utf8'));
      continue;
    }
    const c = body[++i];
    const oct = /[0-7]/.test(c) ? body.slice(i, i + 3) : null;
    if (oct && /^[0-7]{3}$/.test(oct)) {
      bytes.push(parseInt(oct, 8));
      i += 2;
      continue;
    }
    const simple = { n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, a: 7 };
    bytes.push(...Buffer.from(c in simple ? String.fromCharCode(simple[c]) : c, 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

export function parsePorcelain(raw) {
  return String(raw == null ? '' : raw)
    .split('\n')
    .filter((l) => l.length > 3)
    .map((l) => {
      const status = l.slice(0, 2);
      let rest = l.slice(3);
      /* A rename/copy reads `R  old -> new`; the destination is the path that exists now, and it is
         the one a caller must stage. git quotes any path containing the separator, so an UNQUOTED
         ` -> ` is unambiguously the separator. A rebuild cannot rename, so this is belt-and-braces —
         but a parser that silently returned `old -> new` would hand back a path that never exists. */
      if (/^[RC]/.test(status) && rest.includes(' -> ')) rest = rest.slice(rest.lastIndexOf(' -> ') + 4);
      return _unquote(rest);
    });
}

/* A path is GENERATED iff a builder owns it. Everything else — including every *.src.html, every
   authored guide, tests/, uploads/ goldens and all *.js — is SOURCE. */
export function classify(path, gen) {
  if (!gen) return 'source'; // fail CLOSED
  /* A path that traverses is not a path we understand, so it is SOURCE. `provenance/../oxydex-dsp.js`
     matched the `provenance/` prefix and classified GENERATED in the first version — found by an
     adversarial pass. Git does not emit traversing paths from `--diff-filter=U`, so this was not
     reachable in practice; it is fixed anyway, because the whole value of this classifier is that it
     is wrong in the SAFE direction and a prefix test that can be walked out of is not. */
  const p = String(path == null ? '' : path);
  if (!p || p.startsWith('/') || p.split('/').includes('..') || p.split('/').includes('.')) return 'source';
  if (gen.has(p)) return 'generated';
  // NO `docs/` PREFIX RULE — see askBuildDocs(). The owned docs/ paths are in `gen` by name.
  /* provenance/ IS a whole-prefix rule, and that is verified rather than assumed: the directory holds
     exactly the per-app ledger fragments plus `_meta.json` and `index.json`, every one written by
     build.mjs, and nothing authored lives there. If an authored file is ever added under it, this
     line becomes the same defect `docs/` just had — so enumerate before extending it. */
  if (p.startsWith('provenance/')) return 'generated';
  return 'source';
}

function rebuild() {
  const steps = [
    ['tools/build.mjs', ['--all']],
    ['tools/build-analysis.mjs', []],
    ['tools/build-docs.mjs', []]
  ];
  for (const [script, args] of steps) {
    if (!existsSync(join(ROOT, script))) continue;
    process.stdout.write('  ▸ ' + script + ' … ');
    try {
      execFileSync(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, stdio: 'pipe' });
      console.log(paint('ok', C.grn));
    } catch (e) {
      console.log(paint('FAILED', C.red));
      console.error(String((e && (e.stdout || e.message)) || ''));
      process.exit(1);
    }
  }
  process.stdout.write('  ▸ build.mjs --check … ');
  try {
    execFileSync(process.execPath, [join(ROOT, 'tools/build.mjs'), '--check'], { cwd: ROOT, stdio: 'pipe' });
    console.log(paint('clean', C.grn));
  } catch (e) {
    console.log(paint('STALE', C.red));
    console.error(String((e && (e.stdout || e.message)) || ''));
    process.exit(1);
  }
}

/* ── VERIFICATION-STAMP GUARD ────────────────────────────────────────────────────────────────────
   A rebase can silently DISCHARGE a verification. `provenance/<App>.json` is a generated artifact, so
   the auto-resolve above correctly takes `onto`'s copy — and that copy carries `onto`'s `verifiedUnder`,
   throwing away a stamp this branch had already earned. Nothing downstream catches it: GATE A compares
   `manifestHash`, and `verifiedUnder` is not a build product at all — it is a claim that somebody RAN
   the app on the real corpus and reproduced those bytes. Clean tree, green gates, unproven claim.

   Measured 2026-08-17: three sessions nearly lost a stamp to a rebase in one evening. That is a missing
   guard, not three mistakes.

   REPORTS, NEVER FAILS. A legitimate rebase onto a moved `onto` WILL stale a stamp, and the remedy is a
   corpus run this tool cannot perform — the recordings are gitignored, so a contributor without them
   could never green a hard failure. Same split `verify-fixtures` already makes: report in CI, block at
   release.

   ⚠ AND IT DISTINGUISHES *THIS* REBASE'S DAMAGE FROM PRE-EXISTING DRIFT. Without the before/after
   comparison, any branch carrying a deliberately-unverified fixture prints a red line on EVERY rebase —
   and a warning that fires when nothing is wrong is one people learn to scroll past, which is exactly
   the failure that motivated the guard. Quiet until it matters. */
function stampSnapshot() {
  const out = {};
  const dir = join(ROOT, 'provenance');
  if (!existsSync(dir)) return out;
  let MG;
  try {
    MG = require(join(ROOT, 'manifest-gate.js'));
  } catch {
    return out; // no gate module ⇒ no claim, not a false all-clear
  }
  if (!MG || typeof MG.computeHashFromText !== 'function') return out;
  for (const f of require('node:fs').readdirSync(dir)) {
    if (!f.endsWith('.json') || f.startsWith('_') || f === 'index.json') continue;
    const app = f.slice(0, -5);
    const html = join(ROOT, app + '.html');
    if (!existsSync(html)) continue;
    let j;
    try {
      j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    const fixtures = {};
    for (const k of Object.keys(j.fixtures || {})) {
      const fx = j.fixtures[k];
      if (fx && !fx.historical && fx.verifiedUnder) fixtures[k] = fx.verifiedUnder;
    }
    if (Object.keys(fixtures).length) out[app] = { html, fixtures };
  }
  return out;
}

async function stampStates(snap) {
  const MG = require(join(ROOT, 'manifest-gate.js'));
  const st = {};
  for (const app of Object.keys(snap)) {
    let ch = null;
    try {
      ch = await MG.computeHashFromText(readFileSync(snap[app].html, 'utf8'));
    } catch {
      continue;
    }
    for (const [k, v] of Object.entries(snap[app].fixtures)) st[app + ' · ' + k] = v === ch;
  }
  return st;
}

/* The decision core, pure and exported so the self-test can reach it without running a rebase.

   THE THREE-WAY SPLIT IS THE POINT, not bookkeeping. A guard that reports every stale stamp fires on
   any branch carrying a deliberately-unverified fixture — on EVERY rebase — and a warning that cries
   when nothing is wrong is one people learn to scroll past. That would leave the failure exactly where
   it was, with an extra line of output nobody reads.

     before  after   meaning
     MATCH   stale   this rebase discharged it        ← the only case worth alarming on
     stale   stale   pre-existing, untouched here     ← mention once, quietly
     stale   MATCH   the rebase RESTORED it (rebased onto the code it was verified under)

   A key absent from `before` (a fixture this branch adds) is deliberately NOT reported: it was never
   verified here, so this rebase cannot have discharged it. */
export function classifyStamps(before, after) {
  const staled = [],
    pre = [],
    restored = [];
  for (const [key, ok] of Object.entries(after || {})) {
    const was = (before || {})[key];
    if (was === true && ok === false) staled.push(key);
    else if (was === false && ok === false) pre.push(key);
    else if (was === false && ok === true) restored.push(key);
  }
  return { staled, pre, restored };
}

async function reportStampDamage(before) {
  if (!before || !Object.keys(before).length) return;
  let after;
  try {
    after = await stampStates(stampSnapshot());
  } catch {
    return;
  }
  const { staled, pre, restored } = classifyStamps(before, after);
  if (staled.length) {
    console.log(paint('\n⚠ THIS REBASE DISCHARGED ' + staled.length + ' VERIFICATION(S) — the stamp reverted to ' + "the base's:", C.red));
    staled.forEach((k) => console.log('    ' + k));
    console.log('  Re-verify BEFORE pushing, or the branch ships an unproven claim behind green gates:');
    console.log('    DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs');
    console.log("  (If a fixture's BYTES moved, regenerate first — re-verifying a moved golden stamps");
    console.log('   verifiedUnder over content the code does not reproduce.)');
  }
  if (restored.length) {
    console.log(paint('\n⚙ the rebase RESTORED ' + restored.length + ' stamp(s) (you rebased onto the code they were verified under).', C.grn));
  }
  if (pre.length && !staled.length) {
    console.log(paint('\n· ' + pre.length + ' stamp(s) were already stale before this rebase — unchanged by it, not reported as damage.', C.yel));
  }
}

/**
 * THE BACKSTOP FOR THE CONFLICT-DRIVEN MODEL'S ONE BLIND SPOT (see the header).
 *
 * A `merge=union` path never conflicts, so it cannot reach the `--diff-filter=U` machinery above. After
 * a clean rebase this asks git which of the rebased paths actually carry the attribute and reports any
 * row key that now appears more than once — the signature of an EDIT replayed through a union driver,
 * which keeps both the old line and the new one.
 *
 * Reads the COMMITTED HEAD, never the working tree. A working tree that has not been touched yet
 * answers truthfully about itself and tells you nothing about what you are holding — that false
 * negative was measured on 2026-09-15 while diagnosing exactly this class.
 *
 * The attribute comes from `git check-attr`, never from parsing `.gitattributes`: the file has
 * precedence rules and, as of today, two of its three union rules are vestigial (the
 * `tests/*-list.txt` snapshots were retired in 2026-07), so a hand-rolled parse would be both wrong and
 * stale. Asking git costs one call and cannot drift.
 *
 * Keys are `| <key> |` leading table cells, the shape the only live union path uses. A union file with
 * no such rows produces no keys and is reported clean rather than guessed at — this check is a
 * duplicate-detector for keyed ledgers, not a general union linter, and it says so rather than
 * pretending to cover a file whose shape it does not know.
 */
/**
 * PURE (exported for the suite): the dated ledger keys that appear MORE THAN ONCE in `text`.
 *
 * This is the signature of an EDIT replayed through a `merge=union` driver — the driver keeps both the
 * old line and the new one, so a closed row survives twice and the ledger contradicts itself about
 * whether the defect is live.
 *
 * ⚠️ DATED KEYS ONLY (`YYYY-MM-DD-slug`), which is the documented residue key shape. A looser
 * "first table cell" pattern also matches the file's OWN row-contract table — `| key |`, `| logged |`,
 * `| state |` — and those legitimately recur, so it reported a duplicate on a CLEAN `origin/main`.
 * That was caught by running the detector against clean main as a NEGATIVE CONTROL before shipping it:
 * a check that fires on a healthy tree blocks every rebase and gets disabled, which is worse than not
 * having it. The positive control is the real union-merged tree measured 2026-09-15, where it finds
 * exactly the two keys that were duplicated and nothing else.
 */
export function duplicateLedgerKeys(text) {
  const seen = new Map();
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\|\s*(\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*)\s*\|/.exec(line);
    if (m) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

function checkUnionPaths(onto) {
  const touched = git('diff', '--name-only', onto + '...HEAD')
    .split('\n')
    .filter(Boolean);
  if (!touched.length) return;
  let attrs = '';
  try {
    attrs = git('check-attr', 'merge', '--', ...touched);
  } catch {
    return; // check-attr unavailable/errored — this is a backstop, never a blocker
  }
  const union = attrs
    .split('\n')
    .filter((l) => /: merge: union$/.test(l))
    .map((l) => l.replace(/: merge: union$/, ''));
  if (!union.length) return;

  const bad = [];
  for (const p of union) {
    let text = '';
    try {
      text = git('show', 'HEAD:' + p);
    } catch {
      continue; // path deleted by the rebase — nothing to duplicate
    }
    const dups = duplicateLedgerKeys(text);
    if (dups.length) bad.push({ path: p, dups });
  }
  if (!bad.length) {
    console.log(paint('  union-merge paths checked (' + union.length + '): no duplicated key', C.grn));
    return;
  }
  console.error(paint('\n✕ UNION-MERGE DUPLICATE — the rebase reported success and corrupted a ledger:', C.red));
  for (const b of bad) {
    console.error('    ' + b.path);
    b.dups.forEach((k) => console.error('      ' + k + ' appears more than once'));
  }
  console.error(paint('\n  This is NOT a conflict you resolve — a union driver keeps BOTH sides, so an', C.yel));
  console.error(paint('  EDIT (closing a row) survives twice and the ledger contradicts itself.', C.yel));
  console.error('\n  REBUILD the edit on a fresh branch off ' + onto + ' instead of merging or rebasing onto it:');
  console.error('    git checkout -b <branch>-v2 ' + onto + '   # then re-apply the one-cell edit by hand');
  console.error('  Assert the current state before re-applying — if the row is already closed, the work');
  console.error('  is already done and the duplicate is what you were about to create.');
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const gen = generatedSet();

  if (argv[0] === '--classify') {
    for (const p of argv.slice(1)) console.log(classify(p, gen) + '\t' + p);
    return;
  }
  if (!gen) {
    console.error(paint('✕ cannot read the builders’ owned sets — refusing to classify anything as generated.', C.red));
    console.error('  This tool fails CLOSED on purpose: guessing here reverts work. Rebase by hand.');
    process.exit(2);
  }

  const onto = argv.includes('--onto') ? argv[argv.indexOf('--onto') + 1] : 'origin/main';

  /* Snapshot the verification stamps BEFORE anything moves, so the report below can tell a stamp THIS
     rebase discharged from one that was already stale. Cheap: it hashes the bundles once. */
  let stampsBefore = null;
  try {
    stampsBefore = await stampStates(stampSnapshot());
  } catch {
    stampsBefore = null; // no snapshot ⇒ the report stays silent rather than guessing
  }

  const doBuild = !argv.includes('--no-build');

  if (git('status', '--porcelain')) {
    console.error(paint('✕ working tree is not clean — commit or stash your own work first.', C.red));
    process.exit(2);
  }
  console.log(paint('▸ rebase-safe → ' + onto, C.bold));
  if (onto.startsWith('origin/')) gitQuiet('fetch', 'origin', onto.slice('origin/'.length));

  const behind = git('rev-list', '--count', 'HEAD..' + onto);
  if (behind === '0') {
    console.log('  already up to date with ' + onto + ' — nothing to rebase.');
    if (doBuild) rebuild();
    return;
  }
  console.log('  ' + behind + ' commit(s) behind ' + onto);

  const r = gitQuiet('rebase', onto);
  if (!r.ok) {
    const conflicts = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
    const source = conflicts.filter((p) => classify(p, gen) === 'source');
    const generated = conflicts.filter((p) => classify(p, gen) === 'generated');

    if (source.length) {
      console.error(paint('\n✕ SOURCE CONFLICT — stopping. These need real resolution, never a wholesale checkout:', C.red));
      source.forEach((p) => console.error('    ' + p));
      if (generated.length) {
        console.error(paint('  (also conflicted, and safe to auto-resolve once the above are done:', C.yel));
        generated.forEach((p) => console.error('    ' + p));
        console.error(paint('  )', C.yel));
      }
      console.error('\n  For tests/dex-tests.js specifically: restore ' + onto + "'s copy and RE-RUN your insertion.");
      console.error('  Never keep one side wholesale — that is how a test group is silently dropped.');
      console.error('  Aborting the rebase so your branch is exactly as it was.');
      gitQuiet('rebase', '--abort');
      process.exit(1);
    }

    // Generated-only: neither side is authoritative — take one and rebuild below.
    console.log(paint('  auto-resolving ' + generated.length + ' generated artifact(s) (rebuilt below):', C.yel));
    generated.forEach((p) => console.log('    ' + p));
    for (const p of generated) gitQuiet('checkout', onto, '--', p);
    gitQuiet('add', ...generated);
    const cont = execFileSync('git', ['-c', 'core.editor=true', 'rebase', '--continue'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    void cont;
  }
  console.log(paint('  rebase complete', C.grn));

  checkUnionPaths(onto);

  if (doBuild) {
    console.log(paint('▸ rebuilding every generated tree from source', C.bold));
    rebuild();
    /* RAW, not `git()` — `git()` trims, and the leading space of an unstaged entry is load-bearing.
       See parsePorcelain's header: trimming it corrupts the first path. */
    const dirty = parsePorcelain(gitRaw('status', '--porcelain'));
    if (dirty.length) {
      console.log(paint('▸ the rebuild moved ' + dirty.length + ' artifact(s) — AMEND them into your commit:', C.yel));
      dirty.forEach((p) => console.log('    ' + p));
      console.log('\n  git add ' + dirty.map((p) => (/[ ]/.test(p) ? '"' + p + '"' : p)).join(' ') + ' && git commit --amend --no-edit');
    } else {
      console.log(paint('  no artifact moved — nothing to amend', C.grn));
    }
  }
  await reportStampDamage(stampsBefore);

  console.log(paint('\n✓ rebase-safe done. VERIFY YOUR OWN CHANGES SURVIVED before pushing, e.g.', C.bold));
  console.log('    git show HEAD:<file> | grep -c <an identifier your change adds>');
}

if (process.argv[1] && process.argv[1].endsWith('rebase-safe.mjs'))
  main().catch((e) => {
    console.error(String((e && e.stack) || e));
    process.exit(2);
  });
