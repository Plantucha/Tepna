/*
 * tests/docs-ledger-fs.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * DOCS-LEDGER-GATE-FOLLOWUPS §F2 — the shared repo-path walker behind the docs-ledger gate's whole-tree
 * link-integrity inventory (check4b). Imported by tests/run-tests.mjs (readDocsLedger) to recompute
 * fsPaths from disk; check4b resolves every relative DOCS-INDEX + root-doc link against it. Since
 * CPAP-REAL-CORPUS-FOLLOWUPS-II §4 there is no committed list mirror — the gate is Node-lane only and
 * reads the tree straight from fs. Deterministic: sorted, forward-slash relative paths, no timestamps,
 * no absolute paths.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* Dirs a DOCS-INDEX link never targets — dependencies, transient agent/diagnostic output, and raw
   data fixtures. Excluded from BOTH the emitted inventory AND the fs reality check, so their churn
   never reds the gate (this is the deliberate, documented answer to the brief's "weigh the added
   staleness surface" — narrow to the LINKABLE tree, visibly, not a silent no-op). Everything a docs
   dashboard actually links (docs/ audits/ wiring/ papers/ briefs/ licensing/ + root) stays IN. */
export const EXCLUDE_DIRS = new Set(['node_modules', 'screenshots', 'scraps', '_diag', 'uploads', 'screens', 'derive-bundle', 'Ecg nightly', 'ppg-nights']);

/* Dot-entries (.git, .github, .gitignore, .thumbnail, …) are never a DOCS-INDEX link target and add
   only noise + churn; skipping them keeps the walk deterministic and the inventory focused.

   🔴 CORRECT FOR check4b'S QUESTION, WRONG FOR check8d'S — ONE INVENTORY WAS ANSWERING TWO.
   check4b asks *"is this a link target?"*, where a dot-entry never is. check8d — the residue
   ledger's source cell — asks *"does this repo path EXIST?"*, and there `.claude/hooks/*` and
   `.github/workflows/*` are tracked, real, and exactly where this suite's guards and CI gates live,
   so every one of them was uncitable. Measured 2026-09-10: a row sourced to
   `.claude/hooks/guard-stale-brief.sh` reds check8d with "no such path in the tree" for a file that
   is committed and present, which sends the author to fabricate a plausible source cell — the one
   edit CLAUDE.md §📌 names as making a real defect disappear.

   The two callers now get TWO WALKS rather than one widened set: widening this one would re-admit
   dot-noise into the link inventory that deliberately excludes it, trading check8d's blindness for
   check4b's churn. */
const isExcluded = (name) => name.charAt(0) === '.' || EXCLUDE_DIRS.has(name);

/* `.git` stays out of BOTH walks, always. It is enormous, it churns on every git command, and
   `isNestedRepo` reads it as the marker that a directory belongs to somebody else's checkout — so
   admitting it would be slow, non-deterministic, AND would break the nested-repo skip that keeps
   another session's worktree from resolving this tree's paths. */
const isExcludedAll = (name) => name === '.git' || EXCLUDE_DIRS.has(name);

/* A NESTED REPOSITORY OR WORKTREE IS NOT PART OF THIS TREE. `git worktree add ../wt-x` is the house
   rule (CLAUDE.md §👥.1), and sessions routinely place one INSIDE the checkout — `Tepna/wt-odigate`,
   `Tepna/wt-verity-offline`. Such a directory carries a `.git` entry, which `isExcluded` skips as a
   dot-entry, so the marker was invisible while the directory's whole contents were walked as if they
   were this repo's own source.

   Two live consequences, both observed 2026-08-04 on the shared checkout:
     · the A2 SPDX gate reported 10 missing headers, every one inside another session's worktree at an
       older commit — a RED that CI could never reproduce, because CI clones clean;
     · the docs-ledger link inventory (check4b) would resolve a DOCS-INDEX link against a file that
       exists ONLY in someone else's worktree, so a genuinely dead link could read green.
   The first is noisy, the second is a gate lying in the direction that matters.

   Detected by the `.git` entry rather than by a name pattern (`wt-*`): the marker is what git itself
   uses, it is present for both nested clones (dir) and linked worktrees (file), and a name convention
   would miss any worktree someone names differently. */
const isNestedRepo = (dirPath) => existsSync(join(dirPath, '.git'));

/* Every non-excluded file AND directory under `root`, as forward-slash relative path strings.
   Directories are included so a directory-targeted link (`](wiring)`) resolves too. Returns a sorted
   array of path STRINGS only — file vs directory is irrelevant to a link-resolution set. */
export function walkRepoPaths(root, opts) {
  const skip = opts && opts.includeDotEntries ? isExcludedAll : isExcluded;
  const out = [];
  (function rec(dir, prefix) {
    let ents;
    try {
      ents = readdirSync(dir);
    } catch (e) {
      return;
    }
    for (const name of ents) {
      if (skip(name)) continue;
      const rel = prefix ? prefix + '/' + name : name;
      const abs = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(abs).isDirectory();
      } catch (e) {
        /* unreadable → treat as leaf */
      }
      // A nested repo/worktree is skipped ENTIRELY — not merely un-recursed — so its own directory
      // name cannot resolve a link either.
      if (isDir && isNestedRepo(abs)) continue;
      out.push(rel);
      if (isDir) rec(abs, rel);
    }
  })(root, '');
  return out.sort();
}

/* The EXISTENCE inventory — the same walk with dot-entries admitted, for callers asking "does this
   repo path exist?" rather than "is this a link target?". `.git`, the dependency/data dirs and
   nested repos stay excluded exactly as above; the only difference is that `.claude/`, `.github/`
   and friends are walked. Used by check8d (residue source cells); check4b keeps `walkRepoPaths`. */
export function walkRepoPathsAll(root) {
  return walkRepoPaths(root, { includeDotEntries: true });
}
