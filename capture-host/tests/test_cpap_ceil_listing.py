# tepna-capture — tests/test_cpap_ceil_listing.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE EZ SHARE LISTING CEILS. It does not round to nearest, and assuming it did rejected roughly half
# of every file the card ever served — as byte-perfect downloads, permanently, re-fetched and
# re-rejected on every run. 487 `.part` files / 246 MB on the real box.
#
# `size_tolerance_kb`'s reasoning was right about the important part: the error is bounded by the
# QUANTIZATION OF THE PRINTED NUMBER, never a percentage of the file. Only the rounding DIRECTION was
# wrong. Under ceil a complete file may be up to a whole quantum SMALLER than printed and can never be
# larger, so the window is asymmetric.
#
# Every number below is MEASURED off the real card 2026-07-28 — listing string vs Content-Length —
# not constructed to make the test pass.

import cpap_harvest as c


# (listing string, real bytes) — ten files, `listed == ceil(bytes/1024)` in all of them.
REAL = [
    ("1KB", 832),        # 0.81 KB
    ("2KB", 1344),       # 1.31 KB  <- rejected under the old +/-0.5 model
    ("204KB", 208776),   # 203.88 KB
    ("91KB", 92984),     # 90.80 KB
    ("2229KB", 2281784), # 2228.30 KB <- rejected
    ("1KB", 896),        # 0.88 KB
    ("5KB", 4984),       # 4.87 KB
    ("2KB", 1992),       # 1.95 KB
    ("25KB", 25032),     # 24.45 KB <- rejected
    ("104KB", 105810),   # 103.33 KB <- rejected; the one that started this
]


def test_the_listing_is_ceil_not_round():
    """The finding itself, pinned. If a future card rounds instead, this fails loudly rather than
    silently reopening the low-side band."""
    import math
    for listed, b in REAL:
        assert c.size_kb(listed) == math.ceil(b / 1024.0), f"{listed} vs {b}B is not ceil"


def test_every_real_complete_file_is_accepted():
    """All ten. Under the old symmetric tolerance, four of these were rejected as truncated."""
    for listed, b in REAL:
        assert not c.short_read({"size": listed}, b), f"{listed} / {b}B must be complete"


def test_the_four_that_regressed_are_named():
    """Spelled out so the regression is legible: fractional KB part < 0.5 is what used to fail."""
    for listed, b in [("2KB", 1344), ("2229KB", 2281784), ("25KB", 25032), ("104KB", 105810)]:
        frac = (b / 1024.0) % 1
        assert frac < 0.5, f"{listed} was chosen because its fraction is < 0.5, got {frac}"
        assert not c.short_read({"size": listed}, b)


def test_genuine_truncation_is_still_caught():
    """The property this family of functions exists for (§C5). Loosening the low side must not admit a
    corrupt EDF that parses far enough to look real."""
    assert c.short_read({"size": "2229KB"}, 1000000)      # 56% of a BRP
    assert c.short_read({"size": "104KB"}, 50000)         # half
    assert c.short_read({"size": "25KB"}, 24000)          # a full KB short


def test_the_window_is_asymmetric_nothing_above_the_printed_value_passes():
    """A symmetric P +/- q would open a band ABOVE P where a corrupt file passes. Under ceil no
    complete file can exceed the printed value, so nothing may."""
    lo, hi = c.size_window_kb("25KB")
    assert 24.0 == lo and hi < 25.001, (lo, hi)
    assert c.short_read({"size": "25KB"}, 25601)          # 25.0 KB + a byte
    assert c.short_read({"size": "204KB"}, 209000)        # just over 204 KB


def test_content_length_is_exact_and_beats_the_listing():
    """The real fix: when the server declares the length there is no rounding model to get wrong."""
    e = {"size": "104KB"}
    assert not c.short_read(e, 105810, 105810)
    assert c.short_read(e, 105809, 105810), "one byte short is short"
    # …and it overrules a listing string that would have accepted the body.
    assert c.short_read({"size": "104KB"}, 105000, 105810)


def test_should_fetch_agrees_with_short_read(tmp_path):
    """The two must not disagree about what 'complete' means — the §C5 hole was exactly that gap. A
    file on disk that short_read would accept must not be re-fetched."""
    for listed, b in REAL:
        p = tmp_path / f"f{b}.edf"
        p.write_bytes(b"x" * b)
        e = {"size": listed, "name": p.name}
        assert not c.short_read(e, b)
        assert not c.should_fetch(e, str(p)), f"{listed}/{b}B accepted by short_read but re-fetched"


# ── the .part promotion ─────────────────────────────────────────────────────────────────────────────
# The ceil bug left 487 complete files sitting as `.part` — 246 MB. With the completeness test fixed
# they would all simply re-download; a HEAD settles it for the price of a header.

import io
import os


class _Resp(io.BytesIO):
    def __init__(self, data, declared=None):
        super().__init__(data)
        self.headers = {"Content-Length": str(len(data) if declared is None else declared)}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_a_complete_part_is_promoted_without_downloading(tmp_path, monkeypatch):
    """The 246 MB question: an already-complete .part must be renamed, not re-fetched."""
    body = b"Z" * 105810
    (tmp_path / "SA2.edf.part").write_bytes(body)
    got = []

    def fake(req, timeout=None):
        method = getattr(req, "get_method", lambda: "GET")()
        got.append(method)
        return _Resp(body)

    monkeypatch.setattr(c.urllib.request, "urlopen", fake)
    monkeypatch.setattr(c.time, "sleep", lambda *_: None)
    e = {"name": "SA2.edf", "size": "104KB", "href": "download?file=S"}
    path, n = c.EzShare().fetch(e, str(tmp_path))
    assert os.path.basename(path) == "SA2.edf" and n == 105810
    assert not list(tmp_path.glob("*.part")), "the .part must be gone, not left beside the real file"
    assert got == ["HEAD"], f"the body must never be downloaded — requests made: {got}"


def test_a_part_of_the_WRONG_size_is_not_promoted(tmp_path, monkeypatch):
    """Promotion is the one place an unverified file becomes a trusted one, so it may not guess. Only
    an EXACT match against the declared length counts."""
    (tmp_path / "SA2.edf.part").write_bytes(b"Z" * 5000)          # genuinely partial
    monkeypatch.setattr(c.urllib.request, "urlopen", lambda req, timeout=None: _Resp(b"Z" * 105810))
    monkeypatch.setattr(c.time, "sleep", lambda *_: None)
    e = {"name": "SA2.edf", "size": "104KB", "href": "download?file=S"}
    path, n = c.EzShare().fetch(e, str(tmp_path))
    assert n == 105810, "it must have been downloaded in full, not promoted from the stub"


def test_a_failed_HEAD_just_means_download_it(tmp_path, monkeypatch):
    """A card that will not answer HEAD must not break the harvest — it falls through to the body."""
    body = b"Z" * 2048
    (tmp_path / "STR.edf.part").write_bytes(body)
    calls = {"n": 0}

    def fake(req, timeout=None):
        calls["n"] += 1
        if getattr(req, "get_method", lambda: "GET")() == "HEAD":
            raise OSError("no HEAD here")
        return _Resp(body)

    monkeypatch.setattr(c.urllib.request, "urlopen", fake)
    monkeypatch.setattr(c.time, "sleep", lambda *_: None)
    e = {"name": "STR.edf", "size": "2KB", "href": "download?file=S"}
    _, n = c.EzShare().fetch(e, str(tmp_path))
    assert n == 2048 and calls["n"] >= 2


def test_no_promotion_when_the_real_file_already_exists(tmp_path, monkeypatch):
    """A stale .part beside a good file must never overwrite it."""
    (tmp_path / "STR.edf").write_bytes(b"G" * 2048)
    (tmp_path / "STR.edf.part").write_bytes(b"B" * 2048)
    monkeypatch.setattr(c.urllib.request, "urlopen", lambda req, timeout=None: _Resp(b"G" * 2048))
    monkeypatch.setattr(c.time, "sleep", lambda *_: None)
    c.EzShare().fetch({"name": "STR.edf", "size": "2KB", "href": "download?file=S"}, str(tmp_path))
    assert (tmp_path / "STR.edf").read_bytes() == b"G" * 2048


def test_an_unparseable_content_length_is_treated_as_absent(monkeypatch):
    """A server declaring nonsense must not crash the client; the listing window takes over."""
    monkeypatch.setattr(c.urllib.request, "urlopen",
                        lambda url, timeout=None: _Resp(b"Z" * 100, declared="not-a-number"))
    body, declared = c.EzShare()._get("http://x", want_length=True)
    assert body == b"Z" * 100 and declared == 0


def test_an_empty_listing_size_yields_an_empty_window():
    assert c.size_window_kb("") == (0.0, 0.0)


# ── reaping the residue ─────────────────────────────────────────────────────────────────────────────
def test_a_part_identical_to_the_real_file_is_reaped(tmp_path):
    """485 of these on the box, 246 MB, all verified byte-identical. They are unreachable by the
    promotion path — should_fetch correctly SKIPS those files, so fetch() never runs."""
    real = tmp_path / "BRP.edf"
    real.write_bytes(b"D" * 4096)
    (tmp_path / "BRP.edf.part").write_bytes(b"D" * 4096)
    st = {}
    assert c.reap_stale_part(str(real), st) is True
    assert not (tmp_path / "BRP.edf.part").exists()
    assert real.read_bytes() == b"D" * 4096, "the real file must be untouched"
    assert st["reaped"] == 1


def test_a_DIFFERING_part_is_never_reaped(tmp_path):
    """The safety line. A .part that differs may be an interrupted download whose bytes are the only
    ones we have — deleting it destroys the evidence the .part convention exists to preserve."""
    real = tmp_path / "BRP.edf"
    real.write_bytes(b"D" * 4096)
    (tmp_path / "BRP.edf.part").write_bytes(b"D" * 2048)          # half — a real partial
    assert c.reap_stale_part(str(real)) is False
    assert (tmp_path / "BRP.edf.part").exists()


def test_same_size_but_different_bytes_is_never_reaped(tmp_path):
    """Size alone is not identity — that assumption is what this whole change is unpicking."""
    real = tmp_path / "S.edf"
    real.write_bytes(b"A" * 4096)
    (tmp_path / "S.edf.part").write_bytes(b"B" * 4096)
    assert c.reap_stale_part(str(real)) is False
    assert (tmp_path / "S.edf.part").exists()


def test_a_part_with_no_real_file_is_left_for_promotion(tmp_path):
    """That one belongs to fetch(), which HEADs and promotes it. Reaping it would lose the file."""
    (tmp_path / "S.edf.part").write_bytes(b"A" * 4096)
    assert c.reap_stale_part(str(tmp_path / "S.edf")) is False
    assert (tmp_path / "S.edf.part").exists()


def test_reaping_never_raises_on_an_unreadable_pair(tmp_path, monkeypatch):
    """A harvest must not die tidying up."""
    real = tmp_path / "S.edf"
    real.write_bytes(b"A" * 16)
    (tmp_path / "S.edf.part").write_bytes(b"A" * 16)
    monkeypatch.setattr(c.os.path, "getsize", lambda _p: (_ for _ in ()).throw(OSError("gone")))
    assert c.reap_stale_part(str(real)) is False


def test_reaping_works_without_a_stats_dict(tmp_path):
    """`st` is optional — the reaper is usable as a plain predicate, e.g. from a one-off cleanup."""
    real = tmp_path / "S.edf"
    real.write_bytes(b"A" * 32)
    (tmp_path / "S.edf.part").write_bytes(b"A" * 32)
    assert c.reap_stale_part(str(real)) is True
    assert not (tmp_path / "S.edf.part").exists()
