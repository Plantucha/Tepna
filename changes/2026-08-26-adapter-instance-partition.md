<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: PER-DEVICE-ADAPTER-PINNING-2026-08-26-BRIEF.md
---
Per-adapter instance partition — the foundation of the daemon split (§3.3b). Adds an `adapters:` name→MAC map, an optional per-device `adapter:` key, and `--instance` so `tepna-capture@sena` can serve only the devices pinned to that radio. `instance_devices(cfg, None)` returns EVERY device, so the split is opt-in per box and upgrading the code alone cannot silently strip devices from a running capture. The pin is a PREFERENCE, not an absolute (owner decision): an absent pinned radio degrades to the BlueZ default with a loud log rather than refusing to capture, because losing a night to a pin obeyed too literally is worse than a night on the wrong radio. `unowned_devices()` exists for the one failure no single instance can see — a device pinned to a radio nothing serves is captured by nobody while every instance logs a healthy startup — and it is an ERROR at startup, as is an unrecognised `--instance`, which would otherwise serve zero devices while looking like a working daemon.
