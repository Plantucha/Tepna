/**
 * tools/probe-child-death-codes.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * WHAT A DYING CHILD ACTUALLY REPORTS — measured, not reasoned.
 *
 * Residue `2026-09-22-heap-retry-would-misdiagnose-enospc` says a child killed by a FULL DISK could
 * abort the way a heap death aborts, so `trio-batch.mjs`'s `isHeapOom` would read it as a memory cap and
 * retry the night at `RETRY_HEAP_MB`. That is the wrong remedy, applied confidently, to a cause the
 * retry cannot touch. The row gates its own fix on "one real occurrence first", and none has arrived.
 *
 * This tool takes the third path the row does not name. It asks whether a disk fault can reach the exit
 * code the predicate keys on AT ALL. `isHeapOom(code, text)` returns `said || code === 134`, so a disk
 * death is misread only if its text carries a heap word, or its code is exactly 134.
 *
 * The instrument is `/dev/full`. It raises the kernel's own ENOSPC on every write, needs no root, and
 * fills nothing — so the measurement costs no disk and no night.
 *
 * Cases are four uncaught disk deaths plus three controls:
 *   · heap-control      — a real heap exhaustion under a 24 MB cap. Without it, "no disk death aborts"
 *                         could mean the probe cannot see an abort at all.
 *   · instrument-control — a child that CATCHES ENOSPC and calls `process.exit(134)`. Without it, a
 *                         count of zero could mean the probe cannot see a 134 at all.
 *   · abort-no-word     — `process.abort()` with no heap message, so the abort path is read for the WORD
 *                         and not for the signal.
 * A control that fails to establish itself makes the verdict UNKNOWN, never a pass.
 *
 * ⚠️ IT DOES NOT IMPORT `trio-batch.mjs`. That tool has no exports and spawns children during module
 * evaluation. And a probe that re-implemented the predicate would be pinning its own copy, not the
 * shipped one — so this tool reports the RAW (code, signal, word) facts the predicate reads, and the
 * predicate's own pins live in `trio-batch.mjs --selftest` over the strings measured here.
 *
 *   node tools/probe-child-death-codes.mjs             # the table and the verdict word
 *   node tools/probe-child-death-codes.mjs --json      # the tepna.verdict/1 object alone
 *   node tools/probe-child-death-codes.mjs --selftest  # planted truth over the pure classifier
 */
import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { refuseUnknownArgvOrExit, isCliEntry } from './argv-guard.mjs';
import { makeVerdict } from './verdict-emit.mjs';

const GATE = 'probe-child-death-codes';
const TOOL = 'tools/probe-child-death-codes.mjs';
/* PRE-STATED, before the first run (§🧾: a threshold read off the data it judges is UNKNOWN). The
   predicate's disk-fault arm is `code === 134`, so the quantity that decides is the number of uncaught
   disk deaths that land on it. One is enough to make the row's hazard real. */
const CRITERION = { name: 'disk_deaths_reaching_134', threshold: 0, unit: 'deaths', direction: 'lte' };
const FULL = '/dev/full';
const HEAP_WORD = /heap out of memory|Allocation failed/i;
const ENOSPC_WORD = /ENOSPC|No space left on device/i;

/* ── the cases ──────────────────────────────────────────────────────────────────────────────────── */
const CASES = [
  {
    id: 'writeFileSync',
    kind: 'disk-uncaught',
    needsFull: true,
    what: 'writeFileSync to a full device, uncaught',
    script: `require('node:fs').writeFileSync(${JSON.stringify(FULL)}, 'x'.repeat(1 << 16));`
  },
  {
    id: 'createWriteStream',
    kind: 'disk-uncaught',
    needsFull: true,
    what: 'createWriteStream to a full device, error event unhandled',
    script: `const s = require('node:fs').createWriteStream(${JSON.stringify(FULL)}); s.write('x'.repeat(1 << 16)); s.end();`
  },
  {
    id: 'writeSync',
    kind: 'disk-uncaught',
    needsFull: true,
    what: 'writeSync on an fd opened at a full device, uncaught',
    script: `const fs = require('node:fs'); fs.writeSync(fs.openSync(${JSON.stringify(FULL)}, 'w'), 'x'.repeat(1 << 16));`
  },
  {
    id: 'promisesWriteFile',
    kind: 'disk-uncaught',
    needsFull: true,
    what: 'fs/promises writeFile to a full device, rejection unhandled',
    script: `require('node:fs/promises').writeFile(${JSON.stringify(FULL)}, 'x'.repeat(1 << 16));`
  },
  {
    id: 'heapExhaustion',
    kind: 'heap-control',
    needsFull: false,
    heap: 24,
    what: 'a real heap exhaustion under a 24 MB cap',
    script: "const a = []; for (;;) a.push({ s: 'x'.repeat(1024) });"
  },
  {
    id: 'caughtThenExit134',
    kind: 'instrument-control',
    needsFull: true,
    what: 'ENOSPC caught, then a deliberate process.exit(134)',
    script: `try { require('node:fs').writeFileSync(${JSON.stringify(FULL)}, 'x'.repeat(1 << 16)); } catch (e) { console.error(String(e.message)); process.exit(134); }`
  },
  {
    id: 'bareAbort',
    kind: 'abort-no-word',
    needsFull: false,
    what: 'process.abort() carrying neither word',
    script: 'process.nextTick(() => process.abort());'
  }
];

/** Is the instrument present and writable? A probe cannot report absence as a pass. */
export function fullDeviceAvailable(path = FULL) {
  try {
    if (!statSync(path).isCharacterDevice()) return false;
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/* ── the pure classifier ────────────────────────────────────────────────────────────────────────── */
/** One recorded death to one label. Pure, so the selftest asserts the DECISION and not a subprocess. */
export function classifyDeath({ code, signal, text }) {
  const heap = HEAP_WORD.test(text || '');
  const enospc = ENOSPC_WORD.test(text || '');
  if (code === 134) return 'exit-134';
  if (signal === 'SIGABRT' && heap) return 'heap-abort';
  if (signal === 'SIGABRT') return 'bare-abort';
  if (enospc) return 'enospc-exit-' + String(code);
  if (code === 0) return 'survived';
  return 'other-exit-' + String(code);
}

/** Does this recorded death land on the predicate's disk-fault arm? Keyed on the CODE, as it is. */
export function reaches134(row) {
  return row.code === 134;
}

/* ── the run ────────────────────────────────────────────────────────────────────────────────────── */
function runCase(c, timeoutMs) {
  const args = [];
  if (c.heap) args.push('--max-old-space-size=' + c.heap);
  args.push('-e', c.script);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });
  const text = String(r.stdout || '') + String(r.stderr || '');
  const row = { id: c.id, kind: c.kind, what: c.what, code: r.status, signal: r.signal, timedOut: r.error && r.error.code === 'ETIMEDOUT' };
  row.heapWord = HEAP_WORD.test(text);
  row.enospcWord = ENOSPC_WORD.test(text);
  row.label = row.timedOut ? 'timeout' : classifyDeath({ code: row.code, signal: row.signal, text });
  row.firstLine = (text.split('\n').find((l) => l.trim()) || '').slice(0, 120);
  return row;
}

/** The verdict over the recorded rows. Separated from the run so the selftest can feed it rows. */
export function probeVerdict(rows, { excluded = [], eligible = CASES.length, commit } = {}) {
  const disk = rows.filter((r) => r.kind === 'disk-uncaught');
  const hit = disk.filter(reaches134);
  const heapControl = rows.find((r) => r.kind === 'heap-control');
  const instrument = rows.find((r) => r.kind === 'instrument-control');
  const result = {
    diskDeathsReaching134: hit.length,
    diskDeathsChecked: disk.length,
    controls: {
      heapAbortSeen: !!heapControl && heapControl.label === 'heap-abort',
      exit134Seen: !!instrument && instrument.label === 'exit-134'
    },
    rows: rows.map((r) => ({ id: r.id, kind: r.kind, code: r.code, signal: r.signal, heapWord: r.heapWord, enospcWord: r.enospcWord, label: r.label }))
  };
  let status = 'PASS';
  let reason = null;
  if (rows.length === 0) {
    /* NOTHING was examined, so the contract refuses a result beside the word (`verdict.js`): a
       NOT_RUN that carries numbers is a measurement nobody made. */
    status = 'NOT_RUN';
    reason = excluded.length ? `every case was excluded: ${excluded.map((e) => e.id).join(', ')}` : 'no case ran';
  } else if (hit.length > CRITERION.threshold) {
    status = 'FAIL';
    reason = `${hit.length} uncaught disk death(s) reached exit 134: ${hit.map((r) => r.id).join(', ')}`;
  } else if (!result.controls.heapAbortSeen) {
    /* A probe blind to an abort would report the same zero. §∅: an output over absent input reports
       the absence, so the control's failure is the verdict rather than a footnote. */
    status = 'UNKNOWN';
    reason = 'the heap control did not abort with its own word, so this run cannot see an abort';
  } else if (!result.controls.exit134Seen) {
    status = 'UNKNOWN';
    reason = 'the instrument control did not report exit 134, so this run cannot see a 134';
  } else if (disk.length === 0) {
    /* The controls ran, so this is not NOT_RUN — but the criterion's own population is empty, and a
       PASS over nothing is the examined-nothing green this contract exists to refuse. */
    status = 'UNKNOWN';
    reason = 'the controls established themselves, but no disk case ran';
  }
  return makeVerdict({
    gate: GATE,
    status,
    population: { checked: rows.length, eligible, excluded: eligible - rows.length },
    criterion: CRITERION,
    result: status === 'NOT_RUN' ? null : result,
    evidence: [TOOL, 'tools/trio-batch.mjs', 'briefs/RESIDUE.md'],
    reason,
    tool: TOOL,
    commit
  });
}

/* ── planted truth ─────────────────────────────────────────────────────────────────────────────── */
function selftest() {
  let bad = 0;
  let ran = 0;
  const ok = (name, cond, detail) => {
    ran++;
    console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || detail === undefined ? '' : `  — ${detail}`}`);
    if (!cond) bad++;
  };

  /* (1) the classifier, over the shapes measured on 2026-10-20. */
  ok('an uncaught ENOSPC write ⇒ exit 1 carrying the word', classifyDeath({ code: 1, signal: null, text: 'Error: ENOSPC: no space left on device, write' }) === 'enospc-exit-1');
  ok('a heap exhaustion ⇒ an abort carrying the heap word', classifyDeath({ code: null, signal: 'SIGABRT', text: 'FATAL ERROR: JavaScript heap out of memory' }) === 'heap-abort');
  ok('a bare abort ⇒ an abort carrying NEITHER word', classifyDeath({ code: null, signal: 'SIGABRT', text: 'Aborted' }) === 'bare-abort');
  ok('a deliberate exit 134 ⇒ exit-134, whatever its text says', classifyDeath({ code: 134, signal: null, text: 'ENOSPC: no space left on device' }) === 'exit-134');
  ok('the code wins over the signal when both are present', classifyDeath({ code: 134, signal: 'SIGABRT', text: 'heap out of memory' }) === 'exit-134');
  ok('an exit 0 is not a death', classifyDeath({ code: 0, signal: null, text: '' }) === 'survived');
  ok('only the code reaches the predicate arm', reaches134({ code: 134 }) === true && reaches134({ code: null, signal: 'SIGABRT' }) === false);

  /* (2) the verdict's arithmetic and its refusals, over planted rows. */
  const diskRow = (id) => ({ id, kind: 'disk-uncaught', code: 1, signal: null, heapWord: false, enospcWord: true, label: 'enospc-exit-1' });
  const heapRow = { id: 'heapExhaustion', kind: 'heap-control', code: null, signal: 'SIGABRT', heapWord: true, enospcWord: false, label: 'heap-abort' };
  const instRow = { id: 'caughtThenExit134', kind: 'instrument-control', code: 134, signal: null, heapWord: false, enospcWord: true, label: 'exit-134' };
  const good = [diskRow('a'), diskRow('b'), heapRow, instRow];
  const v = probeVerdict(good, { eligible: 4, commit: null });
  ok('no disk death on the arm, both controls up ⇒ PASS', v.status === 'PASS', v.status);
  ok('population balances: checked + excluded = eligible', v.population.checked + v.population.excluded === v.population.eligible, JSON.stringify(v.population));
  const f = probeVerdict([{ ...diskRow('c'), code: 134, label: 'exit-134' }, heapRow, instRow], { eligible: 3, commit: null });
  ok('one disk death on the arm ⇒ FAIL with a reason naming it', f.status === 'FAIL' && /\bc\b/.test(f.reason || ''), f.status + ' ' + f.reason);
  const nh = probeVerdict([diskRow('a'), { ...heapRow, label: 'bare-abort', heapWord: false }, instRow], { eligible: 3, commit: null });
  ok('a heap control that never aborted ⇒ UNKNOWN, not a pass', nh.status === 'UNKNOWN', nh.status);
  const ni = probeVerdict([diskRow('a'), heapRow, { ...instRow, code: 1, label: 'enospc-exit-1' }], { eligible: 3, commit: null });
  ok('an instrument control blind to a 134 ⇒ UNKNOWN, not a pass', ni.status === 'UNKNOWN', ni.status);
  const nr = probeVerdict([], { eligible: 7, excluded: CASES.filter((c) => c.needsFull), commit: null });
  ok('nothing ran ⇒ NOT_RUN naming the excluded cases', nr.status === 'NOT_RUN' && /writeFileSync/.test(nr.reason || ''), nr.status);
  const nd = probeVerdict([heapRow, instRow], { eligible: 7, commit: null });
  ok('controls up but no disk case ⇒ UNKNOWN, never a pass over nothing', nd.status === 'UNKNOWN', nd.status);
  ok('a NOT_RUN carries no result, as the contract requires', nr.result === null, JSON.stringify(nr.result));

  /* (3) the instrument is checked for PRESENCE, and an absent one is not a pass. */
  ok('a directory is not the full device', fullDeviceAvailable('/tmp') === false);
  ok('a path that does not exist is not the full device', fullDeviceAvailable('/dev/no-such-node-9f3') === false);

  console.log(`\n${bad ? `✗ ${bad} of ${ran} failed` : `✓ all ${ran} selftests passed`}`);
  return bad ? 1 : 0;
}

/* ── main ──────────────────────────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const IS_MAIN = isCliEntry(import.meta.url);

if (IS_MAIN) {
  refuseUnknownArgvOrExit(argv, { valued: ['--timeout-ms'], boolean: ['--json', '--selftest', '--verdict-sample'] }, { tool: 'probe-child-death-codes' });

  if (flag('--selftest')) process.exit(selftest());

  if (flag('--verdict-sample')) {
    /* A sample object, printed from planted rows. It probes nothing, so its commit is null. */
    const sample = probeVerdict(
      [
        { id: 'writeFileSync', kind: 'disk-uncaught', code: 1, signal: null, heapWord: false, enospcWord: true, label: 'enospc-exit-1' },
        { id: 'heapExhaustion', kind: 'heap-control', code: null, signal: 'SIGABRT', heapWord: true, enospcWord: false, label: 'heap-abort' },
        { id: 'caughtThenExit134', kind: 'instrument-control', code: 134, signal: null, heapWord: false, enospcWord: true, label: 'exit-134' }
      ],
      { eligible: 3, commit: null }
    );
    console.log(JSON.stringify(sample, null, 1));
    process.exit(0);
  }

  const timeoutMs = Number(opt('--timeout-ms', '30000'));
  const haveFull = fullDeviceAvailable();
  const excluded = CASES.filter((c) => c.needsFull && !haveFull);
  const rows = CASES.filter((c) => !(c.needsFull && !haveFull)).map((c) => runCase(c, timeoutMs));
  const verdict = probeVerdict(rows, { excluded, eligible: CASES.length });

  if (flag('--json')) {
    console.log(JSON.stringify(verdict));
  } else {
    console.log(`▸ ${GATE} — what a dying child reports (${FULL} ${haveFull ? 'present' : 'ABSENT'})\n`);
    for (const r of rows) {
      const code = String(r.code === null ? 'null' : r.code).padEnd(5);
      const sig = String(r.signal || 'null').padEnd(8);
      console.log(`  code=${code} signal=${sig} enospc=${r.enospcWord ? 'Y' : 'n'} heap=${r.heapWord ? 'Y' : 'n'}  ${r.label.padEnd(15)} ${r.what}`);
    }
    for (const e of excluded) console.log(`  ⊘ EXCLUDED — ${e.id}: ${FULL} is absent or not writable here`);
    /* `result` is null when nothing was examined, so the count is read from the rows that ran. */
    const hit = verdict.result ? `${verdict.result.diskDeathsReaching134} of ${verdict.result.diskDeathsChecked} uncaught disk death(s) reached exit 134` : 'nothing was examined';
    console.log(`\n${verdict.status === 'PASS' ? '✓' : '✗'} ${verdict.status} — ${hit}${verdict.reason ? ` (${verdict.reason})` : ''}`);
    console.log(JSON.stringify(verdict));
  }
  process.exit(verdict.status === 'PASS' ? 0 : 1);
}
