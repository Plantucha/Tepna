#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-stale-brief.test.sh — self-test for guard-stale-brief.sh.
#
# Builds a THROWAWAY repo with a real divergence (a brief advanced on `origin/main`
# that a branch does not have) and drives the hook exactly as the harness does: the
# tool-call JSON on stdin. A guard nobody has watched fail is not a guard — every
# DENY case below is paired with an ALLOW case that differs in ONE property, so a
# rule that fires on everything scores as loudly as one that fires on nothing.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/guard-stale-brief.sh"
fail=0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── a repo where origin/main has a brief commit the working branch lacks ────────
UP="$TMP/upstream"; WORK="$TMP/work"
git init -q --bare "$UP"
git clone -q "$UP" "$WORK" 2>/dev/null
cd "$WORK"
git config user.email t@t; git config user.name t
mkdir -p briefs tools
printf 'v1\n' > briefs/SHARED-BRIEF.md
printf 'v1\n' > briefs/OTHER-BRIEF.md
printf 'v1\n' > DOCS-INDEX.md
printf 'v1\n' > README.md
git add -A >/dev/null; git commit -qm base
git branch -M main; git push -q origin main 2>/dev/null

# my branch, based here
git checkout -qb mine
# …meanwhile main advances, touching ONLY SHARED-BRIEF.md + DOCS-INDEX.md
git checkout -q main
printf 'v2 — a concurrent session answered §2 here\n' > briefs/SHARED-BRIEF.md
printf 'v2\n' > DOCS-INDEX.md
# README + briefs/notes.txt + docs/briefs/x.md ALSO move, so the "not in the guarded set"
# ALLOWs below differ from the DENYs in the guarded-set membership ALONE. Without this the
# fixture is a tautology: every out-of-set file was also an unmoved file, and a mutant that
# dropped the set check entirely still scored green (measured — it survived M1).
printf 'v2\n' > README.md
mkdir -p docs/briefs
printf 'v2\n' > briefs/notes.txt
printf 'v2\n' > docs/briefs/x.md
git add -A >/dev/null
git commit -qm 'concurrent: answer §2'
git push -q origin main 2>/dev/null
git checkout -q mine
git fetch -q origin main 2>/dev/null

run() { # run <file_path> ; echoes DENY or ALLOW
  printf '{"tool_input":{"file_path":"%s"}}' "$1" | bash "$H" >/dev/null 2>&1
  [ $? -eq 2 ] && echo DENY || echo ALLOW
}
expect() { # expect <want> <label> <file>
  local got; got="$(run "$3")"
  if [ "$got" = "$1" ]; then printf '  ok    %-58s %s\n' "$2" "$got"
  else printf '  FAIL  %-58s got %s, want %s\n' "$2" "$got" "$1"; fail=$((fail+1)); fi
}

echo "### the divergence it exists to catch"
expect DENY  "brief advanced on origin/main, branch has not"        "briefs/SHARED-BRIEF.md"
expect DENY  "…absolute path resolves to the same rule"             "$WORK/briefs/SHARED-BRIEF.md"
expect DENY  "DOCS-INDEX.md is guarded for the same reason"         "DOCS-INDEX.md"

echo
echo "### the paired ALLOWs — each differs in exactly ONE property"
# same directory, same extension, same branch state — but NOT advanced upstream.
expect ALLOW "a brief that did NOT move upstream"                   "briefs/OTHER-BRIEF.md"
# advanced upstream, but not in the guarded set.
expect ALLOW "README moved upstream too — but is out of the set"    "README.md"
expect ALLOW "briefs/ non-markdown moved too — still not a brief"   "briefs/notes.txt"
expect ALLOW "docs/briefs/ moved too — 'briefs/' must ANCHOR"      "docs/briefs/x.md"

echo
echo "### escape hatch + degenerate inputs"
got="$(printf '{"tool_input":{"file_path":"briefs/SHARED-BRIEF.md"}}' | CLAUDE_ALLOW_STALE_BRIEF=1 bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    CLAUDE_ALLOW_STALE_BRIEF=1 releases it"
else echo "  FAIL  escape hatch did not release"; fail=$((fail+1)); fi
expect ALLOW "no file_path in the payload"                          ""
got="$(printf 'not json' | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    malformed payload fails OPEN, never blocks blindly"
else echo "  FAIL  malformed payload denied"; fail=$((fail+1)); fi

echo
echo "### fails OPEN outside a repo (a git hiccup must not block all doc edits)"
mkdir -p "$TMP/norepo/briefs"; printf 'x\n' > "$TMP/norepo/briefs/A.md"
got="$(cd "$TMP/norepo" && printf '{"tool_input":{"file_path":"briefs/A.md"}}' | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    no git repo ⇒ ALLOW"
else echo "  FAIL  denied outside a repo"; fail=$((fail+1)); fi
# a repo with no origin/main at all
R2="$TMP/noremote"; mkdir -p "$R2/briefs"; (cd "$R2" && git init -q . && git config user.email t@t && git config user.name t && printf 'x\n' > briefs/A.md && git add -A >/dev/null && git commit -qm x)
got="$(cd "$R2" && printf '{"tool_input":{"file_path":"briefs/A.md"}}' | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    no origin/main ⇒ ALLOW"
else echo "  FAIL  denied with no origin/main"; fail=$((fail+1)); fi

echo
echo "### the message names the commits (a bare refusal teaches nothing)"
msg="$(cd "$WORK" && printf '{"tool_input":{"file_path":"briefs/SHARED-BRIEF.md"}}' | bash "$H" 2>&1 >/dev/null)"
for want in "answer §2" "rebase-safe" "CLAUDE_ALLOW_STALE_BRIEF" "git log -p"; do
  if grep -qF -- "$want" <<<"$msg"; then echo "  ok    message carries '$want'"
  else echo "  FAIL  message missing '$want'"; fail=$((fail+1)); fi
done

echo
echo "### file integrity"
if grep -qP '[\x00-\x08\x0b\x0c\x0e-\x1f]' "$H"; then
  echo "  FAIL  control character in the hook"; fail=$((fail+1))
else echo "  ok    no control characters"; fi
# This hook INVERTS the sibling's shape: every ALLOW leaves early via `… || exit 0`, so the
# terminal statement is the DENY. The dead-code hazard is therefore an UNCONDITIONAL bare
# `exit 0` on its own line — one of those short-circuits the guard into a no-op while every
# behavioural case above still reads green, because the harness only sees "not 2".
if [ "$(tail -n1 "$H")" = "exit 2" ]; then echo "  ok    terminal statement is the DENY (exit 2)"
else echo "  FAIL  last line is '$(tail -n1 "$H")', not 'exit 2' — the guard may fall through to ALLOW"; fail=$((fail+1)); fi
n=$(grep -cE '^[[:space:]]*exit 0[[:space:]]*$' "$H")
if [ "$n" -ne 0 ]; then echo "  FAIL  $n unconditional bare 'exit 0' — everything below it is DEAD CODE"; fail=$((fail+1))
else echo "  ok    no unconditional early exit (every ALLOW is guarded by a condition)"; fi
bash -n "$H" && echo "  ok    syntax"

echo
[ "$fail" -eq 0 ] && echo "PASS — every DENY paired with an ALLOW that differs in one property" \
                  || echo "FAIL — $fail problem(s)"
exit $((fail > 0))
