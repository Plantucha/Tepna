# tepna-capture — tests/test_pymalloc_stats.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""CPython's arena figures on the daemon's mem line (row 2026-10-18-cap-net-admin-makes-the-daemon-
non-dumpable-so-smaps-is-root-only). The statistics text below is SYNTHETIC; its shape copies what
`_PyObject_DebugMallocStats` writes."""

import ctypes

import pytest

import capture
import pymalloc_stats

TEXT = """Small block threshold = 512, in 32 size classes.

class   size   num pools   blocks in use  avail blocks
-----   ----   ---------   -------------  ------------
    0     16           1             100           924

# arenas allocated total           =                  172
# arenas reclaimed                 =                  166
# arenas highwater mark            =                  172
# arenas allocated current         =                    6
6 arenas * 1048576 bytes/arena     =            6,291,456

# bytes in allocated blocks        =            2,799,664
# bytes in available blocks        =            3,000,000
Total                              =            6,291,456

Small block free lists:
Total                              =              655,360
"""


@pytest.fixture(autouse=True)
def _unresolved(monkeypatch):
    monkeypatch.setattr(pymalloc_stats, "_BOUND", None)
    monkeypatch.setattr(pymalloc_stats, "_REASON", None)
    monkeypatch.setattr(pymalloc_stats, "_TRIED", False)


def test_the_parse_reads_the_arena_block_and_its_own_total():
    assert pymalloc_stats.parse(TEXT) == {"arenas": 6, "held": 6291456, "live": 2799664}


def test_a_Total_before_the_arena_block_is_not_the_held_figure():
    early = "Total = 999\n" + TEXT.replace("Total                              =            6,291,456\n", "")
    assert pymalloc_stats.parse(early)["held"] == 655360
    assert pymalloc_stats.parse("Total = 999\n")["held"] is None


def test_an_absent_figure_is_None_never_zero():
    assert pymalloc_stats.parse("nothing here") == {"arenas": None, "held": None, "live": None}


class _Fn:
    def __init__(self, fn):
        self.fn, self.restype, self.argtypes = fn, None, None

    def __call__(self, *a):
        return self.fn(*a)


class _Lib:
    """A libc + libpython stand-in. `stats` writes `text` into the stream `open_memstream` opened."""

    def __init__(self, text=TEXT, rc=1, stream=1, raises=None, missing=()):
        self.freed, self.closed = [], []
        self._text, self._rc, self._stream, self._raises, self._missing = text, rc, stream, raises, missing
        self._buf = None

        def oms(pbuf, psize):
            if self._stream:
                self._buf = ctypes.create_string_buffer(self._text.encode())
                pbuf._obj.value = ctypes.addressof(self._buf)
                psize._obj.value = len(self._text)
            return self._stream

        def stats(_fh):
            if self._raises:
                raise self._raises
            return self._rc

        self.fns = {
            "open_memstream": _Fn(oms),
            "_PyObject_DebugMallocStats": _Fn(stats),
            "fclose": _Fn(lambda fh: self.closed.append(fh) or 0),
            "free": _Fn(lambda p: self.freed.append(p)),
        }

    def __getattr__(self, name):
        if name in self._missing:
            raise AttributeError(name)
        return self.fns[name]


def _fake(monkeypatch, lib=None, dlopen_error=None):
    seen = []

    class _C:
        c_int, c_void_p, c_char_p, c_size_t = ctypes.c_int, ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t
        POINTER, byref, cast = ctypes.POINTER, ctypes.byref, ctypes.cast

        @staticmethod
        def string_at(p, n):
            return ctypes.string_at(p, n)

        @staticmethod
        def PyDLL(name):  # noqa: N802 — mirrors the ctypes name
            seen.append(name)
            if dlopen_error:
                raise dlopen_error
            return lib

    monkeypatch.setattr(pymalloc_stats, "ctypes", _C)
    return seen


def test_the_read_binds_through_PyDLL_and_frees_its_buffer(monkeypatch):
    lib = _Lib()
    assert _fake(monkeypatch, lib) == []
    out = pymalloc_stats.read()
    assert out == {"arenas": 6, "held": 6291456, "live": 2799664, "reason": None}
    assert len(lib.freed) == 1 and lib.closed == [1]


def test_the_resolution_happens_once_per_process(monkeypatch):
    seen = _fake(monkeypatch, _Lib())
    pymalloc_stats.read()
    pymalloc_stats.read()
    assert seen == [None]


def test_a_python_without_the_symbol_reads_null_with_a_reason(monkeypatch):
    _fake(monkeypatch, _Lib(missing=("_PyObject_DebugMallocStats",)))
    out = pymalloc_stats.read()
    assert out["arenas"] is None and out["reason"] == "pymalloc stats unavailable: AttributeError"


def test_a_platform_that_cannot_dlopen_itself_reads_null_with_a_reason(monkeypatch):
    _fake(monkeypatch, dlopen_error=OSError("no"))
    assert pymalloc_stats.read()["reason"] == "pymalloc stats unavailable: OSError"


def test_a_NULL_stream_is_a_reason_not_a_crash(monkeypatch):
    lib = _Lib(stream=0)
    _fake(monkeypatch, lib)
    out = pymalloc_stats.read()
    assert out["reason"] == "pymalloc stats: open_memstream returned NULL" and lib.freed == []


def test_rc_0_means_the_allocator_is_not_in_use_not_zero_arenas(monkeypatch):
    lib = _Lib(rc=0)
    _fake(monkeypatch, lib)
    out = pymalloc_stats.read()
    assert out["arenas"] is None and "not in use" in out["reason"] and len(lib.freed) == 1


def test_a_text_without_the_arena_block_names_itself(monkeypatch):
    _fake(monkeypatch, _Lib(text="Small block threshold = 512\n"))
    out = pymalloc_stats.read()
    assert out["arenas"] is None and out["reason"] == "pymalloc stats: no arena block in the text"


def test_a_call_that_raises_keeps_the_status_loop_alive(monkeypatch):
    lib = _Lib(raises=RuntimeError("boom"))
    _fake(monkeypatch, lib)
    assert pymalloc_stats.read()["reason"] == "pymalloc stats call failed: RuntimeError"
    assert len(lib.freed) == 1


def test_an_empty_stream_buffer_parses_as_absent(monkeypatch):
    lib = _Lib()
    _fake(monkeypatch, lib)
    monkeypatch.setattr(pymalloc_stats.ctypes, "cast", lambda p, t: p)
    real_oms = lib.fns["open_memstream"].fn
    lib.fns["open_memstream"] = _Fn(lambda pbuf, psize: 1)
    assert real_oms  # the stand-in above left the buffer NULL
    out = pymalloc_stats.read()
    assert out["reason"] == "pymalloc stats: no arena block in the text" and lib.freed == []


def test_the_REAL_interpreter_answers_or_names_its_absence():
    out = pymalloc_stats.read()
    if out["reason"] is None:
        assert out["arenas"] > 0 and out["held"] >= out["live"] > 0
        assert out["held"] % out["arenas"] == 0
    else:
        assert out["arenas"] is None


# ── the mem line ─────────────────────────────────────────────────────────────────────────────────
SNAP = {
    "rss_kb": {"VmRSS": 1000, "RssAnon": 900, "VmSwap": 0},
    "mallinfo2": {"reason": None},
    "arenas": {"reason": None},
    "gc": {"counts": [1, 0, 0], "collections": [0, 1, 0]},
}


def test_the_line_carries_the_arenas_in_kB():
    line = capture.mem_log_line(SNAP, pymalloc={"arenas": 6, "held": 6291456, "live": 2799664, "reason": None})
    assert line.endswith(" · pymalloc arenas 6 held 6144 kB live 2734 kB")


def test_an_unmeasured_allocator_prints_null_and_its_reason():
    line = capture.mem_log_line(SNAP, pymalloc={"arenas": None, "held": None, "live": None, "reason": "why"})
    assert " · pymalloc arenas null held null kB live null kB · why" in line


def test_a_caller_that_passes_none_gets_no_segment():
    assert "pymalloc" not in capture.mem_log_line(SNAP)
