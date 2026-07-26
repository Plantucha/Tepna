#!/usr/bin/env bash
# Count the SSE `data:` frames a URL delivers within a time budget.
#
#   sse-frames.sh <url> [seconds] [extra curl args...]
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
# So: buffer the body first, and only then count. curl's exit status is expected to be non-zero and
# is deliberately discarded; the frame count is the evidence, not the exit code.
#
# --compressed is not optional. Browsers always advertise gzip; a plain curl does not, and was
# therefore immune to the gzip-buffering bug this exists to detect.
set -uo pipefail

url="${1:?usage: sse-frames.sh <url> [seconds] [extra curl args...]}"
secs="${2:-9}"
shift
[ $# -gt 0 ] && shift

body="$(timeout "$secs" curl -sN --compressed --max-time "$secs" "$@" "$url" 2>/dev/null)" || true
printf '%s\n' "$body" | grep -c '^data:' || true
