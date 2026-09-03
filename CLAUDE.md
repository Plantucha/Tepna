# Dex Suite — Project Conventions (read first)

> **New to this project?** Read **`ORIENTATION.md`** first — the 60-second map (the Dex roster, the shared
> spine, the two gates, and where each fact actually lives). **Auditing the code?** Use **`AUDIT-PROMPT.md`**
> (the deep-audit charter — this suite's specific bug-classes + what NOT to flag). This file (`CLAUDE.md`)
> stays authoritative and wins on every conflict.

A fleet of single-signal physiological analyzers — **OxyDex** (SpO₂/oximetry), **HRVDex** (HRV
summaries), **PulseDex** (raw RR → HRV), **GlucoDex** (CGM), **ECGDex** (raw ECG), **CPAPDex** (CPAP
EDF), **MotionDex** (inertial motion / IMU), planned
**EEGDex** (Muse EEG) — plus a shared event bus (**"Ganglior"** — name is FROZEN, do not rename;
the Integrator still reads a `fascia` alias on input for back-compat) and a fusion layer
(**"Integrator"**, see `briefs/INTEGRATOR-BUILD-BRIEF.md`). Each app is built from external
`*-dsp.js` / `*-render.js` / `*-app.js` files referenced by a `Foo.src.html`, then bundled to a
standalone `Foo.html` via the inliner. **Edit the `.js` + `.src.html`, never the bundled `.html`;
re-bundle after changes.** 100% local — no network, no CDNs. Fonts are **system stacks only**
(no `@font-face`, no CDN — resolved June 2026; see `audits/AUDIT.md`).

## 👥 You are probably NOT alone in this checkout (read before your first `git` command)

**Several agent sessions routinely work this repo at the same time.** The working tree is *not* yours.
Files you did not create will be sitting in it, half-finished, uncommitted, and sometimes the **only
copy in existence**. Every rule below was written after it went wrong.

### 0 · The fleet roster — names, lanes, and the `Fleet-Session:` trailer (renamed 2026-08-31)

**Sessions carry arbitrary, stable identities; role and machine are metadata that change HERE, never
in the name.** The old names collided three ways — "Vigil box" ↔ the `vigil` host ↔ the `vigil` unix
user; "windows" outlived its machine; "Mutator" read as the mutation lane (which is Osprey's);
"Papers" ↔ `papers/`. Descriptive names rot as roles drift; identity must not.

| session | was (pre-2026-08-31) | machine | lane (mutable — update this row, not the name) |
|---|---|---|---|
| **Kestrel** | Mutator | rig-x870 | coordinator / owner's deputy |
| **Heron** | Vigil box | vigil | capture-host + box ops. Deploys to vigil are **owner-authorized only**; a peer relay never changes that boundary |
| **Osprey** | Papers | rig-x870 | mutation program + analysis |
| **Magpie** | Brief runner | rig-x870 | JS surface + sweeps |
| **Finch** | windows | roaming (bridge) | special-collab / hardware RE, engaged on-demand |

- **`Fleet-Session: <Name>` goes in every commit message and PR body** — live 2026-08-31,
  forward-only (never backfill a merged PR; a CI lap for a label fails the cost test). Git history
  before that date reads through the table above.
- ⚠️ **The trailer is a CONVENTION, not a MECHANISM** (Magpie, 2026-08-31). It is self-declared and
  unverified: it makes cooperation *legible* — honest sessions identifying themselves — and that is
  all it does. It does NOT establish attribution: nothing checks the claim against the writer, so
  never reason "the trailer says X, therefore X did it." Under the shared `Plantucha` identity the
  git record cannot discriminate sessions (measured 2026-08-31: an undraft of #1991 was unattributable
  from every artifact — and turned out to be the owner). Real attribution requires distinct
  per-session credentials; that is an owner decision, pending.
- **TRIAGE STAMPS THE BRIEF.** Whoever triages a brief writes the verified state into its status
  header IN THE SAME SESSION (the stale-brief hook guards the edit; `PROPOSED (core BUILT, remainder
  X-blocked — verified YYYY-MM-DD: …)` is the form). Measured 2026-08-31: **seven** "already built"
  discoveries in one day, each a triage cycle spent re-deriving what a previous triage had already
  established and not written down. A triage that leaves the header untouched has thrown away its own
  product.

### 1 · Work in your own worktree. This is the fix.

```sh
git worktree add ../wt-<task> -b claude/<task> origin/main
```

A private checkout off `origin/main`: nothing of anyone else's is in it, so you cannot sweep their work,
cannot destroy it, and cannot **gate against their half-finished code**. It costs a few hundred ms and
shares the object store. *(That last failure is the sneaky one — a session once spent an hour debugging
a "broken" build that was actually another session's in-flight `clock.js`.)*

**Always worktree when you will touch a bundle, a ledger, or a DSP.** For a one-file doc edit in a clean
tree, don't bother.

### 2 · Never blanket-stage, never destroy a tree you didn't dirty

- **Stage by EXPLICIT PATH.** No `git add -A`, no `git add .`, no `git commit -a`. A blanket add sweeps a
  concurrent session's in-flight files into **your** commit, under **your** message. This already
  happened: `cabd7f7` ("fix(ppgdex): …") also carries an unrelated CPAP brief, its `DOCS-INDEX` row, and
  a ledger regen — two work-units fused into one, permanently.
- **`git status` before every commit.** Files you don't recognize? **Leave them.** They're someone's work-unit.
- **Never** `git reset --hard` / `git checkout .` / `git restore .` / `git stash` / `git clean -f` on a
  tree you did not dirty. That is someone's only copy.
- **Never move a branch ref by hand — `git update-ref refs/heads/<b>`, `git branch -f`, `git push . <src>:<b>`.**
  A bare ref move looks like the *safe* way to "sync local main" precisely because it touches no files —
  and that is the trap. If that branch is CHECKED OUT anywhere, the ref advances and the tree does not, so
  every file a merged PR **added** starts reading as `deleted` and every file it changed reads as reverted.
  On 2026-08-03 this reached **47 phantom deletions + 167 phantom modifications** in the shared root, all
  staged by a later blanket `git add -A`; committing it would have removed ~25 pending changesets, live
  briefs and 6 tools from `main`, and tripped `release-ledger` check 7. The count **grows with every merge
  instead of converging** — that growth is the diagnostic tell.
  **You almost never need a local branch ref:** `git worktree add ../wt-<task> -b claude/<task> origin/main`
  reads the remote-tracking ref directly. If one must advance, do it *in the checkout that holds it*
  (`git -C <checkout> merge --ff-only origin/<b>`) so tree + index + ref move together.
  ⚠️ **`git rev-list --count main..origin/main` returning 0 does NOT mean the checkout is synced** — only
  that the ref is. It reads green while the tree is hundreds of files stale. Check
  `git -C <checkout> status --short` as well; that one command, run once, would have caught this on day one.
- Found **finished, uncommitted work** that isn't yours? **Snapshot it, don't step on it** — a temp-index
  commit preserves everything without touching the tree:
  ```sh
  cp .git/index /tmp/r.idx
  TREE=$(GIT_INDEX_FILE=/tmp/r.idx sh -c 'git add -A; git write-tree')
  git branch rescue/$(date +%F)-wip $(git commit-tree $TREE -p origin/main -m 'rescue: WIP snapshot')
  ```
  Then tell the user. Do **not** merge it — you don't know whose it is or whether it's finished.

**This is hook-enforced.** `.claude/hooks/guard-shared-tree.sh` (wired via `.claude/settings.json`) denies
all of the above — plus hand ref-moves — with an explanation. Escape hatch when the tree is genuinely yours alone:
`CLAUDE_ALLOW_BLANKET_GIT=1`.

### 2b · THE REF IS NOT THE TREE — never move a branch ref that is checked out

**`git update-ref refs/heads/main refs/remotes/origin/main` is forbidden here.** It looks like the
careful way to sync local `main` because it avoids `checkout`/`pull`. It is the opposite: `update-ref`
is *plumbing* — it moves the ref, touches neither the working tree nor the index, and is the ONLY form
that skips git's checked-out-branch check. `git fetch origin main:main`, `git branch -f`, and
`git push .` all refuse by name when the branch is checked out; `update-ref` succeeds silently.

If the branch IS checked out, that tree then freezes while HEAD advances, so every file a later merge
**adds** reads as **deleted** — and a blanket add stages them for removal. Measured 2026-08-03: 47 live
files, 25 of them pending changesets, growing with every merge rather than converging.

* **To sync:** `git fetch origin main:main` — and let it refuse. Better, work in your own worktree off
  `origin/main` (§1) so local `main` never needs syncing at all.
* **To CHECK a tree is in sync, measure the TREE** — `git status --porcelain`, not
  `git rev-list --count HEAD..origin/main`. The ref comparison returned **0** while the tree was 214
  files stale; it answers a different question than the one you are asking.

Hook-enforced (`guard-shared-tree.sh`), and **a commit-time detector is possible** — an earlier draft
of this section claimed it was not, arguing the release commit is signal-identical to the corruption.
That claim was wrong, and it was wrong in the way this repo keeps being wrong: it reasoned from the
features that *do* collide (many files, recent, changeset-heavy, one block) and never ran the query.
Two features separate the populations perfectly, over all 33 commits in history that delete a changeset:

| | 29 release commits | the 2026-08-03 corruption |
|---|---|---|
| deletions **outside** `changes/` | **0**, every one | 22 — `briefs/ tools/ docs-archive/ uploads/` |
| co-modifies `suite.manifest.json` + `CHANGELOG.md` + `RELEASE-MANIFEST.json` | **3/3**, every one | **0/3** (version not bumped, no changelog entry) |

So: **a commit deleting a changeset without a release-ledger update, or deleting anything outside
`changes/` alongside one, is not a release.** Zero false positives on every release v1.1.0 → v2.4.0
including `aee1e10`; the only other commits it flags are the three `rescue:` snapshots (which *are*
this failure) and one `Revert` (exemptible by provenance). A release deletes only changesets and
always bumps the version; the accident did neither.

Prevention still comes first — the hook stops the cause, and that is cheaper than catching the damage
after it is staged. But do not repeat the impossibility claim. If you think two populations are
inseparable, **run the query before writing that down**; five reviewers falsified this paragraph in
minutes with one `git log`.

**That detector now EXISTS — `tools/commit-shape.mjs` (#1330).** It runs in `npm run check` as
`verify:commit-shape` and as a step in the CI `static` job. Re-measured over current history at build
time: **32 commits delete a changeset → 30 releases pass with 0 false positives**, 2 exempt.
Exemption is by **declared provenance** (`Revert `, `rescue:`), never by shape — a rescue snapshot is
shape-identical to the corruption *on purpose*, so widening the shape rule would re-admit the
accident. It **refuses (exit 2) on a shallow clone** rather than reporting green: `actions/checkout@v4`
defaults to depth 1, where the scan sees one commit, finds nothing and exits 0 — which is why CI sets
`fetch-depth: 0` there and why that line is load-bearing.

### 2b-bis · ⚠️ "HOOK-ENFORCED" MEANS *CLAUDE CODE, IN A CHECKOUT THAT PULLED IT* — nothing wider

This file says "hook-enforced" in several places. Measured 2026-08-15, the phrase is narrower than it
reads, in two independent ways:

1. **One client.** The guards are `PreToolUse` hooks resolved through `$CLAUDE_PROJECT_DIR` in
   `.claude/settings.json`. `.git/hooks/` holds samples only and `core.hooksPath` is unset — so a
   second coding agent, a human at a terminal, or the GitHub web UI inherits **none** of them.
2. **One checkout.** Hooks load from *your own* working copy. A guard merged to `main` protects nobody
   in a tree that has not pulled it — measured with the shared root 92 commits behind, carrying
   neither the wiring nor the script.

**A git `pre-commit` hook is not the fix and was already declined** —
`CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS-2026-08-04-BRIEF.md` §5: *"a hook must be installed … so the
common state is a hook that exists in-repo and runs for nobody."* That is (2) one layer down.

**Prevention cannot be made agent-neutral.** It is agent-coupled (inside the operator's tool loop) or
install-coupled (per clone), and a sandbox is not a third option — it protects the machine from the
agent, not the tree from a bad `git add`. **Detection can be**, because it reads a property of the
resulting commit and CI applies to whoever opened the PR. That asymmetry is why the two guards below
are CI checks rather than more hooks:

| invariant | agent-neutral enforcement |
|---|---|
| blanket-add / ref-move corruption | `tools/commit-shape.mjs` — `npm run check` + CI `static` job (#1330) |
| stale-brief overwrite | `.github/workflows/stale-file.yml` — **a REQUIRED context** since #1337 (#1086) |
| §2c rebase silently reverting source | **none — not mechanically decidable.** Prevention only |

⚠️ **`stale-file` has no escape hatch, deliberately.** The hook needs `CLAUDE_ALLOW_STALE_BRIEF=1`
because a local hook cannot rebase for you; CI has no such constraint. **Rebasing IS the hatch** — it
advances the merge-base, empties the overlap, and passes the check — and it is the hatch that forces
you to read the upstream commits first, which is the entire reason the check exists.

Full reasoning and what is deliberately *not* covered:
`briefs/AGENT-NEUTRAL-GUARDS-2026-08-15-BRIEF.md`.

### 2c · REBASING: `git checkout <ref> -- <conflicted>` reverts source SILENTLY — use `rebase-safe`

**You will rebase.** `main` moves during every review cycle, and the two orchestrator bundles
(`OverDex.html`, `Data Unifier.html`) are re-bundled by ANY change to ANY inlined module — so two PRs
that share **no source at all** still collide in them. Rebasing is not the exception here, it is the
normal path, and the shortcut everyone reaches for is the one that loses work:

```sh
git checkout origin/main -- $(git diff --name-only --diff-filter=U)   # ← NEVER
```

It is **correct for a generated artifact** and **destructive for a source file**, and the two are
mixed in the same conflict list. A generated file's content is a *function of source*, so neither side
is authoritative — you take either and **rebuild**. A source file has no such function.

**It fails silently, which is what makes it dangerous.** The rebase completes, `git status` is clean,
the branch pushes, CI may even pass — and your commit message still describes changes that are no
longer in the commit. Measured 2026-08-05: one such line reverted a **test group, a DSP fix and a
provenance entry** out of a single commit. Nothing surfaced it; `git show HEAD:<file> | grep` did.

**Use the tool. It asks the BUILDERS which paths they own, so it cannot guess wrong:**

```sh
node tools/rebase-safe.mjs            # fetch → rebase → auto-resolve generated → rebuild → verify
node tools/rebase-safe.mjs --onto <ref>
```

- **Generated** (auto-resolved, then rebuilt): the 9 provenance bundles + the 2 orchestrators
  (`manifest-gate.js MANIFEST_BUNDLES` + `build.mjs ORCHESTRATORS`), the 10 analysis tools
  (`build-analysis.mjs TOOLS`), `docs/**`, `provenance/**`.
- **Source** (it STOPS and aborts the rebase): everything else — every `*.js`, every `*.src.html`,
  every authored guide, `uploads/` goldens, `tests/dex-tests.js`.
- The set is **read from the builders**, never globbed. A `*.html` glob would be the second version of
  this bug: `OxyDex Reference.html` and `Science.html` are authored. If a builder's list cannot be
  read the tool treats everything as source and **fails closed** — a tool that fails open here
  reverts work.

⚠️ **`tests/dex-tests.js` conflicts on nearly every parallel PR.** Restore `main`'s copy and
**re-run your insertion**; never keep one side wholesale. That is the file that got dropped.

⚠️ **After ANY rebase, verify your own change survived before pushing** — the tree being clean proves
nothing: `git show HEAD:<file> | grep -c <an identifier your change adds>`.

**Hook-enforced.** `guard-shared-tree.sh` denies `git checkout <ref> -- <source path>` and points here;
generated paths pass through. Escape hatch for a deliberate single-file restore: run it outside a
rebase on one explicit path, and verify afterwards.

### 2d · TWO SESSIONS WILL DERIVE THE SAME BRANCH NAME — and a plain `--force` destroys the other's PR

Measured 2026-08-16: two sessions independently produced **`claude/land-pr-required-reported`** for the
same defect. One pushed and opened a PR; the other had committed the same name locally and had not
pushed yet. This is **likely, not coincidental** — branches are named after the fix, so one defect
yields one slug, and two sessions working one defect is the normal case here, not the exception.

**No hook can catch it, and that is what makes it a different class from everything else in §👥.** The
collision is on the **remote**, between two private trees. `guard-shared-tree.sh` inspects your local
tree and commands; it structurally cannot see a branch name on `origin` that another checkout is about
to use. Every other hazard in this section is visible somewhere locally. This one is not.

**The safe failure is already built in, and it is the tell:**

- A **plain `git push`** to a diverged branch is **REJECTED** as non-fast-forward. That rejection on a
  branch you believe is yours alone is the warning — **never force past it.** Find out who owns the
  name first.
- **`--force-with-lease`** refuses when the remote carries commits you have not seen. This is the
  load-bearing mitigation and it is what turned the 2026-08-16 case into a near-miss rather than a lost
  PR. **Never use a bare `--force` against `origin`.**
- A **per-session suffix** — `claude/<task>-<3 chars>` — prevents the collision itself. Defence in
  depth, and the cheaper of the two, but note the asymmetry: **the suffix prevents the collision, the
  lease prevents the LOSS**, and only one of those is recoverable when it goes wrong.

⚠️ Verify before any force-push that the remote head is your own commit —
`git log --oneline -1 origin/<branch>` and `git log --format='%an' origin/<branch> -3 | sort -u`. Two
sessions on one repo makes "it is my branch, so forcing is safe" an assumption, not a fact.

### 3 · Bundles and ledgers must be SERIALIZED — a worktree does not save you here

Isolation solves the *tree*. The old single-file ledger collision is **mostly SOLVED** (ARCHITECTURE-DEBT-
REDUCTION §P3, 2026-07-15): `BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json` were split into per-app
**`provenance/<App>.json`** fragments (each owns that app's GATE-A `manifestHash` + GATE-B fixtures), so an
OxyDex re-bundle and a GlucoDex re-bundle now touch **different files** — no collision. `provenance-ledger.js`
reassembles the combined `{ bundles }` / `{ fixtures }` view every reader/gate still consumes; the monoliths
are retired. What remains genuinely shared: a **spine module is inlined into many bundles**, so one spine
change moves each of those apps' `manifestHash` (and thus each fragment) at once.

⚠️ **"EVERY bundle" is WRONG for `clock.js`, and this sentence used to say it.** Measured 2026-08-14 —
`grep -c 'data-inline-src="clock.js"' <App>.html`, then confirmed at runtime by loading each page and
reading `typeof DexClock`:

| module | bundles carrying it |
|---|---|
| `kernel-constants.js` · `metric-registry.js` · `dex-export.js` | **8 of 8** |
| **`clock.js`** | **5 of 8** — absent from **PpgDex · GlucoDex · CPAPDex**, where `DexClock` is `undefined` at runtime |

Those three are exactly the nodes §✅ names as keeping *"DELIBERATE node-local variants — do not force
them onto DexClock"*. They ship without the spine **on purpose**; this paragraph contradicted §✅ and §✅
is the correct one.

🔴 **This cost a whole PR (#1232, closed).** It removed `ppgdex-dsp.js`'s Allan core citing this line —
but that was **the only copy PpgDex has**, and the parity assertion holding the two copies byte-equal
read as evidence of redundancy when it was the opposite. The PpgDex render rig went **1458 ms →
16945 ms** and `browser-gates` went red. Two fixes were tried and both were wrong, in the order that
makes them worth recording: an **unguarded** alias (`const f = DexClock.f`) throws at
MODULE-EVALUATION time — which **no Node assertion can see**, because Node co-loads the spine and never
evaluates the file alone, so only `browser-gates` catches it; **guarding** it then converts the crash
into a **silent disablement**, which is worse than the crash.

**Before delegating anything in a `*-dsp.js` to `DexClock`, check that bundle actually carries it.** Do
not infer it from this section.

- **A shared-spine change still serializes** — all 8 fragments for the three universal modules, **5** for
  `clock.js`; a single-app re-bundle no longer does. For spine work, say so before you start.
- Landing second? **Rebase, re-run `node tools/build.mjs --app <App>`** — it auto-writes the manifest hash
  and re-stamps fixtures, so the redo is cheap — then re-run the gates.
- A shared-spine change (`clock.js`, `kernel-constants.js`, `metric-registry.js`, `dex-export.js`) should
  land **before** node-local work that would otherwise have to re-record everything.

Note the release layer *already* solves parallelism — §📦's changesets exist precisely so parallel coders
never hand-pick a version. This section extends that thinking to the tree and the build.

### 4 · NEVER wait on a process by command name — `until ! pgrep -f "<cmd>"` waits on ITSELF

The gates here run for minutes (`pytest --cov` ~9 min, the node suite >10 min), so every session
eventually writes a "tell me when it's done" loop. **Do not write this one:**

```sh
until ! pgrep -f "pytest -q --cov"; do sleep 20; done      # ← NEVER EXITS
```

It hangs for two independent reasons, and **the first is unconditional — it does not need another
session to be running at all:**

1. **SELF-MATCH.** The waiter itself runs as `bash -c '… until ! pgrep -f "pytest -q --cov" …'`, so its
   own `/proc/<pid>/cmdline` **contains the pattern it is searching for**. `pgrep -f` matches it, and it
   waits for itself to exit. Measured 2026-08-04: with **zero** pytest processes anywhere on the box,
   that pattern matched **six** processes — every one of them a waiter, mutually and self-blocked.
2. **CROSS-SESSION MATCH** (§1's world): several sessions run the *same* gate commands concurrently, so
   even a self-match-proof pattern blocks on somebody else's run.

This is not hypothetical bookkeeping: **13 such shells were found deadlocked across 5+ sessions** on
2026-08-04, each spinning a `sleep` loop forever, each meaning a session never got the notification it
was waiting for — two of them had been waiting on a `mutate_diff.py` run and a `verify-fixtures` run that
could never report back. They are invisible because a hung waiter looks exactly like a slow gate.

**⚠️ The `[p]ytest` bracket trick is NOT a fix.** It defeats (1) — the regex no longer matches its own
bracketed literal — and was **tested here and still matched**, because other sessions' waiters carry the
unbracketed string. Necessary, not sufficient. Do not reach for it and assume you are done.

**What to do instead**, in order:

1. **Don't poll.** Run the real command as a background task and let the harness notify you on exit. No
   waiter process exists, so neither failure mode can occur. This is the default; prefer it.
2. **Own the PID** — no pattern matching at all, and it yields the **exit code**, which `pgrep`
   structurally cannot:
   ```sh
   pytest … > /tmp/mine.$$.log 2>&1 & PID=$!
   while kill -0 "$PID" 2>/dev/null; do sleep 20; done
   wait "$PID"; echo "EXIT=$?"
   ```
3. **Wait on a sentinel you control**, in a `$$`-unique file (immune to both failure modes):
   ```sh
   ( pytest … ; echo "EXIT=$?" ) > /tmp/mine.$$.log 2>&1 &     # ← the & is LOAD-BEARING
   until grep -q '^EXIT=' /tmp/mine.$$.log; do sleep 20; done
   ```
   **Do not drop that `&`.** Without it the first line runs synchronously, so the sentinel is already in
   the file before the loop starts and the loop exits on its first check — measured **0 polls**. It still
   prints the right exit code, which is exactly why it passes review: you get blocking execution followed
   by a no-op loop, in the one place you were trying not to block. (This section shipped without the `&`
   in #825 and was caught in review; with it, the same test polls 3 times and reports the same `EXIT=7`.)

### 4b · The general form: TRUNCATING A RESULT AND READING THE REMAINDER AS THE WHOLE

`| tail -N` is how a long gate is made readable, and it is how a long gate is made to lie. This is **not
only** a pipeline-exit-code issue — that is one instance. Two, both on 2026-08-04, in different tools:

- **`pytest … | tail -20`** reports **tail's** exit code. A coverage run that FAILED at 91.19 % printed
  `EXIT=0` and read as green.
- **`gh pr checks <N> | tail -15`** has no exit-code problem at all — it simply **cut two failing checks
  out of the listing**, so a failing PR looked like it was merely hanging.

The second is the reason to state the general rule rather than the pipeline one: **if you truncate, you
must know the discarded part cannot change the verdict.** For a gate summary it always can.

- **Never read a verdict off a tail.** Aggregate instead: `grep -cE '^(FAILED|ERROR)'`,
  `gh pr checks <N> --json bucket --jq 'group_by(.bucket)|map({(.[0].bucket):length})|add'`, a
  `TOTAL`/`Required` line. Tail the log afterwards for *detail*, never for the answer.
- **Capture `$?` of the command itself, before any pipe** — as (2) and (3) above do.
- Related: identify *your own* processes by a token you put in the command line, never by a session id
  that only appears in an output path — that **under**-reports for the mirror-image reason `pgrep -f`
  **over**-reports. Both happened, in the same hour, to the session that wrote §4.

The family (`grep -q` exit codes, `npx` no-op greens, a child's JSON truncated through a pipe) all share
one shape: **the check ran, and reported success about something it never examined.**

### 5 · LANDING: `main` moves faster than CI, so every extra PR is another lost race

**Re-measured 2026-08-16 — state the WINDOW with any of these numbers, because the value depends on it.**
Over **today's 28 merges**: median gap **8.6 min**, min 0.0, max 88.2, **13 of 27** gaps ≥ 10 min. CI is
**≤ 9 min** worst-workflow, median ~2 min, across 8 required checks (`stale-file` became the 8th on
2026-08-16). *(The prior figure here — "median 7.2 min, 8 of 19 ≥ 12 min", 2026-08-09 — carried no window.
Sampling the last **40 merges** instead of today yields median **13.1 min**, because that reaches back
days and swallows an 88-minute lull and a 5-day gap. Same repo, same hour, two answers. A cadence number
without its window and sample size is not a measurement.)*

⚠️ **AND IT IS NOT A RACE YOU CAN WIN BY WAITING — it is a DEADLOCK. This is the paragraph's most
expensive sentence, so it is now first.** `protect-main` sets `required_status_checks.strict = true`, so
the branch must be **up to date at merge time**, and **GitHub's auto-merge does NOT update it for you**.
An armed, fully green, BEHIND PR therefore **never becomes mergeable on its own**, no matter how long it
sits. Someone must update the branch.

That fact was already stated here, and on 2026-08-16 **three sessions still deadlocked on it** — 14 PRs,
every required context passing, zero pending, zero failing, nothing merging. The reason is framing: it
sat inside "a window open well under half the time", which reads as a probabilistic race that patience
eventually wins. It is not probabilistic. Waiting has **zero** probability of success. Measured on four
of my own that afternoon: the one I updated when green **merged**; the three left armed and green sat
BEHIND indefinitely.

**The consequence is that PRs merge STRICTLY SEQUENTIALLY, and it is the real cost of a deep queue.**
Every merge to `main` re-BEHINDs every other open PR. So updating N branches at once is waste — all N
re-run CI, the first to finish merges, and the other N−1 go BEHIND again. The protocol:

> **update ONE green PR → let it merge → update the next.**

At ~9 min a cycle, a queue of 14 takes over two hours to drain no matter how green it is. That is a far
better argument for fewer simultaneous PRs than the race framing, and it explains how a queue grows all
day while every session is being careful.

⚠️ **If you have anything to push anyway, `git merge origin/main` locally and push ONCE** — `gh pr
update-branch` creates a remote merge commit and restarts CI, and a separate push of your own commit is
a *second* head and a second run. Merging locally makes the branch current and carries your change in one
CI cycle.

**The cadence lever is bigger than the polling lever, and it is the one you control.** One capture-host
fix shipped as **five** PRs (#1062 → #1071 → #1081 → #1091 → #1095) because each increment was pushed as
it was discovered; that is five races and roughly 45 min of re-running an 11-min suite on a file that had
not changed. In order of payoff:

1. **One PR per work-unit, not one per increment.** Discovery is sequential; delivery need not be.
   Diagnose fully, *then* ship. Four of those five PRs touched the same function.
2. **Run the full gate ONCE, on the final state.** Use `-k` / `--group=` while iterating. ⚠️ A filter that
   matches nothing reads exactly like a pass — `-k absent` does **not** match `absence`, and a mutant
   survived unnoticed because the killing test was never collected (§4b's family).
3. **Push BEFORE writing the changeset and PR body.** Gate → write → push serialises ~11 min + ~12 min;
   pushing first runs CI underneath the writing.
4. **`gh pr update-branch` when nothing generated is in the diff** — instant, versus minutes for
   `rebase-safe` + rebuild, which restarts the clock. When bundles / `docs/` / `provenance/` **are** in
   the diff, §👥.2c still applies and `rebase-safe` is mandatory, not optional.

**Do not hand-write the polling loop.** It has been written wrong in all four of §👥.4/4b's ways. Use:

🔴 **ARMED IS NOT LANDING — and this is the single most expensive thing on this page to get wrong.**
`protect-main` sets `strict_required_status_checks_policy: true`, so a branch must be **up to date at
merge time** — and **GitHub's auto-merge does NOT update a branch.** It waits for the merge to become
*possible*; under `strict: true` a `BEHIND` branch never becomes possible on its own. So arming
`--auto` and leaving it is a **DEADLOCK, not a wait**.

Measured 2026-08-16: **14 PRs sat for a full day.** Every one `OPEN`, 0 pending, 0 blocking failures,
all armed, nothing failing, nothing conflicting. Four sessions looked straight at them and saw a
healthy queue, because the only symptom was that **nothing moved — and "nothing moved" is not a state
any dashboard reports.**

Clearing the blocker is *also* not enough, one layer up: dropping `strict` did not drain the queue
either, because **auto-merge does not re-evaluate on a ruleset change** — it waits for an event on the
PR. Twelve merged in 60 seconds once something actively merged them.

```
armed     ≠ landing   — something must UPDATE the branch
unblocked ≠ landing   — something must TRIGGER re-evaluation
```

Both are a passive mechanism waiting on an event that never arrives. **Something must act**: either you
(`gh pr update-branch <N>` once the PR is green — not while its checks are still running, which just
restarts them), `land-pr`, or the **`queue-doctor` timer**, which exists precisely because the failure
happens when nobody is running anything and which names the state — `GREEN AND STUCK` — that no GitHub
view reports. ⚠️ A merge queue would fix this properly and **is not available**: it is an
*organisation*-repository feature and Tepna is user-owned (verified 2026-08-16 — this is availability,
not a cost tradeoff, and an earlier note here got that wrong).

🟢 **KODIAK NOW RUNS THIS LOOP (App trial adopted 2026-08-27; measured 2026-08-28; owner-granted
note).** Everything above describes GitHub-**native** auto-merge and stays true of that mechanism —
but since the `kodiakhq` App was installed (`.kodiak.toml`, `require_automerge_label = false`),
every non-draft PR without a `do-not-merge` label sits in Kodiak's own serial queue: it updates the
front PR when it goes BEHIND, waits for CI, merges, repeats — the "update ONE green PR → let it
merge → update the next" protocol, automated. Measured on **#1914**: pushed with auto-merge NOT
armed and zero labels; `kodiakhq[bot]` updated its branch unprompted once the front merged, then
merged it (`merged_by: kodiakhq[bot]`); reconfirmed the same night on #1917 and #1918. Arming
`--auto` is harmless but adds nothing; the two adoption-day stalls (#1888/#1907) that read as
"Kodiak ignores unarmed PRs" were install-window artifacts. A PR sitting BEHIND while the queue's
front is mid-CI is Kodiak **serialising, not stalling** — leave it. To HOLD a PR, mark it Draft or
label `do-not-merge`. `queue-doctor`/`land-pr` below remain the fallback and the diagnostic if the
App is ever removed or its queue wedges.

```sh
node tools/queue-doctor.mjs --dry-run   # what is green-and-stuck right now, and what it would update
node tools/land-pr.mjs <PR#>            # keeps the branch current, merges the moment it can
node tools/land-pr.mjs <PR#> --dry-run  # print each decision, act on nothing
```

Its decision core is a pure function, gate-backed by the `land-pr` group. It distinguishes the four
states that need **opposite** responses — `BEHIND` (update, this is the race, not an error) · `BLOCKED`
with runs in flight (wait) · `UNKNOWN` mergeability (wait; GitHub is still computing it) · a **required
context that was never reported at all** (stop — a skipped matrix job reports an unexpanded literal name,
so waiting cannot fix it). A failing check outranks all of them, or a red PR gets "updated" forever
behind a fresh pending.

⚠️ **A merge queue would paper over all of this, and is the wrong first reach.** It was proposed here and
correctly rejected: the numbers say the self-inflicted serialisation is the bigger term. Fix the cadence
first; the ruleset is the constraint, not the defect.

### 5b · COLLECTING PRs — measured 2026-08-18, the night the runner pool saturated (owner-ratified)

Four sessions held 11 PRs (= **187 required-check jobs before anyone touched anything**); the pool fell to
~1 job/min with 130 queued, and one unchanged doc PR took **4 full CI laps** to land. The rules that came
out of it, each bought by a specific failure:

- **WIP cap: ≤ 4 open PRs repo-wide.** A finished work-unit WAITS for a slot rather than becoming the
  fifth. This is §5's "one PR per work-unit" made checkable across sessions — the 187-job pile-up was
  legitimate work units, just too many at once.
- **`gh pr update-branch` mostly does NOT cancel the superseded run.** Before the 2026-08-18 concurrency
  guards, 8 of 11 workflows had no `cancel-in-progress`; a superseded 6-shard `tests` run executed
  **43 min past its SHA being replaced**. The guards fix PR refs, but the lesson stands: an update is a
  *purchase*, not a swap — check the pool first:
  `gh pr list --state open --json statusCheckRollup --jq '[.[].statusCheckRollup[]?|.status]|group_by(.)|map({(.[0]):length})|add'`
- **Collect when: the pool has drained AND (`pend=0` OR demonstrably wedged) AND every required check has
  a terminal SUCCESS/SKIPPED conclusion.** Clause 3 exists because a *cancelled* required check reads as
  `pend=0` with an empty conclusion — finished-looking, and completely wrong. Count conclusions, never pendings.
- **"Wedged" is judged ONLY against that workflow's own history, never against siblings.** `tests` queued
  3 h and passed — its siblings are single jobs of minutes, a different distribution entirely. A peer's
  `no-network` at 3 h against its own median 5.5 min / max 11 was genuinely stuck. Same wall-clock,
  opposite verdicts. **Never supersede a queued `tests` run under ~3 h.**
- **Remove your worktree when the PR merges — `node tools/wt-done.mjs <path>`** (verifies MERGED via `gh`
  + clean tree, then removes without `--force`). 329 orphaned trees ≈ 55–60 GB accumulated because the
  merge *feels* like the end of the work-unit and is not.

**And it is not available anyway — check this BEFORE re-opening the cost argument.** GitHub merge queue
requires an **organization-owned** repository; `Tepna` is user-owned (`owner.type: User`, confirmed
`isInOrganization: false`), so the feature is ineligible regardless of the economics. Public visibility
is **not** the discriminator — this repo is public and still ineligible. Verified three independent
ways: the API rejects a `merge_queue` rule outright even with no parameters (2026-08-09), the GraphQL
owner is a User, and GitHub's own documentation scopes the feature to organization repositories.
Recorded here because the paragraph above reads as a *cost* decision, and on 2026-08-16 a session was
about to take fresh cadence numbers to the owner arguing against a constraint that is not economic at
all. If you want merge queue, the question is repository ownership, not throughput.

---

## 📌 Brief lifecycle — date NEW filenames at creation; mark DONE in the HEADER, never rename (non-negotiable)
**All briefs live in `briefs/`** (as of the 2026-07-03 owner-sanctioned bulk relocation — one of two
that day that deliberately broke the old "never move" rule for archival docs; briefs are work-plans,
not runtime inputs — see the **Repo layout** note below for the sibling `audits/` + `docs/` move).
Briefs are cross-referenced by exact filename across CLAUDE.md and the docs, so **an existing brief's
filename is FROZEN** — do NOT rename a brief to mark it done (it breaks every link + git history). The
`briefs/` prefix is now part of that stable path; do not move a brief out of `briefs/` either.
Status lives in a one-line header block on the first content line (just after any SPDX comment):

```
**Status:** PROPOSED | IN-PROGRESS | DONE — YYYY-MM-DD · **Created:** YYYY-MM-DD
```

- **Creating a NEW brief:** create it in `briefs/` with the creation date in the filename — `briefs/<NAME>-YYYY-MM-DD-BRIEF.md`
  (append `-HHMM` only if two briefs are created the same day) — AND stamp the same date as
  `Created:` in the header. The dated filename is set ONCE at birth and then never changes, so it
  stays a stable cross-reference target; the date is a creation marker, not a status marker.
- **Executing a brief:** once it is *fully* executed — every "Done when" / acceptance item met AND
  the relevant gates pass (`Dex-Test-Suite.html` all-green, `verify-provenance.html` clean where it
  applies) — flip the header in place to `Status: DONE — <today>`. Do NOT touch the filename. Never
  stamp DONE on unverified work. Greppable fleet-wide via `grep "Status:.*DONE"`.
- **After executing (or triaging) a brief, residue goes to `briefs/RESIDUE.md` as ONE ROW per verified
  defect — NOT a new `-FOLLOWUPS-` brief** (owner-ratified 2026-09-02; this bullet used to say "spawn a
  follow-up brief"). Row: `| <key> | logged | source brief | defect | evidence | state |` where the key is
  **`YYYY-MM-DD-short-slug`** (`2026-09-02-oxyii-acks-unparsed`), and the source brief's **Status:**
  line gets `**Residue:** <key>` — bidirectional like `Superseded-by`, and gate-backed
  (`docs-ledger` check 8: both directions resolve, exactly 6 cells, state vocabulary). A `<NAME>-FOLLOWUPS-
  YYYY-MM-DD-BRIEF.md` is created **only by the session that picks a row up to execute it** (when the
  remainder is ≥ one work-unit), and creating it closes the row (`→ \`<NAME>-BRIEF.md\``); a one-PR fix
  closes it as `fixed #NNNN`. Rows are appended and closed, never edited or deleted.
  ⚠️ **The key is a date-plus-slug, NOT a counter, and that is load-bearing.** The ledger opened with
  `R<n>` and produced **five collisions in one day** — the last within the hour of the rule being argued
  out, between the two sessions arguing it, each having run the prescribed pre-push check and each having
  got a correct answer from it. `origin/main` cannot contain an id claimed in an OPEN BRANCH, so the
  check the scheme demanded could not return the right answer: **a globally-unique identifier allocated
  from local information has no correct procedure.** Briefs and changesets here are dated-slug and have
  never collided; the ledger was the only artifact inventing an allocation problem.
  ⚠️ **A residue with no parent brief names its real origin — a repo path or a `#PR` — never the nearest
  brief.** Repairing an *instrument* surfaces defects that descend from the fix and from no brief at all
  (2026-09-02: `find_unwired.py` stopped counting a comment as a consumer and two real orphans fell out).
  The source cell therefore accepts a `*-BRIEF.md` (back-reference required), a repo path that must exist
  in the tree, or `#NNNN`. Naming a plausible brief to fill the cell **passes** check 8 — which verifies
  existence and the back-reference, not responsibility — while sending the picker-up to a brief that never
  left the defect.
  *Why:* measured on the 2026-09-02 drain, **27 of 77** open briefs were `-FOLLOWUPS-` files, and none had
  an owner — a file created at execution time is written by the session that is leaving, so it belongs to
  nobody by construction; a row promoted at pickup time belongs to the session that promoted it. The 27
  existing files are not retro-converted. If nothing surfaced, say so in the executed brief's header.
- **Non-executable docs** (deploy manifests, backlog checkpoints) use `Status: REFERENCE (living …)`
  or `Status: CHECKPOINT (living …)` with a `last-verified` date instead of DONE.
- **No `DEFERRED` (or any other) top-level status** (DOCS-LEDGER-GATE-FOLLOWUPS §F1, decided 2026-07-05 =
  option (a)): the status vocabulary is EXACTLY those five values (PROPOSED · IN-PROGRESS · DONE ·
  REFERENCE · CHECKPOINT). Park a brief by keeping it `PROPOSED` with the reason inline — `**Status:**
  PROPOSED (deferred YYYY-MM-DD — …)`; "deferred" as a *sub-item* note inside a DONE brief (`§N DEFERRED`)
  is fine. The gate's `STATUS_RE` deliberately rejects a bare `**Status:** DEFERRED` header (self-test-
  locked), so fabricating a sixth status reds `docs-ledger` (check2a).
- **When one brief replaces another,** don't just DONE the old one — add header links both ways:
  `Superseded-by: <NAME>` on the old, `Supersedes: <NAME>` on the new. (This whole scheme — immutable
  filenames, status-in-header, never move/delete on status change, an index as the view — is the
  industry-standard **ADR / RFC** convention; `Superseded-by:` is the one ADR idea worth borrowing
  over a flat DONE stamp.)
- `DOCS-INDEX.md` carries the at-a-glance status table; keep it in sync when a status flips. It is the
  dashboard — reorganize *that view*, not the files. Now that all briefs already sit in `briefs/`, do
  NOT further sub-folder them into `Done/`/`Executed/` — that breaks every cross-reference + splits git
  history (same failure as renaming); status lives in the header, not the path.
- 🔍 **SEARCH BEFORE YOU SIZE OR BUILD — `node tools/doc-search.mjs "<the thing>"` (PRIMARY DEV
  MACHINE ONLY — see the warning).** A brief pickup starts with a semantic search, not a grep: grep
  finds only your own vocabulary, and twice in one week a session nearly reported build-from-scratch
  for machinery that already existed under other names (a `pooledSeconds` grep returned nothing while
  the pooled pairwise BA + generic three-cornered hat sat in `sigma-no-reference-analysis.js` /
  `analysis-stats.js`, 2026-08-26 — found by doc-search on the first query). Read the top three hits
  before sizing a unit or writing a line; the memory `semantic-search-before-building` records the
  failure class. Owner-mandated as a standing pickup step 2026-08-26.
  ⚠️ **THIS TOOL EXISTS ONLY ON THE PRIMARY DEVELOPMENT COMPUTER.** It runs against a loopback
  bge-m3 embedding model plus a locally prebuilt ~14k-chunk index — 100 % local, never networked,
  and neither ships with the repo. **Other GitHub users, fresh clones, and CI do not have it and
  must not be pointed at it**: on any other machine fall back to `git grep`, no gate or CI job may
  read doc-search output, and the tool being absent is never an error. (This is the same locality
  class as the gitignored corpus — the repo documents it; it does not distribute it.)
- 🔴 **BEFORE YOU EDIT A BRIEF, CHECK IT HAS NOT ALREADY BEEN ANSWERED — mandatory, hook-enforced.**
  Someone else is probably working the same brief queue (§👥). A brief is the ONE artifact several
  sessions reach for at once, and overwriting one produces **no conflict**: answers land in different
  sections, git sees no overlapping hunk, the squash silently keeps the newer text, and no gate in this
  repo can see it. Measured 2026-08-08 on `GENERATOR-FOLLOWUPS-III`, **twice in one day** — #1055 dropped
  #1034's §2 (a better-evidenced answer, proven by execution) and left the brief contradicting its own §4
  for two commits; then #1059 and #1061 independently wrote the *same* reconciliation, because neither
  session could see the other coming either.

  ```sh
  git fetch origin main
  git log --oneline $(git merge-base HEAD origin/main)..origin/main -- briefs/<NAME>-BRIEF.md
  ```

  Non-empty ⇒ **read those commits before writing** (`git log -p …`) — they may already answer what you
  are about to say — then rebase (`node tools/rebase-safe.mjs`) so your edit lands **on top of** them
  rather than instead of them. **Hook-enforced** by `.claude/hooks/guard-stale-brief.sh` (PreToolUse on
  `Edit|Write`, self-tested by `npm run test:hooks`, wired into `npm run check`), which runs exactly that
  query for the file you are touching and denies with the commit list. It covers `briefs/*.md` +
  `DOCS-INDEX.md`, reads your LOCAL `origin/main` and never fetches — so it can only **under**-report,
  which is why the `git fetch` above is part of the rule and not the hook. Escape hatch, for when you
  have read them and are deliberately writing over them: `CLAUDE_ALLOW_STALE_BRIEF=1` — **as a
  command-position prefix on a Bash command** (`… && CLAUDE_ALLOW_STALE_BRIEF=1 sed -i …`), or
  **exported**, which is the ONLY form that reaches an `Edit`/`Write`: that path carries no command
  text for the hook to read, and the hook is a separate process that runs BEFORE your command, so it
  cannot see an inline prefix there. This sentence claimed the bare form worked everywhere until
  2026-09-02, when a session that had read the upstream commits was denied twice by the documented
  hatch and could not tell it from a broken guard (#2088).

  ⚠️ **This is a different failure from a merge conflict, and the absence of one is the tell.** If a
  brief edit rebases cleanly against a brief that moved, that is not reassurance — it is the exact
  signature of the bug.
- **This whole lifecycle is now gate-backed** by the `docs-ledger` group in `tests/dex-tests.js`: a stray
  root brief, a malformed/absent status header on a brief dated ≥ 2026-07-03, an unindexed brief, a dead
  **relative link** in `DOCS-INDEX.md` (any target — `](briefs/…)` resolves against the real brief set, and
  every other `docs/·audits/·wiring/·root` link resolves against a whole-tree path inventory), a one-sided
  `Superseded-by`/`Supersedes` pair, or a filename↔`Created` date mismatch turns the suite RED. Pre-2026-07-03
  headerless briefs are grandfathered (never fabricate a status). **This gate is Node-lane only** (it reads
  `briefs/` + the tree straight from the filesystem — the lane CI runs); the browser lane can't list a
  directory so it SKIPs. There is **no committed list to regenerate** — adding/removing a brief or moving any
  file needs no follow-up step (the committed `tests/docs-ledger-list.txt` snapshot + its generator were
  retired 2026-07-14, CPAP-REAL-CORPUS-FOLLOWUPS-II §4, to kill the regenerate-on-every-PR merge tax).
- **Repo layout (2026-07-03 owner-sanctioned relocation — the second deliberate break of the old
  "never move" rule).** The **root** holds ONLY: base/entry docs (`README.md`, `CLAUDE.md`,
  `ARCHITECTURE-PRINCIPLES.md`, `ORIENTATION.md`, `DOCS-INDEX.md`, `CONTRIBUTING.md`, `AUDIT-PROMPT.md`),
  standard OSS files (`LICENSE`, `NOTICE`, `CITATION.cff`, `THIRD-PARTY.md`, `CHANGELOG.md`), and **all runtime/build
  files** (`*.js` / `*.html` / `*.src.html` / `*.css` / `*.json` — load-bearing paths, NEVER move them).
  Everything else archival lives in: **`briefs/`** (work-plans + pre-standard kickoffs/handoffs),
  **`audits/`** (audit findings, external reviews, fusion issues, validation status, one-off audit
  prompts), **`docs/`** (specs, derivations, analysis READMEs, `docs/LEXICON.md`/`docs/EVENT-LEXICON.md`, patterns,
  deploy + privacy statements, narrative). **`ORIENTATION.md` MUST stay in root** — the test suite
  fetches it (roster gate; `docs/EVENT-LEXICON.md`/`audits/AUDIT.md` are only *mentioned* in tests, safe in their
  folders). Put a NEW archival doc straight into the right folder and add its `DOCS-INDEX.md` row; do not
  drop archival docs in root. The only further sanctioned
  relocation is `docs-archive/` for a *truly dead* doc, done deliberately with a redirect stub, never
  automatically on stamp.

## 📏 Units — the metric system is superior and is the default (non-negotiable)
SI / metric is the **canonical and preferred** unit system across the whole suite. **Store and
compute in metric, always** — kg, cm, °C, mmol/L (or the clinical metric unit a field conventionally
uses: mmHg for BP, bpm for HR, mL/kg/min for VO₂, m for elevation). A metric value is the single
source of truth on every profile/identity record and in every formula; never persist an imperial
number. An **imperial display switch is permissible** (kg↔lb, cm↔in, m↔ft, °C↔°F) **but metric is the
default on first load** and conversion happens only at the display/input boundary — read the field,
convert to metric immediately, do the math in metric, convert back only to render. Do not add
imperial-keyed norm tables or duplicate formulas; there is one metric NORMS table (NHANES/ACSM/etc.,
cited) and imperial is a thin presentation layer over it.

## 📜 Licensing & attribution — see `licensing/LICENSING-BRIEF.md`
The suite is unified on **Apache-2.0** (author: **Michal Planicka**; product brand: **Tepna** —
replaces the legacy umbrella strings `GanglioR`/`ANS Intelligence`). Root `LICENSE`, `NOTICE`,
`CITATION.cff`, `THIRD-PARTY.md` are authoritative. Every authored source file carries the SPDX
header from `licensing/SPDX-HEADERS.txt` (`Copyright 2026 Michal Planicka` + `SPDX-License-Identifier:
Apache-2.0`) — **no MIT/other license** survives. User-facing surfaces carry the health
intended-use disclaimer (BRIEF §6.5) and a `dxl-` stamp from `licensing/dex-license.css`
(samples: `licensing/dex-license-samples.html`). ⚠️ The **product brand `Tepna`** is distinct from
the **FROZEN event-bus codename `Ganglior`** — rename suite/brand strings only; never touch
`ganglior.*` identifiers, the `ganglior.node-export` schema, or the `fascia` alias. To apply the
whole pass, run the brief (Phases 1→3 = licensing, Phase 4 = Tepna rename); honor the re-bundle +
provenance/test gates as it specifies.

## 📚 Literature use — how published data/formulas/processes enter the suite (see `briefs/LITERATURE-USE-POLICY-2026-07-11-BRIEF.md`)
Using a paper is **allowed** in three tiers (formulas/processes · reference statistics/priors · raw datasets),
under rules that inherit the invariants above. The **hard line:** (1) **no networked data in a bundle, ever** —
a `Foo.html` never fetches a paper/DOI/dataset/CDN (gate-backed by `no-network.html`); a literature value that
must reach runtime is **inlined into source at author time as a cited constant**, then it is just code under the
normal gates. (2) **No fabricated authority** — a paper-sourced number is `validated`-tier ONLY with a real,
checkable citation; no citation → it keeps the suite's own tier (never upgrade a badge on "the literature says").
(3) **Attribution is mandatory** — author·year·journal·DOI in the doc + a source comment in code. **Routing:** a
node-specific validation → that node's validation write-up; a forward paper agenda → `PAPERS-ROADMAP` + `papers/`;
a method/formula that **changes code** → its own executable brief (gated like any behavioral change). The full
policy + a living anchor index live in the brief (still PROPOSED — the status flip to `REFERENCE` is the owner's
ratification).

**Attribution is GATE-BACKED, and an alias must declare where it came from.** `audits/CITATION-VERIFICATION-2026-08-05.json`
records `firstAuthor`/`year`/`container` for every DOI, and the `citation-ledger` group asserts that each DOI on a
reader-facing source surface — the reference guides, `papers/**`, `docs/**.md`, and the root `*.js` — is surrounded by
a citation naming that author and a year within ±1. (`briefs/` is deliberately OUT: a brief quotes a wrong attribution
*in order to say it is wrong*, so gating it is 35 % false positives. DOI *resolution* is also out — it needs network,
which no bundle or CI lane may have.) Wrong authors are the failure mode a reader cannot detect, because the link still
resolves and still lands on the paper being described; three shipped citations had them.

When a correct citation would red — a **corporate** author (Crossref stores the ESC/NASPE Task Force's full society
name), a **spacing** variant (`Du BOIS` vs `DuBois`), or a record for which **Crossref carries no author at all** — add
`authorAliases`, and you MUST also add **`aliasSource`**: `crossref-variant` when the alias is a spelling of what
Crossref recorded, or `from-paper` when Crossref has no author and the name was read off the paper itself. The second
is mildly circular — the citation being checked supplies its own answer — which is exactly why it is marked rather
than hidden, and why `from-paper` on a record that *does* have a Crossref author is a red. **Never silence a finding
by editing the ledger's `firstAuthor`**: that is the one edit which makes a real defect disappear.

## 🎙️ Capture provenance — how the raw signals are recorded
Raw **ECG** (Polar H10 chest strap) and **PPG** (Polar Verity Sense armband) are captured with the
**Polar Sensor Logger** Android app (`com.j_ware.polarsensorlogger`, by j-ware). It streams the
sensors over BLE and writes per-stream CSV/TXT files (ECG ~130 Hz, PPG/ACC etc.) with its own
timestamp columns — so `ECGDex` (and any PPG node) must treat Polar Sensor Logger's export layout
as a first-class input format. Honor the Clock Contract when parsing its stamps (regex the explicit
format; never `new Date(str)`); add its exact column/timestamp formats to the relevant `*-dsp.js`
parser as you encounter real files.

**Per-file honest-HR facts (TRIO-METHODS-REUSE §Do 2, from the real tri-device corpus).** The Verity
Sense onboard `_HR.txt` is **all-zero** and `_PPI.txt` is often header-only — a Verity HR MUST be
**derived from the raw `_PPG.txt`** via PPGDSP (3-LED consensus → `buildPPI` → Malik `correctRR`),
never read off the device HR file. The Polar H10 device `_HR.txt` is **smoothed** (it under-states σ
via a quiet-order artifact), so the **raw-ECG Pan–Tompkins** HR (`ECGDSP.parseECG → bandpass →
detectPeaks`) is the honest H10 leg — derive H10 HR from `_ECG.txt`, not `_HR.txt`. Any comparison or
fusion consuming these must derive HR from the raw waveform, not the onboard summary.

**A real tri-device corpus exists** — O2Ring + Polar H10 (device `H10-01`) + Polar Verity Sense
(device `VERITY-01`), 2026-06-10 → 2026-07-05, **20 eligible nights** (~10 with clean Verity). It is
the ground truth behind the reference-free σ work (`sensor-trio-power-analysis.html` /
`sigma-no-reference-analysis.html`) and unblocks several `PAPERS-ROADMAP` real-validation items.

## 🧪 Regression gate — run after ANY `*-dsp.js` / `*-cross.js` / `*-app.js` change
**`Dex-Test-Suite.html`** is the canonical gate. It loads the REAL modules + shared assertions
(`tests/dex-tests.js` — the same suite `node tests/run-tests.mjs` runs), then adds a browser-only
render-coverage group that drives a real app bundle in an iframe. **Render-coverage is now ON-DEMAND
(lazy, 2026-06-30):** a bare open paints ONLY the headless CI floor (~3 s) and the pill reads amber
**"headless green — render-coverage not run"** — that is the floor, **NOT a pass**. To run the FULL
gate, open **`Dex-Test-Suite.html?full`** (or click the **▶ Run render-coverage** button): the rigs
then boot for ~30–50 s — **wait for the group count to stop climbing**, then read the `#summary` pill —
it must say **all green** (`window.__rcState==='done'` + `sameOriginStatus().ok`). Treat a red as a
blocker, not a nitpick. A **cold-boot iframe timeout is now a ⊘ SKIP, not a red** (DEX-TEST-DETERMINISM
2026-07-01 — each rig retries the boot once, then skips an inconclusive double-timeout so the pill stops
flickering red on cold loads): skips count as neither pass nor fail, so a green pill can still hide a rig
that did not actually run — if you need every rig to have truly booted, check `sameOriginStatus().bootSkips`
(prose-immune, `[]` when all booted) / the `N skipped` pill, and just re-open `?full` to warm the cache.
- **Run it after editing any DSP/app, and after re-bundling**, before calling `done`. A passing
  live spot-check on one file is NOT a substitute — the suite catches contract breaks
  (function-signature/arg-order changes, return-type changes) that an ad-hoc check misses.
- The shared assertions ARE the public contract for each module. If you intentionally change a
  signature or return shape, keep back-compat (add new params LAST + optional; expose new return
  data via a NEW field/method) rather than editing the assertion to match — or update
  `tests/dex-tests.js` deliberately, knowing Node CI uses the same file.

## 🔏 Provenance gate — run after RE-BUNDLING any `Foo.html`
> **Ledger packaging (P3, 2026-07-15):** the two ledgers below are no longer single files — they live as
> per-app **`provenance/<App>.json`** fragments (each carries that app's GATE-A `manifestHash` + GATE-B
> fixtures) plus `provenance/_meta.json` + `provenance/index.json`. **`provenance-ledger.js`** reassembles
> the identical combined `{ bundles }` / `{ fixtures }` shape every reader consumes (Node `loadNode`,
> browser `loadBrowser`), so the gate cores below are unchanged — "`BUILD-MANIFEST.json`" / "`FIXTURE-
> PROVENANCE.json`" now name the *assembled view*, and edits land in the per-app fragment.

**`verify-provenance.html`** is a **pure-static, content-addressed** gate (SIGNAL-ADAPTER-AND-FRONTIER
Phase 7, 2026-06-30). It fetches each bundle FILE + the ledger fragments and hashes them — it does **not**
boot any bundle in an iframe and reads **no `buildHash`**, so there is no runtime race and no
same-origin dependency. It opens fast but GATE-B file-hashing settles in ~10 s (it hashes every
committed input + output); read `window.__provenanceOK` / `window.__gateA_ok` / `window.__gateB_ok`
for the verdict — never scan the body. Two gates:

- **GATE A — bundle code identity.** Every shipped bundle's current **`manifestHash`** must equal the
  value committed in **`BUILD-MANIFEST.json`**. `manifestHash` is the **sole executed-code identity**:
  a projection of the bundle's owned **plain-inline** assets (no gzip, no random UUID keys) — extract
  every `data-inline-src` `<script>`/`<style>` block, hash each block's text, form
  `logicalName \0 sha256(assetText)` per block, sort, and SHA-256[0:12] the join — a pure function of
  the inlined JS/CSS, **deterministic** across re-bundles of identical source, moving ONLY on a real
  code change (the legacy gzip+UUID `__bundler/manifest` branch was RETIRED 2026-07-03 — `manifest-gate.js`
  now hashes such a bundle to `null`; PROVENANCE-NONDETERMINISM-2026-06-29 §1). Computed statically by
  `manifest-gate.js manifestHashFromText`, shared by the page + the Node sibling
  `tests/verify-manifest.mjs` (`node tests/verify-manifest.mjs` runs GATE A + best-effort GATE B).
- **GATE B — content-addressed known-answer ledger.** Every fixture in **`FIXTURE-PROVENANCE.json`**
  is a self-contained triple `hash(input) + executed-code manifestHash → hash(output)`. A code-gated
  fixture is `reproducible ✓` only while (1) its producing bundle's current `manifestHash` still
  equals the recorded one, (2) every committed INPUT file still hashes to the recorded `inputHash`,
  and (3) the committed OUTPUT file still hashes to the recorded `outputHash` — so it reds the moment
  the code, an input, OR the output changes. Shared core `manifest-gate.js gateBEvaluate`.

⚠️ **`buildHash` is RETIRED as a provenance signal (Phase 7).** No gate reads it. It is still stamped
into exports by the bundled `ganglior-provenance.js` as **inert legacy metadata** — left in place on
purpose (re-bundling 8 apps to strip it would churn every fixture for zero gate value). Do **not**
record, compare, or reason about `buildHash`; `manifestHash` is the only code identity. (The whole
former "buildHash is a coarse / runtime-only / non-deterministic" caveat is gone — nothing depends on
it.) Behavior is gated **separately** by `Dex-Test-Suite.html`.

### Re-bundle checklist — update `BUILD-MANIFEST.json` (GATE A) + regenerate fixtures (GATE B)

**The build is OWNED (OWN-THE-BUILD Part A, fleet cutover DONE 2026-07-03). There is no hand-update
dance — the tool writes the ledgers.** Every bundle is a repo-owned deterministic **plain-inline** bundle
(`<script|style data-inline-src>` text; no gzip, no UUID). The whole procedure is:

```sh
node tools/build.mjs --app OxyDex     # edit the *.js / .src.html first, then rebuild
npm run check                         # ← the FULL gate. Not `build.mjs --check` alone.
```

⚠️ **`node tools/build.mjs --check` is NOT the drift guard — it is one of THREE.** There are three
generated trees, and re-bundling can staleness any of them:

| tree | built by | checked by |
|---|---|---|
| the 11 owned bundles | `tools/build.mjs` | `npm run build:check` |
| **`docs/` — SERVED COPIES of those same bundles** | **`tools/build-docs.mjs`** | **`npm run verify:docs`** |
| the analysis tools | `tools/build-analysis.mjs` | `npm run verify:analysis` |

`npm run check` runs all three (plus typecheck · lint · `test:par` · `verify:shard-union` ·
`test:build-core` · `verify:manifest`) and is exactly what CI gates on. **Run it, not a hand-picked
subset.** `CONTRIBUTING.md` has carried the full builder table all along — this line exists so the
file you read *first* points at it too.

⚠️ **FORMAT BEFORE YOU BUNDLE, not after.** `npm run check` puts `typecheck` and `lint` first by design:
they cost seconds, and everything after them costs minutes. A one-line type error or a Biome reflow
found *after* `build.mjs` invalidates the whole chain — bundle → orchestrators → `build-analysis` →
`build-docs` → `regen-<node>-goldens` → `verify-fixtures` (which re-runs the entire suite) — because
formatting an inlined file changes the inlined text, so `manifestHash` **and** `computeHash` move and
`verifiedUnder` has to be re-earned. Measured 2026-08-15: that chain ran twice for one `const`.
Pre-flight is `npm run typecheck && npm run lint`, then the group your change touches, and only then the
builders. **Hook-enforced at commit time** by `.claude/hooks/guard-format.sh`, which denies a `git
commit` whose STAGED `*.js`/`*.mjs` are not Biome-clean — `biome` is a required check, so such a commit
reds CI on formatting alone.
⚠️ **A hook change takes effect only once YOUR checkout has pulled it** — a session reads
`.claude/settings.json` from its own project directory, so a hook that merged five minutes ago is
running for nobody until each checkout syncs (measured: the shared root sat 92 commits behind with
neither the wiring nor the script). It degrades safely — a missing script exits 127 and the harness
denies only on 2 — but *"it is hook-enforced"* means *"once you have pulled it"*, and the shared root
is the checkout most likely not to have. It checks the staged paths explicitly (`biome ci --changed` was measured
exiting 0 on a staged format-only violation) and **fails open where Biome cannot run**, because a fresh
worktree has no `node_modules`. Escape hatch for a deliberate WIP commit: `CLAUDE_ALLOW_UNFORMATTED=1`.

The failure mode, if you skip it: a fleet re-bundle that passed `build.mjs --check`, GATE A/B, biome
and all 5378 assertions still went red in CI on `STALE (7): CPAPDex.html, ECGDex.html, …` (#797,
2026-08-03), because nothing local had looked at `docs/`. **All six test shards were green and only
the `static` job failed, so it presents as a test failure and is not one** — that misread is the part
that costs time. Same trap as #450 and DEEP-AUDIT-III-FOLLOWUPS §2.5.

### 🐍 capture-host has its OWN gate — `./check.sh`, and a hand-built pytest line is NOT it

`npm run check` covers the JS side. **`capture-host/` is a separate lane with a separate gate**, and it
is `capture-host/check.sh`: ruff · shellcheck · `pytest -q --cov --cov-branch --cov-fail-under=100`.
CI runs those as three jobs; the script is the one local invocation that runs all three.

⚠️ **A pytest line without `--cov` does not fail the coverage floor — it does not EVALUATE it.** There
is no error, no warning, and no coverage table: the run just prints `N passed` and exits 0. Measured
2026-08-11, twice in one session: 3264 tests passed, the author reported the gate green, and CI failed
on `Required test coverage of 100% not reached. Total coverage: 99.98%` — one uncovered line. The tell
is an ABSENCE (no `TOTAL` row), which is exactly the shape §4b warns about — a check that reports
success about something it never examined.

`check.sh`'s own header already says this about a sibling case ("`pytest --cov` printed 100 % and
`ruff` failed on the very next line"). Run the script.

⚠️ `shellcheck` missing locally exits **127** and the summary prints it beside a real failure. That is
a missing TOOL, not a failing gate — check which before you go looking for a bug in your diff.

⚠️ **After `tools/build-docs.mjs`, stage from `git status`, NOT from the `git add …` line it prints.**
Observed 2026-08-03: it printed nine paths of which **zero** had changed, and omitted the **seven
`docs/*.html` it had just rewritten**.

`build.mjs` **auto-writes** that bundle's `BUILD-MANIFEST.json` `manifestHash` and **re-stamps its
code-gated fixtures**. You do not hand-edit `manifestHash`, and you never hand-edit a fixture hash.
`tools/build.html` / `tools/build-core.js` are the browser equivalents. Do **NOT** use `super_inline_html`
— it regresses a bundle to the retired legacy format, which `manifest-gate.js` now hashes to `null`, so
GATE A reds and points you back here.

**Owned ≠ in GATE A.** `build.mjs` owns **`CLAIM ownedBundles = 11`** bundles — the **9** in
`manifest-gate.js MANIFEST_BUNDLES` (the 8 apps **plus `Integrator.html`**) and
**`CLAIM orchestrators = 2`** orchestrators (`Data Unifier.html`, `OverDex.html`, owned per FOLLOWUPS §6).
GATE A covers those **9**, not 8 — `Integrator.html` carries a `manifestHash` and a `provenance/Integrator.json`
fragment like any app. `--check` is the guard that covers all 11.
*(This line read "owns **10** bundles — the 8 apps" and "GATE A cover the **8 apps**" until 2026-08-15;
both were off by one because `Integrator.html` was never counted. Found by the `claude-md-claims` gate on
its first run, not by a reader. The `CLAIM` markers are machine-checked against the builder, so if you
change what it owns, this line reds until you update it.)*

**Fixtures.** `build.mjs` re-stamps a code-gated fixture's `manifestHash` on rebuild, but it cannot
know that your code changed a fixture's **output**. If it did, regenerate the fixture by **re-running the
app on its committed inputs and re-exporting** (NEVER hand-edit an export), then let the tool re-record
`{ manifestHash, inputHashes, outputHash }`. Because `manifestHash` is deterministic, an **export-inert
rebuild of identical source moves nothing** — no re-record. A fixture-only re-record needs no rebuild.
The regen tools are per-node and are the ONLY sanctioned way to move an output byte:
**`tools/regen-<node>-goldens.mjs` — NINE of them, one per node, plus two shared cores.** (This line
named only CPAPDex/GlucoDex/PulseDex until 2026-08-20 and read as "write one if your node lacks it";
`tests/dex-tests.js:24609` already referenced `regen-ppgdex-goldens.mjs` by name, so the tests knew
before this file did. Not `CLAIM`-marked, so no gate caught it — unlike `ownedBundles`/`clockBundles`.)
`cpap` (CPAPDex, 5 fixtures) · `ecgdex` (ECGDex, 4) · `glucodex` (GlucoDex, 3) · `hrvdex` (HRVDex, 3) ·
`integrator` (Integrator, 3) · `motiondex` (MotionDex, 1) · `oxydex` (OxyDex, 3) · `ppgdex` (PpgDex, 6) ·
`pulsedex` (PulseDex, 3); `regen-goldens.mjs` + `regen-goldens-core.mjs` are the shared machinery.
**Check for your node's tool before concluding a regeneration is expensive** — costing an item as
"needs a regen tool written first" when one ships is the same stale-capability error §📌 keeps finding.
Each re-runs the real modules in a co-loaded realm, preserves the volatile keys the equiv gate excludes
(`file`/`provenance`/`kernel`/`generated`), and re-records the ledger from the bytes it wrote — so an
**output-only** regeneration under UNCHANGED code (the case `build.mjs` does *not* cover: it re-stamps
`outputHash` only when the bundle hash moves) still lands in `FIXTURE-PROVENANCE.json` without a hand-edit.
Writing a node's regen tool is a one-off; copy the CPAP/GlucoDex pair.

### 🔒 "EXPORT-INERT" IS A COMPUTED VALUE — you don't get to *claim* it (FIXTURE-VERIFICATION-GATE, 2026-07-14)

Export-inertness used to be a **claim in a commit message**. `FIXTURE-PROVENANCE.json` is full of
`note_*: "EXPORT-INERT … outputHash UNCHANGED"` — the most-repeated assertion in this repo's history. On
2026-07-14 one of them was **wrong**: DEEP-AUDIT §1 checked only the synthetic golden (which trips no long
gap), declared export-inert, and shipped — while the REAL Lingo night's export had moved. The equiv leg that
would have caught it **SKIPS wherever `uploads/` is absent** (CI, *and* the author's machine); GATE B is
static and never re-runs the app; **`build.mjs` re-stamped the fixture's `manifestHash`**, silently
converting "came from code X" into "is reproducible under code Y". Every gate was green and the served
GlucoDex ran a pre-fix DSP against real users' CGM data. So the claim is now **computed, not asserted**:

- **`computeHash`** (`manifest-gate.js`) — `manifestHash`'s projection over the export's **compute closure**
  (every inlined asset that can reach `compute()`). Render/CSS/app edit → `manifestHash` moves, `computeHash`
  **stable** ⇒ **export-inert, PROVEN**. DSP/clock/export/registry edit → **both** move ⇒ re-verification owed.
  The closure is a **denylist** on purpose: an allowlist that forgets a module fails **OPEN** (the gate goes
  blind — the exact failure being abolished); a denylist that forgets one merely **over-flags**. Unknown asset
  ⇒ inside the closure. We accept false alarms; we do not accept a gate that cannot see.
- **`verifiedUnder`** (per code-gated fixture) — the code that **actually re-ran the app and reproduced those
  bytes**. **`build.mjs` is FORBIDDEN to write it** (it doesn't run the app, so it cannot know — auto-writing
  that claim is how the stale fixture shipped; gate-asserted by source scan). The **only** writer is
  **`tools/verify-fixtures.mjs`**, and only after a **green real-corpus run**.

**What this means in practice:**
- Re-verify after a compute-path change: **`node tools/verify-fixtures.mjs`**. It refuses
  to stamp if an input is missing or the suite is red — a verification you didn't run is precisely the false
  claim being abolished. If a fixture genuinely **moved**, regenerate it (`tools/regen-<node>-goldens.mjs`)
  first; never re-stamp around a moved output.
  ⚠️ **Your worktree does not contain the corpus, and cannot** — the recordings are gitignored, so §👥.1's
  mandated worktree holds only the tracked fifth of `uploads/` while §🔏's mandated re-run needs the other
  four fifths. The tool now searches `$DEX_UPLOADS` → the **primary checkout**'s `uploads/` → this
  checkout's, and prints that search when it refuses, so "absent" is a conclusion you can check rather
  than a guess. `DEX_UPLOADS=<corpus>` still overrides. The data lives in **four** places and only the
  first satisfies this tool — see [`docs/CORPUS-LOCATIONS.md`](docs/CORPUS-LOCATIONS.md), which also
  records that the freshest nights are on `vigil` and that a *regeneration* may therefore be an `ssh` job.
- **`tools/release.mjs` REFUSES to cut a release while any corpus-backed fixture is UNVERIFIED.** That is the
  wall — it would have blocked v1.10.1. CI reports the same thing but does **not** block (a contributor with
  no corpus cannot green it; harm materialises on ship, and the releaser is the one holding the corpus).
- Fixtures with **committed** inputs (the synthetic twins) are **exempt** — CI re-runs them from committed
  bytes every push, so they cannot go stale unseen. This is why an adversarial **committed** twin beats a real
  one: see the GlucoDex 14 h-gap twin. A real gappy night would have been gitignored and CI would have stayed
  just as blind.
- **Never write "export-inert" as an assertion again.** Either `computeHash` didn't move (say so, and give the
  hash), or you re-verified (say so, and name the fixtures). Prose is not evidence.

**The regenerate step is gate-enforced (the GATE-C surface).** GATE B is *static* — it pins the
committed input/output bytes + code identity but does **not** re-run the app, so on its own it can't
catch a code change that MOVED a fixture's output if you re-recorded the fixture's `manifestHash` without
regenerating the output bytes. That regenerate-and-diff (GATE C) is enforced by **`Dex-Test-Suite.html`'s
equivalence gate**: `env.equiv.*` runs `compute({committed input}) ≡ committed export` (volatile-stripped)
for OxyDex/PulseDex/HRVDex/GlucoDex/PpgDex/ECGDex, and the CPAPDex synthetic goldens pin
`compute() ≡ CpapFusion.cpapBuildExport`. **Every code-gated node has ≥1 such dynamic leg**, so a code
change that moves an export's content **reds that node's equiv/golden leg** — `verify-provenance` GATE B
(committed-artifact integrity) + the equiv/golden gate (current code reproduces the export) together
close the loop. So when an equiv leg reds, regenerate **all** of that node's fixtures (e.g. both OxyDex
summaries — only `_1056` has an equiv leg, but `_0439` shares the same code), not just the one named.

**⏱️ The "wait for the build to settle" rule is RETIRED — its cause is gone.** The async platform
auto-rebuild that PROVENANCE-NONDETERMINISM §2/§4 warned about was an artifact of the **legacy inliner**;
the owned build is explicit and deterministic — nothing rebuilds behind your back, and a `manifestHash`
read straight after `build.mjs` is final. Do not re-read-and-wait; do not treat a moving hash as normal.
If a hash moves with no source edit of yours, that is a **concurrent session**, not the build.

**What DOES still hold: the ledgers are single files that every bundle-touching PR rewrites** (see §👥.3).
So `BUILD-MANIFEST.json` / `FIXTURE-PROVENANCE.json` can still be rewritten out-of-band by *another
session*. **If GATE A/B already reconcile to the current hashes, do NOT hand-edit the ledger** — it is
synced, and fighting it just races the other writer. Rebase and re-run `build.mjs` instead.

### Fixture provenance ledger — `FIXTURE-PROVENANCE.json` (content-addressed, Phase 7)
The single source of which fixtures are audited AND their known-answers. Each record is
`{ bundle, manifestHash, inputHashes:{file:16hex}, outputHash:16hex }` (code-gated) or
`{ bundle, historical:true, outputHash }` (an immutable snapshot — e.g. the historical Integrator
fusions — byte-PINNED only, NOT code-gated, because its producing code has evolved and it is not
current-code-reproducible; code-gating it would assert a false reproducibility). The `fixtures` keys
ARE the audited set — there is **no separate legacy list and no `buildHash` fallback** (both retired
in Phase 7). **Workflow:** regenerate by re-running the app + re-exporting (never hand-edit a hash),
then record the three hashes. The full "make `buildHash` itself strong" path (stash the manifest in
the inliner bootstrap) remains **deliberately NOT taken** — it requires owning the inliner
(GENERATOR-FOLLOWUPS-II-BRIEF §1) — and Phase 7 made it unnecessary by content-addressing around the
already-honest `manifestHash`.

## 🎫 Evidence badges — ONE canonical source (don't fork the visuals or the grades)
The 5-level evidence ladder (**measured · validated · emerging · experimental · heuristic**, ranks
0→4, disc shape = trust, never hue) is defined ONCE and mirrored everywhere. Do NOT hand-redraw
badge CSS or re-tier metrics ad hoc.
- **🔴 COVERAGE MANDATE — read THIS before creating or changing ANY measurement:** every surfaced
  measurement carries an evidence badge, *no exception* — **every KPI, every metric / finding card,
  every hero / headline number, every chart-or-graph series, every table row & chip.** A number that
  reaches a user's eye unbadged is a **bug**, same severity as a wrong unit. **Only two placements are
  allowed:** (1) pinned in the card's **bottom-right corner** (`.ev-corner` wrapper; the card must be
  `position:relative`) — for cards, KPIs, hero/headline numbers, chart cards; or (2) **inline,
  immediately *before* the label** (`.ev`) in dense/crowded text — tables, chips, legends, multi-metric
  rows. New surfaces inherit NOTHING automatically: you must wire `MetricRegistry.badge()` / `.ev-corner`
  in when you add them. Markup contract → `dex-badges.css`; workflow → `CONTRIBUTING.md`.
  - **A CHART CAPTION IS NOT A BADGE SITE — badge the SERIES** (owner decision 2026-08-16,
    `DEEP-AUDIT-V-FOLLOWUPS` §1.2 option (c)). A caption routinely spans two metrics —
    *"SpO₂ Mean % · T95% Time Below 95%"* — so it **cannot** carry one evidence tier, and forcing one
    onto it would be the fabricated authority this section exists to prevent. The mandate above already
    says *"every chart-or-graph series"*; the corollary is stated here so it is not re-litigated:
    **an unbadged caption is correct provided every series it draws is badged.** `no-fabricated-tier`
    therefore does not scan `chartTitle`, and its ratchet dropped **94 → 70** when the 24 caption
    labels came out — measured, not assumed (row 2 · chartTitle 24 · metric 55 · ssKPI 7 · nrChip 6).
    Those 24 were never debt.
- **Visual source of truth:** `metric-registry.js` injects the badge stylesheet and now exposes the
  exact string as `MetricRegistry.BADGE_CSS`. `dex-badges.css` is a byte-faithful MIRROR for static
  docs that don't load the engine (e.g. the reference guides). Apps load `metric-registry.js` and
  must NOT also hardcode disc CSS.
- **Grade source of truth:** each node's `<node>-registry.js` (`OXY_REGISTRY`, `ECG_REGISTRY`, …) —
  every metric's `evidence` field. A metric's tier is a NODE fact; never invent a global grade table. The crossnight `*_DEFS` in each `*-cross.js` is a **projection** of the registry, not a second source — `tests/dex-tests.js`'s `registry-defs-parity` group gates it (label · unit · goodDirection · evidence; registry wins).
  Retired vocabulary (proxy→heuristic, composite→experimental, "provisionally validated"→emerging)
  must never reappear.
- **Gate:** the shared suite's `cohesion-badges` group (in `tests/dex-tests.js`) asserts engine ≡
  `dex-badges.css` (per-tier disc props — two files, the single visual source), that each reference
  guide `<link>`s `dex-badges.css` rather than inlining the disc CSS (so its discs inherit the gated
  visuals by construction — DEX-EVENT-UNIFY C3), no retired vocabulary, and that every reference-guide
  card the node's OWN resolver (`<Node>Registry.idForLabel`) maps carries the SAME grade as the
  registry. **A reference guide is the consumer that must conform** —
  if a doc grade and the registry disagree, fix the DOC, not the registry (the registry ships in the
  app and is test-backed). To cover a new guide, pass its `<NODE>_REGISTRY`+`<Node>Registry`+doc text
  into `env` in BOTH runners (`run-tests.mjs` + `Dex-Test-Suite.html`) — the group does the rest.
- **Re-bundle note:** the `BADGE_CSS` export is inert (apps don't read it; injected CSS is
  byte-identical), so adding it did NOT require re-bundling the apps — and re-bundling 7 apps just to
  carry an inert export would flip every provenance fixture. Leave bundles as-is for inert shared-
  module additions; re-bundle only when runtime behavior changes.

## 📦 Releases, versioning & the changelog (CONTROLLED-RELEASES-2026-07-05)
One suite **SemVer** is the release identity (the "maintenance number"): canonical in
`suite.manifest.json` `version`; `RELEASE-MANIFEST.json` is the append-only history; root `CHANGELOG.md`
(Keep a Changelog) is the human view. **Three identity layers, never conflated:** the release SemVer ·
each bundle's `manifestHash` (code) · each brief's dated filename+status (docs). Do **NOT** stamp a
hand-typed version onto source files — `manifestHash` already identifies code more strongly than a number.
- **Bump semantics** (SemVer vs Tepna's published contracts): **MAJOR** breaks a contract
  (`ganglior.node-export`, the Clock Contract, `ganglior.crossnight`, a metric's identity/units, node
  removal); **MINOR** adds backwards-compatibly (node/metric/adapter/gate/additive field); **PATCH**
  fixes without changing a contract shape (a moved fixture output is still PATCH but MUST regenerate
  fixtures per §🔏).
- **Parallel coders never hand-pick a number.** Each work-unit drops a collision-free **changeset** as
  its last action (`changes/*.md` — `bump`/`type`/`brief`; see `changes/README.md`). `tools/release.mjs`
  folds all pending changesets, computes the version ONCE from a **green tree**, stamps
  `suite.manifest.json`, prepends the `CHANGELOG.md` section, appends the `RELEASE-MANIFEST.json` record
  (+ per-app `manifestHash` snapshot), prunes `changes/`, and prints the `git tag`. Never hand-edit a
  version or a snapshot.
- **Gate-backed** by the `release-ledger` group in `tests/dex-tests.js` (sibling of `docs-ledger`): valid
  SemVer · no fork (newest ledger record ≡ canonical) · unique + strictly-increasing versions ·
  history↔changelog parity · changeset well-formedness · **check 7 — code that moved (`manifestHash` ≠ the
  last release's snapshot) requires a pending changeset** (you can't ship code without recording it; zero
  false positives — `manifestHash` is deterministic). **Node-lane only** (it reads `changes/` straight from
  the filesystem — the lane CI runs); the browser lane can't list `changes/` so it SKIPs. There is **no
  committed list to regenerate** on adding/pruning a changeset — the `tests/changes-list.txt` snapshot + its
  generator were retired 2026-07-14 (CPAP-REAL-CORPUS-FOLLOWUPS-II §4, killing the per-PR merge tax).
- **62304/13485-ALIGNED, not conformant.** The `docs/COMPLIANCE/` set (lifecycle plan · safety class ·
  config-mgmt · SOUP · release SOP · doc-control) adopts the disciplines as good practice with **no
  certification claim**; every file carries the non-device disclaimer. Runtime SOUP is empty by design.
- **Version-into-bundle stamping is LIVE (owner-ordered 2026-08-18 — the deferral is over, and so is its
  reason).** `DexBuild.build` projects `suite.manifest.json`'s version into each bundle's presentation
  anchors (`<title>… · vX.Y.Z` · `.logo-sub` · `.version-badge`) at build time, in BOTH lanes.
  The economics that justified deferring changed: the stamp lands OUTSIDE every `data-inline-src` block
  **by construction** (inline blocks are masked during projection), so `manifestHash` — a projection of
  those blocks alone — is INVARIANT and a release moves **zero** fixtures. Gate-asserted with a decoy in
  `tests/build-core-tests.mjs`. After `tools/release.mjs` bumps the version, run `node tools/build.mjs`
  (its printed post-steps now say so) — until then `build.mjs --check`'s byte-compare reds every bundle
  still carrying the old string, so a stale displayed version cannot ship silently. Do NOT hand-edit a
  version string in a `.src.html`; the literals there are placeholders the build overwrites.

## ✅ Known non-issues (do NOT re-investigate or "fix" — they are intentional/resolved)
- **Fonts / woff2:** there are no `*.woff2` files and no `@font-face`/CDN refs in source any more.
  The `'Inter'`/`'IBM Plex Mono'` names in font stacks fall through to `system-ui`/`ui-monospace`
  by design. **All 8 bundles are owned plain-inline (OWN-THE-BUILD Part A) and system-fonts-only** —
  PulseDex's legacy captured IBM Plex Mono woff2 (a stale inliner ext-resource its source never referenced)
  was **dropped in the 2026-07-03 PulseDex cutover** per owner decision, so it now matches the fleet.
  **Do not** add `@font-face`, do not reintroduce a CDN, do not re-embed a woff2, do not
  flag "missing woff2" — that whole class of warning was removed at the root in June 2026.
- **`parseTimestamp` single-sourced in `clock.js` (A5 EXECUTED 2026-07-03, owner-ratified).** The former
  "duplicated in every `*-dsp.js`, mirror it" rule is RETIRED: THE canonical Clock-Contract parser now lives
  in `clock.js` (`DexClock`), inlined by the owned bundler into **`CLAIM clockBundles = 5`** of the 8 app
  bundles (bundled-local AND single-source) — **NOT all of them**, and that distinction is load-bearing:
  oxydex/pulsedex/hrvdex/ecgdex/motiondex ship the spine and DELEGATE via local aliases, while **ppgdex,
  glucodex and cpapdex do not inline `clock.js` at all**, so **`DexClock` is UNDEFINED in those three
  bundles** — a bare `DexClock.x` there is a `ReferenceError`, not a fallback. They keep DELIBERATE
  node-local variants (ppgdex: strict ISO/epoch subset + quote-strip; glucodex: `_ckParse` + MDY numeric
  wrapper; cpapdex: EDF subset) — do not force them onto DexClock, and do not reintroduce a mirror.
  *(This sentence read "into every bundle" until 2026-08-15, which was false for three of eight and is why
  the `claude-md-claims` gate exists. The `CLAIM` marker above is machine-checked — see that group.)* Load `clock.js` BEFORE any
  delegating `*-dsp.js` (dex-coload.js `shared:` + the co-load gate enforce this; worker `importScripts` lists too).
- **`docs-archive/REFACTOR-BRIEF-modularize-Dexes.md`:** historical, the refactor is DONE. See `docs-archive/`.

---

## 🔒 THE CLOCK CONTRACT (non-negotiable — every app + every future node must obey)

All five apps were unified onto ONE time model. EEGDex, the Integrator, and any new node MUST
inherit it verbatim — do not "fix" it back to real-UTC epoch.

### 1. Canonical unit: UTC-normalized *floating wall-clock* milliseconds (`tMs`)
Store the recording's **local civil time encoded as if it were UTC**:

```js
tMs = Date.UTC(year, month-1, day, hour, min, sec, ms);   // canonical — NOT a real UTC instant
```

Why floating (and why you must not revert it): these devices speak local civil time with no zone.
Storing real UTC + rendering with local getters makes displayed time depend on the *viewer's*
timezone (a New-York night reads 03:00 in London). Floating `tMs` + `getUTC*` is
**viewer-timezone-independent**, and two devices recording the same wall-clock minute produce the
**same `tMs`** by construction → cross-app sync holds without anyone sharing a timezone.

- Never store a `Date` object or a formatted string as the source of truth.
- Per record: `tMs`. Per recording/night/session: anchor `t0Ms` = `tMs` of the first valid sample.
- Optional `offsetMin` (minutes east of UTC) **only** when the input carried a real zone (a zoned
  ISO stamp). Real instant is then `utcMs = tMs − offsetMin*60000`. Default ALL sort/align/display
  to `tMs`; compute `utcMs` only for genuine cross-timezone simultaneity. No zone → `offsetMin = null`.

### 2. One shared parser — `parseTimestamp(raw, opts) → { tMs, offsetMin } | null`
**Single-sourced in `clock.js` (`DexClock`) since A5 (owner-ratified, executed 2026-07-03)** — the owned
bundler inlines it into every bundle; delegating DSPs alias it locally (`var parseTimestamp =
DexClock.parseTimestamp;` …). ppgdex/glucodex/cpapdex keep deliberate node-local variants (see §✅).
Resolution order:
1. Numeric epoch (number / all-digit string, plausible range): real instant → floating for the
   local zone at parse time (`tMs = inst − tzOffset(inst)`), `offsetMin = −tzOffset/60000`.
2. **ISO-8601 with zone** (`…Z` / `…±HH:MM`): zone authoritative; `tMs = Date.UTC(components as written)`,
   capture `offsetMin`. (A zoned stamp and a no-zone local stamp for the same wall instant → same `tMs`.)
3. **ISO / `YYYY-MM-DD[ T]HH:MM[:SS]` no zone**: components verbatim → `Date.UTC(...)`, `offsetMin=null`.
4. **Explicit vendor formats by regex** (never locale `new Date(str)` / `Date.parse` on vendor strings):
   `HH:MM:SS DD/MM/YYYY` & `MM/DD/YYYY` (O2Ring), `DD/MM/YYYY HH:MM[:SS]` & `MM/DD/YYYY …` (Welltory),
   `YYYY/MM/DD HH:MM:SS`, 14-digit `YYYYMMDDHHMMSS`. Disambiguate DMY/MDY per §3.
5. **Time-only `HH:MM[:SS]`**: combine with `opts.dateAnchorMs`; roll the date forward one day each
   time the clock wraps past midnight (monotonic via `opts.prevTMs`). No anchor → `null`. Never Jan-1-2000.
6. Fallback: `return null`. **NEVER** fall back to `new Date()` / now() — a missing stamp must be
   visible (null), never fabricated.
7. **Component ranges are validated — `Date.UTC`'s silent roll is a fabricated instant** (DEEP-AUDIT-II
   §12.3, amended 2026-07-21). Regexes match *digits*, not *calendar validity*: `2026-13-45 25:99` would
   feed `Date.UTC` out-of-range components, which it silently ROLLS onto a plausible WRONG instant
   (month 13 → next January, day 45 → next month, `25:99` → +1 day 1 h 39 m). `clock.js:_ckMk` now builds
   `tMs` **only** if the date round-trips (month 1–12, a real calendar day — rejects Feb 30 / Apr 31) and
   the time is `0–23 : 0–59 : 0–59 . 0–999`; any out-of-range component ⇒ **null** (same honesty as §2.6).
   The **one** legitimate overflow is ISO-8601 **`24:00:00`** (end-of-day) → normalized to next-day
   `00:00:00`. **Do NOT add a bare `h > 23` guard** — it would reject `24:00:00`.

Helper: `tzOffset(instantMs) = new Date(instantMs).getTimezoneOffset()*60000`. Everything else is
pure `Date.UTC` + regex.

### 3. DMY vs MDY (one deterministic rule)
Any row with day-component > 12 ⇒ file is unambiguous; lock that order for the whole file. Else honor
`opts.preferDMY` (default **true** for O2Ring/Welltory; GlucoDex CGM uses **false/MDY**). Never switch order mid-file.

### 4. Per-recording anchors
- `dateAnchorMs` = recording's start date at 00:00 (`Date.UTC(y,mo-1,d)`). Priority: (1) full date in
  data; (2) 14-digit `YYYYMMDDHHMMSS` in the filename; (3) file `lastModified` (converted to floating);
  (4) `null` → "date unknown", do not fabricate.
- `t0Ms` = `tMs` of first valid sample. Store on the night/session object (+ `offsetMin` if known).

### 5. Display — ALWAYS `getUTC*` (never `getHours()` etc.)
Because `tMs` is floating, read it back with the UTC family so output is identical on any machine:
- `fmtClock(ms)` → `HH:MM`, `fmtDate(ms)` → `YYYY-MM-DD`, `fmtDateTime(ms)` → `YYYY-MM-DD HH:MM`,
  all from `getUTCHours()/getUTCMinutes()/getUTCFullYear()/…`.
- For `toLocaleDateString`/`toLocaleTimeString` labels, pass `{ timeZone:'UTC' }`.
- A `Date` kept for compatibility must be `new Date(tMs)` and read **only** via `getUTC*`.

### 6. Export contract (the cross-node currency)
Node JSON exports use `schema.name:"ganglior.node-export"`, `recording.startEpochMs` = the floating
`t0Ms`, and `ganglior_events:[{ t:"HH:MM:SS", impulse, node, conf, meta? }]`. **Event `t` is a
wall-clock string with no date** — consumers reconstruct absolute `tMs` from `startEpochMs`'s date +
`t` (rolling past midnight, monotonic). New emitters SHOULD additionally write `tMs` (absolute
floating ms) on each event; consumers must still tolerate `t`-only legacy exports.

### 7. The HOST-DISCIPLINED AXIS — `DexClock.hostAxis` (§1–§6 govern the parser; this governs the RATE)
§1–§6 say how a stamp becomes a `tMs`. They say nothing about what happens across a *recording*, and a
device crystal is wrong by ppm: read the host stamp once to anchor `t0Ms` and then ride the device
counter, and the axis drifts away from the host all night. Every Polar-Sensor-Logger / capture-host row
carries **two** clocks — `Phone timestamp` (the capture host) and `sensor timestamp [ns]` (the device) —
and `hostAxis` is the only sanctioned way to reconcile them. **A node MUST NOT hand-roll a rate
correction**; call `hostAxis` and consume `correctionAt()`.

- **An ANCHOR is a `{ devMs, hostMs }` pair read off the SAME row.** Non-finite members are dropped, not
  defaulted; anchors are sorted by `devMs`. Divergence is measured **relative to the first anchor** — the
  node already anchored `t0Ms` there, and an absolute offset would double-count it.
- **The median is EXACT in the interior and biased at the ENDS, by a known amount.** A running median
  over a linear ramp reproduces it pointwise, so between the clamped edges `correctionAt` is the measured
  divergence with no smoothing loss. At the two ends the window clamps, which pulls each end **inward by
  ⌊win/2⌋/2 = 5 anchors' worth of drift**. Two consequences, both contractual: `correctionAt(firstAnchor)`
  is that bias rather than exactly 0, and **`ppm` under-reads by a factor `1 − 5/(n−1)`** — 12.5 % at
  n=41, 0.6 % at n=801, 0.17 % on the real 2873-anchor O2Ring geometry. This is a *second*, independent
  reason `ppm` must never be quoted without its anchor count and span beside it; the first is leverage.
- **≥3 anchors, and that minimum is a contract, not a nicety.** Two points define a line through any
  jitter and cannot be checked; three is the least that can show curvature — and the O2Ring's observed
  divergence is **non-linear**, so a line is the wrong model, not merely an imprecise one. Fewer than
  three ⇒ **refuse**.
  ⚠ **That curvature is the LINK, not the crystal — do not repeat the old attribution.** This text used to
  read "the O2Ring's real error is −3035 ppm decaying to −1622 ppm" and call it crystal behaviour. Measured
  2026-08-18 against the host on a 7.2 h night: the ring holds **flat at ~4 s lag for hours 0–3**, i.e.
  **sub-ppm**, and only then degrades at ~12.5 s/h — the onset is the first BLE dropout, not a temperature
  ramp. A crystal does not change rate by thousands of ppm; a stalled link does, and a single linear fit
  through the stalls renders it as a smooth "decay". **The ≥3-anchor contract is unchanged and is if
  anything stronger**, because dropout-driven divergence bends harder than any crystal would.
- **A running MEDIAN (width 21), never a fit.** Host stamps carry BLE delivery jitter (~0.1 s, up to
  470 ms observed); interpolating raw anchors injects that straight into beat times, which for HRV is
  worse than the drift being removed. The width was chosen by planted recovery against ±100 ms jitter on
  real geometry (9 → 77 ms worst, 21 → 57, 41 → 168, 81 → 245): 21 halves the jitter without flattening
  the curvature the correction exists to follow. **Do not replace the median with a regression** — that
  is the whole point, and a fit would also re-introduce the "one ppm describes the night" error.
- **Linear between anchors; FLAT outside them.** Past the last anchor there is no measurement, and
  extending a slope there fabricates one — §2.6's rule applied to the rate.
- **`CK_AXIS_MAX_PPM = 50000` (5 %) is a REFUSAL bound, not a clamp.** The largest apparent divergence in
  this corpus is −3035 ppm, so 5 % leaves 16× headroom. ⚠ Read that as a **link** figure, not a crystal
  one — the ring's crystal measures sub-ppm between dropouts (above). That makes the bound **more**
  necessary rather than less: a crystal's error is bounded by physics, whereas a stalled link can
  manufacture an arbitrarily large apparent rate, and this bound is the only thing standing between such
  an artifact and a fabricated timebase. Beyond it the two columns are not the two clocks we think they
  are — a misparse, a unit mismatch, a shifted column — and "correcting" by
  that amount fabricates a timebase (caught by a fixture whose ms column advanced at 2× its host stamps:
  unbounded, a −500000 ppm "correction" that doubled `fs` from 130 to 259.9). Out of bounds ⇒ **refuse**.
- **A refusal returns `{ ok:false, reason, n }` and NO `correctionAt`.** A caller must not be able to
  apply a silent zero: absent a correction the node keeps the device axis and says so.
  ⚠ **A refusal guards the RATE, not the AXIS.** "Keeps the device axis" is the whole of what a refusal
  buys: `fs` is never corrected by a fabricated ppm, and NOTHING ELSE is protected. If the device counter
  carries a step (the `_ECG.txt`/`_ACC.txt` resync of the bullet below), the `relSec` built from it still
  spans the step — measured 2026-09-02 with the true F1 magnitude planted into a `_PPG.txt`: `hostAxis`
  refuses at ±50,000 ppm as designed, and `relSec` still spans **2.416e8 s**, so every duration, epoch
  grid and export window downstream inherits a 7.66-year night while the rate guard reads green. This is
  the `.ppm`-vs-`correctionAt()` distinction one level up: **a refusal on one quantity is not protection
  of another.** A node that relies on `hostAxis` refusing to keep a stepped counter out of its outputs
  has no step guard — the step must be detected and re-anchored on the axis itself (`_clockResyncs`,
  MotionDex/ECGDex), and a node without step detection owes at least a tripwire that reds the day its
  stream first carries one (FOLLOWUPS-VI §1.1/§1.3, #2080).
- **NO span gate here, deliberately** — and this is the one place the sibling tools differ. `hostAxis`
  does not *quote* a rate, it interpolates measured divergence, so its residual is bounded by what it
  observed. Gating on span would refuse the short O2Ring fragments whose real error is ~3 s, i.e. exactly
  the case that needs it. A consumer that reads **`.ppm`** instead of `correctionAt()` is quoting a rate
  and **does** need a baseline — that is why `ecgdex-dsp.js` span-gates its `fs` correction at 2400 s
  while PpgDex, which consumes the interpolation, does not.
- **`ppm` and `maxStepMs` are DIAGNOSTICS.** Never quote `ppm` without the span beside it (the same H10
  reads −20.3 ppm over 373 min and −65.8 over 10.9). `maxStepMs` surfaces a genuine clock STEP smeared
  across one anchor gap rather than hiding it in a slope.
  → **That span rule is a hand-derived special case of a standard curve, and the curve is now computed.**
  A clock's stability is σ_y(τ) — a function of averaging time — which is exactly why one τ-less number
  cannot describe it; the two H10 figures above ARE two points of that curve, reported as disconnected
  anecdotes. **`capture-host/allan.py` computes it** (overlapping Allan deviation, `stability(phase, tau0)`),
  and its SLOPE names the mechanism rather than the magnitude: τ⁻¹ jitter that averages away · τ⁻¹ᐟ² the
  benign case · τ⁰ a floor where more averaging buys NOTHING · τ⁺¹ᐟ² wander · τ⁺¹ drift. If you are about
  to answer "does this drift?" or "how long should I average?" with an SD, a ppm, or a fit of two halves —
  **standard deviation DIVERGES for these noise types as N grows** (NIST/Riley SP 1065), so that answer
  depends on how much data you happened to have. Use the curve. See
  [`briefs/ALLAN-DEVIATION-2026-08-12-BRIEF.md`](briefs/ALLAN-DEVIATION-2026-08-12-BRIEF.md).
- **This does not claim the host is right.** It places every device on ONE timebase so they become
  mutually consistent; whether that timebase is itself correct is the host's business (0.008 ppm on the
  capture box).
- **FIRST ASK WHETHER THERE IS A SECOND CLOCK AT ALL — read `independent`, never a ~0 ppm.** A rate of
  ~0 has two opposite meanings: two independent clocks that agree, or a host column the capture app
  *derived from the device stamp*, which is the absence of a measurement wearing the shape of one. The
  discriminator is the residual **spread**, not the slope, and it is bimodal in the data: box captures
  span 101.89 ms – 5124 ms, phone captures **0.13 – 1.00 ms**, with nothing in between. The phone tree's
  maximum is exactly one stamp quantum because its host column *is* the device time rounded. `hostAxis`
  publishes `spreadMs` and `independent` (`spreadMs > 2 ms`, twice the quantum — a property of the data,
  not a tuned threshold). **A phone-captured recording has no second clock**, which is also why the
  H10↔Verity offset runs ~3.3 s on phone nights against ~0.2 s on box nights: only the box actually puts
  the two devices on one timebase.
- **A device whose axis was DRAWN is not a clock.** Provenance is computed, not assumed: a stream whose
  inter-sample deltas concentrate on one value (≥99 %) was constructed as `sample_index × an assumed
  rate` and carries no independent timing. It may be placed on the host timeline, but it must never be
  spent as a second clock — see `quality.timingSource` (`device+host` · `host` · `none`).
- **ONE DEVICE CLOCK PER AXIS — a resync boundary is a change of clock, and anchors from before it must
  not feed `hostAxis`.** `hostAxis` measures every divergence *relative to its first anchor*, so it assumes
  all its anchors were read off ONE oscillator state. A capture-side resync (`clock_watchdog` re-anchoring
  the device counter; the `_ECG.txt` ns step of DEEP-AUDIT-VI F1) violates that: the pre-seam counter is a
  different clock, and the seam arithmetic that makes the device axis *continuous* across it does not make
  it the *same*. Measured on the real 2026-08-27 seam file (resync 9.5 s in, 50 min long): the host−device
  residual walks **+1508 ms across the first 9.5 s** (≈160,000 ppm) and then holds flat at 38 ppm — with
  anchor 0 inside the pre-seam segment `hostAxis` read that step as a rate, quoted **484.7 ppm**, and the
  span gate let it into `fs` (129.968 → 129.903, 500 ppm off the same H10's 6.5 h sibling — the disagreement
  `trio-batch mergeEcg` refused). A clock CHANGE is the hardest step there is, and the `maxStepMs` rule
  already says a step is reported, never absorbed. The contract: **build the axis from anchors at or after
  the LAST resync only**; rows before it get the flat out-of-range correction of the first post-seam anchor
  (§7 "flat outside them"); count what was dropped (`hostAxis.anchorsDroppedPreResync` on the rec) and surface the seam's
  host↔device offset (`clockResyncs[].hostOffsetMs`) so the pre-seam segment is *visible*, not silently
  re-timed. ECGDex implements this (`ecgdex-dsp.js`, the "ONE DEVICE CLOCK PER AXIS" block). **Any node that
  detects a device-counter step and then calls `hostAxis` owes the same split** — a node that detects no
  steps (PpgDex today) has not shown its stream has none, only that it has not looked; the `_ACC.txt` of the
  same night carries the F1 step (FOLLOWUPS-VI §1.1), and the Verity's `_PPG.txt` is unchecked (§1.3).

### Verification any time you touch time
Round-trip (first/last shown == raw file exactly) · bin==CSV identical `t0Ms`/`tMs` (OxyDex) ·
viewer-timezone independence (re-render under a changed `TZ` → identical clock) · overnight 22:00→06:00
= ~8 h monotonic (no 24 h jump) · zoned `+02:00` == local for same instant → same `tMs` · DMY `13/05`
and MDY `05/13` both → May 13 · stamp-less row → null (never today) · metric parity on clean files.
