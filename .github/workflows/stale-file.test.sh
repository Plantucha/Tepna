#!/usr/bin/env bash
# Verify the stale-file check's logic on a constructed collision — the case where git does NOT
# conflict, which is the whole reason the check exists.
set -uo pipefail
rm -rf /tmp/stale-test && mkdir -p /tmp/stale-test && cd /tmp/stale-test || exit 1
git init -q -b main && git config user.email t@t && git config user.name t
mkdir -p briefs
echo original > briefs/X-BRIEF.md; echo idx > DOCS-INDEX.md; echo code > app.js
git add briefs/X-BRIEF.md DOCS-INDEX.md app.js; git commit -qm base

# my branch: append at the END of the brief
git checkout -qb feature
printf 'original\n\nMY EDIT\n' > briefs/X-BRIEF.md
git add briefs/X-BRIEF.md; git commit -qm "my edit"

# main moves: a DIFFERENT part of the same brief, plus unrelated source churn
git checkout -q main
printf 'THEIR ANSWER\noriginal\n' > briefs/X-BRIEF.md
echo code2 > app.js
git add briefs/X-BRIEF.md app.js; git commit -qm "their answer + source churn"
git checkout -q feature

guard() { grep -E '^(briefs/.*\.md|DOCS-INDEX\.md)$' || true; }
run_check() {
  local base; base=$(git merge-base HEAD main)
  git diff --name-only "$base"...HEAD | sort -u > /tmp/mine.txt
  git diff --name-only "$base" main   | sort -u > /tmp/theirs.txt
  guard < /tmp/mine.txt   > /tmp/mg.txt
  guard < /tmp/theirs.txt > /tmp/tg.txt
  comm -12 /tmp/mg.txt /tmp/tg.txt
}

echo "=== CASE A — the collision (PR and main both touched the brief) ==="
echo "  PR guarded  : $(tr '\n' ' ' < /tmp/mine.txt 2>/dev/null)"
A=$(run_check)
echo "  PR guarded  : $(tr '\n' ' ' < /tmp/mg.txt)"
echo "  main guarded: $(tr '\n' ' ' < /tmp/tg.txt)"
echo "  OVERLAP     : '${A}'"
echo "  verdict     : $([ -n "$A" ] && echo 'FAILS (correct)' || echo 'passes (WRONG)')"
git merge --no-commit --no-ff main >/dev/null 2>&1 && M='CLEAN AUTO-MERGE — git would not have caught it' || M='conflict'
git merge --abort 2>/dev/null
echo "  git would   : $M"

echo
echo "=== CASE B — source-only churn on main (must NOT fire) ==="
# Branch from main's TIP so the brief has NOT moved since; then main gets source churn only.
# (The first attempt branched from the original base, where the brief HAD moved — the check was
#  right and the test was wrong. Recorded because a verifier that is wrong in the passing
#  direction is the failure this whole check exists to catch.)
git checkout -q -B feature2 main
printf 'THEIR ANSWER\noriginal\n\nMY SECOND EDIT\n' > briefs/X-BRIEF.md
git add briefs/X-BRIEF.md; git commit -qm "brief edit, no collision"
git checkout -q main; echo code3 > app.js; git add app.js; git commit -qm "source churn only"
git checkout -q feature2
B=$(run_check)
echo "  OVERLAP     : '${B}'"
echo "  verdict     : $([ -z "$B" ] && echo 'passes (correct — source churn is git'"'"'s job)' || echo 'FAILS (WRONG)')"

echo
echo "=== CASE C — already rebased onto main tip (must NOT fire) ==="
git rebase -q main >/dev/null 2>&1
C=$(run_check)
echo "  OVERLAP     : '${C}'"
echo "  verdict     : $([ -z "$C" ] && echo 'passes (correct — nothing moved since the new base)' || echo 'FAILS (WRONG)')"
