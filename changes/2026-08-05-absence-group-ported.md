<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
---

Replaces the OxyDex absence group's input selection and CS control with the stronger implementation
written concurrently in another session (commit `484c01ab`), which a force-push of mine overwrote
before #949 merged. It orders the committed synthetic twin FIRST so CI and a corpus machine drive the
same leg, and replaces a night-specific `csScore > 0` control with an input-independent one that
synthesizes a low and a high `crcIdx` and asserts the low scores higher — the detector is alive on any
input, with no per-lane special-casing.

Fixes one defect in that version: its optional corpus leg asserted
`[crcIdx, csScore].join('/') === 'null/0'`, but `join` renders null as the empty string, so the
expression is "/0" and the assertion could never pass. It runs only where a corpus exists, so CI could
not see it fail. Split into two value assertions.
