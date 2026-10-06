# tepna-capture — tests/test_as11_link_guard.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""ONE AS11, ONE LINK, FOUR ACTORS — and before this module, nothing stopped two of them overlapping.

`cpap_spool_caller.pull_blocked` names "the AS11's single socket", but it is a PREDICATE evaluated once
per minute BEFORE the pull starts; the pull then runs for minutes while the shadow polls every 33 s. A
check at the start cannot serialize an overlap that begins afterwards.

🔴 AND THE AS11 IS THE ONE DEVICE WHERE THE HOUSE GUARANTEE DOES NOT HOLD.
CAPTURE-HOST-RESOURCE-ORCHESTRATION-AUDIT-2026-09-05 §1 says per-device serialisation is STRUCTURAL —
"a runner never issues two GATT commands concurrently because it is one coroutine". True of every
wearable; the AS11 has FOUR actors instead of one runner (two supervised tasks, a controller, an HTTP
pairing handler), so the structure the audit relies on is absent here.

⚠️ These tests do NOT assert that an overlap caused the 2026-10-05 key rejection. Nothing in our code
records who held the link that morning, and it is not known whether the AS11 accepts two links at once.
What is asserted is that OUR code can no longer start a second session while one is open.
"""

from __future__ import annotations

import asyncio

import as11_link_guard as G
import pytest


@pytest.fixture(autouse=True)
def _free_link():
    """The claim is module state, like `offline_lock`'s. Freed around every test so one failure cannot
    leave the link held for the rest of the session — several tests below deliberately hold a link and
    never disconnect it, which is the point of them.

    ⚠️ Touches the PRIVATE directly, deliberately. A public `reset_for_test()` was the first shape, and
    `tools/find_unwired.py` flagged it as "a public function referenced only by tests" — correctly: a
    production API that exists for the suite is the "published and read by nothing" class that tool
    exists to find. `offline_lock` needs no such hook at all (its tests raise `OfflineBusy` as a double
    and its `finally` always frees the slot), so following the house pattern means reaching for the
    private here rather than widening the module's surface for our convenience."""
    G._holder = None
    yield
    G._holder = None


def _triple(opened: list, name: str):
    """A fake `connect()` returning the (write, recv, disconnect) triple every AS11 actor returns."""

    async def connect():
        opened.append(name)

        async def write(_f):
            pass

        async def recv():
            return b""

        async def disconnect():
            opened.append(f"{name}:closed")

        return write, recv, disconnect

    return connect


def test_a_SECOND_actor_cannot_open_the_link_while_the_first_holds_it():
    """🔴 THE UNIT, and the plant that is red on main: two actors go for one link. The second is DECLINED
    and never reaches its `connect()` — so `opened` can never show two opens with no close between them.

    On main both `connect()` calls run and both return a usable triple, because nothing coordinates
    them: the two connect factories are independent closures, on possibly DIFFERENT adapters, and BlueZ
    will not serialize them for us."""
    opened: list[str] = []

    async def scenario():
        _w, _r, d1 = await G.hold("spool-pull", _triple(opened, "spool"))
        assert opened == ["spool"] and G.busy_with() == "spool-pull"

        with pytest.raises(G.LinkBusy) as ei:
            await G.hold("shadow-poll", _triple(opened, "shadow"))
        assert ei.value.holder == "spool-pull"
        assert opened == ["spool"], f"the declined actor opened the link anyway: {opened}"

        await d1()
        assert G.busy_with() is None and opened == ["spool", "spool:closed"]
        # and now the second actor gets it
        _w2, _r2, d2 = await G.hold("shadow-poll", _triple(opened, "shadow"))
        assert opened[-1] == "shadow"
        await d2()

    asyncio.run(scenario())


def test_NOBODY_QUEUES_so_nobody_can_deadlock():
    """FAIL FAST, the `offline_lock` rule — and here it also removes the worst failure this module could
    introduce. A bounded wait would still turn one leaked release into minutes of dead CPAP; an UNBOUNDED
    one would make it permanent, which is strictly worse than the overlap being prevented. Nobody waits,
    so a leak costs one refused cycle rather than the device.

    ⚠️ The observable is that the call RETURNS (raising) rather than pending: a queueing implementation
    would leave the coroutine unfinished here, and this test would hang instead of failing — which is why
    the assertion is on completion, not just on the exception."""
    opened: list[str] = []

    async def scenario():
        _w, _r, _d = await G.hold("live-stream", _triple(opened, "live"))
        task = asyncio.create_task(G.hold("pairing", _triple(opened, "pair")))
        await asyncio.sleep(0)
        assert task.done(), "the second actor is QUEUEING — it must be declined immediately"
        with pytest.raises(G.LinkBusy):
            task.result()
        assert opened == ["live"]

    asyncio.run(scenario())


def test_a_FAILED_connect_releases_the_link_rather_than_holding_it_for_nothing():
    """A claim held by a connect that never opened would block the link on behalf of nothing — the
    failure that turns one bad connect into a dead CPAP until the daemon restarts."""

    async def boom():
        raise OSError("connect refused")

    async def scenario():
        with pytest.raises(OSError):
            await G.hold("spool-pull", boom)
        assert G.busy_with() is None, "a failed connect must not leave the link claimed"
        opened: list[str] = []
        _w, _r, d = await G.hold("shadow-poll", _triple(opened, "shadow"))
        assert opened == ["shadow"]
        await d()

    asyncio.run(scenario())


def test_the_release_survives_a_disconnect_that_RAISES():
    """`disconnect` does real I/O and can fail. If a failing close left the link claimed, one bad
    teardown would cost every later session — so the release is in a `finally` and the error still
    propagates, because swallowing it would hide a link that never closed."""
    opened: list[str] = []

    async def connect():
        opened.append("x")

        async def write(_f):
            pass

        async def recv():
            return b""

        async def disconnect():
            raise OSError("close failed")

        return write, recv, disconnect

    async def scenario():
        _w, _r, d = await G.hold("live-stream", connect)
        with pytest.raises(OSError):
            await d()
        assert G.busy_with() is None, "a disconnect that raised must still have freed the link"

    asyncio.run(scenario())


def test_the_JOURNAL_LINE_is_actually_emitted_and_names_the_holder(caplog):
    """🔴 THE JOURNAL LINE IS THE DELIVERABLE, so it is asserted where it lands — in the LOG.

    CI's diff-scoped gate named two survivors here and both were on this one statement:
    `log.info(declined_line(_holder))` → `log.info(None)`, and → `log.info(declined_line(None))`. Every
    test above reads the EXCEPTION's message, which is built separately by `LinkBusy.__init__`, so the
    logged line was unobserved and could have been emitting `None` on every decline.

    ⚠️ That is not a cosmetic gap. The brief's requirement was a line naming who holds the link, and a
    contended night is reconstructed from the journal afterwards — "the link is held by None" is exactly
    the un-actionable sentence this line exists to replace."""
    import logging

    opened: list[str] = []

    async def scenario():
        _w, _r, _d = await G.hold("spool-pull", _triple(opened, "spool"))
        with caplog.at_level(logging.INFO, logger="tepna.cpap"), pytest.raises(G.LinkBusy):
            await G.hold("shadow-poll", _triple(opened, "shadow"))

    asyncio.run(scenario())
    msgs = [r.getMessage() for r in caplog.records]
    assert any("held by spool-pull" in m for m in msgs), "the emitted line must name the holder; got %r" % msgs
    assert not any(m.strip() in {"None", ""} for m in msgs), f"an empty or None journal line: {msgs}"
    assert not any("held by None" in m for m in msgs), f"the holder was dropped before logging: {msgs}"


def test_the_declined_line_NAMES_the_holder():
    """ "The link was busy" is not actionable: the question asked afterwards is which actor was in the
    way. The holder is in the sentence and on the exception, so a caller can render it."""
    assert G.declined_line("spool-pull") == (
        "the AS11 link is held by spool-pull — declined rather than opening a second session"
    )
    assert "shadow-poll" in str(G.LinkBusy("shadow-poll"))
    assert G.LinkBusy("shadow-poll").holder == "shadow-poll"


def test_all_four_ACTOR_NAMES_reach_the_guard_from_capture():
    """The wiring, pinned by name. A guard nothing calls is the "published and read by nothing" failure
    this lane keeps finding — and the names are what the journal shows, so a renamed actor that stops
    matching its call site would make the line unreadable rather than failing anything."""
    import re

    from _srcscan import module_source

    # ⚠️ `module_source`, NEVER `open("capture.py")`. A raw read makes mutmut report the whole module as
    # "failed to collect stats" — which looks like a broken environment while silently leaving 298
    # functions unmeasured. `test_mutation_hygiene.test_no_test_reads_a_mutatable_module_source_raw`
    # caught this exact line, and it is the second time today I have had to be told: the same gate
    # refused an `inspect.getsource` premise test this morning.
    src = module_source("capture.py")
    calls = set(re.findall(r'as11_link_guard\.hold\(\s*"([a-z-]+)"', src))
    assert calls == {"live-stream", "pairing", "shadow-poll", "spool-pull"}, calls
