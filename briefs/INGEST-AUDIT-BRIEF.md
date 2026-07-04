<!--
  INGEST-AUDIT-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# Ingest & Capture-Robustness Audit — build brief for an AI coder

**Scope.** Audit and harden how every Dex node ingests *real* device captures
(Polar Sensor Logger + Wellue O2Ring), close the concrete gaps listed below, and
leave the tree green on both gates. Read `CLAUDE.md` first — it is authoritative
for the Clock Contract, the bundle workflow, the evidence-badge system, and the
list of known non-issues you must NOT "fix".

This brief exists because a real co-recorded pilot (O2Ring + Polar H10 + Polar
Verity Sense, June 2026) exercised the ingest paths with messy real files and
surfaced the items below. One of them (PpgDex multi-part) is already fixed and
shipped — use it as the reference implementation for the rest.

---

## 0. Ground rules (don't skip — they save you a wasted cycle)

- **Edit sources, never the bundle.** Each app is `Foo.src.html` + external
  `*-dsp.js` / `*-app.js` / `*-render.js` / …. The shipped `Foo.html` is a
  compiled artifact. Edit the inputs, then re-bundle with the inliner
  (`super_inline_html`, input `Foo.src.html` → output `Foo.html`).
- **Gates after any `*-dsp.js` / `*-cross.js` / `*-app.js` change:**
  1. `Dex-Test-Suite.html` — open, wait ~3 s, read the `#summary` pill. Must be
     **all green** (currently 517 passed / 32 groups). It loads the REAL modules
     + the shared assertions in `tests/dex-tests.js` (same suite Node CI runs).
  2. `verify-provenance.html` — open, confirm **no red verdicts**.
- **Back-compat the contracts.** `tests/dex-tests.js` IS the public contract for
  each module. Add new params LAST and optional; expose new data via NEW
  fields/methods. Don't edit an assertion to match a changed signature — keep the
  signature, or update the assertion deliberately (Node CI uses the same file).
- **VERIFIED build-hash fact (use it — it prevents a needless fixture rebuild).**
  `ganglior-provenance.js → buildSource()` hashes the
  `<script type="__bundler/template">`, which is the **pristine pre-bundle HTML
  shell with external `<script src>` refs** — NOT the inlined JS. Empirically
  confirmed: re-bundling PpgDex with a changed `ppgdex-app.js` left `buildHash`
  identical (`ab7d7d51ae21`), so the committed `uploads/ppgdex_*.json` provenance
  fixtures stayed valid with **zero regeneration**. ⇒ **A pure `*-app.js` /
  `*-dsp.js` edit does not move `buildHash`; you only need to regenerate
  provenance fixtures if you change the `.src.html` shell itself.** Always
  re-confirm by loading the rebuilt bundle and calling
  `await GangliorProvenance.buildHash()` and diffing against the fixture hashes
  before assuming a flip.
- **Clock Contract.** All parsing obeys it: floating wall-clock `tMs` via
  `Date.UTC(...)`, regex vendor stamps (never `new Date(str)` / `Date.parse`),
  display via `getUTC*`. `parseTimestamp` is duplicated per module by design —
  mirror, don't extract.
- **Provenance honesty.** A stream that parses to **0 usable samples must surface
  an explicit null / warning**, never a silently-empty result — mirrors "missing
  stamp → null, never fabricate."

---

## 1. PRIORITY — ECGDex multi-part concatenation (mirror the shipped PpgDex fix)

**Problem.** Polar Sensor Logger writes long streams as split files —
`…_ECG_part01of05.txt … part05of05.txt` (and `…_PPG_part01of15.txt`, plus split
ACC/GYRO/MAGN). Each part repeats the header line. If the app treats each part as
a separate recording, a single overnight ECG capture becomes 5 fragmentary
"sessions" instead of one continuous record. The pilot hit this directly (the H10
ECG for 2026-06-17 is 5 parts; the Verity PPG is 15).

**Reference implementation (already shipped in `ppgdex-app.js`).** Right after the
`Promise.all(... f.text() ...)` resolves in `loadFiles`, fold parts by
part-stripped base name before classifying/parsing:

```js
function partKey(name){
  const m = name.match(/^(.*)_part(\d+)of(\d+)(\.[^.]*)?$/i);
  return m ? { base: m[1] + (m[4]||''), part:+m[2], total:+m[3] } : null;
}
function mergeMultipart(parsed){           // parsed = [{name,text,kind,stampMs}]
  const groups = new Map(), singles = [];
  for(const f of parsed){
    const pk = partKey(f.name);
    if(!pk){ singles.push(f); continue; }
    if(!groups.has(pk.base)) groups.set(pk.base, []);
    groups.get(pk.base).push(Object.assign({}, f, { _part: pk.part }));
  }
  const merged = [];
  groups.forEach((arr, base)=>{
    arr.sort((a,b)=>a._part - b._part);
    let text = arr[0].text;
    for(let i=1;i<arr.length;i++){
      const lines = arr[i].text.split(/\r?\n/); lines.shift(); // drop repeated header
      text += (text.endsWith('\n')?'':'\n') + lines.join('\n');
    }
    merged.push({ name: base, text, kind: arr[0].kind, stampMs: arr[0].stampMs, parts: arr.length });
  });
  return singles.concat(merged);
}
// …then: parsed = mergeMultipart(parsed);
```

**Task.** Apply the equivalent in `ecgdex-app.js`'s ingest path (confirm the file
grouping/classification there first — ECGDex groups raw ECG + companion ACC).
Verify part ordering is numeric (`part2` before `part10`). Then sweep the OTHER
app ingests for the same gap: `oxydex`, `pulsedex`, `glucodex`, and the Integrator
loaders. Fix wherever split files can occur; leave a one-line note where a node
can't receive multi-part input.

**Acceptance.** Concatenated record's first/last timestamps equal the raw
files' exactly (Clock-Contract round-trip); a multi-part overnight yields ONE
session of the full duration. Re-bundle each touched `Foo.html`; both gates green.

---

## 2. UI-test the PpgDex multi-part fix end-to-end

The fix is logic-verified + gate-green but was **not** exercised through the live
file-drop (the merge fn is IIFE-scoped; the real parts are ~270 MB). Add a small,
deterministic check so it's covered:

- Preferred: a unit assertion. Export `mergeMultipart` (or a tiny pure helper it
  delegates to) on the app's testable surface and add a group in
  `tests/dex-tests.js` that feeds synthetic `{name,text}` parts (out of order,
  repeated headers) and asserts one merged stream, correct order, headers
  stripped. Wire it into BOTH runners (`run-tests.mjs` + `Dex-Test-Suite.html`).
- Or: a browser-only integration step that drops 3 tiny synthetic PPG parts and
  asserts a single session with summed duration.

**Acceptance.** New assertions green in both runners; no signature regressions.

---

## 3. PulseDex (and any onboard-RR/PPI consumer) — empty-stream behaviour

**Finding.** PpgDex is safe because it works **raw-PPG-first** (device PPI is a
validation lane only). The exposure is nodes that *trust* the Polar onboard
stream: the Verity Sense's `*_HR.txt` was **all-zero** and its `*_PPI.txt` was
**header-only** across the pilot. A consumer fed that input must not silently
produce empty/whole-cloth output.

**Task.** Audit `pulsedex-dsp.js` / `pulsedex-app.js` (and any RR/PPI ingest):
when the parsed interval list has **0 usable rows** (all-zero HR, header-only PPI,
all blocker-flagged), return an explicit `{ usable:false, reason }` and surface a
clear UI message ("device logged no usable beats — try the raw-waveform node"),
never a fabricated/empty analysis. Where a raw fallback exists (PpgDex from
`*_PPG.txt`), point the user to it.

**Acceptance.** A header-only PPI and an all-zero HR each yield an explicit
"no usable beats" state, not a crash or a blank/zero result. Add an assertion.

---

## 4. `classify()` misroutes `*_HR.txt` (PpgDex, latent)

In `ppgdex-app.js`, `classify()` has no `_HR` branch, so a Polar `*_HR.txt` falls
through to the `'ppg'` default and would be handed to `parsePPG` (which expects a
6-column waveform) → throw. Add an `hr` classification and either ignore HR files
for PpgDex with a friendly note, or route them as a device-HR comparison stream.
Pre-existing; fix while you're in the file.

---

## 5. Paper polish — reconcile H10 0.7 vs 2.17 bpm

`papers/sigma-no-reference.html` cites H10 short-term repeatability ≈ 0.7 bpm
(§2.3 / abstract) and, in the three-cornered hat, H10 σ = 2.17 bpm. Both are
correct but measure different quantities (rolling-median residual vs total
reference-free variance incl. 1-Hz bucketing/instantaneous granularity). Add one
clarifying sentence in §3.2 so a reader doesn't read them as contradictory. Static
doc, no gate.

---

## 6. General ingest audit checklist (sweep all nodes)

For each node (`oxydex`, `ecgdex`, `ppgdex`, `pulsedex`, `glucodex`, Integrator):

- [ ] **Multi-part split files** handled (§1).
- [ ] **Empty / all-zero / header-only** input → explicit null+reason, never
      silent-empty or fabricated (§3; Clock-Contract "never fabricate").
- [ ] **Polar Sensor Logger formats** all covered by explicit regex parsers and
      documented in the node's `*-dsp.js`: HR `Phone timestamp;HR [bpm];HRV;Breathing`;
      RR `Phone timestamp;RR-interval [ms]`; PPI `…;PP-interval [ms];error;blocker;contact;contact;hr [bpm]`;
      PPG `Phone timestamp;sensor ns;ch0;ch1;ch2;ambient` (~176 Hz);
      ECG `Phone timestamp;sensor ns;timestamp [ms];ecg [uV]` (~130 Hz);
      O2Ring CSV `Time,Oxygen Level,Pulse Rate,Motion` with `HH:MM:SS DD/MM/YYYY` (DMY).
- [ ] **Clock Contract**: regex stamps only (no `new Date(str)`/`Date.parse` on
      vendor strings), floating `tMs`, `getUTC*` for display; DMY/MDY rule honored.
- [ ] **fs derivation** from the sensor-ns column (median delta), with a sane
      fallback — not a hardcoded constant when the data disagrees.
- [ ] **Out-of-range / dropout rows** dropped (O2Ring `--`/`- -`, HR<30 or >220),
      not silently coerced.
- [ ] **Filename timestamp** parsing (`YYYYMMDD_HHMMSS`) consistent with the
      in-file stamp; used only as the documented anchor fallback.

Report findings as a short table (node × checklist) even where no change is
needed, so the audit is auditable.

---

## 6b. SHIPPED (2026-06-21) — HRVDex additive ingest, ECGDex handoff, persistence

HRVDex no longer *replaces* its table on each load; **imports are additive**, and
ECGDex is now a first-class input. What changed (sources only — `hrvdex-dsp.js`,
`hrvdex-app.js`, `ecgdex-app.js`; both bundles re-built):

- **Additive merge + dedup (`hrvdex-dsp.js`).** `parseCSV(text, opts)` builds rows
  then delegates to `commitRows(newRows, {replace?})`, which dedup-merges into
  `allRows`, re-sorts by floating `tMs`, re-runs `inferFromData()` +
  `computeDerived()`, persists, and renders. Identity = `_hrvSig(r)` = rounded
  `tMs` + the core metric tuple (HR/MeanRR/SDNN/RMSSD/pNN50/HF/LF/VLF/Stress), so
  distinct same-minute sessions both survive and only true value-duplicates are
  skipped. Multi-day and multiple-sessions-per-day work because the rolling
  windows already key by calendar day. Synthetic-patient generation passes
  `{replace:true}` (new subject ≠ more data).
- **ECGDex / Ganglior JSON ingest (`hrvdex-dsp.js`).** `ingestGangliorJSON()`
  accepts a `ganglior.node-export` (node `ECGDex`) as a single envelope, the
  `multiRecording {recordings:[…]}` array, or a bare array; `_envToSeed()` maps
  each recording's `hrv.time`/`hrv.frequency` to a row (prefers
  `wholeRecordSDNN/RMSSD` for cross-node comparability). Welltory-only subjective
  fields (Stress/Energy/Coherence) have no ECG equivalent → left 0 (derived cards
  read "—", never fabricated).
- **Persistence (`hrvdex-dsp.js`).** The merged table mirrors to
  `localStorage['hrvdex_rows_v1']` as compact numeric seeds (`_seedFromRow` /
  `_rowFromSeed`) and auto-restores on load via `restoreHRVRows()`. **Clear**
  (`clearAll`, relabelled *"Clear saved history"*) wipes both memory and the
  mirror.
- **App glue (`hrvdex-app.js`).** `processFile` detects CSV vs JSON (extension +
  first non-BOM char) and routes accordingly; drag-drop and the picker take
  **multiple** files (`fileInput.multiple` set in JS to avoid a `.src.html`
  change); paste handles JSON too. **Init must NOT gate on `DOMContentLoaded`** —
  the bundler injects app scripts *after* that event fires, so `_hrvInit()` runs
  immediately (`readyState!=='loading'`) and only falls back to the listener while
  still loading. (This was the one shipped bug: restore + `multiple` silently
  no-op'd in the bundle until fixed.)
- **ECGDex multi-session export (`ecgdex-app.js`).** `exportWelltoryCSV` now emits
  **all** loaded recordings (N rows) when ≥2 are present via `_welltoryRowFor(r)`;
  single-recording stays a 1-row file. One export → a whole multi-day history that
  HRVDex appends and dedups.

Doc surfaces updated: `README.md` (nodes table + handoff note), `How to Collect
Data.html` (mapping note), HRVDex in-app upload/empty copy (`HRVDex.src.html`),
`HRVDex Reference.html` (intro callout).

Gates: `Dex-Test-Suite.html` 600/600 · `verify-provenance.html` no red. Note the
JS-only edits left every `buildHash` unchanged (per §0); the later `HRVDex.src.html`
copy edit moves HRVDex's `buildHash`, but **no committed fixture stamps HRVDex's
hash**, so provenance stays green — re-confirm on the rebuilt bundle anyway.

---

## 7. Definition of done

- Each code change: sources edited (never the bundle), affected `Foo.html`
  re-bundled, `buildHash` re-checked (expected unchanged per §0 — confirm).
- `Dex-Test-Suite.html` all-green; `verify-provenance.html` no red.
- New behaviour covered by assertions in `tests/dex-tests.js` (both runners).
- No retired badge vocabulary, no `@font-face`/CDN, no shared-util extraction of
  `parseTimestamp`, no touching `ganglior.*` identifiers / the `fascia` alias
  (see `CLAUDE.md`).
- Short PR note: what changed, which bundles re-built, gate results, and the
  node×checklist audit table.
