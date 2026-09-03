<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [tools]
brief: none
---
tools: the trio fold now READS the ring-clock cross-check it writes — `datTimefit.disagrees` compared two independent measurements of the ring's clock offset, was serialized into `arrival_<night>.json`, and was consumed by nothing, so a verdict that read as a check never was one; the fold's end-of-run block now names the nights that disagree, and reports an unreadable sidecar rather than skipping it.
