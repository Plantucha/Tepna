"""GET /api/version — what code the daemon is RUNNING.

The owner's ask: the vigil monitor shows no version, unlike the Dex apps. The value is not the string
on the page — it is that the string describes the RUNNING process rather than the checkout, so
"did the deploy land?" stops needing an ssh session and a manual SHA comparison.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import build_id  # noqa: E402
from tests.test_webmon_api import _mk, _serve  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _get(app, path="/api/version"):
    async def go(c):
        r = await c.get(path)
        return r.status, await r.json()
    return _serve(app, go)


def test_THE_ENDPOINT_REPORTS_A_SHA_AND_A_START_TIME(tmp_path, monkeypatch):
    monkeypatch.setattr(build_id, "probe",
                        lambda _d, **_k: {"git": "a1b2c3d", "dirty": False, "started": 1000.0})
    app, *_ = _mk(tmp_path)
    st, body = _get(app)
    assert st == 200
    assert body == {"git": "a1b2c3d", "dirty": False, "started": 1000.0}


def test_THE_SHA_IS_READ_AT_STARTUP_NOT_PER_REQUEST(tmp_path, monkeypatch):
    """🔴 The property the whole feature rests on.

    A per-request `git rev-parse` reports the sha on DISK. After a deploy that is the NEW code while
    this process still serves the OLD — the "is X deployed?" question answering itself wrongly, one
    layer in. Measured on vigil 2026-08-30: the checkout sat at 2618f8f9 while the running process
    had started 30 minutes earlier on da2c55b6.

    So: probe called ONCE at app construction, and the answer must not change when the tree does."""
    calls = []

    def _probe(_d, **_k):
        calls.append(1)
        return {"git": f"sha{len(calls)}", "dirty": False, "started": 1000.0}

    monkeypatch.setattr(build_id, "probe", _probe)
    app, *_ = _mk(tmp_path)

    async def go(c):
        a = await (await c.get("/api/version")).json()
        b = await (await c.get("/api/version")).json()
        return a, b
    a, b = _serve(app, go)

    assert a == b, "the sha moved between two requests — it is being read per-request"
    assert len(calls) == 1, f"git was probed {len(calls)} times; it must be once, at startup"


def test_AN_UNKNOWN_TREE_CROSSES_THE_BOUNDARY_AS_NULL_NOT_FALSE(tmp_path, monkeypatch):
    # A tarball deploy has no .git. `dirty: false` there would render a tree we never checked as
    # pristine — a fabricated negative. The tristate has to survive serialisation.
    monkeypatch.setattr(build_id, "probe",
                        lambda _d, **_k: {"git": None, "dirty": None, "started": 1000.0})
    app, *_ = _mk(tmp_path)
    _st, body = _get(app)
    assert body["dirty"] is None and body["git"] is None


def test_IT_PROBES_THE_DEPLOY_ROOT_NOT_THE_CAPTURE_HOST_SUBDIR(tmp_path, monkeypatch):
    # `/opt/tepna` is the checkout; `/opt/tepna/capture-host` is a subdirectory of it. Pointing git at
    # the subdir happens to work today, but the deploy root is what `tepna-update.sh` fast-forwards
    # and is the thing whose sha the operator is actually asking about.
    seen = []
    monkeypatch.setattr(build_id, "probe",
                        lambda d, **_k: (seen.append(d), {"git": "x", "dirty": False,
                                                          "started": 1.0})[1])
    _mk(tmp_path)
    assert seen and not seen[0].rstrip("/").endswith("capture-host"), seen


# ── the page has to actually draw it ──────────────────────────────────────────────────────────────
def test_THE_MONITOR_RENDERS_THE_BUILD_AND_HONOURS_THE_TRISTATE():
    """An endpoint nothing draws is the `find_unwired` failure class in HTML."""
    page = open(os.path.join(HERE, "monitor.html"), encoding="utf-8").read()
    assert 'id="buildId"' in page, "no element to render the build into"
    assert "/api/version" in page, "the page never fetches the version"
    assert "capture-host ${sha}" in page, "the sha is fetched but never drawn"
    # ...and the tristate is honoured rather than collapsed to a boolean.
    assert "_build.dirty === null" in page, (
        "the page does not distinguish 'unknown' from 'clean' — a tarball deploy would render as a "
        "verified-clean tree"
    )
    assert "_build.dirty === true" in page
