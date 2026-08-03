<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: O2RING-PROTOCOL-2026-07-17-BRIEF.md
---
The same opcode question asked of the O2Ring — and why the Polar answer does not transfer.

`probe_pmd_opcodes.py` mapped the Polar PMD instruction set **without executing anything**, by leaning
on a status code: an implemented op rejects the CALL (`invalid_meas`), an absent one rejects the OPCODE
(`invalid_op`). That produced a clean negative — 54 opcodes proven absent, device byte-identical before
and after.

**The OxyII envelope has no status field.** A command either produces a reply frame or it does not, so
the discriminator is REPLY vs SILENCE — and silence is "no evidence", not "absent". An unknown command
that *is* implemented simply runs, and the command space demonstrably contains state-changing ops
(`0xC0` writes the device clock). So `probe_oxyii_opcodes.py` is honestly weaker than its Polar sibling
and says so in its own output.

Mitigations: refuses without `--i-accept-the-risk`, skips the 8 known ops, empty payloads, a live-frame
snapshot before and after every reply, and abort at the first unexplained state change. The main risk
is already covered — the daemon's auto-pull has stored sessions on disk through 2026-08-01, so the ring
is not the only copy of anything.

**Not yet run, because the ring is unreachable off-finger.** Measured 2026-08-03: zero advertisements in
a 30 s scan while 10 other devices were visible, a direct connect fails at the link layer after 45 s,
and BlueZ holds no cache entry (consistent with §1's "no bonding / no pairing is needed" — there is
nothing persistent to cache). This extends `O2RING-PROTOCOL` §5: the ring advertises only when **worn**,
and **charging does not wake the radio either** — it is unreachable in exactly the state one would most
want it, sitting on a charger between nights. That is stricter than the Verity, which advertises in
every state.

capture-host only, out of suite — no bundle, no `manifestHash` movement, no fixture re-recorded.
