<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [CPAPDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Bootstrap CPAPDex _nightFromInput — the fourth zero-kill function, and the highest conversion yet at 6 of 8.

20 survivors and not one kill, so all 20 were unclassifiable by construction: the prober needs a
positive control from the same function and there was nothing to replay. Fourth of the nine the §7.0
census lists (~320 survivors, about a fifth of everything the fleet has mapped).

It is also the cheapest of the open ones — public as `CPAPDex.buildNightFromSets`, and almost pure
input-shape dispatch, so the branches ARE the argument shapes. Verified by re-applying real survivors,
6 of 8 sampled now die:

  !input || typeof input === 'object'          KILLED    the type guard, inverted
  !input && typeof input !== 'object'          KILLED    …and its connective
  input || typeof input !== 'object'           KILLED    …and its negation
  input.night || Array.isArray(input.night…)   KILLED    the wrapped-night arm
  !Array.isArray(sets) && !sets.length         KILLED    the empty-sets refusal
  sets && (input.PLD || …)                     KILLED    the decoded-set sniff

FOUR WAYS TO HAND IT THE SAME NIGHT, each a separate arm: a bare decoded set (sniffed by
PLD/BRP/SA2/EVE), the `edfSets` key, the `sets` key, and a pre-built night passed back in. A fixture
using only one leaves the other three unexercised — which is precisely how a dispatcher accumulates
20 survivors and no kills.

15 assertions, every expectation measured first, using the node's OWN `_synthEdfSet` as the decoded
set rather than an invented shape. Includes idempotence (a night handed back comes out unchanged),
the single-channel sniff (a set carrying only PLD is still recognised, so the || chain cannot collapse
to whichever member the fixtures happened to include), and eight refusals — each returning null rather
than fabricating an empty night, because a caller that cannot tell "no data" from "a night with
nothing in it" cannot report either.

⚠️ The sweep's line numbers were stale again — 25 old survivors, only 12 uniquely re-anchorable — so
only those were applied. Third time this session; `tools/reanchor-equivalence.mjs` exists for it.
