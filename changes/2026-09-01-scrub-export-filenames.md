<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [oxydex, pulsedex, hrvdex, ppgdex, glucodex, ecgdex, cpapdex, motiondex, integrator]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
A scrubbed export no longer names its upload (DEEP-AUDIT-VI F13, SELF-INGEST §5 acceptance).

`DexExport.scrubExport` (`schema.scrubbed:true`) reduced `schema.provenance` and stripped
`recording.{device,serial,model}` — and stopped there. With scrub ON, OxyDex's `nights[].file`
(the upload name verbatim — an O2Ring export embeds the device serial and can embed a person's
name), PpgDex's `sessions[].source` (= `r.fname`) and every night's own `provenance` copy
(`inputs[].name / sha256 / lastModifiedMs`) all shipped. Measured on the real envelope shape:
`Jane_Smith_O2Ring S 2100_20260612230016.csv` survived a scrub.

Fix: the scrub is key-driven, never node-enumerated — `file/fname/filename/fileName/sourceFile` go
on every `nights[]/recordings[]/sessions[]` element, per-element `provenance` is reduced exactly like
the schema-level block, and `source` is removed only when it is filename-SHAPED (a separator or a
dotted extension): ECGDex/GlucoDex write a semantic tag there (`'file'`, `'welltory'`) and a tag
survives, because the scrub removes identity, not meaning. Gate: a new `Self-ingest §5 acceptance`
group plants seven tokens across every carrier, proves each is present BEFORE the scrub, and asserts
none survives the serialised output — pair-verified 18 red on `origin/main`'s `dex-export.js`,
25/25 here; the 51 existing self-ingest/scrub/export groups stay green (917/917).
`dex-export.js` is a universal spine module: all 9 provenance bundles + both orchestrators re-bundled,
`manifestHash` moved on every app, fixtures re-stamped, verify-fixtures re-run.
