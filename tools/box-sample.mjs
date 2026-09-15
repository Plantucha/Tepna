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
//   node tools/box-sample.mjs --selftest
import { execFileSync } from 'node:child_process';
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

  // Phrased for tools/selftest-all.mjs's summary parser, which reads an assertion COUNT so a
  // suite silently shrinking from 14 to 3 stays visible. A green run with no parseable count
  // is reported as unreadable, not as a pass.
  console.log(fail === 0 ? `\n  all ${pass} selftests passed` : `\n  ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

// ── runner ──────────────────────────────────────────────────────────────────
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
