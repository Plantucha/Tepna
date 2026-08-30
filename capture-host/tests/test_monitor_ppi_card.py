# tepna-capture — tests/test_monitor_ppi_card.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The PPI card must name its two channels, and name them in the right order.

PPI is the only multi-channel stream whose readout drew two coloured lines and labelled neither. The
labels were never missing — `capture.py._LIVE_META` declares `("PP-int", "HR")`, `telemetry.py`
serialises them, and the browser already had them in `s.labels`. Nothing read them.

⚠️ THE ORDER IS THE PART THAT CAN SILENTLY BE WRONG, and it is genuinely counter-intuitive: the PMD
decoder's tuple is `(hr, pp_ms, err_ms, flags)` — HR FIRST — and `capture.py` deliberately REVERSES it
when pushing to the bus, so the wire shape is `[PP-int ms, HR]`. Read either half alone and you would
label the card backwards, which is worse than not labelling it: a wrong label is believed. So this
module pins the whole chain — decoder order, the reversing push, the declared labels, and the render —
rather than any one end of it.
"""
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MON = os.path.join(HERE, "monitor.html")
CAP = os.path.join(HERE, "capture.py")
PMD = os.path.join(HERE, "polar_pmd.py")


def _read(p):
    return open(p, encoding="utf-8").read()


# ── the chain, end to end ────────────────────────────────────────────────────────────────────────────

def test_the_decoder_tuple_is_hr_first():
    """The upstream fact everything else compensates for. If Polar's frame layout is ever re-read as
    `(pp_ms, hr, ...)`, the reversing push below becomes the bug rather than the fix."""
    src = _read(PMD)
    line = next(l for l in src.splitlines() if "ppi:(" in l.replace(" ", ""))
    assert re.search(r"ppi:\s*\(hr,\s*pp_ms", line.replace(" ", " ")), line


def test_the_bus_push_reverses_the_decoder_tuple():
    """`[s.values[1], s.values[0]]` — pp_ms first, hr second. This single expression is why the card's
    big number is an interval and not a heart rate."""
    src = _read(CAP)
    line = next(l for l in src.splitlines() if "BUS.push" in l and "PPI" not in l and "values[1]" in l)
    assert "s.values[1], s.values[0]" in line, line
    assert "[PP-int ms, HR]" in line, "the wire order must stay documented at the push site"


def test_the_declared_labels_match_the_wire_order():
    """The labels are only correct RELATIVE to the push above; asserting them alone would pass just as
    happily against a reversed card."""
    src = _read(CAP)
    line = next(l for l in src.splitlines() if l.strip().startswith('"ppi":'))
    assert '("PP-int", "HR")' in line, line
    assert line.index("PP-int") < line.index('"HR"'), "PP-int must be channel 0"


# ── the render ───────────────────────────────────────────────────────────────────────────────────────

def _ppi_branch():
    src = _read(MON)
    i = src.index("} else { // ppi: [PP-int ms, HR]")
    # BRACE-MATCHED, not a 1400-char guess. Measured: the branch is 1281 chars, so the old window
    # covered it with 119 chars to spare — it worked today and would have started slicing the branch
    # in half on any edit that grew it, with the failure landing on whichever assertion below happened
    # to sit past the edge rather than on the code that changed.
    depth, j = 0, src.index("{", i)
    for j in range(j, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                break
    return src[i:j + 1]


def test_the_card_reads_the_declared_labels_rather_than_hardcoding_them():
    """The point of the fix. A hardcoded "PP-int" string would look identical on screen and drift the
    moment _LIVE_META changes — the card must consume the same declaration the chart legend does."""
    b = _ppi_branch()
    assert "s.labels" in b, "the ppi branch must read the declared labels"
    assert "labs[0]" in b and "labs[1]" in b


def test_both_channels_are_labelled_in_wire_order():
    b = _ppi_branch()
    assert b.index("labs[0]") < b.index("labs[1]"), "channel 0 must render first"
    # channel 0 is the interval (ms), channel 1 is the rate (♥)
    seg0 = b[b.index("labs[0]"):b.index("labs[1]")]
    assert "ms" in seg0, "channel 0 must be presented as an interval in ms"
    assert "♥" in b[b.index("labs[1]") - 120:], "channel 1 must be presented as a heart rate"


def test_the_fallbacks_do_not_silently_swap_the_channels():
    """`labs[0]||'PP-int'` — if the declaration ever fails to arrive, the card must degrade to the SAME
    order, not to a guess. A fallback that disagreed with the wire order would be a wrong label that
    only appears on the days the metadata is missing, which is the worst possible time to be wrong."""
    b = _ppi_branch()
    assert "labs[0]||'PP-int'" in b.replace(" ", "")
    assert "labs[1]||'HR'" in b.replace(" ", "")


def test_each_value_is_colour_matched_to_its_own_trace():
    """cols[0] with channel 0, cols[1] with channel 1 — the legend is only useful if the mapping to the
    two lines is unambiguous."""
    b = _ppi_branch()
    assert "cols[0]" in b and "cols[1]" in b
    assert b.index("cols[0]") < b.index("cols[1]")


def test_colour_is_never_the_only_channel_cue():
    """House doctrine (the evidence-badge rule: shape, never hue) applied to a legend. Colour-coding
    alone would leave the card unreadable to anyone who cannot separate teal from violet — which is the
    same 'you have to guess which line is which' problem, merely restyled."""
    b = _ppi_branch()
    assert "esc(labs[0]" in b.replace(" ", "") and "esc(labs[1]" in b.replace(" ", ""), \
        "both channels need a TEXT label, not just a colour"


def test_the_labels_are_escaped():
    """They arrive over the wire from the daemon; every other label render in this file escapes."""
    b = _ppi_branch()
    assert b.count("esc(labs[") == 2


def test_a_missing_hr_still_renders_the_interval():
    """PPI frames carry an HR of 0 while the sensor settles (observed on the real box: `…;415;30;1;1;1;0`).
    The card must not blank the whole readout because one channel is absent."""
    b = _ppi_branch()
    assert "a[1]!=null?" in b.replace(" ", ""), "the HR half must be independently conditional"
    assert "a[0]!=null?" in b.replace(" ", "")
