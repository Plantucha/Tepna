/*
 * tools/run-progress.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * ── SHARED PROGRESS, ETA AND RESUME FOR THE MULTI-HOUR TOOLS ────────────────────────────────────
 *
 * Every long-runner here had the same two holes, and both cost real time:
 *
 *   NO PROGRESS. A Level B run printed one line and then nothing for 8 hours. With no measured
 *   figure to hand the wait gets estimated by guess — "10-15 min" was published against a true 78,
 *   then "1h05m left" against ~6h. The numbers needed to answer it were already being measured and
 *   thrown away.
 *
 *   NO RESUME. Killing a run at 78/126 discarded everything; a second reached 102/179 before the
 *   same question arose. A multi-hour job that cannot survive an interruption will be interrupted
 *   anyway — by a reboot, a full disk, or an operator who has learned something mid-run.
 *
 * RESUMING ACROSS A CODE CHANGE WOULD FABRICATE RESULTS, which is the one way a resume feature
 * turns into a correctness bug: a verdict is only meaningful for the inputs that produced it. The
 * ledger stamps a FINGERPRINT and REFUSES to resume when it differs. A refusal restarts from zero,
 * which is merely slow; the alternative is a results file mixing two codebases and describing
 * neither.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

/* Remaining work is ROUNDS, not items: with `jobs` workers, `left` items take ceil(left/jobs)
   rounds. Dividing items by jobs is the same arithmetic only when left is a multiple of jobs. */
export function etaSeconds(done, total, jobs, perRunSec) {
  const left = Math.max(0, total - done);
  const rounds = Math.ceil(left / Math.max(1, jobs));
  return Math.round(rounds * Math.max(0, perRunSec));
}

/* ── THROUGHPUT ETA, and why it is preferred when elapsed time is known ──────────────────────────
   `etaSeconds` above multiplies a per-run cost by the number of ROUNDS remaining. That is correct
   arithmetic and it rests on an assumption: that every one of `jobs` workers is actually doing work.
   When the assumption is false the estimate is wrong by exactly the factor that does not exist —
   Level B reported "1h05m left" against ~6 h because `--jobs 6` bought no parallelism at all
   (#1338), and the same shape appears more mildly whenever the box is contended or the tail is
   straggler-bound.

   Measuring THROUGHPUT instead assumes nothing: `done / elapsed` is what actually happened, so it
   absorbs contention, stragglers, a warm-up, and a jobs count that turns out to be a lie. This is
   the form `tools/mutate.mjs` has always used, and it is the reason its estimates held up while
   Level B's did not. Prefer it wherever elapsed time is available; keep the rounds form for the
   up-front estimate, before there is anything to measure. */
export function etaFromThroughput(done, total, elapsedSec) {
  if (!(done > 0) || !(elapsedSec > 0)) return null;
  const remaining = Math.max(0, total - done);
  if (remaining === 0) return 0;
  return Math.round(remaining / (done / elapsedSec));
}

export function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '?';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const x = Math.round(sec % 60);
  return h ? h + 'h' + String(m).padStart(2, '0') + 'm' : m ? m + 'm' + String(x).padStart(2, '0') + 's' : x + 's';
}

/* States what it MEASURED — done/total, the per-run cost the estimate rests on, and how long is
   left — so a reader can check the arithmetic instead of trusting a bar. */
export function progressLine(done, total, jobs, perRunSec, label, elapsedSec) {
  const pct = Math.floor((done / Math.max(1, total)) * 100);
  /* Prefer MEASURED throughput once there is any: it assumes nothing about whether the jobs are
     real, which the rounds form does. The line says WHICH it used — `obs` when the number came
     from what actually happened, `est` when it is still the per-run projection — because an
     estimate a reader cannot attribute is one they cannot sanity-check. */
  const obs = etaFromThroughput(done, total, elapsedSec);
  const left = obs == null ? etaSeconds(done, total, jobs, perRunSec) : obs;
  return (
    '  [' +
    String(done).padStart(String(total).length) +
    '/' +
    total +
    ' ' +
    String(pct).padStart(3) +
    '%]  ' +
    String(label == null ? '' : label).padEnd(24) +
    ' ~' +
    fmtDuration(perRunSec) +
    '/run × ' +
    jobs +
    ' jobs  →  ' +
    fmtDuration(left) +
    ' left (' +
    (obs == null ? 'est' : 'obs') +
    ')'
  );
}

export function fingerprint(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

/* ── RESUME LEDGER ────────────────────────────────────────────────────────────────────────────
   Append-only JSONL. Line 1 is a header carrying the fingerprint; every later line is one completed
   item. Append-only is the point: a crash mid-write can only ever damage the LAST line, and `load`
   discards a trailing partial line rather than failing — so a killed run stays resumable, which a
   rewrite-the-whole-file design cannot promise. */
export class ResumeLedger {
  constructor(path, fp) {
    this.path = path;
    this.fp = fp;
    this.done = new Map();
    this.stale = false;
  }

  load() {
    this.done = new Map();
    this.stale = false;
    if (!this.path || !existsSync(this.path)) return this;
    const lines = readFileSync(this.path, 'utf8').split('\n');
    let header = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) continue;
      let rec;
      try {
        rec = JSON.parse(l);
      } catch {
        continue; /* a torn final line from a kill — the exact case this format exists to survive */
      }
      if (rec && rec._header) {
        header = rec;
        continue;
      }
      if (rec && rec.key != null) this.done.set(String(rec.key), rec);
    }
    /* No header, or a different one, means these results describe other inputs. Refuse them. */
    if (!header || header.fp !== this.fp) {
      this.stale = this.done.size > 0 || !!header;
      this.done = new Map();
    }
    return this;
  }

  begin() {
    if (!this.path) return this;
    mkdirSync(dirname(this.path), { recursive: true });
    if (!existsSync(this.path) || this.done.size === 0) {
      writeFileSync(this.path, JSON.stringify({ _header: true, fp: this.fp }) + '\n');
    }
    return this;
  }

  has(key) {
    return this.done.has(String(key));
  }

  get(key) {
    return this.done.get(String(key));
  }

  record(key, value) {
    const rec = { key: String(key), ...value };
    this.done.set(String(key), rec);
    if (this.path) appendFileSync(this.path, JSON.stringify(rec) + '\n');
    return rec;
  }

  get size() {
    return this.done.size;
  }

  values() {
    return [...this.done.values()];
  }
}

// ── selftest ────────────────────────────────────────────────────────────────────────────────────
const IS_MAIN = !!process.argv[1] && process.argv[1].endsWith('run-progress.mjs');
if (IS_MAIN && process.argv.includes('--selftest')) {
  const { mkdtempSync, rmSync, writeFileSync: wf, readFileSync: rf } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  let pass = 0;
  let fail = 0;
  const ok = (n, c, d) => {
    if (c) {
      pass++;
      console.log('  ✓ ' + n);
    } else {
      fail++;
      console.log('  ✗ ' + n + (d ? '  — ' + d : ''));
    }
  };

  /* The throughput form is preferred once anything has been measured, because it assumes nothing
     about whether the jobs are real. These two cases are the ones that matter. */
  ok('throughput ETA needs no jobs count', etaFromThroughput(10, 110, 100) === 1000, String(etaFromThroughput(10, 110, 100)));
  ok('…and is correct when parallelism is a LIE', etaFromThroughput(101, 179, 28800) === Math.round(78 / (101 / 28800)), String(etaFromThroughput(101, 179, 28800)));
  ok(
    '…where the rounds form was optimistic by the jobs factor',
    etaSeconds(101, 179, 6, 285) < etaFromThroughput(101, 179, 28800) / 4,
    etaSeconds(101, 179, 6, 285) + ' vs ' + etaFromThroughput(101, 179, 28800)
  );
  ok('nothing measured yet returns null, not a guess', etaFromThroughput(0, 100, 50) === null && etaFromThroughput(10, 100, 0) === null);
  ok('a finished run is zero', etaFromThroughput(100, 100, 50) === 0 && etaFromThroughput(120, 100, 50) === 0);

  ok('ETA is rounds-remaining × per-run', etaSeconds(0, 126, 8, 295) === 16 * 295, String(etaSeconds(0, 126, 8, 295)));
  ok('…and shrinks as items complete', etaSeconds(120, 126, 8, 295) === 295);
  ok('a finished run is zero, never negative', etaSeconds(126, 126, 8, 295) === 0 && etaSeconds(200, 126, 8, 295) === 0);
  ok('one job is not divided away', etaSeconds(0, 5, 1, 10) === 50);
  ok('durations read in the units a human waits in', fmtDuration(4720) === '1h18m' && fmtDuration(295) === '4m55s' && fmtDuration(9) === '9s');
  ok('a nonsense duration says so', fmtDuration(Number.NaN) === '?' && fmtDuration(-1) === '?');
  ok('the line carries the cost the estimate rests on', /~4m55s\/run × 8 jobs/.test(progressLine(42, 126, 8, 295, 'KILLED')));

  const dir = mkdtempSync(join(tmpdir(), 'rp-'));
  const p = join(dir, 'sub', 'ledger.jsonl');

  const a = new ResumeLedger(p, 'FP1').load().begin();
  a.record('s1', { verdict: 'KILLED' });
  a.record('s2', { verdict: 'SURVIVED' });
  ok('records are readable back in the same process', a.size === 2 && a.has('s1'));

  const b = new ResumeLedger(p, 'FP1').load();
  ok('a NEW ledger object resumes from disk', b.size === 2 && b.get('s2').verdict === 'SURVIVED', String(b.size));

  /* 🔴 THE CORRECTNESS PROPERTY. Resuming across a code change would mix two codebases into one
     results file and describe neither — so a changed fingerprint must discard everything. */
  const c = new ResumeLedger(p, 'FP2-different-code').load();
  ok('a CHANGED fingerprint refuses to resume', c.size === 0 && c.stale === true, 'size=' + c.size + ' stale=' + c.stale);

  /* A kill can only ever damage the last line, and that line must not poison the rest. */
  wf(p, rf(p, 'utf8') + '{"key":"s3","verdi');
  const d = new ResumeLedger(p, 'FP1').load();
  ok('a TORN final line is discarded, earlier records survive', d.size === 2 && !d.has('s3'), String(d.size));

  const e = new ResumeLedger(join(dir, 'absent.jsonl'), 'FP1').load();
  ok('an absent ledger is empty and NOT stale — a first run is not a refusal', e.size === 0 && e.stale === false);

  ok(
    'a ledger with no path is a no-op, not a crash',
    (() => {
      const n = new ResumeLedger(null, 'FP1').load();
      n.record('x', {});
      return n.size === 1;
    })()
  );

  rmSync(dir, { recursive: true, force: true });
  console.log(fail ? '\n✗ ' + fail + ' failed, ' + pass + ' passed' : '\n✓ all ' + pass + ' selftests passed');
  process.exit(fail ? 1 : 0);
}
