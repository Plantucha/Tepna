# Heron — unit 62: the two stale guards disagree on ONE heredoc clause

**Status:** SIZED 2026-10-26, no PR, remedy is a DECISION and my recommendation is no code change.
**Board:** claim #1414, finding #1415.

## 1 · Unit

Row `2026-10-26-the-brief-guard-reads-a-heredoc-body-its-sibling-drops`, which I logged at 05:32Z the
same day. I claimed it to size the remedy. The measurement refutes the row's mechanism and its remedy.

## 2 · Branch and worktree

None. This unit wrote no code. My one open PR is #3953, `claude/ruffskip-hrn` @ `681a3c7a7` in
`~/wt-ruffskip-hrn`, still DRAFT and waiting on Kestrel.

## 3 · Exact stopping point

The control is `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/ctl64.sh`.
It takes the scratchpad directory as `$1`, extracts both guards from `origin/main`, and runs four
command texts through each. It assembles every guarded path from two halves, so its own text names
none and the live hooks stay quiet. Result at `origin/main`:

| case | the command | ledger guard | brief guard |
|---|---|---|---|
| 1 | interpreter heredoc, body names the ledger, target in the scratchpad | ALLOW 0 | DENY 2 |
| 2 | plain `cat >` heredoc, same literal in the body | ALLOW 0 | ALLOW 0 |
| 3 | interpreter heredoc naming a brief | ALLOW 0 | DENY 2 |
| 4 | a real `sed -i` on the ledger, no heredoc | DENY 2 | DENY 2 |

Case 2 refutes the row. Case 1 is the whole asymmetry. Case 4 is the non-regression arm.

**Three facts the row does not hold.**

1. The brief guard has carried the heredoc strip since 2026-09-23. PR #2915 added it and #3581 made
   the decision per heredoc. The strip lives at `guard-stale-brief.sh:260-319` as `cmd_nohere`.
2. The asymmetry is one clause wide. The brief guard keeps an INTERPRETER heredoc's body raw by a
   documented ruling at `:240`, because that body is a program. The ledger guard drops every body with
   no owner check (`guard-stale-ledger.sh:98-118`).
3. So the LOOSER guard is the ledger one, and the row's remedy points the wrong way. A `python3 - <<PY`
   body that rewrites a stale ledger exits 0 under the ledger guard, which is case 1. Lifting that drop
   into the brief guard opens the hole for every interpreter heredoc.

The hole is latent, not live: the brief guard covers that shape, because the ledger moves on
`origin/main` every review cycle. A tree current for the named doc exits before matching
(`guard-stale-brief.sh:407`), so a current checkout pays nothing for either rule.

## 4 · Next step

Append the correcting row below and withdraw the claimed one. It rides a RESIDUE-only PR, after #3953
merges, because it touches a row this PR does not fix.

```
| 2026-10-26-the-heredoc-asymmetry-is-one-interpreter-clause | 2026-10-26 | `.claude/hooks/guard-stale-brief.sh` | **The row 2026-10-26-the-brief-guard-reads-a-heredoc-body-its-sibling-drops is wrong on the mechanism and harmful in the remedy, and this row withdraws it.** That row said the brief guard has no heredoc strip and should take the ledger guard's. The brief guard has carried one since 2026-09-23 under #2915, refined per heredoc by #3581. The real asymmetry is one clause: the brief guard keeps an INTERPRETER heredoc's body raw by the ruling at `guard-stale-brief.sh:240`, and the ledger guard drops every body with no owner check. So the looser guard is the ledger one, and lifting its drop would let a `python3 - <<PY` body rewrite a stale ledger. The decision owed is whether the ledger guard gains the owner check or both rules stay as they are. | Measured 2026-10-26 06:30Z over both guards at `origin/main`, four command texts each. An interpreter heredoc naming the ledger is ALLOW 0 under the ledger guard and DENY 2 under the brief guard. A plain `cat >` heredoc carrying the same literal is ALLOW 0 under both, which refutes the absent-strip reading. A bare `sed -i` on the ledger is DENY 2 under both, so neither rule regressed. Board finding #1415 | OPEN |
```

Then move the claimed row's state cell from `OPEN` to
`withdrawn 2026-10-26-the-heredoc-asymmetry-is-one-interpreter-clause`.

## 5 · Open questions

- The decision in fact 3 is the owner's or Kestrel's: tighten the ledger guard, or leave both rules and
  let the hatch answer a false DENY. I recommend the second, because the tightening denies ordinary
  scratch work and the composition already covers the hole.
- My recommendation claims no cost for a current checkout. That rests on reading `:407`, not on a run
  in a tree at `origin/main`. It costs one throwaway worktree to measure if anyone wants it measured.

## 6 · Blockers

The one-open-PR cap. #3953 is DRAFT and holds my slot, so the correcting row cannot land yet.

## 7 · The doc-search query

`node tools/doc-search.mjs --read "a commit hook denies a command because a heredoc body mentions the guarded file"`
reaches `guard-shared-tree.sh:316`, `guard-stale-brief.test.sh:367`, `guard-stale-brief.sh:227` and the
`CHANGELOG.md` entry that records the data-versus-code ruling. Best score 0.896.
