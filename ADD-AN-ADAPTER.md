<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** REFERENCE (living) — last-verified 2026-06-24 · **Created:** 2026-06-24

# Add an adapter — the 5-minute contributor path

The smallest useful contribution to Tepna: teach the suite to read **one more vendor's file**
for a signal it already analyzes (RR, ECG, SpO₂, CGM). You write **one new file**, register it in
a few `<script>` lines, and run one gate. **No node is edited, no bundle is rebuilt.** You do *not*
need to absorb the brief lifecycle, the Clock Contract, or the provenance gates to do this — those
are for node work, not adapters.

> Why this is cheap: an adapter lives in the **INGEST** layer below DSP. It only *detects* a vendor's
> format and *references* an existing pure parser. It never copies parser math and never touches a
> `*-dsp.js`, so the behavior gate can't regress and no bundle moves. See `CONTRIBUTING.md` §2 for the
> layer model and `SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23-BRIEF.md` §2.4 for the full design.

---

## What an adapter is

```
vendor file ─▶ [ detect + parse ] ─▶ SignalFrame ─▶ DSP (one signal, no vendor logic)
                 your adapter         canonical
```

A registered adapter is a plain object `{ id, signalType, vendor, device?, detect, parse }`:

- **`detect(file, headText) → confidence 0..1`** — cheap, side-effect-free. Look at the filename and a
  short prefix of the file text (`headText`). Return how sure you are this file is yours. **Not a
  boolean** — the router picks the highest-confidence adapter and flags near-ties for the user instead
  of guessing.
- **`parse(text, ctx) → SignalFrame`** — **REFERENCE an existing pure parser, never copy it.** Wrap its
  output with `SignalFrame.toSignalFrame(type, raw, provenance)`.

The whole thesis: **one signal, one math, many vendors.** `coospo-rr.js` differs from `polar-rr.js`
*only in `detect`* — both wrap the same `parseRRInput`. If PulseDex fixes a parse bug, every RR adapter
inherits it for free.

---

## Step 1 — copy the closest existing adapter

For a new **RR** vendor, copy `adapters/coospo-rr.js` — it is intentionally the reference template (a
new vendor for a signal we already analyze = one file that differs only in `detect`). Rename the file
`adapters/<vendor>-<signal>.js` (e.g. `adapters/wahoo-rr.js`).

Keep the SPDX header (every authored file carries it — `licensing/SPDX-HEADERS.txt`), set a unique
`id`, the right `signalType` (`rr` | `ecg` | `spo2` | `cgm` — see `signal-spec.js`), `vendor`, and an
optional `device`.

## Step 2 — write `detect` (the only real work)

Recognize your vendor by its filename and/or header signature, cheaply and without side effects.
Return a high confidence on an unambiguous vendor mark, lower on a generic signal hint:

```js
detect: function (file, headText) {
  var name = (file && file.name || '') + '';
  var head = (headText || '') + '';
  if (/wahoo|tickr/i.test(name + ' ' + head)) return 0.95;   // explicit vendor mark
  if (/\bRR\(ms\)\b|RR_?Interval/i.test(head)) return 0.6;    // generic RR header — weaker
  return 0;                                                   // not mine
}
```

Rules of thumb: filename signature first, header signature as fallback; **never throw** (a thrown
`detect` is treated as confidence 0); keep it pure (no DOM, no network, no `localStorage`).

## Step 3 — write `parse` (reference, don't copy)

Pull the existing parser out of `ctx` (the unifier loads bare-global parsers in isolation and hands the
right one in), run it, and normalize:

```js
parse: function (text, ctx) {
  ctx = ctx || {};
  var parseRR = ctx.parseRRInput || (typeof root.parseRRInput === 'function' ? root.parseRRInput : null);
  if (!parseRR) return root.SignalFrame.toSignalFrame('rr',
    { usable: false, reason: 'wahoo-rr: no parseRRInput in scope (load PulseDex DSP in isolation)' },
    { adapter: 'wahoo-rr', vendor: VENDOR, device: DEVICE });
  var raw = parseRR(text);
  return root.SignalFrame.toSignalFrame('rr', raw, {
    adapter: 'wahoo-rr', vendor: VENDOR, device: DEVICE, files: ctx.files || null, warnings: []
  });
}
```

**If your vendor stamps timestamps in a format the shared parser doesn't know**, normalize them *here*
— rewrite to ISO-8601, or compute `tMs` per the Clock Contract — **before** handing text down. Do
**not** add a regex to the node's `parseTimestamp`: that edits a node (trips the gate) and re-fragments
the format bank the adapter layer exists to centralize. The adapter owns the vendor's quirks.

**Honesty contract:** a missing value is `null`, never fabricated; a file with no usable signal returns
`usable:false` + a human `reason`, never an empty/fake frame.

## Step 4 — register the file (self-registers at load)

The adapter calls `registerAdapter` itself at load. You just add its `<script>` everywhere the registry
is loaded, **after** `signal-adapters.js`:

- `Data Unifier.html` and `OverDex.html` — next to the existing `adapters/*-rr.js` lines.
- `Dex-Test-Suite.html` — same block (so the round-trip test covers it).
- `tests/run-tests.mjs` — add the path to the CORE load list (the array with
  `'adapters/polar-rr.js', 'adapters/coospo-rr.js'`).
- `tsconfig.json` — add it to `include` so the CI types check (`tsc --noEmit --checkJs`) sees it.

## Step 5 — prove it + the one gate

Add a tiny fixture (a few real lines from the vendor's export) and lean on the existing
`property-metamorphic` round-trip law: `validateFrame(toSignalFrame(type, parse(text))).ok === true`
for every registered adapter on its fixture. Then run the **one** gate this touches:

```
node tests/run-tests.mjs      # must exit 0 / all green
```

That's it. You edited **no** `*-dsp.js`/`*-app.js`/`*-cross.js` and rebuilt **no** bundle, so the
**provenance gate does not apply** and nothing needs re-bundling. Pair the adapter with a short capture
note under `how-to-collect/` for that device (the capture-provenance discipline in `CLAUDE.md`).

---

## Fixing a typo / a copy edit

Even smaller: text in a reference guide, a doc, or a node's `.src.html` copy. The rule that matters is
**the registry is the source of truth** — if a reference guide's grade/label disagrees with the node's
`*-registry.js`, fix the **doc**, not the registry (`CONTRIBUTING.md` §4). A pure body-copy/markup edit
to a `.src.html` does **not** move `buildHash` (per `CLAUDE.md`) — but if you edit anything that gets
bundled, re-bundle and run both gates. When in doubt, a doc-only or `*.md` edit is always zero-gate.

## Where to go deeper

- `CONTRIBUTING.md` — the layer model, the two gates, common tasks.
- `signal-adapters.js` / `signal-frame.js` / `signal-spec.js` — the registry, the `SignalFrame`
  normalizer + `validateFrame`, and the signal-type registry. Read these; they're short.
- `SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23-BRIEF.md` §2 — the full adapter architecture and rationale.
