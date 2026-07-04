#!/usr/bin/env node
/*
 * tests/gen-docs-ledger-list.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * DOCS-LEDGER-GATE-2026-07-03 · Phase 1.
 * Regenerates tests/docs-ledger-list.json — the BROWSER lane's brief-name source for the
 * `docs-ledger` gate (fetch cannot list a directory, so the browser reads names from this
 * committed file). Run this whenever a brief is ADDED to or REMOVED from briefs/:
 *
 *     node tests/gen-docs-ledger-list.mjs
 *
 * The Node lane of the gate (run-tests.mjs readDocsLedger → the `staleness` assertion) recomputes
 * the briefs/ listing from fs and reds if this file drifts from reality — so a forgotten regen is
 * caught in CI, not discovered later. Deterministic: sorted names, no timestamps beyond the date.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const briefs = readdirSync(join(ROOT, 'briefs')).filter(f => f.endsWith('.md')).sort();
const rootBriefs = readdirSync(ROOT).filter(f => /-BRIEF\.md$/.test(f)).sort();
const out = {
  _doc: "Generated brief-name ledger for the docs-ledger gate's BROWSER lane (fetch can't list a dir). Regenerate with tests/gen-docs-ledger-list.mjs (Node) whenever a brief is added/removed; the Node lane asserts this matches fs reality, so a stale list reds in CI. DOCS-LEDGER-GATE-2026-07-03.",
  generated: new Date().toISOString().slice(0, 10),
  count: briefs.length,
  briefs,
  rootBriefs
};
writeFileSync(join(ROOT, 'tests', 'docs-ledger-list.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote tests/docs-ledger-list.json — ' + briefs.length + ' briefs, ' + rootBriefs.length + ' root *-BRIEF.md');
