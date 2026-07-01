<!--
  GATE-LIVE-RUNNABILITY-FOLLOWUPS-2026-06-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-28 · **Created:** 2026-06-28 · **Follows:** `GATE-LIVE-RUNNABILITY-2026-06-28-BRIEF.md` (executed DONE 2026-06-28 — the pure doc/harness pass that softened the ENV NOTE, added the in-memory red-branch unit, and folded the settle-time note) · **Theme:** verification *process / method* residue, **no code defect, no re-bundle** · **Trigger:** an explicit "did anything surface?" re-audit after the parent was stamped DONE — the parent header had said "no residue"; this brief is the honest correction (one item was *reproduced live this session*). · **Executed 2026-06-28 (no app re-bundle — harness pages + a harness-only shared module):** **§1** added a PROSE-IMMUNE same-origin signal `window.__sameOriginOK` / `window.sameOriginStatus()` to BOTH harness pages (`Dex-Test-Suite.html` computes it from render-coverage test ROWS; `verify-provenance.html` from bundle-boot results) — verified it returns **true** on a clean same-origin load of both (the old `innerText` scan returned `blocked:true` falsely the same session); reworded the verify-provenance preamble to drop the trigger tokens and pointed the ENV NOTE + `CONTRIBUTING.md` at the signal (THIS brief is the canonical corrected method; the old snippet quoted in the parent/RATIFY headers is historical, left per immutable-history). **§2** reconciled the `~3 s` vs `~50 s settle` contradiction in `CONTRIBUTING.md` §4 + `CLAUDE.md`'s regression-gate (one phrasing: paints ~3 s, rigs boot ~50 s → wait for the group count to stop climbing). **§3** the corrected ans-design.css-pass fixture expectation (pre-R1 PulseDex/ppgdex fixtures read `no provenance` and do NOT flip on a buildHash move; only `integrator_fusion_*` do) is carried in §3 for that pass's future executor — DONE briefs left unrewritten. **§4** gave the red-branch unit real TEETH: extracted the GATE A/B banner text into a NEW shared pure `provenance-banner.js` (`pickProvenanceBanner`) that `verify-provenance.html` RENDERS and `tests/dex-tests.js` ASSERTS against (wired into both runners' `env`) — an edit to a real banner message now goes red in the suite. **Gates (same-origin preview):** `Dex-Test-Suite.html` ✓ all-green **1276 passed / 0 fails**, Manifest group **11/11** (red-branch now via the shared fn), `window.__sameOriginOK`=true; `verify-provenance.html` **GATE A 8/8 + GATE B parsed, 0 reds**, `window.__sameOriginOK`=true. **No further residue surfaced → no `-II` spawned.**

# Gate live-runnability — follow-ups (residue from executing the parent)

> **Read `CLAUDE.md` first** (the two gates, the re-bundle ritual, the immutable-brief convention).
> **This brief contains NO code-defect and requires NO re-bundle.** Every item is doc / verification-method
> hardening. The committed *automated* gates are **sound** — `tests/browser-gates.mjs` and the pages' own
> DOM verdicts decide pass/fail off **pill classes / table cells** (`#summary .pill.fail`,
> `#manifest/#fixtures .pill.bad`), never a body-text scan (confirmed this pass). The residue is in the
> *manual / ad-hoc* verification method the brief lineage documents, plus two small doc-accuracy traps and
> one optional test-teeth upgrade.

---

## §1 · ⚠ HIGHEST (self-inflicted this pass, REPRODUCED live) — the softened prose now FALSE-POSITIVES the documented `bodyHasBlocked` same-origin check

**What surfaced.** The parent's whole premise is "attempt the live gate first and judge by what you
observe," and the lineage documents the observation method as a body-text scan:

```js
bodyHasBlocked = /Blocked a frame|cross-origin|SecurityError|opaque/.test(document.body.innerText)
```

(see `GATE-LIVE-RUNNABILITY-2026-06-28-BRIEF.md` §1 bullet and the RATIFY header, which both quote
`bodyHasBlocked … false on every read` as the *proof* the host was same-origin). Executing the parent, I
**added the literal trigger tokens to rendered prose**:

- `verify-provenance.html` preamble (`<p class="sub">`) now contains *"Blocked a frame"* and *"opaque-origin"*.
- `CONTRIBUTING.md` §4 now contains *"Blocked a frame with origin"*.
- (`Dex-Test-Suite.html`'s ENV NOTE is a JS **comment** → NOT in `document.body.innerText`, so its rendered
  page is unaffected. Only the two surfaces above are rendered body text.)

**Consequence — observed live, not theorized:** during this session's own verify-provenance check, that exact
detector returned **`blocked: true`** on a fully-green, 8/8 GATE-A, same-origin load — a **false positive**
caused *solely* by my added preamble text (I had to explain it away in the result). A future coder/agent who
follows the documented "read `bodyHasBlocked`" step will conclude the host is cross-origin-blocked when it is
not — and waste time spinning up an external static host, or (worse) distrust a genuinely-green gate.

**Why it is NOT a gate regression (do not "fix" the gates).** `tests/browser-gates.mjs` Gate 1 keys off
`document.querySelector('#summary .pill.fail')`; Gate 2 scans only `#manifest/#fixtures .pill.bad|td.bad`
(table cells), explicitly NOT the `.sub` preamble. The pages' own summary/GATE pills are class-driven. So the
**automated** verdicts are immune — this is purely a *manual-method* trap the brief lineage created by
documenting an `innerText` scan and then putting the trigger words into `innerText`.

### Recommended action for §1
1. **Correct the documented detector** to key off the *actual failure signature*, not free text. The
   cross-origin block always manifests as a specific iframe-reach-in error in a **test-result row**, e.g.
   `Failed to read a named property 'addEventListener' from 'Window': Blocked a frame with origin …`. So the
   robust check is one of:
   - **scope to result rows / red pills** (mirror the automated gates):
     `![...document.querySelectorAll('#results .fail, #manifest .pill.bad, #fixtures .pill.bad')].length` plus
     a render-coverage-group-present check; or
   - **match the reach-in signature specifically**:
     `/Failed to read a named property '\w+' from 'Window': Blocked a frame/.test(resultsText)` against
     `#results` (the assertions area), **excluding** explanatory `.sub`/comment prose.
2. **Update the snippet wherever it is quoted** — the parent §1 bullet and the RATIFY header both show the old
   `bodyHasBlocked` regex against `document.body.innerText`; annotate them that the `innerText` form now
   false-positives on the softened prose and point at the row-scoped form above. (Both are historical/DONE; per
   the immutable-history convention, *annotate*, don't rewrite — or simply make THIS brief the canonical
   corrected method and link it.)
3. **Optional, highest-leverage:** add a tiny committed helper to `Dex-Test-Suite.html` /
   `verify-provenance.html` (standalone harnesses — editing them is **not** a re-bundle) that exposes a
   correct `window.__sameOriginOK` boolean computed from result rows, so manual AND agent verification read
   ONE blessed signal instead of re-deriving an `innerText` scan each time.

**Done when:** the documented same-origin check returns the right answer (false-positive-free) on a clean
same-origin load of BOTH pages *despite* the new prose; no committed automated-gate code changed (re-confirm
`browser-gates.mjs` still keys off pills). **Gate cost:** none (doc + optional harness helper, no re-bundle).

---

## §2 · LOW (doc-accuracy, introduced this pass) — `CONTRIBUTING.md` now says BOTH "wait ~3 s" and "~50 s to settle"

**What surfaced.** The parent folded a settle-time corollary ("the green pill appears incrementally … ~50 s to
settle; only ✓all-green *after* the group count stops climbing is a pass") into `CONTRIBUTING.md` §4 gate #1 —
**directly below** the pre-existing "Open it, **wait ~3 s**, read the `#summary` pill" instruction. The two now
contradict: ~3 s is long enough for a *premature* green read (exactly the trap the corollary warns about).
The casual "wait ~3 s" also appears in `CLAUDE.md`'s regression-gate section and several brief footers.

**Do.** Reconcile to one phrasing in the canonical note (`CONTRIBUTING.md` §4 gate #1): e.g. *"~3 s to first
paint, but the render-coverage rigs boot for ~50 s — wait for the group count to stop climbing before trusting
the green pill."* Optionally align the `CLAUDE.md` regression-gate one-liner. **One canonical section** (avoid
the multi-doc duplication `GENERIC-EMIT-GATE-FOLLOWUPS §4` warned about). **Gate cost:** none (doc).

---

## §3 · LOW (forward-trap exposed by the parent's §2 finding) — the deferred `ans-design.css` pass's "flips every buildHash-legacy fixture" prediction is wrong for the pre-R1 fixtures

**What surfaced.** The parent §2 established (LIVE) that `uploads/ppgdex_20260610.json` + the
`uploads/PulseDex_*_summary.json` exports carry **no `provenance` block** → they read **`no provenance
(pre-R1 export)`**, NOT `reproducible ✓ (buildHash-only/legacy)`; only `integrator_fusion_2026-06-{11,13}.json`
(which DO carry a stamped buildHash) hit the legacy path. But the still-**deferred** ans-design.css
token-unification pass is scoped in `AUDIT-FOLLOWUPS-III-2026-06-23-BRIEF.md` §49 (and -II §4) on the premise
that editing `ans-design.css` (inlined into every template) "moves every app's `buildHash` → **flips every
buildHash-legacy fixture** (`PulseDex_*.json` ×3, `ppgdex_20260610.json` ×1, the Integrator
`integrator_fusion_*.json` ×2)". Per the live finding, a buildHash move would flip **only** the two
`integrator_fusion_*` fixtures (they're stamped); the PulseDex/ppgdex pre-R1 fixtures have no stamped hash to
mismatch, so they stay `no provenance` (warn, not red) regardless. So whoever executes the ans-design.css pass
should expect **fewer GATE-B reds than that brief predicts** — and must regenerate fixtures based on *code/
provenance reality*, not the stale count.

**Do.** Carry the corrected expectation **here** (it is now stated above) so the ans-design.css executor reads
it; per the immutable-history convention do **NOT** rewrite the DONE `AUDIT-FOLLOWUPS-II/III` bodies. When the
ans-design.css pass is actually scheduled, add a `Supersedes/Relates` cross-link from its brief to this §3.
**Gate cost:** none (doc); the real work rides the eventual ans-design.css re-bundle pass, not this brief.

---

## §4 · LOW (test-teeth upgrade, optional) — the §3 red-branch unit MIRRORS verify-provenance's banner instead of gating it

**What surfaced.** The parent's §3 in-memory unit (in `tests/dex-tests.js`, `Manifest JSON well-formed` group)
proves the FAIL-banner *selection logic* by re-implementing verify-provenance's `bannerA`/`bannerB` message
stems inside the test and asserting against the copy. This was the **deliberate, brief-sanctioned** safe choice
(the real banner is inline HTML-string construction, not an importable function; the alternative — corrupting
the real sidecar — risks shipping a corrupted gate). But it means there are now **two copies** of the banner
stems: an edit to verify-provenance's *real* `#gateA`/`#gateB` message would NOT be caught — the test gates its
own mirror, not the page.

**Do (pick one, both optional):**
- **(a) shared selector:** extract a tiny pure `pickProvenanceBanner(state) → {gateA, gateB}` into a small
  shared module (or a `<script>` both can load) used by `verify-provenance.html` AND the test, so editing the
  real banner without updating the contract goes red. Touches `verify-provenance.html` (standalone harness →
  **not** a re-bundle) + `tests/dex-tests.js`.
- **(b) real-DOM leg:** add a browser-only render-coverage-style leg that boots `verify-provenance.html` in an
  iframe with an injected bad `FIXPROV` (or fetch-stub) and reads the **real** `#gateB` red pill — the airtight
  end-to-end version of the §3 unit (origin-sensitive; only runs same-origin, like the other render-coverage
  legs).

**Done when:** editing verify-provenance's real GATE-A/B banner text without updating the contract makes a test
go red (option a), and/or the real `#gateB` pill is asserted red under a bad sidecar (option b). **Gate cost:**
test-harness only, no re-bundle; re-run `Dex-Test-Suite.html` → must stay ✓ all-green.

---

## What is NOT broken (do not re-investigate)
- **No committed automated gate regressed.** `tests/browser-gates.mjs` + the pages' own verdicts key off pill
  classes / table cells, never `innerText` — verified this pass. The parent's edits are sound; both gates ran
  green and unchanged (`Dex-Test-Suite` ✓all-green 1257/79; `verify-provenance` GATE A 8/8 + GATE B parsed).
- **The `Dex-Test-Suite.html` ENV NOTE prose is safe** — it is a JS comment, not rendered body text, so it does
  not feed the §1 `innerText` false-positive. Only `verify-provenance.html`'s preamble + `CONTRIBUTING.md` do.
- **The suite count moving 1247→1257** between the parent's session and this one is a **snapshot, not a
  regression** (counts are timing-dependent; the +10 is the 5 new red-branch asserts ×2 reads / render-coverage
  drift — group count stable at 79, every read all-green). Do not chase it (`GENERIC-EMIT-GATE-FOLLOWUPS §3`).

## Done when (whole brief)
§1 the documented same-origin detector is corrected to be prose-immune (and the old `innerText` snippet is
annotated wherever quoted) · §2 the `CONTRIBUTING.md` ~3 s/~50 s contradiction reconciled in one canonical
section · §3 the corrected ans-design.css-pass fixture expectation captured here for its future executor (no
historical-brief rewrite) · §4 optionally given real teeth (shared selector and/or real-DOM leg). **Pure
doc/test-harness — no `*-dsp.js`/`*-app.js`, no re-bundle, no fixture regen** → the gate ritual reduces to
"`Dex-Test-Suite.html` still ✓ all-green; `verify-provenance.html` GATE A/B unchanged." Then flip this header
to `Status: DONE — <date>` in place and sync `DOCS-INDEX.md`. If nothing further surfaces, say so in the header
rather than spawning an empty `-II`.
