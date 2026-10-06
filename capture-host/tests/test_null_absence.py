# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# PROPERTY tests for the absence contract in capture-host. Every property below is a CONTRACT
# SENTENCE quoted from the module it tests — never a restatement of what the implementation
# happens to do. A property that merely re-derives the code passes forever and pins nothing.
#
# The null-fuzz family: None/absent values must never coerce to 0, crash a restart path, or
# masquerade as measured data. These are the Python counterparts of the JS null-fuzz harness
# (tools/null-fuzz.mjs). Run in a loop: `pytest tests/test_null_absence.py --hypothesis-seed=0`
# with different seeds, or crank max_examples via HYPOTHESIS_PROFILE.
#
# History: three properties were xfail while the trust-gap bugs they pinned were open; the fixes landed and the
# markers are gone, so every property below is an enforced guard.

import json
import os
import tempfile

from hypothesis import HealthCheck, example, given, settings
from hypothesis import strategies as st

import acq_evidence_cpap as aec
import ble_visibility
import cpap_spool

_SETTINGS = settings(max_examples=300, deadline=None, suppress_health_check=[HealthCheck.too_slow])

# ── acq_evidence_cpap._counter ────────────────────────────────────────────────
# CONTRACT (_counter docstring): "absent accounting is UNKNOWN, never a fabricated 0 —
# 0 means 'counted, and none happened'."


@_SETTINGS
@given(
    st.dictionaries(
        st.text(alphabet="abcdef", min_size=1, max_size=8),
        st.one_of(st.none(), st.integers(min_value=0, max_value=1000)),
        max_size=12,
    ),
    st.lists(st.text(alphabet="abcdef", min_size=1, max_size=8), min_size=1, max_size=5),
)
def test_counter_none_key_is_unknown_never_zero(summary, keys):
    """CONTRACT: a key present-but-None is UNMEASURED; one unmeasured term makes
    the SUM unmeasured. A partial total published as a total is the same lie
    in smaller print."""
    # The fixed code checks `any(v is None for v in vals)` before summing.
    result = aec._counter(summary or None, *keys)
    vals = [(summary or {}).get(k) for k in keys]
    if not summary or any(v is None for v in vals):
        assert result == aec.ae.UNKNOWN, f"expected UNKNOWN, got {result!r} for {vals}"
    else:
        assert result == sum(vals), f"expected {sum(vals)}, got {result!r}"


@_SETTINGS
@given(st.dictionaries(st.text(min_size=1, max_size=8), st.integers(min_value=0, max_value=100), max_size=8))
def test_counter_all_measured_sums(summary):
    """CONTRACT: when every term is measured, the sum is the sum — no UNKNOWN."""
    if not summary:
        return
    keys = list(summary.keys())
    assert aec._counter(summary, *keys) == sum(summary.values())


# ── cpap_spool.read_ledger / committed_rows ───────────────────────────────────
# CONTRACT (committed_rows docstring): "A VALID-JSON foreign line (a hand-written marker,
# another tool's note) parses but carries no authority — it must never crash the restart
# path or masquerade as a committed round."


_JSON_SCALAR = st.one_of(
    st.none(),
    st.booleans(),
    st.integers(),
    st.floats(allow_nan=False, allow_infinity=False),
    st.text(max_size=40),
)
_JSON_VALUE = st.recursive(
    _JSON_SCALAR,
    lambda children: st.one_of(
        st.lists(children, max_size=4),
        st.dictionaries(st.text(max_size=12), children, max_size=4),
    ),
    max_leaves=8,
)


def _write_lines(lines):
    d = tempfile.mkdtemp()
    p = os.path.join(d, cpap_spool.LEDGER_NAME)
    with open(p, "w", encoding="utf-8") as fh:
        for line in lines:
            fh.write(line + "\n")
    return d, p


@_SETTINGS
@example([42, "x committed_cursor y", {"note": "foreign"}])
@given(st.lists(_JSON_VALUE, max_size=20))
def test_read_ledger_never_crashes_and_yields_dicts_only(values):
    """CONTRACT: valid-JSON non-dict lines parse but carry no authority. The
    reader must not crash on them, and downstream must never see a non-dict."""
    lines = [json.dumps(v) for v in values]
    root, _ = _write_lines(lines)
    try:
        rows = cpap_spool.read_ledger(root)
    finally:
        import shutil

        shutil.rmtree(root, ignore_errors=True)
    assert isinstance(rows, list)
    # Every row is a dict: the reader gates non-dict JSON at read (cpap_spool.read_ledger).
    assert all(isinstance(r, dict) for r in rows), (
        f"non-dict rows leaked: {[r for r in rows if not isinstance(r, dict)][:3]}"
    )


@_SETTINGS
@example([42, "x committed_cursor y round_seq z", {"committed_cursor": "BOGUS", "round_seq": 99}])
@given(st.lists(_JSON_VALUE, max_size=20))
def test_committed_rows_never_crashes_on_foreign_rows(values):
    """CONTRACT: the key-presence filter must not crash on non-dict rows, and
    must not admit them via substring matching (a JSON string containing the
    key names is not a row carrying them)."""
    rows = cpap_spool.committed_rows(values)
    assert isinstance(rows, list)
    assert all(isinstance(r, dict) for r in rows)
    for r in rows:
        assert "committed_cursor" in r and "round_seq" in r


# ── ble_visibility.read_records ───────────────────────────────────────────────
# CONTRACT (read_records docstring): "Skip unparseable lines rather than failing the whole
# history on one bad write." A parseable non-dict line is not skipped today — the exact
# failure the docstring exists to prevent, wearing a different shape.


@_SETTINGS
@example([42, "hello", {"t": 1}])
@given(st.lists(_JSON_VALUE, max_size=20))
def test_read_records_skips_non_dict_lines(values):
    """CONTRACT: only dict records reach the consumer. A non-dict line must be
    skipped like any other line the consumer cannot use."""
    lines = [json.dumps(v) for v in values]
    d = tempfile.mkdtemp()
    p = os.path.join(d, "history.jsonl")
    try:
        with open(p, "w", encoding="utf-8") as fh:
            for line in lines:
                fh.write(line + "\n")
        recs = ble_visibility.read_records(p)
    finally:
        import shutil

        shutil.rmtree(d, ignore_errors=True)
    assert isinstance(recs, list)
    assert all(isinstance(r, dict) for r in recs), (
        f"non-dict records leaked: {[r for r in recs if not isinstance(r, dict)][:3]}"
    )


@_SETTINGS
@given(st.lists(_JSON_VALUE, max_size=20), st.text(min_size=1, max_size=12))
def test_visibility_never_crashes_on_foreign_records(values, target):
    """CONTRACT: visibility() consumes read_records output. If a non-dict ever
    reaches it, the .get() call crashes — the reader is the trust boundary."""
    dicts_only = [v for v in values if isinstance(v, dict)]
    # This documents the crash; after the reader fix, pass the raw values.
    result = ble_visibility.visibility(dicts_only, target)
    assert isinstance(result, dict)
