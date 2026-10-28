# Osprey — hazfix (the probe's exec bar, corrected both ways)

1. **Unit** — fix `closureHazards` so a regex method is not a process spawn, and so a spawn
   reached through `createRequire` still counts. Discharges the two scan-error rows logged in
   #3936. Claimed at board #1339.
2. **Branch + worktree** — `claude/hazfix-osp` @ `8aca76d4d`, cut from `1a50c57c4`, in the
   worktree `wt-hazfix-osp` beside the primary checkout.
3. **Exact stopping point** — committed, with the changeset
   `changes/2026-10-26-hazard-bar-exec-method.md`. `npm run lint` 0 errors (91 pre-existing
   warnings), `npm run typecheck` clean, the tool's selftest 21 of 21. `npm run check` runs
   detached into `check-hazfix.log` in this session's scratchpad. ste-lint reads the PR body clean at
   `body-hazfix.md` beside it. Pushed.
4. **Next step** — read the `EXIT=` sentinel, push with `--force-with-lease`, open the PR as a
   DRAFT with that body. Kestrel undrafts. **Done: #3937, DRAFT, gate green on all 40 steps.**
5. **Open questions** — the closure cells for
   `2026-10-26-the-hazard-bar-reads-a-regex-method-as-a-process-spawn` and
   `2026-10-26-a-dynamic-require-hides-an-exec-capability-from-an-import-scan` still owe their closure to
   Kestrel on a RESIDUE-only PR. Three owner decisions still wait: the sandbox question (#1336),
   the nsrr record population (#1254), and #1310.
6. **Blockers** — none. If `tests/dex-tests.js` conflicts on a rebase, this PR does not touch it,
   so a conflict there means someone else's work and `rebase-safe` will stop on it.
7. **Doc-search query** — `node tools/doc-search.mjs "a probe refuses a tool whose import closure can write or exec"`

## The shape of the fix, so a reviewer does not re-derive it

A bare exec-family call is a spawn. A dotted one counts only where the file names the child
process module anywhere, comments included, which keeps an unknown spelling of
`createRequire(import.meta.url)('node:child_process')` inside the bar. The net family keeps its
one-part regex on purpose: its dotted matches are a separate unlogged population, and widening
this change to cover them would move the probe-safe count with no row to read it against.

**Measured at `1a50c57c4`: probe-safe argv tools 31 → 47 of 268, 16 in and none out.** Five
planted selftest cases hold the bar; two of them fail against the old rule.
