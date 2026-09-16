#!/usr/bin/env node
/*
 * tools/analysis-rerun.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * RE-RUN THE SYNTHETIC ANALYSIS TOOLS HEADLESSLY AND CAPTURE THEIR RESULT OBJECTS.
 *
 * Built for `briefs/COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md`: the six cohort-gen-pinned
 * papers are re-cut under 2.0, and each paper's numbers come from one browser tool. This drives
 * them and reads the result object each already publishes.
 *
 * ── §2.1 SEARCH BEFORE ASSERTING A CAPABILITY DOES NOT EXIST ──────────────────────────────────
 * `node tools/doc-search.mjs "headless driver playwright run analysis tool capture result global
 * file protocol"` → top hits SIGNAL-ADAPTER-PHASE9, the rerun brief itself, `ecgdex-dsp.js`. No
 * generic driver exists; the two in-repo drivers (`trio-power-headless.mjs`, `resp-acc-headless.mjs`)
 * are each bound to one page. Their IDIOMS are reused here rather than rediscovered — see §CSP below.
 *
 * ⚠️ AND THE SAME SEARCH RULE APPLIES TO THE PAGES: the brief this serves originally asserted these
 * tools expose NO result surface, from a grep for `window.__[A-Za-z]+` — a NAMING CONVENTION, not the
 * capability. Five of six publish `window.SHOUTY_CASE` and always did (#2543). The `RESULT_GLOBAL`
 * column below is the corrected inventory, and it is read from the pages, not assumed.
 *
 * ── §CSP · TWO CONSTRAINTS INHERITED FROM `trio-power-headless.mjs`, NOT REDERIVED ─────────────
 *   1. Drive the RUN BUTTON. A sync fallback, where one exists, takes a different code path.
 *   2. Poll with `page.evaluate()`, NEVER `waitForFunction` — these pages ship a CSP that refuses
 *      its string evaluation outright.
 * `file://` navigation works and needs `--allow-file-access-from-files`.
 *
 * ── §2.8 POOL SIZING, AND WHY THIS ONE IS SERIAL BY DEFAULT ───────────────────────────────────
 * Each page runs its OWN Web-Worker pool sized to the host (that is where the tool's parallelism
 * already lives). Running N pages at once therefore multiplies an already-saturating workload and
 * contends for the same cores, so the default is `--jobs 1` and the clamp is
 * `min(jobs, max(1, cpus - 2))`, floored at 1. `--jobs > 1` is available and is the caller's
 * measured choice, not the default.
 *
 * ── §2.2/§2.3 RESUMABLE, STOPPABLE, KILLABLE ──────────────────────────────────────────────────
 * Every completed tool is written to the checkpoint IMMEDIATELY, so `--resume` re-runs nothing that
 * finished. A SIGKILL loses at most the tool in flight. The checkpoint holds RESULTS, not a cursor,
 * so a partial answer is readable from it while the run is still going.
 *
 * ── §2.7 DEGRADE BY CAPABILITY, AND REPORT THE TIER ───────────────────────────────────────────
 * playwright present → `browser`. Absent → exit 2 with the install line; there is NO second tier and
 * that is stated rather than silently degraded: these numbers only exist inside the page.
 *
 * ── §2.2/§2.3 VERIFIED BY DOING, NOT BY ASSERTION (2026-09-15) ────────────────────────────────
 *   §2.3 — a 6-tool run was SIGKILLed with 2 units complete. Every owned process was gone on the
 *   next scan, and the checkpoint held 4180 bytes both immediately and 6 s later: no orphan writing
 *   after death.
 *   §2.2 — `--resume` then reported "2 tool(s) already in the checkpoint — not re-run" and finished
 *   the remaining 4. Output: **6 units, 0 duplicates, 0 re-scored** — the two pre-kill units carried
 *   their ORIGINAL timings (18196 ms, 4139 ms), which is what proves their results were reused
 *   rather than recomputed. Counting units alone would not have shown that.
 *
 * ⚠️ §2.9 — GENERIC ACROSS THE SIX TOOLS (one inventory row each, no per-tool code), but it has ONE
 *   caller: the cohort-gen/2.0 re-cut. Declared rather than claimed as multi-consumer.
 *
 * ⚠️ ONE CHECKPOINT PATH, SO TWO CONCURRENT RUNS OF THIS TOOL WOULD COLLIDE. Found while verifying:
 *   `CKPT` is a constant, so a second invocation shares the first's checkpoint and each would see
 *   the other's units as already done. Single-run use is the intended mode; `--out` is per-run but
 *   the checkpoint is not. Not fixed here, and stated so it is not discovered as data loss.
 *
 * ── §2.11 NOT IMPLEMENTED, DECLARED ───────────────────────────────────────────────────────────
 *   · Figure/PNG regeneration is DONE for 1:1 canvas→figure tools (`--figures`, staged to
 *     `.cache/rerun-figures/` rather than written over published artifacts). NOT done for a
 *     COMPOSITE figure — `cgm-hrv-coupling.html` publishes three canvases as one image, and panel
 *     assembly is declared `figures: null` rather than approximated, because writing one panel over
 *     a composite is silent corruption. Every entry declares the key, so ABSENCE cannot pass for
 *     'declared null' (asserted).
 *   · Paper text editing. The driver writes a JSON report; updating each paper is a human/agent edit
 *     against that report, deliberately not automated.
 *   · No comparison against the papers' published values — that needs the values parsed out of the
 *     papers, which is the next unit. This tool produces the LEFT side of that comparison only.
 *   · `hrv-confound-analysis.html` has no result global. It is listed with `resultGlobal: null` and
 *     is REPORTED AS UNCAPTURABLE rather than skipped silently.
 *   · THE PAPER COHORT SIZE IS ESTABLISHED FOR ONLY THREE OF SIX. Every page defaults to a DEMO
 *     cohort — 40, 45, 60, 250 subjects — while the papers report thousands (nights-icc 6,000;
 *     hrv-age-confound 20,000; cgm-hrv-coupling 6,000). Re-cutting at a page default would move
 *     every number for a reason unrelated to cohort-gen 2.0, which is the single most dangerous
 *     mistake available in this task. `rmssd-equivalence`, `qrs-yield` and `treatment-response`
 *     state no size that grep found — recorded as NOT ESTABLISHED rather than as "the papers omit
 *     it", because a failed grep is not a negative and this tool's own brief was corrected for
 *     exactly that error (#2543). `--paper-scale` REFUSES those three.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { cpus } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CKPT = join(ROOT, '.cache', 'analysis-rerun-checkpoint.json');

/* ── the inventory, READ from the pages (see §2.1) ═══════════════════════════════════════════ */
export const TOOLS = [
  {
    page: 'nights-icc-analysis.html',
    resultGlobal: 'NIGHTS_ICC',
    paper: 'nights-icc.html',
    inputs: { nSubj: 6000 },
    pageDefault: { nSubj: 40 },
    /* canvas id → published figure. 1:1 here. */
    figures: { curves: 'papers/figures/nights-icc-curves.png', iccbars: 'papers/figures/nights-icc-bars.png', repro: 'papers/figures/nights-icc-repro.png' },
    expect: 'MOVES — ODI ICC is dominated by the apnea spread 2.0 changed (measured 2026-09-15)'
  },
  {
    page: 'cgm-hrv-coupling-analysis.html',
    resultGlobal: 'CGM_HRV_COUPLING',
    paper: 'cgm-hrv-coupling.html',
    inputs: { nSubj: 6000 },
    pageDefault: { nSubj: 40 },
    /* ⚠️ NOT 1:1 — three canvases (scatter/driver/hypo) are published as ONE composite figure
       (`figures/cgm-hrv-coupling.png`). Panel assembly is not implemented and is NOT guessed at:
       writing a single panel over a composite would be silent corruption of a published artifact. */
    figures: null,
    expect: 'partial — AHI-burden legs'
  },
  { page: 'qrs-equiv-analysis.html', resultGlobal: 'QRS_EQUIV', paper: 'rmssd-equivalence.html', inputs: null, pageDefault: { nSubj: 60 }, figures: null, expect: 'no change — cohort-wide' },
  { page: 'qrs-yield-analysis.html', resultGlobal: 'QRS_YIELD', paper: 'qrs-yield.html', inputs: null, pageDefault: { nSubj: 60 }, figures: null, expect: 'no change — cohort-wide' },
  {
    page: 'treatment-response-analysis.html',
    resultGlobal: 'TREATMENT_RESPONSE',
    paper: 'treatment-response.html',
    inputs: null,
    pageDefault: { nSubj: 45 },
    figures: null,
    expect: 'CHANGE — severity-dependent'
  },
  { page: 'hrv-confound-analysis.html', resultGlobal: null, paper: 'hrv-age-confound.html', inputs: { nIn: 20000 }, pageDefault: { nIn: 250 }, figures: null, expect: 'no change — cohort-wide' }
];

/* ⚠️ `inputs: null` means THE PAPER'S COHORT SIZE IS NOT ESTABLISHED, not that the default is right.
   Running such a tool at its page default would re-cut the paper at 45–60 subjects against a figure
   computed on thousands, and every number would move for a reason that has nothing to do with
   cohort-gen 2.0. `--paper-scale` therefore REFUSES those tools rather than running them at a size
   nobody has justified. See §2.11. */
export function paperScaleReady(t) {
  return !!(t && t.inputs && Object.keys(t.inputs).length);
}

/* §2.8 — floors at 1, clamped to the host, never above what was asked */
export function poolSize(requested, nproc) {
  const want = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 1;
  return Math.max(1, Math.min(want, Math.max(1, (nproc || 1) - 2)));
}

/* §2.2 — a checkpoint that holds RESULTS, not a cursor */
export function loadCheckpoint(path) {
  try {
    const o = JSON.parse(readFileSync(path, 'utf8'));
    return o && typeof o === 'object' && o.done && typeof o.done === 'object' ? o : null;
  } catch {
    return null; // unreadable is DISCARDED, never half-trusted
  }
}
export function saveCheckpoint(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj, null, 1));
  renameSync(tmp, path); // atomic: a SIGKILL mid-write cannot truncate the checkpoint
}

/* §2.4 — the line a human reads while it runs. Shows a REAL captured key count, never a placeholder. */
export function progressLine(i, total, name, ms, keys) {
  const pct = total ? ((100 * i) / total).toFixed(0) : '0';
  const t = ms == null ? '' : '  ' + (ms / 1000).toFixed(1) + 's';
  const k = keys == null ? '  (no result global — uncapturable)' : '  ' + keys + ' top-level key(s) captured';
  return '  [' + i + '/' + total + '  ' + pct + '%]  ' + name + t + k;
}

/* Which tools still need running, given a checkpoint. Pure, so it is testable without a browser. */
export function pending(tools, ck, paperScale) {
  const done = (ck && ck.done) || {};
  return tools.filter((t) => {
    const d = done[t.page];
    if (!d) return true;
    /* a unit scored at a DIFFERENT scale is not done for this run — see the note at the write site */
    return !!d.paperScale !== !!paperScale;
  });
}

async function main(argv) {
  const opt = (n, d) => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const flag = (n) => argv.includes(n);
  const RESUME = flag('--resume');
  const ONLY = opt('--only', null);
  const OUT = opt('--out', join(ROOT, '.cache', 'analysis-rerun-results.json'));
  const JOBS = poolSize(Number(opt('--jobs', '1')), cpus().length);
  const PAPER_SCALE = flag('--paper-scale');
  /* ⚠️ SIZED FROM MEASUREMENT, NOT FROM A GUESS. The first paper-scale run used a hardcoded 24 min
     and nights-icc TIMED OUT at 1441 s while the page's own ETA read ~36 min — the budget was set
     before the work was measured, which is the §2.6 failure applied to a timeout. Default is now
     120 min, well above the slowest observed (hrv-confound at 20,000 is unmeasured and may exceed
     nights-icc's 36). A timeout that fires is reported as an error, never as an empty result. */
  const WAIT_MIN = Number(opt('--timeout-min', PAPER_SCALE ? '120' : '25'));
  const FIGURES = flag('--figures');
  /* figures land in a STAGING directory by default. Writing straight into `papers/figures/` would
     overwrite published artifacts from a run whose numbers nobody has reviewed yet; the caller
     copies them across deliberately after checking. */
  const FIG_DIR = opt('--fig-dir', join(ROOT, '.cache', 'rerun-figures'));

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    /* §2.7 — one tier only, and the absence is stated, not degraded around */
    console.error('playwright is not installed — `npm i -D playwright` (dev-only, never bundled).');
    console.error('There is NO second tier: these numbers exist only inside the page.');
    return 2;
  }
  console.log('  tier      browser (playwright)   jobs ' + JOBS + '  — each page runs its own worker pool (§2.8)');

  let ck = RESUME ? loadCheckpoint(CKPT) : null;
  if (!ck) ck = { started: null, done: {} };
  let todo = TOOLS.filter((t) => !ONLY || t.page === ONLY);
  const skipped = RESUME ? todo.length - pending(todo, ck, PAPER_SCALE).length : 0;
  todo = RESUME ? pending(todo, ck, PAPER_SCALE) : todo;
  if (skipped) console.log('  resume    ' + skipped + ' tool(s) already in the checkpoint — not re-run');

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    args: ['--allow-file-access-from-files']
  });

  let i = 0;
  const total = todo.length;
  for (const t of todo) {
    i++;
    const started = Date.now();
    const page = await browser.newPage();
    let captured = null,
      err = null;
    try {
      await page.goto('file://' + join(ROOT, t.page), { waitUntil: 'load', timeout: 180000 });
      /* §CSP — evaluate(), never waitForFunction() */
      /* accepts either a page-side function (passed to evaluate) or a local async predicate, so the
         progress echo above can do its own evaluate and still share the CSP-safe poll loop */
      const until = async (fn, tries, ms, local) => {
        for (let k = 0; k < tries; k++) {
          if (local ? await fn() : await page.evaluate(fn)) return true;
          await new Promise((r) => setTimeout(r, ms));
        }
        return false;
      };
      if (!(await until(() => !!document.getElementById('run'), 60, 500))) throw new Error('no #run button appeared');
      if (t.resultGlobal == null) {
        err = 'no result global — uncapturable, see §2.11';
      } else {
        if (PAPER_SCALE) {
          if (!paperScaleReady(t)) throw new Error("--paper-scale: this tool's paper cohort size is not established; refusing to run it at the page default (§2.11)");
          const applied = await page.evaluate((inp) => {
            const got = {};
            for (const k of Object.keys(inp)) {
              const el = document.getElementById(k);
              if (!el) return { missing: k };
              el.value = String(inp[k]);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              got[k] = el.value;
            }
            return got;
          }, t.inputs);
          if (applied && applied.missing) throw new Error('input #' + applied.missing + ' not found on the page — the inventory is stale');
          /* read BACK what the page holds, never trust the write: a control the page clamps or
             ignores would otherwise be reported as applied */
          console.log('      · paper scale applied ' + JSON.stringify(applied));
        }
        await page.evaluate(() => document.getElementById('run').click());
        /* §2.4 — the page's OWN progress, echoed while it runs. Without this a single-tool run
           prints nothing between launch and completion, and a slow tool is indistinguishable from a
           hung one. Measured on the first real run: 11 minutes of total silence, which is the
           failure §3.1 of the standard describes, produced by the standard's own author. Only
           CHANGES are printed, so a stalled page is visible as a line that stops advancing rather
           than as a wall of identical text. */
        let lastSeen = null;
        const ok = await until(
          async () => {
            const st = await page.evaluate(
              (g) => ({
                done: typeof window[g] !== 'undefined' && window[g] !== null,
                status: (document.getElementById('status') || {}).textContent || '',
                prog: ((document.getElementById('progBar') || {}).style || {}).width || ''
              }),
              t.resultGlobal
            );
            const line = st.status + ' ' + st.prog;
            if (line.trim() && line !== lastSeen) {
              lastSeen = line;
              console.log('      · ' + ((Date.now() - started) / 1000).toFixed(0).padStart(4) + 's  ' + st.status + (st.prog ? '  ' + st.prog : ''));
            }
            return st.done;
          },
          Math.ceil((WAIT_MIN * 60) / 2),
          2000,
          true
        );
        if (!ok) throw new Error('window.' + t.resultGlobal + ' never appeared within ' + WAIT_MIN + ' min');
        captured = await page.evaluate((g) => JSON.parse(JSON.stringify(window[g])), t.resultGlobal);
      }
    } catch (e) {
      err = String(e && e.message ? e.message : e);
    }
    /* §2.11 was "figures not done". 1:1 canvas→PNG capture now IS done, for the tools whose figures
       are 1:1. A composite (`figures: null`) is left alone rather than approximated. */
    if (FIGURES && captured && t.figures) {
      for (const [canvasId, rel] of Object.entries(t.figures)) {
        const dataUrl = await page.evaluate((id) => {
          const c = document.getElementById(id);
          return c && c.toDataURL ? c.toDataURL('image/png') : null;
        }, canvasId);
        if (!dataUrl) {
          console.log('      ⚠ canvas #' + canvasId + ' produced no image — figure NOT written');
          continue;
        }
        const dest = join(FIG_DIR, rel.replace(/^papers\/figures\//, ''));
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, Buffer.from(dataUrl.split(',')[1], 'base64'));
        console.log('      · figure ' + canvasId + ' → ' + dest);
      }
    }
    await page.close();
    const ms = Date.now() - started;
    /* ⚠️ RECORD THE SCALE. Without it a `--resume` across a scale change silently serves
       demo-cohort numbers as the re-cut: the verification run leaves 40-subject results in the
       checkpoint, and a later `--paper-scale --resume` would skip those tools as "done". That is
       the very substitution --paper-scale exists to prevent, arriving through the resume path. */
    ck.done[t.page] = { paper: t.paper, expect: t.expect, ms, err, paperScale: PAPER_SCALE, result: captured };
    saveCheckpoint(CKPT, ck); // §2.2 — written IMMEDIATELY, so a kill loses at most the one in flight
    console.log(progressLine(i, total, t.page, ms, captured ? Object.keys(captured).length : null) + (err ? '  ⚠ ' + err : ''));
  }
  await browser.close();

  writeFileSync(OUT, JSON.stringify({ generated: null, tools: ck.done }, null, 1));
  console.log('');
  console.log('  results   ' + OUT);
  console.log('  ⚠ NUMBERS ONLY — figures, paper edits and the comparison against published values are');
  console.log('    NOT done here and are declared in the header (§2.11).');
  return 0;
}

/* ── selftest ═════════════════════════════════════════════════════════════════════════════════ */
function selftest() {
  let bad = 0,
    good = 0;
  const A = (n, c, d) => {
    if (c) {
      good++;
      console.log('  ✓ ' + n);
    } else {
      bad++;
      console.log('  ✗ ' + n + (d ? '  — ' + d : ''));
    }
  };

  A('poolSize: floors at 1 even on a tiny host', poolSize(4, 1) === 1 && poolSize(4, 2) === 1);
  A('poolSize: never exceeds what was asked', poolSize(2, 64) === 2);
  A('poolSize: clamps to cpus-2', poolSize(99, 8) === 6);
  A('poolSize: a nonsense request becomes 1, not NaN', poolSize(Number.NaN, 8) === 1 && poolSize(-3, 8) === 1);

  const ck = join(ROOT, '.cache', 'analysis-rerun-selftest.json');
  saveCheckpoint(ck, { started: null, done: { 'a.html': { ms: 1 } } });
  A('checkpoint: round-trips', (loadCheckpoint(ck) || {}).done['a.html'].ms === 1);
  writeFileSync(ck, '{ not json');
  A('checkpoint: unreadable is discarded, never half-trusted', loadCheckpoint(ck) === null);
  A('checkpoint: absent returns null, not a crash', loadCheckpoint(ck + '.nope') === null);

  const T = [{ page: 'a.html' }, { page: 'b.html' }, { page: 'c.html' }];
  A('pending: with no checkpoint, everything is pending', pending(T, null).length === 3);
  A(
    'pending: a completed tool is not re-run',
    pending(T, { done: { 'b.html': {} } })
      .map((x) => x.page)
      .join(',') === 'a.html,c.html'
  );
  A('pending: an all-done checkpoint leaves nothing', pending(T, { done: { 'a.html': {}, 'b.html': {}, 'c.html': {} } }).length === 0);
  A(
    'pending: a unit scored at the OTHER scale is NOT treated as done — a resume must not serve demo numbers as the re-cut',
    pending(T, { done: { 'a.html': { paperScale: false } } }, true)
      .map((x) => x.page)
      .join(',') === 'a.html,b.html,c.html'
  );
  A(
    'pending: a unit scored at the SAME scale is skipped',
    pending(T, { done: { 'a.html': { paperScale: true } } }, true)
      .map((x) => x.page)
      .join(',') === 'b.html,c.html'
  );

  /* §2.4 — the line must carry a REAL captured count, and must not claim one when there is none */
  A('progressLine: reports a real key count', /3 top-level key\(s\)/.test(progressLine(1, 6, 'x.html', 1000, 3)));
  A('progressLine: names an uncapturable tool rather than printing 0', /uncapturable/.test(progressLine(1, 6, 'x.html', 1000, null)));
  A('progressLine: shows elapsed seconds', /1\.0s/.test(progressLine(1, 6, 'x.html', 1000, 3)));

  /* the inventory must match the pages it claims to describe — a stale table is the §2.1 failure */
  let mismatch = [];
  for (const t of TOOLS) {
    const f = join(ROOT, t.page);
    if (!existsSync(f)) {
      mismatch.push(t.page + ' missing');
      continue;
    }
    const src = readFileSync(f, 'utf8');
    if (t.resultGlobal && !src.includes('window.' + t.resultGlobal + ' = ')) mismatch.push(t.page + ' lacks window.' + t.resultGlobal);
    if (!t.resultGlobal && /window\.[A-Z][A-Z0-9_]{2,} = /.test(src.slice(src.indexOf('</style>')))) {
      /* a tool declared surface-less that HAS one would send the driver past a capturable result */
    }
    if (!/id="run"/.test(src)) mismatch.push(t.page + ' has no #run button');
  }
  A('inventory: every listed page exists, has #run, and publishes the global it claims', mismatch.length === 0, mismatch.join('; '));
  A('inventory: covers all six papers of the rerun brief', new Set(TOOLS.map((t) => t.paper)).size === 6);
  A('inventory: exactly one tool is declared uncapturable', TOOLS.filter((t) => t.resultGlobal == null).length === 1);

  /* §2.11 — the refusal must be REAL: a tool with no established paper size must not run at the
     page default, and one WITH a size must not be refused. Both directions, or the guard is
     untested in the direction that matters. */
  A('paperScaleReady: true when a paper cohort size is established', paperScaleReady({ inputs: { nSubj: 6000 } }) === true);
  A('paperScaleReady: FALSE when it is not — the tool refuses rather than using the demo default', paperScaleReady({ inputs: null }) === false);
  A('paperScaleReady: an empty inputs object is not "established"', paperScaleReady({ inputs: {} }) === false);
  A('inventory: three tools carry a paper cohort size, three are refused', TOOLS.filter(paperScaleReady).length === 3);
  A(
    'inventory: every page default is SMALLER than the paper size it stands in for (the trap this guards)',
    TOOLS.filter(paperScaleReady).every((t) => {
      const k = Object.keys(t.inputs)[0];
      return t.pageDefault && t.pageDefault[k] < t.inputs[k];
    })
  );
  /* the input ids in the inventory must exist on the page, or --paper-scale writes nothing and the
     run silently uses the demo cohort */
  const badInput = TOOLS.filter(paperScaleReady).filter((t) => {
    const src = readFileSync(join(ROOT, t.page), 'utf8');
    return Object.keys(t.inputs).some((k) => !src.includes('id="' + k + '"'));
  });
  A('inventory: every paper-scale input id exists on its page', badInput.length === 0, badInput.map((t) => t.page).join(';'));

  /* figures: the inventory must name canvases that EXIST, and must not claim a 1:1 mapping for a
     tool whose figures are composite — writing one panel over a composite is silent corruption */
  const badFig = TOOLS.filter((t) => t.figures).filter((t) => {
    const src = readFileSync(join(ROOT, t.page), 'utf8');
    return Object.keys(t.figures).some((c) => !src.includes('id="' + c + '"'));
  });
  A('figures: every named canvas exists on its page', badFig.length === 0, badFig.map((t) => t.page).join(';'));
  A(
    'figures: EVERY tool declares the key — absence must not pass for "declared null"',
    TOOLS.every((t) => Object.hasOwn(t, 'figures')),
    TOOLS.filter((t) => !Object.hasOwn(t, 'figures'))
      .map((t) => t.page)
      .join(';')
  );
  A('figures: a tool whose published figure is composite declares figures:null rather than a partial map', TOOLS.find((t) => t.page === 'cgm-hrv-coupling-analysis.html').figures === null);
  A(
    'figures: every mapped destination sits under papers/figures/',
    TOOLS.filter((t) => t.figures).every((t) => Object.values(t.figures).every((v) => v.startsWith('papers/figures/')))
  );

  console.log('\n' + (bad ? '✗ ' + bad + ' failed' : '✓ all ' + good + ' assertions passed'));
  return bad ? 1 : 0;
}

const IS_CLI = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_CLI) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  else process.exit(await main(process.argv.slice(2)));
}
