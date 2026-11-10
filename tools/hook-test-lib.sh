#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# hook-test-lib.sh — the needle readers the hook self-tests share. SOURCE it, never run it.
#
# ── THE READER MUST NOT BE ABLE TO FAIL TO LOOK ─────────────────────────────────
# Rows 2026-11-09-guard-selftest-reads-a-failed-reader-as-an-absent-needle and
# 2026-11-09-four-selftest-legs-print-ok-when-their-reader-fails-to-look. A leg whose PASS is an
# ABSENCE used to pipe its captured text into `grep -q` and read PRESENT from exit 0, ABSENT from
# anything else. That reads three states as one word: a reader that exited 2 because it could not
# run, a reader killed by a signal, and a needle that is honestly absent. In `guard-stale-brief`'s
# classifier two FAILED reads agreed, so it printed STABLE-TEXT and sent the reader at their own
# diff. The fix is not a third verdict for a reader that could not look.
#
# `says` keeps no reader that can fail. A `case` pattern with the needle QUOTED is a literal
# fragment test in the shell itself: no subprocess, no exit status to collapse, and no pipe to meet
# SIGPIPE on a text over the 64 KiB buffer. The quotes are load-bearing — unquoted, a `*` in a
# needle globs.
#
# `matches` carries a needle a `case` glob cannot state: an ERE, a per-line anchor, a character
# class. It cannot avoid grep, so it reports the third state rather than folding it into ABSENT. It
# reads ABSENT only from grep's own exit 1 AND a canary literal the text must carry; everything
# else is UNEXAMINED, which a leg must print as a FAIL. The here-string is load-bearing too:
# `printf … | grep -q` makes printf meet SIGPIPE when grep exits early on a match, and `pipefail`
# then reports 141 about a text that MATCHED.

says() { # says <needle> <text> ; 0 = PRESENT, 1 = ABSENT. It cannot report a third thing.
  case "$2" in *"$1"*) return 0 ;; *) return 1 ;; esac
}

matches() { # matches <ere> <text> <canary literal> ; 0 = PRESENT · 1 = ABSENT · 2 = UNEXAMINED
  local _rc=0
  grep -qE "$1" <<<"$2" || _rc=$?
  if [ "$_rc" -eq 0 ]; then return 0; fi
  if [ "$_rc" -eq 1 ] && says "$3" "$2"; then return 1; fi
  return 2
}
