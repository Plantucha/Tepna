# tepna-capture — tests/test_as11_shadow_wire.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The daemon wiring for the AS11 shadow detector: capture._maybe_start_as11_shadow. Covers all three
# branches (disabled → None, enabled-but-no-creds → None, enabled → task) with the seams injected, so
# no radio and no live loop are needed. The bleak connect closure it would build is the only pragma'd
# edge.

from types import SimpleNamespace

import capture


def test_disabled_is_a_noop(tmp_path):
    tasks = []
    assert capture._maybe_start_as11_shadow({}, "cfg.yaml", str(tmp_path), object(), tasks) is None
    assert tasks == []


def test_enabled_but_no_creds_skips(tmp_path):
    tasks = []
    r = capture._maybe_start_as11_shadow(
        {"as11_detector": {"enabled": True}}, str(tmp_path / "cfg.yaml"), str(tmp_path),
        object(), tasks, load_creds=lambda _p: None,
    )
    assert r is None and tasks == []


def test_enabled_starts_shadow_task_and_opens_sidecars(tmp_path):
    tasks = []
    made = []

    def fake_create_task(coro):
        coro.close()  # create the coroutine but do NOT run the loop
        made.append(coro)
        return "TASK"

    async def fake_connect():  # never called (task isn't run), just satisfies the seam
        return None

    ctl = SimpleNamespace(_running=lambda: False)
    r = capture._maybe_start_as11_shadow(
        {"as11_detector": {"enabled": True, "poll_interval_sec": 10}, "cpap": {"ble_stream": {}}},
        str(tmp_path / "cfg.yaml"), str(tmp_path), ctl, tasks,
        load_creds=lambda _p: {"masterPairKey": "00ff", "clientId": "c1", "ble_addr": "AA:BB"},
        connect_factory=fake_connect, create_task=fake_create_task,
    )
    assert r == "TASK" and tasks == ["TASK"] and len(made) == 1
    # both sidecars were opened under root (headers are buffered until the task runs)
    assert (tmp_path / "SESSIONDETECT.csv").exists()
    assert (tmp_path / "AS11CLOCK.csv").exists()
