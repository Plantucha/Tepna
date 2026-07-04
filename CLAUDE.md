# Dex Suite — Project Conventions (read first)

> **New to this project?** Read **`ORIENTATION.md`** first — the 60-second map (the Dex roster, the shared
> spine, the two gates, and where each fact actually lives). **Auditing the code?** Use **`AUDIT-PROMPT.md`**
> (the deep-audit charter — this suite's specific bug-classes + what NOT to flag). This file (`CLAUDE.md`)
> stays authoritative and wins on every conflict.

A fleet of single-signal physiological analyzers — **OxyDex** (SpO₂/oximetry), **HRVDex** (HRV
summaries), **PulseDex** (raw RR → HRV), **GlucoDex** (CGM), **ECGDex** (raw ECG), planned
**EEGDex** (Muse EEG) — plus a shared event bus (**"Ganglior"** — name is FROZEN, do not rename;
the Integrator still reads a `fascia` alias on input for back-compat) and a fusion layer
(**"Integrator"**, see `INTEGRATOR-BUILD-BRIEF.md`). Each app is built from external
`*-dsp.js` / `*-render.js` / `*-app.js` files referenced by a `Foo.src.html`, then bundled to a
standalone `Foo.html` via the inliner. **Edit the `.js` + `.src.html`, never the bundled `.html`;
re-bundle after changes.** 100% local — no network, no CDNs. Fonts are **system stacks only**
(no `@font-face`, no CDN — resolved June 2026; see `audits/AUDIT.md`).

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
- **When one brief replaces another,** don't just DONE the old one — add header links both ways:
  `Superseded-by: <NAME>` on the old, `Supersedes: <NAME>` on the new. (This whole scheme — immutable
  filenames, status-in-header, never move/delete on status change, an index as the view — is the
  industry-standard **ADR / RFC** convention; `Superseded-by:` is the one ADR idea worth borrowing
  over a flat DONE stamp.)
- `DOCS-INDEX.md` carries the at-a-glance status table; keep it in sync when a status flips. It is the
  dashboard — reorganize *that view*, not the files. Now that all briefs already sit in `briefs/`, do
  NOT further sub-folder them into `Done/`/`Executed/` — that breaks every cross-reference + splits git
  history (same failure as renaming); status lives in the header, not the path.
- **This whole lifecycle is now gate-backed** by the `docs-ledger` group in `tests/dex-tests.js` (both
  runners, headless floor): a stray root brief, a malformed/absent status header on a brief dated ≥
  2026-07-03, an unindexed brief, a dead `](briefs/…)` dashboard link, a one-sided `Superseded-by`/
  `Supersedes` pair, or a filename↔`Created` date mismatch turns the suite RED. Pre-2026-07-03 headerless
  briefs are grandfathered (never fabricate a status). The browser lane reads brief names from
  `tests/docs-ledger-list.json` — **regenerate it (`node tests/gen-docs-ledger-list.mjs`) whenever you add
  or remove a brief**; the Node lane asserts it matches `briefs/` on disk, so a stale list also reds.
- **Repo layout (2026-07-03 owner-sanctioned relocation — the second deliberate break of the old
  "never move" rule).** The **root** holds ONLY: base/entry docs (`README.md`, `CLAUDE.md`,
  `ARCHITECTURE-PRINCIPLES.md`, `ORIENTATION.md`, `DOCS-INDEX.md`, `CONTRIBUTING.md`, `AUDIT-PROMPT.md`),
  standard OSS files (`LICENSE`, `NOTICE`, `CITATION.cff`, `THIRD-PARTY.md`), and **all runtime/build
  files** (`*.js` / `*.html` / `*.src.html` / `*.css` / `*.json` — load-bearing paths, NEVER move them).
  Everything else archival lives in: **`briefs/`** (work-plans + pre-standard kickoffs/handoffs),
  **`audits/`** (audit findings, external reviews, fusion issues, validation status, one-off audit
  prompts), **`docs/`** (specs, derivations, analysis READMEs, `LEXICON.md`/`EVENT-LEXICON.md`, patterns,
  deploy + privacy statements, narrative). **`ORIENTATION.md` MUST stay in root** — the test suite
  fetches it (roster gate; `EVENT-LEXICON.md`/`AUDIT.md` are only *mentioned* in tests, safe in their
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

## 🎙️ Capture provenance — how the raw signals are recorded
Raw **ECG** (Polar H10 chest strap) and **PPG** (Polar Verity Sense armband) are captured with the
**Polar Sensor Logger** Android app (`com.j_ware.polarsensorlogger`, by j-ware). It streams the
sensors over BLE and writes per-stream CSV/TXT files (ECG ~130 Hz, PPG/ACC etc.) with its own
timestamp columns — so `ECGDex` (and any PPG node) must treat Polar Sensor Logger's export layout
as a first-class input format. Honor the Clock Contract when parsing its stamps (regex the explicit
format; never `new Date(str)`); add its exact column/timestamp formats to the relevant `*-dsp.js`
parser as you encounter real files.

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
**`verify-provenance.html`** is a **pure-static, content-addressed** gate (SIGNAL-ADAPTER-AND-FRONTIER
Phase 7, 2026-06-30). It fetches each bundle FILE + the two ledgers and hashes them — it does **not**
boot any bundle in an iframe and reads **no `buildHash`**, so there is no runtime race and no
same-origin dependency. It opens fast but GATE-B file-hashing settles in ~10 s (it hashes every
committed input + output); read `window.__provenanceOK` / `window.__gateA_ok` / `window.__gateB_ok`
for the verdict — never scan the body. Two gates:

- **GATE A — bundle code identity.** Every shipped bundle's current **`manifestHash`** must equal the
  value committed in **`BUILD-MANIFEST.json`**. `manifestHash` is the **sole executed-code identity**:
  a UUID-independent projection of the bundle's `__bundler/manifest` (drop the inliner's random
  per-build UUID keys, gunzip each asset, hash the DECOMPRESSED bytes, sort, SHA-256[0:12] the join —
  a pure function of the inlined JS/CSS, **deterministic** across re-bundles of identical source,
  moving ONLY on a real code change; PROVENANCE-NONDETERMINISM-2026-06-29 §1). Computed statically by
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

> **⚙️ OWNED BUILD (OWN-THE-BUILD-2026-06-30 Part A — fleet cutover DONE 2026-07-03).** **All 8 bundles are now
> repo-owned deterministic PLAIN-INLINE bundles** (`<script|style data-inline-src>` text, no gzip/UUID).
> For an **owned** bundle: edit its `*.js`/`.src.html`, then **rebuild with `node tools/build.mjs --app OxyDex`**
> (or the browser core `tools/build.html` / run_script over `tools/build-core.js`) — **NOT `super_inline_html`**,
> which would regress it to the legacy format. `build.mjs` **auto-writes** the bundle's `BUILD-MANIFEST.json`
> `manifestHash` + re-stamps its code-gated fixtures, so the hand-update dance below is replaced by
> `build.mjs` + **`node tools/build.mjs --check`** (the CI drift guard: committed bundle ≡ build(source)).
> `manifest-gate.js` hashes plain-inline ONLY (the legacy `__bundler/manifest` branch was **RETIRED
> 2026-07-03** — a bundle regressed via the old inliner now hashes to null → GATE A reds and points at the
> owned rebuild). The inert `buildHash` field was dropped from `BUILD-MANIFEST.json` the same day. The hand-update
> steps below are fully superseded by `build.mjs`; they remain only as reference for the
> retired legacy format. Remaining Phase 4 cleanup: `OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md` §2.

After a re-bundle that **changes JS/CSS**, `manifestHash` moves, so you **MUST hand-update that app's
entry** in `BUILD-MANIFEST.json` to the new value (read it off the page's `manifestHash` column / the
Node sibling), or GATE A reads stale (it **HARD-FAILS** on a missing/blocked/stale manifest — no
pass-with-warn). Then, **only if the code changed a fixture's OUTPUT**, regenerate that node's fixtures
by **re-running the app on its committed inputs and re-exporting** (NEVER hand-edit), and re-record the
fixture's `{ manifestHash, inputHashes, outputHash }` in `FIXTURE-PROVENANCE.json` (compute the hashes
with `ManifestGate.sha16` over the raw input/output bytes; GATE B reds otherwise). Because
`manifestHash` is deterministic, an **EXPORT-INERT re-bundle of identical source moves nothing** — no
re-record (the old churn is gone). A fixture-only re-record needs **no app re-bundle**.

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

**⏱️ Record AFTER the build settles, and re-read before you trust (PROVENANCE-NONDETERMINISM §2/§4).**
The platform may **auto-rebuild** a bundle asynchronously after you edit its `*.js`/`.src.html` — a
one-shot async rebuild that *settles* (observed: a CPAPDex `manifestHash` moved with no explicit
re-bundle, then stayed) — and the ledgers (`BUILD-MANIFEST.json` / `FIXTURE-PROVENANCE.json`) can be
rewritten **out-of-band** by that pipeline or a concurrent run. So a `manifestHash` read *immediately*
after an edit can still move under you. **Safe sequence:** finish ALL source edits → let the build
settle → **RE-READ** the final `manifestHash` (re-open `verify-provenance.html` / re-fetch the bundle)
→ only THEN record it → make no further source edit. **Re-read before you trust:** re-derive ground
truth before editing, and **if GATE A/B already reconcile to the current hashes, do NOT hand-edit the
ledger** (it is already synced; fighting it just races the other writer).

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
  every metric's `evidence` field. A metric's tier is a NODE fact; never invent a global grade table.
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
- **`REFACTOR-BRIEF-modularize-Dexes.md`:** historical, the refactor is DONE. See `docs-archive/`.

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

### Verification any time you touch time
Round-trip (first/last shown == raw file exactly) · bin==CSV identical `t0Ms`/`tMs` (OxyDex) ·
viewer-timezone independence (re-render under a changed `TZ` → identical clock) · overnight 22:00→06:00
= ~8 h monotonic (no 24 h jump) · zoned `+02:00` == local for same instant → same `tMs` · DMY `13/05`
and MDY `05/13` both → May 13 · stamp-less row → null (never today) · metric parity on clean files.
