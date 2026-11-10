#!/usr/bin/env bash
# tepna-capture — deploy/sse-frames.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# Count the SSE `data:` frames a URL delivers within a time budget.
#
#   sse-frames.sh <url> [seconds] [extra curl args...]
#
# Exit 0 — the stream answered. stdout carries the count, and `0` means an empty stream.
# Exit 3 — no HTTP response arrived. stdout carries NOTHING, and stderr names the reason.
# Exit 4 — the endpoint answered with a non-2xx status. stdout carries NOTHING.
#
# This is a separate, tested file because getting it right is subtler than it looks, and the naive
# version is silently and permanently broken.
#
# An SSE stream never ends, so we cut it off on purpose — which means curl exits 28 (operation
# timeout) on every single successful run. Under `set -o pipefail`, that makes the whole
# `curl | grep -c` pipeline non-zero, so the idiomatic
#
#     N=$(curl ... | grep -c '^data:') || N=0
#
# throws away a perfectly good count and substitutes 0. It cannot report anything else. On
# 2026-07-26 that turned a correctly installed Caddy config into a red "0 frames in 9 s", minutes
# after the very bug it was checking for had been fixed — a check that can only fail is worse than
# no check, because it teaches you to ignore it.
#
# So: buffer the body first, and only then count.
#
# curl's exit status is still NOT discardable. 28 covers the good run, 7 covers a refused
# connection, and a printed `0` reads as "the stream is empty" for both. That reading is the one
# diagnosis the caller acts on, so it cannot stand for a run that reached nothing. CLAUDE.md §∅
# asks a value nobody measured to be null rather than 0, so the two unreached states print no count
# at all and say why on stderr. `%{http_code}` separates a refusal, which never got a status, from
# an endpoint that answered 401 or 502.
#
# --compressed is not optional. Browsers always advertise gzip; a plain curl does not, and was
# therefore immune to the gzip-buffering bug this exists to detect.
set -uo pipefail

url="${1:?usage: sse-frames.sh <url> [seconds] [extra curl args...]}"
secs="${2:-9}"
shift
[ $# -gt 0 ] && shift

# `timeout` is the belt for a curl that ignores its own --max-time, so it must fire LATER than
# --max-time. Firing first, it SIGTERMs curl before curl writes the --write-out line, and a healthy
# stream then reads as "no response". awk computes the slack, because the window may be fractional.
hard="$(awk -v s="$secs" 'BEGIN { printf "%.3f", s + 5 }')"

body="$(mktemp)"
trap 'rm -f "$body"' EXIT

code="$(timeout "$hard" curl -sN --compressed --max-time "$secs" -o "$body" -w '%{http_code}' "$@" "$url" 2>/dev/null)"
rc=$?

if [ -z "$code" ] || [ "$code" = "000" ]; then
  printf 'sse-frames: no HTTP response from %s within %ss (curl exit %s) — nothing counted\n' \
    "$url" "$secs" "$rc" >&2
  exit 3
fi

case "$code" in
  2??) ;;
  *)
    printf 'sse-frames: HTTP %s from %s — nothing counted. A rejected credential lands here too.\n' \
      "$code" "$url" >&2
    exit 4
    ;;
esac

grep -c '^data:' "$body" || true
