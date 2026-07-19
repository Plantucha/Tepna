# tepna-capture — tests/test_no_deprecated_apis.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Guards against re-introducing APIs that are deprecated TODAY and removed LATER. Both cases below were
# real, both were invisible in normal operation, and both would have failed on the box rather than in CI:
#
#   datetime.utcnow()  — 3,638 warning events in one night's log. Deprecated in 3.12, scheduled for
#                        removal. It sits on the clock path, and CI used to pin 3.12 while the box ran
#                        3.13, so CI would have stayed green through the release that broke it.
#   bleak adapter=     —   698 events. bleak 3.0.2 still shims it (warns, copies into bluez["adapter"]),
#                        but when the shim goes it becomes an unknown kwarg that is SWALLOWED, not
#                        raised — the adapter pin vanishes silently and the box captures over the
#                        onboard radio that cannot hear the sensors.
#
# A source scan rather than a runtime warning filter: the runtime paths (capture/webmon/polar_psftp) need
# BLE hardware and read 0% in a hardware-free CI, so nothing would execute the lines that matter.

import os
import re

HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, "..")
OURS = [f for f in sorted(os.listdir(SRC)) if f.endswith(".py")]


def _read(fname):
    with open(os.path.join(SRC, fname), encoding="utf-8") as fh:
        return fh.read()


def _code_lines(src):
    """(lineno, code) with comments and docstring bodies excluded — the notes in this repo deliberately
    NAME the banned calls, and a scan that flags its own explanation is a scan nobody keeps. Line numbers
    are the REAL ones: enumerating the filtered list instead reports positions that don't exist in the
    file, which sent me hunting for a `pull_session.py:40` that was actually line 60."""
    out, in_doc, doc_q = [], False, ""
    for n, ln in enumerate(src.splitlines(), 1):
        s = ln.strip()
        if in_doc:
            if doc_q in s:
                in_doc = False
            continue
        if s.startswith(('"""', "'''")):
            doc_q = s[:3]
            if not (len(s) > 3 and s.endswith(doc_q)):
                in_doc = True
            continue
        if s.startswith("#"):
            continue
        out.append((n, ln.split("#", 1)[0]))
    return out


def _bleak_files():
    """Only files that actually talk to bleak. `"adapter":` appears in plenty of unrelated dicts — the
    monitor's device-state JSON in webmon.py, for one — and a scan that flags those gets suppressed."""
    return [f for f in OURS if re.search(r"^\s*(import bleak|from bleak)", _read(f), re.M)]


def test_no_datetime_utcnow_anywhere():
    """utcnow() is naive-UTC; its replacement datetime.now(UTC) is AWARE. The whole capture-host clock
    path is naive (_now(), _POLAR_EPOCH), so the fix must be
    `datetime.now(timezone.utc).replace(tzinfo=None)` — a blind swap raises TypeError on the skew line."""
    hits = []
    for f in OURS:
        for n, ln in _code_lines(_read(f)):
            if re.search(r"\butcnow\s*\(", ln):
                hits.append(f"{f}:{n}: {ln.strip()}")
    assert not hits, "datetime.utcnow() is deprecated and slated for removal:\n" + "\n".join(hits)


def test_naive_utc_replacement_keeps_tzinfo_none():
    """The replacement must stay NAIVE. An aware datetime here does not crash where it is written — it
    crashes later, on the clock path, as a device that mysteriously stops reporting skew."""
    import capture
    now = capture._utcnow()
    assert now.tzinfo is None, "_utcnow() must return a naive datetime (see its docstring)"
    import datetime as dt
    # and it must actually be UTC, not local: compare against a known-aware reading
    delta = abs((now - dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)).total_seconds())
    assert delta < 5, f"_utcnow() drifted from real UTC by {delta:.1f}s — is it returning local time?"


def test_no_bare_bleak_adapter_kwarg():
    """bleak wants bluez={'adapter': 'hciN'}. The bare kwarg is shimmed today, but a removed shim does not
    raise — it is swallowed, and the pin disappears with no error naming the cause."""
    hits = []
    for f in _bleak_files():
        for n, ln in _code_lines(_read(f)):
            # a dict literal keyed "adapter" handed to bleak. Our own helpers may still DECLARE an
            # `adapter` parameter (adapter_hci, PolarPsFtp, pull) — those are signatures, not kwargs.
            if re.search(r'["\']adapter["\']\s*:', ln) and "bluez" not in ln:
                hits.append(f"{f}:{n}: {ln.strip()}")
    assert not hits, ("bleak's bare `adapter` kwarg is deprecated; use bluez={'adapter': ...}:\n"
                      + "\n".join(hits))


def test_the_adapter_pin_actually_reaches_bleak_in_the_bluez_form():
    """Shape check on the kwargs we hand bleak: bluez must carry the adapter, because that is the only
    form that survives the shim being removed."""
    import polar_psftp
    kw = polar_psftp.PolarPsFtp("AA:BB:CC:DD:EE:FF", adapter="hci7")._kw
    assert kw == {"bluez": {"adapter": "hci7"}}, f"psftp passes the wrong kwargs to bleak: {kw}"
    assert polar_psftp.PolarPsFtp("AA:BB:CC:DD:EE:FF")._kw == {}, "unconfigured must pass nothing"
