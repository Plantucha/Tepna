# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""THE STORED FILE TYPE SELECTS A COMMAND FAMILY — IT WAS NEVER A FIELD.

Vendor SDK sources (OxyII family; S8AW2100) carry two transfer families over the same 0xA5 envelope:
the oximetry store (`OP_FILE_*`, 0xF1-0xF4, all this module ever spoke) and a stored raw-PPG store
(0x06-0x09). `file_start_frame`'s trailing u32 was named `ftype` and is an OFFSET — so every value
`--ftype N` / `pull.ftype: N` ever took asked the SAME family to start reading at byte N, and the
PPG store was unreachable from here.

⚠️ THE 0x06-0x09 FRAMES ARE UNPROBED. They have never been sent to a ring. These tests pin their
SHAPE, not their effect; a green run here is not a confirmed protocol.
"""
import pytest

import oxyii


def _decode(frame: bytes):
    """(cmd, payload) from an encoded frame — the envelope is `[0xA5][cmd][~cmd][flag][seq][lo][hi]…`."""
    assert frame[0] == 0xA5, frame[:1]
    n = int.from_bytes(frame[5:7], "little")
    return frame[1], frame[7:7 + n]


# ── the misnamed field ────────────────────────────────────────────────────────────────────────────
def test_THE_TRAILING_U32_IS_AN_OFFSET_AND_DEFAULTS_TO_ZERO():
    cmd, pl = _decode(oxyii.file_start_frame("20260906010203"))
    assert cmd == oxyii.OP_FILE_START
    assert pl[:14] == b"20260906010203" and pl[14:16] == b"\x00\x00"
    assert int.from_bytes(pl[16:20], "little") == 0


def test_A_NONZERO_FTYPE_RAISES_RATHER_THAN_SENDING_AN_OFFSET():
    """🔴 The whole misreading in one assertion. `ftype=3` did not select a file type — it asked the
    oximetry store to begin at byte 3. Silently sending that is how the folklore survived."""
    with pytest.raises(ValueError, match="OFFSET"):
        oxyii.file_start_frame("20260906010203", ftype=3)


def test_FTYPE_ZERO_IS_ACCEPTED_SO_EXISTING_CALLERS_KEEP_WORKING():
    assert oxyii.file_start_frame("20260906010203", ftype=0) == \
        oxyii.file_start_frame("20260906010203")


def test_AN_EXPLICIT_OFFSET_STILL_REACHES_THE_WIRE():
    """The field is real and resuming mid-file is a legitimate thing to ask for — it was only ever
    the NAME that was wrong."""
    _cmd, pl = _decode(oxyii.file_start_frame("20260906010203", 4096))
    assert int.from_bytes(pl[16:20], "little") == 4096


# ── the second family ─────────────────────────────────────────────────────────────────────────────
def test_THE_PPG_FAMILY_IS_FOUR_DISTINCT_OPCODES_NOT_A_FLAG():
    assert (oxyii.OP_PPG_FILE_LIST, oxyii.OP_PPG_FILE_START,
            oxyii.OP_PPG_FILE_DATA, oxyii.OP_PPG_FILE_END) == (0x06, 0x07, 0x08, 0x09)
    # ...and they are NOT the oximetry family, which is the point the brief got wrong.
    assert {0x06, 0x07, 0x08, 0x09}.isdisjoint(
        {oxyii.OP_FILE_LIST, oxyii.OP_FILE_START, oxyii.OP_FILE_DATA, oxyii.OP_FILE_END})


def test_PPG_LIST_IS_AN_EMPTY_PAYLOAD():
    cmd, pl = _decode(oxyii.ppg_file_list_frame())
    assert cmd == 0x06 and pl == b""


def test_PPG_START_IS_A_16_BYTE_NAME_PLUS_A_ZERO_OFFSET():
    cmd, pl = _decode(oxyii.ppg_file_start_frame("PPG0001"))
    assert cmd == 0x07 and len(pl) == 20
    assert pl[:16] == b"PPG0001".ljust(16, b"\x00")
    assert int.from_bytes(pl[16:20], "little") == 0


def test_A_LONG_NAME_IS_TRUNCATED_NOT_ALLOWED_TO_MALFORM_THE_FRAME():
    _cmd, pl = _decode(oxyii.ppg_file_start_frame(b"X" * 40))
    assert len(pl) == 20 and pl[:16] == b"X" * 16


def test_PPG_DATA_CARRIES_THE_OFFSET_AND_END_IS_EMPTY():
    cmd, pl = _decode(oxyii.ppg_file_data_frame(1234))
    assert cmd == 0x08 and int.from_bytes(pl, "little") == 1234
    cmd, pl = _decode(oxyii.ppg_file_end_frame())
    assert cmd == 0x09 and pl == b""


# ── the header, which must never invent a rate ───────────────────────────────────────────────────
def _hdr(rate=150, size=1000, lead=2, acc=65535, n=200):
    h = bytearray(n)
    h[16:18] = int(rate).to_bytes(2, "little")
    h[18:22] = int(size).to_bytes(4, "little")
    if n > 22:
        h[22] = lead
    if n >= 39:
        h[35:39] = int(acc).to_bytes(4, "little")
    return bytes(h)


def test_THE_HEADER_YIELDS_RATE_SIZE_LEAD_AND_SAMPLE_WIDTH():
    assert oxyii.parse_ppg_file_header(_hdr()) == {
        "sample_rate": 150, "sample_size": 1000, "lead_size": 2, "sample_bytes": 2}


@pytest.mark.parametrize("acc,width", [(0xFFFFFFFF, 4), (16777215, 3), (65535, 2), (7, 1)])
def test_THE_ACCURACY_SENTINEL_SELECTS_THE_SAMPLE_WIDTH(acc, width):
    assert oxyii.parse_ppg_file_header(_hdr(acc=acc))["sample_bytes"] == width


@pytest.mark.parametrize("buf", [b"", b"\x00" * 38, None])
def test_A_SHORT_HEADER_IS_NONE_NEVER_A_DEFAULT(buf):
    """🔴 The rule this parser exists to hold. Substituting the SDK's 150 Hz for a header we could
    not read would manufacture a rate, and every duration, epoch grid and export window downstream
    would inherit it in silence."""
    assert oxyii.parse_ppg_file_header(buf) is None


# 65535 rather than a bigger number: the field is a u16, so anything larger is not a header a ring
# could ever send — testing it would test my arithmetic, not the guard.
@pytest.mark.parametrize("rate,size", [(0, 1000), (65535, 1000), (150, 0)])
def test_AN_IMPLAUSIBLE_HEADER_IS_REFUSED_AS_FIRMLY_AS_A_SHORT_ONE(rate, size):
    assert oxyii.parse_ppg_file_header(_hdr(rate=rate, size=size)) is None


def test_THE_VENDOR_DEFAULT_IS_EXPORTED_BUT_NOT_USED_AS_A_FALLBACK():
    """It is there so a caller can COMPARE against the vendor default, not stand in for a missing
    header — so a refused header must not equal it."""
    assert oxyii.PPG_FILE_DEFAULT_RATE_HZ == 150
    assert oxyii.parse_ppg_file_header(b"\x00" * 38) is None


# ── the config gate, and the promise that today's behaviour is unchanged ─────────────────────────
from _srcscan import module_source


def test_DEFAULT_BEHAVIOUR_IS_BYTE_IDENTICAL_TO_BEFORE():
    """🔴 THE PROMISE OF THIS CHANGE. Nothing about the oximetry pull moved: the START frame the
    daemon sends for a given session is the same bytes it has always sent."""
    # MEASURED, not transcribed: this hex was produced by running `origin/main`'s own
    # `file_start_frame` before the change (git show origin/main:…/oxyii.py into a scratch dir), so
    # the assertion compares against the OLD implementation rather than restating the new one. A hex
    # literal copied out of the code under test would have proved only that I can copy.
    assert oxyii.file_start_frame("20260906010203").hex() == (
        "a5f20d000014003230323630393036303130323033000000000000d1")


def test_A_STRAY_PULL_FTYPE_IS_REFUSED_AT_CONFIG_LOAD_NOT_IGNORED():
    """A key that reads as a working switch and does nothing is how the misreading survived for
    months. Refusing it names the replacement in the same breath."""
    src = module_source("capture.py")
    i = src.index('config pull.ftype=')
    assert "byte OFFSET" in src[i - 200:i + 300]
    assert "pull.file_family" in src[i:i + 400]


def test_THE_FAMILY_KEY_ACCEPTS_ONLY_TWO_VALUES():
    src = module_source("capture.py")
    i = src.index('config pull.file_family=')
    assert "'oxy' or 'ppg'" in src[i:i + 120]


def test_THE_DAEMON_DOES_NOT_DISPATCH_THE_UNPROBED_FAMILY():
    """Built is not probed. The daemon may know the frames exist and must not send them: the first
    ring contact is owner-authorised separately."""
    src = module_source("capture.py")
    assert "UNPROBED and the daemon will not" in src
    for fn in ("ppg_file_list_frame", "ppg_file_start_frame",
               "ppg_file_data_frame", "ppg_file_end_frame"):
        assert fn not in src, f"capture.py dispatches {fn} — the family is unprobed"


def test_THE_CLI_NO_LONGER_OFFERS_THE_FLAG_THAT_NEVER_WORKED():
    src = module_source("pull_session.py")
    assert '"--ftype"' not in src, "--ftype is back; it was always a byte offset"
    assert '"--family"' in src and 'choices=("oxy", "ppg")' in src
    # ...and the misdiagnosis is gone from the MESSAGE. Checked on the print statement rather than
    # on the whole file: the comment above it quotes the old wording in order to say it was wrong,
    # and a whole-file scan would fail on the correction itself. (It did.)
    printed = "".join(l for l in src.splitlines() if "print(" in l or l.strip().startswith('f"'))
    assert "try a different --ftype" not in printed


# ── the CLI dry path and the config gate, driven rather than grepped ─────────────────────────────
import asyncio
import sys as _sys

import capture
import pull_session


def test_FAMILY_PPG_PRINTS_THE_FRAME_IT_WOULD_SEND_AND_SENDS_NOTHING(monkeypatch, capsys):
    """The dry path. It must be possible to SEE the frame without a ring hearing it — that is what
    keeps 'the code exists' and 'the protocol is confirmed' from collapsing into each other."""
    sent = []
    monkeypatch.setattr(pull_session, "pull", lambda *a, **k: sent.append(a))
    monkeypatch.setattr(_sys, "argv", ["pull_session.py", "--address", "AA:BB", "--out", "/tmp/z",
                                       "--family", "ppg", "--list"])
    with pytest.raises(SystemExit) as e:
        pull_session.main()
    assert e.value.code == 0
    out = capsys.readouterr().out
    assert "UNPROBED" in out and "no frame is sent" in out
    assert oxyii.ppg_file_list_frame().hex() in out
    assert not sent, "the dry path dispatched a pull"


def test_FAMILY_PPG_WITHOUT_LIST_STILL_SENDS_NOTHING(monkeypatch, capsys):
    monkeypatch.setattr(_sys, "argv", ["pull_session.py", "--address", "AA:BB", "--out", "/tmp/z",
                                       "--family", "ppg"])
    with pytest.raises(SystemExit) as e:
        pull_session.main()
    assert e.value.code == 0
    assert "would send" not in capsys.readouterr().out


def _cfg(pull_extra):
    return {"pull": {"auto": True, **pull_extra},
            "devices": [{"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S",
                         "address": "D1:98:62:7C:92:B3", "device_id": "12345678",
                         "streams": ["spo2"]}]}


def test_A_STRAY_PULL_FTYPE_RAISES_AT_LOAD_AND_NAMES_ITS_REPLACEMENT():
    """Not ignored. A key that reads as a working switch and silently does nothing is how the
    misreading survived; the error has to say what to use instead."""
    with pytest.raises(ValueError) as e:
        asyncio.run(capture.charger_pull_poller(_cfg({"ftype": 3}), "/tmp"))
    assert "byte OFFSET" in str(e.value) and "pull.file_family" in str(e.value)


def test_FTYPE_ZERO_IS_STILL_ACCEPTED_SO_AN_OLD_CONFIG_KEEPS_BOOTING(monkeypatch):
    """The value every existing config actually holds must not become a boot failure."""
    capture._STOP.set()
    try:
        asyncio.run(capture.charger_pull_poller(_cfg({"ftype": 0}), "/tmp"))
    finally:
        capture._STOP.clear()


def test_AN_UNKNOWN_FAMILY_IS_REFUSED_AT_LOAD_NOT_AT_USE():
    """A typo'd family surfacing hours later, mid-night, is the shape this repo keeps paying for."""
    with pytest.raises(ValueError, match="'oxy' or 'ppg'"):
        asyncio.run(capture.charger_pull_poller(_cfg({"file_family": "pgp"}), "/tmp"))


def test_FAMILY_PPG_IN_CONFIG_WARNS_AND_STILL_PULLS_THE_OXIMETRY_STORE(caplog):
    """Configuring it must not quietly become dispatching it."""
    capture._STOP.set()
    try:
        with caplog.at_level("WARNING"):
            asyncio.run(capture.charger_pull_poller(_cfg({"file_family": "ppg"}), "/tmp"))
    finally:
        capture._STOP.clear()
    assert "UNPROBED" in caplog.text and "will not" in caplog.text
