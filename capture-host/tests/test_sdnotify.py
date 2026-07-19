# tepna-capture — tests/test_sdnotify.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
import os
import socket

import sdnotify


def test_sd_notify_is_a_noop_without_a_socket(monkeypatch):
    monkeypatch.delenv("NOTIFY_SOCKET", raising=False)
    assert sdnotify.sd_notify("READY=1") is False


def test_sd_notify_sends_to_a_real_unix_socket(tmp_path, monkeypatch):
    sock_path = str(tmp_path / "notify.sock")
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    srv.bind(sock_path)
    srv.settimeout(2)
    try:
        monkeypatch.setenv("NOTIFY_SOCKET", sock_path)
        assert sdnotify.sd_notify("WATCHDOG=1") is True
        assert srv.recv(64) == b"WATCHDOG=1"
    finally:
        srv.close()


def test_sd_notify_handles_the_abstract_namespace(monkeypatch):
    # An "@"-prefixed address is the Linux abstract namespace (leading NUL). Bind one and confirm receipt.
    abstract = "\0tepna-test-" + str(os.getpid())
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    srv.bind(abstract)
    srv.settimeout(2)
    try:
        monkeypatch.setenv("NOTIFY_SOCKET", "@" + abstract[1:])
        assert sdnotify.sd_notify("READY=1") is True
        assert srv.recv(64) == b"READY=1"
    finally:
        srv.close()


def test_sd_notify_swallows_a_bad_socket(monkeypatch):
    monkeypatch.setenv("NOTIFY_SOCKET", "/no/such/socket/path")   # connect() → OSError, caught
    assert sdnotify.sd_notify("READY=1") is False


def test_watchdog_period_is_half_the_configured_interval(monkeypatch):
    monkeypatch.setenv("WATCHDOG_USEC", "120000000")             # 120 s → ping every 60 s
    assert sdnotify.watchdog_period_sec() == 60.0


def test_watchdog_period_floors_at_one_second(monkeypatch):
    monkeypatch.setenv("WATCHDOG_USEC", "500000")               # 0.5 s → half is 0.25, floored to 1.0
    assert sdnotify.watchdog_period_sec() == 1.0


def test_watchdog_period_none_when_unset(monkeypatch):
    monkeypatch.delenv("WATCHDOG_USEC", raising=False)
    assert sdnotify.watchdog_period_sec() is None


def test_watchdog_period_none_when_malformed(monkeypatch):
    monkeypatch.setenv("WATCHDOG_USEC", "not-a-number")
    assert sdnotify.watchdog_period_sec() is None
