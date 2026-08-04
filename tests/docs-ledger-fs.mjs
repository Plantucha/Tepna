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
   only noise + churn; skipping them keeps the walk deterministic and the inventory focused. */
const isExcluded = (name) => name.charAt(0) === '.' || EXCLUDE_DIRS.has(name);

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
export function walkRepoPaths(root) {
  const out = [];
  (function rec(dir, prefix) {
    let ents;
    try {
      ents = readdirSync(dir);
    } catch (e) {
      return;
    }
    for (const name of ents) {
      if (isExcluded(name)) continue;
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
