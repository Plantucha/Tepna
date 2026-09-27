<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [tools]
brief: none
---
`tools/systemd/tepna-tchref-nightly.{service,timer}`: a daily user timer on the corpus machine that runs
`tools/tch-firmware-reference.mjs` over the nights its ledger lacks and writes one `tepna.verdict/1` object
beside the ledger. Paths come from an owner-written EnvironmentFile, so no corpus or home path is committed;
the ledger stays outside every repo (owner-ordered, 2026-09-26).
