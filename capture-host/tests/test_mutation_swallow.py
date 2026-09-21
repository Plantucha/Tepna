# tepna-capture — tests/test_mutation_swallow.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`mutation_swallow` + `tools/mutate_swallow` — residue `2026-09-20-fake-accepts-and-drops-is-suite-wide`.

The instrument that separates CANDIDATES (fakes that swallow — the grep-shaped population) from
survivors ATTRIBUTABLE to a swallowed argument (the intersection, the only defect-shaped number).
Every branch is driven; every plant is a control that the positive cannot pass vacuously."""
from __future__ import annotations

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))

import mutation_swallow as M  # noqa: E402
import mutate_swallow as T  # noqa: E402

FAKES = (
    "import asyncio\n"
    "print('a plain call before any fake')\n"                 # a non-setattr call first: `break` here loses every fake below
    "monkeypatch.setattr(mod, 'early', _later)\n"           # setattr BEFORE the def it binds
    "monkeypatch.setattr(mod, 'reader', _reader)\n"         # a bound def that READS its parameter — not a swallower
    "obj.reads2 = lambda x: x + 1\n"                         # an assigned lambda that reads — not a swallower
    "d['k'] = lambda *a: 1\n"                                # a subscript target has no name to report
    "def test_x(monkeypatch):\n"
    "    monkeypatch.setattr(mod, 'BleakClient', lambda addr, **kw: FakeClient())\n"
    "    monkeypatch.setattr(asyncio, 'sleep', _nosleep)\n"
    "    setattr(mod, 'plain', lambda *a: 1)\n"
    "    monkeypatch.setattr(mod, 'reads', lambda x: x + 1)\n"
    "    monkeypatch.setattr(mod, 'notafake', 42)\n"
    "    monkeypatch.setattr(mod, 'unknown_name', somewhere_else)\n"
    "    monkeypatch.setattr(mod, 'short')\n"
    "    monkeypatch.setattr(mod, 3, lambda *a: 1)\n"
    "    obj.method = lambda *a, **k: None\n"
    "    sleepfake = lambda *a, **k: None\n"                 # a bare-NAME target — the branch the Attribute case does not reach
    "    a, b = lambda: 1, 2\n"
    "async def _nosleep(secs):\n"
    "    return None\n"
    "def _later(*a):\n"
    "    return 1\n"
    "def _reader(n):\n"
    "    return n\n"
    "class FakeFh:\n"
    "    def seek(self, *a, **k):\n"
    "        return 0\n"
    "    def write(self, data, /, *, flush=False):\n"
    "        self.buf.append(data); return flush\n"
)


def test_parse_key_shapes():
    assert M.parse_key("-a | +b") == ("a", "b")
    assert M.parse_key("no separator") is None
    assert M.parse_key("+a | -b") is None
    assert M.parse_key("-a | -b") is None and M.parse_key("+a | +b") is None
    # a BEFORE line that itself contains ` | ` (a bitwise or) must not be cut at the wrong bar
    assert M.parse_key("-x = a | b | +x = a | c") == ("x = a | b", "x = a | c")
    # …and the FIRST ` | +` is the cut, pinned: the after side may carry one, the before side cannot
    assert M.parse_key("-a | +b | +c") == ("a", "b | +c")


def test_call_argument_of_every_branch():
    assert M.call_argument_of("client = C(addr, timeout=20.0)", "client = C(addr, timeout=21.0)") == {"callee": "C", "kind": "kw", "which": "timeout"}
    assert M.call_argument_of("    _t.seek(-1, 2)", "    _t.seek(+1, 2)") == {"callee": "seek", "kind": "pos", "which": 0}
    assert M.call_argument_of("return int(x, 10)", "return int(x, 11)") == {"callee": "int", "kind": "pos", "which": 1}
    assert M.call_argument_of("elif f(1):", "elif f(2):") == {"callee": "f", "kind": "pos", "which": 0}
    assert M.call_argument_of("await g(0.5)", "await g(1.5)") == {"callee": "g", "kind": "pos", "which": 0}
    assert M.call_argument_of("fh.write(data)", "fh.write(None)") == {"callee": "write", "kind": "pos", "which": 0}
    assert M.call_argument_of("f(**kw)", "f(**kz)") == {"callee": "f", "kind": "kw", "which": "**"}
    assert M.call_argument_of("f(a=1, b=2)", "f(a=1, b=3)") == {"callee": "f", "kind": "kw", "which": "b"}
    # innermost wins: the changed argument belongs to `inner`, not `outer`
    assert M.call_argument_of("outer(inner(1))", "outer(inner(2))") == {"callee": "inner", "kind": "pos", "which": 0}
    # an OUTER callee rename must not stop the walk before the inner argument mutation is seen
    assert M.call_argument_of("g(f(1))", "h(f(2))") == {"callee": "f", "kind": "pos", "which": 0}
    # an identical FIRST call must not stop the walk before the differing second one
    assert M.call_argument_of("f(1) + g(2)", "f(1) + g(3)") == {"callee": "g", "kind": "pos", "which": 0}
    assert M.call_argument_of("if f(1):   ", "if f(2):   ") == {"callee": "f", "kind": "pos", "which": 0}   # trailing blanks on a header line
    assert M.call_argument_of("x = f(1)", "x = g(1)") is None            # callee changed
    assert M.call_argument_of("if a > b:", "if a >= b:") is None         # no call at all
    assert M.call_argument_of("f(1)", "f(1, 2)") is None                 # shape changed → None, not a guess
    assert M.call_argument_of("f(1)", "def (:") is None                  # unparseable
    assert M.call_argument_of("f(1)", "f(1)") is None                    # identical
    assert M.call_argument_of("fs[0](1)", "fs[0](2)") is None            # a subscript callee has no name
    # …and a nameless callee must not stop the walk before a NAMED inner call's mutation
    assert M.call_argument_of("fs[0](g(1))", "fs[0](g(2))") == {"callee": "g", "kind": "pos", "which": 0}
    assert M.call_argument_of("f(1)", "g()(1)") is None                  # call count differs


def test_swallowing_fakes_every_shape():
    fakes = {(f["name"], f["shape"], tuple(f["unused"])) for f in M.swallowing_fakes(FAKES)}
    assert ("BleakClient", "setattr-lambda", ("addr", "kw")) in fakes
    assert ("sleep", "setattr-def", ("secs",)) in fakes
    assert ("early", "setattr-def", ("a",)) in fakes            # bound before its def — two-pass
    assert ("plain", "setattr-lambda", ("a",)) in fakes          # bare setattr()
    assert ("method", "lambda", ("a", "k")) in fakes             # attribute-target lambda
    assert ("sleepfake", "lambda", ("a", "k")) in fakes          # name-target lambda
    assert ("seek", "def", ("a", "k")) in fakes
    names = {f["name"] for f in M.swallowing_fakes(FAKES)}
    assert "write" not in names, "a method that reads every parameter is not a swallower"
    assert "reads" not in names
    assert "test_x" not in names
    assert "_nosleep" not in names and "_later" not in names, "a def bound by setattr is reported once, under the callee"
    assert "notafake" not in names and "unknown_name" not in names
    assert "reader" not in names and "reads2" not in names and "_reader" not in names
    assert None not in names, "a lambda assigned to a subscript has no name and must not be reported"
    assert M.swallowing_fakes("def (:") == []
    # the private helpers, driven at their own seams so a boundary mutation is visible
    import ast

    assert M._setattr_target(ast.parse("setattr(a, 'b')").body[0].value) == "b"      # 2 args: the name is still read
    assert M._setattr_target(ast.parse("setattr(a)").body[0].value) is None
    assert M._setattr_target(ast.parse("f(a, 'b', c)").body[0].value) is None
    assert M._unused(["a", "b"], ast.parse("a").body) == ["b"]                         # a list body (a def)
    assert M._unused(["a", "b"], ast.parse("b").body[0].value) == ["a"]                # an expr body (a lambda)
    assert M._callee_name(ast.parse("fs[0]").body[0].value) is None


def test_attribute_intersection_and_controls():
    surv = [
        {"module": "mod.py", "key": "-c = BleakClient(a, timeout=20.0) | +c = BleakClient(a, timeout=21.0)"},
        {"module": "mod.py", "key": "-await asyncio.sleep(0.5) | +await asyncio.sleep(1.5)"},
        {"module": "mod.py", "key": "-fh.write(data) | +fh.write(None)"},
        {"module": "mod.py", "key": "-if a > b: | +if a >= b:"},
        {"module": "mod.py", "key": "malformed"},
        {"module": "other.py", "key": "-c = BleakClient(a, timeout=20.0) | +c = BleakClient(a, timeout=21.0)"},
        {"module": "mod.py", "key": "-c = BleakClient(a, timeout=20.0) | +c = BleakClient(a, timeout=21.0)"},
        {"no": "module"},
        {"module": "mod.py", "key": None},                                     # a record with a module but no key
        {"module": "ghost.py", "key": "-x = int(v, 10) | +x = int(v, 11)"},   # a module with NO selection at all
    ]
    r = M.attribute(surv, {"mod.py": {"tests/test_mod.py": FAKES}, "other.py": {}})
    assert r["survivors"] == 7                 # the duplicate collapses; the malformed key is a record (read, then rejected); the module-less row is not
    assert r["call_argument"] == 5
    assert r["attributable"] == 2
    assert {row["callee"] for row in r["rows"]} == {"BleakClient", "sleep"}
    assert r["rows"][0]["fakes"][0]["test"] == "tests/test_mod.py"
    assert r["candidates"] == {"tests/test_mod.py": 7}
    # a fake outside the module's selection cannot have let the mutant survive
    r2 = M.attribute(surv[:1], {"mod.py": {}, "zzz.py": {"tests/test_zzz.py": FAKES}})
    assert r2["attributable"] == 0 and r2["call_argument"] == 1
    # the same test file feeding two modules is parsed once (cache) and counted once
    r3 = M.attribute(surv[:1], {"mod.py": {"tests/t.py": FAKES}, "other.py": {"tests/t.py": FAKES}})
    assert r3["candidates"] == {"tests/t.py": 7}


def test_tool_loads_selects_reports(tmp_path, capsys):
    d = tmp_path / "arts"
    (d / "deep").mkdir(parents=True)
    (d / "deep" / "a.json").write_text(json.dumps({"survivors": [
        {"module": "o2ring.py", "key": "-x = int(v, 10) | +x = int(v, 11)"}, "not-a-dict"]}), encoding="utf-8")
    (d / "b.json").write_text("{not json", encoding="utf-8")
    (d / "c.json").write_text(json.dumps([1, 2]), encoding="utf-8")
    (d / "d.json").write_text(json.dumps({"survivors": "nope"}), encoding="utf-8")
    single = tmp_path / "one.json"
    single.write_text(json.dumps({"survivors": [{"module": "o2ring.py", "key": "-if a > b: | +if a >= b:"}]}), encoding="utf-8")
    surv = T.load_survivors([str(d), str(single)])
    assert [s["key"] for s in surv] == ["-x = int(v, 10) | +x = int(v, 11)", "-if a > b: | +if a >= b:"]
    sel = T.selections({"o2ring.py"}, T.HERE / "tests")
    assert "tests/test_o2ring.py" in sel["o2ring.py"], "the gate's own selection puts the module's test first"
    # report with rows and without
    r = M.attribute(surv, {"o2ring.py": {"tests/test_x.py": "def int(*a):\n    return 0\n"}})
    text = T.report(r)
    assert "1 ATTRIBUTABLE" in text and "o2ring.py → int()" in text and "tests/test_x.py:1 (def) swallows a" in text
    assert "no survivor attributable" in T.report(M.attribute([], {}))
    # main: text, json, selftest, and the no-argument refusal
    assert T.main([str(single)]) == 0
    assert "mutate-swallow:" in capsys.readouterr().out
    assert T.main([str(single), "--json"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["survivors"] == 1 and out["call_argument"] == 0
    assert T.main(["--selftest"]) == 0
    assert "all 19 selftests passed" in capsys.readouterr().out
    with pytest.raises(SystemExit):
        T.main([])


def test_selftest_reports_a_planted_failure(monkeypatch, capsys):
    """The selftest's failure path is itself driven: break one check and the tool must say so and exit 1."""
    monkeypatch.setattr(M, "parse_key", lambda k: ("x", "y"))
    assert T.selftest() == 1
    out = capsys.readouterr().out
    assert "✗ parse_key rejects a malformed key" in out and "failed of 19" in out
