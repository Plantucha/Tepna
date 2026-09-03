<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: O2RING-PROTOCOL-2026-07-17-BRIEF.md
---
The O2Ring's AES key blob appears only on the PAIRING connect — reproduced across both public
Discussion #180 logs, which are now preserved locally because the thread is closed. Every later connect
gets an over-short reply then nothing, and runs in plaintext: `encrypted=1` twice (both pairings) against
`encrypted=0` six times. Practical consequence: a ring already paired to a host presents no key blob, so
our BLE path would work against `2D010001` hardware today despite having no cipher. Recorded with the
caveat that this is a property of a client-ring PAIR — the logs cannot separate "the ring only offers a
key at pairing" from "the client only asks at pairing".
