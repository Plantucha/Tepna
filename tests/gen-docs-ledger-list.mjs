#!/usr/bin/env node
/*
 * tests/gen-docs-ledger-list.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * DOCS-LEDGER-GATE-2026-07-03 · Phase 1.
 * Regenerates tests/docs-ledger-list.txt — the BROWSER lane's brief-name source for the
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
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { walkRepoPaths } from './docs-ledger-fs.mjs';

const { formatList } = createRequire(import.meta.url)('./list-format.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const briefs = readdirSync(join(ROOT, 'briefs'))
  .filter((f) => f.endsWith('.md'))
  .sort();
const rootBriefs = readdirSync(ROOT)
  .filter((f) => /-BRIEF\.md$/.test(f))
  .sort();
// paths[] — the whole-tree link-integrity inventory (DOCS-LEDGER-GATE-FOLLOWUPS §F2): every non-excluded
// repo file+dir, so the gate's check4b can resolve EVERY relative DOCS-INDEX link (docs/… audits/… wiring/…
// root), not just briefs/. Shared walker with the Node-lane reality check → the two can never drift.
const paths = walkRepoPaths(ROOT);
const out = formatList(
  "Generated ledger for the docs-ledger gate's BROWSER lane (fetch can't list a dir): brief names + a\n" +
    'whole-tree path inventory for link-integrity. Regenerate with tests/gen-docs-ledger-list.mjs whenever a\n' +
    'brief OR any linkable file is added/removed/renamed; the Node lane asserts BOTH lists match fs reality,\n' +
    'so a stale list reds in CI. DOCS-LEDGER-GATE-2026-07-03 (+FOLLOWUPS §F2).',
  { brief: briefs, rootBrief: rootBriefs, path: paths }
);
writeFileSync(join(ROOT, 'tests', 'docs-ledger-list.txt'), out);
console.log('wrote tests/docs-ledger-list.txt — ' + briefs.length + ' briefs, ' + rootBriefs.length + ' root *-BRIEF.md, ' + paths.length + ' repo paths');
