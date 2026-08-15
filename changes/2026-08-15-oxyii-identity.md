---
bump: patch
type: added
---

The O2Ring pull now records **which firmware produced the bytes**, and the last of the detector's
orphans are resolved — `find_unwired.py` reports **0 unexplained** on both scans.

`parse_get_info` said why this mattered and was called by nothing: *"this device's behaviour is
firmware-dependent (the F2 MTU gate differs between 2D010001/2/3), so a capture should record which
firmware produced it."* Nothing in the tree recorded the ring's firmware — the only firmware handling
anywhere was Polar-side. A capture whose interpretation depends on firmware, and which does not say
which firmware, cannot be re-read later with that knowledge.

The read goes in `pull_session.py`'s existing handshake, bounded at **6 s** rather than the usual 20,
and is **strictly non-fatal**: the recording on flash is irreplaceable and a firmware string is not. A
ring that ignores `0xE1` yields `device_firmware: null` — an honest "not read", since *not read* and
*old firmware* are different facts and only one is a reason to reinterpret a capture.

**⚠️ It also caught a regression that was about to ship.** With the test fake declining to answer
`0xE1`, `test_pull_session.py` went from **0.24 s to 4 minutes** — 49 tests each paying the timeout. A
fake that does not answer a command the real device answers is not a neutral omission: it leaves the
happy path untested *and* makes CI slower. The fake now replies; the file is back to 0.26 s; the
non-answer path has its own test.

**The other four orphans were investigated and recorded rather than wired**, because the docstrings
answered the question:

| | |
|---|---|
| `battery_frame` / `parse_battery` | superseded — `byte[1]` matches the live header's battery percent, which the live path reads every frame |
| `config_frame` / `parse_config` | a diagnostic ("verifying the ring's config without the vendor app"), not provenance; no `SET_CONFIG` writer ships |
| `is_offline_cmd` | the READ half of a write/read pair whose write half **is** used — `as_offline` sets the bit in two probes; nothing needs to ask back |

Two mutants verified: removing the identity read fails the firmware test; making its failure fatal fails
the resilience test.

From `CAPTURE-HOST-UNWIRED-MACHINERY-FOLLOWUPS-2026-08-15-BRIEF.md` §1.
