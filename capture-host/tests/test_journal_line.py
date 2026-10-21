# tepna-capture — tests/test_journal_line.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The journal line's grammar has ONE owner, so its zone arithmetic is pinned here.

Row `2026-10-20-ble-backoff-rate-is-drawn-as-a-level-not-a-curve`. `journal_line.stamp_of` was
extracted from `mem_series` when `ble_series` became the second reader of that line, and the
extraction put four mutants over the zone arithmetic on a diff for the first time. Every one of them
survived: both series modules read the daemon's own journal, which stamps `Z`, so no test had ever
asked what a positive zone with a two-digit hour and non-zero minutes does.

Clock Contract §1: `tMs` is the stamp's components encoded as if UTC, so it does NOT move with the
zone. The zone travels beside it as `offsetMin`, which is the only field a zone may change."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import journal_line  # noqa: E402

PREFIX, SUFFIX = "2026-01-02T03:04:05", " synthbox tepna-capture[7]: INFO ble: since last line "
AS_WRITTEN = 1767323045000  # Date.UTC(2026, 0, 2, 3, 4, 5) — the components, not an instant


def test_a_zone_moves_offsetMin_and_never_tMs():
    east = journal_line.stamp_of(PREFIX + "+10:30" + SUFFIX)
    west = journal_line.stamp_of(PREFIX + "-10:30" + SUFFIX)
    assert east["offsetMin"] == 630, "east of UTC is POSITIVE minutes, and the hour is two digits"
    assert west["offsetMin"] == -630, "the sign is the zone's own, read from its first character"
    assert east["tMs"] == west["tMs"] == AS_WRITTEN, "floating: the components are the truth"


def test_the_zone_reads_the_same_without_its_colon():
    assert journal_line.stamp_of(PREFIX + "+1030" + SUFFIX)["offsetMin"] == 630


def test_Z_is_zero_and_an_absent_zone_is_None():
    """`0` and `None` are different answers: one declared UTC, the other declared nothing (§∅)."""
    assert journal_line.stamp_of(PREFIX + "Z" + SUFFIX)["offsetMin"] == 0
    assert journal_line.stamp_of(PREFIX + SUFFIX)["offsetMin"] is None


def test_fractional_seconds_reach_tMs_with_either_separator():
    assert journal_line.stamp_of(PREFIX + ".250Z" + SUFFIX)["tMs"] == AS_WRITTEN + 250
    assert journal_line.stamp_of(PREFIX + ",250Z" + SUFFIX)["tMs"] == AS_WRITTEN + 250


def test_the_pid_is_the_identity_the_series_segments_on():
    assert journal_line.stamp_of(PREFIX + "Z" + SUFFIX)["pid"] == 7


def test_a_line_with_no_journal_prefix_is_None():
    assert journal_line.stamp_of("INFO ble: since last line backoff rate AA 1/h over 60 min") is None
    assert journal_line.stamp_of("2026-01-02T03:04:05Z synthbox tepna-capture: no pid here") is None
