"""webmon.py gap-fill — the endpoints' refusal and degrade paths.

The monitor is a display aid over a live capture box, so the rule these tests pin is: it may return an
error, it may return nothing, but it must never 500 the page and must never report `ok: true` for work
that did not happen. A config write that silently failed is the `VIGIL-DEEP-ANALYSIS §2A` finding.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import storage_targets  # noqa: E402
import webmon  # noqa: E402
from tests.test_webmon_api import H10, _mk, _serve  # noqa: E402


# ── forget: address validation ──────────────────────────────────────────────────────────────────────
def test_forget_refuses_a_malformed_address(tmp_path):
    """`_valid_mac` uses fullmatch precisely because a trailing newline used to slip through: the address
    is persisted, and one carrying a newline never matches a real BLE address again — "forgotten ✓", then
    silently still configured (VIGIL-HARDENING-III §2)."""
    app, *_ = _mk(tmp_path, devices=[dict(H10)])

    async def go(c):
        r = await c.post("/api/forget", json={"address": "not-a-mac"})
        return r.status, await r.json()

    status, body = _serve(app, go)
    assert status == 400 and body["ok"] is False


# ── _save failure must never report success ─────────────────────────────────────────────────────────
def test_storage_post_reports_failure_when_the_config_write_fails(tmp_path, monkeypatch):
    """A full or read-only disk must NOT return ok:true. The settings would look saved and silently
    revert on the next restart."""
    app, *_ = _mk(tmp_path)
    monkeypatch.setattr(webmon.os, "replace", lambda *a, **k: (_ for _ in ()).throw(OSError("ENOSPC")))

    async def go(c):
        r = await c.post("/api/storage", json={"enabled": False})
        return r.status, await r.json()

    status, body = _serve(app, go)
    assert status == 500 and body["ok"] is False and "config write failed" in body["error"]


def test_config_write_cleans_up_its_temp_file_on_failure(tmp_path, monkeypatch):
    """Never leave a stray .config.*.yaml.tmp behind — they accumulate on every failed write."""
    app, *_ = _mk(tmp_path)
    monkeypatch.setattr(webmon.os, "replace", lambda *a, **k: (_ for _ in ()).throw(OSError("ENOSPC")))

    async def go(c):
        await c.post("/api/storage", json={"enabled": False})
        return None

    _serve(app, go)
    assert not [p for p in os.listdir(tmp_path) if p.endswith(".tmp")]


def test_config_write_survives_a_filesystem_that_refuses_directory_fsync(tmp_path, monkeypatch):
    """Some filesystems refuse fsync on a directory fd. The replace already happened and is still
    atomic, so this must be swallowed — not turned into a spurious write failure."""
    app, *_ = _mk(tmp_path)
    # Fail only the SECOND fsync: the first is the file's (which must still work), the second is the
    # directory fd opened after os.replace. Patching fsync wholesale would break the file write too and
    # test the wrong branch.
    calls = {"n": 0}

    def picky(fd):
        calls["n"] += 1
        if calls["n"] >= 2:
            raise OSError("EINVAL")
    monkeypatch.setattr(webmon.os, "fsync", picky)

    async def go(c):
        r = await c.post("/api/storage", json={"enabled": False})
        return r.status, await r.json()

    status, body = _serve(app, go)
    assert status == 200 and body["ok"] is True


# ── storage config surface ──────────────────────────────────────────────────────────────────────────
def test_storage_get_reports_an_unreachable_target_instead_of_raising(tmp_path, monkeypatch):
    """A dead mount is normal operationally — the sidebar has to say so, not 500."""
    app, cfg, *_ = _mk(tmp_path)
    cfg.setdefault("archive", {})["target"] = {"kind": "mount", "mountpoint": "/mnt/gone",
                                               "protocol": "nfs"}

    def boom(_t):
        raise storage_targets.StorageError("not mounted")
    monkeypatch.setattr(webmon.storage_targets, "dest_status", boom)

    async def go(c):
        r = await c.get("/api/storage")
        return r.status, await r.json()

    status, body = _serve(app, go)
    assert status == 200 and body["ready"]["ready"] is False and "not mounted" in body["ready"]["reason"]


def test_storage_post_rejects_a_bad_target(tmp_path):
    app, *_ = _mk(tmp_path)

    async def go(c):
        r = await c.post("/api/storage", json={"target": {"kind": "nonsense"}})
        return r.status, await r.json()

    status, out = _serve(app, go)
    assert status == 400 and out["ok"] is False


def test_storage_post_turns_a_malformed_body_into_400_not_500(tmp_path, monkeypatch):
    """`validate` itself raises StorageError for every shape it can recognise, so the (KeyError,
    TypeError) arm is a defensive catch for a body that breaks the unpacking before validation gets a
    say. The contract it encodes is what matters: a malformed body is the CALLER's error (400), never a
    server error — a 500 here would read as "the box is broken" on the monitor page."""
    app, *_ = _mk(tmp_path)

    def boom(_s):
        raise TypeError("schedule is not subscriptable")
    monkeypatch.setattr(webmon.storage_targets, "validate_schedule", boom)

    async def go(c):
        r = await c.post("/api/storage", json={"enabled": True})
        return r.status, await r.json()

    status, out = _serve(app, go)
    assert status == 400 and out["ok"] is False and "malformed body" in out["error"]


def test_storage_test_rejects_an_invalid_target(tmp_path):
    app, *_ = _mk(tmp_path)

    async def go(c):
        r = await c.post("/api/storage/test", json={"target": {"kind": "nope"}})
        return r.status, await r.json()

    status, body = _serve(app, go)
    assert status == 400 and body["ok"] is False


def test_storage_test_never_500s_when_the_probe_explodes(tmp_path, monkeypatch):
    """A probe reaches the network; anything can happen there. It reports a failure verdict, never a
    server error, because the monitor page has to keep rendering."""
    app, *_ = _mk(tmp_path)
    monkeypatch.setattr(webmon.storage_targets, "validate",
                        lambda t: {"kind": "mount", "mountpoint": "/mnt/x", "protocol": "nfs"})

    async def boom(_t):
        raise RuntimeError("network on fire")
    monkeypatch.setattr(webmon.storage_targets, "test_target", boom)

    async def go(c):
        r = await c.post("/api/storage/test", json={"target": {"kind": "mount"}})
        return r.status, await r.json()

    status, body = _serve(app, go)
    assert status == 200 and body["ok"] is False and "RuntimeError" in body["detail"]


# ── timeline endpoint ───────────────────────────────────────────────────────────────────────────────
def test_timeline_400s_when_there_is_no_night_at_all(tmp_path):
    """captures/ does not exist yet — a fresh box. Not an error condition worth a 500."""
    app, *_ = _mk(tmp_path)

    async def go(c):
        r = await c.get("/api/timeline")
        return r.status, await r.json()

    status, body = _serve(app, go)
    assert status == 400 and body["error"] == "no night"


@pytest.mark.parametrize("night", ["../etc", "a/b"])
def test_timeline_refuses_path_traversal_in_the_night_name(tmp_path, night):
    """`night` is joined onto the captures dir, so a separator or `..` must be refused outright rather
    than reaching the filesystem."""
    app, *_ = _mk(tmp_path)

    async def go(c):
        r = await c.get(f"/api/timeline?night={night}")
        return r.status

    assert _serve(app, go) == 400


def test_timeline_falls_back_to_the_default_bucket_count(tmp_path):
    """A non-numeric ?buckets must not 500 — it falls back, and the clamp keeps it sane."""
    cap = tmp_path / "captures" / "2026-07-25"
    cap.mkdir(parents=True)
    app, *_ = _mk(tmp_path)

    async def go(c):
        r = await c.get("/api/timeline?buckets=abc")
        return r.status

    assert _serve(app, go) == 200


def test_timeline_picks_the_night_with_the_newest_ACTIVITY(tmp_path):
    """Not the newest NAME. After midnight the sensor writers stay in their session's start-date folder
    while only the sidecars roll, so the newest name holds two files and no data."""
    caps = tmp_path / "captures"
    old, new = caps / "2026-07-26", caps / "2026-07-25"
    old.mkdir(parents=True)
    new.mkdir(parents=True)
    os.utime(str(old), (1000, 1000))                       # newest name, stale mtime
    os.utime(str(new), (9_000_000_000, 9_000_000_000))     # older name, freshest activity
    app, *_ = _mk(tmp_path)

    async def go(c):
        r = await c.get("/api/timeline")
        return r.status, await r.json()

    status, body = _serve(app, go)
    assert status == 200 and body.get("night", "2026-07-25") == "2026-07-25"


def test_timeline_500s_with_a_reason_when_the_build_throws(tmp_path, monkeypatch):
    app, *_ = _mk(tmp_path)
    (tmp_path / "captures" / "2026-07-25").mkdir(parents=True)

    def boom(*a, **k):
        raise ValueError("corrupt sidecar")
    monkeypatch.setattr(webmon._timeline, "build", boom)

    async def go(c):
        r = await c.get("/api/timeline?night=2026-07-25")
        return r.status, await r.json()

    status, body = _serve(app, go)
    assert status == 500 and "ValueError" in body["error"]


def test_timeline_serves_the_cached_result_within_the_window(tmp_path, monkeypatch):
    """Rebuilding is the stall #292 moved off the event loop — a night dir is ~1500 files. The 60 s
    cache is what keeps a polling monitor from re-walking it every tick."""
    app, *_ = _mk(tmp_path)
    (tmp_path / "captures" / "2026-07-25").mkdir(parents=True)
    calls = {"n": 0}

    def counted(*a, **k):
        calls["n"] += 1
        return {"night": "2026-07-25"}
    monkeypatch.setattr(webmon._timeline, "build", counted)

    async def go(c):
        await c.get("/api/timeline?night=2026-07-25")
        await c.get("/api/timeline?night=2026-07-25")
        return None

    _serve(app, go)
    assert calls["n"] == 1


def test_config_write_survives_a_temp_file_it_cannot_unlink(tmp_path, monkeypatch):
    """The cleanup is best-effort. If the stray temp cannot be removed (read-only mount, a racing
    reader on Windows-ish semantics) that must not mask the ORIGINAL write failure with a different
    exception — the caller still needs to hear "config write failed", not an unlink error."""
    app, *_ = _mk(tmp_path)
    monkeypatch.setattr(webmon.os, "replace", lambda *a, **k: (_ for _ in ()).throw(OSError("ENOSPC")))
    monkeypatch.setattr(webmon.os, "unlink", lambda *a, **k: (_ for _ in ()).throw(OSError("EROFS")))

    async def go(c):
        r = await c.post("/api/storage", json={"enabled": False})
        return r.status, await r.json()

    status, body = _serve(app, go)
    assert status == 500 and "config write failed" in body["error"]


# ── a body that did not arrive is not an instruction (CAPTURE-HOST-DEEP-AUDIT §D1 / §D3) ────────
def _with_target(tmp_path):
    """An app whose config already holds a configured offload target — the thing that got wiped."""
    app, cfg, *rest = _mk(tmp_path)
    cfg["archive"] = {"enabled": True,
                      "target": {"kind": "mount", "protocol": "local",
                                 "mountpoint": str(tmp_path / "mirror"), "verify": False},
                      "dest": str(tmp_path / "mirror")}
    return app, cfg


def test_an_empty_post_does_not_delete_the_offload_target(tmp_path):
    """THE §D1 regression. `_body` returned {} for an absent body, so `tgt` came out None and the
    `else: a.pop("target", None)` branch DESTROYED the configured target — answering 200 ok=True and
    persisting it. The handler's own docstring promised "a rejected target leaves the previous one
    running rather than half-applying"; an unparseable body was never rejected, it was applied as a
    clear. Second-order: at the next daemon start this also un-gates retention's second-copy
    protection, so the box resumes deleting nights it can no longer confirm a copy of."""
    app, cfg = _with_target(tmp_path)

    async def go(c):
        r = await c.post("/api/storage")                    # no body at all
        return r.status, await r.json()

    status, _body = _serve(app, go)
    assert status == 400
    assert cfg["archive"].get("target") is not None, "the configured target must survive"
    assert cfg["archive"]["enabled"] is True


def test_an_unparseable_post_does_not_delete_the_offload_target(tmp_path):
    app, cfg = _with_target(tmp_path)

    async def go(c):
        r = await c.post("/api/storage", data=b"{bad json",
                         headers={"Content-Type": "application/json"})
        return r.status, await r.json()

    status, _body = _serve(app, go)
    assert status == 400
    assert cfg["archive"].get("target") is not None


def test_a_non_object_json_post_does_not_delete_the_offload_target(tmp_path):
    """§D3's shapes reaching §D1's handler — the reason the two had to land together. Fixing the 500
    alone (folding non-objects to {}) would have turned each of these into a silent wipe."""
    for raw in (b"null", b"[]", b'"x"', b"3"):
        app, cfg = _with_target(tmp_path)

        async def go(c, _raw=raw):
            r = await c.post("/api/storage", data=_raw,
                             headers={"Content-Type": "application/json"})
            return r.status, await r.json()

        status, _b = _serve(app, go)
        assert status == 400, f"{raw!r} must be rejected, got {status}"
        assert cfg["archive"].get("target") is not None, f"{raw!r} wiped the target"


def test_the_designed_disable_path_still_works(tmp_path):
    """The control. A caller who sends an OBJECT and omits `target` is deliberately disabling offload —
    the path monitor.html's full-state PUT semantics and four existing tests rely on. Rejecting it
    would break the UI, so the distinction is between an object with no target and no object at all."""
    app, cfg = _with_target(tmp_path)

    async def go(c):
        r = await c.post("/api/storage", json={"enabled": False})
        return r.status, await r.json()

    status, body = _serve(app, go)
    assert status == 200 and body["ok"] is True
    assert cfg["archive"].get("target") is None, "an explicit object without a target still clears"
    assert cfg["archive"]["enabled"] is False


def test_non_object_bodies_are_400_not_500_across_the_control_surface(tmp_path):
    """§D3. `_body` guarded only a DECODE error, so valid JSON that is not an object reached the
    handlers as a non-dict and 500'd on `.get`. Every state-changing POST answers 400 instead."""
    for path in ("/api/storage", "/api/settings", "/api/clock/tz", "/api/clock",
                 "/api/bond", "/api/forget", "/api/remember"):
        for raw in (b"null", b"[]", b'"x"', b"3", b"{bad json"):
            app, *_ = _mk(tmp_path)

            async def go(c, _p=path, _raw=raw):
                r = await c.post(_p, data=_raw, headers={"Content-Type": "application/json"})
                return r.status

            got = _serve(app, go)
            assert got != 500, f"POST {path} with {raw!r} returned 500"
            assert got == 400, f"POST {path} with {raw!r} returned {got}, expected 400"


# ── D4: the capability guard, and D5: the config the UI owns ────────────────────────────────────
def test_an_unknown_stream_name_is_refused_even_for_a_never_connected_device(tmp_path):
    """§D4. The firmware check is `if sup:` and `pmd_supported` is written once at CONNECT — so for a
    device that has never connected SINCE BOOT there is no capability set and the check is skipped
    entirely. (Not "whenever disconnected": `_set` only ever `update`s, so the capabilities survive a
    drop.) The consequence was bounded — capture.py ignores an unrecognised stream name, so no writer
    and no file — but a guard that is absent is not a guard, and nothing downstream promises to keep
    being lenient."""
    app, cfg, *_ = _mk(tmp_path)
    addr = cfg["devices"][0]["address"]

    async def go(c):
        r = await c.post("/api/settings",
                         json={"streams": {addr: ["bogus", "../../etc/passwd"]}})
        return r.status, await r.json()

    status, body = _serve(app, go)
    assert status == 400, f"expected a refusal, got {status} {body}"
    assert "unknown stream" in body["error"]
    assert cfg["devices"][0]["streams"] != ["bogus", "../../etc/passwd"]


def test_an_implausible_rate_is_refused_for_a_never_connected_device(tmp_path):
    """The rate half: with no device menu (`pmd_options` absent) `allowed` was empty and ANY integer
    was accepted, including -1."""
    for bad in (-1, 0, 999_999):
        app, cfg, *_ = _mk(tmp_path)          # a fresh app per serve — one Application, one loop
        addr = cfg["devices"][0]["address"]

        async def go(c, _v=bad, _a=addr):
            r = await c.post("/api/settings", json={"rates": {_a: {"acc": _v}}})
            return r.status

        assert _serve(app, go) == 400, f"{bad} Hz was accepted"


def test_a_legal_stream_still_applies(tmp_path):
    """The control: the floor must not reject the streams the box actually writes."""
    app, cfg, *_ = _mk(tmp_path)
    addr = cfg["devices"][0]["address"]

    async def go(c):
        r = await c.post("/api/settings", json={"streams": {addr: ["ecg", "acc", "hr"]}})
        return r.status, await r.json()

    status, body = _serve(app, go)
    assert status == 200 and body["ok"] is True
    assert cfg["devices"][0]["streams"] == ["ecg", "acc", "hr"]


def test_the_written_config_says_it_does_not_keep_comments(tmp_path):
    """§D5. `yaml.safe_dump` has no comment round-trip, so every save emits a comment-free document —
    20 comment lines in, 0 out. That is why four hand-made backups of one config were sitting in the
    working tree: the machine-emitted ones lost the prose and a human re-authored it by hand.

    Not fixed with `ruamel.yaml` — a runtime dependency for comment preservation is a SOUP entry on a
    62304-aligned appliance, a real cost for a cosmetic gain. The loss is announced instead, in the
    file and in the journal, and `config.example.yaml` is where the prose belongs."""
    import yaml as _yaml
    app, cfg, _st, cfg_path, _bus = _mk(tmp_path)
    open(cfg_path, "w").write("# keep_nights: my own note\ndevices: []\n")

    async def go(c):
        return (await c.post("/api/storage", json={"enabled": False})).status

    assert _serve(app, go) == 200
    body = open(cfg_path).read()
    assert body.startswith("# WRITTEN BY THE TEPNA MONITOR")
    assert "config.example.yaml" in body, "it must say where notes survive"
    assert "# keep_nights: my own note" not in body, "the loss is real — the banner does not prevent it"
    assert _yaml.safe_load(body) is not None, "and the file must still parse"
