<!--
  VIGIL-OFFLOAD-AND-RETENTION-2026-07-20-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-20

_Executes E6 of `VIGIL-OBSERVED-ERRORS-2026-07-20-BRIEF.md` (retention + offload are configured off).
Deployment / config work — no `*-dsp.js` or bundle change._

> **INTERIM EXECUTED (2026-07-20) — the single-copy risk is defused; the production/NAS decision is still
> open, so this stays PROPOSED.** On the reference box: (a) `nightarchive.archive_night` was validated on
> real nights → a second physical disk (idempotent, sizes-match, marker dropped, NTFS `copy2` clean);
> (b) the existing completed nights were mirrored so every finished night now lives on **two disks**;
> (c) `storage.keep_nights: 14` + `archive.enabled` (Option 2, local second disk) were set in `config.yaml`,
> so future nights auto-mirror and the box prunes its own old primaries. The TrueNAS (`192.168.0.142`, SMB
> + SSH both reachable) remains the eventual off-machine home — that plus the production-box choice below
> are the remaining owner decisions.

# Get finished nights off the box automatically, and let the box reclaim its own space

**Out-of-suite (`capture-host/`, deploy config).** The capture box writes ~1.5 GB/night and, at the
current `keep_nights: 0`, **never deletes anything**. A 240 GB SSD therefore fills in **~3–4 months**,
after which capture fails *silently* (a full filesystem makes `StreamWriter`'s fsync start failing while
the daemon still looks alive — the exact morning-only failure the guardrails exist to prevent). This
brief settles how nights leave the box and how the box reclaims space, and records the decision so it is
not re-litigated.

## The decision — automatic nightly mirror + retention, NOT manual monthly

A manual "copy to the NAS once a month, then wipe the box" scheme is the cheapest in *setup effort* and
was the first instinct, but it is rejected:

- **It re-opens a month-wide single-copy window.** For up to ~29 days the ONLY copy of a night is the
  box's single SSD. Cheap SSDs fail suddenly, not gradually — a failure on day 28 loses ~28
  **unrecoverable** nights. This is precisely the exposure the rest of the Vigil work closed.
- **It is a human step, so it will eventually be skipped.** The design goal is "the box protects a night
  without you watching"; a monthly ritual is the opposite of that.
- **It is not actually cheaper in money.** The NAS/disk is the same either way; the only thing manual
  buys is skipping a one-time setup, at the cost of permanent risk + a recurring chore.
- **Capacity was never the reason to copy** — 30 nights is only ~45 GB, well inside 240 GB. Cadence is
  purely a risk/effort question, and nightly wins it.

**What is adopted instead** — both halves already exist in code; this is configuration, not development:

1. **Nightly mirror** — `nightarchive.py` + `capture.archive_poller`. Each COMPLETED night (never
   tonight — it is still being written) is mirrored to `archive.dest`. Idempotent + resumable via a
   per-night `.archived` marker, and it **MIRRORS, never moves** — copy and delete are deliberately
   separate concerns, so a failed/slow copy can never be what deletes a night.
2. **Retention** — `storage.keep_nights: 14` prunes the LOCAL copy of night dirs older than the newest
   14, but only ever the strict `YYYY-MM-DD` dirs, and **tonight is always protected**. A local night is
   only reclaimed well after it is safely on the NAS.

Net effect: every night is on two disks within ~24 h (vs up to ~30 days), the box self-manages space,
and there is **zero recurring manual step**. 14 nights local also preserves the ~2-week window the
crossnight / trend work leans on.

### Config to set (deploy config, edit the file — deliberately OUT of `settings_schema`)
```yaml
storage:
  keep_nights: 14         # was 0 (never prune). Local copy pruned AFTER it is mirrored; tonight always kept.
  min_free_gb: 2
  poll_sec: 300
archive:
  enabled: true           # was false
  dest: "<transport-dependent — see below>"
  poll_sec: 3600
```

## Dependency (already landed)

`archive_night()` is a synchronous `shutil.copy2` walk (~2 GB / ~1500 files) and used to run **inline on
the capture event loop** — a slow or hung `dest` would have starved every capture task and stopped the
`WatchdogSec=120` heartbeat, restarting the daemon mid-night. **PR #292 moved it (and the QC scan + the
retention rmtree) onto `asyncio.to_thread`.** Enabling `archive.enabled` is therefore only safe on the
merged code — do not enable it on a build predating #292.

## Transport — decide with the hardware, then fill `dest`

Ranked safest-first for an unattended bedside recorder. The rule: **the recorder should not be able to
hang on something it does not own.**

1. **NAS PULLS from the box (preferred if the NAS is the target).** Leave `archive.enabled: false` and
   let TrueNAS (`192.168.0.142`) run a scheduled **Rsync Task over SSH** pulling
   `…/tepna-smoketest/captures/` into a dataset, scheduled for **after wake (~08:00)** so tonight's dir
   is closed first. Nothing is mounted on the recorder, so a NAS outage is invisible to capture. Probed
   2026-07-20: **SMB (445) open, NFS (2049)/rpcbind (111) closed**, so NFS is not currently an option;
   the pull path sidesteps that entirely. `storage.keep_nights` still does the local reclaim.
2. **Local disk (if the box gets its own big drive — e.g. a Pi/N100/800-G3-mini with a 2 TB NVMe).**
   `archive.dest` = a local path on that disk; the copy becomes a local filesystem move with **no mount,
   no protocol, no network partition**. Simplest and most robust; retention still prunes the primary
   captures dir.
3. **Box PUSHES to a mount (last resort).** `sudo apt install cifs-utils`, an `/etc/fstab` CIFS entry,
   credentials in `/etc/cifs-tepna.cred` (`0600`, NOT in `fstab`), `archive.dest = /mnt/nas/tepna`,
   `archive.enabled: true`. Works, and #292 makes a mount hang non-fatal — but it couples the recorder's
   health to the NAS's, which options 1–2 avoid.

**SMB stays as-is regardless** — it is the right surface for a Windows box to *browse* the archive, which
is orthogonal to how the bytes get there.

## Open items (need an owner decision + root)

- [ ] **Production box chosen** — leaning HP EliteDesk 800 G3 mini (~$135, powerful/serviceable, quiet
      fan) vs a fanless N100 (e.g. MINIX Z100-0dB, ~$345, silent premium). Decides transport 1 vs 2. The
      existing USB BLE dongle moves to production either way; note `config.yaml` pins `adapter:` to a MAC,
      which changes on migration.
- [ ] **Transport chosen** → fill `dest` (or set up the TrueNAS Rsync Task).
- [ ] **Root-level setup** (SSH key for the pull, or `cifs-utils` + `fstab` for a mount) — needs owner
      go-ahead; not done unattended.
- [ ] Confirm the production drive is a real SSD/NVMe, not eMMC/SD (endurance is a non-issue —
      ~1.5 GB/night is >100 years on an 80 TBW drive — but SD-class storage is where the QC re-scan
      stalls bite hardest, per #292).

## Done when

- [ ] `storage.keep_nights` set to a non-zero window and verified pruning only old strict-date dirs,
      tonight protected.
- [ ] Nightly mirror running (auto `nightarchive`, or a TrueNAS pull) and a completed night confirmed
      present on the NAS/target **before** its local copy is reclaimed.
- [ ] A full disk is no longer reachable in normal operation: free space trends flat, not down.
- [ ] Header flipped to `Status: DONE` once a real night has round-tripped box → target → local prune.
