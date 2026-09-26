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

⚠️ **`node tools/build.mjs --check` is NOT the drift guard — it is one of FOUR.** There are four
generated trees, and a change can staleness any of them:

| tree | built by | checked by |
|---|---|---|
| the 11 owned bundles | `tools/build.mjs` | `npm run build:check` |
| **`docs/` — SERVED COPIES of those same bundles** | **`tools/build-docs.mjs`** | **`npm run verify:docs`** |
| the analysis tools | `tools/build-analysis.mjs` | `npm run verify:analysis` |
| **`docs/TOOLS-INDEX.md`** | **`tools/tools-index.mjs`** | **`npm run verify:tools-index`** |

⚠️ **The fourth row is not stalened by a re-bundle — it is stalened by `tools/`.** `tools-index.mjs`
reads every tool's header comment, so **adding a tool stales it AND so does reflowing an existing
tool's purpose line.** Measured 2026-09-13: #2457/#2458 added `cohort-fit.mjs` + `nsrr-score-pool.mjs`,
the index stayed at "178 tools" against an actual 180, and `verify:tools-index` (step 14/16) then failed
on **`origin/main` itself** — so every branch cut from it inherited a red that looks like the brancher's
fault. Fixed in #2465.

That row read as absent for a specific reason, and it is the reason to distrust any list here that
*looks* complete: this table said THREE, so a careful author checked three builders, ran a hand-picked
subset, and shipped. Same shape as `clockBundles` reading "every bundle" while being 5 of 8 (§✅). The
enumeration is `package.json` — `grep -E '"(verify|build):' package.json` — not memory, and not this
table if you have any reason to think it has drifted again.

`npm run check` runs all four (plus typecheck · lint · `test:par` · `verify:shard-union` ·
`test:build-core` · `verify:manifest`) and is exactly what CI gates on. **Run it, not a hand-picked
subset** — a rule keyed to the full gate fires on every cause of drift, where "after adding a tool,
regenerate the index" under-fires on all the others. `CONTRIBUTING.md` has carried the full builder
table all along — this line exists so the file you read *first* points at it too.

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
- **The release is ONE command and runs unattended — `node tools/release.mjs --full`** (owner-ordered
  2026-09-07 after v2.10.0 was hand-driven and four of its eleven post-stamp steps went wrong). It
  launches `tools/release-land.mjs` detached: stamp → `build.mjs --all` → `build-docs` → `npm run check`
  → explicit-path stage → PR → merge → tag at the merge sha → **GitHub Release object** (the thing
  "Latest" reads — a tag alone is not a release) → `wt-done`. `node tools/release-land.mjs --status`
  shows the step; `--resume` continues after a fix. Do not run those steps by hand from memory; if the
  tool cannot do one, fix the tool. **Cadence is a MECHANISM, not a rule to remember** (owner, 2026-09-23):
  `tools/release-due.mjs` under `tepna-release-due.timer` on the corpus machine cuts the release at
  7 days since the last tag or 100 commits on `main` since it, whichever comes first.
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
bundler inlines it into **the bundles §✅ names — NOT all of them**; delegating DSPs alias it locally
(`var parseTimestamp = DexClock.parseTimestamp;` …). **`DexClock` is UNDEFINED in ppgdex, glucodex and
cpapdex**, which keep deliberate node-local variants (§✅), so a bare `DexClock.x` there is a
`ReferenceError`, not a fallback. The count lives in §✅'s machine-checked `CLAIM clockBundles` and is
deliberately not restated here: one quantity, one source, one gate — this sentence said "every bundle"
from 2026-08-15 until 2026-09-22 because the correction was applied to §✅ and not to its twin, and
#1232 read the universal literally (PpgDex's only Allan core removed, render rig 1458 ms → 16945 ms,
`browser-gates` red).
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
