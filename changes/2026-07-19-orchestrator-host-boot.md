<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [ecgdex, ppgdex, glucodex, cpapdex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
**OverDex and Data Unifier could not compute ECG, PPG, CGM or CPAP at all.**

`signal-orchestrate.js` defines seven host shims. `emitNodeExport()` dispatches all seven. `canEmit()`
advertised all seven. But both shipped orchestrators booted exactly **three** — `pulseHost` / `oxyHost` /
`hrvHost` — from hand-written `needPulse` / `needOxy` / `needHrv` blocks. A repo-wide search finds **zero
callers** of `glucoHost`, `ppgHost`, `ecgHost` or `cpapHost`.

So a dropped ECG file passed `canEmit('ecg')`, reached `emitNodeExport()`, hit a never-populated `_ecgWin`,
and threw:

```
signal-orchestrate: ECGDex.compute unavailable (co-load the namespaced ecgdex-dsp.js)
```

— **blaming a co-load that is demonstrably present in the `.src.html`.** The generic handler caught it into
`it.runNote = 'run error: …'`, the file dropped out of `exports[]`, and the run continued and reported
success on whatever RR/SpO₂/HRV files happened to be in the same drop. Four of the suite's nine nodes were
unreachable through either orchestrator, and the error message pointed at the wrong thing.

## The fix is structural, not four more copy-pasted blocks

The allowlist and the hosts are now **one table**. `_EMITTABLE` is derived from `_HOSTS`, and `canEmit()`
reads `_HOSTS` directly, so a type is emittable **iff** a host function exists to boot it. The two cannot
drift apart again, and adding a node is one row.

Both apps now boot from what was actually dropped rather than from a hardcoded trio:

- **OverDex** derives the needed signal types from `ITEMS` and calls `ORCH.bootHosts(needed)`.
- **Data Unifier** boots `ORCH.emittableTypes()` — every host is lazy and idempotent, so this costs nothing
  for signals not present.

`bootHosts()` **never rejects**: a host that fails to load yields `{ type, ok:false, error }`, so one
unavailable node cannot abort a mixed drop — the failure is reported against the files that needed it. A
file whose host genuinely failed now says so (`ecg compute host unavailable: …`) instead of claiming there
is "no compute path".

## The guarding gate was hollow

`Host emit allowlist — SignalOrchestrate.canEmit covers the migrated nodes` asserted `canEmit('ecg') === true`
(a key lookup in an object literal) and `/st === 'ecg'/.test(orchSrc)` (a **regex over source text**). Every
assertion checked the allowlist and the dispatch table — the two things that were **correct** — while the
label promised the live hosts emit. Not one booted a host. It passed green with four nodes 100 %
non-functional.

It now asserts the property that was actually false: **every emittable signal has a bootable host.**
Mutation-verified — restoring the parallel hand-written allowlist reds it with `hostless: cgm, ppg, ecg, cpap`,
naming the exact four nodes that were broken.

## A second hollow-gate vector, found and closed

Writing this gate surfaced a harness flaw: `group()` runs its body **synchronously and discards the return
value**, so any assertion made inside a `.then()` lands after the group is sealed and **vanishes without
trace** — a green gate that never ran. My first draft of the boot assertions was exactly that shape.

`group()` now fails loudly when a body returns a thenable. Verified with a probe group whose async assertion
was `false`: the harness reports the promise, and the probe's own assertion never appears — confirming the
loss was real. The boot logic is instead exposed as a pure `plannedHosts(types)` (filter to known signals,
de-duplicate, preserve drop order) and gated synchronously — the same "extract the pure decision" move used
for `triIdxGrade` and `planCompanionGraft`.

The `_EMITTABLE` source-literal scan was retargeted to `_HOSTS`, which is where the truncation risk it exists
to catch now lives. Its five scanner self-tests are non-vacuous — they caught the retarget — and their
fixtures moved with it.

## Provenance

No GATE-A bundle moved: `signal-orchestrate.js`, `overdex-app.js` and `data-unifier-app.js` reach only the two
orchestrators, which are `--check`-guarded but outside GATE A and carry no fixtures. Both rebuilt. Suite 3309
passing, zero skips; GATE A 9/9, GATE B 12 reproducible, all three `--check` surfaces clean.
