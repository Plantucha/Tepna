#!/usr/bin/env node
/*
 * tests/gen-changes-list.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * CONTROLLED-RELEASES-2026-07-05.
 * Regenerates tests/changes-list.json — the BROWSER lane's changeset-name source for the
 * `release-ledger` gate (fetch cannot list a directory, so the browser reads names from this
 * committed file). Run this whenever a changeset is ADDED to or PRUNED from changes/:
 *
 *     node tests/gen-changes-list.mjs
 *
 * tools/release.mjs calls this automatically after it prunes consumed changesets. The Node lane of
 * the gate (run-tests.mjs readReleaseLedger → the `staleness` assertion) recomputes the changes/
 * listing from fs and reds if this file drifts — so a forgotten regen is caught in CI. README.md and
 * any _/.-prefixed file are NOT changesets and are excluded (mirrors the gate + release.mjs filter).
 */
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(ROOT, 'changes');
const isChangeset = f => f.endsWith('.md') && f !== 'README.md' && !/^[._]/.test(f);
const changes = existsSync(dir) ? readdirSync(dir).filter(isChangeset).sort() : [];
const out = {
  _doc: "Generated changeset-name ledger for the release-ledger gate's BROWSER lane (fetch can't list a dir). Regenerate with tests/gen-changes-list.mjs (Node) whenever a changeset is added to or pruned from changes/; the Node lane asserts this matches fs reality, so a stale list reds in CI. Excludes README.md and _/.-prefixed files. CONTROLLED-RELEASES-2026-07-05.",
  generated: new Date().toISOString().slice(0, 10),
  count: changes.length,
  changes
};
writeFileSync(join(ROOT, 'tests', 'changes-list.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote tests/changes-list.json — ' + changes.length + ' pending changeset(s)');
