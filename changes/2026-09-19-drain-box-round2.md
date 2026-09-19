<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: none
---
Brief drain, box round 2 — four briefs re-verified against the tree AND the capture box; one
present-tense capability claim corrected in place.

`VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT` said *"`tepna-sniff.timer` runs a nightly capture"* — true on
09-05, false since the 09-09 reflash, and a present-tense positive reads as corroboration where an
absence claim would merely read as stale. Corrected to RAN 09-06 → 09-09, with the box facts: timer
disabled, both nRF dongles now ordinary Zephyr HCI-UART controllers (hci2/hci3, two `tepna-btattach@`
units), no sniffer radio, owner ruling D2 = leave inert; and Mitigation C clause 1 still un-armed
(no O2Ring `serial:` key on vigil).

`AS11-AUTO-SESSION-DETECTION`: the 09-03 defect persists, measured on last night — 340 `idle/Standby`
rows and one `active/Therapy` across 22:00–07:00 while the live stream wrote a 2.07 MB `BRP.edf`
00:41–06:05; `Leak` still not in `POLL_ITEMS`; and the header's Next step names the instrument the
same header withdrew — the 25 Hz EDF it names instead is now recorded every night, so the debounce
measurement needs an analysis, not an attended session.

`VIGIL-BLUETOOTH-ADAPTERS`: the four controllers and their roles as they stand, the corrected residue,
nine adjacent landings. `AS11-SESSION-DETECTOR-IMPLEMENTATION`: `SESSIONDETECT.csv` live (40,263
rows), increment 3 still a decision, with one observation for it — the daemon already acts on therapy
from the stream's own flow channel.

Each stamp names its surface; negatives read "nothing landed in the surface I checked"; box facts are
marked not checkable from code. No done-when box ticked.
