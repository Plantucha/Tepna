#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-format.test.sh — self-test for guard-format.sh.
#
# Builds a THROWAWAY repo with a real Biome install (symlinked from this checkout)
# and drives the hook exactly as the harness does: the tool-call JSON on stdin.
# Every DENY is paired with an ALLOW differing in ONE property, so a rule that
# fires on everything scores as loudly as one that fires on nothing.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/guard-format.sh"
REPO="$(cd "$(dirname "$H")/../.." && pwd)"
fail=0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
W="$TMP/w"
mkdir -p "$W"
cd "$W"
git init -q .
git config user.email t@t
git config user.name t
cp "$REPO/biome.json" .
ln -s "$REPO/node_modules" node_modules          # the real, pinned Biome

# UGLY is unformatted (Biome reflows it); TIDY is what Biome emits for the same code.
printf 'export const a = {b:1,   c:2};\n' > ugly.js
printf 'export const a = { b: 1, c: 2 };\n' > tidy.js
printf 'not javascript at all\n' > notes.txt
git add tidy.js notes.txt >/dev/null
git commit -qm base

run() { # run <command> ; echoes DENY or ALLOW
  jq -nc --arg c "$1" '{tool_input:{command:$c}}' | bash "$H" >/dev/null 2>&1
  [ $? -eq 2 ] && echo DENY || echo ALLOW
}
expect() { # expect <want> <label> <command>
  local got; got="$(run "$3")"
  if [ "$got" = "$1" ]; then printf '  ok    %-56s %s\n' "$2" "$got"
  else printf '  FAIL  %-56s got %s, want %s\n' "$2" "$got" "$1"; fail=$((fail+1)); fi
}

echo "### the case it exists for"
git add ugly.js >/dev/null
expect DENY  "an unformatted .js is STAGED"                    "git commit -m wip"
expect DENY  "…and through a -C form"                          "git -C . commit -m wip"
expect DENY  "…and when it is not the first word"              "cd /tmp && git commit -m wip"

echo
echo "### the paired ALLOWs — each differs in exactly ONE property"
# Same file, same content, same repo — but NOT staged. Staging is the only difference.
git restore --staged ugly.js >/dev/null 2>&1 || git reset -q HEAD ugly.js
expect ALLOW "the same ugly file is UNSTAGED — not this commit's problem"  "git commit -m wip"
git add tidy.js >/dev/null
expect ALLOW "a staged file that IS formatted"                 "git commit -m ok"
git add notes.txt >/dev/null
expect ALLOW "a staged NON-js file is out of scope"            "git commit -m ok"
# Staged and ugly again — so the ALLOWs below differ only in the COMMAND.
git add ugly.js >/dev/null
expect ALLOW "not a commit at all"                             "git status --short"
expect ALLOW "git commit-tree is not git commit"               "git commit-tree \$TREE -m x"
expect ALLOW "asking for help never commits"                   "git commit --help"

echo
echo "### escape hatch + degenerate inputs"
got="$(jq -nc --arg c 'git commit -m wip' '{tool_input:{command:$c}}' | CLAUDE_ALLOW_UNFORMATTED=1 bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    CLAUDE_ALLOW_UNFORMATTED=1 releases it"
else echo "  FAIL  escape hatch did not release"; fail=$((fail+1)); fi
expect ALLOW "no command in the payload"                       ""
got="$(printf 'not json' | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    malformed payload fails OPEN"
else echo "  FAIL  malformed payload denied"; fail=$((fail+1)); fi

echo
echo "### FAILS OPEN without Biome — the fresh-worktree case that decides usability"
# A worktree has no node_modules (gitignored). A guard that blocked every commit there
# would be switched off within a day, and it guards formatting, not an invariant.
rm node_modules
expect ALLOW "no node_modules ⇒ ALLOW (CI is the backstop)"    "git commit -m wip"
ln -s "$REPO/node_modules" node_modules
expect DENY  "…and it comes straight back when Biome returns"  "git commit -m wip"

echo
echo "### the message names the files AND the fix"
msg="$(jq -nc --arg c 'git commit -m wip' '{tool_input:{command:$c}}' | bash "$H" 2>&1 >/dev/null)"
for want in "ugly.js" "biome format --write" "CLAUDE_ALLOW_UNFORMATTED" "REQUIRED check"; do
  if grep -qF -- "$want" <<<"$msg"; then echo "  ok    message carries '$want'"
  else echo "  FAIL  message missing '$want'"; fail=$((fail+1)); fi
done

echo
echo "### the WIRING — a hook that is not wired is inert, however green its behaviour reads"
S="$REPO/.claude/settings.json"
if [ -f "$S" ]; then
  wired="$(jq -r --arg h guard-format.sh '[.hooks.PreToolUse[]? | select(any(.hooks[]?; .command | test($h))) | .matcher] | join(",")' "$S" 2>/dev/null)"
  case "$wired" in
    *Bash*) echo "  ok    wired for Bash" ;;
    *) echo "  FAIL  not wired for Bash (matchers: '$wired')"; fail=$((fail+1)) ;;
  esac
else
  echo "  FAIL  .claude/settings.json not found at $S"; fail=$((fail+1))
fi

echo
echo "### file integrity"
if [ "$(tail -n1 "$H")" = "exit 2" ]; then echo "  ok    terminal statement is the DENY (exit 2)"
else echo "  FAIL  last line is '$(tail -n1 "$H")', not 'exit 2'"; fail=$((fail+1)); fi
n=$(grep -cE '^[[:space:]]*exit 0[[:space:]]*$' "$H")
if [ "$n" -ne 0 ]; then echo "  FAIL  $n unconditional bare 'exit 0' — everything below is DEAD CODE"; fail=$((fail+1))
else echo "  ok    no unconditional early exit"; fi
bash -n "$H" && echo "  ok    syntax"

echo
[ "$fail" -eq 0 ] && echo "PASS — every DENY paired with an ALLOW that differs in one property" \
                  || echo "FAIL — $fail problem(s)"
exit $((fail > 0))
