#!/usr/bin/env node
/*
 * null-fuzz.mjs — null-injection fuzzer for the DSP absence contract
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fuzzes OxyDex's processNight with random dropout patterns and asserts the
 * §∅ contract: STATISTICS ARE COMPUTED OVER MEASURED SAMPLES, NEVER OVER
 * ABSENT ONES (oxydex-dsp.js, the `§∅` block ahead of computeStats).
 *
 * Two properties:
 *   P1 (no fabrication): an all-null signal yields null metrics, never
 *       0 / NaN / ±Infinity / finite fabrications.
 *   P2 (nulls are ignored, not zeroed): for order-independent point
 *       statistics, metric(fuzzed rows) === metric(clean rows) where clean
 *       is the fuzzed night with null rows removed. A null must behave like
 *       a missing row, never like a 0 reading.
 *
 * v3 — the bundle is GROUPED, not a flat list (2026-10-06, Kestrel, on the
 * owner's "run without eating tokens"). v2 wrote one record per failing
 * assertion: 21 seeds produced 5,600 records (840 KB) that said eight things.
 * v3 keys every failure by (property, metric), keeps a bounded set of
 * examples per group (--keep, default 3: the first, the widest gap, the
 * fewest nulls), counts the rest, and tags each group KNOWN (already routed
 * to a fix — see KNOWN below) or NOVEL. The reader's unit is the group.
 *
 *   --summary FILE   print the readable report for an existing bundle and
 *                    exit — works on a LIVE bundle (writes are atomic), so a
 *                    running soak can be read at any time in ~20 lines.
 *                    Also folds a v2 flat bundle into groups on the fly.
 *   --known a,b,c    override the KNOWN metric list (default: the routed set)
 *   --keep N         examples kept per group (default 3)
 *   --target NAME    oxydex (default) | pulsedex | glucodex | machinery. One target per run and per bundle;
 *                    a bundle records its target, so --summary/--resume pick it up. Add a DSP in TARGETS.
 *   --selftest       per target: a night with NO nulls must equal its own clean twin (the comparator is not
 *                    noisy); machinery also plants the `null + x === x` bug and demands a red. Exit 1 on either.
 *   --narrate        after the run (or with --summary), ask the LOCAL Ollama
 *                    model (the same endpoint and model as tools/qwen-agent.mjs)
 *                    for one plain-English paragraph per NOVEL group, appended
 *                    to the report as an UNVERIFIED DRAFT. One request,
 *                    localhost only, off by default — it evicts bge-m3 from
 *                    the GPU for ~1 min (memory: ai-probe-evicts-bge-m3), so
 *                    run it once, at the end. The model proposes, never decides
 *                    (QWEN-ENGINEERING-PROGRAM brief, shelved but its §0 kept).
 *
 * Every run also writes <out>.md (the same report) beside the bundle and ends
 * with ONE tepna.verdict/1 object (verdict.js; VERDICT-CONTRACT-2026-09-21).
 * The verdict is FAIL while ANY group exists — known defects are still
 * fabrication; the KNOWN/NOVEL split is for the reader, never for the gate.
 *
 * Long-run operation (TOOL-BUILD-STANDARD §2):
 *   --seeds N        seeds to run from --seed-start (default 1)
 *   --seed-start N   first seed (default: random); seeds are independent units,
 *                    so ranges shard across machines with no coordination
 *   --iters N        fuzzed nights per seed (default 50)
 *   --len N          samples per night (default 900)
 *   --out FILE       results bundle JSON (default null-fuzz-<start>.json).
 *                    The bundle IS the checkpoint.
 *   --resume         resume from --out: completed seeds are skipped, groups
 *                    already recorded are kept. Kill -9 mid-run, then rerun
 *                    with --resume for 0 duplicates, 0 re-run seeds.
 *   --heartbeat SEC  progress line to stderr every SEC (default 30). Survives
 *                    redirection; a silent run is indistinguishable from hung.
 *   --quiet          per-failure lines are not printed (the bundle has them)
 *
 *   Example overnight soak, shardable:
 *     node tools/null-fuzz.mjs --seed-start 1 --seeds 200 --iters 50 --quiet \
 *       --out /tmp/fuzz-a.json &
 *     node tools/null-fuzz.mjs --summary /tmp/fuzz-a.json      # any time
 *
 * Exit 0 = no fabrication in the seeds run. Exit 1 = fabrication found (see
 * report). Exit 2 = load/setup error.
 *
 * §2.11 declarations: single process, no workers — SIGKILL terminates cleanly
 * and the checkpoint is always consistent (§2.3 trivially satisfied). No GPU:
 * the workload is serial processNight calls (~0.4–1.1 s each, pure JS, no dense
 * kernel); the parallel unit is the seed, sharded across processes/machines
 * (§2.6 — measured 2026-10-06, n=30 iters: 1.08 s/iter mean, 0.97–1.24 range;
 * 0.36 s/iter niced on a quiet box the same day). Single-purpose: OxyDex only;
 * the shape ports to other Dexes as separate work (§2.9). §2.1 search
 * 2026-10-06: no prior null-fuzz work in repo; the grouped-report shape and the
 * local-model draft follow tools/qwen-agent.mjs and VERDICT-CONTRACT.
 *
 * Zero npm dependencies. Loads the real DSP via node:vm, same as
 * tests/run-tests.mjs.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const DexBuild = require(join(ROOT, 'tools', 'build-core.js'));
const Verdict = require(join(ROOT, 'verdict.js'));
const OLLAMA = process.env.NULL_FUZZ_OLLAMA || 'http://127.0.0.1:11434'; // as tools/qwen-agent.mjs; the env var exists so the failure paths can be tested
const NARRATE_MODEL = 'qwen3-coder:30b'; // as tools/qwen-agent.mjs

/* ── CLI ── */
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const m = args.find((a) => a.startsWith(`--${name}=`));
  if (m) return m.split('=').slice(1).join('=');
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) return args[i + 1];
  return dflt;
};
const has = (name) => args.includes(`--${name}`);
const SUMMARY_OF = opt('summary', null);
const SEED_START = Number(opt('seed-start', opt('seed', (Math.random() * 0xffffffff) >>> 0)));
const SEEDS = Number(opt('seeds', 1));
const ITERS = Number(opt('iters', 50));
const LEN = Number(opt('len', 900));
const HEARTBEAT_SEC = Number(opt('heartbeat', 30));
const KEEP = Math.max(1, Number(opt('keep', 3)));
const QUIET = has('quiet');
const RESUME = has('resume');
const NARRATE = has('narrate');
const OUT = SUMMARY_OF || opt('out', `null-fuzz-${SEED_START}.json`);
const OUT_PATH = OUT.startsWith('/') ? OUT : join(process.cwd(), OUT);
const REPORT_PATH = `${OUT_PATH.replace(/\.json$/, '')}.md`;

/* KNOWN: metrics whose fabrication is already routed to a fix. A hit here is
 * still a failure (the gate does not care); the tag only tells the READER what
 * is new. Keep the route beside the name so the list is checkable, and prune a
 * row when its fix merges — a stale KNOWN entry hides a regression. */
/* Every OxyDex group this tool found was routed and FIXED (#3321, #3359, #3362; the soak on main dbabfa39 is CLEAN,
 * 30 seeds x 20 iters, 0 failures). The routed set is therefore EMPTY on purpose: a stale KNOWN entry would tag a
 * regression as "already routed" and hide it. Any hit on OxyDex from here is NOVEL. */
const KNOWN_OXYDEX = {};
/* Routed defects per target; the other targets start empty, so everything they find is NOVEL until it is verified and routed. */
const KNOWN_BY_TARGET = { oxydex: KNOWN_OXYDEX };
let TARGET = opt('target', 'oxydex');
let KNOWN = {};
/** The routed set for the current target, or --known a,b,c to override it. */
function resolveKnown() {
  const base = KNOWN_BY_TARGET[TARGET] || {};
  const o = opt('known', null);
  if (o === null) return base;
  const out = {};
  for (const k of o
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean))
    out[k] = base[k] || 'listed by --known';
  return out;
}
KNOWN = resolveKnown();

/* ── grouped bundle ───────────────────────────────────────────────────────────
 * groups: { "<property>|<metric>": { property, metric, count, seeds: [..], nulls_min, nulls_max,
 *           examples: [ {seed, iter, fuzzed, clean, note, why} ] } }
 * `why` names which slot the example holds: first | widest | fewest-nulls. */
function blankBundle() {
  return {
    tool: 'null-fuzz.mjs',
    version: 3,
    target: TARGET,
    seed_start: SEED_START,
    seeds: SEEDS,
    iters: ITERS,
    len: LEN,
    keep: KEEP,
    started_at: new Date().toISOString(),
    updated_at: null,
    completed_seeds: [],
    groups: {},
    failure_count: 0,
    stats: { iters_run: 0, ms_total: 0 },
    summary: null,
    verdict: null
  };
}
const gap = (e) => {
  if (typeof e.fuzzed === 'number' && typeof e.clean === 'number') return Math.abs(e.fuzzed - e.clean);
  return e.fuzzed === null || e.clean === null ? Number.POSITIVE_INFINITY : 0;
};
const nullsOf = (e) => {
  const m = /nulls=(\d+)\//.exec(e.note || '');
  return m ? Number(m[1]) : null;
};
function addFailure(b, e) {
  const key = `${e.property}|${e.metric}`;
  let g = b.groups[key];
  if (!g) {
    g = { property: e.property, metric: e.metric, count: 0, seeds: [], nulls_min: null, nulls_max: null, examples: [] };
    b.groups[key] = g;
  }
  g.count++;
  b.failure_count++;
  if (!g.seeds.includes(e.seed)) g.seeds.push(e.seed);
  const nn = nullsOf(e);
  if (nn !== null) {
    g.nulls_min = g.nulls_min === null ? nn : Math.min(g.nulls_min, nn);
    g.nulls_max = g.nulls_max === null ? nn : Math.max(g.nulls_max, nn);
  }
  // Bounded examples: slot `first` = first seen; then the widest gap and the fewest nulls (the
  // cheapest reproduction). KEEP bounds the array; the count carries the rest.
  const ex = { seed: e.seed, iter: e.iter, fuzzed: e.fuzzed, clean: e.clean, note: e.note || null, why: 'first' };
  if (g.examples.length === 0) {
    g.examples.push(ex);
    return;
  }
  const widest = g.examples.find((x) => x.why === 'widest');
  if (gap(ex) > gap(widest || g.examples[0])) {
    if (widest) Object.assign(widest, ex, { why: 'widest' });
    else if (g.examples.length < KEEP) g.examples.push({ ...ex, why: 'widest' });
  }
  const fewest = g.examples.find((x) => x.why === 'fewest-nulls');
  const ref = nullsOf(fewest || g.examples[0]);
  if (nn !== null && (ref === null || nn < ref)) {
    if (fewest) Object.assign(fewest, ex, { why: 'fewest-nulls' });
    else if (g.examples.length < KEEP) g.examples.push({ ...ex, why: 'fewest-nulls' });
  }
}
/** A v2 bundle (flat `failures[]`) folds into v3 groups; a v3 bundle passes through. */
function upgradeBundle(parsed) {
  if (parsed.version >= 3 && parsed.groups) return parsed;
  const b = { ...blankBundle(), ...parsed, version: 3, groups: {}, failure_count: 0, keep: KEEP };
  for (const f of parsed.failures || []) addFailure(b, f);
  delete b.failures;
  return b;
}

let bundle = blankBundle();
if ((RESUME || SUMMARY_OF) && existsSync(OUT_PATH)) {
  try {
    const parsed = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
    if (parsed && parsed.tool === 'null-fuzz.mjs' && Array.isArray(parsed.completed_seeds)) {
      bundle = upgradeBundle(parsed);
      bundle.started_at = bundle.started_at || new Date().toISOString();
    } else {
      console.error(`checkpoint unparseable or foreign — ${SUMMARY_OF ? 'nothing to summarise' : `starting fresh (discarded ${OUT_PATH})`}`);
      if (SUMMARY_OF) process.exit(2);
    }
  } catch {
    console.error(`checkpoint unreadable — ${SUMMARY_OF ? 'nothing to summarise' : `starting fresh (discarded ${OUT_PATH})`}`);
    if (SUMMARY_OF) process.exit(2);
  }
} else if (SUMMARY_OF) {
  console.error(`--summary: no bundle at ${OUT_PATH}`);
  process.exit(2);
}
if (bundle.target && bundle.target !== TARGET) {
  TARGET = bundle.target; // a resumed or summarised bundle names its own target
  KNOWN = resolveKnown();
}
function saveBundle() {
  bundle.updated_at = new Date().toISOString();
  const tmp = `${OUT_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(bundle, null, 1));
  renameSync(tmp, OUT_PATH); // atomic: readers never see a half-write
}
let seedFailures = [];
const fail = (entry) => {
  seedFailures.push(entry); // buffered; merged into bundle only on seed completion (§2.2: no duplicates on resume)
  if (!QUIET)
    console.log(
      `FAIL ${entry.property} seed=${entry.seed} iter=${entry.iter}: ${entry.metric} fuzzed=${JSON.stringify(entry.fuzzed)} clean=${JSON.stringify(entry.clean)}${entry.note ? ` ${entry.note}` : ''}`
    );
};

/* ── report + verdict (shared by the run and --summary) ── */
const fmt = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(+v.toFixed(3));
  return JSON.stringify(v);
};
const sortedGroups = (b) => Object.values(b.groups).sort((x, y) => y.count - x.count);
function buildSummary(b) {
  const groups = sortedGroups(b);
  const novel = groups.filter((g) => !(g.metric in KNOWN));
  const known = groups.filter((g) => g.metric in KNOWN);
  const msPerIter = b.stats.iters_run ? b.stats.ms_total / b.stats.iters_run : 0;
  let verdict = 'CLEAN';
  if (b.failure_count > 0) verdict = novel.length ? 'FABRICATION-FOUND (novel)' : 'FABRICATION-FOUND (all known)';
  return {
    seeds_run: b.completed_seeds.length,
    seeds_planned: b.seeds,
    iters_run: b.stats.iters_run,
    failures: b.failure_count,
    groups: groups.length,
    novel_groups: novel.map((g) => g.metric),
    known_groups: known.map((g) => g.metric),
    ms_per_iter: +msPerIter.toFixed(1),
    verdict
  };
}
function buildVerdict(b, s) {
  const plannedIters = b.seeds * b.iters;
  const complete = b.completed_seeds.length >= b.seeds;
  let status = 'FAIL';
  let reason = `${s.failures} failing assertions in ${s.groups} group(s): ${s.novel_groups.length} novel (${s.novel_groups.join(', ') || '—'}), ${s.known_groups.length} known/routed`;
  if (b.stats.iters_run === 0) {
    status = 'NOT_RUN';
    reason = 'no iteration ran';
  } else if (b.failure_count === 0) {
    status = complete ? 'PASS' : 'UNDERPOWERED';
    reason = complete ? null : `${b.completed_seeds.length} of ${b.seeds} seeds run — clean so far, not the planned population`;
  }
  const v = Verdict.make({
    gate: `null-fuzz-${TARGET}`,
    status,
    population: { checked: b.stats.iters_run, eligible: plannedIters, excluded: Math.max(0, plannedIters - b.stats.iters_run) },
    criterion: { name: 'fabrication_groups', threshold: 0, unit: 'groups', direction: 'eq' },
    result: { groups: s.groups, novel: s.novel_groups.length, known: s.known_groups.length, failures: s.failures, seeds_run: s.seeds_run, skipped: b.stats.skipped || {} },
    evidence: ['tools/null-fuzz.mjs', OUT_PATH.replace(/^.*\//, '')],
    reason,
    producedBy: { tool: 'tools/null-fuzz.mjs', commit: null, commitReason: 'the bundle is a scratch artefact; the commit is the checkout that ran it' }
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) {
    console.error(`verdict object INVALID: ${chk.errors.join('; ')}`);
    process.exit(2);
  }
  return v;
}
function renderReport(b, s, v, narrative) {
  const L = [];
  const live = b.completed_seeds.length < b.seeds;
  L.push(`# null-fuzz [${TARGET}] — ${s.verdict}${live ? ' (RUNNING)' : ''}`);
  L.push('');
  const sk = b.stats.skipped
    ? Object.entries(b.stats.skipped)
        .map(([k, n]) => `${k} ×${n}`)
        .join(', ')
    : '';
  L.push(`Seeds ${s.seeds_run}/${s.seeds_planned} · iters ${s.iters_run} · ${s.failures} failing assertions in ${s.groups} group(s) · ${s.ms_per_iter} ms/iter · bundle \`${OUT_PATH}\``);
  if (sk) L.push(`Skipped, NOT examined (index-dependent metric above ${INDEX_DEP_MAX_NULL_FRAC * 100} % nulls — the comparison premise does not hold): ${sk}`);
  L.push('');
  const table = (title, gs) => {
    L.push(`## ${title} (${gs.length})`);
    L.push('');
    if (!gs.length) {
      L.push('_none_');
      L.push('');
      return;
    }
    L.push('| property | metric | failures | seeds | nulls/night | first example (fuzzed → clean) | widest gap | route |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const g of gs) {
      const first = g.examples.find((x) => x.why === 'first') || g.examples[0];
      const widest = g.examples.find((x) => x.why === 'widest');
      const ex = (x) => (x ? `seed ${x.seed} it ${x.iter}: ${fmt(x.fuzzed)} → ${fmt(x.clean)}` : '—');
      let nulls = '—';
      if (g.nulls_min !== null) nulls = g.nulls_min === g.nulls_max ? `${g.nulls_min}` : `${g.nulls_min}–${g.nulls_max}`;
      L.push(`| ${g.property} | \`${g.metric}\` | ${g.count} | ${g.seeds.length} | ${nulls} | ${ex(first)} | ${ex(widest)} | ${KNOWN[g.metric] || '**NOVEL — verify, then route**'} |`);
    }
    L.push('');
  };
  const groups = sortedGroups(b);
  table(
    'Novel groups',
    groups.filter((g) => !(g.metric in KNOWN))
  );
  table(
    'Known groups (already routed — a regression tripwire, not news)',
    groups.filter((g) => g.metric in KNOWN)
  );
  L.push(
    'How to read: P1 = an all-null night must give null (a number here is fabricated from nothing). P2 = metric(fuzzed) must equal metric(nulls removed) (a gap here means a null acted as a 0 or sorted as −∞). `first` is the cheapest reproduction: rerun with `--seed-start <seed> --seeds 1 --iters <iter+1>`.'
  );
  L.push('');
  if (narrative) {
    L.push(`## Draft narrative — local ${NARRATE_MODEL} via Ollama, UNVERIFIED`);
    L.push('');
    L.push('_A model wrote this from the table above, not from the code. Treat every sentence as a hypothesis to check at the named site._');
    L.push('');
    L.push(narrative.trim());
    L.push('');
  }
  L.push('```json');
  L.push(JSON.stringify(v));
  L.push('```');
  return `${L.join('\n')}\n`;
}
/* ── narration: one request PER NOVEL GROUP, persisted after each one ─────────────────────────
 * The local model can stop early (max_tokens hit, context full, Ollama restarted, GPU evicted). A single
 * all-groups request loses everything when it does; v3.1 asks per group and writes a sidecar
 * (<out>.narration.json, atomic) after EACH answer, so the most a failure costs is the group in flight.
 * An `ok` answer is reused on every rerun while its group's first example is unchanged; a `truncated`
 * answer (finish_reason "length") keeps its partial text, flagged, and is re-asked next time; an error
 * keeps whatever was there before and never overwrites it. Two consecutive failures stop the loop —
 * the model is down, and hammering it helps nobody. The report always renders from the sidecar. */
const NARR_PATH = `${OUT_PATH.replace(/\.json$/, '')}.narration.json`;
function loadNarration() {
  try {
    const j = JSON.parse(readFileSync(NARR_PATH, 'utf8'));
    if (j && j.tool === 'null-fuzz.mjs' && j.entries && typeof j.entries === 'object') return j;
  } catch {
    /* absent or unreadable — start empty; a corrupt sidecar is discarded, never trusted */
  }
  return { tool: 'null-fuzz.mjs', model: NARRATE_MODEL, entries: {} };
}
function saveNarration(n) {
  const tmp = `${NARR_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(n, null, 1));
  renameSync(tmp, NARR_PATH);
}
const fingerprint = (g) => JSON.stringify([g.property, g.metric, g.examples[0] && [g.examples[0].seed, g.examples[0].iter, g.examples[0].fuzzed, g.examples[0].clean]]);
async function askOne(g) {
  const facts = { property: g.property, metric: g.metric, failures: g.count, examples: g.examples };
  const prompt =
    'You are summarising one null-injection fuzz result for a sleep-oximetry DSP. The contract: statistics are computed over measured samples, never over absent ones (a null must behave as a missing row, never as a 0). ' +
    'Write ONE short paragraph in plain English: what the number did when nulls were present versus removed, and the single most likely JavaScript coercion that explains it (null + x, null < x, null - x, a sort with null). ' +
    `Do not invent line numbers or function names. Do not propose code. Under 120 words.\n\n${JSON.stringify(facts, null, 1)}`;
  try {
    const res = await fetch(`${OLLAMA}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: NARRATE_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: Number(process.env.NULL_FUZZ_MAXTOK) || 400 }),
      signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) return { status: 'error', text: null, why: `HTTP ${res.status}` };
    const j = await res.json();
    const c = j.choices?.[0];
    const text = (c?.message?.content || '').trim();
    if (!text) return { status: 'error', text: null, why: 'empty answer' };
    return { status: c.finish_reason === 'length' ? 'truncated' : 'ok', text, why: c.finish_reason || null };
  } catch (e) {
    return { status: 'error', text: null, why: String(e.message).slice(0, 120) };
  }
}
/** Returns the narrative markdown (from the sidecar) or null when there is nothing novel. Localhost only. */
async function narrate(b) {
  const novel = sortedGroups(b).filter((g) => !(g.metric in KNOWN));
  if (!novel.length) return null;
  const n = loadNarration();
  n.model = NARRATE_MODEL;
  let strikes = 0;
  for (const g of novel) {
    const key = `${g.property}|${g.metric}`;
    const have = n.entries[key];
    if (have && have.status === 'ok' && have.fp === fingerprint(g)) continue; // preserved — never re-asked
    if (strikes >= 2) break; // model is down; keep what we have
    const r = await askOne(g);
    if (r.status === 'error') {
      strikes++;
      n.entries[key] = { ...(have || {}), status: have ? have.status : 'error', last_error: r.why, fp: have ? have.fp : fingerprint(g) };
    } else {
      strikes = r.status === 'ok' ? 0 : strikes;
      n.entries[key] = { status: r.status, text: r.text, fp: fingerprint(g), failures: g.count, at: new Date().toISOString() };
    }
    saveNarration(n); // after EACH group
  }
  const out = [];
  for (const g of novel) {
    const e = n.entries[`${g.property}|${g.metric}`];
    if (e && e.text) out.push(`**${g.property} \`${g.metric}\`**${e.status === 'ok' ? '' : ` _(${e.status} — partial, will be re-asked on the next --narrate)_`}: ${e.text}`);
    else
      out.push(`**${g.property} \`${g.metric}\`**: _(no answer yet${e?.last_error ? `: ${e.last_error}` : ''} — rerun --narrate; answered groups are kept in \`${NARR_PATH.replace(/^.*\//, '')}\`)_`);
  }
  return out.join('\n\n');
}
async function finish(b) {
  const s = buildSummary(b);
  const v = buildVerdict(b, s);
  b.summary = s;
  b.verdict = v;
  const narrative = NARRATE ? await narrate(b) : null;
  const report = renderReport(b, s, v, narrative);
  writeFileSync(REPORT_PATH, report);
  process.stdout.write(report);
  return { s, v };
}

/* ── --summary: read-only view of any bundle, then exit ── */
if (SUMMARY_OF) {
  const { v } = await finish(bundle);
  process.exit(v.status === 'FAIL' ? 1 : 0);
}

/* ── seeded RNG ── */
let _s = 0;
function reseed(seed) {
  _s = seed >>> 0;
}
function rnd() {
  _s |= 0;
  _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

/* ── sandbox + loader (one DSP spine per run; a target names its files) ── */
function makeSandbox() {
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    classList: { toggle: noop, add: noop, remove: noop },
    appendChild: noop,
    setAttribute: noop,
    addEventListener: noop,
    children: [],
    querySelectorAll: () => []
  });
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  sandbox.document = {
    getElementById: () => null,
    createElement: el,
    querySelector: () => null,
    querySelectorAll: () => [],
    head: el(),
    body: el(),
    documentElement: { outerHTML: '', appendChild: noop },
    addEventListener: noop
  };
  sandbox.localStorage = { getItem: () => null, setItem: noop, removeItem: noop, clear: noop };
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  return vm.createContext(sandbox);
}
function loadDsp(files) {
  const ctx = makeSandbox();
  for (const f of files) vm.runInContext(DexBuild.classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  return ctx;
}
const bare = (o) => (o && o._bare) || o;

/* ── shared helpers ── */
const T0 = Date.UTC(2026, 0, 1, 22, 0, 0);
/** 1–3 random null blocks of 30–400 samples over [0, len); returns a boolean mask. */
let NO_NULLS = false; // --selftest control: a night with NO nulls must equal its own clean twin, or the comparator is noisy
function nullMask(len) {
  const mask = new Array(len).fill(false);
  if (NO_NULLS) return mask;
  const blocks = rint(1, 3);
  for (let b = 0; b < blocks; b++) {
    const start = rint(0, len - 1);
    const n = rint(30, Math.min(400, len - start));
    for (let i = start; i < start + n && i < len; i++) mask[i] = true;
  }
  return mask;
}
const isFabricated = (v) => v !== null && v !== undefined && (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v) || v !== 0);
const same = (a, b) => {
  if (a === null && b === null) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  return false;
};
/* INDEX-DEPENDENT metrics: a few DSPs mask or window by array POSITION (OxyDex's gated nadir walks the first
 * NADIR_RAMP_MAX_SEC *indices*), so a night with its nulls removed is a different recording once most of the
 * night is gone — removing 705 of 900 samples slides a 120-position window across 195. P2's premise (fuzzed ==
 * nulls removed) cannot hold there, and the disagreement is not a coercion. Such a metric is compared only up to
 * INDEX_DEP_MAX_NULL_FRAC nulls; above it the comparison is SKIPPED AND COUNTED (bundle.stats.skipped), so the
 * report says what it did not examine rather than reading as a pass. The refusal-above-a-floor alternative is the
 * owner's coverage question and is not decided here. Residue row: 2026-10-06 index-keyed ramp (Osprey, #3364). */
const INDEX_DEP_MAX_NULL_FRAC = 0.5;
/** Compare two metric maps; one failure per disagreeing key. `opts.indexDependent` = keys to skip when `opts.sparse`. */
function compareMetrics(fz, cl, note, opts = {}) {
  const out = [];
  const idx = new Set(opts.indexDependent || []);
  for (const k of Object.keys(fz)) {
    if (opts.sparse && idx.has(k)) {
      bundle.stats.skipped = bundle.stats.skipped || {};
      bundle.stats.skipped[k] = (bundle.stats.skipped[k] || 0) + 1;
      continue;
    }
    if (!same(fz[k], cl[k])) out.push({ property: 'P2', metric: k, fuzzed: fz[k], clean: cl[k], note });
  }
  return out;
}

/* ── TARGETS ─────────────────────────────────────────────────────────────────
 * A target = { files, known, setup(ctx) → { p1(), p2(it) } }. p1/p2 return an array of
 * { property, metric, fuzzed, clean, note }; the runner adds seed/iter and groups them. `known` is the
 * routed set for that target (see KNOWN above). To add a DSP: name its files, build a night, build the
 * clean twin (null rows REMOVED), list the order-independent metrics, and say what an all-null night must give. */
const TARGETS = {
  oxydex: {
    files: ['kernel-constants.js', 'clock.js', 'oxydex-util.js', 'oxydex-dsp.js'],
    known: KNOWN_BY_TARGET.oxydex,
    setup(ctx) {
      const OD = bare(ctx.OxyDex);
      if (!OD || typeof OD.processNight !== 'function') throw new Error('OxyDex.processNight not reachable');
      const mk = (spo2, hr, i) => ({ tMs: T0 + i * 1000, t: new Date(T0 + i * 1000), spo2, hr, motion: 0 });
      const metrics = (out) => {
        const st = out.stats || {};
        const desat = out.desat || {};
        const adv = out.spo2Adv || {};
        return {
          meanSpo2: st.meanSpo2,
          minSpo2: st.minSpo2,
          maxSpo2: st.maxSpo2,
          spo2Std: st.spo2Std,
          t95pct: st.t95pct,
          t90pct: st.t90pct,
          auc90Total: desat.auc90Total,
          auc90Rate: desat.auc90Rate,
          spo2IQR: adv.spo2IQR,
          condMeanBelow94: adv.condMeanBelow94,
          condPctBelow94: adv.condPctBelow94
        };
      };
      return {
        p1() {
          const out = metrics(
            OD.processNight(
              Array.from({ length: LEN }, (_, i) => mk(null, null, i)),
              'allnull.csv'
            )
          );
          const f = [];
          for (const k of ['meanSpo2', 'minSpo2', 'maxSpo2', 'spo2Std']) if (out[k] !== null) f.push({ property: 'P1', metric: k, fuzzed: out[k], clean: null, note: 'all-null night, want null' });
          for (const k of ['auc90Total', 'spo2IQR', 'condMeanBelow94', 'condPctBelow94'])
            if (isFabricated(out[k])) f.push({ property: 'P1', metric: k, fuzzed: out[k], clean: null, note: 'all-null night, fabricated' });
          return f;
        },
        p2() {
          for (;;) {
            const rows = [];
            for (let i = 0; i < LEN; i++) {
              const dip = rnd() < 0.06 ? rint(3, 6) : 0;
              rows.push(mk(Math.max(88, Math.min(100, 96 + rint(-2, 2) - dip)), Math.max(45, Math.min(100, 62 + rint(-6, 6))), i));
            }
            const mask = nullMask(LEN);
            // Coupled nulls: the whole row drops, so the clean night carries exactly the fuzzed night's measured multiset.
            mask.forEach((m, i) => {
              if (m) {
                rows[i].spo2 = null;
                rows[i].hr = null;
              }
            });
            const clean = rows.filter((r) => r.spo2 != null).map((r, j) => mk(r.spo2, r.hr, j));
            if (clean.length < 10) continue;
            const nulls = rows.length - clean.length;
            return compareMetrics(metrics(OD.processNight(rows, 'fz.csv')), metrics(OD.processNight(clean, 'cl.csv')), `nulls=${nulls}/${LEN}`, {
              indexDependent: ['minSpo2'],
              sparse: nulls / LEN > INDEX_DEP_MAX_NULL_FRAC
            });
          }
        }
      };
    }
  },

  pulsedex: {
    files: ['kernel-constants.js', 'metric-registry.js', 'clock.js', 'pulsedex-dsp.js'],
    known: {},
    setup(ctx) {
      const PD = bare(ctx.PulseDex);
      if (!PD || typeof PD.pdComputeResult !== 'function') throw new Error('PulseDex.pdComputeResult not reachable');
      // Order-independent RR statistics only: meanRR / hr / sdnn / N. rMSSD and pNN50 read ADJACENT pairs, and removing a null
      // joins the beats either side of the gap, so they are not equal by construction and are not asserted here.
      const metrics = (r) => (r ? { N: r.N, meanRR: r.meanRR, hr: r.hr, sdnn: r.sdnn } : { N: null, meanRR: null, hr: null, sdnn: null });
      const stamp = (vals) => {
        let t = T0;
        return vals.map((v) => {
          t += v == null ? 900 : v;
          return t;
        });
      };
      return {
        p1() {
          const vals = new Array(LEN).fill(null);
          let r;
          try {
            r = PD.pdComputeResult({ vals, tsMs: stamp(vals), t0Ms: T0 });
          } catch (e) {
            return [{ property: 'P1', metric: '(threw)', fuzzed: String(e.message).slice(0, 80), clean: null, note: 'all-null RR series threw' }];
          }
          return r === null || r === undefined ? [] : [{ property: 'P1', metric: '(result)', fuzzed: `object N=${r.N}`, clean: null, note: 'all-null RR series produced a result, want null' }];
        },
        p2() {
          for (;;) {
            const vals = [];
            for (let i = 0; i < LEN; i++) vals.push(Math.round(900 + 40 * Math.sin(i / 9) + (rnd() - 0.5) * 60));
            const ts = stamp(vals); // timestamps of the beats that DID happen stay real
            const mask = nullMask(LEN);
            const fv = vals.map((v, i) => (mask[i] ? null : v));
            const cv = vals.filter((_, i) => !mask[i]);
            const ct = stamp(cv); // the clean twin is a valid continuous RR series of the beats that were measured
            if (cv.length < 10) continue;
            const nulls = LEN - cv.length;
            const fz = PD.pdComputeResult({ vals: fv, tsMs: ts, t0Ms: T0 });
            const cl = PD.pdComputeResult({ vals: cv, tsMs: ct, t0Ms: T0 });
            return compareMetrics(metrics(fz), metrics(cl), `nulls=${nulls}/${LEN}`);
          }
        }
      };
    }
  },

  glucodex: {
    files: ['kernel-constants.js', 'metric-registry.js', 'clock.js', 'glucodex-dsp.js'],
    known: {},
    setup(ctx) {
      const GD = bare(ctx.GlucoDex);
      if (!GD || typeof GD.compute !== 'function') throw new Error('GlucoDex.compute not reachable');
      // Sample-based statistics only (mean/SD/CV and the mean-derived GMI/eA1c, titr, LBGI/HBGI). Time-weighted or windowed
      // metrics (MAGE, MODD, GVP, TIR by interval) legitimately change when a stretch of time is missing.
      const metrics = (r) => {
        const g = (r && r.glucose) || {};
        return { mean: g.mean, sd: g.sd, cv: g.cv, gmi: g.gmi, ea1c: g.ea1c, titr: g.titr, lbgi: g.lbgi, hbgi: g.hbgi };
      };
      const tms = (n) => Array.from({ length: n }, (_, i) => T0 + i * 300000);
      return {
        p1() {
          let r;
          try {
            r = GD.compute({ tMs: tms(LEN), vMgdl: new Array(LEN).fill(null) });
          } catch {
            return []; // an explicit refusal of an all-null series is acceptable
          }
          const m = metrics(r);
          return ['mean', 'sd', 'cv', 'gmi', 'ea1c']
            .filter((k) => m[k] !== null && m[k] !== undefined)
            .map((k) => ({ property: 'P1', metric: k, fuzzed: m[k], clean: null, note: 'all-null CGM series, want null' }));
        },
        p2() {
          for (;;) {
            const v = [];
            let x = rint(95, 125);
            for (let i = 0; i < LEN; i++) {
              x = Math.max(60, Math.min(190, x + rint(-4, 4) + Math.round(6 * Math.sin(i / 30))));
              v.push(x);
            }
            const mask = nullMask(LEN);
            const t = tms(LEN);
            const fv = v.map((y, i) => (mask[i] ? null : y));
            const cv = v.filter((_, i) => !mask[i]);
            const ct = t.filter((_, i) => !mask[i]);
            if (cv.length < 30) continue;
            const nulls = LEN - cv.length;
            return compareMetrics(metrics(GD.compute({ tMs: t, vMgdl: fv })), metrics(GD.compute({ tMs: ct, vMgdl: cv })), `nulls=${nulls}/${LEN}`);
          }
        }
      };
    }
  },

  /* Shared machinery: the absence contract at the smallest units every node leans on. No dropout geometry — each
   * iteration draws random operands and asserts null in → null out. A tripwire: it stays green until someone breaks it. */
  machinery: {
    files: ['kernel-constants.js', 'clock.js', 'quantity.js'],
    known: {},
    setup(ctx) {
      const Q = ctx.Quantity || (ctx.DexQuantity && ctx.DexQuantity.Quantity);
      const CK = ctx.DexClock;
      if (!Q || !CK || typeof CK.parseTimestamp !== 'function') throw new Error('Quantity / DexClock not reachable');
      const junk = ['', ' ', 'null', 'undefined', 'abc', '--:--', '25:61:61', '2026-13-45 99:99', '99/99/9999 99:99:99', 'T', null, undefined];
      const bad = [null, undefined, Number.NaN, 'x', Number.POSITIVE_INFINITY];
      const units = ['kg', 'cm', 'mmol/L'];
      return {
        /** Selftest plant: the exact bug JS makes easy — an absent operand silently yields the surviving one. Returns the restore. */
        plant() {
          const orig = Q.prototype.add;
          Q.prototype.add = function (o) {
            return new Q(this.value != null ? this.value : o.value, this.unit);
          };
          return () => {
            Q.prototype.add = orig;
          };
        },
        p1() {
          return [];
        },
        p2() {
          const f = [];
          const u = units[rint(0, units.length - 1)];
          const val = +(rnd() * 100).toFixed(2);
          const nullQ = Q(bad[rint(0, bad.length - 1)], u);
          for (const [name, r] of [
            ['Quantity.add(value, null)', () => Q(val, u).add(nullQ).value],
            ['Quantity.add(null, value)', () => nullQ.add(Q(val, u)).value],
            ['Quantity(null).as(unit)', () => nullQ.as(u)]
          ]) {
            let got;
            try {
              got = r();
            } catch (e) {
              got = `threw: ${String(e.message).slice(0, 60)}`;
            }
            if (got !== null) f.push({ property: 'M1', metric: name, fuzzed: got, clean: null, note: 'absent operand must give null' });
          }
          const j = junk[rint(0, junk.length - 1)];
          let r;
          try {
            r = CK.parseTimestamp(j, {});
          } catch (e) {
            r = `threw: ${String(e.message).slice(0, 60)}`;
          }
          if (r !== null)
            f.push({
              property: 'M1',
              metric: 'DexClock.parseTimestamp(junk)',
              fuzzed: typeof r === 'object' ? JSON.stringify(r) : r,
              clean: null,
              note: `input ${JSON.stringify(j)} must give null, never now`
            });
          return f;
        }
      };
    }
  }
};
/* ── --selftest: prove the comparator is neither noisy nor vacuous, per target ─────────────────────────
 * CONTROL: a night with no nulls must equal its own clean twin (0 failures) — otherwise every P2 finding below is suspect.
 * PLANT (machinery only, where there is no dropout geometry): reinstate the classic `null + x === x` bug and demand a red. */
if (has('selftest')) {
  let bad = 0;
  for (const [name, def] of Object.entries(TARGETS)) {
    const r = def.setup(loadDsp(def.files));
    NO_NULLS = true;
    reseed(1);
    let ctl = 0;
    for (let i = 0; i < 3; i++) ctl += r.p2().length;
    NO_NULLS = false;
    let plantMsg = '';
    if (typeof r.plant === 'function') {
      const restore = r.plant();
      reseed(1);
      let hit = 0;
      for (let i = 0; i < 20; i++) hit += r.p2().length;
      restore();
      plantMsg = ` · plant red ${hit}${hit > 0 ? '' : ' ✗ VACUOUS'}`;
      if (hit === 0) bad++;
    }
    if (ctl !== 0) bad++;
    console.log(`selftest ${name}: control (no nulls) ${ctl} failures${ctl === 0 ? ' ✓' : ' ✗ NOISY'}${plantMsg}`);
  }
  console.log(bad === 0 ? 'selftest PASS' : `selftest FAIL (${bad})`);
  process.exit(bad === 0 ? 0 : 1);
}

const targetDef = TARGETS[TARGET];
if (!targetDef) {
  console.error(`unknown --target ${TARGET}; known: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(2);
}
let runner;
try {
  runner = targetDef.setup(loadDsp(targetDef.files));
} catch (e) {
  console.error(`FATAL: target ${TARGET} did not load: ${String(e.message).slice(0, 200)}`);
  process.exit(2);
}

/* ── run ── */
const tRunStart = Date.now();
let lastBeat = 0;
function heartbeat(force) {
  const now = Date.now();
  if (!force && now - lastBeat < HEARTBEAT_SEC * 1000) return;
  lastBeat = now;
  const seedsDone = bundle.completed_seeds.length;
  const itersDone = bundle.stats.iters_run;
  const itersTotal = SEEDS * ITERS;
  const elapsed = (now - tRunStart) / 1000;
  const rate = itersDone / Math.max(elapsed, 0.001);
  const eta = rate > 0 ? Math.max(0, (itersTotal - itersDone) / rate) : Number.POSITIVE_INFINITY;
  let etaStr = '?';
  if (Number.isFinite(eta)) etaStr = eta < 90 ? `${eta.toFixed(0)}s` : `${(eta / 60).toFixed(1)}m`;
  const failuresSoFar = bundle.failure_count + seedFailures.length;
  const groupsSoFar = Object.keys(bundle.groups).length;
  // §2.4: real running values — seeds, iters, rate, ETA, failures and groups so far. Never a placeholder.
  console.error(
    `null-fuzz[${TARGET}]: seeds ${seedsDone}/${SEEDS} iters ${itersDone}/${itersTotal} ${rate.toFixed(1)}/s ETA ${etaStr} failures ${failuresSoFar} in ${groupsSoFar} group(s) → ${OUT_PATH}`
  );
}

console.error(
  `null-fuzz v3.2 target=${TARGET}: seeds ${SEED_START}..${SEED_START + SEEDS - 1} iters=${ITERS} len=${LEN} keep=${KEEP} out=${OUT_PATH}${RESUME ? ' (resume)' : ''}${QUIET ? ' (quiet)' : ''}`
);

for (let s = 0; s < SEEDS; s++) {
  const seed = SEED_START + s;
  if (bundle.completed_seeds.includes(seed)) continue; // §2.2: skip completed units on resume
  reseed(seed);
  seedFailures = [];
  const t0p1 = Date.now();
  try {
    for (const f of runner.p1()) fail({ ...f, seed, iter: -1 });
  } catch (e) {
    fail({ property: 'P1', seed, iter: -1, metric: '(threw)', fuzzed: String(e.message).slice(0, 80), clean: null, note: 'p1 threw' });
  }
  bundle.stats.ms_total += Date.now() - t0p1;
  for (let it = 0; it < ITERS; it++) {
    const t0 = Date.now();
    try {
      for (const f of runner.p2()) fail({ ...f, seed, iter: it });
    } catch (e) {
      fail({ property: 'P2', seed, iter: it, metric: '(threw)', fuzzed: String(e.message).slice(0, 80), clean: null, note: 'target threw' });
    } finally {
      bundle.stats.ms_total += Date.now() - t0;
      bundle.stats.iters_run++;
    }
    heartbeat(false);
  }
  bundle.completed_seeds.push(seed);
  for (const f of seedFailures) addFailure(bundle, f); // merge only on completion
  seedFailures = [];
  saveBundle(); // §2.2: atomic checkpoint per completed unit
  heartbeat(true);
}

/* ── final bundle, report, verdict ── */
const { s: finalSummary, v: finalVerdict } = await finish(bundle);
saveBundle();
heartbeat(true);
console.error(
  `null-fuzz done: ${finalSummary.verdict} — ${finalSummary.failures} failing assertions in ${finalSummary.groups} group(s) (${finalSummary.novel_groups.length} novel) across ${finalSummary.seeds_run} seeds — report ${REPORT_PATH}`
);
process.exit(finalVerdict.status === 'PASS' ? 0 : 1);
