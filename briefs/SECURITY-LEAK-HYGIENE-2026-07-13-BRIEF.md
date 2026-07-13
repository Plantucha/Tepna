<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-13 · **Executes:** `audits/PRIVACY-SECURITY-AUDIT-FINDINGS-2026-07-13.md` N2 + N3 · **Follows:** `SECURITY-REMEDIATION-2026-07-11-BRIEF.md` (the F1/F2/F3 escaper pass — this closes the two hygiene residues in the nodes that pass left untouched)

# Leak hygiene — OxyDex raw-data console logging (N2) + PpgDex unescaped error toast (N3)

## Goal & non-goals
**Goal:** close the two remaining privacy/hygiene residues the F1–F7 remediation didn't cover, both
**LOW**, both **EXPORT-INERT** display/logging fixes — consolidated into one brief the way F1/F2/F3 were
(they share the escaper + re-bundle machinery). **Non-goals:** no `compute()`/export change, no new metric,
no CSP work (N1 is its own brief).

## N2 · OxyDex leaks the raw filename + raw CSV header bytes to the console on every load
**Demonstration.** Four **unconditional** `console.log`s in `oxydex-dsp.js` (no debug guard):
- `:368` — `console.log('[O2Ring] Detected native binary format:', file.name, _bytes.length, 'bytes')`
- `:380` — `console.log('[O2Ring] readFile:', file.name, 'length:', text.length, 'first50:', text.substring(0, 50))`
- `:441` — `console.log('[O2Ring] cleanText starts:', cleanText.substring(0, 60))`
- `:443` — `console.log('[O2Ring] Summary CSV detected — export-only format, not re-imported')`

`file.name` is the **raw, unscrubbed** filename (F4's vector — can embed a patient name); the CSV
first-50/60 bytes are raw recording header content. Console output is **local-only** (no network sink — the
no-network invariant contains any exfil), so this is a **minimization/transparency** issue, not an egress
one: raw signal + an identifying name are written to the browser console beyond what the analysis needs.

**Do.** Remove the four `console.log`s. If a diagnostic is genuinely wanted, gate behind an explicit
`window.__oxyDebug` flag (default off/undefined) **and** log only a scrubbed name
(`SignalFrame.scrubFilename(file.name)`) + counts — **never** the raw `text`/`cleanText` substring. While in
the file, sweep the other `oxydex-dsp.js` `console.log`s (9 total) and strip any that dump raw content;
leave error/warn diagnostics that carry no raw signal.

## N3 · PpgDex's error toast is an unescaped `innerHTML` sink (F3-class, the node the escaper pass skipped)
**Demonstration.** `ppgdex-app.js:783` — `function showErr(msg){ …a.innerHTML='⚠ '+msg… }` (and `:784`
`showOK`). Callers `:87`/`:119`/`:133` pass `e.message||String(e)` from the parse/compute `catch`. Shipped
`throw`s in `ppgdex-dsp.js` are static (so no live payload is *proven* — hypothesis-adjacent, exactly as F3
was), but the sink is `innerHTML` over a non-guaranteed-static value, and PpgDex was **outside** the F1/F2/F3
scope. It is the lone inconsistent error path: ECGDex (`:1709-10`) + GlucoDex (`:1106-07`) use
`.textContent`; PulseDex (`:328`) uses `escapeHTML`; OxyDex's F3 was folded in.

**Do.** Route `msg` through the shared escaper — `a.innerHTML = '⚠ ' + escapeHTML(msg)` (and `'✓ ' +
escapeHTML(msg)` in `showOK`) using the fleet-loaded `dex-escape.js` (`escapeHTML`), matching how PulseDex
`res.error` is handled — or set `.textContent` on a child span, matching ECGDex/GlucoDex. Prefer `escapeHTML`
so the `⚠`/`✓` prefix + any intentional markup-free message renders unchanged.

## Do (both)
1. Edit `oxydex-dsp.js` (N2) and `ppgdex-app.js` (N3) — the external `.js`, never the bundled `.html`.
2. `node tools/build.mjs --app OxyDex` and `node tools/build.mjs --app PpgDex` (auto-writes each
   `manifestHash` + re-stamps code-gated fixtures). `node tools/build.mjs --check` (drift guard).
3. Add gate coverage:
   - **N3:** a source-mirror assertion in the F1/F2 family (the `security · …` group in `tests/dex-tests.js`)
     asserting PpgDex's `showErr`/`showOK` route through `escapeHTML`/`.textContent` (no raw `innerHTML='…'+msg`).
   - **N2:** a source-mirror assertion that `oxydex-dsp.js` carries no `console.log` of `file.name` /
     `text.substring` / `cleanText.substring` (regression net against the debug logging returning).

## Done when
- OxyDex logs no raw filename/CSV bytes to the console on load; PpgDex `showErr`/`showOK` render file-derived
  `catch` text escaped. Both source-mirror assertions pass.
- Both re-bundles are **EXPORT-INERT**: `manifestHash` re-recorded only, **no fixture output moved** (verify
  each node's `env.equiv` leg stays green — logging/display-only). `verify-provenance.html` clean · GATE-A 8/8.
- `Dex-Test-Suite.html?full` all-green · `build.mjs --check` clean · `no-network.html` green (unchanged).
- A changeset in `changes/` (`bump: patch` — no contract shape changes; hygiene/security fixes that don't move
  a fixture output).

## Notes
- Touches no frozen name / the `ganglior.node-export` schema / the Clock Contract. Two bundles
  (OxyDex + PpgDex), both `manifestHash`-only. If landing second behind another bundle-touching PR, rebase +
  re-run `build.mjs --app OxyDex --app PpgDex` per CLAUDE.md §👥.3.
