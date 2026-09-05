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


def test_truncated_pdu_header_is_skipped_not_crashed():
    s = ble_sniff.summarise(_pcap(b"\x01\x02" + AA + b"\x05"))
    assert s["adv_channel"] == 1
    assert s["pdus"] == {}


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
