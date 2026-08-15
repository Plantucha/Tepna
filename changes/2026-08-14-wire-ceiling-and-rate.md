---
bump: patch
type: fixed
---

The two orphans `tools/find_unwired.py` found on its first run, both of which the hand audit missed.

**`connection_ceiling_error` is now called, at all THREE link-error sites.** The comment above
`_CEILING_SIGNS` has always said *"classify it so the log says 'adapter connection ceiling', not a
generic link error"* — and every site logged the generic form. The two failures want opposite responses:
a ceiling is over-provisioning you fix at the adapter; an absent sensor is a battery or a strap. A bare
`TimeoutError()` reads identically either way, which is VIGIL-DEEP-ANALYSIS §2D's original complaint
that an over-provisioned dongle "looks like flapping sensors".

⚠️ **The count is the finding.** A first grep found two sites; extracting them properly found three. Two
would have been wired and the third left drifting — which is exactly the defect being cited in the
comment written at the time (the "a charging device cannot be on a body" rule encoded twice, with only
one copy checking `charging`). All three now route through one `link_error_text`, and a test asserts the
count is 3 rather than merely that the formatter exists.

**`rate_unmet` now reaches the monitor.** `capture.py` warns *"configured rate %s Hz was NOT offered by
the device — capturing at %s Hz instead … The config still says %s; nothing else will tell you it did
not happen"*, then publishes `rate_unmet` so that something can. Nothing read it, so the sentence was
literally true.

It is not cosmetic: the config keeps claiming the rate that was asked for, so a Verity negotiated down
from 176 Hz to 55 Hz is a materially different recording that looks correctly configured to anyone
reading the config instead of this field.

Three mutants verified dead — classifier disabled, one site left unclassified, `rate_unmet` not
forwarded. The middle one is the one a partial grep would have shipped.

From `CAPTURE-HOST-UNWIRED-MACHINERY-2026-08-14-BRIEF.md` §6.1.
