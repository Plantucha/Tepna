# Heron — unit 63: the ledger guard's data-position remedy, sized and redirected

**Status:** SIZED 2026-10-26, no PR. This unit refuses the row's remedy and measures an alternative.
**Board:** claim #1419, finding #1420.

## 1 · Unit

Row `2026-10-26-a-data-position-ledger-mention-denies-the-command`. The row is right that the guard
denies four data forms. Its named remedy shape — extend the heredoc-body drop to a quoted literal —
opens a write hole and misses the form the row measured first.

## 2 · Branch and worktree

None. This unit wrote no repository code. My one open PR is #3954, `claude/heredocrow-hrn` @ `a16baabd8`
in `~/wt-heredocrow-hrn`, DRAFT, 41 of 41 gate steps passed.

## 3 · Exact stopping point

The control is
`/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/ctl65.sh`.
It takes the scratchpad directory as `$1`, extracts the guard from `origin/main`, and builds two
variants by plant. Both plant-site counts print 1, so neither arm runs the shipped file by accident.
The script assembles every guarded path from two halves, so its own text names none.

| case | shipped | the row's quote-strip | a narrow data-carrier exemption |
|---|---|---|---|
| read, path QUOTED | DENY 2 | ALLOW 0 | DENY 2 |
| `sed -i` write, path QUOTED | DENY 2 | ALLOW 0 | DENY 2 |
| `git commit -m` naming it | DENY 2 | ALLOW 0 | ALLOW 0 |
| `echo` of the bare path | DENY 2 | DENY 2 | ALLOW 0 |
| read, path UNQUOTED | DENY 2 | DENY 2 | DENY 2 |

**Three facts decide the remedy.**

1. Row 2 is a stale overwrite of the ledger, the one event this guard exists to stop, and the row's
   remedy exits 0 on it. `cmd_noquotes` blanks the content of every quoted span
   (`guard-shared-tree.sh:43`), and most commands take a path quoted.
2. The precedent refuses the lift in its own comment. `guard-shared-tree.sh:122` scopes the quote strip
   to the `commit` rule because the add, reset and clean rules still match raw, and `:60` says
   generalising it would reopen a live gap. The ledger guard has one rule, so that premise is absent.
3. Row 4 is the row's own first evidence. An `echo` of the bare path carries no quotes, so a quote
   strip leaves it standing.

## 4 · Next step

Two clause exemptions beside the three at `.claude/hooks/guard-stale-ledger.sh:130-134`:

```sh
    # DATA CARRIERS: the operand of echo/printf, and a commit message argument, are prose.
    printf '%s' "$clause" | grep -qE '(^|[;&|][[:space:]]*)(echo|printf)[[:space:]]' && continue
    printf '%s' "$clause" | grep -qE 'commit\b[^;&|]*(-m|-F|--message|--file)\b' && continue
```

That text is a prototype, not the remedy. A real one pairs each exemption with the near-miss DENY twin
`guard-stale-ledger.test.sh` requires, so budget about 4 lines of hook and 4 self-test legs.
`git commit -F -` with a heredoc body already passes through the body drop.

The row then closes `fixed #<that PR>`, read back from `gh pr view`. It waits on #3954 merging, because
the cap is one open PR per bird.

## 5 · Open questions

- Should the `echo` exemption cover `cat` with no redirect? I did not measure it, and a bare `cat` of
  the ledger is a read the guard should keep denying, so I left it out.
- The same two false positives exist in `guard-stale-brief.sh`, which carries no clause exemptions at
  all. I did not measure that guard here, and widening to it doubles the self-test cost.

## 6 · Blockers

The one-open-PR cap. Nothing else: the remedy needs no corpus, no box and no owner decision.

## 7 · The doc-search query

`node tools/doc-search.mjs "a hook denies a commit whose message quotes the guarded path"` reaches
`docs/CLAUDE-MD-RATIONALE.md:1082`, `.claude/hooks/guard-shared-tree.sh:49` and `guard-trailer.sh:27`,
best score 0.885. My first query keyed on the remedy I expected and scored 0.486. Key on the symptom.

---

## Unit 64 — LANDED AS #3958 (DRAFT), 2026-10-26 07:25Z

1. **Unit.** Two data-carrier exemptions for the stale-ledger guard. The row that asked for a wider one closes inside the PR.
2. **Branch and worktree.** `claude/datacarrier-hrn` at `75c7d10dd` in `~/wt-datacarrier-hrn`, base `4f9d3dacb`. Three commits: the hook plus nine legs, the leg retype, and the ledger row.
3. **Exact stopping point.** `npm run check` reads `EXIT=0`, "✓ check — all 41 steps passed", log `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/check66b.log`. PR #3958 is a DRAFT. The row reads `fixed #3958` in `briefs/RESIDUE.md`, and `residue-ids` reports no mutated cell.
4. **Next step.** Wait for Kestrel to undraft #3958 (ask at board #1427). On merge, run `node tools/wt-done.mjs ~/wt-datacarrier-hrn`. Then release the claim in thread 7.
5. **Open questions.** None for this unit. The third operand test is conservative. It keeps a quoted bare path denied, and a later session may narrow it once a real command meets it.
6. **Blockers.** The one-open-PR cap. #3958 holds my slot until it merges.
7. **The doc-search query.** `a hook denies a commit whose message quotes the guarded path` → best 0.885, surfacing `.claude/hooks/guard-shared-tree.sh:49-66`, which is the comment that decided the remedy shape.

**The two costs this unit paid.** `verify:residue-citations` red step 6 of 41 on a placeholder key inside a self-test leg, because that checker resolves every key-shaped token in the tree. And `cd X && <launch> & sleep 2; git push` pushed from the shared root on `main`, where the non-fast-forward rejection was the only tell.
