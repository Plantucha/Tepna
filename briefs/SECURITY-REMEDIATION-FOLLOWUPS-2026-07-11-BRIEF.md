<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-11 (§2 + §3 executed; **§1 EXECUTED 2026-07-11** via `SECURITY-CSP-STRICT-SCRIPT-SRC-2026-07-11-BRIEF.md` — the strict hash-based `script-src` shipped; §4 informational) · **Created:** 2026-07-11 · **Follows:** `SECURITY-REMEDIATION-2026-07-11-BRIEF.md` (executed 2026-07-11, all three phases DONE)

# Security remediation — follow-ups (what surfaced while executing F1–F7)

The parent brief closed F1–F7. These items were discovered or deliberately deferred during execution and
did not block it. None is a live injection; all are hardening / completeness.

## §1 — Nonce/hash-based `script-src` (F7 decision A deferred the strict CSP)
> **DONE 2026-07-11 — executed via `SECURITY-CSP-STRICT-SCRIPT-SRC-2026-07-11-BRIEF.md`.** The strict,
> hash-based `script-src` shipped: all ~150 inline `on*=` handlers (`.src.html` markup + runtime
> `innerHTML` strings) were converted to a shared event-delegation dispatcher (`dex-actions.js`,
> `data-act`), the owned bundler (`tools/build-core.js`) now hashes every inline `<script>` block
> (`sha256` base64, sorted → `build --check` byte-stable), and `'unsafe-inline'` was dropped from
> `script-src` fleet-wide (`style-src` keeps it — explicit non-goal). CSP is now an **injection**
> backstop, not just the `connect-src 'none'` egress control: an injected `<script>`/`<img onerror>`
> no longer executes (proven by the Playwright negative control + the `security · csp-strict` gate).

_(Historical context — now executed.)_ Decision A shipped `'unsafe-inline'` for scripts as the baseline
and deferred the strict policy; that made the CSP an **egress** control (`connect-src`) but not an
**injection** backstop. The execution (see the strict-CSP brief) taught the owned bundler
(`tools/build-core.js`) to emit a per-inline-block **hash** (not a random nonce — a nonce would break
`manifestHash` determinism / `build --check`) and list the hashes in `script-src`; `style-src` keeps
`'unsafe-inline'` (inline styles are pervasive; style injection is not code execution — non-goal). **Done.**

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
