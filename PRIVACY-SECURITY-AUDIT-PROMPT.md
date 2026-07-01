<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living audit charter) · **last-verified:** 2026-07-01 · **Audience:** an AI agent (or human) doing a suite-wide PRIVACY & SECURITY audit of the Tepna Dex suite · **Siblings:** `AUDIT-PROMPT.md` (correctness) · `EFFICIENCY-AUDIT-PROMPT.md` (efficiency) — read those first; this is the third lens, not a replacement

# Privacy & security audit charter — Tepna Dex suite

> **Paste the "MISSION" block below to start a privacy/security auditor.** The rest is the reference it reads.
> Tuned to *this* codebase: a **100%-local, offline, no-account** personal health-signal analyzer. That
> architecture is the product's biggest privacy asset — so most of this charter is about **proving the
> local-first invariant holds** and **minimizing what persists**, NOT about bolting on server-era security
> theatre (there is no server, no auth, no transport to harden).

### Regulatory posture — read this before you reach for a compliance checklist
This suite is **not** a HIPAA "covered entity" system, **not** a certified medical device, and ships no
cloud/account/transport. The audience is **international**, so DON'T anchor findings to any single national
regime (HIPAA/US in particular will not land) — anchor them to the **portable data-protection PRINCIPLES**
that every serious regime shares and that this architecture can actually satisfy: **data minimization,
purpose limitation, storage limitation, local user control, transparency, security-of-processing**
(the GDPR Art. 5 vocabulary, used as *engineering principles* not a legal claim). The one legal-adjacent
surface that already exists is the **intended-use / not-a-medical-device disclaimer** (LICENSING-BRIEF §6.5)
— a privacy finding must never contradict it or imply a compliance certification the project hasn't earned.
State posture honestly: *"here is the principle, here is whether the code upholds it, here is the gap"* —
never *"this makes us compliant with X."*

---

## MISSION (paste this)

You are running a **privacy & security audit** of the **Tepna Dex suite** — browser-based, 100%-offline
analyzers of a person's own physiological recordings (oximetry, HRV, CGM, ECG, EEG). The data is
**intimate and identifying** (a night of SpO₂/ECG is health data about one named person), so the bar is:
**nothing about the user leaves their machine, nothing persists longer or wider than the user intends, and
the user can see + delete what's stored.** Find **real, demonstrated** violations of that — one gated change
at a time, never a speculative sweep.

**DEMONSTRATE, DON'T ASSERT** (mirrors the correctness charter's reproduce-don't-trust). Every finding
carries a **proof**: a network call you actually caught (a `fetch`/`XHR`/`WebSocket`/CDN `src`/`<img>`
beacon in a bundle or fired at runtime), a specific key you found still in `localStorage`/IndexedDB after
the user "cleared," an identifying field you traced into an export/log, a concrete XSS/`innerHTML`-injection
path from untrusted file content to the DOM. A worry without a demonstration is a *hypothesis* — label it.

**Method:** state a **privacy/security invariant** and hunt **violations**:
- **The NO-NETWORK invariant** (the flagship): no shipped bundle initiates ANY network egress — no `fetch`,
  `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, dynamic `import()` of a URL, no
  remote `src`/`href`/`@font-face`/CSS `url()` to a non-local origin, no `<img>`/pixel beacon. This is
  CLAUDE.md's "no network, no CDNs" rule promoted from *convention* to an *enforced security property*. It
  is the single highest-value thing to prove here and it is **automatable** — see "do-first" below.
- **STORAGE-MINIMIZATION**: what actually persists (`localStorage`/`sessionStorage`/IndexedDB/Cache)? Is raw
  signal data (a full recording) persisted when only a small summary/position is needed? Does the
  persisted-playback-position pattern (or any "resume" state) store more than an index? Is there a clear,
  discoverable way for the user to DELETE stored data, and does it actually remove ALL of it (not just the
  keys one app knows about)? Storage-limitation: does anything accumulate unbounded across sessions?
- **EXPORT / EGRESS-BY-USER-ACTION**: the `ganglior.node-export` JSON + any CSV/PNG export is the ONE
  sanctioned way data leaves — audit what it contains. Does it carry identity/PII beyond what the user
  needs (device serials, filenames with names, absolute paths, a real-UTC instant that de-anonymizes a
  timezone)? Remember the Clock Contract stores *floating* wall-clock ms specifically so exports don't leak
  the viewer's zone — verify no path reintroduces a real-instant leak.
- **UNTRUSTED-INPUT → DOM**: recordings are user files, but a file can still be hostile (a crafted CSV
  header, a filename, a vendor string). Hunt `innerHTML`/`insertAdjacentHTML`/`document.write` fed from file
  content or filenames without escaping; a parsed field rendered as markup; a `<script>`/event-handler that
  could ride in via a value. XSS in an offline app still steals the very local data this charter protects.
- **THIRD-PARTY CODE / SUPPLY CHAIN**: the app already has strong *build* provenance (manifestHash/GATE A).
  The security angle is EXECUTION: does any bundle `eval`/`new Function` a string derived from input or
  storage? Is there a CSP (even a `<meta>` one) pinning `default-src 'self'`/`connect-src 'none'` as
  defense-in-depth behind the no-network invariant? Any inlined dependency whose origin/version isn't in
  `THIRD-PARTY.md`?
- **INCIDENTAL LEAKS**: `console.log`/debug output dumping raw signal or identity; verbose errors embedding
  file contents; a data: URL or blob that outlives its use; clipboard writes; `localStorage` keys that
  encode identity in their NAME.

**Before you start:** read `ORIENTATION.md` + `CLAUDE.md` (constitution — wins on conflict) and
`licensing/LICENSING-BRIEF.md` §6.5 (the disclaimer you must not contradict). Establish the green baseline
(`Dex-Test-Suite.html?full` + `verify-provenance.html`) — a privacy change that touches a `*-dsp.js`/render
path must leave both gates exactly as green (equal values). Skim `DOCS-INDEX.md` + the "out of scope" list
below so you don't re-file solved/intentional items.

Deliver findings in the **Reporting** format; propose one gated change at a time.

## Reporting (per finding)
`INVARIANT · severity (HIGH/MED/LOW) · the demonstration (the exact call/key/field/path you caught) · the
data-protection principle it violates (minimization / storage-limitation / local-control / transparency /
security-of-processing) · the proposed one gated change · gate impact (does it move a fixture? re-bundle
which apps?)`. Order by severity × certainty. Separate **demonstrated** findings from **hypotheses**. End
with a **do-first** shortlist.

## Do-first (the highest-value, buildable item)
**A `no-network` gate** — the privacy analogue of `verify-provenance.html`. Two layers, mirroring the
existing gate style:
1. **Static:** grep every shipped bundle for egress primitives (`fetch(`, `XMLHttpRequest`, `WebSocket`,
   `EventSource`, `sendBeacon`, `import(` of a URL, `src=`/`href=`/`url(` to a non-local scheme,
   `@font-face` remote). Zero matches = pass; any match is a HARD fail with the file+line.
2. **Runtime:** in a test harness, monkeypatch/Proxy those primitives to THROW, boot each app bundle in an
   iframe (reuse the render-coverage rig), drive a synthetic recording, and assert none fired.
This turns "100% local" from a comment into an enforced, greppable property — the single biggest privacy
win, and it costs no runtime behavior change (so no re-bundle, no fixture churn). Wire it as a group in
`tests/dex-tests.js` (both runners) so it rides the canonical gate.

**Negative control (REQUIRED — the gate must verify ITSELF, not just self-reassure).** A grep/probe gate's
worst failure is a *vacuous pass* — a typo'd pattern or a forgotten primitive makes it green on everything,
forever, silently. So ship a **canary**, mirroring the house pattern (equiv legs red on moved output;
render-coverage boots a real bundle): (1) **static** — a test-only fixture string containing a real
`fetch("https://evil.example/x")` that the grep is REQUIRED to flag; assert it catches exactly that line,
and HARD-FAIL the gate if it doesn't (the detector is broken). (2) **runtime** — a test-only module that
attempts one egress call against the throwing `fetch`/`XHR`/`WebSocket`/`sendBeacon` trap; assert the trap
threw and the harness recorded it. This proves the trap has teeth BEFORE a green on the real bundles is
trusted. Keep it to these two minimal planted-egress assertions — do NOT build a honeytoken (an offline app
has no listening post; it would sit inert) or any elaborate canary that becomes its own maintenance burden.
Everything else is a finding, not a foregone build.

## Out of scope / do NOT re-file
- **HIPAA / any single-nation compliance certification** — deliberately not claimed (international audience;
  not a covered entity / medical device). Frame everything in portable principles, not a national regime.
- **"Add a login / encrypt at rest with a password / add a server"** — this is an intentionally
  serverless, accountless, single-user local tool. Transport/auth hardening for a server that doesn't exist
  is theatre. (Local at-rest encryption is only worth proposing if you DEMONSTRATE a concrete shared-machine
  threat the user can't mitigate by OS-level means — and even then it's a UX/keys tradeoff, not a slam-dunk.)
- **System-font stacks / no woff2 / no CDN, PulseDex's LOCALLY-bundled IBM Plex Mono** — intentional and
  already the privacy-correct choice (no font CDN = no font-load beacon). Not a finding; in fact it's the
  no-network invariant already being honored.
- **The floating-wall-clock time model** — a privacy FEATURE (viewer-timezone independence stops exports
  leaking the user's zone). Don't "fix" it to real-UTC.
- **Build provenance (`manifestHash`/GATE A/B, `buildHash`)** — covered by `AUDIT-PROMPT.md` + the provenance
  gates; only file the EXECUTION-security angle (eval/CSP), not build integrity.

## Constraints any proposal MUST honor
100% local (no network/CDN — a proposal that ADDS egress is auto-rejected, it's the exact thing we protect);
edit `*.js`/`*.src.html`, never the bundled `*.html`, and re-bundle; the Clock Contract (incl. its
zone-privacy property); the intended-use disclaimer (never imply certification); frozen names (`Ganglior`,
the `fascia` alias, `ganglior.node-export` schema — a privacy fix to export CONTENTS must keep the schema
name/shape). A proposal needing a re-bundle carries the GATE-A manifestHash update + any fixture
regeneration (CLAUDE.md checklist) and lands both gates green. **Running this charter produces a REPORT** —
each accepted finding spawns its own dated gated change-brief; don't fix in the audit pass itself.
