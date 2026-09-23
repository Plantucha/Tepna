# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The ring's ACC must be RECORDED, not only displayed.

`bf68b959` made the O2Ring's 3-axis ACC reachable and drew it a card. It pushed to the bus and
registered a stream — and no writer existed, so the data lived in the browser and nowhere else. Every
other stream on this box has a writer; that one had none, and nothing noticed because the DISPLAY path
was complete and a complete display is what a reviewer looks at.

These are source scans. The defect is an ABSENT CALL: with no writer wired, capture runs, the card
paints, the daemon logs nothing, and the only symptom is a file that does not exist. There is no
runtime state to assert on that differs between the broken and fixed versions short of running a real
BLE session against hardware.
"""
from __future__ import annotations
import re

from _srcscan import module_source

# ⚠️ THROUGH `_srcscan.module_source`, NEVER `read_text`. mutmut 3 generates ONE module holding every
# mutant inline, so a raw scan sees hundreds of copies of every line and the module reports "failed to
# collect stats" — which looks like a broken environment and silently means it is never measured at
# all. `test_mutation_hygiene` enforces this and caught this file's first draft in CI.
#
# The routing is the load-bearing part: `module_source` SKIPS when handed a generated file, so none of
# these assertions ever runs against inlined mutants. That matters because one of them below is a
# `not in` — a shape the helper's own notes call out as breaking when applied to whole module source,
# since mutmut generates the forbidden string as a mutation. Here it is applied to a single captured
# header value rather than to the module, and the skip means it never meets a mutant either way.
CAP = module_source("capture.py")
WRI = module_source("writers.py")


def test_the_acc_push_is_accompanied_by_a_write():
    """A BUS.push with no writer beside it is a stream that exists until the page closes."""
    m = re.search(r'BUS\.push\("acc_o2".*?note_data', CAP, re.S)
    assert m, "the acc_o2 push site has moved — re-read this test before trusting it"
    assert "accrawwr.write_acc(" in m.group(0), (
        "acc_o2 is pushed to the bus but never written to disk — display-only data")


def test_the_writer_is_gated_on_the_same_key_as_the_push_bit():
    """`AUTO_RT_SWITCH` bit 3 is ORed in from `dev['streams']` containing 'acc'. If the WRITER were
    gated on anything else, the ring could be asked to push frames that are then dropped — airtime
    spent for nothing — or a writer could open for a stream that never arrives and leave an empty file
    that reads as a failed night."""
    m = re.search(r"accrawwr\s*=\s*\(StreamWriter\([^)]*\)\s*\n?\s*if\s+(.*?)\s+else\s+None", CAP, re.S)
    assert m, "the accrawwr construction has moved or was reshaped"
    assert '"acc" in (dev.get("streams") or [])' in m.group(1), (
        f"writer gate must match the push-bit gate exactly; got: {m.group(1)!r}")


def test_the_writer_is_closed_in_the_finally():
    """A writer absent from the close tuple leaks its handle AND loses whatever the StreamWriter had
    buffered but not flushed. The tuple is written out by hand, so adding a writer without adding it
    here is a silent partial-data bug — caught in review on this very change."""
    m = re.search(r"for _w in \(([^)]*)\):", CAP)
    assert m, "the writer-close loop has moved"
    assert "accrawwr" in m.group(1), (
        f"accrawwr is not closed in the finally — buffered rows are lost; tuple: {m.group(1)!r}")


def test_the_ring_acc_header_never_claims_a_calibrated_unit():
    """Polar publishes a scale so `acc` can say mg. Wellue publishes none and nothing here has been
    calibrated, so a mg column would be a number a reader multiplies wrongly. This is the one
    assertion that must survive someone 'tidying' the two ACC headers into one."""
    assert '"accraw"' in WRI, "the ring's ACC stream key is gone"
    hdr = re.search(r'"accraw":\s*"([^"]+)"', WRI)
    assert hdr, "accraw header not found"
    assert "[raw]" in hdr.group(1) and "[mg]" not in hdr.group(1), (
        f"the ring's ACC has no measured scale; header claims: {hdr.group(1)!r}")
