<!--
  EXPORT-IDENTITY-2026-06-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-29 · **Created:** 2026-06-27 — Phases 0–1 (CORE `signal-frame.js`: deterministic identity-free `recording.contentId` digest + boundary PHI filename-scrub) landed earlier 2026-06-29; Phase 2 + the discovered leak closed 2026-06-29 → DoD met (≥1 node surfaces `contentId` AND the scrub is fleet-wide): **PulseDex now surfaces `recording.contentId`** in its ganglior export (signal-frame.js bundled into PulseDex; the live `calculate()` path also stamps it so app `exportGanglior()` ≡ `compute()`; both PulseDex fixtures regenerated, only-delta `contentId`), and the discovered `provenance.inputs[].name` PHI leak is closed in the **bundled** `ganglior-provenance.js` (byte-faithful `scrubFilename` mirror) → scrub now fleet-wide (all 8 re-bundled). Both gates green (verify-provenance GATE A 8/8 + GATE B; Dex-Test-Suite all-green, 88 groups; +2 groups: §1 contentId + §2 inputs[].name scrub). Residue — remaining nodes’ opportunistic `contentId` adoption + opt-in subject key (Phase 3) + HIPAA/GDPR & longitudinal-linking product calls → `EXPORT-IDENTITY-FOLLOWUPS-2026-06-29-BRIEF.md` → `EXPORT-IDENTITY-FOLLOWUPS-II-2026-06-29-BRIEF.md`. · **Related:** `EXPORT-HYGIENE-2026-06-27-BRIEF.md` (sibling — the *filename/timestamp* half; this brief is the *identity/privacy* half)

# Export identity & PHI minimization — build brief

> **Read `CLAUDE.md` first** (100%-local moat, frozen `ganglior.node-export` schema, additive-contracts
> rule, epistemic-honesty `null`-not-fabricated). **Compliance caveat up front:** whether any of this
> clears HIPAA/GDPR for a real deployment is an **external compliance call**, not a design one — this
> brief makes the data *more* minimal and traceable; it does not certify it.

---

## 0 · Thesis — content-addressing, not serial numbers

The motivating question was: *"should exports carry a serial number / identification, given the private
medical nature?"* The instinct (medical exports need identity discipline) is right; **serial numbering
is the wrong tool and would be a privacy *regression*.** Three things sound like "an ID" and must not be
conflated:

1. **Monotonic serial counter — no.** Needs persistent cross-recording state, leaks how many recordings
   exist and their order, and is exactly the stateful identity the local-only / floating-clock design
   avoids. No dedup/fusion upside that content-addressing doesn't beat.
2. **Patient or device identifier — actively no.** The whole moat is *identity-free, 100% local*.
   Stamping a persistent subject ID — or worse a hardware **device serial** (Polar H10 / Verity
   MAC/serial) — *manufactures* a linkable identifier where none existed and re-links anonymous nights
   to a person. For private data the correct posture is **minimization/pseudonymization**, the opposite
   of serializing. (Today `SignalFrame.provenance.device` holds a model *name* — "Verity Sense" — which
   is fine; the line is crossed the moment that becomes a unit serial.)
3. **Content-addressed recording digest — yes.** A deterministic hash of the canonical recording is a
   stable, **privacy-neutral** handle: it carries no identity, dedups the same night routed twice
   through OverDex/Integrator, and makes a recording citable in `papers/` without exposing content. It
   is the same content-addressed direction SIGNAL-ADAPTER Phase 7 is taking for *code* — extend it to
   *data*.

---

## 1 · Current state — grounded

- **Exports already self-describe their *source*** but have no stable *handle*: `SignalFrame.provenance`
  is `{ adapter, vendor, device, files[], kernelHash, warnings }` (SIGNAL-ADAPTER §2.2), and node
  exports carry `recording.startEpochMs` (the floating `t0Ms`) + `ganglior_events`. Dedup across a
  routed pile relies on comparing content, not on an id.
- **🔴 The real existing leak: `provenance.files` carries raw filenames.** Real captures are routinely
  named with PHI — `Jane_Smith_2026-06-12_RR.txt` — so a person's name can ride inside every export and
  every fused result today. That is a live privacy hole and is *more* pressing than the absence of a
  serial.
- **No `device`-serial leak yet** — values seen are model names. Keep it that way (invariant below).

---

## 2 · Target

**2.1 `recording.contentId` — the privacy-safe handle (additive).** A short content-addressed digest
computed in CORE at frame creation:

```
contentId = shortHash( signalType + '|' + t0Ms + '|' + digest(intervals|samples) )   // e.g. 12 hex chars
```

Deterministic (same recording → same id), identity-free, and a natural dedup/citation key. It is an
**additive** field — the FROZEN `schema.name` is untouched, and invariant #5 (`CLAUDE.md`: new data via
a NEW field) explicitly permits this. Stamp it on `SignalFrame` (CORE) first; nodes surface it in their
`ganglior` export when migrated.

**2.2 Scrub `provenance.files` to identity-free at the ingest boundary.** In `toSignalFrame`, reduce
each entry to a non-identifying token — basename with the name component stripped/hashed, keeping only
what's diagnostic (extension, vendor signature, the `_RR`/`_ECG`/`_PPG` lane tag). The signal a consumer
needs ("this came from a Polar `_RR.txt`") survives; the patient's name does not.

**2.3 Optional opt-in pseudonymous subject key (only if longitudinal linking is wanted).** If — and only
if — cross-night linking is a product requirement, the privacy-preserving form is a **random UUID per
subject**, generated locally, **never derived from name/DOB**, never a device serial, and **strippable**
before sharing/fusion. Default OFF. This is a deliberate product decision, not a default — leave it last.

---

## 3 · Phased plan (sequenced by gate cost — zero first)

### Phase 0 — `contentId` in CORE   · GATE COST: Node runner only (CORE/unbundled-tool scope)
Add the `contentId` computation to `signal-frame.js` `toSignalFrame`, expose it as an **optional**
field, and teach `validateFrame` to accept-but-not-require it. Add a `content-id` group to
`tests/dex-tests.js`: determinism (same input → same id), independence from viewer TZ and from filename,
and that two genuinely different recordings collide-resist. `signal-frame.js` is loaded by the
**unbundled** unifier/OverDex, not by node bundles → **no app re-bundle, provenance untouched**; run
`node tests/run-tests.mjs`.

### Phase 1 — Filename scrub at the boundary   · GATE COST: Node runner only
Implement 2.2 in `toSignalFrame` + a `provenance-scrub` test (a PHI-named input → scrubbed token,
diagnostic tag retained). Still CORE/unbundled scope → no re-bundle.

### Phase 2 — Node adoption: write `recording.contentId` into the `ganglior` export   · GATE COST: per-node, **fixture-MOVING**
When migrating a node (or under its next Phase-9 pass), have its export builder emit `recording.contentId`.
**Unlike the filename change, this is a new field IN the export content → it MOVES fixture bytes** →
full per-node ritual: re-bundle → `Dex-Test-Suite` green → `manifestHash` → `BUILD-MANIFEST.json` (GATE
A) → **regenerate that node's fixtures** by re-running + re-exporting (never hand-edit) → record the
producing `manifestHash` in `FIXTURE-PROVENANCE.json` (GATE B). Additive field → Integrator/consumers
tolerate its absence on legacy exports (invariant #5).

### Phase 3 — Optional opt-in subject key   · GATE COST: product decision first, then per-node
Only if 2.3 is wanted. Keep OFF by default; design the strip-on-share path before any node writes it.

---

## 4 · Invariants you MUST NOT break

1. **No serial, no personal ID, no device serial** in any export or filename. Identity-free is the moat.
2. **100% local.** `contentId` is computed on-device from data already in hand; no network, no registry,
   no CDN.
3. **Additive on a frozen schema.** `schema.name:"ganglior.node-export"` and all `ganglior.*` identifiers
   are untouchable; `recording.contentId` is a NEW optional field, consumers tolerate its absence.
4. **Epistemic honesty.** A frame with no usable signal stays `usable:false` + `reason`; never fabricate
   a `contentId` for an empty/absent recording.
5. **SPDX header** on every authored file; Apache-2.0; author Michal Planicka.

---

## 5 · Definition of done + follow-up

**Done when:** `contentId` is computed + validated in CORE with a green test group; `provenance.files`
is scrubbed at the boundary with a green PHI-scrub test; **zero app re-bundle incurred** for Phases 0–1.
Node adoption (Phase 2) and the optional subject key (Phase 3) proceed opportunistically and are
explicitly *not* required for this brief's shippable bar.

**Lifecycle (`CLAUDE.md`):** date in filename (set once, never rename). Flip header to `IN-PROGRESS`
once Phases 0–1 land, `DONE — <today>` when at least one node surfaces `contentId` and the scrub is
fleet-wide. Keep `DOCS-INDEX.md` in sync. Spawn `EXPORT-IDENTITY-FOLLOWUPS-<YYYY-MM-DD>-BRIEF.md` for
residue (e.g. the subject-key product decision), or state none surfaced.

**Open product decisions to surface to the human (not for an agent to silently pick):** (a) is
longitudinal cross-night linking wanted at all (gates Phase 3)? (b) HIPAA/GDPR applicability — external
compliance sign-off.
