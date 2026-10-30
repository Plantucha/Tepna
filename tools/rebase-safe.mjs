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
 *   node tools/rebase-safe.mjs --resolve <p…>  # take <onto>'s bytes for a path the BUILDERS own
 *   node tools/rebase-safe.mjs --no-build      # skip the rebuild (classification + rebase only)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { parseRows as parseLedgerRows } from './residue-ids.mjs';
import { extractVerdicts } from './pr-compliance.mjs';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { isCliEntry } from './argv-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* 🔴 THIS TOOL ACTS ON THE CHECKOUT IT LIVES IN, NOT THE ONE YOU ARE STANDING IN — and every git call
   below is bound to `ROOT`, including `git rebase --continue` and the builders. So invoking ANOTHER
   checkout's copy does not merely read the wrong tree, it would REBASE the wrong tree and run
   `build.mjs --check` inside it.

   Measured 2026-09-15: `node ~/Tepna/tools/rebase-safe.mjs` run from a worktree refused
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
   resolve it.

   🔴 IT RUNS ON A CLI RUN ONLY, BECAUSE A BARE TOP-LEVEL BLOCK FIRES ON AN `import` TOO. The refusal
   lived in a bare block here, so `import { classify } from './rebase-safe.mjs'` exited 4 before the
   importing file reached a line of its own — and the exit text spoke about rebasing a checkout the
   importer never asked to rebase. `wt-done --landed` is the caller that wants `classify`, and it runs
   by absolute path from any checkout, which is the very case the refusal names. `js-lex.mjs` was
   split out of `mutate.mjs` for the same reason: importing a module to borrow one function must not
   start the module's job. Row `2026-10-30-a-module-level-guard-travels-with-the-import`.

   THE REFUSAL GUARDS THE REBASE, NOT THE READS. An importer reaching `generatedSet()` or
   `heldGoldens()` still reads the SCRIPT's checkout, and that is safe by construction here: both fail
   CLOSED, returning `null` or an empty set, and `classify` answers `source` on a null set — which
   stops a rebase rather than resolving one. Destructive work lives in `main()`, and `main()` asks
   first. */
function refuseForeignCheckout() {
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
  /* `build-docs.mjs` is not the only builder that writes under `docs/`. `tools/tools-index.mjs`
     writes ONE file there, and the classifier called it SOURCE, so `rebase-safe` STOPPED on a file
     no human edits (measured 2026-10-13: `--classify docs/TOOLS-INDEX.md` → `source`). Ask that
     builder for the path instead of typing it here, so a rename in the builder reaches this tool.

     WHY ONLY THIS ONE, AND WHY `docs/MUTATION-INVENTORY.md` STAYS SOURCE. The test is not "a builder
     writes it" — it is "does the rebuild RESTORE it", because auto-resolve throws one side away and
     the rebuild is the only thing that puts the right bytes back. `tools-index.mjs` reads `tools/**`,
     carries no clock, and reproduces its output byte for byte, so taking either side is harmless.
     `tools/mutation-suite.mjs --inventory` does neither: it stamps `last-verified` with TODAY (so a
     rebuild would dirty the file and claim a verification no sweep performed), and its content comes
     from mutation journals that git ignores and that differ per checkout — with none present it logs
     `no journals in this checkout` and writes nothing at all. Auto-resolving that file would discard
     a branch's regenerated inventory, leave it unrestorable, and report `✓` — the exact silent revert
     the 2026-08-05 pass removed the `docs/` prefix rule to prevent. So it is SOURCE and the tool
     stops on it, which is the expensive-but-correct side of the trade.

     ONE DELIBERATE DISAGREEMENT WITH THE HOOK. `.claude/hooks/guard-shared-tree.sh` keeps every
     `docs/**.md` as source (its note 5), so a hand-typed `git checkout <ref> -- docs/TOOLS-INDEX.md`
     stays DENIED even though this classifier now calls that path generated. The hook's own note says a
     guard and the tool it points at must not disagree, and the asymmetry is kept anyway because it
     runs in the safe direction: an over-deny costs one command and points at `npm run rebase`, which
     is the right answer for a conflict in a built file, while an exemption would let a hand-rolled
     restore reach the 28 authored specs that live beside it. `rebase-safe` never needs the exemption —
     it resolves and then REBUILDS, inside this process, where no hook applies. */
  const idx = askSingleDocsOutput('tools/tools-index.mjs');
  if (!idx) return null; // FAIL CLOSED — same rule: an unanswerable builder means we know nothing
  bundles.add(idx);
  /* THE GOLDEN REGENERATORS, asked the same way and failing closed the same way — see
     askRegenGoldens() for the two rails and for why a held fixture stays SOURCE. Nine spawns that
     build nothing: measured 379 ms for all nine, against a rebase that rebuilds four trees. */
  const goldens = askRegenGoldens();
  if (!goldens) return null; // FAIL CLOSED
  _recipeByFixture = new Map();
  goldens.generated.forEach((g) => {
    bundles.add(g.path);
    _recipeByFixture.set(g.path, g.recipe);
  });
  return bundles;
}

/* Which recipe rewrites a given auto-resolved fixture. Written by `generatedSet()` so `rebuild()` can
   run exactly the regenerators a conflict needs, rather than all nine on every rebase. */
let _recipeByFixture = new Map();
export function recipeForFixture(p) {
  return _recipeByFixture.get(p) || null;
}

/* The ONE `docs/` path a builder declares, read out of its source text. Returns null — never a
   guess — when the file is unreadable (0 matches) or declares more than one (≥2), because a second
   output means this method can no longer say WHICH one is the index. Both cases fail closed in
   `generatedSet()`, where the whole set collapses to "everything is source". */
export function docsOutputFromText(text) {
  if (typeof text !== 'string' || !text) return null;
  const hits = text.match(/join\(\s*ROOT\s*,\s*'docs'\s*,\s*'[^']+'\s*\)/g) || [];
  if (hits.length !== 1) return null;
  const m = hits[0].match(/'docs'\s*,\s*'([^']+)'/);
  return m && m[1] ? 'docs/' + m[1] : null;
}

function askSingleDocsOutput(file) {
  const abs = join(ROOT, file);
  if (!existsSync(abs)) return null;
  try {
    return docsOutputFromText(readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

/* ── THE GOLDEN REGENERATORS OWN FIXTURES UNDER `uploads/`, AND THE CLASSIFIER CALLED THEM SOURCE ──
   Measured by Magpie on #3765 and logged as `2026-10-20-rebase-safe-calls-a-regen-owned-fixture-source`:
   a PpgDex PR that fell behind main stopped on six `uploads/*.node-export.json` files no human edits,
   and the documented way out was blocked in both directions. Keeping one side wholesale is wrong for a
   regenerated artifact, and deleting the files to regenerate them does not work either — `isNew` skips
   an absent fixture with no `newRecord`, and the merge needs the committed bytes as its base. The only
   authority on those bytes is `tools/regen-<node>-goldens.mjs`, which is exactly the shape this tool
   already uses for `docs/`: ask the builder, never glob the tree.

   TWO RAILS, BOTH REQUIRED, because the question is not "does a builder write it" but "can the rebuild
   RESTORE it here" — the same test that keeps `docs/MUTATION-INVENTORY.md` source:

     1 · THE RECIPE DECLARES IT REPRODUCIBLE. A `corpus` row is a real recording's golden; its input is
         gitignored, so a fresh worktree cannot re-run it and an auto-resolve would discard the branch's
         regeneration with nothing to put back.
     2 · EVERY INPUT IS TRACKED IN THIS CHECKOUT. The flag is a declaration; tracking is a measurement,
         and it is the one that answers "here". A fixture whose inputs nobody declared — in the recipe
         or in the fixture ledger — is held too: a classifier that guesses on absent evidence is the
         silent revert this tool exists to prevent.

   Anything held stays SOURCE, so the rebase stops on it and says why. That is the expensive-but-correct
   side: one hand-run of the node's regenerator against a real corpus, instead of a ✓ over reverted bytes. */
export function parseOwnedListing(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n').filter((l) => l.trim().length);
  if (!lines.length) return null;
  const rows = [];
  for (const l of lines) {
    const f = l.split('\t');
    if (f.length !== 3) return null; // not the contract — unreadable, not empty
    const path = f[0].trim();
    const kind = f[1].trim();
    if (!path || (kind !== 'corpus' && kind !== 'committed')) return null;
    rows.push({
      path,
      kind,
      inputs: f[2]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    });
  }
  return rows;
}

/* The decision, separated from the spawns and the git calls so the suite drives every rail by value.
   `isTracked(name)` answers whether an input ships in THIS checkout. Returns null on an unreadable
   listing, which the caller turns into a null generated set — fail CLOSED, never an empty one. */
export function classifyOwnedFixtures(rows, isTracked, ledgerInputs) {
  if (!Array.isArray(rows) || typeof isTracked !== 'function') return null;
  const led = ledgerInputs && typeof ledgerInputs === 'object' ? ledgerInputs : {};
  const generated = [];
  const held = [];
  for (const r of rows) {
    if (!r || typeof r.path !== 'string' || !r.path) return null;
    if (r.kind === 'corpus') {
      held.push({ path: r.path, why: 'the recipe declares it corpus-backed — its input is gitignored' });
      continue;
    }
    const base = r.path.slice(r.path.lastIndexOf('/') + 1);
    const declared = (Array.isArray(r.inputs) ? r.inputs : []).concat(Array.isArray(led[base]) ? led[base] : []);
    const inputs = [...new Set(declared.filter((s) => typeof s === 'string' && s))];
    if (!inputs.length) {
      held.push({ path: r.path, why: 'neither the recipe nor the fixture ledger names an input' });
      continue;
    }
    const absent = inputs.filter((n) => !isTracked(n));
    if (absent.length) {
      held.push({ path: r.path, why: 'input not tracked in this checkout: ' + absent.join(', ') });
      continue;
    }
    generated.push(r.path);
  }
  return { generated, held };
}

/* Which auto-resolved fixtures a regen run did NOT rewrite. The regenerator reports an item it could
   not reach rather than failing — `⊘ <name> — INPUT ABSENT`, `⊘ <name> — committed fixture absent`,
   `✗ <name> — build threw` — and exits 0. So a caller that reads only the exit code would auto-resolve
   a fixture to main's bytes, watch the restore silently not happen, and print ✓. */
export function unrestoredFrom(text, names) {
  if (typeof text !== 'string' || !Array.isArray(names)) return null;
  const bad = [];
  for (const p of names) {
    if (typeof p !== 'string' || !p) return null;
    const base = p.slice(p.lastIndexOf('/') + 1);
    const re = new RegExp('[⊘✗]\\s+' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+—');
    if (re.test(text)) bad.push(p);
  }
  return bad;
}

/* The recipes, read off disk rather than typed here: a node that gains a regenerator reaches this tool
   the day it lands. `regen-goldens.mjs` (the front door) and `regen-goldens-core.mjs` (the scaffolding)
   are not recipes and own nothing. */
function regenRecipeFiles() {
  try {
    return readdirSync(join(ROOT, 'tools'))
      .filter((n) => /^regen-.+-goldens\.mjs$/.test(n) && n !== 'regen-goldens.mjs')
      .sort()
      .map((n) => 'tools/' + n);
  } catch {
    return null;
  }
}

/* Every fixture record's declared inputs, keyed by fixture name. An older golden declares none in its
   recipe (only a `newRecord` carries them there) and the ledger is where that evidence lives. */
function ledgerInputsByFixture() {
  const out = {};
  let names = [];
  try {
    names = readdirSync(join(ROOT, 'provenance')).filter((n) => n.endsWith('.json'));
  } catch {
    return out;
  }
  for (const n of names) {
    let j = null;
    try {
      j = JSON.parse(readFileSync(join(ROOT, 'provenance', n), 'utf8'));
    } catch {
      continue; // an unparseable fragment contributes no evidence; the tracking rail then holds the fixture
    }
    const fx = (j && j.fixtures) || null;
    if (!fx || typeof fx !== 'object') continue;
    for (const [k, v] of Object.entries(fx)) {
      if (v && Array.isArray(v.inputs) && v.inputs.length) out[k] = (out[k] || []).concat(v.inputs);
    }
  }
  return out;
}

/* The held set, kept so `main()` can name the reason when it stops on one. Written by `askRegenGoldens`
   and read nowhere else; `--classify` answers from the set itself. */
let _heldGoldens = [];
export function heldGoldens() {
  return _heldGoldens.slice();
}

/* WHAT SHIPS HERE, from one `git ls-files` listing. A `src:<path>` input is a repo-relative SOURCE
   file that builds the input in code (a recipe's `builtFrom`), and it must be listed at exactly that
   path. Any other input is an `uploads/` basename, the rule every older declaration uses. Pure and
   exported so the suite drives it by value. Returns null on an unreadable listing. */
export function trackedOracle(lsFilesText) {
  if (typeof lsFilesText !== 'string') return null;
  const paths = new Set(
    lsFilesText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  );
  const uploads = new Set();
  for (const p of paths) if (p.startsWith('uploads/')) uploads.add(p.slice(p.lastIndexOf('/') + 1));
  return (n) => (typeof n === 'string' && n.startsWith('src:') ? paths.has(n.slice(4)) : uploads.has(n));
}

function askRegenGoldens() {
  const files = regenRecipeFiles();
  if (!files || !files.length) return null; // FAIL CLOSED — the recipes could not be listed
  let tracked = null;
  try {
    tracked = trackedOracle(execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  } catch {
    return null; // no answer about what ships here ⇒ no classification
  }
  if (!tracked) return null;
  const led = ledgerInputsByFixture();
  const generated = [];
  const held = [];
  for (const f of files) {
    let out = '';
    try {
      out = execFileSync(process.execPath, [join(ROOT, f), '--list-owned'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null; // a recipe that cannot be asked is not an empty recipe
    }
    const rows = parseOwnedListing(out);
    if (!rows) return null;
    const d = classifyOwnedFixtures(rows, tracked, led);
    if (!d) return null;
    d.generated.forEach((p) => generated.push({ path: p, recipe: f }));
    d.held.forEach((h) => held.push({ ...h, recipe: f }));
  }
  _heldGoldens = held;
  return { generated, held };
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

/* 🔴 THE REMEDY THIS TOOL PRINTS HAS TO BE RUNNABLE FROM A SESSION, AND IT WAS NOT.
   `main()` stops on a held golden and says "resolve by taking <onto>'s copy, then re-run that
   recipe". Every spelling of that — `git checkout <onto> -- <paths>`, `--ours`, `git checkout HEAD~1
   -- <one golden>` outside any rebase — is denied by `.claude/hooks/guard-shared-tree.sh`, which is
   RIGHT: its rule keys on the command shape, it cannot know what a path is, and widening it would
   wave through the silent revert it exists to refuse. The hook's own hatch cannot reach it either,
   because a hook reads the Claude Code process environment and not the environment of the Bash call
   it judges. So the sanctioned spelling belongs HERE, in the tool that asks the builders which paths
   they own. Row 2026-10-29-the-remedy-rebase-safe-prints-is-denied-by-the-hook-in-every-spelling.

   PURE, and driven by value from the suite: it decides, it writes nothing. The CLI applies the plan.
   It takes a path only on an AFFIRMATIVE answer — a builder owns it, or it is a HELD golden whose
   regenerator is named — and refuses everything else, so an unreadable builder set (`gen` null,
   every verdict `source`) resolves nothing rather than reverting the tree. */
export function resolvePlan(paths, gen, held, recipeFor) {
  const recipe = typeof recipeFor === 'function' ? recipeFor : () => null;
  const heldBy = new Map();
  for (const h of Array.isArray(held) ? held : []) {
    if (h && typeof h.path === 'string' && h.path) heldBy.set(h.path, h);
  }
  const take = [];
  const refuse = [];
  const seen = new Set();
  for (const raw of Array.isArray(paths) ? paths : []) {
    if (typeof raw !== 'string' || !raw.trim()) {
      refuse.push({ path: String(raw), reason: 'not a path' });
      continue;
    }
    const path = raw.trim();
    if (seen.has(path)) continue; // naming a path twice is not two resolutions
    seen.add(path);
    const h = heldBy.get(path);
    if (h) {
      take.push({ path, verdict: 'held', recipe: h.recipe || null, why: h.why || null });
      continue;
    }
    if (classify(path, gen) === 'generated') {
      take.push({ path, verdict: 'generated', recipe: recipe(path), why: null });
      continue;
    }
    /* `tests/dex-tests.js` gets its own refusal, because the generic one is wrong about it in a way
       that costs a test group: the ref's copy IS the right starting point there, and the step that
       matters is re-running your own insertion on top. CLAUDE.md §2c states it; a refusal that only
       said "source" would read as "do not touch it". */
    refuse.push({
      path,
      reason:
        path === 'tests/dex-tests.js'
          ? "source — restore the ref's copy by hand and RE-RUN your insertion, never keep one side wholesale"
          : 'source — no builder owns it, so neither side of the conflict is reproducible; resolve it by hand'
    });
  }
  return { take, refuse };
}

function rebuild(regenFixtures) {
  const steps = [
    ['tools/build.mjs', ['--all']],
    ['tools/build-analysis.mjs', []],
    ['tools/build-docs.mjs', []],
    /* `docs/TOOLS-INDEX.md` is in the generated set, so a conflict there is auto-resolved — and an
       auto-resolve is only safe because this step puts the right bytes back. It reads `tools/**`,
       writes one file and costs ~35 ms, so it runs on every rebase rather than only on a conflict. */
    ['tools/tools-index.mjs', []]
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
  regenAutoResolved(regenFixtures);
}

/* ── THE REGEN STEP, AND WHY IT RUNS ONLY FOR WHAT CONFLICTED ──────────────────────────────────────
   A committed-input golden is in the generated set, so a conflict there is auto-resolved — and an
   auto-resolve is only safe because something puts the right bytes back. The four steps above do not:
   `build.mjs` re-stamps `manifestHash` and never an `outputHash`, so the fixture would keep `onto`'s
   payload and the rebase would report ✓ over a reverted regeneration.

   The node's own regenerator is the authority, and it is the EXPENSIVE step here — it re-runs the real
   modules over each input — so it runs for the recipes that actually conflicted and for no others. A
   rebase with no fixture conflict pays nothing.

   AND IT CHECKS THAT THE RESTORE HAPPENED. The regenerator reports an item it could not reach and
   exits 0, so the exit code alone would read "restored" over a fixture it skipped. `unrestoredFrom`
   reads the report; anything unrestored stops the tool with the path named. */
function regenAutoResolved(fixtures) {
  const list = (Array.isArray(fixtures) ? fixtures : []).filter((p) => typeof p === 'string' && p);
  if (!list.length) return;
  const byRecipe = new Map();
  for (const p of list) {
    const r = recipeForFixture(p);
    if (!r) {
      console.error(paint('\n✕ no regenerator owns ' + p + ' — it should not have been auto-resolved.', C.red));
      process.exit(1);
    }
    byRecipe.set(r, (byRecipe.get(r) || []).concat(p));
  }
  for (const [recipe, names] of byRecipe) {
    process.stdout.write('  ▸ ' + recipe + ' (' + names.length + ' auto-resolved fixture(s)) … ');
    let out = '';
    try {
      out = String(execFileSync(process.execPath, [join(ROOT, recipe)], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || '');
    } catch (e) {
      console.log(paint('FAILED', C.red));
      console.error(String((e && (e.stdout || e.message)) || ''));
      process.exit(1);
    }
    const bad = unrestoredFrom(out, names);
    if (bad === null || bad.length) {
      console.log(paint('NOT RESTORED', C.red));
      (bad || names).forEach((p) => console.error('    ' + p));
      console.error(paint('\n  The regenerator did not rewrite the fixture(s) above, so they still carry', C.yel));
      console.error(paint('  the base branch’s bytes and your regeneration is gone from the tree.', C.yel));
      console.error('  Point DEX_UPLOADS at the corpus and re-run ' + recipe + ' by hand, then amend.');
      process.exit(1);
    }
    console.log(paint('regenerated', C.grn));
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

/* THE SECOND KIND OF EVIDENCE A REBASE DESTROYS — and the one that costs a CI round-trip rather than a
   corpus run. `pr-compliance` check 8 holds a body's quoted `tepna.verdict/1` to the code that merges:
   the object's `producedBy.commit` must be in the PR's history. A rebase rewrites every commit on the
   branch, so it drops that one UNCONDITIONALLY. The body lives on GitHub, where nothing else in this
   tool looks, so the branch comes back green here and reds in CI minutes later.

   MEASURED 2026-10-20 on two branches off one base, each carrying one non-Markdown file commit: the
   rebased leg reds with "is not in this PR's history", the merged leg raises nothing. #3506 paid three
   4-minute re-runs of one mutation sweep in one evening, and all three reported the same 27 mutants
   and the same 7 survivors at the same 5 lines — the re-runs bought nothing, because the code they
   examined had not moved.

   SILENT WITHOUT EVIDENCE, AND NEVER FAILING. No `gh`, no network, no PR, or a body quoting no
   verdict all yield a `null` snapshot, and a null snapshot is not an all-clear — the report refuses to
   run on one rather than printing a clean line it cannot support. The three-way split is
   `classifyStamps`, reused rather than re-derived: before-and-after booleans over a keyed map is the
   same decision, and a verdict already foreign BEFORE the rebase must not be blamed on it. */
export function quotedVerdictKeys(body) {
  const vs = extractVerdicts(String(body || '')).filter((v) => v.commit && /^[0-9a-f]{7,40}$/i.test(v.commit));
  /* `null`, not `[]`: "this body quotes nothing to judge" is not "nothing is wrong here", and the
     reporter distinguishes them. A verdict naming no commit, or a sha check 8 would call
     `unresolved` on its own terms, is dropped here — this guard speaks only where it can be right. */
  if (!vs.length) return null;
  return vs.map((v) => ({ key: (v.gate || 'a verdict') + ' at ' + v.commit, commit: v.commit }));
}

function reachableFromHead(sha) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false; /* absent from the clone, or on no path to HEAD — check 8 reds either way */
  }
}

function quotedVerdictStates() {
  let body = null;
  try {
    /* stderr ignored on purpose: with no PR for this branch `gh` writes a multi-line error, and a
       guard that is silent by design must not leak the probe it used to decide it had nothing to say. */
    body = execFileSync('gh', ['pr', 'view', '--json', 'body', '--jq', '.body'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
  const ks = quotedVerdictKeys(body);
  if (!ks) return null;
  const st = {};
  for (const k of ks) st[k.key] = reachableFromHead(k.commit);
  return st;
}

function reportVerdictDamage(before) {
  if (!before || !Object.keys(before).length) return;
  const after = quotedVerdictStates();
  if (!after) return; // the body stopped being readable ⇒ no claim in either direction
  const { staled, pre } = classifyStamps(before, after);
  if (staled.length) {
    console.log(paint('\n⚠ THIS REBASE DROPPED THE COMMIT ' + staled.length + ' QUOTED tepna.verdict/1 OBJECT(S) NAME — pr-compliance check 8 will red the body:', C.red));
    staled.forEach((k) => console.log('    ' + k));
    console.log('  Re-run the deciding tool on the NEW head, put the new object in the PR body, and push');
    console.log('  an empty commit — a body edit alone does not re-run the gate, which reads the trigger payload.');
    console.log('  (A `git merge origin/main` keeps a quote fresh: the commit stays an ancestor, and the');
    console.log('   briefs/RESIDUE.md conflict that forces most of these rebases is Markdown, which check 8 excludes.)');
  }
  if (pre.length && !staled.length) {
    console.log(paint('\n· ' + pre.length + ' quoted verdict(s) were already outside this history before the rebase — not damage from it.', C.yel));
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
 * ⚠️ THE ROW SHAPE IS `residue-ids.mjs`'s, NOT A SECOND COPY OF IT. `parseRows` is imported rather
 * than reimplemented, because a row-shape disagreement between the checker and the rebaser would be
 * this very bug one level up: two tools quietly differing on what counts as a row, with neither able
 * to see the other's blind spot. It keys on DATED slugs (`YYYY-MM-DD-slug`), the documented residue
 * key shape. A looser "first table cell" pattern also matches the file's OWN row-contract table —
 * `| key |`, `| logged |`, `| state |` — and those legitimately recur, so an earlier draft of this
 * reported a duplicate on a CLEAN `origin/main`.
 * That was caught by running the detector against clean main as a NEGATIVE CONTROL before shipping it:
 * a check that fires on a healthy tree blocks every rebase and gets disabled, which is worse than not
 * having it. The positive control is the real union-merged tree measured 2026-09-15, where it finds
 * exactly the two keys that were duplicated and nothing else.
 */
export function duplicateLedgerKeys(text) {
  const seen = new Map();
  for (const r of parseLedgerRows(text)) seen.set(r.id, (seen.get(r.id) || 0) + 1);
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
  /* FIRST, before any argument is read or any builder list is loaded: the two-checkout refusal above.
     It sits here rather than at module scope so an `import` of this file runs no checks of its own,
     and it stays ahead of `--classify` because that path reads the script's checkout as well. */
  refuseForeignCheckout();
  const argv = process.argv.slice(2);
  const gen = generatedSet();

  /* THE REFUSAL COMES FIRST, BECAUSE `--classify` HAS A CALLER NOW. `classify()` fails closed by
     answering `source`, which is right for this tool's own rebase and WRONG as an answer to another
     program: `wt-done --landed` asks which paths are generated so it can leave them out of the diff it
     reads, and "everything is source" is exactly the reading that made its hatch unreachable (row
     2026-10-29-the-landed-hatch-reads-a-rebundled-diff-into-a-one-megabyte-buffer). An unreadable
     builder list is an absent answer, so it exits 2 here rather than printing 180 wrong ones. */
  if (!gen) {
    console.error(paint('✕ cannot read the builders’ owned sets — refusing to classify anything as generated.', C.red));
    console.error('  This tool fails CLOSED on purpose: guessing here reverts work. Rebase by hand.');
    process.exit(2);
  }
  if (argv[0] === '--classify') {
    for (const p of argv.slice(1)) console.log(classify(p, gen) + '\t' + p);
    return;
  }

  /* `--resolve <p…>` — the sanctioned spelling of the remedy the SOURCE-CONFLICT message prints, and
     the only one a session can run (see resolvePlan's header). It is deliberately NOT a rebase: it
     writes the ref's bytes for the paths you name, stages them, and names the recipe that re-earns
     each one. Nothing else moves, so the operator still decides what happens next. */
  if (argv[0] === '--resolve') {
    const rest = argv.slice(1);
    const wanted = [];
    let ref = 'origin/main';
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--onto') {
        ref = rest[i + 1] || ref;
        i++;
        continue;
      }
      if (rest[i].startsWith('--')) continue;
      wanted.push(rest[i]);
    }
    if (!wanted.length) {
      console.error(paint('✕ --resolve needs at least one path.', C.red));
      console.error('  node tools/rebase-safe.mjs --resolve <path…> [--onto <ref>]   # default ref: origin/main');
      process.exit(2);
    }
    /* NO FETCH HERE, and that is deliberate. A rebase in progress is already anchored to the upstream
       commit it started from; fetching could move `origin/main` past it, and then "the ref's copy"
       would be bytes from a commit the rebase never saw. The ref is read exactly as this checkout
       holds it. */
    const resolved = gitQuiet('rev-parse', '--verify', '--quiet', ref + '^{commit}');
    if (!resolved.ok) {
      console.error(paint('✕ cannot resolve ' + ref + ' in this checkout — refusing to guess which bytes you meant.', C.red));
      process.exit(2);
    }
    const plan = resolvePlan(wanted, gen, heldGoldens(), recipeForFixture);
    /* VALIDATE EVERY PATH BEFORE WRITING ANY, because a half-applied resolve is a worse state than a
       refusal: the operator cannot tell by looking which paths still hold their own bytes. */
    if (plan.refuse.length) {
      console.error(paint('✕ refusing — these paths are not the builders’ to restore:', C.red));
      plan.refuse.forEach((r) => console.error('    ' + r.path + '\n      ' + r.reason));
      console.error('\n  Nothing was written. Re-run naming only the paths a builder or a regenerator owns.');
      console.error('  node tools/rebase-safe.mjs --classify <path…>   # the verdict, per path');
      process.exit(1);
    }
    console.log(paint('▸ taking ' + ref + "'s bytes for " + plan.take.length + ' path(s):', C.bold));
    for (const t of plan.take) {
      const co = gitQuiet('checkout', ref, '--', t.path);
      if (!co.ok) {
        console.error(paint('✕ git checkout failed for ' + t.path + ' — stopping with ' + plan.take.indexOf(t) + ' path(s) already written.', C.red));
        process.exit(2);
      }
      gitQuiet('add', '--', t.path);
      console.log('    ' + t.path + '  [' + t.verdict + ']');
      if (t.why) console.log('      ' + t.why);
      if (t.recipe) console.log('      authority: ' + t.recipe);
    }
    const recipes = plan.take.map((t) => t.recipe).filter(Boolean);
    const held = plan.take.filter((t) => t.verdict === 'held');
    console.log(paint('\n  The bytes are the ref’s, so they are NOT yet a rebuild of your branch. Next:', C.yel));
    if (recipes.length) {
      [...new Set(recipes)].forEach((r) => console.log('    ' + r));
      if (held.length) console.log('    …with DEX_UPLOADS pointed at the corpus (docs/CORPUS-LOCATIONS.md)');
    }
    console.log('    node tools/build.mjs --all       # every other generated tree');
    console.log('    npm run check                    # the full gate on the final state');
    /* `--git-path` answers RELATIVE to the repository, and `existsSync` resolves a relative path
       against the process cwd — which for this tool is never guaranteed to be ROOT. Join it. */
    const gitPath = (n) => {
      const r = git('rev-parse', '--git-path', n);
      return r.startsWith('/') ? r : join(ROOT, r);
    };
    if (existsSync(gitPath('rebase-merge')) || existsSync(gitPath('rebase-apply'))) {
      console.log(paint('  A rebase is in progress: `git rebase --continue` first, then the lines above.', C.yel));
    }
    return;
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

  /* Same before/after shape as the stamps, and for the same reason: a verdict this branch quoted at a
     commit that was ALREADY outside its history is not damage this rebase did. */
  const verdictsBefore = quotedVerdictStates();

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

  /* The regen-owned fixtures this rebase auto-resolves, carried to the rebuild so the node's own
     regenerator puts their bytes back. Empty on a clean rebase, which costs nothing. */
  let autoResolvedFixtures = [];
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
      /* A regen-owned fixture that is HELD stops the rebase, and the reason is the whole value of
         stopping: "resolve it by hand" is unactionable, "its input is gitignored, point DEX_UPLOADS at
         the corpus and re-run this recipe" is one command. */
      const heldHit = heldGoldens().filter((h) => source.includes(h.path));
      if (heldHit.length) {
        console.error(paint('\n  Of those, these are GOLDENS a regenerator owns — held because the rebuild cannot restore them here:', C.yel));
        heldHit.forEach((h) => console.error('    ' + h.path + '\n      ' + h.why + '\n      authority: ' + h.recipe));
        console.error('  Resolve by taking ' + onto + "'s copy, then re-run that recipe with DEX_UPLOADS pointed at the corpus.");
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
    autoResolvedFixtures = generated.filter((p) => recipeForFixture(p));
    gitQuiet('add', ...generated);
    const cont = execFileSync('git', ['-c', 'core.editor=true', 'rebase', '--continue'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    void cont;
  }
  console.log(paint('  rebase complete', C.grn));

  checkUnionPaths(onto);

  if (doBuild) {
    console.log(paint('▸ rebuilding every generated tree from source', C.bold));
    rebuild(autoResolvedFixtures);
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
  reportVerdictDamage(verdictsBefore);

  console.log(paint('\n✓ rebase-safe done. VERIFY YOUR OWN CHANGES SURVIVED before pushing, e.g.', C.bold));
  console.log('    git show HEAD:<file> | grep -c <an identifier your change adds>');
}

if (isCliEntry(import.meta.url))
  main().catch((e) => {
    console.error(String((e && e.stack) || e));
    process.exit(2);
  });
