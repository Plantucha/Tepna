<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
A branch code was called a firmware version, and a guard compared the wrong two fields.

One confusion, two sites. `oxyii.parse_get_info` returned the vendor's `branchCode` under the key
`"firmware"` and never exposed the real version; `_publish_ring_firmware` then compared the **DIS
Firmware Revision String** (0x2A26) to `O2RING_PLAINTEXT_FW = "2D010002"` — a branch code. That
comparison could never be true on a ring implementing DIS, and on this box's ring, which exposes no DIS
at all, the guard never ran.

Per §3c the two coexist on one device: `payload[9:17]` is the 8-character branch (`2D010002`), while the
firmware version is `[4].[3].[2].[1]` (`1.13.1.0`), with `hwV = [0]` and a bootloader from `[8]..[5]`.

**Additive, not a rename of meaning.** `parse_get_info` gains `branch_code`, `firmware_version`,
`hw_version` and `bootloader`; `"firmware"` keeps its branch value, deprecated. It is persisted —
`pull_session` writes it into a session sidecar as `device_firmware` — so changing what the key *means*
would rewrite the meaning of records already on disk while every consumer kept reading the same name.
`ring_firmware` keeps its value for the same reason: webmon forwards that exact key to the monitor.

**The guard moved to the field it always meant.** `O2RING_PLAINTEXT_BRANCH` is compared against the
branch code from GET_INFO — which every ring answers in our own handshake — inside the `0xE1` branch
where that value is already parsed, two lines from the identity check. DIS, when present, publishes as
a diagnostic beside `firmware_version` and is never the gate.

The premise is unchanged and still measured: the app-layer AES session on branch-`2D010001` rings is
real, and is a different layer from the LE link encryption Probe A refuted. Only the compared field
was wrong.

`aes_session_suspect(branch_code)` is **pure and takes the branch alone** — the signature is as much
of the fix as the body: a predicate that cannot see a firmware version cannot be keyed on one by
mistake. An unknown branch (GET_INFO unanswered) is not suspect; warning on absence would fire on
every link before identity arrives.

⚠️ Which plant reds the wrong fix, measured rather than assumed: a predicate keyed on the version
still fires for branch `2D010001`, so **plant 3 passes for the wrong reason**. The discriminator is the
paired opposite — the measured branch `2D010002` must NOT fire — which the wrong fix reds because a
version string never equals a branch code.

`find_unwired` required the whole chain: the new fields are published, forwarded by webmon, and drawn
by the monitor, which already labelled the value "branch" and carried a comment waiting for this rename.
