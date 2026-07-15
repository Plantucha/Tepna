<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-14

# Architecture-debt reduction — five maintainability wins after the checkJs type gate

> **What this is.** A build/work plan capturing the maintainability improvements surfaced while
> widening the `checkJs` type gate over the whole DSP fleet (PRs #70–#79, recorded in `tsconfig.json`
> `//d2`). It is written to be executed **one phase per PR by a local model** — every phase is
> self-contained, lists its exact files, gate commands, and a machine-checkable **Done-when**. Read the
> **Environment** and **Hard-won lessons** sections ONCE; then each phase is independent.
>
> **Nothing here changes runtime behavior.** Every phase is a dev-time / test-time / tooling change,
> or an EXPORT-INERT re-format. The 100%-local / offline / single-file invariants are untouched.
>
> **Priority order (do them in this sequence):** P1 → P2 → P3 → (P4 depends on P1) → P5 is deferred.

---

## Environment & gates cheat-sheet (read once)

**You are probably not alone in this checkout.** Work in your own worktree off `origin/main`, stage by
explicit path (never `git add -A`), and only one session touches the bundles/ledgers at a time — see
`CLAUDE.md` §👥. One phase = one branch = one PR.

**Toolchain present here:** `node`, `npm`, `npx`, `tsc` (pinned `typescript@5.5.4`), `@biomejs/biome@2.5.3`.
**NOT present:** any browser — so `Dex-Test-Suite.html?full`, `verify-provenance.html`, `no-network.html`
runtime layer, and the render-coverage rigs **cannot** be run locally. CI runs them; rely on the Node
lanes below and let CI cover the browser lanes.

**The gates you CAN run locally, and the exact commands:**

| Gate | Command | Green means |
| --- | --- | --- |
| checkJs type gate | `npx -y -p typescript@5.5.4 tsc --noEmit -p tsconfig.json` | exit 0, no output |
| Full node test suite | `node tests/run-tests.mjs --quiet` | `all N assertions passed` (currently 2315) |
| One group only | `node tests/run-tests.mjs --group=<name> --quiet` | dev convenience, NOT the merge gate |
| Provenance GATE A+B | `node tests/verify-manifest.mjs` | `PROVENANCE PASS — GATE A all 8 bundles match` |
| Bundle drift guard | `node tools/build.mjs --check` | `clean (10 owned checked...)` |
| Re-bundle one app | `node tools/build.mjs --app <App>` | writes manifestHash + re-stamps fixtures |
| biome (format+lint) | `npx -y @biomejs/biome@2.5.3 ci <file.js>` | exit 0 (warnings are OK, errors fail) |
| tsconfig is valid JSON | `node -e 'JSON.parse(require("fs").readFileSync("tsconfig.json","utf8"))'` | no throw |

**After adding/removing a brief OR any linkable file:** `node tests/gen-docs-ledger-list.mjs`.
**After adding/pruning a changeset:** `node tests/gen-changes-list.mjs`.
**A code change that moved a bundle's `manifestHash` needs a changeset** (`changes/*.md`; see
`changes/README.md`) or the `release-ledger` group reds. A **doc-only** change does not.

**The always-run-before-done sequence for any phase that touches a `.js`/tsconfig/bundle:**
```sh
npx -y -p typescript@5.5.4 tsc --noEmit -p tsconfig.json      # 1. types green
node tools/build.mjs --check                                  # 2. no unexpected drift
node tests/verify-manifest.mjs                                # 3. GATE A/B (if you re-bundled)
node tests/run-tests.mjs --quiet                              # 4. full suite green
```

---

## Hard-won lessons (do NOT relearn these the expensive way)

These were paid for in PRs #70–#79. Every one bit at least once.

1. **A DSP's own `global.<Node>`/`root.<Node>` namespace attach is DECLARED, never cast.** Several
   source-text safety gates in `tests/dex-tests.js` slice a node's `<node>LoadOwnExport` body on the
   VERBATIM attach marker (e.g. `indexOf('global.GlucoDex = global.GlucoDex')`). An inline
   `/** @type {any} */(global).X = …` cast rewrites that line → the marker vanishes → the gate collapses.
   Add the name to a `<node>-globals.d.ts` instead; the attach line stays byte-identical.
2. **When you must cast near a property WRITE that a source-text gate asserts, cast the VARIABLE at its
   declaration, not the property access.** (The integrator `_pe.sqiFloor = true` gate, `dex-tests.js`
   ~:2698: `/** @type {any} */(_pe).sqiFloor` breaks the regex; `var _pe = /** @type {any} */(events[i])`
   does not.)
3. **A declared global `require` makes tsc RESOLVE its string-literal calls as modules** →
   `require('./sibling.js')` pulls the sibling in and cascades `TS2306`. Keep `require` declared (so
   `typeof require` checks) but cast the CALL sites: `(/** @type {any} */(require))('./x')`. Do NOT route
   `require`/module-local names through `globalThis` — in Node they are module-local, not global.
4. **`oxydex-dsp.js` and `pulsedex-dsp.js` are the two DSPs NOT in `biome.json`'s formatter-override
   list** (they are already biome-reflowed). A PR that touches them is FORMAT-checked; run any edit
   through `npx @biomejs/biome@2.5.3 format --write <file>` before committing. The other six DSPs are
   override-listed (formatter disabled) — do not reflow them (see P4).
5. **JSDoc casts are comment-only → EXPORT-INERT.** They move a bundle's `manifestHash` (bytes change)
   but NOT any fixture's OUTPUT hash. `build.mjs` re-stamps the `manifestHash`; GATE B confirms outputs
   are unchanged. Re-bundle the app AND any orchestrator that co-loads its DSP (grep `*.src.html`).
6. **`tsconfig.json` is JSONC** — tsc tolerates comments and even bad escapes, but keep it strict-JSON
   valid (`\.`/`\s` in a string are invalid JSON escapes — write prose, not raw regex, in the `//d2`
   note). Verify with the `JSON.parse` command above.
7. **The `//d2` string in `tsconfig.json` is the running log of the type-gate campaign** — append a
   one-paragraph entry per module you add; do not rewrite prior entries.

---

## P1 — Replace the brittle source-text safety gates with behavioral tests · **do first**

> **§P1 EXECUTED 2026-07-14** — all **7** `<node>LoadOwnExport` "never re-stamps" gates
> (oxy·hrv·pulse·gluco·ecg·cpap·ppg) converted from the source-text slice to a behavioral leg. Each
> node already carried a *present → preserved verbatim* leg; the removed slice's extra coverage (the
> absent case) is now the real invariant — clone the committed export, delete `schema.provenance`,
> reload, and assert `!!res && !res.provenance` (no provenance fabricated). Net assertion count
> unchanged; suite 2315/2315; test-only (no re-bundle, no changeset). Adversarially verified live (flip
> the expectation → red). **Remaining P1 work:** the broader source-text scans in `tests/dex-tests.js`
> that are NOT function-body provenance slices (badge/CSS cohesion, retired-vocabulary, format-sensitive
> safety scans) are **out of scope** and deliberately kept. P4 is now unblocked only w.r.t. these seven
> gates — audit the rest before running the tree-wide format.
>
> **§P1 EXECUTED (cont.) 2026-07-15** — the eighth and last cleanly-convertible target from the Problem
> list, the **Integrator PpgDex sqi-floor** write-slice (`/_pe\.sqiFloor\s*=\s*true/` + `/_pe\.sqi\s*<\s*PPG_SQI_FLOOR/`
> over `integrator-dsp.js`), is now behavioral. The group already drove `adaptEnvelopeNode` (a co-loaded
> module); a **boundary pair** (an event at sqi 0.29 → floored, one at sqi 0.30 → untouched) now proves the
> exact `PPG_SQI_FLOOR = 0.3` value AND the strict-`<` comparison behaviorally — strictly stronger than the
> two source-text legs it replaces (which pinned neither the exact value nor `<`-vs-`<=`). Net assertion
> count unchanged (−2 source-text +2 boundary); test-only, no re-bundle, no changeset. **Audit of "the rest"
> for P4 (2026-07-15):** the only remaining function-body **write** slices are the H10 corner-gate's
> solve-path checks (`~:5601`/`~:5603`, over `sensor-trio-power-analysis.js`) — these are **NOT
> P1-convertible**: that group already runs the extractable pure `h10FailureClass` via `new Function`, but
> the *solve/null-the-corner* path lives in the analysis-page IIFE's private closures (worker + DOM deps),
> so it can't be co-loaded and called. They — plus the deliberately-kept security scans (`showErr`/`showOK`
> escaping) and the DSP body-extractions (`lombScargle`/`sampEn`) — are **P4-prep = make the regex
> whitespace/brace-tolerant**, not P1 behavioral conversions. So P1's convert-to-behavioral scope is now
> **complete**; what remains for P4 is regex-hardening those un-loadable source scans, not conversion.

**Problem.** A family of tests in `tests/dex-tests.js` asserts a safety invariant by *slicing a function
body out of the raw source text and regex-matching it*, e.g. (line numbers approximate — grep to
confirm):
- `~:8063` oxydex — `dsp.indexOf('function oxyLoadOwnExport') … dsp.indexOf('function oxyScrubExport')`
- `~:8464` glucodex — `gsrc.indexOf('global.GlucoDex = global.GlucoDex')`
- `~:8581` ecgdex — `esrc.indexOf('global.ECGDex = global.ECGDex')`
- `~:8877` ppgdex — `psrc.indexOf('global.PpgDex = global.PpgDex')`
- `~:8206` cpapdex — `fsrc.indexOf('global.CpapFusion')`
- `~:2698` integrator — a regex asserting the verbatim `_pe.sqiFloor = true` write

Each asserts something real (e.g. "`<node>LoadOwnExport` never re-stamps provenance — no `.stamp(` /
`GangliorProvenance` in its body"). But because they read *source text*, a harmless comment, a cast, or a
reflow silently breaks the slice and either false-passes or false-fails. They fought every type-gate PR.

**Goal.** Convert the invariant from "the source text looks like X" to "the function *behaves* like X" —
call the real function and assert the effect. This is strictly stronger AND unblocks P4 (tree-wide
format), which currently cannot run because reflowing moves the text these gates slice.

**Scope.** Do **one gate per PR** (they are independent). Start with the `<node>LoadOwnExport`
"never re-stamps" family — pick `oxydex` first (`grep -n "oxyLoadOwnExport never re-stamps" tests/dex-tests.js`).

**Steps (per gate):**
1. `grep -n "<marker string>" tests/dex-tests.js` to find the exact assertion and read ~40 lines around
   it to learn what it is really protecting (usually: "loadOwnExport preserves the committed provenance
   verbatim and does NOT re-stamp a new build fingerprint").
2. Find the behavioral leg already in the same group — most `<node>LoadOwnExport` gates already have a
   *dynamic* sibling assertion that builds an export, calls `<Node>.loadOwnExport(env)`, and inspects the
   result (`res.provenance`, `res.reviewMode`, …). The env + call are already set up right above the
   source-text slice.
3. Replace the source-text assertion with a behavioral one: construct an env whose `provenance` /
   `schema` carries a **sentinel** value, call `loadOwnExport`, and assert the returned provenance is the
   sentinel **byte-for-byte unchanged** (i.e. it was preserved, not re-stamped). If the function ever
   re-stamped, the sentinel would be replaced → the assertion catches it dynamically, no source text.
4. Delete the `.indexOf(...)`/`.slice(...)`/regex block and the `<node>src` variable if now unused.
5. Keep the assertion message stable so the test-count math and any headless-floor references still line
   up. Do NOT change the group title (other runners reference it — see the `cohesion`/`registry` groups
   for how titles are passed into `env`).

**Files:** `tests/dex-tests.js` only. No source `.js` change, no re-bundle, **no changeset** (test-only,
no manifestHash move).

**Done-when:**
- `node tests/run-tests.mjs --quiet` → all green, assertion count unchanged or +/- documented.
- `grep -c "indexOf('function.*LoadOwnExport')\|indexOf('global\.[A-Za-z]* = global\." tests/dex-tests.js`
  drops by one per converted gate.
- (Adversarial self-check, recommended) temporarily make the real `<node>LoadOwnExport` re-stamp, confirm
  the NEW test goes RED, then revert. A behavioral test you didn't watch fail is not verified.

**Watch-outs:** the same file has *legitimate* source-text scans (badge/CSS cohesion, retired-vocabulary
checks) — do NOT touch those; only the function-body-slice provenance gates are in scope. Leave a
one-line comment where you delete a slice so the next reader knows the invariant moved to a behavioral leg.

---

## P2 — Turn on `strictNullChecks`, one already-gated module at a time · cheap, incremental

> **§P2 ✅ EXECUTED / DONE 2026-07-14 — `strictNullChecks:true` is now ON; the gate is ACTIVE.** All
> **104** errors fixed across 14 files and the flag flipped in `tsconfig.json`. Landed in two PRs: chunk 1
> (the 4 adapters + signal-orchestrate, #85) then chunk 2 (the remaining 80 = the 8 DSPs + dex-ingest +
> signal-frame + the flag-flip). Every fix was comment/guard-level and **export-inert** — all 7 GATE-A
> apps re-bundled (signal-frame is in every app bundle), each manifestHash moved, but GATE B confirms
> every fixture OUTPUT reproduces unchanged. Root-cause note for the DSPs: most of the 80 collapsed to a
> few shared causes — `never[]`/inferred-`null`-slot object literals (annotate the literal once),
> `.filter(Boolean)` arrays tsc won't narrow (cast the array once), and possibly-null result vars from
> `buildSessionFromEdf`/`classifyMode`/`getElementById` (cast at declaration). cpapdex's 38 were all in
> `selfTest()` and reduced to 6 declaration casts. biome caveat: `oxydex-dsp.js` had to JOIN the
> formatter-override list — its inline JSDoc casts get MANGLED by `biome format` (it relocates the
> comment paren, silently breaking a mid-expression cast); signal-frame + dex-ingest were override-listed
> as pre-biome (§B2). The historical planning notes below are kept for the record.
>
> **§P2 planning history (superseded by the DONE note above):** Full count under `strictNullChecks:true` is **104**
> (not the 74 first estimated — that was a code-subset). Per-file: cpapdex-dsp 38 · resmed-edf 14 ·
> oxydex-dsp 12 · ecgdex-dsp 10 · dex-ingest 7 · glucodex-dsp 4 · polar-sense-ppg 4 · ppgdex-dsp 3 ·
> hrvdex-dsp 3 · polar-h10-ecg 3 · signal-frame 2 · welltory-summary 2 · signal-orchestrate 1 ·
> pulsedex-dsp 1. **CORRECTION to the "no re-bundle" order-suggestion below: it was WRONG — EVERY one of
> these files is inlined into a bundle** (the four adapters + signal-orchestrate → the two orchestrators;
> dex-ingest → 4 bundles; signal-frame → ALL 9; each `*-dsp.js` → its app + orchestrators). So every
> chunk re-bundles. **Chunk 1 (24 errors): the 4 adapters + signal-orchestrate** — all bundled only into
> the two non-GATE-A orchestrators, so it is the lowest-churn start. Fixes were `never[]`-warning-array
> annotations, `.pop()` `string|undefined` guards, a `.filter(Boolean)`-array cast (tsc doesn't narrow
> it), and a Promise resolve-arg — all comment/guard-level, export-inert (GATE A/B green, no fixture
> output moved). Pre-biome files touched here were **override-listed in `biome.json`** (§B2 on-touch),
> NOT reflowed — the reflow is P4's job. **Remaining P2 chunks:** the DSPs (cheapest-first) + dex-ingest +
> the fleet-wide signal-frame, then the final `strictNullChecks:true` flag-flip PR once all 104 are clean.

**Problem.** The gate runs with `strictNullChecks:false`, so the whole null/`undefined`/`{}`/`never`
class (the errors P4-era casts papered over — `TS18047`, `TS2538`, `.pos on never`) is invisible. Fixing
them at the source is better than casting them away.

**Goal.** Get each module clean under `strictNullChecks:true` **without** flipping the flag fleet-wide
(that would red every not-yet-hardened file at once).

**Approach — per module, per PR:**
1. Measure: create a throwaway copy of `tsconfig.json` with `"strictNullChecks": true` (edit the real
   file, DO NOT use a `/tmp` config — relative `include` paths resolve from the config's dir, so a
   `/tmp` config reds `TS18003`). Run tsc, capture the errors for ONE target module, revert.
2. Fix each error at the source with the smallest honest change: a real null-guard where one is missing,
   a non-null assertion only where the value is provably non-null, or a `/** @type {…|null} */`
   annotation that documents the real shape. Prefer a guard over a cast — the point is to *find* the bug,
   not silence it.
3. Because you cannot flip the flag for one file in isolation with this tooling, keep `strictNullChecks`
   OFF globally and instead land the *source fixes* (they are valid under both settings). Track progress
   in a checklist at the top of the phase's PR; flip the global flag ON only in the FINAL PR once every
   gated module is clean.
4. Any source edit to a bundled DSP is EXPORT-INERT only if it is comment/guard-level; re-bundle + GATE
   A/B + changeset per lesson #5. A pure added `if (x == null) return;` guard **can** change behavior —
   verify with the node suite that no fixture output moved (`verify-manifest` GATE B stays green).

**Files:** the target `*-dsp.js` + `tsconfig.json` (only in the final flip PR).
**Done-when:** target module has 0 `strictNullChecks` errors; suite green; if a bundle moved, changeset +
GATE A/B green.
**Order suggestion (corrected — see the §P2 note above; ALL these files are bundled):** the four adapters
+ `signal-orchestrate.js` first (chunk 1, DONE — lowest churn, re-bundles only the two non-GATE-A
orchestrators), then the DSPs cheapest-first (glucodex 4 · ppgdex 3 · hrvdex 3 · pulsedex 1 · ecgdex 10 ·
oxydex 12 · cpapdex 38 — each re-bundles its app + the orchestrators that co-load it), then `dex-ingest.js`
(4 bundles) and `signal-frame.js` (ALL bundles — fleet churn, land alone), then the flag-flip PR.

---

## P3 — Split the two shared provenance ledgers into per-app files · kills the serialize bottleneck

**Problem.** `BUILD-MANIFEST.json` and `FIXTURE-PROVENANCE.json` are **single files every bundle-touching
PR rewrites**. That is why `CLAUDE.md` §👥.3 says "only one session does bundle/ledger work at a time" —
two parallel bundle PRs collide on these files. Content-addressing is right; the single-file packaging is
the bottleneck.

**Goal.** Make each app own its own ledger fragment (e.g. `provenance/<App>.manifest.json` and
`provenance/<App>.fixtures.json`, or a `manifest`/`fixtures` block keyed per app in a directory), so two
PRs touching two different apps never edit the same bytes — exactly the reasoning the `changes/`
changeset system already applies to versions.

**This is the heaviest phase — it touches the build + the provenance gate together. Do it carefully:**
1. Read the producers/consumers first: `tools/build.mjs` (writes the ledgers), `manifest-gate.js`
   (`gateBEvaluate`, `manifestHashFromText`), `tests/verify-manifest.mjs` (Node GATE A/B),
   `verify-provenance.html` + `provenance-banner.js` (browser GATE A/B), and any test in
   `tests/dex-tests.js` that reads the ledgers.
2. Choose the split shape (recommend: a `provenance/` dir with one JSON per app + a tiny index the gates
   glob). Keep the **record schema identical** (`{ bundle, manifestHash, inputHashes, outputHash }` /
   `{ bundle, historical, outputHash }`) — only the *file packaging* changes, not the content-addressing.
3. Update `build.mjs` to write the per-app fragment, and BOTH gate readers (Node + browser) to read the
   glob. The browser reader has no filesystem — it must fetch a committed index/list, mirroring how
   `tests/docs-ledger-list.txt` / `tests/changes-list.txt` are pre-generated for the browser lane; add a
   generator + a Node-lane assertion that the list matches disk.
4. Migrate the existing records into the new layout in one commit; verify **the same hashes** land in the
   new files (a pure repackaging must not change any hash).

**Files:** `tools/build.mjs`, `manifest-gate.js`, `tests/verify-manifest.mjs`, `provenance-banner.js`,
`verify-provenance.html`, `tests/dex-tests.js` (ledger readers), new `provenance/*` + its generator.
**Done-when:** `node tools/build.mjs --check` clean; `node tests/verify-manifest.mjs` PASS with the same
hashes as before the split; full suite green; a changeset (`type: changed`, `nodes: [tooling]`).
**Watch-outs:** this is the one phase that materially changes tooling — land it when no other bundle PR is
in flight, and re-run GATE A/B twice (the browser lane is CI-only here). If it proves too large for one
PR, split by "reader migration" then "writer migration", keeping the old single files as a fallback the
gates still accept until the last step.

---

## P4 — Format the whole tree, retire the biome override list · **depends on P1**

> **§P4-PREP DONE 2026-07-15 — the "~17 format-sensitive gates break" blocker is mostly a myth; the ONE
> real one is fixed.** Measured it instead of assuming: reflowed a biome-formatted COPY of each
> formatter-exempt source (`sensor-trio-worker.js`, `ppgdex-app.js`, the DSPs) and tested every source-text
> gate that reads it against BOTH the current and the reflowed bytes. **Only `ppgdex-app.js`'s
> `showErr`/`showOK` XSS-sink scans actually broke** (biome rewrites `showErr(msg){` → `showErr(msg) {`,
> and the regex hard-coded `\)\{`). Hardened to `\)\s*\{` (verified matches both forms). **Everything else
> the brief feared SURVIVES a reflow** — the H10 corner-gate solve-path checks, the `lombScargle`/`sampEn`
> body-extractions, and the remaining source-mirror regexes all already use `\s*` at their token
> boundaries, so biome's spacing changes don't move them (empirically confirmed, not asserted). Net: P4's
> real remaining cost is the **provenance churn** (re-bundle every reflowed app) — NOT a gate-rewrite
> project. P1 (behavioral conversions) + P4-prep (this) are both done; P4 is unblocked and awaits the
> owner's go-ahead for the one-time reflow+rebundle.

**Problem.** `biome.json` has an `overrides` block that disables the FORMATTER for ~27 pre-biome files
(six of eight DSPs, plus render/app/util files). It exists because reflowing them would (a) churn every
provenance fixture and (b) **break the ~17 format-sensitive source-text gates** in `tests/dex-tests.js`.
It is archaeology from a mid-project formatter adoption and makes "is this file format-gated?" a guess.

**Goal.** Once P1 has converted the format-sensitive gates to behavioral tests, reflow the whole tree in
ONE deliberate pass and delete the override list, so every `.js` is uniformly formatted and CI's
`biome ci --changed` is unconditional.

**Blocked until:** P1 removes **every** source-text gate that slices bundled `*.js`. Confirm with
`grep -nE "src\.(indexOf|slice)|\.indexOf\('function |\.indexOf\('global\." tests/dex-tests.js` returning
only non-bundled hits.

**Steps:**
1. `npx @biomejs/biome@2.5.3 format --write` across the source `.js` (respecting `biome.json` `files`
   excludes). This reflows the override-listed files.
2. Delete the `overrides[0]` formatter-disable block from `biome.json` (or empty its `includes`).
3. **Re-bundle every app** whose DSP/source was reflowed (`node tools/build.mjs --app <App>` for each,
   plus the two orchestrators) — these re-bundles are EXPORT-INERT (format-only) so GATE B outputs must
   NOT move; if any fixture OUTPUT hash changes, a reflow altered behavior → stop and investigate.
4. `node tools/build.mjs --check` clean, `node tests/verify-manifest.mjs` GATE A/B green, full suite green.
5. One changeset (`type: changed`, `nodes: [suite]`), and append a `//d2`-style note is NOT needed here
   (that log is type-gate-specific).

**Files:** most `*.js`, `biome.json`, all 10 bundles, the two ledgers.
**Done-when:** `npx @biomejs/biome@2.5.3 ci` (no file arg, whole tree) exits 0; suite green; no fixture
OUTPUT hash moved. **This is a big diff** — land it alone, on a quiet tree, in its own PR.

---

## P5 — ES modules for the node realms · **DEFERRED — research/decision only, do NOT execute now**

**Why it's here.** The single largest source of accidental complexity is that each node is 4–5 *plain
global scripts sharing page scope* (`*-dsp` / `*-render` / `*-app` / `*-profile`, all bare globals). That
coupling is why every `<node>-globals.d.ts` exists, why `parseTimestamp` was once copy-pasted per node,
and why the type gate cost ten PRs of per-node archaeology. Real `import`/`export` would make the
DSP↔render coupling explicit and machine-checked, and most of the ambient `.d.ts` files would disappear.

**Why NOT now.** It is a large refactor touching every node, the `dex-coload.js` co-load contract, and the
inliner, and it churns every `manifestHash`. The type gate (PRs #70–#79) already made the coupling
**visible and checked** via the `<node>-globals.d.ts` files, capturing much of ESM's benefit without the
migration. Do this only if a concrete wall appears that ESM would remove.

**If/when it is taken up, it becomes its own multi-phase brief** (`ESM-MIGRATION-YYYY-MM-DD-BRIEF.md`),
not a phase here. Minimum spike before committing: prove the owned inliner can bundle an ES-module node to
a single offline `Foo.html` that passes `no-network` + GATE A/B, on ONE node, behind a flag — then decide.

---

## Cross-cutting Done-when for the whole brief

Flip this brief's header to `Status: DONE — <date>` only when **P1, P2, P3, P4 are each merged** (P5 stays
deferred and is called out as such). Spawn `ARCHITECTURE-DEBT-REDUCTION-FOLLOWUPS-…` for anything the
execution surfaces. Keep `DOCS-INDEX.md` in sync and regenerate `tests/docs-ledger-list.txt` on any
brief/file add.
