# tepna-capture — status_union.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""ONE OPERATOR VIEW FROM N CAPTURE INSTANCES — and the rule that a dead instance stays visible.

PER-DEVICE-ADAPTER-PINNING §3.6. Each `tepna-capture@<adapter>` writes its own
`status.<instance>.json` atomically; nothing shares a file, so there is no locking and no writer
contention. This module is the READ side: a pure union the monitor and nightqc consume.

🔴 THE LOAD-BEARING RULE — UNION OVER THE EXPECTED SET, NEVER THE FOUND SET.

Union the files that happen to exist and a dead `@intel` simply contributes nothing: the monitor shows
the other two radios, every device it lists is healthy, and NOTHING ANYWHERE SAYS A THIRD OF THE
CAPTURE IS GONE. That is this suite's most-repeated defect wearing new clothes — an absent contributor
reading as a clean result. It is the same shape as a `--group=` filter that matched nothing, a `-k`
that collected no test, and a "15 active streams" count that measured subscription rather than
delivery. Every one of those reported success about something it never examined.

So the expected instances come from CONFIG, and an instance that is missing or stale is rendered DEAD
WITH ITS LAST-SEEN AGE rather than omitted. A merge layer that cannot fail visibly is not worth
building.
"""
from __future__ import annotations

import json
import os
import time

# How long an instance may go unheard before the union calls it STALE. `status_loop` writes every 10 s,
# so 60 s is six missed writes — long enough not to flap on a slow disk, short enough that an operator
# looking at the monitor learns within a minute. It is NOT a tuned constant: any value here is a
# statement about how long a dead radio may masquerade as a live one.
STALE_AFTER_MS = 60_000


def expected_instances(cfg: dict | None) -> list:
    """The instances that SHOULD be publishing — from config, never from a directory listing.

    Reading the directory instead is precisely the bug this module exists to prevent: a dead instance
    has no file, so a directory-derived expectation can never notice it is missing."""
    return sorted((cfg or {}).get("adapters") or {})


def read_instance(root: str, instance: str | None) -> dict | None:
    """One instance's published status, or None when it has never written / is unreadable.

    None is a real answer here, not an error to swallow: it is what `merge()` turns into a DEAD row."""
    path = os.path.join(root, "captures",
                        "status.json" if instance is None else f"status.{instance}.json")
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def instance_health(doc: dict | None, now_ms: int | None = None,
                    stale_after_ms: int = STALE_AFTER_MS) -> dict:
    """One instance's liveness, as a fact rather than an absence.

    `state` is exactly one of:
      * `dead`  — never published, or the file is unreadable/unparseable
      * `stale` — published, but not within `stale_after_ms` (the process is up-but-wedged case, which
                  is the failure `WatchdogSec` exists for and the one that LOOKS most like health)
      * `live`  — heard from recently

    `age_ms` is None only for `dead`; for `stale` it is the number the operator needs, because "gone
    for 90 s" and "gone since yesterday" demand different responses."""
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    if not isinstance(doc, dict):
        return {"state": "dead", "age_ms": None}
    hb = doc.get("heartbeat_ms")
    if not isinstance(hb, (int, float)):
        # Published, but with no heartbeat — an OLD writer, or a truncated doc. Treated as dead rather
        # than live: an unaged status is one that cannot be shown to be current.
        return {"state": "dead", "age_ms": None}
    age = max(0, now_ms - int(hb))
    return {"state": "stale" if age > stale_after_ms else "live", "age_ms": age}


def merge(root: str, cfg: dict | None, now_ms: int | None = None,
          stale_after_ms: int = STALE_AFTER_MS) -> dict:
    """The union the monitor and nightqc read.

    Returns `{"instances": {name: {...health, adapter, device_count}}, "devices": [...],
    "streams": [...], "degraded": bool, "missing": [names]}`.

    `degraded` is True whenever ANY expected instance is not live. It exists so a consumer cannot
    render a healthy-looking page by accident: the union always carries its own verdict, rather than
    leaving each reader to notice absence for itself.

    With no `adapters:` declared (an un-split box) this reads the single `status.json` and reports one
    implicit instance, so the same reader serves both deployments."""
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    names = expected_instances(cfg)
    out_inst, devices, streams, missing = {}, [], [], []
    for name in (names or [None]):
        doc = read_instance(root, name)
        health = instance_health(doc, now_ms, stale_after_ms)
        key = name if name is not None else "(single)"
        out_inst[key] = {
            **health,
            "adapter": (doc or {}).get("adapter"),
            "device_count": len(((doc or {}).get("devices") or [])),
        }
        if health["state"] != "live":
            missing.append(key)
        if isinstance(doc, dict):
            devices.extend(doc.get("devices") or [])
            streams.extend(doc.get("streams") or [])
    return {"instances": out_inst, "devices": devices, "streams": streams,
            "degraded": bool(missing), "missing": missing}
