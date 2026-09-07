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

import oxyii
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
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))

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
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))
    assert 0.3 in sleeps, "the skipped session still paces its FILE_END"


# ── what the not-found error actually carries ───────────────────────────────────────────────────────
def test_the_not_found_error_names_the_address_and_says_why(tmp_path, monkeypatch):
    """`BleakDeviceNotFoundError(address, message)`. The auto-pull catches this and logs it, and the
    address is how an operator tells "the ring is asleep" from "we are scanning for the wrong MAC" —
    a factory-reset ring re-pairs under a new address, and since the scan is address-only (2026-09-05)
    a stale configured MAC is the ONE way a healthy, advertising ring reads as absent.

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
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))

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
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))
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
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))
    out = capsys.readouterr().out
    assert "20260719010000" in out, "the skipped session must be named"
    assert "20260720010000" in out, "and so must the pulled one"


def test_an_already_present_session_says_so_with_its_size(tmp_path, monkeypatch, capsys):
    blob = b"\x01\x03" + b"z" * 90
    ring = FakeRing(["20260720010000"], blob)
    _install(monkeypatch, ring)
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))
    capsys.readouterr()

    ring2 = FakeRing(["20260720010000"], blob)
    _install(monkeypatch, ring2)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))
    out = capsys.readouterr().out
    assert got == [], "an already-present session is not reported as newly written"
    assert "92" in out, "the size it matched on must be named — that is the evidence for skipping"
    assert len(_dat(tmp_path)) == 1, "and nothing is re-downloaded"


# ── every diagnostic branch names the value it is about ─────────────────────────────────────────────
# Each of these branches is already exercised by test_pull_session.py for its RETURN value. None of
# them was ever exercised with the output captured, so the line that tells an operator WHY could be
# emptied without a single test noticing. Same rule throughout: assert the value, never the wording.

def test_a_traversal_id_is_named_in_the_refusal(tmp_path, monkeypatch, capsys):
    """`which` comes from the LAN webmon /api/pull body — untrusted. The containment guard refuses it,
    and the refusal has to say WHICH value was refused or the operator cannot tell a typo from an
    attack."""
    _install(monkeypatch, FakeRing(["20260719010000"], b"\x01\x03" + b"z" * 90))
    evil = "../" * 40 + "evil"
    assert _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), evil, 0, None, "0000")) == []
    out = capsys.readouterr().out
    assert "evil" in out, "the refused id must appear — a bare 'skipping' names nothing"
    assert "escapes" in out or "output dir" in out


def test_an_implausible_id_is_named_in_the_refusal(tmp_path, monkeypatch, capsys):
    _install(monkeypatch, FakeRing(["20260719010000"], b"\x01\x03" + b"z" * 90))
    assert _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "notastamp", 0, None, "0000")) == []
    assert "notastamp" in capsys.readouterr().out


def test_an_implausible_size_reports_the_size_it_got(tmp_path, monkeypatch, capsys):
    """The message is only actionable if it says WHAT SIZE came back — 0 and a huge number are
    different faults. It used to advise "try a different --ftype", which was never a file type but
    this frame's byte OFFSET, so the advice could not work; the size half was always the useful
    half and is what this pins."""
    blob = b"\x01\x03" + b"z" * 90
    _install(monkeypatch, FakeRing(["20260719010000", "20260720010000"], blob, declared_seq=[0, len(blob)]))
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))
    out = capsys.readouterr().out
    assert "0" in out and "implausible size" in out
    assert "try a different --ftype" not in out, "the misdiagnosis is back"


def test_the_connection_lines_name_the_device_and_the_mtu(tmp_path, monkeypatch, capsys):
    """MTU decides the download chunk size, so a wrong one is the difference between a 20 s pull and a
    10 min one. It is reported once, at connect, and nowhere else."""
    ring = FakeRing(["20260720010000"], b"\x01\x03" + b"z" * 90)
    _install(monkeypatch, ring)
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))
    out = capsys.readouterr().out
    assert "D1:98:62:7C:92:B3" in out, "the address actually connected to must be named"
    assert "O2Ring S8AW" in out, "and the advertised name, so a wrong-peer connect is visible"
    assert "517" in out, "the negotiated MTU must be reported — it sets the chunk size"


def test_an_empty_flash_says_so_rather_than_printing_nothing(tmp_path, monkeypatch, capsys):
    _install(monkeypatch, FakeRing([], b""))
    assert _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "latest", 0, None, "0000")) == []
    out = capsys.readouterr().out
    assert "0" in out, "the count from the listing must be reported, even when it is zero"
    assert "no sessions" in out.lower() or "nothing to pull" in out.lower()


def test_the_download_reports_its_offset_against_the_declared_size(tmp_path, monkeypatch, capsys):
    """The progress line is the only signal during a multi-minute pull over BLE. A blob larger than one
    chunk forces more than one iteration, which is the only way this line is reached at all."""
    # the line fires on `off % (512*40) < len(chunk)`, i.e. once every 20 KB of transfer — so the blob
    # has to cross that boundary or the branch is never reached at all. 1500 bytes does not.
    blob = b"\x01\x03" + b"y" * (512 * 45)
    ring = FakeRing(["20260720010000"], blob, chunk=512)
    _install(monkeypatch, ring)
    got = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))
    out = capsys.readouterr().out
    assert got, "the multi-chunk download must still complete"
    assert str(len(blob)) in out, "the declared size must appear in the progress line"
    assert "/" in out and "%" in out, "progress is offset/size and a percentage"


# ── an incomplete download must not occupy the final path ────────────────────────────────────────────
# CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS §3 carried this as "noticed, not reproduced — and it is the same
# defect §C5 fixed one module over, so it is likely real". Reproduced 2026-08-05: a mid-transfer
# timeout at offset 512 of 3002 wrote a 512-byte `<session>.dat` at the FINAL path and returned it in
# `saved_paths`. The sidecar did record `bytes` vs `declared_size`, so the truth was written down — just
# not where anything globbing `*.dat` would look.

class _Truncating(FakeRing):
    """Stops answering FILE_DATA part-way, which is what a ring carried out of range does."""

    def __init__(self, *a, stop_after=1, **k):
        super().__init__(*a, **k)
        self.data_replies = 0
        self.stop_after = stop_after

    async def write_gatt_char(self, char, frame, response=None):
        if frame[1] == oxyii.OP_FILE_DATA:
            self.data_replies += 1
            if self.data_replies > self.stop_after:
                self.writes.append(frame)
                return                      # silence — `_wait` raises asyncio.TimeoutError
        return await super().write_gatt_char(char, frame, response=response)


def _fast_wait(monkeypatch):
    """20 s per chunk is the production timeout; the test wants the same path in milliseconds."""
    orig = pull_session._wait

    async def quick(q, op, timeout=20.0):
        return await orig(q, op, timeout=0.05)
    monkeypatch.setattr(pull_session, "_wait", quick)


def test_a_truncated_pull_leaves_no_dat_at_the_final_path(tmp_path, monkeypatch):
    blob = b"\x01\x03" + bytes(3000)
    ring = _Truncating(["20260720010000"], blob, chunk=512, stop_after=1)
    _install(monkeypatch, ring)
    _fast_wait(monkeypatch)
    saved = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))

    dats = list(tmp_path.rglob("*.dat"))
    parts = list(tmp_path.rglob("*.dat.part"))
    assert dats == [], f"a short download must not look like a session: {dats}"
    assert len(parts) == 1, "the bytes are kept, under a name nothing mistakes for a recording"
    assert parts[0].stat().st_size == 512 < len(blob)
    # Reported, but as what it is. The prior design surfaced partials in `saved_paths` on the grounds
    # that the data is real, and that is kept — the caller feeds these to the API's `new_files`.
    assert len(saved) == 1 and saved[0].endswith(".dat.part"), \
        f"the partial is still reported, under a name that says so: {saved}"


def test_the_partial_still_carries_its_sidecar(tmp_path, monkeypatch):
    """Keeping the bytes without the explanation would just move the problem."""
    import json as _json
    blob = b"\x01\x03" + bytes(3000)
    _install(monkeypatch, _Truncating(["20260720010000"], blob, chunk=512, stop_after=1))
    _fast_wait(monkeypatch)
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))
    meta = list(tmp_path.rglob("*.dat.part.meta.json"))
    assert len(meta) == 1, "the sidecar rides whichever file actually exists"
    j = _json.loads(meta[0].read_text())
    assert j["bytes"] == 512 and j["declared_size"] == len(blob)
    assert j["finalized"] is False


def test_a_COMPLETE_pull_still_lands_at_the_final_path(tmp_path, monkeypatch):
    """The control. Renaming on completion must not break the ordinary case — and no `.part` may
    survive a good pull, or the next run would find litter it cannot explain."""
    blob = b"\x01\x03" + bytes(3000)
    _install(monkeypatch, FakeRing(["20260720010000"], blob, chunk=512))
    saved = _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", 0, None, "0000"))
    dats = list(tmp_path.rglob("*.dat"))
    assert len(dats) == 1 and dats[0].stat().st_size == len(blob)
    assert list(tmp_path.rglob("*.part")) == [], "a completed pull leaves no .part behind"
    assert saved and saved[0].endswith(".dat")




# ── an unreadable sidecar is not "a session with no metadata" ────────────────────────────────────────
# Found by triaging capture.py's swallowing `except` handlers (DEEP-AUDIT-FOLLOWUPS §3's carried-forward
# list). `session_meta` returned a bare `{}` on ANY failure to read `<file>.meta.json`, and monitor.html
# renders that as a clean `✓ <filename>` with the size simply absent — indistinguishable from success.
#
# The sidecar is where the SHORTFALL lives: `bytes` vs `declared_size` is how a truncated pull is told
# from a whole one. A sidecar we cannot read is precisely the case where saying nothing is worst.
#
# NOTE: the first version of these tests RE-IMPLEMENTED the function's body and asserted on the copy —
# the anti-pattern this repo's own audit records as "a test that re-implements its subject tests
# nothing". It passed while proving nothing. `session_meta` was a closure, which is what invited that;
# hoisting it to module level is why these can call the real thing.
import capture as _capture


def test_a_readable_sidecar_is_returned_verbatim(tmp_path):
    p = tmp_path / "a.dat"
    p.write_bytes(b"x")
    (tmp_path / "a.dat.meta.json").write_text('{"bytes": 7, "declared_size": 7}')
    assert _capture.session_meta(str(p)) == {"bytes": 7, "declared_size": 7}


def test_a_corrupt_sidecar_says_UNREADABLE_not_empty(tmp_path, caplog):
    p = tmp_path / "b.dat"
    p.write_bytes(b"x")
    (tmp_path / "b.dat.meta.json").write_text("{ this is not json")
    with caplog.at_level("WARNING"):
        m = _capture.session_meta(str(p), "Ring")
    assert m.get("unreadable") is True, "a corrupt sidecar must say so, not vanish into {}"
    assert m.get("reason") == "JSONDecodeError", m
    assert m != {}, "the bare {} is what made this indistinguishable from a real empty session"
    assert "unreadable" in caplog.text, "and it must reach the journal, not only the API"


def test_a_MISSING_sidecar_is_unreadable_too(tmp_path):
    """pull_session writes the sidecar immediately after the data, so an absent one is not 'normal'."""
    p = tmp_path / "c.dat"
    p.write_bytes(b"x")
    m = _capture.session_meta(str(p))
    assert m.get("unreadable") is True and m.get("reason") == "FileNotFoundError", m
