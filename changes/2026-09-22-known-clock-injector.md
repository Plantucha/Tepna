---
bump: minor
type: added
brief: KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14-BRIEF.md
---

The KNOWN-CLOCK injector (Protocol B, targets 1 · 4): `capture-host/adversarial_capture.py`, a separate process that shims `bleak.BleakClient` in its own process so every PMD frame of a targeted device passes a known perturbation — a constant device-clock offset on the u64 stamp, or a seeded deterministic frame drop — before the unchanged capture pipeline decodes it, with the truth sidecar (`tepna.injection-truth/1`) recording what was injected beside the night in the adversarial root. The injector refuses production (exit 3 on any root overlapping the config's `root` or `/srv/tepna`, or lacking an `adversarial` component; default `/srv/tepna-adversarial`), the plant shown load-bearing first; `capture.py` carries no hook, branch or config key. Target 6 (labelled beat FP/FN) deliberately not built — its truth needs its own design.
