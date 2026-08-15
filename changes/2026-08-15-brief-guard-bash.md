---
bump: patch
type: fixed
brief: BRIEF-COLLISION-RESIDUAL-GAP-2026-08-09-BRIEF.md
---

`guard-stale-brief.sh` now runs on `Bash` as well as `Edit|Write`, because `Edit|Write` is a TOOL
predicate and not a file write.

Every computed edit arrives through `Bash` — `python3 - <<'PY'`, `cat > briefs/X.md`, `sed -i` — and
all of them bypassed the guard completely. The brief that recorded this counted **four** such edits to
`DOCS-INDEX.md` and a brief in the session that wrote it, because placing a table row in the right
place is easier to compute than to hand-write. The sibling `guard-shared-tree.sh` has always matched
`Bash` for exactly this reason.

The entry is **unconditional** — no `if:` — because a narrowing clause re-opens the gap for every
command outside it. That is now asserted, not just intended.

**A command is only inspected when it is WRITE-SHAPED, and that restriction is the design.** Naming a
brief cannot be the trigger: this hook's own remedy tells you to run `git log -p … -- <brief>`, and a
guard that denied its own advice would be worse than the gap it closes. Three signals qualify — a
redirect / `tee` / `cp` / `mv` / `truncate` aimed at a guarded path, an in-place `sed`, or an
interpreter (`python`/`node`/`perl`/…) together with a write verb (`open(…,'w'`, `.write(`,
`writeFileSync`). The third exists because in the heredoc route the path sits behind a **variable**
(`p='briefs/X.md'`), so no adjacency test can see it — which is the exact form the brief measured.

⚠️ It is a heuristic over shell text, tuned to over- rather than under-fire. A read piped into a file
(`grep x briefs/A.md > /tmp/o`) is write-shaped by this rule. The cost is bounded: the staleness query
still gates every path, so a false positive needs the brief to have *actually moved* upstream, and the
denial names the commits and the escape hatch. Under-firing has no such bound.

Nine new self-test cases, every DENY paired with an ALLOW differing in one property. The DENYs are the
four bypass routes; the ALLOWs are the hook's own remedy, a `grep`, a write to a brief that did not
move, a write outside the guarded set, and `git add`.

**The wiring itself is now gated, because that was the same defect one level up.** A correct guard
that never runs is inert, and nothing in this tree read `.claude/settings.json` at all — so an
unwiring, or an `if:` quietly added back, would have left every behavioural case green. The self-test
now asserts the hook is wired for `Edit|Write`, wired for `Bash`, and that the `Bash` entry carries no
`if:`. Two mutants confirm it reds: removing the entry, and narrowing it to `Bash(sed *)`.

The hook header gains a `⚠ SCOPE` block. It covers the SEQUENTIAL collision — the other work has
merged and you have fetched. It structurally cannot cover the CONCURRENT one, because the information
does not exist on any ref for it to read; that half is `.github/workflows/stale-file.yml`. The brief's
§5 is specifically about not asserting that limitation away in prose, so it is now stated where the
guard is, not only where the brief is.

**Not addressed, and explicitly an owner action:** making `stale-file` a required check on
`protect-main`. It is advisory today and auto-merge is used on essentially every PR here, so it
informs rather than prevents. That is the brief's one remaining box.
