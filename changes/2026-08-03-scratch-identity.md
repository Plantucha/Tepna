<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Mutation records now carry their scratch identity, so a cross-generation survivor diff cannot fabricate a delta silently.

Mutant IDs are numbered positionally per function, so `x_f__mutmut_34` in two different generations is
the same NAME and not necessarily the same MUTATION. Diffing survivor sets across generations therefore
produces a plausible, entirely fabricated delta.

That happened on 2026-08-03: a `run_polar` comparison reported **14 regressions that did not exist**,
because the baseline scratch had been deleted by this tool's own pruning and the "after" set came from a
different generation. The pruning is correct — `/tmp` is tmpfs and a scratch is 100–150 MB — but it
silently destroys the thing a diff depends on.

Every record now carries `scratch_id` and `mutant_generation` (the mutated module's source hash), and a
run that pruned an older scratch emits a `WARNING` naming what it removed. A before/after pair is valid
only when both `mutant_generation` values match; the runbook now says so where it describes diffing.
