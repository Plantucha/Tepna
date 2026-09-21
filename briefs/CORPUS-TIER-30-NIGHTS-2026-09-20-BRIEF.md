<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** IN-PROGRESS — 2026-09-21 (FIRST REAL RUN 2026-09-21 14:31 → 15:08: replaced 46,517 files / 118.2 GB, `/srv/data` 96 % → 50 %, exit 3 on 29 refusals — all 0-byte `.archived` markers with no NAS twin, written by the vigil pull AFTER the migration snapshot. Two defects found by that run, both fixed same day: (1) nothing carried rig-originated files to the NAS — 228 local files had no twin; the tool now SYNCS a missing twin (additive, `COPYFILE_EXCL`) before tiering; (2) a 0-byte marker's existence is its signal and a symlink into an unmounted NAS reads as absent — zero-byte files now stay local unconditionally. Unit re-pointed to run the tool from `origin/main` via `git show | node -`, because the primary checkout sits on a stale branch and the timer was going to run yesterday's copy tomorrow) · **Created:** 2026-09-20

# Corpus tier — the last 30 nights stay local, everything older reads from the NAS

Charter: keep `/srv/data` from filling while every reader of `/srv/data/tepna-corpus/` keeps working
unchanged. Owner-ruled 2026-09-20 in eight parts (§1). Built as `tools/corpus-tier.mjs` + a rig user
timer. **Nothing is deleted, ever** — an aged file becomes a symlink into the verified NAS copy.

## 1 · The rulings, verbatim in effect

| question | ruling |
|---|---|
| mechanism when a file ages out | **replace with a symlink into the NAS** — never delete |
| scope | **everything**, by age |
| cadence | **standing nightly prune** on rig |
| what defines age | **the last 30 nights, by count** — not 30 calendar days; a capture gap does not drain the local set |
| undated files (synthetic/, workshop-imports/, `.trio-stamp`, loose exports) | **stay local, always** — the fixed reference set |
| verification before replacement | **size + SHA-256, every file** |
| schedule | **14:30 daily**, one hour after the 13:30 vigil pull |
| first run | **dry-run now; the real run is the timer's first fire** |

## 2 · Why symlinks and not deletion (the load-bearing constraint)

`/srv/data/tepna-corpus/` is not a cache. The primary checkout's `uploads/` is **391 symlinks into
it**; `corpusSearch` (`regen-goldens-core.mjs`), `verify-fixtures.mjs`, every `regen-*-goldens.mjs`
and `trio-batch.mjs` resolve there. The fixture inputs — `uploads/captures/`, `Ecg nightly/` (192 CPAP
nights), `trio/`, `synthetic/` — are **all older than 30 nights**. Deleting them locally would ENOENT
every gate that reads the corpus. A symlink keeps the path valid; the read goes over NFS.

## 3 · Measured before any header was written

- `/srv/data`: **96 % used, 9.6 GB free**, corpus 173.8 GB apparent (60,380 files), growing ~0.6 GB / 12 h.
- NAS copy: verified 2026-09-20 by path **and** size, both directions — **0 missing** (#2722).
- **Dry run of the tool:** 247 distinct nights · keep 30 (2026-08-22 → 2026-09-20, 12,349 files) · tier out
  **217 nights, 46,400 files, 116.9 GB** · 1,631 undated stay local · 0 refused by size.
- After the first real run `/srv/data` should sit near **~57 GB used** of 227.

## 4 · What the tool refuses, and the plant that proves it

A gate that cannot see must not report green. Planted on a tmpdir (`--skip-mount-check`, test-only):

| case | expected | measured |
|---|---|---|
| NAS root not an NFS mountpoint | exit 2, nothing changed | ✓ exit 2, file still regular |
| twin **same size, different bytes** | refused, left local, exit 3 | ✓ `sha256 differs`, regular, exit 3 |
| twin identical | symlinked atomically | ✓ `SYMLINK → nas/…` |
| file inside the keep window | untouched | ✓ regular |
| undated file | untouched | ✓ regular |
| rerun | idempotent | ✓ `already symlinked 1 · replaced 0` |

⚠️ **The same-size-different-bytes case is the reason the owner ruled full hashing.** A size-only
check passes it. It is also the shape of every rsync failure that leaves a file behind: right length,
wrong content.

## 5 · The rig units (not tracked — rig user units live in `~/.config/systemd/user/`, like `tepna-archive-pull`)

```ini
# tepna-corpus-tier.service
[Unit]
Description=Tepna corpus tier — keep the last 30 nights local, symlink older into the NAS
After=tepna-archive-pull.service
RequiresMountsFor=/mnt/nas/tepna-corpus
[Service]
Type=oneshot
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
ExecStart=/home/michal/.nvm/versions/node/v22.23.1/bin/node /home/michal/Tepna/tools/corpus-tier.mjs --keep 30

# tepna-corpus-tier.timer
[Timer]
OnCalendar=*-*-* 14:30:00
Persistent=true
RandomizedDelaySec=120
[Install]
WantedBy=timers.target
```

`RequiresMountsFor` means systemd will not even start the service if the NAS is not mounted; the
tool's own `findmnt` check is the second witness. Exit 2 and exit 3 both read as **failed** in
`systemctl --user status tepna-corpus-tier` — deliberately, so a refused night is visible.

## 6 · What this does NOT decide

- **Repointing the corpus root to the NAS** (one symlink, everything over NFS) — a different decision
  with a latency cost on a 60k-file tree. This brief keeps the hot 30 nights local precisely to avoid it.
- **`storage.keep_nights` on vigil** — the box's own prune; stays 0 until a night round-trips through
  #2720's fixed poller (VIGIL-OFFLOAD-AND-RETENTION).
- **The first run's NFS read cost** (~117 GB hashed, ~45 min) lands tomorrow 14:31. If it collides with
  gates, `Nice=10` / best-effort I/O is the throttle; `--keep` is the lever if the window should move.

## Done when

- [x] `tools/corpus-tier.mjs` built; biome clean; `--dry-run` measured on the real tree.
- [x] Plant covers: unmounted → exit 2; content-differs → refused; keep window + undated untouched; idempotent.
- [x] Timer installed, enabled, next fire shown by `systemctl --user list-timers`.
- [x] **First real run completed** 2026-09-21 14:31 → 15:08: `replaced 46,517 (118.2 GB) · refused 29` (all 0-byte markers, see header), `/srv/data` 96 % → 50 %, 113 GB free.
- [ ] `node tests/run-tests.mjs` from the primary checkout still passes its corpus-backed groups reading through the new symlinks (the 43 assertions CI cannot see).
- [ ] `node tools/verify-fixtures.mjs` still resolves every input — the June/July corpus now over NFS.
- [ ] Header flipped to DONE with the first run's numbers.
