/*
 * tests/docs-ledger-fs.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * DOCS-LEDGER-GATE-FOLLOWUPS §F2 — the ONE shared repo-path walker behind the docs-ledger gate's
 * whole-tree link-integrity inventory. Imported by BOTH:
 *   - tests/gen-docs-ledger-list.mjs  → writes the committed paths[] the BROWSER lane resolves against
 *   - tests/run-tests.mjs (readDocsLedger) → recomputes fsPaths for the list==fs staleness check
 * Single-sourced so the generator and the Node-lane reality check can NEVER drift (a divergent walk
 * would red the staleness leg forever). Deterministic: sorted, forward-slash relative paths, no
 * timestamps, no absolute paths.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* Dirs a DOCS-INDEX link never targets — dependencies, transient agent/diagnostic output, and raw
   data fixtures. Excluded from BOTH the emitted inventory AND the fs reality check, so their churn
   never reds the gate (this is the deliberate, documented answer to the brief's "weigh the added
   staleness surface" — narrow to the LINKABLE tree, visibly, not a silent no-op). Everything a docs
   dashboard actually links (docs/ audits/ wiring/ papers/ briefs/ licensing/ + root) stays IN. */
export const EXCLUDE_DIRS = new Set(['node_modules', 'screenshots', 'scraps', '_diag', 'uploads', 'screens', 'derive-bundle', 'Ecg nightly']);

/* Dot-entries (.git, .github, .gitignore, .thumbnail, …) are never a DOCS-INDEX link target and add
   only noise + churn; skipping them keeps the walk deterministic and the inventory focused. */
const isExcluded = (name) => name.charAt(0) === '.' || EXCLUDE_DIRS.has(name);

/* Every non-excluded file AND directory under `root`, as forward-slash relative path strings.
   Directories are included so a directory-targeted link (`](wiring)`) resolves too. Returns a sorted
   array. NOTE for the browser-lane mirror (tests/gen-docs-ledger-list.mjs writes this to disk): the
   inventory is path STRINGS only — file vs directory is irrelevant to a link-resolution set, so a
   consumer that can only tell "leaf vs has-children" (e.g. the sandbox regenerator) produces the
   identical string set. */
export function walkRepoPaths(root) {
  const out = [];
  (function rec(dir, prefix) {
    let ents;
    try { ents = readdirSync(dir); } catch (e) { return; }
    for (const name of ents) {
      if (isExcluded(name)) continue;
      const rel = prefix ? prefix + '/' + name : name;
      out.push(rel);
      let isDir = false;
      try { isDir = statSync(join(dir, name)).isDirectory(); } catch (e) { /* unreadable → treat as leaf */ }
      if (isDir) rec(join(dir, name), rel);
    }
  })(root, '');
  return out.sort();
}
