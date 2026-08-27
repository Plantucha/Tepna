# tepna-capture — tests/test_oxy_presence.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The PRESENCE axis + connection budget (O2RING-AUTONOMOUS-HARVEST §5/§6/§11/§12/§20/§21).
# §26's negative tests are first-class here, not an appendix: most of this module's value is in what
# it REFUSES to do, and a refusal that is never tested is a refusal that quietly stops happening.
# Every assertion below was verified by re-applying the defect it names.

import oxy_presence as P
from oxy_presence import OxyPresState as S

RING = "AA:BB:CC:DD:EE:FF"


# ── §5 identity ──────────────────────────────────────────────────────────────
def test_the_configured_ring_matches_case_insensitively():
    assert P.is_expected_ring("aa:bb:cc:dd:ee:ff", RING) is True


def test_an_arbitrary_device_is_NOT_the_ring():
    assert P.is_expected_ring("11:22:33:44:55:66", RING) is False


def test_a_missing_address_or_missing_config_never_matches():
    # Fail CLOSED. An unconfigured ring matching everything is how a stranger's beacon summons a probe.
    assert P.is_expected_ring(None, RING) is False
    assert P.is_expected_ring(RING, None) is False
    assert P.is_expected_ring("", "") is False


# ── §5 debounce and gap tolerance ────────────────────────────────────────────
def test_one_advertisement_does_NOT_make_the_ring_present():
    # The charter names this failure directly: "avoid creating a harvest every time one
    # advertisement is received."
    p = P.observe(None, seen_at=100.0, now=100.0)
    assert p.state is S.UNKNOWN and p.sightings == 1
    assert "debouncing" in p.reason


def test_two_advertisements_clear_the_debounce():
    p = P.observe(P.observe(None, seen_at=100.0, now=100.0), seen_at=101.0, now=101.0)
    assert p.state is S.PRESENT and p.sightings == 2


def test_nothing_ever_seen_is_UNKNOWN_not_ABSENT():
    # A disabled or cold scanner must not manufacture a negative observation.
    p = P.observe(None, seen_at=None, now=500.0)
    assert p.state is S.UNKNOWN and "no observation to report" in p.reason


def test_a_short_RF_gap_is_TOLERATED_and_presence_holds():
    seen = P.observe(P.observe(None, seen_at=100.0, now=100.0), seen_at=101.0, now=101.0)
    p = P.observe(seen, seen_at=None, now=101.0 + P.ABSENT_AFTER_S - 1)
    assert p.state is S.PRESENT, "an RF gap inside the window must not read as departure"
    assert "tolerating the gap" in p.reason


def test_sustained_silence_becomes_ABSENT():
    seen = P.observe(P.observe(None, seen_at=100.0, now=100.0), seen_at=101.0, now=101.0)
    p = P.observe(seen, seen_at=None, now=101.0 + P.ABSENT_AFTER_S)
    assert p.state is S.ABSENT, ">= the window, not > — a boundary silence is silence"


def test_a_single_sighting_does_not_ERASE_a_prior_absence():
    absent = P.Presence(S.ABSENT, 0, 10.0, "")
    p = P.observe(absent, seen_at=200.0, now=200.0)
    assert p.state is S.ABSENT, "one frame must not flip a settled absence; the debounce is symmetric here"


# ── §3 the axes stay independent ─────────────────────────────────────────────
def test_the_presence_vocabulary_is_DISJOINT_from_the_other_two_axes():
    import oxy_lifecycle as L
    pres = {s.value for s in S}
    link = {s.value for s in L.OxyState}
    rec = {s.value for s in L.OxyRecState}
    assert not (pres & link), "an axis-blind journal reader must not confuse presence with the link"
    assert not (pres & rec)
    # The specific trap this ruling exists for: NOT_SEEN is a LINK state and reads like absence.
    assert L.OxyState.NOT_SEEN.value not in pres


# ── §6/§11 the connection budget: mostly refusals ────────────────────────────
PRESENT = P.Presence(S.PRESENT, 2, 100.0, "")


def _plan(**kw):
    base = dict(armed=True, presence=PRESENT, rec_state=None, last_probe_at=None, now=1000.0)
    return P.probe_justified(**{**base, **kw})


def test_an_unarmed_system_refuses_FIRST_and_blames_the_flag_not_the_ring():
    r = _plan(armed=False, presence=None)
    assert r.action == P.SKIP and r.reason == "presence trigger not armed", (
        "an unarmed system reporting 'not present' would read as a device fault")


def test_UNKNOWN_presence_must_NOT_probe():
    # The sharp edge of "presence is an OBSERVATION": UNKNOWN means we have not looked. Probing on it
    # makes a cold scanner indistinguishable from a sighting — a connection storm.
    r = _plan(presence=P.Presence(S.UNKNOWN, 0, None, ""))
    assert r.action == P.SKIP and "pres_unknown" in r.reason


def test_a_RECORDING_ring_is_observed_never_probed():
    r = _plan(rec_state="recording")
    assert r.action == P.SKIP and "do not probe" in r.reason


def test_the_rate_limit_holds_and_says_how_long_is_left():
    r = _plan(last_probe_at=900.0)
    assert r.action == P.SKIP and "200s to go" in r.reason


def test_present_not_recording_and_past_the_interval_justifies_ONE_connection():
    assert _plan(last_probe_at=600.0).action == P.CONNECT


# ── §11/§12 inside the one link ─────────────────────────────────────────────
# The `connection_plan` tests that lived here are DELETED with the function. It duplicated
# `oxy_transfer.close_harvest_decision`'s composition and was unwired — see the note in
# `oxy_presence.py`. The behaviour those tests pinned (deadline before flush state, a ready file not
# buying time the drop window lacks) is already pinned by `close_harvest_decision`'s own suite against
# the same two predicates, so deleting them removes duplication, not coverage.

# ── §20/§21 enabled vs armed ─────────────────────────────────────────────────
def test_absent_config_defaults_OFF_and_says_it_never_inherits():
    a = P.arming({})
    assert (a.enabled, a.armed) == (False, False) and "never inherits" in a.reason


def test_an_explicit_false_reads_differently_from_an_absent_key():
    a = P.arming({"o2ring": {"presence_harvest": {"enabled": False}}})
    assert a.reason == "o2ring.presence_harvest.enabled=False"


def test_ENABLED_BUT_NOT_ARMED_is_a_real_state_and_names_the_missing_measurement():
    # The whole point of splitting the two: §2's matrix has not run, so the scanner ships COLD.
    a = P.arming({"o2ring": {"presence_harvest": {"enabled": True}}})
    assert a.enabled is True and a.armed is False
    assert "coexistence matrix has not been run" in a.reason


def test_armed_only_once_the_coexistence_verdict_is_recorded():
    a = P.arming({"o2ring": {"presence_harvest": {"enabled": True,
                                                  P.COEXISTENCE_KEY: True}}})
    assert a.armed is True


# ── §19 the execution witness ────────────────────────────────────────────────
def test_an_empty_chain_stops_at_the_FIRST_link_not_the_last():
    c = P.witness_chain({})
    assert c["stops_at"] == "enabled" and c["reached"] == 0


def test_a_complete_chain_is_the_ONLY_way_to_read_complete():
    c = P.witness_chain({k: 1.0 for k in P.WITNESS_LINKS})
    assert c["stops_at"] is None and c["reached"] == len(P.WITNESS_LINKS)
    assert P.witness_summary(c) == "complete (10/10)"


def test_the_chain_NAMES_where_it_stops():
    """§19's whole design. Ten nullable fields where the seventh is empty reads as healthy to anyone
    not counting — and that is the same act of attention that missed the original defect (a path that
    armed 0 times against 312 poller lines). One field, in words, instead."""
    stamps = {k: 1.0 for k in P.WITNESS_LINKS[:3]}
    c = P.witness_chain(stamps)
    assert c["stops_at"] == "probe_attempted"
    assert P.witness_summary(c) == "stops at probe_attempted (3/10)"


def test_reached_counts_the_UNBROKEN_PREFIX_not_the_non_empty_links():
    """A later link stamped while an earlier one is empty is not progress — it is evidence the chain
    is being written out of order. Counting it would let a hole be filled from downstream."""
    c = P.witness_chain({"enabled": 1.0, "artifact_committed": 9.0})
    assert c["reached"] == 1, "8 empty links sit between them"
    assert c["stops_at"] == "observer_armed"


def test_a_link_stamped_zero_still_counts_as_fired():
    """A monotonic clock can legitimately read 0.0. Testing `if not stamp` instead of `is None` would
    make the very first observation of a freshly-booted host read as never-happened."""
    stamps = {k: 0.0 for k in P.WITNESS_LINKS}
    assert P.witness_chain(stamps)["stops_at"] is None
