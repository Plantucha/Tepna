# tepna-capture — tests/test_webmon_seal.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The two operator actions of CAPTURE-NIGHT-SEAL §13 (2) on the monitor: re-display the card (lost)
and rotate it (stolen) — 404 until the seal poller is armed, never minting keys of their own — and the
Storage view's seal block that reads STATUS.seal."""

import os

import sealbox
from tests.test_webmon_api import _mk, _serve

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _get(app, path):
    async def go(c):
        r = await c.get(path)
        return r.status, r.content_type, await r.text()

    return _serve(app, go)


def _post(app, path):
    async def go(c):
        r = await c.post(path, json={})
        return r.status, await r.json()

    return _serve(app, go)


def test_card_and_rotate_are_404_until_the_seal_poller_is_armed(tmp_path):
    app, *_ = _mk(tmp_path)
    status, _ct, text = _get(app, "/api/seal/card")
    assert status == 404 and "not armed" in text
    app, *_ = _mk(tmp_path)  # one app per served request (one loop each)
    status, j = _post(app, "/api/seal/rotate")
    assert status == 404 and not os.path.exists(str(tmp_path / "keys"))  # nothing minted by the endpoints


def test_card_redisplays_the_current_key_and_rotate_mints_the_next(tmp_path):
    kd = str(tmp_path / "keys")
    k, _ = sealbox.load_or_create_signing_key(kd)
    store, _ = sealbox.load_or_create_card_store(kd)
    app, cfg, st, *_ = _mk(tmp_path)
    cfg["seal"] = {"enabled": True, "box_id": "box9"}
    st["seal"] = {"armed": True, "box_id": "box9", "key_id": 1}
    status, ct, page = _get(app, "/api/seal/card")
    assert status == 200 and ct == "text/html"
    import sealfmt as F

    assert F.card_code_encode(sealbox.current_card_key(store)[1]) in page and "card key <b>1</b>" in page
    app, cfg, st, *_ = _mk(tmp_path)
    cfg["seal"] = {"enabled": True, "box_id": "box9"}
    st["seal"] = {"armed": True, "box_id": "box9", "key_id": 1}
    status, j = _post(app, "/api/seal/rotate")
    assert status == 200 and j["ok"] and j["keyId"] == 2 and j["card"].endswith("box9-card-k2.html")
    assert os.path.exists(j["card"]) and st["seal"]["key_id"] == 2
    store2, _ = sealbox.load_or_create_card_store(kd)
    assert store2["keyId"] == 2 and "1" in store2["keys"]  # the old key is kept
    app, cfg, st, *_ = _mk(tmp_path)
    cfg["seal"] = {"enabled": True, "box_id": "box9"}
    st["seal"] = {"armed": True, "box_id": "box9", "key_id": 2}
    status, ct, page = _get(app, "/api/seal/card")
    assert "card key <b>2</b>" in page  # re-display shows the current key


def test_endpoints_report_a_broken_key_store_instead_of_500ing_blind(tmp_path):
    kd = tmp_path / "keys"
    kd.mkdir()
    (kd / sealbox.CARD_STORE_NAME).write_text("{broken")
    app, cfg, st, *_ = _mk(tmp_path)
    cfg["seal"] = {"enabled": True}
    st["seal"] = {"armed": True, "box_id": "b"}
    status, _ct, text = _get(app, "/api/seal/card")
    assert status == 500 and "malformed" in text
    app, cfg, st, *_ = _mk(tmp_path)
    cfg["seal"] = {"enabled": True}
    st["seal"] = {"armed": True, "box_id": "b"}
    status, j = _post(app, "/api/seal/rotate")
    assert status == 500 and "malformed" in j["error"]


def test_the_storage_view_draws_the_seal_block_and_wires_both_actions():
    html = open(os.path.join(HERE, "monitor.html"), encoding="utf-8").read()
    for frag in (
        'id="sealCard"',
        'id="stSeal"',
        'id="sealShowCard"',
        'id="sealRotate"',
        "function renderSealStatus",
        "STATE.seal",
        "/api/seal/card",
        "/api/seal/rotate",
        "renderSealStatus();",
    ):
        assert frag in html, frag
    assert "not asked" in html  # consent null renders as its own state
