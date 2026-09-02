<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: DEEP-AUDIT-IV-2026-08-04-BRIEF.md
---
An absent value is no longer rendered, exported, or recorded as a measured zero. DEEP-AUDIT-IV
§3-RESULT found the `|| 0).toFixed` shape at exactly three production sites; all three are fixed.

  oxydex-render.js  an absent hrSdnn rendered `HR-Var SD 0.00 bpm` on a metric CARD → em dash
  oxydex-dsp.js     the node export wrote `hrSdnn: 0` when neither proxy was measured → null
  integrator-dsp.js `effConf: 0` sat beside `conf: null` in a finding's sources[] → null

⚠️ **`sources[].effConf` may now be null.** Consumers were traced, not assumed: it is written once,
passed through verbatim into the export (`:6861`, `:7018`), and **read by nothing** — no `*-render.js`,
`*-cross.js` or `*-app.js` mentions it, including `integrator-render.js` and `integrator-longitudinal.js`,
and the `byNode` map at `:6866` reads `o.conf`. So it serialises as JSON null and nothing sums,
averages or `.toFixed`es it. The fused posterior was never affected: `:1934` passes the UNROUNDED
`effConf()` to `combineConf`, which skips nulls.

Measured unreachable on today's corpus (0 of 3155 fusable events lack `conf`; 54 of 54 hrv blocks
non-zero) — which is exactly why it survived every gate, so it is pinned by a source scan whose COUNT
is the assertion plus one EXECUTED leg. computeHash moved for both bundles (OxyDex
cd29e2ce779e → fd19cdd172bd, Integrator baef4daf41f4 → 2090b00692b7) and **zero fixture outputs
moved**: 4 fixtures re-stamped, 11 already current, no `outputHash` in the ledger diff.
