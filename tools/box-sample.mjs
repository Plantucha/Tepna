#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// box-sample.mjs — periodic resource sampler for a remote capture host.
//
// Answers OPERATIONAL-MATURITY-ROADMAP §13 ("measure rather than guess": BLE connection
// count, CPU, RAM, disk, load) by SAMPLING over read-only ssh rather than estimating.
//
// §∅ ABSENCE IS NULL. A sample that could not be taken — ssh failed, the unit is gone,
// the adapter is absent — records `null`, never 0. A 0 in an hci column means "the radio
// reported zero connections"; an empty cell means "we did not find out". Collapsing those
// two is how a dead sampler reads as a quiet box.
//
// §4 note: the daemon is located with `systemctl show -p MainPID` and NEVER `pgrep -f`.
// Over ssh the remote shell's own cmdline contains the pattern, so `pgrep -f` self-matches.
//
// Usage:
//   node tools/box-sample.mjs --host vigil@192.168.0.41 --unit tepna-capture --interval 300
//   node tools/box-sample.mjs --verdict .cache/box-sample.tsv [--json]   # what may this trace be spent on?
//   node tools/box-sample.mjs --verdict-sample                    # the tepna.verdict/1 sample (corpus-free)
//   node tools/box-sample.mjs --selftest
import { execFileSync, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// `hwm_kb` is APPENDED, never inserted: existing TSV column positions must not shift.
export const FIELDS = ['cpu_pct', 'rss_kb', 'elapsed_s', 'hci0_le', 'hci1_le', 'hci2_le', 'load1', 'mem_used_mb', 'disk_pct', 'unit_active', 'hwm_kb'];

// ── pure core ───────────────────────────────────────────────────────────────
// Parse `key=value` lines into a row. EVERY field defaults to null: a key the
// remote did not emit is an ABSENCE, not a zero. This is the whole contract.
export function parse(raw) {
  const row = Object.fromEntries(FIELDS.map((f) => [f, null]));
  if (typeof raw !== 'string' || raw.trim() === '') return row; // ssh gave nothing => all null
  for (const line of raw.split('\n')) {
    const m = /^([a-z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, k, vRaw] = m;
    if (!FIELDS.includes(k)) continue;
    const v = vRaw.trim();
    if (v === '' || v === 'null' || v === '-') continue; // explicit absence stays null
    if (k === 'unit_active') {
      row[k] = v === 'active' ? 1 : 0;
      continue;
    }
    if (k === 'elapsed_s') {
      row[k] = parseElapsed(v);
      continue;
    }
    const n = Number(v);
    row[k] = Number.isFinite(n) ? n : null;
  }
  return row;
}

// `08:56:51` / `1-08:56:51` / `56:51` -> seconds. Unparseable -> null, never 0.
export function parseElapsed(v) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(v).trim());
  if (!m) return null;
  const [, d, h, mi, s] = m;
  return +(d || 0) * 86400 + +(h || 0) * 3600 + +mi * 60 + +s;
}

// Summarise a column across rows. A mean over nulls is NOT 0 — it is null, and `n`
// publishes the denominator so a sparse column cannot masquerade as a measured one.
export function summarise(rows, field) {
  const vals = rows.map((r) => r?.[field]).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (vals.length === 0) return { n: 0, nMissing: rows.length, min: null, max: null, mean: null };
  const sum = vals.reduce((a, b) => a + b, 0);
  return {
    n: vals.length,
    nMissing: rows.length - vals.length,
    min: Math.min(...vals),
    max: Math.max(...vals),
    mean: sum / vals.length
  };
}

/* ── A PEAK IS A CLAIM ABOUT A WINDOW ────────────────────────────────────────────────────────
   `summarise` publishes `n`, so a sparse column cannot pass as a measured one. It does not publish
   the trace's SPAN, and that is the other way a memory reading misleads: a peak — or, worse, an
   ABSENCE of one — read off a short trace looks exactly like the same reading off a long one.

   Measured 2026-09-20 and recorded as residue `2026-09-21-capture-daemon-qc-digest-peaks-1-3gb`:
   a clean `tepna-capture` restart "stayed at 92 MB for ten minutes … flat, no transient", and that
   was written down as evidence that the daemon has no startup transient. This tool's OWN traces,
   five days earlier and 259 samples deep (rows `2026-09-15-capture-rss-peak-is-startup` /
   `-saturates`), put the step at **604 s → 665 s**: peak 123 MB at 604 s, 667 MB at 665 s, and
   saturation at ~760 MB by 1.70 h. A 600 s window therefore ENDS BEFORE THE STEP — the two
   observations agree at every elapsed time they share, and the short one cannot distinguish "no
   transient" from "the transient has not started yet".

   So the span travels with the claim. `peakClaim` refuses rather than annotates when the trace does
   not reach the onset, because that is the case where the number carries no information at all
   (CLAUDE.md §∅: a discontinuity refuses, reduced coverage annotates). PURE. */
export const TRANSIENT_ONSET_S = 665; // the first sample that SAW the step (2026-09-15 cycle 1)
export const TRANSIENT_LAST_QUIET_S = 604; // the last sample before it: peak still 123 MB
export const TRANSIENT_SATURATION_S = 6120; // 1.70 h, peak flat at ~760 MB thereafter

/** Elapsed-time coverage of a trace, from the `elapsed_s` column (process age, not wall time, so a
 *  restart mid-trace is visible as a drop). Nulls are excluded and counted, never read as 0. */
export function traceSpan(rows) {
  const v = rows.map((r) => r?.elapsed_s).filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (v.length === 0) return { n: 0, nMissing: rows.length, fromS: null, toS: null, spanS: null, restarts: 0 };
  let restarts = 0;
  for (let i = 1; i < v.length; i++) if (v[i] < v[i - 1]) restarts++;
  return { n: v.length, nMissing: rows.length - v.length, fromS: Math.min(...v), toS: Math.max(...v), spanS: Math.max(...v) - Math.min(...v), restarts };
}

/** What a trace may be spent on. Returns the peak it saw (kB, from `hwm_kb` — the kernel high-water
 *  mark, which a sampler cannot step over) together with the verdict:
 *    'none'      — the trace does not reach TRANSIENT_ONSET_S. Neither a peak nor an absence of one
 *                  may be read off it; this is a REFUSAL, and `reason` says why.
 *    'cap-only'  — reaches the onset but not saturation: the peak is a lower bound on the cap.
 *    'full'      — reaches saturation: the peak is the cap.
 *  A restart inside the trace also refuses: `elapsed_s` then spans two process lifetimes and the
 *  window is not one stretch of one process (§∅ — a discontinuity refuses). */
export function peakClaim(rows) {
  const span = traceSpan(rows);
  const hw = summarise(rows, 'hwm_kb');
  const base = { peakKb: hw.max, nPeak: hw.n, span };
  if (span.n === 0) return { ...base, claim: 'none', reason: 'no sample carries an elapsed_s, so the trace has no window' };
  if (span.restarts > 0) return { ...base, claim: 'none', reason: `elapsed_s drops ${span.restarts}\u00d7: the trace spans more than one process lifetime` };
  if (span.toS < TRANSIENT_ONSET_S)
    return {
      ...base,
      claim: 'none',
      reason: `the oldest sample is ${Math.round(span.toS)} s into the process, short of the ${TRANSIENT_ONSET_S} s at which this tool's 2026-09-15 traces first saw the startup step (peak 123 MB at ${TRANSIENT_LAST_QUIET_S} s, 667 MB at ${TRANSIENT_ONSET_S} s) \u2014 a flat trace here cannot tell "no transient" from "not yet"`
    };
  if (span.toS < TRANSIENT_SATURATION_S)
    return {
      ...base,
      claim: 'cap-only',
      reason: `reaches ${Math.round(span.toS)} s, past the ${TRANSIENT_ONSET_S} s onset but short of saturation at ${TRANSIENT_SATURATION_S} s \u2014 the peak is a LOWER BOUND on the cap`
    };
  return { ...base, claim: 'full', reason: `reaches ${Math.round(span.toS)} s, past saturation at ${TRANSIENT_SATURATION_S} s` };
}

/* ── the same claim as ONE tepna.verdict/1 object (docs/VERDICT-CONTRACT.md) ──────────────────
   `peakClaim`'s prose is the explanation; this is the API. The mapping is the contract's own, and
   the criterion is pre-stated: the trace's span against the saturation time this tool measured.
     PASS         span reaches saturation \u2014 the peak IS the cap
     SHORTFALL    past the onset, short of saturation \u2014 the peak is a LOWER BOUND on the cap
     UNDERPOWERED short of the onset \u2014 the window cannot tell "no transient" from "not yet"
     UNKNOWN      a restart inside the trace, or no elapsed_s at all \u2014 no single window exists
   `population` is SAMPLES: checked = rows carrying an elapsed_s, excluded = rows that do not. */
export function peakVerdict(rows, { path: srcPath = '<trace>', commit = null } = {}) {
  const Verdict = createRequire(import.meta.url)('../verdict.js');
  const c = peakClaim(rows);
  const status = c.claim === 'full' ? 'PASS' : c.claim === 'cap-only' ? 'SHORTFALL' : c.span.n === 0 || c.span.restarts > 0 ? 'UNKNOWN' : 'UNDERPOWERED';
  const v = Verdict.make({
    gate: 'box-sample-peak-window',
    status,
    scope: 'internal',
    population: { checked: c.span.n, eligible: c.span.n + c.span.nMissing, excluded: c.span.nMissing },
    criterion: { name: 'trace_span_s', threshold: TRANSIENT_SATURATION_S, unit: 's', direction: 'gte' },
    result: { peakKb: c.peakKb, nPeakSamples: c.nPeak, elapsedFromS: c.span.fromS, elapsedToS: c.span.toS, restarts: c.span.restarts },
    evidence: ['tools/box-sample.mjs', srcPath],
    reason: status === 'PASS' ? null : c.reason,
    producedBy: { tool: 'tools/box-sample.mjs', commit, ...(commit ? {} : { commitReason: 'not read from a git tree' }) }
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`box-sample: verdict invalid under verdict.js \u2014 ${chk.errors.join(' | ')}`);
  return v;
}

/** The corpus-free sample the adoption gate runs: the 2026-09-20 ten-minute trace that produced the
 *  wrong conclusion, as an in-memory trace. It emits UNDERPOWERED, which is the whole point. */
export function sampleTrace() {
  return [60, 180, 300, 420, 540, 600].map((t) => ({ ...Object.fromEntries(FIELDS.map((f) => [f, null])), elapsed_s: t, rss_kb: 88000, hwm_kb: 94000, unit_active: 1 }));
}

export function toTsv(ts, row) {
  // null serialises as EMPTY, never "0" — the file must not lie either.
  return [ts, ...FIELDS.map((f) => (row[f] === null ? '' : row[f]))].join('\t');
}

export function fromTsv(line) {
  const c = line.split('\t');
  // Tolerate a row written before a field was appended: the missing trailing columns are an
  // ABSENCE and read back as null. Rejecting them would discard a real series on a schema bump;
  // filling them with 0 would fabricate a measurement. A row LONGER than FIELDS is still refused.
  if (c.length < 2 || c.length > FIELDS.length + 1) return null;
  const row = {};
  FIELDS.forEach((f, i) => {
    const v = i + 1 < c.length ? c[i + 1] : '';
    row[f] = v === '' ? null : Number(v);
  });
  return { ts: c[0], row };
}

export const REMOTE = (unit) => `
u=$(systemctl is-active ${unit} 2>/dev/null); echo "unit_active=\${u:-unknown}"
p=$(systemctl show -p MainPID --value ${unit} 2>/dev/null)
if [ -n "$p" ] && [ "$p" != "0" ] && [ -d "/proc/$p" ]; then
  set -- $(ps -o %cpu=,rss=,etime= -p "$p" 2>/dev/null)
  [ -n "$1" ] && echo "cpu_pct=$1"; [ -n "$2" ] && echo "rss_kb=$2"; [ -n "$3" ] && echo "elapsed_s=$3"
  awk '/^VmHWM:/{print "hwm_kb="$2}' "/proc/$p/status" 2>/dev/null
fi
for i in 0 1 2; do
  if [ -d /sys/class/bluetooth/hci$i ]; then
    echo "hci\${i}_le=$(hcitool -i hci$i con 2>/dev/null | grep -c LE)"
  fi
done
echo "load1=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null)"
free -m 2>/dev/null | awk '/^Mem:/{print "mem_used_mb="$3}'
df -P / 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print "disk_pct="$5}'
`;

// ── selftest ────────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (name, cond, detail) => {
    if (cond) {
      pass++;
      console.log(`  ok   ${name}`);
    } else {
      fail++;
      console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
  };

  const real = 'unit_active=active\ncpu_pct=6.8\nrss_kb=428232\nelapsed_s=08:56:51\n' + 'hci0_le=2\nhci1_le=0\nhci2_le=0\nload1=0.06\nmem_used_mb=2169\ndisk_pct=32';
  const r = parse(real);
  ok(
    // `real` deliberately omits hwm_kb — test 16 uses that same blob as its absence plant.
    '1 real blob parses every field it carries',
    FIELDS.filter((f) => f !== 'hwm_kb').every((f) => r[f] !== null),
    JSON.stringify(r)
  );
  ok('2 elapsed 08:56:51 -> 32211 s', r.elapsed_s === 32211, String(r.elapsed_s));
  ok('3 hci1 genuinely zero stays 0', r.hci1_le === 0, String(r.hci1_le));

  // THE PLANT (§∅): an absent adapter must be null, and must NOT read as "0 connections".
  const noAdapter = parse(
    real
      .split('\n')
      .filter((l) => !l.startsWith('hci2_le='))
      .join('\n')
  );
  ok('4 PLANT absent hci2 is null, not 0', noAdapter.hci2_le === null, `got ${noAdapter.hci2_le}`);
  ok('5 PLANT null adapter != reported zero', noAdapter.hci2_le !== r.hci1_le);

  // A failed ssh yields nothing. Every field must be null — a row of zeros would read
  // as a healthy idle box, which is the failure the health-check prompt kept naming.
  const dead = parse('');
  ok(
    '6 PLANT empty ssh -> all null, zero zeros',
    FIELDS.every((f) => dead[f] === null),
    JSON.stringify(dead)
  );

  // Daemon down: unit_active is measured (0), but its CPU/RSS are ABSENT, not 0.
  const down = parse('unit_active=inactive\nload1=0.01\nmem_used_mb=900\ndisk_pct=32');
  ok('7 daemon down: unit 0 measured, cpu/rss null', down.unit_active === 0 && down.cpu_pct === null && down.rss_kb === null);

  ok('8 unparseable elapsed -> null', parseElapsed('garbage') === null);

  /* VmHWM is the process high-water mark. A SAMPLER CANNOT MISS A PEAK BETWEEN SAMPLES if it reads
     this, and that is the whole reason the field exists: measured 2026-09-15, a 60 s sampler's own
     max was 514.6 MB while VmHWM stood at 759.4 MB — 245 MB of peak invisible to sampling. A memory
     budget set from sampled RSS would have been sized from the plateau. */
  const hw = parse(real + '\nhwm_kb=777600');
  ok('14 hwm parses', hw.hwm_kb === 777600, String(hw.hwm_kb));
  ok('15 PLANT hwm >= rss (a swapped parse would invert this)', hw.hwm_kb >= hw.rss_kb);
  // §∅ again: an unreadable /proc entry is an ABSENCE, not a peak of zero, and not a copy of rss.
  ok('16 PLANT absent hwm is null, not 0 and not rss', r.hwm_kb === null);

  /* ⚠️ VmHWM is MONOTONIC. It gives the CAP and says nothing about SHAPE — oscillation, and whether
     memory is returned, are invisible to it. Sampling gives the shape and understates the peak.
     Neither replaces the other; quoting either alone misleads. (Osprey, 2026-09-15.) */
  const legacy = ['2026-09-15T10:00:00Z', 6.8, 428232, 32211, 2, 0, 0, 0.06, 2169, 32, 1].join('\t');
  const back = fromTsv(legacy);
  ok('17 PLANT a pre-hwm row still parses', back !== null && back.row.cpu_pct === 6.8);
  ok('18 PLANT its absent hwm reads null, not 0', back !== null && back.row.hwm_kb === null);
  // legacy is FIELDS.length columns (pre-hwm), so ONE extra makes it exactly current-length and is
  // legitimately accepted; it takes two to be over-long. Getting this wrong is how a bounds test
  // passes against the wrong bound — it did, here, on the first attempt.
  ok('19 a current-length row is accepted', fromTsv(legacy + '\t777600') !== null);
  ok('20 an over-long row is still refused', fromTsv(legacy + '\t777600\t999') === null);

  // Summary must not average a column it never measured.
  const s = summarise([dead, dead], 'cpu_pct');
  ok('9 PLANT mean over all-null is null with n=0', s.mean === null && s.n === 0 && s.nMissing === 2);
  const s2 = summarise([r, dead], 'cpu_pct');
  ok('10 mean skips nulls and publishes denominator', s2.n === 1 && s2.nMissing === 1 && Math.abs(s2.mean - 6.8) < 1e-9);

  // Round-trip: null must not become 0 on the way through the file.
  const line = toTsv('2026-09-15T10:00:00Z', noAdapter);
  const col = (f) => line.split('\t')[FIELDS.indexOf(f) + 1]; // +1 for the ts prefix
  ok('11 PLANT null serialises empty, not "0"', col('hci2_le') === '', JSON.stringify(col('hci2_le')));
  ok('11b measured zero still serialises "0"', col('hci1_le') === '0', JSON.stringify(col('hci1_le')));
  ok('12 tsv round-trip preserves null', fromTsv(line).row.hci2_le === null);

  // §4: the remote must not locate the daemon by pattern.
  ok('13 remote uses systemctl, never pgrep -f', !/pgrep\s+-f/.test(REMOTE('u')) && /MainPID/.test(REMOTE('u')));

  /* ── A peak is a claim about a window (residue 2026-09-22-startup-transient-refutation-underpowered) ── */
  const mk = (el, hwmKb) => ({ ...parse(real), elapsed_s: el, hwm_kb: hwmKb });
  // PLANT 21: the 2026-09-20 shape that produced the wrong conclusion — ten flat minutes from a
  // clean start. It is REFUSED: the window ends before the step this tool measured at 604->665 s.
  const tenMin = [60, 180, 300, 420, 540, 600].map((t) => mk(t, 94000));
  const c10 = peakClaim(tenMin);
  ok('21 PLANT a ten-minute trace refuses a peak claim', c10.claim === 'none', c10.claim);
  ok('21b …and says the window is the reason', /short of the 665 s/.test(c10.reason), c10.reason);
  // PLANT 22: the same trace one sample longer — past the onset — becomes a lower bound, not a cap.
  const past = tenMin.concat([mk(665, 683000)]);
  const cp = peakClaim(past);
  ok('22 past the onset the peak is claimable as a LOWER BOUND', cp.claim === 'cap-only' && cp.peakKb === 683000, cp.claim);
  // PLANT 23: past saturation it is the cap.
  ok('23 past saturation the peak is the cap', peakClaim(past.concat([mk(7200, 778000)])).claim === 'full');
  // PLANT 24: a restart inside the trace refuses — elapsed_s then spans two process lifetimes.
  const restarted = [mk(3000, 700000), mk(7200, 778000), mk(120, 90000)];
  const cr = peakClaim(restarted);
  ok('24 PLANT a restart inside the trace refuses', cr.claim === 'none' && /more than one process/.test(cr.reason), cr.reason);
  // PLANT 25: the refusal is not blanket — an all-null elapsed column refuses for its OWN reason,
  // and traceSpan counts the absence rather than reading it as 0 (§∅).
  const noEl = [parse(''), parse('')];
  ok('25 an absent elapsed column is an absence, not a span of 0', traceSpan(noEl).spanS === null && traceSpan(noEl).nMissing === 2);
  ok('25b …and refuses with its own reason', peakClaim(noEl).reason === 'no sample carries an elapsed_s, so the trace has no window');
  // PLANT 26: the peak itself is still reported on a refusal — the refusal is about what may be
  // CONCLUDED from it, not about hiding the number.
  ok('26 PLANT a refused claim still carries the peak it saw', c10.peakKb === 94000, String(c10.peakKb));

  // PLANT 27-29: the verdict object — the same claim in the shape a machine reads, validated
  // against verdict.js here so the adoption gate's sample cannot drift out of the contract.
  const vs = peakVerdict(sampleTrace(), { path: '<selftest>' });
  ok('27 the ten-minute sample verdict is UNDERPOWERED', vs.status === 'UNDERPOWERED', vs.status);
  ok(
    '28 PLANT a saturated trace verdicts PASS with reason null',
    (() => {
      const v = peakVerdict(past.concat([mk(7200, 778000)]), { path: '<selftest>' });
      return v.status === 'PASS' && v.reason === null;
    })()
  );
  ok('29 PLANT population is an EQUALITY (checked + excluded = eligible)', vs.population.checked + vs.population.excluded === vs.population.eligible);

  // Phrased for tools/selftest-all.mjs's summary parser, which reads an assertion COUNT so a
  // suite silently shrinking from 14 to 3 stays visible. A green run with no parseable count
  // is reported as unreadable, not as a pass.
  console.log(fail === 0 ? `\n  all ${pass} selftests passed` : `\n  ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

// ── runner ──────────────────────────────────────────────────────────────────
function gitCommit() {
  try {
    return (
      execSync('git rev-parse --short HEAD', { cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || null
    );
  } catch {
    return null; // \u00a7\u2205: not in a git tree is an ABSENCE, and the verdict says so in commitReason
  }
}

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

function sampleOnce(host, unit) {
  try {
    return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', host, REMOTE(unit)], { encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return ''; // => all null. NOT an exception that stops the run, and NOT zeros.
  }
}

async function main() {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  // Read a trace back and say what it may be spent on, rather than leaving the span implicit.
  if (process.argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(peakVerdict(sampleTrace(), { path: '<sample>', commit: gitCommit() }), null, 2));
    process.exit(0);
  }
  const vPath = arg('verdict', null);
  if (vPath) {
    const rows = fs
      .readFileSync(path.resolve(vPath), 'utf8')
      .trim()
      .split('\n')
      .filter((l) => l && !l.startsWith('ts\t'))
      .map((l) => fromTsv(l))
      .filter(Boolean)
      .map((x) => x.row);
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(peakVerdict(rows, { path: vPath, commit: gitCommit() }), null, 2));
      process.exit(0);
    }
    const c = peakClaim(rows);
    const mb = (kb) => (kb === null ? 'null' : `${Math.round(kb / 1024)} MB`);
    console.log(`${vPath}: ${rows.length} row(s) \u00b7 elapsed ${c.span.fromS ?? 'null'}\u2013${c.span.toS ?? 'null'} s \u00b7 peak ${mb(c.peakKb)} (n=${c.nPeak})`);
    console.log(c.claim === 'none' ? `  \u2717 REFUSED \u2014 ${c.reason}` : `  claim: ${c.claim} \u2014 ${c.reason}`);
    process.exit(c.claim === 'none' ? 2 : 0);
  }
  const host = arg('host', 'vigil@192.168.0.41');
  const unit = arg('unit', 'tepna-capture');
  const interval = Number(arg('interval', '300'));
  const out = path.resolve(arg('out', '.cache/box-sample.tsv'));
  const maxN = Number(arg('limit', '0')) || Infinity;

  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Resumable: the file IS the checkpoint. Re-running appends; nothing is re-sampled,
  // because a sample is a point in time and cannot be redone.
  let prior = 0;
  if (fs.existsSync(out))
    prior = fs
      .readFileSync(out, 'utf8')
      .trim()
      .split('\n')
      .filter((l) => l && !l.startsWith('ts\t')).length;
  else fs.writeFileSync(out, ['ts', ...FIELDS].join('\t') + '\n');

  console.log(`tier: ssh (${host}) · unit ${unit} · every ${interval}s -> ${out}`);
  console.log(`resuming with ${prior} prior samples`);
  let n = 0,
    miss = 0;
  for (;;) {
    const ts = new Date().toISOString();
    const row = parse(sampleOnce(host, unit));
    fs.appendFileSync(out, toTsv(ts, row) + '\n');
    n++;
    if (row.cpu_pct === null) miss++;
    // §2.4/2.5 heartbeat: a real running value, on stdout, survives redirection.
    console.log(
      `[${ts}] n=${prior + n} cpu=${row.cpu_pct ?? 'null'} rss_mb=${row.rss_kb === null ? 'null' : Math.round(row.rss_kb / 1024)} peak_mb=${row.hwm_kb === null ? 'null' : Math.round(row.hwm_kb / 1024)} ` +
        `le=${[row.hci0_le, row.hci1_le, row.hci2_le].map((v) => v ?? 'x').join('/')} load=${row.load1 ?? 'null'} missed=${miss}`
    );
    if (n >= maxN) break;
    await new Promise((res) => setTimeout(res, interval * 1000));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
