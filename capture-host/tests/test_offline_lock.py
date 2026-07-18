# tepna-capture — tests/test_offline_lock.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The single offline-download slot: only ONE device may pull its onboard recording at a time, and a
# second request must FAIL FAST (not queue). Regression for 2026-07-18 09:00, where three overlapping
# offline ops fought over the one radio and the O2Ring pull died with org.bluez.Error.InProgress.
# offline_lock.py is pure stdlib (contextlib) → imports cleanly in the hardware-free CI.

import asyncio

import pytest

import offline_lock


def test_slot_is_free_initially():
    assert offline_lock.busy_with() is None


def test_second_caller_is_rejected_while_first_holds():
    async def scenario():
        async with offline_lock.slot("O2Ring"):
            assert offline_lock.busy_with() == "O2Ring"
            with pytest.raises(offline_lock.OfflineBusy) as ei:
                async with offline_lock.slot("Verity"):
                    pass                       # must never run — the slot is taken
            assert ei.value.holder == "O2Ring"  # names the blocker so the UI can say who
    asyncio.run(scenario())


def test_slot_is_released_after_normal_exit():
    async def scenario():
        async with offline_lock.slot("O2Ring"):
            pass
        assert offline_lock.busy_with() is None
        async with offline_lock.slot("Verity"):   # a later pull must succeed
            assert offline_lock.busy_with() == "Verity"
    asyncio.run(scenario())


def test_slot_is_released_even_when_the_pull_raises():
    async def scenario():
        with pytest.raises(TimeoutError):
            async with offline_lock.slot("O2Ring"):
                raise TimeoutError("MTU=23, READ_FILE_START dropped")
        assert offline_lock.busy_with() is None   # a failed pull must not wedge the slot forever
    asyncio.run(scenario())


def test_concurrent_pulls_only_one_wins():
    async def scenario():
        ran = []

        async def puller(name):
            try:
                async with offline_lock.slot(name):
                    ran.append(name)
                    await asyncio.sleep(0.02)
                return "ok"
            except offline_lock.OfflineBusy:
                return "busy"

        results = await asyncio.gather(puller("A"), puller("B"), puller("C"))
        assert sorted(results) == ["busy", "busy", "ok"]   # exactly one proceeds
        assert len(ran) == 1
        assert offline_lock.busy_with() is None
    asyncio.run(scenario())
