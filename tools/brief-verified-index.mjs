#!/usr/bin/env node
/*
 * tools/brief-verified-index.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WHEN WAS EACH OPEN BRIEF LAST *VERIFIED* — not last edited, and not how open it looks.
 *
 * WHY. Triage of the open-brief queue was being done by status label and open-item count, and both
 * mislead. Measured 2026-08-26 over three briefs picked that way: two carried real contradictions
 * and one was already correct — and the correct one was the one RE-MEASURED most recently (08-23,
 * against 08-20 and 08-16 for the two that were wrong). Staleness tracks TIME SINCE VERIFICATION.
 * A brief with nine open items that was checked yesterday is in better shape than a brief with one
 * open item nobody has looked at since June.
 *
 * ⚠️ GIT MTIME IS NOT A VERIFICATION DATE, and this is the whole reason the tool reads prose.
 * `git log -1` tells you someone EDITED the file. Editing is not checking: a session can fix a typo,
 * repoint a link, or flip a DOCS-INDEX row without re-reading a single claim. What this tool wants is
 * the date a human or session asserts they went and LOOKED. That assertion lives in the text
 * ("verified in code 2026-08-20", "RE-MEASURED 2026-08-20"), so the text is what is parsed. Both are
 * reported side by side precisely so the gap between them is visible.
 *
 * ⚠️ ABSENCE OF A DATE IS A FINDING, NOT A BLANK. A brief that never claims a verification is not
 * "unknown" — it is the never-verified tail, and it sorts FIRST. Rendering it as an empty cell would
 * be the well-formed-zero failure this repo keeps paying for, so it prints NEVER and is counted.
 *
 * ⚠️ AND A NEVER IS ONLY AS TRUSTWORTHY AS THE VERB LIST. This tool's first run reported 11 NEVERs
 * and 8 were wrong — it was blind to dated `corrected`/`executed`/`shipped`. If you widen or narrow
 * VERBS, re-measure the NEVER count against a hand-read sample before quoting it; a confident zero
 * from a narrow filter is the failure this repo pays for most often, and this tool has committed it.
 *
 * WHAT IT DOES NOT CLAIM. That a claimed date is true — a brief asserting "verified 2026-08-20" is
 * taken at its word; this ranks candidates, it does not audit them. And a `Created:` date is
 * deliberately NOT a verification: authoring a claim is not checking it.
 *
 *   node tools/brief-verified-index.mjs              # oldest-verified first
 *   node tools/brief-verified-index.mjs --top 3      # the next reconciliation batch
 *   node tools/brief-verified-index.mjs --json
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRIEFS = join(REPO, 'briefs');
const OPEN = new Set(['PROPOSED', 'IN-PROGRESS']);

/* A date is a VERIFICATION date only when a verification verb sits within ~70 chars of it, on
   either side. The window is deliberately generous (prose interleaves markup) and the verb list
   deliberately narrow — "created", "spawned", "proposed", "follows" are NOT verification. */
/* ⚠️ THIS LIST WAS TOO NARROW ON ITS FIRST RUN AND THE TOOL LIED BY 8 OF 11.
   The first cut carried only the verification verbs proper (verified/measured/audited/...) and
   reported "11 open briefs never claim a verification". Eight of those eleven carried a DATED
   `corrected` / `executed` / `shipped` / `landed` / `retired` / `withdrawn` — someone had plainly
   gone and engaged with the claim on that date. Only three were genuinely undated.
   The tool built to catch narrow filters shipped with one. What is being proxied is *when did a
   human last engage with this brief's CONTENT*, and executing or correcting an item is engagement
   at least as strong as checking it.
   Still deliberately EXCLUDED: created / spawned / proposed / follows / superseded-by — authoring
   or linking a claim is not engaging with whether it holds. */
const VERBS =
  'verified|re-?verified|re-?measured|measured|audited|re-?audited|checked|re-?checked|confirmed|re-?run|reproduced|corrected|executed|shipped|landed|retired|withdrawn|closed|resolved|refuted|ratified';
const NEAR = new RegExp(`(?:${VERBS})[^\\n]{0,70}?(\\d{4}-\\d{2}-\\d{2})|(\\d{4}-\\d{2}-\\d{2})[^\\n]{0,70}?(?:${VERBS})`, 'gi');

export function verificationDates(text) {
  const out = [];
  for (const m of text.matchAll(NEAR)) out.push(m[1] || m[2]);
  return [...new Set(out)].sort();
}

export function statusOf(text) {
  const m = text.match(/\*\*Status:\*\*\s*([A-Z-]+)/);
  return m ? m[1] : null;
}

function gitLastTouched(rel) {
  try {
    return (
      execFileSync('git', ['log', '-1', '--format=%ad', '--date=short', '--', rel], {
        cwd: REPO,
        encoding: 'utf8'
      }).trim() || null
    );
  } catch {
    return null;
  }
}

const args = process.argv.slice(2);
const top = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) : 0;
const asJson = args.includes('--json');

const rows = [];
for (const f of readdirSync(BRIEFS)
  .filter((x) => x.endsWith('.md'))
  .sort()) {
  const text = readFileSync(join(BRIEFS, f), 'utf8');
  const status = statusOf(text);
  if (!status || !OPEN.has(status)) continue;
  const dates = verificationDates(text);
  const last = dates.length ? dates[dates.length - 1] : null;
  /* Every date the brief mentions, newest first. A SUPERSET of the verb matches and it cannot be
     older, so the gap between the two columns is the tool's own uncertainty made visible. */
  const anyDates = [...text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((m) => m[1]).sort();
  const lastDated = anyDates.length ? anyDates[anyDates.length - 1] : null;
  // `Created:` is NOT a verification, but inside the never-verified tier it is what separates
  // "written yesterday, no time to check it" from "written in July and never once re-read".
  const cm = text.match(/\*\*Created:\*\*\s*\(?(\d{4}-\d{2}-\d{2})/) || f.match(/(\d{4}-\d{2}-\d{2})/);
  rows.push({
    brief: f.replace('-BRIEF.md', ''),
    status,
    lastVerified: last,
    lastDated,
    created: cm ? cm[1] : null,
    edited: gitLastTouched(join('briefs', f)),
    nDates: dates.length
  });
}

/* NEVER-verified sorts first: it is the worst case, not a missing value.
   ⚠️ Within that tier, order by CREATED — alphabetical would be arbitrary, and the tiers are not
   equivalent: a brief written three days ago that nobody has re-checked is unremarkable, while one
   written in July and never once verified is the finding. Sorting NEVER by name buries the second
   behind the first. */
rows.sort((a, b) => {
  if (!a.lastVerified && !b.lastVerified) return (a.created || '9999').localeCompare(b.created || '9999');
  if (!a.lastVerified) return -1;
  if (!b.lastVerified) return 1;
  return a.lastVerified.localeCompare(b.lastVerified);
});

const picked = top > 0 ? rows.slice(0, top) : rows;

if (asJson) {
  console.log(JSON.stringify({ open: rows.length, never: rows.filter((r) => !r.lastVerified).length, rows: picked }, null, 2));
} else {
  const never = rows.filter((r) => !r.lastVerified).length;
  console.log(`open briefs: ${rows.length}   never claiming a verification: ${never}`);
  console.log('');
  console.log('  last-verified  any-date    created     edited      status        brief');
  for (const r of picked) {
    const lv = r.lastVerified || 'NEVER     ';
    const gap = r.lastDated && r.lastVerified && r.lastDated > r.lastVerified ? '*' : ' ';
    console.log(`  ${lv.padEnd(14)} ${((r.lastDated || '?') + gap).padEnd(11)} ${(r.created || '?').padEnd(11)} ${(r.edited || '?').padEnd(11)} ${r.status.padEnd(13)} ${r.brief}`);
  }
  if (!top) {
    console.log('');
    console.log('⚠️  `edited` is git mtime — someone touched the file. It is NOT evidence anyone re-checked a');
    console.log('    claim. A recent edit beside an old (or absent) verification is the interesting row.');
    console.log('');
    console.log('⚠️  `any-date` is the newest date the brief mentions ANYWHERE; `*` marks it newer than the');
    console.log('    verb-matched one. Measured 2026-08-26: 19 of 72 open briefs carry such a gap, i.e. the');
    console.log('    verb list calls a quarter of the queue staler than it is (TCH-FUSED-ROBUST-HAT by three');
    console.log('    weeks). The two columns fail in OPPOSITE directions and neither is the truth:');
    console.log('      last-verified  under-reports freshness — sends you to briefs that are fine (wasteful)');
    console.log('      any-date       over-reports it — a cited date from another brief is not engagement,');
    console.log('                     and trusting it would HIDE a stale brief (silent, and worse)');
    console.log('    Ranking stays on last-verified because over-flagging is the survivable error. Read the');
    console.log('    `*` rows as "probably fresher than this rank" and spend the read budget elsewhere first.');
  }
}
