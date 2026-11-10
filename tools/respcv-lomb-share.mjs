#!/usr/bin/env node
/*
 * tools/respcv-lomb-share.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * WHICH CALL SITE SPENDS ECGDex's Lomb-Scargle TIME, measured on the PRODUCT PATH.
 *
 * THE CLAIM UNDER TEST. Residue row `2026-11-08-ecg-respcv-spends-five-lomb-calls-per-epoch-with-no-
 * consumer` (source #4673) states: "ECGDex computes `respCv` from up to five Lomb-Scargle sub-windows
 * per epoch, and only tests read it. That is about 5/6 of the ECG Lomb-Scargle time." The second
 * sentence is an inference from the CALL COUNT, and the row records no timing. This tool measures the
 * time.
 *
 * WHY A CALL COUNT CANNOT CARRY IT. `lombScargle` costs O(N · nfFull): two trig passes over N beats
 * for each of `nfFull` bins (`ecgdex-dsp.js:1438-1460`). `_respCv` cuts ONE epoch into 60 s
 * sub-windows, so the five calls share the epoch's beats between them rather than repeating them.
 * Five calls over N/5 beats each is the same work as one call over N beats when `nfFull` matches, and
 * `nf` is 160 at both sites. So the per-call-site TIME is the measurement the row's disposition needs,
 * and this tool reports it beside the call count that produced the claim.
 *
 * THE INSTRUMENT. `lombScargle` is a closure-local function declaration, so a shim on the exported
 * property intercepts none of the DSP's own calls. This tool rewrites the DECLARATION in memory —
 * never on disk — into a timing wrapper, and tags each of the three call sites with a comma
 * expression that names it. It REFUSES when the declaration or any call-site text is not found
 * exactly once. The wrapper resets the tag to `untagged` after every call, so a call site this tool
 * does not know about reports itself rather than borrowing the previous site's name: a non-zero
 * `untagged` count makes the verdict UNKNOWN, because the attribution then does not cover every call.
 *
 * THREE ARMS, interleaved so slow drift hits all three:
 *   main  — `vm.runInThisContext`: the product path, the realm the §1b revisit condition asks about.
 *   vm    — `vm.runInContext` over a fresh context: the harness realm. `tools/lomb-share-profile.mjs`
 *           measured a realm moving the SHARE and not only the total, so the arm stays.
 *   clean — the product path with NO transform: the untouched denominator, so the wrapper's own cost
 *           is measured rather than assumed.
 *
 * THE CRITERION IS PRE-STATED, and it is the row's own figure: 83.3 % (5/6). At or above it the row's
 * timing claim holds. Below it the claim does not survive the move from call counts to a clock, and
 * the disposition has to be argued from the measured share instead.
 *
 *   node tools/respcv-lomb-share.mjs --json
 *   node tools/respcv-lomb-share.mjs --json --write audits/RESPCV-LOMB-SHARE-2026-11-10.json
 *   node tools/respcv-lomb-share.mjs --runs 1
 *   node tools/respcv-lomb-share.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { populationVerdict, snapshotEntries } from './corpus-scope-core.mjs';
import { corpusRoots, findNight, listCaptureFiles, median, realmShim, resolvedRootOf, scalarDigest, sharePct, spread } from './lomb-share-profile.mjs';

const TOOL = 'tools/respcv-lomb-share.mjs';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d = null) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(1));

/* ── PRE-STATED. The row's own 5/6, written here before any run. ─────────────────────────────────── */
export const CRITERION = Object.freeze({
  name: 'respcv_share_of_ecg_lomb_time_pct',
  threshold: 83.3,
  unit: '%',
  direction: 'gte'
});
export const REALMS = Object.freeze(['main', 'vm', 'clean']);
export const DEFAULT_RUNS = 3;
export const DSP = 'ecgdex-dsp.js';
export const GLOBAL = 'ECGDSP';
export const FILES = Object.freeze(['clock.js', 'kernel-constants.js', 'ecgdex-dsp.js']);
export const NIGHT = 'Polar_H10_02849638_20260611_210411_ECG.txt';
export const DECL = '  function lombScargle(nn, times, nf) {';

/* The three call sites, by their exact source text. `recordSpectrum` sits in the no-epoch fallback
   branch, so a night that yields epochs measures 0 calls there — a measured zero, not an absence. */
export const CALL_SITES = Object.freeze([
  Object.freeze({ site: 'respCv', text: 'lombScargle(sSeg, sT, 160)', where: 'ecgdex-dsp.js:1662 — one per 60 s sub-window inside _respCv' }),
  Object.freeze({ site: 'epochSpectrum', text: 'lombScargle(seg, segT, 160)', where: 'ecgdex-dsp.js:1749 — one per epoch, the window every band metric reads' }),
  Object.freeze({ site: 'recordSpectrum', text: 'lombScargle(repSeg, repT, 300)', where: 'ecgdex-dsp.js:3158 — the no-epoch fallback only' })
]);
export const SITE_NAMES = Object.freeze([...CALL_SITES.map((s) => s.site), 'untagged']);

/* ── PURE: the source transform. Planted by --selftest, including every refusal arity. ──────────── */
export function tagSource(src) {
  const text0 = String(src);
  const declFound = text0.split(DECL).length - 1;
  const sites = {};
  if (declFound !== 1) {
    return { ok: false, declFound, sites, text: null, reason: `the lombScargle declaration was found ${declFound} time(s), not once` };
  }
  const wrapper =
    `  function lombScargle(nn, times, nf) {\n` +
    `    var __t0 = __lsNow(), __s = __lsSite;\n` +
    `    try { return __lsInner(nn, times, nf); }\n` +
    `    finally {\n` +
    `      var __d = __lsNow() - __t0;\n` +
    `      __lsAcc += __d;\n` +
    `      __lsCalls++;\n` +
    `      __lsSiteMs[__s] = (__lsSiteMs[__s] || 0) + __d;\n` +
    `      __lsSiteN[__s] = (__lsSiteN[__s] || 0) + 1;\n` +
    `      __lsSiteSamples[__s] = (__lsSiteSamples[__s] || 0) + (nn && nn.length ? nn.length : 0);\n` +
    `      __lsSiteBins[__s] = (__lsSiteBins[__s] || 0) + (nf || 0);\n` +
    `      __lsSite = 'untagged';\n` +
    `    }\n` +
    `  }\n` +
    `  function __lsInner(nn, times, nf) {`;
  let text = text0.replace(DECL, wrapper);
  for (const s of CALL_SITES) {
    const found = text.split(s.text).length - 1;
    sites[s.site] = found;
    if (found !== 1) {
      return { ok: false, declFound, sites, text: null, reason: `the ${s.site} call site was found ${found} time(s), not once` };
    }
    text = text.replace(s.text, `(__lsSite = '${s.site}', ${s.text})`);
  }
  return { ok: true, declFound, sites, text, reason: null };
}

/* The accounting globals the wrapper writes. A fresh, prototype-less map per site family, so a site
   named after an Object.prototype member cannot read as already counted. */
export function siteShim(base) {
  const g = realmShim(base);
  g.__lsSite = 'untagged';
  g.__lsSiteMs = Object.create(null);
  g.__lsSiteN = Object.create(null);
  g.__lsSiteSamples = Object.create(null);
  g.__lsSiteBins = Object.create(null);
  return g;
}

/** Every known site, explicitly, so the parent never fills a gap with a 0 it did not measure. */
export function readSites(ctx) {
  const out = {};
  for (const s of SITE_NAMES) {
    out[s] = {
      ms: +(ctx.__lsSiteMs[s] || 0).toFixed(1),
      calls: ctx.__lsSiteN[s] || 0,
      samples: ctx.__lsSiteSamples[s] || 0,
      bins: ctx.__lsSiteBins[s] || 0
    };
  }
  return out;
}

/* ── PURE: the statistic. rows: [{ realm, totalMs, lombMs, lombCalls, sites, peakRssMB }]. ──────── */
export function summarise(rows) {
  const per = {};
  for (const realm of REALMS) {
    const r = rows.filter((x) => x.realm === realm);
    if (!r.length) continue;
    const totalMs = median(r.map((x) => x.totalMs));
    const lombMs = realm === 'clean' ? null : median(r.map((x) => x.lombMs));
    const sites = {};
    if (realm !== 'clean') {
      for (const s of SITE_NAMES) {
        const pick = (f) => r.map((x) => (x.sites && x.sites[s] ? x.sites[s][f] : null));
        sites[s] = {
          ms: r1(median(pick('ms'))),
          calls: median(pick('calls')),
          samples: median(pick('samples')),
          shareOfLombPct: sharePct(median(pick('ms')), lombMs)
        };
      }
    }
    const perRunRespShare = r.map((x) => (x.sites && x.sites.respCv ? sharePct(x.sites.respCv.ms, x.lombMs) : null)).filter((x) => x != null);
    per[realm] = {
      runs: r.length,
      totalMs: r1(totalMs),
      lombMs: r1(lombMs),
      lombCalls: realm === 'clean' ? null : median(r.map((x) => x.lombCalls)),
      peakRssMB: median(r.map((x) => x.peakRssMB)),
      spreadMs: spread(r.map((x) => x.totalMs)),
      /* The instrument's own resolution. A delta no larger than this is unresolved, never absent. */
      respSharePctSpread: perRunRespShare.length > 1 ? spread(perRunRespShare) : null,
      sites
    };
  }
  return per;
}

/* ── PURE: the decision. Planted by --selftest on every branch. ─────────────────────────────────── */
export function decide(per, pop) {
  const main = per.main || null;
  const vmArm = per.vm || null;
  const clean = per.clean || null;
  const respMs = main && main.sites.respCv ? main.sites.respCv.ms : null;
  const shareOfLomb = main ? sharePct(respMs, main.lombMs) : null;
  const untagged = main && main.sites.untagged ? main.sites.untagged.calls : null;
  const result = {
    night: NIGHT,
    claimedSharePct: CRITERION.threshold,
    callSites: CALL_SITES.map((s) => ({ site: s.site, where: s.where })),
    respCvShareOfLombPct: shareOfLomb,
    respCvShareOfComputePct: main ? sharePct(respMs, main.totalMs) : null,
    vmRealmRespCvShareOfLombPct: vmArm && vmArm.sites.respCv ? sharePct(vmArm.sites.respCv.ms, vmArm.lombMs) : null,
    lombShareOfComputePct: main ? sharePct(main.lombMs, main.totalMs) : null,
    productPathTotalMs: main ? main.totalMs : null,
    cleanTotalMs: clean ? clean.totalMs : null,
    vmRealmTotalMs: vmArm ? vmArm.totalMs : null,
    realmInflation: vmArm && main && main.totalMs > 0 ? +(vmArm.totalMs / main.totalMs).toFixed(2) : null,
    instrumentOverheadPct: clean && main && clean.totalMs > 0 ? +(((main.totalMs - clean.totalMs) / clean.totalMs) * 100).toFixed(2) : null,
    instrumentOverheadMs: clean && main ? r1(main.totalMs - clean.totalMs) : null,
    instrumentOverheadResolved: clean && main && main.spreadMs != null ? Math.abs(main.totalMs - clean.totalMs) > main.spreadMs : null,
    untaggedCalls: untagged,
    productPathSpreadMs: main ? main.spreadMs : null,
    respSharePctSpread: main ? main.respSharePctSpread : null,
    peakRssMB: main ? main.peakRssMB : null,
    byRealm: per,
    criterion: CRITERION
  };
  if (pop.checked === 0 || shareOfLomb == null) {
    return { status: 'NOT_RUN', reason: pop.reason || 'no product-path arm completed, so no call site was timed', result };
  }
  if (untagged == null || untagged > 0) {
    return {
      status: 'UNKNOWN',
      reason: `${untagged} lombScargle call(s) carried no site tag, so the attribution does not cover every call`,
      result
    };
  }
  const met = shareOfLomb >= CRITERION.threshold;
  return {
    status: met ? 'PASS' : 'SHORTFALL',
    reason: met
      ? null
      : `respCv is ${shareOfLomb} % of the ECGDex Lomb-Scargle time, under the 83.3 % the row infers from its call count. The five sub-windows split one epoch's beats, so they cost about one epoch spectrum.`,
    result
  };
}

/** The first array in `out` whose elements carry `key`, found by the field rather than by a path this
    tool guesses. `null` when no such array exists, never a count of 0 (§∅). The row states that
    `respCv` "rides in the exported epoch objects", so the run reads the epoch array out of the real
    `compute()` return and reports whether the field is on it. */
export function findArrayCarrying(out, key, depth = 0) {
  if (!out || typeof out !== 'object' || depth > 6) return null;
  if (Array.isArray(out)) {
    if (out.some((e) => e && typeof e === 'object' && key in e)) return out;
    for (const e of out.slice(0, 40)) {
      const hit = findArrayCarrying(e, key, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const k of Object.keys(out)) {
    const hit = findArrayCarrying(out[k], key, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Where `respCv` appears in the DSP source, and whether any of it is at or after the export builder
    the fleet consumes. The slice runs from `ecgBuildNodeExport`'s declaration to the end of the file,
    so it is a SUPERSET of that builder: a 0 over the superset is a stronger statement than a 0 over a
    body this tool would have to brace-balance to find. `builderFound: false` refuses rather than
    reporting a 0 over a slice it never located. */
export function exportBuilderRespCv(src) {
  const lines = src.split('\n');
  const declIdx = lines.findIndex((l) => /function\s+ecgBuildNodeExport\s*\(/.test(l));
  const at = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].includes('respCv')) at.push(i + 1);
  if (declIdx < 0) return { builderFound: false, builderDeclLine: null, occurrences: at.length, lines: at, fromBuilderOn: null };
  const after = at.filter((ln) => ln >= declIdx + 1);
  return {
    builderFound: true,
    builderDeclLine: declIdx + 1,
    occurrences: at.length,
    lines: at,
    fromBuilderOn: after.length,
    note: 'the slice is the builder plus everything after it, so 0 here means 0 inside the builder'
  };
}

/* ── The child: ONE realm, ONE run, its own process, so peak RSS and the JIT are its own. ───────── */
function childRun(realm, nightPath) {
  const { classicify } = req(path.join(REPO, 'tools/build-core.js'));
  const transform = realm !== 'clean';
  let ctx;
  let run;
  if (realm === 'vm') {
    ctx = vm.createContext(siteShim({}));
    run = (code, filename) => vm.runInContext(code, ctx, { filename });
  } else {
    ctx = siteShim(globalThis);
    run = (code, filename) => vm.runInThisContext(code, { filename });
  }
  const say = (o) => process.stdout.write(`RESPCV_JSON ${JSON.stringify({ realm, ...o })}\n`);
  let tag = null;
  for (const f of FILES) {
    let src = classicify(fs.readFileSync(path.join(REPO, f), 'utf8'));
    if (transform && f === DSP) {
      tag = tagSource(src);
      if (!tag.ok) {
        say({ refused: tag.reason, declFound: tag.declFound, siteCounts: tag.sites });
        return;
      }
      src = tag.text;
    }
    run(src, f);
  }
  const text = fs.readFileSync(nightPath, 'utf8');
  const api = ctx[GLOBAL];
  if (!api || typeof api.compute !== 'function') {
    say({ refused: `${GLOBAL}.compute is not a function in the ${realm} realm` });
    return;
  }
  const t0 = Number(process.hrtime.bigint()) / 1e6;
  const out = api.compute(text);
  const totalMs = Number(process.hrtime.bigint()) / 1e6 - t0;
  const dig = scalarDigest(out);
  /* The row's fourth claim, read off the real return rather than argued. `findArrayCarrying` looks
     for the epoch series by a field every epoch object carries, so a miss is a statement about the
     return and not about a path this tool guessed. */
  const exported = findArrayCarrying(out, 'tMin');
  const respCvAnywhere = findArrayCarrying(out, 'respCv');
  say({
    totalMs: +totalMs.toFixed(1),
    lombMs: transform ? +ctx.__lsAcc.toFixed(1) : null,
    lombCalls: transform ? ctx.__lsCalls : null,
    sites: transform ? readSites(ctx) : null,
    declFound: tag ? tag.declFound : null,
    computeEpochSeries: exported ? exported.length : 0,
    respCvInComputeReturn: respCvAnywhere !== null,
    peakRssMB: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
    scalars: dig.n,
    digest: dig.sha,
    bytes: fs.statSync(nightPath).size
  });
}

/* ── The parent: interleave the arms, median the runs, emit ONE tepna.verdict/1. ────────────────── */
function spawnChild(realm, nightPath) {
  const out = execFileSync(process.execPath, ['--max-old-space-size=6144', path.join(REPO, TOOL), '--child', realm, '--night', nightPath], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const line = out.split('\n').find((l) => l.startsWith('RESPCV_JSON '));
  if (!line) throw new Error('the child printed no RESPCV_JSON line');
  return JSON.parse(line.slice('RESPCV_JSON '.length));
}

function main() {
  const Verdict = req('../verdict.js');
  const runs = Math.max(1, Number(arg('--runs', DEFAULT_RUNS)) || DEFAULT_RUNS);
  const commit = (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim().slice(0, 8);
    } catch {
      return null;
    }
  })();

  const nightPath = findNight(NIGHT);
  const popRoot = resolvedRootOf(nightPath ? [nightPath] : []);
  const popBefore = snapshotEntries(popRoot, { list: listCaptureFiles, unit: 'records' });

  const eligible = REALMS.length * runs;
  const rows = [];
  const refusals = [];
  for (let r = 0; r < runs && nightPath; r++) {
    for (const realm of REALMS) {
      let got;
      try {
        got = spawnChild(realm, nightPath);
      } catch (e) {
        refusals.push(`${realm}/run${r + 1}: ${String(e.message || e).slice(0, 160)}`);
        continue;
      }
      if (got.refused) refusals.push(`${realm}/run${r + 1}: ${got.refused}`);
      else rows.push(got);
    }
  }

  const pop = {
    checked: rows.length,
    eligible,
    excluded: eligible - rows.length,
    reason: nightPath ? null : `the corpus holds no ${NIGHT} — searched ${corpusRoots().join(', ')}`
  };
  const corpusPopulation = populationVerdict(popBefore, snapshotEntries(popRoot, { list: listCaptureFiles, unit: 'records' }), { tool: TOOL, evidence: [TOOL] });
  const source = exportBuilderRespCv(fs.readFileSync(path.join(REPO, DSP), 'utf8'));
  const d = decide(summarise(rows), pop);
  const mainRows = rows.filter((x) => x.realm === 'main');
  const v = Verdict.make({
    gate: 'respcv-lomb-share',
    status: d.status,
    scope: 'internal',
    population: { checked: pop.checked, eligible: pop.eligible, excluded: pop.excluded },
    criterion: {
      ...CRITERION,
      preStated:
        "83.3 % is the residue row 2026-11-08-ecg-respcv-spends-five-lomb-calls-per-epoch-with-no-consumer's own 'about 5/6 of the ECG Lomb-Scargle time', which it infers from the call count. No threshold here comes from this run."
    },
    result: {
      ...d.result,
      runs,
      realms: [...REALMS],
      /* The row's fourth claim, in two measurements. The runtime one: `compute()`'s return carries
         no epoch series at all, so the field cannot ride in one. The source one: the export the
         fleet actually consumes is `ecgBuildNodeExport` (`ecgdex-dsp.js:7011` says so in those
         words), and `respCv` appears nowhere from that builder to the end of the file. */
      computeEpochSeriesEpochs: mainRows.length ? median(mainRows.map((x) => x.computeEpochSeries)) : null,
      respCvInComputeReturn: mainRows.length ? mainRows[0].respCvInComputeReturn : null,
      ...(source ? { exportBuilder: source } : {}),
      outputDigests: [...new Set(rows.map((x) => x.digest))],
      corpusPopulation,
      refusals,
      note: 'the wrapper resets the site tag after every call, so untaggedCalls > 0 means the attribution missed a call site and the verdict is UNKNOWN rather than a share quoted over part of the time'
    },
    evidence: [TOOL, 'ecgdex-dsp.js', 'briefs/REM-STAGING-REDESIGN-2026-07-28-BRIEF.md', 'tools/lomb-share-profile.mjs'],
    reason: d.reason,
    producedBy: { tool: TOOL, commit }
  });
  /* `validate` answers `{ ok, errors, checked }`. A `.length` read of that object is `undefined`,
     so a guard written on it never fires (`tools/astgrep-rules/no-verdict-validate-length.yml`). */
  const ck = Verdict.validate(v);
  if (!ck.ok) {
    console.error(`${TOOL}: the verdict is invalid — ${ck.errors.join('; ')}`);
    process.exit(2);
  }
  const text = `${JSON.stringify(v, null, 1)}\n`;
  const w = arg('--write', null);
  if (w) fs.writeFileSync(path.join(REPO, w), text);
  if (has('--json') || w) process.stdout.write(text);
  if (!has('--json')) {
    const m = d.result.byRealm.main;
    if (m) {
      for (const s of SITE_NAMES) {
        const x = m.sites[s];
        console.error(
          `${s.padEnd(15)} ${String(x.ms).padStart(8)} ms  ${String(x.calls).padStart(5)} call(s)  ${String(x.shareOfLombPct).padStart(6)} % of lomb  ${String(x.samples).padStart(8)} beat-sample(s)`
        );
      }
      console.error(`lomb ${m.lombMs} ms of ${m.totalMs} ms compute · realm inflation ${d.result.realmInflation}× · spread ${m.spreadMs} ms`);
    }
    console.error(`corpus population: ${corpusPopulation.status} — ${corpusPopulation.population.checked} record(s) of ${corpusPopulation.population.eligible} under ${popRoot}`);
    console.error(`${v.status}${v.reason ? ` — ${v.reason}` : ''}`);
  }
  process.exit(v.status === 'PASS' || v.status === 'SHORTFALL' ? 0 : 1);
}

/* ── Selftest. Every assertion is counted by the helper; the number is never typed. ─────────────── */
function selftest() {
  let n = 0;
  const fails = [];
  const ok = (what, cond, got) => {
    n++;
    if (!cond) fails.push(`${what} — got ${got}`);
  };

  const src = fs.readFileSync(path.join(REPO, DSP), 'utf8');
  const t = tagSource(src);
  ok('the ECGDex lombScargle declaration is found exactly once', t.ok && t.declFound === 1, `${t.ok}/${t.declFound}/${t.reason}`);
  for (const s of CALL_SITES) {
    ok(`the ${s.site} call site is found exactly once in the real source`, t.sites[s.site] === 1, t.sites[s.site]);
    ok(`the ${s.site} tag is written into the transformed source`, t.text.includes(`(__lsSite = '${s.site}', ${s.text})`), 'absent');
  }
  ok('the wrapper keeps the original body under a new name', t.text.includes('function __lsInner(nn, times, nf) {'), 'absent');
  ok('the transform leaves the source on disk untouched', fs.readFileSync(path.join(REPO, DSP), 'utf8') === src, 'the file moved');

  ok(
    'an absent declaration refuses and names the count',
    (() => {
      const r = tagSource('function other() {}');
      return !r.ok && r.declFound === 0 && /declaration/.test(r.reason);
    })(),
    'no refusal'
  );
  ok(
    'two declarations refuse',
    (() => {
      const r = tagSource(`${DECL}\n${DECL}\n`);
      return !r.ok && r.declFound === 2;
    })(),
    'no refusal'
  );
  ok(
    'a call site present twice refuses and names that site',
    (() => {
      const r = tagSource(`${DECL}\n  }\n  ${CALL_SITES[0].text};\n  ${CALL_SITES[0].text};\n`);
      return !r.ok && r.sites.respCv === 2 && r.reason.includes('respCv');
    })(),
    'no refusal'
  );
  ok(
    'a call site that is absent refuses before any tag is written',
    (() => {
      const r = tagSource(`${DECL}\n  }\n`);
      return !r.ok && r.sites.respCv === 0 && r.text === null;
    })(),
    'no refusal'
  );

  /* The attribution is PLANTED in a realm, never reasoned about. Four calls, three tagged. */
  const plant =
    `var sSeg = [1, 2, 3], sT = [0, 1, 2];\n` +
    `var seg = [1, 2, 3, 4], segT = [0, 1, 2, 3];\n` +
    `var repSeg = [5, 6], repT = [0, 1];\n` +
    `${DECL}\n    return { respRate: nn.length, nf: nf };\n  }\n` +
    `  __r1 = ${CALL_SITES[0].text};\n` +
    `  __r2 = ${CALL_SITES[1].text};\n` +
    `  __r3 = ${CALL_SITES[2].text};\n` +
    `  __r4 = lombScargle([7, 7, 7, 7, 7], [0, 1, 2, 3, 4], 11);\n`;
  const tp = tagSource(plant);
  ok('the plant transforms cleanly', tp.ok, tp.reason);
  const sand = siteShim({});
  vm.runInNewContext(tp.text, sand);
  ok('a tagged call returns exactly what the body returned', sand.__r2 && sand.__r2.respRate === 4 && sand.__r2.nf === 160, JSON.stringify(sand.__r2));
  ok('the wrapper counts every call, tagged or not', sand.__lsCalls === 4, sand.__lsCalls);
  const read = readSites(sand);
  ok('each tagged site is credited with its own single call', read.respCv.calls === 1 && read.epochSpectrum.calls === 1 && read.recordSpectrum.calls === 1, JSON.stringify(read));
  ok('an untagged call site reports itself rather than borrowing the previous name', read.untagged.calls === 1 && read.untagged.samples === 5, JSON.stringify(read.untagged));
  ok('the sample count is the first argument length at each site', read.respCv.samples === 3 && read.epochSpectrum.samples === 4 && read.recordSpectrum.samples === 2, JSON.stringify(read));
  ok('the bin count is the nf argument at each site', read.respCv.bins === 160 && read.recordSpectrum.bins === 300, JSON.stringify(read));
  ok('the tag is reset after the last call, so a later untagged call cannot inherit it', sand.__lsSite === 'untagged', sand.__lsSite);
  ok(
    'every site family is reported, including one that never fired',
    (() => {
      const fresh = readSites(siteShim({}));
      return SITE_NAMES.every((s) => fresh[s] && fresh[s].calls === 0 && fresh[s].ms === 0);
    })(),
    'a site family is missing'
  );
  ok(
    'the per-site durations sum to the accumulator the wrapper kept',
    Math.abs(SITE_NAMES.reduce((a, s) => a + read[s].ms, 0) - +sand.__lsAcc.toFixed(1)) < 0.5,
    `${SITE_NAMES.reduce((a, s) => a + read[s].ms, 0)} vs ${sand.__lsAcc}`
  );

  /* The statistic and the decision, over planted rows. */
  const row = (realm, totalMs, lombMs, resp, epoch, untaggedCalls = 0) => ({
    realm,
    totalMs,
    lombMs,
    lombCalls: 100,
    peakRssMB: 900,
    digest: 'a',
    computeEpochSeries: 0,
    respCvInComputeReturn: false,
    sites: {
      respCv: { ms: resp, calls: 95, samples: 900, bins: 15200 },
      epochSpectrum: { ms: epoch, calls: 19, samples: 900, bins: 3040 },
      recordSpectrum: { ms: 0, calls: 0, samples: 0, bins: 0 },
      untagged: { ms: 0, calls: untaggedCalls, samples: 0, bins: 0 }
    }
  });
  const half = summarise([row('main', 1000, 600, 300, 300), row('main', 1020, 610, 305, 305), row('vm', 4000, 3200, 1600, 1600), row('clean', 990, null, 0, 0)]);
  ok('the product-path arm medians over its runs', half.main.totalMs === 1010 && half.main.lombMs === 605, JSON.stringify([half.main.totalMs, half.main.lombMs]));
  ok("a site's share is taken against the lomb time, not the compute time", half.main.sites.respCv.shareOfLombPct === 50, half.main.sites.respCv.shareOfLombPct);
  ok('the clean arm reports no lomb time and no sites, because it carries no wrapper', half.clean.lombMs === null && Object.keys(half.clean.sites).length === 0, JSON.stringify(half.clean));
  ok('the within-arm share spread is reported as the resolution', half.main.respSharePctSpread != null, String(half.main.respSharePctSpread));
  const dHalf = decide(half, { checked: 4, eligible: 4, excluded: 0, reason: null });
  ok('a measured half of the lomb time falls short of the claimed 5/6', dHalf.status === 'SHORTFALL' && /under the 83.3 %/.test(dHalf.reason), `${dHalf.status}/${dHalf.reason}`);
  ok('the shortfall still reports the share of the whole compute', dHalf.result.respCvShareOfComputePct === 29.95, dHalf.result.respCvShareOfComputePct);
  ok('the realm inflation is the vm total over the product-path total', dHalf.result.realmInflation === 3.96, dHalf.result.realmInflation);
  const dMost = decide(summarise([row('main', 1000, 600, 540, 60), row('clean', 1000, null, 0, 0)]), { checked: 2, eligible: 2, excluded: 0, reason: null });
  ok('a share at or above the claim passes, and carries no reason', dMost.status === 'PASS' && dMost.reason === null, `${dMost.status}/${dMost.reason}`);
  const dUn = decide(summarise([row('main', 1000, 600, 300, 300, 7)]), { checked: 1, eligible: 1, excluded: 0, reason: null });
  ok('an untagged call makes the attribution UNKNOWN rather than a share over part of the time', dUn.status === 'UNKNOWN' && /no site tag/.test(dUn.reason), `${dUn.status}/${dUn.reason}`);
  const dNone = decide(summarise([]), { checked: 0, eligible: 3, excluded: 3, reason: 'the corpus holds no night' });
  ok('no arm at all reports NOT_RUN and never a 0 % share', dNone.status === 'NOT_RUN' && dNone.result.respCvShareOfLombPct === null, `${dNone.status}/${dNone.result.respCvShareOfLombPct}`);
  const dUnres = decide(summarise([row('main', 1000, 600, 300, 300), row('main', 1100, 600, 300, 300), row('clean', 1040, null, 0, 0)]), { checked: 3, eligible: 3, excluded: 0, reason: null });
  ok('an overhead smaller than the arm spread reads as unresolved, not as absent', dUnres.result.instrumentOverheadResolved === false, String(dUnres.result.instrumentOverheadResolved));

  /* The exported epoch array is found by the field under test, never by a guessed path. */
  ok(
    'the epoch array is found by a field it carries, however deeply it is nested',
    (() => {
      const hit = findArrayCarrying(
        {
          a: {
            b: {
              c: {
                rows: [
                  { tMin: 0, respCv: 0.09 },
                  { tMin: 5, respCv: null }
                ]
              }
            }
          }
        },
        'tMin'
      );
      return Array.isArray(hit) && hit.length === 2;
    })(),
    'not found'
  );
  ok(
    'an epoch array that carries no respCv is still found by tMin, so the absence is reported rather than read as no epochs',
    (() => {
      const out = { measurement: { epochs: [{ tMin: 0 }, { tMin: 5 }] } };
      const ex = findArrayCarrying(out, 'tMin');
      return ex && ex.length === 2 && findArrayCarrying(out, 'respCv') === null;
    })(),
    'misread'
  );
  ok(
    'a null respCv still counts the epoch as carrying the field, and only a non-null counts as measured',
    (() => {
      const hit = findArrayCarrying({ epochs: [{ respCv: 0.04 }, { respCv: null }] }, 'respCv');
      return hit.length === 2 && hit.filter((e) => e.respCv != null).length === 1;
    })(),
    'miscounted'
  );

  /* The export-shape claim, measured on the real source. */
  const eb = exportBuilderRespCv(src);
  ok('the export builder is located by its declaration, so the slice is never a guess', eb.builderFound && eb.builderDeclLine > 0, `${eb.builderFound}/${eb.builderDeclLine}`);
  ok(
    'respCv appears only where the DSP computes it, and nowhere from the export builder on',
    eb.occurrences === 3 && eb.fromBuilderOn === 0,
    `${eb.occurrences} occurrences at ${eb.lines.join(',')}; ${eb.fromBuilderOn} from line ${eb.builderDeclLine} on`
  );
  ok(
    'a source with no export builder refuses rather than reporting a 0 over a slice it never found',
    (() => {
      const r = exportBuilderRespCv('var respCv = 1;\n');
      return r.builderFound === false && r.fromBuilderOn === null && r.occurrences === 1;
    })(),
    'reported a count anyway'
  );

  /* The corpus population: this tool walks a corpus root, so it owes a verdict over what it read. */
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'respcv-selftest-'));
  fs.writeFileSync(path.join(tmp, 'A_ECG.txt'), 'x');
  fs.mkdirSync(path.join(tmp, 'nightly'));
  fs.writeFileSync(path.join(tmp, 'nightly', 'B_PPG.txt'), 'x');
  const snapA = snapshotEntries(tmp, { list: listCaptureFiles, unit: 'records' });
  ok('the population snapshot names the lister that chose its members', snapA.rule === 'listCaptureFiles', String(snapA.rule));
  ok('the population counts the records under the root the night came from', snapA.ok && snapA.n === 2, `${snapA.ok}/${snapA.n}`);
  fs.writeFileSync(path.join(tmp, 'C_ECG.txt'), 'x');
  const moved = populationVerdict(snapA, snapshotEntries(tmp, { list: listCaptureFiles, unit: 'records' }), { tool: TOOL, at: '2026-11-10T00:00:00Z' });
  ok('a corpus that moved under the run does not pass', moved.status !== 'PASS' && moved.reason != null, `${moved.status}/${moved.reason}`);
  ok(
    'the root-pick takes the root that actually held the night',
    resolvedRootOf([path.join(tmp, 'nightly', 'B_PPG.txt')], ['/nowhere', tmp]) === tmp,
    String(resolvedRootOf([path.join(tmp, 'nightly', 'B_PPG.txt')], ['/nowhere', tmp]))
  );
  fs.rmSync(tmp, { recursive: true, force: true });

  if (fails.length) {
    for (const f of fails) console.error(`✗ ${f}`);
    console.error(`${fails.length} of ${n} selftests FAILED`);
    process.exit(1);
  }
  console.log(`all ${n} selftests passed`);
}

if (isCliEntry(import.meta.url)) {
  refuseUnknownArgvOrExit(argv, { boolean: ['--json', '--selftest'], valued: ['--write', '--runs', '--child', '--night'] }, { tool: TOOL });
  if (has('--selftest')) selftest();
  else if (has('--child')) childRun(arg('--child', 'main'), arg('--night'));
  else main();
}
