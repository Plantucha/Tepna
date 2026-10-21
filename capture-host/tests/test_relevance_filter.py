# tepna-capture — tests/test_relevance_filter.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE DEFECT THIS CLOSES (residue 2026-10-20-capture-host-relevance-filter-skips-the-tools-change-that-reds-it).
# capture-host-ci's `changes` job skipped the Python matrix for any diff outside `capture-host/`, on the
# argument that tests/conftest.py puts only capture-host/ on sys.path. That argument is about what the
# suite IMPORTS. The suite also READS repo-root files as data through a `ROOT` anchor, so a change to
# `tools/mutate.mjs` reded this suite in a job that had skipped it — a filter mis-answering toward SKIP,
# which is the blind-gate shape CLAUDE.md §4b names.
#
# Three legs, in the order the fix was built:
#   1. the SET is measured, not guessed — `tools/root_reads.py` traces which root paths the suite opens;
#   2. the FILTER names that set — `tools/relevance.sh`, the one implementation CI also calls;
#   3. this module asserts the two agree, and that a new root anchor in the suite reds rather than
#      quietly aging the manifest.
#
# The control is the SKIP. A diff touching only a repo-root file outside the measured set must still
# read `false`, or the filter has stopped filtering and the ~80 s it exists to save is gone.

import json
import os
import pathlib
import re
import subprocess

import pytest

from tools import root_reads

HERE = pathlib.Path(__file__).resolve().parent
CH = HERE.parent
ROOT = CH.parent
SCRIPT = CH / "tools" / "relevance.sh"
MANIFEST = CH / "tools" / "root-reads.json"
WORKFLOW = ROOT / ".github" / "workflows" / "capture-host-ci.yml"


def decide(changed, manifest=None):
    """Run the committed filter the way CI runs it. The test never re-implements the decision: a test
    that re-writes the extraction it is checking agrees with itself, never with the job."""
    env = dict(os.environ)
    if manifest is not None:
        env["ROOT_READS_MANIFEST"] = str(manifest)
    r = subprocess.run(
        ["bash", str(SCRIPT)],
        input="\n".join(changed),
        capture_output=True,
        text=True,
        check=True,
        env=env,
    )
    return r.stdout.strip()


# ---------------------------------------------------------------- the filter


def test_the_manifest_is_a_nonempty_measured_set():
    rec = json.loads(MANIFEST.read_text())
    assert rec["schema"] == root_reads.SCHEMA
    assert "--cov-fail-under=100" in rec["command"]
    assert len(rec["paths"]) >= 40, "a manifest this short means the trace measured almost nothing"


def test_every_manifest_path_runs_the_suite():
    for entry in json.loads(MANIFEST.read_text())["paths"]:
        assert decide([entry["path"]]) == "true", entry["path"]


def test_the_scripts_extraction_equals_the_json():
    """The script reads the manifest line by line, so a format change must red here rather than
    silently shorten the set it filters on."""
    listed = decide([], manifest=MANIFEST)  # unused, keeps the usage symmetric
    assert listed in {"true", "false"}
    out = subprocess.run(["bash", str(SCRIPT), "--list"], capture_output=True, text=True, check=True).stdout.split("\n")
    extracted = [line for line in out if line]
    assert extracted == [e["path"] for e in json.loads(MANIFEST.read_text())["paths"]]


def test_a_capture_host_change_runs_the_suite():
    assert decide(["capture-host/x"]) == "true"


def test_the_workflow_runs_the_suite_even_without_the_manifest():
    """The workflow owns the matrix, the pins and the coverage floor, so it is a second rail in the
    script rather than a manifest entry that a re-measure could drop."""
    assert decide([".github/workflows/capture-host-ci.yml"], manifest=MANIFEST) == "true"


# THE CONTROL PATHS, ASSEMBLED FROM FRAGMENTS AND DELIBERATELY SO. `mutation_diff.root_reads` turns any
# root filename a test NAMES into a root read, so a control spelled as a literal joins the measured set
# and stops being a control — a name-indexed instrument measuring the file that reads it. The repo's
# top-level readme is in the set for exactly that reason, which is why it is not the control here.
CONTROLS = ["CLAUDE" + ".md", "package" + ".json", "OxyDex" + ".html"]


def test_an_unrelated_root_file_still_skips():
    """THE CONTROL. Without this the filter could read `true` for everything and every leg above would
    still pass."""
    for c in CONTROLS:
        assert decide([c]) == "false", c
    assert decide(CONTROLS) == "false"


def test_an_empty_diff_runs_the_suite():
    assert decide([]) == "true"


def test_a_blank_line_in_the_diff_is_not_a_path():
    assert decide([CONTROLS[0], "", CONTROLS[1]]) == "false"


def test_one_measured_path_among_unrelated_ones_runs_the_suite():
    assert decide([CONTROLS[0], "clock.js", CONTROLS[1]]) == "true"


def test_the_script_refuses_an_unknown_argument():
    r = subprocess.run(["bash", str(SCRIPT), "--what"], capture_output=True, text=True, check=False)
    assert r.returncode == 2
    assert "usage" in r.stderr


def test_the_workflow_calls_the_script_and_inlines_no_copy_of_it():
    text = WORKFLOW.read_text()
    assert "capture-host/tools/relevance.sh" in text
    assert "capture-host/*|.github" not in text, "the old inlined decision is back"


def test_the_static_derivation_and_the_manifest_agree():
    """THE TRIPWIRE THAT COSTS NOTHING. `mutation_diff.root_reads` already derives root reads from the
    test sources for the mutation scratch. It runs on every suite run, so making the manifest a
    superset of it means a test that newly NAMES a root file reds here instead of aging the manifest
    silently. It cannot see a constructed path, which is why the traced half exists as well."""
    rec = json.loads(MANIFEST.read_text())
    manifest = {e["path"] for e in rec["paths"]}
    named = root_reads.named_root_reads(ROOT)
    assert named - manifest == set(), "re-run the fold: a test names a root file the manifest omits"
    assert {e["path"] for e in rec["paths"] if "named" in e["found"]} == named


# ---------------------------------------- the tripwire over the measured set

# Every file in this suite that reaches ABOVE capture-host, i.e. builds a path to the repo root. Each
# one is a reason the manifest exists; a fifth means the trace is out of date and must be re-run.
# `parents[1]` is capture-host itself and is not a root anchor.
ROOT_ANCHORS = {
    "test_verdict.py",
    "test_webmon_nights.py",
    "test_worn_precedence.py",
    "test_writers_sidecars.py",
}
_ANCHOR = re.compile(r"parents\[2\]|dirname\(os\.path\.dirname\(os\.path\.dirname\(")


def test_the_root_anchor_set_is_the_measured_one():
    found = {p.name for p in sorted(HERE.glob("test_*.py")) if _ANCHOR.search(p.read_text())}
    assert found == ROOT_ANCHORS, (
        "a test now reaches the repo root through a path the manifest was not measured under — "
        "re-run tools/root_reads.py and re-fold tools/root-reads.json"
    )


# ------------------------------------------------- the tracer, unit by unit


def test_repo_root_is_above_capture_host():
    assert root_reads.repo_root() == ROOT


@pytest.mark.parametrize(
    "p,expect",
    [
        (3, None),  # a file descriptor, not a path
        (b"clock.js", "clock.js"),  # bytes, which is what a traced argv often carries
        (str(ROOT / "clock.js"), "clock.js"),
        (str(CH / "oxyii.py"), None),  # inside capture-host, which the filter already covers
        (str(CH), None),  # capture-host itself
        ("/etc/hostname", None),  # outside the repo
    ],
)
def test_relativise(p, expect):
    assert root_reads.relativise(p, ROOT, str(ROOT)) == expect


def test_relativise_resolves_a_relative_path_against_the_given_cwd():
    assert root_reads.relativise("clock.js", ROOT, str(ROOT)) == "clock.js"


def test_relativise_rejects_a_type_that_is_not_a_path():
    assert root_reads.relativise(object(), ROOT, str(ROOT)) is None


def test_record_keeps_only_root_paths():
    seen = {}
    assert root_reads.record(seen, str(ROOT / "clock.js"), "read", ROOT, str(ROOT)) == "clock.js"
    assert root_reads.record(seen, "/etc/hostname", "read", ROOT, str(ROOT)) is None
    root_reads.record(seen, str(ROOT / "clock.js"), "exec", ROOT, str(ROOT))
    assert seen == {"clock.js": {"read", "exec"}}


@pytest.mark.parametrize(
    "mode,expect", [("r", False), ("rb", False), ("w", True), ("a", True), ("r+", True), (None, False)]
)
def test_mode_is_write(mode, expect):
    assert root_reads._mode_is_write(mode) is expect


def test_audit_records_an_open_with_and_without_a_mode():
    seen = {}
    root_reads.audit("open", (str(ROOT / "clock.js"), "r", 0), seen, ROOT, str(ROOT))
    root_reads.audit("open", (str(ROOT / "verdict.js"),), seen, ROOT, str(ROOT))
    root_reads.audit("open", (str(ROOT / "out.json"), "w"), seen, ROOT, str(ROOT))
    assert seen == {"clock.js": {"read"}, "verdict.js": {"read"}, "out.json": {"write"}}


def test_audit_records_every_argv_member_of_a_subprocess():
    seen = {}
    root_reads.audit(
        "subprocess.Popen",
        ("/usr/bin/node", [str(CH / "node"), str(ROOT / "tools" / "mutate.mjs"), 7], None, None),
        seen,
        ROOT,
        str(ROOT),
    )
    assert seen == {"tools/mutate.mjs": {"exec"}}


def test_audit_tolerates_a_popen_without_an_argv_list():
    seen = {}
    root_reads.audit("subprocess.Popen", (str(ROOT / "clock.js"),), seen, ROOT, str(ROOT))
    assert seen == {"clock.js": {"exec"}}


def test_audit_ignores_an_unrelated_event():
    seen = {}
    assert root_reads.audit("import", ("os",), seen, ROOT, str(ROOT)) == []
    assert seen == {}


def test_dump_appends_one_line_per_path(tmp_path):
    out = tmp_path / "deep" / "trace.jsonl"
    root_reads.dump({"clock.js": {"read"}}, out)
    root_reads.dump({"verdict.js": {"read", "exec"}}, out)
    lines = [json.loads(line) for line in out.read_text().split("\n") if line]
    assert lines == [
        {"path": "clock.js", "how": ["read"]},
        {"path": "verdict.js", "how": ["exec", "read"]},
    ]


def test_install_registers_a_hook_that_records(tmp_path):
    hooks, exits = [], []
    seen = root_reads.install(tmp_path / "t.jsonl", ROOT, hooks.append, exits.append, str(ROOT))
    assert len(hooks) == 1 and len(exits) == 1
    assert hooks[0]("open", (str(ROOT / "clock.js"), "r")) is None, "a hook must not return a value"
    assert seen == {"clock.js": {"read"}}
    exits[0]()
    assert (tmp_path / "t.jsonl").read_text().strip() == json.dumps({"path": "clock.js", "how": ["read"]})


def test_install_defaults_to_the_real_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(ROOT)
    hooks, exits = [], []
    root_reads.install(tmp_path / "t.jsonl", ROOT, hooks.append, exits.append)
    assert hooks[0]("open", ("clock.js", "r")) is None


def test_the_plugin_is_a_no_op_without_the_env_var(monkeypatch):
    monkeypatch.delenv("ROOTREADS_OUT", raising=False)
    assert root_reads.pytest_configure(None) is None


def test_the_plugin_arms_the_hook_when_asked(tmp_path, monkeypatch):
    hooks, exits = [], []
    monkeypatch.setattr(root_reads.sys, "addaudithook", hooks.append)
    monkeypatch.setattr(root_reads.atexit, "register", exits.append)
    monkeypatch.setenv("ROOTREADS_OUT", str(tmp_path / "t.jsonl"))
    monkeypatch.delenv("ROOTREADS_ROOT", raising=False)
    seen = root_reads.pytest_configure(None)
    assert seen == {} and len(hooks) == 1 and len(exits) == 1


def test_the_plugin_honours_an_explicit_root(tmp_path, monkeypatch):
    monkeypatch.setattr(root_reads.sys, "addaudithook", lambda h: None)
    monkeypatch.setattr(root_reads.atexit, "register", lambda f: None)
    monkeypatch.setenv("ROOTREADS_OUT", str(tmp_path / "t.jsonl"))
    monkeypatch.setenv("ROOTREADS_ROOT", str(tmp_path))
    assert root_reads.pytest_configure(None) == {}


# ------------------------------------------------------------------ the fold


def test_named_root_reads_drops_what_lives_inside_capture_host():
    named = root_reads.named_root_reads(ROOT)
    assert "clock.js" in named
    assert not [p for p in named if p.startswith("capture-host/")]


def test_tracked_files_reads_the_index():
    tracked = root_reads.tracked_files(ROOT)
    assert "clock.js" in tracked
    assert "capture-host/check.sh" in tracked


def test_fold_classifies_every_observation(tmp_path):
    (tmp_path / "here-only.txt").write_text("x")
    lines = [
        json.dumps({"path": "clock.js", "how": ["read"]}),
        "",
        json.dumps({"path": "clock.js", "how": ["exec"]}),
        json.dumps({"path": "here-only.txt", "how": ["read"]}),
        json.dumps({"path": "hci0", "how": ["exec"]}),
    ]
    rec = root_reads.fold(lines, tmp_path, {"clock.js", "named-only.js"}, {"named-only.js"})
    assert rec["paths"] == [
        {"path": "clock.js", "found": ["traced"], "how": ["exec", "read"]},
        {"path": "named-only.js", "found": ["named"]},
    ]
    why = {e["token"]: e["why"] for e in rec["excluded"]}
    assert "no commit" in why["here-only.txt"]
    assert "argv token" in why["hci0"]


def test_main_refuses_without_fold(capsys):
    assert root_reads.main([]) == 2
    assert "usage" in capsys.readouterr().err


def test_main_writes_the_manifest_it_was_asked_for(tmp_path, capsys):
    src = tmp_path / "trace.jsonl"
    src.write_text(json.dumps({"path": "clock.js", "how": ["read"]}) + "\n")
    dest = tmp_path / "m.json"
    assert root_reads.main(["--fold", str(src), "--out", str(dest)], root=ROOT) == 0
    assert {e["path"] for e in json.loads(dest.read_text())["paths"]} >= {"clock.js"}
    assert "tracked root path" in capsys.readouterr().out


def test_main_defaults_to_the_committed_manifest_path(tmp_path, monkeypatch):
    src = tmp_path / "trace.jsonl"
    src.write_text(json.dumps({"path": "clock.js", "how": ["read"]}) + "\n")
    (tmp_path / "tools").mkdir()
    monkeypatch.chdir(tmp_path)
    assert root_reads.main(["--fold", str(src)], root=ROOT) == 0
    assert (tmp_path / root_reads.MANIFEST).exists()
