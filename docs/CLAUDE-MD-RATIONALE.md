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
reviewer can diff the compression against the source. Moved in three PRs (2026-09-26): §👥 first, then §📌 ∅ 🧾 📏 📜 📚 🎙️ 🧪.

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
- 🔍 **SEARCH BEFORE YOU SIZE OR BUILD — `node tools/doc-search.mjs --read "<the thing>"` (PRIMARY
  DEV MACHINE ONLY — see the warning). `--read` prints the matching chunk of the top three hits
  inline; use it, and READ those chunks — measured 2026-09-26, twice in one day a session read the
  path list and never opened the top hit.** A brief pickup starts with a semantic search, not a grep: grep
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

## ∅ ABSENCE IS NULL — never a number (non-negotiable, owner-reinforced 2026-09-06)

**A value that was not measured is `null`. It is never `0`, never a default, never a sentinel that lives
inside the value's own range — at EVERY layer: capture writer · sidecar · parser · DSP · export · render.**
This was a founding rule of the suite. It was written down twice — the Clock Contract §2.6 (*"a missing
stamp must be visible (null), never fabricated"*) and `parse_live`'s scalars (SpO₂ outside 50–100 → null,
PR outside 20–250 → null) — and both held. **It was never written for the raw waveform bytes**, and that is
where it failed, after two thousand commits: the O2Ring's `_PPG.txt` (2026-09-05, `S8AW2100`) carries
**3048 samples of exact `0` in 149 runs, 105 of them ≥ 10 consecutive, the longest 78 samples (0.62 s)**,
against a modal baseline of 114–119, sitting INSIDE complete 127-sample frames — in-band blanking, not a
delivery gap. No consumer guards it (`PPG_INVALID` is an alias for the `156` beat marker — a name that
sounds like the guard and is a different thing). Every fixture reproduced the zeros faithfully because
that is what was on disk, so every gate was green. Owner, on finding it: *"zero appearance in data for
compute is reprehensible … this is absolute priority for everyone because it breaks basic."*

What the rule means when the sentinel is IN-BAND, which is the case the two earlier statements never had
to face:

- **A consumer cannot null what it cannot distinguish.** `0` is a legal u8. So the fix is never a
  `!= 0` in a DSP — that invents a sentinel and convicts every stream where zero is a real value (ECG µV
  crosses zero on every beat; an ACC axis rests at 0 mG). **Validity must travel OUT-OF-BAND**: the
  emitter, or the capture path, or an end-of-night back-check records *where the signal was absent* in a
  **sidecar** (a span list is orders of magnitude smaller than the data), and consumers read the sidecar.
- **Captured bytes are immutable.** A recording is evidence; it is never rewritten to "fix" it, not even
  to replace a fabricated `0` with a null. Correction lives beside the file, dated and attributed.
- **Detection is distributional, not a literal.** The test that finds fabricated absence is a run-length
  signature against the stream's OWN value distribution — a pleth does not sit at exactly one value for
  78 samples — and it must run **on every device, from day 1 of the corpus**, and then stand as a
  tripwire that reds the day a new stream first carries it. A hardcoded `!= 0` fixes zero and misses the
  next sentinel (an in-range value can do the same thing); a rule that flags deliberate working behaviour
  is the wrong rule, not a finding. **Key on RUN LENGTH, never on value membership** (Heron,
  2026-09-06, independently on a second file of the same night: 2738 zeros in 125 runs ≈ 22 per run,
  versus the ring's `156` beat markers — 5455 of them in 5405 runs, singletons by construction). A
  value-keyed detector would flag every beat marker as corruption and bury the real signal 2:1; run
  length separates the two populations by itself and generalises to the next constant nobody has met.
- **An output computed over absent input reports the absence.** A metric over a window that contained
  blanking carries its coverage (`n`, the excluded span) or is itself `null`. A number that is computable
  from fabricated input and carries no information is the zero one layer up.
  🔴 **WHICH of those two — owner ruling 2026-09-17, and it is now a RULE rather than a choice:**
  **a DISCONTINUITY refuses; reduced COVERAGE annotates.**
  - **Discontinuous or absent input → `null` + a named reason.** A clock seam, a blanking run, an
    absent span: the window does not describe one stretch of signal, so no number over it means
    anything. Name the real state — `clock-seam`, not a borrowed reason that happens to fire.
  - **Merely reduced coverage → the value, with `n` / the covered span beside it.** Dropouts and short
    windows leave the signal *sparse*, not *discontinuous*, and refusing them would null a large share
    of real nights (the Verity alone recorded 24 dropout segments in one corpus night).
  - **The line is whether the window still describes ONE continuous stretch of signal**, not how much
    of it is missing — a 120 s dropout keeps a metric, a 0.6 s clock seam does not.
  ⚠️ This codifies what already shipped rather than changing it: PpgDex refuses a seam with
  `clock-seam` (#2600) and F10 refused before it. The measured argument for the refusal half is that
  the annotate-everything alternative was *tried by accident* — with the seam removed from the axis but
  no seam-keyed guard, `ppiConf` came back `[1,1,1,…]` across an 86-second clock discontinuity: a
  number computable from broken input, carrying no information, reporting no problem. That is this
  section's own failure one layer up.
  ⚠️ **It is a data-loss trade, taken deliberately and ONLY for the discontinuous case.**
  `BLE-TRANSPORT-REDESIGN` §1.7 declined the same trade for adapter leases and was right to: there the
  alternative was losing a night's CAPTURE, here it is declining to publish a meaningless number.
  Do not generalise this ruling into "refuse when in doubt".
- **Ask "the device emitted it" vs "our path manufactured it" BEFORE proposing the remedy.** They are
  different fixes with different blast radii. For the O2Ring this is CUT (Wren, 2026-09-06): **the ring
  emits the zeros** — `oxyii.py:838` returns `payload[26:26+n]` untransformed and `capture.py:4293` writes
  `v` straight through; no default, no fill, no failure path yields 0. So the bytes are a faithful record
  and the missing thing is the interpretation layer, which is exactly why the sidecar is the remedy and
  not a compromise. ⚠️ That does NOT establish what `0` means *to the ring* (LED off, ADC underflow, a
  deliberate sentinel) — the distribution says it is not signal, not what the device meant; that needs
  vendor documentation or a controlled finger-off capture, a separate unit. Fit no story to the signal
  before cutting it.

**The mechanism is pending the owner's review** (all-hands 2026-09-06: survey every device → sidecar
proposal → fix after review → refold → check which goldens and which PAT numbers moved → prevention on
the fly with an end-of-night back-check). Nothing in this section authorises a fix to land before that
review. What it authorises — requires — is that **no new writer, parser, DSP or export ever again
represents "not measured" as a number**, and that a reviewer who sees a `0` default, a `?? 0`, a
`.get(k, 0)` or a zero-filled buffer standing in for absence reads it as the bug this section records.
Same family as §🔒 §2.6 (stamps), §🎫's "never upgrade a badge on prose" (authority), and §4b's "reported
success about something it never examined" (gates): a fabricated value, a fabricated tier, a fabricated
pass — all one shape.

## 🧾 VERDICTS ARE MACHINE-READABLE — prose is explanation, not the API (owner, standing requirement 2026-09-21)

**Every gate, oracle, audit, harness or study that decides something emits ONE JSON object of a fixed
shape beside its prose** — `tepna.verdict/1`, defined once in `verdict.js` and specified in
`briefs/VERDICT-CONTRACT-2026-09-21-BRIEF.md`. The owner's framing, verbatim: *"A human can determine the
truth from the evidence, but a downstream machine cannot reliably distinguish PASS / FAIL / NOT RUN / NOT
APPLICABLE / UNDERPOWERED / SHORTFALL / UNKNOWN without parsing prose. That is dangerous. … Then prose
becomes explanation, not the API."* The sealed-night reader (`CAPTURE-NIGHT-SEAL`) will be an independent
consumer of this suite's verdicts; a clinician or a machine must never regex a paragraph to decide whether
evidence is trustworthy.

```json
{ "schema": "tepna.verdict/1", "gate": "oracle-ecg-firmware-rr", "status": "PASS",
  "population": { "checked": 52, "eligible": 52, "excluded": 0 },
  "criterion": { "name": "rr_delta_median", "threshold": 8, "unit": "ms", "direction": "lte" },
  "result": { "median": 0.45 }, "evidence": ["tools/oracle-ecg-firmware-rr.mjs"], "reason": null,
  "producedBy": { "tool": "tools/oracle-ecg-firmware-rr.mjs", "commit": "3c0dbdec" }, "at": "2026-09-21T18:40:12Z" }
```

- **`status` is a closed enum of EXACTLY seven** — `PASS · FAIL · SHORTFALL · UNDERPOWERED · NOT_RUN ·
  NOT_APPLICABLE · UNKNOWN`. `NOT_RUN` (nothing examined) and `NOT_APPLICABLE` (examined; rule does not
  bind) are different states and both read as green to a naive reader — which is why they are named.
- **`population` is an equality** (`checked + excluded = eligible`); a `PASS` over `checked: 0` is invalid
  by schema — §4b's examined-nothing shape refused at the type level. A `PASS` with empty `evidence` is
  invalid. Every non-`PASS` carries a `reason`; `PASS` carries none.
- **`criterion` is pre-stated** (threshold, unit, direction written before the measurement); a threshold
  derived from the data it judges is `UNKNOWN`, not `PASS`.
- **Prose stays** — tables, bands, explanations are for humans. The object is what the next tool reads.
  Never the reverse: a verdict that exists only as a sentence is the defect this section records.
- **Adoption is a named set with a gate**, not a sweep (`PARTIAL-ADOPTION-DETECTION`): a tool that prints
  a status word and is not in the set is a red with the tool's name.

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
(device `VERITY-01`), 2026-06-10 → 2026-07-05, **CLAIM trioEligibleNights = 20 FROM analysis/tri_device_nights.json#count eligible nights** (~10 with clean Verity). It is
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
- **Under the capture-host mutation gate a hand-advanced `while` index TIMES OUT, not fails** — a
  mutant that flips `i += 1` to `i -= 1` or `i < n` to `i <= n` loops forever, mutmut reports it
  UNDECIDED, and `mutate_diff` REFUSES the run (exit 2; under `--report-only` the refusal is printed
  FIRST and marked BLOCKING). Write scanners as `for … in enumerate(…)` or through a tokenizer, never
  as a `while` over a hand-moved index. Measured 2026-09-26: six ~10-minute runs spent reading the
  refusal as advisory.

---
