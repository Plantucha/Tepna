<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Corpus byte audit — 2026-09-21

**Status:** REFERENCE (a dated measurement; re-run it, never edit it) · **Created:** 2026-09-21 · **Fleet-Session:** Magpie

Owner assignment: *"check byte correct transfer."* The canonical corpus was rsynced to the NAS on
2026-09-20 (#2722, path+size parity, 60,380 files) and on 2026-09-21 `corpus-tier` replaced 46,517
local files with symlinks after a SHA-256 on both sides of each (#2723). Those three PRs are one
session's; this is a second instrument, written for the purpose, reporting numbers rather than a
verdict.

## What was measured

Three runs, all on rig-x870, `LC_ALL=C`, NUL-safe paths, detached under `systemd-run --user`:

1. **Every local regular file, hashed both sides** — `find -type f` on `/srv/data/tepna-corpus`,
   SHA-256 of the local file and of its NAS twin at the same relative path, compared by hash and by size.
2. **A NAS-side SHA-256 manifest** of every regular file under `/mnt/nas/tepna-corpus` (nfs4,
   `soft` mount, 47 GB reported used).
3. **The refusal plant, re-run independently** of the tool's own selftest: a scratch src/nas pair
   with one correct twin (control) and one twin of the same size with one byte flipped, driven through
   `tools/corpus-tier.mjs --skip-mount-check` — the flag that exists for exactly this.

## Numbers

| population | count |
|---|---|
| local regular files | **14,091** (61.04 GB) |
| local symlinks | **46,517** — every one into `/mnt/nas/tepna-corpus`, **0 dangling** |
| NAS regular files | **60,383** |

**Run 1 — local regular files vs their NAS twins:**

| result | files | what they are |
|---|---|---|
| **MATCH** | **13,831** | identical SHA-256 both sides |
| NO_TWIN | 228 | all dated 2026-09-20/21 under `uploads/vigil-archive/captures` (83) and `smoketest-captures` (145) — the late arrivals #2780 syncs; expected, not a failure |
| MISMATCH_SIZE | 28 | see below |
| MISMATCH_BYTES | 4 | see below |

**All 32 mismatches are the box's live state, in its two mirror trees** (`smoketest-captures/` and
`uploads/vigil-archive/captures/`): the 2026-09-20 night still recording when the NAS copy was taken
(`OXYLIFE.csv` 1.7 kB on the NAS vs 113 kB local; `CLOCKSYNC.csv`, `QC-SUMMARY.json`, the `_LINK` /
`_CLOCK` csvs), ledgers the box appends (`cpap_spool_ledger.jsonl`, `inventory.jsonl`,
`cpap-harvest-jobs.jsonl`, `watchdog.log`), and state files it rewrites (`status.json`,
`link-baselines.json`, `cpap-autostart-session.json`, and the four 13-byte `.watchdog-fixes` /
`.watchdog-wedge` counters, whose local mtime is exactly one day newer than the NAS copy and whose
tenth byte is the counter digit). **Mismatches in the immutable corpus (`uploads/` outside the vigil
mirror): 0** — 7,166 files checked there, 7,069 match, 97 have no twin yet, none differ.

**Run 2 — the NAS manifest:** 60,383 files, **0 read errors**, 8.4 MB. Cross-instrument check: every
one of run 1's 13,831 NAS hashes agrees with the manifest's independent read of the same file ~40
minutes later — **13,831 / 13,831, 0 disagreeing**. The 46,517 symlink targets are **all** present in
the manifest. The accounting closes exactly: 46,517 symlink targets + 13,863 twins of local files + 3
orphans = 60,383. The three orphans: `.writetest` (a mount probe), `_archive/tepna-superseded-20260919.bundle`,
and `uploads/vigil-captures/2026-09-02/.Polar_VeritySense_0C301E3F_20260902225953_MAG.txt.QfZQ9t` —
a **zero-byte rsync temp file** from a stream interrupted at 18:28 on 2026-09-20 before it wrote
anything; the real 14,058,568-byte file is present both sides and matches. Deleting it is the
owner's call. These three are also why the count is 60,383 against the parity check's 60,380.

**Run 3 — the plant holds:** the correct twin was replaced by a symlink; the same-size,
one-byte-different twin was refused — *"sha256 differs"* — left local, exit 3, and its corrupt NAS
copy was **not overwritten**. Two properties that follow, both now measured rather than read: the tool
never repairs a NAS twin, so a corrupt twin stays corrupt until someone acts; and the sync-before-tier
step copies files that lack a twin whether or not they are tier candidates (the kept night's file was
copied too).

## What this does NOT establish, stated as the limit

The 46,517 replaced files' local originals no longer exist. Their byte-correctness rests on the tool
having hashed both sides before each `rename` — established by its design, by its selftest, and by
the plant above under a second hand — **not by a second instrument reading the original bytes.** The
only route to that is restoring a sample from a pre-tier backup, and there is none on rig. The NAS is
now the only copy of those 118 GB; the manifest below is what makes drift in it detectable from here on.

## Baseline artifacts (local disk, beside the corpus, never tiered — undated by both of the tool's rules)

| file | lines | SHA-256 |
|---|---|---|
| `/srv/data/tepna-corpus/.manifests/nas-sha256-2026-09-21.txt` | 60,383 | `a274d6193d241a6ea7a5264c53fd767fca00d45d5fe5197d6375357378ef2671` |
| `/srv/data/tepna-corpus/.manifests/local-vs-nas-2026-09-21.tsv` | 14,091 | `7cd3b306893de1d8d805ac0b98be8e76028a67cf40c05ed3b1f9fa5dd4eec7a9` |

The manifest is 8.4 MB and lives beside the corpus rather than in the repo; the two hashes above are
the repo's record of it. To detect NAS drift later: re-run `find . -type f -print0 | sort -z |
xargs -0 sha256sum` from `/mnt/nas/tepna-corpus` and `comm` against the manifest — the live-mirror
trees will differ by design, the immutable corpus must not.
