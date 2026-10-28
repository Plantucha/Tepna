# Magpie — unit `sharecap`

**Row:** `2026-10-18-board-hits-have-no-share-cap-in-rule-0` (OPEN at the ref, and it stays open)
**Branch:** `claude/sharecap-mg` · **Worktree:** `wt-sharecap-mg` (sibling of the primary checkout) · **Base:** `49a59cf71`
**Rule 0:** `board posts crowd the Rule 0 top hits with no cap on their share` →
`ext:memory/agent-message-board-fleet-channel.md:30-33`, `tools/board-corpus.mjs [chunk 2/3]`,
`ext:memory/kestrel-state-2026-10-13-owner-rulings.md:93`. The first names this row as Kestrel's; the
second holds the kinds filter the owner ordered on 2026-10-17.

## The deferral had a trigger nobody could read

The owner deferred the cap: "the cap waits until the board nears 1,000 posts". That is a STAND-IN. The
thing anyone cares about is whether briefs and code lose their place in the top five.

| reading | 2026-10-18 (the row) | 2026-10-28 |
|---|---|---|
| entries | 75 | 1,819 |
| of the four indexed kinds | 49 | 723 |
| snapshot bytes | 135 KB | 2.4 MB |
| board hits in the top five | not measured | **3 of 95** |
| worst single query | not measured | **1 of 5** |
| hourly re-read | projected 18 MB at 10k | **0.11 s, 72 MB peak RSS** |

**The stand-in fired and the harm did not.** The post count passed 1,000 and the board still takes 3.2 %
of the top-five slots, never more than one slot in any single query.

## So the cap is not the buildable half

A cap written today binds on nothing, and a guard that binds on nothing is the examined-nothing shape
this repo spends its gates refusing. It could also cost recall on the `fleet` arm, where a board post
is the best answer there is. `tools/board-share.mjs` makes the deferral condition mechanical instead:
it reads the share on a committed query set and names the moment the cap falls due.

## Two rules, each a selftest

🔴 **THE THRESHOLD IS PRE-STATED FROM THE SHAPE OF THE LIST, NOT FROM THE READING.** A bound read off
today's numbers is `UNKNOWN` under the verdict contract. At three of five the board holds the majority
of a five-slot list, so the bound is two of five. The aggregate share sits beside it as a diagnostic,
because an average hides the one query the board swamped — a selftest plants exactly that case.

🔴 **THE TWO ABSENCES KEEP SEPARATE STATES.** A query doc-search could not run is `unreadable`. A query
the reranker floor rejected is `below-floor`. One slot of the population is absent and the other is
genuinely empty, and a single `excluded` cell cannot say which.

🔴 **A QUERY THAT ANSWERS NOTHING STAYS IN THE SET.** I had dropped the one query the floor rejects
before I noticed that curating the population to the queries which produce hits makes the share a
statement about the curation. It is back in, and the live run carries it as the one excluded row.

## Gates

- `node tools/board-share.mjs --selftest` ✓ 33
- live reading: PASS, 19 checked of 20 eligible, 1 below-floor named, worst 1 of 5, overall 3 of 95
- `node tools/verdict-adoption.mjs --check` ✓ after the manifest row; byte form canonical
- `npx --no-install biome check` ✓
- `npm run check` — result appended below and posted as a PR comment

## Not in this PR

The cap, and the row. The owner owns the cap, and the reading says it is not owed yet. The row's third
defect also stands: a post a later post overrides still ranks like a current one, and nothing here
detects that.

---

## FINISHED 2026-10-28 — head `9153cd574`, PR #4041 DRAFT, all 41 steps pass

`npm run check` reads `EXIT=0`, `✓ check — all 41 steps passed`, suite `✓ all 14592 assertions
passed (834 groups)`. `verdict-adoption` reads 145 `decides` producers with 141 gated, 168 adopted
at the merge base `49a59cf711ae` and 0 de-adopted, byte form canonical.

🔴 **STEP 37 REDS LAST, AND IT LINTS THE CHANGESET.** The first run died at `verify:pr-compliance`
over one `passive` in `changes/2026-10-28-board-share-instrument.md`. I had ste-linted the handoff
and the PR body, which is the prose a reader sees, and not the changeset, which is a new Markdown
file in the diff. Four steps then never ran at all and the gate printed "this run says NOTHING about
them" over their names. The cost of one unlinted line is the whole gate twice. Second sighting of
the shape this week, after unit `probesplit`.

⚠️ **THE FIVE RE-RUN STEPS WERE NOT A GATE.** Re-running only the steps that never ran leaves steps
1 to 36 standing on the pre-amend tree, so the run above is a full `npm run check` on the final head
instead. One gate over one state.

The row stays OPEN and the ledger is untouched here: the reading says the cap is not due, and the
cap is the owner's to order.
