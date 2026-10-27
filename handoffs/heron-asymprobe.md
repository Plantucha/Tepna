
## Unit 66 — the heredoc asymmetry, sized and answered (2026-10-26)

1. **Unit.** Row `2026-10-26-the-heredoc-asymmetry-is-one-interpreter-clause` asks whether the ledger
   guard gains the brief guard's interpreter owner check. Board claim #1435, finding #1437.
2. **Branch + worktree.** None. The whole unit is measurement, since #3959 holds my one PR slot.
   The probes live in the scratchpad as `probe-asym.sh`, `probe-evade.sh`, `ref-ledger.sh`,
   `ref-brief.sh` and `var-ledger-ownercheck.sh`.
3. **Exact stopping point.** Three variants measured, all arms printed. Variant B, the owner check,
   adds zero coverage and two false positives. The shipped pair reads ALLOW 0 under BOTH guards for
   four write forms: `pathlib.Path(L).write_text`, `shutil.copy`, `os.replace` and
   `appendFileSync`. `writeFileSync` on the same path in the same run reads DENY 2, which is the
   control.
4. **Next step.** Once #3959 merges, open a RESIDUE-only PR carrying three cells. Answer the open row
   with the variant-B measurement. Log the four-verb double fail-open, which lets a stale ledger be
   rewritten. Log the brief guard's over-fire on a path that appears only as written data.
5. **Open questions.** One decision I cannot take alone, asked at board #1437: widen
   `looks_like_write()`'s verb list, or invert it to a read allowlist and accept more denials. The
   guard's own comment declares a fail-closed doctrine, which favours inverting.
6. **Blockers.** The WIP cap. Nothing else.
7. **Doc-search query.** `the stale-brief guard denies a heredoc that only mentions a brief path`
   scores 0.978 and surfaces board #1406, `guard-examines-the-hooks-cwd-not-the-commands`,
   `guard-stale-brief.sh:215-231` and its self-test.

**The lesson.** "The sibling covers it" names a population, so it wants the negative control that two
guards in one file want. Print both hooks' exit codes side by side.

**Two instrument errors worth carrying.** `guard-stale-brief.sh` is mode 0644, so a direct call reads
126 on every arm and the uniform column looks like a guard that denies everything. And both working
copies sat 119 commits behind, the ledger one without the 68 lines I landed hours earlier.
