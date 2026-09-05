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
 * `groupFiles()` expects: `Polar_H10_*_ACC.txt` at the top level, and the matching flow beside it
 * under `CPAP/YYYYMMDD/*_BRP.edf`.
 *
 * BOTH capture layouts are accepted — `_YYYYMMDD_HHMMSS_ACC.txt` (phone / Polar Sensor Logger) and
 * `_YYYYMMDDHHMMSS_ACC.txt` (capture host, no separator). This paragraph used to say the box layout
 * "silently contributes nothing"; that was true of `groupFiles()` once, was fixed in the parser
 * (`RespAccAnalysis.sessionStamp`, gated by `resp-acc-analysis · corpus · absence`), and the fix never
 * reached this file — see the pre-flight below, which kept its own copy of the OLD regex and therefore
 * announced "0 of 193 name-matching" three lines before the page grouped 188 nights from them.
 * The pre-flight now CALLS `sessionStamp`, so there is one rule and it cannot drift again.
 *
 * Stage by HARDLINK, not copy — an ACC night is ~300 MB:
 *     T=/path/staged; mkdir -p "$T/CPAP/20260610"
 *     ln "<corpus>/Polar_H10_..._20260610_211538_ACC.txt" "$T/"
 *     ln "<corpus>/CPAP/20260610/20260610_204840_BRP.edf" "$T/CPAP/20260610/"
 * (hardlink needs one filesystem; the corpus and the staging dir are both on the data volume.)
 *
 * Usage:
 *   node tools/resp-acc-headless.mjs <staged-dir> [--url http://127.0.0.1:8080] [--figures <out-dir>]
 *   (serve the repo first: python3 -m http.server 8080 --bind 127.0.0.1)
 *
 * `--figures <out-dir>` writes the page's three canvases — Bland-Altman, coverage, per-night MAE — as
 * PNGs named exactly as the page's own download buttons name them, so a run reproduces the published
 * figures rather than a look-alike. Read straight off the live canvas via `toDataURL`; nothing is
 * re-plotted here, so there is no second drawing implementation to drift from the one on screen.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DIR = process.argv[2];
const uArg = process.argv.indexOf('--url');
const URL_ = uArg > 0 ? process.argv[uArg + 1] : 'http://127.0.0.1:8080';
let wrote = 0;
let blank = 0;
const fArg = process.argv.indexOf('--figures');
const FIGDIR = fArg > 0 ? process.argv[fArg + 1] : null;

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

/* ONE RULE, NOT A SECOND COPY. This pre-flight used to run its own `_YYYYMMDD_HHMMSS_` regex — the
   phone-only form — while the page had long since moved to `sessionStamp`, which accepts the capture
   host's separator-less run too. The two disagreed in the same output: "193 ACC file(s), 0 of them
   name-matching" followed three lines later by "grouped 188 night(s)". A confident, wrong pre-flight
   is worse than none, because it tells a reader the corpus is unanalysable when it is not — which is
   the conclusion MOTIONDEX-RESPIRATORY-RATE §11 had to correct at corpus scale. */
const stampOf = (() => {
  try {
    const src = fs.readFileSync(path.join(REPO, 'resp-acc-analysis.js'), 'utf8');
    const sb = { console };
    sb.window = sb;
    sb.self = sb;
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(src, sb, { filename: 'resp-acc-analysis.js' });
    const A = sb.RespAccAnalysis;
    if (A && typeof A.sessionStamp === 'function') return (n) => A.sessionStamp(n);
  } catch {}
  return null;
})();
const acc = fs.readdirSync(DIR).filter((f) => /Polar_H10.*_ACC\.txt$/i.test(f));
console.log(`▸ staged dir: ${DIR}`);
if (!stampOf) {
  /* FAIL LOUD, NOT OPEN. If the shared parser cannot be loaded, this tool must not fall back to a
     private regex — that is how the two copies diverged in the first place. */
  console.log(`  ${acc.length} ACC file(s) · ⚠ could not load RespAccAnalysis.sessionStamp — pre-flight SKIPPED, not guessed`);
} else {
  const dated = acc.filter((f) => stampOf(f) != null);
  console.log(`  ${acc.length} ACC file(s), ${dated.length} of them carrying a session stamp the page can read`);
  if (acc.length && !dated.length) console.log('  ⚠ none carry a recognisable stamp — expected _YYYYMMDD_HHMMSS_ACC.txt (phone) or _YYYYMMDDHHMMSS_ACC.txt (capture host)');
}

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
/* Dump every rendered table. The agreement row — MAE / CI / bias / RMSE / LoA / r — has no
   element id, so before this it was visible on screen and nowhere in a run's output. A sweep that
   cannot print its own headline statistic cannot be re-derived by anyone else, which is the
   PAPERS-ROADMAP §5.2 requirement; MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS §5 needed it to report the
   RR_WIN_SEC curve. Read straight off the DOM, so there is no second formatting of the numbers. */
const tables = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll('table').forEach((t, i) => {
    const cap = ((t.previousElementSibling && t.previousElementSibling.textContent) || '').trim().slice(0, 90);
    out.push('TABLE ' + i + ' :: ' + cap);
    t.querySelectorAll('tr').forEach((r) => {
      out.push('  ' + [...r.children].map((c) => c.textContent.trim()).join(' | '));
    });
  });
  return out.join('\n');
});
console.log('\n▸ TABLES\n' + tables);
const rows = await p.evaluate(() => document.querySelectorAll('table tbody tr').length);
console.log(`\n▸ ${rows} table row(s) rendered · ${errs.length} console error(s)`);
for (const e of errs.slice(0, 5)) console.log('    ✕ ' + e);

/* COHORT MANIFEST — the NIGHT SET behind the n, written beside the figures.
   `2026-09-02-papers-cohort-never-recorded`: a published n cannot be checked because the night set it
   was computed over was never recorded, and that — not a transcription error — is how one quantity
   comes to have two published values. Four sources were checked and none names the cohort; the
   generating commit says "all 26 nights scored, 18,856 epochs", which is a COUNT, never a SET.

   Every night appears with the stage it reached, so an n is checkable in both directions: which nights
   produced it, and which were dropped and where. STAGED is read from the input directory rather than
   from the page, because a night the picker never ingested is invisible to every DOM query — that
   silent drop is the failure this manifest exists to make visible (`grouped 49` from `staged 50` is a
   fact no table on the page states).

   ⚠️ THE INCLUSION RULE IS QUOTED FROM THE PAGE, NEVER RESTATED HERE. Paraphrasing "coverage floor,
   lock gate, head/tail trim" into this file would create a second statement of the rule that drifts
   from the one that actually gated the run — the same reason the figures are read off the live canvas
   instead of being re-plotted. `#driftSummary` / `#refSummary` / `#status` carry the page's own words
   and go in verbatim.

   ⚠️ A cohort-recorded n is NOT comparable to a cohort-less one, so `schema` is stamped and the
   published 18,856 / 19,193 must not be printed beside a manifest-backed number as though they were
   the same measurement (the row says this explicitly; see `2026-09-05-respacc-epochs-predate-alignment-fix`). */
if (FIGDIR) {
  const dom = await p.evaluate(() => {
    const tableWhose = (needle) => {
      for (const t of document.querySelectorAll('table')) {
        const cap = ((t.previousElementSibling && t.previousElementSibling.textContent) || '').trim();
        if (cap.includes(needle)) return t;
      }
      return null;
    };
    const grid = (t) => (t ? [...t.querySelectorAll('tr')].map((r) => [...r.children].map((c) => c.textContent.trim())) : []);
    const asObjects = (rowsIn) => {
      if (rowsIn.length < 2) return [];
      const head = rowsIn[0];
      return rowsIn.slice(1).map((r) => Object.fromEntries(r.map((v, i) => [head[i] || 'col' + i, v])));
    };
    const say = (id) => {
      const e = document.getElementById(id);
      return e ? e.textContent.trim() : null;
    };
    return {
      clock: asObjects(grid(tableWhose('Offset recovered by cross-correlating'))),
      scored: asObjects(grid(tableWhose('Per-night breakdown'))),
      status: say('status'),
      refSummary: say('refSummary'),
      driftSummary: say('driftSummary')
    };
  });

  const stagedAcc = fs
    .readdirSync(DIR)
    .filter((f) => /Polar_H10.*_ACC\.txt$/i.test(f))
    .sort();
  const scoredNights = dom.scored.map((r) => r.Night).filter(Boolean);
  const manifest = {
    schema: 'tepna.resp-acc-cohort/1',
    generatedAt: new Date().toISOString(),
    stagedDir: path.resolve(DIR),
    inclusionRuleVerbatim: {
      note: 'quoted from the page that gated this run; never restated by the harness',
      status: dom.status,
      refSummary: dom.refSummary,
      driftSummary: dom.driftSummary
    },
    counts: {
      stagedAccFiles: stagedAcc.length,
      inClockTable: dom.clock.length,
      scoredNights: scoredNights.length
    },
    stagedAccFiles: stagedAcc,
    nights: dom.clock.map((r) => {
      const night = r.Night || '';
      const hit = dom.scored.find((s) => s.Night === night);
      return {
        night,
        verdict: r.verdict || null,
        scored: !!hit,
        hours: hit ? hit.hours : null,
        epochs: hit ? hit.epochs : null
      };
    }),
    scoredNights
  };
  fs.mkdirSync(FIGDIR, { recursive: true });
  fs.writeFileSync(path.join(FIGDIR, 'cohort-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `\n▸ COHORT → ${path.join(FIGDIR, 'cohort-manifest.json')}` +
      `\n    staged ${manifest.counts.stagedAccFiles} ACC file(s) · ${manifest.counts.inClockTable} night(s) in the clock table · ${manifest.counts.scoredNights} scored`
  );
}

/* FIGURES — read off the LIVE canvases, never re-plotted here. The names match the page's own
   download buttons (resp-acc-analysis-app.js), so what a run writes is what a human clicking Save
   would get. A canvas that never drew is reported as SKIPPED with its id, never written as a blank
   PNG: an empty figure in papers/figures/ is indistinguishable from a real one at a glance, and this
   corpus can legitimately produce a page with no confident locks to plot. */
if (FIGDIR) {
  const FIGS = [
    ['figBA', 'acc-resp-bland-altman.png'],
    ['figCov', 'acc-resp-coverage.png'],
    ['figNights', 'acc-resp-per-night.png']
  ];
  fs.mkdirSync(FIGDIR, { recursive: true });
  console.log('\n▸ FIGURES → ' + FIGDIR);
  for (const [id, name] of FIGS) {
    const shot = await p.evaluate((cid) => {
      const c = document.getElementById(cid);
      if (!c || !c.width || !c.height) return null;
      // A canvas that was sized but never painted is uniformly transparent; treat that as "no figure"
      // rather than writing an empty PNG that reads as a result.
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let painted = false;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] !== 0) {
          painted = true;
          break;
        }
      }
      return painted ? { url: c.toDataURL('image/png'), w: c.width, h: c.height } : null;
    }, id);
    if (!shot) {
      console.log(`    ⊘ ${name} — #${id} drew nothing (no figure written)`);
      blank++;
      continue;
    }
    const buf = Buffer.from(shot.url.split(',')[1], 'base64');
    fs.writeFileSync(path.join(FIGDIR, name), buf);
    wrote++;
    console.log(`    ✓ ${name}  ${shot.w}x${shot.h}  ${(buf.length / 1024).toFixed(0)} KB`);
  }
}

await b.close();

/* 🔴 A RUN THAT WROTE NO FIGURE IS NOT A PASS, and `rows > 0` could not see that. Measured on the full
   79-night corpus: three `drew nothing` lines, an EMPTY `--figures` directory, 564 table rows, and
   EXIT=0 — because the guard counted TABLE ROWS while the thing that failed was the RENDER. A caller
   could not distinguish "the corpus produced no scoreable night" from "the run worked", by exit code or
   by the presence of output, so an unattended invocation reads a total non-result as success.
   The verdict is now stated in words as well as in the exit code: a count that is only a number is what
   let this pass unread for a corpus run. Refusing to score off-model nights stays correct — what was
   wrong was reporting that refusal as success. */
if (FIGDIR) {
  console.log(`\n  FIGURES: ${wrote} written, ${blank} blank of ${wrote + blank} canvas(es) → ${FIGDIR}`);
  if (!wrote) console.log('  ⊘ NO FIGURE WAS WRITTEN — this run produced no scoreable output. Reporting FAILURE.');
}
console.log(`  TABLE: ${rows} row(s)${errs.length ? `  ·  ${errs.length} console error(s)` : ''}`);
const okRun = rows > 0 && !errs.length && (!FIGDIR || wrote > 0);
process.exit(okRun ? 0 : 1);
