# tepna-capture — daemon_control.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# STOP / RESTART THE CAPTURE DAEMON FROM THE MONITOR, so an operator does not need a terminal.
#
# WHY THIS EXISTS. Every recovery this box has needed went through ssh: on 2026-08-13 the daemon was
# restarted SIX times to apply a config change, and a runaway device was silenced by POSTing config
# through the settings API because nothing else could reach it. The machinery to do it properly was
# already present and only lacked a caller — `tepna-restart.sh` is root-owned, NOPASSWD-granted, and
# names exactly one unit, so this adds a BUTTON over an existing grant rather than new privilege.
#
# ── THE VERB IS AN ALLOWLIST, NEVER AN INTERPOLATION ────────────────────────────────────────────────
#
# This is reachable from an HTTP body, so nothing the caller sent reaches the command line. The verb is
# used as a LOOKUP KEY and the argv is built from the value stored in `_VERBS` — the caller's own string
# is compared and then discarded. That distinction is not pedantic: appending `verb` after a membership
# test is what CodeQL flagged as py/command-line-injection, and it was correct to, because the object on
# the command line was caller-derived even though its content could only be one of three words.
# `minutes` is coerced to a bounded int and formatted with %d, so it is one to three digits.
#
# ⚠️ RESTART KILLS THIS WEB SERVER. The monitor is served BY the unit being restarted, so a synchronous
# call would stop the process mid-response and every click would read as a crash. The HTTP layer
# therefore answers FIRST and fires the helper on a short delay (`schedule`), and the response says how
# long to wait before reconnecting. That ordering is the whole reason this is not three lines inline.
from __future__ import annotations

import subprocess

import helper_path

HELPER = "tepna-restart.sh"

# The verbs the helper actually implements. `status` is read-only and safe to run inline; `restart` and
# `stop` end this process, so the HTTP layer must respond before either is fired.
# Maps a REQUESTED verb to the canonical name that goes on the command line, plus its arity. The name
# is stored, not echoed: `build_cmd` appends THIS string, never the caller's — so the argv is built
# from module constants even though the lookup key came from an HTTP body. A membership test alone
# ("if verb in _ARITY") leaves the caller's own object on the command line, which is what CodeQL
# flagged as py/command-line-injection and what the previous comment here wrongly claimed was not
# happening.
_VERBS = {"restart": ("restart", 0), "status": ("status", 0), "stop": ("stop", 1)}
_ARITY = {k: v[1] for k, v in _VERBS.items()}
KILLS_SELF = frozenset({"restart", "stop"})

# `stop` takes minutes. Bounded because the helper arms a deadman timer with it: too small is useless,
# and an unbounded value is an indefinite outage entered by typo. 8 h is longer than any night.
MIN_STOP_MINUTES = 1
MAX_STOP_MINUTES = 480
DEFAULT_STOP_MINUTES = 30

# Seconds between answering the client and stopping the unit. Long enough for the response to flush on
# a LAN, short enough that nobody wonders whether the click registered.
RESTART_DELAY_S = 0.75


class VerbError(ValueError):
    """A verb or argument that will not be passed to the helper. Raised rather than sanitised — a
    request this module does not understand is refused, never guessed at."""


def coerce_minutes(value, *, default: int = DEFAULT_STOP_MINUTES) -> int:
    """PURE. The deadman minutes for `stop`, or raise.

    `None` means "use the default" — the button sends no value. Anything else must be a whole number in
    range: a float, a numeric string and an int are all accepted because a JSON body may carry any of
    them, but a non-numeric or out-of-range value is an error rather than a clamp. Clamping would let a
    typo of 4800 become a silent 480-minute outage."""
    if value is None:
        return default
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        raise VerbError(f"minutes must be a whole number, got {value!r}") from None
    if minutes != float(value):
        raise VerbError(f"minutes must be a whole number, got {value!r}")
    if not MIN_STOP_MINUTES <= minutes <= MAX_STOP_MINUTES:
        raise VerbError(
            f"minutes must be {MIN_STOP_MINUTES}–{MAX_STOP_MINUTES}, got {minutes}")
    return minutes


def build_cmd(verb, minutes=None) -> list[str]:
    """PURE. The argv for one helper verb, or raise.

    The allowlist IS the security boundary: the verb is looked up, never formatted, so no caller string
    reaches a command line. Returns a list (never a shell string) so there is no shell to quote for."""
    if verb not in _VERBS:
        raise VerbError(f"unknown verb {verb!r} — expected one of {', '.join(sorted(_VERBS))}")
    canonical, arity = _VERBS[verb]          # the STORED name, not the caller's string
    argv = ["sudo", "-n", helper_path.resolve(HELPER), canonical]
    if arity:
        n = coerce_minutes(minutes)
        # ⚠️ THE BOUND IS RE-ASSERTED HERE, at the point of USE, not only in `coerce_minutes`.
        #
        # Not redundancy for its own sake. The value reaches this line from an HTTP body, and a reader
        # (or a static analyser) checking whether a caller-supplied value can influence a command line
        # has to follow it into another function to find the guard. CodeQL flagged exactly that as
        # `py/command-line-injection` — the sanitiser did not survive the call boundary, and a
        # security property that cannot be seen locally is one nobody can verify in review either.
        #
        # After this, `n` is provably an int in [1, 480], so `str(n)` is one to three digits. Combined
        # with a LIST argv (no shell, nothing to quote for) there is no injection surface — but the
        # argument for that now lives where the argv is built.
        # UNREACHABLE by construction — `coerce_minutes` raises on everything this catches — and kept
        # anyway, because its value is not runtime behaviour: a reader of THIS function needs no other
        # function to trust the next line. Excluded from coverage for the same reason the arm exists.
        if not isinstance(n, int) or not MIN_STOP_MINUTES <= n <= MAX_STOP_MINUTES:  # pragma: no cover
            raise VerbError(f"minutes out of range after coercion: {n!r}")
        argv.append("%d" % n)
    return argv


def run(verb, minutes=None, *, timeout: float = 30.0, runner=subprocess.run) -> dict:
    """Invoke the helper and report what happened. Never raises for an operational failure.

    `runner` is injected so the decision logic is testable without a privileged helper on the box —
    the alternative is a test that only runs where sudo already works, which is no test at all.

    A MISSING GRANT IS NOT A FAILING DAEMON, and the distinction is the one an operator needs: `sudo -n`
    exits 1 with 'a password is required' on a box without the sudoers line, which reads identically to
    a broken unit unless it is named. Same reasoning as check.sh's shellcheck-127 note."""
    try:
        argv = build_cmd(verb, minutes)
    except VerbError as e:
        return {"ok": False, "verb": verb, "error": str(e)}
    try:
        r = runner(argv, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        return {"ok": False, "verb": verb, "error": "sudo not found — not a capture host"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "verb": verb, "error": f"helper did not return within {timeout:g}s"}
    out = ((r.stdout or "") + (r.stderr or "")).strip()
    if r.returncode == 0:
        return {"ok": True, "verb": verb, "detail": out[-400:]}
    hint = ""
    if "password" in out.lower() or "sudo:" in out.lower():
        hint = (" — the NOPASSWD grant for " + HELPER + " is missing on this host; this is a DEPLOY "
                "gap, not a failing daemon")
    return {"ok": False, "verb": verb, "exit": r.returncode, "error": (out[-400:] or "helper failed") + hint}
