---
bump: minor
type: fixed
brief: POLAR-ONBOARD-BACKUP-FOLLOWUPS-2026-08-11-BRIEF.md
---

A Verity on its charger streamed 176 Hz PPG into the night with `worn: True` and nothing able to stop
it. The charging inference already in `_read_batt` is sound and works everywhere it can fire — a
RISING battery is unambiguous, these cells do not self-charge (measured 2026-07-19, Verity 35 → 61 %).

**It cannot fire at 100 %.** A full cell has nowhere to rise to, so a device docked while full reports
`charging: False` for as long as it sits there. Measured 2026-08-14: 80 minutes of streaming with
`battery` pinned at 100 across every 120 s poll, `charging` False throughout, and the HR contact bit
asserting `worn` — a dock indistinguishable from a wrist.

**At full, flatness replaces rising.** Streaming drains this hardware ~9 %/h (2026-08-10: 100 → 74 %
in 3 h at 55 Hz, and 176 Hz costs more), so 45 minutes at full without movement is ~7 points that did
not happen. The window is deliberately long: it spans several quantisation steps whatever the device's
reporting granularity, and waiting costs minutes of streaming while being wrong costs a dropped link.

Restricted to full ON PURPOSE. Flatness lower down is weak — a slow drain and a coarse reporting step
look identical — and it does not need to work there, because a battery below 100 that goes on charge
RISES and the existing rule catches it. This fills the one hole that rule cannot reach and claims
nothing outside it. It never returns False: a battery flat for ten minutes has not proved it is
discharging, and saying so would invent the opposite verdict from insufficient evidence.

**Charging overrules every other worn detector, and it is the one case that inverts the asymmetry.**
The combiner is otherwise "worn if ANY detector says worn", because a false NOT-worn drops a live link
and costs a night while a false worn costs a charge. That reasoning does not apply here: a device in a
dock is not on a wrist, so the expensive error is not available to be made. This is also the only
signal in the set that is a PHYSICAL FACT about where the device IS rather than an inference about
what it is seeing — which is why it may overrule a contact bit that says worn, and on 2026-08-14 that
contact bit did say worn, for 80 minutes, on a charger.

The rule is tested purely and exhaustively; the capture-side tests assert the WIRING, including the
complement that keeps it from degenerating into "at 100 % assume a charger" — a strap unplugged at
full also reads 100 for its first minutes, and a short flat stretch must set nothing.
