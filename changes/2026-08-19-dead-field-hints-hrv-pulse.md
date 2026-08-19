---
bump: patch
type: removed
brief: DEAD-FIELD-HINTS-FLEET-2026-08-19-BRIEF.md
---

**The last 22 dead field-hint writes are gone, and the class now has a gate that was seen to RED first.**
`DEAD-FIELD-HINTS-FLEET` closes: HRVDex and PulseDex wrote `lbl_*` field hints to ids **no `.src.html`
defines**, through setters guarded by `if (!el) return`. Every write was a silent no-op — the render-side
twin of a metric surfaced without an evidence badge, which is exactly the class this repo insists must
fail visibly.

**The brief's remaining count was wrong, for the fourth time and in the same way.** It said
`HRVDex 6 · PulseDex 11 = 17`; the measured number is **22**, because five HRVDex sites reach the DOM
through a bare `document.getElementById('lbl_…')` rather than a setter, and scoping by `set('lbl_X')`
cannot see them. §0 had already fixed the *character class* and left the *call shape* assumed. PulseDex's
writes also live in `pulsedex-overview.js` — there is no `pulsedex-profile.js`, and grepping that
nonexistent path returned a clean, plausible **`0`** rather than an error.

**Removed surgically, because the enclosing code is live:**

- **HRVDex (11)** — the writes sit inside a live `updateProfile()`. `altFactor` stays (it feeds
  `window._hrvProfileAlt`); the VO₂ projection block keeps `window._projVO2` and `renderANSAgeCard()`,
  losing only its `lv.textContent` line. The orphaned `_setSub`/`_set` helpers and `idealW` go with it.
  `vo2Est` and its chain were checked and **kept** — used at three other sites, not only by the dead write.
- **PulseDex (11)** — `computeProfileHints` was dead on **two** independent grounds: it opens
  `if (!document.getElementById('profSex')) return;` and `PulseDex.src.html` defines no `profSex`, so it
  returned at its first line on every call. Removed with both call sites, its `window` export, and the
  now-orphaned `nu` import.

**The gate.** `dead-field-hints` resolves every `lbl_*` literal in a node's inlined JS against the ids that
node's own `.src.html` defines. Against pristine `main` it **failed with exactly the 22** while all six
already-cleaned nodes passed; against the fix, 17/17. It matches by **property, not call shape** (the
blindness that made this brief wrong twice), reads each node's sources from its own `<script src>` list
rather than globbing, and carries an **anti-vacuity leg** asserting the sources were actually read — a node
whose files went unread would otherwise contribute no references and report "clean".

**Provenance.** `computeHash` is stable for HRVDex ⇒ export-inert, proven. It **moved** for PulseDex
(`pulsedex-overview.js` is not named `-render`/`-app`, so the denylist counts it inside the compute
closure — failing closed, as designed), so its corpus-backed fixtures were re-verified rather than
re-stamped around.
