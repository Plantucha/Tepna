#!/usr/bin/env bash
# tepna-capture — deploy/archive-pull.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# archive-pull.sh — PULL vigil's capture tree to the dev box, so every night exists on TWO disks.
#
# WHY PULL, WHY HERE (owner decision 2026-08-25, VIGIL-OFFLOAD-AND-RETENTION lineage):
#   • The box's own archive machinery (`storage_targets.py`) is BUILT but its config points
#     `archive.dest` at THE SAME DISK (`/srv/tepna/archive`) — enabling it as configured would
#     produce two copies on one spindle, the exact failure it exists to prevent.
#   • PULL over `ssh vigil` means NO key is installed on the box and nothing on the box changes —
#     the dev box initiates, the box only serves what it already serves.
#   • Destination is a SUBDIRECTORY of the corpus, never uploads/ flat: docs/CORPUS-LOCATIONS.md
#     §85-86 records that uploads/ holds 3 flat CPAP nights as FIXTURE INPUTS and must not be a
#     corpus root — a flat pull would break verify-fixtures' corpus search.
#
# WHEN IT RUNS: daily at 13:30 (after the box's 13:00 ez-share harvest settles), NEVER at night —
# pulling during a recording reads growing files and archives torn tails as if final.
#
# WHAT IT DOES NOT DO:
#   • No --delete, EVER. An archive that mirrors deletions is a replica, not an archive.
#   • No writes to vigil. rsync runs in pull mode over ssh; the box side is read-only.
#   • No .part files — in-flight captures are excluded; they arrive complete on the next run.
#
# Install on the dev box (one-time; user timer, no root):
#   systemctl --user edit --force --full tepna-archive-pull.timer   # see units in this header
#   -- or simply:
#   crontab -e   →   30 13 * * *  /home/michal/Tepna/capture-host/deploy/archive-pull.sh
#
# The paired systemd user units, verbatim:
#   ~/.config/systemd/user/tepna-archive-pull.service
#     [Unit]
#     Description=Pull vigil captures to the corpus archive (second disk)
#     [Service]
#     Type=oneshot
#     ExecStart=/home/michal/Tepna/capture-host/deploy/archive-pull.sh
#   ~/.config/systemd/user/tepna-archive-pull.timer
#     [Unit]
#     Description=Daily 13:30 archive pull (after the box's 13:00 SD harvest)
#     [Timer]
#     OnCalendar=*-*-* 13:30:00
#     Persistent=true
#     [Install]
#     WantedBy=timers.target
#   then: systemctl --user daemon-reload && systemctl --user enable --now tepna-archive-pull.timer
#   ⚠ `loginctl enable-linger michal` or the timer dies with the login session — the exact
#     Linger=no silent-failure trap the main-auto-sync timers already hit once.
set -euo pipefail

SRC="vigil:/srv/tepna/captures/"
DEST="${TEPNA_ARCHIVE_DEST:-/home/michal/Tepna/uploads/vigil-archive/captures}"
LOG="${TEPNA_ARCHIVE_LOG:-$HOME/.local/state/tepna-archive-pull.log}"

mkdir -p "$DEST" "$(dirname "$LOG")"

# --ignore-existing is deliberately NOT used: a re-pulled file that changed upstream (a re-export,
# a repaired night) should refresh here. Without --delete, nothing is ever removed.
# --exclude='*.part' keeps in-flight captures out (they land complete on the next run).
{
  echo "== archive-pull $(date -Is) =="
  # RC captured via || so `set -e` cannot abort the block mid-log — a failed pull must still
  # write its EXIT line and destination counts, or the log truncates exactly when it matters.
  RC=0
  rsync -a --no-owner --no-group \
        --exclude='*.part' --exclude='*.tmp' \
        --timeout=300 \
        "$SRC" "$DEST/" || RC=$?
  echo "rsync EXIT=$RC"
  # The verdict is the DESTINATION, not the log (the 2026-08-25 harvest lesson): count what arrived.
  echo "dest files: $(find "$DEST" -type f | wc -l) · dest bytes: $(du -sb "$DEST" | cut -f1)"
  echo "newest: $(find "$DEST" -type f -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)"
  exit $RC
} >> "$LOG" 2>&1
