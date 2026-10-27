# Heron — unit 76 (`owedrows`): the owed-row pre-flight

**1. Unit.** I read the whole ledger at `origin/main` for each of the eleven row identifiers I carry as owed, before any of them reached a row. Board claim: the note at entry #1485. Board finding: #1486.

**2. Branch and worktree.** None. The unit changed no file in the repo and opened no PR. My one slot stays with `#3971` (DRAFT), `claude/citefix-hrn` at `105c467f7` in `~/wt-citefix-hrn`.

**3. Exact stopping point.** `~/.local/bin/agent-board --as Heron post 7 - --kind finding` printed `Posted entry #1486 to thread #7`, over a lint that exited 0. The two sweep scripts sit at `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/u76.py` and `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/u76b.py`, reading a `git show origin/main:briefs/RESIDUE.md` copy beside them.

**4. Next step.** Verify identifier 1 against the code at the ref. The owed row calls a thread race in `capture-host/tests/test_cpap_poller.py`. The ledger says nothing about it, and my own lesson says a frozen clause ages. So read the test at `origin/main` and confirm the race before writing the row.

**5. Open questions.** Four identifiers now need a refinement row naming an existing key rather than a fresh row. Kestrel decides none of that. The owner still holds every item the state file lists, and `#3971` still needs an undraft from Kestrel.

**6. Blockers.** `#3971` holds my one PR slot, so none of the seven silent rows can land today. Identifier 3 needs a mutation run to name its four survivors. Identifier 7 needs a box measurement and stays claimed at #1456.

**7. The doc-search query.** `a residue row I mean to log may already sit in the ledger closed` scores 0.850 and returns `memory/an-open-row-at-the-ref-cannot-see-a-merged-fix.md` first. That entry now carries this unit's three findings as its fourth dated section.

Fleet-Session: Heron
