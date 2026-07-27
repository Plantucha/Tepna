# tepna-capture — tests/test_deploy_ezparse.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `deploy/ezparse.py` is the Phase-1 ez Share listing parser that CPAP-AUTOHARVEST-2026-07-26-BRIEF §1.2
# points readers at as "a working regex". It is a FORK of what shipped as `cpap_harvest.parse_listing`,
# and the two have already drifted once in the direction that matters (CAPTURE-HOST-DEEP-AUDIT §E3: the
# `G` size suffix was accepted by the regex and dropped by the consumer). So the test that earns its keep
# here is not "does the prototype parse" — it is PARITY with the shipped parser, because a brief that
# tells the next reader to copy this regex is only safe while this regex still matches production.
#
# It also had zero tests AND was invisible to the coverage number: coverage's unexecuted-file scan only
# descends into importable subdirectories, and `deploy/` has no `__init__.py`, so an untested file read
# as no coverage debt at all. See the `source = [".", "deploy"]` note in pyproject.toml.

import importlib.util
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import cpap_harvest as ch  # noqa: E402

_EZ = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "deploy", "ezparse.py")


def _load():
    """Load deploy/ezparse.py by path — deploy/ is a script directory, not an importable package."""
    spec = importlib.util.spec_from_file_location("ezparse", _EZ)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ez = _load()

# Verbatim from the real card (night 20260725), same bytes as tests/test_cpap_harvest.py. The leading
# spaces and the split date/time (`2026- 7-26`, `3:50:50`) are exactly as served, and they are precisely
# what a naive parser mis-handles.
NIGHT_HTML = """
   2026- 7-25   17: 0: 0         &lt;DIR&gt;   <a href="dir?dir=A:%5CDATALOG%5C20260725"> .</a>
   2026- 7-25   17: 0: 0         &lt;DIR&gt;   <a href="dir?dir=A:%5CDATALOG"> ..</a>
   2026- 7-26    3:50:50           1KB  <a href="http://192.168.4.1/download?file=D%5C202607~1.EDF"> 20260725_225050_CSL.edf</a>
   2026- 7-26    6:42:26           2KB  <a href="http://192.168.4.1/download?file=D%5C202607~2.EDF"> 20260725_225050_EVE.edf</a>
   2026- 7-26   10:10:58        2229KB  <a href="http://192.168.4.1/download?file=D%5C202607~5.EDF"> 20260725_225058_BRP.edf</a>
   Total Entries: 7 Total Size: 2527KB
"""

ROOT_HTML = """
   2026- 7-26    3:50:50           1KB  <a href="http://192.168.4.1/download?file=JOURNAL.JNL"> JOURNAL.JNL</a>
   2026- 7-26   17: 0: 0         &lt;DIR&gt;   <a href="dir?dir=A:%5CDATALOG"> DATALOG</a>
   2026- 7-26    6:42:26         105KB  <a href="http://192.168.4.1/download?file=STR.EDF"> STR.EDF</a>
"""


def test_parses_the_real_card_listing_with_metadata_aligned():
    """Metadata PRECEDES the anchor on this card, so anchor-first parsing shifts every row by one — it
    looks plausible and is wrong. Pin the alignment on the row where it would show: BRP is the 2229KB
    file, not the 1KB one."""
    rows = ez.parse(NIGHT_HTML)
    assert [r["name"] for r in rows] == ["20260725_225050_CSL.edf", "20260725_225050_EVE.edf",
                                         "20260725_225058_BRP.edf"]
    brp = rows[-1]
    assert brp["size"] == "2229KB"
    assert brp["mtime"] == "2026-7-26 10:10:58"        # the served spaces are squeezed out
    # `html.unescape` on the href undoes HTML entities only — the `%5C` is URL escaping and is left for
    # the fetcher, exactly as the shipped parser leaves it.
    assert brp["href"] == "http://192.168.4.1/download?file=D%5C202607~5.EDF"
    assert brp["isdir"] is False
    # The `Total Entries: …` footer is not a row — it has no anchor, so it must not become a file.
    assert not any("Total" in r["name"] for r in rows)


def test_drops_the_dot_entries_but_keeps_real_directories():
    """`.` and `..` are the loop's only skip, and dropping them must not also drop DATALOG — the
    directory rows are how the walker finds the nights."""
    rows = ez.parse(NIGHT_HTML)
    assert not any(r["name"] in (".", "..") for r in rows)      # both dot rows were present in the input
    root = ez.parse(ROOT_HTML)
    datalog = next(r for r in root if r["name"] == "DATALOG")
    assert datalog["isdir"] is True and datalog["size"] == "<DIR>"


def test_no_rows_on_input_that_is_not_a_listing():
    """The loop's exit-without-a-single-iteration path: an error page or an empty body yields [], never
    a half-built row."""
    assert ez.parse("") == []
    assert ez.parse("<html><body>404 Not Found</body></html>") == []


def test_parity_with_the_shipped_cpap_harvest_parser():
    """THE reason this file exists. The brief points the next reader at this regex, so it must still
    agree with `cpap_harvest.parse_listing` — same rows, same fields, in the same order. Compared with
    the shipped parser's ignore list emptied, since dropping `ezshare.cfg` et al is a harvest policy
    that the prototype deliberately does not carry."""
    for html in (NIGHT_HTML, ROOT_HTML):
        assert ez.parse(html) == ch.parse_listing(html, ignore=())
