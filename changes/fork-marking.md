<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [tools]
brief: none
---
A build that did not come from this repository now says so, where a person can see it.

`projectSource` in build-core injects a visible notice into the body of a bundle, names the
upstream project in the `<title>`, and adds machine-readable `tepna-built-from` /
`tepna-upstream` meta. `build.mjs` supplies the two values: `sourceRepo` from
`GITHUB_REPOSITORY`, which GitHub sets for every run in every fork and which cannot be
inherited by accident, and `UPSTREAM_REPO`, which lives in the tree so a fork inherits it by
copying the code.

**It stamps a fork and nothing else.** An upstream build and a local build are byte-identical
no-ops, which is what keeps the nine committed bundles untouched by its existence — asserted
on the shipped artifacts, not only on synthetic strings: `upstream build is still
byte-identical to the committed bundle` for three real bundles, and `build --check` stays
green with no rebuild.

**manifestHash-invariant by the same construction as the version stamp** — inline asset blocks
are masked before the regexes run, so the stamp can only touch bytes outside them. Gated for
three real bundles, since the whole licence to stamp anything per build is that invariance.

⚠️ **The decoy leg earned its place immediately.** The idempotency guard originally read the
RAW html, so a fork whose own app code merely mentioned the marker attribute — a selector, a
test fixture, a comment — would have suppressed the banner silently and forever. Nothing else
in the suite could have seen that: every other leg passed. The guard now reads the masked
text.

⚠️ **NOT an authenticity control**, and the source comment says so. A fork that wants the
banner gone deletes one call, exactly as it could edit `NOTICE`. What this buys is that
keeping the notice is the default and removing it is a decision. It is also the Apache-2.0
§4(b) notice — "cause any modified files to carry prominent notices stating that You changed
the files" — put where a user of the file can see it rather than only where a reader of the
source can.

A slug that is not `owner/name` is refused outright rather than escaped: the two strings land
in markup, so that guard is the whole of the escaping story and is gated with an
`alert(1)`-carrying slug.
