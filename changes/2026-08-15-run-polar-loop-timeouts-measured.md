---
bump: minor
type: added
brief: RUN-POLAR-MUTATION-STOP-HERE-2026-08-09-BRIEF.md
---

`run_polar`'s shutdown now has to actually reach its hold loops, and the mutation sweep's 13
loop-condition timeouts are measured rather than guessed.

§5 asked whether those timeouts were real non-termination or an artefact of `_stop_after`, which patches
`asyncio.sleep` to a no-op — the hypothesis being *"a loop that no longer awaits a real sleep therefore
never sees `_STOP`"*. **That hypothesis is refuted.** The loops in question do await a real sleep.
Measured by running the real `run_polar` under the **real** `asyncio.sleep` with a real deadline, one
mutant at a time:

| site | mutant | real sleep + `_STOP` set |
|---|---|---|
| hold loop | `client.is_connected and not _STOP` → `or` | **HUNG** (8 s ceiling) |
| …same, plus the link dropped | | EXITED 1.20 s |
| pause loop | `(paused or recovering) and not _STOP` → `or` | **EXITED** 1.20 s |
| …same, with the pause HELD | | **HUNG** |
| unmutated control, every arm | | EXITED 1.20 s |

**The operator is not what decides it.** Such a mutant is real exactly when its **sibling condition can
still be true at shutdown**, because `or` then makes `_STOP` unreachable. For the hold loop the sibling
is `client.is_connected` — true by definition during a session, and cleared only by the `finally` *after*
the loop, so nothing inside the process can end it. For the pause loop the sibling is transient, which is
why the same mutation looks inert in the ordinary path and is fatal when a pull owns the link at
shutdown.

⚠️ **One site would have produced either answer.** The first alone says *real*; the second alone says
*artefact*. Generalising from one file is this brief family's recurring error — the parent's §3 is a
retraction of exactly that — so the second site was measured before anything was written, and it changed
the conclusion from a verdict to a rule.

**Two tests now gate it, and they cost 0.56 s.** §5 expected these to be expensive; they are not, once
the mechanism is known. Both drive the real runner with a real sleep — under `_stop_after` they would
pass against the mutant, which is the whole finding — and use `_run_bounded`, so a regression **fails at
6 s instead of hanging the suite**. Verified by re-applying each mutant: each is killed by its own test
and only its own.

**What could not be settled:** the exact 13 mutant IDs are unrecoverable — the sweep state lived in
`/tmp` and did not survive the 2026-08-14 reboot. What is settled is the mechanism and the decision rule,
which is what those IDs would have been judged by anyway.

Also closed with this, all from the same brief's Done-when:

- **§3 `reconnect / bonding` DECLINED on evidence.** Its claim was the 2026-07-29 incident that cost
  4.5 h of ECG. The box journal re-read 2026-08-15: 3 `re-pair` lines, **all on 2026-07-30** — the tail
  of that same episode — and 0 escalations to the two-strike rule in the 16 days since. The weakness is
  stated with it: 16 quiet days is weak evidence about a rare failure, and the recovery path shipped
  *because* of that incident, so the quiet may be the fix working. Declined **reversibly**, with the
  trigger written down — a second incident reopens it.
- **§4's rule into `MUTATION-AUDIT-RUNBOOK` §7**, beside the ceiling rule: *a mutant killable only by
  asserting a tuned constant is not the suite's to own; pin the behaviour and let the number move.* With
  the boundary it needs — it governs **tuned** constants, not all constants. A number fixed by a wire
  format, a vendor spec or a physical unit stays pinned.
- **The declines recorded in `CAPTURE-HOST-MUTATION-FLEET` §7.8**, per family with reasons, in that file
  rather than only by reference, so `run_polar` cannot be re-opened as if untouched.

Capture-host only: no bundle, no JS lane, no fixture.
