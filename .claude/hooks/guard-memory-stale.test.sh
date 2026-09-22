#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-memory-stale.test.sh — self-test for guard-memory-stale.sh.
#
# Builds a THROWAWAY `.claude/projects/<proj>/memory/` under a temp dir and drives the hook exactly
# as the harness does: the tool-call JSON on stdin, `pre` or `post` as the argument. Every DENY is
# paired with the ALLOW that differs in ONE property — read/not read, changed/unchanged since the
# read, exists/new, inside/outside a memory dir, session id present/absent, hatch set/unset — so a
# guard that fires on nothing scores as red as one that fires on everything.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/guard-memory-stale.sh"
fail=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PROJ="$TMP/.claude/projects/-home-x-Repo"
MEM="$PROJ/memory"
mkdir -p "$MEM" "$TMP/elsewhere"
SID="11111111-2222-3333-4444-555555555555"
SID2="99999999-2222-3333-4444-555555555555"

run() { # run <tool> <file_path> [phase] [session_id] ; echoes DENY or ALLOW
  local tool="$1" f="$2" phase="${3-pre}" sid="${4-$SID}" js
  if [ -n "$sid" ]; then js="$(printf '{"session_id":"%s","tool_name":"%s","tool_input":{"file_path":"%s"}}' "$sid" "$tool" "$f")"
  else js="$(printf '{"tool_name":"%s","tool_input":{"file_path":"%s"}}' "$tool" "$f")"; fi
  printf '%s' "$js" | env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_ALLOW_STALE_MEMORY bash "$H" "$phase" >/dev/null 2>&1
  [ $? -eq 2 ] && echo DENY || echo ALLOW
}
ok() { # ok <expected> <got> <name>
  if [ "$1" = "$2" ]; then echo "  ✓ $3"; else echo "  ✗ $3 — expected $1, got $2"; fail=$((fail + 1)); fi
}

F="$MEM/some-fact.md"
IDX="$MEM/MEMORY.md"
printf 'body by session A\n' > "$F"
printf -- '- [a](some-fact.md)\n' > "$IDX"

# 1 · never read ⇒ DENY; a NEW file ⇒ ALLOW (the one-property pair: exists vs not)
ok DENY  "$(run Write "$F")"                 'Write to an EXISTING memory file this session never read is DENIED'
ok DENY  "$(run Edit "$F")"                  'Edit likewise'
ok ALLOW "$(run Write "$MEM/new-fact.md")"   'Write to a NEW memory path is allowed (not an overwrite)'
ok DENY  "$(run Write "$IDX")"               'MEMORY.md (the shared index) is covered too'

# 2 · read, then write ⇒ ALLOW
ok ALLOW "$(run Read "$F")"                  'a Read is never denied (it records)'
[ -f "$PROJ/.memory-guard/$SID" ] && r=yes || r=no
ok yes "$r"                                   'the Read leaves a per-session ledger BESIDE the memory dir, not inside it'
[ -e "$MEM/.memory-guard" ] && p=polluted || p=clean
ok clean "$p"                                 '…and nothing lands inside memory/'
ok ALLOW "$(run Write "$F")"                 'Write after a Read of the same, unchanged file is ALLOWED'
ok ALLOW "$(run Edit "$F")"                  'Edit likewise'

# 3 · read, then ANOTHER session writes, then write ⇒ DENY (the TOCTOU the harness cannot see)
sleep 1; printf 'body by session B\n' > "$F"
ok DENY  "$(run Write "$F")"                 'Write after the file CHANGED since this session read it is DENIED'
ok ALLOW "$(run Read "$F")"                  'a fresh Read…'
ok ALLOW "$(run Write "$F")"                 '…re-arms the same Write'

# 4 · our own write moves the mtime; PostToolUse re-records so the session can keep editing
sleep 1; printf 'body by session A, edited\n' > "$F"     # what the allowed Write did
ok DENY  "$(run Edit "$F")"                  'control: without the post-hook the session'"'"'s own write reads as a change'
ok ALLOW "$(run Write "$F" post)"            'PostToolUse re-records the new mtime'
ok ALLOW "$(run Edit "$F")"                  '…so the next Edit in the same session is allowed'

# 5 · per SESSION: another session id has its own ledger
ok DENY  "$(run Write "$F" pre "$SID2")"     'a second session that never read the file is denied on its own ledger'

# 6 · fail-open legs, each one property away from a DENY
ok ALLOW "$(run Write "$F" pre "")"          'no session id in the payload ⇒ allow (not a Claude Code session)'
ok ALLOW "$(run Write "$TMP/elsewhere/x.md")" 'a path outside any .claude/projects/*/memory/ ⇒ allow'
printf 'y\n' > "$TMP/elsewhere/x.md"
ok ALLOW "$(run Write "$TMP/elsewhere/x.md")" '…even when it exists and was never read'
ok ALLOW "$(run Bash "$F")"                  'a tool this guard does not judge ⇒ allow (the Bash-side gap is documented, not closed)'
js="$(printf '{"session_id":"%s","tool_name":"Write","tool_input":{"file_path":"%s"}}' "$SID2" "$F")"
printf '%s' "$js" | env CLAUDE_ALLOW_STALE_MEMORY=1 bash "$H" pre >/dev/null 2>&1; [ $? -eq 2 ] && h=DENY || h=ALLOW
ok ALLOW "$h"                                 'the EXPORTED escape hatch allows a deliberate overwrite'

# 6b · the cheap reject cannot turn a DENY into an ALLOW: a payload naming a memory path still parses
js="$(printf '{"session_id":"%s","tool_name":"Write","tool_input":{"file_path":"%s"}}' "$SID2" "$F")"
printf '%s' "$js" | env -u CLAUDE_ALLOW_STALE_MEMORY bash "$H" pre >/dev/null 2>&1; [ $? -eq 2 ] && c=DENY || c=ALLOW
ok DENY "$c"                                  'the cheap /memory/ substring reject still lets a real memory path through to the check'

# 7 · the denial names the reason
msg="$(printf '{"session_id":"%s","tool_name":"Write","tool_input":{"file_path":"%s"}}' "$SID2" "$F" | bash "$H" pre 2>&1 >/dev/null)"
case "$msg" in *"has NOT read it"*) n=named ;; *) n=unnamed ;; esac
ok named "$n"                                 'the never-read denial says so'
sleep 1; printf 'changed again\n' > "$F"
msg="$(printf '{"session_id":"%s","tool_name":"Write","tool_input":{"file_path":"%s"}}' "$SID" "$F" | bash "$H" pre 2>&1 >/dev/null)"
case "$msg" in *"CHANGED since this session read it"*) n=named ;; *) n=unnamed ;; esac
ok named "$n"                                 'the changed-since-read denial says so, with both mtimes'

# ── 8 · THE Bash ARMS. HOME is redirected so `mem_dirs`' glob finds the throwaway project, which is
#        also how the SECOND-SLUG case is evidence rather than argument.
runb() { # runb <command> <phase> [session_id] ; echoes DENY or ALLOW
  local c="$1" phase="${2-pre}" sid="${3-$SID}" js
  js="$(printf '{"session_id":"%s","tool_name":"Bash","tool_input":{"command":%s}}' "$sid" "$(printf '%s' "$c" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")"
  printf '%s' "$js" | env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_ALLOW_STALE_MEMORY HOME="$TMP" bash "$H" "$phase" >/dev/null 2>&1
  [ $? -eq 2 ] && echo DENY || echo ALLOW
}
# the guard globs $HOME/.claude/projects/*/memory, so the fixture must live there
F2="$MEM/second-fact.md"
printf 'body by session A\n' > "$F2"

# 8a · PREVENTION — the two forms whose path is IN the command string
ok DENY  "$(runb "cat > $F2 <<'EOF'
new body
EOF")"                                        'pre-Bash · a HEREDOC write to an unread memory file is DENIED'
ok DENY  "$(runb "sed -i 's/a/b/' $F2")"     'pre-Bash · an in-place sed likewise'
ok ALLOW "$(runb "cat $F2")"                 'pre-Bash · a READ of the same file is allowed (a guard that denies its own remedy is worse than the gap)'
ok ALLOW "$(runb "grep -n '>>>>>>>' $F2")"   'pre-Bash · a conflict-marker grep is a READ, not a redirect (≥3 ">" stripped)'
ok ALLOW "$(runb "echo writing $F2 by hand")" 'pre-Bash · a command that merely NAMES the file is not write-shaped'
ok DENY  "$(runb "cp /tmp/x $F2")"           'pre-Bash · cp onto a memory file is a write'
ok ALLOW "$(runb "cat > $MEM/brand-new.md <<'EOF'
x
EOF")"                                        'pre-Bash · writing a NEW memory file is not an overwrite'

# 8b · THE CASE PREVENTION CANNOT SEE — a python heredoc whose path is computed.
PYW="python3 - <<'PY'
import os
p = os.path.join(os.environ['M'], 'second' + '-fact.md')
open(p, 'w').write('rewritten by a program\n')
PY"
ok ALLOW "$(runb "$PYW")"                    'pre-Bash · a PYTHON program with a COMPUTED path walks past prevention — stated, not hidden'

# 8c · DETECTION catches exactly that. First post establishes the baseline (no finding is possible),
#      then the write happens, then the next post reports it.
ok ALLOW "$(runb "true" post)"               'post-Bash · the FIRST invocation has no baseline, so it reports nothing and snapshots'
sleep 1; M="$MEM" python3 -c "
import os
p = os.path.join(os.environ['M'], 'second-fact.md')
open(p, 'w').write('rewritten by a program\n')
"
ok DENY  "$(runb "true" post)"               'post-Bash · a memory file that MOVED in a session that never read it IS reported — the write form is irrelevant'
ok ALLOW "$(runb "true" post)"               'post-Bash · …and reported ONCE: the snapshot is refreshed, so the same move does not re-fire'

# 8d · a file this session READ at its current state is its own accounted write, not a finding
ok ALLOW "$(run Read "$F2")"                 'a Read records the post-write state'
sleep 1; printf 'again\n' > "$F2"
ok DENY  "$(runb "true" post)"               'post-Bash · a LATER move after that read is reported again'

# 8e · SECOND PROJECT SLUG — "in scope by construction" is an argument; this is the evidence.
PROJ2="$TMP/.claude/projects/-opt-tepna"; MEM2="$PROJ2/memory"
mkdir -p "$MEM2"; printf 'box body\n' > "$MEM2/box-fact.md"
ok DENY  "$(runb "cat > $MEM2/box-fact.md <<'EOF'
x
EOF")"                                        'pre-Bash · a DIFFERENT project slug is in scope (the box'"'"'s own -opt-tepna)'
ok ALLOW "$(runb "cat > $TMP/elsewhere/x.md <<'EOF'
x
EOF")"                                        'pre-Bash · a path outside any memory dir is allowed'

if [ "$fail" -eq 0 ]; then echo "guard-memory-stale: all checks passed"; else echo "guard-memory-stale: $fail FAILED"; exit 1; fi
