# tepna-capture — tests/test_verdict.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`tepna.verdict/1` — the Python half of VERDICT-CONTRACT §1. Every rule that refuses the
examined-nothing shape is planted here, one per assertion: the object a machine reads must not be
able to carry a pass about nothing."""

import json
import os

import pytest

import verdict

CRIT = {"name": "x", "threshold": 1, "unit": "count", "direction": "lte"}
POP = {"checked": 3, "eligible": 4, "excluded": 1}


def _ok(**kw):
    base = dict(
        gate="g",
        status="PASS",
        population=POP,
        criterion=CRIT,
        result={"n": 0},
        evidence=["tools/x.py"],
        reason=None,
        tool="tools/x.py",
        commit="abc1234",
    )
    base.update(kw)
    return verdict.make(**base)


def test_a_well_formed_pass_round_trips_and_carries_the_provenance_fields():
    o = _ok()
    assert o["schema"] == "tepna.verdict/1" and o["scope"] == "internal"
    assert o["producedBy"] == {"tool": "tools/x.py", "commit": "abc1234"}
    assert o["at"].endswith("Z") and "T" in o["at"]
    verdict.validate(json.loads(json.dumps(o)))


@pytest.mark.parametrize(
    "kw, msg",
    [
        (dict(status="pass"), "not one of"),  # no case variants
        (dict(status="SKIPPED"), "not one of"),  # no eighth value
        (dict(population={"checked": 2, "eligible": 4, "excluded": 1}), "must equal"),  # an equality, not a floor
        (dict(population={"checked": 0, "eligible": 0, "excluded": 0}), "examined-nothing"),
        (dict(evidence=[]), "needs evidence"),
        (dict(reason="looks fine"), "reason: null"),
        (dict(result=None), "carries a result"),
        (dict(status="FAIL", reason=None), "requires a reason"),
        (dict(status="NOT_RUN", reason="absent"), "carries result: null"),  # result must be null there
        (dict(status="FAIL", reason="missed", result=None), "carries a result"),
        (dict(status="UNDERPOWERED", reason="too few"), "as numbers"),
        (dict(commit="xyz"), "hex sha"),
        (dict(criterion={"name": "x", "threshold": "1", "unit": "count", "direction": "lte"}), "finite number"),
        (dict(criterion={"name": "x", "threshold": 1, "unit": "count", "direction": "within"}), "pair"),
        (dict(result=[1]), "object of measured"),
        (dict(criterion={"name": "x", "threshold": 1, "unit": "count", "direction": "below"}), "direction"),
        (dict(criterion={"name": "x", "threshold": 1}), "criterion must be"),
        (dict(population={"checked": True, "eligible": 1, "excluded": 0}), "non-negative integer"),
        (dict(evidence=["", "x"]), "non-empty strings"),
        (dict(gate=""), "gate must be"),
        (dict(criterion={"name": "", "threshold": 1, "unit": "count", "direction": "lte"}), "non-empty string"),
        (dict(criterion={"name": "x", "threshold": [0, "9"], "unit": "count", "direction": "within"}), "pair"),
        (dict(status="SHORTFALL", reason="tail", evidence=[]), "needs evidence"),
    ],
)
def test_every_examined_nothing_and_off_contract_shape_is_refused(kw, msg):
    with pytest.raises(ValueError, match=msg):
        _ok(**kw)


def test_a_within_criterion_takes_a_pair():
    o = _ok(criterion={"name": "x", "threshold": [0.5, 1.5], "unit": "ratio", "direction": "within"})
    assert o["criterion"]["threshold"] == [0.5, 1.5]


def test_not_run_and_not_applicable_are_distinct_values_both_with_a_reason():
    a = _ok(status="NOT_RUN", result=None, reason="input absent")
    b = _ok(status="NOT_APPLICABLE", result=None, reason="the rule does not bind here")
    assert a["status"] != b["status"]


def test_validate_refuses_a_non_utc_or_malformed_at_and_a_wrong_scope():
    o = _ok()
    o["at"] = "2026-09-21T18:40:12+02:00"
    with pytest.raises(ValueError, match="UTC"):
        verdict.validate(o)
    o = _ok()
    o["at"] = "yesterdayZ"
    with pytest.raises(ValueError):
        verdict.validate(o)
    o = _ok()
    o["scope"] = "public"
    with pytest.raises(ValueError, match="scope"):
        verdict.validate(o)
    o = _ok()
    o["producedBy"] = {"tool": "x"}
    with pytest.raises(ValueError, match="producedBy"):
        verdict.validate(o)
    o = _ok()
    o["producedBy"] = {"tool": "x", "commit": 7}
    with pytest.raises(ValueError, match="hex sha or null"):
        verdict.validate(o)
    o = _ok()
    o["producedBy"] = {"tool": "x", "commit": None}
    with pytest.raises(ValueError, match="commitReason"):
        verdict.validate(o)
    o = _ok()
    o["scope"] = "publishable"
    verdict.validate(o)  # the other legal scope
    with pytest.raises(ValueError, match="schema"):
        verdict.validate({"schema": "tepna.verdict/2"})
    o = _ok()
    o["population"] = [3, 4, 1]
    with pytest.raises(ValueError, match="population must be"):
        verdict.validate(o)


def test_unknown_names_the_exception_and_examines_nothing():
    o = verdict.unknown(gate="g", criterion=CRIT, evidence=["t"], tool="t", exc=RuntimeError("disk gone"))
    assert o["status"] == "UNKNOWN" and o["reason"] == "the gate raised RuntimeError: disk gone"
    assert o["population"] == {"checked": 0, "eligible": 0, "excluded": 0} and o["result"] is None


def test_write_is_atomic_and_validates_first(tmp_path):
    p = str(tmp_path / "V.json")
    verdict.write(p, _ok())
    assert json.load(open(p))["status"] == "PASS" and not os.path.exists(p + ".tmp")
    bad = _ok()
    bad["status"] = "MAYBE"
    with pytest.raises(ValueError):
        verdict.write(p, bad)
    assert json.load(open(p))["status"] == "PASS"  # the good file is untouched by the refused write


def test_commit_sha_is_probed_once_and_null_without_git(monkeypatch):
    calls = []
    monkeypatch.setattr(verdict, "_commit", False)
    monkeypatch.setattr(
        verdict.build_id, "probe", lambda d: calls.append(d) or {"git": None, "dirty": None, "started": 0.0}
    )
    assert verdict.commit_sha("/nowhere") is None
    assert verdict.commit_sha("/nowhere") is None and len(calls) == 1  # cached: one subprocess, ever
    o = verdict.make(
        gate="g",
        status="NOT_RUN",
        population={"checked": 0, "eligible": 0, "excluded": 0},
        criterion=CRIT,
        result=None,
        evidence=["t"],
        reason="absent",
        tool="t",
    )
    assert o["producedBy"]["commit"] is None  # null, never a placeholder
    assert o["producedBy"]["commitReason"] == verdict.NO_GIT_REASON  # and the null says why (∅)


# ── THE JS VALIDATOR IS THE CONTRACT; the Python half must agree with it ─────────────────────────────

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def js_validate(obj):
    """Run verdict.js (#2797) on an object under node. Skips when node is absent (the box has none)."""
    import shutil
    import subprocess

    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed — verdict.js cannot run here")
    prog = (
        "const V=require(process.argv[1]); const o=JSON.parse(process.argv[2]);"
        "console.log(JSON.stringify(V.validate(o)));"
    )
    r = subprocess.run(
        [node, "-e", prog, os.path.join(ROOT, "verdict.js"), json.dumps(obj)],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


@pytest.mark.parametrize(
    "status, extra",
    [
        ("PASS", {}),
        ("FAIL", {"reason": "missed by 2"}),
        ("SHORTFALL", {"reason": "the tail missed"}),
        ("UNDERPOWERED", {"reason": "3 checked, minimum 10"}),
        ("NOT_RUN", {"reason": "absent", "result": None}),
        ("NOT_APPLICABLE", {"reason": "does not bind", "result": None}),
        ("UNKNOWN", {"reason": "the gate raised X"}),
    ],
)
def test_every_status_the_python_half_accepts_is_accepted_by_verdict_js(status, extra):
    o = _ok(status=status, **extra)
    v = js_validate(o)
    assert v["ok"], v["errors"]
    o2 = _ok(status=status, **extra)  # the no-checkout shape, with its reason
    o2["producedBy"] = {"tool": "t", "commit": None, "commitReason": verdict.NO_GIT_REASON}
    verdict.validate(o2)
    assert js_validate(o2)["ok"], js_validate(o2)["errors"]


def test_what_verdict_js_refuses_the_python_half_refuses_too():
    for bad in (
        {"status": "pass"},
        {"population": {"checked": 0, "eligible": 0, "excluded": 0}},
        {"evidence": []},
        {"reason": "fine"},
        {"commit": "xyz"},
    ):
        o = _ok()
        o.update(bad if "commit" not in bad else {"producedBy": {"tool": "t", "commit": "xyz"}})
        assert not js_validate(o)["ok"], bad
        with pytest.raises(ValueError):
            verdict.validate(o)
