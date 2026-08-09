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
 * Resume is automatic: a file whose result carries `complete: true` is skipped.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, realpathSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { cpus } from 'node:os';
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
   reason, and looked like a finding. The list mirrors `dex-coload.js`'s `shared:`. */
const SPINE = ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'dex-export.js', 'dex-units.js', 'signal-frame.js'];
function loadRealm(text) {
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
function runBattery(fn, bat) {
  const out = [];
  for (const args of bat.args()) {
    let r;
    try {
      r = fn.apply(null, args);
    } catch (e) {
      r = 'THREW:' + (e && e.message);
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
function sweep(file) {
  const outFile = join(OUT, basename(file) + '.sweep.json');
  const args = ['tools/mutate.mjs', '--file', file, '--limit', '9999', '--jobs', String(JOBS), '--bail', '--json'];
  const txt = execFileSync('node', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 6 * 3600 * 1000 });
  const rec = JSON.parse(txt.trim().split('\n')[0]);
  writeFileSync(outFile, JSON.stringify(rec, null, 2) + '\n');
  return rec;
}
function enclosingFn(lines, lineNo) {
  for (let i = Math.min(lineNo - 1, lines.length - 1); i >= 0; i--) {
    const m = lines[i].match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/) || lines[i].match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/);
    if (m && !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(m[1])) return m[1];
  }
  return '(top level)';
}
function probeFile(file, rec) {
  const abs = join(ROOT, file);
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
    const baseRows = runBattery(baseFn, bat);
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
        rows = runBattery(resolve(mut, path), bat);
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
    kill = 0;
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
    const k = (j.findings || []).reduce((a, x) => a + (x.killable || 0), 0);
    const s = (j.findings || []).reduce((a, x) => a + (x.survivors || 0), 0);
    tot += s;
    kill += k;
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
  console.log('\n  ' + kill + ' killable of ' + tot + ' survivors across ' + files.length + ' file(s)');
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
