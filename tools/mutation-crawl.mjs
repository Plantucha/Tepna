// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/**
 * MUTATION CRAWL — run the MEASUREMENT unattended, so a person only does the judgement.
 *
 * A mutation sweep produces survivors. A survivor is not a work item: on `ppgdex-dsp.js`, 767 of them
 * across 84 functions, and roughly three quarters cannot be killed by ANY input. Turning that pile
 * into work means, per survivor, finding an input that separates it from the original — mechanical,
 * slow, and exactly what a machine should do while nobody is watching.
 *
 * So this crawls: sweep → triage → probe → append to a work list. It runs for hours, resumes after a
 * crash, and hands back "these N mutants ARE killable, and here is the input that proves it for each"
 * instead of "here are 767 survivors, good luck".
 *
 * WHAT IT DELIBERATELY DOES NOT DO — WRITE TESTS.
 * Every kill in this repo's mutation work came from reading a distinguishing input and deciding what
 * CONTRACT it implies: that a flat spectrum means "no peak" rather than "rate zero"; that a refusal
 * must still NAME the node it is refusing. A script can hand you the input. It cannot decide what the
 * code ought to promise, and a generated assertion that merely pins current output would kill the
 * mutant while proving nothing. The judgement stays with the author.
 *
 * IT NEVER TOUCHES SOURCE, TESTS, OR GIT. It writes only under its results directory. `mutate.mjs`
 * does mutate files while sweeping, but only inside its own disposable worktrees (`--jobs > 1`), and
 * it carries its own on-disk backup + `recoverStale()` for the case where it is killed mid-run.
 *
 * THE NUMBER IT REPORTS IS A LOWER BOUND, AND THE PROVENANCE TRAVELS WITH IT.
 * "Killable" means "this battery found a distinguishing input". A battery too narrow to make two
 * outputs differ reports "equivalent" about ITSELF, not about the code — measured, twice, painfully:
 * one probe read `PPGDSP.loadOwnExport`, which is `undefined`, so every case threw the identical
 * "not a function" and original matched mutant BY CONSTRUCTION. It reported 0 of 22. Pointed at the
 * right handle, the same battery found 17. Every record therefore carries `battery` (which one) and
 * `batteryInputs` (how many), and a probe whose outputs never varied is reported as UNUSABLE rather
 * than as evidence of equivalence.
 *
 * USAGE
 *   node tools/mutation-crawl.mjs                        # crawl the default DSP fleet
 *   node tools/mutation-crawl.mjs --file hrvdex-dsp.js   # one file (repeatable)
 *   node tools/mutation-crawl.mjs --max-hours 40         # stop starting new work after 40 h
 *   node tools/mutation-crawl.mjs --jobs 12              # worker pool per sweep
 *   node tools/mutation-crawl.mjs --out /tmp/crawl       # results directory
 *   node tools/mutation-crawl.mjs --status               # read the checkpoint, run nothing
 *   node tools/mutation-crawl.mjs --selftest             # known-answer, touches nothing
 *
 * Resume is automatic, at three levels, and each is guarded by the hash of the source file and of
 * `tests/dex-tests.js` — never by time or by trust:
 *   · a file whose result carries `complete: true` is skipped entirely;
 *   · a file whose SWEEP completed but whose PROBE failed reuses the cached sweep (no re-test);
 *   · a sweep interrupted mid-flight resumes from `mutate.mjs`'s journal.
 * If either hash has moved, the cache and the journal are refused and the sweep runs cold, saying
 * which input changed. The per-file ceiling is whatever remains of `--max-hours`, not a constant.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, realpathSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const OUT = opt('--out', join(ROOT, '.mutation-crawl'));
const JOBS = +opt('--jobs', Math.max(2, Math.round((cpus().length * 2) / 3)));
const MAX_MS = +opt('--max-hours', 48) * 3600 * 1000;
const T0 = Date.now();

const DEFAULT_FLEET = ['hrvdex-dsp.js', 'motiondex-dsp.js', 'pulsedex-dsp.js', 'cpapdex-dsp.js', 'glucodex-dsp.js', 'ppgdex-dsp.js', 'oxydex-dsp.js', 'ecgdex-dsp.js', 'integrator-dsp.js'];

const log = (s) => process.stderr.write('  ' + s + '\n');

/* ── ANOTHER SWEEP ON THE BOX IS A REASON TO WAIT, NOT TO COMPETE ───────────────────────────────
   Two sweeps on 24 cores do not take twice as long each — they start TIMING OUT, and a timed-out
   mutant is scored INVALID and silently leaves the denominator. Measured: a contended run reported
   `killed 79 invalid 25` and read as if a quarter of a module's coverage had vanished. Unattended,
   nobody is there to notice, so the crawl backs off instead.

   Matched on the command line rather than by process group, and this function is careful to exclude
   ITS OWN pid: `pgrep -f` matching your own command line is a classic self-deadlock, and a wait loop
   that waits on itself never exits. */
export function otherSweepPids(psOutput, selfPid) {
  const out = [];
  for (const line of String(psOutput).split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const cmd = m[2];
    if (pid === selfPid) continue;
    if (!/\bnode\b/.test(cmd)) continue;
    if (!/tools\/mutate\.mjs/.test(cmd)) continue;
    if (/mutation-crawl/.test(cmd)) continue; // our own launcher, not a sweep
    out.push(pid);
  }
  return out;
}
function busy() {
  try {
    return otherSweepPids(execSync('ps -eo pid,args --no-headers', { encoding: 'utf8' }), process.pid);
  } catch {
    return [];
  }
}
async function waitForQuiet() {
  for (;;) {
    const b = busy();
    if (!b.length) return true;
    if (Date.now() - T0 > MAX_MS) return false;
    log('another sweep is running (pid ' + b.join(', ') + ') — waiting 5 min rather than competing');
    await new Promise((r) => setTimeout(r, 300000));
  }
}

/* ── REALM LOADING ──────────────────────────────────────────────────────────────────────────────
   A DSP is an IIFE that hangs its API off a global. WHICH global differs per file and sometimes per
   FUNCTION within a file — `PPGDSP` and `PpgDex` are both present in ppgdex-dsp.js and do not carry
   the same members. So do not guess a name: load, then collect every global object that owns
   functions, and let the caller look a function up across all of them. Guessing the handle is the
   bug that made a probe report 0 of 22. */
/* THE SPINE MUST BE CO-LOADED FIRST. `clock.js` is inlined into every bundle and the delegating DSPs
   (oxydex/pulsedex/hrvdex/ecgdex/integrator) alias `DexClock` at module scope — so a realm without it
   throws `DexClock is not defined` at LOAD, before a single function exists to probe. Measured: the
   first end-to-end run of this crawler reported "0 KILLABLE of 298 survivors" for exactly that
   reason, and looked like a finding.

   This list is WIDER than `dex-coload.js`'s `shared:` (which is `['clock.js']` alone) and the comment
   here used to claim it mirrored it — it does not, and should not: co-loading is about what a running
   app needs, this is about what a module body can reference before any function is called. It also
   carried `dex-units.js`, which does not exist in this repo and never has; every load is
   `existsSync`-guarded so it cost nothing but a reader's confidence. Each entry below resolves. */
const SPINE = ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'dex-export.js', 'signal-frame.js'];
export function loadRealm(text) {
  const src = String(text).replace(/^export .*$/gm, '');
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Math,
    Date,
    JSON,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    Number,
    String,
    Array,
    Object,
    Boolean,
    Float64Array,
    Float32Array,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int32Array,
    ArrayBuffer,
    DataView,
    BigInt,
    TextDecoder,
    TextEncoder,
    RegExp,
    Error,
    TypeError,
    RangeError,
    Map,
    Set,
    WeakMap,
    Promise,
    setTimeout,
    clearTimeout,
    structuredClone
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.global = ctx;
  /* ── A DOM STUB, BECAUSE A DSP THAT TOUCHES `document` AT LOAD TIME IS NOT A DSP THAT NEEDS A DOM.
     `oxydex-dsp.js:153` reads `document.documentElement.outerHTML` while the module body runs, so the
     whole realm threw `document is not defined` and the probe reported UNMEASURED for the fleet's
     LARGEST file — 1477 survivors, more than every other node's survivors put together, invisible
     for two full crawls (measured 2026-08-16 and again on 2026-08-17 after a 193-minute re-sweep).
     Six references in that file, all incidental: an `outerHTML` read for parser provenance and five
     `getElementById`/`createElement` calls inside UI handlers no probe ever enters.

     The stub is INERT ON PURPOSE — every getter returns an empty string or null, every method is a
     no-op. It exists to let the module body finish, not to simulate a browser: a stub that returned
     plausible elements would let UI code run under the prober and make a mutant's verdict depend on
     a fake DOM, which is a worse failure than the one being fixed. Anything that genuinely needs a
     document belongs in the browser lane, where there is a real one. */
  /* `dataset` and `style` are plain bags rather than getters: `metric-registry.js:applyTier` guards
     on `document.body` being truthy and then WRITES `b.dataset.mode`. Introducing a document makes
     that path execute for the first time, so the stub has to absorb the write — the selftest below
     caught it as `Cannot set properties of undefined (setting 'mode')`. It is the general hazard of
     stubbing a host object: the stub's SHAPE decides which branches run, so every field here exists
     because something real reached for it, and each one absorbs rather than answers. */
  const stubEl = () => ({
    outerHTML: '',
    innerHTML: '',
    textContent: '',
    value: '',
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {},
    removeChild() {},
    addEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
  });
  ctx.document = {
    documentElement: stubEl(),
    body: stubEl(),
    getElementById: () => null,
    createElement: () => stubEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}
  };
  vm.createContext(ctx);
  for (const dep of SPINE) {
    const p = join(ROOT, dep);
    if (existsSync(p)) vm.runInContext(readFileSync(p, 'utf8').replace(/^export .*$/gm, ''), ctx);
  }
  vm.runInContext(src, ctx);
  return ctx;
}
/** Every callable reachable as `<global>.<name>`, deduped by identity, with where it was found. */
export function calleesOf(ctx, seedKeys) {
  const found = new Map();
  const visit = (obj, path, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 2) return;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'function') {
        if (!found.has(k)) found.set(k, path + '.' + k);
      } else if (v && typeof v === 'object' && depth < 2) {
        /* DESCEND ONE LEVEL. HRVDex hangs its testable API off `HRVDex._bare.computeDerived`, not off
           `HRVDex.computeDerived` — a flat scan finds nothing and reports every survivor as
           UNREACHABLE, which is indistinguishable from "this code is untestable". Measured: the first
           run after the realm was fixed called all 298 hrvdex survivors unreachable for this reason. */
        visit(v, path + '.' + k, depth + 1);
      }
    }
  };
  for (const g of seedKeys) visit(ctx[g], g, 1);
  return found;
}
function globalNames(ctx) {
  return Object.keys(ctx).filter((k) => ctx[k] && typeof ctx[k] === 'object' && !['window', 'globalThis', 'self', 'global', 'console', 'JSON', 'Math'].includes(k));
}

/* ── BATTERIES ──────────────────────────────────────────────────────────────────────────────────
   Per-function batteries where the shape is known; a generic one otherwise. The generic battery is
   deliberately weak and SAYS SO in the record — its job is to find the easy half, not to license a
   claim of equivalence. A survivor that only a hand-built battery could separate must come back as
   "not distinguished by the generic battery", which is a different statement from "equivalent". */
const NN = (f, amp, n) => {
  const tt = [],
    nn = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const rr = 1000 + amp * Math.sin(2 * Math.PI * f * t);
    nn.push(rr);
    tt.push(t);
    t += rr / 1000;
  }
  return [tt, nn];
};
const PPG_TEXT = (n, cols, hdr) => {
  const H6 = 'Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient';
  const H3 = 'Phone timestamp;sensor timestamp [ns];channel 0';
  const L = [];
  if (hdr) L.push(cols === 6 ? H6 : H3);
  const start = Date.UTC(2026, 5, 21, 6, 5, 23);
  for (let i = 0; i < n; i++) {
    const ms = new Date(start + Math.round((i * 1000) / 135)).toISOString().replace('Z', '');
    const v = 200000 + Math.round(3000 * Math.sin((2 * Math.PI * 1.1 * i) / 135));
    L.push(cols === 6 ? `${ms};${i * 7407407};${v};${v + 11};${v + 22};${v + 33}` : `${ms};${i * 7407407};${v}`);
  }
  return L.join('\n');
};
const NODE_EXPORT = (o) => Object.assign({ schema: { name: 'ganglior.node-export', node: 'PpgDex' } }, o);

export const BATTERIES = {
  /* Frequency-domain: every band edge plus just inside and outside it, lengths spanning the minimum,
     amplitudes including zero (a FLAT signal is the only input where "no peak" is observable). */
  spectral: {
    name: 'spectral',
    args() {
      const out = [];
      const F = [0.003, 0.0031, 0.0029, 0.04, 0.0401, 0.0399, 0.15, 0.1501, 0.1499, 0.4, 0.401, 0.399, 0.01, 0.08, 0.25, 0.5];
      for (const n of [7, 8, 9, 20, 60, 300]) for (const f of F) for (const amp of [0, 1, 40, 120]) out.push(NN(f, amp, n));
      out.push(
        [[], []],
        [[0], [1000]],
        [
          [0, 1, 2],
          [1000, 1000, 1000]
        ]
      );
      return out;
    }
  },
  /* Text parsing: row counts across every floor, both column layouts, headerless, junk, blanks. */
  ppgText: {
    name: 'ppgText',
    args() {
      const out = [];
      for (const n of [0, 1, 5, 9, 10, 11, 50, 300]) for (const cols of [3, 6]) for (const hdr of [true, false]) out.push([PPG_TEXT(n, cols, hdr)]);
      for (const raw of ['', ' ', '\n', 'not a ppg file', ';;;;;', '1;2;3;4;5;6']) out.push([raw]);
      return out;
    }
  },
  /* Node-export validation: schema shape, node identity in every spelling, carrier variants. */
  nodeExport: {
    name: 'nodeExport',
    args() {
      return [
        [null],
        [undefined],
        [42],
        ['x'],
        [[]],
        [{}],
        [{ schema: 1 }],
        [{ schema: { name: 'other', node: 'PpgDex' } }],
        [{ schema: { node: 'PpgDex' } }],
        [{ schema: { name: 'ganglior.node-export', node: '' } }],
        [{ schema: { name: 'ganglior.node-export', node: 'OxyDex' } }],
        [{ schema: { name: 'ganglior.node-export', node: '  PpgDex  ' } }],
        [NODE_EXPORT({ summary: { n: 1 } })],
        [NODE_EXPORT({ sessions: [] })],
        [NODE_EXPORT({ sessions: [{ a: 1 }] })],
        [NODE_EXPORT({ sessions: [{ a: 1 }, { a: 2 }, { a: 3 }] })],
        [NODE_EXPORT({ sessions: { a: 1 } })],
        [NODE_EXPORT({ crossNight: { nights: 2 }, sessions: [{ a: 1 }] })],
        [{ schema: { name: 'ganglior.node-export', node: 'PpgDex', scrubbed: true }, sessions: [{ a: 1 }] }],
        [NODE_EXPORT({ sessions: [{ hrv: { from: 's' } }], hrv: { from: 't' } })],
        [NODE_EXPORT({ sessions: [{ a: 1 }], hrv: { from: 't' }, quality: { q: 1 }, personalization: { p: 1 } })]
      ];
    }
  },
  /* The fallback. Universal shapes only — it finds crashes and gross refusals, little else. */
  generic: {
    name: 'generic',
    args() {
      const A = [undefined, null, 0, 1, -1, NaN, Infinity, '', 'x', '0', true, false, [], [1, 2, 3], {}, { a: 1 }];
      const out = [];
      for (const a of A) out.push([a]);
      for (const a of [null, 0, 1, [], [1, 2, 3], {}]) for (const b of [null, 0, 1, [], { a: 1 }]) out.push([a, b]);
      return out;
    }
  }
};
/** Which battery suits a function, by name. Explicit table first — never guess from arity alone. */
export function batteryFor(fnName) {
  const n = String(fnName);
  if (/lombScargle|spectral|freqDomain|welch/i.test(n)) return BATTERIES.spectral;
  if (/^parse(PPG|Ppg)|parseSignal/i.test(n)) return BATTERIES.ppgText;
  if (/loadOwnExport|NodeExport|scrubExport/i.test(n)) return BATTERIES.nodeExport;
  return BATTERIES.generic;
}

/** Run a battery and return a stable string. Non-serialisable results are labelled, not dropped. */
/* ── A MUTANT THAT NEVER RETURNS MUST NOT WEDGE THE CRAWL ───────────────────────────────────────
   `fn.apply(null, args)` called from the HOST has no timeout and cannot be interrupted. Mutation
   testing MANUFACTURES non-terminating loops — deleting the body of `while (t < prev) t += 86400000;`
   leaves `while (cond) ;` — so this is an expected output, not an edge case.

   Measured 2026-08-16: ppgdex-dsp.js swept fine (538/1346 killed, 808 survivors, canary PASSED,
   38 min) and then the probe phase ran **11 h 11 m of CPU at 93 %, single-threaded, with zero
   output**, produced no result file, and blocked oxydex and ecgdex from ever being crawled. It would
   not have stopped on its own.

   THE FIX IS WHERE THE CALL HAPPENS, NOT WHAT IT CALLS. `vm`'s `timeout` interrupts synchronous
   script execution — but only for code running INSIDE `runInContext`. Holding a function reference
   from the realm and calling it out here escapes that entirely, which is exactly what this did. So
   the call is moved back inside the realm, where the timeout applies.

   Both the ORIGINAL and the MUTANT run under the same budget, so a genuinely slow function times out
   on both sides and produces no false difference. A timeout is recorded as its own outcome rather
   than as a throw: "did not terminate" is a real behavioural difference, and labelling it keeps it
   from being read as an ordinary killable one-liner — no test can assert "hangs" the way it asserts
   a value. */
const PROBE_TIMEOUT_MS = +opt('--probe-timeout-ms', 2000);
function runBattery(fn, bat, ctx) {
  const out = [];
  for (const args of bat.args()) {
    let r;
    try {
      if (ctx) {
        ctx.__probeFn = fn;
        ctx.__probeArgs = args;
        r = vm.runInContext('__probeFn.apply(null, __probeArgs)', ctx, { timeout: PROBE_TIMEOUT_MS });
      } else {
        r = fn.apply(null, args);
      }
    } catch (e) {
      const msg = String((e && e.message) || e);
      r = /Script execution timed out|ERR_SCRIPT_EXECUTION_TIMEOUT/i.test(msg) ? 'TIMEOUT:' + PROBE_TIMEOUT_MS + 'ms — did not terminate' : 'THREW:' + (e && e.message);
    } finally {
      if (ctx) {
        ctx.__probeFn = undefined;
        ctx.__probeArgs = undefined;
      }
    }
    let s;
    try {
      s = JSON.stringify(r, (k, v) => (typeof v === 'bigint' ? String(v) : ArrayBuffer.isView(v) ? Array.from(v).slice(0, 8) : v));
    } catch {
      s = 'UNSERIALISABLE';
    }
    out.push(s === undefined ? 'undefined' : s);
  }
  return out;
}
/* A DIFFERENCE THE PROBE ITSELF CAUSED IS NOT EVIDENCE ABOUT THE CODE.
   A DSP guards optional co-loaded modules with `typeof DexUnits !== 'undefined' && DexUnits…`. In a
   realm that lacks DexUnits the ORIGINAL short-circuits safely, while the `&&`→`||` mutant evaluates
   the missing identifier and throws `DexUnits is not defined`. The two differ — but only because the
   probe's realm is incomplete, and in the real suite both would take the same path. Counting that as
   KILLABLE hands someone a work item that cannot be written.

   So: a difference whose mutant output is a ReferenceError for an identifier the BASE realm also
   lacks is reported as REALM-ARTEFACT. Co-loading the spine (above) removes most of these; this
   catches whatever the list misses, which matters because the list will always be one module behind
   the code. */
export function isRealmArtefact(origRow, mutRow, ctxHasIdent) {
  const m = /^"?THREW:(?:ReferenceError: )?([A-Za-z_$][\w$]*) is not defined/.exec(String(mutRow));
  if (!m) return null;
  if (/is not defined/.test(String(origRow))) return null; // both failed the same way → not it
  return ctxHasIdent(m[1]) ? null : m[1];
}
/** True when a battery produced ANY variety — the guard against a probe that never ran its subject. */
export function batteryIsUsable(rows) {
  const s = new Set(rows);
  if (s.size > 1) return true;
  const only = rows[0];
  /* The leading `"` matters: results are JSON-stringified, so a thrown string arrives as
     `"THREW:… is not a function"`, and an anchored /^THREW/ never matches it. The selftest caught
     this — which is the guard that exists to catch a probe reading the wrong handle, failing in
     exactly the way it was written to detect. */
  return !(only === undefined || /^"?THREW:.*is not a function/.test(String(only)));
}

// ── the crawl ──────────────────────────────────────────────────────────────────────────────────

/* ── A SWEEP THAT RAN FOR HOURS MUST NEVER BE THROWN AWAY ───────────────────────────────────────
   Three separate ways this tool used to discard work it had already paid for, all measured on the
   2026-08-16/17 fleet crawl:

   1. `timeout: 6 h` was a CONSTANT while the crawl's own budget is 48 h. `integrator-dsp.js` ran
      717 of 1845 mutants in 354 min at 8 jobs, hit the ceiling, threw `spawnSync node ETIMEDOUT`,
      and the crawl recorded an error — six hours of test execution, gone. The ceiling now derives
      from the budget actually remaining, so a file that legitimately needs 5.5 h is not killed by
      a number that has nothing to do with it.
   2. `mutate.mjs` has journalled every verdict since it was written, and takes `--resume` — the
      crawl passed neither. So even the interrupted run above could have continued from mutant 717
      and did not, because nobody asked it to.
   3. A sweep whose PROBE failed left `complete:false`, and resume is per-file on `complete:true` —
      so the next run re-swept from zero to reach the same failing probe. `oxydex-dsp.js` re-ran a
      193-minute sweep on 2026-08-17 to fail on `document is not defined` a second time.

   RESUMING IS ONLY SOUND ACROSS IDENTICAL CODE, and `--resume` deliberately does not check: it
   replays every recorded verdict, which is right for "the same run continued" and wrong for
   anything else. (`--incremental` is the hash-validated mode, but it never reuses a SURVIVED
   verdict — on a survivor-heavy file it re-tests almost everything, which is not what is needed
   here.) So the CRAWL supplies the identity guard that `--resume` lacks: it stamps the source and
   the test file's hashes beside the journal, and resumes only on an exact match. A mismatch
   discards the journal and sweeps cold, saying which input moved. This fails CLOSED — a stale
   journal replayed against changed code would fabricate verdicts for mutants that were never run
   under it, which is this repo's oldest failure class wearing a new hat (§🔏). */
const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** The identity a journal/sweep was produced under: the mutated source + the suite that judged it. */
export function sweepIdentity(srcText, testsText) {
  return { srcHash: sha16(String(srcText)), testsHash: sha16(String(testsText)) };
}

/** Which of the two inputs moved — the message a resume refusal owes the reader. */
export function identityDrift(a, b) {
  if (!a || !b) return 'no recorded identity';
  const out = [];
  if (a.srcHash !== b.srcHash) out.push('source changed');
  if (a.testsHash !== b.testsHash) out.push('tests/dex-tests.js changed');
  return out.join(' + ') || null;
}

/** Only worth logging "sweeping cold" when there was something on disk it could have used. */
function hasCacheOrJournal(outFile, journal) {
  return existsSync(outFile) || existsSync(journal);
}

function currentIdentity(file) {
  let tests = '';
  try {
    tests = readFileSync(join(ROOT, 'tests/dex-tests.js'), 'utf8');
  } catch {
    /* no suite readable ⇒ no identity ⇒ nothing may be resumed, which fails closed */
    return null;
  }
  try {
    return sweepIdentity(readFileSync(join(ROOT, file), 'utf8'), tests);
  } catch {
    return null;
  }
}

/* ── THE DECISION, AS A PURE FUNCTION ───────────────────────────────────────────────────────────
   Three inputs on disk (a cached sweep, a state stamp, a journal) and one computed identity give
   four possible actions, and the two expensive mistakes are OPPOSITE: re-sweeping when a cache was
   valid costs 193 minutes, and reusing when it was not fabricates verdicts. Deciding that inline
   made both branches unreachable from a test, which is how this tool's sibling `land-pr.mjs` earned
   its own pure decision core. `reason` is not decoration — it is what the log line prints, so a
   refusal that a reader cannot explain cannot ship. */
export function sweepPlan({ hasSweep, hasState, hasJournal, state, now }) {
  /* No identity computable (unreadable source or suite) ⇒ nothing may be trusted. Fails CLOSED. */
  if (!now) return { action: 'cold', reason: 'no identity for the current source/suite' };
  const drift = state ? identityDrift(state.identity, now) : 'no recorded identity';
  if (hasSweep && hasState && state && state.complete) {
    if (!drift) return { action: 'reuse', reason: 'source and suite hash unchanged' };
    return { action: 'cold', reason: 'cached sweep not reusable: ' + drift };
  }
  if (hasJournal) {
    if (!drift) return { action: 'resume', reason: 'same source, same suite' };
    return { action: 'cold', reason: 'journal not resumable (' + drift + ')' };
  }
  return { action: 'cold', reason: 'no cache, no journal' };
}

function sweep(file) {
  const outFile = join(OUT, basename(file) + '.sweep.json');
  const stateFile = join(OUT, basename(file) + '.sweep-state.json');
  const journal = join(ROOT, '.mutate-journal', file.replace(/[/\\]/g, '_') + '.jsonl');
  const now = currentIdentity(file);
  let state = null;
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    /* absent or unreadable ⇒ no stamp ⇒ the planner treats it as unattributable */
  }
  const plan = sweepPlan({ hasSweep: existsSync(outFile), hasState: existsSync(stateFile), hasJournal: existsSync(journal), state, now });

  /* A completed sweep is a pure function of (source, suite): if both still hash the same, re-running
     it cannot produce a different answer — so a probe that failed last time gets a second attempt for
     the price of the probe, not the price of the sweep. */
  if (plan.action === 'reuse') {
    try {
      const rec = JSON.parse(readFileSync(outFile, 'utf8'));
      if (rec && Array.isArray(rec.survivors)) {
        log('   ↻ REUSING the cached sweep — ' + plan.reason + ' (' + rec.survivors.length + ' survivors, no re-test needed)');
        return rec;
      }
      log('   cached sweep unreadable as a record — sweeping cold');
    } catch {
      log('   cached sweep unreadable — sweeping cold');
    }
  } else if (plan.action === 'resume') {
    log('   ↻ RESUMING from the journal — ' + plan.reason);
  } else if (hasCacheOrJournal(outFile, journal)) {
    log('   ' + plan.reason + ' — sweeping cold');
  }

  writeFileSync(stateFile, JSON.stringify({ file, identity: now, complete: false, startedAt: new Date().toISOString() }, null, 2) + '\n');

  /* The ceiling is what is LEFT OF THE BUDGET, not a constant unrelated to it. */
  const remaining = MAX_MS - (Date.now() - T0);
  const args = ['tools/mutate.mjs', '--file', file, '--limit', '9999', '--jobs', String(JOBS), '--bail', '--json'];
  if (plan.action === 'resume') args.push('--resume');
  const txt = execFileSync('node', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: Math.max(60000, remaining) });
  const rec = JSON.parse(txt.trim().split('\n')[0]);
  writeFileSync(outFile, JSON.stringify(rec, null, 2) + '\n');
  writeFileSync(stateFile, JSON.stringify({ file, identity: now, complete: true, finishedAt: new Date().toISOString() }, null, 2) + '\n');
  return rec;
}
function enclosingFn(lines, lineNo) {
  for (let i = Math.min(lineNo - 1, lines.length - 1); i >= 0; i--) {
    const m = lines[i].match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/) || lines[i].match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/);
    if (m && !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(m[1])) return m[1];
  }
  return '(top level)';
}
/* ── CALL-SITE CONTEXT ──────────────────────────────────────────────────────────────────────────
   Where else in the repo does this identifier appear? Grouped by area, because the area is what a
   reader actually sorts on: a function referenced only from `tests/` and `tools/regen-*` is fixture
   scaffolding; one referenced from `adapters/` or another DSP is load-bearing. Counted over a corpus
   read ONCE per file rather than grepping per function — there are hundreds of functions and the
   corpus is a few megabytes.

   Word-boundary matched. A substring match would count `computeDerivedX` as a reference to
   `computeDerived`, and inflating a signal that exists to be read by eye is worse than omitting it. */
export function callSiteContext(fnName, corpus) {
  const re = new RegExp('\\b' + String(fnName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
  const areas = {};
  const files = [];
  for (const [path, text] of corpus) {
    if (!re.test(text)) continue;
    const area = path.startsWith('tests/')
      ? 'tests'
      : path.startsWith('tools/')
        ? 'tools'
        : path.startsWith('adapters/')
          ? 'adapters'
          : path.includes('/')
            ? 'other'
            : /-dsp\.js$/.test(path)
              ? 'dsp'
              : 'root';
    areas[area] = (areas[area] || 0) + 1;
    files.push(path);
  }
  return { areas, files: files.slice(0, 6), total: files.length };
}
/** Read the JS corpus once: every tracked .js/.mjs outside node_modules, keyed by repo-relative path. */
function readCorpus() {
  const out = [];
  let list = [];
  try {
    list = execSync('git ls-files "*.js" "*.mjs"', { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
      .split('\n')
      .filter(Boolean);
  } catch {
    return out;
  }
  for (const f of list) {
    try {
      out.push([f, readFileSync(join(ROOT, f), 'utf8')]);
    } catch {}
  }
  return out;
}

function probeFile(file, rec) {
  const abs = join(ROOT, file);
  // exclude the file under test: it DEFINES the function, which is not a reference to it
  const corpus = readCorpus().filter(([p]) => p !== file);
  const SRC = readFileSync(abs, 'utf8');
  const lines = SRC.split('\n');
  let base;
  try {
    base = loadRealm(SRC);
  } catch (e) {
    return { probed: 0, error: 'realm load failed: ' + e.message, findings: [] };
  }
  const seeds = globalNames(base);
  const callees = calleesOf(base, seeds);

  // group survivors by enclosing function; only those we can actually CALL are probeable
  const byFn = new Map();
  for (const s of rec.survivors || []) {
    const fn = enclosingFn(lines, s.line);
    if (!byFn.has(fn)) byFn.set(fn, []);
    byFn.get(fn).push(s);
  }
  const findings = [];
  let probed = 0;
  for (const [fn, list] of [...byFn.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const path = callees.get(fn);
    if (!path) {
      findings.push({ fn, survivors: list.length, status: 'UNREACHABLE', note: 'not exported — no handle to call it with' });
      continue;
    }
    const bat = batteryFor(fn);
    const resolve = (root, dotted) => dotted.split('.').reduce((o, seg) => (o == null ? o : o[seg]), root);
    const baseFn = resolve(base, path);
    if (typeof baseFn !== 'function') {
      findings.push({ fn, survivors: list.length, status: 'UNRESOLVABLE', callPath: path, note: 'the recorded path did not resolve to a function — not evidence about the code' });
      continue;
    }
    const baseRows = runBattery(baseFn, bat, base);
    if (!batteryIsUsable(baseRows)) {
      findings.push({
        fn,
        survivors: list.length,
        status: 'BATTERY-UNUSABLE',
        battery: bat.name,
        note: 'every input produced the same result — the probe is not exercising this function; NOT evidence of equivalence'
      });
      continue;
    }
    const per = [];
    for (const m of list) {
      const L = lines.slice();
      const i = m.line - 1;
      if (!L[i] || !L[i].includes(String(m.before).trim())) {
        per.push({ line: m.line, op: m.op, status: 'ANCHOR-MISS' });
        continue;
      }
      L[i] = L[i].replace(String(m.before).trim(), String(m.after).trim());
      let mut;
      try {
        mut = loadRealm(L.join('\n'));
      } catch {
        per.push({ line: m.line, op: m.op, status: 'WONT-LOAD' });
        continue;
      }
      let rows;
      try {
        rows = runBattery(resolve(mut, path), bat, mut);
      } catch (e) {
        per.push({ line: m.line, op: m.op, status: 'PROBE-THREW', detail: e.message });
        continue;
      }
      probed++;
      let idx = -1;
      for (let z = 0; z < Math.max(rows.length, baseRows.length); z++)
        if (rows[z] !== baseRows[z]) {
          idx = z;
          break;
        }
      const artefact = idx < 0 ? null : isRealmArtefact(baseRows[idx], rows[idx], (id) => id in base);
      if (artefact) {
        per.push({
          line: m.line,
          op: m.op,
          status: 'REALM-ARTEFACT',
          missing: artefact,
          note: 'the mutant differs only by throwing on `' + artefact + '`, which this probe realm lacks — the suite co-loads it, so this is not a work item'
        });
      } else if (idx < 0) {
        per.push({ line: m.line, op: m.op, status: 'no-distinguishing-input' });
      } else {
        const args = bat.args()[idx];
        let argStr;
        try {
          argStr = JSON.stringify(args, (kk, v) => (Array.isArray(v) && v.length > 8 ? v.slice(0, 8).concat(['…+' + (v.length - 8)]) : v));
        } catch {
          argStr = '(unserialisable)';
        }
        per.push({
          line: m.line,
          op: m.op,
          status: 'KILLABLE',
          before: String(m.before).trim().slice(0, 120),
          /* ⚠️ RECORD WHAT THE MUTATION ACTUALLY WAS. Without this, a KILLABLE record carries the
             ORIGINAL text and the operator NAME but not the replacement — and `mutation-ai-probe`'s
             canary replays it with `mutateAtLine(src, line, before, after)`, where `String(undefined)`
             becomes the literal identifier `undefined`. Measured 2026-08-24: `if (a > 0)` was replayed
             as `if (undefined)` — an expression-nulling mutation nobody recorded, in place of the
             `cmp > → >=` that was. Across the fleet: 165 KILLABLE records, 0 carrying `after`.
             So the canary has been proving the harness can detect *a* difference, never that it can
             detect THE recorded one. It worked as a liveness check by accident: nulling an expression
             usually also kills. The line above already uses `m.after` to build the mutant — it was
             simply never persisted. */
          after: String(m.after).trim().slice(0, 120),
          input: String(argStr).slice(0, 400),
          orig: String(baseRows[idx]).slice(0, 300),
          mutant: String(rows[idx]).slice(0, 300)
        });
      }
    }
    findings.push({
      fn,
      survivors: list.length,
      status: 'PROBED',
      battery: bat.name,
      batteryInputs: bat.args().length,
      callPath: path,
      killable: per.filter((p) => p.status === 'KILLABLE').length,
      realmArtefacts: per.filter((p) => p.status === 'REALM-ARTEFACT').length,
      /* WHO ELSE REFERENCES THIS FUNCTION — reported, never acted on. The crawl ranks by COUNT, and
         count is not value: CPAPDex's two biggest clusters were `_synthEdfSet` (38 killable) and
         `_synthRaw` (11), which are SYNTHETIC FIXTURE GENERATORS — `cohort-gen.js` calls the first
         "test-shaped" in a comment. Their mutants are cheap to kill and worth little, while
         `pressureEnvelope`'s two are worth more than all 38. 49 of that file's 67 "work items" were
         not production code at all.

         Deliberately NOT a `_synth*` heuristic. A rule that decides what is production code fails
         silently the day a real DSP function is called `_synthesizeEnvelope`, and it would vanish
         from the work list with nothing to show it had been dropped.

         AND THIS IS NOT A CLASSIFIER EITHER — measured on the file that motivated it. It separates
         the EXTREMES well (`compute` 70 refs across root/dsp/adapters; `_synthRaw` 1 ref, tools-only)
         and NOT the middle: `_synthEdfSet` (a fixture generator) shows 7 refs across four areas,
         while `pressureEnvelope` (production, a shipped metric) shows 2 — the fixture looks MORE
         load-bearing than the real code. So this is a pointer to the call sites worth opening, not a
         ranking. Anyone using it to sort automatically will mis-rank `pressureEnvelope`. */
      referencedBy: callSiteContext(fn, corpus),
      mutants: per
    });
  }
  return { probed, findings };
}

function statusReport() {
  if (!existsSync(OUT)) return console.log('no crawl results at ' + OUT);
  const files = readdirSync(OUT).filter((f) => f.endsWith('.crawl.json'));
  if (!files.length) return console.log('no completed files in ' + OUT);
  let tot = 0,
    kill = 0,
    counted = 0;
  console.log('MUTATION CRAWL — results in ' + OUT + '\n');
  for (const f of files.sort()) {
    const j = JSON.parse(readFileSync(join(OUT, f), 'utf8'));
    if (j.voided) {
      console.log('  ' + j.file.padEnd(22) + ' ⚠ VOID — canary survived; this file measured nothing');
      continue;
    }
    if (j.probeFailed) {
      console.log('  ' + j.file.padEnd(22) + ' ⚠ UNMEASURED — probe failed: ' + String(j.probeError || 'nothing probed').slice(0, 60));
      continue;
    }
    /* A SWEEP THAT DIED IS NOT A FILE WITH NO SURVIVORS. The two guards above already refuse to
       report a void or unprobed file as a result; a sweep that failed outright had no such branch
       and fell through to the normal row, where `(j.findings || [])` is empty and every reduce
       returns 0. Measured 2026-08-16: integrator-dsp.js timed out at 717/1845 after 354 minutes
       (`spawnSync node ETIMEDOUT`) and the summary rendered

           integrator-dsp.js   killed undefined/NaN   survivors 0   KILLABLE 0

       then counted it in "across 6 file(s)" — a six-hour failure presented as a clean file with
       nothing left to do, and folded into the fleet totals as if it had contributed.

       The RESULT FILE was honest the whole time (`complete: false` plus the error), so resume
       correctly re-runs it. Only the summary lied, which is the worse place for it: resume is read
       by the tool, the summary is read by a person deciding whether the work is done. */
    if (!j.complete || j.error) {
      console.log('  ' + j.file.padEnd(22) + ' ⚠ INCOMPLETE — sweep did not finish: ' + String(j.error || 'no error recorded').slice(0, 60) + '  (re-run to resume; NOT counted below)');
      continue;
    }
    const k = (j.findings || []).reduce((a, x) => a + (x.killable || 0), 0);
    const s = (j.findings || []).reduce((a, x) => a + (x.survivors || 0), 0);
    tot += s;
    kill += k;
    counted++;
    console.log(
      '  ' +
        j.file.padEnd(22) +
        ' killed ' +
        String(j.killed).padStart(4) +
        '/' +
        String(j.tested - j.invalid).padEnd(5) +
        ' survivors ' +
        String(s).padStart(4) +
        '  KILLABLE ' +
        String(k).padStart(4) +
        (j.canary && j.canary !== 'PASSED' ? '   ⚠ canary ' + j.canary : '')
    );
  }
  /* `files.length` counts every result FILE, including the void / unmeasured / incomplete ones the
     loop above deliberately skipped — so the footer claimed six files while five had contributed.
     Count what was actually summed, and say plainly how many were excluded rather than quietly
     shrinking the denominator. */
  console.log(
    '\n  ' +
      kill +
      ' killable of ' +
      tot +
      ' survivors across ' +
      counted +
      ' file(s)' +
      (files.length - counted > 0 ? '   (' + (files.length - counted) + ' excluded above — void, unmeasured or incomplete)' : '')
  );
  console.log('  "killable" = a battery found a distinguishing input. It is a LOWER BOUND: see each');
  console.log("  finding's `battery` and `batteryInputs`, and note any BATTERY-UNUSABLE entries.");
}

function selftest() {
  let fail = 0;
  const ck = (n, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log((ok ? '  ✓ ' : '  ✕ ') + n + (ok ? '' : '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
    if (!ok) fail++;
  };
  console.log('otherSweepPids — a wait loop that waits on itself never exits');
  const ps = ['  111 node tools/mutate.mjs --file a.js', '  222 node tools/mutation-crawl.mjs', '  333 node tools/mutate.mjs --file b.js', '  444 vim tools/mutate.mjs', '  555 grep mutate.mjs'].join(
    '\n'
  );
  ck('finds other sweeps', otherSweepPids(ps, 999), [111, 333]);
  ck('excludes SELF by pid', otherSweepPids(ps, 111), [333]);
  ck('excludes the crawler itself', otherSweepPids('  222 node tools/mutation-crawl.mjs', 999), []);
  ck('excludes an editor holding the file open', otherSweepPids('  444 vim tools/mutate.mjs', 999), []);
  ck('excludes a grep that merely mentions it', otherSweepPids('  555 grep mutate.mjs', 999), []);

  console.log('\nbatteryIsUsable — a probe that never ran its subject is not evidence of equivalence');
  ck('varied output is usable', batteryIsUsable(['1', '2', '2']), true);
  ck('all-identical "not a function" is UNUSABLE', batteryIsUsable(['"THREW:P.foo is not a function"', '"THREW:P.foo is not a function"']), false);
  ck('all-undefined is UNUSABLE', batteryIsUsable([undefined, undefined]), false);
  ck('all-identical but REAL output is usable (a constant function is legitimate)', batteryIsUsable(['null', 'null']), true);

  /* Count is not value. CPAPDex's two largest killable clusters were synthetic FIXTURE generators —
     49 of its 67 "work items" were not production code. This reports where a name is referenced so a
     reader can sort in seconds; it must never decide, and it must never over-count. */
  console.log('\ncallSiteContext — reports where a name is used, and never decides what that means');
  const corpus = [
    ['tests/dex-tests.js', 'CpapDsp._synthEdfSet(opts)'],
    ['tools/regen-cpap-goldens.mjs', '_synthEdfSet → buildSession'],
    ['adapters/resmed-edf.js', 'compute/buildNightFromSets/_synthEdfSet'],
    ['oxydex-dsp.js', 'nothing relevant here'],
    ['cohort-gen.js', 'CpapDsp._synthEdfSet is test-shaped']
  ];
  const ctx1 = callSiteContext('_synthEdfSet', corpus);
  ck('counts every referencing file', ctx1.total, 4);
  ck('…grouped by area, which is what a reader sorts on', JSON.stringify(ctx1.areas), '{"tests":1,"tools":1,"adapters":1,"root":1}');
  ck('a name nobody references reports zero', callSiteContext('neverUsedAnywhere', corpus).total, 0);
  /* Word-boundary: a substring match would count `computeDerivedX` as a use of `computeDerived`, and
     inflating a signal that exists to be read by eye is worse than omitting it. */
  ck('does NOT match a longer identifier containing the name', callSiteContext('computeDerived', [['a.js', 'computeDerivedX(1)']]).total, 0);
  ck('…but does match the exact identifier', callSiteContext('computeDerived', [['a.js', 'x = computeDerived(rows)']]).total, 1);
  ck('a regex-special name does not blow up', callSiteContext('a.b', [['a.js', 'zzz']]).total, 0);

  console.log('\nisRealmArtefact — a difference the PROBE caused is not evidence about the code');
  const noIdent = () => false,
    hasIdent = () => true;
  ck('mutant throws on a module the realm lacks → artefact', isRealmArtefact('undefined', '"THREW:DexUnits is not defined"', noIdent), 'DexUnits');
  ck('…with the ReferenceError prefix too', isRealmArtefact('undefined', '"THREW:ReferenceError: DexUnits is not defined"', noIdent), 'DexUnits');
  ck('…but NOT when the realm actually has it (a real bug)', isRealmArtefact('undefined', '"THREW:DexUnits is not defined"', hasIdent), null);
  ck('…and NOT when the original throws the same way', isRealmArtefact('"THREW:X is not defined"', '"THREW:X is not defined"', noIdent), null);
  ck('an ordinary value difference is never an artefact', isRealmArtefact('1', '2', noIdent), null);
  ck('a non-ReferenceError throw is never an artefact', isRealmArtefact('1', '"THREW:boom"', noIdent), null);

  console.log('\nbatteryFor — an explicit table, never a guess from arity');
  ck('lombScargle → spectral', batteryFor('lombScargle').name, 'spectral');
  ck('parsePPG → ppgText', batteryFor('parsePPG').name, 'ppgText');
  ck('loadOwnExport → nodeExport', batteryFor('ppgLoadOwnExport').name, 'nodeExport');
  ck('anything else → generic', batteryFor('someHelper').name, 'generic');
  ck(
    'every battery yields inputs',
    Object.values(BATTERIES).every((b) => b.args().length > 0),
    true
  );

  /* A NON-TERMINATING MUTANT IS AN EXPECTED OUTPUT OF MUTATION TESTING, NOT AN EDGE CASE.
     Deleting the body of `while (t < prev) t += 86400000;` leaves `while (cond) ;`. Before this
     guard, one such mutant wedged the ppgdex probe for 11 h 11 m of CPU with no output and no
     result file, and blocked two further files from ever being crawled. The shapes below are the
     real one and a bare spin; both must come back TIMEOUT rather than never coming back. */
  console.log('\nrunBattery — a mutant that never returns is timed out, not waited on');
  {
    const tctx = { Math, Number, String, Array, Object, JSON, isFinite };
    tctx.globalThis = tctx;
    vm.createContext(tctx);
    const one = (src, args) => runBattery(vm.runInContext('(' + src + ')', tctx), { args: () => [args] }, tctx)[0];
    ck('a terminating function still returns its value', one('function(a){return a*2}', [21]), '42');
    ck('a throwing function still reports THREW', /THREW:boom/.test(String(one('function(){throw new Error("boom")}', []))), true);
    ck('an infinite loop reports TIMEOUT', /^"?TIMEOUT:/.test(String(one('function(){var t=0;while(true){t++;}return t;}', []))), true);
    ck('…including the `while (cond) ;` shape statement-deletion actually produces', /^"?TIMEOUT:/.test(String(one('function(t,prev){while(t<prev);return t;}', [0, 10]))), true);
  }

  /* RESUMING IS ONLY SOUND ACROSS IDENTICAL CODE. `--resume` replays verdicts without checking, so
     the identity guard is the crawl's, and it must refuse on EITHER input moving — a suite edit
     changes what "killed" means just as surely as a source edit does. */
  console.log('\nsweepIdentity / identityDrift — a journal is resumable only under the code that wrote it');
  const idA = sweepIdentity('source A', 'tests A');
  ck('the same inputs hash the same', identityDrift(idA, sweepIdentity('source A', 'tests A')), null);
  ck('a changed SOURCE refuses', identityDrift(idA, sweepIdentity('source B', 'tests A')), 'source changed');
  ck('a changed SUITE refuses — it changes what "killed" means', identityDrift(idA, sweepIdentity('source A', 'tests B')), 'tests/dex-tests.js changed');
  ck('both moving names both', identityDrift(idA, sweepIdentity('source B', 'tests B')), 'source changed + tests/dex-tests.js changed');
  /* Fails CLOSED: an absent identity is never treated as a match. The pre-existing journals on disk
     when this shipped had no stamp, and replaying them would have been exactly the fabricated-verdict
     failure the guard exists to prevent. */
  ck('a MISSING recorded identity refuses rather than matching', identityDrift(null, idA), 'no recorded identity');
  ck('…in either position', identityDrift(idA, null), 'no recorded identity');

  /* The two mistakes this planner sits between are OPPOSITE in cost: re-sweeping a valid cache spends
     193 minutes, reusing an invalid one fabricates verdicts. So both directions are asserted. */
  console.log('\nsweepPlan — reuse what is provably the same, refuse everything else');
  const ID = sweepIdentity('src', 'tests');
  const OLD = sweepIdentity('src OLD', 'tests');
  const P = (o) => sweepPlan({ hasSweep: false, hasState: false, hasJournal: false, state: null, now: ID, ...o });
  ck('a completed sweep under the same identity is REUSED', P({ hasSweep: true, hasState: true, state: { complete: true, identity: ID } }).action, 'reuse');
  ck('…and is REFUSED once the source moves', P({ hasSweep: true, hasState: true, state: { complete: true, identity: OLD } }).action, 'cold');
  ck('…naming what moved, because the log line is the reason', P({ hasSweep: true, hasState: true, state: { complete: true, identity: OLD } }).reason, 'cached sweep not reusable: source changed');
  ck('an INCOMPLETE sweep is not a cache — it falls through to the journal', P({ hasSweep: true, hasState: true, hasJournal: true, state: { complete: false, identity: ID } }).action, 'resume');
  ck('a journal under the same identity RESUMES', P({ hasJournal: true, hasState: true, state: { complete: false, identity: ID } }).action, 'resume');
  ck('…and is REFUSED once the suite moves', P({ hasJournal: true, hasState: true, state: { complete: false, identity: sweepIdentity('src', 'tests NEW') } }).action, 'cold');
  /* The journals already on disk when this shipped carried NO stamp. Replaying them would have been
     the fabricated-verdict failure this guard exists to prevent, so an unstamped journal is cold. */
  ck('an UNSTAMPED journal (pre-dating this guard) is never resumed', P({ hasJournal: true }).action, 'cold');
  ck('…saying so', P({ hasJournal: true }).reason, 'journal not resumable (no recorded identity)');
  ck('nothing on disk sweeps cold', P({}).action, 'cold');
  /* Fails closed on an unreadable source or suite: no identity ⇒ nothing is trusted, cache included.
     Asserted on the REASON, not just the action. Deleting the `!now` guard leaves the action `cold`
     either way — `identityDrift` refuses a null on either side — so an action-only assertion could
     not tell the two apart, and a planted deletion of that guard survived until this line checked the
     message. The distinction is worth keeping: it points at the unreadable SOURCE rather than at the
     journal, and sending a reader to the wrong file is the whole cost of a vague refusal. */
  const noId = sweepPlan({ hasSweep: true, hasState: true, hasJournal: true, state: { complete: true, identity: ID }, now: null });
  ck('no computable identity refuses even a complete cache', noId.action, 'cold');
  ck('…blaming the unreadable source, not the journal', noId.reason, 'no identity for the current source/suite');

  /* The realm must survive a module body that touches `document` at load. This is the assertion that
     was seen to FAIL against the pre-fix realm — it threw `document is not defined`, which is exactly
     how oxydex-dsp.js's 1477 survivors went unmeasured across two crawls. */
  console.log('\nloadRealm — a DSP that reads `document` at load time must not take the realm down');
  {
    const probeSrc =
      'var _prov = document.documentElement.outerHTML;\n' + 'globalThis.Probe = { echo: function (x) { return x * 2; }, el: function () { return document.getElementById("nope"); } };\n';
    let realm = null,
      threw = null;
    try {
      realm = loadRealm(probeSrc);
    } catch (e) {
      threw = String((e && e.message) || e);
    }
    ck('a module body reading document.documentElement.outerHTML loads', threw, null);
    ck('…and its functions are then reachable', realm && typeof realm.Probe.echo === 'function' ? realm.Probe.echo(21) : null, 42);
    /* INERT, not simulated: the stub must not hand back a plausible element, or a mutant's verdict
       starts depending on a DOM this harness invented. */
    ck('getElementById returns null — the stub is inert, not a fake browser', realm && realm.Probe.el(), null);
  }

  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all green');
  return fail ? 1 : 0;
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────
/* RUN ONLY WHEN INVOKED AS A PROGRAM.
   Without this guard, `import { batteryFor } from './mutation-crawl.mjs'` STARTS A MULTI-HOUR CRAWL.
   That is not hypothetical — it happened the first time this file's own exports were imported to
   check them, and the import had to be killed. The functions above are exported precisely so they
   can be exercised without side effects; a module that acts on import cannot be. `mutate.mjs` has
   the same defect and deserves the same fix. */
const INVOKED_DIRECTLY = (() => {
  try {
    return !!process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();
if (INVOKED_DIRECTLY) await main();

async function main() {
  if (has('--selftest')) process.exit(selftest());
  if (has('--status')) {
    statusReport();
    process.exit(0);
  }

  mkdirSync(OUT, { recursive: true });
  const files = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--file' && argv[i + 1]) files.push(argv[i + 1]);
  const TARGETS = files.length ? files : DEFAULT_FLEET;

  log('MUTATION CRAWL — measurement only. It never edits source, tests, or git.');
  log('targets: ' + TARGETS.length + ' file(s) · jobs ' + JOBS + ' · budget ' + (MAX_MS / 3600000).toFixed(1) + ' h · out ' + OUT);
  log('resume: a file with complete:true is skipped. Re-run this exact command to continue.\n');

  for (const file of TARGETS) {
    const dest = join(OUT, basename(file) + '.crawl.json');
    if (existsSync(dest)) {
      try {
        if (JSON.parse(readFileSync(dest, 'utf8')).complete) {
          log('skip ' + file + ' (already complete)');
          continue;
        }
      } catch {}
    }
    if (Date.now() - T0 > MAX_MS) {
      log('budget spent — stopping before ' + file);
      break;
    }
    if (!existsSync(join(ROOT, file))) {
      log('skip ' + file + ' (not found)');
      continue;
    }
    if (!(await waitForQuiet())) {
      log('budget spent while waiting for a quiet box — stopping');
      break;
    }

    log('── ' + file + ' — sweeping (this is the long part)');
    let rec;
    const t = Date.now();
    try {
      rec = sweep(file);
    } catch (e) {
      writeFileSync(dest, JSON.stringify({ file, complete: false, error: String(e.message).slice(0, 400) }, null, 2) + '\n');
      log('   sweep FAILED: ' + String(e.message).slice(0, 120));
      continue;
    }
    log(
      '   killed ' +
        rec.killed +
        '/' +
        (rec.tested - rec.invalid) +
        '  survivors ' +
        rec.survivors.length +
        '  invalid ' +
        rec.invalid +
        '  canary ' +
        rec.canary +
        '  (' +
        Math.round((Date.now() - t) / 60000) +
        ' min)'
    );
    if (rec.canary === 'FAILED') {
      /* A voided sweep is not a smaller result, it is NO result: the harness could not be shown to be
       detecting kills, so nothing downstream of it means anything. Record and move on. */
      writeFileSync(
        dest,
        JSON.stringify({ file, complete: true, voided: true, canary: rec.canary, note: 'canary survived — the harness was not detecting kills; this file measured nothing' }, null, 2) + '\n'
      );
      log('   ⚠ CANARY FAILED — recorded as VOID, not as a low score');
      continue;
    }
    log('   probing ' + rec.survivors.length + ' survivors for distinguishing inputs…');
    const p = probeFile(file, rec);
    const killable = (p.findings || []).reduce((a, x) => a + (x.killable || 0), 0);
    const unreachable = (p.findings || []).filter((x) => x.status === 'UNREACHABLE').reduce((a, x) => a + x.survivors, 0);
    /* A PROBE THAT COULD NOT RUN IS NOT A RESULT OF ZERO. If the realm failed to load, or nothing was
     probed at all, the file is recorded as PROBE-FAILED with `killable: null` — never as
     "0 killable", which reads as "nothing here is fixable" and is the precise false-equivalence this
     tool exists to prevent. It happened on the very first end-to-end run: `DexClock is not defined`
     killed the realm, and the result file said 0 of 298 as if that were a measurement. */
    const probeFailed = !!p.error || (rec.survivors.length > 0 && p.probed === 0);
    if (probeFailed) log('   ⚠ PROBE FAILED (' + (p.error || 'nothing was probed') + ') — recorded as unmeasured, NOT as zero');
    const tmp = dest + '.tmp';
    writeFileSync(
      tmp,
      JSON.stringify(
        {
          file,
          complete: !probeFailed,
          probeFailed: probeFailed || undefined,
          probeError: p.error || undefined,
          generatedAt: new Date(T0).toISOString().slice(0, 10),
          killed: rec.killed,
          tested: rec.tested,
          invalid: rec.invalid,
          canary: rec.canary,
          survivors: rec.survivors.length,
          probed: p.probed,
          killable: probeFailed ? null : killable,
          unreachable: probeFailed ? null : unreachable,
          invalids: rec.invalids || [],
          findings: p.findings
        },
        null,
        2
      ) + '\n'
    );
    renameSync(tmp, dest); // atomic: a half-written result must never look complete
    log(
      probeFailed
        ? '   → UNMEASURED — no killable count reported for a probe that did not run\n'
        : '   → ' + killable + ' KILLABLE of ' + rec.survivors.length + ' survivors (' + unreachable + ' unreachable, not exported)\n'
    );
  }
  log('crawl finished. `node tools/mutation-crawl.mjs --status` for the summary.');
}
