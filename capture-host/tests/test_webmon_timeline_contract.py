# tepna-capture — tests/test_webmon_timeline_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`GET /api/timeline` — what the handler passes to `timeline.build`, and how it clamps the request.

The tests next door prove the endpoint's OUTCOMES: 400 on no night, 400 on traversal, 500 with a reason
when the build throws, a cached second call. What they leave unobserved is everything in between — the
bucket clamp, the query keys it reads, and the three arguments it hands the builder. The mutation audit
counted 51 survivors here, and they are concentrated in exactly that gap: both ends of
`max(20, min(600, …))` could move, the builder could be handed no devices, and `?buckets=` could be
read from a key that does not exist.

None of that raises. A clamp that lost its lower bound renders a timeline with one bucket; a builder
called with `None` for devices draws an empty chart. Both look like a quiet night.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import webmon  # noqa: E402
from tests.test_webmon_api import _mk, _serve  # noqa: E402

NIGHT = "2026-07-25"


def _app_with_night(tmp_path, devices=None):
    (tmp_path / "captures" / NIGHT).mkdir(parents=True)
    return _mk(tmp_path, devices=devices)[0]


def _get(app, query="", capture=None):
    if capture is not None:
        def rec(path, devs, buckets):
            capture.append({"path": path, "devices": devs, "buckets": buckets})
            return {"night": NIGHT, "buckets": buckets}
        webmon._timeline.build = rec

    async def go(c):
        r = await c.get(f"/api/timeline{query}")
        return r.status, await r.json()
    return _serve(app, go)


@pytest.fixture(autouse=True)
def _restore_build():
    real = webmon._timeline.build
    yield
    webmon._timeline.build = real


# ── the three arguments the builder is given ────────────────────────────────────────────────────────
def test_the_builder_is_aimed_at_the_night_under_the_configured_root(tmp_path):
    seen = []
    app = _app_with_night(tmp_path, devices=[{"name": "H10", "vendor": "Polar", "model": "H10",
                                              "device_id": "1", "address": "A", "rates": {}}])
    status, _ = _get(app, f"?night={NIGHT}", capture=seen)
    assert status == 200
    assert seen[0]["path"] == os.path.join(str(tmp_path), "captures", NIGHT)


def test_the_configured_devices_reach_the_builder(tmp_path):
    """`timeline.build` needs the device list to label and order its lanes. Handed nothing, it still
    returns — with no lanes, which renders as a night on which no sensor recorded."""
    devs = [{"name": "H10", "vendor": "Polar", "model": "H10", "device_id": "1",
             "address": "A", "rates": {}}]
    seen = []
    _get(_app_with_night(tmp_path, devices=devs), f"?night={NIGHT}", capture=seen)
    assert seen[0]["devices"] == devs


# ── the bucket clamp ────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("asked,expect", [
    ("1", 20),            # below the floor -> floor. A 1-bucket timeline is a single block.
    ("20", 20),           # the floor itself is ALLOWED, not bumped
    ("300", 300),         # in range, passed through untouched
    ("600", 600),         # the ceiling itself is ALLOWED
    ("100000", 600),      # above the ceiling -> ceiling
])
def test_the_bucket_count_is_clamped_to_its_stated_range(tmp_path, asked, expect):
    seen = []
    _get(_app_with_night(tmp_path), f"?night={NIGHT}&buckets={asked}", capture=seen)
    assert seen[0]["buckets"] == expect


def test_an_absent_bucket_count_uses_the_module_default(tmp_path):
    seen = []
    _get(_app_with_night(tmp_path), f"?night={NIGHT}", capture=seen)
    assert seen[0]["buckets"] == webmon._timeline.DEFAULT_BUCKETS


def test_a_non_numeric_bucket_count_falls_back_to_the_default(tmp_path):
    """Already known not to 500; this pins WHAT it falls back to. Falling back to `None` would reach the
    builder and fail there instead, one frame further from the cause."""
    seen = []
    status, _ = _get(_app_with_night(tmp_path), f"?night={NIGHT}&buckets=abc", capture=seen)
    assert status == 200 and seen[0]["buckets"] == webmon._timeline.DEFAULT_BUCKETS


# ── the query keys it actually reads ────────────────────────────────────────────────────────────────
def test_the_night_is_read_from_the_night_query_key(tmp_path):
    """Reading a key that is never sent silently re-routes every request to the auto-selected night —
    so the page would show the same night whatever you clicked."""
    caps = tmp_path / "captures"
    (caps / NIGHT).mkdir(parents=True)
    (caps / "2026-07-01").mkdir()
    os.utime(str(caps / NIGHT), (9_000_000_000, 9_000_000_000))    # newest activity
    seen = []
    _get(_mk(tmp_path)[0], "?night=2026-07-01", capture=seen)
    assert seen[0]["path"].endswith("2026-07-01"), \
        "an explicitly requested night must win over the auto-selected one"


# ── the cache ───────────────────────────────────────────────────────────────────────────────────────
def test_a_cached_hit_returns_the_stored_PAYLOAD_not_its_timestamp(tmp_path):
    """The cache stores `(when, payload)`. Reading the wrong element of that tuple does not raise where
    it is stored — it raises, or serves a float, at the point of use."""
    app = _app_with_night(tmp_path)
    calls = {"n": 0}

    def counted(path, devs, buckets):
        calls["n"] += 1
        return {"night": NIGHT, "marker": "built-once"}
    webmon._timeline.build = counted

    async def go(c):
        a = await (await c.get(f"/api/timeline?night={NIGHT}")).json()
        b = await (await c.get(f"/api/timeline?night={NIGHT}")).json()
        return a, b
    first, second = _serve(app, go)
    assert calls["n"] == 1, "the second request inside the window must not rebuild"
    assert first == second == {"night": NIGHT, "marker": "built-once"}


def test_a_different_bucket_count_is_a_different_cache_entry(tmp_path):
    """The key is (night, buckets). Keyed on the night alone, changing the resolution would serve the
    previous resolution's chart back — visibly wrong only if you already know what you asked for."""
    app = _app_with_night(tmp_path)
    seen = []

    def rec(path, devs, buckets):
        seen.append(buckets)
        return {"night": NIGHT, "buckets": buckets}
    webmon._timeline.build = rec

    async def go(c):
        a = await (await c.get(f"/api/timeline?night={NIGHT}&buckets=100")).json()
        b = await (await c.get(f"/api/timeline?night={NIGHT}&buckets=200")).json()
        return a, b
    a, b = _serve(app, go)
    assert seen == [100, 200] and a["buckets"] == 100 and b["buckets"] == 200
