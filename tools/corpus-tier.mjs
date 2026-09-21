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
 * fixed reference set; the NAS twin is verified by SIZE AND SHA-256 before the local copy is touched;
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
 * Exit: 0 clean · 2 NAS unavailable (nothing changed) · 3 some files refused (rest replaced)
 */
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

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
  // §refuse — a gate that cannot see must not report green
  if (!SKIP_MOUNT && !nasMounted()) {
    console.error(`REFUSING: ${NAS} is not an NFS mountpoint — nothing changed`);
    process.exit(2);
  }
  let nasCount = 0;
  for await (const _ of walk(NAS)) {
    if (++nasCount >= NAS_MIN_FILES) break;
  }
  if (nasCount < NAS_MIN_FILES) {
    console.error(`REFUSING: ${NAS} holds ${nasCount} files (< ${NAS_MIN_FILES}) — looks unmounted or empty; nothing changed`);
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

  console.log(`corpus-tier ${DRY ? '(DRY RUN) ' : ''}src=${SRC} nas=${NAS} keep=${KEEP}`);
  console.log(`  regular files ${files.length} · already symlinked ${alreadyLinked} · undated (stay local) ${undated} · nights ${sorted.length}`);
  console.log(
    `  keep local: ${sorted.slice(0, KEEP).length} nights, ${[...keepSet].reduce((a, n) => a + nights.get(n).length, 0)} files (${sorted[Math.min(KEEP, sorted.length) - 1] ?? '—'} … ${sorted[0] ?? '—'})`
  );
  console.log(`  tier out:   ${sorted.length - keepSet.size} nights, ${tierOut.length} files`);

  let replaced = 0,
    refused = 0,
    bytes = 0;
  const refusals = [];
  for (const rel of tierOut) {
    const local = path.join(SRC, rel),
      remote = path.join(NAS, rel);
    let ls, rs;
    try {
      ls = await fs.stat(local);
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
  console.log(`  ${DRY ? 'would replace' : 'replaced'} ${replaced} files (${(bytes / 2 ** 30).toFixed(1)} GB) · refused ${refused}`);
  for (const r of refusals.slice(0, 20)) console.log(`    ! ${r}`);
  if (refusals.length > 20) console.log(`    … and ${refusals.length - 20} more`);
  process.exit(refused ? 3 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
