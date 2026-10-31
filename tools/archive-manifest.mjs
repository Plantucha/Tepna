#!/usr/bin/env node
/* Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ════════════════════════════════════════════════════════════════════════
 * archive-manifest — a hash manifest for every archived capture night, written
 * at copy time on the rig.
 *
 *   node tools/archive-manifest.mjs write --night 2026-10-30   # hash source + copy, compare, write manifest
 *   node tools/archive-manifest.mjs verify --night 2026-10-30  # re-hash the copy against its manifest
 *   node tools/archive-manifest.mjs sync-manifests             # manifest every archived night that lacks one
 *   node tools/archive-manifest.mjs --json                     # (with a mode) one tepna.verdict/1 on stdout
 *   node tools/archive-manifest.mjs --selftest                 # temp-dir tests of the rules below
 *
 * WHY (owner infra item 3a, Kestrel ruling #2507, brief INFRA-STATE-2026-10-31).
 * The archive pull (capture-host/deploy/archive-pull.sh) copies vigil nights to
 * the Synology with rsync and verifies nothing: the copy's goodness was a
 * count, and counts lie quietly — on 2026-10-31 the archive held 53 of vigil's
 * 54 files for 2026-10-29 and nobody knew. This tool is step zero of the
 * replication item, split by Kestrel: 3a writes a per-file sha256 manifest at
 * copy time, from the SOURCE (vigil, read-only over ssh), and only writes it
 * when the copy matches the source exactly. 3b, the seal check, waits for
 * capture-host seal phase B and is not claimed here.
 *
 * Rules:
 *   - A manifest certifies equality. On any difference, write nothing, name
 *     the differing paths, exit 1.
 *   - Manifests live in the rig's state dir,
 *     ~/.local/state/tepna-archive-manifests/<night>.json (override:
 *     TEPNA_ARCHIVE_MANIFEST_DIR). The archive tree on the Synology is
 *     read-only to the pull user, and a manifest is the rig's own record of
 *     what it verified. A night directory stays byte-identical to its source.
 *   - sync-manifests is idempotent and resumable. It skips nights that have a
 *     manifest, skips the current date (the night is not settled), and labels
 *     every manifest with its basis: copy-time-source, or copy-only-backfill
 *     when the source no longer holds the night and the copy itself is the
 *     baseline of record. A backfill proves future integrity, never copy-time
 *     correctness, and says so in the manifest.
 *   - Exclusions match the pull: *.part and *.tmp are never hashed.
 *   - A dest under /mnt/ that is not a mountpoint is NOT_RUN (exit 2), never a
 *     silent write to the wrong disk — the same guard the pull's drop-in uses.
 *
 * Exit codes: 0 ok · 1 mismatch or failure · 2 NOT_RUN (prerequisite absent).
 * RSS stays flat: files are hashed as streams, one at a time.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { createReadStream } from 'node:fs';
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, positionalArgs, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { populationVerdict, snapshotNights } from './corpus-scope-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));

const argv = process.argv.slice(2);
const ARGV_SPEC = { boolean: ['--selftest', '--json'], valued: ['--night'], positional: true };
const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXCLUDED = (name) => name.endsWith('.part') || name.endsWith('.tmp');

function gitHead() {
  try {
    return createRequire(import.meta.url)('node:child_process')
      .execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
      .trim();
  } catch {
    return 'unknown';
  }
}

export function verdictOf({ status, findings, checked, reason }) {
  const v = Verdict.make({
    gate: 'archive-manifest',
    status,
    population: { checked, eligible: checked, excluded: 0 },
    criterion: { name: 'archived-night-matches-source-manifest', threshold: 0, unit: 'nights', direction: 'eq' },
    result: status === 'NOT_RUN' ? null : { findings, failedTransientScopes: [] },
    evidence: ['tools/archive-manifest.mjs'],
    reason: reason ?? (status === 'FAIL' ? findings.join('; ') : null),
    producedBy: { tool: 'tools/archive-manifest.mjs', commit: gitHead() },
    at: new Date().toISOString()
  });
  const check = Verdict.validate(v);
  if (!check.ok) throw new Error(`archive-manifest produced an invalid verdict: ${check.errors.join('; ')}`);
  return v;
}

/* ── hashing ──────────────────────────────────────────────────────────── */

export async function hashFile(path) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}

export async function hashLocalTree(root) {
  const out = [];
  async function walk(dir, rel) {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      if (EXCLUDED(e.name)) continue;
      const p = join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(p, r);
      else if (e.isFile()) {
        const st = await stat(p);
        out.push({ path: r, bytes: st.size, sha256: await hashFile(p) });
      }
    }
  }
  await walk(root, '');
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

const REMOTE_WALKER = `
import hashlib, json, os, sys
root = sys.argv[1]
for dirpath, dirnames, filenames in os.walk(root):
    dirnames.sort()
    for name in sorted(filenames):
        if name.endswith('.part') or name.endswith('.tmp'):
            continue
        p = os.path.join(dirpath, name)
        h = hashlib.sha256()
        with open(p, 'rb') as f:
            for chunk in iter(lambda: f.read(1 << 20), b''):
                h.update(chunk)
        rel = os.path.relpath(p, root).replace(os.sep, '/')
        print(json.dumps({'path': rel, 'bytes': os.path.getsize(p), 'sha256': h.hexdigest()}))
`;

export function hashRemoteTree(host, root) {
  if (!/^[\w./-]+$/.test(root)) throw new Error(`refusing shell-unsafe source root: ${root}`);
  // The walker travels base64-encoded through a plain pipeline. Two plainer
  // routes failed in the field: a multi-line -c argument is mangled when ssh
  // flattens argv into one remote shell line, and a script streamed on the
  // ssh channel's stdin stalled sessions past every timeout (2026-10-31).
  const b64 = Buffer.from(REMOTE_WALKER).toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'ssh',
      ['-F', join(homedir(), '.ssh', 'config'), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, `echo ${b64} | base64 -d | python3 - ${root}`],
      { timeout: 240000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || '').trim() || err.message;
          return reject(new Error(`ssh hash of ${host}:${root} failed [exit ${err.code ?? '?'}]: ${detail.slice(0, 300)}`));
        }
        const out = stdout
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l));
        resolve(out.sort((a, b) => (a.path < b.path ? -1 : 1)));
      }
    );
  });
}

/* ── the pure comparison ──────────────────────────────────────────────── */

export function compareTrees(source, dest) {
  const sMap = new Map(source.map((f) => [f.path, f]));
  const dMap = new Map(dest.map((f) => [f.path, f]));
  const missing = [];
  const differ = [];
  const extra = [];
  for (const [p, sf] of sMap) {
    const df = dMap.get(p);
    if (!df) missing.push(p);
    else if (df.sha256 !== sf.sha256 || df.bytes !== sf.bytes) differ.push(p);
  }
  for (const p of dMap.keys()) if (!sMap.has(p)) extra.push(p);
  return { missing: missing.sort(), differ: differ.sort(), extra: extra.sort() };
}

export function buildManifest({ night, basis, source, files }) {
  return {
    kind: 'tepna.archive-manifest/1',
    night,
    basis,
    written_at: new Date().toISOString(),
    source,
    file_count: files.length,
    total_bytes: files.reduce((a, f) => a + f.bytes, 0),
    files
  };
}

/* ── environment ──────────────────────────────────────────────────────── */

function parseSrc() {
  const src = process.env.TEPNA_ARCHIVE_SRC || 'vigil:/srv/tepna/captures/';
  const m = src.match(/^([A-Za-z0-9_.-]+):(.+?)\/?$/);
  if (m && !src.startsWith('/')) return { host: m[1], root: m[2] };
  return { host: null, root: src.replace(/\/?$/, '') };
}

function destRoot() {
  return (process.env.TEPNA_ARCHIVE_DEST || join(homedir(), 'Tepna', 'uploads', 'vigil-archive', 'captures')).replace(/\/?$/, '');
}

async function isMountpoint(path) {
  return new Promise((resolve) => {
    execFile('mountpoint', ['-q', path], (err) => resolve(!err));
  });
}

async function destUsable(dest) {
  try {
    await access(dest);
  } catch {
    return `archive dest does not exist: ${dest}`;
  }
  if (dest.startsWith('/mnt/') && !(await isMountpoint(dest.split('/').slice(0, 3).join('/')))) {
    return `archive dest is not a mountpoint: ${dest}`;
  }
  return null;
}

// 'yes' | 'no' | 'error' — an ssh transport failure is not evidence that the
// night is absent, and the two are never reported as one.
async function probeSourceNight(src, night) {
  if (src.host) {
    return new Promise((resolve) => {
      execFile('ssh', ['-F', join(homedir(), '.ssh', 'config'), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', src.host, 'test', '-d', `${src.root}/${night}`], (err) => {
        if (!err) return resolve('yes');
        // ssh returns the remote exit status: 1 is the remote test saying
        // the directory is absent; 255 is ssh itself failing (route, auth).
        resolve(err.code === 1 ? 'no' : 'error');
      });
    });
  }
  try {
    await access(join(src.root, night));
    return 'yes';
  } catch {
    return 'no';
  }
}

async function hashSourceNight(src, night) {
  return src.host ? hashRemoteTree(src.host, `${src.root}/${night}`) : hashLocalTree(join(src.root, night));
}

/* ── modes ────────────────────────────────────────────────────────────── */

function manifestDir() {
  return process.env.TEPNA_ARCHIVE_MANIFEST_DIR || join(homedir(), '.local', 'state', 'tepna-archive-manifests');
}

async function writeManifest(manifest) {
  const dir = manifestDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${manifest.night}.json`), JSON.stringify(manifest, null, 1) + '\n');
}

async function readManifest(night) {
  try {
    return JSON.parse(await readFile(join(manifestDir(), `${night}.json`), 'utf8'));
  } catch {
    return null;
  }
}

async function doWrite(night, { quiet = false } = {}) {
  const dest = destRoot();
  const unusable = await destUsable(dest);
  if (unusable) return { status: 'NOT_RUN', reason: unusable, findings: [] };
  const src = parseSrc();
  const probe = await probeSourceNight(src, night);
  if (probe === 'error') {
    return { status: 'NOT_RUN', reason: `source unreachable over ssh: ${src.host}`, findings: [] };
  }
  if (probe === 'no') {
    return { status: 'FAIL', reason: `source night not found: ${night}`, findings: [`${night}: source missing`] };
  }
  const sourceFiles = await hashSourceNight(src, night);
  const destFiles = await hashLocalTree(join(dest, night));
  const cmp = compareTrees(sourceFiles, destFiles);
  const bad = [...cmp.missing.map((p) => `${night}: missing in copy: ${p}`), ...cmp.differ.map((p) => `${night}: differs: ${p}`)];
  if (bad.length) return { status: 'FAIL', findings: bad, checked: 1 };
  const manifest = buildManifest({
    night,
    basis: 'copy-time-source',
    source: src.host ? `${src.host}:${src.root}` : src.root,
    files: sourceFiles
  });
  await writeManifest(manifest);
  if (!quiet) console.log(`${night}: manifest written · ${manifest.file_count} files · ${manifest.total_bytes} bytes · basis copy-time-source`);
  return { status: 'PASS', findings: [], checked: 1, manifest };
}

async function doVerify(night, { quiet = false } = {}) {
  const dest = destRoot();
  const unusable = await destUsable(dest);
  if (unusable) return { status: 'NOT_RUN', reason: unusable, findings: [] };
  const manifest = await readManifest(night);
  if (!manifest) return { status: 'FAIL', findings: [`${night}: no manifest`], checked: 1 };
  const destFiles = await hashLocalTree(join(dest, night));
  const cmp = compareTrees(manifest.files, destFiles);
  const bad = [...cmp.missing.map((p) => `${night}: missing in copy: ${p}`), ...cmp.differ.map((p) => `${night}: differs: ${p}`)];
  if (cmp.extra.length && !quiet) console.log(`${night}: note · ${cmp.extra.length} extra file(s) in copy, not in manifest: ${cmp.extra.slice(0, 5).join(', ')}`);
  if (bad.length) return { status: 'FAIL', findings: bad, checked: 1 };
  if (!quiet) console.log(`${night}: verified · ${manifest.file_count} files match the manifest`);
  return { status: 'PASS', findings: [], checked: 1 };
}

async function doSync() {
  const dest = destRoot();
  const unusable = await destUsable(dest);
  if (unusable) return { status: 'NOT_RUN', reason: unusable, findings: [] };
  const src = parseSrc();
  const popBefore = snapshotNights(dest);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const entries = await readdir(dest, { withFileTypes: true });
  const nights = entries
    .filter((e) => e.isDirectory() && NIGHT_RE.test(e.name) && e.name < today)
    .map((e) => e.name)
    .sort();
  const findings = [];
  let checked = 0;
  for (const night of nights) {
    if (await readManifest(night)) continue;
    checked++;
    const probe = await probeSourceNight(src, night);
    if (probe === 'error') {
      findings.push(`${night}: source unreachable over ssh; manifest deferred`);
    } else if (probe === 'yes') {
      const r = await doWrite(night);
      if (r.status !== 'PASS') findings.push(...(r.findings || [`${night}: ${r.reason || r.status}`]));
    } else {
      const destFiles = await hashLocalTree(join(dest, night));
      const manifest = buildManifest({ night, basis: 'copy-only-backfill', source: null, files: destFiles });
      await writeManifest(manifest);
      console.log(`${night}: manifest written · ${manifest.file_count} files · basis copy-only-backfill`);
    }
  }
  const population = populationVerdict(popBefore, snapshotNights(dest), { tool: 'tools/archive-manifest.mjs', evidence: ['tools/archive-manifest.mjs'] });
  console.error(`population: ${popBefore.n} archived night(s) · movement ${population.status}${population.reason ? ` — ${population.reason}` : ''}`);
  console.log(`sync-manifests: ${nights.length} settled nights · ${checked} newly manifested · ${findings.length} finding(s)`);
  return { status: findings.length ? 'FAIL' : 'PASS', findings, checked, population };
}

/* ── selftest ─────────────────────────────────────────────────────────── */

export async function selftest() {
  const { mkdtemp, writeFile: wf, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  let ran = 0;
  const fail = [];
  const t = (name, cond) => {
    ran++;
    if (!cond) fail.push(name);
  };
  const base = await mkdtemp(join(tmpdir(), 'archman-'));
  try {
    const srcRoot = join(base, 'src');
    const dest = join(base, 'dest');
    const night = '2026-01-02';
    await mkdir(join(srcRoot, night, 'sub'), { recursive: true });
    await mkdir(join(dest, night, 'sub'), { recursive: true });
    await wf(join(srcRoot, night, 'a.bin'), Buffer.alloc(1000, 7));
    await wf(join(srcRoot, night, 'sub', 'b.bin'), Buffer.alloc(50, 9));
    await wf(join(srcRoot, night, 'growing.part'), Buffer.alloc(10, 1));
    for (const f of ['a.bin', 'sub/b.bin']) {
      const data = await readFile(join(srcRoot, night, f));
      await wf(join(dest, night, f), data);
    }
    process.env.TEPNA_ARCHIVE_SRC = srcRoot;
    process.env.TEPNA_ARCHIVE_DEST = dest;
    process.env.TEPNA_ARCHIVE_MANIFEST_DIR = join(base, 'manifests');

    const r1 = await doWrite(night, { quiet: true });
    t('write passes on identical trees', r1.status === 'PASS');
    const man = await readManifest(night);
    t('manifest exists with source basis', !!man && man.basis === 'copy-time-source');
    t('manifest excludes .part files', !!man && man.file_count === 2);
    t('manifest hashes match sha256 of content', !!man && man.files.find((f) => f.path === 'a.bin')?.sha256 === (await hashFile(join(srcRoot, night, 'a.bin'))));

    const v1 = await doVerify(night, { quiet: true });
    t('verify passes on untouched copy', v1.status === 'PASS');

    await wf(join(dest, night, 'a.bin'), Buffer.alloc(1000, 8));
    const v2 = await doVerify(night, { quiet: true });
    t('verify fails on a corrupted copy file', v2.status === 'FAIL' && v2.findings.some((f) => f.includes('a.bin')));

    const night2 = '2026-01-03';
    await mkdir(join(srcRoot, night2), { recursive: true });
    await mkdir(join(dest, night2), { recursive: true });
    await wf(join(srcRoot, night2, 'only-source.bin'), Buffer.alloc(10, 3));
    const r2 = await doWrite(night2, { quiet: true });
    t('write refuses when the copy is missing a file', r2.status === 'FAIL' && (await readManifest(night2)) === null);

    const cmp = compareTrees(
      [{ path: 'x', bytes: 1, sha256: 'a' }],
      [
        { path: 'x', bytes: 1, sha256: 'a' },
        { path: 'y', bytes: 2, sha256: 'b' }
      ]
    );
    t('compareTrees reports extras without failing equality', cmp.extra.length === 1 && cmp.missing.length === 0 && cmp.differ.length === 0);

    const v = verdictOf({ status: 'PASS', findings: [], checked: 1 });
    t('verdict validates as tepna.verdict/1', v && v.gate === 'archive-manifest');
    const vf = verdictOf({ status: 'FAIL', findings: ['2026-01-02: missing in copy: a.bin'], checked: 1 });
    t('FAIL verdict validates and carries its reason', vf.status === 'FAIL' && typeof vf.reason === 'string' && vf.reason.includes('a.bin'));
    const vn = verdictOf({ status: 'NOT_RUN', findings: [], checked: 0, reason: 'archive dest does not exist' });
    t('NOT_RUN verdict validates', vn.status === 'NOT_RUN' && vn.result === null);
  } finally {
    await rm(base, { recursive: true, force: true });
    delete process.env.TEPNA_ARCHIVE_SRC;
    delete process.env.TEPNA_ARCHIVE_DEST;
    delete process.env.TEPNA_ARCHIVE_MANIFEST_DIR;
  }
  const line = fail.length ? `archive-manifest selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ran, fail, line };
}

/* ── main ─────────────────────────────────────────────────────────────── */

if (isCliEntry(import.meta.url)) {
  refuseUnknownArgvOrExit(argv, ARGV_SPEC, { tool: 'archive-manifest' });
  if (argv.includes('--selftest')) {
    const r = await selftest();
    console.log(r.line);
    if (r.fail.length) console.log('FAILED:', r.fail.join(' · '));
    process.exit(r.fail.length ? 1 : 0);
  }
  const mode = positionalArgs(argv, ARGV_SPEC)[0];
  const nightAt = argv.indexOf('--night');
  const night = nightAt >= 0 ? argv[nightAt + 1] : null;
  let result;
  try {
    if (mode === 'write') {
      if (!night || !NIGHT_RE.test(night)) throw new Error('write needs --night YYYY-MM-DD');
      result = await doWrite(night);
    } else if (mode === 'verify') {
      if (!night || !NIGHT_RE.test(night)) throw new Error('verify needs --night YYYY-MM-DD');
      result = await doVerify(night);
    } else if (mode === 'sync-manifests') {
      result = await doSync();
    } else {
      console.error('usage: archive-manifest.mjs write|verify --night YYYY-MM-DD | sync-manifests | --selftest');
      process.exit(2);
    }
  } catch (e) {
    result = { status: 'FAIL', findings: [String(e.message || e)], checked: 0 };
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify(verdictOf(result), null, 1));
  } else {
    for (const f of result.findings || []) console.log(`FINDING ${f}`);
    if (result.reason) console.log(`reason: ${result.reason}`);
    console.log(`archive-manifest: ${result.status}`);
  }
  process.exit(result.status === 'PASS' ? 0 : result.status === 'NOT_RUN' ? 2 : 1);
}
