# Dex Suite — Project Conventions (read first)

> **New here?** Read **`ORIENTATION.md`** (the 60-second map). **Auditing?** Use **`AUDIT-PROMPT.md`**.
> This file is authoritative and wins on every conflict. The incidents and measurements behind each rule
> live in **`docs/CLAUDE-MD-RATIONALE.md`**, cited below as *why → RATIONALE §x*; read the pointer before
> relaxing a rule.

A fleet of single-signal physiological analyzers — **OxyDex** (SpO₂), **HRVDex** (HRV summaries),
**PulseDex** (raw RR → HRV), **GlucoDex** (CGM), **ECGDex** (raw ECG), **CPAPDex** (CPAP EDF),
**MotionDex** (IMU), planned **EEGDex** — plus the event bus **"Ganglior"** (name FROZEN; the Integrator
still reads a `fascia` alias on input) and the fusion layer **"Integrator"**
(`briefs/INTEGRATOR-BUILD-BRIEF.md`). Each app is built from `*-dsp.js` / `*-render.js` / `*-app.js`
referenced by `Foo.src.html` and bundled to a standalone `Foo.html`. **Edit the `.js` + `.src.html`,
never the bundled `.html`; re-bundle after changes.** 100 % local — no network, no CDNs, system font
stacks only (no `@font-face`, no woff2).

## 👥 You are NOT alone in this checkout (*why → RATIONALE §👥*)

Several agent sessions work this repo at once. The working tree is not yours; files you did not create
may be someone's only copy.

### 0 · Roster and the `Fleet-Session:` trailer

Identities are stable; role and machine are metadata — update the row, never the name.

| session | machine | lane |
|---|---|---|
| **Kestrel** | rig-x870 | coordinator / owner's deputy |
| **Heron** | vigil | capture-host + box ops. Deploys to vigil are **owner-authorized only**; a relay never changes that |
| **Osprey** | rig-x870 | mutation program + analysis |
| **Magpie** | rig-x870 | JS surface + sweeps |
| **Finch** | roaming (bridge) | special-collab / hardware RE, on demand |
| **Wren** | vigil | resident on the capture box — box-local measurement + capture-host work; runs under the fleet herder's boot-enabled user unit. Deploys/daemon restarts owner-authorized. No push credentials on the box, so its branches land via a relay: `Fleet-Session: Wren (relay: <Name>)` |

- **`Fleet-Session: <Name>` in every commit message and PR body** (forward-only from 2026-08-31).
- **The trailer is a convention, not a mechanism** — self-declared, unverified; never infer "X did it".
- **Triage stamps the brief** in the same session: `PROPOSED (core BUILT, remainder X-blocked — verified
  YYYY-MM-DD: …)`. An untouched header throws the triage away.

### 1 · Work in your own worktree

```sh
git worktree add ../wt-<task>-<3 chars> -b claude/<task>-<3 chars> origin/main
```

**Always** when touching a bundle, a ledger or a DSP; a one-file doc edit in a clean tree needs none.
The per-session suffix prevents two sessions deriving one branch name for one defect (§2d).

### 2 · Never blanket-stage, never destroy or re-point a tree you did not dirty

- **Stage by explicit path.** No `git add -A` / `git add .` / `git commit -a`. `git status` before every
  commit; unrecognised files are someone's work-unit — leave them.
- **Never** `git reset --hard` / `git checkout .` / `git restore .` / `git stash` / `git clean -f` on a
  tree you did not dirty.
- **Never move a branch ref by hand** — `git update-ref`, `git branch -f`, `git push . <src>:<b>`,
  `git fetch origin main:main`. If the branch is checked out anywhere the ref advances and the tree does
  not, so every file a later merge added reads as `deleted` and a blanket add stages the removal. To
  advance a ref, do it in the checkout that holds it: `git -C <checkout> merge --ff-only origin/<b>`.
- **`git rev-list --count main..origin/main` = 0 does NOT mean synced** — measure the TREE:
  `git -C <checkout> status --short`.
- **Finished, uncommitted work that is not yours: snapshot, do not step on it, do not merge it:**
  ```sh
  cp .git/index /tmp/r.idx
  TREE=$(GIT_INDEX_FILE=/tmp/r.idx sh -c 'git add -A; git write-tree')
  git branch rescue/$(date +%F)-wip $(git commit-tree $TREE -p origin/main -m 'rescue: WIP snapshot')
  ```
- **Detector:** `tools/commit-shape.mjs` (`npm run check`, CI `static`): a commit deleting a changeset
  without a release-ledger update, or deleting outside `changes/` alongside one, is not a release.
  Exempt by declared provenance only (`Revert `, `rescue:`). Refuses on a shallow clone (exit 2) —
  CI's `fetch-depth: 0` is load-bearing.

Hook-enforced by `.claude/hooks/guard-shared-tree.sh`; hatch `CLAUDE_ALLOW_BLANKET_GIT=1` when the tree
is genuinely yours alone. **"Hook-enforced" means Claude Code, in a checkout that has pulled the hook** —
a second agent, a terminal, the GitHub UI and an un-pulled tree inherit nothing. Prevention is
agent-coupled; detection is agent-neutral and lives in CI:

| invariant | agent-neutral enforcement |
|---|---|
| blanket-add / ref-move corruption | `tools/commit-shape.mjs` — `npm run check` + CI `static` |
| stale-brief overwrite | `.github/workflows/stale-file.yml` — a REQUIRED context, no escape hatch (rebasing IS the hatch) |
| §2c rebase silently reverting source | none — not mechanically decidable; prevention only |

### 2c · Rebasing: use `rebase-safe`

`main` moves every review cycle and the two orchestrator bundles are re-bundled by any inlined change,
so PRs sharing no source still conflict. **Never** `git checkout origin/main -- $(git diff --name-only
--diff-filter=U)` — right for a generated file, silently destructive for a source file, and the two share
one conflict list.

```sh
node tools/rebase-safe.mjs            # fetch → rebase → auto-resolve generated → rebuild → verify
node tools/rebase-safe.mjs --onto <ref>
```

- **Generated** (auto-resolved, rebuilt): the 9 provenance bundles + 2 orchestrators (read from
  `manifest-gate.js MANIFEST_BUNDLES` + `build.mjs ORCHESTRATORS`), the analysis tools
  (`build-analysis.mjs TOOLS`), `docs/**`, `provenance/**`. Never globbed; an unreadable builder list
  fails closed.
- **Source** (it stops): everything else. **`tests/dex-tests.js` conflicts on nearly every parallel PR** —
  restore `main`'s copy and re-run your insertion, never keep one side wholesale.
- **After ANY rebase verify your change survived:** `git show HEAD:<file> | grep -c <identifier you added>`.

Hook-enforced (`guard-shared-tree.sh` denies `git checkout <ref> -- <source>`; generated paths pass).

### 2d · Branch names collide across sessions — never a bare `--force`

A non-fast-forward rejection on "your" branch is the warning: find out who owns the name. Push with
`--force-with-lease` only, and first check `git log --oneline -1 origin/<branch>` and
`git log --format='%an' origin/<branch> -3 | sort -u`. (Kodiak's base merge on your own PR is the benign
case: `kodiakhq[bot]` at the head, your commit contained — merge it in and push.)

### 3 · Shared-spine changes serialize (*why → RATIONALE §👥.3, PR #1232*)

Ledgers are per-app `provenance/<App>.json` fragments, so single-app re-bundles do not collide. A spine
module inlined into many bundles moves every carrying app's `manifestHash` at once:

| module | bundles carrying it |
|---|---|
| `kernel-constants.js` · `metric-registry.js` · `dex-export.js` | **8 of 8** |
| **`clock.js`** | **5 of 8** — absent from **PpgDex · GlucoDex · CPAPDex**, where `DexClock` is `undefined` |

- **Before delegating anything in a `*-dsp.js` to `DexClock`, check the bundle carries it**
  (`grep -c 'data-inline-src="clock.js"' <App>.html`). An unguarded alias throws at module evaluation
  (only `browser-gates` sees it); guarding it converts the crash into silent disablement.
- Say so before starting spine work; land it **before** node-local work. Landing second: rebase, re-run
  `node tools/build.mjs --app <App>`, re-run the gates.

### 4 · Never wait on, or kill by, a command-name pattern (*why → RATIONALE §👥.4*)

```sh
until ! pgrep -f "pytest -q --cov"; do sleep 20; done      # ← NEVER EXITS: matches itself and peers' gates
```

1. **Don't poll** — run the real command as a background task; the harness notifies you.
2. **Own the PID** (gives the exit code):
   ```sh
   pytest … > /tmp/mine.$$.log 2>&1 & PID=$!
   while kill -0 "$PID" 2>/dev/null; do sleep 20; done
   wait "$PID"; echo "EXIT=$?"
   ```
3. **Sentinel you control** — the `&` is load-bearing:
   ```sh
   ( pytest … ; echo "EXIT=$?" ) > /tmp/mine.$$.log 2>&1 &
   until grep -q '^EXIT=' /tmp/mine.$$.log; do sleep 20; done
   ```

**The same self-match KILLS**: any list-then-act line whose text contains its pattern (`pkill -f x`,
`for p in $(pgrep -f x)…`, a `case` label, a `/proc` scan into `xargs kill`) acts on itself — tell: exit
144 on your own call. Two commands, the second carrying no pattern:

```sh
pgrep -af '<pattern>'            # 1 · LIST. Read. Decide. May also list a peer's gate — kill only your own.
kill 41233 41240                 # 2 · ACT on numeric PIDs.
```

### 4b · A truncated result is not the verdict

`| tail -N` reports tail's exit code and can cut the failing lines out. **Never read a verdict off a
tail**: aggregate (`grep -cE '^(FAILED|ERROR)'`, `gh pr checks <N> --json bucket --jq
'group_by(.bucket)|map({(.[0].bucket):length})|add'`, a `TOTAL`/`Required` line), capture `$?` before
any pipe, tail afterwards for detail. The family — `grep -q` exit codes, `npx` no-op greens, a filter that
matches nothing — is **success reported about something never examined.**

### 4c · A gate that dies with no verdict is not your diff

A long run SIGKILLed mid-suite with no exit code is the Claude Code harness watchdog reaping tracked
background tasks under BOX memory pressure. **Detach anything over ~100 s: `setsid nohup <gate> > log
2>&1 &` plus an `EXIT=` sentinel** — a `MemoryMax` cap on your gate does not help (the watchdog reads
the box; cap the CONSUMER instead). Rule out the kernel with `journalctl -k`, never `dmesg`
(unreadable here). Contention slows a gate, it does not stop it mid-run; a death at exactly 114 s or
600 s is the tool timeout. Attribute pressure by `/proc/<pid>/cgroup` walked to the top (a
`.service` is a timer, a tmux scope is a session) and by `df -h /tmp /dev/shm` + `free`'s `shared`
column — `/tmp` is a 30 GB tmpfs invisible to `ps`. Deleting orphans there is the owner's call;
`lsof +D <dir>` first.

### 5 · Landing (*why → RATIONALE §👥.5, §👥.5b*)

- **Kodiak merges** (`.kodiak.toml`, `require_automerge_label = false`): every non-draft PR without a
  `do-not-merge` label sits in its serial queue — it updates the front PR when BEHIND, waits for CI,
  merges, repeats. A PR sitting BEHIND while the front is mid-CI is serialising, not stalling. To HOLD:
  Draft or `do-not-merge`. Arming `--auto` adds nothing.
- Without Kodiak, `strict` status checks make an armed green BEHIND PR a **deadlock** (auto-merge never
  updates a branch): `node tools/queue-doctor.mjs --dry-run` names the green-and-stuck state and
  `node tools/land-pr.mjs <PR#>` drives one PR to merge. A merge queue is **not available** (user-owned
  repo).
- **One PR per work-unit, not per increment.** Run the full gate once on the final state (a `-k` /
  `--group=` filter that matches nothing reads as a pass); push before writing the changeset and PR body;
  `git merge origin/main` locally and push once rather than `gh pr update-branch` + a second push.
- **WIP cap: ≤ 4 open non-draft PRs repo-wide.** A finished unit waits for a slot.
- **Collect when** the pool has drained AND (`pend=0` OR wedged against that workflow's own history)
  AND every required check has a terminal SUCCESS/SKIPPED conclusion — a cancelled check reads as
  `pend=0`. Never supersede a queued `tests` run under ~3 h. Check the pool before an update:
  `gh pr list --state open --json statusCheckRollup --jq '[.[].statusCheckRollup[]?|.status]|group_by(.)|map({(.[0]):length})|add'`
- **Remove your worktree when the PR merges: `node tools/wt-done.mjs <path>`**, one path per call.

---

## 📌 Brief lifecycle (*why → RATIONALE §📌*)

**All briefs live in `briefs/`; a filename is FROZEN at creation** (`briefs/<NAME>-YYYY-MM-DD-BRIEF.md`,
`-HHMM` only for a same-day twin; never rename or move to mark status). Status is the first content
line after any SPDX comment:

```
**Status:** PROPOSED | IN-PROGRESS | DONE — YYYY-MM-DD · **Created:** YYYY-MM-DD
```

- **Exactly five statuses:** PROPOSED · IN-PROGRESS · DONE · REFERENCE (living …) · CHECKPOINT (living …),
  the last two with a `last-verified` date. Park as `PROPOSED (deferred YYYY-MM-DD — …)`; a bare
  `DEFERRED` reds `docs-ledger`. `Created:` must equal the filename date.
- **DONE** only when every acceptance item is met AND the gates pass. Never on unverified work.
- **Residue → `briefs/RESIDUE.md`, one row per verified defect, never a new `-FOLLOWUPS-` brief**
  (owner, 2026-09-02): `| <key> | logged | source | defect | evidence | state |`, key
  `YYYY-MM-DD-short-slug` (never a counter), source = a brief (which gets `**Residue:** <key>` on its
  status line), a repo path, or `#NNNN` — the real origin, never the nearest brief. Rows are appended and
  closed (`fixed #NNNN` or `→ \`<NAME>-BRIEF.md\``), never edited. A `-FOLLOWUPS-` brief is created only by
  the session picking a row up.
- **Supersession:** `Superseded-by: <NAME>` on the old, `Supersedes: <NAME>` on the new.
- **`DOCS-INDEX.md` is the dashboard** — add a row for every new doc; reorganise the view, not the files.
- 🔍 **Search before you size or build: `node tools/doc-search.mjs --read "<the thing>"`** (owner
  standing rule; hook `guard-doc-search.sh`). Read the top hits first. **Primary development computer
  only** — a local bge-m3 index that ships with nothing; elsewhere fall back to `git grep`, and no gate
  or CI may read its output.
- 🔴 **Before editing a brief, check it was not already answered** (overwrites produce no conflict):
  ```sh
  git fetch origin main
  git log --oneline $(git merge-base HEAD origin/main)..origin/main -- briefs/<NAME>-BRIEF.md
  ```
  Non-empty ⇒ read those commits, then `node tools/rebase-safe.mjs` and land on top. Hook-enforced by
  `guard-stale-brief.sh` (covers `briefs/*.md` + `DOCS-INDEX.md`; reads local `origin/main`, never
  fetches). Hatch `CLAUDE_ALLOW_STALE_BRIEF=1` — **exported**, the only form an `Edit`/`Write` sees.
- **Gate:** `docs-ledger` (Node lane) reds a stray root brief, a malformed header on a brief dated
  ≥ 2026-07-03, an unindexed brief, a dead `DOCS-INDEX.md` link, a one-sided supersede pair. Older
  headerless briefs are grandfathered — never fabricate a status.
- **Repo layout:** root holds only entry docs (`README.md`, `CLAUDE.md`, `ARCHITECTURE-PRINCIPLES.md`,
  `ORIENTATION.md`, `DOCS-INDEX.md`, `CONTRIBUTING.md`, `AUDIT-PROMPT.md`), standard OSS files, and all
  runtime/build files (`*.js` / `*.html` / `*.src.html` / `*.css` / `*.json` — never move). Archival docs go
  to `briefs/`, `audits/`, `docs/`; truly dead docs to `docs-archive/` with a redirect stub.
  `ORIENTATION.md` must stay in root (a gate fetches it).

## ∅ ABSENCE IS NULL — never a number (non-negotiable; *why → RATIONALE §∅*)

**A value that was not measured is `null` — never `0`, a default, or an in-range sentinel — at every
layer: capture writer · sidecar · parser · DSP · export · render.** The O2Ring's `_PPG.txt` shipped
thousands of in-band zeros through every green gate because the rule was never written for raw bytes.

- **A consumer cannot null what it cannot distinguish.** `0` is a legal sample (ECG crosses zero, an ACC
  axis rests there), so the fix is never `!= 0` in a DSP. **Validity travels out-of-band** in a sidecar
  written beside the stream — shipped for optical channels as `writers._RunSidecar` → `<base>RUNS.txt`
  (`PPG-ABSENCE-AS-VALUE`, DONE 2026-09-21); consumers read the sidecar.
- **Captured bytes are immutable.** Correction lives beside the file, dated and attributed.
- **Detect by RUN LENGTH against the stream's own distribution, never by value membership** (a
  value-keyed detector flags every singleton beat marker). Run it on every device from day 1 and keep
  it as a tripwire.
- **An output over absent input reports the absence.** 🔴 Owner ruling 2026-09-17: **a DISCONTINUITY
  refuses; reduced COVERAGE annotates.** A clock seam, blanking run or absent span → `null` + a named
  reason (`clock-seam`, not a borrowed one). Dropouts and short windows → the value with `n` / the covered
  span beside it. The line is whether the window still describes ONE continuous stretch of signal — a
  120 s dropout keeps a metric, a 0.6 s seam does not. Do not generalise into "refuse when in doubt".
- **Ask "the device emitted it" vs "our path manufactured it" before proposing the remedy.** Fit no
  story to the signal before cutting it.
- A reviewer reads a `0` default, `?? 0`, `.get(k, 0)` or a zero-filled buffer standing in for absence as
  this bug.

## 🧾 VERDICTS ARE MACHINE-READABLE (owner standing requirement 2026-09-21; *why → RATIONALE §🧾*)

Every gate, oracle, audit or study that decides something emits ONE `tepna.verdict/1` object beside its
prose (`verdict.js`; spec `briefs/VERDICT-CONTRACT-2026-09-21-BRIEF.md`). Prose explains; the object is
the API.

```json
{ "schema": "tepna.verdict/1", "gate": "oracle-ecg-firmware-rr", "status": "PASS",
  "population": { "checked": 52, "eligible": 52, "excluded": 0 },
  "criterion": { "name": "rr_delta_median", "threshold": 8, "unit": "ms", "direction": "lte" },
  "result": { "median": 0.45 }, "evidence": ["tools/oracle-ecg-firmware-rr.mjs"], "reason": null,
  "producedBy": { "tool": "tools/oracle-ecg-firmware-rr.mjs", "commit": "3c0dbdec" }, "at": "2026-09-21T18:40:12Z" }
```

- `status` is exactly seven: `PASS · FAIL · SHORTFALL · UNDERPOWERED · NOT_RUN · NOT_APPLICABLE ·
  UNKNOWN` (`NOT_RUN` examined nothing; `NOT_APPLICABLE` examined and the rule does not bind).
- `checked + excluded = eligible`; `PASS` over `checked: 0` or with empty `evidence` is invalid; every
  non-`PASS` carries a `reason`.
- `criterion` is pre-stated; a threshold derived from the data it judges is `UNKNOWN`.
- Adoption is a named set with a gate (`PARTIAL-ADOPTION-DETECTION`); a status-printing tool outside it is red.

## 📏 Units — metric is canonical (non-negotiable)
Store and compute in metric (kg, cm, °C, mmol/L; clinical metric units where conventional: mmHg, bpm,
mL/kg/min, m). Never persist an imperial number. An imperial display switch is allowed, metric is the
first-load default, and conversion happens only at the display/input boundary over one cited metric
NORMS table — no imperial-keyed tables or duplicate formulas.

## 📜 Licensing — `licensing/LICENSING-BRIEF.md`
**Apache-2.0**, author **Michal Planicka**, brand **Tepna**. Root `LICENSE`, `NOTICE`, `CITATION.cff`,
`THIRD-PARTY.md` are authoritative; every authored source carries the SPDX header from
`licensing/SPDX-HEADERS.txt`; user-facing surfaces carry the intended-use disclaimer and a `dxl-` stamp
(`licensing/dex-license.css`). **`Tepna` is the brand; `Ganglior` is the FROZEN bus codename** — never
touch `ganglior.*` identifiers, the `ganglior.node-export` schema or the `fascia` alias.

## 📚 Literature — `briefs/LITERATURE-USE-POLICY-2026-07-11-BRIEF.md` (REFERENCE)
Three hard lines: (1) **no networked data in a bundle, ever** — a literature value reaching runtime is
inlined at author time as a cited constant (gate `no-network.html`); (2) **no fabricated authority** — a
paper-sourced number is `validated`-tier only with a real, checkable citation; (3) **attribution is
mandatory** — author·year·journal·DOI in the doc + a source comment in code. A method that changes code
gets its own executable brief.

**Attribution is gate-backed** (`citation-ledger`, ledger `audits/CITATION-VERIFICATION-2026-08-05.json`):
every DOI on a reader-facing surface (reference guides, `papers/**`, `docs/**.md`, root `*.js`) sits in a
citation naming the ledger's first author and a year within ±1. `briefs/` and DOI resolution are out.
For a corporate author, spacing variant or author-less Crossref record add `authorAliases` **with
`aliasSource`** (`crossref-variant` | `from-paper`; `from-paper` on a record that has a Crossref author is
red). **Never silence a finding by editing `firstAuthor`.**

## 🎙️ Capture provenance
Raw ECG (Polar H10) and PPG (Polar Verity Sense) also arrive as **Polar Sensor Logger** exports
(`com.j_ware.polarsensorlogger`; per-stream CSV/TXT with its own stamp columns) — a first-class input
format; regex its stamps per the Clock Contract, never `new Date(str)`.

**Honest HR:** the Verity onboard `_HR.txt` is all-zero and `_PPI.txt` often header-only — derive
Verity HR from raw `_PPG.txt` (PPGDSP 3-LED consensus → `buildPPI` → Malik `correctRR`). The H10 `_HR.txt`
is smoothed — derive H10 HR from `_ECG.txt` via Pan–Tompkins (`ECGDSP.parseECG → bandpass →
detectPeaks`). Never fuse or compare onboard summaries.

**A real tri-device corpus exists** — O2Ring + Polar H10 (device `H10-01`) + Polar Verity Sense
(device `VERITY-01`), 2026-06-10 → 2026-07-05, **CLAIM trioEligibleNights = 20 FROM analysis/tri_device_nights.json#count eligible nights** (~10 with clean Verity) — the ground truth behind the reference-free σ work.

## 🧪 Regression gate — after ANY `*-dsp.js` / `*-cross.js` / `*-app.js` change
**`Dex-Test-Suite.html`** runs the real modules + `tests/dex-tests.js` (the same suite as
`node tests/run-tests.mjs`) plus browser-only render-coverage. A bare open is the headless floor only
(amber "render-coverage not run" — NOT a pass); the full gate is **`Dex-Test-Suite.html?full`**: wait for
the group count to stop climbing, then `#summary` must be all green (`window.__rcState==='done'` +
`sameOriginStatus().ok`). A cold-boot iframe timeout is a ⊘ SKIP — check `sameOriginStatus().bootSkips`
(`[]`) if every rig must have run. A red is a blocker; a spot-check on one file is not a substitute.
- The shared assertions ARE the contract: change a signature back-compatibly (new params last +
  optional, new data in a new field) or update `tests/dex-tests.js` deliberately.
- **Under the capture-host mutation gate a hand-advanced `while` index TIMES OUT, not fails** — mutmut
  reports UNDECIDED and `mutate_diff` REFUSES (exit 2; under `--report-only` printed first, BLOCKING,
  not advisory). Write scanners as `for … in enumerate(…)` or a tokenizer.

## 🔏 Provenance gate — after RE-BUNDLING any `Foo.html` (*why → RATIONALE §🔏*)

Ledgers are per-app `provenance/<App>.json` fragments (+ `_meta.json`, `index.json`), reassembled by
`provenance-ledger.js` into the `{ bundles }` / `{ fixtures }` views named `BUILD-MANIFEST.json` /
`FIXTURE-PROVENANCE.json` below. **`verify-provenance.html`** is pure-static and content-addressed
(hashes files, boots nothing); read `window.__provenanceOK` / `__gateA_ok` / `__gateB_ok`, never the body.

- **GATE A — code identity.** Each bundle's **`manifestHash`** must equal `BUILD-MANIFEST.json`: per
  `data-inline-src` block `logicalName \0 sha256(text)`, sorted, SHA-256[0:12] — deterministic, moving
  only on a code change (`manifest-gate.js manifestHashFromText`; `tests/verify-manifest.mjs`). A legacy
  gzip+UUID bundle hashes to `null`. `buildHash` is retired: still stamped into exports, read by nothing.
- **GATE B — known answers.** Each fixture in `FIXTURE-PROVENANCE.json` is `hash(input) + manifestHash →
  hash(output)`; reproducible only while all three still match (`manifest-gate.js gateBEvaluate`).
  Records are `{ bundle, manifestHash, inputHashes, outputHash }` or `{ bundle, historical:true,
  outputHash }` (byte-pinned, not code-gated). The keys ARE the audited set.
- **GATE C — equivalence** in `Dex-Test-Suite.html`: `env.equiv.*` runs `compute({committed input}) ≡
  committed export` (volatile-stripped) per node; when a leg reds, regenerate **all** that node's fixtures.

### Re-bundle checklist

```sh
node tools/build.mjs --app OxyDex     # edit the *.js / .src.html first, then rebuild
npm run check                         # ← the FULL gate. Not `build.mjs --check` alone.
```

- **Pre-flight `npm run typecheck && npm run lint` BEFORE bundling** — a reflow after `build.mjs` moves
  `manifestHash` and `computeHash` and re-runs the whole chain. Hook-enforced at commit by
  `guard-format.sh` (staged `*.js`/`*.mjs` must be Biome-clean; hatch `CLAUDE_ALLOW_UNFORMATTED=1`).
- **Four generated trees, four checks — `npm run check` runs them all; never a hand-picked subset:**

| tree | built by | checked by |
|---|---|---|
| the 11 owned bundles | `tools/build.mjs` | `npm run build:check` |
| `docs/` served copies of those bundles | `tools/build-docs.mjs` | `npm run verify:docs` |
| the analysis tools | `tools/build-analysis.mjs` | `npm run verify:analysis` |
| `docs/TOOLS-INDEX.md` (stalened by `tools/`, not by a re-bundle) | `tools/tools-index.mjs` | `npm run verify:tools-index` |

  The enumeration is `package.json` (`grep -E '"(verify|build):' package.json`), not this table. A stale
  `docs/` reds only CI's `static` job — it presents as a test failure and is not one.
- **After `build-docs.mjs`, stage from `git status`, not from the `git add` line it prints.**
- `build.mjs` auto-writes `manifestHash` and re-stamps code-gated fixtures — never hand-edit either;
  never use `super_inline_html`. **Owned ≠ in GATE A:** `build.mjs` owns **`CLAIM ownedBundles = 11`**
  bundles — the 9 in `manifest-gate.js MANIFEST_BUNDLES` (8 apps + `Integrator.html`) plus
  **`CLAIM orchestrators = 2`** orchestrators (`Data Unifier.html`, `OverDex.html`); GATE A covers the 9,
  `--check` all 11 (markers machine-checked).
- **A moved fixture OUTPUT is regenerated by re-running the app on its committed inputs**, never by
  editing a hash: `tools/regen-<node>-goldens.mjs` — nine of them (`cpap` 5 fixtures · `ecgdex` 4 ·
  `glucodex` 3 · `hrvdex` 3 · `integrator` 3 · `motiondex` 1 · `oxydex` 3 · `ppgdex` 6 · `pulsedex` 3) on
  `regen-goldens.mjs` + `regen-goldens-core.mjs`. Check for your node's tool before costing a regen.
- If GATE A/B already reconcile, do not hand-edit a ledger — a hash moving with no edit of yours is a
  concurrent session; rebase and re-run `build.mjs`.

### 🐍 capture-host has its own gate — `capture-host/check.sh`

ruff · shellcheck · `pytest -q --cov --cov-branch --cov-fail-under=100` · `tools/find_unwired.py --check` ·
mypy against a ratcheting baseline (flips BLOCKING at 0). **A pytest line without `--cov` does not
evaluate the floor at all** (no `TOTAL` row is the tell) — run the script. `shellcheck` missing exits 127:
a missing tool, not a failing gate.

### 🔒 Export-inertness is COMPUTED, never claimed

- **`computeHash`** (`manifest-gate.js`): `manifestHash` projected over the export's compute closure (a
  **denylist** — an unknown asset is inside it). Render/CSS/app edit ⇒ `computeHash` stable ⇒
  export-inert, proven. DSP/clock/export/registry edit ⇒ both move ⇒ re-verification owed.
- **`verifiedUnder`**: the code that actually re-ran the app and reproduced the bytes. Written **only** by
  **`tools/verify-fixtures.mjs`** after a green real-corpus run; `build.mjs` is forbidden to write it
  (gate-asserted). The tool refuses when an input is missing or the suite is red; regenerate a moved
  fixture first, never re-stamp around it. It finds the corpus via `$DEX_UPLOADS` → the primary
  checkout's `uploads/` → this checkout's (`docs/CORPUS-LOCATIONS.md`; a worktree has no corpus).
- **`tools/release.mjs` refuses to cut a release while any corpus-backed fixture is UNVERIFIED.**
  Fixtures with committed inputs are exempt (CI re-runs them); prefer an adversarial committed twin.
- **Never write "export-inert" as prose.** Either `computeHash` did not move (give the hash) or you
  re-verified (name the fixtures).

## 🎫 Evidence badges — one source for visuals and grades (*why → RATIONALE §🎫*)
Ladder **measured · validated · emerging · experimental · heuristic** (ranks 0→4; disc shape = trust,
never hue). **Every surfaced number carries a badge** — KPI, card, hero, chart series, table row, chip —
an unbadged number is a bug of wrong-unit severity. Two placements only: `.ev-corner` bottom-right of a
`position:relative` card, or inline `.ev` before the label in dense text. New surfaces inherit nothing —
wire `MetricRegistry.badge()`. **Badge the series, not the caption** (owner 2026-08-16): an unbadged
caption is correct when every series it draws is badged.
- **Visuals:** `metric-registry.js` injects the CSS (`MetricRegistry.BADGE_CSS`); `dex-badges.css` is
  its byte-faithful mirror for static docs. Never hardcode disc CSS.
- **Grades:** each node's `<node>-registry.js` `evidence` field; a tier is a node fact. `*_DEFS` in
  `*-cross.js` is a projection (gate `registry-defs-parity`). Retired vocabulary (proxy, composite,
  "provisionally validated") never reappears.
- **Gate `cohesion-badges`:** engine ≡ CSS, guides `<link>` the CSS, guide grades ≡ registry — fix the DOC.
- An inert shared-module addition does not require re-bundling.

## 📦 Releases (CONTROLLED-RELEASES-2026-07-05; *why → RATIONALE §📦*)
One suite SemVer in `suite.manifest.json`; `RELEASE-MANIFEST.json` append-only history; `CHANGELOG.md`
the human view. Three identities, never conflated: release SemVer · bundle `manifestHash` · brief
filename+status. Never hand-type a version anywhere (bundle `<title>`/badge strings are build-stamped
placeholders).
- **Bump:** MAJOR breaks a contract (`ganglior.node-export`, Clock Contract, `ganglior.crossnight`, a
  metric's identity/units, node removal) · MINOR adds compatibly · PATCH fixes (a moved fixture output
  is PATCH and regenerates fixtures).
- **Each work-unit drops a changeset** (`changes/*.md` — `bump`/`type`/`brief`; `changes/README.md`).
  `release-ledger` check 7: code that moved since the last snapshot requires a pending changeset.
- **The release is ONE unattended command — `node tools/release.mjs --full`** (stamp → `build.mjs
  --all` → `build-docs` → `npm run check` → PR → merge → tag → GitHub Release → `wt-done`; `--status`,
  `--resume`). If it cannot do a step, fix the tool. Cadence is a mechanism: `tools/release-due.mjs`
  under `tepna-release-due.timer` cuts at 7 days or 100 commits since the last tag.
- 62304/13485-**aligned**, not conformant (`docs/COMPLIANCE/`); runtime SOUP empty by design.

## ✅ Known non-issues — do not re-investigate
- **Fonts:** no woff2, no `@font-face`, no CDN; `'Inter'`/`'IBM Plex Mono'` fall through to system faces
  by design.
- **`parseTimestamp` is single-sourced in `clock.js` (`DexClock`)**, inlined into
  **`CLAIM clockBundles = 5`** of the 8 app bundles — oxydex/pulsedex/hrvdex/ecgdex/motiondex delegate
  via local aliases; **ppgdex, glucodex and cpapdex do not carry `clock.js`, so `DexClock` is UNDEFINED
  there** (a `ReferenceError`, not a fallback) and they keep deliberate node-local variants. Do not force
  them onto DexClock or reintroduce a mirror. Load `clock.js` before any delegating `*-dsp.js`
  (`dex-coload.js shared:`, worker `importScripts`).
- `docs-archive/REFACTOR-BRIEF-modularize-Dexes.md`: historical, done.

---

## 🔒 THE CLOCK CONTRACT (non-negotiable for every node; *why → RATIONALE §🔒*)

### 1. Canonical unit: floating wall-clock ms (`tMs`)
```js
tMs = Date.UTC(year, month-1, day, hour, min, sec, ms);   // local civil time encoded as if UTC — NOT an instant
```
Viewer-timezone-independent; two devices at the same wall-clock minute give the same `tMs`. Never store
a `Date` or a string as truth. Per record `tMs`; per recording `t0Ms` = first valid sample. `offsetMin`
(minutes east of UTC) only when the input carried a real zone (`utcMs = tMs − offsetMin*60000`), else
`null`. Sort, align and display on `tMs`.

### 2. One parser — `parseTimestamp(raw, opts) → { tMs, offsetMin } | null` (`clock.js`; see §✅ for which bundles carry it)
1. Numeric epoch (plausible range) → floating for the local zone at parse time.
2. ISO-8601 with zone: zone authoritative; `Date.UTC(components as written)`, capture `offsetMin`.
3. ISO / `YYYY-MM-DD[ T]HH:MM[:SS]` no zone: components verbatim, `offsetMin = null`.
4. Vendor formats **by regex** (never `new Date(str)` / `Date.parse`): `HH:MM:SS DD/MM/YYYY` &
   `MM/DD/YYYY` (O2Ring), `DD/MM/YYYY HH:MM[:SS]` & `MM/DD/YYYY …` (Welltory), `YYYY/MM/DD HH:MM:SS`,
   14-digit `YYYYMMDDHHMMSS`.
5. Time-only `HH:MM[:SS]` + `opts.dateAnchorMs`, rolling the date at each midnight wrap
   (`opts.prevTMs`). No anchor → `null`.
6. Otherwise `null`. **Never** fall back to now — a missing stamp is visible, never fabricated.
7. Components are range-validated (`clock.js:_ckMk`: real calendar day, `0–23:0–59:0–59.0–999`) —
   `Date.UTC` silently rolls bad components onto a wrong instant. The one legal overflow is ISO
   `24:00:00` → next-day `00:00:00`; **no bare `h > 23` guard.**

`tzOffset(instantMs) = new Date(instantMs).getTimezoneOffset()*60000`; everything else is `Date.UTC` + regex.

### 3. DMY vs MDY
Any row with day > 12 locks the order for the whole file; else `opts.preferDMY` (default true;
GlucoDex CGM false). Never switch mid-file.

### 4. Anchors
`dateAnchorMs` = start date 00:00, from (1) a full date in the data, (2) a 14-digit stamp in the
filename, (3) file `lastModified` as floating, (4) else `null` — never fabricated. `t0Ms` on the
night/session object (+ `offsetMin` if known).

### 5. Display — always `getUTC*`
`fmtClock` → `HH:MM`, `fmtDate` → `YYYY-MM-DD`, `fmtDateTime` → `YYYY-MM-DD HH:MM` from `getUTC*`;
`toLocale*` with `{ timeZone:'UTC' }`; a compatibility `Date` is `new Date(tMs)` read via `getUTC*` only.

### 6. Export contract
`schema.name:"ganglior.node-export"`, `recording.startEpochMs` = floating `t0Ms`,
`ganglior_events:[{ t:"HH:MM:SS", impulse, node, conf, meta? }]`. `t` is a date-less wall-clock string;
consumers rebuild `tMs` from `startEpochMs`'s date + `t`, rolling past midnight. New emitters also write
`tMs`; consumers tolerate `t`-only exports.

### 7. The host-disciplined axis — `DexClock.hostAxis` governs the RATE
Every capture-host / Polar-Sensor-Logger row carries two clocks (`Phone timestamp` = host,
`sensor timestamp [ns]` = device). **A node never hand-rolls a rate correction**: call `hostAxis`,
consume `correctionAt()`.
- An anchor is `{ devMs, hostMs }` from the SAME row; non-finite members dropped, sorted by `devMs`;
  divergence relative to the first anchor.
- **≥3 anchors** (refuse below); **running median width 21, never a fit** (host stamps carry BLE
  jitter; the O2Ring's divergence is the LINK stalling, non-linear); **linear between anchors, FLAT
  outside them**; the end-clamp biases the ends by 5 anchors' drift, so `ppm` under-reads by
  `1 − 5/(n−1)`.
- **`CK_AXIS_MAX_PPM = 50000` is a refusal bound, not a clamp.** A refusal returns `{ ok:false, reason,
  n }` with no `correctionAt`; the node keeps the device axis and says so. **A refusal guards the RATE,
  not the AXIS** — a stepped device counter still spans the step in `relSec`; step detection and
  re-anchoring live on the axis (`_clockResyncs`, MotionDex/ECGDex), and a node without it owes a tripwire.
- No span gate here (it interpolates); a consumer reading **`.ppm`** quotes a rate and needs a baseline
  (`ecgdex-dsp.js` gates `fs` correction at 2400 s). **`ppm` and `maxStepMs` are diagnostics** — never
  quote `ppm` without anchor count and span; for "does this drift / how long to average" use the Allan
  curve (`capture-host/allan.py`, `ALLAN-DEVIATION-2026-08-12-BRIEF`), never an SD or a two-half fit.
- **First ask whether there IS a second clock — read `independent` (`spreadMs > 2 ms`), never a ~0
  ppm.** A phone capture's host column is the device time rounded: no second clock. A stream whose
  inter-sample deltas are ≥99 % one value was DRAWN (`quality.timingSource`) and is never a clock.
- **One device clock per axis:** a resync is a change of clock. Build the axis from anchors at or after
  the LAST resync; earlier rows get the first post-seam anchor's flat correction; count the dropped
  (`hostAxis.anchorsDroppedPreResync`) and surface `clockResyncs[].hostOffsetMs` (ECGDex does; any node
  that detects steps and calls `hostAxis` owes the same split).
- This places every device on ONE timebase; the host's own correctness is the host's business.

### Verification whenever you touch time
Round-trip first/last == raw · bin==CSV identical `t0Ms`/`tMs` · identical clock under a changed `TZ` ·
22:00→06:00 = ~8 h monotonic · zoned `+02:00` == local for the same instant · DMY `13/05` and MDY
`05/13` → May 13 · stamp-less row → `null` · metric parity on clean files.
