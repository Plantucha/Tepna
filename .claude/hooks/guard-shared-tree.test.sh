#!/usr/bin/env bash
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# Matrix for guard-shared-tree.sh.  Run:  bash .claude/hooks/guard-shared-tree.test.sh
#
# WHY THIS FILE EXISTS.  Every defect this guard shipped was invisible to the obvious check:
#   · a rule appended below the terminal `exit 0` — dead code, read as passing
#   · a `re.sub` replacement template that turned \b into a literal backspace, silently killing
#     one alternative of a rule while the other alternatives kept matching
#   · a rewrite that closed an over-broad exemption by making the match too narrow, dropping
#     `stash pop`/`apply`
#   · a rewrite that replaced a 3-form rule with a 1-form rule, dropping `branch -f` and `push .`
# All four read as "allow". None was findable by asking "does it deny the thing I just fixed?".
#
# THE CHECK THAT FINDS THEM is two-directional: compare every case against the PREVIOUS committed
# hook, and fail on any case this version ALLOWS that the old one DENIED. A one-sided matrix is
# how three of the four shipped.
#
# The verdict is JSON on stdout, NOT the exit code — a denied command exits 0. Testing with
# `&& echo ok || echo deny` reports "allow" for every input, including denials.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1
H=.claude/hooks/guard-shared-tree.sh
BASE=$(mktemp); trap 'rm -f "$BASE"' EXIT
git show origin/main:"$H" > "$BASE" 2>/dev/null || cp "$H" "$BASE"

v(){ local o; o=$(jq -Rn --arg c "$1" '{tool_name:"Bash",tool_input:{command:$c}}' | bash "$2" 2>/dev/null)
     [[ "$o" == *'"deny"'* ]] && echo DENY || echo allow; }

fail=0
chk(){ # chk <expected> <command>
  local got; got=$(v "$2" "$H")
  local base; base=$(v "$2" "$BASE")
  local flag=""
  [ "$got" != "$1" ] && { flag=" <-- EXPECTED $1"; fail=$((fail+1)); }
  [ "$got" = allow ] && [ "$base" = DENY ] && { flag="$flag <-- REGRESSION vs origin/main"; fail=$((fail+1)); }
  printf '  %-5s %-5s %s%s\n' "$got" "$base" "$2" "$flag"
}

echo "### MUST DENY                                                 now   main"
while IFS= read -r c; do [ -n "$c" ] && chk DENY "$c"; done <<'DENY'
git add -A
git add .
git add -u
git add -A -- .
git commit -a -m x
git commit -am x
git reset --hard HEAD
git reset --keep HEAD~1
git checkout .
git checkout -f main
git checkout HEAD -- .
git restore --worktree :/
git clean -fd
git stash
git stash push -m wip
git stash pop
git stash apply
git stash list && git stash push -qm wip
git rm -r --cached .
git rm -rf .
git worktree remove --force ../wt-other
git branch -D claude/someone-elses
git update-ref refs/heads/main abc
git update-ref -d refs/heads/main
git update-ref --stdin
git update-ref --no-deref refs/heads/main abc
git branch -f main abc
git branch --force main abc
git push . HEAD:main
git symbolic-ref HEAD refs/heads/other
DENY

echo
echo "### MUST DENY — invocation forms that defeated earlier versions"
while IFS= read -r c; do [ -n "$c" ] && chk DENY "$c"; done <<'DENY2'
bash -c "git add -A"
env git add -A
/usr/bin/git add -A
git -C . add -A
git -C . reset --hard
git -C "/path with spaces" add -A
git --git-dir=.git --work-tree=. add -A
git -c core.pager=cat add -A
git -C /r update-ref refs/heads/main a
git -C /r branch -f main abc
cd /repo && git add -A
if true; then git add -A; fi
for f in a b; do git add -A; done
DENY2
printf '  '; chk DENY "$(printf 'git add \\\n  -A')"

echo
echo "### MUST ALLOW — ordinary work"
while IFS= read -r c; do [ -n "$c" ] && chk allow "$c"; done <<'ALLOW'
git add path/to/file.js
git add -- src/a.js src/b.js
git commit -m "feat: thing"
git commit -m "fix -a flag parsing in the CLI"
git commit -F /tmp/msg.txt
git checkout -b claude/x origin/main
git checkout main
git checkout -- path/file.js
git restore --staged file.js
git reset --soft HEAD~1
git stash list
git stash show -p
git rm path/to/file.js
git rm -r src/olddir
git branch -d claude/old
git branch --list
git worktree add ../wt-y -b claude/y origin/main
git worktree remove ../wt-y
git worktree list
git push origin claude/x
git push --force-with-lease origin claude/x
git fetch origin main:main
git merge --ff-only origin/main
git status --porcelain
git clean -n
git -C ../wt-other status --porcelain
git -c user.email=a@b -c user.name=t commit -m "normal"
ls -l /usr/bin/git
digit add -A
legit add -A
ALLOW

echo
echo "### file integrity"
if grep -qP '[\x00-\x08\x0b\x0c\x0e-\x1f]' "$H"; then
  echo "  FAIL  control character in the hook — a \\b escape was written as a literal backspace,"
  echo "        which silently disables the alternative it sits in"; fail=$((fail+1))
else echo "  ok    no control characters"; fi
n=$(grep -c '^exit 0' "$H")
if [ "$n" -ne 1 ]; then echo "  FAIL  $n terminal 'exit 0' — rules below the first are DEAD CODE"; fail=$((fail+1))
else echo "  ok    exactly one terminal exit"; fi
bash -n "$H" && echo "  ok    syntax"

echo
[ "$fail" -eq 0 ] && echo "PASS — all cases as expected, no regression vs origin/main" \
                  || echo "FAIL — $fail problem(s)"
exit $((fail > 0))
