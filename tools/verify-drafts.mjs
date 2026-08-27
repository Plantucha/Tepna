#!/usr/bin/env node
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
//
// verify-drafts.mjs — re-verify qwen mutation drafts IN THE REALM THAT WILL RUN THEM.
//
// 🔴 WHY THIS EXISTS (QWEN-ENGINEERING-PROGRAM §2.1, forced by the first adoption pass). A draft's
// expected value is "machine-verified" — but verified against the DRAFTING harness's environment,
// not the suite's. Where the two differ, the tool records a value the real code never produces.
// Measured in the first batch, 2 of 48 (4 %):
//
//   · `computeMOS(null).mos` recorded 3. The real code returns 1 and CANNOT return 3 — that needs
//     `null >= K.MOS_LONG`, and MOS_LONG is 15. The drafting realm lacked the kernel constant.
//   · `getFilteredRows(null)` recorded length 58. In the suite realm it THROWS on `_tMs` of
//     undefined. The drafting realm had a populated DOM; the suite does not.
//
// Both would have been adopted as passing assertions pinning behaviour the code has never had.
//
// ⚠️ AND THE COMPARATOR IS PART OF THE REALM. 4 more drafts recorded the literal string "undefined"
// where the suite's `T.eq` tags an undefined value `@undef` — a value that never round-trips through
// the comparator that will judge it. So this tool imports `dexSerializeForEq` FROM THE SUITE rather
// than re-implementing the tagging: a copy would answer a different question than adoption asks,
// which is the very divergence being measured. (`tests/dex-tests.js` learned that once already, in
// the group that used to re-declare its own private `ser`.)
//
// THREE BUCKETS, and UNEXECUTABLE is a first-class honest answer, not a failure:
//   VERIFIED     — the projection reproduces the recorded value, through the suite's comparator.
//   DIVERGENT    — it reproduces something ELSE. Both values are shown; adoption must not proceed.
//   UNEXECUTABLE — the co-load realm cannot reach the call (missing global, throwing constructor).
//                  NOT a divergence: we did not measure it, and saying so is the point. Counting an
//                  unexecutable as verified is how a blind spot ships as a green number.
//
// This tool VERIFIES ONLY. It never edits a draft's content and never adopts anything.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const require_ = createRequire(import.meta.url);

/** Where the drafts live: machine-local `<git-common-dir>/tepna-mutation/`, never committed.
 *
 * ⚠️ IT IS THE COMMON DIR, NOT `<root>/.git`, AND THAT DISTINCTION IS THE NORMAL CASE HERE. In a
 * WORKTREE — which CLAUDE.md §👥.1 mandates for exactly this kind of work — `.git` is a FILE pointing
 * at the primary checkout's git dir, so `join(root, '.git', 'tepna-mutation')` does not exist. The
 * first version of this did that and reported "no drafts dir", which reads as "there is nothing to
 * verify" rather than "I looked in the wrong place": a silent zero, from the tool whose entire job is
 * to stop silent zeros. `git rev-parse --git-common-dir` resolves it for a worktree and a plain
 * checkout alike. */
export function draftsDir(root = ROOT, { run = execFileSync } = {}) {
  try {
    const common = String(run('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' })).trim();
    return join(resolve(root, common), 'tepna-mutation');
  } catch {
    return join(root, '.git', 'tepna-mutation'); // not a git dir at all — the honest fallback
  }
}

/** THE SUITE'S OWN comparator — imported, never copied. See the header. */
export function suiteSerializer(root = ROOT) {
  const mod = require_(join(root, 'tests', 'dex-tests.js'));
  if (typeof mod.dexSerializeForEq !== 'function') {
    // FAIL LOUD. Falling back to a local JSON.stringify would silently answer a different question
    // than adoption asks, and every result after that point would be a comfortable lie.
    throw new Error('tests/dex-tests.js does not export dexSerializeForEq — refusing to guess');
  }
  return mod.dexSerializeForEq;
}

/** Parse one drafts file into blocks. Content is READ, never rewritten. */
export function parseDrafts(text) {
  const out = [];
  for (const chunk of text.split('/* mutant:').slice(1)) {
    const mutant = chunk.split('\n')[0].trim();
    const call = (chunk.match(/const out = ([\s\S]*?);\s*\n\s*T\.eq\(/) || [])[1];
    const eq = chunk.match(/T\.eq\((".*?"),\s*JSON\.stringify\(([\s\S]*?)\),\s*([\s\S]*?)\);\s*\n/);
    if (!call || !eq) continue;
    out.push({ mutant, call: call.trim(), label: eq[1], projection: eq[2].trim(), expected: eq[3].trim() });
  }
  return out;
}

/* Extra modules the suite's realm carries beyond `dex-coload.js`'s manifest. The manifest is the
   single ordered source of truth for the CO-LOAD set, but the node runner adds these, and a draft
   for CPAPDex or the Integrator needs them. Kept explicit and SHORT rather than globbing the root:
   a glob would pull app/render files that need a DOM, and their throw would masquerade as a
   divergence in whatever loaded next. A module missing from here shows up as UNEXECUTABLE, naming
   the global it could not resolve — a loud, correct answer rather than a silent skip. */
const EXTRA_MODULES = ['kernel-constants.js', 'metric-registry.js', 'oxydex-util.js', 'cpapdex-dsp.js', 'integrator-dsp.js', 'dex-export.js'];

/** Build the co-load realm the suite uses. Returns `{ ctx, loaded, failed }`. */
export function buildRealm(root = ROOT, { readFile = readFileSync, exists = existsSync } = {}) {
  const build = require_(join(root, 'tools', 'build-core.js'));
  const classicify = (build.default || build).classicify || ((s) => s);
  const ctx = {
    console,
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    TypeError,
    Set,
    Map,
    WeakMap,
    Promise,
    Symbol,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    encodeURIComponent,
    decodeURIComponent,
    Uint8Array,
    Float64Array,
    Int32Array,
    Int16Array,
    ArrayBuffer,
    DataView,
    TextDecoder,
    TextEncoder,
    structuredClone
  };
  /* THE DOM STUB IS SEMANTIC, NOT SCAFFOLDING — it must match the SUITE's, deliberately minimal.
     Mirrors `makeSandbox()` in tests/run-tests.mjs (private to that CLI script; importing it would
     execute the whole suite). A RICHER stub would be actively wrong: `getFilteredRows(null)` recorded
     length 58 in the drafting realm precisely because that realm had a populated DOM, and it THROWS
     in the suite. A verifier with a generous stub would reproduce the drafting realm's answer and
     certify the divergence it exists to catch. `test_the_realm_reproduces_the_suite_not_the_drafter`
     pins that with the very draft that exposed it. */
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    append: noop,
    removeChild: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop
  });
  ctx.document = {
    getElementById: () => null,
    createElement: el,
    createTextNode: () => ({}),
    querySelector: () => null,
    querySelectorAll: () => [],
    head: el(),
    body: el(),
    documentElement: el(),
    addEventListener: noop,
    readyState: 'complete'
  };
  const _store = new Map();
  ctx.localStorage = { getItem: (k) => (_store.has(k) ? _store.get(k) : null), setItem: (k, v) => _store.set(k, String(v)), removeItem: (k) => _store.delete(k), clear: () => _store.clear() };
  ctx.setTimeout = setTimeout;
  ctx.clearTimeout = clearTimeout;
  ctx.addEventListener = noop;
  ctx.removeEventListener = noop;
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  let manifest = [];
  try {
    vm.runInContext(classicify(readFile(join(root, 'dex-coload.js'), 'utf8')), ctx, { filename: 'dex-coload.js' });
    // ⚠️ THE GLOBAL IS `DexCoload`. The first version read `DEX_COLOAD` — the module's INTERNAL
    // variable name, inferred from a grep of its body instead of read off its attachment line
    // (`root.DexCoload = DEX_COLOAD`). It resolved to undefined, the manifest silently contributed
    // ZERO modules, and 69 drafts reported UNEXECUTABLE — a confident, wrong, and entirely quiet
    // answer from the tool whose job is to prevent exactly that.
    const m = ctx.DexCoload || ctx.DEX_COLOAD || {};
    manifest = [].concat(
      m.shared || [],
      m.adapters || [],
      m.dsps || [],
      (m.nodeModules || []).map((x) => x.file)
    );
  } catch {
    /* The manifest itself failed to load. Every module then becomes an EXTRA-list load and most
       drafts land in UNEXECUTABLE — which is the honest report, not a reason to invent a list. */
  }
  const loaded = [];
  const firstError = new Map();
  /* DEDUPED. `dex-coload.js` legitimately lists `clock.js` in BOTH `shared` and `nodeModules` (one
     is the load order, the other the global-conformance set), so a naive concat evaluates it twice
     and the second evaluation dies on `Identifier 'DexClock' has already been declared` — a
     re-declaration error masquerading as a broken module. */
  let pending = [...new Set([...manifest, ...EXTRA_MODULES])]; // MANIFEST FIRST: it carries `shared` (clock.js),
  // and a delegating DSP evaluated before it dies on `DexClock is not defined`. The first version
  // loaded EXTRA_MODULES first and integrator-dsp.js failed for exactly that reason.
  let failed = [];
  /* TWO PASSES, so load ORDER is discovered rather than hand-maintained. A module that failed only
     because its dependency had not been evaluated yet succeeds on the retry; one that fails twice has
     a real problem and is reported with its message. A hand-ordered list would be a second source of
     truth beside `dex-coload.js`, and it would drift the first time a module gained a dependency. */
  for (let pass = 0; pass < 2 && pending.length; pass++) {
    const retry = [];
    for (const f of pending) {
      const p = join(root, f);
      if (!exists(p)) {
        failed.push([f, 'absent']);
        continue;
      }
      try {
        vm.runInContext(classicify(readFile(p, 'utf8')), ctx, { filename: p });
        loaded.push(f);
      } catch (e) {
        const msg = String(e && e.message);
        /* ⚠️ REPORT THE FIRST FAILURE, NOT THE RETRY'S. A pass-0 failure can partially evaluate a
           module, so the pass-1 retry dies on `Identifier 'X' has already been declared` — which
           REPLACES the real cause (`document is not defined`) with a re-declaration artifact. That
           cost real debugging time here: the retry pass, added to discover load order, made the one
           genuine failure illegible. First message wins. */
        const first = firstError.get(f) || msg;
        firstError.set(f, first);
        (pass === 0 ? retry : failed).push([f, first.slice(0, 90)]);
      }
    }
    pending = retry.map((r) => r[0]);
    if (pass === 1) failed = failed.concat(retry.filter((r) => !pending.includes(r[0])));
  }
  return { ctx, loaded, failed };
}

/** Verify ONE draft against a built realm. Never throws; classifies instead. */
export function verifyDraft(ctx, ser, d) {
  let got;
  try {
    // `out` and the projection are evaluated exactly as the adopted assertion would evaluate them.
    got = vm.runInContext(`(function(){ var out = ${d.call}; return JSON.stringify(${d.projection}); })()`, ctx, { timeout: 5000 });
  } catch (e) {
    const msg = String((e && e.message) || e);
    // A ReferenceError on the module global means the realm never had that DSP — unreachable, not
    // wrong. Anything else thrown by the CALL is a real behavioural difference from the drafting
    // realm (that is exactly how `getFilteredRows` was caught), so it is DIVERGENT.
    const unreachable = /is not defined|Cannot read properties of undefined \(reading '_bare'\)/.test(msg);
    return { ...d, bucket: unreachable ? 'UNEXECUTABLE' : 'DIVERGENT', got: unreachable ? null : `THREW:${msg.slice(0, 80)}`, reason: msg.slice(0, 100) };
  }
  let want;
  try {
    want = JSON.parse(d.expected);
  } catch {
    want = undefined;
  }
  // BOTH sides through the suite's serializer — the same call `T.eq` will make after adoption.
  const pass = ser(got) === ser(want);
  return { ...d, bucket: pass ? 'VERIFIED' : 'DIVERGENT', got: ser(got), want: ser(want) };
}

const MARK_BEGIN = '/* ── SUITE-REALM VERIFICATION ─────────────────────────────────────────────────';
const MARK_END = ' ── end suite-realm verification ── */';

/** Render the in-place summary block. PURE — takes results, returns text. */
export function renderSummary(results, stamp) {
  const n = (b) => results.filter((r) => r.bucket === b).length;
  const lines = [
    MARK_BEGIN,
    `   Verified in the SUITE's co-load realm ${stamp} by tools/verify-drafts.mjs.`,
    '   A draft is machine-verified against the DRAFTING realm; this says whether it also holds in',
    "   the realm that will run it. Comparison uses the suite's own `dexSerializeForEq`, so @undef /",
    '   @NaN / @-0 tagging round-trips exactly as T.eq will apply it after adoption.',
    '',
    `   VERIFIED ${n('VERIFIED')}   DIVERGENT ${n('DIVERGENT')}   UNEXECUTABLE ${n('UNEXECUTABLE')}   (of ${results.length})`,
    ''
  ];
  const div = results.filter((r) => r.bucket === 'DIVERGENT');
  if (div.length) {
    lines.push('   🔴 DIVERGENT — DO NOT ADOPT these without re-recording; the value does not reproduce:');
    for (const r of div) lines.push(`     · ${r.call} → ${r.projection}`, `         got ${String(r.got).slice(0, 76)}  ·  want ${String(r.want ?? r.expected).slice(0, 46)}`);
    lines.push('');
  }
  const un = results.filter((r) => r.bucket === 'UNEXECUTABLE');
  if (un.length) {
    lines.push('   ⚠️ UNEXECUTABLE — the realm could not reach these. NOT a pass and NOT a failure:', '      nothing was measured, and counting them as verified is how a blind spot ships green.');
    for (const r of un) lines.push(`     · ${r.call} — ${String(r.reason).slice(0, 74)}`);
    lines.push('');
  }
  lines.push(MARK_END);
  return lines.join('\n');
}

/** Insert/replace the summary block. The drafts' CONTENT is never touched. */
export function withSummary(text, summary) {
  const i = text.indexOf(MARK_BEGIN);
  if (i >= 0) {
    const j = text.indexOf(MARK_END, i);
    if (j >= 0) return text.slice(0, i) + summary + text.slice(j + MARK_END.length);
  }
  // First run: place it after the generated header comment so adoption reads it before any draft.
  const hdr = text.indexOf('*/');
  return hdr >= 0 ? `${text.slice(0, hdr + 2)}\n\n${summary}\n${text.slice(hdr + 2)}` : `${summary}\n${text}`;
}

export function main(argv = [], { root = ROOT, write = writeFileSync, now = () => new Date().toISOString().slice(0, 10) } = {}) {
  const dir = draftsDir(root);
  if (!existsSync(dir)) {
    process.stderr.write(`no drafts dir: ${dir}\n`);
    return 0;
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.drafts.js'))
    .sort();
  const ser = suiteSerializer(root);
  const { ctx, loaded, failed } = buildRealm(root);
  process.stderr.write(`realm: ${loaded.length} modules loaded${failed.length ? `, ${failed.length} failed (${failed.map((f) => f[0]).join(', ')})` : ''}\n`);

  const totals = { VERIFIED: 0, DIVERGENT: 0, UNEXECUTABLE: 0 };
  for (const f of files) {
    const p = join(dir, f);
    const text = readFileSync(p, 'utf8');
    const results = parseDrafts(text).map((d) => verifyDraft(ctx, ser, d));
    for (const r of results) totals[r.bucket]++;
    if (!argv.includes('--dry-run')) write(p, withSummary(text, renderSummary(results, now())), 'utf8');
    const n = (b) => results.filter((r) => r.bucket === b).length;
    process.stderr.write(`  ${f.padEnd(30)} verified ${n('VERIFIED')}  divergent ${n('DIVERGENT')}  unexecutable ${n('UNEXECUTABLE')}\n`);
  }
  process.stderr.write(`TOTAL verified ${totals.VERIFIED} · divergent ${totals.DIVERGENT} · unexecutable ${totals.UNEXECUTABLE}\n`);
  // Exit 0 always: this REPORTS, it does not gate. Adoption reads the buckets and decides.
  return 0;
}

export function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (name, cond, detail) => {
    if (cond) {
      pass++;
      console.log(`  ✓ ${name}`);
    } else {
      fail++;
      console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
    }
  };

  const ser = suiteSerializer();
  ok("the comparator is the SUITE's, and tags undefined as @undef", ser(undefined) === '"@undef"', ser(undefined));
  ok('…and NaN as @NaN, distinctly from null', ser(NaN) !== ser(null) && ser(NaN) === '"@NaN"');

  const SAMPLE = `/* header */\n\n  /* mutant: num -> 0  @ x\n     PROPERTY (model-written, needs a human read):\n     prose */\n  {\n    const out = Math.max(1,2);\n    T.eq("label", JSON.stringify(out), "2");\n  }\n`;
  const parsed = parseDrafts(SAMPLE);
  ok('a draft block parses to call + projection + expected', parsed.length === 1 && parsed[0].call === 'Math.max(1,2)' && parsed[0].expected === '"2"', JSON.stringify(parsed[0] || null).slice(0, 90));

  /* THE PLANTED DIVERGENT DRAFT — the control this tool exists for. Same call, a recorded value the
     code does not produce. A verifier that cannot fail here certifies everything, which is worse
     than no verifier: it converts "unchecked" into "checked and fine". */
  const ctx = vm.createContext({ Math, JSON });
  /* ⚠️ `expected` is the draft file's JSON TEXT, quotes included — `"2"`, not `2`. A first version of
     this fixture passed the bare `2`, which parses to a NUMBER while `got` is the STRINGIFIED value,
     so the control failed for a fixture defect rather than a tool defect. The selftest caught it. */
  const good = verifyDraft(ctx, ser, { call: 'Math.max(1,2)', projection: 'out', expected: '"2"' });
  ok('a draft whose value REPRODUCES is VERIFIED', good.bucket === 'VERIFIED', good.bucket);
  const bad = verifyDraft(ctx, ser, { call: 'Math.max(1,2)', projection: 'out', expected: '"99"' });
  ok('🔴 a PLANTED divergent draft is DIVERGENT, not verified', bad.bucket === 'DIVERGENT', bad.bucket);
  ok('…and it SHOWS BOTH values, so a human can judge which is right', String(bad.got).includes('2') && String(bad.want).includes('99'), `got ${bad.got} want ${bad.want}`);

  /* UNEXECUTABLE is not DIVERGENT. A realm that cannot reach a call measured NOTHING; reporting that
     as a divergence would send someone re-recording a draft that was never tested. */
  const unreach = verifyDraft(ctx, ser, { call: 'NoSuchGlobal.f()', projection: 'out', expected: '"1"' });
  ok('an unreachable call is UNEXECUTABLE, never DIVERGENT', unreach.bucket === 'UNEXECUTABLE', unreach.bucket);

  /* A THROW from a reachable call IS a divergence — that is how `getFilteredRows` was caught. */
  const threw = verifyDraft(ctx, ser, { call: '(function(){ throw new TypeError("boom"); })()', projection: 'out', expected: '"1"' });
  ok('a reachable call that THROWS is DIVERGENT, not unexecutable', threw.bucket === 'DIVERGENT', threw.bucket);

  const sum = renderSummary([{ bucket: 'VERIFIED' }, { bucket: 'DIVERGENT', call: 'c', projection: 'p', got: 'g', want: 'w' }], '2026-01-01');
  ok('the summary states all three counts', /VERIFIED 1/.test(sum) && /DIVERGENT 1/.test(sum) && /UNEXECUTABLE 0/.test(sum));
  const once = withSummary('/* h */\nbody\n', sum);
  const twice = withSummary(once, renderSummary([{ bucket: 'VERIFIED' }], '2026-01-02'));
  ok('re-running REPLACES the summary rather than stacking copies', (twice.match(/SUITE-REALM VERIFICATION/g) || []).length === 1);
  ok('…and the draft CONTENT is never modified', twice.includes('body'));

  /* ⚠️ THE WORDING IS THE CONTRACT. `tools/selftest-all.mjs` parses `all (\d+) selftests passed` to
     report a COUNT, and a tool whose summary it cannot parse is listed as "green but unparseable" —
     which the aggregate then cannot distinguish from a tool that lost its assertions. Matching the
     phrase is what makes this tool's count auditable rather than merely non-red. */
  console.log(fail === 0 ? `\n✓ all ${pass} selftests passed` : `\n✗ selftest — ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(process.argv.includes('--selftest') ? selftest() : main(process.argv.slice(2)));
}
