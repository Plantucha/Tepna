# tepna-capture — tests/test_muse_athena.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Known-answer tests for the Muse S Athena tokeniser and unpackers (muse_athena.py, PURE).
# Every packet here is SYNTHETIC, packed bit by bit through a string of bits, a different method from
# the module's integer shifts. No captured packet is committed: a notification of the data
# characteristic carries the wearer's EEG, and captured fixtures stay off every public surface.

import muse_athena as M


def _pack(values, width):
    """Pack fields LSB-first through a bit string (independent of the module's method)."""
    bits = "".join(format(v & ((1 << width) - 1), f"0{width}b")[::-1] for v in values)
    bits += "0" * (-len(bits) % 8)
    return bytes(int(bits[i : i + 8][::-1], 2) for i in range(0, len(bits), 8))


def _rec(tag, index, tick, data):
    return bytes([tag, index]) + tick.to_bytes(3, "little") + data


def _pkt(counter, *records):
    body = b"".join(records)
    return bytes([M.HEADER_LEN + len(body), counter]) + bytes(7) + body


def test_a_mixed_packet_tokenises_in_wire_order_with_its_header():
    """The shape of the probed stream (brief §2): EEG, motion and EEG records in one notification."""
    raw = _pkt(
        3,
        _rec(M.TAG_EEG, 9, 2379190, bytes(28)),
        _rec(M.TAG_MOTION, 0, 1780693, bytes(36)),
        _rec(M.TAG_EEG, 10, 2457315, bytes(28)),
    )
    pkt, why = M.tokenise(raw)
    assert why is None and pkt.counter == 3 and pkt.header == raw[2:9]
    assert [(r.tag, r.index, r.tick) for r in pkt.records] == [
        (M.TAG_EEG, 9, 2379190),
        (M.TAG_MOTION, 0, 1780693),
        (M.TAG_EEG, 10, 2457315),
    ]
    assert all(len(r.data) == M.RECORD_SIZE[r.tag] - M.RECORD_HEAD for r in pkt.records)
    assert M.tick_seconds(2379190, 2457315) == 1 / 128  # one EEG record period: 78 125 ticks


def test_the_three_stored_tags_tokenise_and_stay_raw():
    """0x11, 0x34 and 0x35 are stored as received (brief §6.5): each must tokenise at its own size."""
    recs = [_rec(tag, 1, 2, bytes(range(M.RECORD_SIZE[tag] - M.RECORD_HEAD))) for tag in (M.TAG_11, M.TAG_34, M.TAG_35)]
    pkt, why = M.tokenise(_pkt(1, *recs))
    assert why is None
    assert [len(r.data) for r in pkt.records] == [28, 30, 40]


def test_eeg_samples_are_two_samples_of_eight_channels_sample_after_sample():
    vals = list(range(100, 116))
    pkt, _ = M.tokenise(_pkt(1, _rec(M.TAG_EEG, 0, 0, _pack(vals, 14))))
    assert M.eeg_samples(pkt.records[0]) == [tuple(range(100, 108)), tuple(range(108, 116))]
    assert M.eeg_samples(M.Record(M.TAG_OPTICS, 0, 0, bytes(40))) is None
    assert len(M.EEG_ELECTRODES) == 4


def test_battery_is_the_first_u16_over_256_and_only_from_a_whole_0x88_record():
    data = (0x4080).to_bytes(2, "little") + bytes(M.RECORD_SIZE[M.TAG_BATTERY] - M.RECORD_HEAD - 2)
    assert M.battery_pct(M.Record(M.TAG_BATTERY, 0, 0, data)) == 64.5
    assert M.battery_pct(M.Record(M.TAG_BATTERY, 0, 0, data[:-1])) is None
    assert M.battery_pct(M.Record(M.TAG_53, 0, 0, data)) is None


def test_frame_counter_reads_a_trusted_header_only():
    good = _pkt(42, _rec(M.TAG_EEG, 0, 0, bytes(28)))
    assert M.frame_counter(good) == 42
    assert M.frame_counter(_pkt(43, bytes([0x99]) + bytes(5))) == 43  # a record fault keeps the counter
    assert M.frame_counter(good[:8]) is None
    assert M.frame_counter(bytes([good[0] + 1]) + good[1:]) is None


def test_tick_clock_unwraps_forward_across_the_wrap_and_steps_back_a_little():
    c = M.TickClock()
    assert c.ticks is None
    assert c.feed(M.TICK_MOD - 10) == M.TICK_MOD - 10
    assert c.feed(5) == M.TICK_MOD + 5  # forward 15 ticks across the wrap
    assert c.feed(1) == M.TICK_MOD + 1  # a slightly older record steps back, never forward a wrap
    ns = c.ns(78126)
    assert ns == (M.TICK_MOD + 78126) * 100 and type(ns) is int


def test_a_command_is_length_then_ascii_then_a_line_feed():
    assert M.command("dc001") == b"\x06dc001\n"
    assert M.command("h") == b"\x02h\n"


def test_the_start_sequence_carries_the_preset_and_the_stop_halts():
    seq = M.start_sequence("p1045")
    assert seq == ("h", "v6", "s", "h", "p1045", "s", "dc001", "dc001", "L1")
    assert M.STOP_SEQUENCE == ("s", "h")


def _frag(text):
    return bytes([len(text)]) + text.encode()


def test_control_replies_join_fragments_until_the_braces_balance():
    r = M.ControlReplies()
    assert r.feed(_frag('{"bp":7')) == []
    assert r.feed(_frag('2.5,"x":{"y":1}}')) == [{"bp": 72.5, "x": {"y": 1}}]


def test_control_replies_split_two_in_one_fragment_and_drop_text_outside():
    r = M.ControlReplies()
    assert r.feed(_frag('ab{"a":1}cd{"b":2}{"c"')) == [{"a": 1}, {"b": 2}]
    assert r.feed(_frag(":3}")) == [{"c": 3}]


def test_control_replies_keep_an_unparsable_reply_as_text_and_ignore_an_empty_fragment():
    r = M.ControlReplies()
    assert r.feed(b"") == []
    assert r.feed(_frag("{rc:0}")) == ["{rc:0}"]
    assert r.feed(bytes([9]) + b"}{") == []  # length byte past the end: only the bytes present count
    assert r.feed(_frag('"k":1}')) == [{"k": 1}]


def test_synthetic_eeg_fields_round_trip_in_wire_order():
    vals = [0, 1, 8191, 8192, 16383, 5, 6, 7, 100, 200, 300, 400, 16000, 2, 3, 4]
    pkt, why = M.tokenise(_pkt(7, _rec(M.TAG_EEG, 250, 0xABCDEF, _pack(vals, 14))))
    assert why is None
    r = pkt.records[0]
    assert (r.index, r.tick) == (250, 0xABCDEF) and M.eeg_fields(r) == vals


def test_synthetic_optics_round_trip():
    vals = [(i * 65537 + 3) % (1 << 20) for i in range(16)]
    pkt, _ = M.tokenise(_pkt(1, _rec(M.TAG_OPTICS, 0, 1, _pack(vals, 20))))
    assert M.optics(pkt.records[0]) == vals


def test_synthetic_motion_round_trip_is_signed_and_sample_major():
    s = [(1, -1, 32767, -32768, 100, -100), (2, -2, 0, 0, 200, -200), (3, -3, 5, -5, 300, -300)]
    pkt, _ = M.tokenise(_pkt(1, _rec(M.TAG_MOTION, 0, 1, _pack([v for t in s for v in t], 16))))
    assert M.motion(pkt.records[0]) == s


def test_unresolved_records_stay_raw():
    pkt, _ = M.tokenise(_pkt(1, _rec(M.TAG_53, 4, 9, bytes(range(24))), _rec(M.TAG_88, 5, 9, bytes(range(20)))))
    assert [r.data for r in pkt.records] == [bytes(range(24)), bytes(range(20))]


def test_an_unpacker_refuses_another_tag_and_a_wrong_size():
    eeg = M.Record(M.TAG_EEG, 0, 0, bytes(28))
    assert M.optics(eeg) is None and M.motion(eeg) is None
    assert M.eeg_fields(M.Record(M.TAG_OPTICS, 0, 0, bytes(40))) is None
    assert M.eeg_fields(M.Record(M.TAG_EEG, 0, 0, bytes(27))) is None
    assert M.optics(M.Record(M.TAG_OPTICS, 0, 0, bytes(39))) is None
    assert M.motion(M.Record(M.TAG_MOTION, 0, 0, bytes(35))) is None


def test_a_malformed_packet_is_refused_with_a_named_reason_and_yields_nothing():
    good = _pkt(1, _rec(M.TAG_EEG, 0, 0, bytes(28)))
    assert M.tokenise(good[:8]) == (None, "short")
    assert M.tokenise(bytes([good[0] + 1]) + good[1:]) == (None, "length-byte")
    assert M.tokenise(_pkt(1, bytes([0x99]) + bytes(32))) == (None, "unknown-tag")
    assert M.tokenise(_pkt(1, _rec(M.TAG_EEG, 0, 0, bytes(27)))) == (None, "truncated-record")
    assert M.tokenise(_pkt(1)) == (None, "no-record")
    # the refusal of a later record refuses the whole packet: a half-read packet is not a packet
    assert M.tokenise(_pkt(1, _rec(M.TAG_EEG, 0, 0, bytes(28)), bytes([0x99]) + bytes(10))) == (None, "unknown-tag")


def test_lost_between_counts_a_gap_and_wraps():
    assert M.lost_between(None, 17) == 0
    assert M.lost_between(4, 5) == 0
    assert M.lost_between(4, 8) == 3
    assert M.lost_between(255, 0) == 0
    assert M.lost_between(250, 3) == 8
    assert M.lost_between(9, 9) == 255  # a repeat is not "nothing lost": the caller must look at the tick


def test_tick_seconds_crosses_one_wrap():
    assert M.tick_seconds(M.TICK_MOD - 78125, 0) == 78125 / M.TICK_HZ


def test_unpack_lsb_drops_trailing_bits_and_sign_extends():
    assert M.unpack_lsb(bytes([0xFF, 0x01]), 5) == [31, 15, 0]
    assert M.unpack_lsb(bytes([0xFF, 0x7F]), 16, signed=True) == [32767]
    assert M.unpack_lsb(bytes([0x00, 0x80]), 16, signed=True) == [-32768]


def test_tick_clock_reads_half_a_wrap_as_a_step_back_and_less_than_half_as_forward():
    c = M.TickClock()
    c.feed(0)
    assert c.feed(M.TICK_MOD // 2) == -(M.TICK_MOD // 2)
    c = M.TickClock()
    c.feed(0)
    assert c.feed(M.TICK_MOD * 2 // 5) == M.TICK_MOD * 2 // 5


def test_battery_reads_two_bytes_only():
    n = M.RECORD_SIZE[M.TAG_BATTERY] - M.RECORD_HEAD
    assert M.battery_pct(M.Record(M.TAG_BATTERY, 0, 0, bytes([0x80, 0x40, 0x01]) + bytes(n - 3))) == 64.5


def test_a_packet_of_exactly_the_header_length_has_a_counter():
    assert M.frame_counter(bytes([M.HEADER_LEN, 77]) + bytes(M.HEADER_LEN - 2)) == 77


def test_unpack_lsb_gives_one_field_per_whole_width_and_no_more():
    assert M.unpack_lsb(bytes(range(1, 9)), 8) == list(range(1, 9))


def test_control_replies_read_only_the_bytes_the_length_byte_counts():
    """Bytes past the length byte are padding: they never join the reply."""
    r = M.ControlReplies()
    assert r.feed(bytes([5]) + b'{"a":' + b"zz}") == []
    assert r.feed(_frag("1}")) == [{"a": 1}]


def test_control_replies_decode_as_ascii_and_replace_a_byte_outside_it():
    body = b'{"k":"\xc3\xa9"}'
    assert M.ControlReplies().feed(bytes([len(body)]) + body) == [{"k": "\ufffd\ufffd"}]
