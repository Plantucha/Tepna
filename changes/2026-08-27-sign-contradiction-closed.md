---
bump: patch
type: changed
brief: CLOCK-LEG-SIGN-CONTRADICTION-2026-08-27-BRIEF.md
---

`CLOCK-LEG-SIGN-CONTRADICTION` is **DONE**. The last Done-when item asked which method is wrong on
2026-08-13, or an explicit "unexplained". It is answerable: **leg C**, and it fails by SNR rather than by
defect — the unwrap is sound, the fragments are matched, the axes are device-side and `fs` is derived
correctly. It simply cannot measure the quantity asked of it on that night.

| | host legs | leg C |
|---|---|---|
| the night's two fragments | −20.1 / −20.4 and −26.4 / −26.8 ppm | +26.6 / −13.5 ppm |
| spread | **0.3 / 0.4 ppm** | **40.1 ppm** |

One method reproduces to tenths of a ppm across the same two windows; the other swings 40. Framing this
as "the two methods contradict" gave leg C a standing its own reproducibility never supported. The
control that makes the diagnosis stick is 2026-07-20: 7 ms scatter, identical code, agrees with the host
legs to **0.27σ**.

Two threads deliberately left open inside the DONE brief: **what the wander is** (PAT leads but is not
established — a −320 ms excursion would exceed typical whole-PAT magnitude, so beat-pairing and
foot-detection jitter stay live), and **leg C should publish an uncertainty and refuse when wander
exceeds signal** — the `hostAxis` refusal discipline applied to itself, a code change for whoever next
touches `tools/beat-leg-closure.mjs`. Printing a bare ppm is what allowed a 40 ppm-unstable quantity to
become a gate input.

`CROSS-DEVICE-DRIFT-AND-CLOSURE` §PAT stays BLOCKED, and its band↔verdict anti-correlation now has a
direct cause: leg C's true per-night error exceeds every host-leg band, so the passes were simply the
nights with the widest bands. DOCS-INDEX row synced (the gate caught it — check3b, index vs header).
