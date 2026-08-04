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

import io
import logging

import capture


def _emit(level, msg, stream):
    """Drive a real LogRecord through the installed root handler and return what was written."""
    logging.getLogger("tepna-capture").log(level, msg)
    return stream.getvalue()


def _reset_root():
    for h in logging.root.handlers[:]:
        logging.root.removeHandler(h)


def _install(stream):
    """Clear root first: `_install_logging` deliberately does NOT use `force=True` (it would rip out
    pytest's caplog handler), so `basicConfig` is a no-op unless root is empty."""
    _reset_root()
    return capture._install_logging(stream)


def test_priority_map_covers_every_level_the_daemon_uses():
    # 4 is the one that matters: WARNING is the level `-p warning` filters on and the level the daemon
    # emits link errors at. 2/3/6/7 are asserted so a future edit cannot quietly shift the scale.
    assert capture._SYSLOG_PRIORITY[logging.CRITICAL] == 2
    assert capture._SYSLOG_PRIORITY[logging.ERROR] == 3
    assert capture._SYSLOG_PRIORITY[logging.WARNING] == 4
    assert capture._SYSLOG_PRIORITY[logging.INFO] == 6
    assert capture._SYSLOG_PRIORITY[logging.DEBUG] == 7


def test_under_journald_warning_is_prefixed_4_and_info_6(monkeypatch):
    monkeypatch.setenv("JOURNAL_STREAM", "8:12345")
    stream = io.StringIO()
    try:
        fmt = _install(stream)
        assert isinstance(fmt, capture._PriorityFormatter)

        out = _emit(logging.WARNING, "Polar H10 link error", stream)
        assert out.startswith("<4>"), out
        assert "Polar H10 link error" in out

        stream.truncate(0), stream.seek(0)
        out = _emit(logging.INFO, "capture started", stream)
        assert out.startswith("<6>"), out
    finally:
        _reset_root()


def test_an_unknown_level_falls_back_to_info_not_a_crash(monkeypatch):
    # A custom level must not raise inside the log path — a formatter that throws takes the daemon's
    # whole logging down, which is strictly worse than an imprecise priority.
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
        assert not isinstance(fmt, capture._PriorityFormatter)
        out = _emit(logging.WARNING, "Polar H10 link error", stream)
        assert not out.startswith("<"), out
        assert "WARNING" in out and "Polar H10 link error" in out
    finally:
        _reset_root()


def test_capture_installs_logging_rather_than_bare_basicconfig():
    # Anchored on the call site, not on the helper's existence: the regression that reintroduces this bug
    # is someone replacing _install_logging() with logging.basicConfig(...) at the main() call site.
    src = (capture.__file__ and open(capture.__file__, encoding="utf-8").read()) or ""
    assert "_install_logging()" in src
    # exactly one basicConfig in the file, and it is the one inside _install_logging
    assert src.count("logging.basicConfig(") == 1


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
        capture._install_logging(io.StringIO())
        assert sentinel in logging.root.handlers, "install_logging removed a pre-existing root handler"
    finally:
        _reset_root()
