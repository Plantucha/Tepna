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


def test_start_spool_rejects_a_missing_from_dt():
    # an empty spool address is what the device rejects — so it must never be built
    for bad in (None, ""):
        with pytest.raises(ValueError):
            L.start_spool("Summary", bad)


def test_pull_spool_fragments_builder():
    obj = json.loads(L.pull_spool_fragments(12))
    assert obj["params"]["spoolId"] == 12 and obj["method"] == "PullSpoolFragments"
