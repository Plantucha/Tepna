# tepna-capture — tests/test_monitor_eeg_lanes.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The EEG card and the scope draw one lane per electrode.

The Muse electrodes rest at different offsets, and one of them can sit at a rail. On one shared scale the
other three traces were flat lines of one colour, and the scope showed the left ear alone. These tests run
the shipped JavaScript over a canvas that records its calls, as `test_monitor_kind_foot.py` does.
"""

import json
import os
import shutil
import subprocess

import pytest

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_LABELS = ["left-ear", "left-forehead", "right-forehead", "right-ear"]
_EEG = {"key": "eeg_TEST0001", "chans": 4, "labels": _LABELS}

_CTX = """
const calls=[]; let path=null;
const ctx={ set strokeStyle(v){ this._s=v; }, get strokeStyle(){ return this._s; }, lineWidth:0, font:'', fillStyle:'',
  globalAlpha:1, setTransform(){}, clearRect(){}, setLineDash(){},
  beginPath(){ path=[]; }, moveTo(x,y){ path.push(['M',x,y]); }, lineTo(x,y){ path.push(['L',x,y]); },
  stroke(){ calls.push({color:this._s, width:this.lineWidth, path}); },
  fillText(t,x,y){ calls.push({text:t, color:this.fillStyle, x, y, align:this.textAlign}); } };
"""


def _src() -> str:
    return open(os.path.join(_HERE, "monitor.html"), encoding="utf-8").read()


def _fn(src: str, head: str) -> str:
    i = src.index(head)
    return src[i : src.index("\n}\n", i) + 3]


def _line(src: str, head: str) -> str:
    i = src.index(head)
    return src[i : src.index("\n", i) + 1]


def _colors(src: str) -> str:
    i = src.index("const CH_COLORS")
    return src[i : src.index("};", i) + 3]


def _lib() -> str:
    src = _src()
    return (
        _line(src, "const isPpgKey")
        + _line(src, "const isEegKey")
        + _line(src, "const isAmbientChan")
        + _line(src, "const isLaneStream")
        + _colors(src)
        + _fn(src, "function chanColors(s){")
        + _fn(src, "function laneRange(data, ch){")
        + _fn(src, "function drawLanes(")
        + _fn(src, "function ovDrawMini(st, s){")
        + _line(src, "function scopeStream(){")
        + _fn(src, "function feed(v){")
        + _fn(src, "function draw(){")
    )


def _run(body: str):
    node = shutil.which("node")
    if not node:  # pragma: no cover - ubuntu-latest always has node; a dev box might not
        pytest.skip("node is not installed")
    r = subprocess.run([node, "-e", _CTX + _lib() + body], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


def _lanes(data, stream=_EEG, width=1.2, labels=False, h=400):
    return _run(
        "drawLanes(ctx,%s,%s,300,%d,%s,%s); console.log(JSON.stringify(calls));"
        % (json.dumps(data), json.dumps(stream), h, width, json.dumps(labels))
    )


def _traces(calls):
    return [c for c in calls if "path" in c and c["color"].startswith("#")]


def _ramp(n=101):
    """Four channels of one shape at four offsets; the last sits at the 14-bit rail."""
    return [[i, 5000 + i, 9000 + i, 16383] for i in range(n)]


def _scope(stream, values):
    """`feed` then one `draw` on the scope, with the page around them stubbed."""
    page = """
const devicePixelRatio=1, WINDOW_S=6, OV_WIN_S=5, STREAMS=[%s]; let VIEW='scope', scopeRaf=null, current=%s;
let buf=[], sig=[], lastVal=null, bpm=null, fs=256; const els={};
const document={documentElement:{}}; const getComputedStyle=()=>({getPropertyValue:()=>'#123456'});
const requestAnimationFrame=()=>1;
const canvas={clientWidth:300, clientHeight:400, getContext:()=>ctx};
const $=k=>k==='#scope'?canvas:(els[k]=els[k]||{});
"""
    return _run(
        page % (json.dumps(stream), json.dumps(stream["key"]))
        + "feed(%s); draw(); console.log(JSON.stringify({calls, els, n:buf.length, first:buf[0], sig}));"
        % json.dumps(values)
    )


# ── the colours ─────────────────────────────────────────────────────────────────────────────────────


def test_the_eeg_channels_have_four_different_colours():
    got = _run("console.log(JSON.stringify(chanColors(%s)));" % json.dumps(_EEG))
    assert len(got) == 4 and len(set(got)) == 4


def test_control_the_other_streams_keep_their_colours():
    got = _run(
        "console.log(JSON.stringify([{key:'acc_x',chans:3},{key:'ppi_x',chans:2},{key:'ecg',chans:1}].map(chanColors)));"
    )
    assert got == [["#FF6B7A", "#39D98A", "#58A6FF"], ["#3DE0D0", "#a78bfa"], None]


# ── which streams take lanes ────────────────────────────────────────────────────────────────────────


def test_only_a_multi_channel_eeg_stream_takes_lanes():
    got = _run(
        "console.log(JSON.stringify([%s,{key:'eeg',chans:4},{key:'eeg',chans:1},{key:'eeg'},{key:'acc_x',chans:3},"
        "{key:'ppg_x',chans:4}].map(isLaneStream)));" % json.dumps(_EEG)
    )
    assert got == [True, True, False, False, False, False]


# ── the scale of one channel ────────────────────────────────────────────────────────────────────────


def _range(data, ch=0):
    return _run("console.log(JSON.stringify(laneRange(%s,%d)));" % (json.dumps(data), ch))


def test_the_range_is_the_2nd_to_98th_percentile():
    assert _range([[i] for i in range(101)]) == [2, 98]


def test_one_electrode_pop_does_not_move_the_range():
    data = [[i] for i in range(101)]
    data[50] = [16383]
    assert _range(data)[1] <= 100


def test_the_range_reads_its_own_channel():
    assert _range(_ramp(), 1) == [5002, 5098]


def test_a_flat_channel_gets_a_range_around_its_value():
    assert _range(_ramp(), 3) == [16382, 16384]


def test_a_long_window_is_strided_to_at_most_256_values():
    got = _run(
        "let reads=0; const d=Array.from({length:1280},(_,i)=>({get 0(){ reads++; return i; }}));"
        "const r=laneRange(d,0); console.log(JSON.stringify([reads,r[0]<60,r[1]>1200]));"
    )
    assert got == [256, True, True]


def test_an_absent_value_carries_no_scale_and_an_absent_channel_has_none():
    assert _range([[None], None, [7], [9]]) == [7, 9]
    assert _range([[None], None]) is None


# ── the lanes ───────────────────────────────────────────────────────────────────────────────────────


def test_every_electrode_fills_its_own_lane():
    tr = _traces(_lanes(_ramp()))
    assert len(tr) == 4 and len({t["color"] for t in tr}) == 4
    for ch, t in enumerate(tr[:3]):
        ys = [p[2] for p in t["path"]]
        assert ys[2] == pytest.approx(ch * 100 + 90) and ys[98] == pytest.approx(ch * 100 + 10)
        assert ch * 100 <= min(ys) and max(ys) <= (ch + 1) * 100
    railed = {p[2] for p in tr[3]["path"]}
    assert len(railed) == 1 and 300 < railed.pop() < 400


def test_a_lane_rises_with_its_value_and_spans_the_width():
    p = _traces(_lanes(_ramp()))[0]["path"]
    assert p[0][2] > p[-1][2] and p[0][1] == 0 and p[-1][1] == 300


def test_a_value_outside_the_range_is_drawn_at_the_lane_edge():
    data = [[i, 0, 0, 0] for i in range(101)]
    data[50][0], data[60][0] = 16383, -16383
    ys = [p[2] for p in _traces(_lanes(data))[0]["path"]]
    assert ys[50] == pytest.approx(0) and ys[60] == pytest.approx(100)


def test_an_absent_sample_breaks_the_line():
    data = _ramp(11)
    data[5] = None
    data[8] = [None, 1, 2, 3]
    ops = [[p[0] for p in t["path"]] for t in _traces(_lanes(data))]
    assert ops[0] == list("MLLLLMLML") and ops[1] == list("MLLLLMLLLL")


def test_an_absent_channel_draws_no_trace_and_the_others_stay():
    tr = _traces(_lanes([[i, None, i, i] for i in range(11)]))
    assert len(tr) == 3


def test_separators_stand_between_the_lanes():
    calls = _lanes(_ramp())
    seps = [c["path"][0][2] for c in calls if "path" in c and not c["color"].startswith("#")]
    assert seps == [100, 200, 300]


def test_the_labels_name_the_electrode_and_its_last_value():
    texts = [c for c in _lanes(_ramp(), labels=True) if "text" in c]
    assert [t["text"] for t in texts] == [
        "left-ear  100",
        "left-forehead  5100",
        "right-forehead  9100",
        "right-ear  16383",
    ]
    assert [t["color"] for t in texts] == [t["color"] for t in _traces(_lanes(_ramp()))]
    assert [t["y"] for t in texts] == [4, 104, 204, 304]
    assert {(t["x"], t["align"]) for t in texts} == {(292, "right")}  # the readout covers the left side


def test_an_absent_last_value_reads_a_dash_and_an_unnamed_channel_its_number():
    data = [*_ramp(5), [None, 1, 2, 3]]
    texts = [c["text"] for c in _lanes(data, {"key": "eeg", "chans": 4}, labels=True) if "text" in c]
    assert texts == ["ch 1  —", "ch 2  1", "ch 3  2", "ch 4  3"]
    assert [c["text"] for c in _lanes([*_ramp(5), None], labels=True) if "text" in c][0] == "left-ear  —"


def test_control_the_card_draws_no_label():
    assert not [c for c in _lanes(_ramp()) if "text" in c]


# ── the call sites: the card and the scope ──────────────────────────────────────────────────────────


def _mini(stream, data):
    page = """
const devicePixelRatio=1, OV_WIN_S=5; const document={documentElement:{}};
const getComputedStyle=()=>({getPropertyValue:()=>'#123456'});
const streamState=()=>({trust:true}), deviceForStream=()=>null;
"""
    return _run(
        page + "ovDrawMini({canvas:{clientWidth:300,clientHeight:400,getContext:()=>ctx},buf:%s,fs:256},%s);"
        "console.log(JSON.stringify(calls));" % (json.dumps(data), json.dumps(stream))
    )


def test_the_card_draws_the_eeg_in_lanes():
    tr = _traces(_mini(_EEG, _ramp()))
    assert len(tr) == 4 and len({t["color"] for t in tr}) == 4
    assert max(p[2] for p in tr[0]["path"]) < 100 < min(p[2] for p in tr[1]["path"])


def test_control_the_card_keeps_one_scale_for_a_motion_stream():
    tr = _traces(_mini({"key": "acc_x", "chans": 3, "labels": ["x", "y", "z"]}, [[0, 0, 100], [0, 50, 100]]))
    assert len(tr) == 3
    assert tr[2]["path"][0][2] < tr[0]["path"][0][2]


def test_the_scope_draws_every_electrode_and_names_it():
    got = _scope(_EEG, _ramp())
    assert len(_traces(got["calls"])) == 4
    assert [c["text"].split("  ")[0] for c in got["calls"] if "text" in c] == _LABELS
    assert got["els"]["#roVal"]["textContent"] == "4 ch" and got["els"]["#roHr"]["textContent"] == ""
    assert got["n"] == 101 and got["first"] == [0, 5000, 9000, 16383]


def test_the_scope_window_is_still_bounded():
    assert _scope(_EEG, [[1, 2, 3, 4]] * 2000)["n"] == 6 * 256


def test_control_a_motion_scope_still_tracks_channel_0():
    got = _scope({"key": "acc_x", "chans": 3}, [[1, 9, 9], [2, 9, 9], [3, 9, 9]])
    assert len(_traces(got["calls"])) == 1 and got["sig"] == [1, 2, 3] and got["first"] == 1
    assert got["els"]["#roVal"]["textContent"] == "3.0"


def test_one_sample_draws_no_lane():
    assert not _traces(_scope(_EEG, [[1, 2, 3, 4]])["calls"])


def test_the_scope_note_says_where_the_channels_are_shown():
    src = _fn(_src(), "function pick(key){")
    assert "isLaneStream(m) ? 'the scope' : 'Overview'" in src
