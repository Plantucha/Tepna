#!/usr/bin/env node
/*
 * tools/resp-acc-headless.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Drive `resp-acc-analysis.html` THROUGH ITS OWN UI, headlessly, against a real corpus.
 *
 * MOTIONDEX-RESPIRATORY-RATE §6 recorded a regeneration "driven headlessly against the tool's ENGINE"
 * and left this open: *"Exercise the browser page itself end to end. The folder-ingest / FileReader /
 * render path is still unexercised."* That gap is the one this repo keeps re-learning — an engine with
 * a known-answer test, sitting behind a page nobody has run, is a passing gate over an unexercised
 * path. `resp-acc-analysis.js` is covered in both test lanes; `resp-acc-analysis-app.js` (the ingest,
 * the grouping, the FileReader, the table render) was covered nowhere.
 *
 * It is a TOOL and not a gate, deliberately: it needs a real gitignored corpus and a browser, so CI
 * cannot run it and pretending otherwise would be the hollow-gate pattern. Per PAPERS-ROADMAP §5.2
 * ("no number without a tool that reproduces it") the point is that the run is REPEATABLE, not that it
 * is automatic.
 *
 * ⚠ The picker is `<input webkitdirectory>`, so Playwright must be handed a DIRECTORY path, not a file
 * list — `setInputFiles` with individual paths fails outright. The directory must be shaped the way
 * `groupFiles()` expects: `Polar_H10_*_YYYYMMDD_HHMMSS_ACC.txt` at the top level, and the matching
 * flow beside it under `CPAP/YYYYMMDD/*_BRP.edf`. Note the ACC name needs the underscore BETWEEN date
 * and time — the capture-host box writes `..._YYYYMMDDHHMMSS_ACC.txt` (no separator), which the regex
 * does not match, so a box-captured night silently contributes nothing. Phone (Polar Sensor Logger)
 * nights do match. Stage by HARDLINK, not copy — an ACC night is ~300 MB:
 *     T=/path/staged; mkdir -p "$T/CPAP/20260610"
 *     ln "<corpus>/Polar_H10_..._20260610_211538_ACC.txt" "$T/"
 *     ln "<corpus>/CPAP/20260610/20260610_204840_BRP.edf" "$T/CPAP/20260610/"
 * (hardlink needs one filesystem; the corpus and the staging dir are both on the data volume.)
 *
 * Usage:
 *   node tools/resp-acc-headless.mjs <staged-dir> [--url http://127.0.0.1:8080]
 *   (serve the repo first: python3 -m http.server 8080 --bind 127.0.0.1)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const DIR = process.argv[2];
const uArg = process.argv.indexOf('--url');
const URL_ = uArg > 0 ? process.argv[uArg + 1] : 'http://127.0.0.1:8080';

if (!DIR || !fs.existsSync(DIR)) {
  console.error('usage: node tools/resp-acc-headless.mjs <staged-dir> [--url http://host:port]');
  console.error('  <staged-dir> needs Polar_H10_*_YYYYMMDD_HHMMSS_ACC.txt + CPAP/YYYYMMDD/*_BRP.edf');
  process.exit(2);
}

/* Playwright is installed `--no-save` by the browser-gates workflow and is absent from a plain clone.
   REFUSE with the install line rather than limping — a "0 nights" run that was actually a missing
   dependency is precisely the false-green this tool exists to close. */
let chromium;
{
  const req = createRequire(import.meta.url);
  /* A WORKTREE HAS NO node_modules — and CLAUDE.md §👥.1 tells every agent to work in one, so plain
     `require('playwright')` fails for exactly the people this tool is for. Fall back to the main
     checkout's copy, located from the shared git dir rather than guessed. */
  const cands = ['playwright'];
  try {
    const { execFileSync } = await import('node:child_process');
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    if (common) cands.push(path.join(path.dirname(common), 'node_modules', 'playwright'));
  } catch {}
  for (const c of cands) {
    try {
      chromium = req(c).chromium;
      if (c !== 'playwright') console.log(`  (playwright resolved from the main checkout: ${c})`);
      break;
    } catch {}
  }
  if (!chromium) {
    console.error('✕ playwright not installed. `npm install --no-save playwright@1.48.0 && npx playwright install --with-deps chromium`');
    process.exit(2);
  }
}

const acc = fs.readdirSync(DIR).filter((f) => /Polar_H10.*_ACC\.txt$/i.test(f));
const dated = acc.filter((f) => /_(\d{8})_(\d{6})_ACC\.txt$/i.test(f));
console.log(`▸ staged dir: ${DIR}`);
console.log(`  ${acc.length} ACC file(s), ${dated.length} of them name-matching groupFiles()`);
if (acc.length && !dated.length) console.log('  ⚠ none match — box captures write YYYYMMDDHHMMSS with no separator; groupFiles() needs the underscore');

const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await p.goto(URL_ + '/resp-acc-analysis.html', { waitUntil: 'load', timeout: 120000 });
await p.setInputFiles('#folderInput', path.resolve(DIR));
// `run()` is async over every night; the status line stops saying "processing"/"night N of M" when done.
await p.waitForFunction(
  () => {
    const s = document.querySelector('#status');
    return s && !/processing|night \d+ of/i.test(s.textContent);
  },
  null,
  { timeout: 3600000 }
);

const txt = async (sel) => p.$eval(sel, (e) => e.textContent.trim()).catch(() => null);
console.log('\n▸ STATUS  ' + (await txt('#status')));
const log = (await txt('#log')) || '';
console.log('▸ LOG');
for (const line of log.split('\n')) console.log('    ' + line);
for (const id of ['refSummary', 'driftSummary']) {
  const t = await txt('#' + id);
  if (t) console.log(`▸ ${id}\n    ${t}`);
}
const rows = await p.evaluate(() => document.querySelectorAll('table tbody tr').length);
console.log(`\n▸ ${rows} table row(s) rendered · ${errs.length} console error(s)`);
for (const e of errs.slice(0, 5)) console.log('    ✕ ' + e);
await b.close();
// A run that rendered nothing is a failure even when nothing threw — the whole point is the render path.
process.exit(rows > 0 && !errs.length ? 0 : 1);
