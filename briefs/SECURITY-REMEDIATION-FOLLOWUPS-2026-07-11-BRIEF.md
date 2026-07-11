<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-11 (§2 + §3 executed; **§1 DEFERRED** — assessed infeasible as a follow-up, see below; §4 informational) · **Created:** 2026-07-11 · **Follows:** `SECURITY-REMEDIATION-2026-07-11-BRIEF.md` (executed 2026-07-11, all three phases DONE)

# Security remediation — follow-ups (what surfaced while executing F1–F7)

The parent brief closed F1–F7. These items were discovered or deliberately deferred during execution and
did not block it. None is a live injection; all are hardening / completeness.

## §1 — Nonce/hash-based `script-src` (F7 decision A deferred the strict CSP)
> **DEFERRED 2026-07-11 — assessed infeasible as a follow-up (concrete blocker).** A strict `script-src`
> (dropping `'unsafe-inline'`) would need every inline script AND every inline event handler covered by a
> build-time hash. The bundles carry **111 inline `on*=` event-handler attributes across the 10
> `.src.html`, plus ~32 handlers injected at RUNTIME via `innerHTML`** (in the external `*.js`). The
> runtime-injected ones often interpolate values, so their exact bytes aren't known at build time and
> **can't be hashed** — a strict policy would break them (and `'unsafe-hashes'` can't help). Making §1
> real therefore requires refactoring ~140 handlers to `addEventListener`/event-delegation fleet-wide — a
> large, high-risk change for **marginal** value: Phase A already escapes the sinks + `connect-src 'none'`
> already blocks all egress, so §1 only buys a backstop against a *future* injection regression (already
> covered by the escaping regression gate). **Recommendation:** keep deferred; if ever wanted, do it as its
> own dedicated brief that (1) converts inline handlers to delegated listeners, then (2) hashes the
> remaining inline `<script>`/`<style>` blocks in the owned bundler. Not worth blindly attempting here.

The shipped CSP keeps `'unsafe-inline'` for scripts (the bundles are inline `<script>`, and decision A
was "baseline now, defer nonce"). So the CSP is an **egress** control (`connect-src`), not an **injection**
backstop — a future untrusted→DOM regression's inline script would still execute. To make CSP also block
injection, teach the owned bundler (`tools/build-core.js`) to emit a per-inline-block **hash** (not a
random nonce — a nonce would break `manifestHash` determinism / `build --check`) and list the hashes in
`script-src` (+ `style-src` for inline `<style>`). Bigger change; only worth it if the injection-backstop
value is wanted on top of the escaping + `connect-src 'none'` already in place. **Deferred, not dropped.**

## §2 — Erase-all coverage of the standalone analysis pages
> **EXECUTED 2026-07-11.** `dex-forget.js` gained a second tier — `ANALYSIS_KEYS` (the `cgmcpl_*`/
> `hrvconf_*`/`nicc_*`/`striopwr_*`/`txresp_*` lock + sampling-rate localStorage keys) and `ANALYSIS_IDB`
> (the five `*_ckpt` IndexedDB checkpoints + `ganglior_cohort_pilot`). `eraseAll()` now wipes them alongside
> the Dex-app keys, so "Erase all data on this device" is honest even though those pages don't render the
> control. Kept as a SEPARATE list so the Dex-app inventory drift-guard stays scoped. Storage gate extended.

`dex-forget.js`'s `LOCAL_KEYS` + `IDB_DBS` cover the **Dex apps** (the 6 that render the profile panel) and
the Integrator longitudinal store. The standalone research/analysis pages keep their own checkpoint state
that the erase-all does **not** touch: localStorage `cgmcpl_*`, `hrvconf_*`, `nicc_*`, `striopwr_*`,
`txresp_*` and the IndexedDB DBs `cgmcpl_ckpt`, `hrvconf_ckpt`, `nicc_ckpt`, `striopwr_ckpt`, `txresp_ckpt`,
`ganglior_cohort_pilot`. These pages aren't part of the main health-data surface and their button never
renders there, so this was scoped out — but a user who ran them and wants a true "erase everything" won't
get those. Options: (a) add a second-tier "also clear analysis-tool state" list to `dex-forget.js`; (b) give
each analysis page its own erase control. Low priority.

## §3 — The erase control isn't shown in CPAPDex / the Integrator
> **EXECUTED 2026-07-11.** CPAPDex + Integrator now co-load `dex-forget.js` and mount the erase-all control
> into a `#dexForgetSlot` above their footer ribbon (via a small inline bootstrap — they don't render the
> shared profile panel). The two apps that most directly own longitudinal data now expose the control
> directly. Gate asserts both bundles co-load + mount it.

CPAPDex and the Integrator don't bundle `dex-profile.js`, so they don't render the shared profile panel and
therefore don't show the erase-all button. The **data is still erasable** (the button in any of the 6
profile apps runs `indexedDB.deleteDatabase('ganglior_integrator')` cross-app), but it's less discoverable
from the two apps that most directly own longitudinal data. Consider mounting `DexForget.ensureControl()`
into a settings/footer slot on those two bundles.

## §4 — F1 is now closed by REMOVAL, not escaping
Phase A escaped the OxyDex reload-chip filename sink; Phase C (F4 drop) then **removed** the whole
reload-last-session feature, which is strictly stronger (no filename re-enters the DOM at all) and also
took out the *inline*-shell chip Phase A hadn't touched. `dex-escape.js` remains the shared escaper for the
surviving F2 (PulseDex) / F3 (OxyDex) sinks and any future one. Nothing to do — recorded so the change in
F1's fix mechanism between phases is traceable.

## Done-when
Each item lands as its own change (or is explicitly declined in this header) with the usual gates. §1 is the
only one with real weight; §2/§3 are small; §4 is informational.
