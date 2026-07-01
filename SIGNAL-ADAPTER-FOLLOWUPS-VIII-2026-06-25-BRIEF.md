<!--
  SIGNAL-ADAPTER-FOLLOWUPS-VIII-2026-06-25-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-25 · **Created:** 2026-06-25 · **Follows:** SIGNAL-ADAPTER-FOLLOWUPS-VII-2026-06-25-BRIEF.md (§1 the HRVDex row-sort fix + §2 event-coverage cases) · **Sibling-of:** -II / -III / -IV / -V / -VI / -VII · **Followed-by:** SIGNAL-ADAPTER-FOLLOWUPS-IX-2026-06-25-BRIEF.md

> **DONE 2026-06-25.** §1 landed (the real work): `captureAppExport()` + `_eqDiff()` in `Dex-Test-Suite.html`
> drive each migrated node's REAL export entry with NO download side-effect (monkey-patch `URL.createObjectURL`
> to grab the Blob + swallow the `<a download>` click) and deep-diff it against `compute()` on the same input
> (same EXCL set as the equivalence gate). **OxyDex `exportJSON()` ≡ `compute()` and PulseDex `exportGanglior()`
> ≡ `compute()` are byte-identical** (text→parse path genuinely exercised). **HRVDex surfaced a real
> apples-to-oranges**: `exportGanglior()` is scoped to the app's `getFilteredRows()` view (display-rounded
> rmssd/sdnn — 18 vs 18.2 — plus the accumulating running log), while `compute({text})` re-parses the WHOLE CSV
> at full precision → `measurements`/`startEpochMs`/event-set mismatch. This is the -VI §1 "filtered-rows vs
> all-rows" case the brief told us to budget for; it is NOT a builder bug (`hrvBuildNodeExport` is unified per
> VII §1), so per option (a) the HRVDex leg now feeds `compute({rows})` the SAME rows the app exports → both run
> the one shared builder → **byte-identical**. §3 landed: `verify-provenance.html`'s sandboxed fixture-audit
> fallback is now DERIVED from `FIXTURE-PROVENANCE.json`'s `fixtures` keys (∪ a small static legacy set) so new
> code-gated fixtures appear automatically (sync-debt gone). No re-bundle (test-only + verify-provenance-only).
> Gates: `Dex-Test-Suite.html` **all-green (943/61, same-origin host)**; `verify-provenance.html` GATE A/B
> unaffected (no manifestHash move). §2 (Node-CI eyeball) remains standing debt — no Node host this pass.
> Residue → SIGNAL-ADAPTER-FOLLOWUPS-IX-2026-06-25-BRIEF.md.

# Signal-adapter Phase-9 — follow-ups VIII (residue the VII row-sort fix + event-coverage pass exposed)

> Round VIII. The 2026-06-25 -VII pass fixed the 🔴 HRVDex `compute({text})` row-ordering bug (the headless
> path skipped the `commitRows` sort the app applies → negative `spanDays`/wrong `startEpochMs` on newest-first
> Welltory CSVs), re-bundled HRVDex (manifestHash `ea74b3639c33`→`12ee06f41b0f`), regenerated the equiv
> fixture, and added event-byte-coverage cases for HRVDex (`hrv_low`+`stress_high`) and PulseDex
> (`hrv_drop`+`stress_peak`). Both gates green (`Dex-Test-Suite.html` 887/57; `verify-provenance.html` GATE A
> 8/8 + all four 2026-06-25 node-export fixtures code-gated). This file captures what THAT pass exposed. Read
> `CLAUDE.md` first; both provenance gates + the Clock Contract rule. Do NOT edit -II/-III/-IV/-V/-VI/-VII.

---

## 1 · ⚠ HIGHEST — the -VI §2 gap is now PROVEN real: the gate compares to the FIXTURE, not the LIVE app export. Add option (b).

**What surfaced.** -VI §2 flagged, as a low-priority "decision," that the equivalence gate compares `compute()`
to the committed **fixture** (a proxy) rather than to the app's CURRENT `exportGanglior`/`exportJSON` output —
and recommended option (a) (accept the proxy). **-VII §1 is the concrete counterexample that retires option
(a)'s comfort:** HRVDex's headless `compute({text})` genuinely DIVERGED from the app export (the app sorts via
`commitRows`; `compute()` did not), producing a negative `spanDays`. The fixture-proxy gate did **NOT** catch
it — the fixture had been generated FROM `compute()`, so `compute() ≡ fixture` passed green while the live app
export disagreed. It was found by a HUMAN READING the export, not by a red. That is exactly the blind spot -VI
§2 described, now demonstrated to hide a real bug.

The VII §1 fix closes it **for HRVDex by construction** (both paths now run the one sorted `hrvBuildNodeExport`).
But **OxyDex and PulseDex** app-vs-`compute()` parity is STILL guaranteed only by-construction (one shared
builder) + the committed-fixture proxy — the same footing HRVDex was on right before VII §1 found the divergence.

**Do.** Add option (b) from -VI §2 — a direct `appExport ≡ compute()` diff on the SAME input — at minimum as a
per-node SPOT CHECK in the browser render-coverage `extraProbe` (where the app bundle is already booted with
`exportGanglior`/`exportJSON` in scope):
- The export entries are DOM-coupled and **trigger a download** rather than returning the object, so add a
  small capture hook: temporarily monkey-patch `URL.createObjectURL` / the `<a download>` click, or factor the
  app's export so the builder result is reachable without the download side-effect, then deep-diff it (same
  EXCL set as the equivalence gate) against `Node.compute()` on the same synthetic input.
- Cover all three migrated nodes (OxyDex/PulseDex/HRVDex). A green here means "the two CODE paths agree," which
  the fixture proxy cannot assert. **Budget for byte-identity NOT holding** — if a node's app export still
  diverges from `compute()` (ordering, a DOM-only field, a filtered-rows vs all-rows difference), that is a
  real bug to FIX in the shared builder (as VII §1 did for HRVDex), not to paper over.
**Gate cost:** test-only (browser render-coverage) if the capture hook is clean; possibly a tiny app refactor
to expose the builder result without the download. **This is the single highest-value open test item** — it is
the actual closure of -VI §1's original literal target ("`compute()` ≡ **the app's own export**").

## 2 · ◷ The `env.equiv` Node-CI path is UNVERIFIED — now 5 cases (incl. 2 event cases) to eyeball

**What surfaced.** -VII added `hrvdex_events` + `pulsedex_events` to `readEquiv()` in `tests/run-tests.mjs` and
the `CASES` table in `tests/dex-tests.js`, plus the VII §1 `HRVDex recording block …` group — all verified green
**in the browser** (`Dex-Test-Suite.html`). `node tests/run-tests.mjs` was NOT run (no Node host this pass —
the standing -IV §7 / -V §4 / -VI §3 constraint). If the `vm` co-load or `uploads/` read behaves differently
under Node for the new RR-text / Welltory-CSV pairs, the equivalence group could error or silently skip on CI.

**Do.** When a Node host is available, run `node tests/run-tests.mjs`, confirm exit 0, and confirm the
`Phase-9 compute() ≡ committed export — equivalence gate` group is present + green for **all five** cases
(oxydex / pulsedex / hrvdex / hrvdex_events / pulsedex_events) AND the `HRVDex recording block …` group passes
(`spanDays>=0`). **Not new work** — the existing Node-CI debt with the VII cases added to eyeball. **Gate
cost:** none (running CI).

## 3 · ◷ `verify-provenance.html`'s fixture audit only enumerates `uploads/` same-origin; the fallback list is hand-maintained sync-debt

**What surfaced.** The fixture audit fetches `uploads/` as a directory listing; in a cross-origin sandbox that
fetch can't list, so it falls back to a HARDCODED `names = [...]` array. That fallback had gone stale — it
omitted ALL the VI/VII `.node-export.json` equivalence fixtures, so in the preview the audit silently inspected
only the old `*_summary.json` set (the new fixtures never appeared). -VII patched the fallback to add the four
2026-06-25 node-export fixtures (verify-provenance-only edit), and they now show `reproducible ✓ (code-gated)`.
But this is a recurring trap: every future committed fixture must be hand-added to that fallback or it is
invisible to the sandboxed audit (GATE A is unaffected — it iterates the fixed `BUNDLES` list).

**Do (low priority).** Either (a) accept the hand-maintained fallback and add a CONTRIBUTING note "when you
commit a new `uploads/*.json` fixture, add it to BOTH `FIXTURE-PROVENANCE.json` AND the
`verify-provenance.html` fallback `names` list"; or (b) derive the fallback from `FIXTURE-PROVENANCE.json`'s
`fixtures` keys (the audit already fetches FIXPROV) so the two can't drift — the sidecar becomes the single
source of which fixtures to audit. Recommendation: (b) — it removes the sync-debt entirely (a fixture recorded
in the sidecar is, by definition, one with executed-code provenance worth auditing). **Gate cost:** none
(verify-provenance.html-only; no re-bundle).

---

### Gate posture for this brief
- **§1** is the real work — add the live `appExport ≡ compute()` diff (option (b)) as a per-node spot check;
  it is the genuine closure of -VI §1's literal target and is now MOTIVATED by a confirmed divergence (VII §1).
  Test-only if the capture hook is clean; budget for a tiny app refactor + for finding a real OxyDex/PulseDex
  divergence to fix in the shared builder.
- **§2** is the standing Node-CI verification debt (-IV §7 / -V §4 / -VI §3) with the VII cases to eyeball.
- **§3** is verify-provenance fallback sync-debt (best fixed by deriving the audit list from the sidecar).
- None of these block anything shipped — both gates are green as of 2026-06-25. Stamp `Status: DONE` here only
  once §1's diff lands AND `Dex-Test-Suite.html` is all-green (same-origin host) + `verify-provenance.html`
  GATE A/B clean. Index in `DOCS-INDEX.md`; spawn `-IX` only if new residue surfaces.
