#!/usr/bin/env node
/*
 * tools/lomb-share-profile.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * `lombScargle`'s SHARE of a real ECGDex and PpgDex `compute()`, measured on the PRODUCT PATH.
 *
 * WHY THIS TOOL EXISTS, AND WHY IT IS A MEASUREMENT AND NOT AN OPTIMISATION.
 * `briefs/PROFILED-HOTSPOTS-CI-AND-DSP-2026-07-12-BRIEF.md` §1b records a decision of 2026-07-21:
 * **LEAVE `lombScargle` as-is.** It gives three reasons (sharding already took the gate from ~4 m to
 * ~1 m; a bit-identical CPU speedup re-associates floats inside a gated DSP; a non-identical speedup
 * changes published metric values, which needs fixture regeneration and owner sign-off). It then names
 * ONE revisit condition, verbatim: "Revisit only if a browser/`vm.runInThisContext` profile of the real
 * product pipeline (not the vm-realm harness — §0/§3's lesson) shows `lombScargle` is a genuine
 * product-path hotspot worth a metric-moving change."
 *
 * Residue `2026-11-08-lomb-scargle-makes-two-trig-passes-per-bin-and-sample` (#4673) claims 66 % of an
 * 8 h ECG compute and 28 % of an 8 h PPG compute. No tool in `tools/` profiles the product path, so the
 * claim and the 2026-07-21 decision have never met. This tool measures the revisit condition.
 *
 * THE INSTRUMENT. `lombScargle` is a closure-local function declaration, so patching the exported
 * property does NOT intercept the DSP's own calls. This tool rewrites the DECLARATION in memory —
 * never on disk — into a timing wrapper plus the original body under a new name, and refuses
 * (NOT_RUN) when the declaration text is not found exactly once.
 *
 * THREE ARMS per node, each a separate process, interleaved so slow drift hits all three:
 *   main  — `vm.runInThisContext`: the product path, the realm §1b asks about.
 *   vm    — `vm.runInContext` over a fresh context: the harness realm, the CONTROL. §0 of that brief
 *           measured a vm realm inflating tight numeric loops up to 12.3×, and §M1's retraction of a
 *           28 % finding is what that inflation cost. The arm quantifies the inflation here.
 *   clean — the product path with NO transform: the denominator the instrument did not touch, so the
 *           wrapper's own cost is reported rather than assumed.
 *
 * THE CRITERION IS PRE-STATED, and not by this tool: 35 %, which is §1b's own figure for `lombScargle`
 * ("35 % of the pre-shard gate"), carried into its revisit condition. A share at or above it on the
 * product path means the condition is met and the disposition is the owner's, because §1b's reasons 2
 * and 3 make any repair a metric decision. A share below it means the vm-realm figure did not survive
 * the move to the product path, exactly as §0 warns, and §1b's LEAVE stands on its own evidence.
 *
 *   node tools/lomb-share-profile.mjs --json
 *   node tools/lomb-share-profile.mjs --json --write audits/LOMB-SHARE-PROFILE-2026-11-10.json
 *   node tools/lomb-share-profile.mjs --json --only ecg --runs 1
 *   node tools/lomb-share-profile.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { populationVerdict, snapshotEntries } from './corpus-scope-core.mjs';

const TOOL = 'tools/lomb-share-profile.mjs';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d = null) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);

/* ── PRE-STATED. §1b's own figure, copied from the brief, not chosen after a run. ───────────────── */
export const CRITERION = Object.freeze({
  name: 'lomb_self_share_pct_product_path',
  threshold: 35,
  unit: '%',
  direction: 'gte'
});
export const REALMS = Object.freeze(['main', 'vm', 'clean']);
export const DEFAULT_RUNS = 3;

/* The claimed shares are the residue row's, recorded here so the result is read against the claim. */
export const NODES = Object.freeze({
  ecg: Object.freeze({
    global: 'ECGDSP',
    dsp: 'ecgdex-dsp.js',
    decl: '  function lombScargle(nn, times, nf) {',
    params: 'nn, times, nf',
    files: Object.freeze(['clock.js', 'kernel-constants.js', 'ecgdex-dsp.js']),
    night: 'Polar_H10_02849638_20260611_210411_ECG.txt',
    claimPct: 66
  }),
  ppg: Object.freeze({
    global: 'PPGDSP',
    dsp: 'ppgdex-dsp.js',
    decl: '  function lombScargle(tt, nn) {',
    params: 'tt, nn',
    files: Object.freeze(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ppgdex-registry.js', 'ppgdex-morph.js', 'ppgdex-dsp.js']),
    night: 'Polar_Sense_0C301E3F_20260611_210416_PPG.txt',
    claimPct: 28
  })
});

/* ── PURE: the source transform. Planted by --selftest, including both refusal arities. ─────────── */
export function wrapSource(src, decl, params) {
  const found = String(src).split(decl).length - 1;
  if (found !== 1) return { ok: false, found, text: null };
  const wrapper =
    `  function lombScargle(${params}) { var __t0 = __lsNow(); try { return __lsInner(${params}); }` +
    ` finally { __lsAcc += __lsNow() - __t0; __lsCalls++; } }\n` +
    `  function __lsInner(${params}) {`;
  return { ok: true, found, text: String(src).replace(decl, wrapper) };
}

/* ── PURE: the statistic and the decision. Planted by --selftest. ───────────────────────────────── */
export function median(xs) {
  const a = xs
    .filter(Number.isFinite)
    .slice()
    .sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** The within-arm spread: max − min, null below two runs. It is the resolution, never a claim. */
export function spread(xs) {
  const a = xs.filter(Number.isFinite);
  if (a.length < 2) return null;
  return +(Math.max(...a) - Math.min(...a)).toFixed(2);
}

export function sharePct(lombMs, totalMs) {
  if (!Number.isFinite(lombMs) || !Number.isFinite(totalMs) || totalMs <= 0) return null;
  return +((lombMs / totalMs) * 100).toFixed(2);
}

/** rows: [{ node, realm, totalMs, lombMs, lombCalls, peakRssMB }] → medians per node and realm. */
export function summarise(rows) {
  const out = {};
  for (const node of Object.keys(NODES)) {
    const per = {};
    for (const realm of REALMS) {
      const r = rows.filter((x) => x.node === node && x.realm === realm);
      if (!r.length) continue;
      const totalMs = median(r.map((x) => x.totalMs));
      const lombMs = realm === 'clean' ? null : median(r.map((x) => x.lombMs));
      const perRunShares = r.map((x) => sharePct(x.lombMs, x.totalMs)).filter((x) => x != null);
      per[realm] = {
        runs: r.length,
        totalMs: totalMs == null ? null : +totalMs.toFixed(1),
        lombMs: lombMs == null ? null : +lombMs.toFixed(1),
        lombCalls: realm === 'clean' ? null : median(r.map((x) => x.lombCalls)),
        peakRssMB: median(r.map((x) => x.peakRssMB)),
        sharePct: realm === 'clean' ? null : sharePct(lombMs, totalMs),
        /* The SPREAD is this instrument's own resolution. A delta no larger than it is unresolved,
           so the overhead leg below reports the number and says whether the run could see it. */
        spreadMs: spread(r.map((x) => x.totalMs)),
        sharePctSpread: perRunShares.length > 1 ? spread(perRunShares) : null
      };
    }
    if (Object.keys(per).length) out[node] = per;
  }
  return out;
}

/** The verdict fields. `meds` from summarise(); `pop` the child-run population. */
export function decide(meds, pop) {
  const nodes = {};
  for (const [k, per] of Object.entries(meds)) {
    const main = per.main || null;
    const vmArm = per.vm || null;
    const clean = per.clean || null;
    nodes[k] = {
      night: NODES[k].night,
      claimedPct: NODES[k].claimPct,
      productPathSharePct: main ? main.sharePct : null,
      vmRealmSharePct: vmArm ? vmArm.sharePct : null,
      lombCalls: main ? main.lombCalls : null,
      productPathTotalMs: main ? main.totalMs : null,
      cleanTotalMs: clean ? clean.totalMs : null,
      vmRealmTotalMs: vmArm ? vmArm.totalMs : null,
      realmInflation: vmArm && main && main.totalMs > 0 ? +(vmArm.totalMs / main.totalMs).toFixed(2) : null,
      instrumentOverheadPct: clean && main && clean.totalMs > 0 ? +(((main.totalMs - clean.totalMs) / clean.totalMs) * 100).toFixed(2) : null,
      instrumentOverheadMs: clean && main ? +(main.totalMs - clean.totalMs).toFixed(1) : null,
      /* A wrapper cost smaller than the arms' own spread is UNRESOLVED, not absent (§∅). */
      instrumentOverheadResolved: clean && main && clean.spreadMs != null && main.spreadMs != null ? Math.abs(main.totalMs - clean.totalMs) > Math.max(main.spreadMs, clean.spreadMs) : null,
      productPathSharePctSpread: main ? main.sharePctSpread : null,
      productPathSpreadMs: main ? main.spreadMs : null,
      peakRssMB: main ? main.peakRssMB : null
    };
  }
  const ecg = nodes.ecg ? nodes.ecg.productPathSharePct : null;
  if (pop.checked === 0 || ecg == null) {
    return {
      status: 'NOT_RUN',
      reason: pop.reason || 'no product-path arm completed, so the revisit condition was not examined on either node',
      result: { nodes, criterion: CRITERION }
    };
  }
  const met = ecg >= CRITERION.threshold;
  return {
    status: met ? 'PASS' : 'SHORTFALL',
    reason: met ? null : `lombScargle is ${ecg} % of an ECGDex product-path compute, below the 35 % §1b pre-stated, so the revisit condition is not met and §1b's LEAVE stands`,
    result: { nodes, criterion: CRITERION }
  };
}

/* ── The corpus. $DEX_UPLOADS → the canonical corpus root → this checkout (docs/CORPUS-LOCATIONS.md).
   A worktree holds no recordings, so a search that finds nothing REFUSES and names where it looked. */
export function corpusRoots() {
  const r = [];
  if (process.env.DEX_UPLOADS) r.push(process.env.DEX_UPLOADS);
  r.push('/srv/data/tepna-corpus/uploads', path.join(REPO, 'uploads'));
  return r.filter((p, i) => r.indexOf(p) === i);
}

export function findNight(base, roots = corpusRoots()) {
  for (const root of roots) {
    const direct = path.join(root, base);
    if (fs.existsSync(direct)) return direct;
    let kids = [];
    try {
      kids = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of kids) {
      if (!d.isDirectory() && !d.isSymbolicLink()) continue;
      const p = path.join(root, d.name, base);
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        /* an unreadable subtree is not a hit */
      }
    }
  }
  return null;
}

/* ── THE POPULATION IS MEASURED, NOT ASSUMED. `findNight` enumerates a corpus root and one
   subdirectory level, so this tool is a corpus enumerator and owes a population verdict: the
   capture set it searched can move while the profile runs (the corpus re-tier service rewrites it
   daily), and a share quoted over a night set nobody re-read describes neither set. The lister IS
   the rule, and it carries a name so the snapshot can publish which rule chose its members. */
export function listCaptureFiles(root) {
  const out = [];
  const capture = (name) => /\.(?:txt|csv|edf)$/i.test(name);
  let kids = [];
  try {
    kids = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    throw new Error('ENOENT');
  }
  for (const d of kids) {
    if (d.isFile() && capture(d.name)) out.push(d.name);
    if (!d.isDirectory() && !d.isSymbolicLink()) continue;
    let inner = [];
    try {
      inner = fs.readdirSync(path.join(root, d.name));
    } catch {
      continue;
    }
    for (const f of inner) if (capture(f)) out.push(`${d.name}/${f}`);
  }
  return out;
}

/* The root the nights actually came from, so the snapshot walks the tree the run read rather than
   the first candidate on the list. With no night resolved there is nothing to match, and the first
   candidate is what `findNight` looked at first. */
export function resolvedRootOf(nightPaths, roots = corpusRoots()) {
  for (const p of nightPaths) {
    const hit = roots.find((r) => String(p).startsWith(r + path.sep));
    if (hit) return hit;
  }
  return roots[0] || null;
}

/* ── The child: ONE (node, realm) run in its own process, so peak RSS and the JIT are its own. ─── */
function realmShim(g) {
  const noop = () => {};
  /* The product-path arm shims the REAL global, where `navigator` is getter-only, so every property
     goes through one setter that falls back to defineProperty and leaves a usable value in place. */
  const set = (k, v) => {
    if (g[k] != null && (k === 'navigator' || k === 'console')) return;
    try {
      g[k] = v;
      if (g[k] === v) return;
    } catch {
      /* fall through to defineProperty */
    }
    try {
      Object.defineProperty(g, k, { value: v, writable: true, configurable: true });
    } catch {
      /* a frozen global property is the realm's, not ours to replace */
    }
  };
  set('window', g);
  set('self', g);
  if (g !== globalThis) set('globalThis', g);
  set('console', console);
  set('setTimeout', setTimeout);
  set('clearTimeout', clearTimeout);
  set('addEventListener', noop);
  set('removeEventListener', noop);
  set('document', {
    createElement: () => ({ style: {}, getContext: () => null, appendChild: noop }),
    getElementById: () => null,
    addEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    head: { appendChild: noop },
    body: {
      appendChild: noop,
      dataset: {},
      style: {},
      setAttribute: noop,
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false }
    },
    documentElement: { outerHTML: '' }
  });
  set('navigator', { userAgent: 'v' });
  set('localStorage', { getItem: () => null, setItem: noop, removeItem: noop });
  set('__lsNow', () => Number(process.hrtime.bigint()) / 1e6);
  g.__lsAcc = 0;
  g.__lsCalls = 0;
  return g;
}

/** A small, cheap cross-realm equality read: the top-level finite numbers of the output. */
function scalarDigest(out) {
  const pick = [];
  const walk = (o, prefix, depth) => {
    if (!o || typeof o !== 'object' || depth > 1) return;
    for (const k of Object.keys(o).sort().slice(0, 40)) {
      const v = o[k];
      if (typeof v === 'number' && Number.isFinite(v)) pick.push(`${prefix}${k}=${v.toFixed(6)}`);
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, `${prefix}${k}.`, depth + 1);
    }
  };
  walk(out, '', 0);
  const text = pick.join('|');
  return {
    n: pick.length,
    sha: req('node:crypto').createHash('sha256').update(text).digest('hex').slice(0, 12)
  };
}

function childRun(key, realm, nightPath) {
  const node = NODES[key];
  const { classicify } = req(path.join(REPO, 'tools/build-core.js'));
  const transform = realm !== 'clean';
  let ctx;
  let run;
  if (realm === 'vm') {
    ctx = vm.createContext(realmShim({}));
    run = (code, filename) => vm.runInContext(code, ctx, { filename });
  } else {
    ctx = realmShim(globalThis);
    run = (code, filename) => vm.runInThisContext(code, { filename });
  }
  let found = null;
  for (const f of node.files) {
    let src = classicify(fs.readFileSync(path.join(REPO, f), 'utf8'));
    if (transform && f === node.dsp) {
      const w = wrapSource(src, node.decl, node.params);
      found = w.found;
      if (!w.ok) {
        process.stdout.write(`LOMB_JSON ${JSON.stringify({ node: key, realm, refused: `declaration found ${w.found} times, not once`, declFound: w.found })}\n`);
        return;
      }
      src = w.text;
    }
    run(src, f);
  }
  const text = fs.readFileSync(nightPath, 'utf8');
  const DSP = ctx[node.global];
  if (!DSP || typeof DSP.compute !== 'function') {
    process.stdout.write(`LOMB_JSON ${JSON.stringify({ node: key, realm, refused: `${node.global}.compute is not a function in the ${realm} realm` })}\n`);
    return;
  }
  const t0 = Number(process.hrtime.bigint()) / 1e6;
  const out = DSP.compute(text);
  const totalMs = Number(process.hrtime.bigint()) / 1e6 - t0;
  const dig = scalarDigest(out);
  process.stdout.write(
    `LOMB_JSON ${JSON.stringify({
      node: key,
      realm,
      totalMs: +totalMs.toFixed(1),
      lombMs: transform ? +ctx.__lsAcc.toFixed(1) : null,
      lombCalls: transform ? ctx.__lsCalls : null,
      declFound: found,
      peakRssMB: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
      scalars: dig.n,
      digest: dig.sha,
      bytes: fs.statSync(nightPath).size
    })}\n`
  );
}

/* ── The parent: interleave the arms, median the runs, emit ONE tepna.verdict/1. ────────────────── */
function spawnChild(key, realm, nightPath) {
  const out = execFileSync(process.execPath, ['--max-old-space-size=6144', path.join(REPO, TOOL), '--child', key, '--realm', realm, '--night', nightPath], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const line = out.split('\n').find((l) => l.startsWith('LOMB_JSON '));
  if (!line) throw new Error('the child printed no LOMB_JSON line');
  return JSON.parse(line.slice('LOMB_JSON '.length));
}

function main() {
  const Verdict = req('../verdict.js');
  const runs = Math.max(1, Number(arg('--runs', DEFAULT_RUNS)) || DEFAULT_RUNS);
  const only = arg('--only', null);
  const keys = only ? [only] : Object.keys(NODES);
  const commit = (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim().slice(0, 8);
    } catch {
      return null;
    }
  })();

  const nights = {};
  const missing = [];
  for (const k of keys) {
    if (!NODES[k]) {
      console.error(`${TOOL}: --only ${k} is not a node (${Object.keys(NODES).join(', ')})`);
      process.exit(2);
    }
    const p = findNight(NODES[k].night);
    if (p) nights[k] = p;
    else missing.push(`${k}: ${NODES[k].night}`);
  }

  const popRoot = resolvedRootOf(Object.values(nights));
  const popBefore = snapshotEntries(popRoot, { list: listCaptureFiles, unit: 'records' });

  const eligible = keys.length * REALMS.length * runs;
  const rows = [];
  const refusals = [];
  for (let r = 0; r < runs; r++) {
    for (const realm of REALMS) {
      for (const k of keys) {
        if (!nights[k]) continue;
        let got;
        try {
          got = spawnChild(k, realm, nights[k]);
        } catch (e) {
          refusals.push(`${k}/${realm}/run${r + 1}: ${String(e.message || e).slice(0, 160)}`);
          continue;
        }
        if (got.refused) refusals.push(`${k}/${realm}/run${r + 1}: ${got.refused}`);
        else rows.push(got);
      }
    }
  }

  const pop = {
    checked: rows.length,
    eligible,
    excluded: eligible - rows.length,
    reason: missing.length ? `the corpus holds no ${missing.join(' and ')} — searched ${corpusRoots().join(', ')}` : null
  };
  const corpusPopulation = populationVerdict(popBefore, snapshotEntries(popRoot, { list: listCaptureFiles, unit: 'records' }), { tool: TOOL, evidence: [TOOL] });
  const d = decide(summarise(rows), pop);
  const digests = {};
  for (const k of keys) {
    const set = new Set(rows.filter((x) => x.node === k).map((x) => x.digest));
    if (set.size) digests[k] = [...set];
  }
  const v = Verdict.make({
    gate: 'lomb-share-profile',
    status: d.status,
    scope: 'internal',
    population: { checked: pop.checked, eligible: pop.eligible, excluded: pop.excluded },
    criterion: {
      ...CRITERION,
      preStated:
        "35 % is briefs/PROFILED-HOTSPOTS-CI-AND-DSP-2026-07-12-BRIEF.md §1b's own figure for lombScargle, carried into its revisit condition; the residue row #4673 claims 66 % (ECG) and 28 % (PPG). No threshold here comes from this run."
    },
    result: {
      ...d.result,
      runs,
      realms: [...REALMS],
      outputDigests: digests,
      corpusPopulation,
      refusals,
      note: "the `clean` arm carries no transform, so `instrumentOverheadPct` is the wrapper's own measured cost rather than an assumption; the `vm` arm is §0's inflation control"
    },
    evidence: [TOOL, 'briefs/PROFILED-HOTSPOTS-CI-AND-DSP-2026-07-12-BRIEF.md', 'ecgdex-dsp.js', 'ppgdex-dsp.js'],
    reason: d.reason,
    producedBy: { tool: TOOL, commit }
  });
  const bad = Verdict.validate(v);
  if (bad && bad.length) {
    console.error(`${TOOL}: the verdict is invalid — ${bad.join('; ')}`);
    process.exit(2);
  }
  const text = `${JSON.stringify(v, null, 1)}\n`;
  const w = arg('--write', null);
  if (w) fs.writeFileSync(path.join(REPO, w), text);
  if (has('--json') || w) process.stdout.write(text);
  if (!has('--json')) {
    for (const [k, n] of Object.entries(d.result.nodes)) {
      console.error(
        `${k}: product path ${n.productPathSharePct} % (claimed ${n.claimedPct} %) · vm realm ${n.vmRealmSharePct} % · realm inflation ${n.realmInflation}× · ${n.lombCalls} calls · ${n.productPathTotalMs} ms`
      );
    }
    console.error(
      `corpus population: ${corpusPopulation.status} — ${corpusPopulation.population.checked} record(s) of ${corpusPopulation.population.eligible} under ${popRoot}` +
        (corpusPopulation.reason ? `\n  ${corpusPopulation.reason}` : '')
    );
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
  const ecgSrc = fs.readFileSync(path.join(REPO, NODES.ecg.dsp), 'utf8');
  const ppgSrc = fs.readFileSync(path.join(REPO, NODES.ppg.dsp), 'utf8');

  const we = wrapSource(ecgSrc, NODES.ecg.decl, NODES.ecg.params);
  ok('the ECGDex declaration is found exactly once', we.ok && we.found === 1, we.found);
  const wp = wrapSource(ppgSrc, NODES.ppg.decl, NODES.ppg.params);
  ok('the PpgDex declaration is found exactly once', wp.ok && wp.found === 1, wp.found);
  ok('the PpgDex declaration does not appear in the ECGDex source, so the two transforms cannot cross-apply', ecgSrc.split(NODES.ppg.decl).length - 1 === 0, ecgSrc.split(NODES.ppg.decl).length - 1);
  ok('the wrapper keeps the original body under a new name', we.text.includes('function __lsInner(nn, times, nf) {'), 'absent');

  const none = wrapSource('function other() {}', NODES.ecg.decl, NODES.ecg.params);
  ok('an absent declaration refuses', !none.ok && none.found === 0, `${none.ok}/${none.found}`);
  const twice = wrapSource(`${NODES.ecg.decl}\n${NODES.ecg.decl}\n`, NODES.ecg.decl, NODES.ecg.params);
  ok('two declarations refuse', !twice.ok && twice.found === 2, `${twice.ok}/${twice.found}`);

  /* The wrapper preserves the return value and accumulates — planted in a realm, not reasoned about. */
  const plant = `  function lombScargle(nn, times, nf) {\n    return [nn + times, nf === undefined ? 'undef' : nf];\n  }\n  globalThis.__out2 = lombScargle(2, 3);\n  globalThis.__out3 = lombScargle(2, 3, 9);\n`;
  const wrapped = wrapSource(plant, NODES.ecg.decl, NODES.ecg.params);
  const sand = realmShim({});
  vm.runInNewContext(wrapped.text, sand);
  ok('the wrapped call returns what the body returns', JSON.stringify(sand.__out2) === '[5,"undef"]', JSON.stringify(sand.__out2));
  ok('a third argument passes through the wrapper', JSON.stringify(sand.__out3) === '[5,9]', JSON.stringify(sand.__out3));
  ok('the wrapper counts every call', sand.__lsCalls === 2, sand.__lsCalls);
  ok('the accumulator is a finite, non-negative duration', Number.isFinite(sand.__lsAcc) && sand.__lsAcc >= 0, sand.__lsAcc);

  ok('median of an even-length set', median([4, 1, 3, 2]) === 2.5, median([4, 1, 3, 2]));
  ok('median of an empty set is null, never 0', median([]) === null, median([]));
  ok('a share needs a positive denominator', sharePct(5, 0) === null, sharePct(5, 0));
  ok('a share is a percentage of the total', sharePct(33, 100) === 33, sharePct(33, 100));

  const rows = [
    { node: 'ecg', realm: 'main', totalMs: 1000, lombMs: 660, lombCalls: 300, peakRssMB: 900, digest: 'a' },
    { node: 'ecg', realm: 'main', totalMs: 1040, lombMs: 686, lombCalls: 300, peakRssMB: 900, digest: 'a' },
    { node: 'ecg', realm: 'vm', totalMs: 3000, lombMs: 2400, lombCalls: 300, peakRssMB: 900, digest: 'a' },
    { node: 'ecg', realm: 'clean', totalMs: 990, lombMs: null, lombCalls: null, peakRssMB: 900, digest: 'a' },
    { node: 'ecg', realm: 'clean', totalMs: 1030, lombMs: null, lombCalls: null, peakRssMB: 900, digest: 'a' }
  ];
  const meds = summarise(rows);
  ok('the product-path share is the main arm', meds.ecg.main.sharePct === 65.98, meds.ecg.main.sharePct);
  ok('the clean arm carries no share, because it carries no instrument', meds.ecg.clean.sharePct === null, meds.ecg.clean.sharePct);
  const hot = decide(meds, { checked: 3, eligible: 3, excluded: 0 });
  ok('a share at or above the pre-stated 35 % meets the revisit condition', hot.status === 'PASS', hot.status);
  ok('the realm inflation is reported beside the share', hot.result.nodes.ecg.realmInflation === 2.94, hot.result.nodes.ecg.realmInflation);
  ok("the wrapper's own cost is reported, not assumed", hot.result.nodes.ecg.instrumentOverheadMs === 10, hot.result.nodes.ecg.instrumentOverheadMs);
  ok('a wrapper cost smaller than the arms own spread reads UNRESOLVED, never absent', hot.result.nodes.ecg.instrumentOverheadResolved === false, hot.result.nodes.ecg.instrumentOverheadResolved);
  ok('the spread of one run is null, never 0', spread([5]) === null, spread([5]));
  ok('the spread is the max less the min', spread([1000, 1040]) === 40, spread([1000, 1040]));
  ok('the headline share carries its own spread', hot.result.nodes.ecg.productPathSharePctSpread === 0.04, hot.result.nodes.ecg.productPathSharePctSpread);

  const cold = decide(summarise(rows.map((r) => (r.realm === 'main' ? { ...r, lombMs: 120 } : r))), { checked: 3, eligible: 3, excluded: 0 });
  ok('a share below the pre-stated 35 % is a SHORTFALL with a reason', cold.status === 'SHORTFALL' && /LEAVE stands/.test(cold.reason), cold.status);
  const nothing = decide({}, { checked: 0, eligible: 6, excluded: 6, reason: 'the corpus holds no night' });
  ok('an unexamined run is NOT_RUN and never a 0 % share', nothing.status === 'NOT_RUN' && nothing.reason === 'the corpus holds no night', nothing.status);

  ok('a basename no corpus can hold is not found', findNight('lomb-share-no-such-night.txt') === null, 'found');
  ok(
    'every node names a committed-corpus night and a global',
    Object.values(NODES).every((x) => x.night && x.global && x.files.includes(x.dsp)),
    'incomplete'
  );

  const Verdict = req('../verdict.js');
  const v = Verdict.make({
    gate: 'lomb-share-profile',
    status: 'PASS',
    scope: 'internal',
    population: { checked: 3, eligible: 3, excluded: 0 },
    criterion: { ...CRITERION, preStated: 'the brief §1b figure' },
    result: hot.result,
    evidence: [TOOL],
    reason: null,
    producedBy: { tool: TOOL, commit: 'deadbeef' }
  });
  const bad = Verdict.validate(v);
  ok('the verdict this tool builds validates', !bad || !bad.length, JSON.stringify(bad));

  /* The population leg. A corpus enumerator owes a population verdict, so the lister and the
     root-pick are measured over a planted tree rather than over whichever corpus this box holds. */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lombpop-'));
  fs.writeFileSync(path.join(tmp, 'A_ECG.txt'), 'x');
  fs.writeFileSync(path.join(tmp, 'notes.md'), 'x');
  fs.mkdirSync(path.join(tmp, 'nightly'));
  fs.writeFileSync(path.join(tmp, 'nightly', 'B_PPG.txt'), 'x');
  fs.mkdirSync(path.join(tmp, 'nightly', 'deeper'));
  fs.writeFileSync(path.join(tmp, 'nightly', 'deeper', 'C_ECG.txt'), 'x');
  const listed = listCaptureFiles(tmp).sort();
  ok('the lister reads one subdirectory level, exactly as findNight searches', JSON.stringify(listed) === '["A_ECG.txt","nightly/B_PPG.txt"]', JSON.stringify(listed));
  let threw = false;
  try {
    listCaptureFiles(path.join(tmp, 'absent-root'));
  } catch {
    threw = true;
  }
  ok('an unreadable root throws, so the snapshot refuses rather than reporting an empty population', threw, threw);
  const snapA = snapshotEntries(tmp, { list: listCaptureFiles, unit: 'records' });
  ok('the snapshot names the lister that chose its members', snapA.rule === 'listCaptureFiles', String(snapA.rule));
  ok('the snapshot counts the records it listed', snapA.ok && snapA.n === 2, `${snapA.ok}/${snapA.n}`);
  const stable = populationVerdict(snapA, snapA, { tool: TOOL, at: '2026-11-10T00:00:00Z' });
  ok('an unmoved population passes', stable.status === 'PASS', stable.status);
  fs.writeFileSync(path.join(tmp, 'D_ECG.txt'), 'x');
  const moved = populationVerdict(snapA, snapshotEntries(tmp, { list: listCaptureFiles, unit: 'records' }), { tool: TOOL, at: '2026-11-10T00:00:00Z' });
  ok('a population that moved under the run does not pass', moved.status !== 'PASS' && moved.reason != null, `${moved.status}/${moved.reason}`);
  const refused = populationVerdict(snapshotEntries(path.join(tmp, 'absent-root'), { list: listCaptureFiles, unit: 'records' }), snapA, { tool: TOOL, at: '2026-11-10T00:00:00Z' });
  ok('a root that cannot be enumerated reports NOT_RUN, never a count of 0 as a pass', refused.status === 'NOT_RUN', refused.status);
  ok(
    'the root-pick takes the root that actually held the night',
    resolvedRootOf([path.join(tmp, 'nightly', 'B_PPG.txt')], ['/nowhere', tmp]) === tmp,
    String(resolvedRootOf([path.join(tmp, 'nightly', 'B_PPG.txt')], ['/nowhere', tmp]))
  );
  ok('with no night resolved the root-pick names the first candidate searched, never null', resolvedRootOf([], ['/nowhere', tmp]) === '/nowhere', String(resolvedRootOf([], ['/nowhere', tmp])));
  fs.rmSync(tmp, { recursive: true, force: true });

  if (fails.length) {
    for (const f of fails) console.error(`✗ ${f}`);
    console.error(`${fails.length} of ${n} selftests FAILED`);
    process.exit(1);
  }
  console.log(`all ${n} selftests passed`);
}

if (isCliEntry(import.meta.url)) {
  refuseUnknownArgvOrExit(argv, { boolean: ['--json', '--selftest'], valued: ['--write', '--runs', '--only', '--child', '--realm', '--night'] }, { tool: TOOL });
  if (has('--selftest')) selftest();
  else if (has('--child')) childRun(arg('--child'), arg('--realm', 'main'), arg('--night'));
  else main();
}
