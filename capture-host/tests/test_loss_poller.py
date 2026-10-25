# tepna-capture — tests/test_loss_poller.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""capture.loss_poller: each settled night audited once, re-audited only when its files change, the
active night untouched, a daemon-caused night logged as a warning, one bad night does not stop it."""

import asyncio
import concurrent.futures.process  # lazily loaded by the package; an xdist worker may not have touched it
import json
import os
import time

import capture
from tests.test_capture_coverage_100 import _run, _stop_after


def _night(root, name, *, data_age_s=4 * 3600.0):
    """A night folder whose DATA is `data_age_s` old — the quantity the poller now reads.

    🔴 THE AGE IS THE SCENARIO. These tests used to declare "this night is settled" by monkeypatching
    `diskguard.active_nights`, which is the predicate the poller was WRONG to use: a faked
    `active_nights` can never expose the stall where a poller's own QC-SUMMARY / verdict writes keep the
    folder active forever, because the fake does not know about them. Declaring it in the file's mtime
    tests what production tests. `data_age_s=0` means "still recording"."""
    d = root / "captures" / name
    d.mkdir(parents=True)
    f = d / "Polar_H10_0284_20260920220000_ECG.txt"
    f.write_text("Phone timestamp;x\n2026-09-20T22:00:00.000;1\n2026-09-20T22:00:01.000;1\n")
    if data_age_s:
        t = time.time() - data_age_s
        os.utime(str(f), (t, t))
    return d


def test_loss_poller_audits_settled_nights_once_and_skips_the_active_one(tmp_path, monkeypatch, caplog):
    _night(tmp_path, "2026-09-18")  # data 4 h old ⇒ settled
    _night(tmp_path, "2026-09-19", data_age_s=0)  # data written just now ⇒ still recording
    # `active_nights` is left REAL on purpose: both folders are "active" by its rule (both were just
    # created), and the poller must still judge 09-18. Under the old predicate it judged neither.
    monkeypatch.setattr(capture.diskguard, "active_nights", capture.diskguard.active_nights)
    calls = []

    def fake_write(nd, devices, commit=None):
        calls.append(os.path.basename(nd))
        dc = 3.0 if len(calls) == 1 else 0.0  # the re-audit finds a clean night: no warning the second time
        obj = {
            "status": "UNKNOWN",
            "at": "2026-09-21T00:00:00Z",
            "result": {"daemon_caused_min": dc},
            "reason": "no bar",
        }
        open(os.path.join(nd, capture.loss_audit.VERDICT_NAME), "w").write(json.dumps(obj))
        return obj

    monkeypatch.setattr(capture.loss_audit, "write_night", fake_write)
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 2)
    with caplog.at_level("WARNING"):
        _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": []}, str(tmp_path)))
    assert calls == ["2026-09-18"], calls  # once, not per tick; the active night skipped
    assert capture.STATUS["loss"]["2026-09-18"]["daemon_caused_min"] == 3.0
    assert any("3 min of the night's gaps were the daemon's own doing" in r.getMessage() for r in caplog.records)
    # the night's files change ⇒ audited again
    d = tmp_path / "captures" / "2026-09-18"
    # The night's DATA must be newer than its audit AND still old enough to be settled, so the audit's
    # own stamp moves back rather than the data forward — moving the data to "now" would make the night read as
    # still recording, which is the new predicate working, not a test to be worked around.
    _dm = os.path.getmtime(str(d / "Polar_H10_0284_20260920220000_ECG.txt"))
    os.utime(str(d / capture.loss_audit.VERDICT_NAME), (_dm - 5, _dm - 5))
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": []}, str(tmp_path)))
    assert calls == ["2026-09-18", "2026-09-18"]
    assert sum("the daemon's own doing" in r.getMessage() for r in caplog.records) == 1
    capture._STOP.clear()
    capture._STOP = asyncio.Event()


def test_loss_poller_survives_a_failing_night(tmp_path, monkeypatch, caplog):
    _night(tmp_path, "2026-09-18")  # data 4 h old ⇒ settled by its own mtime
    monkeypatch.setattr(capture.loss_audit, "write_night", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    with caplog.at_level("WARNING"):
        _run(capture.loss_poller({"devices": []}, str(tmp_path)))
    assert any("loss-audit: poll failed" in r.getMessage() for r in caplog.records)
    capture._STOP.clear()


def test_a_SIDECAR_touched_after_the_audit_does_not_re_audit_the_night(tmp_path, monkeypatch):
    """⚠️ THE DEFECT THIS REPLACES, measured on vigil 2026-09-23. The skip compared the audit against a
    DIRECTORY-WIDE max mtime, so any marker another actor wrote made a settled night read as changed —
    and the archive mirror writes `.archived` per night on every verified push. Twelve settled nights
    were re-audited on every 30-minute poll, re-reading ~1.9 GB of H10 ECG alone and re-running a
    journal subprocess per device, for nights whose DATA had not moved in days.

    `nightqc.newest_data_mtime` ranks device-capture files only; its own docstring says that exclusion
    is the whole point. The poller's docstring already promised "the night's PRIMARY files"."""
    d = _night(tmp_path, "2026-09-18")  # data 4 h old ⇒ settled by its own mtime
    calls = []

    def fake_write(nd, devices, commit=None):
        calls.append(os.path.basename(nd))
        open(os.path.join(nd, capture.loss_audit.VERDICT_NAME), "w").write("{}")
        return {"status": "UNKNOWN", "at": "x", "result": {"daemon_caused_min": 0.0}, "reason": "no bar"}

    monkeypatch.setattr(capture.loss_audit, "write_night", fake_write)
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": []}, str(tmp_path)))
    assert calls == ["2026-09-18"]

    v = os.path.getmtime(str(d / capture.loss_audit.VERDICT_NAME))
    for marker in (".archived", "Tepna_20260918220000_LINK.csv", "QC-SUMMARY.json"):
        (d / marker).write_text("x")
        os.utime(str(d / marker), (v + 60, v + 60))  # newer than the audit, and NOT capture data
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": []}, str(tmp_path)))
    assert calls == ["2026-09-18"], "a sidecar or marker is not the night's data changing"

    # …and the positive control: the DATA being newer than the audit still re-audits, or the skip would
    # be a silent stop. Expressed by moving the audit's own stamp back, not the data forward: data stamped "now"
    # would read as still recording under the eligibility rule, and the control would then pass for the
    # wrong reason — it would prove the night was skipped, not that a moved file re-audits.
    _dm = os.path.getmtime(str(d / "Polar_H10_0284_20260920220000_ECG.txt"))
    os.utime(str(d / capture.loss_audit.VERDICT_NAME), (_dm - 30, _dm - 30))
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": []}, str(tmp_path)))
    assert calls == ["2026-09-18", "2026-09-18"], "the night's own data moved: audit again"
    capture._STOP.clear()


def test_a_folder_with_no_capture_file_is_skipped_not_audited(tmp_path, monkeypatch):
    """`newest_data_mtime` answers None there — an absence, not a zero. A 00:00 folder holding only
    sidecars has no primary stream to audit, and auditing it would report on nothing."""
    d = tmp_path / "captures" / "2026-09-18"
    d.mkdir(parents=True)
    (d / "Tepna_20260918000000_LINK.csv").write_text("x")
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    calls = []
    monkeypatch.setattr(
        capture.loss_audit,
        "write_night",
        lambda nd, devices, commit=None: (
            calls.append(nd) or {"status": "UNKNOWN", "at": "x", "result": {}, "reason": ""}
        ),
    )
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": []}, str(tmp_path)))
    assert calls == []
    capture._STOP.clear()


def _audit_writer(calls, write_file=True):
    def fake_write(nd, devices, commit=None):
        calls.append(os.path.basename(nd))
        if write_file:
            open(os.path.join(nd, capture.loss_audit.VERDICT_NAME), "w").write("{}")
        return {"status": "UNKNOWN", "at": "x", "result": {"daemon_caused_min": 0.0}, "reason": "no bar"}

    return fake_write


def _poll_once(monkeypatch, tmp_path, devices=()):
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": list(devices)}, str(tmp_path)))
    capture._STOP.clear()


def test_the_solid_night_verdict_follows_the_audit_and_only_the_audit(tmp_path, monkeypatch):
    """SOLID-NIGHT §2: composed on the loss audit's OWN trigger — once per audit, again only when the audit
    moved. STATUS is replaced for this test so no other test's state can leak in either direction."""
    d = _night(tmp_path, "2026-09-18")
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    composed = []
    real = capture.solid_night.write_night
    monkeypatch.setattr(
        capture.solid_night,
        "write_night",
        lambda nd, *a, **k: composed.append(os.path.basename(nd)) or real(nd, *a, **k),
    )
    _poll_once(monkeypatch, tmp_path)
    assert composed == ["2026-09-18"] and (d / capture.solid_night.VERDICT_NAME).exists()
    s = capture.STATUS["solid"]
    assert s["night"] == "2026-09-18" and s["status"] == "UNKNOWN" and s["run"].startswith("0 solid of")
    _poll_once(monkeypatch, tmp_path)
    assert composed == ["2026-09-18"], "the audit did not move, so neither does the verdict"
    v = os.path.getmtime(str(d / capture.solid_night.VERDICT_NAME))
    os.utime(str(d / capture.loss_audit.VERDICT_NAME), (v + 5, v + 5))  # the audit is newer than the verdict
    _poll_once(monkeypatch, tmp_path)
    assert composed == ["2026-09-18", "2026-09-18"]


def test_a_verdict_that_cannot_be_composed_is_logged_and_the_audit_stands(tmp_path, monkeypatch, caplog):
    _night(tmp_path, "2026-09-18")
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    monkeypatch.setattr(capture.solid_night, "write_night", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    with caplog.at_level("WARNING"):
        _poll_once(monkeypatch, tmp_path)
    assert any("solid-night: 2026-09-18 — verdict not written" in r.getMessage() for r in caplog.records)
    assert "2026-09-18" in capture.STATUS["loss"] and "solid" not in capture.STATUS


def test_no_audit_on_disk_means_no_verdict_is_composed_over_nothing(tmp_path, monkeypatch):
    d = _night(tmp_path, "2026-09-18")
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    calls = []
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer(calls, write_file=False))
    _poll_once(monkeypatch, tmp_path)
    assert calls == ["2026-09-18"] and not (d / capture.solid_night.VERDICT_NAME).exists()
    assert "solid" not in capture.STATUS


def test_PLANT_the_poller_s_OWN_verdict_writes_do_not_keep_a_night_unjudged(tmp_path, monkeypatch):
    """🔴 THE STALL, reproduced. Wren measured it on the box and I confirmed the chain on vigil
    2026-10-03: 2026-10-02's last device file was written **03:58:25**, its `QC-SUMMARY.json` was
    rewritten at **16:46:51** — **12 h 48 m** later — and the night was still unjudged; Wren saw 10-01
    judged 10 h 55 m after doff, and only because a daytime session put data in a different folder.

    The chain: the QC poller rewrites `QC-SUMMARY.json` + the verdicts into `_current_night()` every
    cycle → `diskguard.active_nights` counts ANY file younger than `settle_sec`, so the folder never
    settles → `_current_night` cannot advance either, because the next date's folder holds only
    `LINK`/`CLOCK` (both `_SIDECAR_TAGS`) and `OXYLIFE.csv` (which does not parse as a capture name at
    all), so `newest_data_mtime` is None there → and the loss poller judged only nights NOT in
    `active_nights`. The night was therefore never eligible, so #2958's data-keyed re-audit skip —
    correct in itself — was never reached.

    This plant writes exactly that state: data four hours quiet, a `QC-SUMMARY.json` written NOW. Under
    the old predicate the folder is active and the night is skipped forever; under the new one the
    night's DATA decides and it is judged."""
    d = _night(tmp_path, "2026-10-02")
    (d / "QC-SUMMARY.json").write_text("{}")  # the poller's own output, written this instant
    calls = []

    def fake_write(nd, devices, commit=None):
        calls.append(os.path.basename(nd))
        open(os.path.join(nd, capture.loss_audit.VERDICT_NAME), "w").write("{}")
        return {"status": "UNKNOWN", "at": "x", "result": {"daemon_caused_min": 0.0}, "reason": "no bar"}

    monkeypatch.setattr(capture.loss_audit, "write_night", fake_write)
    # `active_nights` is REAL, and it reports this night as active — which is correct for its own job
    # (something IS writing here) and is precisely why the verdict poller must not ask it.
    assert "2026-10-02" in capture.diskguard.active_nights(str(tmp_path / "captures"), 1200.0)
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": []}, str(tmp_path)))
    assert calls == ["2026-10-02"], (
        "the night's DATA had been quiet for four hours; only the poller's own QC-SUMMARY was fresh, "
        "and that must not keep a night unjudged"
    )
    capture._STOP = asyncio.Event()


def test_CONTROL_a_night_whose_DATA_is_still_arriving_stays_INELIGIBLE(tmp_path, monkeypatch):
    """The control the plant needs, or "judge it anyway" would pass both. A night still recording must
    NOT be judged: its gaps are not gaps yet, and a verdict over a live stream reports a loss that the
    next minute of data fills in."""
    _night(tmp_path, "2026-10-03", data_age_s=0)  # data written this instant
    calls = []
    monkeypatch.setattr(capture.loss_audit, "write_night", lambda nd, *a, **k: calls.append(nd))
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": []}, str(tmp_path)))
    assert calls == [], "a night whose data is still arriving was judged"
    capture._STOP = asyncio.Event()


# ── the pending statement: the night that has NOT settled ───────────────────────────────────────────


def _cfg_devices():
    return [{"name": "Polar H10 0284", "model": "H10"}]


def test_a_night_still_receiving_data_is_published_as_pending_with_its_settle_countdown(tmp_path, monkeypatch):
    """The morning case: between doff and the audit the surface had nothing new to say and kept the
    PREVIOUS night's verdict under the previous night's date."""
    _night(tmp_path, "2026-09-18")  # settled, audited by the loop
    _night(tmp_path, "2026-09-19", data_age_s=120)  # still recording
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: {"2026-09-19"})
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    _poll_once(monkeypatch, tmp_path, devices=_cfg_devices())
    s = capture.STATUS["solid"]
    assert s["night"] == "2026-09-19"
    assert s["status"] == "UNKNOWN" and s["reason"] == capture.solid_night.NOT_SETTLED
    assert 110 <= s["quiet_s"] <= 130
    # The window is the config's, not a number spelled twice: `settles_in_s` is what is LEFT of it.
    assert s["quiet_s"] + s["settles_in_s"] == capture._NIGHT_SETTLE_S
    assert not (tmp_path / "captures" / "2026-09-19" / capture.solid_night.VERDICT_NAME).exists()


def test_the_live_vitals_file_in_last_nights_folder_does_not_nominate_it_as_pending(tmp_path, monkeypatch):
    """The box's own state, 2026-09-29: `OXYLIFE.csv` is appended into the session's START-date folder for
    as long as the run lasts, so `2026-09-28` was `active` 11 h after its last device sample and 8 h after
    its own verdict. Nominating on `active` would have replaced that verdict with "pending" all day."""
    d = _night(tmp_path, "2026-09-28")  # device data 2 h quiet
    (d / "OXYLIFE.csv").write_text("live\n")  # touched seconds ago — activity, but not device data
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: {"2026-09-28"})
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    _poll_once(monkeypatch, tmp_path, devices=_cfg_devices())
    # ⚠️ ASSERTED ON THE PENDING SHAPE, not on the key's absence. Before #3252 this night was ineligible
    # and nothing was published at all, so `"solid" not in STATUS` said what was meant. #3252 made a
    # night judgeable when its DATA goes quiet, so it now gets a REAL verdict here — which is the right
    # outcome and the opposite of the defect. What must still never happen is the PENDING publication,
    # and `settles_in_s` is the only key that distinguishes it (a verdict is a statement about the night;
    # the settle countdown is a statement about the clock it is read at).
    published = capture.STATUS.get("solid") or {}
    assert published.get("night") == "2026-09-28", published
    assert "settles_in_s" not in published, "a lifecycle append is not a reason to call a night pending"
    assert published.get("reason") != "not settled", published


def test_a_pending_night_older_than_what_is_published_does_not_pull_the_surface_back(tmp_path, monkeypatch):
    _night(tmp_path, "2026-09-18", data_age_s=60)
    monkeypatch.setattr(capture, "STATUS", {"solid": {"night": "2026-09-19", "status": "FAIL"}})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: {"2026-09-18"})
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    _poll_once(monkeypatch, tmp_path, devices=_cfg_devices())
    assert capture.STATUS["solid"] == {"night": "2026-09-19", "status": "FAIL"}


def test_a_folder_with_no_device_data_is_never_the_pending_night(tmp_path, monkeypatch):
    """The midnight decoy: at 00:00 the box creates tomorrow's folder and writes SIDECARS into it while
    every sensor keeps appending to the session's start-date folder."""
    _night(tmp_path, "2026-09-18", data_age_s=60)
    d = tmp_path / "captures" / "2026-09-19"
    d.mkdir(parents=True)
    (d / "Tepna_20260919000000_LINK.csv").write_text("x\n")  # a sidecar, and lexically newer
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: {"2026-09-18", "2026-09-19"})
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    _poll_once(monkeypatch, tmp_path, devices=_cfg_devices())
    assert capture.STATUS["solid"]["night"] == "2026-09-18"


def test_a_pending_verdict_that_cannot_be_composed_is_logged_and_nothing_is_published(tmp_path, monkeypatch, caplog):
    _night(tmp_path, "2026-09-19", data_age_s=60)
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: {"2026-09-19"})
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    monkeypatch.setattr(
        capture.solid_night, "pending_verdict", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom"))
    )
    with caplog.at_level("WARNING"):
        _poll_once(monkeypatch, tmp_path, devices=_cfg_devices())
    assert any("solid-night: 2026-09-19 — pending verdict not composed" in r.getMessage() for r in caplog.records)
    assert "solid" not in capture.STATUS


def test_an_empty_captures_tree_publishes_nothing_rather_than_a_night_shaped_null(tmp_path, monkeypatch):
    (tmp_path / "captures").mkdir(parents=True)
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    _poll_once(monkeypatch, tmp_path, devices=_cfg_devices())
    assert "solid" not in capture.STATUS


def test_a_verdict_older_judge_code_wrote_is_re_judged_one_night_per_poll(tmp_path, monkeypatch, caplog):
    """The 2026-10-09 defect: a settled night's data never changes, so its verdict stood after the judge was
    fixed. Two nights judged under OLD; the daemon restarts on NEW with the judge changed between them. Each
    poll re-judges ONE night, the withdrawal says why, and once both carry NEW the poller stands down."""
    a, b = _night(tmp_path, "2026-09-17"), _night(tmp_path, "2026-09-18")
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    audits = []
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer(audits))
    monkeypatch.setattr(capture.solid_night, "_moved", {})
    monkeypatch.setattr(capture.solid_night._bid, "_git", lambda *a, **k: "capture-host/solid_night_inputs.py")
    monkeypatch.setattr(capture.verdict, "commit_sha", lambda: "01d01d01")
    _poll_once(monkeypatch, tmp_path)
    assert audits == ["2026-09-17", "2026-09-18"]
    monkeypatch.setattr(capture.verdict, "commit_sha", lambda: "4e44e401")
    with caplog.at_level("INFO"):
        _poll_once(monkeypatch, tmp_path)
    assert audits[2:] == ["2026-09-17"], "one re-judge per poll: each is a full audit in the daemon"
    why = capture.solid_night.CODE_MOVED.format(old="01d01d01", new="4e44e401")
    assert any(why in r.getMessage() for r in caplog.records)
    w = json.loads((a / capture.solid_night.WITHDRAWN_NAME).read_text().splitlines()[-1])
    assert w["reason"] == why and w["replaced_by"]["commit"] == "4e44e401"
    _poll_once(monkeypatch, tmp_path)
    assert audits[3:] == ["2026-09-18"]
    wb = [json.loads(ln) for ln in (b / capture.solid_night.WITHDRAWN_NAME).read_text().splitlines()]
    assert [w["reason"] for w in wb] == [why], wb
    _poll_once(monkeypatch, tmp_path)
    assert audits[4:] == [], "both nights carry the running commit now: nothing is re-judged"


def test_a_re_judged_older_night_does_not_pull_the_status_card_back(tmp_path, monkeypatch):
    d = _night(tmp_path, "2026-09-18")
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    shown = {"night": "2026-09-19", "status": "PASS"}
    monkeypatch.setattr(capture, "STATUS", {"solid": dict(shown)})
    _poll_once(monkeypatch, tmp_path)
    assert (d / capture.solid_night.VERDICT_NAME).exists(), "the older night's verdict is still written"
    assert capture.STATUS["solid"] == shown, "but the card keeps the newer night"


# ── the audit and the verdict run OFF this process (QC-SPAWN-CHILD, 2026-10-13) ──────────────────────
def test_where_the_audit_RAN_is_published_beside_what_it_found(tmp_path, monkeypatch):
    """A full audit and composition cost this process +311..+605 MB of peak per night (vigil
    2026-10-12), so both now run in the poll's one spawned child. Which process did the work is a fact
    about the measurement, and it is published the way `qc.isolation` is — on the surface the finding
    itself lands on. Here the suite's own fake keeps the work in this process, and the field says so."""
    _night(tmp_path, "2026-09-18")
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    _poll_once(monkeypatch, tmp_path)
    assert capture.STATUS["loss"]["2026-09-18"]["isolation"] == "thread"
    assert capture._LOSS_ISOLATION == "thread" and capture.STATUS["loss"]["2026-09-18"]["status"] == "UNKNOWN"


def test_a_poll_with_NOTHING_TO_DO_does_not_pay_for_a_child(tmp_path, monkeypatch):
    """A box carrying settled nights polls every 30 minutes and almost always has no work: the audit is
    current and the verdict is newer than it. Two stats answer that in this process, and a spawn to
    discover it would be 0.3 s and a full interpreter per poll, forever."""
    _night(tmp_path, "2026-09-18")
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    _poll_once(monkeypatch, tmp_path)  # the first poll audits and composes

    async def refuse(*a, **k):
        raise AssertionError("a poll with no work asked for a child")

    monkeypatch.setattr(capture, "_qc_offload", refuse)
    _poll_once(monkeypatch, tmp_path)  # the second has nothing to do


def test_an_audit_that_raises_no_longer_takes_the_PENDING_statement_down_with_it(tmp_path, monkeypatch):
    """🔴 A SECOND NIGHT'S ABSENCE CAUSED BY THE FIRST NIGHT'S FAILURE. When the audit ran in this frame
    its exception left the per-night loop AND skipped `_solid_pending`, so a settled night that could
    not be audited also suppressed the statement about the night still being captured — the morning card
    kept a verdict under an older date. The batch returns the failure as a value, so both run."""
    _night(tmp_path, "2026-09-18")  # settled, and its audit will raise
    _night(tmp_path, "2026-09-19", data_age_s=0)  # still recording ⇒ the pending night
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    monkeypatch.setattr(capture.loss_audit, "write_night", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    _poll_once(monkeypatch, tmp_path)
    assert capture.STATUS["solid"]["night"] == "2026-09-19"
    assert capture.STATUS["solid"]["reason"] == "not settled", capture.STATUS["solid"]


def test_a_CHILD_THAT_DIED_is_a_poll_that_did_not_run_and_the_poller_says_so(tmp_path, monkeypatch, caplog):
    """A batch that did not run must not read as one that ran. `_qc_offload` lets `BrokenProcessPool`
    propagate on purpose — a worker killed under us (the box OOM-killing the child is the case that
    matters) is not a night without findings — and the poller's own handler is what names it. This is
    the path the per-night `loss_error` does NOT cover: that one is the audit raising INSIDE a living
    child, which comes back as a value."""
    _night(tmp_path, "2026-09-18")
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))

    async def died(*a, **k):
        raise concurrent.futures.process.BrokenProcessPool("worker died")

    monkeypatch.setattr(capture, "_qc_offload", died)
    with caplog.at_level("WARNING"):
        _poll_once(monkeypatch, tmp_path)
    assert any("loss-audit: poll failed" in r.getMessage() for r in caplog.records)
    assert "loss" not in capture.STATUS, "nothing is published about a night nothing audited"


# ── the card's floor at startup (residue 2026-10-21-the-solid-card-states-a-stale-night-…) ───────────
def _stored(root, night, obj):
    """A written SOLID-VERDICT.json beside `night`, with no capture data: judged, not re-judgeable."""
    d = root / "captures" / night
    d.mkdir(parents=True, exist_ok=True)
    (d / capture.solid_night.VERDICT_NAME).write_text(json.dumps(obj))
    return d


def test_the_card_is_seeded_from_the_newest_written_verdict_at_startup(tmp_path, monkeypatch, caplog):
    """All six fields the two publish paths write, mapped from the file's own two levels.

    The run statement, the solid count and the exit flag live under `result.run`; the night, the status
    and the reason are at the top. The card draws only the second three, and the first three are carried
    anyway so the object's shape does not depend on which path last wrote it."""
    _stored(tmp_path, "2026-09-17", {"status": "FAIL", "reason": "earlier night"})
    _stored(
        tmp_path,
        "2026-09-19",
        {
            "status": "PASS",
            "reason": None,
            "result": {"run": {"statement": "3 solid of 5 nights over 5 days", "solid": 3, "exit": False}},
        },
    )
    monkeypatch.setattr(capture, "STATUS", {})
    with caplog.at_level("INFO"):
        capture._seed_solid(str(tmp_path / "captures"))
    assert capture.STATUS["solid"] == {
        "night": "2026-09-19",
        "status": "PASS",
        "reason": None,
        "run": "3 solid of 5 nights over 5 days",
        "solid": 3,
        "exit": False,
    }
    assert any("card seeded from 2026-09-19 PASS" in r.getMessage() for r in caplog.records)


def test_a_not_applicable_nights_absent_run_is_null_on_the_card_never_a_zero(tmp_path, monkeypatch):
    """∅ `result: null` is the verdict contract's own shape for NOT_APPLICABLE, so the run is ABSENT.

    A zero count with a false exit would read as "this programme has zero solid nights and has not
    exited", which is a measurement. Nothing measured it: the night was skipped."""
    _stored(tmp_path, "2026-09-19", {"status": "NOT_APPLICABLE", "reason": "probe night", "result": None})
    monkeypatch.setattr(capture, "STATUS", {})
    capture._seed_solid(str(tmp_path / "captures"))
    s = capture.STATUS["solid"]
    assert (s["night"], s["status"], s["reason"]) == ("2026-09-19", "NOT_APPLICABLE", "probe night")
    assert s["run"] is None and s["solid"] is None and s["exit"] is None, s


def test_a_box_that_has_judged_no_night_seeds_nothing_and_says_so(tmp_path, monkeypatch, caplog):
    """∅ No verdict anywhere leaves the key absent, so `renderSolidNight` keeps the card hidden."""
    (tmp_path / "captures" / "2026-09-19").mkdir(parents=True)  # a night, and nothing has judged it
    monkeypatch.setattr(capture, "STATUS", {})
    with caplog.at_level("INFO"):
        capture._seed_solid(str(tmp_path / "captures"))
    assert "solid" not in capture.STATUS
    assert any("the card seeds nothing" in r.getMessage() for r in caplog.records)


def test_after_a_restart_the_seed_keeps_a_re_judged_older_night_off_the_card(tmp_path, monkeypatch):
    """THE DEFECT ITSELF. `_publish_solid` promises a re-judged older night is written but not published.

    With `STATUS` empty after a restart that promise holds for nothing, and the poller walks its window
    oldest-first — measured on the box as `PASS · 2026-09-08` while 09-20 recorded. The seed is the
    floor that rule needs. The control below is the same poll with the seed removed."""
    older = _night(tmp_path, "2026-09-18")  # settled DATA: this night is the one the poller re-judges
    _stored(tmp_path, "2026-09-19", {"status": "PASS", "reason": None})  # the newest JUDGED night
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    monkeypatch.setattr(capture, "STATUS", {})
    _poll_once(monkeypatch, tmp_path)
    assert (older / capture.solid_night.VERDICT_NAME).exists(), "the older night is still judged and written"
    assert capture.STATUS["solid"]["night"] == "2026-09-19", "and the card states the newest judged night"
    # CONTROL — the seed removed, nothing else changed: the card reads the older night back. Its
    # verdict goes with it, because the poll above already wrote one under the running commit and a
    # night that carries that commit is re-judged by nothing.
    (older / capture.solid_night.VERDICT_NAME).unlink()
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture, "_seed_solid", lambda captures: None)
    _poll_once(monkeypatch, tmp_path)
    assert capture.STATUS["solid"]["night"] == "2026-09-18", "which is the state the row logged"
