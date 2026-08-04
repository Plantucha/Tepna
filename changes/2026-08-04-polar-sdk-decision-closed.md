<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md
---

Close the Polar-SDK decision doc — Track A was decided, built and hardware-proven — and correct the
stale `polar_pmd.py` header that was still asserting the opposite.

The brief flips DONE on its own terms: §6 asks for a track to be picked and the accepted work to open
dated briefs. Track A was executed, not merely picked. `polar_pmd.py` decodes the PMD wire format
against the specification Polar publishes with its SDK — quoting the SDK's own Kotlin at `:123` — while
never linking to, vendoring or depending on it.

Its gating open question is answered, and favourably: offline-recording control IS reachable over
`bleak`/PMD (`OFFLINE_BIT = 0x80`, plus `polar_psftp.py` / `polar_mirror.py`), so the automated-fetch
backstop was a Track-A win rather than a Track-B-only feature. Track B is routed to its own dated
briefs — `SPORT-CAPTURE-ANDROID-2026-07-18`, `POLAR-OFFLINE-DOWNLOAD-2026-07-17`,
`POLAR-ONBOARD-BACKUP-2026-08-01`.

The finding worth keeping: `polar_pmd.py`'s header still said "UNVERIFIED ON HARDWARE" and named the
missing compressed-frame decoder as "the one open gap, and the only thing that would reopen the SDK
question". Both had been false for weeks — `_decode_delta` / `_decode_delta_ex` ship with known-answer
tests (landed `487407bf`, hardened `01b99a3c`), and the daemon captures nightly with measured rates
matching the negotiated ones. A header claiming a shipped decoder does not exist is exactly how a
settled decision gets relitigated, so it is corrected in place rather than left for the next reader.
The one caveat that IS still true — start-command TLVs must match the device's `requestStreamSettings`
for your firmware — is kept and marked as such.
