# Heron · unit `yearhz` — the year-pinned night rule gets a tripwire

**1 · Unit.** Build the gate that fires BEFORE the horizon of the year-pinned night rule, for row
`2026-10-26-the-corpus-night-rule-is-pinned-to-one-calendar-year`. The row's own remedy stays the
owner's decision, so this unit builds only the half that is nobody's decision.

**2 · Branch and worktree.** `claude/yearhz-hrn` @ `8a7bc76d6` in `~/wt-yearhz-hrn`, base
`b73e9f199` after `rebase-safe`. **PR #3982, DRAFT, two commits.** Five files:
`tools/night-rule-horizon.mjs` new, plus `tools/verdict-adoption.json`, `docs/TOOLS-INDEX.md`,
`changes/2026-10-26-night-rule-horizon-tripwire.md` and one appended ledger row. Board claim #1527,
reports #1530, #1533, #1536 and #1537.

**3 · Exact stopping point.** Both commits sit pushed and the tree is clean. `npm run check` passed
all 41 steps with EXIT=0 on the pre-rebase content, over 14420 assertions in 830 groups.
`rebase-safe.mjs` then moved the base and amended no artifact, and the census reads identically at the
new base. `pr-compliance.mjs` passed 9 checks before `gh pr create`. The row logged for this unit
travels inside the PR as `fixed #3982`, and `residue-ids.mjs` reads 1 row added, none mutated.

**4 · Next step.** Kestrel undrafts #3982, which I asked for at board #1537. Then Kodiak takes it.
On merge, run `node tools/wt-done.mjs ~/wt-yearhz-hrn` and release claim #1527.

**5 · Open questions.** The row's remedy needs the owner: widen the rule and change the population, or
keep the pin and invert the default. Osprey claimed the row's 327 clause only, at board #1400, and owes
the correcting row. My tripwire takes neither half of that question.

**6 · Blockers.** The undraft is Kestrel's call. The one-PR cap holds my next unit's PR until #3982 merges.

**7 · The doc-search query.** `node tools/doc-search.mjs "night rule pinned to one calendar year
horizon tripwire"` → board #1400 (Osprey's claim of the 327 clause), board #1347 (the eleven carrier
names, measured independently), board #1346 (the three measurements Osprey planned).

## What the unit measured

A row count and a site count are two units, so the verdict states both. 22 rules over 49 sites declare
a night rule under `tools/`. 17 rules over 35 sites ship, 11 of those rules pin the year over 11
tools, and 5 rules over 14 sites sit inside a file's own selftest. 175 nights over 5 readable roots of
11 documented. The earliest horizon is 2027-01-01, carried by the same eleven tools the row lists.

Four defects of my own instrument. The live read caught the first two, and Osprey's question at board
#1531 found the third:

1. **A fixture rule judged as a scorer turned one deliberate refusal into 174 findings.**
   `corpus-scope.mjs:1086` declares `/^2026-07-25$/` inside its selftest to prove the primitive
   refuses. Judged, it reported a refused pair for every other night in the corpus. The verdict now
   excludes a fixture site by name and counts a shipped dead rule once per site.
2. **After the declaration is not inside the body.** My first classifier called a site a fixture when
   it sat below the file's `function selftest(` line. Six shipped `pat-*` sites sit below theirs,
   because each file declares the harness above its command path, so the reader dropped two thirds of the
   judged set and still printed PASS. The body now ends at the next closing brace in column one.
3. **Two regexes that share a blind spot cannot see what both miss.** The site expression looked for
   `re:` inside the call text, and the resolver read the rule out of that same text.
   `corpus-scope.mjs:1050` builds the rule into a named object, and line 1051 passes it twice. So the
   census neither counted nor read those two sites. The fail-closed arm compared a site count against
   a resolved count, and both came from the same blind expression, so it had nothing to compare.
4. **One counter over two families cancels a miss against a hit.** My first draft of the fix shared
   one `resolved` counter, which would let an unread inline site hide behind a resolved options
   object. Each family now owes its own arithmetic.

A fifth lesson is about reporting rather than reading. A count beside one line number reads as that
line repeating, so a folded row now names every line it was read at. Line 782 of `corpus-scope.mjs`
holds two calls, so a repeated number in that list is a measurement rather than a duplicate.

The reconciliation that caught the first three: a second session counted eleven carriers with a
different reader, and my 13 and my 5 disagreed with it. An instrument that disagrees with an
independent count of the same thing is wrong until it explains the gap.
