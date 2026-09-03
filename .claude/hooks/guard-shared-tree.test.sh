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
# `#` lines are commentary on WHY a case exists, not cases. Without this the harness runs them as
# commands, they are allowed, and each one reads as a failure — which is how a genuine 9-case
# addition first reported 11 problems.
while IFS= read -r c; do [ -n "$c" ] && [[ "$c" != \#* ]] && chk DENY "$c"; done <<'DENY'
git add -A
git add .
git add -u
git add -A -- .
git commit -a -m x
git commit -am x

# ── the temp-index exemption must not become a bypass (2026-08-16) ───────────────────────────────
# The rescue recipe's SHAPE aimed at the repo's own index is ordinary blanket staging, and a
# commit is never exempt however the index is spelled.
GIT_INDEX_FILE=.git/index git add -A
GIT_INDEX_FILE=./.git/index git add -A
GIT_INDEX_FILE=/tmp/r.idx git commit -a -m x

# ── source-checkout rule, adversarial pass 2026-08-05 ────────────────────────────────────────────
# Each of these was ALLOWED before the fix. Every one is the ACCIDENTAL form: the shape a person or
# agent actually types mid-rebase, not an evasion.
#
# 1 · The extension list omitted .py and .sh — i.e. every line of capture-host/, the largest body of
#     source here, plus its deploy scripts. A Python source revert was invisible to the guard.
git checkout origin/main -- capture-host/writers.py
# 6 · A BARE DIRECTORY HAS NO EXTENSION (2026-09-03). The extraction keyed on a file extension, so the
#     NARROW form denied and the WIDE one — which restores every file in the directory, including every
#     other session's in-flight work — was allowed. Found after a session ran exactly this in the shared
#     root and staged 78 briefs into the root's index.
git checkout origin/main -- briefs
git checkout origin/main -- briefs/
git --work-tree=/tmp/t checkout origin/main -- briefs
git checkout origin/main -- audits
git checkout origin/main -- capture-host
git restore --source=origin/main -- tools
#     provenance is deliberately NOT exempt as a directory: restoring it wholesale discards
#     verifiedUnder stamps that only a corpus run can re-earn, which is worse than a rebuild.
git checkout origin/main -- provenance
# --- adversarial round 2 (2026-08-05). Each line ALLOWED on main @2e82c29c.
# a traversing path inherited the generated-prefix exemption: #990 fixed the CLASSIFIER, not the hook
git checkout origin/main -- provenance/../oxydex-dsp.js
# the ref clause knew only origin/, HEAD and hex — a plain branch, a remote, @{u} and a tag walked past
git checkout main -- oxydex-dsp.js
git checkout upstream/main -- oxydex-dsp.js
git checkout @{u} -- oxydex-dsp.js
git checkout v2.4.0 -- oxydex-dsp.js
git restore --source=main -- oxydex-dsp.js
git checkout origin/main -- capture-host/vigil.sh
git checkout origin/main -- capture-host/pyproject.toml
git restore --source=origin/main -- capture-host/tests/test_writers.py
# 2 · The path had to end in whitespace or EOL, so a QUOTED path slipped past — and a quoted path is
#     how anyone writes one containing a space, which this repo ships ("Data Unifier.html").
git checkout origin/main -- "clock.js"
git checkout origin/main -- 'clock.js'
# 3 · The docs//provenance/ exemption was COMMAND-WIDE: one generated path anywhere in the argument
#     list disabled the rule for the source files beside it. A real conflict list mixes the two,
#     which is the entire reason this rule exists.
git checkout origin/main -- clock.js docs/index.html
git checkout origin/main -- provenance/OxyDex.json capture-host/writers.py
git -C /tmp/wt-x checkout origin/main -- clock.js docs/OxyDex.html
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
git update-ref --stdin
git update-ref --no-deref refs/heads/main abc
git branch -f main abc
git branch --force main abc
git push . HEAD:main
git symbolic-ref HEAD refs/heads/other

# ── source-checkout rule, adversarial pass 2 (2026-08-05) ────────────────────────────────────────
# The rule extracted a path TOKEN from the command, so it could only see spellings that print one.
# It therefore stayed silent on its OWN worked example — the line CLAUDE.md §2c prints verbatim and
# calls hook-denied, and the line that actually dropped a test group, a DSP fix and a provenance
# entry. Measured against origin/main before this fix: ALLOWED. Documentation promised a guarantee
# the guard did not implement, which is worse than no guard: it is a guard people rely on.
#
# 5 · The path list is COMPUTED, so no token exists. Unknowable ⇒ SOURCE, matching the rule
#     tools/rebase-safe.mjs already uses (classify() fails closed on anything it cannot place).
git checkout origin/main -- $(git diff --name-only --diff-filter=U)
git restore --source=origin/main -- $(git diff --name-only --diff-filter=U)
git checkout origin/main -- `git diff --name-only --diff-filter=U`
git diff --name-only --diff-filter=U | xargs git checkout origin/main --
# 6 · --ours/--theirs NAME NO REF, so the ref clause never fired — yet taking one side wholesale IS
#     the destructive operation, and for tests/dex-tests.js it is the specifically wrong answer.
#     The clause had been written from the shape of the command that caused the incident rather
#     than from the operation the rule exists to refuse.
git checkout --ours -- tests/dex-tests.js
git checkout --theirs -- oxydex-dsp.js
git checkout --theirs oxydex-dsp.js
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
echo
echo "### INTENTIONALLY RELAXED — main DENIES these, and that was the bug        now   main"
# The one-way ratchet above ("never allow what main denied") is the right default and caught three
# shipped defects. But it cannot express a deliberate loosening, and an over-block is a real defect
# too: people route around a guard that refuses ordinary work, and then it protects nothing. So a
# relaxation is allowed HERE ONLY, one line at a time, each with the reason it is not a regression.
# The bar is that the command must be provably outside the rule's stated purpose — not merely
# inconvenient.
# ⚠ THE ONLY ASSERTION HERE IS `allow`. The first version also FAILED when main allowed the case
# too, reasoning that a relaxation main already permits is not a relaxation and belongs in MUST
# ALLOW. That is true on the branch and false one second after it merges: `$BASE` is origin/main, so
# the moment the loosening lands, base and H agree and the check fires forever. It did — `npm run
# check` went red on main for every session the moment #991 merged, and the PR that introduced it was
# green when it was measured, because it was measured against the main that predated it.
# A case whose expectation flips on merge is not a test, it is a fuse. The base column stays, printed
# for information: DENY means the loosening has not landed yet, allow means it has.
relaxed(){ local got; got=$(v "$1" "$H"); local base; base=$(v "$1" "$BASE")
  [ "$got" != allow ] && { fail=$((fail+1)); printf '  %-5s %-5s %s <-- EXPECTED allow\n' "$got" "$base" "$1"; return; }
  printf '  %-5s %-5s %s\n' "$got" "$base" "$1"; }
# NOTE (2026-08-05): the `relaxed` assertion for
#     git checkout -b claude/x origin/main && bash .claude/hooks/guard-shared-tree.test.sh
# was SELF-INVALIDATING and had been failing on main ever since #991. `relaxed` requires that the
# BASE (origin/main) still DENIES the command — but #991 both added the assertion and shipped the fix,
# so the moment it merged, main allowed it too and the assertion could no longer hold. It was true
# only against pre-#991 main. The behaviour is now main's own, so the case belongs in MUST ALLOW,
# which is exactly what the failure message said; moved there. `relaxed` itself is kept for the next
# genuine, one-line loosening.

echo
echo "### MUST DENY — the three classes still open after the 2026-08-05 pass (measured against main)"
# Re-probed 2026-08-08 against the merged guard: of eight bypasses found on 08-05, five were closed
# (command substitution, local-branch/tag/short-hash refs, the -s form). These three were not. Each is
# listed with several paths, so a green line is a CLASS and not one lucky filename.
#
# CLASS 2 is the sharpest, because the guard and the tool it points at disagreed about the same path:
# `rebase-safe.mjs --classify docs/LEXICON.md` says SOURCE (fixed by #990), while the hook exempted all
# of docs/ and so permitted the hand-rolled checkout that reverts it — the very file that was silently
# reverted on 2026-08-05.
while IFS= read -r c; do [ -n "$c" ] && [[ "$c" != \#* ]] && chk DENY "$c"; done <<'DENY3'
# 1 · authored *.html at the repo root — the list carried src.html but not html
git checkout origin/main -- Science.html
git checkout origin/main -- index.html
git checkout origin/main -- "OxyDex Reference.html"
git checkout origin/main -- "CPAPDex Reference.html"
git checkout origin/main -- Science.html OverDex.html
# 2 · AUTHORED specs under docs/ — everything else under docs/ stays exempt
git checkout origin/main -- docs/LEXICON.md
git checkout origin/main -- docs/EVENT-LEXICON.md
git checkout origin/main -- docs/EXPORT-SHAPES.md
git checkout origin/main -- docs/COMPLIANCE/SOUP-LIST.md
git checkout origin/main -- docs/OxyDex.html docs/LEXICON.md
DENY3
# 3 · blanket staging by glob. These go through chk directly rather than a heredoc: the add rule
# matches $cmdn RAW (deliberately — so `bash -c "git add -A"` cannot hide), which means a heredoc
# listing the glob denies the very command that writes this matrix. Noted rather than worked around.
chk DENY 'git add *'
chk DENY "git add '*'"
chk DENY 'git add ./*'

echo
echo "### MUST ALLOW — ordinary work"
while IFS= read -r c; do [ -n "$c" ] && [[ "$c" != \#* ]] && chk allow "$c"; done <<'ALLOW'
# creating a BRANCH is not a ref-checkout of a path; main allows it too, it was mis-filed as DENY
git checkout -b claude/x origin/main && bash .claude/hooks/guard-shared-tree.test.sh
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
git checkout origin/main -- OverDex.html
git checkout origin/main -- "Data Unifier.html"
git checkout origin/main -- provenance/Integrator.json
git checkout origin/main -- docs/OxyDex.html
git checkout origin/main -- docs/dex-badges.css
git checkout origin/main -- docs/sitemap.xml
git checkout origin/main -- OxyDex.html
git checkout origin/main -- Integrator.html MotionDex.html
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
# generated-only argument lists stay allowed — that is the whole point of the distinction, and a
# tightened rule that also blocks these would push people back to the hand-rolled form.
git checkout origin/main -- docs/index.html
git checkout origin/main -- provenance/OxyDex.json
git checkout origin/main -- docs/OxyDex.html provenance/OxyDex.json
# The paths were read from the WHOLE command, not from the checkout's own segment, so any unrelated
# source-looking token in a `&&`-joined step supplied the "source path" for a checkout that touched
# none. Over-blocking is the safe direction, but it fires on ordinary compound commands: this exact
# shape — make a branch, then run a harness — was refused three times in a row while developing the
# cases above. A guard that blocks routine work is a guard people learn to route around.
git switch -c claude/x2 origin/main
node tools/rebase-safe.mjs && npm run check
# `--ours`/`--theirs` on a GENERATED path is still the correct move: neither side is authoritative
# and the rebuild settles it. The new clause must not swallow that.
git checkout --ours -- docs/OxyDex.html
npm run rebase
ALLOW

echo
echo "### DELIBERATE RELAXATIONS — this version MUST allow these; the main column is information"
# CLAUDE.md §👥.2's OWN RESCUE RECIPE, which this guard used to deny (2026-08-16).
# A blanket add into a SEPARATE index writes a throwaway file: it touches no working-tree file and
# not the repo's index, so none of the damage the blanket-add rule prevents is reachable. Denying it
# made the documented procedure for PRESERVING another session's uncommitted work unexecutable —
# and the escape hatch is for "when the tree is genuinely yours alone", precisely when no rescue is
# needed. Measured that day: a peer could snapshot one file by explicit path and could not snapshot
# the 188-file shared tree at all.
while IFS= read -r c; do [ -n "$c" ] && [[ "$c" != \#* ]] && relaxed "$c"; done <<'RELAX'
GIT_INDEX_FILE=/tmp/r.idx git add -A
GIT_INDEX_FILE=/tmp/r.idx sh -c 'git add -A; git write-tree'
cp .git/index /tmp/r.idx && GIT_INDEX_FILE=/tmp/r.idx git add -A && GIT_INDEX_FILE=/tmp/r.idx git write-tree
RELAX


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
