#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# hook-test-lib.test.sh — self-test for hook-test-lib.sh.
#
# Each reader is driven against a text it holds and a text it does not, and then against a BROKEN
# `grep` planted on PATH. That last pair is the whole point of the library: `says` must still read
# PRESENT with no working grep at all, and `matches` must report UNEXAMINED rather than ABSENT.
# A reader that folds "could not look" into "not there" is the defect these legs guard.
set -uo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-test-lib.sh"
if [ ! -r "$LIB" ]; then printf '  REFUSE  hook-test-lib.sh is unreadable at %s\n' "$LIB" >&2; exit 2; fi
# The path is a runtime expression, so shellcheck resolves it only under -x.
# shellcheck source=hook-test-lib.sh disable=SC1091
. "$LIB"

fail=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

expect() { # expect <wanted rc> <got rc> <label>
  if [ "$1" = "$2" ]; then printf '  ok    %s\n' "$3"
  else printf '  FAIL  %s — wanted rc %s, got %s\n' "$3" "$1" "$2"; fail=$((fail+1)); fi
}

echo "── says: the literal fragment test ──────────────────────────────────────"
says 'needle' 'a haystack with a needle in it'; expect 0 $? 'says reads PRESENT for a fragment the text holds'
says 'needle' 'a haystack with nothing in it'; expect 1 $? 'says reads ABSENT for a fragment the text lacks'
says 'permissionDecision' ''; expect 1 $? 'an empty text holds no fragment'
# The quotes in the `case` pattern are load-bearing. Unquoted, `a*b` would glob and match `aXXb`.
says 'a*b' 'aXXb'; expect 1 $? "a star in the needle is a character, not a glob"
says 'a*b' 'x a*b y'; expect 0 $? "…and the same needle is found where it is literal"
# 64 KiB is the pipe buffer. A reader built on a pipe can meet SIGPIPE above it; this one has none.
big="$(head -c 200000 /dev/zero | tr '\0' 'x')NEEDLE"
says 'NEEDLE' "$big"; expect 0 $? 'says reads a 200 KB text with no pipe to break'

echo "── matches: the ERE a case glob cannot state ────────────────────────────"
msg="$(printf 'SyntaxError: bad\n    at Module._compile\nbroken.js')"
clean="$(printf 'SyntaxError: bad\n  ^\nbroken.js')"
matches '^[[:space:]]+at ' "$msg" 'broken.js'; expect 0 $? 'matches reads PRESENT for an anchored ERE the text holds'
matches '^[[:space:]]+at ' "$clean" 'broken.js'; expect 1 $? '…and ABSENT when the ERE misses and the canary is there'
# THE CONTROL. The old shape printed ABSENT here, which is how an empty capture passed as a pass.
matches '^[[:space:]]+at ' '' 'broken.js'; expect 2 $? 'THE DEFECT: no canary means UNEXAMINED, never ABSENT'
matches '^[[:space:]]+at ' "$clean" 'some-other-file.js'; expect 2 $? 'a text that is not the text we meant is UNEXAMINED'
matches 'NEEDLE$' "$big" 'xxx'; expect 0 $? 'matches reads a 200 KB text through a here-string, not a pipe'

echo "── the planted broken grep: a reader that cannot look ───────────────────"
# `grep` exits 2 on a real error — an unreadable file, a bad regex, a signal. Both readers meet
# that here, and only one of them is allowed to keep answering.
printf '#!/bin/sh\nexit 2\n' > "$TMP/grep"
chmod +x "$TMP/grep"
(
  PATH="$TMP:$PATH"
  export PATH
  says 'needle' 'a haystack with a needle in it'; r=$?
  if [ "$r" = 0 ]; then printf '  ok    %s\n' 'says still reads PRESENT with no working grep on PATH'; else printf '  FAIL  says broke with grep broken — it is meant to use no subprocess (rc %s)\n' "$r"; exit 1; fi
  matches 'needle' 'a haystack with a needle in it' 'haystack'; r=$?
  if [ "$r" = 2 ]; then printf '  ok    %s\n' 'matches reports UNEXAMINED when grep cannot run'; else printf '  FAIL  matches read rc %s from a grep that could not look\n' "$r"; exit 1; fi
) || fail=$((fail+1))

if [ "$fail" = 0 ]; then echo "✓ hook-test-lib: every leg passes"; exit 0; fi
printf '✗ hook-test-lib: %s leg(s) FAILED\n' "$fail"; exit 1
