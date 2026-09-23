# tepna-capture — tests/_qc_child_target.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""A module-level scan stand-in the spawned QC worker can import BY NAME. Deliberately imports
nothing from the daemon: the child re-imports this module, and a `capture` import there would
drag the whole daemon into every worker the test spawns."""

import os


def pid_stamp(night, devices):
    return {"night": night, "devices": list(devices), "pid": os.getpid()}
