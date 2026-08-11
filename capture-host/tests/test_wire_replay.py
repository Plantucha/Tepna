# tepna-capture — tests/test_wire_replay.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# KNOWN-ANSWER TESTS AGAINST REAL DEVICE BYTES. 48 exchanges recorded off a Polar Verity Sense and a
# Polar H10 (`tests/wire/`), replayed through the shipped parsers.
#
# The value is not extra coverage — it is that these assertions cannot be satisfied by agreeing with
# ourselves. Every other test in this suite feeds the parsers bytes some human wrote while reading
# those parsers; these feed them bytes a device sent. That distinction is the whole subject: on
# 2026-08-11 the parser and three of its fakes agreed on a 3–4 byte control-point envelope and the
# hardware had been sending 5 all along.

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import polar_pmd as pmd            # noqa: E402
import wire_replay                 # noqa: E402

ALL = wire_replay.all_transcripts()
PAIRS = [(name, s, r) for name, doc in ALL for s, r in wire_replay.exchanges(doc)]


def test_the_corpus_is_present_and_non_vacuous():
    """A file-driven suite that silently finds nothing is the failure mode this whole file is about."""
    assert len(ALL) >= 2, f"expected both devices' transcripts, found {[n for n, _ in ALL]}"
    assert len(PAIRS) >= 40, f"only {len(PAIRS)} recorded exchanges — did a fixture get truncated?"


@pytest.mark.parametrize("name,sent,reply", PAIRS, ids=[f"{n}:{s.hex()}" for n, s, _ in PAIRS])
def test_every_real_reply_carries_the_envelope_the_SDK_describes(name, sent, reply):
    """`[0xF0, op, meas, status, moreFlag, …]` — status at index 3, payload from 5, and payload ONLY on
    success (`PmdControlPointResponse.kt`).

    Three fakes in this suite emitted a 3- or 4-byte SUCCESS envelope and passed for years, because the
    parser they were written against began reading at the status byte.

    ⚠️ THE FIRST CUT OF THIS TEST ASSERTED `len >= 5` FOR EVERYTHING AND WAS WRONG — derived from the
    Verity transcript alone (minimum 5) and generalised. The H10 answers an unimplemented op with a
    4-byte frame and refuted it immediately. Measured across both devices: SUCCESS n=29, min 5; ERROR
    n=19, min 4 — exactly the SDK's rule, since an error carries no parameters and so needs no
    moreFlag. Generalising from one device is the same mistake the corpus exists to prevent, and it
    caught the author of the corpus doing it."""
    assert reply[0] == 0xF0, f"{name}: a control-point reply that is not a response frame"
    assert reply[1] == sent[0], f"{name}: reply echoes op {reply[1]:#04x}, asked {sent[0]:#04x}"
    assert len(reply) >= 4, (
        f"{name}: {reply.hex()} is {len(reply)} bytes — the STATUS lives at index 3, so nothing "
        f"shorter can be interpreted at all")
    if reply[3] == 0x00:
        assert len(reply) >= 5, (
            f"{name}: {reply.hex()} claims SUCCESS in {len(reply)} bytes, but a successful reply "
            f"carries a moreFlag at [4] and its payload from [5]. A fake emitting this shape puts the "
            f"payload two bytes early — which is precisely how three of them passed against a parser "
            f"that read from index 3")


@pytest.mark.parametrize("name,sent,reply", PAIRS, ids=[f"{n}:{s.hex()}" for n, s, _ in PAIRS])
def test_an_ERROR_reply_never_yields_DATA_from_any_parser(name, sent, reply):
    """The 2026-08-11 defect, checked against the bytes that exposed it. The H10 answers op 5 with
    `f0050001` (ERROR_INVALID_OP_CODE) and the old parser returned `{ppg: "none"}` — a measurement
    state, for a stream that device does not physically have, manufactured out of an error code.

    The SDK is explicit that parameters are only populated on SUCCESS
    (`PmdControlPointResponse.kt`), so every parser must return empty on any non-zero status."""
    if reply[3] == 0x00:
        return                                   # SUCCESS — the payload is real, checked elsewhere
    assert pmd.parse_status_response(reply) == {}, f"{name}: {reply.hex()} produced measurement state"
    assert pmd.parse_settings_response(reply) == {}, f"{name}: {reply.hex()} produced settings"


def test_the_recorded_menus_are_what_the_parser_reads_back():
    """Known answers, independently corroborated by the daemon's own journal lines on the box
    ("ppg options: rate_hz=[…]"). If `parse_settings_response` ever drifts, these move with the code
    and the corpus does not."""
    verity = wire_replay.load_transcript("verity-sense-INW4J-fw0.1.5.json")
    got = {}
    for sent, reply in wire_replay.exchanges(verity):
        if sent[0] == 0x01 and len(reply) > 3 and reply[3] == 0x00:
            got[sent[1]] = pmd.parse_settings_response(reply).get(0x00)
    # Non-SDK-mode Verity: PPG is 55-only — the fact that made `rates: {ppg: 176}` a silent no-op.
    assert got[pmd.PPG] == [55]
    assert got[pmd.ACC] == [52]
    assert got[pmd.GYRO] == [52]
    assert got[pmd.MAG] == [10, 20, 50, 100]
    # …and the OFFLINE variants are a DIFFERENT, narrower menu — the ~2 MB flash budget showing
    # through the protocol, which is why offline PPG cannot cover a night.
    assert got[pmd.ACC | pmd.OFFLINE_BIT] == [13, 26, 52]
    assert got[pmd.GYRO | pmd.OFFLINE_BIT] == [13, 26, 52]


def test_the_H10_transcript_pins_what_that_device_cannot_do():
    """Measured 2026-08-10 and it settles the H10 recording design: no SDK mode, no PMD offline
    recording, and no way to ask it what it is recording."""
    h10 = wire_replay.load_transcript("polar-h10-fw5.0.0.json")
    by_cmd = {s: r for s, r in wire_replay.exchanges(h10)}
    assert by_cmd[bytes([0x05])][3] == 0x01, "MEASUREMENT_STATUS is INVALID_OP_CODE on the H10"
    assert by_cmd[bytes([0x01, pmd.ECG | pmd.OFFLINE_BIT])][3] == 0x02, \
        "the offline bit is an INVALID MEASUREMENT TYPE to an H10, not a recording flag"
    assert h10["features"]["supported"] == ["acc", "ecg"], "ECG + ACC and nothing else"


def test_the_replay_fake_REFUSES_a_command_the_device_never_answered():
    """The property that makes it a recording rather than a fake: it cannot invent. A test that needs
    an unrecorded command has to go and record it."""
    import asyncio
    cp = wire_replay.ReplayControlPoint(wire_replay.load_transcript("polar-h10-fw5.0.0.json"))
    assert asyncio.run(cp(bytes([0x05]))).hex() == "f0050001"
    with pytest.raises(wire_replay.UnrecordedCommand):
        asyncio.run(cp(bytes([0x02, 0x99])))
    assert cp.sent[-1] == bytes([0x02, 0x99]), "even a refused command is recorded as asked"


def test_the_shipped_parsers_survive_every_recorded_reply():
    """No exceptions across the whole corpus. Weak on its own, and it is the floor: a parser that
    raises on real hardware output fails before any semantic question is reachable."""
    for name, sent, reply in PAIRS:
        pmd.parse_status_response(reply)
        pmd.parse_settings_response(reply)
        pmd.parse_sdk_mode_status(reply)
        assert pmd.is_control_response(reply), f"{name}: {reply.hex()}"
