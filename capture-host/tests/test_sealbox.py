# tepna-capture — tests/test_sealbox.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The box side of the night seal (CAPTURE-NIGHT-SEAL phase B, §13): keys generated once and never
replaced, the card store and its rotation, the card page, bag-info's five facts, and the per-night
seal-or-reissue decision with its verdict — each outcome planted, each verdict validated by both halves
of the contract."""

import datetime as dt
import json
import os
import stat

import pytest

import seal
import sealbox
import sealfmt as F
import unseal
import verdict
from tests.test_verdict import js_validate


def _both(o):
    verdict.validate(o)
    v = js_validate(o)
    assert v["ok"], v["errors"]


# ── (1) signing key ──────────────────────────────────────────────────────────────────────────────────


def test_the_signing_key_is_generated_once_at_0600_and_never_silently_replaced(tmp_path):
    kd = str(tmp_path / "keys")
    k1, made = sealbox.load_or_create_signing_key(kd)
    assert made is True
    p = os.path.join(kd, sealbox.SIGNING_NAME)
    assert stat.S_IMODE(os.stat(p).st_mode) == 0o600 and stat.S_IMODE(os.stat(kd).st_mode) == 0o700
    k2, made = sealbox.load_or_create_signing_key(kd)
    assert made is False and seal.public_raw(k1) == seal.public_raw(k2)  # the same key, the same fingerprint
    assert not os.path.exists(p + ".tmp")
    open(p, "wb").write(b"not a pem")
    with pytest.raises(sealbox.SealBoxError, match="unreadable"):  # never regenerated over a bad file
        sealbox.load_or_create_signing_key(kd)


def test_a_non_ec_key_file_is_refused(tmp_path, monkeypatch):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    kd = str(tmp_path / "keys")
    os.makedirs(kd)
    rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=1024)
    open(os.path.join(kd, sealbox.SIGNING_NAME), "wb").write(
        rsa_key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
    )
    with pytest.raises(sealbox.SealBoxError, match="not an EC key"):
        sealbox.load_or_create_signing_key(kd)


def test_a_failed_private_write_leaves_no_tmp_behind(tmp_path, monkeypatch):
    kd = str(tmp_path / "keys")
    os.makedirs(kd)
    monkeypatch.setattr(sealbox.os, "replace", lambda a, b: (_ for _ in ()).throw(OSError("disk")))
    with pytest.raises(OSError):
        sealbox._write_private_0600(os.path.join(kd, "x"), b"y")
    assert os.listdir(kd) == []


# ── (2) card store ───────────────────────────────────────────────────────────────────────────────────


def test_the_card_store_is_created_once_and_rotation_keeps_every_old_key(tmp_path):
    kd = str(tmp_path / "keys")
    rng = lambda n: bytes(range(n))  # noqa: E731 — deterministic key
    store, made = sealbox.load_or_create_card_store(kd, rng=rng)
    assert made and store["keyId"] == 1 and sealbox.current_card_key(store) == (1, bytes(range(16)))
    assert stat.S_IMODE(os.stat(os.path.join(kd, sealbox.CARD_STORE_NAME)).st_mode) == 0o600
    again, made = sealbox.load_or_create_card_store(kd)
    assert not made and again == store
    rotated = sealbox.rotate_card(kd, store, rng=lambda n: bytes([7] * n))
    assert rotated["keyId"] == 2 and sealbox.card_key_for(rotated, 1) == bytes(range(16))
    assert sealbox.card_key_for(rotated, 2) == bytes([7] * 16) and sealbox.card_key_for(rotated, 3) is None
    assert len(rotated["rotatedAt"]) == 1
    reloaded, _ = sealbox.load_or_create_card_store(kd)
    assert reloaded == rotated  # persisted, still 0600
    os.unlink(os.path.join(kd, sealbox.CARD_STORE_NAME))  # rotation with no file on disk still writes one
    again = sealbox.rotate_card(kd, rotated)
    assert again["keyId"] == 3 and sealbox.load_or_create_card_store(kd)[0]["keyId"] == 3


def test_a_malformed_or_short_card_store_is_refused(tmp_path):
    kd = str(tmp_path / "keys")
    os.makedirs(kd)
    p = os.path.join(kd, sealbox.CARD_STORE_NAME)
    open(p, "w").write("{not json")
    with pytest.raises(sealbox.SealBoxError, match="malformed"):
        sealbox.load_or_create_card_store(kd)
    open(p, "w").write(json.dumps({"keyId": 1, "keys": {"1": "abcd"}}))
    with pytest.raises(sealbox.SealBoxError, match="not 16 bytes"):
        sealbox.load_or_create_card_store(kd)


# ── the card ─────────────────────────────────────────────────────────────────────────────────────────


def test_the_card_carries_the_code_the_fingerprint_and_says_when_there_is_no_qr(tmp_path, monkeypatch):
    key = bytes(range(16))
    page = sealbox.render_card_html(box_id="vigil<1>", key_id=3, card_key=key, fingerprint="sha256/abc", qr=None)
    assert F.card_code_encode(key) in page and "sha256/abc" in page and "vigil&lt;1&gt;" in page
    assert "No QR on this card" in page and "<script" not in page and "http" not in page.split("<body")[1]
    assert "issue key 4" in page
    page = sealbox.render_card_html(box_id="b", key_id=1, card_key=key, fingerprint="f", qr="<svg>QR</svg>")
    assert "<svg>QR</svg>" in page and "No QR" not in page


def test_qr_svg_is_none_without_segno_and_an_svg_with_an_encoder(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def no_segno(name, *a, **k):
        if name == "segno":
            raise ImportError("no segno")
        return real_import(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", no_segno)
    assert sealbox._load_segno() is None and sealbox.qr_svg("ABCD") is None
    monkeypatch.setattr(builtins, "__import__", real_import)
    assert sealbox._load_segno(import_module=lambda name: name) == "segno"  # installed ⇒ the module comes back

    class _Fake:  # segno's surface as the card uses it: make(text, error=).save(buf, kind="svg", ...)
        def make(self, text, error):
            assert error == "m" and text == "ABCD"

            class _Q:
                def save(self, buf, **kw):
                    assert kw["kind"] == "svg" and kw["svgns"] is True
                    buf.write(b"<svg>QR</svg>")

            return _Q()

    assert sealbox.qr_svg("ABCD", encoder=_Fake()) == "<svg>QR</svg>"
    try:
        import segno  # noqa: F401
    except ImportError:
        return  # the real encoder runs where it is installed
    assert sealbox.qr_svg("ABCD").lstrip().startswith("<svg")


def test_write_card_names_the_file_by_box_and_key_and_writes_atomically(tmp_path):
    kd = str(tmp_path / "keys")
    ob = str(tmp_path / "outbox")
    k, _ = sealbox.load_or_create_signing_key(kd)
    store, _ = sealbox.load_or_create_card_store(kd)
    p = sealbox.write_card(ob, box_id="box1", store=store, signing_key=k)
    assert p == os.path.join(ob, "box1-card-k1.html") and os.path.exists(p) and not os.path.exists(p + ".part")
    assert F.fingerprint(seal.public_raw(k)) in open(p, encoding="utf-8").read()


# ── (3) extra_info ──────────────────────────────────────────────────────────────────────────────────


def test_extra_info_reads_each_fact_from_where_it_lives_and_nulls_the_rest():
    cfg = {
        "devices": [
            {"vendor": "Polar", "model": "H10", "device_id": "0284", "address": "24:AC:AC:02:84:96"},
            {"name": "x"},
            "junk",
        ],
        "seal": {"research_consent": None},
    }
    e = sealbox.extra_info(cfg, version="2.6.0", commit="abc1234", revision=2)
    assert e == {
        "Tepna-Capture-Host-Version": "2.6.0",
        "Tepna-Capture-Host-Commit": "abc1234",
        "Tepna-Device-Inventory": "Polar H10 0284",
        "Tepna-Research-Consent": "null",
        "Tepna-Seal-Revision": "2",
    }
    assert "24:AC" not in json.dumps(e)  # never a BLE address in the bag
    e = sealbox.extra_info({}, version=None, commit=None, revision=1)
    assert e["Tepna-Capture-Host-Version"] == "null" and e["Tepna-Capture-Host-Commit"] == "null"
    assert e["Tepna-Device-Inventory"] == "null"
    assert sealbox.consent_value({"seal": {"research_consent": True}}) == "yes"
    assert sealbox.consent_value({"seal": {"research_consent": "no"}}) == "no"
    assert sealbox.consent_value({"seal": {"research_consent": False}}) == "no"
    assert sealbox.consent_value({}) is None  # not asked — never a default
    assert (
        sealbox.extra_info({"seal": {"research_consent": "yes"}}, version=None, commit=None, revision=1)[
            "Tepna-Research-Consent"
        ]
        == "yes"
    )


def test_box_id_defaults_to_the_hostname(monkeypatch):
    monkeypatch.setattr(sealbox.socket, "gethostname", lambda: "vigil")
    assert sealbox.box_id_of({}) == "vigil" and sealbox.box_id_of({"seal": {"box_id": "S8AW2100"}}) == "S8AW2100"


# ── seal_or_reissue ─────────────────────────────────────────────────────────────────────────────────


def _box(tmp_path):
    kd = str(tmp_path / "keys")
    ob = str(tmp_path / "outbox")
    k, _ = sealbox.load_or_create_signing_key(kd)
    store, _ = sealbox.load_or_create_card_store(kd)
    night = tmp_path / "captures" / "2026-09-19"
    night.mkdir(parents=True)
    (night / "Polar_H10_0284_20260919_ECG.txt").write_text("a;b\n1;2\n")
    (night / "QC-SUMMARY.json").write_text("{}")
    return kd, ob, k, store, str(night)


def _run(tmp_path, ob, k, store, night, cfg=None, **kw):
    return sealbox.seal_or_reissue(
        night,
        outbox=ob,
        box_id="box1",
        night="2026-09-19",
        store=store,
        signing_key=k,
        cfg=cfg or {"seal": {"research_consent": None}},
        version="2.6.0",
        commit="abc1234",
        now=dt.datetime(2026, 9, 20, 9, 0),
        **kw,
    )


def test_first_seal_passes_then_reads_not_applicable_until_the_directory_moves(tmp_path):
    kd, ob, k, store, night = _box(tmp_path)
    o = _run(tmp_path, ob, k, store, night)
    _both(o)
    final = os.path.join(ob, "box1-2026-09-19.tepna")
    assert o["status"] == "PASS" and o["result"]["revision"] == 1 and o["result"]["files"] == 2
    assert os.path.exists(final) and os.path.exists(final + ".verdict.json")
    assert json.load(open(final + ".verdict.json"))["gate"] == "night-seal"
    # the seal is readable with the card key and the pinned fingerprint — the reader's own verdict
    kid, ck = sealbox.current_card_key(store)
    r = unseal.unseal(final, card_key=ck, pinned_fingerprint=F.fingerprint(seal.public_raw(k)))
    assert sorted(r["files"]) == ["Polar_H10_0284_20260919_ECG.txt", "QC-SUMMARY.json"]
    assert r["bag_info"]["Tepna-Research-Consent"] == "null" and r["bag_info"]["Tepna-Seal-Revision"] == "1"
    assert r["bag_info"]["Tepna-Capture-Host-Commit"] == "abc1234"
    # nothing changed ⇒ NOT_APPLICABLE, and the file is untouched
    before = os.stat(final).st_mtime_ns
    o = _run(tmp_path, ob, k, store, night)
    _both(o)
    assert o["status"] == "NOT_APPLICABLE" and "revision 1 still matches" in o["reason"]
    assert os.stat(final).st_mtime_ns == before


def test_a_post_close_writer_gets_a_verified_reissue_at_revision_2(tmp_path):
    kd, ob, k, store, night = _box(tmp_path)
    _run(tmp_path, ob, k, store, night)
    open(os.path.join(night, "BACKCHECK-VERDICT.json"), "w").write("{}")  # the back-check sidecar lands
    o = _run(tmp_path, ob, k, store, night)
    _both(o)
    final = os.path.join(ob, "box1-2026-09-19.tepna")
    assert o["status"] == "PASS" and o["result"]["revision"] == 2 and o["result"]["files"] == 3
    assert unseal.read_header(final)["revision"] == 2 and not os.path.exists(final + ".rev.part")
    # a rotated card leaves the night under ITS keyId: re-issue after rotation still uses key 1
    store2 = sealbox.rotate_card(kd, store)
    open(os.path.join(night, "late.txt"), "w").write("x")
    o = _run(tmp_path, ob, k, store2, night)
    assert o["status"] == "PASS" and o["result"]["keyId"] == 1 and o["result"]["revision"] == 3


def test_a_reissue_that_does_not_verify_keeps_the_previous_seal(tmp_path, monkeypatch):
    kd, ob, k, store, night = _box(tmp_path)
    _run(tmp_path, ob, k, store, night)
    final = os.path.join(ob, "box1-2026-09-19.tepna")
    rev1 = open(final, "rb").read()
    open(os.path.join(night, "late.txt"), "w").write("x")
    monkeypatch.setattr(sealbox._unseal, "verdict", lambda *a, **kw: {"status": "FAIL", "reason": "signature: planted"})
    o = _run(tmp_path, ob, k, store, night)
    _both(o)
    assert o["status"] == "FAIL" and "signature: planted" in o["reason"]
    assert open(final, "rb").read() == rev1 and not os.path.exists(final + ".rev.part")  # revision 1 stands


def test_a_first_seal_that_does_not_verify_is_not_left_in_the_outbox(tmp_path, monkeypatch):
    kd, ob, k, store, night = _box(tmp_path)
    monkeypatch.setattr(sealbox._unseal, "verdict", lambda *a, **kw: {"status": "FAIL", "reason": "payload: planted"})
    o = _run(tmp_path, ob, k, store, night)
    assert o["status"] == "FAIL" and not os.path.exists(os.path.join(ob, "box1-2026-09-19.tepna"))


def test_not_run_and_unknown_shapes(tmp_path, monkeypatch):
    kd, ob, k, store, night = _box(tmp_path)
    empty = tmp_path / "captures" / "2026-09-18"
    empty.mkdir()
    o = sealbox.seal_or_reissue(
        str(empty),
        outbox=ob,
        box_id="box1",
        night="2026-09-18",
        store=store,
        signing_key=k,
        cfg={},
        version=None,
        commit=None,
    )
    _both(o)
    assert o["status"] == "NOT_RUN" and "holds no files" in o["reason"] and o["population"]["checked"] == 0
    # a seal under a keyId the store no longer holds cannot be re-issued
    _run(tmp_path, ob, k, store, night)
    open(os.path.join(night, "late.txt"), "w").write("x")
    o = _run(tmp_path, ob, k, {"keyId": 9, "keys": {"9": "00" * 16}}, night)
    assert o["status"] == "NOT_RUN" and "keyId 1" in o["reason"]
    # the sealer raising is UNKNOWN naming it, and a half-written re-issue is removed
    monkeypatch.setattr(sealbox._seal, "seal_night", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("disk gone")))
    o = _run(tmp_path, ob, k, store, night)
    _both(o)
    assert o["status"] == "UNKNOWN" and "RuntimeError: disk gone" in o["reason"]
    assert not os.path.exists(os.path.join(ob, "box1-2026-09-19.tepna.rev.part"))

    def half_write_then_raise(night_dir, target, **kw):  # the sealer dies after opening its output
        open(target, "wb").write(b"half")
        raise RuntimeError("mid-write")

    monkeypatch.setattr(sealbox._seal, "seal_night", half_write_then_raise)
    o = _run(tmp_path, ob, k, store, night)
    assert o["status"] == "UNKNOWN" and not os.path.exists(os.path.join(ob, "box1-2026-09-19.tepna.rev.part"))
    # an unreadable existing seal reads as absent for the decision: sealed afresh at revision 1
    final = os.path.join(ob, "box1-2026-09-19.tepna")
    open(final, "wb").write(b"garbage")
    assert sealbox.existing_header(final) is None
    monkeypatch.undo()
    o = _run(tmp_path, ob, k, store, night)
    assert o["status"] == "PASS" and o["result"]["revision"] == 1


def test_a_verdict_file_that_cannot_be_written_is_logged_not_raised(tmp_path, monkeypatch, caplog):
    kd, ob, k, store, night = _box(tmp_path)
    monkeypatch.setattr(sealbox._verdict, "write", lambda p, o: (_ for _ in ()).throw(OSError("ro")))
    with caplog.at_level("WARNING"):
        o = _run(tmp_path, ob, k, store, night)
    assert o["status"] == "PASS" and any("could not write" in r.getMessage() for r in caplog.records)


def test_closed_at_is_the_newest_file_as_floating_ms(tmp_path):
    kd, ob, k, store, night = _box(tmp_path)
    t0 = dt.datetime(2026, 9, 20, 1, 0, 0).timestamp()
    t = dt.datetime(2026, 9, 20, 5, 30, 0).timestamp()
    os.utime(os.path.join(night, "Polar_H10_0284_20260919_ECG.txt"), (t0, t0))
    os.utime(os.path.join(night, "QC-SUMMARY.json"), (t, t))  # the newest file is the close
    assert sealbox.closed_at_ms(night) == int(
        dt.datetime(2026, 9, 20, 5, 30, tzinfo=dt.timezone.utc).timestamp() * 1000
    )
    # ⚠️ THIS ASSERTED THE FABRICATION UNTIL 2026-09-23: it pinned an empty directory's close time to
    # within 5 s of NOW, i.e. `default=time.time()` — the SEAL time written into a SIGNED header as the
    # instant the night closed, in-band and indistinguishable from a real reading. Absence is None.
    e = tmp_path / "empty"
    e.mkdir()
    assert sealbox.closed_at_ms(str(e)) is None


def test_PLANT_a_night_whose_files_vanish_before_the_seal_REFUSES(tmp_path, monkeypatch):
    """The only reachable path to an unmeasurable close: `n_files == 0` is already refused upstream, so
    the files must disappear BETWEEN `night_signature`'s count and `closed_at_ms`. Sealing anyway wrote
    `now` into the header as the close instant."""
    kd, ob, k, store, night = _box(tmp_path)
    real = sealbox._seal._night_files
    calls = {"n": 0}

    def once_then_gone(d):
        # A REAL TOCTOU: `night_signature` counts the files, then they are gone by `closed_at_ms`.
        # Patching the lister to return [] unconditionally does NOT reach this branch — the upstream
        # `n_files == 0` guard fires first with its own reason, which is what the first version of
        # this test actually asserted against.
        calls["n"] += 1
        return real(d) if calls["n"] == 1 else []

    monkeypatch.setattr(sealbox._seal, "_night_files", once_then_gone)
    o = sealbox.seal_or_reissue(
        night, outbox=ob, box_id="box-1", night="2026-09-19", store=store,
        signing_key=k, cfg={}, version=None, commit=None)
    assert o["status"] == "NOT_RUN", o
    assert "vanished before the seal" in (o["reason"] or ""), o["reason"]
    assert not os.path.exists(os.path.join(ob, "box-1-2026-09-19.tepna")), "no seal may be written"


def test_a_file_that_vanishes_MID_SCAN_is_skipped_not_raised(tmp_path):
    """A per-file OSError between the listing and the getmtime is the same race one level down: skip it,
    and if others remain the close time is still measured from them."""
    kd, ob, k, store, night = _box(tmp_path)
    t0 = dt.datetime(2026, 9, 20, 1, 0, 0).timestamp()
    t = dt.datetime(2026, 9, 20, 5, 30, 0).timestamp()
    # BOTH files, as the test above does: an untouched file keeps its creation mtime and would be the
    # newest, so the assertion would read `now` and pass for the wrong reason.
    os.utime(os.path.join(night, "Polar_H10_0284_20260919_ECG.txt"), (t0, t0))
    os.utime(os.path.join(night, "QC-SUMMARY.json"), (t, t))
    real_files = list(sealbox._seal._night_files(night))
    ghost = ("x", os.path.join(night, "Polar_H10_0284_20260919_GONE.txt"))
    import unittest.mock as _m
    with _m.patch.object(sealbox._seal, "_night_files", lambda d: real_files + [ghost]):
        got = sealbox.closed_at_ms(night)
    assert got == int(dt.datetime(2026, 9, 20, 5, 30, tzinfo=dt.timezone.utc).timestamp() * 1000)


# ── the seal runs in a child ─────────────────────────────────────────────────────────────────────────


def _job(tmp_path):
    kd, ob, k, store, night = _box(tmp_path)
    return {
        "night_dir": night,
        "outbox": ob,
        "box_id": "box1",
        "night": "2026-09-19",
        "key_dir": kd,
        "cfg": {"seal": {"research_consent": None}},
        "version": "2.6.0",
        "commit": "abc1234",
    }


def test_the_child_seals_from_a_job_on_stdin_and_prints_one_verdict(tmp_path):
    job = _job(tmp_path)
    out = sealbox.seal_job_main(json.dumps(job))
    o = json.loads(out)
    _both(o)
    assert o["status"] == "PASS" and o["result"]["revision"] == 1
    assert os.path.exists(os.path.join(job["outbox"], "box1-2026-09-19.tepna"))


def test_seal_in_subprocess_spawns_the_real_child_and_the_parent_gets_the_verdict(tmp_path):
    """The integration: a real interpreter, the real sealer, the object back over stdout — the daemon's
    path, minus the daemon. (RSS: measured 2026-09-22 on the real 09-17 night, 916 MB → +1 971 MB peak
    in the sealing process; that peak now belongs to a child that exits.)"""
    job = _job(tmp_path)
    o = sealbox.seal_in_subprocess(
        job["night_dir"],
        outbox=job["outbox"],
        box_id="box1",
        night="2026-09-19",
        key_dir=job["key_dir"],
        cfg=job["cfg"],
        version="2.6.0",
        commit="abc1234",
    )
    _both(o)
    assert o["status"] == "PASS" and o["producedBy"]["commit"] == "abc1234"
    o = sealbox.seal_in_subprocess(
        job["night_dir"],
        outbox=job["outbox"],
        box_id="box1",
        night="2026-09-19",
        key_dir=job["key_dir"],
        cfg=job["cfg"],
        version="2.6.0",
        commit="abc1234",
    )
    assert o["status"] == "NOT_APPLICABLE"  # the second run sees the seal it wrote


def test_a_child_that_dies_times_out_or_babbles_is_UNKNOWN_naming_it(tmp_path):
    import subprocess

    job = _job(tmp_path)
    kw = dict(
        outbox=job["outbox"],
        box_id="box1",
        night="2026-09-19",
        key_dir=job["key_dir"],
        cfg={},
        version=None,
        commit=None,
    )

    class _R:
        def __init__(self, rc, out="", err=""):
            self.returncode, self.stdout, self.stderr = rc, out, err

    o = sealbox.seal_in_subprocess(
        job["night_dir"], run=lambda *a, **k: _R(1, "", "Traceback\nMemoryError: boom"), **kw
    )
    _both(o)
    assert o["status"] == "UNKNOWN" and "exited 1: MemoryError: boom" in o["reason"]
    o = sealbox.seal_in_subprocess(job["night_dir"], run=lambda *a, **k: _R(0, "not json"), **kw)
    assert o["status"] == "UNKNOWN" and "not a verdict" in o["reason"]
    o = sealbox.seal_in_subprocess(job["night_dir"], run=lambda *a, **k: _R(0, json.dumps({"schema": "x"})), **kw)
    assert o["status"] == "UNKNOWN" and "not a verdict" in o["reason"]
    o = sealbox.seal_in_subprocess(job["night_dir"], run=lambda *a, **k: _R(1, "", ""), **kw)
    assert "(no stderr)" in o["reason"]

    def _timeout(*a, **k):
        raise subprocess.TimeoutExpired(cmd="x", timeout=k.get("timeout"))

    o = sealbox.seal_in_subprocess(job["night_dir"], run=_timeout, timeout_s=7, **kw)
    assert o["status"] == "UNKNOWN" and "exceeded 7 s" in o["reason"]
    o = sealbox.seal_in_subprocess(job["night_dir"], python="/nonexistent/python", **kw)
    assert o["status"] == "UNKNOWN" and "could not be started" in o["reason"]
    assert o["population"] == {"checked": 0, "eligible": 1, "excluded": 1}
