# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""as11_link — the AS11 BLE link layer, exercised against the published spec.

Covers FIG framing (incl. resume-mid-stream and incomplete-packet branches), the key
derivations, a full simulated SRP-6a exchange (client M1/M2/K vs a device side built from
the same table), and every RPC builder including its refusals. The AES payload cipher is
NOT here — it is dependency-injected into as11_pull (see that module's header) so this gated
module carries no non-stdlib crypto dependency.
"""
import hashlib
import hmac
import json
import struct

import as11_link as L
import pytest


# ── FIG framing ──────────────────────────────────────────────────────────────
def test_frame_roundtrips_and_resumes_after_leading_garbage():
    frame = L.fig_frame(L.VCID_ENC_TX, b'{"id":1}')
    vcid, payload, rest = L.fig_unframe(b"\x00\x11" + frame + b"tail")
    assert vcid == L.VCID_ENC_TX and payload == b'{"id":1}' and rest == b"tail"


def test_frame_roundtrips_empty_payload():
    vcid, payload, rest = L.fig_unframe(L.fig_frame(L.VCID_PLAIN_TX, b""))
    assert vcid == L.VCID_PLAIN_TX and payload == b"" and rest == b""


def test_unframe_none_without_sync():
    assert L.fig_unframe(b"no sync word here") is None


def test_unframe_none_when_header_incomplete():
    assert L.fig_unframe(L.fig_frame(1, b"abcd")[:10]) is None


def test_unframe_none_when_payload_incomplete():
    assert L.fig_unframe(L.fig_frame(1, b"abcdef")[:-1]) is None


# ── key material ─────────────────────────────────────────────────────────────
def test_session_key_matches_spec():
    K, n = b"K" * 32, bytes.fromhex("00112233445566778899aabbccddeeff")
    assert L.session_key(K, n) == hashlib.sha256(K + n).digest()


def test_session_key_rejects_short_key():
    with pytest.raises(ValueError):
        L.session_key(b"short", b"n")


def test_session_proof_matches_spec():
    K, ch = b"K" * 32, b"challenge-bytes"
    assert L.session_proof(K, ch) == hmac.new(K, ch, hashlib.sha256).digest()


def test_session_proof_rejects_short_key():
    with pytest.raises(ValueError):
        L.session_proof(b"short", b"c")


# ── SRP-6a: a full exchange against a device side built from the same table ──
def test_srp_client_and_device_agree_on_key_and_proofs():
    passkey, salt = "4867", bytes(range(16))
    x = int.from_bytes(L._h(salt, L._h(passkey.encode())), "big")
    v = pow(L.SRP_G, x, L.SRP_N)  # device verifier
    b_priv = 0x2BADC0DE
    k = int.from_bytes(L._h(L._pad(L.SRP_N), L._pad(L.SRP_G)), "big")
    B = (k * v + pow(L.SRP_G, b_priv, L.SRP_N)) % L.SRP_N
    cli = L.SrpClient(private_value=0x1234)
    assert cli.public_hex() == L._pad(cli.A).hex()
    m1, m2_expected, K = cli.prove(L._pad(B).hex(), salt.hex(), passkey)
    u = int.from_bytes(L._h(L._pad(cli.A), L._pad(B)), "big")
    S_dev = pow(cli.A * pow(v, u, L.SRP_N), b_priv, L.SRP_N)
    K_dev = L._h(L._pad(S_dev))
    assert K == K_dev
    hn, hg = L._h(L._pad(L.SRP_N)), L._h(L._pad(L.SRP_G))
    m1_dev = L._h(bytes(p ^ q for p, q in zip(hn, hg)), salt, L._pad(cli.A), L._pad(B), K_dev)
    assert m1 == m1_dev.hex()
    assert m2_expected == L._h(L._pad(cli.A), m1_dev, K_dev).hex()


def test_srp_client_generates_a_random_private_value_by_default():
    assert L.SrpClient().A != L.SrpClient().A


# ── RPC builders ─────────────────────────────────────────────────────────────
def test_rpc_omits_params_when_none():
    obj = json.loads(L.rpc("GetDateTime", None, 7, "1.0"))
    assert obj == {"jsonrpc": "1.0", "method": "GetDateTime", "id": 7} and "params" not in obj


def test_rpc_includes_params_when_given():
    assert json.loads(L.rpc("X", {"a": 1}, 3, "2.0"))["params"] == {"a": 1}


def test_session_and_pairing_builders():
    assert json.loads(L.request_session("cid"))["method"] == "RequestSession"
    assert json.loads(L.check_session_integrity("ab"))["params"]["response"] == "ab"
    assert json.loads(L.start_key_exchange("00"))["params"]["clientPk"] == "00"
    assert json.loads(L.confirm_key_exchange("m1"))["params"]["clientConfirmation"] == "m1"


def test_get_date_time_builder_shape():
    obj = json.loads(L.get_date_time(13))
    assert obj["method"] == "GetDateTime" and obj["jsonrpc"] == "1.0" and "params" not in obj


def test_get_items_builds_array_and_rejects_bad_names():
    assert json.loads(L.get_items(["A", "B"]))["params"] == ["A", "B"]
    for bad in ([], [""], [1]):
        with pytest.raises(ValueError):
            L.get_items(bad)


def test_start_spool_requires_from_dt_and_max_spool_size():
    # HARDWARE-CONFIRMED shape: fromDateTime AND maxSpoolSize both present, or the AS11 answers -32602.
    obj = json.loads(L.start_spool("Summary", "2026-04-29T00:00:00.000Z"))
    assert obj["params"]["spoolAddress"]["Summary"] == {"fromDateTime": "2026-04-29T00:00:00.000Z"}
    assert obj["params"]["maxSpoolSize"] == 4096
    assert obj["method"] == "StartSpool" and obj["id"] == 14 and obj["jsonrpc"] == "1.0"


def test_start_spool_rejects_a_missing_from_dt():
    # an empty spool address is what the device rejects — so it must never be built; the message names it
    for bad in (None, ""):
        with pytest.raises(ValueError, match="fromDateTime"):
            L.start_spool("Summary", bad)


def test_pull_spool_fragments_builder():
    obj = json.loads(L.pull_spool_fragments(12))
    assert obj["params"]["spoolId"] == 12 and obj["method"] == "PullSpoolFragments"


# ── StartStream (live waveform) ────────────────────────────────────────────────
def test_start_stream_builds_the_request_with_a_defaulted_report_interval():
    obj = json.loads(L.start_stream(["PatientFlow", "MaskPressure"], 40))
    assert obj["method"] == "StartStream" and obj["jsonrpc"] == "1.0"
    p = obj["params"]
    assert p["dataIds"] == ["PatientFlow", "MaskPressure"]
    assert p["sampleIntervalMs"] == 40
    assert p["reportIntervalMs"] == 200, "reportIntervalMs defaults to exactly 5× the sample interval"


def test_start_stream_all_defaults_are_the_documented_values():
    """Calling with ONLY the dataIds must produce the hardware-confirmed defaults: 40 ms sample, 200 ms
    report (5×), and rpc id 16. Pins each default value, not just the shape."""
    obj = json.loads(L.start_stream(["PatientFlow"]))
    assert obj["id"] == 16, "the default rpc_id is 16"
    p = obj["params"]
    assert p["sampleIntervalMs"] == 40 and p["reportIntervalMs"] == 200


def test_start_stream_uses_the_rpc_id_it_is_given():
    assert json.loads(L.start_stream(["PatientFlow"], 40, rpc_id=99))["id"] == 99


def test_start_stream_honours_an_explicit_report_interval():
    p = json.loads(L.start_stream(["SpO2"], 1000, 1000))["params"]
    assert p["reportIntervalMs"] == 1000


def test_start_stream_rejects_an_empty_or_malformed_id_list():
    for bad in ([], [""], [1], ["ok", ""]):
        with pytest.raises(ValueError, match="dataId"):
            L.start_stream(bad, 40)


def test_start_stream_accepts_exactly_thirty_ids_but_rejects_thirty_one():
    """The cap is INCLUSIVE at 30 (`> 30`, not `>= 30`): 30 is the documented maximum and must build."""
    assert len(json.loads(L.start_stream([f"d{i}" for i in range(30)], 40))["params"]["dataIds"]) == 30
    with pytest.raises(ValueError, match="at most 30"):
        L.start_stream([f"d{i}" for i in range(31)], 40)


def test_start_stream_bounds_the_sample_interval():
    for bad in (9, 65001):
        with pytest.raises(ValueError, match="10.*65000"):
            L.start_stream(["PatientFlow"], bad)
    # the inclusive edges are accepted
    assert json.loads(L.start_stream(["PatientFlow"], 10))["params"]["sampleIntervalMs"] == 10
    assert json.loads(L.start_stream(["PatientFlow"], 65000))["params"]["sampleIntervalMs"] == 65000


def test_start_stream_report_interval_lower_bound_is_inclusive_at_one():
    """The report window may be as small as 1 ms (`1 <= report`, not `2 <=` or `1 <`): report=1 must
    build. Pins the lower boundary against both an off-by-one and a strict-inequality mutant."""
    assert json.loads(L.start_stream(["PatientFlow"], 40, 1))["params"]["reportIntervalMs"] == 1


def test_start_stream_report_interval_may_not_exceed_five_times_the_sample():
    with pytest.raises(ValueError, match="reportIntervalMs"):
        L.start_stream(["PatientFlow"], 40, 201)   # 5× is 200
    assert json.loads(L.start_stream(["PatientFlow"], 40, 200))["params"]["reportIntervalMs"] == 200
    with pytest.raises(ValueError, match="reportIntervalMs"):
        L.start_stream(["PatientFlow"], 40, 0)     # must be ≥ 1


# ── FIG CRC verification (2026-09-19) ─────────────────────────────────────────
# `fig_frame` has ALWAYS written both CRCs — the payload CRC32 inside the header struct and a CRC32
# over that header — and `fig_unframe` verified NEITHER: the payload CRC went into a discard name and
# the header CRC at bytes 12-16 was never read. The payload cipher is AES-256-CBC with no MAC, so a
# flipped bit surfaced only if it happened to break the pad or the JSON.


def _corrupt(frame: bytes, index: int) -> bytes:
    b = bytearray(frame)
    b[index] ^= 0xFF
    return bytes(b)


def test_a_clean_frame_still_roundtrips_and_reports_NOTHING():
    """The positive control. A verifier that rejects everything would pass the tests below."""
    seen = []
    frame = L.fig_frame(L.VCID_PLAIN_TX, b"hello")
    vcid, payload, rest = L.fig_unframe(frame, on_bad_crc=seen.append)
    assert (vcid, payload, rest) == (L.VCID_PLAIN_TX, b"hello", b"")
    assert seen == [], "a good frame must not report a CRC failure"


def test_a_corrupt_PAYLOAD_is_detected_and_named():
    """The half nothing else covers: the header verifies, so the frame LOOKS well-formed, and only the
    payload CRC separates it from a real one."""
    seen = []
    frame = L.fig_frame(L.VCID_PLAIN_TX, b"hello")
    assert L.fig_unframe(_corrupt(frame, len(frame) - 1), on_bad_crc=seen.append) is None
    assert seen == ["payload"]


def test_a_corrupt_HEADER_is_detected_and_named():
    seen = []
    frame = L.fig_frame(L.VCID_PLAIN_TX, b"hello")
    assert L.fig_unframe(_corrupt(frame, 5), on_bad_crc=seen.append) is None
    assert seen == ["header"]


def test_a_CORRUPT_FRAME_DOES_NOT_WEDGE_THE_STREAM():
    """🔴 THE REASON A BAD CRC RESYNCS INSTEAD OF RETURNING None, and it is a property of OUR caller.

    `capture.py`'s notify handler is `while True: r = fig_unframe(bytes(rx)); if not r: break`, and it
    trims `rx` ONLY on success. A corrupt frame that merely returned None would sit at the head of the
    buffer forever — every later notification re-parsing the same bad bytes and breaking again, with
    the link permanently deaf and no error anywhere. So the corrupt frame must be skipped WITHIN the
    call and the next good one delivered, which is what lets the caller advance."""
    good = L.fig_frame(L.VCID_PLAIN_TX, b"hello")
    for label, bad in (("header", _corrupt(good, 5)), ("payload", _corrupt(good, len(good) - 1))):
        seen = []
        r = L.fig_unframe(bad + good, on_bad_crc=seen.append)
        assert r is not None, f"{label}: a corrupt frame must not hide the good frame behind it"
        assert r[1] == b"hello" and seen == [label]
        assert r[2] == b"", "the remainder must exclude everything skipped, so the caller can trim"


def test_a_payload_failure_skips_THE_WHOLE_FRAME_not_four_bytes():
    """The header verified, so `length` is trustworthy and the frame boundary is KNOWN. Rescanning from
    +4 would hunt a sync word inside payload bytes — and a payload that happens to contain the sync
    word would then be re-parsed as a frame. One report, not several."""
    good = L.fig_frame(L.VCID_PLAIN_TX, struct.pack("<I", L.FIG_SYNC) * 3)
    seen = []
    r = L.fig_unframe(_corrupt(good, len(good) - 1) + good, on_bad_crc=seen.append)
    assert seen == ["payload"], f"expected one report, got {seen}"
    assert r is not None and r[1] == struct.pack("<I", L.FIG_SYNC) * 3


def test_the_callback_is_OPTIONAL_and_verification_still_happens_without_it():
    """Back-compat: every existing caller passes no callback. Verification is not conditional on
    someone asking to be told — an unverified frame must not be deliverable either way."""
    frame = L.fig_frame(L.VCID_PLAIN_TX, b"hello")
    # BOTH kinds, because the claim is about verification and not about one CRC: the no-callback path
    # is a separate branch per CRC, and testing only the payload left the header one untaken — caught
    # by the 100 % branch floor, which is exactly what it is for.
    assert L.fig_unframe(_corrupt(frame, len(frame) - 1)) is None, "payload, no callback"
    assert L.fig_unframe(_corrupt(frame, 5)) is None, "header, no callback"


def test_the_PRODUCTION_caller_wires_the_counter_to_a_consumer():
    """A count that reaches nobody is the #2670 defect one layer up — `link`/`offline_op` incremented
    into a dict `snapshot()` could not enumerate, so real failures never reached published status. The
    callback exists to be wired; this asserts the one production call site wires it."""
    from tests._srcscan import module_source

    src = module_source("capture.py")
    assert "_L.fig_unframe(bytes(rx), on_bad_crc=" in src, "the notify handler dropped the counter"
    assert 'blestats.fail("fig_crc"' in src, "CRC failures must reach blestats, not just a log"
