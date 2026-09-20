# tepna-capture — tests/test_spare_round_trip.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""ASK THE SPARE BEFORE YOU MOVE ONTO IT — `failover_candidates` + `_pick_live_spare`.

`failover_target` ranks spares on `up`, which is the kernel's CACHED flag. On vigil 2026-09-11 the
wedged radio reported `UP RUNNING` while `HCI Reset` timed out at `-110`, so that flag is wrong about
precisely the failure a failover exists to escape. These tests pin the three rules that make the
round trip safe to depend on: only `False` convicts, a refusal is remembered as a COOLDOWN rather than
a verdict, and a box with no live spare refuses to migrate instead of spending the flap cap.
"""

import asyncio

import capture
import pytest

PIN = "00:01:95:CC:53:02"
A = "AC:A7:F1:29:9D:1D"
B = "F0:D5:BF:1E:79:21"


@pytest.fixture(autouse=True)
def _clean():
    capture._SPARE_QUARANTINE.clear()
    yield
    capture._SPARE_QUARANTINE.clear()


def _ad(hci, mac, up=True):
    return {"hci": hci, "mac": mac, "up": up}


def _pick(adapters, *, reserved=(), probe=None, clock=None, cooldown=900.0):
    kw = {"reserved": reserved, "cooldown_sec": cooldown}
    if probe is not None:
        kw["probe"] = probe
    if clock is not None:
        kw["now"] = clock
    return asyncio.run(capture._pick_live_spare(PIN, adapters, **kw))


def _answers(table):
    """A probe that answers per-hci, and records what it was asked."""
    asked = []

    async def probe(h):
        asked.append(h)
        return table[h]

    return probe, asked


# ── the pure ranking ────────────────────────────────────────────────────────────────────────────
def test_candidates_rank_unreserved_first_and_agree_with_failover_target():
    """The ranking must be the SAME decision `failover_target` already made, only with the
    runners-up still attached — otherwise this refactor quietly changed which radio is preferred."""
    ads = [_ad("hci0", A), _ad("hci2", B)]
    ranked = capture.failover_candidates(PIN, ads, reserved=[A])
    assert [c["mac"] for c in ranked] == [B, A], "a reserved radio was not pushed to the back"
    assert capture.failover_target(PIN, ads, reserved=[A]) == ranked[0]["mac"]


def test_candidates_exclude_the_pinned_radio_and_anything_down():
    ranked = capture.failover_candidates(PIN, [_ad("hci1", PIN), _ad("hci0", A, up=False),
                                               _ad("hci2", B)])
    assert [c["mac"] for c in ranked] == [B]


def test_candidates_carry_the_hci_name_the_probe_needs():
    """MAC identifies the radio; `hci` is what `hciconfig` is addressed by. Dropping either makes
    the round trip impossible to ask."""
    (c,) = capture.failover_candidates(PIN, [{"hci": "hci2", "mac": B.lower(), "up": True}])
    assert (c["hci"], c["mac"]) == ("hci2", B), "mac must come back upper-cased, hci untouched"


# ── only False convicts ─────────────────────────────────────────────────────────────────────────
def test_a_spare_that_answers_is_taken():
    probe, asked = _answers({"hci2": True})
    assert _pick([_ad("hci2", B)], probe=probe) == B
    assert asked == ["hci2"]


def test_a_DEAF_spare_is_skipped_and_the_next_one_is_taken():
    probe, asked = _answers({"hci0": False, "hci2": True})
    assert _pick([_ad("hci0", A), _ad("hci2", B)], probe=probe) == B
    assert asked == ["hci0", "hci2"], "the runner-up was never reached"
    assert A in capture._SPARE_QUARANTINE and B not in capture._SPARE_QUARANTINE


def test_an_UNDETERMINABLE_probe_does_not_convict(caplog):
    """§∅: `None` means the probe could not run — no `hciconfig`, unparseable output. That is an
    absent measurement, not evidence against the radio, so behaviour must be exactly what it was
    before the probe existed: take the spare."""
    probe, _ = _answers({"hci2": None})
    assert _pick([_ad("hci2", B)], probe=probe) == B
    assert B not in capture._SPARE_QUARANTINE, "an unmeasurable radio was quarantined"


def test_a_candidate_with_no_hci_name_is_taken_unprobed():
    """`parse_hciconfig` always supplies one, but a caller that does not must not be refused — the
    same 'absence never convicts' rule, one level up."""
    probe, asked = _answers({})
    assert _pick([{"mac": B, "up": True}], probe=probe) == B
    assert asked == []


# ── refusing is a real outcome ──────────────────────────────────────────────────────────────────
def test_when_EVERY_spare_is_deaf_the_failover_is_REFUSED(caplog):
    probe, _ = _answers({"hci0": False, "hci2": False})
    with caplog.at_level("CRITICAL"):
        assert _pick([_ad("hci0", A), _ad("hci2", B)], probe=probe) is None
    assert "NO LIVE SPARE" in caplog.text, "a refusal that says nothing is indistinguishable from "\
                                           "having no spare at all"
    assert set(capture._SPARE_QUARANTINE) == {A, B}


def test_no_candidates_at_all_is_silent(caplog):
    """Nothing to say: this box simply has one radio. The CRITICAL is reserved for the case where
    spares EXISTED and every one of them was deaf."""
    probe, _ = _answers({})
    with caplog.at_level("CRITICAL"):
        assert _pick([_ad("hci1", PIN)], probe=probe) is None
    assert "NO LIVE SPARE" not in caplog.text


# ── the quarantine is a cooldown, not a verdict ─────────────────────────────────────────────────
def test_a_quarantined_spare_is_skipped_WITHOUT_being_probed_again():
    now = [1000.0]
    probe, asked = _answers({"hci0": False, "hci2": True})
    assert _pick([_ad("hci0", A), _ad("hci2", B)], probe=probe, clock=lambda: now[0]) == B
    assert asked == ["hci0", "hci2"]
    now[0] = 1100.0                      # still inside the 900 s cooldown
    assert _pick([_ad("hci0", A), _ad("hci2", B)], probe=probe, clock=lambda: now[0]) == B
    assert asked == ["hci0", "hci2", "hci2"], "the quarantined radio was probed again too early"


def test_the_cooldown_EXPIRES_and_the_radio_is_probed_again():
    """A refusal that never expires is the 'failover that silently became permanent' the
    per-device-pinning brief warns about. The memory suppresses re-probing; it must never become the
    thing that decides."""
    now = [1000.0]
    table = {"hci0": False, "hci2": True}
    probe, asked = _answers(table)
    assert _pick([_ad("hci0", A), _ad("hci2", B)], probe=probe, clock=lambda: now[0]) == B
    now[0] = 2000.0                      # past 1000 + 900
    table["hci0"] = True                 # the radio came back
    assert _pick([_ad("hci0", A), _ad("hci2", B)], probe=probe, clock=lambda: now[0]) == A
    assert A not in capture._SPARE_QUARANTINE, "a served cooldown left the entry behind"


def test_every_spare_quarantined_refuses_without_probing():
    now = [1000.0]
    probe, asked = _answers({"hci0": False})
    assert _pick([_ad("hci0", A)], probe=probe, clock=lambda: now[0]) is None
    now[0] = 1001.0
    assert _pick([_ad("hci0", A)], probe=probe, clock=lambda: now[0]) is None
    assert asked == ["hci0"], "a radio inside its cooldown was re-probed"


# ── the defaults are the production path ────────────────────────────────────────────────────────
def test_the_defaults_use_the_real_probe_and_a_real_clock(monkeypatch):
    """Both injection points default to production: if `probe` fell back to something else, or the
    clock did, these tests would be exercising a path the daemon never takes."""
    seen = []

    async def fake(h):
        seen.append(h)
        return True

    monkeypatch.setattr(capture, "_adapter_responds", fake)
    assert asyncio.run(capture._pick_live_spare(PIN, [_ad("hci2", B)])) == B
    assert seen == ["hci2"]
