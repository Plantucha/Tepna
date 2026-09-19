<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: none
---
Brief drain, device/box partition — six briefs re-verified against the tree AND the box, headers
stamped with what landed, what did not, and what a commit log cannot see.

Two absence clauses were false when written, not overtaken later: `BLE-SNIFFER-DUTY-CYCLE`'s
09-11 "`tepna-sniff.service`/`.timer` NOT in the tree" (they landed 09-06 under
`capture-host/systemd/`, not root), and `O2RING-PHASE4`'s 09-02 "no marker-aware-gridding artifact
anywhere" (the marker-aware axis shipped 08-08, #1048). One residue closed (`ppg2w-fill-rate`,
#2433). One open field witness measured from last night's journal (`VIGIL-OVERNIGHT` §8: 3.0/h
connect timeouts on an absent-H10 night, plus 16.5/h clock-sync deferrals from a different loop —
both numbers recorded, the population §8 meant left to the owner).

Box facts no `git log` can show, stated as such: the sniff timer is installed and DISABLED, the
sniffer dongles were reflashed 09-09, 43 `BUZZ fired` lines exist on four dates (the buzz
SCHEDULE has run; the correlation TOOL has not), no `tepna-capture@` instance runs. Each stamp
names the surface it checked; a clean result reads "nothing landed in the surface I checked".
No done-when box ticked — landings and candidates only.
