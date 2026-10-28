<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

# heron-stallwho — the loop-attribution instruments get a reader

**Unit.** Residue `2026-09-25-qc-poll-still-stalls-the-loop-without-tracing` is open on an owner
decision: arming either attribution instrument is a `config.yaml` key on the capture box. This unit does
the half that needs no decision, and the row stays OPEN.

**Branch + worktree.** `claude/stallwho-hrn` in `~/wt-stallwho-hrn`, cut from `origin/main` at
`3897b129a`.

**The defect this closes.** Neither instrument had a consumer. `capture.SlowCallbackWatch` logs the
callback by name, `capture.stall_sampler_watch` appends a row per stall to `<night>/STALLS.jsonl`, and
nothing in the repo read either. So a night that WAS armed still published `daemon:event-loop stall` with
no holder, and nothing opened the sampler's file at all.

**The shape.** `loss_audit.stall_attribution` reads both halves and publishes them beside
`stall_sample`, in the night record and in the verdict's `result`. Arming is three-valued per §∅: `false`
with `events: null`, `true` with `events: {}` for an armed and quiet loop, and `null` when the window
carries neither the ON nor the OFF line. Rows outrank an unread journal, because only an armed sampler
writes them. The cap and what it dropped travel with the rows.

**Next step.** The owner's arming decision, then a night. Until then the field reports `armed: false` or
`armed: null` with its reason, which is the honest state.

**Doc-search query.** `who held the loop slow callback stall sampler attribution reader`.
