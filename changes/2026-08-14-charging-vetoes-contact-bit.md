---
bump: patch
type: fixed
---

The charging veto shipped **unreachable** on the one device it was written for. `capture.on_hr`
published `worn` with a direct `_set`, consulting neither `worn_verdict` nor `_publish_worn` — both of
which describe themselves in their own docstrings as the single path.

**Measured on the box, 2026-08-14.** A Polar Verity Sense streamed **3 h 24 m at 176 Hz into its
charging dock** — 154.6 MB of PPG plus 31.5 MB of ACC in that session, ~600 MB across the day — with
`battery: 100`, `charging: True` published *correctly*, and `worn: True — worn per hr-contact-bit`
sitting right beside it. The contact bit reports skin contact in a dock, and nothing downstream was
permitted to disagree with it.

**Two abstractions were bypassed, and each had a comment claiming otherwise:**

* `worn_verdict` — *"ONE COMBINER, EVERY DETECTOR"* — holds `if charging: return False, "not worn — on
  charger (a docked device is not on a wrist)"`. Its own comment already anticipated this exact case:
  *"which is why it may overrule a contact bit that says worn"*. It was never given the HR contact bit,
  which is a different signal from the PPI flag byte it decodes, so on a device with a contact bit the
  veto could not fire.
* `_publish_worn` — *"one publish path for every source of `worn`, so the power bookkeeping cannot
  diverge between them"* — owns the `_WORN_SINCE` clock that `should_drop_not_worn` measures. `on_hr`
  kept a duplicate copy keyed off the **raw bit**, so the 180 s not-worn drop could never accumulate
  however certain any other detector was. That is why the link was never dropped.

`worn_verdict` gains a `contact` vote (`hr-contact-bit`) and `on_hr` now routes through both. The
precedence established in #1228 is **unchanged**: a contact bit still owns `worn` against the OPTICS,
because "contact says worn, optics say not" describes an armband on a desk *and* one worn over a sleeve
in bright sun, and arbitrating between them would be a guess wearing a verdict's clothes. Charging is
not an inference about what the sensor is seeing — it is a physical fact about where the device is, and
the combiner already checks it first, before any vote.

**The regression test runs at the level that failed.** The 24 unit assertions on the veto all passed
throughout, which is precisely the problem — this repo's recurring failure class is machinery that is
green without exercising anything. So the new test drives `run_polar` end to end with a contact bit
that says worn and `charging: True`, and asserts both the verdict **and** that `_WORN_SINCE` starts;
a verdict nothing acts on is not a fix. Reverting `on_hr` to the shipped code fails it, and the mirror
test (contact worn, not charging ⇒ still worn, no drop clock) guards the expensive direction — a false
not-worn drops a live link and costs a night.

Also fixes a test that would have asserted its own mock: `test_a_CONFLICT_…` stubbed `worn_verdict`
globally, which isolated the optical branch only by accident of `on_hr` not calling it. It now
discriminates by argument (`ambient` vs `contact`), so the scenario it describes is the one it runs.
