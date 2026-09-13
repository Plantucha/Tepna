#!/usr/bin/env bash
# tools/nsrr-fetch.sh — Tepna
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the project root.
# ═════════════════════════════════════════════════════════════════════════════
# Fetch an NSRR signal set in N parallel streams. Resumable, idempotent, safe to re-run.
#
# ⚠️ THIS IS NOT PART OF THE SUITE'S RUNTIME AND NOTHING CALLS IT. Tepna never fetches: no bundle, no
# gate, no CI job reaches the network, and that is enforced by `no-network.html`. Obtaining a corpus is
# the OWNER'S act, performed deliberately, outside the repo's execution paths — this script exists so
# that act is reproducible and documented rather than reconstructed from shell history each time.
# It needs a token the repo does not hold and will never hold.
#
# WHY: NSRR throttles PER CONNECTION, not per account. Measured 2026-09-13 in a paired test over equal
# 120 s windows: one stream 0.67 MB/s; three streams 1.47 MB/s aggregate (2.2x), with the original
# stream NOT degrading. That last part is the load-bearing observation — extra connections add
# throughput rather than dividing it.
#
# ⚠️ The single-stream rate varies ~2x on its own (0.67-1.53 MB/s observed), so the 2.2x figure carries
# real uncertainty from one paired run. Treat it as "parallelism helps", not as a precise multiplier.
#
# ⚠️ N is deliberately modest. This is someone else's server and a signed-DUA resource; 4 streams is
# neighbourly, 32 would be abuse and would likely get rate-limited or blocked anyway.
#
# RESUMABLE: every worker skips ids already present on disk, so re-running costs nothing and an
# interrupted run continues where it stopped. Safe to run alongside or after the sequential download.
set -uo pipefail

N=${N:-4}
DEST=${DEST:-/mnt/synology/nsrr-shhs1}
IDSRC=${IDSRC:-/srv/data/shhs/polysomnography/annotations-events-nsrr/shhs1}
NSRR=${NSRR:-$HOME/.local/share/gem/ruby/3.3.0/bin/nsrr}
TOKEN_FILE=${TOKEN_FILE:-$HOME/.nsrr_token}
EDFDIR="$DEST/shhs/polysomnography/edfs/shhs1"

[ -s "$TOKEN_FILE" ] || { echo "no token at $TOKEN_FILE"; exit 2; }
[ -x "$NSRR" ] || { echo "nsrr not executable at $NSRR"; exit 2; }
[ -d "$IDSRC" ] || { echo "no annotation dir at $IDSRC — needed for the id list"; exit 2; }
mkdir -p "$DEST" "$EDFDIR"

# The id list comes from the ANNOTATIONS, which are complete (5136) and local. Deriving it from the
# EDF directory would be circular — that is the set we are trying to fill.
mapfile -t ALL < <(ls "$IDSRC" | sed 's/-nsrr\.xml$//' | sort -u)
# Count .edf files without `ls | grep` (SC2010): a glob is correct for any filename, and an unmatched
# glob under `nullglob` yields an empty array rather than the literal pattern.
# ── A FILE THAT EXISTS IS NOT A FILE THAT IS COMPLETE ────────────────────────────────────────
# The skip test was `[ -s file ]` — exists and non-empty. A truncated EDF left by a killed worker
# passes that and is then skipped FOREVER, silently, surfacing only when something downstream reads a
# night mysteriously missing its last hours. That scenario is not hypothetical: a careless `pkill -f`
# stalled every worker during this corpus fetch.
#
# An EDF declares its own size, so completeness is checkable without a manifest or a checksum:
#   header = 256 + ns*256      (ns at bytes 252-255)
#   data   = nDataRecords * sum(samples per record) * 2
# Samples-per-record live at 256 + 216*ns, eight ASCII bytes each.
#
# Verified against this corpus: 4928 of 4928 complete, 0 short, 0 unreadable — so the guard costs
# nothing on a healthy tree and is the only thing standing between an interrupted run and a corpus
# with a permanent hole in it.
edf_complete() {
  local f=$1 ns nrec hdr per want actual i off v
  [ -s "$f" ] || return 1
  actual=$(stat -c%s "$f" 2>/dev/null) || return 1
  nrec=$(dd if="$f" bs=1 skip=236 count=8 2>/dev/null | tr -d ' ')
  ns=$(dd if="$f" bs=1 skip=252 count=4 2>/dev/null | tr -d ' ')
  [[ "$nrec" =~ ^[0-9]+$ && "$ns" =~ ^[0-9]+$ ]] || return 1
  [ "$ns" -ge 1 ] && [ "$nrec" -ge 1 ] || return 1
  hdr=$(( 256 + ns * 256 ))
  [ "$actual" -ge "$hdr" ] || return 1
  per=0; off=$(( 256 + 216 * ns ))
  for ((i=0; i<ns; i++)); do
    v=$(dd if="$f" bs=1 skip=$(( off + i*8 )) count=8 2>/dev/null | tr -d ' ')
    [[ "$v" =~ ^[0-9]+$ ]] || return 1
    per=$(( per + v ))
  done
  want=$(( hdr + nrec * per * 2 ))
  [ "$actual" -eq "$want" ]
}

count_edf() {
  local -a f=()
  shopt -s nullglob
  f=("$EDFDIR"/*.edf)
  shopt -u nullglob
  printf '%s' "${#f[@]}"
}

echo "ids in cohort: ${#ALL[@]}   already on disk: $(count_edf)   streams: $N"

worker() {
  local k=$1 got=0 skip=0 fail=0 i=0 id
  for id in "${ALL[@]}"; do
    i=$((i+1))
    [ $(( (i-1) % N )) -eq "$k" ] || continue
    if edf_complete "$EDFDIR/$id.edf"; then skip=$((skip+1)); continue; fi
    # present but INCOMPLETE: remove it so the fetch below is a clean retry rather than a no-op
    if [ -e "$EDFDIR/$id.edf" ]; then
      echo "re-fetching incomplete $id.edf" >> "$DEST/shard.log"
      rm -f "$EDFDIR/$id.edf"
    fi
    if "$NSRR" download "shhs/polysomnography/edfs/shhs1/$id.edf" \
         --token="$(cat "$TOKEN_FILE")" >/dev/null 2>&1; then got=$((got+1))
    else fail=$((fail+1)); fi
    # a tiny pause keeps this from looking like a hammer if a file 404s instantly
    sleep 0.2
  done
  echo "worker $k done: $got downloaded, $skip already present, $fail failed" >> "$DEST/shard.log"
}

cd "$DEST" || exit 2
: > "$DEST/shard.log"
for ((k=0; k<N; k++)); do worker "$k" & done
wait
echo "ALL WORKERS EXITED  files=$(count_edf)/${#ALL[@]}" >> "$DEST/shard.log"
echo "EXIT=0" >> "$DEST/shard.log"
