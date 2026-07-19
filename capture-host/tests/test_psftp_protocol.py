# tepna-capture — tests/test_psftp_protocol.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The PS-FTP wire codec: hand-rolled proto2 encoders, the protobuf reader, RFC76 air-packet framing, and
# the query allowlist. All pure, all reverse-engineered, and all of it writes to a device we cannot
# easily inspect — so the tests are ROUND-TRIPS (encode -> parse -> same values) plus the safety
# properties, rather than golden byte strings nobody can re-derive if they change.

import datetime as dt

import pytest

import polar_psftp as ps


# ── varint + protobuf reader ────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("n", [0, 1, 127, 128, 300, 16383, 16384, 2**31, 2**63 - 1])
def test_uvarint_round_trips_through_the_reader(n):
    val, i = ps._read_varint(ps._uvarint(n), 0)
    assert val == n and i == len(ps._uvarint(n))


def test_uvarint_uses_the_continuation_bit_correctly():
    assert ps._uvarint(0) == b"\x00"
    assert ps._uvarint(127) == b"\x7f"            # single byte, no continuation
    assert ps._uvarint(128) == b"\x80\x01"        # continuation set on the first byte only
    assert all(b & 0x80 for b in ps._uvarint(300)[:-1])
    assert not ps._uvarint(300)[-1] & 0x80        # last byte always clears it


def test_parse_pb_fields_reads_varint_and_length_delimited():
    buf = ps._pb_uint(1, 2026) + ps._pb_msg(2, b"hello")
    assert ps._parse_pb_fields(buf) == {1: 2026, 2: b"hello"}


def test_parse_pb_fields_last_occurrence_wins():
    """Documented behaviour — a repeated field collapses to the last value."""
    assert ps._parse_pb_fields(ps._pb_uint(1, 1) + ps._pb_uint(1, 9))[1] == 9


def test_iter_fields_rejects_an_unknown_wire_type():
    """Wire types 3/4 (deprecated groups) must raise rather than silently desync the parser and return
    garbage fields for the rest of the buffer."""
    with pytest.raises(ValueError, match="bad protobuf wire type"):
        list(ps._iter_fields(bytes([(1 << 3) | 3])))


def test_iter_fields_handles_fixed32_and_fixed64():
    f32 = bytes([(1 << 3) | 5]) + b"\x01\x02\x03\x04"
    f64 = bytes([(2 << 3) | 1]) + b"\x01\x02\x03\x04\x05\x06\x07\x08"
    assert ps._parse_pb_fields(f32 + f64) == {1: b"\x01\x02\x03\x04", 2: bytes(range(1, 9))}


# ── directory listing ───────────────────────────────────────────────────────────────────────────────
def _entry(name: str, size: int) -> bytes:
    return ps._pb_msg(1, ps._pb_msg(1, name.encode()) + ps._pb_uint(2, size))


def test_parse_directory_reads_repeated_entries():
    buf = _entry("SESSION1.DAT", 1234) + _entry("SUB/", 0)
    assert ps._parse_directory(buf) == [("SESSION1.DAT", 1234), ("SUB/", 0)]


def test_parse_directory_defaults_a_missing_size_to_zero():
    assert ps._parse_directory(ps._pb_msg(1, ps._pb_msg(1, b"X.DAT"))) == [("X.DAT", 0)]


def test_parse_directory_skips_an_entry_with_no_name():
    """A nameless entry is unusable; it must be dropped, not surfaced as ("", 0) which would then be
    treated as a real file by the caller."""
    assert ps._parse_directory(ps._pb_msg(1, ps._pb_uint(2, 99))) == []


def test_parse_directory_survives_undecodable_utf8_in_a_name():
    out = ps._parse_directory(ps._pb_msg(1, ps._pb_msg(1, b"\xff\xfeBAD") + ps._pb_uint(2, 1)))
    assert len(out) == 1 and out[0][1] == 1        # replaced, not raised


def test_parse_directory_ignores_a_non_entry_field():
    assert ps._parse_directory(ps._pb_uint(7, 42) + _entry("A.DAT", 5)) == [("A.DAT", 5)]


# ── operation encoding ──────────────────────────────────────────────────────────────────────────────
def test_encode_operation_carries_command_and_path():
    buf = ps._encode_operation(ps.GET, "/U/0/SESSION1.DAT")
    assert ps._parse_pb_fields(buf) == {1: ps.GET, 2: b"/U/0/SESSION1.DAT"}


def test_encode_operation_handles_a_long_path_needing_a_multibyte_length():
    path = "/U/0/" + "A" * 200
    assert ps._parse_pb_fields(ps._encode_operation(ps.GET, path))[2].decode() == path


# ── the time queries: encode -> parse round-trip ────────────────────────────────────────────────────
def _decode_local_time(buf):
    f = ps._parse_pb_fields(buf)
    d, t = ps._parse_pb_fields(f[1]), ps._parse_pb_fields(f[2])
    return (dt.datetime(d[1], d[2], d[3], t.get(1, 0), t.get(2, 0), t.get(3, 0), t.get(4, 0) * 1000),
            f.get(3))


def test_set_local_time_round_trips_every_component():
    when = dt.datetime(2026, 7, 19, 13, 45, 7, 123000)
    got, tz = _decode_local_time(ps.encode_set_local_time(when, 0))
    assert got == when and tz == 0


def test_set_local_time_carries_millis_not_micros():
    """PbTime's field 4 is MILLIseconds. Writing micros would push the device's clock field out of range
    and is invisible unless the round-trip checks the unit."""
    buf = ps.encode_set_local_time(dt.datetime(2026, 1, 1, 0, 0, 0, 999000), 0)
    assert ps._parse_pb_fields(ps._parse_pb_fields(buf)[2])[4] == 999


@pytest.mark.parametrize("tz", [0, 60, 120, -240, -60])
def test_tz_offset_round_trips_including_negatives(tz):
    """proto2 int32 is a PLAIN varint with negatives sign-extended to 64 bits — not zigzag. A zigzag
    encoder here would put a wrong offset on the device, and -240 (US Eastern) is the live case."""
    _when, got = _decode_local_time(ps.encode_set_local_time(dt.datetime(2026, 7, 19, 1, 2, 3), tz))
    assert got == (tz & 0xFFFFFFFFFFFFFFFF if tz < 0 else tz)


def test_negative_int32_is_sign_extended_to_ten_bytes():
    body = ps._pb_int32(3, -240)[1:]
    assert len(body) == 10, "a sign-extended 64-bit negative varint is 10 bytes"


def test_set_system_time_marks_the_host_as_trusted():
    when = dt.datetime(2026, 7, 19, 6, 30, 0)
    f = ps._parse_pb_fields(ps.encode_set_system_time(when))
    assert f[3] == 1, "trusted must be set — the host is NTP-disciplined"
    d = ps._parse_pb_fields(f[1])
    assert (d[1], d[2], d[3]) == (2026, 7, 19)


# ── the query allowlist (safety) ────────────────────────────────────────────────────────────────────
def test_only_the_three_time_queries_are_permitted():
    for allowed in (ps.SET_SYSTEM_TIME, ps.SET_LOCAL_TIME, ps.GET_LOCAL_TIME):
        assert ps._encode_query_header(allowed)


@pytest.mark.parametrize("dangerous,what", [(12, "PREPARE_FIRMWARE_UPDATE"), (14, "REQUEST_START_RECORDING"),
                                            (0, "unset"), (13, "unknown"), (255, "out of range")])
def test_dangerous_query_ids_are_refused(dangerous, what):
    """This module is otherwise strictly read-only. The PbPFtpQuery enum shares its number space with
    firmware update and start-recording, so a wrong id does something far worse than set a clock."""
    with pytest.raises(ValueError, match="not a time query"):
        ps._encode_query_header(dangerous, what.encode())


def test_query_header_sets_the_query_marker_bit():
    """Top bit of byte 1 distinguishes a QUERY from a REQUEST; without it the device parses the id as a
    length and the whole frame is misread."""
    hdr = ps._encode_query_header(ps.GET_LOCAL_TIME)
    assert hdr[0] == ps.GET_LOCAL_TIME and hdr[1] & 0x80


def test_query_header_appends_params_verbatim():
    params = ps.encode_set_local_time(dt.datetime(2026, 7, 19, 1, 1, 1), 0)
    assert ps._encode_query_header(ps.SET_LOCAL_TIME, params)[2:] == params


# ── RFC76 framing ───────────────────────────────────────────────────────────────────────────────────
# The header byte is `next | status | (seq << 4)`, so the STATUS occupies bits 1-2 only — masking the
# whole low nibble also catches the `next` bit and makes a continuation LAST packet read 0x03.
MORE, LAST, STATUS = 0x06, 0x02, 0x06


def test_a_short_stream_is_one_LAST_packet():
    pkts = ps._chunk_rfc76(b"abc", frame_mtu=20)
    assert len(pkts) == 1
    assert pkts[0][0] & STATUS == LAST, "single packet must be LAST, not MORE"
    assert pkts[0][0] & 0x01 == 0, "the only packet is also the first, so next=0"
    assert pkts[0][1:] == b"abc"


def test_a_long_stream_splits_into_MORE_then_LAST_and_reassembles():
    stream = bytes(range(256)) * 2
    mtu = 20
    pkts = ps._chunk_rfc76(stream, frame_mtu=mtu)
    assert len(pkts) > 1
    assert all(len(p) <= mtu for p in pkts), "no packet may exceed the frame MTU"
    for p in pkts[:-1]:
        assert p[0] & STATUS == MORE, "non-final packets must be MORE"
    assert pkts[-1][0] & STATUS == LAST, "final packet must be LAST"
    assert b"".join(p[1:] for p in pkts) == stream, "payload must reassemble byte-identically"


def test_a_stream_that_exactly_fills_one_packet_is_still_LAST():
    """Boundary: remaining == frame_mtu-1 takes the LAST branch, not MORE. Getting this wrong emits a
    MORE with nothing following it and the device waits forever for a continuation."""
    pkts = ps._chunk_rfc76(bytes(19), frame_mtu=20)
    assert len(pkts) == 1 and pkts[0][0] & STATUS == LAST


def test_only_the_first_packet_clears_the_next_bit():
    pkts = ps._chunk_rfc76(bytes(200), frame_mtu=20)
    assert pkts[0][0] & 0x01 == 0, "first packet carries next=0"
    assert all(p[0] & 0x01 == 1 for p in pkts[1:]), "continuation packets carry next=1"


def test_the_sequence_number_increments_and_wraps_at_15():
    pkts = ps._chunk_rfc76(bytes(19 * 20), frame_mtu=20)
    seqs = [(p[0] >> 4) & 0x0F for p in pkts]
    assert seqs[:16] == list(range(16)), "seq must count 0..15"
    assert seqs[16] == 0, "seq must wrap to 0 after 15, not overflow into the status nibble"


def test_seq_wraps_in_place():
    s = ps._Seq()
    for expected in list(range(1, 16)) + [0]:
        s.inc()
        assert s.seq == expected


def test_request_packets_carry_the_length_header_with_the_top_bit_clear():
    body = ps._encode_operation(ps.GET, "/U/0/")
    pkts = ps._build_request_packets(body, frame_mtu=200)
    stream = b"".join(p[1:] for p in pkts)
    assert stream[0] == len(body) & 0xFF
    assert stream[1] == (len(body) >> 8) & 0x7F
    assert not stream[1] & 0x80, "top bit clear marks a REQUEST, not a QUERY"
    assert stream[2:] == body


def test_query_packets_route_through_the_allowlist():
    with pytest.raises(ValueError, match="not a time query"):
        ps._build_query_packets(12, b"", frame_mtu=20)


def test_build_query_packets_frames_the_header_and_params():
    params = ps.encode_set_system_time(dt.datetime(2026, 7, 19, 5, 0, 0))
    stream = b"".join(p[1:] for p in ps._build_query_packets(ps.SET_SYSTEM_TIME, params, frame_mtu=20))
    assert stream == ps._encode_query_header(ps.SET_SYSTEM_TIME, params)


# ── adapter plumbing ────────────────────────────────────────────────────────────────────────────────
def test_psftp_passes_the_adapter_pin_in_the_bluez_form():
    assert ps.PolarPsFtp("AA:BB:CC:DD:EE:FF", adapter="hci3")._kw == {"bluez": {"adapter": "hci3"}}
    assert ps.PolarPsFtp("AA:BB:CC:DD:EE:FF")._kw == {}
