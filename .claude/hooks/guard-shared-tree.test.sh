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
while IFS= read -r c; do [ -n "$c" ] && [ "${c###}" = "$c" ] && chk DENY "$c"; done <<'DENY'
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
git checkout origin/main -- tests/dex-tests.js
git checkout origin/main -- integrator-tch.js oxydex-dsp.js
git checkout HEAD -- ppgdex-dsp.js
git restore --source origin/main -- clock.js
git restore --source=origin/main -- clock.js
git -C . checkout origin/main -- tests/dex-tests.js
git checkout HEAD~1 -- integrator-tch.js
git checkout origin/main -- OverDex.html tests/dex-tests.js
# --- adversarial pass II (2026-08-05). Every line below ALLOWED before this round.
# A · the generated exemption was COMMAND-WIDE: any mention of docs/ or provenance/ anywhere disarmed
#     the whole rule, and a real conflict list here mixes them with source by construction.
git checkout origin/main -- docs/PpgDex.html oxydex-dsp.js
git checkout origin/main -- provenance/PpgDex.json ppgdex-dsp.js
git checkout origin/main -- docs/index.html tests/dex-tests.js
git checkout origin/main -- provenance/../oxydex-dsp.js
echo docs/ ; git checkout origin/main -- oxydex-dsp.js
# B · the ref pattern knew only origin/, HEAD and hex — a plain branch, a remote, @{u} and a tag walked past.
git checkout main -- oxydex-dsp.js
git checkout upstream/main -- oxydex-dsp.js
git checkout @{u} -- oxydex-dsp.js
git checkout v2.4.0 -- oxydex-dsp.js
git restore --source=main -- oxydex-dsp.js
# C · authored non-JS source was not in the extension list. A *.html glob is wrong in the OTHER
#     direction (the bundles are generated), which is why the rule no longer looks at extensions.
git checkout origin/main -- Science.html
git checkout origin/main -- "OxyDex Reference.html"
git checkout origin/main -- capture-host/capture.py
git checkout origin/main -- .github/workflows/ci.yml
git checkout origin/main -- .claude/hooks/guard-shared-tree.sh
# D · a root bundle is generated but INDISTINGUISHABLE in bash from authored Science.html without the
#     builders' list, so it fails closed here; npm run rebase does this restore for you.
git checkout origin/main -- OverDex.html
git checkout origin/main -- "Data Unifier.html"
# E · docs/ is NOT a generated prefix: 30 authored .md live there with no root twin and no builder,
#     and build-docs.mjs filters .md out of its asset list, so a rebuild cannot restore one.
git checkout origin/main -- docs/EVENT-LEXICON.md
git checkout origin/main -- docs/COMPLIANCE/SOUP.md
git checkout origin/main -- docs/OxyDex.html
git checkout origin/main -- docs/OxyDex.html && npm run check
git checkout origin/main -- docs/OxyDex.html
# --- adversarial pass III (2026-08-05). Every line below ALLOWED before this round.
# E · BUNDLED SHORT FLAGS. git bundles them; `-A\b` has no boundary between `A` and a letter, so the
#     `add` rule — the one this file exists for — missed `-Av` while catching `-vA`. Verified against
#     real git: `git add -Av` staged every modification AND every untracked file.
git add -Av
git add -An
git add -uv
# F · THE QUOTED DOT. The header block asserts «`git add "."` must still be caught by the rule above»
#     as the stated reason only the commit rule may strip quotes. It was not caught. Now it is.
git add "."
git add '.'
git checkout -- "."
# G · `git switch` WAS ABSENT FROM THE WHOLE FILE. `switch -f` is `--discard-changes`; verified here to
#     destroy an uncommitted edit exactly as the denied `checkout -f` does.
git switch -f main
git switch --force main
git switch --discard-changes main
# H · GLOBAL OPTIONS $GITX DID NOT KNOW bypass EVERY rule at once, not one. `-P` is the short form of
#     `--no-pager`, which was already handled — the long spelling was caught and the short was not.
git -P add -A
git --no-optional-locks add -A
git --literal-pathspecs add -A
git --icase-pathspecs reset --hard
# I · `push .` REQUIRED THE DOT IMMEDIATELY AFTER `push`. Verified: this form moved a branch ref.
git push --force . HEAD:main
git push --force-with-lease . side:main
# J · THE GENERATED EXEMPTION READ ONLY THE LAST ` -- ` IN THE LINE, so a harmless trailing restore
#     disarmed a destructive leading one. Chaining restores mid-rebase is ordinary, and the bypass
#     widens the more of the conflict list you resolve.
git checkout origin/main -- oxydex-dsp.js; git checkout origin/main -- clock.js && git checkout origin/main -- provenance/OxyDex.json
git checkout origin/main -- oxydex-dsp.js && echo -- docs/x.html
git update-ref --stdin
git update-ref --no-deref refs/heads/main abc
git branch -f main abc
git branch --force main abc
git push . HEAD:main
git symbolic-ref HEAD refs/heads/other
DENY

echo
echo "### MUST DENY — invocation forms that defeated earlier versions"
while IFS= read -r c; do [ -n "$c" ] && [ "${c###}" = "$c" ] && chk DENY "$c"; done <<'DENY2'
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
while IFS= read -r c; do [ -n "$c" ] && [ "${c###}" = "$c" ] && chk allow "$c"; done <<'ALLOW'
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
git checkout origin/main -- provenance/Integrator.json
# The last-` -- `-window read denied this too — it swept `&& npm run check` into the path list. A
# generated-only restore chained with anything is correct and common; the per-segment split allows it
# again. Over-flagging is the safe direction, but not for a command the docs tell you to run.
git add -p oxydex-dsp.js
node tools/rebase-safe.mjs
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
