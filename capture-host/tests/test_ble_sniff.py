# tepna-capture — tests/test_ble_sniff.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The two defects this module exists to prevent are BOTH tested here as decoys, because a parser
# that is merely "correct on good input" would not have caught either of them:
#
#   * `test_unreadable_file_is_loud_not_empty` — a file that cannot be read must not print like an
#     empty capture. That confusion cost an hour on 2026-09-04.
#   * `test_access_address_inside_the_payload_is_not_a_header` — the crude scan that reported 21
#     CONNECT_INDs where 4 existed matched the access address anywhere in the record. The decoy
#     packet here carries those bytes in its PAYLOAD and must not be parsed from them.

import struct

import pytest

import ble_sniff

RESMED = "04:CD:15:3A:0B:BD"
RESMED_WIRE = bytes.fromhex("bd0b3a15cd04")
PHONE_WIRE = bytes.fromhex("112233445566")
AA = ble_sniff.ADV_ACCESS_ADDRESS


def _pcap(*payloads: bytes) -> bytes:
    out = bytearray(b"\xd4\xc3\xb2\xa1" + b"\x00" * 20)
    for p in payloads:
        out += struct.pack("<IIII", 0, 0, len(p), len(p)) + p
    return bytes(out)


def _adv(pdu: int, addr: bytes = RESMED_WIRE, *, prefix: bytes = b"\x01\x02") -> bytes:
    """A nordic pseudo-header, then the access address, a 2-byte PDU header, then AdvA."""
    return prefix + AA + bytes([pdu, 0x0C]) + addr


def _connect_ind(initiator: bytes, advertiser: bytes) -> bytes:
    return _adv(ble_sniff.CONNECT_IND, initiator + advertiser)


def test_mac_reverses_wire_order():
    assert ble_sniff.mac(RESMED_WIRE) == RESMED


def test_summarise_counts_advertising_and_names_the_advertiser():
    s = ble_sniff.summarise(_pcap(_adv(0x0), _adv(0x0), _adv(0x2)))
    assert s["total"] == 3
    assert s["adv_channel"] == 3
    assert s["data_channel"] == 0
    assert s["pdus"] == {0x0: 2, 0x2: 1}
    assert s["advertisers"] == {RESMED: 3}


def test_data_channel_is_anything_without_the_advertising_access_address():
    s = ble_sniff.summarise(_pcap(_adv(0x0), b"\xde\xad\xbe\xef" * 4))
    assert s["data_channel"] == 1
    assert s["adv_channel"] == 1


def test_access_address_inside_the_payload_is_not_a_header():
    """The 2026-09-04 over-count: a crude scan read a PDU type out of payload bytes.

    Here the access address appears ONCE, at the header position, and the payload also contains a
    byte that would read as CONNECT_IND if anything scanned for types instead of anchoring.
    """
    pkt = _adv(0x0) + bytes([ble_sniff.CONNECT_IND]) * 8
    s = ble_sniff.summarise(_pcap(pkt))
    assert s["pdus"] == {0x0: 1}
    assert s["connects"] == []


def test_connect_ind_records_initiator_and_advertiser():
    s = ble_sniff.summarise(_pcap(_connect_ind(PHONE_WIRE, RESMED_WIRE)), follow=RESMED)
    assert s["connects"] == [("66:55:44:33:22:11", RESMED)]
    assert s["follow_connects"] == 1


def test_connect_ind_is_not_counted_as_an_advertiser():
    s = ble_sniff.summarise(_pcap(_connect_ind(PHONE_WIRE, RESMED_WIRE)))
    assert s["advertisers"] == {}


def test_follow_is_case_insensitive_and_counts_that_device_only():
    s = ble_sniff.summarise(_pcap(_adv(0x0), _adv(0x0, PHONE_WIRE)), follow=RESMED.lower())
    assert s["follow"] == RESMED
    assert s["follow_adv_packets"] == 2 - 1


def test_no_follow_leaves_the_followed_counts_at_zero():
    s = ble_sniff.summarise(_pcap(_adv(0x0)))
    assert s["follow"] is None
    assert s["follow_adv_packets"] == 0
    assert s["follow_connects"] == 0


def test_a_packet_ending_at_the_access_address_has_no_pdu_to_read():
    """Nothing after the access address: counted as advertising, but no type is invented."""
    s = ble_sniff.summarise(_pcap(b"\x01\x02" + AA))
    assert s["adv_channel"] == 1
    assert s["pdus"] == {}


def test_a_single_header_octet_is_enough_to_read_the_pdu_type():
    """Only the type octet is read, so one octet suffices — the length octet is never used."""
    s = ble_sniff.summarise(_pcap(b"\x01\x02" + AA + bytes([ble_sniff.CONNECT_IND])))
    assert s["pdus"] == {ble_sniff.CONNECT_IND: 1}
    assert s["connects"] == []


def test_short_body_yields_no_address():
    s = ble_sniff.summarise(_pcap(_adv(0x0, b"\x01\x02")))
    assert s["pdus"] == {0x0: 1}
    assert s["advertisers"] == {}
    s2 = ble_sniff.summarise(_pcap(_adv(ble_sniff.CONNECT_IND, b"\x01\x02")))
    assert s2["connects"] == []


def test_file_shorter_than_the_global_header_is_refused():
    with pytest.raises(ble_sniff.SniffError, match="not a pcap"):
        list(ble_sniff.iter_packets(b"\x00" * 8))


def test_truncated_record_header_is_refused():
    with pytest.raises(ble_sniff.SniffError, match="truncated record header"):
        list(ble_sniff.iter_packets(_pcap(_adv(0x0)) + b"\x00" * 4))


def test_truncated_packet_is_refused_not_silently_dropped():
    data = bytearray(_pcap(_adv(0x0)))
    data[ble_sniff._PCAP_GLOBAL_HEADER_LEN + 8:ble_sniff._PCAP_GLOBAL_HEADER_LEN + 12] = \
        struct.pack("<I", 9999)
    with pytest.raises(ble_sniff.SniffError, match="truncated packet"):
        list(ble_sniff.iter_packets(bytes(data)))


def test_verdict_reports_gatt_when_a_data_channel_exists():
    r = ble_sniff.format_report(ble_sniff.summarise(_pcap(b"\xde\xad" * 8)))
    assert "a connection WAS followed" in r


def test_verdict_explains_a_connect_that_was_not_followed():
    r = ble_sniff.format_report(
        ble_sniff.summarise(_pcap(_connect_ind(PHONE_WIRE, RESMED_WIRE)), follow=RESMED))
    assert "did not track it" in r


def test_verdict_explains_advertising_with_nothing_connecting():
    r = ble_sniff.format_report(ble_sniff.summarise(_pcap(_adv(0x0)), follow=RESMED))
    assert "nothing connected to it" in r


def test_verdict_explains_a_device_never_seen():
    r = ble_sniff.format_report(ble_sniff.summarise(_pcap(_adv(0x0, PHONE_WIRE)), follow=RESMED))
    assert "never seen advertising" in r


def test_verdict_without_a_follow_target_states_the_zero_plainly():
    r = ble_sniff.format_report(ble_sniff.summarise(_pcap(_adv(0x0))))
    assert "NO connection was followed" in r
    assert "never seen advertising" not in r


def test_report_marks_the_followed_device_and_names_reserved_pdus():
    s = ble_sniff.summarise(_pcap(_adv(0x0), _connect_ind(PHONE_WIRE, RESMED_WIRE), _adv(0xF)),
                            follow=RESMED)
    r = ble_sniff.format_report(s)
    assert "<-- followed device" in r
    assert "reserved-0xF" in r
    assert "ADV_IND" in r


def test_main_reports_and_succeeds(tmp_path, capsys):
    p = tmp_path / "c.pcap"
    p.write_bytes(_pcap(_adv(0x0)))
    assert ble_sniff.main([str(p), RESMED]) == 0
    assert "VERDICT" in capsys.readouterr().out


def test_main_without_arguments_prints_usage():
    assert ble_sniff.main([]) == 2


def test_unreadable_file_is_loud_not_empty(tmp_path, capsys):
    """The 2026-09-04 confusion: a read failure printed like an empty capture."""
    rc = ble_sniff.main([str(tmp_path / "absent.pcap")])
    err = capsys.readouterr().err
    assert rc == 1
    assert "cannot read" in err
    assert "VERDICT" not in err


def test_malformed_file_is_loud(tmp_path, capsys):
    p = tmp_path / "bad.pcap"
    p.write_bytes(b"\x00" * 8)
    assert ble_sniff.main([str(p)]) == 1
    assert "not a pcap" in capsys.readouterr().err


# ── boundary and ordering cases the first round of tests never produced ────────────────────────
# Every test below was written because a surviving mutant named the exact input the fixtures could
# not express. They are not padding: each one changes a verdict on some real capture.

def test_a_header_only_pcap_is_valid_and_yields_nothing():
    """Exactly the global header: a capture that recorded zero packets, not a broken file."""
    assert list(ble_sniff.iter_packets(_pcap())) == []


def test_a_record_ending_exactly_at_eof_is_accepted():
    data = _pcap(_adv(0x0))
    assert len(list(ble_sniff.iter_packets(data))) == 1


def test_truncation_error_states_how_many_bytes_actually_remain():
    data = bytearray(_pcap(_adv(0x0)))
    off = ble_sniff._PCAP_GLOBAL_HEADER_LEN
    remaining = len(data) - off - ble_sniff._PCAP_RECORD_HEADER_LEN
    data[off + 8:off + 12] = struct.pack("<I", 9999)
    with pytest.raises(ble_sniff.SniffError) as exc:
        list(ble_sniff.iter_packets(bytes(data)))
    assert "%d remain" % remaining in str(exc.value)


def test_the_first_access_address_anchors_the_header_not_the_last():
    """A payload that repeats the access address must not move the parse to the later copy."""
    pkt = _adv(0x0) + AA + bytes([ble_sniff.CONNECT_IND, 0x0C]) + PHONE_WIRE
    s = ble_sniff.summarise(_pcap(pkt))
    assert s["pdus"] == {0x0: 1}
    assert s["advertisers"] == {RESMED: 1}
    assert s["connects"] == []


def test_an_access_address_at_offset_zero_is_still_advertising():
    """No nordic pseudo-header: `find` returns 0, which is a hit, not a miss."""
    s = ble_sniff.summarise(_pcap(_adv(0x0, prefix=b"")))
    assert s["adv_channel"] == 1
    assert s["data_channel"] == 0


def test_data_channel_packets_accumulate():
    s = ble_sniff.summarise(_pcap(b"\xde\xad" * 8, b"\xbe\xef" * 8, b"\xca\xfe" * 8))
    assert s["data_channel"] == 3


def test_a_data_channel_packet_does_not_end_the_scan():
    s = ble_sniff.summarise(_pcap(b"\xde\xad" * 8, _adv(0x0), _adv(0x0)))
    assert s["data_channel"] == 1
    assert s["adv_channel"] == 2


def test_connect_ind_reads_only_the_two_addresses_not_the_lldata():
    """A real CONNECT_IND carries 22 bytes of LLData after the addresses."""
    body = PHONE_WIRE + RESMED_WIRE + bytes(range(22))
    s = ble_sniff.summarise(_pcap(_adv(ble_sniff.CONNECT_IND, body)), follow=RESMED)
    assert s["connects"] == [("66:55:44:33:22:11", RESMED)]
    assert s["follow_connects"] == 1


def test_an_absent_followed_device_counts_zero_not_none():
    s = ble_sniff.summarise(_pcap(_adv(0x0, PHONE_WIRE)), follow=RESMED)
    assert s["follow_adv_packets"] == 0


def test_pdu_types_are_listed_most_frequent_first():
    """The frequent type is deliberately the HIGHER-numbered one, so 'sorted by count' and
    'sorted by type' disagree — otherwise the ordering claim is untestable."""
    s = ble_sniff.summarise(_pcap(_adv(0x0), _adv(0x2), _adv(0x2)))
    lines = [ln for ln in ble_sniff.format_report(s).splitlines() if ln.startswith("  ADV_")]
    assert lines[0].split()[0] == "ADV_NONCONN_IND"
    assert lines[1].split()[0] == "ADV_IND"


def test_advertisers_are_listed_most_frequent_first_and_capped_at_eight():
    addrs = [bytes([i]) + b"\x00" * 5 for i in range(1, 11)]
    pkts = []
    for n, a in enumerate(addrs, start=1):
        pkts.extend([_adv(0x0, a)] * n)
    s = ble_sniff.summarise(_pcap(*pkts))
    body = ble_sniff.format_report(s).split("top advertisers:")[1].strip().splitlines()
    assert len(body) == 8
    counts = [int(ln.split()[1]) for ln in body]
    assert counts == sorted(counts, reverse=True)
    assert counts[0] == 10


def test_only_the_followed_device_is_starred_in_each_listing():
    s = ble_sniff.summarise(
        _pcap(_adv(0x0), _adv(0x0, PHONE_WIRE), _connect_ind(PHONE_WIRE, RESMED_WIRE),
              _connect_ind(RESMED_WIRE, PHONE_WIRE)),
        follow=RESMED)
    report = ble_sniff.format_report(s)
    starred = [ln for ln in report.splitlines() if "<-- followed device" in ln]
    assert len(starred) == 2                      # one CONNECT_IND row, one advertiser row
    assert all(RESMED in ln for ln in starred)
    # A CONNECT_IND is starred by its ADVERTISER, so the row initiated BY the phone is starred and
    # the row initiated by the CPAP is not. Check the advertiser listing, where one row per device
    # makes the claim unambiguous.
    listing = report.split("top advertisers:")[1].strip().splitlines()
    assert [("<--" in ln) for ln in listing] == [RESMED in ln for ln in listing]


def test_a_zero_length_record_is_read_not_refused():
    """A record header ending exactly at EOF with no payload is well-formed, not truncation."""
    data = _pcap() + struct.pack("<IIII", 0, 0, 0, 0)
    assert list(ble_sniff.iter_packets(data)) == [b""]


def test_a_packet_with_no_pdu_octet_does_not_end_the_scan():
    s = ble_sniff.summarise(_pcap(b"\x01\x02" + AA, _adv(0x0), _adv(0x0)))
    assert s["adv_channel"] == 3
    assert s["pdus"] == {0x0: 2}


def test_the_followed_marker_is_exactly_the_expected_suffix():
    """Asserting the substring lets a mutated marker through; assert the line ENDS with it."""
    s = ble_sniff.summarise(_pcap(_adv(0x0), _connect_ind(PHONE_WIRE, RESMED_WIRE)), follow=RESMED)
    marked = [ln for ln in ble_sniff.format_report(s).splitlines() if "followed device" in ln]
    assert len(marked) == 2
    assert all(ln.endswith("  <-- followed device") for ln in marked)


def test_usage_names_the_arguments_on_stderr(capsys):
    assert ble_sniff.main([]) == 2
    err = capsys.readouterr().err
    assert "usage: ble_sniff.py <capture.pcap> [MAC-to-follow]" in err


def test_main_passes_the_follow_argument_through_to_the_report(tmp_path, capsys):
    """Without this, `follow` could be dropped in main and every test still passes."""
    p = tmp_path / "c.pcap"
    p.write_bytes(_pcap(_adv(0x0)))
    assert ble_sniff.main([str(p), RESMED]) == 0
    out = capsys.readouterr().out
    assert RESMED in out
    assert "nothing connected to it" in out


def test_main_without_a_follow_argument_reports_the_plain_zero(tmp_path, capsys):
    p = tmp_path / "c.pcap"
    p.write_bytes(_pcap(_adv(0x0)))
    assert ble_sniff.main([str(p)]) == 0
    out = capsys.readouterr().out
    assert "NO connection was followed" in out
    assert "nothing connected to it" not in out


# ── CRC honesty + capture span (VIGIL-BLUETOOTH-ADAPTERS-2026-09-05 F1/F2) ─────────────────────
# Measured on the box 2026-09-05: 14 % of the overnight capture's records were CRC-bad, and this
# module reported 262 CONNECT_INDs where tshark (crcok==1) found 12 — 95 % bit-flip noise. And the
# same capture had silently stopped producing packets 2 h into a 7.4 h window; nothing reported a
# span, so the file's mtime passed for its coverage. Layout facts the builder below encodes were
# derived from the real capture and verified against tshark on all 20,824 records (crc-bad count
# matched exactly): 7-byte prefix (board · LE16 payload-len · protover=2 · LE16 counter ·
# packet-id=6/EVENT) then a length-prefixed payload header whose SECOND octet is flags, bit0=CRC-ok.

def _nordic(ble: bytes, *, flags: int = 0x01, protover: int = 2, packet_id: int = 6,
            plen_delta: int = 0) -> bytes:
    """A real nRF Sniffer v2 EVENT record around `ble` (which is AA + header + body)."""
    body = bytes([10, flags, 38, 56, 0, 0, 0, 0, 0, 0]) + ble
    return (bytes([0]) + struct.pack("<H", len(body) + plen_delta)
            + bytes([protover]) + b"\x00\x00" + bytes([packet_id]) + body)


def _pcap_ts(*records: tuple[int, int, bytes]) -> bytes:
    """Like `_pcap`, but each record carries an explicit (ts_sec, ts_usec)."""
    out = bytearray(b"\xd4\xc3\xb2\xa1" + b"\x00" * 20)
    for ts, tu, p in records:
        out += struct.pack("<IIII", ts, tu, len(p), len(p)) + p
    return bytes(out)


def test_crc_bad_record_is_excluded_from_every_counter():
    good = _nordic(_adv(0x0, prefix=b""))
    bad = _nordic(_adv(0x0, prefix=b""), flags=0x00)
    s = ble_sniff.summarise(_pcap(good, bad, bad), follow=RESMED)
    assert s["total"] == 3
    assert s["crc_bad"] == 2
    assert s["adv_channel"] == 1
    assert s["pdus"] == {0x0: 1}
    assert s["advertisers"] == {RESMED: 1}
    assert s["follow_adv_packets"] == 1


def test_crc_bad_connect_ind_is_not_a_connect():
    """The 262-vs-12 defect itself: a corrupted CONNECT_IND must not enter the connect list."""
    bad = _nordic(_adv(ble_sniff.CONNECT_IND, PHONE_WIRE + RESMED_WIRE, prefix=b""), flags=0x00)
    s = ble_sniff.summarise(_pcap(bad), follow=RESMED)
    assert s["connects"] == []
    assert s["follow_connects"] == 0
    assert s["crc_bad"] == 1


def test_crc_bad_data_channel_record_is_excluded_from_the_verdict():
    """A corrupted record without the access address must not fabricate 'GATT is present'."""
    s = ble_sniff.summarise(_pcap(_nordic(b"\xde\xad\xbe\xef" * 4, flags=0x00)))
    assert s["data_channel"] == 0
    assert s["crc_bad"] == 1
    assert "NO connection was followed" in ble_sniff.format_report(s)


def test_crc_uses_only_bit_zero_of_the_flags():
    """Other flag bits (direction/encrypted/MIC/PHY) must neither save nor damn a record."""
    s = ble_sniff.summarise(_pcap(_nordic(_adv(0x0, prefix=b""), flags=0xFE)))
    assert s["crc_bad"] == 1
    s2 = ble_sniff.summarise(_pcap(_nordic(_adv(0x0, prefix=b""), flags=0x03)))
    assert s2["crc_bad"] == 0
    assert s2["pdus"] == {0x0: 1}


def test_a_record_without_a_nordic_header_is_counted_not_guessed():
    """Every pre-existing fixture in this file, and any non-nRF pcap: no header, no CRC claim."""
    s = ble_sniff.summarise(_pcap(_adv(0x0)))
    assert s["crc_bad"] == 0
    assert s["pdus"] == {0x0: 1}


def test_near_miss_nordic_headers_do_not_claim_the_crc_bit():
    """Wrong protover, wrong packet id, or an inconsistent payload length: the flags octet is
    NOT trusted, so a zero there must not silently discard a countable record."""
    ble = _adv(0x0, prefix=b"")
    for miss in (_nordic(ble, flags=0x00, protover=3),
                 _nordic(ble, flags=0x00, packet_id=5),
                 _nordic(ble, flags=0x00, plen_delta=1)):
        s = ble_sniff.summarise(_pcap(miss))
        assert s["crc_bad"] == 0
        assert s["pdus"] == {0x0: 1}


def test_a_record_too_short_for_a_nordic_header_is_counted():
    s = ble_sniff.summarise(_pcap(b"\x00" * 10))
    assert s["crc_bad"] == 0
    assert s["data_channel"] == 1


def test_crc_bad_records_still_extend_the_span():
    """A corrupted record is still a record IN TIME — excluding it from the span would shrink
    the very number that exists to expose a capture that died early."""
    s = ble_sniff.summarise(_pcap_ts(
        (100, 500000, _nordic(_adv(0x0, prefix=b""), flags=0x00)),
        (200, 0, _adv(0x0))))
    assert s["first_ts"] == pytest.approx(100.5)
    assert s["last_ts"] == pytest.approx(200.0)
    assert s["duration_s"] == pytest.approx(99.5)


def test_capture_span_is_last_minus_first():
    s = ble_sniff.summarise(_pcap_ts((100, 500000, _adv(0x0)), (460, 900000, _adv(0x0))))
    assert s["duration_s"] == pytest.approx(360.4)


def test_capture_span_survives_out_of_order_records():
    """min/max over all records, not first-seen/last-seen."""
    s = ble_sniff.summarise(_pcap_ts((460, 900000, _adv(0x0)), (100, 500000, _adv(0x0))))
    assert s["first_ts"] == pytest.approx(100.5)
    assert s["last_ts"] == pytest.approx(460.9)
    assert s["duration_s"] == pytest.approx(360.4)


def test_an_empty_capture_has_no_span():
    s = ble_sniff.summarise(_pcap())
    assert s["first_ts"] is None
    assert s["last_ts"] is None
    assert s["duration_s"] is None
    assert "capture span      : no packets" in ble_sniff.format_report(s)


def test_report_prints_the_span_with_utc_endpoints():
    """The 2026-09-04 overnight capture read as 7.4 h by mtime and held 2 h of packets; the span
    line is what would have said so. Endpoints render in UTC (Clock Contract: display via UTC)."""
    s = ble_sniff.summarise(_pcap_ts((1788628423, 215216, _adv(0x0)),
                                     (1788628783, 615216, _adv(0x0))))
    r = ble_sniff.format_report(s)
    assert "capture span      : 360.4 s (2026-09-05T17:13:43Z -> 2026-09-05T17:19:43Z)" in r


def test_report_states_the_crc_exclusion_even_at_zero():
    """An absent line and a zero are different facts (§4b): the exclusion is always stated."""
    r = ble_sniff.format_report(ble_sniff.summarise(_pcap(_adv(0x0))))
    assert "  crc-bad excluded: 0" in r
    r2 = ble_sniff.format_report(
        ble_sniff.summarise(_pcap(_nordic(_adv(0x0, prefix=b""), flags=0x00))))
    assert "  crc-bad excluded: 1" in r2


# ── the nightly audit (VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT D3) ──────────────────────────────────────
# `tepna-sniff.sh` records a bounded all-advertising capture every night and asks two questions of
# it. Both are answered here as pure functions of the summary, so the shell test only has to prove
# the plumbing.

SENA = "00:1B:DC:F4:AB:CD"            # one of OUR adapters
SENA_WIRE = bytes.fromhex("cdabf4dc1b00")
RING = "D1:98:62:7C:92:B3"            # one of OUR devices
RING_WIRE = bytes.fromhex("b3927c6298d1")
STRANGER_WIRE = bytes.fromhex("665544332211")
STRANGER = "11:22:33:44:55:66"


def _night(*payloads, span_s=590.0):
    """A capture whose packets span `span_s` seconds — the audit's window input."""
    stamped = [(100 + int(span_s * i / max(1, len(payloads) - 1)), 0, p)
               for i, p in enumerate(payloads)]
    return ble_sniff.summarise(_pcap_ts(*stamped))


def test_audit_passes_a_full_window_with_only_our_own_connects():
    s = _night(_adv(0x0, RING_WIRE), _connect_ind(SENA_WIRE, RING_WIRE), _adv(0x0, RING_WIRE))
    a = ble_sniff.audit(s, 600, {RING}, {SENA})
    assert a["ok"] and a["problems"] == []
    assert a["foreign"] == []
    assert a["heard"] == [RING]
    r = ble_sniff.format_audit(a)
    assert "AIR AUDIT: OK" in r
    assert "foreign connects: 0" in r          # stated at zero, never omitted
    assert "1 configured, 1 heard" in r


def test_audit_fails_a_capture_that_died_early_the_F2_shape():
    """2 h of a 7.4 h window read as 'the night' by mtime. The audit reads the packets."""
    s = _night(_adv(0x0), _adv(0x0), span_s=7168)
    a = ble_sniff.audit(s, 26640, set(), set())
    assert not a["ok"]
    assert a["window"].startswith("captured 7168.0 s of 26640 s expected")
    assert "died 19472 s early" in a["window"]
    assert "window:" in a["problems"][0]


def test_audit_accepts_the_handshake_and_teardown_shortfall():
    """A healthy 600 s run spans ~590 s (firmware handshake + SIGINT teardown). Not a red."""
    s = _night(_adv(0x0), _adv(0x0), span_s=0.8 * 600)
    assert ble_sniff.audit(s, 600, set(), set())["ok"]
    s = _night(_adv(0x0), _adv(0x0), span_s=0.8 * 600 - 0.5)
    assert not ble_sniff.audit(s, 600, set(), set())["ok"]


def test_audit_fails_an_empty_capture_by_name():
    """The extcap exits 0 on a LockedException (port busy) with a header-only pcap. Zero packets
    in a requested window is a failure, and it says so — never a quiet 'OK, nothing seen'."""
    a = ble_sniff.audit(ble_sniff.summarise(_pcap()), 600, {RING}, {SENA})
    assert not a["ok"]
    assert a["window"] == "no packets at all in a 600 s window"


def test_audit_without_a_window_judges_only_the_connects():
    s = _night(_adv(0x0), span_s=5)
    a = ble_sniff.audit(s, None, {RING}, {SENA})
    assert a["ok"] and a["window"] is None
    assert "window" not in ble_sniff.format_audit(a)


def test_audit_flags_a_stranger_connecting_to_our_device():
    """C1 on air: an initiator that is not one of our adapters opened a link to our ring."""
    s = _night(_connect_ind(STRANGER_WIRE, RING_WIRE), _adv(0x0, RING_WIRE))
    a = ble_sniff.audit(s, 600, {RING}, {SENA})
    assert not a["ok"]
    assert a["foreign"] == [(STRANGER, RING)]
    assert a["problems"] == ["1 foreign connect(s) to our devices"]
    r = ble_sniff.format_audit(a)
    assert "AIR AUDIT: FAILED — 1 foreign connect(s) to our devices" in r
    assert "%s -> %s  <-- NOT one of our adapters" % (STRANGER, RING) in r


def test_audit_ignores_strangers_connecting_to_neighbours_devices():
    """F3's four connects to a neighbour's device are the neighbour's business."""
    s = _night(_connect_ind(STRANGER_WIRE, PHONE_WIRE), _adv(0x0, RING_WIRE))
    a = ble_sniff.audit(s, 600, {RING}, {SENA})
    assert a["ok"] and a["foreign"] == []


def test_audit_with_no_adapter_list_calls_every_connect_to_us_foreign():
    """'Could not attribute' must read as a finding, not as clean."""
    s = _night(_connect_ind(SENA_WIRE, RING_WIRE), _adv(0x0, RING_WIRE))
    a = ble_sniff.audit(s, 600, {RING}, set())
    assert not a["ok"]
    assert a["foreign"] == [(SENA, RING)]
    assert "our adapters    : NONE listed — every connect to our devices counts as foreign" \
        in ble_sniff.format_audit(a)


def test_audit_reports_both_problems_when_both_hold():
    s = _night(_connect_ind(STRANGER_WIRE, RING_WIRE), _adv(0x0), span_s=10)
    a = ble_sniff.audit(s, 600, {RING}, {SENA})
    assert len(a["problems"]) == 2
    assert a["problems"][0].startswith("window:")
    assert "; " in ble_sniff.format_audit(a).splitlines()[1]


def test_audit_hears_a_device_that_only_appears_as_a_connect_target():
    """A device already being connected to may never advertise inside the window."""
    s = _night(_connect_ind(SENA_WIRE, RING_WIRE), _adv(0x0))
    assert ble_sniff.audit(s, None, {RING}, {SENA})["heard"] == [RING]


def test_device_addresses_reads_only_the_addresses(tmp_path):
    cfg = tmp_path / "config.yaml"
    cfg.write_text(
        "devices:\n"
        "  - name: ring\n    address: \"d1:98:62:7c:92:b3\"\n    bond_key: SECRET\n"
        "  - name: h10\n    address: ' 24:AC:AC:0C:30:1E '\n"
        "  - name: muse\n"                      # no address — a name-only entry contributes nothing
        "  -\n"                                 # a null entry (trailing dash) must not crash it
    )
    assert ble_sniff.device_addresses(str(cfg)) == {RING, "24:AC:AC:0C:30:1E"}
    empty = tmp_path / "empty.yaml"
    empty.write_text("")
    assert ble_sniff.device_addresses(str(empty)) == set()


def test_main_two_positional_form_is_unchanged_and_prints_no_audit(tmp_path, capsys):
    p = tmp_path / "c.pcap"
    p.write_bytes(_pcap(_adv(0x0)))
    assert ble_sniff.main([str(p), RESMED]) == 0
    assert "AIR AUDIT" not in capsys.readouterr().out


def test_main_audit_options_exit_3_on_a_failed_audit_and_0_on_a_clean_one(tmp_path, capsys):
    cfg = tmp_path / "config.yaml"
    cfg.write_text("devices:\n  - address: %s\n" % RING)
    p = tmp_path / "night.pcap"
    p.write_bytes(_pcap_ts((100, 0, _connect_ind(STRANGER_WIRE, RING_WIRE)),
                           (690, 0, _adv(0x0, RING_WIRE))))
    rc = ble_sniff.main([str(p), "--expect-seconds", "600", "--config", str(cfg),
                         "--adapters", "%s,%s" % (SENA.lower(), " 00:11:22:33:44:55 ")])
    out = capsys.readouterr().out
    assert rc == 3
    assert "VERDICT" in out and "AIR AUDIT: FAILED" in out
    assert "our adapters    : 00:11:22:33:44:55, %s" % SENA in out
    clean = tmp_path / "clean.pcap"
    clean.write_bytes(_pcap_ts((100, 0, _connect_ind(SENA_WIRE, RING_WIRE)),
                               (690, 0, _adv(0x0, RING_WIRE))))
    assert ble_sniff.main([str(clean), "--expect-seconds", "600", "--ours", RING,
                           "--adapters", SENA]) == 0
    assert "AIR AUDIT: OK" in capsys.readouterr().out


def test_main_audit_options_also_accept_the_follow_mac(tmp_path, capsys):
    p = tmp_path / "c.pcap"
    p.write_bytes(_pcap(_adv(0x0)))
    assert ble_sniff.main([str(p), RESMED, "--ours", RING]) == 0
    assert "AIR AUDIT: OK" in capsys.readouterr().out


def test_main_bad_option_values_are_usage_errors_not_tracebacks(tmp_path, capsys):
    p = tmp_path / "c.pcap"
    p.write_bytes(_pcap(_adv(0x0)))
    assert ble_sniff.main([str(p), "--expect-seconds"]) == 2            # value missing
    assert ble_sniff.main([str(p), "--expect-seconds", "soon"]) == 2    # not a number
    assert ble_sniff.main([str(p), "--config", str(tmp_path / "nope.yaml")]) == 2
    assert ble_sniff.main([str(p), RESMED, "extra"]) == 2               # three positionals
    assert capsys.readouterr().err.count("bad arguments") == 3


def test_main_an_unreadable_capture_under_audit_is_still_exit_1_not_3(tmp_path, capsys):
    rc = ble_sniff.main([str(tmp_path / "absent.pcap"), "--expect-seconds", "600"])
    assert rc == 1
    assert "cannot read" in capsys.readouterr().err
