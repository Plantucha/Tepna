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

**Several agent sessions work this repo at once. The working tree is not yours.** Files you did not
create may be sitting in it, uncommitted, and may be the only copy in existence. Every rule below was
written after it went wrong — the incidents live in `docs/CLAUDE-MD-RATIONALE.md` §👥 (cited below as
*why → RATIONALE §👥.n*).

### 0 · The fleet roster — names, lanes, and the `Fleet-Session:` trailer

Sessions carry arbitrary, stable identities; role and machine are metadata that change **in this
table**, never in the name (*why → RATIONALE §👥.0*).

| session | was (pre-2026-08-31) | machine | lane (mutable — update this row, not the name) |
|---|---|---|---|
| **Kestrel** | Mutator | rig-x870 | coordinator / owner's deputy |
| **Heron** | Vigil box | vigil | capture-host + box ops. Deploys to vigil are **owner-authorized only**; a peer relay never changes that boundary |
| **Osprey** | Papers | rig-x870 | mutation program + analysis |
| **Magpie** | Brief runner | rig-x870 | JS surface + sweeps |
| **Finch** | windows | roaming (bridge) | special-collab / hardware RE, engaged on-demand |
| **Wren** | — (created 2026-09-05) | vigil | resident on the capture box — box-local measurement + capture-host work; persists across reboot via a user systemd unit (`claude-wren.service` + linger, tmux `wren`). Deploys/daemon restarts remain owner-authorized. The box holds no gh/push credentials, so its branches land through a relay (`Fleet-Session: Wren (relay: <Name>)`) — a property of the lane, not a temporary state |

- **`Fleet-Session: <Name>` goes in every commit message and PR body** — forward-only from 2026-08-31;
  never backfill a merged PR.
- **The trailer is a CONVENTION, not a MECHANISM.** It is self-declared and unverified. Never reason
  "the trailer says X, therefore X did it"; real attribution needs per-session credentials (owner
  decision, pending).
- **TRIAGE STAMPS THE BRIEF.** Whoever triages a brief writes the verified state into its status header
  IN THE SAME SESSION, in the form `PROPOSED (core BUILT, remainder X-blocked — verified YYYY-MM-DD: …)`.
  A triage that leaves the header untouched has thrown away its own product.

### 1 · Work in your own worktree. This is the fix.

```sh
git worktree add ../wt-<task> -b claude/<task> origin/main
```

A private checkout off `origin/main`: you cannot sweep, destroy, or **gate against** someone else's
half-finished code (*why → RATIONALE §👥.1*). **Always worktree when you will touch a bundle, a ledger,
or a DSP.** A one-file doc edit in a clean tree needs none.

### 2 · Never blanket-stage, never destroy a tree you didn't dirty

- **Stage by EXPLICIT PATH.** No `git add -A`, no `git add .`, no `git commit -a`.
- **`git status` before every commit.** Files you don't recognise? **Leave them.**
- **Never** `git reset --hard` / `git checkout .` / `git restore .` / `git stash` / `git clean -f` on a
  tree you did not dirty.
- **Never move a branch ref by hand** — `git update-ref refs/heads/<b>`, `git branch -f`,
  `git push . <src>:<b>`. If that branch is checked out anywhere, the ref advances and the tree does
  not, and every file a merged PR added reads as `deleted` (*why → RATIONALE §👥.2, §👥.2b*). You
  almost never need a local branch ref; if one must advance, do it *in the checkout that holds it*:
  `git -C <checkout> merge --ff-only origin/<b>`.
- **`git rev-list --count main..origin/main` = 0 does NOT mean the checkout is synced** — only the
  ref is. Measure the TREE: `git -C <checkout> status --short`.
- Found **finished, uncommitted work** that isn't yours? Snapshot it, don't step on it:
  ```sh
  cp .git/index /tmp/r.idx
  TREE=$(GIT_INDEX_FILE=/tmp/r.idx sh -c 'git add -A; git write-tree')
  git branch rescue/$(date +%F)-wip $(git commit-tree $TREE -p origin/main -m 'rescue: WIP snapshot')
  ```
  Then tell the user. Do **not** merge it.

**Hook-enforced** by `.claude/hooks/guard-shared-tree.sh` (wired in `.claude/settings.json`). Escape
hatch when the tree is genuinely yours alone: `CLAUDE_ALLOW_BLANKET_GIT=1`.

### 2b · THE REF IS NOT THE TREE

- **`git update-ref refs/heads/main refs/remotes/origin/main` is forbidden here.** It is the one form
  that skips git's checked-out-branch check; `git fetch origin main:main`, `git branch -f` and
  `git push .` all refuse by name when the branch is checked out.
- **To sync:** `git fetch origin main:main` and let it refuse — better, work in a worktree off
  `origin/main` so local `main` never needs syncing.
- **To CHECK a tree is in sync, measure the TREE** (`git status --porcelain`), never the ref count.
- **Detector:** `tools/commit-shape.mjs` (`npm run check` as `verify:commit-shape`, and the CI `static`
  job). A commit deleting a changeset without a release-ledger update, or deleting anything outside
  `changes/` alongside one, is not a release. Exemption is by **declared provenance** (`Revert `,
  `rescue:`), never by shape. It **refuses (exit 2) on a shallow clone**; CI's `fetch-depth: 0` is
  load-bearing (*why → RATIONALE §👥.2b*).

### 2b-bis · "HOOK-ENFORCED" means *Claude Code, in a checkout that pulled it* — nothing wider

The guards are `PreToolUse` hooks resolved through `$CLAUDE_PROJECT_DIR`; `.git/hooks/` holds samples
and `core.hooksPath` is unset. A second agent, a human at a terminal, or the GitHub web UI inherits
none of them, and a guard merged to `main` protects nobody in a tree that has not pulled it. A git
`pre-commit` hook is not the fix (declined; see RATIONALE §👥.2b-bis). Prevention is agent-coupled;
**detection can be agent-neutral**, which is why these are CI checks:

| invariant | agent-neutral enforcement |
|---|---|
| blanket-add / ref-move corruption | `tools/commit-shape.mjs` — `npm run check` + CI `static` job |
| stale-brief overwrite | `.github/workflows/stale-file.yml` — a REQUIRED context |
| §2c rebase silently reverting source | **none — not mechanically decidable.** Prevention only |

⚠️ **`stale-file` has no escape hatch, deliberately.** Rebasing IS the hatch: it advances the
merge-base and forces you to read the upstream commits first. Full reasoning:
`briefs/AGENT-NEUTRAL-GUARDS-2026-08-15-BRIEF.md`.

### 2c · REBASING: `git checkout <ref> -- <conflicted>` reverts source SILENTLY — use `rebase-safe`

You will rebase: `main` moves every review cycle, and the two orchestrator bundles are re-bundled by
any inlined change, so PRs sharing no source still collide in them. **Never**
`git checkout origin/main -- $(git diff --name-only --diff-filter=U)` — correct for a generated
artifact, destructive for a source file, and the two are mixed in one conflict list; it fails
silently (*why → RATIONALE §👥.2c*).

```sh
node tools/rebase-safe.mjs            # fetch → rebase → auto-resolve generated → rebuild → verify
node tools/rebase-safe.mjs --onto <ref>
```

- **Generated** (auto-resolved, then rebuilt): the 9 provenance bundles + the 2 orchestrators
  (`manifest-gate.js MANIFEST_BUNDLES` + `build.mjs ORCHESTRATORS`), the 10 analysis tools
  (`build-analysis.mjs TOOLS`), `docs/**`, `provenance/**`. The set is **read from the builders**,
  never globbed; if a builder's list cannot be read the tool treats everything as source and fails closed.
- **Source** (it STOPS and aborts): everything else — every `*.js`, every `*.src.html`, authored
  guides, `uploads/` goldens, `tests/dex-tests.js`.
- ⚠️ **`tests/dex-tests.js` conflicts on nearly every parallel PR.** Restore `main`'s copy and
  **re-run your insertion**; never keep one side wholesale.
- ⚠️ **After ANY rebase, verify your own change survived before pushing:**
  `git show HEAD:<file> | grep -c <an identifier your change adds>`.

**Hook-enforced** (`guard-shared-tree.sh` denies `git checkout <ref> -- <source path>`; generated
paths pass). Deliberate single-file restore: outside a rebase, one explicit path, verify afterwards.

### 2d · TWO SESSIONS WILL DERIVE THE SAME BRANCH NAME — a plain `--force` destroys the other's PR

Branches are named after the fix, so one defect yields one slug and two sessions on one defect is the
normal case. No hook can see a name on `origin` another checkout is about to use
(*why → RATIONALE §👥.2d*).

- A **plain `git push` REJECTED as non-fast-forward** on a branch you believe is yours is the warning
  — **never force past it**; find out who owns the name first.
- **`--force-with-lease`** refuses when the remote carries commits you have not seen. **Never a bare
  `--force` against `origin`.**
- A **per-session suffix** — `claude/<task>-<3 chars>` — prevents the collision; the lease prevents the loss.
- Before any force-push: `git log --oneline -1 origin/<branch>` and
  `git log --format='%an' origin/<branch> -3 | sort -u`.

### 3 · Bundles and ledgers must be SERIALIZED — a worktree does not save you here

Ledgers are per-app **`provenance/<App>.json`** fragments (each owns that app's GATE-A `manifestHash`
+ GATE-B fixtures), reassembled by `provenance-ledger.js`; single-app re-bundles no longer collide.
What is still shared: a **spine module inlined into many bundles** moves every carrying app's
`manifestHash` at once.

| module | bundles carrying it |
|---|---|
| `kernel-constants.js` · `metric-registry.js` · `dex-export.js` | **8 of 8** |
| **`clock.js`** | **5 of 8** — absent from **PpgDex · GlucoDex · CPAPDex**, where `DexClock` is `undefined` at runtime |

- Those three ship without the spine **on purpose** (§✅ names their deliberate node-local variants).
  **Before delegating anything in a `*-dsp.js` to `DexClock`, check that bundle carries it**
  (`grep -c 'data-inline-src="clock.js"' <App>.html`); an unguarded alias throws at module evaluation,
  which only `browser-gates` can see, and guarding it converts the crash into a silent disablement
  (*why → RATIONALE §👥.3, PR #1232*).
- **A shared-spine change still serializes** — 8 fragments for the three universal modules, 5 for
  `clock.js`. Say so before you start, and land it **before** node-local work.
- Landing second? **Rebase, re-run `node tools/build.mjs --app <App>`** (it auto-writes the manifest
  hash and re-stamps fixtures), then re-run the gates.

### 4 · NEVER wait on a process by command name — `until ! pgrep -f "<cmd>"` waits on ITSELF

```sh
until ! pgrep -f "pytest -q --cov"; do sleep 20; done      # ← NEVER EXITS
```

The waiter's own command line contains the pattern (self-match), and other sessions run the same
gates (cross-session match). The `[p]ytest` bracket trick defeats only the first
(*why → RATIONALE §👥.4*). In order:

1. **Don't poll.** Run the real command as a background task and let the harness notify you.
2. **Own the PID** — yields the exit code, which `pgrep` structurally cannot:
   ```sh
   pytest … > /tmp/mine.$$.log 2>&1 & PID=$!
   while kill -0 "$PID" 2>/dev/null; do sleep 20; done
   wait "$PID"; echo "EXIT=$?"
   ```
3. **Wait on a sentinel you control** — and the `&` is LOAD-BEARING (without it the loop polls 0 times
   and still prints the right exit code):
   ```sh
   ( pytest … ; echo "EXIT=$?" ) > /tmp/mine.$$.log 2>&1 &
   until grep -q '^EXIT=' /tmp/mine.$$.log; do sleep 20; done
   ```

⚠️ **The same self-match KILLS.** Any LIST-THEN-ACT command whose own text contains the pattern acts on
itself — `pkill -f x`, `for p in $(pgrep -f x); do kill $p; done`, a shell `case` label, a `/proc`
scan piped to `xargs kill`. The tell is **exit 144 on your own tool call**. The discipline is two
commands, the second carrying NO pattern:

```sh
pgrep -af '<pattern>'            # 1 · LIST. Read the output. Decide.
kill 41233 41240                 # 2 · ACT on NUMERIC PIDs.
```

Never fuse them; the list may contain a peer's gate — read `kill-only-owned-pids` (§4c) before step 2.

### 4b · TRUNCATING A RESULT AND READING THE REMAINDER AS THE WHOLE

`| tail -N` makes a gate readable and makes it lie: `pytest … | tail -20` reports **tail's** exit code;
`gh pr checks | tail -15` simply cut two failing checks out of the listing
(*why → RATIONALE §👥.4b*). **If you truncate, you must know the discarded part cannot change the
verdict** — for a gate summary it always can.

- **Never read a verdict off a tail.** Aggregate: `grep -cE '^(FAILED|ERROR)'`,
  `gh pr checks <N> --json bucket --jq 'group_by(.bucket)|map({(.[0].bucket):length})|add'`, a
  `TOTAL`/`Required` line. Tail afterwards for *detail*, never for the answer.
- **Capture `$?` of the command itself, before any pipe.**
- Identify *your own* processes by a token you put in the command line, never by a session id that
  only appears in an output path.

The family — `grep -q` exit codes, `npx` no-op greens, a child's JSON truncated through a pipe —
shares one shape: **the check ran, and reported success about something it never examined.**

### 4c · A GATE THAT DIES WITH NO VERDICT IS NOT YOUR DIFF — detach anything over ~100 s

A long run SIGKILLed mid-suite with no exit code and no failing test is the **Claude Code harness
watchdog** reaping harness-tracked background tasks when the BOX is low on memory
(*why → RATIONALE §👥.4c*).

- **A `MemoryMax` cap on YOUR gate does not protect it** — the watchdog reads the box, not the cgroup.
  **`setsid nohup <gate> > log 2>&1 &` plus an `EXIT=` sentinel is the only shape that survives.**
  (A cap on the CONSUMER is where the fix belongs — `MemoryHigh`/`MemoryMax` on the process that
  evicts; not a swap fence, it never swapped.)
- **Rule out the kernel with `journalctl -k`, NEVER `dmesg`** (unreadable here; its silence is not a negative).
- **Load alone is NOT this.** Contention slows a gate; it does not stop it at 43 %. A death at exactly
  114 s or 600 s is the tool timeout, a different thing.
- **The memory pressure may be nobody's session.** Read `/proc/<pid>/cgroup` and walk the ppid chain
  to the TOP — an `app.slice/<unit>.service` is a timer, a `tmux-spawn-….scope` is a session.
- **`/tmp` is a 30 GB tmpfs, i.e. RAM, and orphaned files there are invisible to every `ps`.** Before
  blaming a process: `df -h /tmp /dev/shm` and `free`'s `shared` column. Deleting is the owner's call
  (§👥.2): `lsof +D <dir>` first.

### 5 · LANDING: `main` moves faster than CI, and it is a DEADLOCK, not a race

`protect-main` sets `required_status_checks.strict = true`: a branch must be **up to date at merge
time**, and GitHub's auto-merge does NOT update it. An armed, green, BEHIND PR **never merges on its
own** — waiting has zero probability of success (*why → RATIONALE §👥.5: 14 PRs sat a full day*).
PRs therefore merge **strictly sequentially**:

> **update ONE green PR → let it merge → update the next.**

- **If you have anything to push anyway, `git merge origin/main` locally and push ONCE** — one head,
  one CI run.
- **The cadence lever is bigger than the polling lever:** (1) one PR per work-unit, not per increment;
  (2) run the full gate ONCE, on the final state — a `-k`/`--group=` filter that matches nothing
  reads exactly like a pass; (3) push BEFORE writing the changeset and PR body; (4)
  `gh pr update-branch` when nothing generated is in the diff, `rebase-safe` when bundles/`docs/`/
  `provenance/` are (mandatory, §2c).
- **Do not hand-write the polling loop.** Use:
  ```sh
  node tools/queue-doctor.mjs --dry-run   # what is green-and-stuck right now
  node tools/land-pr.mjs <PR#>            # keeps the branch current, merges the moment it can
  node tools/land-pr.mjs <PR#> --dry-run
  ```
  `land-pr` distinguishes `BEHIND` (update) · `BLOCKED` with runs in flight (wait) · `UNKNOWN`
  mergeability (wait) · a required context never reported (stop). A failing check outranks all.
- 🟢 **Kodiak runs this loop** (`.kodiak.toml`, `require_automerge_label = false`): every non-draft PR
  without a `do-not-merge` label sits in its serial queue; it updates the front PR, waits for CI,
  merges, repeats. A PR BEHIND while the front is mid-CI is **serialising, not stalling** — leave it.
  To HOLD a PR: mark it Draft or label `do-not-merge`. `queue-doctor`/`land-pr` remain the fallback.
- **A merge queue is NOT available**: it is an organisation-repository feature and Tepna is user-owned
  (verified three ways). The question is ownership, not throughput.

### 5b · COLLECTING PRs (owner-ratified)

- **WIP cap: ≤ 4 open non-draft PRs repo-wide.** A finished work-unit WAITS for a slot.
- **`gh pr update-branch` is a purchase, not a swap** — check the pool first:
  `gh pr list --state open --json statusCheckRollup --jq '[.[].statusCheckRollup[]?|.status]|group_by(.)|map({(.[0]):length})|add'`
- **Collect when the pool has drained AND (`pend=0` OR demonstrably wedged) AND every required check
  has a terminal SUCCESS/SKIPPED conclusion** — a *cancelled* required check reads as `pend=0` with an
  empty conclusion. Count conclusions, never pendings.
- **"Wedged" is judged ONLY against that workflow's own history**, never siblings. **Never supersede a
  queued `tests` run under ~3 h.**
- **Remove your worktree when the PR merges — `node tools/wt-done.mjs <path>`**, one named path per
  invocation, never a glob (*why → RATIONALE §👥.5b: 329 orphaned trees ≈ 55–60 GB*).

---

## 📌 Brief lifecycle — date NEW filenames at creation; mark DONE in the HEADER, never rename (non-negotiable)

**All briefs live in `briefs/`.** A brief's filename is FROZEN once created (cross-referenced by exact
name everywhere); never rename or move one to mark status. Status lives in a one-line header on the
first content line after any SPDX comment (*why → RATIONALE §📌*):

```
**Status:** PROPOSED | IN-PROGRESS | DONE — YYYY-MM-DD · **Created:** YYYY-MM-DD
```

- **New brief:** `briefs/<NAME>-YYYY-MM-DD-BRIEF.md` (append `-HHMM` only for a same-day twin) with the
  same date as `Created:`. The date is a creation marker, never a status marker.
- **Executed brief:** flip the header to `Status: DONE — <today>` only when every acceptance item is
  met AND the gates pass (`Dex-Test-Suite.html` all-green, `verify-provenance.html` clean where it
  applies). Never stamp DONE on unverified work.
- **Residue goes to `briefs/RESIDUE.md` as ONE ROW per verified defect, never a new `-FOLLOWUPS-`
  brief** (owner-ratified 2026-09-02). Row: `| <key> | logged | source brief | defect | evidence | state |`,
  key **`YYYY-MM-DD-short-slug`** (never a counter — allocating a unique id from local information has
  no correct procedure), and the source brief's `Status:` line gets `**Residue:** <key>`
  (gate-backed, `docs-ledger` check 8: both directions resolve, exactly 6 cells, state vocabulary). A
  `-FOLLOWUPS-` brief is created **only by the session that picks a row up** (remainder ≥ one work-unit)
  and closes the row (`→ \`<NAME>-BRIEF.md\``); a one-PR fix closes it as `fixed #NNNN`. Rows are
  appended and closed, never edited or deleted. A residue with no parent brief names its real origin —
  a repo path or a `#PR` — never the nearest brief. If nothing surfaced, say so in the brief's header.
- **Non-executable docs** use `Status: REFERENCE (living …)` or `Status: CHECKPOINT (living …)` with a
  `last-verified` date.
- **The status vocabulary is EXACTLY five:** PROPOSED · IN-PROGRESS · DONE · REFERENCE · CHECKPOINT.
  Park a brief as `**Status:** PROPOSED (deferred YYYY-MM-DD — …)`; `§N DEFERRED` inside a DONE brief
  is fine; a bare `DEFERRED` header reds `docs-ledger` (check2a).
- **One brief replacing another:** `Superseded-by: <NAME>` on the old, `Supersedes: <NAME>` on the new
  (the ADR/RFC convention).
- **`DOCS-INDEX.md` is the dashboard** — keep its status table in sync; reorganise the view, never the
  files (no `Done/` sub-folders).
- 🔍 **SEARCH BEFORE YOU SIZE OR BUILD — `node tools/doc-search.mjs --read "<the thing>"`** (owner-mandated
  standing pickup step, 2026-08-26). Read the top three hits before sizing a unit or writing a line;
  grep finds only your own vocabulary. `--read` prints the top three chunks inline, which is cheaper
  than three file opens. ⚠️ **PRIMARY DEVELOPMENT COMPUTER ONLY** — a loopback bge-m3 model + a local
  ~14k-chunk index, neither shipped with the repo. Fresh clones and CI fall back to `git grep`; no gate
  reads doc-search output; the tool being absent is never an error.
- 🔴 **BEFORE YOU EDIT A BRIEF, CHECK IT HAS NOT ALREADY BEEN ANSWERED** — overwriting one produces no
  merge conflict (*why → RATIONALE §📌: twice in one day on GENERATOR-FOLLOWUPS-III*):

  ```sh
  git fetch origin main
  git log --oneline $(git merge-base HEAD origin/main)..origin/main -- briefs/<NAME>-BRIEF.md
  ```

  Non-empty ⇒ read those commits (`git log -p …`), then `node tools/rebase-safe.mjs` so your edit lands
  on top of them. **Hook-enforced** by `.claude/hooks/guard-stale-brief.sh` (PreToolUse on `Edit|Write`,
  covers `briefs/*.md` + `DOCS-INDEX.md`, reads your LOCAL `origin/main` and never fetches — so the
  `git fetch` above is part of the rule). Escape hatch `CLAUDE_ALLOW_STALE_BRIEF=1`: as a prefix on a
  Bash command, or **exported** — the only form that reaches an `Edit`/`Write`. A brief edit that
  rebases cleanly against a brief that moved is the signature of the bug, not reassurance.
- **Gate-backed** by the `docs-ledger` group in `tests/dex-tests.js` (Node lane only): stray root
  brief, malformed/absent status header on a brief dated ≥ 2026-07-03, unindexed brief, dead relative
  link in `DOCS-INDEX.md`, one-sided supersede pair, filename↔`Created` mismatch all red the suite.
  Pre-2026-07-03 headerless briefs are grandfathered (never fabricate a status). There is no committed
  list to regenerate.
- **Repo layout (owner-sanctioned 2026-07-03).** Root holds ONLY base/entry docs (`README.md`,
  `CLAUDE.md`, `ARCHITECTURE-PRINCIPLES.md`, `ORIENTATION.md`, `DOCS-INDEX.md`, `CONTRIBUTING.md`,
  `AUDIT-PROMPT.md`), standard OSS files, and **all runtime/build files** (`*.js` / `*.html` /
  `*.src.html` / `*.css` / `*.json` — load-bearing paths, NEVER move them). Archival docs live in
  **`briefs/`** (work-plans), **`audits/`** (findings, reviews), **`docs/`** (specs, derivations,
  lexicons, deploy/privacy statements). **`ORIENTATION.md` MUST stay in root** (the roster gate fetches
  it). A truly dead doc goes to `docs-archive/` deliberately, with a redirect stub.

## ∅ ABSENCE IS NULL — never a number (non-negotiable, owner-reinforced 2026-09-06)

**A value that was not measured is `null`. Never `0`, never a default, never a sentinel inside the
value's own range — at EVERY layer: capture writer · sidecar · parser · DSP · export · render.** The
Clock Contract §2.6 and `parse_live`'s scalars always said so; the raw waveform bytes did not, and the
O2Ring's `_PPG.txt` shipped 3048 exact zeros in 149 runs inside complete frames through every green
gate (*why → RATIONALE §∅*). Owner: *"zero appearance in data for compute is reprehensible."*

- **A consumer cannot null what it cannot distinguish.** `0` is a legal u8, so the fix is never a
  `!= 0` in a DSP (ECG crosses zero every beat; an ACC axis rests at 0). **Validity travels
  OUT-OF-BAND** — a sidecar span list written by the emitter, the capture path, or an end-of-night
  back-check; consumers read the sidecar.
- **Captured bytes are immutable.** A recording is evidence, never rewritten. Correction lives beside
  the file, dated and attributed.
- **Detection is distributional — key on RUN LENGTH, never on value membership.** A pleth does not sit
  at one value for 78 samples; a value-keyed detector would flag every `156` beat marker (singletons by
  construction) and bury the real signal 2:1. Run it on every device from day 1 of the corpus and keep
  it as a tripwire.
- **An output computed over absent input reports the absence.** 🔴 Owner ruling 2026-09-17, a RULE:
  **a DISCONTINUITY refuses; reduced COVERAGE annotates.**
  - Discontinuous or absent input (clock seam, blanking run, absent span) → `null` + a named reason
    (`clock-seam`, not a borrowed reason that happens to fire).
  - Merely reduced coverage (dropouts, short windows) → the value, with `n` / the covered span beside it.
  - **The line is whether the window still describes ONE continuous stretch of signal**, not how much
    is missing — a 120 s dropout keeps a metric, a 0.6 s clock seam does not. This codifies what
    shipped (PpgDex `clock-seam`, #2600; F10). It is a data-loss trade taken ONLY for the
    discontinuous case — do not generalise it into "refuse when in doubt".
- **Ask "the device emitted it" vs "our path manufactured it" BEFORE proposing the remedy** — different
  fixes, different blast radii. For the O2Ring the ring emits the zeros (cut by Wren 2026-09-06), so
  the sidecar is the remedy; what `0` means *to the ring* is a separate unit needing vendor docs or a
  controlled finger-off capture. Fit no story to the signal before cutting it.

**The mechanism is pending the owner's review** (all-hands 2026-09-06). Nothing here authorises a fix
to land before it. What it requires: **no new writer, parser, DSP or export ever represents "not
measured" as a number**, and a reviewer reads a `0` default, a `?? 0`, a `.get(k, 0)` or a zero-filled
buffer standing in for absence as this bug. Same family as §🔒 §2.6 (stamps), §🎫's "never upgrade a
badge on prose" (authority) and §👥.4b's examined-nothing gates.

## 🧾 VERDICTS ARE MACHINE-READABLE — prose is explanation, not the API (owner, standing requirement 2026-09-21)

**Every gate, oracle, audit, harness or study that decides something emits ONE JSON object of a fixed
shape beside its prose** — `tepna.verdict/1`, defined once in `verdict.js`, specified in
`briefs/VERDICT-CONTRACT-2026-09-21-BRIEF.md`. A downstream machine (the sealed-night reader, a
clinician's tool) must never regex a paragraph to decide whether evidence is trustworthy
(*why → RATIONALE §🧾*).

```json
{ "schema": "tepna.verdict/1", "gate": "oracle-ecg-firmware-rr", "status": "PASS",
  "population": { "checked": 52, "eligible": 52, "excluded": 0 },
  "criterion": { "name": "rr_delta_median", "threshold": 8, "unit": "ms", "direction": "lte" },
  "result": { "median": 0.45 }, "evidence": ["tools/oracle-ecg-firmware-rr.mjs"], "reason": null,
  "producedBy": { "tool": "tools/oracle-ecg-firmware-rr.mjs", "commit": "3c0dbdec" }, "at": "2026-09-21T18:40:12Z" }
```

- **`status` is a closed enum of EXACTLY seven** — `PASS · FAIL · SHORTFALL · UNDERPOWERED · NOT_RUN ·
  NOT_APPLICABLE · UNKNOWN`. `NOT_RUN` (nothing examined) and `NOT_APPLICABLE` (examined; rule does
  not bind) are different states that both read green to a naive reader.
- **`population` is an equality** (`checked + excluded = eligible`); a `PASS` over `checked: 0` or with
  empty `evidence` is invalid by schema. Every non-`PASS` carries a `reason`; `PASS` carries none.
- **`criterion` is pre-stated**; a threshold derived from the data it judges is `UNKNOWN`, not `PASS`.
- **Prose stays** for humans; the object is what the next tool reads. A verdict that exists only as a
  sentence is the defect.
- **Adoption is a named set with a gate** (`PARTIAL-ADOPTION-DETECTION`): a tool that prints a status
  word and is not in the set is a red with the tool's name.

## 📏 Units — the metric system is superior and is the default (non-negotiable)
**Store and compute in metric, always** — kg, cm, °C, mmol/L (or the clinical metric unit a field
conventionally uses: mmHg, bpm, mL/kg/min, m). The metric value is the single source of truth on every
profile record and in every formula; never persist an imperial number. An **imperial display switch is
permissible** (kg↔lb, cm↔in, m↔ft, °C↔°F) **but metric is the default on first load** and conversion
happens only at the display/input boundary. One metric NORMS table (cited); imperial is a thin
presentation layer over it — no imperial-keyed norm tables, no duplicate formulas.

## 📜 Licensing & attribution — see `licensing/LICENSING-BRIEF.md`
The suite is **Apache-2.0** (author **Michal Planicka**; product brand **Tepna**, replacing the legacy
`GanglioR`/`ANS Intelligence`). Root `LICENSE`, `NOTICE`, `CITATION.cff`, `THIRD-PARTY.md` are
authoritative. Every authored source file carries the SPDX header from `licensing/SPDX-HEADERS.txt`
(`Copyright 2026 Michal Planicka` + `SPDX-License-Identifier: Apache-2.0`) — **no MIT/other license**
survives. User-facing surfaces carry the health intended-use disclaimer (BRIEF §6.5) and a `dxl-` stamp
from `licensing/dex-license.css`. ⚠️ **`Tepna` is the brand; `Ganglior` is the FROZEN event-bus
codename** — never touch `ganglior.*` identifiers, the `ganglior.node-export` schema, or the `fascia` alias.

## 📚 Literature use — see `briefs/LITERATURE-USE-POLICY-2026-07-11-BRIEF.md`
Papers enter in three tiers (formulas/processes · reference statistics/priors · raw datasets) under
three hard lines: (1) **no networked data in a bundle, ever** — a literature value that must reach
runtime is inlined at author time as a cited constant (gate: `no-network.html`); (2) **no fabricated
authority** — a paper-sourced number is `validated`-tier ONLY with a real, checkable citation, else it
keeps the suite's own tier; (3) **attribution is mandatory** — author·year·journal·DOI in the doc + a
source comment in code. Routing: node validation → that node's write-up; paper agenda →
`PAPERS-ROADMAP` + `papers/`; a method that changes code → its own executable brief. (Policy still
PROPOSED; the flip to `REFERENCE` is the owner's.)

**Attribution is GATE-BACKED.** `audits/CITATION-VERIFICATION-2026-08-05.json` records
`firstAuthor`/`year`/`container` per DOI, and the `citation-ledger` group asserts every DOI on a
reader-facing surface (reference guides, `papers/**`, `docs/**.md`, root `*.js`) is surrounded by a
citation naming that author and a year within ±1. `briefs/` is deliberately OUT (a brief quotes a wrong
attribution in order to say it is wrong); DOI *resolution* is out (needs network). When a correct
citation would red — a corporate author, a spacing variant, a record Crossref carries no author for —
add `authorAliases` **and `aliasSource`**: `crossref-variant` (a spelling of what Crossref recorded) or
`from-paper` (Crossref has no author; name read off the paper — marked because it is circular).
`from-paper` on a record that has a Crossref author is a red. **Never silence a finding by editing the
ledger's `firstAuthor`** (*why → RATIONALE §📚: three shipped citations named the wrong author*).

## 🎙️ Capture provenance — how the raw signals are recorded
Raw **ECG** (Polar H10) and **PPG** (Polar Verity Sense) are captured with **Polar Sensor Logger**
(`com.j_ware.polarsensorlogger`), which writes per-stream CSV/TXT (ECG ~130 Hz, PPG/ACC etc.) with its
own timestamp columns — a first-class input format for `ECGDex` and any PPG node. Honor the Clock
Contract when parsing its stamps (regex the explicit format; never `new Date(str)`).

**Per-file honest-HR facts (TRIO-METHODS-REUSE §Do 2).** The Verity onboard `_HR.txt` is **all-zero**
and `_PPI.txt` often header-only — a Verity HR MUST be **derived from raw `_PPG.txt`** via PPGDSP
(3-LED consensus → `buildPPI` → Malik `correctRR`). The H10 device `_HR.txt` is **smoothed** (under-states
σ), so the honest H10 leg is raw-ECG Pan–Tompkins (`ECGDSP.parseECG → bandpass → detectPeaks`) from
`_ECG.txt`. Any comparison or fusion derives HR from the raw waveform, never the onboard summary.

**A real tri-device corpus exists** — O2Ring + Polar H10 (device `H10-01`) + Polar Verity Sense
(device `VERITY-01`), 2026-06-10 → 2026-07-05, **CLAIM trioEligibleNights = 20 FROM analysis/tri_device_nights.json#count eligible nights** (~10 with clean Verity). It is
the ground truth behind the reference-free σ work (`sensor-trio-power-analysis.html` /
`sigma-no-reference-analysis.html`).

## 🧪 Regression gate — run after ANY `*-dsp.js` / `*-cross.js` / `*-app.js` change
**`Dex-Test-Suite.html`** is the canonical gate: the REAL modules + the shared assertions
(`tests/dex-tests.js`, the same suite `node tests/run-tests.mjs` runs) plus a browser-only
render-coverage group. **Render-coverage is ON-DEMAND:** a bare open paints only the headless floor
(~3 s) and the pill reads amber **"headless green — render-coverage not run"** — that is NOT a pass.
For the FULL gate open **`Dex-Test-Suite.html?full`** (or ▶ Run render-coverage), wait ~30–50 s for the
group count to stop climbing, then read `#summary`: **all green** (`window.__rcState==='done'` +
`sameOriginStatus().ok`). A red is a blocker. A cold-boot iframe timeout is a ⊘ SKIP (each rig
retries once): skips are neither pass nor fail, so check `sameOriginStatus().bootSkips` (`[]` when all
booted) if every rig must have run; re-open `?full` to warm the cache.
- **Run it after editing any DSP/app and after re-bundling**, before calling `done`. A live spot-check
  on one file is not a substitute — the suite catches contract breaks an ad-hoc check misses.
- The shared assertions ARE the public contract. To change a signature or return shape, keep back-compat
  (new params LAST + optional; new data via a NEW field) — or update `tests/dex-tests.js` deliberately,
  knowing Node CI uses the same file.
- **Under the capture-host mutation gate a hand-advanced `while` index TIMES OUT, not fails** — the
  mutant loops forever, mutmut reports it UNDECIDED, and `mutate_diff` REFUSES the run (exit 2; under
  `--report-only` the refusal prints FIRST, marked BLOCKING — it is not advisory). Write scanners as
  `for … in enumerate(…)` or through a tokenizer, never as a `while` over a hand-moved index
  (*why → RATIONALE §🧪*).

## 🔏 Provenance gate — run after RE-BUNDLING any `Foo.html`
The ledgers are per-app **`provenance/<App>.json`** fragments (each carries that app's GATE-A
`manifestHash` + GATE-B fixtures) plus `provenance/_meta.json` + `provenance/index.json`;
**`provenance-ledger.js`** reassembles the combined `{ bundles }` / `{ fixtures }` view every reader
consumes, so "`BUILD-MANIFEST.json`" / "`FIXTURE-PROVENANCE.json`" below name the *assembled view* and
edits land in the per-app fragment.

**`verify-provenance.html`** is a **pure-static, content-addressed** gate: it fetches each bundle FILE
+ the ledger fragments and hashes them, boots nothing, reads **no `buildHash`**. GATE-B hashing settles
in ~10 s; read `window.__provenanceOK` / `window.__gateA_ok` / `window.__gateB_ok` — never scan the body.

- **GATE A — bundle code identity.** Every shipped bundle's current **`manifestHash`** must equal the
  value committed in **`BUILD-MANIFEST.json`**. `manifestHash` is the **sole executed-code identity**:
  extract every `data-inline-src` `<script>`/`<style>` block, hash each block's text, form
  `logicalName \0 sha256(assetText)` per block, sort, SHA-256[0:12] the join — deterministic across
  re-bundles of identical source, moving ONLY on a real code change (a legacy gzip+UUID bundle hashes to
  `null`). Computed by `manifest-gate.js manifestHashFromText`, shared with `tests/verify-manifest.mjs`.
- **GATE B — content-addressed known-answer ledger.** Every fixture in **`FIXTURE-PROVENANCE.json`** is
  `hash(input) + executed-code manifestHash → hash(output)`; `reproducible ✓` only while the bundle's
  `manifestHash`, every committed INPUT hash and the committed OUTPUT hash all still match. Core:
  `manifest-gate.js gateBEvaluate`.

⚠️ **`buildHash` is RETIRED as a provenance signal.** Still stamped into exports by
`ganglior-provenance.js` as inert legacy metadata; do not record, compare or reason about it.
`manifestHash` is the only code identity; behavior is gated separately by `Dex-Test-Suite.html`.

### Re-bundle checklist — the tool writes the ledgers

```sh
node tools/build.mjs --app OxyDex     # edit the *.js / .src.html first, then rebuild
npm run check                         # ← the FULL gate. Not `build.mjs --check` alone.
```

⚠️ **`build.mjs --check` is ONE of FOUR drift guards** (*why → RATIONALE §🔏: the table said three and
`verify:tools-index` failed on `origin/main` itself*):

| tree | built by | checked by |
|---|---|---|
| the 11 owned bundles | `tools/build.mjs` | `npm run build:check` |
| **`docs/` — SERVED COPIES of those bundles** | **`tools/build-docs.mjs`** | **`npm run verify:docs`** |
| the analysis tools | `tools/build-analysis.mjs` | `npm run verify:analysis` |
| **`docs/TOOLS-INDEX.md`** | **`tools/tools-index.mjs`** | **`npm run verify:tools-index`** |

The fourth row is stalened by `tools/` (adding a tool OR reflowing a tool's purpose line), not by a
re-bundle. The enumeration is `package.json` — `grep -E '"(verify|build):' package.json` — not this
table. `npm run check` runs all four plus typecheck · lint · `test:par` · `verify:shard-union` ·
`test:build-core` · `verify:manifest`, and is exactly what CI gates on. **Run it, not a subset.**

⚠️ **FORMAT BEFORE YOU BUNDLE.** Pre-flight `npm run typecheck && npm run lint`, then the group your
change touches, then the builders — a Biome reflow after `build.mjs` moves `manifestHash` AND
`computeHash` and re-runs the whole chain (*why → RATIONALE §🔏*). **Hook-enforced at commit** by
`.claude/hooks/guard-format.sh` (denies a commit whose STAGED `*.js`/`*.mjs` are not Biome-clean;
fails open where Biome cannot run; hatch `CLAUDE_ALLOW_UNFORMATTED=1`). A hook takes effect only in a
checkout that has pulled it.

⚠️ A fleet re-bundle green on `build.mjs --check`, GATE A/B and all assertions still reds CI's
`static` job with `STALE (7): …` when `docs/` was not rebuilt — it presents as a test failure and is not one.

### 🐍 capture-host has its OWN gate — `./check.sh`

`capture-host/check.sh` = ruff · shellcheck · `pytest -q --cov --cov-branch --cov-fail-under=100`. **A
pytest line without `--cov` does not fail the coverage floor — it does not EVALUATE it** (no `TOTAL`
row is the tell; *why → RATIONALE §🔏*). Run the script. `shellcheck` missing locally exits **127** —
a missing tool, not a failing gate.

⚠️ **After `tools/build-docs.mjs`, stage from `git status`, NOT from the `git add …` line it prints**
(measured printing nine unchanged paths and omitting the seven it rewrote).

`build.mjs` **auto-writes** the bundle's `manifestHash` and **re-stamps its code-gated fixtures**; never
hand-edit either. `tools/build.html` / `tools/build-core.js` are the browser equivalents. Do **NOT** use
`super_inline_html` (regresses to the retired format; GATE A reds).

**Owned ≠ in GATE A.** `build.mjs` owns **`CLAIM ownedBundles = 11`** bundles — the **9** in
`manifest-gate.js MANIFEST_BUNDLES` (the 8 apps **plus `Integrator.html`**) and
**`CLAIM orchestrators = 2`** orchestrators (`Data Unifier.html`, `OverDex.html`). GATE A covers those
**9**; `--check` covers all 11. The `CLAIM` markers are machine-checked against the builder.

**Fixtures.** `build.mjs` cannot know that your code changed a fixture's **output**. If it did,
regenerate by **re-running the app on its committed inputs and re-exporting** (NEVER hand-edit an
export) with the node's regen tool — **`tools/regen-<node>-goldens.mjs`, NINE of them**: `cpap` (5
fixtures) · `ecgdex` (4) · `glucodex` (3) · `hrvdex` (3) · `integrator` (3) · `motiondex` (1) · `oxydex`
(3) · `ppgdex` (6) · `pulsedex` (3), on `regen-goldens.mjs` + `regen-goldens-core.mjs`. Each re-runs
the real modules in a co-loaded realm, preserves the volatile keys (`file`/`provenance`/`kernel`/
`generated`) and re-records the ledger from the bytes it wrote. **Check for your node's tool before
costing a regeneration.** An export-inert rebuild of identical source moves nothing.

### 🔒 "EXPORT-INERT" IS A COMPUTED VALUE — you don't get to *claim* it

A commit-message claim of export-inertness shipped a stale GlucoDex fixture through every green gate
(*why → RATIONALE §🔏*). So the claim is **computed**:

- **`computeHash`** (`manifest-gate.js`) — `manifestHash`'s projection over the export's **compute
  closure**. Render/CSS/app edit → `manifestHash` moves, `computeHash` **stable** ⇒ export-inert,
  PROVEN. DSP/clock/export/registry edit → both move ⇒ re-verification owed. The closure is a
  **denylist** on purpose: unknown asset ⇒ inside it. We accept over-flagging, not a blind gate.
- **`verifiedUnder`** (per code-gated fixture) — the code that actually re-ran the app and reproduced
  those bytes. **`build.mjs` is FORBIDDEN to write it** (gate-asserted); the **only** writer is
  **`tools/verify-fixtures.mjs`**, after a green real-corpus run.

In practice:
- After a compute-path change: **`node tools/verify-fixtures.mjs`**. It refuses to stamp if an input is
  missing or the suite is red. If a fixture genuinely moved, regenerate it first; never re-stamp around
  a moved output.
- ⚠️ **Your worktree does not contain the corpus** (gitignored). The tool searches `$DEX_UPLOADS` →
  the primary checkout's `uploads/` → this checkout's, and prints the search when it refuses. The data
  lives in four places, only the first satisfies this tool — `docs/CORPUS-LOCATIONS.md`; a regeneration
  may be an `ssh` job.
- **`tools/release.mjs` REFUSES to cut a release while any corpus-backed fixture is UNVERIFIED.** CI
  reports it but does not block.
- Fixtures with **committed** inputs (the synthetic twins) are exempt — CI re-runs them every push. An
  adversarial **committed** twin beats a real gitignored one (the GlucoDex 14 h-gap twin).
- **Never write "export-inert" as an assertion.** Either `computeHash` didn't move (say so, give the
  hash) or you re-verified (say so, name the fixtures).

**GATE C is the equivalence gate in `Dex-Test-Suite.html`**: `env.equiv.*` runs
`compute({committed input}) ≡ committed export` (volatile-stripped) for OxyDex/PulseDex/HRVDex/GlucoDex/
PpgDex/ECGDex, and the CPAPDex goldens pin `compute() ≡ CpapFusion.cpapBuildExport`. When an equiv leg
reds, regenerate **all** of that node's fixtures, not just the one named.

**The "wait for the build to settle" rule is RETIRED.** The owned build is explicit and deterministic; a
`manifestHash` read straight after `build.mjs` is final. A hash moving with no edit of yours is a
concurrent session. **If GATE A/B already reconcile to the current hashes, do NOT hand-edit the
ledger** — rebase and re-run `build.mjs`.

### Fixture provenance ledger — `FIXTURE-PROVENANCE.json`
Each record is `{ bundle, manifestHash, inputHashes:{file:16hex}, outputHash:16hex }` (code-gated) or
`{ bundle, historical:true, outputHash }` (an immutable snapshot, byte-pinned, NOT code-gated — e.g. the
historical Integrator fusions). The `fixtures` keys ARE the audited set; no legacy list, no `buildHash`
fallback. Regenerate by re-running the app + re-exporting, never by editing a hash.

## 🎫 Evidence badges — ONE canonical source (don't fork the visuals or the grades)
The 5-level ladder (**measured · validated · emerging · experimental · heuristic**, ranks 0→4, disc shape
= trust, never hue) is defined ONCE. Do NOT hand-redraw badge CSS or re-tier metrics ad hoc.
- **🔴 COVERAGE MANDATE:** every surfaced measurement carries a badge, *no exception* — every KPI,
  metric/finding card, hero number, chart series, table row and chip. An unbadged number is a **bug**,
  same severity as a wrong unit. **Two placements only:** (1) `.ev-corner` pinned bottom-right of a
  `position:relative` card; (2) inline `.ev` immediately *before* the label in dense text. New surfaces
  inherit nothing: wire `MetricRegistry.badge()` / `.ev-corner` in. Markup → `dex-badges.css`;
  workflow → `CONTRIBUTING.md`.
  - **A CHART CAPTION IS NOT A BADGE SITE — badge the SERIES** (owner, 2026-08-16). A caption spans
    metrics and cannot carry one tier; an unbadged caption is correct provided every series it draws
    is badged. `no-fabricated-tier` does not scan `chartTitle` (*why → RATIONALE §🎫*).
- **Visual source of truth:** `metric-registry.js` injects the stylesheet and exposes it as
  `MetricRegistry.BADGE_CSS`; `dex-badges.css` is a byte-faithful MIRROR for static docs. Apps must NOT
  also hardcode disc CSS.
- **Grade source of truth:** each node's `<node>-registry.js` `evidence` field. A tier is a NODE fact;
  never invent a global grade table. `*_DEFS` in each `*-cross.js` is a projection (gate:
  `registry-defs-parity`; registry wins). Retired vocabulary (proxy, composite, "provisionally
  validated") must never reappear.
- **Gate:** `cohesion-badges` asserts engine ≡ `dex-badges.css`, each reference guide `<link>`s the CSS
  rather than inlining it, no retired vocabulary, and every guide card the node's `idForLabel` maps
  carries the registry's grade. **Fix the DOC, not the registry.** To cover a new guide, pass its
  registry + doc text into `env` in BOTH runners.
- **Re-bundle note:** an inert shared-module addition (like `BADGE_CSS`) does NOT require re-bundling;
  re-bundle only when runtime behavior changes.

## 📦 Releases, versioning & the changelog (CONTROLLED-RELEASES-2026-07-05)
One suite **SemVer** — canonical in `suite.manifest.json` `version`; `RELEASE-MANIFEST.json` is the
append-only history; root `CHANGELOG.md` the human view. **Three identity layers, never conflated:**
release SemVer · each bundle's `manifestHash` · each brief's dated filename+status. Never stamp a
hand-typed version onto source.
- **Bump:** **MAJOR** breaks a contract (`ganglior.node-export`, the Clock Contract,
  `ganglior.crossnight`, a metric's identity/units, node removal); **MINOR** adds backwards-compatibly;
  **PATCH** fixes without changing a shape (a moved fixture output is PATCH and MUST regenerate
  fixtures per §🔏).
- **The release is ONE command, unattended — `node tools/release.mjs --full`** (owner-ordered
  2026-09-07). It launches `tools/release-land.mjs` detached: stamp → `build.mjs --all` → `build-docs`
  → `npm run check` → explicit-path stage → PR → merge → tag at the merge sha → **GitHub Release
  object** → `wt-done`. `--status` shows the step; `--resume` continues after a fix. If the tool cannot
  do a step, fix the tool. **Cadence is a MECHANISM** (owner, 2026-09-23): `tools/release-due.mjs`
  under `tepna-release-due.timer` on the corpus machine cuts at 7 days since the last tag or 100
  commits on `main`, whichever first.
- **Parallel coders never hand-pick a number.** Each work-unit drops a **changeset** as its last action
  (`changes/*.md` — `bump`/`type`/`brief`; see `changes/README.md`). `release.mjs` folds them, computes
  the version ONCE from a green tree, stamps the manifest, prepends the changelog section, appends the
  ledger record (+ per-app `manifestHash` snapshot), prunes `changes/`. Never hand-edit a version or a
  snapshot.
- **Gate-backed** by `release-ledger` (Node lane): valid SemVer · no fork · unique increasing versions ·
  history↔changelog parity · changeset well-formedness · **check 7 — code that moved (`manifestHash` ≠
  last snapshot) requires a pending changeset.** No committed list to regenerate.
- **62304/13485-ALIGNED, not conformant.** `docs/COMPLIANCE/` adopts the disciplines with **no
  certification claim**; runtime SOUP is empty by design.
- **Version-into-bundle stamping is LIVE** (owner-ordered 2026-08-18): `DexBuild.build` projects the
  version into `<title>… · vX.Y.Z` · `.logo-sub` · `.version-badge` OUTSIDE every `data-inline-src`
  block, so `manifestHash` is invariant and a release moves zero fixtures (gate-asserted with a decoy).
  After `release.mjs` bumps, run `node tools/build.mjs`; the `.src.html` literals are placeholders.

## ✅ Known non-issues (do NOT re-investigate or "fix" — they are intentional/resolved)
- **Fonts / woff2:** no `*.woff2`, no `@font-face`, no CDN refs. `'Inter'`/`'IBM Plex Mono'` in font
  stacks fall through to `system-ui`/`ui-monospace` by design; all bundles are owned plain-inline and
  system-fonts-only (PulseDex's legacy woff2 dropped 2026-07-03). Do not re-add any of it or flag it.
- **`parseTimestamp` single-sourced in `clock.js` (A5, owner-ratified 2026-07-03).** THE canonical
  Clock-Contract parser lives in `clock.js` (`DexClock`), inlined by the owned bundler into
  **`CLAIM clockBundles = 5`** of the 8 app bundles — **NOT all of them**: oxydex/pulsedex/hrvdex/
  ecgdex/motiondex ship the spine and DELEGATE via local aliases, while **ppgdex, glucodex and cpapdex
  do not inline `clock.js` at all**, so **`DexClock` is UNDEFINED there** — a bare `DexClock.x` is a
  `ReferenceError`, not a fallback. They keep DELIBERATE node-local variants (ppgdex: strict ISO/epoch
  subset + quote-strip; glucodex: `_ckParse` + MDY numeric wrapper; cpapdex: EDF subset) — do not force
  them onto DexClock, do not reintroduce a mirror (*why → RATIONALE §✅, PR #1232*). Load `clock.js`
  BEFORE any delegating `*-dsp.js` (`dex-coload.js shared:` + the co-load gate; worker `importScripts` too).
- **`docs-archive/REFACTOR-BRIEF-modularize-Dexes.md`:** historical; the refactor is DONE.

---

## 🔒 THE CLOCK CONTRACT (non-negotiable — every app + every future node must obey)

All apps share ONE time model. EEGDex, the Integrator and any new node inherit it verbatim — do not
"fix" it back to real-UTC epoch (*why → RATIONALE §🔒*).

### 1. Canonical unit: UTC-normalized *floating wall-clock* milliseconds (`tMs`)
Store the recording's **local civil time encoded as if it were UTC**:

```js
tMs = Date.UTC(year, month-1, day, hour, min, sec, ms);   // canonical — NOT a real UTC instant
```

Floating `tMs` + `getUTC*` is viewer-timezone-independent, and two devices recording the same
wall-clock minute produce the **same `tMs`** by construction.
- Never store a `Date` or a formatted string as the source of truth.
- Per record: `tMs`. Per recording: anchor `t0Ms` = `tMs` of the first valid sample.
- `offsetMin` (minutes east of UTC) **only** when the input carried a real zone; real instant is then
  `utcMs = tMs − offsetMin*60000`. Default ALL sort/align/display to `tMs`. No zone → `offsetMin = null`.

### 2. One shared parser — `parseTimestamp(raw, opts) → { tMs, offsetMin } | null`
**Single-sourced in `clock.js` (`DexClock`)**, inlined into the bundles §✅ names — **NOT all of them**;
`DexClock` is UNDEFINED in ppgdex, glucodex and cpapdex, which keep node-local variants. The count is
§✅'s machine-checked `CLAIM clockBundles`, deliberately not restated here. Resolution order:
1. Numeric epoch (plausible range): real instant → floating for the local zone at parse time
   (`tMs = inst − tzOffset(inst)`), `offsetMin = −tzOffset/60000`.
2. **ISO-8601 with zone**: zone authoritative; `tMs = Date.UTC(components as written)`, capture `offsetMin`.
3. **ISO / `YYYY-MM-DD[ T]HH:MM[:SS]` no zone**: components verbatim → `Date.UTC(...)`, `offsetMin=null`.
4. **Explicit vendor formats by regex** (never `new Date(str)` / `Date.parse` on vendor strings):
   `HH:MM:SS DD/MM/YYYY` & `MM/DD/YYYY` (O2Ring), `DD/MM/YYYY HH:MM[:SS]` & `MM/DD/YYYY …` (Welltory),
   `YYYY/MM/DD HH:MM:SS`, 14-digit `YYYYMMDDHHMMSS`. Disambiguate DMY/MDY per §3.
5. **Time-only `HH:MM[:SS]`**: combine with `opts.dateAnchorMs`; roll the date forward each time the
   clock wraps past midnight (monotonic via `opts.prevTMs`). No anchor → `null`. Never Jan-1-2000.
6. Fallback: `return null`. **NEVER** fall back to `new Date()` / now() — a missing stamp must be
   visible, never fabricated.
7. **Component ranges are validated** — `Date.UTC` silently ROLLS out-of-range components onto a
   plausible WRONG instant. `clock.js:_ckMk` builds `tMs` only if the date round-trips (month 1–12, a
   real calendar day) and the time is `0–23 : 0–59 : 0–59 . 0–999`; otherwise **null**. The **one**
   legitimate overflow is ISO **`24:00:00`** → next-day `00:00:00`. **Do NOT add a bare `h > 23` guard.**

Helper: `tzOffset(instantMs) = new Date(instantMs).getTimezoneOffset()*60000`. Everything else is
pure `Date.UTC` + regex.

### 3. DMY vs MDY (one deterministic rule)
Any row with day-component > 12 ⇒ the file is unambiguous; lock that order for the whole file. Else
honor `opts.preferDMY` (default **true** for O2Ring/Welltory; GlucoDex CGM **false/MDY**). Never switch
order mid-file.

### 4. Per-recording anchors
- `dateAnchorMs` = start date at 00:00 (`Date.UTC(y,mo-1,d)`). Priority: (1) full date in data;
  (2) 14-digit `YYYYMMDDHHMMSS` in the filename; (3) file `lastModified` (converted to floating);
  (4) `null` → "date unknown", do not fabricate.
- `t0Ms` = `tMs` of first valid sample, stored on the night/session object (+ `offsetMin` if known).

### 5. Display — ALWAYS `getUTC*` (never `getHours()` etc.)
`fmtClock(ms)` → `HH:MM`, `fmtDate(ms)` → `YYYY-MM-DD`, `fmtDateTime(ms)` → `YYYY-MM-DD HH:MM`, all
from `getUTC*`. For `toLocale*` labels pass `{ timeZone:'UTC' }`. A compatibility `Date` is
`new Date(tMs)` read **only** via `getUTC*`.

### 6. Export contract (the cross-node currency)
Node JSON exports use `schema.name:"ganglior.node-export"`, `recording.startEpochMs` = the floating
`t0Ms`, and `ganglior_events:[{ t:"HH:MM:SS", impulse, node, conf, meta? }]`. **Event `t` is a
wall-clock string with no date** — consumers reconstruct absolute `tMs` from `startEpochMs`'s date + `t`
(rolling past midnight, monotonic). New emitters SHOULD also write `tMs` on each event; consumers must
tolerate `t`-only legacy exports.

### 7. The HOST-DISCIPLINED AXIS — `DexClock.hostAxis` (§1–§6 govern the parser; this governs the RATE)
A device crystal is wrong by ppm and a BLE link stalls; every Polar-Sensor-Logger / capture-host row
carries **two** clocks (`Phone timestamp` = host, `sensor timestamp [ns]` = device), and `hostAxis` is
the only sanctioned way to reconcile them. **A node MUST NOT hand-roll a rate correction**; call
`hostAxis` and consume `correctionAt()` (*why and the measurements → RATIONALE §🔒.7*).

- **An ANCHOR is a `{ devMs, hostMs }` pair read off the SAME row.** Non-finite members are dropped,
  not defaulted; anchors are sorted by `devMs`. Divergence is measured **relative to the first anchor**.
- **The median is EXACT in the interior and biased at the ENDS by ⌊win/2⌋/2 = 5 anchors' worth of
  drift**, so `correctionAt(firstAnchor)` is that bias, not 0, and **`ppm` under-reads by
  `1 − 5/(n−1)`**. Never quote `ppm` without its anchor count and span.
- **≥3 anchors is a contract.** Two points cannot be checked; the O2Ring's divergence is non-linear
  (the LINK, not the crystal — flat ~4 s lag for hours, then ~12.5 s/h after the first BLE dropout).
  Fewer than three ⇒ **refuse**.
- **A running MEDIAN (width 21), never a fit.** Host stamps carry BLE jitter (~0.1 s, up to 470 ms);
  21 halves it without flattening the curvature. **Do not replace the median with a regression.**
- **Linear between anchors; FLAT outside them.** Extending a slope past the last anchor fabricates one.
- **`CK_AXIS_MAX_PPM = 50000` (5 %) is a REFUSAL bound, not a clamp.** Beyond it the two columns are not
  the two clocks (a misparse, a unit mismatch, a shifted column). Out of bounds ⇒ **refuse**.
- **A refusal returns `{ ok:false, reason, n }` and NO `correctionAt`**; the node keeps the device axis
  and says so. ⚠️ **A refusal guards the RATE, not the AXIS**: a stepped device counter still spans the
  step in `relSec` (measured: a 7.66-year night while the rate guard read green). Step detection and
  re-anchoring live on the axis itself (`_clockResyncs`, MotionDex/ECGDex); a node without step detection
  owes at least a tripwire (FOLLOWUPS-VI §1.1/§1.3, #2080).
- **NO span gate here, deliberately** — `hostAxis` interpolates measured divergence. A consumer that
  reads **`.ppm`** instead of `correctionAt()` quotes a rate and **does** need a baseline (`ecgdex-dsp.js`
  span-gates its `fs` correction at 2400 s; PpgDex, consuming the interpolation, does not).
- **`ppm` and `maxStepMs` are DIAGNOSTICS.** Never quote `ppm` without the span (the same H10 reads
  −20.3 ppm over 373 min and −65.8 over 10.9). `maxStepMs` surfaces a genuine clock STEP. A clock's
  stability is σ_y(τ), a function of averaging time — `capture-host/allan.py` computes it (overlapping
  Allan deviation) and its SLOPE names the mechanism; SD diverges for these noise types as N grows
  (NIST/Riley SP 1065). See `briefs/ALLAN-DEVIATION-2026-08-12-BRIEF.md`.
- **This does not claim the host is right.** It places every device on ONE timebase; the host's own
  correctness is the host's business (0.008 ppm on the capture box).
- **FIRST ASK WHETHER THERE IS A SECOND CLOCK AT ALL — read `independent`, never a ~0 ppm.** The
  discriminator is the residual **spread**: box captures span 102–5124 ms, phone captures 0.13–1.00 ms
  (one stamp quantum — the host column IS the device time rounded). `hostAxis` publishes `spreadMs` and
  `independent` (`spreadMs > 2 ms`). **A phone-captured recording has no second clock.**
- **A device whose axis was DRAWN is not a clock.** Inter-sample deltas concentrated on one value
  (≥99 %) means `sample_index × an assumed rate`; it may be placed on the host timeline but never spent
  as a second clock — `quality.timingSource` (`device+host` · `host` · `none`).
- **ONE DEVICE CLOCK PER AXIS — a resync boundary is a change of clock; anchors from before it must not
  feed `hostAxis`.** Build the axis from anchors at or after the LAST resync only; rows before it get
  the flat out-of-range correction of the first post-seam anchor; count what was dropped
  (`hostAxis.anchorsDroppedPreResync`) and surface the seam's host↔device offset
  (`clockResyncs[].hostOffsetMs`). ECGDex implements this (`ecgdex-dsp.js`, "ONE DEVICE CLOCK PER
  AXIS"). **Any node that detects a device-counter step and then calls `hostAxis` owes the same split**;
  a node that detects no steps has not shown its stream has none (the `_ACC.txt` of the same night
  carries the F1 step; the Verity's `_PPG.txt` is unchecked).

### Verification any time you touch time
Round-trip (first/last shown == raw file exactly) · bin==CSV identical `t0Ms`/`tMs` (OxyDex) ·
viewer-timezone independence (re-render under a changed `TZ` → identical clock) · overnight 22:00→06:00
= ~8 h monotonic (no 24 h jump) · zoned `+02:00` == local for same instant → same `tMs` · DMY `13/05`
and MDY `05/13` both → May 13 · stamp-less row → null (never today) · metric parity on clean files.
