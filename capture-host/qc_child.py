# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""qc_child — the night-QC work that runs OFF the daemon's own process.

`capture._qc_offload` sends one of these functions to a spawned child, so each is a module-level
function with no daemon state: it takes paths and plain data, returns plain data, and logs nothing. A
child has no handlers for this package's logger, so every reason it finds TRAVELS BACK as a value and
the parent is the only thing that writes to the journal.

🔴 WHY ONE FUNCTION PER POLL AND NOT ONE PER CALL. `capture.py` records the measurement beside
`qc_poller`: a SECOND `_qc_offload` in the same poll wedged `check.sh` twice at 98 %, with all 24 xdist
workers idle and the controller in `futex_do_wait`, because several poller tests freeze
`time.monotonic` and a spawn pool's deadlines never elapse under a constant clock. So the shape here is
one entry point per poller, carrying every expensive call that poll makes — the child count per poll
stays at one, and what moves out of the parent is the work.

What that work costs in the PARENT, measured, is why it moves:
  · `nightqc.summarize` — 51 s of pure-Python CPU per poll by dawn (vigil 2026-09-23); already a child.
  · `loss_audit.wear_by_device` — 6.9 s of GIL per poll on the 794 MB 2026-09-23 night (H10 5.0 s,
    Verity 1.9 s), and ~50 MB of arena retention over 4 repeats that `mallinfo2` cannot see
    (`ext:wren-pr/to-kestrel-rss.md`, vigil 2026-10-12).
  · `loss_audit.write_night` + `solid_night.write_night` — +311..+605 MB peak per night (vigil
    2026-10-12), which the parent kept for the rest of its life.
A child's peak returns to the kernel when the child exits. That is the whole claim of this module.
"""

import os
import traceback
from typing import Any

import loss_audit
import nightqc
import solid_night
import stitch_31d


def scan_night(night_dir: str, devices: list) -> dict:
    """The CURRENT night's two expensive scans, in one call: the QC summary and the wear ends.

    Returns `{"summary": …, "wear": …, "wear_reason": …}`. Nothing is composed here — `attach_wear` is
    pure and cheap, so it stays in the parent beside the boundary check that refuses a summary which is
    not a dict. A child that attached first would have to make that same judgement a second time.

    §∅: a wear scan that raises returns `wear = None` WITH a reason, never an empty dict. The two are
    not the same answer — `{}` would say "no device was worn" to a consumer reading per-device ends."""
    summ = nightqc.summarize(night_dir, devices)
    try:
        wear: Any = loss_audit.wear_by_device(night_dir, devices)
        reason = None
    except Exception as e:  # noqa: BLE001 — a wear scan is a REPORT, not the QC; the parent logs this
        wear, reason = None, f"{type(e).__name__}: {e}"
    return {"summary": summ, "wear": wear, "wear_reason": reason}


def compose_due(night_dir: str) -> bool:
    """True when SOLID-NIGHT §2's trigger is pending for this night: an audit exists beside it and no
    verdict newer than that audit.

    ONE definition, two callers, and they are not interchangeable in time. The parent asks BEFORE the
    poll's child, to decide whether there is any work at all; `audit_and_compose` asks AFTER each audit,
    because the audit is what moves the mtime this reads. A second copy of the rule would be two rules
    the day one of them is edited."""
    vpath = os.path.join(night_dir, loss_audit.VERDICT_NAME)
    spath = os.path.join(night_dir, solid_night.VERDICT_NAME)
    if not os.path.exists(vpath):
        return False  # no audit on disk: nothing to compose over
    return not (os.path.exists(spath) and os.path.getmtime(spath) >= os.path.getmtime(vpath))


def audit_and_compose(jobs: list, devices: list, nights: list, active: set, commit: Any) -> list:
    """Every SETTLED night's loss audit and SOLID-NIGHT verdict for one poll, in one call.

    The parent decides eligibility (settled, data newer than the audit, the re-judge budget) because
    those decisions are stats and a budget it carries between polls. This runs what those decisions
    cost. Each job is `{"dir", "night", "audit", "why"}`; each result carries only the PROJECTIONS the
    parent publishes, never the verdict objects — the objects are what the memory figure above is made
    of, and pickling them back would undo the move.

    Two failure shapes, each matching what the parent did when this ran in-process:
      · an audit that raises STOPS the batch (`loss_error`), because the poll did; the nights already
        done are returned so their STATUS still lands.
      · a verdict that cannot be composed is this night's failure alone (`solid_error`), and the audit
        beside it stands.
    A traceback is returned as TEXT: the parent logs it, and an exception pickled across a spawn
    boundary can fail to unpickle for reasons that have nothing to do with the night."""
    out: list = []
    for job in jobs:
        nd = job["dir"]
        res: dict = {
            "night": job["night"],
            "loss": None,
            "solid": None,
            "loss_error": None,
            "solid_error": None,
            "stitch": None,
        }
        if job["audit"]:
            try:
                obj = loss_audit.write_night(nd, devices, commit=commit)
            except Exception:  # noqa: BLE001 — one bad night is logged by the parent, not raised here
                res["loss_error"] = traceback.format_exc()
                out.append(res)
                break
            res["loss"] = {
                "status": obj["status"],
                "at": obj["at"],
                "daemon_caused_min": (obj.get("result") or {}).get("daemon_caused_min"),
                "reason": obj.get("reason"),
            }
        # §2's gate, re-read HERE because the audit above is what moves it: the verdict follows the
        # audit, so the parent's own answer to this question is stale by the time the audit has run.
        if not compose_due(nd):
            out.append(res)
            continue
        try:
            obj2, run = solid_night.write_night(
                nd, devices, nights=nights, active=active, commit=commit, reason=job["why"]
            )
        except Exception:  # noqa: BLE001 — one night's verdict must not stop the batch
            res["solid_error"] = traceback.format_exc()
            out.append(res)
            continue
        res["solid"] = {
            "status": obj2["status"],
            "reason": obj2["reason"],
            "statement": run["statement"],
            "solid": run["solid"],
            "exit": run["exit"],
        }
        # 31-day stitch trigger: a new PASS verdict means the solid-night set
        # changed, so the stitched fused-tool inputs are stale. The stitch
        # itself runs here (in the child, off the daemon's process); the
        # server-side compute runs later via tools/stitch-31d-run.mjs.
        # A stitch failure is recorded, never raised: the verdict stands.
        if obj2["status"] == "PASS":
            try:
                captures_dir = os.path.dirname(nd)
                manifests = stitch_31d.stitch_31d(captures_dir, "/srv/tepna/stitched")
                res["stitch"] = {
                    "ok": True,
                    "tools": sorted(manifests.keys()),
                }
            except Exception as e:  # noqa: BLE001 — stitch is best-effort; verdict stands
                res["stitch"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        else:
            res["stitch"] = None  # no new solid night: stitched inputs stand
        out.append(res)
    return out


def _verdict_sample(commit=None, at=None):
    """The `--verdict-sample` object the adoption gate reads, built and validated by `verdict.make`."""
    import json as _json

    import verdict as VD

    return _json.dumps(
        VD.make(
            gate="qc-child-stitch-hook",
            status="PASS",
            population={"checked": 1, "eligible": 1, "excluded": 0},
            criterion={
                "name": "PASS verdict triggers stitch; non-PASS skips",
                "threshold": 1,
                "unit": "hook",
                "direction": "eq",
            },
            result={"trigger": "PASS", "skip": ["FAIL", "UNKNOWN", "NOT_APPLICABLE"]},
            evidence=["capture-host/qc_child.py", "capture-host/tests/test_qc_child_stitch.py"],
            reason=None,
            tool="capture-host/qc_child.py",
            commit=commit,
            at=at,
        ),
        indent=2,
    )


if __name__ == "__main__":
    import sys

    if "--verdict-sample" in sys.argv:
        print(_verdict_sample())
