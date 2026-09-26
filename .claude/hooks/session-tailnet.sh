#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# session-tailnet.sh — SessionStart hook: join the owner's tailnet ONLY where a cloud
# session was handed the key. Inert everywhere else, BY CONSTRUCTION, not by configuration:
#
#   · no `TS_AUTHKEY` in the environment  → exit 0, silent  (every local session, every CI runner)
#   · no `ts-up` on PATH                  → exit 0, silent  (the join helper ships with the cloud
#                                           image, never with this repo)
#   · both present                        → run `ts-up`, print ONE line, exit 0 either way
#
# WHY. Until 2026-09-26 every cloud session began with the owner typing the join command as
# its first message; a hook that fires only where the key exists removes that line without
# giving any other session a network step it did not have. `ts-up` reads the key from the
# environment and hands it to `tailscale up` through a 0600 temp file, never on a command
# line; this script never echoes, logs or writes the key, and its self-test asserts the
# key's value is absent from everything the hook prints. A failed join is REPORTED, not
# fatal: a session with no tunnel can still do repo work, and a non-zero SessionStart exit
# would only add noise on top of the line that already says what happened.
# ═══════════════════════════════════════════════════════════════════════════════
set -u
[ -n "${TS_AUTHKEY:-}" ] || exit 0
command -v ts-up >/dev/null 2>&1 || exit 0
if out="$(ts-up 2>&1)"; then
  printf 'session-tailnet: %s\n' "$(printf '%s\n' "$out" | tail -n 1)"
else
  printf 'session-tailnet: join FAILED — %s\n' "$(printf '%s\n' "$out" | tail -n 1)"
fi
exit 0
