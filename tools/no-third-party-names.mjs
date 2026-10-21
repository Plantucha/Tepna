// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/* ════════════════════════════════════════════════════════════════════════
   tools/no-third-party-names.mjs — the name gate

       node tools/no-third-party-names.mjs          # gate (exit 1 on a hit)
       node tools/no-third-party-names.mjs --json    # the verdict alone

   Owner ruling 2026-10-10: do not use other projects' names in our titles,
   bodies, changesets, briefs, code comments or docs. Name the BEHAVIOUR or the
   MEASUREMENT; a licence attribution stays only where code was taken under a
   licence that requires one, and nothing here was.

   ⚠️ TWO THINGS THIS GATE MUST NOT DO, both learned the hard way.

   1 · IT MUST NOT CARRY THE NAMES IT FORBIDS. A gate holding the literal is a
       hit on itself, and a selftest needle sitting in the same file self-matches
       (measured 2026-10-10 on the crawl's wiring assertions). The needles are
       therefore base64 and are decoded at run time; `git grep <the name>` finds
       nothing here, which is the point. For the same reason NO MATCHED TEXT is
       ever printed: a failure names the FILE and LINE and a count, never the
       word, so the gate's own output cannot reintroduce what it forbids.

   2 · IT MUST MATCH THE FULL NAME ON A WORD BOUNDARY, NEVER A STEM. The sweep
       that produced this gate began from `grep -ci somno` = 73 files, of which
       40 were `polysomnography` — the field's standard term for a sleep study,
       in two user-facing reference guides, a published paper, and the download
       paths of a public dataset (`shhs/polysomnography/edfs/...`, where editing
       the string breaks the fetch). A stem gate reds on all of them and can only
       be satisfied by corrupting the vocabulary. The real population was 33
       files / 53 occurrences. Word boundaries are load-bearing here.
   ════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isCliEntry } from './argv-guard.mjs';

const Verdict = createRequire(import.meta.url)('../verdict.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** base64 so the literals never appear here. Decoded only in memory. */
const ENCODED = ['U29tbm9UcmFjZQ==', 'U29tbm9TdGFnZQ==', 'aWx5YWtydWNoaW5pbg=='];

export function needles(encoded = ENCODED) {
  return encoded.map((b) => Buffer.from(b, 'base64').toString('utf8'));
}

/** Word-boundary, case-insensitive. NEVER a stem — see the header. */
export function patternFor(list = needles()) {
  return new RegExp('\\b(?:' + list.join('|') + ')\\b', 'i');
}

/** THE RATCHET IS ZERO and stays zero; there is no grandfathered set. */
export const ALLOWED_HITS = 0;

/** Files git tracks, minus this gate itself (which holds only base64 anyway). */
export function trackedFiles(root = ROOT) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter((f) => f && f !== 'tools/no-third-party-names.mjs');
}

/** Returns [{ file, line }] — never the matched text. */
export function scan(files, root = ROOT, re = patternFor()) {
  const hits = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(join(root, f), 'utf8');
    } catch {
      continue; // unreadable or binary: nothing to assert about it
    }
    if (!re.test(text)) continue; // cheap reject before splitting a large file
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) hits.push({ file: f, line: i + 1 });
  }
  return hits;
}

function main() {
  const files = trackedFiles();
  const hits = scan(files);
  const ok = hits.length <= ALLOWED_HITS;
  const v = Verdict.make({
    gate: 'no-third-party-names',
    status: ok ? 'PASS' : 'FAIL',
    population: { checked: files.length, eligible: files.length, excluded: 0 },
    criterion: { name: 'third_party_name_hits', threshold: ALLOWED_HITS, unit: 'lines', direction: 'lte' },
    result: { hits: hits.length, files: new Set(hits.map((h) => h.file)).size },
    evidence: ['tools/no-third-party-names.mjs'],
    /* The reason names the COUNT and the places, never the word. */
    reason: ok ? null : hits.length + ' line(s) in ' + new Set(hits.map((h) => h.file)).size + ' file(s) carry a forbidden third-party project name — name the behaviour or the measurement instead',
    producedBy: { tool: 'tools/no-third-party-names.mjs', commit: gitCommit() }
  });
  /* `--json` is the documented "verdict alone": without it stdout carries the object AND the check
     line, which reads well and does not parse. Nothing read the flag until 2026-10-21. */
  const JSON_ONLY = process.argv.includes('--json');
  console.log(JSON.stringify(v));
  if (!ok) {
    console.error(v.reason);
    for (const h of hits.slice(0, 40)) console.error('   · ' + h.file + ':' + h.line);
    if (hits.length > 40) console.error('   … and ' + (hits.length - 40) + ' more');
  } else {
    if (!JSON_ONLY) console.log('\u2713 no forbidden third-party project name in ' + files.length + ' tracked files');
  }
  process.exit(ok ? 0 : 1);
}

function gitCommit(root = ROOT) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

if (process.argv.includes('--verdict-sample')) {
  /* The SHAPE, examining nothing. §∅ applies to a verdict's own fields: `checked: 0` must carry
     `result: null`, because a sample that scanned no files has measured no hits — not zero hits.
     (The adoption gate refused exactly this confusion in another tool on 2026-10-10.) */
  const v = Verdict.make({
    gate: 'no-third-party-names',
    status: 'NOT_RUN',
    population: { checked: 0, eligible: 0, excluded: 0 },
    criterion: { name: 'third_party_name_hits', threshold: ALLOWED_HITS, unit: 'lines', direction: 'lte' },
    result: null,
    evidence: ['tools/no-third-party-names.mjs'],
    reason: 'sample only — this invocation scanned no files',
    producedBy: { tool: 'tools/no-third-party-names.mjs', commit: gitCommit() }
  });
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}

if (process.argv.includes('--selftest') && isCliEntry(import.meta.url)) {
  let bad = 0,
    ran = 0;
  const ck = (n, got, want) => {
    ran++;
    const okk = JSON.stringify(got) === JSON.stringify(want);
    if (!okk) {
      bad++;
      console.log('  \u2715 ' + n + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
    } else console.log('  \u2713 ' + n);
  };
  const re = patternFor();
  /* The needles are rebuilt by DECODING, so these cases never hold the literal either. */
  const [A] = needles();
  ck('the decoded needle is matched', re.test('see ' + A + ' for the shape'), true);
  ck('…case-insensitively', re.test(A.toLowerCase()), true);
  /* 🔴 THE CASE THE 73-FILE MISCOUNT CAME FROM. A stem gate reds on every one of
     these; this gate must not, or it can only be satisfied by corrupting the
     clinical vocabulary and breaking a public dataset's download paths. */
  ck('polysomnography is NOT a hit', re.test('overnight polysomnography was scored'), false);
  ck('polysomnogram is NOT a hit', re.test('4 polysomnograms, 2 polysomnographic'), false);
  ck('a dataset path is NOT a hit', re.test('shhs/polysomnography/edfs/shhs1/x.edf'), false);
  ck('the bare stem alone is NOT a hit', re.test('somno'), false);
  /* Word boundaries both sides: a longer word that merely CONTAINS a needle is not it. */
  ck('the needle inside a longer token is NOT a hit', re.test('x' + A + 'ish'), false);
  ck('an empty line is not a hit', re.test(''), false);
  ck('the ratchet is zero, with no grandfathered set', ALLOWED_HITS, 0);
  /* The gate must not be able to print what it forbids. */
  const fake = [{ file: 'a.md', line: 3 }];
  ck('a hit record carries a file and a line and NOTHING ELSE', Object.keys(fake[0]).sort(), ['file', 'line']);
  ck(
    'this source does not contain the literals it forbids',
    needles().some((n) => readFileSync(fileURLToPath(import.meta.url), 'utf8').includes(n)),
    false
  );
  console.log(bad ? '  \u2717 ' + bad + ' of ' + ran + ' selftests failed' : '  all ' + ran + ' selftests passed');
  process.exit(bad ? 1 : 0);
}
if (!process.argv.includes('--selftest') && !process.argv.includes('--verdict-sample')) main();
