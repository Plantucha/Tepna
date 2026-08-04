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

Hook-enforced (`guard-shared-tree.sh`). There is deliberately **no commit-time guard on deletions**:
deleting files that exist on `origin/main` is what deleting a file *is*, and such a rule would block
`tools/release.mjs`'s changeset prune, so it would be overridden into uselessness.

### 3 · Bundles and ledgers must be SERIALIZED — a worktree does not save you here

Isolation solves the *tree*. The old single-file ledger collision is **mostly SOLVED** (ARCHITECTURE-DEBT-
REDUCTION §P3, 2026-07-15): `BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json` were split into per-app
**`provenance/<App>.json`** fragments (each owns that app's GATE-A `manifestHash` + GATE-B fixtures), so an
OxyDex re-bundle and a GlucoDex re-bundle now touch **different files** — no collision. `provenance-ledger.js`
reassembles the combined `{ bundles }` / `{ fixtures }` view every reader/gate still consumes; the monoliths
are retired. What remains genuinely shared: **`clock.js` (and any other spine module) is inlined into EVERY
bundle** — so one clock change moves **every** app's `manifestHash` (and thus every fragment) at once.

- **A shared-spine change still serializes** (it re-stamps all 8 fragments); a single-app re-bundle no longer
  does. For spine work, say so before you start.
- Landing second? **Rebase, re-run `node tools/build.mjs --app <App>`** — it auto-writes the manifest hash
  and re-stamps fixtures, so the redo is cheap — then re-run the gates.
- A shared-spine change (`clock.js`, `kernel-constants.js`, `metric-registry.js`, `dex-export.js`) should
  land **before** node-local work that would otherwise have to re-record everything.

Note the release layer *already* solves parallelism — §📦's changesets exist precisely so parallel coders
never hand-pick a version. This section extends that thinking to the tree and the build.

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
- **After executing a brief, spawn a follow-up brief** — `<NAME>-FOLLOWUPS-YYYY-MM-DD-BRIEF.md` —
  capturing what you discovered during execution that still needs addressing (house pattern:
  `AUDIT-FOLLOWUPS` → `-II`, `GENERATOR-FOLLOWUPS` → `-II`). If nothing surfaced, say so in the
  executed brief's header rather than creating an empty follow-up.
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

The failure mode, if you skip it: a fleet re-bundle that passed `build.mjs --check`, GATE A/B, biome
and all 5378 assertions still went red in CI on `STALE (7): CPAPDex.html, ECGDex.html, …` (#797,
2026-08-03), because nothing local had looked at `docs/`. **All six test shards were green and only
the `static` job failed, so it presents as a test failure and is not one** — that misread is the part
that costs time. Same trap as #450 and DEEP-AUDIT-III-FOLLOWUPS §2.5.

⚠️ **After `tools/build-docs.mjs`, stage from `git status`, NOT from the `git add …` line it prints.**
Observed 2026-08-03: it printed nine paths of which **zero** had changed, and omitted the **seven
`docs/*.html` it had just rewritten**.

`build.mjs` **auto-writes** that bundle's `BUILD-MANIFEST.json` `manifestHash` and **re-stamps its
code-gated fixtures**. You do not hand-edit `manifestHash`, and you never hand-edit a fixture hash.
`tools/build.html` / `tools/build-core.js` are the browser equivalents. Do **NOT** use `super_inline_html`
— it regresses a bundle to the retired legacy format, which `manifest-gate.js` now hashes to `null`, so
GATE A reds and points you back here.

**Owned ≠ in GATE A.** `build.mjs` owns **10** bundles — the 8 apps plus the two orchestrators
(`Data Unifier.html`, `OverDex.html`, owned per FOLLOWUPS §6). `BUILD-MANIFEST.json` / GATE A cover the
**8 apps**. `--check` is the guard that covers all 10.

**Fixtures.** `build.mjs` re-stamps a code-gated fixture's `manifestHash` on rebuild, but it cannot
know that your code changed a fixture's **output**. If it did, regenerate the fixture by **re-running the
app on its committed inputs and re-exporting** (NEVER hand-edit an export), then let the tool re-record
`{ manifestHash, inputHashes, outputHash }`. Because `manifestHash` is deterministic, an **export-inert
rebuild of identical source moves nothing** — no re-record. A fixture-only re-record needs no rebuild.
The regen tools are per-node and are the ONLY sanctioned way to move an output byte:
`tools/regen-cpap-goldens.mjs` (CPAPDex, 5 fixtures) · `tools/regen-glucodex-goldens.mjs` (GlucoDex, 3) ·
`tools/regen-pulsedex-goldens.mjs` (PulseDex, 3).
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
- Re-verify after a compute-path change: **`DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`**. It refuses
  to stamp if an input is missing or the suite is red — a verification you didn't run is precisely the false
  claim being abolished. If a fixture genuinely **moved**, regenerate it (`tools/regen-<node>-goldens.mjs`)
  first; never re-stamp around a moved output.
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
- **Version-into-bundle stamping is DEFERRED** (rides the next behavioral re-bundle — don't re-bundle 8
  apps just to carry a string; same economics as the inert license-comment/`BADGE_CSS` rules). Until
  then the version is authoritative in `suite.manifest.json` and surfaced on the docs/deploy pages.

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
  in `clock.js` (`DexClock`), inlined by the owned bundler into every bundle (bundled-local AND single-source).
  oxydex/pulsedex/hrvdex/ecgdex/integrator-dsp DELEGATE via local aliases; ppgdex (strict ISO/epoch subset +
  quote-strip), glucodex (`_ckParse` + MDY numeric wrapper) and cpapdex (EDF subset) keep DELIBERATE node-local
  variants — do not force them onto DexClock, and do not reintroduce a mirror. Load `clock.js` BEFORE any
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
  jitter and cannot be checked; three is the least that can show curvature — and the O2Ring's real error
  is **non-linear** (−3035 ppm decaying to −1622 ppm), so a line is the wrong model, not merely an
  imprecise one. Fewer than three ⇒ **refuse**.
- **A running MEDIAN (width 21), never a fit.** Host stamps carry BLE delivery jitter (~0.1 s, up to
  470 ms observed); interpolating raw anchors injects that straight into beat times, which for HRV is
  worse than the drift being removed. The width was chosen by planted recovery against ±100 ms jitter on
  real geometry (9 → 77 ms worst, 21 → 57, 41 → 168, 81 → 245): 21 halves the jitter without flattening
  the curvature the correction exists to follow. **Do not replace the median with a regression** — that
  is the whole point, and a fit would also re-introduce the "one ppm describes the night" error.
- **Linear between anchors; FLAT outside them.** Past the last anchor there is no measurement, and
  extending a slope there fabricates one — §2.6's rule applied to the rate.
- **`CK_AXIS_MAX_PPM = 50000` (5 %) is a REFUSAL bound, not a clamp.** A crystal is wrong by ppm; the
  worst real one in this corpus is −3035, so 5 % leaves 16× headroom. Beyond it the two columns are not
  the two clocks we think they are — a misparse, a unit mismatch, a shifted column — and "correcting" by
  that amount fabricates a timebase (caught by a fixture whose ms column advanced at 2× its host stamps:
  unbounded, a −500000 ppm "correction" that doubled `fs` from 130 to 259.9). Out of bounds ⇒ **refuse**.
- **A refusal returns `{ ok:false, reason, n }` and NO `correctionAt`.** A caller must not be able to
  apply a silent zero: absent a correction the node keeps the device axis and says so.
- **NO span gate here, deliberately** — and this is the one place the sibling tools differ. `hostAxis`
  does not *quote* a rate, it interpolates measured divergence, so its residual is bounded by what it
  observed. Gating on span would refuse the short O2Ring fragments whose real error is ~3 s, i.e. exactly
  the case that needs it. A consumer that reads **`.ppm`** instead of `correctionAt()` is quoting a rate
  and **does** need a baseline — that is why `ecgdex-dsp.js` span-gates its `fs` correction at 2400 s
  while PpgDex, which consumes the interpolation, does not.
- **`ppm` and `maxStepMs` are DIAGNOSTICS.** Never quote `ppm` without the span beside it (the same H10
  reads −20.3 ppm over 373 min and −65.8 over 10.9). `maxStepMs` surfaces a genuine clock STEP smeared
  across one anchor gap rather than hiding it in a slope.
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

### Verification any time you touch time
Round-trip (first/last shown == raw file exactly) · bin==CSV identical `t0Ms`/`tMs` (OxyDex) ·
viewer-timezone independence (re-render under a changed `TZ` → identical clock) · overnight 22:00→06:00
= ~8 h monotonic (no 24 h jump) · zoned `+02:00` == local for same instant → same `tMs` · DMY `13/05`
and MDY `05/13` both → May 13 · stamp-less row → null (never today) · metric parity on clean files.
