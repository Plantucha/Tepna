#!/usr/bin/env bash
# tepna-capture — deploy/archive-pull.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# archive-pull.sh — PULL vigil's capture tree to the dev box, so every night exists on TWO disks.
#
# WHY PULL, WHY HERE (owner decision 2026-08-25, VIGIL-OFFLOAD-AND-RETENTION lineage):
#   • The box's own archive machinery (`storage_targets.py`) IS ENABLED, and it pushes every night
#     to the NAS export a rig reader mounts. Measured 2026-11-01, read-only: the live vigil config
#     reads `archive.enabled: true`, `protocol: rsync`, the NAS host and a `share` on the NAS pool.
#     The 2026-08-25 wording said the box never pushes, because `archive.dest` then pointed at the
#     box's own disk. That claim is RETRACTED — the config decides it, never this header. Read
#     `docs/CORPUS-LOCATIONS.md` for the measured state, and the box config for the live one.
#   • So this pull is the SECOND copy, on a disk that neither the box nor the NAS pool holds. The
#     NAS copy has a writer, and a reader who finds none has trusted a header over a config.
#   • PULL over `ssh vigil` means NO key is installed on the box and nothing on the box changes —
#     the dev box initiates, the box only serves what it already serves.
#   • Destination is a SUBDIRECTORY of the corpus, never uploads/ flat: docs/CORPUS-LOCATIONS.md
#     §85-86 records that uploads/ holds 3 flat CPAP nights as FIXTURE INPUTS and must not be a
#     corpus root — a flat pull would break verify-fixtures' corpus search.
#
# WHEN IT RUNS: daily at 13:30 (after the box's 13:00 ez-share harvest settles), NEVER at night —
# pulling during a recording reads growing files and archives torn tails as if final.
#
# MANIFESTS (item 3a, INFRA-STATE-2026-10-31): after a successful pull,
# tools/archive-manifest.mjs writes a per-file sha256 manifest for each newly
# archived night, hashed from the source. A manifest failure never fails the
# pull. It is logged here, and unmanifested nights are the reconciler's finding.
#
# WHAT IT DOES NOT DO:
#   • No --delete, EVER. An archive that mirrors deletions is a replica, not an archive.
#   • No writes to vigil. rsync runs in pull mode over ssh; the box side is read-only.
#   • No .part files — in-flight captures are excluded; they arrive complete on the next run.
#   • It does NOT refuse an unwritable destination. It PROBES one and names it — see the probe below.
#   • No chmod of its own. #4474 removed rsync's with `--no-perms`, and no script here replaces it.
#
# Install on the dev box (one-time; user timer, no root):
#   systemctl --user edit --force --full tepna-archive-pull.timer   # see units in this header
#   -- or simply:
#   crontab -e   →   30 13 * * *  ~/Tepna/capture-host/deploy/archive-pull.sh
#
# The paired systemd user units, verbatim:
#   ~/.config/systemd/user/tepna-archive-pull.service
#     [Unit]
#     Description=Pull vigil captures to the corpus archive (second disk)
#     [Service]
#     Type=oneshot
#     ExecStart=%h/Tepna/capture-host/deploy/archive-pull.sh   # `%h` is the unit user's home;
#                                                              systemd expands no `~` and no `$HOME`
#   ~/.config/systemd/user/tepna-archive-pull.timer
#     [Unit]
#     Description=Daily 13:30 archive pull (after the box's 13:00 SD harvest)
#     [Timer]
#     OnCalendar=*-*-* 13:30:00
#     Persistent=true
#     [Install]
#     WantedBy=timers.target
#   then: systemctl --user daemon-reload && systemctl --user enable --now tepna-archive-pull.timer
#   ⚠ `loginctl enable-linger "$USER"` or the timer dies with the login session — the exact
#     Linger=no silent-failure trap the main-auto-sync timers already hit once.
set -euo pipefail

# SRC overridable for the test harness only — production always pulls from vigil.
SRC="${TEPNA_ARCHIVE_SRC:-vigil:/srv/tepna/captures/}"
DEST="${TEPNA_ARCHIVE_DEST:-$HOME/Tepna/uploads/vigil-archive/captures}"
LOG="${TEPNA_ARCHIVE_LOG:-$HOME/.local/state/tepna-archive-pull.log}"

mkdir -p "$DEST" "$(dirname "$LOG")"

# --ignore-existing is deliberately NOT used: a re-pulled file that changed upstream (a re-export,
# a repaired night) should refresh here. Without --delete, nothing is ever removed.
# --exclude='*.part' keeps in-flight captures out (they land complete on the next run).
# --no-perms: rsync never chmods the destination. On the Synology a chmod replaces a folder's ACL
# with plain mode bits, so `-a` alone stripped the inherited ACL and locked the NFS user out
# (rsync exit 23, daily from 2026-10-31). New files take the destination's inherited ACL instead.
{
  echo "== archive-pull $(date -Is) =="
  # ── THE DESTINATION'S WRITE BIT IS MEASURED BEFORE rsync SPEAKS ────────────────────────────────
  # Measured from the 2026-10-31 17:50 EDT run (residue
  # `2026-11-01-the-archive-pull-cannot-write-its-own-destination`): the tree carried 755 directories
  # and 644 files under another uid, so this pull held no write bit anywhere in it. The log said so in
  # 59 path-bearing rsync errors — 47 `mkstemp` refusals, 7 failed-to-set-times, 3 mkdir and 2
  # failed-to-open over 34 night directories — and the ONE fact behind all 59 appeared in none of
  # them. An operator who reads the tail reads a transfer error; the cause is a mode bit.
  #
  # A PROBE, NOT A MODE READ. `test -w` reads the bits as this kernel renders them, and over NFSv3
  # `sec=sys` with a server-side ACL or a squashed uid that is not the question being asked. Writing a
  # file and removing it is the capability itself.
  #
  # IT NAMES, IT DOES NOT REFUSE. rsync exit 23 is a PARTIAL transfer: a tree whose root is locked may
  # still have one writable night, and refusing early would discard what the run could still do. So
  # the probe is a line in the log before the attempt, and the attempt happens either way.
  #
  # TWO DEPTHS, because the failure was per-night: the root says whether a new night can be created,
  # and the newest existing night says whether an existing one can be refreshed. A tree with no
  # subdirectory reports `none` rather than a guess (§∅).
  probe_write() {
    local dir="$1" probe
    probe="${dir}/.tepna-dest-probe.$$"
    # The REDIRECTION is what fails, and the shell reports that itself, before `:` runs. So the
    # `2>/dev/null` has to wrap the whole group — on `:` alone a refused probe printed a raw
    # `Permission denied` naming the full destination path, beside the line that explains it.
    if { : > "$probe"; } 2>/dev/null; then
      rm -f "$probe"
      echo "yes"
    else
      echo "NO"
    fi
  }
  # A probe from a killed run would otherwise sit in the tree forever: there is no --delete here.
  rm -f "$DEST"/.tepna-dest-probe.* 2>/dev/null || true
  DEST_ROOT_W="$(probe_write "$DEST")"
  NEWEST_NIGHT="$(find "$DEST" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)"
  if [ -n "$NEWEST_NIGHT" ]; then
    DEST_NIGHT_W="$(probe_write "$NEWEST_NIGHT")"
  else
    DEST_NIGHT_W="none"
  fi
  echo "dest-writable: root=${DEST_ROOT_W} newest-night=${DEST_NIGHT_W}"
  # RC captured via || so `set -e` cannot abort the block mid-log — a failed pull must still
  # write its EXIT line and destination counts, or the log truncates exactly when it matters.
  RC=0
  rsync -a --no-owner --no-group --no-perms \
        --exclude='*.part' --exclude='*.tmp' \
        --timeout=300 \
        "$SRC" "$DEST/" || RC=$?
  echo "rsync EXIT=$RC"
  # ONE LINE FOR THE CAUSE OF 59, AND IT IS NOT GATED ON rsync's EXIT CODE. Exit 23 is a partial
  # transfer, so a non-zero code says that something refused and never WHICH depth did. The probe
  # answers that, and it answers on a run rsync reports as clean: a locked night under a writable
  # root transfers nothing new and still exits 0.
  #
  # THE REMEDY IS THE OWNER'S AND IT IS NOT A chmod. #4474 measured that a chmod on the Synology
  # replaces a folder's inherited ACL with plain mode bits, which is what locked this uid out, and it
  # removed rsync's own chmod with `--no-perms`. So this line names the ACL restore in DSM. A mode
  # change from a script here would re-apply the very mechanism that caused the outage.
  if [ "$DEST_ROOT_W" = "NO" ] || [ "$DEST_NIGHT_W" = "NO" ]; then
    echo "archive-pull: the DESTINATION refused a probe write before rsync ran (see the EXIT line above for what rsync then managed)"
    echo "archive-pull: remedy (owner-run, in DSM): restore the inherited ACL on the archive tree so this uid regains write — never a chmod, which replaces the ACL (#4474)"
  fi
  # The verdict is the DESTINATION, not the log (the 2026-08-25 harvest lesson): count what arrived.
  echo "dest files: $(find "$DEST" -type f | wc -l) · dest bytes: $(du -sb "$DEST" | cut -f1)"
  echo "newest: $(find "$DEST" -type f -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)"
  # Item 3a (INFRA-STATE-2026-10-31): write copy-time hash manifests for newly
  # archived nights. Best-effort: a manifest failure never fails the pull.
  if [ "$RC" -eq 0 ]; then
    MANIFEST_TOOL="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/tools/archive-manifest.mjs"
    NODE="$(command -v node || true)"
    if [ -z "$NODE" ]; then
      for cand in "$HOME"/.nvm/versions/node/*/bin/node; do
        [ -x "$cand" ] && NODE="$cand"
      done
    fi
    if [ -n "$NODE" ] && [ -f "$MANIFEST_TOOL" ]; then
      "$NODE" "$MANIFEST_TOOL" sync-manifests || echo "manifest sync EXIT=$? (pull unaffected)"
    else
      echo "manifest sync skipped: node or tools/archive-manifest.mjs not found"
    fi
  fi
  exit $RC
} >> "$LOG" 2>&1
