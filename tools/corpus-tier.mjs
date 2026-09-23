/*
 * corpus-tier.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * KEEP THE LAST 30 NIGHTS LOCAL; EVERYTHING OLDER BECOMES A SYMLINK INTO THE NAS. Owner-ruled
 * 2026-09-20, in eight parts, each of which shapes a line below: the window is the 30 most recent
 * NIGHTS by count (a capture gap does not drain the local set — the same rule `keep_nights` applies on
 * vigil), not 30 calendar days; a file that ages out is REPLACED BY A SYMLINK into the NAS copy, never
 * deleted, so every reader that resolves through `/srv/data/tepna-corpus/` keeps working over NFS;
 * undated files (synthetic/, workshop-imports/, `.trio-stamp`, loose exports) STAY LOCAL ALWAYS as the
 * fixed reference set; ZERO-BYTE files stay local too (a marker's existence is its signal — `.archived` —
 * and a symlink into an unmounted NAS reads as absent, silently flipping it; there is nothing to save);
 * the NAS twin is verified by SIZE AND SHA-256 before the local copy is touched;
 * it runs at 14:30 daily, an hour after the vigil pull, so the newest night is counted first.
 *
 * WHY THIS EXISTS. `/srv/data` reached 96 % on 2026-09-20 with the canonical corpus at 174 GB and the
 * TrueNAS holding a verified full duplicate (60,380 files, path+size parity both directions). The
 * corpus grows ~0.6 GB per 12 h; without a tier the disk fills in days and the vigil pull writes into
 * a full volume. Deleting is not an option: 391 symlinks in the primary checkout, `verify-fixtures`,
 * every `regen-*-goldens` and `trio-batch` resolve into this tree, and the reference sets the fixtures
 * are built on are all older than 30 nights.
 *
 * WHAT "A NIGHT" IS. A file's night is, in order: a `YYYY-MM-DD` directory component in its path; a
 * `YYYYMMDD` stamp in its filename (year 2025–2027, month 01–12, day 01–31); otherwise NONE, and a
 * file with no night is never tiered. Distinct nights sort descending; the top `--keep` stay local.
 *
 * SYNC BEFORE TIER (added 2026-09-21 after the first real run refused 29 files). The migration copied a
 * SNAPSHOT; nothing carried new arrivals forward — the rig's daily vigil pull lands nights on
 * `/srv/data` that the NAS never sees (vigil's own push goes to a different NAS dataset), and the
 * `.archived` markers the pull writes exist only here. So a regular file with no NAS twin is first
 * COPIED to the NAS (`fs.copyFile`, additive, never overwrites, never deletes), and only then is it a
 * tier candidate. Symlinks are never synced — they already point into the NAS. The copy count is
 * printed; a copy that fails leaves the file local and counts as refused.
 *
 * WHAT IT REFUSES. A gate that cannot see must not report green: if the NAS root is not a mountpoint,
 * or holds fewer than `--nas-min-files`, it exits 2 having changed nothing. A file whose NAS twin is
 * missing, or differs in size or hash, is LEFT LOCAL and counted as `refused` — the exit is 3 if any
 * were, so a timer failure is visible in `systemctl --user status`. A symlink already pointing into
 * the NAS is skipped (idempotent). Replacement is atomic: symlink to a temp name, then rename over.
 *
 * ⚠️ THE HASH IS THE COST. The first run hashes ~110 GB over NFS (~45 min at the measured 48 MB/s);
 * every later run hashes one night's worth. `--fast` compares size only and exists for a dry-run
 * preview, never for the real replacement — the owner ruled full hashing, and a size match is what
 * every rsync failure mode looks like from outside.
 *
 * Usage:
 *   node tools/corpus-tier.mjs --dry-run              # print the plan, change nothing
 *   node tools/corpus-tier.mjs                        # replace, with full verification
 *   node tools/corpus-tier.mjs --keep 30 --src /srv/data/tepna-corpus --nas /mnt/nas/tepna-corpus
 * `--skip-mount-check` exists for the plant test only — never in the timer unit.
 *   node tools/corpus-tier.mjs --selftest --json     # the refusal plant on a scratch pair, as ONE verdict (CI, no corpus)
 * Exit: 0 clean · 2 NAS unavailable (nothing changed) · 3 some files refused (rest replaced)
 *
 * VERDICT (wave-2 adopter, VERDICT-CONTRACT §1): `--json` prints ONE tepna.verdict/1 object on stdout
 * (the human report moves to stderr). The decision is "every tiered file had a byte-identical NAS twin":
 * PASS = 0 refused and 0 sync failures; FAIL names the refusals; NOT_RUN when the NAS is not there.
 * `--selftest` runs the tool on a scratch src/nas pair — a control twin, a same-size twin with ONE byte
 * flipped, a zero-byte marker — and its verdict is whether the plant was REFUSED by sha256, the control
 * tiered and the marker kept local: the run #2784's byte audit did by hand, as the tool's own check.
 */
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const Verdict = createRequire(import.meta.url)(path.join(HERE, '..', 'verdict.js'));

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (k) => args.includes(k);
const SRC = path.resolve(opt('--src', '/srv/data/tepna-corpus'));
const NAS = path.resolve(opt('--nas', '/mnt/nas/tepna-corpus'));
const KEEP = Number(opt('--keep', '30'));
const NAS_MIN_FILES = Number(opt('--nas-min-files', '1000'));
const DRY = flag('--dry-run');
const FAST = flag('--fast');
const SKIP_MOUNT = flag('--skip-mount-check'); // TEST ONLY: plants run on a tmpdir, not a mount
const JSON_OUT = flag('--json');
const SELFTEST = flag('--selftest');
// under --json the human report goes to stderr so stdout is one parseable document
const out = (line) => (JSON_OUT ? console.error(line) : console.log(line));

function emitVerdict({ status, eligible, checked, result, reason, gate }) {
  let commit = null;
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: path.join(HERE, '..'), encoding: 'utf8' }).trim();
  } catch {
    /* no git */
  }
  const v = Verdict.make({
    gate: gate || 'corpus-tier',
    status,
    population: { checked, eligible, excluded: eligible - checked },
    criterion: { name: 'every-tiered-file-has-a-byte-identical-nas-twin', threshold: 0, unit: 'refused files', direction: 'eq' },
    result: status === 'NOT_RUN' ? null : result,
    evidence: ['tools/corpus-tier.mjs'].concat(SELFTEST ? [] : [SRC, NAS]),
    reason: reason === undefined ? null : reason,
    producedBy: commit ? { tool: 'tools/corpus-tier.mjs', commit } : { tool: 'tools/corpus-tier.mjs', commit: null, commitReason: 'git rev-parse unavailable' }
  });
  const check = Verdict.validate(v);
  if (!check.ok) throw new Error(`corpus-tier produced an invalid verdict: ${check.errors.join('; ')}`);
  process.stdout.write(JSON.stringify(v, null, 1) + '\n');
}

/* The refusal plant as a selftest: a scratch pair with a control (byte-identical twin ⇒ tiered), a
   plant (same size, byte 4000 flipped ⇒ REFUSED by sha256, NAS twin left untouched) and a zero-byte
   marker (kept local). Runs this tool as a child so the judged path is the real CLI path. */
async function selftest() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpus-tier-selftest-'));
  const src = path.join(root, 'src'),
    nas = path.join(root, 'nas');
  const night = 'uploads/trio/2026-01-01';
  await fs.mkdir(path.join(src, night), { recursive: true });
  await fs.mkdir(path.join(nas, night), { recursive: true });
  const body = Buffer.alloc(8192, 7);
  await fs.writeFile(path.join(src, night, 'control.dat'), body);
  await fs.writeFile(path.join(nas, night, 'control.dat'), body);
  const planted = Buffer.from(body);
  planted[4000] ^= 0x01;
  await fs.writeFile(path.join(src, night, 'plant.dat'), body);
  await fs.writeFile(path.join(nas, night, 'plant.dat'), planted);
  await fs.writeFile(path.join(src, night, 'marker.done'), Buffer.alloc(0));
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--src', src, '--nas', nas, '--keep', '0', '--nas-min-files', '1', '--skip-mount-check', '--json'], { encoding: 'utf8' });
  let child = null;
  try {
    child = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  } catch {
    /* judged below */
  }
  const control = await fs.lstat(path.join(src, night, 'control.dat')).then(
    (st) => st.isSymbolicLink(),
    () => false
  );
  const plantLocal = await fs.lstat(path.join(src, night, 'plant.dat')).then(
    (st) => st.isFile(),
    () => false
  );
  const nasPlant = await fs.readFile(path.join(nas, night, 'plant.dat')).then(
    (b) => Buffer.compare(b, planted) === 0,
    () => false
  );
  const markerLocal = await fs.lstat(path.join(src, night, 'marker.done')).then(
    (st) => st.isFile() && st.size === 0,
    () => false
  );
  const res = child && child.result ? child.result : {};
  const checks = {
    childVerdictFAILNamingThePlant: !!(child && child.status === 'FAIL' && /plant\.dat: sha256 differs/.test(child.reason || '')),
    controlTiered: control && res.replaced === 1,
    plantRefusedAndLeftLocal: plantLocal && res.refused === 1,
    corruptNasTwinNotOverwritten: nasPlant,
    zeroByteMarkerKeptLocal: markerLocal && res.zeroByte === 1,
    childExit3: r.status === 3
  };
  await fs.rm(root, { recursive: true, force: true });
  const failed = Object.keys(checks).filter((k) => !checks[k]);
  const names = Object.keys(checks);
  for (const k of names) out(`  ${checks[k] ? '✓' : '✗'} ${k}`);
  // the prose line selftest-all.mjs parses; the OBJECT is the API under --json
  out(failed.length ? `${failed.length} failed of ${names.length}` : `all ${names.length} selftests passed`);
  if (JSON_OUT)
    emitVerdict({
      status: failed.length ? 'FAIL' : 'PASS',
      eligible: names.length,
      checked: names.length,
      result: { checks, child: child && { status: child.status, reason: child.reason, result: child.result } },
      reason: failed.length ? `selftest plants not seen: ${failed.join(', ')}` : null
    });
  process.exit(failed.length ? 1 : 0);
}

const DIR_NIGHT = /^(\d{4})-(\d{2})-(\d{2})$/;
const FILE_NIGHT = /(?<!\d)(202[5-7])(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/;

function nightOf(rel) {
  const parts = rel.split(path.sep);
  for (const p of parts.slice(0, -1)) {
    const m = DIR_NIGHT.exec(p);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const m = FILE_NIGHT.exec(parts[parts.length - 1]);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function* walk(dir, base = dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) {
      yield { rel: path.relative(base, p), link: true };
      continue;
    }
    if (e.isDirectory()) yield* walk(p, base);
    else if (e.isFile()) yield { rel: path.relative(base, p), link: false };
  }
}

function sha256(file) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => res(h.digest('hex')))
      .on('error', rej);
  });
}

function nasMounted() {
  try {
    execFileSync('findmnt', ['-n', '-t', 'nfs,nfs4', NAS], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (SELFTEST) return selftest();
  // §refuse — a gate that cannot see must not report green
  if (!SKIP_MOUNT && !nasMounted()) {
    console.error(`REFUSING: ${NAS} is not an NFS mountpoint — nothing changed`);
    if (JSON_OUT) emitVerdict({ status: 'NOT_RUN', eligible: 0, checked: 0, reason: `${NAS} is not an NFS mountpoint — nothing examined, nothing changed` });
    process.exit(2);
  }
  let nasCount = 0;
  for await (const _ of walk(NAS)) {
    if (++nasCount >= NAS_MIN_FILES) break;
  }
  if (nasCount < NAS_MIN_FILES) {
    console.error(`REFUSING: ${NAS} holds ${nasCount} files (< ${NAS_MIN_FILES}) — looks unmounted or empty; nothing changed`);
    if (JSON_OUT) emitVerdict({ status: 'NOT_RUN', eligible: 0, checked: 0, reason: `${NAS} holds ${nasCount} files (< ${NAS_MIN_FILES}) — looks unmounted or empty; nothing examined` });
    process.exit(2);
  }

  const files = [];
  let alreadyLinked = 0;
  for await (const f of walk(SRC)) {
    if (f.link) alreadyLinked++;
    else files.push(f.rel);
  }
  const nights = new Map();
  let undated = 0;
  for (const rel of files) {
    const n = nightOf(rel);
    if (!n) {
      undated++;
      continue;
    }
    (nights.get(n) ?? nights.set(n, []).get(n)).push(rel);
  }
  const sorted = [...nights.keys()].sort().reverse();
  const keepSet = new Set(sorted.slice(0, KEEP));
  const tierOut = sorted.slice(KEEP).flatMap((n) => nights.get(n));

  // §sync — every regular local file with no NAS twin is copied there first (additive; never overwrites)
  let synced = 0;
  const syncFailed = [];
  for (const rel of files) {
    const remote = path.join(NAS, rel);
    try {
      await fs.access(remote);
      continue; // twin exists
    } catch {
      /* missing — copy it */
    }
    if (DRY) {
      synced++;
      continue;
    }
    try {
      await fs.mkdir(path.dirname(remote), { recursive: true });
      await fs.copyFile(path.join(SRC, rel), remote, fs.constants.COPYFILE_EXCL);
      synced++;
    } catch (e) {
      syncFailed.push(`${rel}: ${e.code ?? e.message}`);
    }
  }

  out(`corpus-tier ${DRY ? '(DRY RUN) ' : ''}src=${SRC} nas=${NAS} keep=${KEEP}`);
  out(`  regular files ${files.length} · already symlinked ${alreadyLinked} · undated (stay local) ${undated} · nights ${sorted.length}`);
  out(
    `  keep local: ${sorted.slice(0, KEEP).length} nights, ${[...keepSet].reduce((a, n) => a + nights.get(n).length, 0)} files (${sorted[Math.min(KEEP, sorted.length) - 1] ?? '—'} … ${sorted[0] ?? '—'})`
  );
  out(`  tier out:   ${sorted.length - keepSet.size} nights, ${tierOut.length} files`);
  out(`  ${DRY ? 'would sync' : 'synced'} to NAS: ${synced} new file(s) · sync failed ${syncFailed.length}`);
  for (const r of syncFailed.slice(0, 10)) out(`    ! ${r}`);

  let replaced = 0,
    refused = 0,
    zeroByte = 0,
    bytes = 0;
  const refusals = [];
  for (const rel of tierOut) {
    const local = path.join(SRC, rel),
      remote = path.join(NAS, rel);
    let ls, rs;
    try {
      ls = await fs.stat(local);
    } catch {
      continue; // vanished between walk and tier
    }
    if (ls.size === 0) {
      zeroByte++; // a marker: its EXISTENCE is the signal, a symlink into an unmounted NAS reads as absent, and there is nothing to save
      continue;
    }
    try {
      rs = await fs.stat(remote);
    } catch {
      refused++;
      refusals.push(`${rel}: NAS twin missing`);
      continue;
    }
    if (ls.size !== rs.size) {
      refused++;
      refusals.push(`${rel}: size ${ls.size} ≠ ${rs.size}`);
      continue;
    }
    if (!FAST && !DRY) {
      const [a, b] = await Promise.all([sha256(local), sha256(remote)]);
      if (a !== b) {
        refused++;
        refusals.push(`${rel}: sha256 differs`);
        continue;
      }
    }
    bytes += ls.size;
    if (DRY) {
      replaced++;
      continue;
    }
    const tmp = `${local}.tier-${process.pid}`;
    await fs.symlink(remote, tmp);
    await fs.rename(tmp, local); // atomic over the regular file
    replaced++;
  }
  out(`  ${DRY ? 'would replace' : 'replaced'} ${replaced} files (${(bytes / 2 ** 30).toFixed(1)} GB) · refused ${refused} · zero-byte kept local ${zeroByte}`);
  for (const r of refusals.slice(0, 20)) out(`    ! ${r}`);
  if (refusals.length > 20) out(`    … and ${refusals.length - 20} more`);
  if (JSON_OUT) {
    const bad = refused + syncFailed.length;
    emitVerdict({
      status: bad ? 'FAIL' : 'PASS',
      eligible: tierOut.length,
      checked: replaced + refused + zeroByte,
      result: {
        dryRun: DRY,
        files: files.length,
        nights: sorted.length,
        tierOut: tierOut.length,
        replaced,
        refused,
        zeroByte,
        synced,
        syncFailed: syncFailed.length,
        bytes,
        refusals: refusals.slice(0, 50)
      },
      reason: bad
        ? `${refused} file(s) refused (no byte-identical NAS twin)${syncFailed.length ? `, ${syncFailed.length} sync failure(s)` : ''}: ${refusals.concat(syncFailed).slice(0, 5).join('; ')}`
        : null
    });
  }
  process.exit(refused || syncFailed.length ? 3 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
