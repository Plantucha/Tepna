# tepna-capture — tools/probe_firstrow_equivalence.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""ARE THE THREE SURVIVORS ON THE RING'S FIRST-ROW PATH UNKILLABLE, OR IS MY SUITE BLIND? — the
committed battery behind this unit's three `tools/mutate-equivalence.json` entries.

`tools/probe_equivalence.py` says in its own header why a battery must be committed rather than
hand-rolled in a shell: "the batteries that produced them were never committed, so those verdicts
cannot be re-checked, widened, or re-run against moved code." Its `--module` flag is narrower than it
looks — `battery()` there is written against `polar_pmd`'s frame API by name — and its header says the
remedy out loud: "To probe another module, write its battery here." Two modules on this unit's path
need one, so they get this file instead of a second promise of generality.

⚠️ THE CANARY RULE, INHERITED: a battery that distinguishes nothing looks exactly like a battery that
cannot see. So each unit below carries CANARIES — mutants a committed test already kills — and NO
equivalence count is reported for a unit whose canaries it cannot distinguish.

    .venv/bin/python tools/probe_firstrow_equivalence.py              # canaries + candidates
    .venv/bin/python tools/probe_firstrow_equivalence.py --selftest   # canaries only
"""

from __future__ import annotations

import argparse
import datetime as _dt
import importlib.util
import itertools
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

# A mutation is `(label, anchor, replacement, lo, hi)`; the anchor must occur EXACTLY ONCE inside the
# line window [lo, hi], which is how a line that also occurs in a sibling function stays out of reach.
# `validation_depth=validation_depth,` is the case that needs it: it sits in `assemble_dat` too.
_W_LO, _W_HI = 3378, 3403  # Spo2CsvWriter.__init__
_E_LO, _E_HI = 252, 292  # assemble_live's span block and its return


def _load(alias: str, path: str) -> Any:
    spec = importlib.util.spec_from_file_location(alias, path)
    assert spec is not None and spec.loader is not None, path
    mod = importlib.util.module_from_spec(spec)
    sys.modules[alias] = mod
    spec.loader.exec_module(mod)
    return mod


def _variant(module: str, alias: str, anchor: str | None, repl: str | None, lo: int, hi: int) -> tuple[Any, str]:
    """A copy of `<module>.py` with `anchor` -> `repl` inside [lo, hi], imported under `alias`."""
    d = tempfile.mkdtemp(prefix="firstrow-probe-")
    lines = (HERE / (module + ".py")).read_text(encoding="utf-8").split("\n")
    if anchor is not None and repl is not None:
        win = "\n".join(lines[lo - 1 : hi])
        if win.count(anchor) != 1:
            raise SystemExit(f"anchor matched {win.count(anchor)}x in {module}.py:{lo}-{hi} (need 1): {anchor[:70]}")
        lines = lines[: lo - 1] + win.replace(anchor, repl).split("\n") + lines[hi:]
    p = Path(d) / (module + ".py")
    p.write_text("\n".join(lines), encoding="utf-8")
    return _load(alias, str(p)), d


# ── UNIT 1 · writers.Spo2CsvWriter.__init__ ────────────────────────────────────────────────────────
# The axes the constructor can branch on: what is already at the path, how many rows follow, and
# which readings those rows carry (an absent SpO2 and an absent pulse write BLANK, never 0, so the
# row widths differ). Seeds carry a CRLF row and a bare CR on purpose: those are the only bytes a
# `newline=` difference could act on, and the writer can emit neither.
_WHEN = _dt.datetime(2026, 10, 21, 5, 42, 7, 456000)
_READINGS = [(96, 58, 0), (None, None, 0), (96, None, 3), (None, 58, 1), (100, 220, 255), (0, 0, 0)]
_SEEDS = [None, "", "x", "Time,Oxygen Level,Pulse Rate,Motion\n", "a,1,2,3\r\n", "a,1,2,3", "\n", "\r"]


def _observe_writer(mod: Any) -> list:
    out: list[list[Any]] = []
    for seed, nrows, k in itertools.product(_SEEDS, (0, 1, 2, 7, 60), range(len(_READINGS))):
        reads = _READINGS[k:] + _READINGS[:k]
        d = tempfile.mkdtemp(prefix="firstrow-run-")
        p = os.path.join(d, "ring_SPO2.csv")
        if seed is not None:
            Path(p).write_bytes(seed.encode())
        label = f"seed={seed!r} rows={nrows} readings={k}"
        try:
            wr = mod.Spo2CsvWriter(p, flush_interval=0.0, fsync=False)
            mode = wr._fh.mode
            for i in range(nrows):
                spo2, pr, motion = reads[i % len(reads)]
                wr.write(_WHEN + _dt.timedelta(seconds=i), spo2, pr, motion)
            seen = [wr.rows, wr.first_row_ms, wr.resumed, wr.rows_lost, mode]
            wr.close()
            out.append([label, [seen, Path(p).read_bytes().hex()]])
        except Exception as e:  # an exception IS an observable outcome
            out.append([label, "EXC:" + type(e).__name__])
        finally:
            shutil.rmtree(d, ignore_errors=True)
    return out


_WRITER_CANARIES = [
    (
        "an EMPTY file reads as a resume",
        "os.path.getsize(path) > 0",
        "os.path.getsize(path) >= 0",
        "test_an_EMPTY_file_is_NOT_a_resume_and_still_gets_its_header",
    ),
    (
        "a ONE-byte file reads as fresh",
        "os.path.getsize(path) > 0",
        "os.path.getsize(path) > 1",
        "test_ANY_byte_already_in_the_file_is_a_RESUME",
    ),
    (
        "every path is opened for APPEND",
        '"a" if _resumed else "w"',
        '"a" if (_resumed) or True else "w"',
        "test_a_FRESH_path_is_opened_for_writing_not_appending",
    ),
    (
        "the header loses a column",
        'self._fh.write("Time,Oxygen Level,Pulse Rate,Motion\\n")',
        'self._fh.write("Time,Oxygen Level,Pulse Rate\\n")',
        "test_an_EMPTY_file_is_NOT_a_resume_and_still_gets_its_header",
    ),
]

_WRITER_CANDIDATES = [
    ('newline="\\n")', "newline=None)", "newline=None"),
    (', newline="\\n")', ", )", "the kwarg dropped"),
]


# ── UNIT 2 · acq_evidence_o2ring.assemble_live ─────────────────────────────────────────────────────
# Every argument the envelope branches on, including the two starts that are the point of this unit.
def _envelope_cases() -> list[dict]:
    import acq_evidence as ae

    offs = [None, ae.ClockOffset.unknown(), ae.ClockOffset(-1.25, 1792551727456.0, "host-stratum1", "GetDateTime")]
    axes = itertools.product(
        [None, 0.0, 1792551727456.0],  # the artifact's first row: absent, the epoch, a real tMs
        [0, 1, 3, 29000],  # rows this instance wrote
        [None, True, False],  # stopped_cleanly
        [True, False],  # resumed
        offs,
        [None, ae.UNKNOWN, "charging", ""],  # device_state
    )
    return [
        {
            "device_id": "O2-1",
            "session_id": "20261021031500",
            "artifact_path": "/n/ring_SPO2.csv",
            "artifact_rows": nrows,
            "start_time_ms": start,
            "instance_start_time_ms": 1792542900000.0,
            "resumed": resumed,
            "stopped_cleanly": clean,
            "clock_offset": off,
            "device_state": state,
        }
        for start, nrows, clean, resumed, off, state in axes
    ]


def _observe_envelope(mod: Any) -> list:
    out: list[list[Any]] = []
    for kw in _envelope_cases():
        label = "start={start_time_ms} rows={artifact_rows} clean={stopped_cleanly} resumed={resumed}".format(**kw)
        label += f" off={kw['clock_offset'] is not None} state={kw['device_state']!r}"
        try:
            out.append([label, json.dumps(mod.assemble_live(**kw).to_dict(), sort_keys=True, default=str)])
        except Exception as e:
            out.append([label, "EXC:" + type(e).__name__])
    return out


_ENVELOPE_CANARIES = [
    (
        "the device loses its identity",
        "device_id=device_id,",
        "device_id=None,",
        "test_the_envelope_carries_the_IDENTITY_it_was_given",
    ),
    (
        "an unmeasured device state becomes None",
        "device_state=device_state if device_state is not None else ae.UNKNOWN,",
        "device_state=None,",
        "test_an_UNMEASURED_clock_offset_and_device_state_are_the_SENTINELS_not_None",
    ),
    (
        "the resume test is inverted",
        "artifact_start = None if resumed else start_time_ms",
        "artifact_start = None if not resumed else start_time_ms",
        "test_A_RESUMED_FILE_REPORTS_NEITHER_A_START_NOR_A_COUNT",
    ),
    (
        "the derived end drops the sample count",
        "end_time_ms = artifact_start + sample_count * 1000",
        "end_time_ms = artifact_start + 1000",
        "test_THE_DERIVED_END_FOLLOWS_THE_CORRECTED_START",
    ),
]

_ENVELOPE_CANDIDATES = [
    ("validation_depth=validation_depth,", "validation_depth=None,", "validation_depth=None"),
]

UNITS = [
    ("writers", "Spo2CsvWriter.__init__", _W_LO, _W_HI, _observe_writer, _WRITER_CANARIES, _WRITER_CANDIDATES),
    (
        "acq_evidence_o2ring",
        "assemble_live",
        _E_LO,
        _E_HI,
        _observe_envelope,
        _ENVELOPE_CANARIES,
        _ENVELOPE_CANDIDATES,
    ),
]


def _differences(a: list, b: list) -> int:
    """How many cases distinguish the variant from the baseline — length mismatch included.

    The sibling prober's header records why that last clause is load-bearing: a bare `zip` stops at
    the shorter list, so a variant that DROPPED results read as 0 differences, which is this suite's
    own signature failure — success reported about something never examined."""
    n = sum(1 for x, y in zip(a, b) if json.dumps(x[1], sort_keys=True) != json.dumps(y[1], sort_keys=True))
    return n + abs(len(a) - len(b))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true", help="run the canaries only")
    a = ap.parse_args()

    rc = 0
    for i, (module, fn, lo, hi, observe, canaries, candidates) in enumerate(UNITS):
        base_mod, base_dir = _variant(module, f"{module}_base_{i}", None, None, lo, hi)
        base = observe(base_mod)
        shutil.rmtree(base_dir, ignore_errors=True)
        print(f"\n{module}.py {fn} — battery: {len(base)} case(s) over lines {lo}-{hi}")

        blind = []
        for j, (why, anchor, repl, killed_by) in enumerate(canaries):
            mut, d = _variant(module, f"{module}_can_{i}_{j}", anchor, repl, lo, hi)
            n = _differences(base, observe(mut))
            shutil.rmtree(d, ignore_errors=True)
            print(f"  {'✓' if n else '✗ BLIND'} canary {why:<38} {n}/{len(base)}   (killed by {killed_by})")
            if not n:
                blind.append(why)
        if blind:
            print("  ⚠️ BATTERY TOO NARROW — it cannot distinguish " + ", ".join(blind) + ".")
            print("     No equivalence count is reported for this unit. Widen the battery.")
            rc = max(rc, 2)
            continue
        if a.selftest:
            continue
        for j, (anchor, repl, tag) in enumerate(candidates):
            mut, d = _variant(module, f"{module}_cand_{i}_{j}", anchor, repl, lo, hi)
            n = _differences(base, observe(mut))
            shutil.rmtree(d, ignore_errors=True)
            verdict = "no-distinguishing-input (over THIS battery)" if n == 0 else f"KILLABLE — {n} distinguishing"
            print(f"  candidate [{tag}]: {n} of {len(base)} differed  ⇒ {verdict}")
            if n:
                rc = max(rc, 1)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
