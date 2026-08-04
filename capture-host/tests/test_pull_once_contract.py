# tepna-capture — tests/test_pull_once_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `_pull_once` is the whole O2Ring session pull: scan, connect, auth, list, download, write, sidecar.
# Its survivors are not decision logic — the branches are already covered by test_pull_session.py. They
# are the things a test that only checks the RETURN VALUE cannot see: the pacing the device needs, what
# the not-found error actually carries, whether the sidecar is readable, and whether the progress output
# names the values it is reporting on.
#
# ON ASSERTING PRINTED OUTPUT. These are a daemon's only diagnostics — the auto-pull runs unattended and
# `journalctl` is the sole record of why a night is missing. The assertions below check that a message
# NAMES ITS VALUES (the session id, the byte count, the offset), never its wording, so rewording any of
# them stays green while dropping the interpolated value goes red. That distinction is the whole point:
# pinning phrasing turns the suite into a change-detector, pinning the VALUES pins the diagnostic.

import json
import os

import pytest

import pull_session

from test_pull_session import FakeRing, _dat, _install, _run


def _spy_sleeps(monkeypatch):
    """Records every awaited sleep. MUST be called AFTER `_install`, which installs its own no-op
    `asyncio.sleep` — patching before it means the spy is silently replaced and every pacing assertion
    reads an empty list, which is a double that discards what it was built to observe."""
    seen = []

    async def spy(d, *a, **k):
        seen.append(d)

    monkeypatch.setattr(pull_session.asyncio, "sleep", spy)
    return seen


# ── the pacing the ring needs between control frames ────────────────────────────────────────────────
def test_the_control_handshake_is_paced_and_the_pauses_are_the_stated_ones(tmp_path, monkeypatch):
    """Auth and setup each get 0.5 s, and every FILE_END gets 0.3 s. These are not cosmetic: the ring is
    a BLE peripheral that drops frames sent while it is still processing the previous one, which is why
    the values are written as literals rather than left to chance.

    `sleep(None)` does not error — asyncio treats it as "yield once" — so the pause silently vanishes
    and the pull becomes flaky in a way that only shows up against real hardware. Nothing about the
    returned path or byte count changes, which is why these survived every existing test."""
    ring = FakeRing(["20260720010000"], b"\x01\x03" + b"z" * 90)
    _install(monkeypatch, ring)
    sleeps = _spy_sleeps(monkeypatch)
    _run(pull_session._pull_once("A", str(tmp_path), "all", 0, None, "0000"))

    assert 0.5 in sleeps, "the auth frame needs its pause before the next write"
    assert sleeps.count(0.5) >= 2, "auth AND setup are paced — 0.5 s each"
    assert 0.3 in sleeps, "FILE_END is paced at 0.3 s"
    assert None not in sleeps, "a None pause is not a pause; asyncio yields once and moves on"


def test_the_skip_paths_pace_their_file_end_too(tmp_path, monkeypatch):
    """The implausible-size and already-on-disk branches both send FILE_END and must pace it exactly as
    the download path does — they are the branches an auto-pull takes on EVERY cycle once the flash is
    already mirrored, so an unpaced FILE_END there is the common case, not the rare one."""
    blob = b"\x01\x03" + b"z" * 90
    ring = FakeRing(["20260719010000", "20260720010000"], blob, declared_seq=[0, len(blob)])
    _install(monkeypatch, ring)
    sleeps = _spy_sleeps(monkeypatch)
    _run(pull_session._pull_once("A", str(tmp_path), "all", 0, None, "0000"))
    assert 0.3 in sleeps, "the skipped session still paces its FILE_END"


# ── what the not-found error actually carries ───────────────────────────────────────────────────────
def test_the_not_found_error_names_the_address_and_says_why(tmp_path, monkeypatch):
    """`BleakDeviceNotFoundError(address, message)`. The auto-pull catches this and logs it, and the
    address is how an operator tells "the ring is asleep" from "we are scanning for the wrong MAC" —
    the O2Ring's MAC can rotate on a factory reset, so that distinction is real and recurring.

    Both arguments are asserted, and so is their ORDER: swapping them or dropping either produces an
    exception that still raises, still gets caught, and still logs — with the wrong content."""
    ring = FakeRing([], b"")
    _install(monkeypatch, ring)

    async def nothing_advertising(pred, **kw):
        return None

    monkeypatch.setattr(pull_session.BleakScanner, "find_device_by_filter",
                        staticmethod(nothing_advertising))

    with pytest.raises(pull_session.BleakDeviceNotFoundError) as e:
        _run(pull_session._pull_once("AA:BB:CC:DD:EE:FF", str(tmp_path), "latest", 0, None, "0000"))

    assert getattr(e.value, "identifier", None) == "AA:BB:CC:DD:EE:FF", \
        "the address must be the FIRST argument — it is how a wrong-MAC scan is told from a sleeping ring"
    text = str(e.value)
    assert "advertising" in text and "finger-in" in text, \
        "the message must state the actionable cause, not just that nothing was found"


# ── the sidecar a human reads ───────────────────────────────────────────────────────────────────────
def test_the_meta_sidecar_is_written_indented_so_it_can_be_read(tmp_path, monkeypatch):
    """`json.dump(..., indent=2)`. The sidecar sits beside a 2.6 MB binary and is the only human-readable
    record of what that .dat contains — `indent=None` collapses it to one line, which is what an
    operator gets when they open it on the box over ssh. Asserting the CONTENT and that it spans
    multiple lines pins readability without pinning the exact indent width."""
    ring = FakeRing(["20260720010000"], b"\x01\x03" + b"z" * 90)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("A", str(tmp_path), "all", 0, None, "0000"))

    side = got[0] + ".meta.json"
    assert os.path.exists(side), "every .dat gets a sidecar"
    raw = open(side).read()
    assert raw.count("\n") > 3, "indent=None collapses the sidecar to a single unreadable line"
    meta = json.loads(raw)
    assert meta["session"] == "20260720010000"
    assert meta["bytes"] == 92 and meta["declared_size"] == 92


# ── the progress output names its values ────────────────────────────────────────────────────────────
def test_the_progress_output_names_the_session_the_size_and_the_path(tmp_path, monkeypatch, capsys):
    """The auto-pull runs unattended; this output IS the record. Every assertion here is on a VALUE the
    line interpolates, never on its phrasing — reword any of these freely and the test stays green, but
    drop the interpolated value and it goes red, because a line that says "saved" without saying how
    much or where is not a diagnostic."""
    ring = FakeRing(["20260720010000"], b"\x01\x03" + b"z" * 90)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("A", str(tmp_path), "all", 0, None, "0000"))
    out = capsys.readouterr().out

    assert "20260720010000" in out, "the session being pulled must be named"
    assert "92" in out, "the declared size and the byte count must be reported"
    assert os.path.basename(got[0]) in out, "the path written must be named"
    assert "1" in out, "the session count from the flash listing must be reported"


def test_the_skip_reasons_name_the_session_they_are_about(tmp_path, monkeypatch, capsys):
    """With `which='all'` the auto-pull walks every session every cycle, so these skip lines are the
    steady-state output. A skip that does not say WHICH session it skipped is unusable once the flash
    holds a dozen nights."""
    blob = b"\x01\x03" + b"z" * 90
    ring = FakeRing(["20260719010000", "20260720010000"], blob, declared_seq=[0, len(blob)])
    _install(monkeypatch, ring)
    _run(pull_session._pull_once("A", str(tmp_path), "all", 0, None, "0000"))
    out = capsys.readouterr().out
    assert "20260719010000" in out, "the skipped session must be named"
    assert "20260720010000" in out, "and so must the pulled one"


def test_an_already_present_session_says_so_with_its_size(tmp_path, monkeypatch, capsys):
    blob = b"\x01\x03" + b"z" * 90
    ring = FakeRing(["20260720010000"], blob)
    _install(monkeypatch, ring)
    _run(pull_session._pull_once("A", str(tmp_path), "all", 0, None, "0000"))
    capsys.readouterr()

    ring2 = FakeRing(["20260720010000"], blob)
    _install(monkeypatch, ring2)
    got = _run(pull_session._pull_once("A", str(tmp_path), "all", 0, None, "0000"))
    out = capsys.readouterr().out
    assert got == [], "an already-present session is not reported as newly written"
    assert "92" in out, "the size it matched on must be named — that is the evidence for skipping"
    assert len(_dat(tmp_path)) == 1, "and nothing is re-downloaded"
