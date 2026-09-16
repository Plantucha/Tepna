# tepna-capture — tests/test_long_run_repeated.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""§14 of OPERATIONAL-MATURITY-ROADMAP: REPEATED operation, not only single success.

The suite already covers each of these events ONCE — `test_a_gone_window_ABANDONS_WITHOUT_touching_the_link`,
`test_identity_is_skipped_when_the_device_has_gone`,
`test_resolve_hci_forgets_a_cached_index_when_the_adapter_disappears`. A single occurrence cannot see the
failure §14 is actually about: state that ACCUMULATES across churn, and behaviour that differs on the
fiftieth cycle from the first. §14's own words are "failures that occur only after hours or days".

Audited 2026-09-15 across §14's nine items: eight had at least one test whose name asserts repetition;
**repeated device disappearance had none**. This is that gap.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import link_rssi  # noqa: E402

CYCLES = 50


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _wire(monkeypatch, state):
    """sysfs reports the adapter only while `state['hci']` is set; dbus never answers."""

    def sysfs():
        if state["hci"] is None:
            return {"00:11:22:33:44:55": "hci1"}  # some OTHER adapter is present
        return {state["key"]: state["hci"]}

    async def no_dbus():
        return {}

    monkeypatch.setattr(link_rssi, "sysfs_hci", sysfs)
    monkeypatch.setattr(link_rssi, "dbus_hci", no_dbus)


def test_repeated_disappearance_neither_accumulates_nor_pins_a_stale_index(monkeypatch):
    """50 disappear/reappear cycles, RENUMBERING on each return.

    Two failures a single-shot test cannot reach:
      1. the cache grows by one entry per cycle (unbounded across a night of BLE churn);
      2. cycle N serves cycle N-1's index — the 2026-07-18 hci0/hci2 swap, which pins connections to a
         DIFFERENT radio and is silent because the name still resolves.
    """
    key = "AA:BB:CC:DD:EE:FF"
    state = {"key": key, "hci": "hci0"}
    _wire(monkeypatch, state)

    link_rssi._HCI_CACHE.pop(key, None)
    baseline = len(link_rssi._HCI_CACHE)

    resolved = []
    for i in range(CYCLES):
        # the adapter comes back, re-enumerated to a DIFFERENT index than last time
        state["hci"] = "hci0" if i % 2 == 0 else "hci2"
        resolved.append(_run(link_rssi.resolve_hci(key, refresh=True)))

        # ...and then goes away again
        state["hci"] = None
        assert _run(link_rssi.resolve_hci(key, refresh=True)) is None, f"cycle {i}: a vanished adapter resolved"
        assert key not in link_rssi._HCI_CACHE, f"cycle {i}: a vanished adapter kept serving a stale index"

    expected = ["hci0" if i % 2 == 0 else "hci2" for i in range(CYCLES)]
    assert resolved == expected, "a cycle served a stale index instead of the current one"
    # ANTI-VACUITY: the loop must actually have alternated, or the stale-index assertion proves nothing.
    assert len(set(resolved)) == 2, "the test never renumbered, so it cannot have detected pinning"
    assert len(link_rssi._HCI_CACHE) == baseline, (
        f"cache grew from {baseline} to {len(link_rssi._HCI_CACHE)} over {CYCLES} cycles"
    )


def test_repeated_resolve_while_present_is_idempotent(monkeypatch):
    """The control arm. Repetition WITHOUT disappearance must also not accumulate — otherwise the test
    above could pass because the pop happens to mask growth the steady path introduces."""
    key = "BB:CC:DD:EE:FF:00"
    state = {"key": key, "hci": "hci3"}
    _wire(monkeypatch, state)

    link_rssi._HCI_CACHE.pop(key, None)
    got = [_run(link_rssi.resolve_hci(key, refresh=True)) for _ in range(CYCLES)]

    assert got == ["hci3"] * CYCLES
    assert len(link_rssi._HCI_CACHE) <= 1 + len([k for k in link_rssi._HCI_CACHE if k != key])
    link_rssi._HCI_CACHE.pop(key, None)
