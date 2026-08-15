---
bump: patch
type: fixed
---

The brief's §5 — and it resolved as **decisions recorded**, not code deleted, because all three
"orphans" turned out to be capability that exists elsewhere.

| | |
|---|---|
| **`last_sample`** | **surfaced.** `nightqc` computes a per-night `silent_sec` and the frozen-sensor alert fires off it — but that is a *night* summary. An operator watching the card mid-session had no way to see a stream that stopped four minutes ago while the link stayed up: the same failure the frozen alert exists for, one time-scale down. |
| **`_WPA_DIR`** | **deleted.** Its own comment claimed a "module default for CLI/test use" that nothing used. |
| `oxy_is_finalized` | allowlisted — `pull_session.py` already gates re-pulls on finalisation via `parse_trailer`, which that caller needs anyway for the device summary. |
| `busy_with` | allowlisted — `offline_lock.slot()` raises `OfflineBusy(_busy)`, so the label already reaches callers as `e.holder`. |
| `predict_step_split` | allowlisted — research helper from `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS §2`, driven by its brief rather than the daemon; same shape as `blind_spots.analyze`. |

Deleting tested code on a judgement about someone else's module API is the wrong reflex. The allowlist
entry records the investigation once, so the next reader spends a line instead of repeating it — which
is what the allowlist is for, and why every entry prints with its reason.

**⚠️ Using the detector on §5 made it commit its own defect class, for the third time.** Adding three
allowlist entries made all three rows **vanish from the report entirely** rather than print as
`(allowed)`. The allowlist *names* the functions it excuses; `os.walk` reads `tools/` into the corpus;
each entry counted as a usage. The scanner was reading its own suppression file as evidence the code is
wired — the precise inversion of its stated design, *"a suppression you cannot see is how the next real
finding hides behind a stale entry."*

It now skips its own source. The report reads 9 unexplained, 5 allowed and visible with their reasons,
and removing the self-skip reds two tests. That is three bugs the detector has found in itself — a
decorative `root` parameter, a def-time-bound default, and now self-referential suppression — every one
surfaced by *using* it rather than reading it.

The gate also caught a real omission: `last_sample` reached the projection without being declared in
`DEVICE_KEYS`, and the contract test failed exactly as designed.

Closes `CAPTURE-HOST-UNWIRED-MACHINERY-2026-08-14-BRIEF.md` §5.
