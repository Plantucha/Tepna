#!/usr/bin/env python3
# tepna-capture — tools/seq_suite.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Run the whole suite in ONE ordered process, and name every test the order exposed.

THE BLIND SPOT. `check.sh` runs pytest under xdist (`-n auto`), so this suite has never executed as one
ordered process, and a test that depends on what ran before it cannot be observed by any gate here: it
passes alone, passes in its file, and passes in every green `check.sh`. Residue row
`2026-10-04-the-suite-is-never-run-sequentially-so-order-dependencies-are-invisible` found one by
instance. `test_run_polar_live_contract.py::test_A_ZERO_STAMPED_FRAME_PUBLISHES_NO_SKEW_AT_ALL` asserted
that an ABSENT record reaches the journal, while `capture._CLOCK_ABSENT` records the pairs already
declared THIS PROCESS. In one ordered process an earlier test consumes the onset and the assertion finds
nothing. Until this tool existed the one place the repo ran everything in order was the mutation gate's
clean run, which looks only at the covering set of whatever module a diff happens to touch.

THE SHAPE IS THE OWNER'S, ruled 2026-10-04 on that row: a rig user timer runs the whole suite in one
ordered process with no xdist, scheduled clear of the mutation crawl's window, and emits ONE
`tepna.verdict/1` to a tracked path a bird reads in the morning. A failure files nothing by itself.

⚠️ A FAILURE IS NOT YET AN ORDER DEPENDENCY, so this tool does not report one. It re-runs each failing
test ALONE, and splits the failures by what that second run says: `orderDependent` passed alone and
therefore failed only because of its neighbours, `failsAlone` is simply red on this tree and belongs to
whoever broke it. The split is the product — without it a bird cannot tell a blind spot from a bug.

⚠️ THE CRITERION IS THE ORDERED RUN, NOT THE SPLIT. `ordered_run_failures <= 0` is pre-stated, and any
failure is a FAIL, because a red ordered suite is a red suite whichever half it lands in. A criterion
keyed to `orderDependent` alone would report PASS over a suite that cannot run.

⚠️ A `NOT_RUN` CARRIES `result: null` — the contract refuses one that does not, so the detail of a
skipped pass (which lock, which collect exit) lives in its `reason` and nowhere else.

⚠️ `checked` COMES FROM THE JUNIT XML, NEVER FROM THE COLLECTION. The collection says what was
eligible; only the run says what executed. pytest can abort a run after an error, and a `checked` copied
from the collection would then report a population the run never examined — the examined-nothing shape
this contract exists to refuse. `excluded` is the difference, and it carries a reason.

Coverage instrumentation stays ON, because the 180 s per-test bound in `check.sh` was derived WITH it
(the slowest test there is 31.98 s bare and 36.99 s instrumented). The floor is NOT asserted here: a
coverage shortfall is `check.sh`'s verdict, and asserting it would file it under this gate's name.

Usage:
    python3 tools/seq_suite.py                        # run, print the verdict object
    python3 tools/seq_suite.py --verdict-out PATH     # …and write it atomically beside a log
    python3 tools/seq_suite.py --lock PATH            # skip with NOT_RUN while the rig lock is held
    python3 tools/seq_suite.py --verdict-sample       # the adoption gate's object (synthetic)
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

sys.path.insert(0, HERE)
import verdict as VD  # noqa: E402

GATE = "seq-suite"
TOOL = "capture-host/tools/seq_suite.py"
TIMEOUT_S = 180
# Pre-stated, and it names the ORDERED RUN rather than the split (see the docstring).
CRITERION = {"name": "ordered_run_failures", "threshold": 0, "unit": "tests", "direction": "lte"}
LOCK_BUSY = "the rig lock at {path} is held by another run, so this pass examined nothing"
COLLECT_FAILED = (
    "pytest could not enumerate the suite (collect exit {rc}, {n} id(s) printed), so no ordered run was attempted"
)
OVER_COUNT = "the junit report counts more tests than the collection offered"


def _run(cmd: list[str], cwd: str) -> tuple[int, str]:
    """One subprocess, stdout and stderr merged. The merge is deliberate: pytest writes a collection
    error to stderr and the short summary to stdout, and a reader of one of them alone sees a run that
    examined nothing as a run with nothing to report."""
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=False)
    return p.returncode, p.stdout + p.stderr


def collect_order(out: str) -> list[str]:
    """The node ids `--collect-only -q` prints, in collection order — which IS the execution order.

    A node id is taken by shape (`::` in a line that starts at column 0) rather than by position,
    because the same stream carries a trailing count line and, on a bad tree, a traceback. The
    column-0 test carries no empty-string case: a line holding `::` is never empty, so a guard for it
    would be a branch no input can separate — the shape the mutation gate named in `nights_index`
    on 2026-10-20."""
    order = []
    for ln in out.splitlines():
        if "::" in ln and ln[:1] not in (" ", "\t"):
            order.append(ln.strip())
    return order


def failing_ids(out: str) -> list[str]:
    """The node ids of the short summary (`-rf`), which is the only place pytest prints a failure's id
    verbatim. The junit XML carries a DOTTED classname instead, and rebuilding an id from it loses the
    file path of any test in a class — so counts come from the XML and identities come from here."""
    ids = []
    for ln in out.splitlines():
        head = ln.split(" ", 1)
        if head[0] in ("FAILED", "ERROR") and len(head) == 2:
            ids.append(head[1].split(" - ", 1)[0].strip())
    return ids


def junit_checked(xml_text: str) -> int | None:
    """How many test cases the RUN executed, from `<testsuite tests=…>`. None when the file is absent
    or unreadable: a population this tool cannot state is one it must not invent."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None
    suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
    total = 0
    for s in suites:
        total += int(s.get("tests", "0"))
    return total


def _read(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return None


def _lock(path: str):
    """Hold the rig lock for the whole run, or return None when another run has it. `flock` and not a
    pid file: a crawl SIGKILLed mid-mutation leaves a pid file behind and a lock it never held."""
    fh = open(path, "a+", encoding="utf-8")
    try:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        fh.close()
        return None
    return fh


def _positions(order: list[str], ids: list[str]) -> dict[str, int | None]:
    """1-based execution position per failing id, or None when the id is not in the collection. An
    absent position is reported rather than guessed: a parametrised id the collection printed
    differently is a real gap in this tool, and a fabricated index would hide it."""
    index = {n: i + 1 for i, n in enumerate(order)}
    return {n: index.get(n) for n in ids}


def classify(
    ids: list[str], order: list[str], python: str, cwd: str, timeout: int, run=_run
) -> tuple[list[dict], list[dict]]:
    """Re-run each failing test ALONE and split by what that says. Passing alone means the neighbours
    failed it; failing alone means the tree is red and the order had nothing to do with it."""
    pos = _positions(order, ids)
    dependent, alone = [], []
    for nodeid in ids:
        rc, _ = run([python, "-m", "pytest", "-q", "-p", "no:xdist", f"--timeout={timeout}", nodeid], cwd)
        row = {"nodeid": nodeid, "position": pos[nodeid], "of": len(order)}
        (dependent if rc == 0 else alone).append(row)
    return dependent, alone


def _verdict(
    *, status: str, population: dict, result, evidence: list, reason: str | None, at: str | None = None
) -> dict:
    return VD.make(
        gate=GATE,
        status=status,
        population=population,
        criterion=dict(CRITERION),
        result=result,
        evidence=evidence,
        reason=reason,
        tool=TOOL,
        at=at,
    )


def sample() -> dict:
    """The adoption gate reads a real object from every tool that prints a verdict word, and this is
    the one shape that costs no suite run."""
    return _verdict(
        status="PASS",
        population={"checked": 10761, "eligible": 10761, "excluded": 0},
        result={"orderDependent": [], "failsAlone": [], "wallSec": 1131.0},
        evidence=[TOOL],
        reason=None,
    )


def run_once(*, python: str, cwd: str, timeout: int, junit: str, lock: str | None, run=_run) -> dict:
    """One ordered pass: take the lock, enumerate, run, split, answer in the fixed shape."""
    held = None
    if lock is not None:
        held = _lock(lock)
        if held is None:
            return _verdict(
                status="NOT_RUN",
                population={"checked": 0, "eligible": 0, "excluded": 0},
                result=None,
                evidence=[TOOL],
                reason=LOCK_BUSY.format(path=lock),
            )
    try:
        rc, out = run([python, "-m", "pytest", "--collect-only", "-q", "-p", "no:xdist"], cwd)
        order = collect_order(out)
        if rc != 0 or not order:
            return _verdict(
                status="NOT_RUN",
                population={"checked": 0, "eligible": len(order), "excluded": len(order)},
                result=None,
                evidence=[TOOL],
                reason=COLLECT_FAILED.format(rc=rc, n=len(order)),
            )
        t0 = time.monotonic()
        _, out = run(
            [
                python,
                "-m",
                "pytest",
                "-q",
                "--cov",
                "--cov-branch",
                "-p",
                "no:xdist",
                f"--timeout={timeout}",
                "-rf",
                f"--junitxml={junit}",
            ],
            cwd,
        )
        wall = round(time.monotonic() - t0, 1)
        ids = failing_ids(out)
        xml_text = _read(junit)
        checked = None if xml_text is None else junit_checked(xml_text)
        if checked is None:
            return _verdict(
                status="UNKNOWN",
                population={"checked": 0, "eligible": len(order), "excluded": len(order)},
                result={"failed": ids, "wallSec": wall},
                evidence=[TOOL, junit],
                reason=f"the junit report at {junit} is absent or unreadable, so the run has no population",
            )
        if checked > len(order):
            return _verdict(
                status="UNKNOWN",
                population={"checked": 0, "eligible": len(order), "excluded": len(order)},
                result={"junitTests": checked, "collected": len(order), "wallSec": wall},
                evidence=[TOOL, junit],
                reason=OVER_COUNT,
            )
        dependent, alone = classify(ids, order, python, cwd, timeout, run=run)
        population = {"checked": checked, "eligible": len(order), "excluded": len(order) - checked}
        result = {"orderDependent": dependent, "failsAlone": alone, "wallSec": wall}
        if not ids:
            return _verdict(status="PASS", population=population, result=result, evidence=[TOOL, junit], reason=None)
        return _verdict(
            status="FAIL",
            population=population,
            result=result,
            evidence=[TOOL, junit],
            reason=(f"{len(dependent)} test(s) pass alone and failed only in order, {len(alone)} fail alone as well"),
        )
    finally:
        if held is not None:
            held.close()


def main(argv: list[str] | None = None, run=_run) -> int:
    ap = argparse.ArgumentParser(description="run the suite in one ordered process")
    ap.add_argument("--python", default=sys.executable)
    ap.add_argument("--cwd", default=HERE)
    ap.add_argument("--timeout", type=int, default=TIMEOUT_S)
    ap.add_argument("--junit", default=os.path.join(HERE, ".seq-suite-junit.xml"))
    ap.add_argument("--lock", default=None)
    ap.add_argument("--verdict-out", default=None)
    ap.add_argument("--verdict-sample", action="store_true")
    a = ap.parse_args(argv)
    if a.verdict_sample:
        print(json.dumps(sample(), indent=2))
        return 0
    v = run_once(python=a.python, cwd=a.cwd, timeout=a.timeout, junit=a.junit, lock=a.lock, run=run)
    print(json.dumps(v, indent=2))
    if a.verdict_out:
        VD.write(a.verdict_out, v)
    # The exit code carries the verdict so the unit's journal shows it, and a bird still reads the
    # object: a FAIL files nothing by itself (the owner's ruling on the row).
    return 0 if v["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
