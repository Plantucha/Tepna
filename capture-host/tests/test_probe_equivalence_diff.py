# tepna-capture — tests/test_probe_equivalence_diff.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`probe_equivalence._differences` — the count that decides whether a mutant is EQUIVALENT.

`n == 0` is the caller's verdict for "no-distinguishing-input", so anything this function fails to count
is a mutant declared harmless. It used to be a bare `sum(... for x, y in zip(a, b) ...)`, and `zip` stops
at the shorter list — so a variant that DROPPED results had them silently ignored, and a matching prefix
came back 0. A mutant that destroyed two thirds of the output was reported as equivalent.

That is this suite's signature failure — a check reporting success about something it never examined —
inside the tool built to detect exactly that.
"""
import importlib.util
import os
import re
import sys
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "probe_equivalence",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools",
                 "probe_equivalence.py"))
if _SPEC is None or _SPEC.loader is None:
    raise ImportError("cannot load probe_equivalence.py")
pe = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(pe)

_BASE = [("a", {"v": 1}), ("b", {"v": 2}), ("c", {"v": 3})]


def test_identical_output_is_equivalent():
    assert pe._differences(_BASE, list(_BASE)) == 0


def test_a_changed_value_is_counted():
    assert pe._differences(_BASE, [("a", {"v": 9}), ("b", {"v": 2}), ("c", {"v": 3})]) == 1


def test_DROPPED_RESULTS_ARE_COUNTED():
    """THE REGRESSION. Under `zip` alone this returned 0 — "no-distinguishing-input" — for a variant that
    produced one result where the baseline produced three."""
    assert pe._differences(_BASE, [("a", {"v": 1})]) == 2


def test_extra_results_are_counted_too():
    """Symmetric: a variant that invents output is as distinguishable as one that loses it."""
    assert pe._differences(_BASE, _BASE + [("d", {"v": 4})]) == 1


def test_a_dropped_result_can_never_read_as_equivalent():
    """The property that matters, stated directly: any length mismatch is non-zero however well the
    surviving prefix matches."""
    for keep in range(len(_BASE)):
        assert pe._differences(_BASE, _BASE[:keep]) > 0


def test_changed_and_dropped_add_rather_than_mask():
    """A variant that both alters a surviving entry AND loses one must not have the two cancel."""
    assert pe._differences(_BASE, [("a", {"v": 9}), ("b", {"v": 2})]) == 2


def test_empty_variant_is_maximally_different():
    assert pe._differences(_BASE, []) == len(_BASE)


# ── the rest of the module ──────────────────────────────────────────────────────────────────────────
# ⚠️ THIS MODULE WAS UNMEASURED UNTIL THE TESTS ABOVE IMPORTED IT, and that is not incidental: the zip
# truncation lived here for as long as it did BECAUSE nothing imported the file, so it contributed zero
# statements to the coverage floor and its absence was invisible. Covering the rest is the cost of
# gating the fix, and it is the right cost.
import datetime as _dt          # noqa: E402
import json as _json            # noqa: E402
import types                    # noqa: E402

import pytest                   # noqa: E402


class _FakeSample:
    def __init__(self, ns, vals):
        self.sensor_ns, self.phone, self.values = ns, _dt.datetime(2026, 7, 16), vals


def _fake_pmd(raise_on=None):
    """The smallest object `battery`/`observe` can drive: four measurement ids and a decode_frame."""
    m = types.SimpleNamespace(ECG=0, PPG=1, ACC=2, PPI=3)

    def decode_frame(buf, phone, fs=None, prev_last_ns=None):
        if raise_on is not None and raise_on in buf:
            raise ValueError("planted")
        return (buf[0], [_FakeSample(1, [1, 2])])

    m.decode_frame = decode_frame
    return m


def test_battery_yields_every_shape_at_every_rate():
    rows = list(pe.battery(_fake_pmd()))
    assert rows, "the battery must not be empty — it is the whole discriminating power"
    names = {r[0] for r in rows}
    assert {"ECG x4", "ECG empty", "PPG x3", "ACC x4", "PPI zeros"} <= names
    assert {r[4] for r in rows} == {None, 52, 130, 176, 1000}, "every fs must be exercised"


def test_observe_records_values():
    out = pe.observe(_fake_pmd())
    assert len(out) == len(list(pe.battery(_fake_pmd())))
    assert all(isinstance(row[0], str) for row in out)


def test_observe_records_an_EXCEPTION_as_an_outcome():
    """An exception is observable to a caller, so it must be a distinguishable result rather than a
    crash — otherwise a mutant that starts raising would abort the probe instead of being killed."""
    out = pe.observe(_fake_pmd(raise_on=b"\x00"))
    assert any(isinstance(r[1], str) and r[1].startswith("EXC:") for r in out)


def test_run_variant_refuses_an_anchor_that_is_not_unique(tmp_path, monkeypatch):
    """`before` must match exactly once, or the mutation is ambiguous and the verdict meaningless."""
    monkeypatch.setattr(pe, "HERE", tmp_path)
    (tmp_path / "m.py").write_text("x = 1\nx = 1\n", encoding="utf-8")
    with pytest.raises(SystemExit) as e:
        pe._run_variant("m.py", "x = 1", "x = 2")
    assert "2x" in str(e.value) or "matched" in str(e.value)


def test_run_variant_raises_when_the_subprocess_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(pe, "HERE", tmp_path)
    (tmp_path / "m.py").write_text("x = 1\n", encoding="utf-8")
    (tmp_path / "tools").mkdir()
    monkeypatch.setattr(pe.subprocess, "run",
                        lambda *a, **k: types.SimpleNamespace(returncode=1, stdout="", stderr="boom"))
    with pytest.raises(SystemExit) as e:
        pe._run_variant("m.py", None, None)
    assert "boom" in str(e.value)


def test_run_variant_returns_the_parsed_observation(tmp_path, monkeypatch):
    monkeypatch.setattr(pe, "HERE", tmp_path)
    (tmp_path / "m.py").write_text("x = 1\n", encoding="utf-8")
    (tmp_path / "tools").mkdir()
    payload = [["lbl", [[1, "t", [2]]]]]
    monkeypatch.setattr(pe.subprocess, "run",
                        lambda *a, **k: types.SimpleNamespace(
                            returncode=0, stdout=_json.dumps(payload), stderr=""))
    assert pe._run_variant("m.py", None, None) == payload


# ── main(): the verdict paths ───────────────────────────────────────────────────────────────────────
def _stub_runs(monkeypatch, base, variants):
    """`_run_variant` returns `base` for the unmutated call and pops `variants` for each mutation."""
    seq = list(variants)

    def fake(module, before, after):
        if before is None:
            return base
        return seq.pop(0) if seq else base

    monkeypatch.setattr(pe, "_run_variant", fake)


def test_main_refuses_a_verdict_when_a_canary_is_BLIND(monkeypatch, capsys):
    """The fail-closed path: if the battery cannot see a known-killable mutant it has not earned the
    right to call anything equivalent, so no verdict is emitted at all."""
    base = [("a", {"v": 1})]
    _stub_runs(monkeypatch, base, [base] * len(pe.CANARIES))      # every canary indistinguishable
    monkeypatch.setattr(sys, "argv", ["probe_equivalence", "--selftest"])
    assert pe.main() == 2
    assert "BATTERY TOO NARROW" in capsys.readouterr().out


def test_main_selftest_passes_when_every_canary_is_seen(monkeypatch, capsys):
    base = [("a", {"v": 1})]
    _stub_runs(monkeypatch, base, [[("a", {"v": 2})]] * len(pe.CANARIES))
    monkeypatch.setattr(sys, "argv", ["probe_equivalence", "--selftest"])
    assert pe.main() == 0
    assert "all canaries seen" in capsys.readouterr().out


def test_main_reports_a_KILLABLE_candidate(monkeypatch, capsys):
    base = [("a", {"v": 1})]
    seen = [[("a", {"v": 2})]] * len(pe.CANARIES)
    _stub_runs(monkeypatch, base, seen + [[("a", {"v": 3})]])
    monkeypatch.setattr(sys, "argv", ["probe_equivalence", "--probe", "x = 1", "x = 2"])
    assert pe.main() == 1
    assert "KILLABLE" in capsys.readouterr().out


def test_main_reports_no_distinguishing_input(monkeypatch, capsys):
    base = [("a", {"v": 1})]
    seen = [[("a", {"v": 2})]] * len(pe.CANARIES)
    _stub_runs(monkeypatch, base, seen + [base])
    monkeypatch.setattr(sys, "argv", ["probe_equivalence", "--probe", "x = 1", "x = 2"])
    assert pe.main() == 0
    assert "no-distinguishing-input" in capsys.readouterr().out


def test_main_with_no_mode_just_reports_the_battery(monkeypatch, capsys):
    base = [("a", {"v": 1})]
    _stub_runs(monkeypatch, base, [[("a", {"v": 2})]] * len(pe.CANARIES))
    monkeypatch.setattr(sys, "argv", ["probe_equivalence"])
    assert pe.main() == 0


def test_a_canary_that_cannot_be_APPLIED_is_also_blind(monkeypatch, capsys):
    """`_run_variant` raises SystemExit when an anchor no longer matches — a canary whose anchor has
    drifted must count as blind, not be skipped silently."""
    base = [("a", {"v": 1})]

    def fake(module, before, after):
        if before is None:
            return base
        raise SystemExit("anchor matched 0x")

    monkeypatch.setattr(pe, "_run_variant", fake)
    monkeypatch.setattr(sys, "argv", ["probe_equivalence", "--selftest"])
    assert pe.main() == 2
    assert "BATTERY TOO NARROW" in capsys.readouterr().out


def test_run_variant_carries_an_init_py_into_the_sandbox(tmp_path, monkeypatch):
    """A package module needs its `__init__.py` beside it or the subprocess import fails — the copy is
    conditional, so the branch where the file EXISTS needs exercising too."""
    monkeypatch.setattr(pe, "HERE", tmp_path)
    (tmp_path / "m.py").write_text("x = 1\n", encoding="utf-8")
    (tmp_path / "__init__.py").write_text("", encoding="utf-8")
    (tmp_path / "tools").mkdir()
    seen = {}

    def fake_run(*a, **k):
        seen["cwd"] = k.get("cwd")
        return types.SimpleNamespace(returncode=0, stdout="[]", stderr="")

    monkeypatch.setattr(pe.subprocess, "run", fake_run)
    assert pe._run_variant("m.py", None, None) == []
    assert seen["cwd"] == str(tmp_path)


def test_run_variant_APPLIES_a_unique_anchor(tmp_path, monkeypatch):
    """The mutation actually being written is the whole point: a probe that silently failed to apply it
    would run the UNMUTATED module and report every candidate as equivalent — the same false-equivalence
    this file exists to prevent, one layer up. So read the sandbox copy back out and check it changed."""
    monkeypatch.setattr(pe, "HERE", tmp_path)
    (tmp_path / "m.py").write_text("value = 1\n", encoding="utf-8")
    (tmp_path / "tools").mkdir()
    seen = {}

    def fake_run(*a, **k):
        # the generated -c program embeds the sandbox path; read the copy before the tempdir is removed
        code = a[0][2]
        sandbox = re.search(r"sys\.path\.insert\(0, '([^']+)'\)", code).group(1)
        seen["src"] = (Path(sandbox) / "m.py").read_text(encoding="utf-8")
        return types.SimpleNamespace(returncode=0, stdout="[]", stderr="")

    monkeypatch.setattr(pe.subprocess, "run", fake_run)
    assert pe._run_variant("m.py", "value = 1", "value = 2") == []
    assert seen["src"] == "value = 2\n", "the mutation never reached the sandbox"
