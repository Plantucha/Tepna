# tepna-capture — tests/test_polar_mirror.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The device mirror. What is pinned:
#
#   * REDACTION. `/U/0/USERID.BPB` holds the owner's real name and Polar account UUID, and
#     `/SYS/BT/<n>/BTDEV.BPB` holds each paired host's address and a 128-bit key. A mirror is personal
#     data and pairing secrets, so `--redact` must actually cover BOTH — the second was missed on the
#     first pass and only added after reading the bytes.
#   * TRUST. Bonded-but-untrusted is indistinguishable from unbonded at the ATT layer and makes every
#     PS-FTP call fail with a message about BlueZ. The mirror repairs it before doing anything else.
#   * RESUMABILITY. The link dies mid-run routinely; a file already local must not be re-fetched, and a
#     failure on one file must not lose the ones already written.

import asyncio
import json
import os

import polar_mirror as pm


def _run(c):
    return asyncio.run(c)


class _FakeFs:
    """A PS-FTP session over an in-memory tree. `hangs` names paths that never answer."""

    def __init__(self, tree, blobs, hangs=(), errors=()):
        self.tree, self.blobs, self.hangs, self.errors = tree, blobs, set(hangs), set(errors)
        self.fetched = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def list_dir(self, path):
        if path not in self.tree:
            raise RuntimeError(f"no such dir {path}")
        return self.tree[path]

    async def list_dir_ex(self, path):
        """`(entries, truncated)` — what `walk` actually calls. `truncated` is driven by `self.cut` so
        a test can hand the mirror a listing that was cut short, which is the case a fake that only
        knows `list_dir` cannot express at all."""
        return await self.list_dir(path), path in getattr(self, "cut", ())

    async def get(self, path, timeout=0):
        self.fetched.append(path)
        if path in self.hangs:
            await asyncio.sleep(3600)
        if path in self.errors:
            raise RuntimeError("PS-FTP error 106")
        return self.blobs[path]


TREE = {
    "/": [("SYS/", 0), ("U/", 0), ("DEVICE.BPB", 4)],
    "/SYS/": [("BT/", 0)],
    "/SYS/BT/": [("0/", 0)],
    "/SYS/BT/0/": [("BTDEV.BPB", 6)],
    "/U/": [("0/", 0)],
    "/U/0/": [("USERID.BPB", 5)],
}
BLOBS = {"/DEVICE.BPB": b"dev!", "/SYS/BT/0/BTDEV.BPB": b"secret", "/U/0/USERID.BPB": b"name!"}


def _patch(monkeypatch, fs, trusted="already trusted"):
    monkeypatch.setattr(pm.psftp, "PolarPsFtp", lambda addr: fs)
    monkeypatch.setattr(pm, "ensure_trusted", lambda a: trusted)


def test_the_whole_tree_is_walked_and_pulled(monkeypatch, tmp_path):
    fs = _FakeFs(TREE, BLOBS)
    _patch(monkeypatch, fs)
    res = _run(pm.mirror("AA:BB", str(tmp_path), redact=False))
    assert res["n_files_seen"] == 3
    assert open(os.path.join(tmp_path, "DEVICE.BPB"), "rb").read() == b"dev!"
    assert open(os.path.join(tmp_path, "SYS/BT/0/BTDEV.BPB"), "rb").read() == b"secret"
    assert json.load(open(os.path.join(tmp_path, "MANIFEST.json")))["files"]["/DEVICE.BPB"]["status"] == "pulled"


def test_redaction_covers_the_bonding_keys_not_just_the_name(monkeypatch, tmp_path):
    """The bonding table is the STRONGER reason to redact: it holds other hosts' pairing secrets."""
    fs = _FakeFs(TREE, BLOBS)
    _patch(monkeypatch, fs)
    _run(pm.mirror("AA:BB", str(tmp_path), redact=True))
    for p in ("U/0/USERID.BPB", "SYS/BT/0/BTDEV.BPB"):
        body = open(os.path.join(tmp_path, p)).read()
        assert "REDACTED" in body, f"{p} was written verbatim"
    assert "/U/0/USERID.BPB" not in fs.fetched, "a redacted file must not even be fetched"
    assert open(os.path.join(tmp_path, "DEVICE.BPB"), "rb").read() == b"dev!", "non-PII is untouched"


def test_a_file_already_local_is_not_refetched(monkeypatch, tmp_path):
    os.makedirs(tmp_path, exist_ok=True)
    open(os.path.join(tmp_path, "DEVICE.BPB"), "wb").write(b"dev!")
    fs = _FakeFs(TREE, BLOBS)
    _patch(monkeypatch, fs)
    res = _run(pm.mirror("AA:BB", str(tmp_path), redact=False))
    assert "/DEVICE.BPB" not in fs.fetched
    assert res["files"]["/DEVICE.BPB"]["status"] == "already local"


def test_a_local_file_of_the_wrong_size_is_refetched(monkeypatch, tmp_path):
    open(os.path.join(tmp_path, "DEVICE.BPB"), "wb").write(b"xx")
    fs = _FakeFs(TREE, BLOBS)
    _patch(monkeypatch, fs)
    _run(pm.mirror("AA:BB", str(tmp_path), redact=False))
    assert open(os.path.join(tmp_path, "DEVICE.BPB"), "rb").read() == b"dev!"


def test_a_hanging_path_is_bounded_and_the_rest_still_arrive(monkeypatch, tmp_path):
    """Some paths never answer. One of them must not consume the window."""
    monkeypatch.setattr(pm, "FILE_TIMEOUT", 0.05)
    fs = _FakeFs(TREE, BLOBS, hangs={"/DEVICE.BPB"})
    _patch(monkeypatch, fs)
    res = _run(pm.mirror("AA:BB", str(tmp_path), redact=False))
    assert "TIMEOUT" in res["files"]["/DEVICE.BPB"]["status"]
    assert res["files"]["/U/0/USERID.BPB"]["status"] == "pulled"


def test_a_real_psftp_error_is_recorded_against_the_file(monkeypatch, tmp_path):
    fs = _FakeFs(TREE, BLOBS, errors={"/U/0/USERID.BPB"})
    _patch(monkeypatch, fs)
    res = _run(pm.mirror("AA:BB", str(tmp_path), redact=False))
    assert "error 106" in res["files"]["/U/0/USERID.BPB"]["status"]


def test_a_size_mismatch_is_flagged_rather_than_accepted(monkeypatch, tmp_path):
    fs = _FakeFs(TREE, {**BLOBS, "/DEVICE.BPB": b"longer-than-declared"})
    _patch(monkeypatch, fs)
    res = _run(pm.mirror("AA:BB", str(tmp_path), redact=False))
    assert "size differs" in res["files"]["/DEVICE.BPB"]["status"]


def test_an_unlistable_directory_is_recorded_not_fatal(monkeypatch, tmp_path):
    tree = {**TREE, "/": [("GONE/", 0), ("DEVICE.BPB", 4)]}
    fs = _FakeFs(tree, BLOBS)
    _patch(monkeypatch, fs)
    res = _run(pm.mirror("AA:BB", str(tmp_path), redact=False))
    assert "/GONE/" in res["errors"]
    assert res["files"]["/DEVICE.BPB"]["status"] == "pulled"


def test_a_truncated_listing_is_recorded_as_an_error_and_the_rest_still_mirrors(monkeypatch, tmp_path):
    """A CUT LISTING IS THE ONE FAILURE A MIRROR CANNOT SHRUG OFF, because the manifest is what later
    analysis reads to say what was on the device. Measured on the real Verity: the USB pipe's `/U/0/`
    lost 2 of 6 entries — one of them a session directory holding 22 `.REC` recordings — and the tool
    reported success. So the pull of what DID arrive must proceed (a partial mirror beats none), and
    the omission must be stated (`psftp.TruncatedProtobuf`)."""
    fs = _FakeFs(TREE, BLOBS)
    fs.cut = {"/"}
    _patch(monkeypatch, fs)
    res = _run(pm.mirror("AA:BB", str(tmp_path), redact=False))
    assert "/" in res["errors"] and "TRUNCATED" in res["errors"]["/"]
    assert res["files"]["/DEVICE.BPB"]["status"] == "pulled", "the entries that DID arrive still pull"


def test_a_complete_listing_leaves_the_manifest_errors_empty(monkeypatch, tmp_path):
    """Positive control for the test above — a truncation flag that is always set says nothing."""
    fs = _FakeFs(TREE, BLOBS)
    _patch(monkeypatch, fs)
    res = _run(pm.mirror("AA:BB", str(tmp_path), redact=False))
    assert res["errors"] == {}


def test_the_walk_has_a_depth_limit(monkeypatch, tmp_path):
    """A device that reports a directory containing itself must not recurse forever."""
    fs = _FakeFs({"/": [("A/", 0)], "/A/": [("A/", 0)], "/A/A/": [("A/", 0)],
                  "/A/A/A/": [("A/", 0)], "/A/A/A/A/": [("A/", 0)], "/A/A/A/A/A/": [("A/", 0)],
                  "/A/A/A/A/A/A/": [("A/", 0)], "/A/A/A/A/A/A/A/": [("A/", 0)]}, {})
    _patch(monkeypatch, fs)
    res = _run(pm.mirror("AA:BB", str(tmp_path), redact=False))
    assert len(res["dirs"]) <= 8


# ── trust ───────────────────────────────────────────────────────────────────────────────────────────

def test_trust_is_set_when_missing(monkeypatch):
    calls = []

    class _R:
        stdout = "Paired: yes\nBonded: yes\nTrusted: no\n"

    def run(cmd, **k):
        calls.append(cmd)
        return _R()
    monkeypatch.setattr(pm.subprocess, "run", run)
    msg = pm.ensure_trusted("AA:BB")
    assert "trust set" in msg and "UNLIKELY_ERROR" in msg
    assert ["bluetoothctl", "trust", "AA:BB"] in calls


def test_trust_is_left_alone_when_present(monkeypatch):
    class _R:
        stdout = "Trusted: yes\n"
    monkeypatch.setattr(pm.subprocess, "run", lambda *a, **k: _R())
    assert pm.ensure_trusted("AA:BB") == "already trusted"


def test_no_bluetoothctl_is_reported_rather_than_raising(monkeypatch):
    def boom(*a, **k):
        raise FileNotFoundError("bluetoothctl")
    monkeypatch.setattr(pm.subprocess, "run", boom)
    assert "could not check/set trust" in pm.ensure_trusted("AA:BB")


# ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

def test_main_guards_the_link_and_summarises(monkeypatch, tmp_path, capsys):
    guarded = {"n": 0}
    monkeypatch.setattr(pm, "require_free_link", lambda: guarded.__setitem__("n", 1))
    fs = _FakeFs(TREE, BLOBS)
    _patch(monkeypatch, fs)
    assert pm.main(["--address", "AA:BB", "--out", str(tmp_path)]) == 0
    out = json.loads(capsys.readouterr().out)
    assert guarded["n"] == 1, "the daemon precondition must be checked before touching the radio"
    assert out["pulled"] == 3 and out["failed"] == {}


def test_main_reports_failures_separately(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(pm, "require_free_link", lambda: None)
    fs = _FakeFs(TREE, BLOBS, errors={"/DEVICE.BPB"})
    _patch(monkeypatch, fs)
    pm.main(["--address", "AA:BB", "--out", str(tmp_path), "--redact"])
    out = json.loads(capsys.readouterr().out)
    assert "/DEVICE.BPB" in out["failed"]
    assert out["pulled"] == 0, "the other two were redacted, not pulled"
