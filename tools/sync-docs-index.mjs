#!/usr/bin/env node
/*
 * tools/sync-docs-index.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * FLIP A BRIEF'S STATUS, THEN RUN THIS. It carries the flip into DOCS-INDEX.md.
 *
 * `docs-ledger` check3b requires every DOCS-INDEX row's status marker to equal its brief's HEADER
 * status, and the header is the declared source of truth. The gate is right and it works — it caught
 * the same stale row three times in one day. But catching it three times is a tooling gap, not a
 * discipline problem: the fix was always mechanical (copy one word from the header into one row) and
 * doing it by hand costs a full `docs-ledger` run to discover, an edit, and a re-run to confirm.
 *
 * WHAT IT DOES NOT DO, deliberately:
 *   · it never edits a BRIEF. The header is the source of truth; a tool that could rewrite the source
 *     of truth to match its copy would be able to make any disagreement disappear in the wrong
 *     direction. Only `DOCS-INDEX.md` moves.
 *   · it never ADDS a marker to a row that has none. check3b reports those separately as `statusBlind`,
 *     and there are legitimately status-less rows; inventing a marker would silence a different check.
 *
 * SCOPE — every status marker attached to a brief LINK, not only table rows. Observed on first real use
 * (2026-08-04): `REPO-DISCOVERABILITY-2026-07-03` is referenced twice — the table row at :215 AND a
 * prose blockquote at :34 carrying its own `*(IN-PROGRESS 2026-07-04)*`. Both were stale and both were
 * synced. That is correct and is the intent: a stale marker misleads wherever it sits, and check3b's
 * `statusBlind`/decoration rules apply the same way in prose. The earlier wording here said "only the
 * index row", which described less than the tool does.
 *   · it does not touch REFERENCE or CHECKPOINT briefs — check3b only compares the three executable
 *     statuses, so neither should this.
 *
 * WHAT IT PRESERVES. Markers carry decoration and prose that a naive rewrite would eat:
 *     *(**DONE 2026-07-14**)*      *(✅ DONE 2026-07-05 …)*      (**DONE …**)
 *     *(DONE 2026-08-03 — agenda settled; live work in `X`)*
 * Only the status WORD is replaced, in place. Bold markers, a leading tick/emoji, and everything after
 * the word — including a trailing explanation — survive untouched.
 *
 * The date inside the marker is left alone too: it is prose about when the row was written, and
 * check3b compares only the status word. Rewriting dates would produce churn the gate cannot even see.
 *
 * USAGE
 *   node tools/sync-docs-index.mjs            # fix the rows, report what moved
 *   node tools/sync-docs-index.mjs --check    # report only, exit 1 if anything is stale (CI-shaped)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

/* Both regexes are LIFTED VERBATIM from `docs-ledger` check3b. If the gate's tolerance ever widens,
   this must widen with it — a fixer that understands fewer marker shapes than the gate would report
   "nothing to do" about rows the gate is failing on, which is the worst possible failure for a tool
   whose whole job is to end that mismatch. */
const STATUS_MARK = /\(\s*[^A-Za-z]{0,4}\s*\*{0,2}\s*(DONE|PROPOSED|IN-PROGRESS)\b/;
const HEADER_RE = /^\*\*Status:\*\*\s+(PROPOSED|IN-PROGRESS|DONE|REFERENCE|CHECKPOINT)\b/m;

const idxPath = join(ROOT, 'DOCS-INDEX.md');
const briefDir = join(ROOT, 'briefs');
if (!existsSync(idxPath) || !existsSync(briefDir)) {
  console.error('sync-docs-index: DOCS-INDEX.md or briefs/ not found');
  process.exit(2);
}

/* The header block is the first content line after any SPDX comment — same shape the gate reads. */
const headerStatus = (text) => {
  const m = text.match(HEADER_RE);
  return m ? m[1] : null;
};

const briefs = {};
for (const n of readdirSync(briefDir).filter((f) => f.endsWith('.md'))) {
  briefs[n] = headerStatus(readFileSync(join(briefDir, n), 'utf8'));
}

const lines = readFileSync(idxPath, 'utf8').split('\n');
const moved = [];
const blind = [];

for (const [name, hs] of Object.entries(briefs)) {
  if (hs !== 'DONE' && hs !== 'PROPOSED' && hs !== 'IN-PROGRESS') continue;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.indexOf('](briefs/' + name + ')') < 0) continue;
    // A multi-brief row shares one status cell — the gate skips it and so must this.
    if ((line.match(/\]\(briefs\//g) || []).length > 1) continue;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    const last = cells[cells.length - 1] || '';
    const m = last.match(STATUS_MARK);
    if (!m) {
      blind.push(name);
      continue;
    }
    if (m[1] === hs) continue;
    /* Replace the status word ONLY, and only inside the last cell — a brief's own title or prose
       elsewhere in the row can contain the word DONE, and rewriting that would corrupt the text. */
    const fixedCell = last.replace(STATUS_MARK, (mm) => mm.replace(m[1], hs));
    const at = line.lastIndexOf(last);
    lines[i] = line.slice(0, at) + fixedCell + line.slice(at + last.length);
    moved.push(`${name}: ${m[1]} → ${hs}`);
  }
}

if (moved.length && !CHECK) writeFileSync(idxPath, lines.join('\n'));

for (const m of moved) console.log((CHECK ? '  ✕ stale  ' : '  ✓ synced ') + m);
if (blind.length) console.log(`  ∘ ${blind.length} row(s) carry no status marker — reported by check3b as statusBlind, not invented here`);
if (!moved.length) console.log('DOCS-INDEX status rows already match every brief header.');
else if (!CHECK) console.log(`\n${moved.length} row(s) synced. Re-run \`node tests/run-tests.mjs --group=docs-ledger\` to confirm.`);

if (CHECK && moved.length) process.exit(1);
