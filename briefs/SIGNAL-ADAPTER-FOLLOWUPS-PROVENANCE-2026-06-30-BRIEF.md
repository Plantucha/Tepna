<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-06-30 · **Created:** 2026-06-30 · **Follows:** `SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23-BRIEF.md` Phase 7 (content-addressed provenance, executed DONE 2026-06-30) · **Relates:** CLAUDE.md "Provenance gate", `verify-provenance.html`, `manifest-gate.js`, `FIXTURE-PROVENANCE.json`, `BUILD-MANIFEST.json`, `tests/verify-manifest.mjs`, `GENERATOR-FOLLOWUPS-II-BRIEF.md` §1 (inliner-ownership path, still untaken)

# Signal-Adapter Phase 7 — provenance follow-ups (residue from executing the content-addressed gate)

> Phase 7 landed a PURE-STATIC, content-addressed provenance gate and retired `buildHash` as a signal.
> **Both gates are green right now** (`verify-provenance` GATE A 8/8 + GATE B 15/15; `Dex-Test-Suite`
> 1560/99 all-green) and the teeth are proven (synthetic code/input/output drift each reds). This brief
> is the residue — all LOW/MEDIUM, none blocks anything. **Verify, don't trust:** every item below has a
> re-derivable check (open `verify-provenance.html`, read `window.__provenanceOK` / the GATE-B rows).

## ✅ Executed — 2026-06-30 (decision/doc pass — NO re-bundle, NO gate-code change; both gates stay green)
- **§1 → option (a) DONE:** documented the two-gate closure in CLAUDE.md (re-bundle checklist). GATE B
  (static, committed-artifact + code-identity integrity, `verify-provenance.html`) + **`Dex-Test-Suite.html`'s
  equivalence gate** (`env.equiv.*` `compute({committed input}) ≡ committed export`, volatile-stripped) +
  the CPAPDex synthetic goldens (`compute() ≡ CpapFusion.cpapBuildExport`) ARE the GATE-C surface.
  **KEY FINDING:** *every code-gated NODE has ≥1 dynamic leg*, so a code change that moves an export's
  content reds that node's equiv/golden leg and forces regeneration — the residual static-only false-green
  (re-record `manifestHash` without regenerating the output) is closed by the house rule "regenerate the
  **NODE's** fixtures." The 4 code-gated fixtures with no DIRECT equiv leg (OxyDex `_0439`; the 2 real-EDF
  CPAPDex `cpapdex-2026-06-12/-16`) are each **indirectly** covered by a sibling leg of the same node
  (OxyDex `_1056` equiv; the CPAPDex goldens). A dedicated per-fixture GATE C (an `oxydex2` equiv leg, or a
  headless GATE C in `verify-manifest.mjs`) is a **noted future tightening, NOT taken now** — marginal over
  node-level coverage, and the brief recommended doc-first "before building new harness."
- **§2 → LEAVE IT (DECIDED):** `buildHash` stays stamped into exports as inert legacy metadata; stripping
  it forces an 8-app re-bundle + all-13-fixture regen for zero gate value. Fold removal into the next
  fleet-wide re-bundle that happens for an independent reason. (Already stated in CLAUDE.md/CONTRIBUTING.)
- **§3 → ACCEPT best-effort (DECIDED):** `tests/verify-manifest.mjs` GATE B skips uploads-absent fixtures
  (gitignored in CI); the browser `verify-provenance.html` (served with `uploads/`) is the authoritative
  GATE-B surface. No CI fixture pair committed (not worth it unless a drift slips the browser gate).
- **§4 → ACCEPT raw-bytes outputHash (DECIDED):** `outputHash` = sha256[0:16] of the committed fixture's
  RAW bytes (tamper-pin); volatile-stripping stays GATE C's job (recorded in `FIXTURE-PROVENANCE.json`
  `_doc`). Not switched to a canonical-stripped hash (adds a serializer/strip-list drift surface for
  marginal gain).
- **§5 → LEAVE AS-IS (DECIDED):** the 4 dropped pre-R1 samples (3 PulseDex summaries + `ppgdex_20260610.json`)
  stay in `uploads/` as untracked samples (the uncurated-uploads-out-of-scope rule); not archived (several
  are inputs to the historical `integrator_fusion_*` snapshots, so deleting them would break those records).
- **§6 → DONE in Phase-7 execution** (GATE-B hashing parallelized to `Promise.all`, ~3 s settle).

**Verification:** `verify-provenance.html` GATE A 8/8 + GATE B 15/15 green; `Dex-Test-Suite.html` 1560/99
all-green (UNCHANGED — this pass touched only CLAUDE.md prose, no gate code). **No `-II`:** every item is a
terminal decision or a doc tie-off; the only open future option (a dedicated per-fixture GATE C) is recorded
in §1 and gated on a real need.

## §1 (MEDIUM) — GATE C (regenerate-and-diff) is still the only catcher of "output-moving code change, fixture not regenerated"
The static content-addressed gate pins three committed artifacts (input bytes + bundle `manifestHash` +
output bytes) and reds if ANY is tampered with. It does **not** re-run the code, so the one residual
false-green is: a code change MOVES a fixture's output, the author updates `BUILD-MANIFEST.json` (GATE A
green) **and** re-records the fixture's `manifestHash` to match — but forgets to regenerate the OUTPUT
bytes. Then `outputHash` still matches the (stale) committed file and `manifestHash` matches → GATE B
green on a stale fixture. (This is NOT a Phase-7 regression — the old `buildHash`/manifestHash-only gate
had the same blind spot; the content-addressing strictly *added* input/output tamper-detection.) The
closure is **GATE C**: drive each app headless on its committed input, capture the export, strip the
volatile keys (`schema.generated`/`provenance`/`generated`/`kernel` + the profile-coupled
`newMetrics.vo2est`/`karv`), and deep-diff against the committed fixture. The Dex-Test-Suite **equiv
gate already does exactly this** for 9 nodes (`env.equiv.*` runs `compute({text}) ≡ committed export`),
so GATE C is *mostly already enforced in the behavior lane* — the gap is only the fixtures with no
equiv leg (the 2 historical Integrator fusions, which are intentionally not code-reproducible). **Do
(LOW-MED):** document in CLAUDE.md that the Dex-Test-Suite equiv gate IS the GATE-C surface for the
code-gated fixtures, and that `verify-provenance` GATE B + the equiv gate together close the loop; OR
add a thin headless GATE C to `tests/verify-manifest.mjs` for nodes whose committed input is present.
Recommendation: document the equiv-gate-is-GATE-C mapping (cheap, accurate) before building new harness.

## §2 (LOW / standing) — `buildHash` is still stamped into exports by the bundled `ganglior-provenance.js`
Phase 7 retired `buildHash` from every GATE, but the bundled `ganglior-provenance.js` still computes +
stamps it into each export's `schema.provenance.buildHash` (inert legacy metadata). Removing the stamp
is the only *fully* clean end-state, but it edits a shared BUNDLED module → forces re-bundling **all 8**
apps + regenerating `BUILD-MANIFEST` (and, because every code-gated fixture's committed bytes carry the
stamped `buildHash`, regenerating **all 13** fixtures). That is a large gate cost for zero functional
gain (no gate reads the field). **Decision recorded: LEAVE IT** (the BADGE_CSS / inert-shared-module
precedent — never re-bundle the fleet to carry/strip an inert change). Revisit ONLY if `buildHash` is
removed for an INDEPENDENT reason that already re-bundles the fleet (e.g. the deferred
`buildSource()`-snapshot pass) — fold the stamp removal into THAT pass. Until then it is harmless
historical metadata; CLAUDE.md/CONTRIBUTING already say plainly that no gate reads it.

## §3 (LOW) — Node-lane GATE B is best-effort (uploads/ is gitignored)
`tests/verify-manifest.mjs` now runs GATE B, but `uploads/` is gitignored (personal health data), so in
CI the committed fixtures/inputs are ABSENT → every GATE-B row SKIPS (not fails), exactly like the
equiv-gate's `existsSync` self-skip. So the **authoritative GATE-B surface is the browser
`verify-provenance.html`** (served with `uploads/`), and the Node lane gives teeth only where `uploads/`
is present (locally / this environment). **Do (LOW):** if CI coverage of GATE B is ever wanted, commit a
TINY synthetic input+output fixture pair OUTSIDE `uploads/` (e.g. `tests/fixtures/provenance/`) and add a
sidecar entry for it — then the Node lane gates at least one known-answer on every push. Not worth it
unless a real drift slips the browser gate.

## §4 (LOW) — `outputHash` pins RAW committed bytes (snapshot), not the volatile-stripped content
`outputHash` = sha256[0:16] of the committed fixture file's RAW bytes, so it pins the snapshot INCLUDING
the frozen volatile fields (`schema.generated`, `provenance`, `kernel`) that were stamped at generation
time. This is correct + simplest for *tamper-detection* of the committed artifact, and the "is the
content reproducible" question is GATE C's job (it strips volatiles + re-runs). **Decision recorded:**
raw-bytes for the static gate; normalization stays in GATE C. An alternative — hash the
volatile-stripped canonical content so `outputHash` equals what a re-run+strip produces — was considered
and NOT taken (it needs a shared canonical-serializer + the strip-list in the gate core, adding a
drift surface for marginal gain). Re-open only if a use-case needs the static gate to equal a re-run hash.

## §5 (LOW) — tidy: 4 pre-R1 sample exports dropped from the audit remain in `uploads/`
Phase 7 dropped the old `LEGACY_FIXTURES` buildHash-fallback list. Three pre-R1 PulseDex summaries
(`PulseDex_2026-06-13_1701`/`_1055`/`PulseDex_2026-06-12_0821_summary.json`) + `ppgdex_20260610.json`
are no longer audited (PulseDex/PpgDex already carry code-gated fixtures, so no node lost coverage). They
remain in `uploads/` as untracked sample exports. **Do (LOW, optional):** leave as-is (they are
inputs/samples, not gated fixtures — the standing "uncurated uploads are out of scope" rule), or move
the truly-dead ones to `docs-archive/retired-fixtures/` for tidiness (only those NOT referenced by a
historical `integrator_fusion_*.json` `inputs[]`, with care — destructive). Recommendation: leave as-is.

## §6 (DONE in execution) — `verify-provenance.html` GATE-B hashing parallelized
GATE B originally fetched + hashed every committed input + output **sequentially** (`for … await`), and
the CPAP fixtures alone reference 15 binary EDFs, so the page took ~10 s to render GATE B. **Resolved
during Phase-7 execution:** the two hashing loops (bundle `manifestHashOf` ×8, file `fileHash16` ×~28)
now run via `Promise.all` (the hashes are independent) → settle dropped to ~3 s. `window.__provenanceOK`
still lets an agent/verifier wait deterministically. No further action.

## Done when
- [x] §1 decided — **option (a)**: documented the equiv-gate-is-GATE-C mapping in CLAUDE.md (every code-gated node has ≥1 dynamic leg; per-fixture GATE C noted, not taken).
- [x] §2 left standing (LEAVE IT) — fold `buildHash`-stamp removal into the next fleet-wide re-bundle if one happens for another reason.
- [x] §3 decided — best-effort Node GATE B accepted (no CI fixture pair committed).
- [x] §4 decided — raw-bytes `outputHash` accepted (recorded in FIXTURE-PROVENANCE `_doc`).
- [x] §5 decided — leave the 4 dropped samples as-is.
- [x] §6 DONE in execution — GATE-B hashing parallelized (`Promise.all`), settle ~3 s.

### Priority summary
- **MEDIUM:** §1 (GATE-C is the only catcher of the forgot-to-regenerate-output case — but the Dex-Test-Suite equiv gate already covers it for the code-gated fixtures; mostly a documentation tie-off).
- **LOW / standing:** §2 (`buildHash` stamp — LEAVE IT, fold into a future fleet re-bundle), §3 (Node GATE B best-effort), §4 (raw-bytes outputHash — recorded decision).
- **LOW / tidy / nicety:** §5 (dropped samples), §6 (parallelize the settle — **already done in execution**).
