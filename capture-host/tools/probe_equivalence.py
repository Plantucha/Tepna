# tepna-capture — tools/probe_equivalence.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""IS A SURVIVING PYTHON MUTANT A TEST GAP, OR UNKILLABLE? — the Python sibling of
`tools/probe-equivalence.mjs`, which is vm-based and therefore JS-only.

WHY THIS EXISTS. `tools/mutate-equivalence.json` requires a `probe` field saying what was actually
run, and `mutate_diff.py`'s header is explicit: "EQUIVALENT MUTANTS ARE RECORDED WITH EVIDENCE, NOT
ARGUED IN A PR COMMENT … Silence is never equivalence." Until now the Python side had the file but no
prober, so every equivalence claim here was a hand-rolled battery that died with the shell that ran
it. That is the exact failure MUTATION-EQUIVALENCE §8.4 names — "the batteries that produced them were
never committed, so those verdicts cannot be re-checked, widened, or re-run against moved code."
So the battery is committed, and re-runnable.

⚠️ THE CANARY RULE — WHY A ZERO-DIFFERENCE RESULT IS NOT EVIDENCE ON ITS OWN.
A battery that distinguishes nothing looks identical to a battery that is simply too narrow. Measured
2026-08-09 on this very module: a first battery reported 0/160 differences for `payload[o+4] >> 8` and
for `est < 1.1*step` — BOTH of which a committed test kills. Its PPI payload was all zeros (so the
high byte was invisible) and its `prev_last_ns` values never landed on a boundary. Widening it to 455
cases caught both (65/455 and 6/455).

So this prober FAILS CLOSED: it runs a set of CANARY mutants that are known-killable, and if any of
them fails to produce a difference the battery is declared too narrow and NO equivalence verdict is
emitted. An unkillable-looking result is only reported when the battery has demonstrated it can see.

    python tools/probe_equivalence.py --module polar_pmd.py            # probe + canaries
    python tools/probe_equivalence.py --module polar_pmd.py --selftest # canaries only
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent

# ── THE BATTERY ────────────────────────────────────────────────────────────────────────────────────
# Every axis that decode_frame branches on. Widened 2026-08-09 after the narrow version missed two
# known kills; the additions are marked, because a battery's blind spots are the interesting part.
_PPI_HI = bytes([60]) + (1000).to_bytes(2, "little") + (700).to_bytes(2, "little") + bytes([2])


def battery(pmd):
    """(name, meas, frame_type, payload, fs, dprev) tuples. `dprev` = last_ns - prev_last_ns."""
    shapes = [
        ("ECG x4", pmd.ECG, 0x00, b"\x01\x00\x00" * 4, 3),
        ("ECG x1", pmd.ECG, 0x00, b"\x01\x00\x00", 3),          # ADDED: n == 1 exercises `n > 0`
        ("ECG empty", pmd.ECG, 0x00, b"", 3),
        ("PPG x3", pmd.PPG, 0x00, bytes(12 * 3), 12),
        ("ACC x4", pmd.ACC, 0x01, bytes(6 * 4), 6),
        ("PPI hi-byte", pmd.PPI, 0x00, _PPI_HI, 6),             # ADDED: non-zero HIGH byte
        ("PPI zeros", pmd.PPI, 0x00, bytes(6 * 2), 6),
    ]
    for nm, meas, ft, pay, stride in shapes:
        n = max(1, len(pay) // stride)
        for fs in (None, 52, 130, 176, 1000):
            nom = 1e9 / (fs or 1)
            # ADDED: dprev landing EXACTLY on the branch boundaries, per fs, so `<=` vs `<` is reached
            exact = [int(round(k * nom * n)) for k in (0.9, 1.0, 1.1, 0.5, 1.5)]
            for dprev in [None, 0, 1, 3, n, 7_692_307, 10_000_000, 20_000_000] + exact:
                yield (nm, meas, ft, pay, fs, dprev)


def observe(pmd) -> list:
    """Every output byte a caller can see: the stamps, the phone clock, and the values."""
    out = []
    for nm, meas, ft, pay, fs, dprev in battery(pmd):
        last = 10_000_000_000
        prev = None if dprev is None else last - dprev
        hdr = bytes([meas]) + last.to_bytes(8, "little") + bytes([ft])
        label = f"{nm} fs={fs} dprev={dprev}"
        try:
            _m, s = pmd.decode_frame(hdr + pay, _dt.datetime(2026, 7, 16), fs=fs, prev_last_ns=prev)
        except Exception as e:                              # an exception IS an observable outcome
            out.append([label, "EXC:" + type(e).__name__])
            continue
        out.append([label, [[x.sensor_ns, x.phone.isoformat(), list(x.values)] for x in s]])
    return out


# ── CANARIES — known-killable mutants the battery MUST see. Fail closed if it cannot. ──────────────
# Each is `(before, after, why_it_is_killable)`. These are not equivalence candidates; they are the
# battery's own test. `killed_by` names the committed test that kills it, so a canary that stops being
# killable is visible as a test regression rather than as a silently weaker probe.
CANARIES = [
    ("phone=arrival - _dt.timedelta", "phone=arrival + _dt.timedelta",
     "back-timing sign flip", "test_backtiming_runs_BACKWARD_from_the_frame_last_sample"),
    ("payload[o + 3] | (payload[o + 4] << 8), payload[o + 5]))",
     "payload[o + 3] | (payload[o + 4] >> 8), payload[o + 5]))",
     "PPI ppErrMs high byte", "test_ppi_error_field_reads_its_HIGH_byte"),
    ("if 0.9 * step_ns <= est <= 1.1 * step_ns:", "if 0.9 * step_ns <= est < 1.1 * step_ns:",
     "upper plausibility bound", "test_estimate_exactly_on_the_UPPER_bound_is_adopted"),
    ("elif 0 < est < step_ns:", "elif 1 < est < step_ns:",
     "clamp lower bound", "test_a_sub_nanosecond_estimate_is_still_clamped_not_refused"),
]


def _run_variant(module: str, before: str | None, after: str | None) -> list:
    """Import `module` in a subprocess with an optional one-line mutation applied, and observe it."""
    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        shutil.copy(HERE / module, work / module)
        for extra in ("__init__.py",):
            if (HERE / extra).exists():
                shutil.copy(HERE / extra, work / extra)
        if before is not None:
            p = work / module
            src = p.read_text(encoding="utf-8")
            if src.count(before) != 1:
                raise SystemExit(f"anchor matched {src.count(before)}x (need exactly 1): {before[:70]}")
            p.write_text(src.replace(before, after), encoding="utf-8")
        code = (
            "import sys, json; sys.path.insert(0, %r); sys.path.insert(0, %r)\n"
            "import importlib; pmd = importlib.import_module(%r)\n"
            "import probe_shim; print(json.dumps(probe_shim.observe(pmd), default=str))\n"
            % (str(work), str(HERE / "tools"), module[:-3])
        )
        shim = HERE / "tools" / "probe_shim.py"
        shim.write_text("from probe_equivalence import observe  # re-exported for the subprocess\n",
                        encoding="utf-8")
        try:
            r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                               cwd=str(HERE), env={"PYTHONPATH": str(HERE / "tools"), "PATH": "/usr/bin:/bin"})
        finally:
            shim.unlink(missing_ok=True)
        if r.returncode != 0:
            raise SystemExit("probe subprocess failed:\n" + r.stderr[-1500:])
        return json.loads(r.stdout)


def _differences(a: list, b: list) -> int:
    """How many decode results distinguish the variant from the baseline.

    ⚠️ A LENGTH MISMATCH IS A DIFFERENCE — THE LARGEST ONE — and `zip` alone cannot see it. This used to
    be a bare `sum(... for x, y in zip(a, b) ...)`, which stops at the SHORTER list: a variant that
    dropped results simply had them ignored, and if the surviving prefix matched, the count came back 0.
    `n == 0` is the caller's verdict for "no-distinguishing-input", i.e. EQUIVALENT — so a mutant that
    destroyed two thirds of the output was reported as harmless. Demonstrated:

        base 3 results, variant 3 identical   -> 0   (equivalent, correct)
        base 3 results, one value changed     -> 1   (killable, correct)
        base 3 results, variant 1 result      -> 0   <- WRONG: 2 results vanished

    That is this suite's signature failure inside the very tool built to detect it: a check reporting
    success about something it never examined. Missing and extra entries are now counted."""
    n = sum(1 for x, y in zip(a, b) if json.dumps(x[1], sort_keys=True) != json.dumps(y[1], sort_keys=True))
    return n + abs(len(a) - len(b))


def main() -> int:
    ap = argparse.ArgumentParser()
    # ⚠️ THE FLAG IS NARROWER THAN IT LOOKS, AND SAYING SO IS THE POINT. `battery()` is written
    # against polar_pmd's API by name (`pmd.ECG`, PMD frame types, payload shapes), so pointing this
    # at another module raises AttributeError on the first shape rather than probing it. That is a
    # LOUD failure, not a false verdict — but the flag's generality is a promise this tool does not
    # keep, and a reader discovers that only at the traceback. Measured 2026-08-28 while probing
    # `mutation_diff.py` for the #1900 equivalences, which had to be done with a bespoke harness.
    # Narrowed rather than given a battery registry: a registry would imply every module gets one,
    # which is more promise than the program needs. To probe another module, write its battery here.
    ap.add_argument("--module", default="polar_pmd.py",
                    help="polar_pmd.py, or a module whose API `battery()` actually drives — this is "
                         "NOT a generic prober; see the note above")
    ap.add_argument("--selftest", action="store_true", help="run the canaries only")
    ap.add_argument("--probe", nargs=2, metavar=("BEFORE", "AFTER"),
                    help="one candidate mutation to classify")
    a = ap.parse_args()

    base = _run_variant(a.module, None, None)
    print(f"battery: {len(base)} decode calls over {a.module}")

    print("\ncanaries — the battery must SEE each of these, or it is too narrow to prove anything:")
    blind = []
    for before, after, why, killed_by in CANARIES:
        try:
            n = _differences(base, _run_variant(a.module, before, after))
        except SystemExit as e:
            print(f"  ✗ {why}: {e}")
            blind.append(why)
            continue
        mark = "✓" if n else "✗ BLIND"
        print(f"  {mark} {why:<28} {n}/{len(base)}   (killed by {killed_by})")
        if not n:
            blind.append(why)
    if blind:
        print("\n⚠️ BATTERY TOO NARROW — it cannot distinguish " + ", ".join(blind) + ".")
        print("   No equivalence verdict is emitted. Widen the battery until every canary is seen.")
        return 2
    print("\n  all canaries seen — the battery can distinguish. Verdicts below are meaningful.")

    if a.selftest:
        return 0
    if a.probe:
        n = _differences(base, _run_variant(a.module, a.probe[0], a.probe[1]))
        verdict = "no-distinguishing-input (over THIS battery)" if n == 0 else f"KILLABLE — {n} distinguishing case(s)"
        print(f"\ncandidate: {a.probe[0][:60]} -> {a.probe[1][:60]}\n  {n}/{len(base)} differ  ⇒ {verdict}")
        return 0 if n == 0 else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
