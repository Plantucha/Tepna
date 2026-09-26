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

# ── 9 · WITHOUT jq THE GUARD IS INERT, AND SAYS SO ONCE ─────────────────────────────────────────
#    Fail-open is kept: a hook that errors on every tool call breaks the session. What is planted is
#    that the absence is ANNOUNCED rather than silent, exactly once, and never on the hot path.
NOJQ="$TMP/nojq"; mkdir -p "$NOJQ"
for _b in sed grep awk find stat cat printf mkdir mv tail cut head sort wc date env bash sh; do
  _p="$(command -v "$_b" 2>/dev/null)" && ln -sf "$_p" "$NOJQ/$_b" 2>/dev/null
done
nojq_run() { # nojq_run <tool> <phase> <marker-dir> ; echoes the stderr
  printf '{"session_id":"%s","tool_name":"%s","tool_input":{"file_path":"%s"}}' "$SID" "$1" "$F" \
    | env -i PATH="$NOJQ" HOME="$TMP" TMPDIR="$3" CLAUDE_CODE_SESSION_ID="$SID" bash "$H" "$2" 2>&1 >/dev/null
}
MK="$TMP/mk1"; mkdir -p "$MK"
_first="$(nojq_run Write pre "$MK")"
case "$_first" in
  *"MEMORY GUARD IS INERT"*) echo "  ✓ without jq the guard ANNOUNCES that it is inert" ;;
  *) echo "  ✗ without jq the guard is silently inert — the fail-open-and-say-nothing shape"; fail=$((fail + 1)) ;;
esac
case "$_first" in
  *"NOTHING backstops"*) echo "  ✓ …and says WHY this differs from the format/ruff guards (no safety net behind it)" ;;
  *) echo "  ✗ the notice does not say why this guard's fail-open is different"; fail=$((fail + 1)) ;;
esac
_second="$(nojq_run Write pre "$MK")"
[ -z "$_second" ] && echo "  ✓ …ONCE per session: the second write says nothing" || { echo "  ✗ the notice repeats — a line per call is how a guard gets ripped out"; fail=$((fail + 1)); }
_read="$(nojq_run Read pre "$TMP/mk2")"
[ -z "$_read" ] && echo "  ✓ …and never on Read, which is the hot path" || { echo "  ✗ the notice fires on Read"; fail=$((fail + 1)); }
# A DIFFERENT session gets its own notice — the marker is session-scoped, not global.
MK2="$TMP/mk3"; mkdir -p "$MK2"
_other="$(printf '{"session_id":"%s","tool_name":"Write","tool_input":{"file_path":"%s"}}' "$SID2" "$F" \
  | env -i PATH="$NOJQ" HOME="$TMP" TMPDIR="$MK2" CLAUDE_CODE_SESSION_ID="$SID2" bash "$H" pre 2>&1 >/dev/null)"
case "$_other" in
  *"MEMORY GUARD IS INERT"*) echo "  ✓ …and a second session gets its own notice (marker is session-scoped)" ;;
  *) echo "  ✗ a second session is silently inert"; fail=$((fail + 1)) ;;
esac
ls "$MK"/tepna-memory-guard-inert.* >/dev/null 2>&1 && echo "  ✓ the marker is NAMED for what it is, under TMPDIR" || { echo "  ✗ marker missing or unnamed"; fail=$((fail + 1)); }
# AND IT STILL FAILS OPEN: announcing is not denying.
printf '{"session_id":"%s","tool_name":"Write","tool_input":{"file_path":"%s"}}' "$SID" "$F" \
  | env -i PATH="$NOJQ" HOME="$TMP" TMPDIR="$MK" CLAUDE_CODE_SESSION_ID="$SID" bash "$H" pre >/dev/null 2>&1
[ $? -eq 2 ] && { echo "  ✗ without jq the guard DENIES — it must fail open"; fail=$((fail + 1)); } || echo "  ✓ …while still failing OPEN: announcing is not denying"

echo
echo "### THE PRE ARM'S OWN ALLOW IS EXCUSED ONCE — and the bound is where the value is"
# Wren found this and it was 100 % reproducible: a `Read` records the PRE-write mtime, so after ANY
# write the pre arm allowed, the ledger cannot hold the current one and the post arm reported —
# identically to a real foreign overwrite. The case the arm exists for became the one people scroll
# past. Every leg below is a CONTROL on how far the excuse reaches, because an excuse that reaches
# too far is the same guard with the finding removed.
W="$TMP/.claude/projects/-home-x-Repo2"; WMEM="$W/memory"; mkdir -p "$WMEM"
WSID="77777777-2222-3333-4444-555555555555"
wa="$WMEM/a.md"; wb="$WMEM/b.md"
bash_run() { # bash_run <phase> <command> ; echoes DENY or ALLOW
  printf '{"session_id":"%s","tool_name":"Bash","tool_input":{"command":"%s"}}' "$WSID" "$1" \
    | env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_ALLOW_STALE_MEMORY HOME="$TMP" bash "$H" "$2" >/dev/null 2>&1
  [ $? -eq 2 ] && echo DENY || echo ALLOW
}
read_run() { printf '{"session_id":"%s","tool_name":"Read","tool_input":{"file_path":"%s"}}' "$WSID" "$1" \
    | env -u CLAUDE_CODE_SESSION_ID HOME="$TMP" bash "$H" pre >/dev/null 2>&1; }

printf 'a\n' > "$wa"; printf 'b\n' > "$wb"
bash_run true post >/dev/null                                    # snapshot
# ⚠ POSITIVE CONTROL FIRST. A harness whose memory dir the hook cannot see returns quiet for
#   EVERYTHING, which reads exactly like a pass — it happened to two of us building this. Prove the
#   instrument can make the hook report before trusting any quiet below.
printf 'foreign\n' > "$wb"; sleep 0.02
ok DENY "$(bash_run true post)" "control: the harness CAN make the post arm report (else every quiet below is vacuous)"

bash_run true post >/dev/null
read_run "$wa"
ok ALLOW "$(bash_run "printf x > $wa" pre)" "the pre arm ALLOWS a write to a file this session read"
printf 'x\n' > "$wa"; sleep 0.02
ok ALLOW "$(bash_run "printf x > $wa" post)" "…and the post arm no longer cries wolf over that same write"
printf 'y\n' > "$wa"; sleep 0.02
ok DENY "$(bash_run true post)" "the excuse is SPENT: a second write with no new read reports"

bash_run true post >/dev/null; read_run "$wa"
bash_run "printf z > $wa" pre >/dev/null
printf 'z\n' > "$wa"; printf 'peer\n' > "$wb"; sleep 0.02
ok DENY "$(bash_run "printf z > $wa" post)" "the excuse is PER-PATH: a peer touching ANOTHER file in the window still reports"

bash_run true post >/dev/null
printf 'foreign\n' > "$wa"; sleep 0.02
ok DENY "$(bash_run "printf q > $wa" pre)" "a stale read is still DENIED at the pre arm"
printf 'q\n' > "$wa"; sleep 0.02
ok DENY "$(bash_run true post)" "…and a DENIED command leaves no licence behind for the next one"

# ── no memory directory anywhere under HOME ⇒ the hook is a no-op, pre and post, on every tool ──
# (a cloud container or fresh clone; the hook must not parse a payload for a directory that cannot exist)
NOMEM="$(mktemp -d)"; mkdir -p "$NOMEM/.claude/projects/-home-x-Repo"   # the project dir WITHOUT memory/
nomem() { printf '{"session_id":"%s","tool_name":"%s","tool_input":{"file_path":"%s"}}' "$SID" "$1" "$2" \
  | env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_ALLOW_STALE_MEMORY HOME="$NOMEM" bash "$H" "${3-pre}" >/dev/null 2>&1; echo $?; }
ok 0 "$(nomem Write "$F")"        'no memory dir under HOME: a Write to a memory-looking path is a no-op (exit 0), pre'
ok 0 "$(nomem Write "$F" post)"   '…and post'
ok 0 "$(nomem Bash "$F" post)"    '…and a Bash post, the phase that otherwise always reads the directory'
ok DENY "$(run Write "$F")"       'control: with the memory dir present the same Write is still DENIED'
rm -rf "$NOMEM"

if [ "$fail" -eq 0 ]; then echo "guard-memory-stale: all checks passed"; else echo "guard-memory-stale: $fail FAILED"; exit 1; fi
