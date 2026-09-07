# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""THE RESUME PATH, END TO END — and the reason it is OFF by default.

`resume_strategy` has existed since G1 and was reachable only from the pure planner: the download
loop always sent offset 0, so the policy could not be exercised by the path that moves bytes. The
physical drop test that decides the policy was blocked on there being something to run it against.

⚠️ A CLEAN PULL AND A RESUMED PULL ARE NOT EQUALLY TRUSTED. A clean pull fails SHORT — visible in a
byte count. A resumed pull fails as a file of exactly the right size whose middle is wrong, which no
length check can see. That asymmetry is why `pull.resume` defaults OFF, why a resumed file is
verified before commit, and why a failure DISCARDS the `.part` instead of keeping it for the next
resume to splice onto.
"""
import hashlib
import os

import oxyii
import pull_session
from test_oxyii import _fmt_a_file
from test_pull_session import FakeRing, _install, _run

SESSION = "20260720010000"


def _blob(n=900):
    """A REAL Format-A file — header, position-dependent records, valid 48-byte trailer.

    ⚠️ Position-dependent on purpose: with a constant fill an off-by-one splice writes the right
    byte anyway and the hash comparison cannot see it. And a real trailer is required, not
    decoration — the resume path VERIFIES before committing, so a trailerless synthetic body is
    correctly discarded and the byte-identity assertion would never get a file to compare. (It
    didn't: the first version of this test built a bare blob and the gate refused it, which is the
    gate working.)"""
    return _fmt_a_file([(96, 50 + (i % 7), i % 3) for i in range(n)])


def _sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def test_RESUME_OFF_BY_DEFAULT_ALWAYS_OPENS_AT_ZERO(tmp_path, monkeypatch):
    """The measured-safe default. Until the drop test runs, re-serve is the only behaviour."""
    ring = FakeRing([SESSION], _blob())
    _install(monkeypatch, ring)
    part = tmp_path / f"Wellue_O2Ring-S_{SESSION}_STORED.dat.part"
    part.write_bytes(b"\xff" * 900)                 # a leftover that resume WOULD have used
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", False, None, "0000"))

    starts = [w for w in ring.writes if w[1] == oxyii.OP_FILE_START]
    offsets = [int.from_bytes(w[7:-1][16:20], "little") for w in starts]
    assert offsets == [0], f"re-serve must open at 0 only, got {offsets}"


def test_A_RESUMED_PULL_IS_BYTE_IDENTICAL_TO_A_CLEAN_ONE(tmp_path, monkeypatch):
    """🔴 THE VERIFICATION THE UNIT EXISTS FOR. Hash a clean pull, then hash a resumed pull of the
    same session, and require equality — the only check that can see a splice, because a spliced
    file has the right SIZE."""
    blob = _blob()
    clean_dir = tmp_path / "clean"; clean_dir.mkdir()
    _install(monkeypatch, FakeRing([SESSION], blob))
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(clean_dir), "all", False, None, "0000"))
    clean = clean_dir / f"Wellue_O2Ring-S_{SESSION}_STORED.dat"
    assert clean.exists(), sorted(os.listdir(clean_dir))

    # ...now the same session, with a genuine prefix already on disk from an interrupted pull.
    res_dir = tmp_path / "resumed"; res_dir.mkdir()
    part = res_dir / f"Wellue_O2Ring-S_{SESSION}_STORED.dat.part"
    part.write_bytes(blob[:1024])
    _install(monkeypatch, FakeRing([SESSION], blob))
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(res_dir), "all", True, None, "0000"))
    resumed = res_dir / f"Wellue_O2Ring-S_{SESSION}_STORED.dat"

    assert resumed.exists(), sorted(os.listdir(res_dir))
    assert _sha(resumed) == _sha(clean), "a resumed file must be byte-identical to a clean re-pull"


def test_THE_RING_IS_SEEKED_NOT_JUST_THE_FILE(tmp_path, monkeypatch):
    """A resume that repositions the local writer but keeps asking from 0 would re-download the whole
    file and splice it at the wrong place — right size, wrong middle."""
    blob = _blob()
    part = tmp_path / f"Wellue_O2Ring-S_{SESSION}_STORED.dat.part"
    part.write_bytes(blob[:1024])
    ring = FakeRing([SESSION], blob)
    _install(monkeypatch, ring)
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", True, None, "0000"))

    offsets = [int.from_bytes(w[7:-1][16:20], "little")
               for w in ring.writes if w[1] == oxyii.OP_FILE_START]
    assert 1024 in offsets, f"the ring was never asked to seek; STARTs were {offsets}"


def test_A_LONGER_STALE_PART_NEVER_REACHES_THE_SPLICE_AT_ALL(tmp_path, monkeypatch):
    """🔴 THE SPLICE IS UNREACHABLE FROM HERE, and the reason is worth stating rather than trusting.

    Two facts compose. `plan.offset` IS the `.part`'s size (resume_strategy returns `partial_bytes`),
    so `fh.read(plan.offset)` can never over-read — an off-by-one there gets nothing, because there
    is no byte after the end of the file it just measured. And a `.part` LONGER than the declared
    size takes resume_strategy's size-complete branch and re-serves from 0, so the stale tail is not
    read either.

    ⚠️ This test previously claimed to catch a stale-tail splice and could not: it asserted the
    absence of a 16-byte run of 0x99, in a scenario that never resumes. Planting `read(offset + 1)`
    left it green. It now asserts the mechanism that actually holds — the pull re-serves — so a
    change that made the splice REACHABLE would fail it here rather than pass quietly.

    The reachable off-by-one is the RING seek, and `test_THE_RING_IS_SEEKED_NOT_JUST_THE_FILE` plus
    the byte-identity test cover that one: planting `plan.offset - 1` on the START reds both."""
    blob = _blob()
    part = tmp_path / f"Wellue_O2Ring-S_{SESSION}_STORED.dat.part"
    part.write_bytes(blob[:1024] + b"\x99" * 4000)   # longer than the declared size
    ring = FakeRing([SESSION], blob)
    _install(monkeypatch, ring)
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", True, None, "0000"))

    offsets = [int.from_bytes(w[7:-1][16:20], "little")
               for w in ring.writes if w[1] == oxyii.OP_FILE_START]
    assert offsets == [0], f"an over-long .part must re-serve, not resume; STARTs were {offsets}"
    out = tmp_path / f"Wellue_O2Ring-S_{SESSION}_STORED.dat"
    assert out.exists() and out.read_bytes() == blob, "the recording differs from the ring's session"


def test_A_SIZE_COMPLETE_PART_RE_SERVES_RATHER_THAN_RESUMING_FOREVER(tmp_path, monkeypatch):
    """Size-complete but unfinalised means the TRAILER never flushed. Resuming from the end would
    append nothing and re-verify the same file forever."""
    blob = _blob()
    part = tmp_path / f"Wellue_O2Ring-S_{SESSION}_STORED.dat.part"
    part.write_bytes(blob)                            # already the full declared size
    ring = FakeRing([SESSION], blob)
    _install(monkeypatch, ring)
    _run(pull_session._pull_once("D1:98:62:7C:92:B3", str(tmp_path), "all", True, None, "0000"))

    offsets = [int.from_bytes(w[7:-1][16:20], "little")
               for w in ring.writes if w[1] == oxyii.OP_FILE_START]
    assert offsets == [0], f"a size-complete .part must re-serve, got STARTs at {offsets}"


def test_THE_STRATEGY_IS_STILL_THE_ONLY_PLACE_THE_CHOICE_IS_MADE():
    """G1 §5's invariant, provable by grep and worth keeping: the drop test must flip one function
    body, not a policy scattered through the loop."""
    from _srcscan import module_source
    src = module_source("pull_session.py")
    assert "resume_strategy(" in src
    assert src.count("oxy_transfer.RESUME") <= 2, "the RESUME decision is being re-derived inline"
