# Heron — unit 20: the stall bin states what it covers

**Unit.** The `daemon:event-loop stall` bin publishes its own coverage in `LOSS-AUDIT.json` and in the
night verdict. The caveat lived in a source comment before this.

**Branch and worktree.** `claude/stallcover-hrn` @ `52d6f105b` in `~/wt-stallcover-hrn`, cut
from `origin/main` @ `eb0ac7b7c`. PR **#3918**, DRAFT, base main, MERGEABLE, 0 behind. Two commits: the
code and tests, then the one row.

**Exact stopping point.** Everything landed and every gate ran green on `52d6f105b`.

`check.sh` EXIT=0
with 11355 passed and `TOTAL 30006 0 10398 0 100%`. `tools/mutate_diff.py --base origin/main` EXIT=0,
PASS over 3 functions, every owed mutant killed. `npm run check` EXIT=0 over all 40 steps. CI reads 26
pass, 1 pending, 1 skipping. Board note #1178, gate comment on the PR itself.

**Next step.** Nothing on this unit. The PR waits for the owner to undraft it, since I never undraft my
own. The next unit takes the oldest OPEN row of my lane from `origin/main`.

**Open questions.** Row `2026-09-25-qc-poll-still-stalls-the-loop-without-tracing` stays OPEN and I ask
Kestrel to mark it owner-blocked. Its named per-callback instrument exists twice —
`capture.slow_callback_watch` and `capture.stall_sampler_watch` — and both sit OFF by default. Arming
one is a `config.yaml` change on the box, which is board #281 items 2 and 3. The carried owner queue is
unchanged: the `unreadable` ruling, the re-judge bin, the NAS export, and the 176 Hz trial.

**Blockers.** None for this unit. The NAS export outage blocks any PR that re-runs a bundle over a real
recording, and this one touches no bundle.

**doc-search query.** `the event loop stall bin is a rate limited sample and the artifact never says so`
→ `capture-host/loss_audit.py:236-250` · `capture-host/capture.py:11631-11649` stall_sampler_watch ·
`memory/a-rate-limited-warning-is-a-sample-not-the-record.md`. That third hit is my own measurement from
2026-10-13, and it is what kept this unit from inventing a suppression count.

## What a resumer should know

🔴 **The row's named NEXT was already built, and by me.** A row's remedy ages exactly as a line
number does. Grep the tree for the mechanism and grep your own state file for its name, then ask
whether the remedy is absent or merely DISABLED.

🔴 **`suppressed` is null, and the reason names where the record IS.** The daemon counts a stall at
100 ms and logs one at 1000 ms, capped at one line per 300 s. So its `stalls so far: N` spans two
populations against the lines seen. The live count sits in the daemon's own `loop` status block, and the
reason says so rather than stopping at unknowable.

⚠️ **Two modules now state the same three numbers.** A test pins `loss_audit`'s published values against
`capture._LOOP_LAG_STALL_MS`, `_LOOP_LAG_WARN_MS` and `_LOOP_LAG_WARN_EVERY_S`. The reason string is
built from the constants, so the prose cannot drift from the numbers either.

⚠️ **`loss_audit.py` carries no module-level mutation exclusion**, unlike `capture.py` and `webmon.py`.
So this gate run is evidence about the diff rather than about the filter.
