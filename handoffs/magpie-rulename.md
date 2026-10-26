# Magpie — unit `rulename`

**Row:** `2026-10-26-the-suite-night-rule-detector-reads-an-inline-rule-only` (OPEN at the ref)
**Branch:** `claude/rulename-mg` · **Worktree:** `wt-rulename-mg` (sibling of the primary checkout) · **Base:** `d8c5786a2`
**Claim:** board #1570 on thread 7
**Rule 0:** `suite detector reads an inline night rule object at the snapshotNights call site` (0.245)
→ board #1533 (Heron's tool-side twin of this blind spot), #1352, #1482, #1343, #1347.

## The defect, and two more of the same family

The `ruled` population in `tests/dex-tests.js` asked which tools declare their own night rule by
testing `snapshotNights\([^)]*\{[^}]*\bre:` over the raw file. Three shapes defeat that text:

| shape | the old regex | ships today |
|---|---|---|
| a rule bound one line earlier and passed by NAME | blind | `tools/corpus-scope.mjs:1051` |
| a call in the FIRST argument, which ends the `[^)]*` run | blind | nowhere yet |
| a tool source planted in a STRING by a selftest | counts it | `tools/night-rule-horizon.mjs` |

The first is the row. The second and third are the same reader read twice more, and the third runs
the other way: a text census over raw bytes counts the text that explains the code.

## The reader

`nrSites(text)` masks comments and strings with the one lexer (`js-lex codeMask`), finds each
`snapshotNights` call by scanning for the NAME and then its parenthesis, takes the balanced argument
list, reads the second argument, and resolves an identifier through its own binding. It returns
sites, rules, ruleless and **unreadable**, and the leg reds on a non-empty `unreadable`, because a
site whose rule went unread is not a site with no rule.

## Population-neutral at this ref, and measured both ways

17 rule-declaring tools before and after, symmetric difference empty, 3 wide-rule tools either way,
87 sites over 43 importers, 0 unreadable. **Dropping the mask alone joins `night-rule-horizon.mjs`**
on 2 rules its own selftest only quotes — so the mask is load-bearing and the number proves it.

## Plants, each against the final code

1. The code mask removed → 2 red: the string-planted control and the comment control.
2. The by-name branch removed → 2 red: the by-name control, and the ruleless control which flips to
   unreadable, so no form passes silently.
3. A live by-name rule planted into `acc-select-compare.mjs`, which prints no `ruleLine` → 1 red
   naming the tool. The old regex sees that plant as nothing.
4. An options form of `ruleOf(DIR)` planted at the same site → 1 red naming
   `acc-select-compare.mjs:199`. The coordinate is the file's own line, because the mask preserves
   offsets.

Restoring after each gives 138 of 138.

## Not in this PR

The row's closure. A code PR here does not touch the ledger, so `fixed #NNNN` rides the RESIDUE-only
PR Kestrel sequences.

---

## FINISHED 2026-10-26 — PR #3990 (DRAFT), head `e33246037`, base `d8c5786a2`

`npm run check` — all 41 steps passed, EXIT=0, suite 14470 assertions over 830 groups. Biome clean
on the changed file against a base control reading 0 diagnostics, typecheck EXIT=0, and
`pr-compliance.mjs` passed its 9 checks before `gh pr create`.

⚠️ **A STATEFUL `exec` LOOP WITH `continue` ARMS COST A BIOME WARNING AND WOULD HAVE COST A SPIN.**
`while ((m = re.exec(t)))` reds `noAssignInExpressions`, and the base file carries zero diagnostics,
so the warning was mine. Scanning by index instead removes both the warning and the hazard: every
`continue` would otherwise have to remember to advance the regex.
