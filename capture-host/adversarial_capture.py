# tepna-capture — adversarial_capture.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The KNOWN-CLOCK injector — Protocol B of KNOWN-CLOCK-ADVERSARIAL-CAPTURE (targets 1 and 4).

A SEPARATE PROCESS that composes the shipped capture library unchanged and puts a shim BETWEEN the device
and the writer: every PMD data notification from a targeted device passes through `perturb_frame` before
`capture.py` ever sees it. `capture.py` carries no hook, no branch and no config key for this — the
daemon cannot reach it (owner ruling 2, relayed 2026-09-20: "no — shim or separate process"), and the
test that shows so is `test_adversarial_capture.py::test_the_shipped_daemon_cannot_reach_the_injector`.

WHAT IS INJECTED, and where the truth lives (§∅ applies to the truth too — it records what was INJECTED,
never what was measured):

  target 1 · constant device-clock OFFSET — `offset_ns` is added to the u64 LE timestamp at bytes 1..8 of
             every PMD frame (the device's own stamp of the frame's last sample), so decode, back-timing,
             the arrival sidecar, the watchdog and every writer see a device whose clock is offset by a
             KNOWN amount against the host's true arrival. The transport's contribution stays measurable:
             arrival is untouched.
  target 4 · PACKET LOSS — a frame is dropped before decode with probability `drop_p`, decided by a
             seeded hash of (seed, address, frame index): deterministic, replayable, and independent of
             wall time. A dropped frame is one the pipeline never received, exactly as a real loss.
  target 6 · labelled beat FP/FN — NOT built here. A truth sidecar that is approximately right is a
             fabricated label (the brief sizes it last for that reason); it needs its own design.

The TRUTH SIDECAR (`INJECTION-TRUTH-<stamp>.jsonl`, `tepna.injection-truth/1`) sits in the adversarial
root beside the injected night, never beside anything in production: a header row with the plan, then
one row per perturbed frame — address, measurement type, frame index, host arrival, the original and the
injected device stamp, the action. Scoring recovers the offset / the lost frames against these rows.

⚠ THE ROOT IS A DIFFERENT TREE, AND THE INJECTOR REFUSES PRODUCTION (owner ruling 1): output goes under a
root that no corpus tool walks, and this process exits 3 if the root overlaps the daemon config's `root`
or any known production root — as a descendant, an ancestor, or the same path — or has no path component
containing `adversarial`. A marker file would be a label nothing opens; a different tree is what the
walkers cannot find. `refuse_production` is the plant that matters and its test first shows the run
WOULD proceed without it.

The derived config keeps the daemon's devices and adapters, moves `root`, and switches OFF the alert
webhook and the CPAP harvest — an adversarial night must never page anyone or touch the production
spool. Running this beside the production daemon is running two daemons on one box: the owner's call,
and the owner runs the clock nights.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as _dt
import hashlib
import json
import os
import struct
import sys

import polar_pmd as pmd

SCHEMA = "tepna.injection-truth/1"
DEFAULT_ROOT = "/srv/tepna-adversarial"
# Roots the injector refuses REGARDLESS of what the config says — the box's production tree as
# `config.example.yaml` ships it and as vigil runs it (`/opt/tepna/capture-host/config.yaml`, read
# 2026-09-22). The config's own `root` is added at runtime. Note the default adversarial root is a
# SIBLING of it, not a child: `/srv/tepna/adversarial` would be walked by everything that walks
# `/srv/tepna`, which is the whole reason ruling 1 exists.
KNOWN_PRODUCTION_ROOTS = ("/srv/tepna",)
REQUIRED_COMPONENT = "adversarial"
EXIT_REFUSED = 3


class Refused(SystemExit):
    """The injector will not write here. Exit 3, never 0."""

    def __init__(self, why: str):
        super().__init__(EXIT_REFUSED)
        self.why = why


def _overlaps(a: str, b: str) -> bool:
    """True when one resolved path is the other or lies under it. PURE over strings."""
    a, b = os.path.realpath(a), os.path.realpath(b)
    return a == b or a.startswith(b + os.sep) or b.startswith(a + os.sep)


def refuse_production(root: str, cfg_root: str | None, known: tuple[str, ...] = KNOWN_PRODUCTION_ROOTS) -> str:
    """The guard. Returns the resolved root or raises `Refused` naming the overlap. A root that overlaps the
    daemon's `root` or a known production root — same path, under it, or ABOVE it (a night written above
    production is walked by anything that walks the parent) — is refused; so is a root without the
    `adversarial` component, which is how a typo lands beside production instead of inside it."""
    resolved = os.path.realpath(root)
    if not any(REQUIRED_COMPONENT in part for part in resolved.split(os.sep)):
        raise Refused(f"{resolved}: the adversarial root must carry a path component containing '{REQUIRED_COMPONENT}'")
    for prod in [p for p in (cfg_root, *known) if p]:
        if _overlaps(resolved, prod):
            raise Refused(f"{resolved} overlaps the production capture tree {os.path.realpath(prod)} — refused")
    return resolved


def drop_decision(seed: int, address: str, frame_index: int, drop_p: float) -> bool:
    """Deterministic per-frame loss: sha256(seed:address:index) → [0, 1) < drop_p. PURE."""
    if drop_p <= 0.0:
        return False
    h = hashlib.sha256(f"{seed}:{address.upper()}:{frame_index}".encode()).digest()
    return int.from_bytes(h[:8], "big") / 2**64 < drop_p


def perturb_frame(data: bytes, *, offset_ns: int, drop: bool) -> bytes | None:
    """One PMD frame → the frame the pipeline will see (`None` = dropped). Only bytes 1..8 (the u64 LE
    device stamp) can change; a frame too short to carry a stamp passes through untouched, because
    `decode_frame` refuses it anyway and rewriting garbage would be a second fabrication. PURE."""
    if drop:
        return None
    if offset_ns == 0 or len(data) < 10:
        return bytes(data)
    last_ns = struct.unpack_from("<Q", data, 1)[0]
    out = bytearray(data)
    struct.pack_into("<Q", out, 1, (last_ns + offset_ns) & 0xFFFFFFFFFFFFFFFF)
    return bytes(out)


class Plan:
    """What is injected, stated before the night: the targeted addresses (address only — the standing
    ruling), the constant offset, the loss probability and its seed."""

    def __init__(self, devices, *, offset_ns: int = 0, drop_p: float = 0.0, seed: int = 0):
        if not devices:
            raise ValueError("a plan names at least one device address")
        if not (0.0 <= drop_p < 1.0):
            raise ValueError("drop_p must be in [0, 1)")
        self.devices = frozenset(d.upper() for d in devices)
        self.offset_ns = int(offset_ns)
        self.drop_p = float(drop_p)
        self.seed = int(seed)

    def targets(self, address: str) -> bool:
        return address.upper() in self.devices

    def as_dict(self) -> dict:
        return {"devices": sorted(self.devices), "offset_ns": self.offset_ns, "drop_p": self.drop_p, "seed": self.seed,
                "targets": [t for t, on in (("1-constant-offset", self.offset_ns != 0), ("4-packet-loss", self.drop_p > 0)) if on]}


class TruthWriter:
    """The sidecar: one JSON line per perturbed frame, the plan first. Append-only, flushed per row so a
    night that dies mid-way leaves every injected frame on disk."""

    def __init__(self, path: str, plan: Plan, started: _dt.datetime):
        self.path = path
        self.rows = 0
        self._fh = open(path, "a", encoding="utf-8")
        self._emit({"schema": SCHEMA, "plan": plan.as_dict(), "started": started.isoformat(timespec="seconds"),
                    "note": "records what was INJECTED, never what was measured"})

    def _emit(self, row: dict) -> None:
        self._fh.write(json.dumps(row, separators=(",", ":")) + "\n")
        self._fh.flush()

    def record(self, *, address: str, meas: int, index: int, arrival: _dt.datetime, original_ns: int | None,
               injected_ns: int | None, action: str) -> None:
        self.rows += 1
        self._emit({"i": index, "address": address.upper(), "meas": pmd.MEAS_NAME.get(meas, meas),
                    "arrival": arrival.isoformat(timespec="microseconds"), "action": action,
                    "original_last_ns": original_ns, "injected_last_ns": injected_ns})

    def close(self) -> None:
        self._fh.close()


def inject(plan: Plan, truth: TruthWriter, address: str, data: bytes, index: int, arrival: _dt.datetime) -> bytes | None:
    """The per-frame seam: decide, perturb, record. Returns the frame to deliver or None. A frame the plan
    does not touch is returned as-is and NOT recorded — the sidecar lists injections, not traffic."""
    drop = drop_decision(plan.seed, address, index, plan.drop_p)
    out = perturb_frame(data, offset_ns=plan.offset_ns, drop=drop)
    original = struct.unpack_from("<Q", data, 1)[0] if len(data) >= 10 else None
    meas = (data[0] & 0x3F) if data else -1
    if out is None:
        truth.record(address=address, meas=meas, index=index, arrival=arrival, original_ns=original, injected_ns=None, action="drop")
    elif out != bytes(data):
        truth.record(address=address, meas=meas, index=index, arrival=arrival, original_ns=original,
                     injected_ns=struct.unpack_from("<Q", out, 1)[0], action="offset")
    return out


def make_client_class(base, plan: Plan, truth: TruthWriter, now):
    """The shim: a `BleakClient` subclass whose `start_notify` on the PMD data characteristic wraps the
    daemon's callback with `inject`. Every other characteristic, and every untargeted device, passes
    straight through. Installed on the `bleak` module by `run`, so `capture.py`'s function-local
    `from bleak import BleakClient` resolves to it — nothing in capture.py changes."""

    class InjectingClient(base):
        def __init__(self, address_or_device, *a, **kw):
            super().__init__(address_or_device, *a, **kw)
            self._inj_address = str(getattr(address_or_device, "address", address_or_device))
            self._inj_index = 0

        async def start_notify(self, char, callback, *a, **kw):
            if str(char).lower() != pmd.PMD_DATA or not plan.targets(self._inj_address):
                return await super().start_notify(char, callback, *a, **kw)

            def wrapped(sender, data):
                idx = self._inj_index
                self._inj_index += 1
                out = inject(plan, truth, self._inj_address, bytes(data), idx, now())
                if out is not None:
                    callback(sender, bytearray(out))

            return await super().start_notify(char, wrapped, *a, **kw)

    return InjectingClient


def derive_config(cfg: dict, root: str) -> dict:
    """The daemon's config with `root` moved and everything that pages or harvests switched off."""
    out = json.loads(json.dumps(cfg))   # a deep copy with no shared references into the daemon's dict
    out["root"] = root
    out["alerts"] = {**(out.get("alerts") or {}), "enabled": False, "webhook_url": ""}
    out["cpap"] = {**(out.get("cpap") or {}), "enabled": False}
    return out


def build(argv: list[str]) -> tuple[Plan, str, dict, argparse.Namespace]:
    """Parse, refuse production, derive the config. Everything up to (not including) the night."""
    ap = argparse.ArgumentParser(description="KNOWN-CLOCK injector: a capture run with a known perturbation, into a separate root")
    ap.add_argument("--config", default="config.yaml", help="the daemon's config; its root is what this refuses")
    ap.add_argument("--root", default=DEFAULT_ROOT, help=f"adversarial output root (default {DEFAULT_ROOT}); must not overlap production")
    ap.add_argument("--device", action="append", required=True, help="BLE address to perturb (repeatable; address only)")
    ap.add_argument("--offset-ms", type=float, default=0.0, help="target 1: constant device-clock offset, ms (may be negative)")
    ap.add_argument("--drop-p", type=float, default=0.0, help="target 4: per-frame loss probability in [0, 1)")
    ap.add_argument("--seed", type=int, default=1, help="target 4: the loss sequence's seed")
    ap.add_argument("--instance", default=None, help="passed to capture.py --instance")
    ap.add_argument("--dry-run", action="store_true", help="refuse or print the plan and derived config; run nothing")
    a = ap.parse_args(argv)
    import yaml
    with open(a.config, encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh)
    if not isinstance(cfg, dict):
        raise SystemExit(f"{a.config}: config is empty or not a mapping")
    root = refuse_production(a.root, cfg.get("root"))
    plan = Plan(a.device, offset_ns=round(a.offset_ms * 1_000_000), drop_p=a.drop_p, seed=a.seed)
    if not plan.as_dict()["targets"]:
        raise SystemExit("nothing to inject: give --offset-ms and/or --drop-p")
    return plan, root, derive_config(cfg, root), a


def run(argv: list[str]) -> int:
    plan, root, cfg, a = build(argv)
    if a.dry_run:
        print(json.dumps({"root": root, "plan": plan.as_dict(), "config": cfg}, indent=1))
        return 0
    os.makedirs(root, exist_ok=True)
    started = _dt.datetime.now(_dt.timezone.utc)
    stamp = started.strftime("%Y%m%dT%H%M%SZ")
    cfg_path = os.path.join(root, f"adversarial-config-{stamp}.yaml")
    import yaml
    with open(cfg_path, "w", encoding="utf-8") as fh:
        yaml.safe_dump(cfg, fh, sort_keys=False)
    truth = TruthWriter(os.path.join(root, f"INJECTION-TRUTH-{stamp}.jsonl"), plan, started)
    import bleak
    import capture
    bleak.BleakClient = make_client_class(bleak.BleakClient, plan, truth, capture._now)  # type: ignore[misc]
    sys.argv = ["capture.py", "--config", cfg_path] + (["--instance", a.instance] if a.instance else [])
    print(f"adversarial capture → {root}\n  plan  {json.dumps(plan.as_dict())}\n  truth {truth.path}", flush=True)
    try:
        asyncio.run(capture.main())
    finally:
        truth.close()
        print(f"  injected frames recorded: {truth.rows}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(run(sys.argv[1:]))
    except Refused as r:
        print(f"REFUSED: {r.why}", file=sys.stderr)
        sys.exit(EXIT_REFUSED)
