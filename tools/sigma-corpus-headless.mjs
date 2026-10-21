#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * sigma-corpus-headless.mjs — run `sigma-no-reference-analysis.html` over the canonical
 * corpus without a human dropping a folder, and report the POPULATION it reaches.
 *
 * WHY. RESIDUE `2026-10-20-sigma-paper-reports-the-blind-classifier-corpus`.
 * `papers/sigma-no-reference.html` §4 reports "of 58 indexed nights, 31 are trio-eligible
 * and 26 resolve a clean across-night hat (291,561 simultaneous seconds)". That corpus is
 * the one the page's PHONE-APP-ONLY classifier produced. #3805 widened the classifier to
 * the capture-host layout, and the page now indexes four times as many nights. Nobody has
 * measured what the hat does over the widened corpus, and the row says the work is to
 * RE-RUN THE TOOL, never to hand-edit a number in the paper.
 *
 * WHAT IT DOES NOT DO. It does not re-implement the classifier, the night key, the corner
 * DSPs, the per-window kernel or the aggregation. It drives the REAL page, the same way
 * `tools/trio-power-headless.mjs` drives the real power sweep: a second implementation that
 * agreed would prove nothing about the page, and one that disagreed would not say which was
 * wrong. Every number this tool prints comes out of `window.SIGMA_RESULT` or the page's own
 * night table.
 *
 * THREE THINGS THAT ARE NOT OBVIOUS.
 *
 *   1. THE CORPUS IS NOT A DIRECTORY YOU CAN HAND TO `webkitdirectory`. 63 % of
 *      `/srv/data/tepna-corpus` is a symlink into the NAS cold tier, and each recording is
 *      ALSO staged into several view directories. A walk that neither follows links nor
 *      dedupes by recording reads a different corpus — measured in #3791, where the first
 *      pass accepted 5,216 files where the published figure was 9,853. So this tool walks
 *      names, dedupes by basename, and hands the page an explicit FILE LIST.
 *
 *   2. THE FILE LIST IS BUILT BY THE PAGE'S OWN `classify`, SLICED OUT OF THE PAGE SOURCE.
 *      A shared stamp regex written beside the page is not the page's reader: one measured
 *      in #3826 ate a Polar device serial as a date and reported 2,694 false losses. The
 *      slice below executes the page's declaration, so the list this tool hands over is the
 *      set the page would have accepted from a folder drop.
 *
 *   3. CONCURRENCY IS A MEMORY BOUND, NOT A SPEED KNOB. `processFolder` opens
 *      `min(8, navigator.hardwareConcurrency)` worker lanes, and each lane holds one night's
 *      raw ECG and raw PPG while it derives that night's corners. On this corpus a single
 *      night's H10 `_ECG.txt` runs to hundreds of megabytes, so eight lanes is gigabytes of
 *      live text. `--concurrency` overrides `navigator.hardwareConcurrency` before the page
 *      script runs, which is the only point at which that read can be intercepted.
 *
 * USAGE
 *   node tools/sigma-corpus-headless.mjs --out /tmp/sigma-corpus.json
 *   node tools/sigma-corpus-headless.mjs --corpus /srv/data/tepna-corpus --concurrency 2
 *   node tools/sigma-corpus-headless.mjs --index-only     # population only, no hat
 *   node tools/sigma-corpus-headless.mjs --nights 4       # smoke run over the first N
 * ════════════════════════════════════════════════════════════════════════ */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { launch } from './pw-launch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const PAGE_JS = join(REPO, 'sigma-no-reference-analysis.js');
const PAGE_HTML = join(REPO, 'sigma-no-reference-analysis.html');

const ARGV_SPEC = {
  valued: ['--corpus', '--out', '--concurrency', '--nights', '--timeout-min', '--list-in', '--list-out', '--record', '--record-from'],
  boolean: ['--index-only', '--json', '--headed']
};

/** The page's own `classify`, executed rather than re-described. Fails closed. */
export function pageClassifier(src) {
  const open = '  function classify(file) {';
  const i = src.indexOf(open);
  if (i < 0) throw new Error('classify declaration not found in sigma-no-reference-analysis.js');
  const end = src.indexOf('\n  }\n', i);
  if (end < 0) throw new Error('classify declaration has no closing brace at the expected indent');
  return new Function('return (' + src.slice(i, end + 5).trim() + ');')();
}

/**
 * Walk names only — never a `stat`, so the NAS cold tier is not paged in — following
 * directory symlinks, and keep the first path for each distinct BASENAME.
 */
export function walkAccepted(root, classify) {
  const seen = new Map();
  let entries = 0;
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let ents;
    try {
      ents = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (e.isSymbolicLink()) {
        let rp;
        try {
          rp = realpathSync(p);
        } catch {
          continue;
        }
        let isDir = false;
        try {
          readdirSync(rp);
          isDir = true;
        } catch {
          /* a file symlink — fall through and classify it by name */
        }
        if (isDir) {
          stack.push(rp);
          continue;
        }
      }
      entries++;
      const c = classify({ name: e.name });
      if (c && !seen.has(e.name)) seen.set(e.name, { role: c.role, path: p });
    }
  }
  return { entries, accepted: seen };
}

/* `854 keyed by filename (no row stamp)` — the page PRINTS this count rather than exposing it, and
   §∅ makes it part of the population: a night keyed by a filename was keyed by the session OPEN time.
   A status this cannot read is null, never 0. */
export function keyedByNameFromStatus(status) {
  const m = String(status || '').match(/(\d+) keyed by filename/);
  return m ? +m[1] : null;
}

/* A skip reason reads `204 s overlap < 1000` or `no Verity-HR`. The leading figure is that one
   night's own overlap, so the family drops it and the record publishes counts. */
export function skipFamilies(skipped) {
  const by = new Map();
  for (const s of skipped || []) {
    const raw = String(s.reason || 'unstated');
    const ov = raw.match(/^\d+(?:\.\d+)?\s*s overlap < (\d+)$/);
    const fam = ov ? `three-way overlap below ${ov[1]} s` : raw;
    by.set(fam, (by.get(fam) || 0) + 1);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([reason, nights]) => ({ reason, nights }));
}

/* ── the published-number record ────────────────────────────────────────────────────────────────
   The committed artifact, and it is NOT the `--out` JSON: counts only, no per-night key and no
   dated row (owner ruling 2026-09-24 — per-night values stay off the public repo).

   The digest is over `name\0role` of the accepted set, so it pins the POPULATION this record claims
   and nothing else. The raw waveforms are multi-GB and uncommitted, and no digest written here would
   notice a changed BYTE inside one; the note says exactly that rather than implying more.

   A record can be built from a finished run's `--out` JSON (`--record-from`) instead of from a live
   one. The solve costs hours over the cold tier, so re-running it only to add a field would be waste,
   and the two-step invocation is recorded in the `invocation` string the way the SHHS re-cut records
   its own pool-then-recut pair. ═══════════════════════════════════════════════════════════════════ */
export function buildRecord({ corpus, conc, entries, acceptedPairs, index, hat, commit, invocation }) {
  const h = createHash('sha256');
  for (const [name, role] of [...acceptedPairs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    h.update(name + '\0' + role + '\0');
  }
  return {
    schema: 'tepna.published-number-record/1',
    producer: 'tools/sigma-corpus-headless.mjs',
    producerCommit: commit,
    invocation,
    generated: new Date().toISOString().slice(0, 10),
    inputs: {
      path: `${corpus} (private overnight capture set — multi-GB raw waveforms, NOT committed, never fetched by the suite)`,
      committed: false,
      files: acceptedPairs.length,
      digest: h.digest('hex').slice(0, 12),
      note: "sha256[0:12] over name\\0role of every file the page's own classifier accepted, sorted. It pins the POPULATION this record claims. It does NOT pin the bytes inside a capture, so a re-written waveform is invisible to it — re-run the producer to resolve that."
    },
    publishedIn: 'papers/sigma-no-reference.html §4 and Reproducibility (population re-run under the classifier widened by #3805, 2026-10-21)',
    supersedes: null,
    claims: {
      note: 'the values EXACTLY as the prose states them, so a reader compares without rounding',
      indexedNights: index.indexed,
      trioEligibleNights: index.eligible,
      solvedNights: hat.solved,
      simultaneousSeconds: hat.totalS
    },
    population: {
      entriesWalked: entries,
      acceptedFiles: acceptedPairs.length,
      concurrency: conc,
      filesKeyedByFilename: index.keyedByName ?? keyedByNameFromStatus(index.status),
      nonSolvedEligible: index.eligible - hat.solved,
      /* Families, never the rows. Each skip carries the night's LABEL, which is a date, and a dated
         per-night row stays off the public repo (owner ruling 2026-09-24). The overlap reasons also
         carry the night's own overlap in seconds, which is per-night data in a string — so the family
         is the reason with its number removed, and the count is what this record publishes. */
      skippedFamilies: skipFamilies(hat.skipped)
    },
    supersededFigure: {
      note: 'what the paper states today, and why it is not wrong as of its date',
      indexedNights: 58,
      trioEligibleNights: 31,
      solvedNights: 26,
      simultaneousSeconds: 291561,
      why: 'computed before #3805 widened the classifier, which could not read box-layout capture names; most of the gain is later box-era capture that did not exist when the paper was written'
    }
  };
}

export function gitShort(repo) {
  try {
    return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  } catch {
    /* a detached or absent git tree leaves the field honest rather than fabricated */
    return 'unknown';
  }
}

async function main() {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, ARGV_SPEC, { tool: 'tools/sigma-corpus-headless.mjs' });
  const opt = (n, d) => {
    const i = argv.indexOf(n);
    return i < 0 ? d : argv[i + 1];
  };
  const flag = (n) => argv.includes(n);
  const corpus = opt('--corpus', '/srv/data/tepna-corpus');

  /* `--record-from` derives the committed record from a finished run's `--out` JSON plus the file
     list that run used. It launches no browser: the measurement already happened, and re-solving
     123 nights over the cold tier to add one field would be hours spent to change nothing. It
     refuses an index-only artifact, because a record with no solve behind it would publish a night
     count the hat never produced. */
  const recordFrom = opt('--record-from', null);
  if (recordFrom) {
    const prior = JSON.parse(readFileSync(recordFrom, 'utf8'));
    const listPath = opt('--list-in', null);
    const target = opt('--record', null);
    if (!listPath || !target) {
      console.error('✕ --record-from needs --list-in (the file list that run used, for the digest) and --record (where to write)');
      process.exit(2);
    }
    if (!prior.hat) {
      console.error(`✕ ${recordFrom} carries no hat — it is an --index-only artifact, and a record needs the solve`);
      process.exit(2);
    }
    const list = JSON.parse(readFileSync(listPath, 'utf8'));
    if (list.files.length !== prior.population.acceptedDistinct) {
      console.error(
        `✕ the file list holds ${list.files.length} file(s) and the run accepted ${prior.population.acceptedDistinct} — a different walk, so the digest would describe the wrong population`
      );
      process.exit(2);
    }
    const rec = buildRecord({
      corpus: prior.corpus,
      conc: +opt('--concurrency', '2'),
      entries: prior.population.entriesWalked,
      acceptedPairs: list.files.map((f) => [f.name, f.role]),
      index: prior.index,
      hat: prior.hat,
      commit: gitShort(REPO),
      invocation: `node tools/sigma-corpus-headless.mjs --corpus ${prior.corpus} --list-in <file list> --concurrency 2 --out <run.json> · node tools/sigma-corpus-headless.mjs --record-from <run.json> --list-in <file list> --record <this file>`
    });
    rec.measuredAt = prior.at;
    rec.elapsedS = prior.elapsedS;
    writeFileSync(target, JSON.stringify(rec, null, 1) + '\n');
    console.error(`▸ wrote the published-number record to ${target} from ${recordFrom}`);
    return;
  }

  const outPath = opt('--out', null);
  const conc = Math.max(1, +opt('--concurrency', '2'));
  const nightCap = opt('--nights', null) == null ? null : +opt('--nights', '0');
  const timeoutMin = +opt('--timeout-min', '360');
  const asJson = flag('--json');

  /* The walk costs ~40 min over the canonical corpus because 63 % of it is a symlink into the NAS
     cold tier. `--list-out` / `--list-in` let the index pass and the solve pass share ONE walk.
     A reused list is still checked against this run's classifier: a list that no longer classifies
     is a stale list, and reading it would measure a corpus that has moved. */
  const src = readFileSync(PAGE_JS, 'utf8');
  const classify = pageClassifier(src);
  const t0 = Date.now();
  let entries;
  let accepted;
  const listIn = opt('--list-in');
  if (listIn) {
    const prior = JSON.parse(readFileSync(listIn, 'utf8'));
    accepted = new Map();
    for (const r of prior.files) {
      const again = classify({ name: r.name });
      if (!again || again.role !== r.role) {
        console.error(`✕ --list-in is stale: ${r.name} no longer classifies as ${r.role}`);
        process.exit(2);
      }
      accepted.set(r.name, { role: r.role, path: r.path });
    }
    entries = prior.entriesWalked ?? null;
    if (!asJson) console.error(`▸ reused ${accepted.size} accepted file(s) from ${listIn} — re-classified, none stale`);
  } else {
    ({ entries, accepted } = walkAccepted(corpus, classify));
    if (!asJson) console.error(`▸ walked ${entries} entries → ${accepted.size} distinct accepted file(s) in ${((Date.now() - t0) / 1000) | 0}s`);
  }
  if (!accepted.size) {
    console.error('✕ no accepted file — wrong --corpus, or the classifier moved');
    process.exit(2);
  }
  const paths = [...accepted.values()].map((v) => v.path);
  const byRole = {};
  for (const v of accepted.values()) byRole[v.role] = (byRole[v.role] || 0) + 1;
  const listOut = opt('--list-out');
  if (listOut) {
    writeFileSync(
      listOut,
      JSON.stringify(
        {
          corpus,
          at: new Date().toISOString(),
          entriesWalked: entries,
          files: [...accepted.entries()].map(([name, v]) => ({ name, role: v.role, path: v.path }))
        },
        null,
        1
      )
    );
    if (!asJson) console.error(`▸ wrote the accepted list to ${listOut}`);
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('playwright is not installed — `npm i -D playwright` (this tool is dev-only, never bundled).');
    process.exit(2);
  }

  /* The house launcher, never a direct `chromium.launch`: it carries the AppArmor user-namespace
     case (residue `2026-09-05-playwright-blocked-by-apparmor-userns`), and this box has no
     Playwright-managed browser, so the system Chrome is the only one that starts. */
  const browser = await launch(chromium, {
    headless: !flag('--headed'),
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    args: ['--allow-file-access-from-files']
  });
  const ctx = await browser.newContext();
  await ctx.addInitScript((n) => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => n });
  }, conc);
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto('file://' + PAGE_HTML, { waitUntil: 'load', timeout: 120000 });

  /* CSP-SAFE POLL. The page ships `default-src 'self' 'unsafe-inline'` with no `'unsafe-eval'` —
     the browser-enforced half of the no-network invariant. Playwright's polling wait evaluates a
     STRING in the page and the page refuses it, so every wait below goes through `evaluate`. */
  const until = async (fn, label, limitMs) => {
    const deadline = Date.now() + limitMs;
    for (;;) {
      if (await page.evaluate(fn)) return;
      if (Date.now() > deadline) {
        throw new Error(`timed out after ${(limitMs / 60000).toFixed(1)} min waiting for ${label}`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  await until(() => !!window.SIGMA_RESULT, 'the page to publish SIGMA_RESULT', 60000);

  if (!asJson) console.error(`▸ ingesting ${paths.length} file(s) — the page reads a slice of each to key its night`);
  await page.setInputFiles('#fileInput', paths);
  await until(() => /night/.test(document.querySelector('#realStatus')?.textContent || ''), 'the ingest to index the nights', timeoutMin * 60000);

  const index = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.nchk2')];
    return {
      status: document.querySelector('#realStatus')?.textContent || '',
      indexed: rows.length,
      eligible: rows.filter((r) => !r.disabled).length,
      /* The page prints the fallback count rather than exposing it, and §∅ makes that count part of
         the population: a night keyed by a filename was keyed by the session OPEN time, not by its
         first data row. A status the regex cannot read is null, never 0. */
      keyedByName: (() => {
        const m = (document.querySelector('#realStatus')?.textContent || '').match(/(\d+) keyed by filename/);
        return m ? +m[1] : null;
      })(),
      nights: rows.map((r) => ({ key: r.getAttribute('data-k'), eligible: !r.disabled }))
    };
  });
  if (!asJson) console.error(`▸ ${index.indexed} indexed · ${index.eligible} eligible — "${index.status}"`);

  let hat = null;
  if (!flag('--index-only')) {
    if (nightCap != null) {
      await page.evaluate((n) => {
        const rows = [...document.querySelectorAll('.nchk2')].filter((r) => !r.disabled);
        rows.forEach((r, i) => {
          r.checked = i < n;
        });
      }, nightCap);
    }
    const want = nightCap == null ? index.eligible : Math.min(nightCap, index.eligible);
    if (!asJson) console.error(`▸ solving ${want} night(s) at concurrency ${conc} — this is the long leg`);
    await page.click('#procBtn2');
    await until(() => /done|no night solved|no eligible/.test(document.querySelector('#realStatus')?.textContent || ''), 'the solve to finish', timeoutMin * 60000);
    hat = await page.evaluate(() => {
      const R = window.SIGMA_RESULT || {};
      const h = R.hat || {};
      return {
        status: document.querySelector('#realStatus')?.textContent || '',
        solved: (h.windows || []).length,
        totalS: h.totalS ?? null,
        ciKind: h.ciKind ?? null,
        skipped: (h.skipped || []).map((s) => ({ label: s.label, reason: s.reason })),
        sigma: h.sigma ?? null,
        perDevice: h.perDevice ?? null,
        agg: Object.fromEntries(Object.entries(h).filter(([k, v]) => typeof v === 'number' || typeof v === 'string'))
      };
    });
  }

  const recordPath = opt('--record', null);
  if (recordPath) {
    if (!hat) {
      console.error('✕ --record needs a solved run — it would publish a night count with no solve behind it');
      process.exit(2);
    }
    writeFileSync(
      recordPath,
      JSON.stringify(
        buildRecord({
          corpus,
          conc,
          entries,
          acceptedPairs: [...accepted.entries()].map(([n, v]) => [n, v.role]),
          index,
          hat,
          commit: gitShort(REPO),
          invocation: `node tools/sigma-corpus-headless.mjs --corpus ${corpus} --concurrency ${conc} --record <this file>`
        }),
        null,
        1
      ) + '\n'
    );
    if (!asJson) console.error(`▸ wrote the published-number record to ${recordPath}`);
  }

  const out = {
    tool: 'tools/sigma-corpus-headless.mjs',
    at: new Date().toISOString(),
    corpus,
    population: { entriesWalked: entries, acceptedDistinct: accepted.size, byRole },
    index: { indexed: index.indexed, eligible: index.eligible, keyedByName: index.keyedByName, status: index.status },
    hat,
    pageErrors: consoleErrors,
    elapsedS: Math.round((Date.now() - t0) / 1000)
  };
  await browser.close();
  if (outPath) writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify(out, null, 1));
}

if (isCliEntry(import.meta.url)) await main();
