---
bump: patch
type: fixed
brief: POLAR-ONBOARD-BACKUP-FOLLOWUPS-2026-08-11-BRIEF.md
---

The contact bit was pre-empting the optical detectors entirely, so when it was WRONG nothing could
say so. Measured 2026-08-13: a Verity on a desk reported `worn: True` from its HR contact bit for ten
hours while streaming 496 MB, with no `worn_why`, no second opinion, and `drop_not_worn_sec` armed at
180 s and structurally unable to fire.

**The precedence is deliberately UNCHANGED.** My first attempt demoted the contact bit so the optics
could override it, and the test I was about to break argued it down: a genuinely-worn strap whose
sensor sees light — worn loosely, over a sleeve, in bright sun — would be declared off-body and
DROPPED. "Contact says worn, optics say not" describes that case and a desk identically, so the two
signals cannot settle it, and the costs are not symmetric: a false not-worn loses a night, a false
worn loses a charge.

So the defect was never the ranking — it was that nobody else spoke. `_has_contact_bit` suppressed the
whole optical branch. Now it runs alongside, publishes `worn_optical` / `worn_optical_why` beside
`worn`, and logs the disagreement ONCE per session (at 176 Hz that branch runs every ~1.25 s; an
unthrottled warning would emit ~2900 identical lines a night and bury the one that matters). Every
`worn` writer now sets `worn_why`, so the deciding source is always visible.

`webmon` forwards the three new fields. **A field published into STATUS but not forwarded is not
published** — the conflict would have reached the daemon log and no human, which is the state being
fixed. Asserted through a real HTTP GET in the projection contract, whose exact key-set check kills
the missing-forward case; removing the forwarding reds two tests, including the null-shape one that
inherits the same key set.

The negotiation warning now asks BOTH calibrations before announcing there will be no verdict. It
asked only the 55 Hz level detector, so it fired on every 176 Hz session while the stability detector
was publishing one — a warning that cries wolf on the configuration the box actually runs teaches the
reader to skip the line that will one day be true. The SILENCE at a covered rate is asserted, which is
the half that stays fixed.

⚠️ **This makes the conflict visible, not resolved.** A desk armband still reads `worn: True` and
still will not auto-drop. Resolving it needs a signal that separates a desk from a sleeve, and there
isn't one.

Found by branch coverage: `assert len(said) == 1` was passing VACUOUSLY. The fixture's PPG frame packs
240 samples against a 220-sample window, so one frame is exactly one window, the throttle's suppression
arm never ran, and "exactly one warning" was guaranteed by having exactly one opportunity. Two frames
now, and replacing the guard with `if True:` fails the test — it did not before.
