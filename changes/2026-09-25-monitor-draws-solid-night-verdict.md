<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: none
---
The monitor draws the SOLID-NIGHT verdict. `solid_night.compose` has written one `tepna.verdict/1` per night
since the programme started and `capture.py` published it into `STATUS["solid"]`, but `/api/state` is an
allowlist and did not name the key, so the capture-quality programme's one nightly answer reached no operator:
33 of `monitor.html`'s 34 matches for "solid" were `px solid` borders and the 34th was the word "rock-solid" in
a comment. `solid` is now forwarded, and a sidebar card draws the status word, the term that decided it and
which night — nothing else, since the run statement is the programme's state rather than the night's. The pill
colour separates two UNKNOWNs that mean opposite things: `not settled` is the ordinary state of a night still
in progress (§3.1 excludes it from the run rather than resetting it) and is neutral, while a night that could
not be assessed resets the run and is amber. Absent verdict ⇒ the card stays hidden, never a green.
`find_unwired`'s scan 3 cannot guard this key — "solid" is a CSS keyword, so the existing borders satisfy its
word match whether or not anything draws the verdict — so the guard is a test that runs the shipped function
and an exhaustive `/api/state` key set with a decoy.
