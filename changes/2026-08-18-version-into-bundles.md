---
bump: minor
type: added
brief: DELIVERY-PROCESS-OVERHAUL-2026-08-18-BRIEF.md
---

The suite version now rides every bundle — owner-ordered, un-deferring CLAUDE.md §📦's
"version-into-bundle stamping", whose reason to exist had quietly expired.

THE SYMPTOM: the served docs pages said v2.6.0 while every app bundle's own header said v1.0 — three
hand-written anchors per app (`<title>`, `.logo-sub`, `.version-badge`) frozen at their birth values,
because re-bundling 8 apps "just to carry a string" used to churn every provenance fixture.

THE DESIGN, and the invariant that changes the economics: `DexBuild.projectVersion` stamps
suite.manifest.json's version into those anchors AT BUILD TIME, in BOTH lanes (build.mjs passes it;
tools/build.html fetches the manifest and passes it, no-op'ing gracefully offline). The stamp can only
ever touch bytes OUTSIDE the data-inline-src blocks — every inline asset is MASKED during projection and
restored after — so manifestHash, a projection of those blocks alone, is INVARIANT: measured on the real
fleet, all 9 provenance bundles rebuilt to the IDENTICAL hash (d039a1dbd1b2 -> d039a1dbd1b2, ...) with
zero fixtures re-stamped. Releases now update the fleet's displayed version for free.

GATED, not asserted, in tests/build-core-tests.mjs: the three anchors stamp; a DECOY version-shaped
string inside an inline script is untouchable (the mask is structural, not careful); absent or
non-semver version is a byte-identical no-op (never interpolated); idempotent; anchor-less bundles
(orchestrators) byte-identical; and THE leg — same source built with and without the stamp yields the
SAME manifestHash. The existing committed-equals-fresh-build legs now build the way build.mjs builds,
which is also what forced the fleet rebuild in this changeset rather than letting it drift.

ENFORCEMENT COMES FREE: the version is injected during build, so build.mjs --check's byte-compare reds
every bundle still carrying the old string after a release bump — release.mjs's printed post-steps now
include `node tools/build.mjs`. The stale-version state cannot ship silently.

The v-literals in the 8 src.html files are now marked as placeholders (comment beside <title>), and
CLAUDE.md §📦's deferral bullet is rewritten to the live design. Release.mjs also had a latent syntax
break from this work's first draft (an apostrophe inside its printed-steps string) caught by biome
before commit — the printed line is now apostrophe-free.
