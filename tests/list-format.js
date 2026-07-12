#!/usr/bin/env node
/*
 * list-format.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 */
/* ════════════════════════════════════════════════════════════════════════
   tests/list-format.js — the UNION-MERGEABLE list format (D2)
   ────────────────────────────────────────────────────────────────────────
   The browser lanes of the docs-ledger and release-ledger gates cannot list a
   directory over fetch, so the brief / path / changeset NAMES are committed.
   Those two committed files used to be JSON — and they were a merge-conflict
   engine:

     · 62 of 139 commits (45%) touched them, and TEN merge commits in 48 h
       existed purely to re-resolve them;
     · the conflict was STRUCTURAL, not behavioural — each carried scalar
       `count` and `generated: <date>` fields that change on BOTH sides of any
       concurrent add, so the hunks conflicted even when the arrays were
       disjoint;
     · and a conflicted PR is not merely annoying: GitHub builds `pull_request`
       runs against the MERGE commit, so when the merge cannot be created it
       dispatches NOTHING. The PR sits with zero checks and no error anywhere.
       That failure is silent, and it cost two real sessions a debug cycle.

   So the format is now line-oriented text with NO volatile scalars, and
   `.gitattributes` marks both files `merge=union`. Two disjoint additions now
   merge automatically instead of conflicting.

   Union merge is allowed to produce DUPLICATE and UNSORTED lines — and, if a
   line was deleted on one side, to resurrect it. Both are handled:
     · readers sort + dedupe (parseList), so duplicates and order are harmless;
     · a resurrected (stale) entry is caught by the existing Node-lane
       `list == fs` staleness assertion, which reds and tells you to regenerate.
   That is the deliberate trade: a bad union degrades to a RED you can fix with
   one command, instead of a silent no-CI PR.
   ════════════════════════════════════════════════════════════════════════ */

/** Serialize `{ kind: [names] }` to sorted, prefixed, comment-headed text. */
function formatList(header, sections) {
  const lines = [];
  for (const line of String(header).trim().split('\n')) lines.push('# ' + line.trim());
  lines.push('#');
  lines.push('# Line-oriented + `merge=union` (see tests/list-format.js): NO count, NO generated-date —');
  lines.push('# a volatile scalar would conflict on every concurrent add. Regenerate, never hand-edit.');
  for (const kind of Object.keys(sections).sort()) {
    for (const name of [...sections[kind]].sort()) lines.push(kind + ' ' + name);
  }
  return lines.join('\n') + '\n';
}

/**
 * Parse the text back to `{ kind: [names] }` — sorted + deduped, so a union merge's
 * duplicate/unordered output is absorbed rather than believed.
 */
function parseList(text) {
  const out = {};
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.charAt(0) === '#') continue;
    const sp = line.indexOf(' ');
    if (sp < 1) continue;
    const kind = line.slice(0, sp),
      name = line.slice(sp + 1).trim();
    if (!name) continue;
    if (!out[kind]) out[kind] = [];
    out[kind].push(name);
  }
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])].sort();
  return out;
}

/* Dual export — the manifest-gate.js precedent: ONE source, loaded by BOTH lanes (the Node runners via
   createRequire, and Dex-Test-Suite.html via <script src>), so the two can never drift on how a union
   merge's duplicate/unsorted output is absorbed. */
if (typeof globalThis !== 'undefined') globalThis.DexListFormat = { formatList: formatList, parseList: parseList };
if (typeof module !== 'undefined' && module.exports) module.exports = { formatList: formatList, parseList: parseList };
