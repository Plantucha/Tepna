#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-doc-search.test.sh — self-test for guard-doc-search.sh.
#
# Builds a THROWAWAY repo (main checkout + one linked worktree, sharing a common dir), plants
# an index and session stamps into ITS state dir, and drives the hook exactly as the harness
# does: the tool-call JSON on stdin. Every DENY is paired with an ALLOW that differs in ONE
# property — index present/absent, stamp present/absent/stale, session id present/absent,
# path inside/outside the repo, hatch set/unset — so a rule that fires on everything scores as
# loudly as one that fires on nothing.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/guard-doc-search.sh"
fail=0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

REPO="$TMP/repo"; WT="$TMP/wt"; OUT="$TMP/outside"
mkdir -p "$OUT"
git init -q "$REPO"
cd "$REPO" || exit 1
git config user.email t@t; git config user.name t
mkdir -p tools capture-host briefs
printf 'x\n' > tools/a.mjs; printf 'x\n' > capture-host/b.py; printf 'x\n' > briefs/C-BRIEF.md
git add -A >/dev/null; git commit -qm base
git worktree add -q "$WT" -b wt HEAD 2>/dev/null
STATE="$REPO/.git/tepna-mutation"
mkdir -p "$STATE/doc-search-sessions"
SID="11111111-2222-3333-4444-555555555555"

run() { # run <file_path> [session_id] ; echoes DENY or ALLOW
  local f="$1" sid="${2-$SID}" js
  if [ -n "$sid" ]; then js="$(printf '{"session_id":"%s","tool_input":{"file_path":"%s"}}' "$sid" "$f")"
  else js="$(printf '{"tool_input":{"file_path":"%s"}}' "$f")"; fi
  printf '%s' "$js" | env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_ALLOW_NO_DOC_SEARCH bash "$H" >/dev/null 2>&1
  [ $? -eq 2 ] && echo DENY || echo ALLOW
}
expect() { # expect <want> <label> <file> [sid]
  local got; got="$(run "$3" "${4-$SID}")"
  if [ "$got" = "$1" ]; then echo "  ✓ $2"; else echo "  ✗ $2 — wanted $1, got $got"; fail=1; fi
}
check() { # check <want> <got> <label>
  if [ "$2" = "$1" ]; then echo "  ✓ $3"; else echo "  ✗ $3 — wanted $1, got $2"; fail=1; fi
}
expect_nosid() { local got; got="$(run "$3" "")"; if [ "$got" = "$1" ]; then echo "  ✓ $2"; else echo "  ✗ $2 — wanted $1, got $got"; fail=1; fi; }

echo "guard-doc-search: no index on this machine (the non-rig case)"
expect ALLOW "no index ⇒ allow, even with no stamp" "$REPO/tools/a.mjs"

echo "guard-doc-search: index present, no stamp"
printf '{}' > "$STATE/doc-search-index.json"
expect DENY  "source edit in the main checkout"                 "$REPO/tools/a.mjs"
expect DENY  "…and in a linked worktree (same common dir)"       "$WT/capture-host/b.py"
expect DENY  "…and a brief"                                      "$REPO/briefs/C-BRIEF.md"
expect DENY  "…and a NEW file in an existing repo dir (Write)"   "$WT/tools/new.mjs"
expect ALLOW "a file OUTSIDE any repo"                           "$OUT/notes.md"
expect ALLOW "a file whose directory does not exist yet"         "$REPO/no/such/dir/x.js"
expect_nosid ALLOW "no session id in the payload (a human, not a session)" "$REPO/tools/a.mjs"
expect ALLOW "a session id that is not a filename"               "$REPO/tools/a.mjs" "../etc"
OTHER="99999999-0000-0000-0000-000000000000"
: > "$STATE/doc-search-sessions/$OTHER"
expect ALLOW "the stamped session is allowed"                     "$REPO/tools/a.mjs" "$OTHER"
expect DENY  "…a DIFFERENT session's stamp does not vouch for ours" "$REPO/tools/a.mjs"

echo "guard-doc-search: stamp present"
printf '2026-09-12T00:00:00Z\tq\n' > "$STATE/doc-search-sessions/$SID"
expect ALLOW "fresh stamp ⇒ allow (main checkout)"               "$REPO/tools/a.mjs"
expect ALLOW "fresh stamp ⇒ allow (worktree)"                    "$WT/capture-host/b.py"
touch -d '4 hours ago' "$STATE/doc-search-sessions/$SID"
expect DENY  "stale stamp (4 h > 3 h) ⇒ deny"                    "$REPO/tools/a.mjs"
got="$(printf '{"session_id":"%s","tool_input":{"file_path":"%s"}}' "$SID" "$REPO/tools/a.mjs" | DOC_SEARCH_MAX_AGE_S=99999 bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
check ALLOW "$got" "…the age limit is the deciding property (raised ⇒ allow)"
touch "$STATE/doc-search-sessions/$SID"
expect ALLOW "…re-touched ⇒ allow again"                         "$REPO/tools/a.mjs"

echo "guard-doc-search: session id from the ENVIRONMENT when the payload carries none"
rm -f "$STATE/doc-search-sessions/$SID"
got="$(printf '{"tool_input":{"file_path":"%s"}}' "$REPO/tools/a.mjs" | CLAUDE_CODE_SESSION_ID="$SID" bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
check DENY "$got" "env session id, no stamp ⇒ deny"
: > "$STATE/doc-search-sessions/$SID"
got="$(printf '{"tool_input":{"file_path":"%s"}}' "$REPO/tools/a.mjs" | CLAUDE_CODE_SESSION_ID="$SID" bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
check ALLOW "$got" "env session id, stamped ⇒ allow"
rm -f "$STATE/doc-search-sessions/$SID"

echo "guard-doc-search: the escape hatch, and the deny message"
got="$(printf '{"session_id":"%s","tool_input":{"file_path":"%s"}}' "$SID" "$REPO/tools/a.mjs" | CLAUDE_ALLOW_NO_DOC_SEARCH=1 bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
check ALLOW "$got" "CLAUDE_ALLOW_NO_DOC_SEARCH=1 ⇒ allow"
msg="$(printf '{"session_id":"%s","tool_input":{"file_path":"%s"}}' "$SID" "$REPO/tools/a.mjs" | env -u CLAUDE_ALLOW_NO_DOC_SEARCH bash "$H" 2>&1 >/dev/null)"
check 0 "$(printf '%s' "$msg" | grep -q 'node tools/doc-search.mjs'; echo $?)" "the denial names the command to run"
check 0 "$(printf '%s' "$msg" | grep -q 'CLAUDE_ALLOW_NO_DOC_SEARCH=1'; echo $?)" "…and the hatch"
check 0 "$(printf '%s' "$msg" | grep -q "tools/a.mjs"; echo $?)" "…and the file, repo-relative"

echo "guard-doc-search: payload shapes that are not ours"
got="$(printf '{"session_id":"%s","tool_input":{"command":"ls"}}' "$SID" | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
check ALLOW "$got" "a Bash payload that is not a commit ⇒ allow"
got="$(printf 'not json' | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
check ALLOW "$got" "unparseable payload ⇒ allow"

# ── SHAPE 2: Bash `git commit` — the choke point (owner-ordered 2026-09-24). Every DENY is paired
#    with an ALLOW that differs in ONE property: the verb, the tree, the stamp, the hatch. ────────
run_cmd() { # run_cmd <command> <cwd> [sid] ; echoes DENY or ALLOW
  local c="$1" cwd="$2" sid="${3-$SID}" js
  js="$(jq -cn --arg s "$sid" --arg c "$c" --arg w "$cwd" '{session_id:$s, tool_name:"Bash", cwd:$w, tool_input:{command:$c}}')"
  printf '%s' "$js" | env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_ALLOW_NO_DOC_SEARCH bash "$H" >/dev/null 2>&1
  [ $? -eq 2 ] && echo DENY || echo ALLOW
}
echo "guard-doc-search: shape 2 — a commit without a search"
rm -f "$STATE/doc-search-sessions/$SID"
check DENY  "$(run_cmd 'git commit -m x' "$REPO")"                          "git commit in the repo cwd ⇒ deny"
check DENY  "$(run_cmd "git -C $WT commit -m x" "$OUT")"                    "…tree from the command's -C, not the cwd (cwd is outside)"
check DENY  "$(run_cmd "cd $WT && git add -A && git commit -m x" "$OUT")"   "…tree from a leading cd"
check DENY  "$(run_cmd 'git add tools/a.mjs && git commit -q -m x && git push' "$REPO")" "…a commit inside a chain"
check ALLOW "$(run_cmd 'git commit -m x' "$OUT")"                           "the same commit OUTSIDE any repo ⇒ allow"
check ALLOW "$(run_cmd 'git status && git fetch origin' "$REPO")"           "git without a commit ⇒ allow"
check ALLOW "$(run_cmd 'echo "the commit message says git commit"' "$REPO")" "the words in PROSE (echo) are not a commit"
check ALLOW "$(run_cmd 'git log --grep commit' "$REPO")"                    "…nor an argument to another git verb"
check ALLOW "$(run_cmd 'CLAUDE_ALLOW_NO_DOC_SEARCH=1 git commit -m x' "$REPO")" "the inline hatch on the command line ⇒ allow"
: > "$STATE/doc-search-sessions/$SID"
check ALLOW "$(run_cmd 'git commit -m x' "$REPO")"                          "…stamped ⇒ the same commit is allowed"
touch -d '4 hours ago' "$STATE/doc-search-sessions/$SID"
check DENY  "$(run_cmd 'git commit -m x' "$REPO")"                          "…stale stamp ⇒ deny again"
rm -f "$STATE/doc-search-sessions/$SID"
msg="$(jq -cn --arg s "$SID" --arg w "$REPO" '{session_id:$s, tool_name:"Bash", cwd:$w, tool_input:{command:"git commit -m x"}}' | env -u CLAUDE_ALLOW_NO_DOC_SEARCH bash "$H" 2>&1 >/dev/null)"
check 0 "$(printf '%s' "$msg" | grep -q 'committing'; echo $?)" "the denial names the shape (committing)"

# ── SHAPE 3: SendMessage — a ruling is gated like an edit, from the payload's cwd. ──────────────
run_msg() { # run_msg <cwd> [sid]
  local cwd="$1" sid="${2-$SID}" js
  js="$(jq -cn --arg s "$sid" --arg w "$cwd" '{session_id:$s, tool_name:"SendMessage", cwd:$w, tool_input:{to:"peer", message:"a ruling"}}')"
  printf '%s' "$js" | env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_ALLOW_NO_DOC_SEARCH bash "$H" >/dev/null 2>&1
  [ $? -eq 2 ] && echo DENY || echo ALLOW
}
echo "guard-doc-search: shape 3 — a ruling without a search"
check DENY  "$(run_msg "$REPO")"   "SendMessage from a repo cwd, no stamp ⇒ deny"
check DENY  "$(run_msg "$WT")"     "…from a linked worktree cwd ⇒ deny"
check ALLOW "$(run_msg "$OUT")"    "…from OUTSIDE any repo ⇒ allow"
: > "$STATE/doc-search-sessions/$SID"
check ALLOW "$(run_msg "$REPO")"   "…stamped ⇒ allow"
rm -f "$STATE/doc-search-sessions/$SID"
js="$(jq -cn --arg s "$SID" --arg w "$REPO" '{session_id:$s, tool_name:"Read", cwd:$w, tool_input:{file_path:""}}')"
got="$(printf '%s' "$js" | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
check ALLOW "$got" "a tool that is none of the three shapes (Read, empty path) ⇒ allow"

# ── ANTI-VACUITY: the hook must not contain a bare unconditional `exit 0` (a no-op guard reads
#    green on every ALLOW leg above and the DENY legs are what catch it — keep them). ───────────
if grep -qE '^exit 0$' "$H"; then echo "  ✗ a bare 'exit 0' line short-circuits the guard"; fail=1; else echo "  ✓ no bare 'exit 0' line"; fi

cd /
if [ $fail -eq 0 ]; then echo "guard-doc-search.test.sh: all passed"; else echo "guard-doc-search.test.sh: FAILED"; exit 1; fi
