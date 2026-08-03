<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Main was red: a test merged in #760 asserted on arguments it could not reliably observe.

`test_a_pmd_device_is_bonded_with_its_own_address_and_the_pinned_adapter` spied on
`bonding.ensure_bonded` and asserted it received `(addr, ADAPTER)`. It passed the full gate when merged
and later failed, recording `(None, None)` — while the CALLER's frame provably held
`addr = '24:AC:AC:02:84:96'`. `capture.py` was unmodified, `bonding.ensure_bonded` is a plain function
with no wrapper, and the mangling is unaccounted for.

Which means the assertion was never trustworthy, including while it was green. A test that can report a
value the caller demonstrably did not pass is not evidence about the code; it is evidence about the
harness, and this suite's whole premise is that a green assertion must mean something.

Replaced with a SOURCE-ORDER assertion of the contract actually worth pinning: the bond is gated on
`needs_pmd` (an hr-only strap must not be bonded — doing so cost "a pointless bond attempt, an
18-SECOND GLOBAL CAPTURE PAUSE ... and a phantom link that then tripped the watchdog") and it happens
BEFORE the PMD control point is touched (the H10 drops an un-authenticated link ~1-2 s after connect).
Negative-controlled both ways: removing the `needs_pmd` gate reds it, restoring it greens it.
