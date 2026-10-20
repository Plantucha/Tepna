# tepna-capture — pymalloc_stats.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""CPython's own small-object allocator, read from inside the daemon: arenas held and bytes live.

Row `2026-10-18-cap-net-admin-makes-the-daemon-non-dumpable-so-smaps-is-root-only`. The `mem` line
carries glibc's two views, and both are blind to the memory CPython's small-object allocator maps for
its arenas. Row `2026-10-18-most-of-the-climb-sits-outside-glibc-arena-accounting` puts most of the
climb there. Two routes to that population were measured on the capture box on 2026-10-20:

  · `/proc/self/smaps` IS readable from inside the daemon. The capability grant makes the process
    non-dumpable, and that refuses every OTHER reader of the same uid, but the kernel always lets a
    process read its own `/proc` files. The mapping view still cannot answer the question: the kernel
    merges adjacent anonymous mappings, so 171 MB of small objects sat in mappings over 1 MiB and no
    size class isolated the 1 MiB arenas.
  · CPython reports the arenas itself. `_PyObject_DebugMallocStats(FILE *)` writes the allocator's
    statistics to a stream: 0.5–0.6 ms per call at 89 arenas, through the same `open_memstream`
    pattern `capture.malloc_info_xml` uses, so nothing touches file descriptor 2 and no other thread's
    log line can be captured by mistake.

So this module reads the second route. `held` is what the allocator holds in arenas, `live` is the
bytes in allocated blocks; `held - live` is space CPython keeps and does not use.

§∅: every figure the statistics do not state is `None`, with a reason. A return code of 0 means the
process does not run the small-object allocator (for example `PYTHONMALLOC=malloc`), which is a
different fact from "no arenas"."""

from __future__ import annotations

import ctypes
import re
from typing import Any

_BOUND: Any = None
_REASON: str | None = None
_TRIED = False

_ARENAS = re.compile(r"^# arenas allocated current\s*=\s*([\d,]+)\s*$", re.M)
_LIVE = re.compile(r"^# bytes in allocated blocks\s*=\s*([\d,]+)\s*$", re.M)
_TOTAL = re.compile(r"^Total\s*=\s*([\d,]+)\s*$", re.M)


def _resolve() -> None:
    """Bind the stats call and the stream through PyDLL, so the GIL stays held for the walk."""
    global _BOUND, _REASON, _TRIED
    _TRIED = True
    try:
        lib = ctypes.PyDLL(None)
        stats, oms, fcl, fre = lib._PyObject_DebugMallocStats, lib.open_memstream, lib.fclose, lib.free
    except (AttributeError, OSError) as e:
        _REASON = f"pymalloc stats unavailable: {type(e).__name__}"
        return
    stats.restype = ctypes.c_int
    stats.argtypes = [ctypes.c_void_p]
    oms.restype = ctypes.c_void_p
    oms.argtypes = [ctypes.POINTER(ctypes.c_char_p), ctypes.POINTER(ctypes.c_size_t)]
    fcl.restype = ctypes.c_int
    fcl.argtypes = [ctypes.c_void_p]
    fre.restype = None
    fre.argtypes = [ctypes.c_void_p]
    _BOUND = (stats, oms, fcl, fre)


def _int(m: re.Match[str] | None) -> int | None:
    return None if m is None else int(m.group(1).replace(",", ""))


def parse(text: str) -> dict:
    """PURE: `{arenas, held, live}` from the statistics text, in bytes, `None` for an absent figure.

    `held` is the FIRST `Total` after the arena block, which is the sum of the arena lines above it.
    The text has further `Total` lines for other sections, so a match before the arena block, or a
    later one, would be a different figure."""
    a = _ARENAS.search(text)
    out = {"arenas": _int(a), "live": _int(_LIVE.search(text)), "held": None}
    if a is not None:
        out["held"] = _int(_TOTAL.search(text, a.end()))
    return out


def read() -> dict:
    """The allocator's figures now, or all-`None` with a reason. Never raises into the status loop."""
    if not _TRIED:
        _resolve()
    out: dict[str, Any] = {"arenas": None, "held": None, "live": None, "reason": None}
    if _BOUND is None:
        out["reason"] = _REASON
        return out
    stats, oms, fcl, fre = _BOUND
    buf = ctypes.c_char_p()
    size = ctypes.c_size_t()
    try:
        fh = oms(ctypes.byref(buf), ctypes.byref(size))
        if not fh:
            out["reason"] = "pymalloc stats: open_memstream returned NULL"
            return out
        rc = stats(fh)
        fcl(fh)
        if rc == 0:
            out["reason"] = "pymalloc stats: the small-object allocator is not in use"
            return out
        if not buf:
            out["reason"] = "pymalloc stats: the stream left no buffer"
            return out
        out.update(parse(ctypes.string_at(buf, size.value).decode(errors="replace")))
        if out["arenas"] is None:
            out["reason"] = "pymalloc stats: no arena block in the text"
        return out
    except Exception as e:  # noqa: BLE001 — an instrument never takes the status loop down
        out["reason"] = f"pymalloc stats call failed: {type(e).__name__}"
        return out
    finally:
        if buf:
            fre(ctypes.cast(buf, ctypes.c_void_p))
