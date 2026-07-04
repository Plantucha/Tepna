<!--
  GENERIC-EMIT-GATE-FOLLOWUPS-III-2026-06-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-28 · **Created:** 2026-06-28 · **Executed:** §1 landed — the generic-emit gate's `_EMITTABLE` fallback parser is now STRING/COMMENT-AWARE (`tests/dex-tests.js` `_emittableSrcKeys`: brace depth counts only in CODE state, skipping `//line` · `/*block*/` · `'…'`/`"…"`/`` `…` `` — a commented/quoted `}` can no longer truncate the allowlist on the FALLBACK path, closing -II §3's "trailing-comment brace" risk WITHOUT resting on the live accessor). Teeth: A (literal closes under the comment-aware scan), B (every live key survives the parse, -II §3), C/§1b (source DECLARES `emittableTypes()` but the loaded module LACKS it → RED — a stale/mis-loaded realm) + a `!_emLive` downgrade ANNOUNCE, and a 5-case red-fires PROOF (flat · nested-value · line-comment · block-comment · string brace each keep the key after the `}`). §2/§3/§4 = no-action (document/link-only). TEST-LAYER ONLY → no re-bundle, no provenance change (GATE A unchanged by construction). Shared-assertion suite green incl. the whole generic-emit group (the -III §1 teeth A/B/C + the 5 red-fires all pass); the lone suite red is the documented **ECGDex render-coverage iframe-boot transient** (§3 / GATE-LIVE-RUNNABILITY §4) — ECGDex.html verified to boot CLEAN standalone (live `GangliorProvenance`, app rendered, zero console errors) and in verify-provenance's iframe (GATE A 8/8), so NOT a bundle defect. · **Follows:** `GENERIC-EMIT-GATE-FOLLOWUPS-II-2026-06-28-BRIEF.md` (the -II pass — §3 `_EMITTABLE` discovery hardened to prefer a live `SignalOrchestrate.emittableTypes()` accessor with a balanced-brace source fallback; §1 ratified live all-green; all DONE 2026-06-28) · **Relates:** `GENERIC-EMIT-GATE-FOLLOWUPS-2026-06-28-BRIEF.md` (-I, the gate's DRIVER-2 + §2 soft-skip→RED), `GLUCODEX-FOLLOWUPS-2026-06-27-BRIEF.md` §1 (DRIVER-2 origin), `SIGNAL-ADAPTER-PHASE9-REMAINING-NODES-2026-06-25-BRIEF.md` (CPAPDex = node 4/4, the imminent `_EMITTABLE` editor), `GATE-LIVE-RUNNABILITY-2026-06-28-BRIEF.md` §4 (the render-coverage timing caveat)

# Generic adapter→emit→export gate — follow-ups III (residue from executing -II §3)

> **Read `CLAUDE.md` first** (the two gates, the inert-shared-module re-bundle rule, the Clock Contract). Then
> -II. This brief is the residue that surfaced while *executing* -II §3 — i.e. it is feedback on the fix that
> pass shipped, found by scrutinising my own change. Everything here is **test-/harness-/doc-layer**; nothing
> requires a re-bundle and nothing blocks any node DONE stamp. The single net-new item (§1) is a
> **defense-in-depth weakness I introduced on the fallback path**, latent today (the live accessor masks it),
> but it sits squarely on the path the **CPAPDex** coder will walk.

## 0 · What -II §3 shipped (context — verify, don't trust)

`signal-orchestrate.js` gained an **inert** `emittableTypes()` accessor (returns `Object.keys(_EMITTABLE)`; apps
gate emit on `canEmit`, nothing reads it → no re-bundle, the `MetricRegistry.BADGE_CSS` rule). In
`tests/dex-tests.js`'s generic group, `_EMITTABLE` discovery now:
1. **prefers the live accessor** — `SO.emittableTypes()` (or `SO._EMITTABLE`) — and unions its keys into the
   DRIVER-2 candidate `universe`;
2. **falls back to a balanced-brace source parse** (a depth-counted scan to the matching `}`) when the accessor
   is absent — strictly better than the old `\{([^}]*)\}` (which stopped at the FIRST `}`);
3. adds two assertions — **teeth A** `_EMITTABLE source literal brace-balances`, **teeth B** `source parse
   retains every live key`.

Verified live: generic group **33/33** (both teeth green), full suite **✓ all-green 1264/0** same-origin.

---

## 1 · ⚠ HIGHEST (but low-risk, latent) — the fallback parser is NOT string/comment-aware, so the live accessor is now SILENTLY load-bearing for full truncation-safety

The -II §3 fallback scanner counts `{`/`}` depth but does **not** skip braces inside **line comments, block
comments, or quoted strings** within the `_EMITTABLE` literal. And **teeth A** only checks `_end > _open` — that
*a* depth-0 close brace was found, **not that it is the correct, literal-closing one**. So a `}` inside a comment
or string sets `_end` early and teeth A **still passes**:

```js
var _EMITTABLE = { rr:1, /* legacy } */ spo2:1, hrv:1, cgm:1, ppg:1, ecg:1 };
//                          ^ scanner stops HERE: depth 1→0, _end set, teeth A passes,
//                            parsed body = " rr:1, /* legacy " → only {rr}; spo2…ecg DROPPED
```

This is **exactly the "trailing-comment brace" case -II §3 named as a risk** — closed for the live-accessor path
but **re-opened on the fallback path**. Why it does **not** bite today (so it is latent, not a live red):
- the live accessor IS present in both runners → the candidate `universe` is unioned from `_emLive` (correct),
  **not** from the truncated `_emSrc`; and
- **teeth B** (`_emLive && _emSrc`) reds on the live-vs-parse mismatch — so the comment-brace surfaces loudly.

**The residual is the dependency itself:** full truncation-safety now **rests entirely on the live accessor
being present**, and **nothing asserts that it is**. Two ways it silently degrades to the weaker fallback:
1. someone removes `emittableTypes()` from `signal-orchestrate.js` (or renames `_EMITTABLE` so `Object.keys`
   returns the wrong thing);
2. a realm loads an **older** `signal-orchestrate.js` build that predates the accessor (the back-compat case
   -II §3 deliberately preserved with the `typeof SO.emittableTypes === 'function'` guard).

In either, `_emLive` is `null` → teeth B is skipped → the union uses the **brace-only** `_emSrc`. A comment/string
`}` positioned **before a fully-bespoke `_EMITTABLE`-only type** (no `SignalSpec` entry, no registered adapter,
no provider — i.e. **the CPAPDex `cpap`/`flow` case**) would then **silently drop that type from `universe`**,
and DRIVER-2 would not require its provider — **the false-green -II §3 exists to prevent**, reintroduced. (Types
that are *also* in `SignalSpec`/adapters/providers — rr/spo2/hrv/cgm/ppg/ecg — stay covered regardless, so only
the bespoke-only type is at risk; that is precisely the new node's headline type.)

**Do (pick deliberately; (a) is the durable core):**
- **(a) make the fallback scanner string/comment-aware** — skip `//…\n`, `/*…*/`, and `'…'`/`"…"` while
  depth-counting — so the fallback **alone** is truncation-proof and -II §3's "trailing-comment brace" risk is
  closed *without* depending on the live accessor. (Small, self-contained; the durable completion of -II §3.)
- **(b) guard the load-bearing accessor + announce the downgrade** — when `env.sources['signal-orchestrate.js']`
  matches `/emittableTypes\s*\(/` but `typeof SO.emittableTypes !== 'function'`, **RED** (a source/runtime
  mismatch — a stale or mis-loaded realm); and when the gate **does** fall back (`!_emLive`), add a visible
  WARN-style test (`emit-allowlist discovered via best-effort source parse — live accessor absent in this
  realm`) so a silent downgrade can't pass unnoticed. (Cheap; complements (a).)
- Optionally tighten **teeth A** to verify the captured close brace is the *last* depth-0 brace, not merely *a*
  depth-0 brace — subsumed by (a).

**Done when:** a comment/string `}` inside `_EMITTABLE` cannot silently shrink the DRIVER-2 universe **on the
fallback path** (not only via the live accessor); AND a realm whose `signal-orchestrate.js` source declares
`emittableTypes()` but whose loaded module lacks it RED-s. `Dex-Test-Suite.html` stays ✓ all-green; pairs with
the CPAPDex `_EMITTABLE` edit (do (a)/(b) before or with it). Test-layer only — **no re-bundle**.

---

## 2 · LOW (known/expected — document, no action) — the inert `emittableTypes()` is source-ahead-of-bundle and will ride the next host re-bundle

`signal-orchestrate.js` is bundled into `Data Unifier.html` + `OverDex.html`. The -II §3 accessor was added to
**source only** (no re-bundle — it is inert, the `BADGE_CSS` rule), so those committed bundles still carry the
pre-accessor `signal-orchestrate.js`. This is **correct and intentional** (runtime is identical; nothing reads
`emittableTypes` in the apps; re-bundling two hosts just to carry an inert method would move their `manifestHash`
+ force a `BUILD-MANIFEST.json` update for zero behavioral gain). The only consequence to flag so the **next
re-bundler isn't surprised**: the next time either host is rebuilt for *any* reason, its bundled
`signal-orchestrate.js` will gain `emittableTypes()` and its `manifestHash` will move accordingly — an expected,
unrelated diff riding along, **not** a regression. **Provenance is untouched by construction this pass:** no
bundle file changed → every `manifestHash` is unchanged → `verify-provenance.html` GATE A is green without being
re-run (and `buildHash` does not move for an external-module source edit — `CLAUDE.md`). **No action**; recorded
so the fact is greppable rather than rediscovered.

---

## 3 · LOW (link-only, do NOT re-track) — a transient render-coverage red was observed again; it reinforces the already-deferred deterministic-summary work

Executing §1's verification, the first settled read of `Dex-Test-Suite.html` showed **1 red** —
`Render coverage — ECGDex … :: bundle loads in iframe` (empty detail) — in an **untouched** group; a reload
returned **✓ all-green 1264/0** with all 8 render-coverage legs green (ECGDex 13/13). This is the exact
**transient iframe-boot race** documented at `GATE-LIVE-RUNNABILITY §4` (read-before-settle / `waitForRender`
14 s-per-rig guard mitigates-not-eliminates) and is the live cost of the timing-nondeterminism that
**-II §2** (≡ -I §3(b), the deferred-optional deterministic-summary: `Promise.all` the `APP_COVERAGE` legs before
the final paint) would remove. **No new tracker** — this is fresh evidence for, and stays owned by, **-II §2** /
`GATE-LIVE-RUNNABILITY §4`. Operational rule unchanged: only **✓ all green after the group count stabilises** is
a pass; a lone render-coverage red is **suspect — re-run** before treating it as a regression.

---

## 4 · Standing debt (link-only, do NOT re-open) — literal Node-CI run

Unchanged by this pass: the literal `node tests/run-tests.mjs` exit-0 is not runnable in-environment (no Node
host). It stays **discharged-by-equivalence** (the identical-superset same-origin browser run) per
`GATE-LIVE-RUNNABILITY §5`, tracked at `SIGNAL-ADAPTER-FOLLOWUPS-XII §3` (and -II §1). The §1 fix above lands in
`tests/dex-tests.js`, which **both** runners share, so when a Node host appears it ratifies in one run — no
separate Node work. Do **not** open a third tracker.

---

### Priority summary
- **⚠ before/with the CPAPDex `_EMITTABLE` edit:** §1 (the -II §3 fallback parser isn't string/comment-aware →
  the live `emittableTypes()` accessor is silently load-bearing for full truncation-safety; make the fallback
  comment/string-aware **and** guard against a silent downgrade — both test-layer, no re-bundle).
- **LOW / docs:** §2 (inert accessor is source-ahead-of-bundle — expected, will ride the next host re-bundle;
  provenance untouched by construction; no action).
- **LOW / link-only:** §3 (a transient render-coverage red reinforces the deferred -II §2 deterministic summary
  — don't re-track), §4 (literal Node-CI run stays the standing debt at SIGNAL-ADAPTER-FOLLOWUPS-XII §3).

---

## Executed (2026-06-28)

§1 landed in `tests/dex-tests.js` — the comment/string-aware `_emittableSrcKeys` scanner (depth-counts
braces only in CODE state; skips `//line` · `/*block*/` · `'…'`/`"…"`/`` `…` `` strings), plus teeth A
(closes under the comment-aware scan), B (every live key survives the parse, -II §3), C/§1b (source
declares `emittableTypes()` but the loaded module lacks it → RED) + a `!_emLive` downgrade announce, and
a 5-case red-fires PROOF (flat · nested-value · line-comment · block-comment · string brace — each keeps
the key after the `}`). §2/§3/§4 were no-action (document/link-only). **Test-layer only — no re-bundle,
provenance untouched by construction** (no bundle file changed → every `manifestHash` unchanged →
`verify-provenance.html` GATE A green without re-running). The shared-assertion suite is green including
the whole generic-emit group; the single suite red is the documented **ECGDex render-coverage iframe-boot
transient** (§3 / GATE-LIVE-RUNNABILITY §4) — `ECGDex.html` verified to boot clean standalone (live
`GangliorProvenance`, app rendered, zero console errors) AND inside `verify-provenance.html`'s iframe
(GATE A 8/8), so it is a host/timing artifact, **not** a bundle defect. No new residue → no `-IV`.
