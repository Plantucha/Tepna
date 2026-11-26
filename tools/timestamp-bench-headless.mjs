#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * timestamp-bench-headless.mjs — re-run `papers/timestamp-pathology-analysis.html` and report the
 * two counts `papers/timestamp-pathology.html` publishes: the vendor/branch corpus and the six
 * Clock Contract invariants.
 * ----------------------------------------------------------------------------
 * WHY A TOOL AND NOT A ONE-OFF DRIVER. The paper's §3 states `24 / 24` and `6 / 6` and its §5 calls
 * the benchmark a regression guard. Nothing re-ran it: the page is UNBUNDLED, so neither the
 * provenance gate nor the behaviour gate opens it, and `tools/analysis-rerun.mjs` does not carry it
 * (that registry is cohort-driven — every entry declares an `nSubj`, and this page has no cohort).
 * A `CLAIM` marker needs a producer anyone can run, so this is it.
 *
 * ── THE RUNNER TIMEZONE IS AN INPUT, AND THE PUBLISHED COUNT DEPENDS ON IT ──────────────────────
 *
 * Measured 2026-11-26 across four runner zones: the corpus reads 24/24 under UTC and 21/24 under
 * America/New_York, Asia/Kolkata and Pacific/Chatham alike. The three that move are exactly the
 * branch-1 epoch cases (`epoch-ms`, `epoch-s`, `epoch-num`), and they move for the reason the paper
 * itself states in §3: a bare epoch is a genuine instant, so the parser localises it to the runner's
 * wall clock — deliberately the one place the viewer's zone enters. The benchmark's expectation for
 * those three rows is a FIXED epoch (`want: 1751925600000`), so it is pinned to a UTC runner while
 * the parser under test is not.
 *
 * So the parser is behaving as documented and the EXPECTATION is zone-pinned. This tool therefore
 * reports the zone beside every count, and its verdict is scoped to the UTC runner — the condition
 * under which the published figure is the one the page produces.
 *
 * The six invariants hold in all four zones, as they must: each is a relative comparison (B6 asks
 * only that a string and a numeric epoch agree), so none of them reads an absolute instant.
 *
 * ── THE TWO COMMITTED SNAPSHOTS DISAGREE, AND THIS TOOL DOES NOT REPAIR THEM ────────────────────
 *
 * `papers/timestamp-corpus.json` records `pass: 21`, `fail: 3` with those three epoch rows at
 * `ok: false` and `off=-240` — captured on a US-Eastern runner. `papers/timestamp-invariants.json`
 * records `corpus: { pass: 24, total: 24 }`. Both are cited by §5 as "a committed run for diffing",
 * and they are two runs in two zones. Reported here, repaired nowhere: regenerating a published
 * artifact is not this unit, and a silent rewrite would destroy the evidence of the disagreement.
 *
 * USAGE
 *   node tools/timestamp-bench-headless.mjs                      # UTC + the three sweep zones
 *   node tools/timestamp-bench-headless.mjs --zones UTC          # one zone
 *   node tools/timestamp-bench-headless.mjs --json               # one tepna.verdict/1
 *   node tools/timestamp-bench-headless.mjs --out <path.json>    # the full per-case record
 *   node tools/timestamp-bench-headless.mjs --verdict-sample     # the verdict shape, examining nothing
 *   node tools/timestamp-bench-headless.mjs --selftest           # the status map, no browser
 * ════════════════════════════════════════════════════════════════════════════ */
import { writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeVerdict, printVerdict } from './verdict-emit.mjs';
import { refuseUnknownArgvOrExit, isCliEntry } from './argv-guard.mjs';
import { writeRootOrDie } from './write-root.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'papers/timestamp-pathology-analysis.html';
/* The verdict's zone. Every published count in the paper is this runner's. */
const PRIMARY_ZONE = 'UTC';
/* The sweep is three zones that differ from UTC in sign, in magnitude and in minute offset, so a
   result that held only for whole-hour western offsets could not pass unnoticed. */
const SWEEP_ZONES = ['America/New_York', 'Asia/Kolkata', 'Pacific/Chatham'];

const argv = process.argv.slice(2);
const IS_CLI = isCliEntry(import.meta.url);
if (IS_CLI) refuseUnknownArgvOrExit(argv, { valued: ['--zones', '--out'], boolean: ['--json', '--verdict-sample', '--selftest'] }, { tool: 'timestamp-bench-headless' });
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const JSON_ONLY = flag('--json');
const zones = opt('--zones', null) ? opt('--zones', '').split(',') : [PRIMARY_ZONE, ...SWEEP_ZONES];
const OUT = opt('--out', null);

/* One browser, one context per zone: `timezoneId` is a context property, so a zone cannot leak
   from one run into the next. */
async function runZone(browser, tz) {
  const ctx = await browser.newContext({ timezoneId: tz });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto('file://' + join(ROOT, PAGE));
  await page.waitForFunction('window.__tsbench !== undefined', null, { timeout: 60000 });
  const bench = await page.evaluate(() => window.__tsbench);
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('table'))
      .map((t) =>
        Array.from(t.querySelectorAll('tr'))
          .filter((r) => !r.querySelector('th'))
          .map((r) => Array.from(r.children).map((c) => c.textContent.trim()))
      )
      .filter((rs) => rs.length)
  );
  await ctx.close();
  const corpusRows = rows[0] || [];
  const invRows = rows[1] || [];
  /* The two tables mark a pass DIFFERENTLY: the corpus prints a tick, the invariant table prints
     the word. A tick-only filter reported all six invariants failing while the page's own count read
     6/6 — a filter that matches everything (CLAUDE.md §4b), caught because the verdict disagreed with
     the printed table. */
  const passed = (cell) => cell === '✓' || cell === 'PASS';
  return {
    tz,
    bench,
    pageErrors: errs,
    corpusFailures: corpusRows.filter((r) => !passed(r[r.length - 1])).map((r) => ({ cat: r[0], raw: r[1], got: r[2], offsetMin: r[3], note: r[4] })),
    invariantFailures: invRows.filter((r) => !passed(r[1])).map((r) => r[0]),
    corpusRows,
    invRows
  };
}

/* ⚠ PLAYWRIGHT LOADS LAZILY, AND THE REASON IS A CI RED I CAUSED. A static `import … from
   'playwright'` runs at module evaluation, so it threw on the CI runner, which carries no browser.
   The adoption manifest runs `--verdict-sample` there, read its empty stdout and reported
   `emits could not be read — Unexpected end of JSON input`: the gate never reached the branch that
   opens no browser. A measurement path may need a browser; the SHAPE path must not. */
export async function measure() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const runs = [];
    for (const tz of zones) runs.push(await runZone(browser, tz));
    return runs;
  } finally {
    await browser.close();
  }
}

/* ── THE DECISION, PURE, SO A SELFTEST CAN REACH EVERY BRANCH WITHOUT A BROWSER ─────────────────
   `--selftest` plants run shapes here. The browser path and the selftest path therefore read the
   SAME status map, which is the only way a status map can be tested at all. */
export function decide(runs, zonesRun) {
  const primary = runs.find((r) => r.tz === PRIMARY_ZONE) || null;
  /* Every assertion the page makes in one run: one per corpus case plus one per invariant. */
  const eligible = primary ? primary.bench.corpus.total + primary.bench.invariants.total : 0;
  const failures = primary ? primary.corpusFailures.length + primary.invariantFailures.length : null;
  const status = !primary ? 'NOT_RUN' : primary.pageErrors.length ? 'UNKNOWN' : failures === 0 ? 'PASS' : 'FAIL';
  const reason = !primary
    ? `the primary zone ${PRIMARY_ZONE} was not among the zones run (${zonesRun.join(', ')}), so nothing was examined`
    : primary.pageErrors.length
      ? `the page raised ${primary.pageErrors.length} error(s), so its own counts cannot be trusted: ${primary.pageErrors[0]}`
      : failures === 0
        ? null
        : `${failures} of ${eligible} assertion(s) failed under a ${PRIMARY_ZONE} runner`;
  return {
    status,
    reason,
    /* NOT_RUN examined nothing, so it reports no population and no result (VERDICT-CONTRACT §1). */
    population: { checked: eligible, eligible, excluded: 0 },
    result: primary
      ? {
          runnerZone: PRIMARY_ZONE,
          corpusPass: primary.bench.corpus.pass,
          corpusTotal: primary.bench.corpus.total,
          invariantsPass: primary.bench.invariants.pass,
          invariantsTotal: primary.bench.invariants.total,
          failures,
          zoneSweep: runs.map((r) => ({
            tz: r.tz,
            corpusPass: r.bench.corpus.pass,
            invariantsPass: r.bench.invariants.pass,
            failing: r.corpusFailures.map((c) => c.note)
          }))
        }
      : null
  };
}

const build = (d) =>
  makeVerdict({
    gate: 'timestamp-bench',
    tool: 'tools/timestamp-bench-headless.mjs',
    status: d.status,
    population: d.status === 'NOT_RUN' ? { checked: 0, eligible: 0, excluded: 0 } : d.population,
    /* Pre-stated by the PAPER, not by this run: its §3 publishes 24/24 and 6/6. */
    criterion: { name: 'bench_failures', threshold: 0, unit: 'assertions', direction: 'lte' },
    result: d.result,
    evidence: d.result ? ['tools/timestamp-bench-headless.mjs', PAGE, 'clock.js'] : ['tools/timestamp-bench-headless.mjs'],
    reason: d.reason
  });

/* --verdict-sample: the SHAPE, examining nothing. The adoption manifest runs this, so it must not
   open a browser and must never read PASS. */
if (flag('--verdict-sample')) {
  printVerdict(
    build({
      status: 'NOT_RUN',
      reason: '--verdict-sample prints the shape and opens no browser, so no case and no invariant was examined',
      population: { checked: 0, eligible: 0, excluded: 0 },
      result: null
    })
  );
  process.exit(0);
}

if (flag('--selftest')) {
  let fails = 0;
  let ran = 0;
  const ok = (cond, what, detail) => {
    ran += 1;
    console.log(`  ${cond ? '\u2713' : '\u2717'} ${what}${detail ? '  \u2014 ' + detail : ''}`);
    if (!cond) fails++;
  };
  const run = (tz, o = {}) => ({
    tz,
    bench: { corpus: { pass: o.cPass ?? 24, total: 24 }, invariants: { pass: o.iPass ?? 6, total: 6 } },
    pageErrors: o.pageErrors || [],
    corpusFailures: Array.from({ length: 24 - (o.cPass ?? 24) }, (_, i) => ({ note: 'case ' + i })),
    invariantFailures: Array.from({ length: 6 - (o.iPass ?? 6) }, (_, i) => 'B' + (i + 1))
  });

  const green = decide([run('UTC'), run('Asia/Kolkata', { cPass: 21 })], ['UTC', 'Asia/Kolkata']);
  ok(green.status === 'PASS' && green.reason === null, 'all 30 assertions hold under UTC \u2192 PASS', `checked ${green.population.checked}`);
  ok(green.population.checked === 30 && green.population.eligible === 30 && green.population.excluded === 0, 'the population is the 24 cases plus the 6 invariants');
  ok(green.result.zoneSweep.length === 2 && green.result.zoneSweep[1].corpusPass === 21, 'a non-UTC zone reports in the sweep and does NOT decide the verdict');

  const red = decide([run('UTC', { cPass: 21 })], ['UTC']);
  ok(red.status === 'FAIL' && /3 of 30/.test(red.reason), 'a failing case under UTC \u2192 FAIL with its count', red.reason);
  const redInv = decide([run('UTC', { iPass: 5 })], ['UTC']);
  ok(redInv.status === 'FAIL' && /1 of 30/.test(redInv.reason), 'a failing INVARIANT reds too \u2014 the tick-vs-PASS bug read six of these as failures', redInv.reason);

  const unknown = decide([run('UTC', { pageErrors: ['TypeError: x'] })], ['UTC']);
  ok(unknown.status === 'UNKNOWN' && /cannot be trusted/.test(unknown.reason), 'a page error \u2192 UNKNOWN, never a PASS off the page\u2019s own counts');

  const notRun = decide([run('Asia/Kolkata')], ['Asia/Kolkata']);
  ok(notRun.status === 'NOT_RUN' && notRun.result === null, 'no UTC run \u2192 NOT_RUN with a null result');
  ok(build(notRun).population.checked === 0, 'the NOT_RUN verdict reports checked 0 \u2014 it examined nothing');
  for (const d of [green, red, redInv, unknown, notRun]) build(d);
  ok(true, 'every status in the map builds a VALID tepna.verdict/1', 'makeVerdict validates, and throws otherwise');

  /* The count is the COUNTER the helper increments, never a typed literal (selftest-all's
     `literalCountLines`): a hand-typed total can outlive the assertion it counted. */
  console.log(`\n${fails ? '\u2717 ' + fails + ' of ' + ran + ' selftest assertion(s) FAILED' : '\u2713 selftest: ' + ran + ' assertions passed'}`);
  process.exit(fails ? 1 : 0);
}

const runs = await measure();
const decision = decide(runs, zones);
const { status } = decision;

const verdict = build(decision);

if (OUT) {
  /* The record goes into the checkout this run belongs to, resolved through `writeRootOrDie` at the
     write (WRITE-ROOT-ADOPTION-2026-11-03): a tool invoked from one worktree must not write into
     another one's tree. An absolute path, or a relative one that climbs out, is refused by name
     rather than followed. */
  const root = writeRootOrDie(import.meta.url);
  const dest = resolve(root, OUT);
  if (isAbsolute(OUT) || relative(root, dest).startsWith('..')) {
    console.error(`\u2717 --out ${OUT} resolves outside ${root} \u2014 give a path inside the checkout; nothing was written.`);
    process.exit(2);
  }
  writeFileSync(dest, JSON.stringify({ zones, runs, verdict }, null, 1) + '\n');
}

if (!JSON_ONLY) {
  console.log(`timestamp-bench \u2014 ${PAGE} over the shipping clock.js parser\n`);
  console.log('  runner zone            corpus   invariants  failing cases');
  for (const r of runs) {
    const c = `${r.bench.corpus.pass}/${r.bench.corpus.total}`;
    const iv = `${r.bench.invariants.pass}/${r.bench.invariants.total}`;
    console.log(`  ${r.tz.padEnd(22)} ${c.padStart(6)}   ${iv.padStart(10)}  ${r.corpusFailures.map((x) => x.note).join(', ') || '\u2014'}`);
  }
  console.log(`\n  The verdict is the ${PRIMARY_ZONE} row. A non-UTC runner moves the three branch-1 epoch`);
  console.log('  cases, whose expectation is a fixed epoch while the parser localises one \u2014 see the header.');
}
printVerdict(verdict);
process.exitCode = status === 'PASS' ? 0 : 1;
