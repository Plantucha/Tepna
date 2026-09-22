---
bump: minor
type: fixed
brief: PPG-ABSENCE-AS-VALUE-2026-09-06-BRIEF.md
---

The zero-order-hold class of an optical channel is decided PER WINDOW (every `HELD_WARMUP_RUNS` = 64 runs), never once per night (residue `2026-09-06-warmup-verdict-goes-stale`): each window's rows are judged by that window's class, the `_PPGRUNS.txt` sidecar carries the class transitions with their host instants (`# stream=… channel=… class=… window=N confirmed=K at=…`) and the whole-night `# final` line gains `windows= transitions= partial=`. Measured before shipping: a bare re-decision flapped 32–164 times per channel per night on the one real hold (the ring's ACC), so the class has hysteresis — a Schmitt band (`HELD_EXIT_SHARE` 0.70, set 0.10 under the measured floor of the hold's per-window share) and `HELD_CONFIRM_WINDOWS` = 2 — validated on synthetic plants the band was not fitted to (a hold with a transition at a known instant, a pleth dithering at the band's edge, a variable stream dithering under entry), and checked against 45 held + 309 optical corpus channels.
