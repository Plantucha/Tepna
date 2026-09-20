---
bump: patch
type: changed
brief: none
---

**`codegen` manifests: the `status` maturity enum is retired.** One hand-maintained word
("planned" | "alpha") stood for a spectrum, with exactly one consumer — a footer string in
`dex-gen.js`. It went wrong on four shipped nodes (#2676) and went unnoticed for months, because
six of the seven nodes have hand-authored guides: their generated page is never produced, so the
field reached no reader at all.

It is replaced by two facts of different kinds. The generated guide's footer now states
**provenance** — `generated from <manifest>` — which has no half-life. **Maturity**, which really
does decay, moved to dated prose in the rendered `warning`, where readers look: EEGDex ships a DSP
and a selftest, no app and no bundle, and `signal-spec.js` routes EEG files to an `EEGDSP` that
resolves to undefined in every shipped bundle. One word could not say "routed but unreachable".

Gate-backed by the `codegen · manifest · provenance` group (Node lane): the retired key cannot
return (asserted on the raw key, so `"status": null` still reds), the footer carries no maturity
vocabulary, and the committed guide must still carry the manifest's own warning — nothing
regenerates `codegen/generated/`, so page and manifest are two copies of that claim with nothing
else comparing them. Four planted decoys red it.

Fleet-Session: Magpie
