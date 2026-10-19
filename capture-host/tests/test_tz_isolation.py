# tepna-capture — tests/test_tz_isolation.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`conftest._restore_process_timezone` — the guard that keeps one test's zone out of the next one.

Every test here drives the helper directly, because the fixture that calls it runs for every test in
the suite and an order-dependent test of it would be a coin flip under xdist."""

import os
import time

import conftest


def test_an_ABSENT_TZ_is_restored_by_REMOVING_the_one_the_test_set():
    """`before is None` is the ordinary case: the gate launches the suite with no `TZ` at all, so
    putting back an empty string or the literal `None` would leave a zone the box never had."""
    before, names = None, time.tzname
    os.environ["TZ"] = "UTC"
    time.tzset()
    try:
        conftest._restore_process_timezone(before, names)
        assert "TZ" not in os.environ
        assert time.tzname == names, time.tzname
    finally:
        os.environ.pop("TZ", None)
        time.tzset()


def test_a_PRIOR_VALUE_is_restored_rather_than_dropped():
    """The other half: a suite launched `TZ=UTC` must still be on UTC after a test that moved it, and
    dropping the variable there hands the C library `/etc/localtime` instead."""
    os.environ["TZ"] = "UTC"
    time.tzset()
    before, names = os.environ.get("TZ"), time.tzname
    os.environ["TZ"] = "America/New_York"
    time.tzset()
    try:
        conftest._restore_process_timezone(before, names)
        assert os.environ["TZ"] == "UTC"
        assert time.tzname == names, time.tzname
    finally:
        os.environ.pop("TZ", None)
        time.tzset()


def test_the_C_LIBRARY_is_put_back_when_the_ENVIRONMENT_ALONE_already_MATCHES():
    """🔴 The case the whole guard exists for, and the one an environment check cannot see.
    `monkeypatch` is torn down FIRST, so by the time the guard runs the variable is already back and
    only the library has drifted. Here the environment reads `UTC` and the library reports EST."""
    os.environ["TZ"] = "UTC"
    time.tzset()
    before, names = os.environ.get("TZ"), time.tzname
    os.environ["TZ"] = "America/New_York"
    time.tzset()
    os.environ["TZ"] = "UTC"  # what monkeypatch's own restore does, and all it does
    try:
        assert time.tzname != names, "the CONTROL: without tzset the library keeps the test's zone"
        conftest._restore_process_timezone(before, names)
        assert time.tzname == names, time.tzname
    finally:
        os.environ.pop("TZ", None)
        time.tzset()


def test_a_test_that_MOVED_NOTHING_costs_no_tzset(monkeypatch):
    """It runs after every one of ten thousand tests, and all but a handful touch no zone at all."""
    calls = []
    monkeypatch.setattr(conftest._time, "tzset", lambda: calls.append(1))
    conftest._restore_process_timezone(os.environ.get("TZ"), time.tzname)
    assert calls == [], calls
