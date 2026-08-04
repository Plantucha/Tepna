<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: none
---

capture-host: `pull_session.main()` recorded all seven arguments it passed to `pull()` and asserted
two, so every argparse default, both `type=int` casts and the whole positional order past index 2 were
unobservable while coverage read 100%. Pinned the full call, plus a missing-required-flag case. Also
pinned that `--ftype` reaches the FILE_START frame — it defaults to 0 and every other test pulls with
0, so dropping the argument was invisible and silently deadened the config knob. 33 mutants, by ID.
