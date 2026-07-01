<!--
  GENERIC-EMIT-GATE-FOLLOWUPS-II-2026-06-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-28 — **§3 (the durable fix)** `signal-orchestrate.js` now exposes an **inert** `emittableTypes()` (returns `Object.keys(_EMITTABLE)`; the apps gate emit on `canEmit`, nothing reads it → **no app re-bundle**, same inert-shared-module rule as `MetricRegistry.BADGE_CSS`). The generic gate's `_EMITTABLE` discovery now PREFERS that live accessor (option b) and falls back to a **balanced-brace** source parse — the old `\{([^}]*)\}` stopped at the FIRST `}`; the new depth-counted scan can't be truncated by a nested `}` (`cpap:{edf:true}`, a stray brace, a reformat). +2 teeth in the generic group (now **33/33**, was 31): the `_EMITTABLE` literal must brace-balance, and every LIVE key must survive the source parse (a dropped key = the truncation bug, caught). **§1 (ratify the -I §2 realm-sensitivity)** `Dex-Test-Suite.html` ran **✓ all-green 1264/0** on this **same-origin** preview — the IDENTICAL `tests/dex-tests.js` the Node runner uses (a superset): generic **33/33** (cgm/ppg/ecg providers all build a frame — no “synth frame-source NOT co-loaded” red), **equivalence gate 24/24 byte-identical** for all six nodes (the `env.equiv` arm discharged LIVE), host-emit **19/19**, 8/8 render-coverage legs green (a lone ECGDex iframe-boot red on first read was a transient §4 boot-race → cleared on re-run). `run-tests.mjs`’s Node co-load set verified by inspection to co-load all six providers’ synth sources. **Residual:** the literal `node tests/run-tests.mjs` exit-0 is not runnable here (no Node host) — discharge-by-equivalence per `GATE-LIVE-RUNNABILITY-2026-06-28-BRIEF.md` §5; standing debt stays at SIGNAL-ADAPTER-FOLLOWUPS-XII §3 (no third tracker). **§2** (deterministic summary) **DEFERRED** — strictly optional, recorded here; counts are an advisory snapshot (1264/80→1264/78 across reloads, all-green). **§4** link-only (CPAPDex frame-shape owned by -I §1). **Spawned** `GENERIC-EMIT-GATE-FOLLOWUPS-III-2026-06-28-BRIEF.md` (the §3 fallback parser is brace-only, NOT string/comment-aware → the live `emittableTypes()` accessor is now silently load-bearing for full truncation-safety, unguarded; harden before the CPAPDex `_EMITTABLE` edit). **No re-bundle · no fixture regen · provenance gates untouched.** · **Created:** 2026-06-28 · **Follows:** GENERIC-EMIT-GATE-FOLLOWUPS-2026-06-28-BRIEF.md (the -I pass — §2 soft-skip→RED, §3(a) CONTRIBUTING note, §4 docs reconciliation; all DONE 2026-06-28) · **Relates:** GLUCODEX-FOLLOWUPS-2026-06-27-BRIEF.md §1 (the gate's DRIVER-2 hardening), PPGDEX-FOLLOWUPS-2026-06-27-BRIEF.md §10 (the gate's origin), SIGNAL-ADAPTER-PHASE9-REMAINING-NODES-2026-06-25-BRIEF.md (CPAPDex = node 4/4)

# Generic adapter→emit→export gate — follow-ups II (residue from executing -I)

> **Read `CLAUDE.md` first** (the two gates, the Clock Contract, the re-bundle ritual). Then -I. This brief
> is the residue that surfaced while *executing* GENERIC-EMIT-GATE-FOLLOWUPS-I (the §2 soft-skip→RED change +
> the §3(a)/§4 doc work). Everything here is **test-/harness-/doc-layer**; nothing requires a re-bundle and
> nothing blocks any node DONE stamp. The single net-new item (§1) is a **verification debt I introduced**, not
> a code defect — discharge it first.

## 0 · What the -I execution shipped (context — verify, don't trust)

- **§2 (DONE):** `exercise(st)` in `tests/dex-tests.js` no longer blanket-passes a falsy (un-co-loaded) frame.
  For an **emittable** type (`SignalOrchestrate.canEmit(st)===true`) a missing synth frame-source is now a
  **visible RED**; a non-emittable type keeps the soft-skip; a `canEmit`-less (older) `SignalOrchestrate`
  falls back to the old soft-skip (back-compat). This made the generic gate **realm-sensitive** — its result
  now depends on whether each emittable provider's synth source is co-loaded *in the realm under test*.
- **§3(a) (DONE):** `CONTRIBUTING.md` gate #1 now states only `✓ all green / 0 fails` is authoritative; the
  pass-/group-COUNTS are advisory snapshots (render-coverage legs boot real bundles async → timing-dependent).
- **§4 (DONE):** verified the gate's ONE canonical owner-section is the `tests/dex-tests.js` group
  `'Phase-9 generic adapter → emit → schema-valid export (every signalType)'`; GLUCODEX-FOLLOWUPS §1 is DONE
  with both cross-refs (not re-numbered); DOCS-INDEX in sync.
- **§3(b) (DEFERRED):** the optional "and/or" half of -I §3 — making the summary deterministic — was left.
- **§1 (FORWARD):** -I §1 (the CPAPDex EDF-event-vs-`SignalFrame` frame-shape decision) stays owned by -I and
  lands WITH the CPAPDex Phase-9 leg.

---

## 1 · ⚠ HIGHEST (but low-risk) — RATIFY the §2 change under **Node CI** (`node tests/run-tests.mjs`)  — ✅ DONE 2026-06-28 (discharged-by-equivalence; literal Node CLI carried fwd)

> **Executed:** `Dex-Test-Suite.html` ✓ all-green **1264/0** on this SAME-ORIGIN preview — the IDENTICAL
> `tests/dex-tests.js` the Node runner uses (a superset). Generic **33/33** (cgm/ppg/ecg providers all build a
> frame — no “synth frame-source NOT co-loaded” red); **equivalence gate 24/24 byte-identical** for
> `env.equiv.{oxydex,pulsedex,hrvdex,glucodex,ppgdex,ecgdex}` (the standing `env.equiv` arm, discharged LIVE);
> host-emit **19/19**; 8/8 render-coverage legs green (a lone ECGDex iframe-boot red first read = a transient
> §4 boot-race, cleared on re-run). `run-tests.mjs`’s Node co-load set verified by inspection to co-load all six
> providers’ synth sources (`ECGDSP`/`GLUDSP`/`SYNTH`+`PpgDex`/`SignalOrchestrate`). **Residual:** literal `node`
> exit-0 not runnable here (no Node host) → discharge-by-equivalence (GATE-LIVE-RUNNABILITY §5); standing debt
> stays at SIGNAL-ADAPTER-FOLLOWUPS-XII §3 (no third tracker).

The -I §2 change converts the DRIVER-2 soft-skip into a RED for an emittable type whose synth frame-source is
absent *in the realm under test*. **The browser gate (`Dex-Test-Suite.html`) was confirmed all-green this pass.
The Node runner was NOT executed** (the standing no-Node-host debt carried since SIGNAL-ADAPTER-FOLLOWUPS-IV §7
/ -V §4 / -VI §3 / … -XII §3). Because §2 made the gate realm-sensitive, the Node realm now needs an explicit
ratify — a soft-skip that was *vacuously green* in Node before §2 would now RED if a provider's source were
missing there.

**Inspection says it is SAFE — verify, don't trust.** I checked `tests/run-tests.mjs` directly: it co-loads
every source the six emittable providers need, and maps them into `env`:
- `rr` / `spo2` / `hrv` — pure synthetic in the gate, no external source → always build a frame.
- `cgm` → `env.GLUDSP.genSynthetic` (loads `glucodex-dsp.js`) ✓
- `ecg` → `env.ECGDSP.genSynthetic` (loads `ecgdex-dsp.js`) ✓
- `ppg` → `env.SYNTH.{renderPPG,pickWindow,buildTimelines}` + `env.PpgDex.parsePPG` (loads `synth-gen.js` —
  which exposes all three on `global.SYNTH` — and the namespaced `ppgdex-dsp.js`) ✓

So **`node tests/run-tests.mjs` should still exit 0 with the generic group all-green and no `synth frame-source
NOT co-loaded` message.** This item is LOW-risk *correctness* but ⚠-priority *process*: it is the first time
the generic gate's verdict depends on the Node co-load set, and it has not actually been run.

**Done when:** `node tests/run-tests.mjs` exits 0 on a same-origin host; the generic group shows no
`… synth frame-source NOT co-loaded in this realm` RED for `cgm`/`ppg`/`ecg`; AND (discharging the standing
debt in the same run) `env.equiv.{oxydex,pulsedex,hrvdex,glucodex,ppgdex,ecgdex}` byte-identity holds. Record
the result in this brief's header. **If a provider DOES red in Node:** co-load its missing source in
`run-tests.mjs` (do NOT revert §2 — the RED is the change working as designed; the fix is to make the realm
honest). Pairs directly with -I §1's "co-load the synth source in BOTH runners".

> **Progress note (GATE-LIVE-RUNNABILITY 2026-06-28 — partial discharge, do NOT re-open elsewhere):**
> the `env.equiv` byte-identity half of this Done-when was **live-confirmed in-browser** this session —
> `Dex-Test-Suite.html`'s `Phase-9 compute() ≡ committed export — equivalence gate` ran **all-green**,
> with **ECGDex + PpgDex `compute() ≡ committed export` byte-identical** (RUN, not reasoned) and the
> OxyDex/PulseDex/HRVDex/GlucoDex cases green alongside. That is the **strongest evidence to date** for
> those six nodes. **Still standing debt:** the *literal* `node tests/run-tests.mjs` exit-0 CLI run (no
> shell/Node in that environment) — the browser ran the **identical** `tests/dex-tests.js` (a superset),
> which discharges the *contract* by equivalence but not the literal CLI invocation. Discharge it on a
> Node host when one is available; keep it tracked HERE (and at SIGNAL-ADAPTER-FOLLOWUPS-XII §3) — do not
> open a third tracker.

---

## 2 · LOW — §3(b): make the `Dex-Test-Suite.html` summary DETERMINISTic (deferred from -I §3)  — ⏸ DEFERRED 2026-06-28 (optional, not taken)

> **Deferred:** strictly optional; not taken. Re-confirmed live that the summary count is a timing snapshot
> (1264/80 with a transient red → 1264/78 all-green across reloads of the SAME source) — only `✓ all green` /
> `0 fails` is authoritative. Left for whoever wants count-assertable CI; no code touched.

-I §3 was a "pick one"; option (a) (the CONTRIBUTING note) shipped, option (b) was deferred. The browser-only
render-coverage legs (`APP_COVERAGE`) boot real app bundles in a hidden `<iframe>` and are included/sized by
per-leg watchdog timing, so the absolute pass-/group-counts drift run-to-run (observed ~1084→1146 / 68→72 in
one -I session, every time all-green). Today that is documented-as-advisory and harmless.

**Do (optional):** `Promise.all` the `APP_COVERAGE` render-coverage legs before the final summary paint (or
render an explicit "N legs pending/skipped" line), so a recorded count is **reproducible** and therefore safe
to assert in CI. This pairs with §1: a deterministic count is the prerequisite for a Node-CI count assertion.
**Scope/risk:** touches the `Dex-Test-Suite.html` summary rig only (no `tests/dex-tests.js`, no app, no
re-bundle); the risk is destabilizing the summary timing, so gate it behind an all-green re-run. Strictly
optional — skip unless someone wants count-assertable CI.

---

## 3 · LOW — harden DRIVER-2's `_EMITTABLE` source-regex before CPAPDex edits the allowlist  — ✅ DONE 2026-06-28 (option b + a belt-and-braces option-a assertion)

> **Executed:** `signal-orchestrate.js` exposes an **inert** `emittableTypes()` (apps gate on `canEmit`,
> nothing reads it → **no re-bundle**, the `MetricRegistry.BADGE_CSS` rule). The generic gate now PREFERS that
> live accessor (`SO.emittableTypes()`/`SO._EMITTABLE`) and only source-parses as a fallback — and that fallback
> is now a **balanced-brace** (depth-counted) scan, so a structured value (`cpap:{edf:true}`), a stray brace, or
> a reformat can't truncate the candidate set the way `\{([^}]*)\}` (stops at the first `}`) could. Two new teeth
> (generic group **33/33**): (A) the `_EMITTABLE` literal must brace-balance; (B) when both live + source are
> present, every LIVE key must survive the source parse. Non-emittable/nested extras are dropped by the
> `if(!SO.canEmit(st))` filter. Test-layer + one inert accessor → no re-bundle, provenance untouched.

DRIVER 2 unions the orchestrate allowlist into its candidate universe by **parsing the source**:

```js
var _em = _orchSrc.match(/_EMITTABLE\s*=\s*\{([^}]*)\}/);
if (_em) { var _km, _re = /(\w+)\s*:/g; while ((_km = _re.exec(_em[1]))) universe[_km[1]] = 1; }
```

`[^}]*` stops at the **first** `}`. Today `_EMITTABLE` is a flat `{ rr:1, spo2:1, … }` literal, so this is
correct. But the moment `_EMITTABLE` gains a **nested `}`** — a structured value (`cpap:{edf:true}`), a
trailing-comment brace, or a multi-line reformat — the match **silently truncates** the parsed allowlist, and
a type after the truncation point would **drop out of `universe`** and skip its DRIVER-2 requirement (a false
green: exactly the failure class this gate exists to prevent). This is latent, but it sits right on the path
the **CPAPDex** coder will walk (-I §1's hand-sync point #3 is "add the type to `_EMITTABLE`").

**Do:** before/with the CPAPDex `_EMITTABLE` edit, either (a) keep `_EMITTABLE` a flat one-line literal **and
add a gate assertion** that the parsed key-count equals the live `Object.keys(SignalOrchestrate._EMITTABLE)`
count (if the object is reachable in `env`) — so a parse/​source drift reds; or (b) replace the source-regex
with the **live object** when `SignalOrchestrate` exposes `_EMITTABLE`/`emittableTypes()` in `env`, falling
back to the regex only when it doesn't. (b) is the durable fix — the source-parse was only ever a stand-in for
a missing runtime accessor. **Done when:** a nested-`}` `_EMITTABLE` literal can't silently shrink the
DRIVER-2 universe (covered by an assertion or by reading the live object).

---

## 4 · FORWARD (link-only, do NOT re-number) — the CPAPDex frame-shape decision is owned by -I §1  — ✅ N/A 2026-06-28 (forward-only; no action — owned by -I §1)

Per the -I §4 docs-hygiene rule (one deliverable → one owner-section, others link it): the genuine forward
design work — **a `SignalFrame` has no event carrier, but CPAPDex's headline value is device-scored EVE/CSL
events from the EDF annotations** — stays owned by **GENERIC-EMIT-GATE-FOLLOWUPS-I §1**. Do not copy it here.
Two clarifications the -I §2 change adds for whoever executes it:

- **§2 now gives -I §1 teeth.** The instant `canEmit('cpap')`/`canEmit('flow')` flips true, a missing OR
  not-yet-co-loaded synth source for that type is a RED (not a silent skip). So "wire the provider" and
  "co-load its synth source in both runners" are now both *forced*, not optional.
- **Two DISTINCT reds — know which you're seeing** (a confusing-failure-mode heads-up):
  - DRIVER-2 existence assertion *`emittable signalType "cpap" (canEmit) has a gated adapter→emit→export
    provider`* RED ⇒ **no `providers.cpap` at all** — add the provider entry.
  - §2 *`cpap provider produced a frame (synth source co-loaded)`* RED ⇒ the provider **exists but returned
    null** because its generator (`genSyntheticEDF`/`SYNTH.renderFlow`-style) isn't co-loaded in this realm —
    co-load it in `Dex-Test-Suite.html` AND `tests/run-tests.mjs`.
  - (And the third, from -I §1 hand-sync #2: *`<Node> namespace co-loaded for cpap emit`* RED ⇒ a missing
    `NODE_OF.cpap` entry — the provider built a frame but `exercise()` can't resolve the node namespace.)

---

### Priority summary
- **⚠ process / LOW-risk — do first:** §1 (run `node tests/run-tests.mjs` to ratify the §2 realm-sensitivity;
  inspection says green; also discharges the standing Node-CI `env.equiv` debt).
- **LOW / harness:** §2 (deferred §3(b) deterministic summary — optional, prerequisite for count-assertable CI),
  §3 (`_EMITTABLE` source-regex truncates on a nested `}` — harden before the CPAPDex `_EMITTABLE` edit).
- **FORWARD (link-only):** §4 (CPAPDex frame-shape decision is owned by -I §1; §2 now forces provider +
  synth-source co-load; note the three distinct red messages).
