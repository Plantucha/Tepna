# tepna-capture — tests/test_fixture_provenance.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`tests/FIXTURE-PROVENANCE.json` — which test fixtures carry REAL bytes, held as an EQUALITY.

The registry exists so a tool can tell a test that embeds a captured device frame, host output or a real
night's numbers from one whose bytes were built in the test — `tools/codex-export.mjs` omits the first kind
before any source leaves the box. A registry that could fall behind the tree would make that omission
silently incomplete, so the population is COMPUTED here and must equal the registry's keys both ways: a new
file with a timestamp, a long hex literal or a non-.py fixture fails until someone classifies it.

Census 2026-10-04 (Wren): no test embeds a captured row BLOCK — the longest run of stamped data-row lines in
any file is 7 — so "captured" here means device frames, real addresses, host output and transcribed values.
"""

import hashlib
import json
import os
import re

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
REGISTRY = os.path.join(HERE, "FIXTURE-PROVENANCE.json")
CLASSES = ("captured", "derived", "format", "synthetic", "authored")
ISO = re.compile(r"20\d\d-[01]\d-[0-3]\d[T ][0-2]\d:[0-5]\d")
HEX = re.compile(r'(?:fromhex\(\s*|b?["\'])((?:[0-9a-fA-F]{2}[ ]?){24,})["\']')
MAC = re.compile(r"\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b")
SELF = {"FIXTURE-PROVENANCE.json", os.path.basename(__file__)}


def population(root: str) -> dict:
    """{relative path: text} for every file the registry must classify."""
    out = {}
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d != "__pycache__"]
        for f in fn:
            rel = os.path.relpath(os.path.join(dp, f), root)
            if rel in SELF or f.endswith(".pyc"):
                continue
            with open(os.path.join(dp, f), "rb") as fh:
                raw = fh.read()
            s = raw.decode("utf-8", "replace")
            if not f.endswith(".py") or ISO.search(s) or HEX.search(s):
                out[rel] = raw
    return out


def problems(root: str, reg: dict) -> list[str]:
    """Every way the registry disagrees with the tree. Empty means consistent."""
    pop = population(root)
    ent = reg.get("entries") or {}
    synth = {a.upper() for a in reg.get("synthetic_addresses") or []}
    out = [f"UNCLASSIFIED: {p}" for p in sorted(set(pop) - set(ent))]
    out += [f"STALE (no longer in the population): {p}" for p in sorted(set(ent) - set(pop))]
    for p, e in sorted(ent.items()):
        if e.get("class") not in CLASSES:
            out.append(f"BAD CLASS {e.get('class')!r}: {p}")
        if not (e.get("kind") and e.get("source")):
            out.append(f"NO kind/source: {p}")
        if p not in pop:
            continue
        real = sorted({m.upper() for m in MAC.findall(pop[p].decode("utf-8", "replace"))} - synth)
        if real and e.get("class") != "captured":
            out.append(f"REAL ADDRESS in a {e.get('class')} file: {p} ({', '.join(real[:3])})")
        if not p.endswith(".py") and e.get("class") in ("captured", "derived"):
            if hashlib.sha256(pop[p]).hexdigest() != e.get("sha256"):
                out.append(f"SHA MISMATCH on a {e.get('class')} fixture: {p}")
    return out


def _reg():
    with open(REGISTRY, encoding="utf-8") as fh:
        return json.load(fh)


def test_the_registry_EQUALS_the_tree():
    bad = problems(HERE, _reg())
    assert not bad, "FIXTURE-PROVENANCE.json disagrees with the tree:\n  " + "\n  ".join(bad)


def test_the_synthetic_address_list_is_addresses_and_sorted():
    synth = _reg()["synthetic_addresses"]
    assert synth == sorted(synth) and all(MAC.fullmatch(a) for a in synth)


# ── PLANTS: each must red the check, on a copy of the registry against a planted tree ─────────────


@pytest.fixture
def tree(tmp_path):
    (tmp_path / "test_plain.py").write_text("x = 1\n")
    (tmp_path / "test_stamped.py").write_text('T = "2026-08-19T21:00:00.000"\n')
    (tmp_path / "wire").mkdir()
    (tmp_path / "wire" / "dev.json").write_text('{"address": "AA:BB:CC:DD:EE:01"}\n')
    reg = {
        "synthetic_addresses": ["AA:BB:CC:DD:EE:01"],
        "entries": {
            "test_stamped.py": {"class": "authored", "kind": "k", "source": "s", "sha256": None},
            "wire/dev.json": {"class": "synthetic", "kind": "k", "source": "s", "sha256": None},
        },
    }
    return tmp_path, reg


def test_PLANT_the_consistent_tree_passes(tree):
    root, reg = tree
    assert problems(str(root), reg) == []


def test_PLANT_a_new_stamped_file_reds_until_classified(tree):
    root, reg = tree
    (root / "test_new.py").write_text('B = bytes.fromhex("' + "ab" * 24 + '")\n')
    assert problems(str(root), reg) == ["UNCLASSIFIED: test_new.py"]


def test_PLANT_a_registry_entry_for_a_file_that_left_the_population_reds(tree):
    root, reg = tree
    (root / "test_stamped.py").write_text("x = 2\n")
    assert problems(str(root), reg) == ["STALE (no longer in the population): test_stamped.py"]


def test_PLANT_a_real_address_makes_the_file_captured(tree):
    root, reg = tree
    (root / "test_stamped.py").write_text('T = "2026-08-19T21:00:00"\nA = "24:AC:AC:02:84:96"\n')
    assert problems(str(root), reg) == ["REAL ADDRESS in a authored file: test_stamped.py (24:AC:AC:02:84:96)"]


def test_PLANT_a_captured_fixture_that_changes_bytes_reds(tree):
    root, reg = tree
    raw = (root / "wire" / "dev.json").read_bytes()
    reg["entries"]["wire/dev.json"] = {
        "class": "captured",
        "kind": "k",
        "source": "s",
        "sha256": hashlib.sha256(raw).hexdigest(),
    }
    assert problems(str(root), reg) == []
    (root / "wire" / "dev.json").write_bytes(raw + b" ")
    assert problems(str(root), reg) == ["SHA MISMATCH on a captured fixture: wire/dev.json"]


def test_PLANT_an_unknown_class_and_a_missing_source_red(tree):
    root, reg = tree
    reg["entries"]["test_stamped.py"] = {"class": "real", "kind": "", "source": "", "sha256": None}
    assert problems(str(root), reg) == ["BAD CLASS 'real': test_stamped.py", "NO kind/source: test_stamped.py"]
