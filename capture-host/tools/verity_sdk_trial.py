#!/usr/bin/env python3
# tepna-capture — tools/verity_sdk_trial.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Prepare ONE night of Verity Sense SDK mode at 176 Hz PPG. Run it ON the capture host.

    /opt/tepna/capture-host/.venv/bin/python tools/verity_sdk_trial.py check
    /opt/tepna/capture-host/.venv/bin/python tools/verity_sdk_trial.py apply
    /opt/tepna/capture-host/.venv/bin/python tools/verity_sdk_trial.py revert

It edits the live config and NOTHING else: it never restarts the daemon, never touches the BLE
device, and never prints a MAC address. The runbook is `docs/VERITY-SDK-TRIAL.md`.

Plumbing only — argparse, the config read and write, the timestamped backup, the free-space call and
the printing. Every decision lives in `verity_sdk_config.py`, which is inside the coverage floor:
which block is the Verity, which keys may move, the two-key parse proof and the operator warnings.
Same split as `find_blindspots.py` / `blind_spots.py`.

THE EXIT-CODE CONTRACT:
    0  the report printed, or the write completed and the parse proof came back clean
    1  REFUSED — a missing config, no Verity block, or a parse proof that found a third moved value

PyYAML IS REQUIRED, and its absence is a refusal rather than a skipped check: without a parser this
cannot prove the write moved only two keys, and a write it cannot prove is a write it must not make.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import glob
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

# ⚠️ THE TWO HALVES MUST NOT SHARE A BASENAME, and the first draft of this unit gave them one.
# Measured 2026-10-26: with the module also called `verity_sdk_trial`, this file shadowed it on
# `sys.path` under the full suite, and all 40 of its tests failed on `AttributeError` although
# every one passed alone. Two more gates reded on the same cause, each for a different reason:
# coverage then measured the CLI, so covscope called its pin spent, and `find_unwired.importers`
# skips `n == module + ".py"` as the module itself, so the one importer was discarded and the
# module read as imported by nothing. Every sibling split in this tree differs by name for this
# reason — `covscope.py` / `coverage_scope.py`, `mutate_triage.py` / `mutation_triage.py`.
import verity_sdk_config as VT  # noqa: E402

CONFIG = os.environ.get("TEPNA_CONFIG", "/opt/tepna/capture-host/config.yaml")


def read(path: str) -> list[str]:
    with open(path, encoding="utf-8") as f:
        return f.read().splitlines(keepends=True)


def loader():
    """The YAML loader the proof runs on. An absent parser refuses here, not inside the decision."""
    try:
        import yaml  # type: ignore
    except ImportError:
        raise SystemExit(
            "REFUSING: PyYAML is not importable, so this cannot prove the write is safe.\n"
            "  Run it with the daemon's own interpreter: /opt/tepna/capture-host/.venv/bin/python"
        ) from None
    return yaml.safe_load


def free_space(lines: list[str]) -> str:
    root = VT.config_root(lines)
    try:
        st = os.statvfs(root)
    except OSError as e:
        return f"{root}: unreadable ({e.__class__.__name__})"
    return f"{root}: {st.f_bavail * st.f_frsize / 1e9:.1f} GB free"


def backups() -> list[str]:
    return sorted(glob.glob(f"{CONFIG}.{VT.BAK_TAG}.bak-*"))


def revert(from_backup: str | None) -> int:
    src = from_backup or (backups()[-1] if backups() else None)
    if not src:
        raise SystemExit(f"REFUSING: no {CONFIG}.{VT.BAK_TAG}.bak-* to revert from")
    shutil.copyfile(src, CONFIG)
    print(f"reverted {CONFIG} from {src}")
    print(f"the daemon still runs the trial config until you restart it: {VT.RESTART}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("verb", choices=("check", "apply", "revert"), nargs="?", default="check")
    ap.add_argument("--ppg", type=int, default=VT.WANT_PPG, help=f"PPG rate to request (default {VT.WANT_PPG})")
    ap.add_argument("--from-backup", help="revert from this file instead of the newest trial backup")
    a = ap.parse_args()

    if not os.path.exists(CONFIG):
        raise SystemExit(f"REFUSING: {CONFIG} does not exist — run this ON the capture host")
    if a.verb == "revert":
        return revert(a.from_backup)

    before = read(CONFIG)
    try:
        after, notes = VT.edit(before, a.ppg)
    except VT.Refusal as e:
        raise SystemExit(f"REFUSING: {e}") from None

    print(f"config: {CONFIG}")
    print(f"disk:   {free_space(before)}")
    print(f"backups present: {len(backups())}")
    print("\n── the Verity block as it stands ──")
    print(VT.show_block(before))
    print("\n── what this changes ──")
    for n in notes:
        print(f"  · {n}")
    print("\n── diff ──")
    print(VT.diff_text(before, after) or "  (nothing to change)")
    print("\n── read this before you apply ──")
    for w in VT.warn_about(after):
        print(f"  ⚠ {w}")

    if a.verb == "check":
        print("\ncheck only: nothing was written. Re-run with `apply` to write it.")
        return 0
    if before == after:
        print("\nnothing to write — the live config already asks for this.")
        return 0

    problems = VT.only_two_keys_moved("".join(before), "".join(after), a.ppg, loader())
    if problems:
        for p in problems:
            print(f"  ✗ {p}")
        raise SystemExit("REFUSING to write: the parse check did not come back clean")

    stamp = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bak = f"{CONFIG}.{VT.BAK_TAG}.bak-{stamp}"
    shutil.copyfile(CONFIG, bak)
    with open(CONFIG, "w", encoding="utf-8") as f:
        f.writelines(after)
    print(f"\nwrote {CONFIG}")
    print(f"backup: {bak}")
    print("The parse check read the written file and found only the two keys moved.")
    print(f"\nNOT restarted. The trial starts when you run: {VT.RESTART}")
    print("Revert with: this script, verb `revert`.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
