# tepna-capture — tests/test_journal_priority.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# VIGIL-COEXISTENCE-AND-RANGE §1. systemd assigns ONE priority to a service's whole stdout stream, so a
# plain basicConfig files every line — INFO, WARNING, ERROR — at priority 6, and
# `journalctl -u tepna-capture -p warning` returns nothing on a box that logged 33 warnings. The fix is a
# leading `<N>` syslog prefix, which systemd parses because `SyslogLevelPrefix=yes` is the default.
#
# The mapping test alone is not enough: the bug these guard against is a SEVERITY that is printed but not
# expressed, so the assertions below check the emitted BYTES rather than the formatter's return value in
# isolation, and check the negative case too — the prefix must never reach an interactive console.
#
# This file owns `journal_logging.py`, the module BOTH units import. It held `capture.py`'s private copy
# until row `2026-10-30-the-journal-priority-formatter-is-duplicated-in-radioclock`: `radioclock.py` had
# copied the map, the formatter and the installer, and nothing held the two equal. The behaviour is
# asserted once here, and each unit's own call site is asserted at the bottom — a unit that stops calling
# the installer logs nothing the journal can filter, whatever this module does.

import io
import logging

import journal_logging as jl
from _srcscan import module_source


def _emit(level, msg, stream):
    """Drive a real LogRecord through the installed root handler and return what was written."""
    logging.getLogger("tepna-capture").log(level, msg)
    return stream.getvalue()


def _reset_root():
    for h in logging.root.handlers[:]:
        logging.root.removeHandler(h)


def _install(stream):
    """Clear root first: `install_logging` deliberately does NOT use `force=True` (it would rip out
    pytest's caplog handler), so `basicConfig` is a no-op unless root is empty."""
    _reset_root()
    return jl.install_logging(stream)


def test_priority_map_covers_every_level_the_daemon_uses():
    # 4 is the one that matters: WARNING is the level `-p warning` filters on and the level the daemon
    # emits link errors at. 2/3/6/7 are asserted so a future edit cannot quietly shift the scale.
    assert jl.SYSLOG_PRIORITY[logging.CRITICAL] == 2
    assert jl.SYSLOG_PRIORITY[logging.ERROR] == 3
    assert jl.SYSLOG_PRIORITY[logging.WARNING] == 4
    assert jl.SYSLOG_PRIORITY[logging.INFO] == 6
    assert jl.SYSLOG_PRIORITY[logging.DEBUG] == 7


def test_under_journald_warning_is_prefixed_4_and_info_6(monkeypatch):
    monkeypatch.setenv("JOURNAL_STREAM", "8:12345")
    stream = io.StringIO()
    try:
        fmt = _install(stream)
        assert isinstance(fmt, jl.PriorityFormatter)

        out = _emit(logging.WARNING, "Polar H10 link error", stream)
        assert out.startswith("<4>"), out
        assert "Polar H10 link error" in out
        # The level NAME travels in the text too, so a reader that drops the journal's metadata still
        # sees the severity. Pinned here because the format is the other half of expressing it.
        assert "WARNING" in out, out

        stream.truncate(0), stream.seek(0)
        out = _emit(logging.INFO, "capture started", stream)
        assert out.startswith("<6>"), out
    finally:
        _reset_root()


def test_an_unknown_level_falls_back_to_info_not_a_crash(monkeypatch):
    # A custom level must not raise inside the log path — a formatter that throws takes the daemon's
    # whole logging down, which is strictly worse than an imprecise priority. 6 also keeps such a line
    # visible under the journal's default, where 7 would file it as DEBUG and hide it.
    monkeypatch.setenv("JOURNAL_STREAM", "8:12345")
    stream = io.StringIO()
    try:
        _install(stream)
        out = _emit(logging.WARNING + 1, "odd level", stream)
        assert out.startswith("<6>"), out
    finally:
        _reset_root()


def test_interactive_console_gets_no_prefix(monkeypatch):
    # The Done-when explicitly requires this: the prefix must not appear on the interactive path.
    # JOURNAL_STREAM absent => not journald => plain format, even though a redirected stream is
    # equally not-a-TTY (which is why isatty() is the wrong discriminator).
    monkeypatch.delenv("JOURNAL_STREAM", raising=False)
    stream = io.StringIO()
    try:
        fmt = _install(stream)
        assert not isinstance(fmt, jl.PriorityFormatter)
        out = _emit(logging.WARNING, "Polar H10 link error", stream)
        assert not out.startswith("<"), out
        assert "WARNING" in out and "Polar H10 link error" in out
    finally:
        _reset_root()


def test_the_installer_raises_the_root_level_so_an_info_line_arrives(monkeypatch):
    """A fresh interpreter starts root at WARNING, so an installer that configures handlers and not the
    LEVEL drops every INFO line a unit emits. The other legs here cannot see it: pytest leaves root
    permissive, so INFO arrives whatever the installer sets. This one puts root back where a real
    process starts. Measured on `radioclock.py` 2026-10-30 — a silent exit 0 with no handler at all."""
    monkeypatch.delenv("JOURNAL_STREAM", raising=False)
    stream = io.StringIO()
    try:
        _reset_root()
        logging.root.setLevel(logging.WARNING)
        jl.install_logging(stream)
        logging.getLogger("tepna-capture").info("capture started")
        assert "capture started" in stream.getvalue(), "the installer must let INFO through"
    finally:
        _reset_root()
        logging.root.setLevel(logging.WARNING)


def test_install_logging_does_not_clobber_an_existing_root_handler():
    """No `force=True` — the property that keeps `caplog` alive.

    `force=True` reads as harmless tidiness and is not: it REMOVES every existing root handler, so under
    pytest it deletes caplog's and any test that drives `main()` then asserts on `caplog.records` sees an
    empty list while the logging itself works perfectly. That regression was real — it broke
    `test_shutdown_names_a_task_that_ignores_cancellation` and three siblings. Those tests catch it only
    incidentally; this one states the property, so a refactor over there cannot silently drop the guard.
    """
    _reset_root()
    sentinel = logging.StreamHandler(io.StringIO())
    logging.root.addHandler(sentinel)
    try:
        jl.install_logging(io.StringIO())
        assert sentinel in logging.root.handlers, "install_logging removed a pre-existing root handler"
    finally:
        _reset_root()


# ── THE TWO CALL SITES ──────────────────────────────────────────────────────────────────────────────
# Anchored on the call site, not on the helper's existence: the regression that reintroduces this bug is
# someone replacing the installer with `logging.basicConfig(...)` where a unit starts up. One leg per
# importing unit, because a shared module that nobody calls expresses nothing.
#
# ⚠️ `module_source`, NEVER a raw read — see `tests/_srcscan.py`. mutmut generates ONE module holding
# every mutant inline, so a `count(...)` over a raw read of a mutatable module reads a double-digit
# number and the whole module comes back unmeasurable. Residue
# `2026-10-30-the-mutation-hygiene-scan-misses-a-read-through-a-module-alias`.


def test_capture_installs_logging_through_the_shared_module():
    src = module_source("capture.py")
    assert "journal_logging.install_logging()" in src
    assert src.count("logging.basicConfig(") == 0, "the only basicConfig lives in journal_logging.py"


def test_the_shared_module_holds_exactly_one_basicconfig():
    assert module_source("journal_logging.py").count("logging.basicConfig(") == 1
