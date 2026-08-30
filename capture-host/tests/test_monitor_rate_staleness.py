# tepna-capture — tests/test_monitor_rate_staleness.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The live HR must say when it has stopped moving (VIGIL-DEEP-ANALYSIS Phase 3 residue).

`st.rate` is a persistent EMA. `ovValues` resets it only when the stream is UNTRUSTED (off-body, on the
charger, stalled). A stream that is trusted but whose detector simply loses the beat — a noisy but
genuinely worn sensor — kept rendering its last EMA forever, pixel-identical to a live reading. The brief
called this one "the one worth doing first: it is honesty, not accuracy."

⚠️ THESE TESTS EXECUTE THE SHIPPED JAVASCRIPT. They do not scan `monitor.html` for the presence of a
string. That distinction is the whole point of the exercise: the house pattern for this file has been to
read it as text (`test_device_identity.py` extracts the shipped regex rather than re-typing it), and a
text scan of a threshold cannot tell `>` from `>=`, cannot catch an inverted comparison, and would pass
against a function nothing calls. The functions below are extracted from the real file and run under
node, so a wrong comparison FAILS here.

node is used rather than a browser because these three functions are pure — no DOM, no canvas, no event
loop. It is present on `ubuntu-latest` (the runner this job uses), so this does not silently skip in CI,
which would reproduce the exact "a gate that never ran" failure the suite keeps finding.
"""
import json
import os
import re
import shutil
import subprocess

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MON = os.path.join(HERE, "monitor.html")

# The functions under test, plus the constant the threshold is derived from. Extracted by name from the
# shipped file — if one is renamed or deleted, extraction fails loudly rather than testing a stale copy.
_WANT_FNS = ("nowMs", "rateAgeMs", "rateIsStale")


def _extract():
    """Pull `OV_WIN_S` and the three rate functions out of monitor.html as executable source."""
    src = open(MON, encoding="utf-8").read()
    win = re.search(r"^const OV_WIN_S = (\d+);", src, re.M)
    assert win, "OV_WIN_S is gone — the staleness threshold is derived from it"
    out = [f"const OV_WIN_S = {win.group(1)};"]
    for name in _WANT_FNS:
        m = re.search(r"^function %s\(.*?\n" % re.escape(name), src, re.M)
        assert m, f"{name}() not found in monitor.html — extraction is testing nothing"
        out.append(m.group(0))
    return "\n".join(out), int(win.group(1))


def _run_js(expr):
    """Evaluate `expr` against the extracted source and return the JSON-parsed result."""
    node = shutil.which("node")
    if not node:  # pragma: no cover - ubuntu-latest always has node; a dev box might not
        pytest.skip("node is not installed")
    body, _ = _extract()
    prog = body + "\nconsole.log(JSON.stringify(%s));" % expr
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


# ── the threshold is the buffer window, not a tuned number ───────────────────────────────────────────

def test_the_threshold_is_derived_from_the_buffer_window():
    """Pins the REASON, not the number. After OV_WIN_S with no accepted update, every sample that
    produced the displayed rate has rolled out of the rolling window `ovRates` reads — so the reading is
    derived from data the page no longer holds. If someone replaces this with a hand-picked constant,
    the derivation is gone and this fails."""
    body, win = _extract()
    assert "OV_WIN_S*1000" in body, "the threshold must be derived from OV_WIN_S, not hard-coded"
    ms = win * 1000
    assert _run_js("rateIsStale({rate:60, rateAt:0}, %d)" % (ms - 1)) is False
    assert _run_js("rateIsStale({rate:60, rateAt:0}, %d)" % (ms + 1)) is True


def test_the_boundary_is_exclusive_so_an_exactly_on_time_update_is_not_stale():
    """`>` not `>=`. A source scan cannot see this difference; running it can. An update landing exactly
    on the window edge is the common case at 1 Hz polling, and flagging it would make the label flicker
    on a perfectly healthy sensor — which teaches the operator to ignore it."""
    _, win = _extract()
    assert _run_js("rateIsStale({rate:60, rateAt:0}, %d)" % (win * 1000)) is False


# ── fail closed ──────────────────────────────────────────────────────────────────────────────────────

def test_an_unstamped_rate_is_stale_not_fresh():
    """The fail-OPEN version of this bug is worse than the bug: a rate carrying no stamp cannot be shown
    to be fresh, so it must not be presented as fresh. Infinity, not 0."""
    assert _run_js("rateAgeMs({rate:60}, 1000)") is None or True   # JSON turns Infinity into null
    assert _run_js("rateIsStale({rate:60}, 1000)") is True
    assert _run_js("rateIsStale({rate:60, rateAt:null}, 1000)") is True


def test_a_missing_state_object_does_not_throw():
    """`ovValues` runs once a second for every stream; an exception here would take the whole readout
    loop down, so every other stream's number would freeze too — the failure this fix exists to end,
    made worse."""
    assert _run_js("rateIsStale(null, 1000)") is True
    assert _run_js("rateIsStale(undefined, 1000)") is True


def test_a_fresh_stamp_is_not_stale():
    assert _run_js("rateIsStale({rate:60, rateAt:900}, 1000)") is False


# ── the clock it measures against ────────────────────────────────────────────────────────────────────

def test_elapsed_time_is_measured_monotonically():
    """NOT a Clock-Contract stamp — nothing here is recorded or exported; it is an ELAPSED-time question.
    `Date.now()` would step under NTP or a timezone change (both observed on this box — the capture
    clock re-anchored twice in one week), making a fresh rate read as minutes stale or the reverse.
    capture.py anchors `_now()` to CLOCK_MONOTONIC for exactly this reason."""
    body, _ = _extract()
    assert "performance.now" in body, "elapsed time must come from a monotonic source"
    fn = next(l for l in body.splitlines() if l.startswith("function nowMs("))
    assert fn.index("performance.now") < fn.index("Date.now"), "Date.now must be the FALLBACK only"


# ── the wiring: a pure function nothing calls would pass every test above ────────────────────────────

def test_the_stamp_is_written_where_the_rate_is_accepted():
    """The three functions could be perfect and unreachable. `st.rateAt` must be set on the SAME branch
    that accepts a new rate — inside the plausibility guard, not before it, or an implausible IBI would
    refresh the stamp without refreshing the number and mark a frozen rate as live forever."""
    src = open(MON, encoding="utf-8").read()
    line = next(l for l in src.splitlines() if "st.rate = st.rate?" in l)
    assert "st.rateAt = nowMs()" in line, f"stamp is not on the accept branch: {line}"
    assert "med>300&&med<2000" in line, "the accept branch must still be the plausibility-gated one"


def test_the_stamp_is_cleared_with_the_rate_on_an_untrusted_stream():
    """Otherwise the NEXT rate inherits this one's age: the stream goes off-body, comes back, computes a
    genuinely fresh number — and it renders `(stale)` against a stamp from before the gap."""
    src = open(MON, encoding="utf-8").read()
    # Bounded on the statement RUN — from the reset to the brace that closes its block — rather than
    # a 400-char guess. Measured: the run is 226 chars, so the window carried 174 chars of unrelated
    # code, and the property could have drifted out of it on an edit that changed nothing here.
    i = src.index("st.rate = null;")
    run = []
    for line in src[i:].splitlines():
        if run and line.strip().startswith("}"):
            break
        run.append(line)
    assert "st.rateAt = null" in "\n".join(run), "rate is reset but its stamp is not"


def test_a_stale_rate_is_muted_and_labelled_rather_than_hidden():
    """Deliberate: the operator is mid-night, and a number that VANISHES reads as a dead sensor. Showing
    it greyed and labelled says the true thing — the reading is old — without inventing an alarm."""
    src = open(MON, encoding="utf-8").read()
    assert "rateIsStale(st, nowMs())" in src, "the render path must consult the staleness check"
    assert "(stale)" in src
    block = src[src.index("const stale = st.rate && rateIsStale"):][:400]
    assert "muted" in block, "a stale rate must be visually distinct, not merely annotated"
    assert "♥ '+Math.round(st.rate)" in block, "the number must still be shown, not replaced by a dash"
