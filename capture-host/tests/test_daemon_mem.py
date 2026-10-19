# tepna-capture — tests/test_daemon_mem.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Daemon-RSS part A: the status tick publishes RSS beside glibc's allocator accounting and the gc
counters, and the journal keeps the series.

The climb under investigation was measured from OUTSIDE the process (94 → 549 MB over one night, smooth
at ~+300 MB/6 h while streams record). From outside, memory Python freed and glibc kept is
indistinguishable from live objects, and `smaps` is root-only on the box. These are the three
populations that separate them, published from inside."""

import asyncio
import ctypes

import capture
from tests.test_capture_coverage_100 import _run, _stop_after


def _unresolved(monkeypatch):
    """Put the process-wide resolution back to its pre-first-call state."""
    monkeypatch.setattr(capture, "_MALLINFO2", None)
    monkeypatch.setattr(capture, "_MALLINFO2_REASON", None)
    monkeypatch.setattr(capture, "_MALLINFO2_TRIED", False)
    monkeypatch.setattr(capture, "_MALLOC_INFO", None)
    monkeypatch.setattr(capture, "_MALLOC_INFO_REASON", None)
    monkeypatch.setattr(capture, "_MALLOC_INFO_TRIED", False)


# ── mallinfo2 ────────────────────────────────────────────────────────────────────────────────────


def test_the_ten_fields_come_back_in_bytes_and_in_declaration_order(monkeypatch):
    """ctypes maps a struct BY POSITION, so the field tuple is the labelling. A fake libc returning a
    struct whose members are 0,1,2… proves each name sits where glibc puts it."""
    _unresolved(monkeypatch)
    probe = capture._Mallinfo2(*range(len(capture._MALLINFO2_FIELDS)))

    class _FakeCtypes:
        Structure = ctypes.Structure
        c_size_t = ctypes.c_size_t

        class PyDLL:
            def __init__(self, _name):
                pass

            def __getattr__(self, name):
                assert name == "mallinfo2"

                class _Fn:
                    restype = None
                    argtypes = None

                    def __call__(self):
                        return probe

                return _Fn()

    monkeypatch.setattr(capture, "ctypes", _FakeCtypes)
    out = capture.mallinfo2()
    assert out["reason"] is None
    assert [out[k] for k in capture._MALLINFO2_FIELDS] == list(range(10))
    assert capture._MALLINFO2_FIELDS[0] == "arena" and capture._MALLINFO2_FIELDS[8] == "fordblks"


def test_the_binding_goes_through_PyDLL_not_CDLL(monkeypatch):
    """The measured reason this matters (see `_resolve_mallinfo2`): a CDLL call releases the GIL and pays
    12–25 ms re-acquiring it under 8 churning threads, on a loop whose own latency is the open question.
    A fake whose CDLL raises makes the regression fail here rather than on the box."""
    _unresolved(monkeypatch)
    used = []

    class _FakeCtypes:
        Structure = ctypes.Structure
        c_size_t = ctypes.c_size_t

        @staticmethod
        def CDLL(_name):  # noqa: N802 — mirrors the ctypes name
            raise AssertionError("CDLL releases the GIL — the instrument must not")

        class PyDLL:
            def __init__(self, _name):
                used.append("PyDLL")

            def __getattr__(self, _name):
                class _Fn:
                    restype = None
                    argtypes = None

                    def __call__(self):
                        return capture._Mallinfo2()

                return _Fn()

    monkeypatch.setattr(capture, "ctypes", _FakeCtypes)
    capture.mallinfo2()
    assert used == ["PyDLL"]


def test_a_libc_without_the_symbol_reads_null_with_a_reason(monkeypatch):
    """§∅. musl, or glibc before 2.33. `mallinfo` is not a fallback: its fields are `int` and wrap at
    2 GB, which is inside this daemon's range."""
    _unresolved(monkeypatch)

    class _FakeCtypes:
        Structure = ctypes.Structure
        c_size_t = ctypes.c_size_t

        class PyDLL:
            def __init__(self, _name):
                pass

            def __getattr__(self, name):
                raise AttributeError(name)

    monkeypatch.setattr(capture, "ctypes", _FakeCtypes)
    out = capture.mallinfo2()
    assert out["reason"] == "mallinfo2 unavailable: AttributeError"
    assert all(out[k] is None for k in capture._MALLINFO2_FIELDS)


def test_a_platform_that_cannot_dlopen_itself_reads_null_with_a_reason(monkeypatch):
    _unresolved(monkeypatch)

    class _FakeCtypes:
        Structure = ctypes.Structure
        c_size_t = ctypes.c_size_t

        class PyDLL:
            def __init__(self, _name):
                raise OSError("cannot open self")

    monkeypatch.setattr(capture, "ctypes", _FakeCtypes)
    out = capture.mallinfo2()
    assert out["reason"] == "mallinfo2 unavailable: OSError"
    assert out["arena"] is None


def test_a_call_that_raises_reports_the_failure_and_keeps_the_loop_alive(monkeypatch):
    """An instrument never takes the status loop down, and a failed read is absence, not zero."""
    _unresolved(monkeypatch)

    def _boom():
        raise RuntimeError("struct mismatch")

    monkeypatch.setattr(capture, "_MALLINFO2", _boom)
    monkeypatch.setattr(capture, "_MALLINFO2_TRIED", True)
    out = capture.mallinfo2()
    assert out["reason"] == "mallinfo2 call failed: RuntimeError"
    assert all(out[k] is None for k in capture._MALLINFO2_FIELDS)


def test_the_resolution_happens_once_per_process(monkeypatch):
    """`_MALLINFO2_TRIED` is the latch: a box without the symbol must not pay a dlopen every 10 s."""
    _unresolved(monkeypatch)
    n = {"calls": 0}
    real = capture._resolve_mallinfo2

    def counted():
        n["calls"] += 1
        real()

    monkeypatch.setattr(capture, "_resolve_mallinfo2", counted)
    capture.mallinfo2()
    capture.mallinfo2()
    capture.mallinfo2()
    assert n["calls"] == 1


def test_the_real_libc_answers_or_names_its_absence():
    """The one test that runs against whatever libc the gate runs on. Either shape is correct; a third
    shape — fields present AND a reason, or every field 0 — is not."""
    out = capture.mallinfo2()
    if out["reason"] is None:
        assert out["arena"] is not None and out["uordblks"] > 0
        assert out["uordblks"] <= out["arena"] + out["hblkhd"], out
    else:
        assert "mallinfo2" in out["reason"]
        assert all(out[k] is None for k in capture._MALLINFO2_FIELDS)


# ── gc counters ──────────────────────────────────────────────────────────────────────────────────


def test_the_gc_counters_are_the_cheap_half(monkeypatch):
    """Not `gc_snapshot()`, whose durations exist only inside an armed probe window, and not
    `len(gc.get_objects())`, which materialises every tracked object on a 10 s loop."""
    monkeypatch.setattr(capture.gc, "get_count", lambda: (7, 3, 1))
    monkeypatch.setattr(
        capture.gc,
        "get_stats",
        lambda: [{"collections": 100}, {"collections": 9}, {"collections": 2}],
    )
    out = capture.gc_counters()
    assert out["counts"] == [7, 3, 1] and out["collections"] == [100, 9, 2] and out["enabled"] in (True, False)


def test_a_generation_cpython_does_not_report_is_null_not_zero(monkeypatch):
    """§∅. Zero collections and no answer are different facts."""
    monkeypatch.setattr(capture.gc, "get_stats", lambda: [{"collections": 4}])
    out = capture.gc_counters()
    assert out["collections"] == [4, None, None]


# ── every arena, not only the main one ───────────────────────────────────────────────────────────

#: Two heaps whose own `<total type="rest">` differs from the root's, so a parser reading the nested one
#: produces 111 and the correct one produces 777. The root also carries an `<aspace>` element this does
#: not read, and a `<total>` with no `size` attribute at all.
_TWO_HEAPS = b"""<malloc version="1">
<heap nr="0"><sizes/><total type="rest" count="1" size="111"/><system type="current" size="222"/></heap>
<heap nr="1"><sizes/><total type="rest" count="1" size="333"/><system type="current" size="444"/></heap>
<total type="fast" count="2" size="88"/>
<total type="rest" count="9" size="777"/>
<total type="mmap" count="2"/>
<system type="current" size="5000"/>
<system type="max" size="6000"/>
<aspace type="total" size="5000"/>
</malloc>"""


def test_the_totals_are_the_root_elements_not_a_heaps_own(monkeypatch):
    """🔴 THE defect this function exists to prevent. `<total type="rest">` appears inside EVERY heap and
    once at the root, with identical spelling. The root one is the across-arena sum; a nested one
    describes a single arena. Reading the first match gives one arena's figure labelled as the total."""
    out = capture.parse_malloc_info(_TWO_HEAPS)
    assert out["rest"] == 777 and out["heaps"] == 2
    assert out["fast"] == 88 and out["system_current"] == 5000 and out["system_max"] == 6000


def test_an_element_glibc_did_not_write_is_null_not_zero():
    """§∅, measured: glibc 2.43 writes NO root-level `<total type="fast">` at all on a single-arena
    process, and `<total type="mmap">` here carries no `size`. Both read `null`."""
    out = capture.parse_malloc_info(_TWO_HEAPS)
    assert out["mmap"] is None
    assert capture.parse_malloc_info(b'<malloc version="1"></malloc>') == {
        "heaps": 0,
        "fast": None,
        "rest": None,
        "mmap": None,
        "system_current": None,
        "system_max": None,
    }


def test_a_size_that_is_not_a_number_is_null_not_a_guess():
    """A non-numeric attribute is an absence, never `int()` on a hope."""
    out = capture.parse_malloc_info(b'<malloc><total type="rest" size="-1"/></malloc>')
    assert out["rest"] is None


def test_a_document_that_does_not_parse_reads_null_with_a_reason(monkeypatch):
    monkeypatch.setattr(capture, "malloc_info_xml", lambda: (b"<malloc>truncated", None))
    out = capture.malloc_arenas()
    assert all(out[k] is None for k in capture._ARENA_KEYS)
    assert out["reason"].startswith("malloc_info XML unparsable: ")


class _FakeStream:
    """A libc whose four symbols are scripted: `nul` makes `open_memstream` fail, `empty` leaves the
    buffer NULL, and `raises` makes the call itself throw. Every path records its `free` calls."""

    def __init__(self, mode="ok", xml=b"<malloc/>"):
        self.mode, self.xml, self.freed = mode, xml, []

    def _symbol(self, name):
        outer = self

        class _Fn:
            restype = None
            argtypes = None

            def __call__(self, *a):
                if name == "open_memstream":
                    if outer.mode == "nul":
                        return None
                    if outer.mode == "raises":
                        raise RuntimeError("scripted")
                    if outer.mode != "empty":
                        a[0]._obj.value = outer.xml
                        a[1]._obj.value = len(outer.xml)
                    return 7
                if name == "free":
                    outer.freed.append(a[0])
                return 0

        return _Fn()

    def __getattr__(self, name):
        return self._symbol(name)


def _fake_libc(monkeypatch, stream):
    class _FakeCtypes:
        c_void_p, c_int, c_char_p, c_size_t = (ctypes.c_void_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_size_t)
        byref, cast, string_at, POINTER = (ctypes.byref, ctypes.cast, ctypes.string_at, ctypes.POINTER)
        Structure = ctypes.Structure

        @staticmethod
        def CDLL(_name):  # noqa: N802 — mirrors the ctypes name
            raise AssertionError("CDLL releases the GIL — the instrument must not")

        @staticmethod
        def PyDLL(_name):  # noqa: N802 — mirrors the ctypes name
            return stream

    monkeypatch.setattr(capture, "ctypes", _FakeCtypes)


def test_the_arena_binding_also_goes_through_PyDLL(monkeypatch):
    """Same measurement as `mallinfo2`: a CDLL call releases the GIL and pays milliseconds re-acquiring
    it. `malloc_info` takes the SAME arena locks, so it gets the same binding."""
    _unresolved(monkeypatch)
    stream = _FakeStream(xml=_TWO_HEAPS)
    _fake_libc(monkeypatch, stream)
    out = capture.malloc_arenas()
    assert out["rest"] == 777 and out["reason"] is None


def test_the_buffer_is_freed_on_every_path_that_allocated_one(monkeypatch):
    """An instrument that leaked 4 kB a minute would become the thing it measures. `open_memstream`
    allocates with `malloc`, and nothing but `free` releases it."""
    _unresolved(monkeypatch)
    stream = _FakeStream(xml=_TWO_HEAPS)
    _fake_libc(monkeypatch, stream)
    capture.malloc_arenas()
    capture.malloc_arenas()
    assert len(stream.freed) == 2


def test_open_memstream_returning_NULL_is_a_reason_not_a_crash(monkeypatch):
    _unresolved(monkeypatch)
    _fake_libc(monkeypatch, _FakeStream(mode="nul"))
    out = capture.malloc_arenas()
    assert out["reason"] == "malloc_info: open_memstream returned NULL"
    assert all(out[k] is None for k in capture._ARENA_KEYS)


def test_a_stream_with_no_document_names_itself_rather_than_the_parser(monkeypatch):
    """The buffer stayed NULL with no error reported. There is nothing to parse, so the reason says so
    instead of handing `None` to the parser."""
    _unresolved(monkeypatch)
    _fake_libc(monkeypatch, _FakeStream(mode="empty"))
    out = capture.malloc_arenas()
    assert out["reason"] == "malloc_info: no document"


def test_a_call_that_raises_keeps_the_status_loop_alive(monkeypatch):
    _unresolved(monkeypatch)
    stream = _FakeStream(mode="raises")
    _fake_libc(monkeypatch, stream)
    out = capture.malloc_arenas()
    assert out["reason"] == "malloc_info call failed: RuntimeError"
    assert stream.freed == []  # nothing was allocated, so nothing is freed


def test_a_libc_without_malloc_info_reads_null_with_a_reason(monkeypatch):
    """§∅. The reason names the symbol, so a reader never has to guess which instrument went absent."""
    _unresolved(monkeypatch)

    class _NoSymbol:
        def __getattr__(self, name):
            raise AttributeError(name)

    _fake_libc(monkeypatch, _NoSymbol())
    assert capture.malloc_arenas()["reason"] == "malloc_info unavailable: AttributeError"


def test_a_platform_that_cannot_dlopen_itself_has_no_arena_view_either(monkeypatch):
    """The `mallinfo2` sibling of this test covers the same OSError on the other resolver — both are
    needed, because each caches its own reason and a reader must be told which view is absent."""
    _unresolved(monkeypatch)

    class _FakeCtypes:
        @staticmethod
        def PyDLL(_name):  # noqa: N802 — mirrors the ctypes name
            raise OSError("no self-dlopen")

    monkeypatch.setattr(capture, "ctypes", _FakeCtypes)
    assert capture.malloc_arenas()["reason"] == "malloc_info unavailable: OSError"


def test_the_arena_resolution_happens_once_per_process(monkeypatch):
    """One `PyDLL(None)` per process, not one per 10 s tick."""
    _unresolved(monkeypatch)
    n = {"calls": 0}
    real = capture._resolve_malloc_info

    def counted():
        n["calls"] += 1
        real()

    monkeypatch.setattr(capture, "_resolve_malloc_info", counted)
    capture.malloc_arenas()
    capture.malloc_arenas()
    capture.malloc_arenas()
    assert n["calls"] == 1


def test_the_real_libc_reports_more_than_the_main_arena_or_names_its_absence():
    """The whole reason this sits beside `mallinfo2`: on the real libc the across-arena `system_current`
    must be a real figure. Written as either/or so a musl box reports an absence instead of failing."""
    out = capture.malloc_arenas()
    if out["reason"] is None:
        assert out["heaps"] >= 1 and out["system_current"] > 0
        assert out["rest"] is not None
    else:
        assert out["reason"].startswith("malloc_info")


# ── the line ─────────────────────────────────────────────────────────────────────────────────────


def _snap(**kw):
    base = {
        "rss_kb": {"VmRSS": 262144, "RssAnon": 245760, "RssFile": 16384, "VmSwap": 94208},
        "mallinfo2": dict.fromkeys(capture._MALLINFO2_FIELDS, 0)
        | {
            "arena": 300 * 1024,
            "hblkhd": 64 * 1024 * 1024,
            "uordblks": 200 * 1024,
            "fordblks": 100 * 1024,
            "keepcost": 95 * 1024,
            "reason": None,
        },
        "arenas": {
            # measured shape: 9 heaps, `fast` absent on glibc 2.43, totals across every arena
            "heaps": 9,
            "fast": None,
            "rest": 3099171,
            "mmap": 401408,
            "system_current": 6656000,
            "system_max": 6688768,
            "reason": None,
        },
        "gc": {"counts": [700, 3, 1], "collections": [12345, 1100, 9], "enabled": True},
    }
    base.update(kw)
    return base


def test_the_line_is_one_unit_throughout():
    """kB for every figure, including the `mallinfo2` ones that arrive in BYTES — a line mixing the two
    is a 1024x reading error waiting to be made."""
    line = capture.mem_log_line(_snap())
    assert line == (
        "mem: VmRSS 262144 kB RssAnon 245760 kB VmSwap 94208 kB · main arena 300 kB hblkhd 65536 kB uordblks 200 kB "
        "fordblks 100 kB keepcost 95 kB · all arenas heaps 9 system 6500 kB rest 3026 kB mmap 392 kB "
        "· gc counts 700,3,1 collections 12345,1100,9"
    )


def test_an_unmeasured_figure_prints_null_and_the_reason_rides_the_line():
    """§∅ on the journal surface too: a 0 here would read as "the allocator holds nothing"."""
    snap = _snap(
        rss_kb={"VmRSS": None, "RssAnon": None, "RssFile": None, "VmSwap": None},
        mallinfo2=dict.fromkeys(capture._MALLINFO2_FIELDS) | {"reason": "mallinfo2 unavailable: AttributeError"},
        arenas=dict.fromkeys(capture._ARENA_KEYS) | {"reason": "malloc_info unavailable: AttributeError"},
        gc={"counts": [1, 2, 3], "collections": [5, None, None], "enabled": True},
    )
    line = capture.mem_log_line(snap)
    assert "VmRSS null kB" in line and "VmSwap null kB" in line and "main arena null kB" in line
    assert "all arenas heaps null system null kB" in line
    assert "collections 5,null,null" in line
    # each instrument names its own absence, and one absent instrument never speaks for the other
    assert line.endswith("· mallinfo2 unavailable: AttributeError · malloc_info unavailable: AttributeError")
    assert " 0 kB" not in line


# ── the status tick ──────────────────────────────────────────────────────────────────────────────


def _loop(monkeypatch, tmp_path, passes=1, **kw):
    monkeypatch.setitem(capture.STATUS, "devices", {})
    monkeypatch.setattr(capture.writers, "live_loss_check", lambda prev: ([], {}))
    monkeypatch.setattr(capture.writers, "open_writer_paths", lambda: [])
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, passes)
    _run(capture.status_loop(str(tmp_path), **kw))
    capture._STOP.clear()


def test_the_status_tick_publishes_the_four_populations(tmp_path, monkeypatch, caplog):
    with caplog.at_level("INFO"):
        _loop(monkeypatch, tmp_path)
    mem = capture.STATUS["mem"]
    assert set(mem) == {"rss_kb", "mallinfo2", "arenas", "gc"}
    assert set(mem["rss_kb"]) == {"VmRSS", "RssAnon", "RssFile", "VmSwap"}
    assert set(mem["mallinfo2"]) == {*capture._MALLINFO2_FIELDS, "reason"}
    assert set(mem["arenas"]) == {*capture._ARENA_KEYS, "reason"}
    assert mem["gc"]["counts"] and len(mem["gc"]["collections"]) == 3
    assert any(r.getMessage().startswith("mem: VmRSS ") for r in caplog.records)


def test_the_journal_cadence_is_not_the_publish_cadence(tmp_path, monkeypatch, caplog):
    """The block is published every 10 s tick; the line is not. 8640 lines a day for a smooth 6 h curve
    is volume without information, and the owner's standing ruling on journal flood is to measure it."""
    with caplog.at_level("INFO"):
        _loop(monkeypatch, tmp_path, passes=4, mem_log_sec=3600)
    assert sum(r.getMessage().startswith("mem: ") for r in caplog.records) == 1


def test_zero_publishes_the_block_and_logs_nothing(tmp_path, monkeypatch, caplog):
    """Same convention as `stream.stall_sec`: 0 disables, and it disables the LINE only — a box that
    wants no journal volume still keeps the status block for the monitor."""
    with caplog.at_level("INFO"):
        _loop(monkeypatch, tmp_path, passes=3, mem_log_sec=0)
    assert not any(r.getMessage().startswith("mem: ") for r in caplog.records)
    assert capture.STATUS["mem"]["gc"]["counts"]
