---
bump: patch
type: added
brief: none
---

**All 170 tests in `test_nightqc.py` passed identically before and after #3009 changed the coverage
denominator from the session span to the device's own span.** `_cap` writes clockless `i;i` rows, so
`file_span_sec` returns None for every fixture, every one fell back to the session span, and the new path
was never reached. The suite could not see a live behavioural change, and the zone defect that came with
it surfaced only in CI. A green suite said nothing, which is the most expensive thing a suite can say.

This adds the scan that makes that impossible to repeat: every test whose docstring makes a time claim and
which builds its night with the **clockless** `_cap` must either move to `_cap_timed` or be declared here
with the reason its claim needs no stamps. Keyed on the **fixture call**, not on a name — what a test is
made of is the property in question, and a name-keyed scan would be the wrong tool for the same reason the
schema scanner's leaf key was.

⚠️ **The answer is not "move them all", and measuring said so.** Of the 20 time-claiming tests on `_cap`:
16 make **session-level** claims — pooling, splitting, the cross-midnight boundary, band selection — which
are decided by filename stamps and mtimes, both of which `_cap` + `_utime` model faithfully and no device
clock enters. One has no data files at all. **Two assert the ASSUMED-RATE path on purpose** (`_cap` writes
too few rows for `measured_hz` to read a rate, so coverage is computed against the configured one and the
row reads `(rate assumed)`) — moving those onto timed fixtures would turn their basis to `measured` and
**delete the coverage they exist to provide**. The last is the fallback test itself, whose whole claim is
that a clockless file falls back and says `span_basis: session`.

So nothing moved, and the deliverable is the declaration plus its two controls: a **spent-entry** check, so
a declaration for a renamed or already-moved test fails rather than making the list look considered; and an
**anti-vacuity** check, because both assertions pass over an empty population if the AST walk breaks —
which is this repo's most-repeated defect. Falsified by removing one declaration: the scan names exactly
that test.

`_tz` gains **`Asia/Kolkata`** as a third zone — a half-hour offset catches a sign error or a
rounding-to-the-hour that two whole-hour zones agree on. 183 tests pass under UTC, America/New_York and
Asia/Kolkata.

**`test_loss_audit.py` needs nothing, and the way that was established is the point.** A docstring scan
reports zero time claims there — because its 39 tests carry **zero docstrings**, so the scan was examining
nothing, and I nearly wrote that down as a finding. Checked properly: its own `_stream` fixture writes real
Phone timestamps, and `loss_audit.py` never calls `.timestamp()` at all — it stays in naive civil time and
only takes **differences**, which is zone-safe by construction. Verified rather than read: 39 passed under
all three zones. That module does it right, and the contrast with `nightqc._session_of` — which converts a
floating civil stamp to an epoch with the reader's zone — is the whole of residue
`2026-09-24-session-span-resolves-a-floating-stamp-in-the-readers-zone`.

The second half of the same gap is filed rather than bundled:
`2026-09-24-nightqc-session-tests-plant-stampless-filenames` — 21 of 63 filename plants are 8-digit, so
`_session_of` takes its mtime fallback and the session-grouping tests verify the legacy branch. The
re-derivation that fix needs is the risky part and does not belong in a PR whose point is that tests were
not seeing what they claimed.

**Proposed, not done:** a `TZ` matrix on the capture-host CI job would catch the zone class at the same
place it first appeared. Workflow edits are the owner's, so it is proposed in the PR body and not made.
