# tepna-capture — tests/test_probe_polar_usb.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The USB-HID PS-FTP probe. It is hand-run against hardware, but its FRAMING is exactly the part that
# cannot be checked by looking at a device — and it is the part that already produced one wrong
# conclusion. Two off-by-one details in Polar's USB framing (`length + 4`, and flags==1 meaning END
# rather than MORE) each turn a working transport into a silent "no response" that reads as "USB is not
# supported". Both are pinned here, driven over a fake device rather than real hardware, so the next
# person to touch this cannot silently reintroduce either.

import probe_polar_usb as probe


# ── request framing (host -> device) ─────────────────────────────────────────────────────────────────

def test_a_request_is_one_fixed_size_report_with_the_output_id():
    r = probe.build_request("/")
    assert len(r) == probe.REPORT_BYTES == 64, "a HID OUTPUT report is fixed-size"
    assert r[0] == probe.OUT_REPORT_ID == 0x01


def test_the_rfc60_length_is_path_length_plus_four():
    """The bug that produced the false dead end: a bare length is accepted and answered with nothing."""
    r = probe.build_request("/U/0/")
    assert r[3] == len("/U/0/") + 4 == 9
    assert r[4] == 0x00, "little-endian, high byte zero for any real path"


def test_the_size_flags_byte_is_length_plus_eight_shifted_left_two():
    r = probe.build_request("/")
    assert r[1] == ((1 + 8) << 2) & 0xFF == 36


def test_the_request_carries_the_shared_psftp_protobuf_verbatim():
    """If this drifts from polar_psftp, the two transports have forked and only one is tested."""
    import polar_psftp as ps
    r = probe.build_request("/SYS/")
    assert r[5:5 + 9] == ps._encode_operation(ps.GET, "/SYS/")


def test_the_report_tail_is_zero_padding_not_stale_bytes():
    r = probe.build_request("/")
    assert set(r[10:]) == {0}


def test_an_ack_is_the_three_byte_form_the_device_expects():
    a = probe.build_ack(7)
    assert a[:3] == bytes([0x01, 0x05, 0x07])
    assert len(a) == probe.REPORT_BYTES


def test_ack_numbers_wrap_at_ff_rather_than_overflowing_the_byte():
    assert probe.next_ack(0) == 1
    assert probe.next_ack(0xFE) == 0xFF
    assert probe.next_ack(0xFF) == 0, "0x100 would not fit in the packet-number byte"


def test_an_ack_number_above_a_byte_is_masked_not_truncated_into_the_next_field():
    assert probe.build_ack(0x1FF)[:3] == bytes([0x01, 0x05, 0xFF])


# ── reply decoding (device -> host) ──────────────────────────────────────────────────────────────────

def _reply(size, flags, body=b"", initial=True):
    head = bytes([probe.IN_REPORT_ID, (size << 2) | flags, 0x00])
    if initial:
        head += b"\x00\x00"
    return probe.to_report(head + body)


def test_flags_one_means_END_and_flags_zero_means_MORE():
    """INVERTED from the BLE RFC76 reading. Getting this backwards is what produced the dead end."""
    assert probe.reply_is_end(_reply(4, 1)) is True
    assert probe.reply_is_end(_reply(4, 0)) is False


def test_the_size_lives_in_the_upper_six_bits():
    assert probe.reply_size(_reply(40, 0)) == 40
    assert probe.reply_size(bytes([0x11, 0x04])) == 1, "the observed idle filler is one byte"


def test_the_first_reply_packet_has_two_extra_header_bytes():
    first = _reply(3, 0, b"abc", initial=True)
    later = _reply(3, 0, b"abc", initial=False)
    assert probe.reply_body(first, initial=True) == b"abc"
    assert probe.reply_body(later, initial=False) == b"abc"


def test_reading_a_later_packet_as_if_it_were_first_loses_two_bytes():
    """Pinning the failure mode, so an off-by-two shows up here rather than as corrupt file content."""
    later = _reply(3, 0, b"abc", initial=False)
    assert probe.reply_body(later, initial=True) != b"abc"


# ── the fetch loop ───────────────────────────────────────────────────────────────────────────────────

_IDLE = bytes([0x11, 0x04]) + b"\x00" * 62
_LISTING = bytes.fromhex("0a0c0a08444244432e44415410010a0e0a0a5553455249442e425042"
                         "10460a060a02532f10000a0d0a0932303236303632312f1000")


class _FakeDev:
    """A hidraw stand-in: a scripted reply queue plus a record of what the host wrote."""

    def __init__(self, replies, stale=(), read_error=False):
        self.replies, self.stale = list(replies), list(stale)
        self.read_error, self.writes = read_error, []


def _install(monkeypatch, dev):
    monkeypatch.setattr(probe.os, "open", lambda *a, **k: 99)
    monkeypatch.setattr(probe.os, "close", lambda fd: None)
    monkeypatch.setattr(probe.os, "write", lambda fd, b: dev.writes.append(b) or len(b))

    def _select(rl, wl, xl, timeout):
        # timeout == 0 is fetch()'s drain probe: only pre-existing stale bytes are visible to it,
        # otherwise the drain would swallow the reply this request is waiting for.
        ready = bool(dev.stale) if timeout == 0 else bool(dev.stale or dev.replies)
        return ([99], [], []) if ready else ([], [], [])

    def _read(fd, n):
        if dev.stale:
            return dev.stale.pop(0)
        if dev.read_error:
            raise OSError(5, "Input/output error")
        return dev.replies.pop(0)

    monkeypatch.setattr(probe.select, "select", _select)
    monkeypatch.setattr(probe.os, "read", _read)


def test_a_single_end_packet_is_parsed_into_directory_entries(monkeypatch):
    """The real listing measured over USB on 2026-08-02, replayed byte-for-byte."""
    dev = _FakeDev([_reply(len(_LISTING), 1, _LISTING)])
    _install(monkeypatch, dev)
    r = probe.fetch("/dev/hidraw0", "/U/0/")
    assert r["ok"] is True
    assert [e[0] for e in r["entries"]] == ["DBDC.DAT", "USERID.BPB", "S/", "20260621/"]
    assert ("20260621/", 0) in r["entries"], "a date-named session directory"


# ── TRUNCATION ───────────────────────────────────────────────────────────────────────────────────────
# The SAME reply, re-measured 2026-08-09 — and the device had more to say. `_LISTING` above is the
# 2026-08-02 capture, which happened to end on a record boundary and so looked whole. It was not: the
# USB pipe caps a reply at one 64-byte report and sets the END flag regardless, and on 08-09 the extra
# bytes that fit landed MID-RECORD. The BLE mirror of the same unit lists SIX entries in `/U/0/`
# (`20260802/` and `20260803/`, the latter holding 22 `.REC` recordings); both USB captures show FOUR.
_LISTING_TRUNCATED = _LISTING + bytes.fromhex("0a0d0a093230")     # entry: name len 9, 2 bytes delivered


def test_a_truncated_payload_is_reported_as_truncated_not_as_a_short_listing(monkeypatch):
    dev = _FakeDev([_reply(len(_LISTING_TRUNCATED), 1, _LISTING_TRUNCATED)])
    _install(monkeypatch, dev)
    r = probe.fetch("/dev/hidraw0", "/U/0/")
    assert r["truncated"] is True and r["complete"] is False
    assert [e[0] for e in r["entries"]] == ["DBDC.DAT", "USERID.BPB", "S/", "20260621/"]
    assert "20" not in [e[0] for e in r["entries"]], "a 2-byte fragment of a 9-byte name is not a file"


def test_a_whole_payload_is_marked_complete(monkeypatch):
    """Positive control: `complete` must be capable of being true, or it reports nothing."""
    dev = _FakeDev([_reply(len(_LISTING), 1, _LISTING)])
    _install(monkeypatch, dev)
    r = probe.fetch("/dev/hidraw0", "/U/0/")
    assert r["truncated"] is False and r["complete"] is True


def test_main_leads_the_verdict_with_the_truncation(monkeypatch, capsys):
    """`ok` stays TRUE on a truncated listing — the transport really did work — so the verdict is the
    only line that can stop a reader citing four entries as the device's filesystem. One did, for a
    week: POLAR-VERITY-DEVICE-SURFACE quotes the short list as the device's `/U/0/`."""
    monkeypatch.setattr(probe, "find_device", lambda: ("/dev/hidraw0", "0C301E3F"))
    monkeypatch.setattr(probe, "fetch", lambda *a, **k: {
        "ok": True, "truncated": True, "complete": False, "entries": [("20260621/", 0)]})
    assert probe.main([]) == 0
    out = capsys.readouterr().out
    assert "TRUNCATED" in out and "polar_mirror" in out
    assert "reusable" not in out, "the success verdict must not also be printed"


def test_a_multi_packet_reply_is_acked_and_reassembled(monkeypatch):
    a, b = _LISTING[:20], _LISTING[20:]
    dev = _FakeDev([_reply(len(a), 0, a, initial=True), _reply(len(b), 1, b, initial=False)])
    _install(monkeypatch, dev)
    r = probe.fetch("/dev/hidraw0", "/U/0/")
    assert r["ok"] is True and r["real"] == 2
    assert [e[0] for e in r["entries"]] == ["DBDC.DAT", "USERID.BPB", "S/", "20260621/"]
    acks = [w for w in dev.writes if w[1] == 0x05]
    assert acks and acks[0][:3] == bytes([0x01, 0x05, 0x00]), "a non-final packet must be ACKed"


def test_all_idle_filler_reports_a_closed_window_not_a_broken_transport(monkeypatch):
    """The state the device has been in since the one successful run — worth naming precisely."""
    dev = _FakeDev([_IDLE] * 6)
    _install(monkeypatch, dev)
    r = probe.fetch("/dev/hidraw0", "/U/0/")
    assert r["ok"] is False and r["real"] == 0 and r["idle"] == 6
    assert "window is closed" in r["error"]
    assert "replug" in r["error"], "the operator needs the next action, not just a diagnosis"


def test_idle_packets_are_acked_so_the_pingpong_keeps_moving(monkeypatch):
    dev = _FakeDev([_IDLE] * 3)
    _install(monkeypatch, dev)
    probe.fetch("/dev/hidraw0", "/U/0/")
    assert [w[2] for w in dev.writes if w[1] == 0x05] == [0, 1, 2], "ACK numbers must advance"


def test_a_one_byte_end_packet_is_an_answer_not_filler(monkeypatch):
    """Size<=1 is only filler while flags say MORE; a 1-byte END is a real, if empty, response."""
    dev = _FakeDev([_reply(1, 1, b"\x00")])
    _install(monkeypatch, dev)
    r = probe.fetch("/dev/hidraw0", "/U/0/")
    assert r["real"] == 1 and r["idle"] == 0


def test_stale_bytes_in_the_node_are_drained_before_the_request(monkeypatch):
    small = bytes.fromhex("0a060a02532f1000")
    dev = _FakeDev([_reply(len(small), 1, small)], stale=[_IDLE])
    _install(monkeypatch, dev)
    r = probe.fetch("/dev/hidraw0", "/U/0/")
    assert r["ok"] is True, "a leftover reply must not be parsed as this request's answer"


def test_a_read_error_is_reported_rather_than_crashing_the_probe(monkeypatch):
    dev = _FakeDev([b""], read_error=True)
    _install(monkeypatch, dev)
    r = probe.fetch("/dev/hidraw0", "/U/0/")
    assert r["ok"] is False and "read failed" in r["error"]


def test_a_runt_report_is_skipped_not_indexed_into(monkeypatch):
    small = bytes.fromhex("0a060a02532f1000")
    dev = _FakeDev([b"\x11", _reply(len(small), 1, small)])
    _install(monkeypatch, dev)
    r = probe.fetch("/dev/hidraw0", "/U/0/")
    assert r["ok"] is True


def test_silence_ends_the_loop_without_hanging(monkeypatch):
    dev = _FakeDev([])
    _install(monkeypatch, dev)
    r = probe.fetch("/dev/hidraw0", "/U/0/", window=0.05)
    assert r["ok"] is False and r["real"] == 0


def test_max_packets_bounds_a_device_that_never_terminates(monkeypatch):
    dev = _FakeDev([_IDLE] * 500)
    _install(monkeypatch, dev)
    r = probe.fetch("/dev/hidraw0", "/U/0/", window=30.0, max_packets=5)
    assert r["idle"] == 5, "the 4000-packets-in-8s ping-pong must not run unbounded"


def test_unparseable_payload_is_surfaced_as_hex_rather_than_claimed_as_success(monkeypatch):
    dev = _FakeDev([_reply(4, 1, b"\xff\xff\xff\xff")])
    _install(monkeypatch, dev)
    r = probe.fetch("/dev/hidraw0", "/U/0/")
    assert r["ok"] is False and r["head"] == "ffffffff"


def test_a_payload_the_protobuf_reader_REJECTS_is_also_surfaced_as_hex(monkeypatch):
    """`\\xff\\xff\\xff\\xff` above is now diagnosed as TRUNCATION (a varint whose continuation bit
    never clears really has run off the end), which `_parse_directory_ex` handles internally. So the
    `except` arm needs the OTHER garbage shape to stay reachable: wire type 3 — a deprecated protobuf
    group — which `_iter_fields` raises on outright rather than desyncing the parser. Either way the
    bytes must reach the operator, because on this transport they are the only evidence of what the
    device actually said."""
    dev = _FakeDev([_reply(1, 1, b"\x0b")])           # tag: field 1, wire type 3
    _install(monkeypatch, dev)
    r = probe.fetch("/dev/hidraw0", "/U/0/")
    assert r["ok"] is False and r["truncated"] is False and r["head"] == "0b"


def test_permission_denied_names_the_udev_rule(monkeypatch):
    def _boom(*a, **k):
        raise PermissionError(13, "Permission denied")
    monkeypatch.setattr(probe.os, "open", _boom)
    r = probe.fetch("/dev/hidraw0", "/")
    assert r["ok"] is False and "udev" in r["error"]


def test_a_missing_node_is_reported_with_its_reason(monkeypatch):
    def _boom(*a, **k):
        raise OSError(2, "No such file or directory")
    monkeypatch.setattr(probe.os, "open", _boom)
    r = probe.fetch("/dev/hidraw9", "/")
    assert r["ok"] is False and "No such file" in r["error"]


# ── device discovery ─────────────────────────────────────────────────────────────────────────────────

def _hidraw_tree(tmp_path, monkeypatch, nodes):
    for name, uevent in nodes.items():
        d = tmp_path / name / "device"
        d.mkdir(parents=True)
        (d / "uevent").write_text(uevent, encoding="utf-8")
    monkeypatch.setattr(probe.glob, "glob", lambda pat: sorted(str(p) for p in tmp_path.iterdir()))


def test_the_polar_is_found_by_usb_id_not_by_node_number(tmp_path, monkeypatch):
    """Node numbers move with enumeration order — binding to hidraw0 is how a probe talks to the
    wrong device. The successful run and every failed one used different bus addresses."""
    _hidraw_tree(tmp_path, monkeypatch, {
        "hidraw0": "HID_ID=0003:00001050:00000407\nHID_NAME=Yubico\n",
        "hidraw1": "HID_ID=0003:00000DA4:00000008\nHID_UNIQ=0C301E3F\nHID_NAME=Polar INW4J\n",
    })
    dev, uniq = probe.find_device()
    assert dev.endswith("hidraw1") and uniq == "0C301E3F"


def test_no_polar_present_returns_none(tmp_path, monkeypatch):
    _hidraw_tree(tmp_path, monkeypatch, {"hidraw0": "HID_ID=0003:00001050:00000407\n"})
    assert probe.find_device() is None


def test_a_node_with_no_uniq_still_matches(tmp_path, monkeypatch):
    _hidraw_tree(tmp_path, monkeypatch, {"hidraw0": "HID_ID=0003:00000DA4:00000008\n"})
    dev, uniq = probe.find_device()
    assert dev.endswith("hidraw0") and uniq == ""


def test_an_unreadable_uevent_is_skipped_rather_than_aborting_the_scan(tmp_path, monkeypatch):
    _hidraw_tree(tmp_path, monkeypatch, {
        "hidraw0": "HID_ID=0003:00000DA4:00000008\nHID_UNIQ=0C301E3F\n",
    })
    monkeypatch.setattr(probe.glob, "glob",
                        lambda pat: [str(tmp_path / "gone"), str(tmp_path / "hidraw0")])
    dev, _ = probe.find_device()
    assert dev.endswith("hidraw0")


# ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

def test_main_reports_the_listing_and_a_success_verdict(monkeypatch, capsys):
    monkeypatch.setattr(probe, "find_device", lambda: ("/dev/hidraw0", "0C301E3F"))
    monkeypatch.setattr(probe, "fetch",
                        lambda *a, **k: {"ok": True, "entries": [("20260621/", 0)]})
    assert probe.main([]) == 0
    out = capsys.readouterr().out
    assert "20260621/" in out and "reusable" in out


def test_main_surfaces_the_failure_reason_as_the_verdict(monkeypatch, capsys):
    monkeypatch.setattr(probe, "find_device", lambda: ("/dev/hidraw0", "x"))
    monkeypatch.setattr(probe, "fetch", lambda *a, **k: {"ok": False, "error": "window is closed"})
    assert probe.main([]) == 0
    assert "window is closed" in capsys.readouterr().out


def test_main_without_a_reason_still_prints_a_verdict(monkeypatch, capsys):
    monkeypatch.setattr(probe, "find_device", lambda: ("/dev/hidraw0", "x"))
    monkeypatch.setattr(probe, "fetch", lambda *a, **k: {"ok": False})
    assert probe.main([]) == 0
    assert "no answer" in capsys.readouterr().out


def test_an_explicit_device_skips_autodetection(monkeypatch, capsys):
    monkeypatch.setattr(probe, "find_device",
                        lambda: (_ for _ in ()).throw(AssertionError("scanned")))
    monkeypatch.setattr(probe, "fetch", lambda *a, **k: {"ok": True, "entries": []})
    assert probe.main(["--device", "/dev/hidraw3"]) == 0
    assert "/dev/hidraw3" in capsys.readouterr().out


def test_no_device_exits_nonzero_with_an_actionable_message(monkeypatch, capsys):
    monkeypatch.setattr(probe, "find_device", lambda: None)
    assert probe.main([]) == 1
    assert "dock on USB" in capsys.readouterr().out
