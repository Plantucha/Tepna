<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
# CLAUDE.md — the rationale: every incident, measurement and correction behind the rules

**Status:** REFERENCE (living — grows only by moving text OUT of `CLAUDE.md`; nothing here is a rule) ·
**Created:** 2026-09-26 · **Split ruling:** owner, 2026-09-26 — *"optimize to reasonable minimum usage,
move narratives somewhere else"*, reversing the 2026-08-28 convention-only verdict of
`briefs/CLAUDE-MD-REDUNDANCY-AUDIT-2026-08-27-BRIEF.md` after `CLAUDE.md` grew from ~6k to ~31k
tokens and became 85 % of every session's per-turn floor.

`CLAUDE.md` keeps every imperative rule, every command block, every `CLAIM` line, the roster, the brief
and changeset lifecycle and the Clock Contract. **This file is the verbatim text those rules were
compressed from** — the measured incidents ("measured 2026-xx-yy"), the PRs each rule cost, and the
"this sentence used to say" corrections. A rule in `CLAUDE.md` points here with `why → RATIONALE §x`.
Read the pointer's section when a rule looks wrong, arbitrary, or worth relaxing: the case that made
it is here, with its numbers. **Nothing in this file overrides `CLAUDE.md`; on a conflict, `CLAUDE.md`
wins and this file is stale.**

Sections are copied one-for-one, under their original headings, in `CLAUDE.md`'s original order, so a
reviewer can diff the compression against the source. Moved in three PRs (2026-09-26): §👥 first.

---

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
| **Wren** | — (created 2026-09-05) | vigil | resident on the capture box — box-local measurement + capture-host work; persists across reboot via a user systemd unit (`claude-wren.service` + linger, tmux `wren`). Deploys/daemon restarts remain owner-authorized. The box holds no gh/push credentials, so its branches land through a relay (`Fleet-Session: Wren (relay: <Name>)`) — a property of the lane, not a temporary state |

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

⚠️ **THE SAME SELF-MATCH KILLS, and none of the three remedies above apply to it** (residues
`2026-09-05-pgrep-selfmatch-kills-too` · `2026-09-13-kill-selfmatch-needs-no-process-tool`). Everything
above is the WAITING consequence — a shell that hangs on itself. The identical premise has a second
consequence that is **immediate rather than eventual, and destroys the acting process instead of hanging
it**: any LIST-THEN-ACT command whose own text contains the pattern it matches will act on itself.
Measured five times on two machines, in five forms that each read as a different bug:

```sh
pkill -f storm-watch.sh                                        # ← killed the shell running it
for p in $(pgrep -f nrf_sniffer_ble); do kill $p; done          # ← same
case "$cmd" in *"timeout -s INT"*) kill …;; esac                # ← a shell CASE LABEL — no process tool at all
grep -l <worktree-path> /proc/*/cmdline | … | xargs -r kill     # ← a /proc scan, rig-x870, exit 144
pgrep -f 'SLOT FREE' >/dev/null && echo alive                   # ← list-then-REPORT: "alive: yes" about nothing
```

The tell is **exit 144 (128 + SIGTERM) on your own tool call**, ending before the kill list was applied
— on vigil it left an O2Ring capture stopped and four `storm-watch.sh` instances racing one serial port.
The third and fourth forms are the instructive ones: **the invariant is not about `pgrep`/`pkill`.** The
text need only APPEAR in the command line — as a case label, a grep argument, anything — for the
scanning shell to be in its own result set. The bracket trick, owning the PID and the sentinel file are
all remedies for *waiting*; a kill list has no PID to own and no sentinel to wait on.

**The discipline is two commands, and the second contains NO pattern:**

```sh
pgrep -af '<pattern>'            # 1 · LIST. Read the output. Decide. (This command may match itself — harmless.)
kill 41233 41240                 # 2 · ACT on NUMERIC PIDs, in a command line that carries no pattern at all.
```

Never fuse them. A one-liner that lists and kills is in its own list by construction; the recoveries
both rows record were exactly this split, and worked first time. Cross-session (§1) makes it worse, not different: the
list may also contain a peer's gate, which is why `kill-only-owned-pids` (§4c) is read BEFORE step 2.

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

### 4c · A GATE THAT DIES WITH NO VERDICT IS NOT YOUR DIFF — detach anything over ~100 s

§4 and §4b are about a check that reported the wrong answer. This is about one that reports **no**
answer: a long run is SIGKILLed mid-suite, the task ends with no exit code and no failing test, and it
reads like the gate hanging on your change. It is not — it is the **Claude Code harness watchdog**
reaping harness-tracked background tasks when the BOX is low on memory. Measured 2026-09-13 across
three sessions in one afternoon: **five** deaths — `check.sh` at 106 s and 40 s against a completed
464 s run of the same command minutes earlier, and `verify-fixtures` twice, once at group 126/594.

Three things that cost the fleet an afternoon to establish, so you do not have to:

- **A `MemoryMax` cgroup cap does NOT protect you.** One of the killed runs was single-threaded under
  `MemoryMax=8G/MemorySwapMax=0`. The watchdog reads the box, not the cgroup. Capping is false comfort;
  **`setsid nohup <gate> > log 2>&1 &` plus an `EXIT=` sentinel is the only shape that survived** — the
  same prescription §4 gives for a different reason.
- **Rule out the kernel with `journalctl -k`, NEVER `dmesg`.** `dmesg` on rig-x870 returns
  `read kernel buffer failed: Operation not permitted`, so its silence is an unreadable source, not a
  negative (§4b's family). `journalctl -k` is readable and carries 63 historical OOM kills — that is the
  positive control proving the instrument can see them, which is what makes "zero in the window" a real
  negative.
- **Load alone is NOT this.** Contention makes an 8-minute gate take 30; it does not stop it at 43 %. A
  death at an arbitrary time with no verdict means something signalled. (A death at exactly 114 s or
  600 s is the tool timeout instead — a different thing, §4's arithmetic tell.)

⚠️ **And the memory pressure may be nobody's session.** That afternoon it was
`tepna-nightly-triage.service` — a systemd **user timer**, 10.4 GB resident, running `mutate.mjs
--jobs 16` for 2 h 31 m. Two sessions independently blamed each other from a `ps -eo pid,ppid` walk,
because every session's cwd is the shared root and one hop up lands on `mutation-crawl.mjs`, *the same
tool a session would run*. **Read `/proc/<pid>/cgroup`, and walk the ppid chain to the TOP** — an
`app.slice/<unit>.service` is a timer, a `tmux-spawn-….scope` is a session. Stopping one hop early
produces a confident wrong attribution, and `kill-only-owned-pids` cuts both ways: a timer unit is the
owner's, not yours.

⚠️ **THAT ATTRIBUTION IS INCOMPLETE, AND THE MISSING TERM IS INVISIBLE TO EVERY `ps` YOU WILL RUN.**
Re-measured 2026-09-14: the timer was ONE term on a box that was **already ~21 GB down before it
started**. `/tmp` here is a **30 GB tmpfs**, i.e. RAM, and it was sitting at **21 GB used** — held by
files that NO PROCESS OWNS and that shrink only when something deletes them. It is reported by `free`
as `shared`, never as any process's RSS, so the whole `ps -eo pid,rss` method both sessions used that
afternoon could not see it even in principle. A single abandoned test directory
(`/tmp/snt_edf_test_sAks1r`, 8.1 GB, zero open handles) outweighed everything the two sessions were
arguing about. **Before blaming a process, run `df -h /tmp /dev/shm` and read `free`'s `shared`
column** — deleting the orphans returned **9 GB** and took MemAvailable from 23 GB to 32 GB, more than
bounding the timer did. ⚠️ Deleting is the owner's call, not yours (§👥.2): check `lsof +D <dir>` first,
because two of those trees were the live cwd of leaked stub servers and one was root-owned firmware
build output that `rm` could not touch anyway.

⚠️ **"A `MemoryMax` cap does not protect you" is about the VICTIM, not the CAUSE — do not read it as
"cgroup caps are useless".** Both halves are true and they point opposite ways: a cap on YOUR gate
cannot save it, because the watchdog reads the box; a cap on the CONSUMER is the only thing that
bounds the box at all, and it is where the fix belongs. And size it to the right quantity — the
triage unit's own cgroup reported `memory.swap.current = **0**`. It never swapped; it EVICTED, by
taking resident memory, and other processes' pages are what landed in swap. So a swap fence on the
consumer would have fenced a mechanism that was not operating, while `MemoryHigh`/`MemoryMax` on it
does the work. A first draft of that fix got this backwards and was corrected only by reading the
cgroup.

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
