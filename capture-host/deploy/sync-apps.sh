#!/usr/bin/env bash
# tepna-capture — deploy/sync-apps.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# COPY THE REPO'S BUNDLED APPS INTO THE DIRECTORY CADDY SERVES.
#
#   bash sync-apps.sh [--check]
#
# ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────
# `/srv/tepna/app` is a COPY of the repo's `*.html` bundles, not a symlink and not a checkout. Nothing
# was refreshing it: `deploy-vigil.sh` creates the directory, `install-services.sh` only counts what is
# in it, and the bundles were copied there by hand once. It then rotted silently — on 2026-07-26 the
# served `PpgDex.html` was a full day behind the repo and ELEVEN bundles had never been copied at all.
#
# A stale bundle is the worst kind of wrong, because nothing about it looks wrong: the phone loads an
# app that opens, renders, and computes — with last week's DSP. Every provenance gate in this suite
# operates on the REPO copy, so GATE A can be green on a `manifestHash` that is not the code being
# served. This closes that: the served set is a byte-for-byte copy of the gated one, and `--check`
# says so or exits non-zero.
#
# ── WHY IT DOES NOT DELETE ─────────────────────────────────────────────────────────────────────────
# Files present in the served directory but absent from the repo are LEFT ALONE and merely reported. A
# deploy script that prunes a directory it does not fully own is one rename away from removing
# something an operator put there deliberately. Reporting is enough to notice; deleting is not the
# script's call.
set -uo pipefail

SRC="${TEPNA_SRC:-$(cd "$(dirname "$0")/../.." && pwd)}"
DEST="${TEPNA_APP_DIR:-/srv/tepna/app}"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

[ -d "$SRC" ] || { echo "  ✗ source not found: $SRC"; exit 1; }
if [ ! -d "$DEST" ]; then
  [ "$CHECK" = "1" ] && { echo "  ✗ $DEST does not exist"; exit 1; }
  mkdir -p "$DEST" || { echo "  ✗ cannot create $DEST"; exit 1; }
fi

shopt -s nullglob
bundles=("$SRC"/*.html)
[ ${#bundles[@]} -gt 0 ] || { echo "  ✗ no *.html bundles in $SRC — wrong source directory?"; exit 1; }

changed=0 added=0 same=0 failed=0
for f in "${bundles[@]}"; do
  b="$(basename "$f")"
  if [ -e "$DEST/$b" ]; then
    if cmp -s "$f" "$DEST/$b"; then
      same=$((same + 1))
      continue
    fi
    [ "$CHECK" = "1" ] && { echo "  ✗ STALE  $b"; changed=$((changed + 1)); continue; }
    cp -p "$f" "$DEST/$b" && changed=$((changed + 1)) || { echo "  ✗ failed to copy $b"; failed=$((failed + 1)); }
  else
    [ "$CHECK" = "1" ] && { echo "  ✗ MISSING $b"; added=$((added + 1)); continue; }
    cp -p "$f" "$DEST/$b" && added=$((added + 1)) || { echo "  ✗ failed to add $b"; failed=$((failed + 1)); }
  fi
done

# Present in the served set, absent from the repo — reported, never removed (see the header).
extra=0
for f in "$DEST"/*.html; do
  b="$(basename "$f")"
  [ -e "$SRC/$b" ] || { echo "  · extra (left alone): $b"; extra=$((extra + 1)); }
done

if [ "$CHECK" = "1" ]; then
  echo "  ${#bundles[@]} bundle(s): $same current, $changed stale, $added missing, $extra extra"
  [ $((changed + added)) -eq 0 ] || exit 1
  exit 0
fi
echo "  ${#bundles[@]} bundle(s): $same already current, $changed refreshed, $added added, $extra extra, $failed failed"
[ "$failed" -eq 0 ] || exit 1
exit 0
