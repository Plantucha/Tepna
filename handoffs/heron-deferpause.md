# Heron — unit 17: a deferral after a paid pause leaves the A5 record set

**Status:** PR open as DRAFT, three gates green on the pushed head. 2026-10-25 09:30Z.

## 1 · Unit

Row `2026-10-21-the-night-judge-counts-clock-rows-that-recorded-no-clock-write`, OPEN at the ref. Unit 16 measured the trade and named the cause as the WORD LIST rather than the judge. This unit lands the one-word half of that finding.

## 2 · Branch and worktree

`claude/deferpause-hrn` @ `5b8c5f6ed` in `~/wt-deferpause-hrn`, cut from `ed92bdf31` and rebased onto `8f3500720`. PR **#3917**, DRAFT, MERGEABLE, 0 behind, local and remote refs agreeing. Four files, 94 insertions.

## 3 · Exact stopping point

The PR body carries the stamped sha and the coverage line, and it lints PASS. Board note #1171 reports the finish. Nothing is left in the worktree: `git status --short` is empty.

The diff is four changes. `_A5_NON_RECORD_EVENTS` gains `deferred-after-pause`. `writers.append_clock_sync_event` documents the word. `clock_records` and `unrecorded_shift` lose the two docstrings that contradicted their own code. The test runs one case per member of the set and asserts the set itself.

## 4 · Next step

Nothing on this PR. It waits for the owner to undraft it, because I never undraft my own. The next unit takes the next OPEN row in my lane. The oldest is `2026-10-21-the-polar-clock-verdict-does-reach-a-night-artifact`.

## 5 · Open questions

The `unreadable` disagreement is the owner's and board #1170 carries it. The journal source admits `device clock unreadable` while this list excludes the same event. I recommend NO on admitting it, on the producer's own words at `capture.py` `clock_decline_verdict`.

Three rows are still unlogged, and a code PR may not carry them. They are the undocumented word, the journal device name-against-address mismatch at `loss_audit.py:1541`, and the borrowed reason at `tools/measurement-walk.mjs:240`.

## 6 · Blockers

🔴 **The mutation gate examined nothing and exited 0.** `mutate_diff --base origin/main` reads `NOT_APPLICABLE` with `checked: 0`. The semantic change is a module-level tuple and the rest are docstrings, so no changed function body exists. A hand plant stands in for it: the list without the word reds the new test by name at `test_solid_night_inputs.py:2147`. `git show HEAD:<path>` then restores the tree.

🔴 **Two sessions widened one tuple within the hour.** #3916 appended `released-to-set` while this branch was in flight. `rebase-safe` refused the wholesale resolution, and the equality assertion named the new member. Take main's copy and re-run the insertion; never keep one side.

## 7 · The doc-search query

`node tools/doc-search.mjs --read "exclude a deferred clock sync event word from the A5 record set"` → `capture-host/tests/test_loss_audit.py:2385-2411` · `capture-host/solid_night_inputs.py:1513-1535` · `capture-host/tests/test_solid_night_inputs.py:478-503`. Unit 16's measurement is board #1168 and its correction is #1169.
