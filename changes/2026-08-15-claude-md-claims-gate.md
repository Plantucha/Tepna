---
bump: minor
type: added
brief: none
---

**`claude-md-claims` — CLAUDE.md's factual claims are now checked against the tree.**

CLAUDE.md wins on every conflict and is the first thing a session reads, so a false claim in it
misleads more reliably than a bug does: nothing downstream disagrees with it. Nothing checked it, and
two claims had rotted.

**Both were found by measurement, and the second by the gate itself on its first run:**

- *"`clock.js` … inlined by the owned bundler into **every bundle**"* — **false for three of eight.**
  `PpgDex.html`, `GlucoDex.html` and `CPAPDex.html` do not inline the spine at all, so **`DexClock` is
  UNDEFINED there** and a bare `DexClock.x` is a `ReferenceError`, not a fallback. (Verified harmless
  today — PpgDex guards with `typeof`, GlucoDex's mention is in a comment, CPAPDex has none — but the
  sentence is what a reader acts on.)
- *"`build.mjs` owns **10** bundles"* and *"GATE A cover the **8 apps**"* — **both off by one.**
  `MANIFEST_BUNDLES` is **9** (the 8 apps **plus `Integrator.html`**, which carries a `manifestHash`
  and a `provenance/Integrator.json` fragment like any app), so owned is **11** and GATE A covers **9**.

**The gate reads NUMBERS, not prose, and that limit is the design.** Two measurements set it:

- Asserting every path CLAUDE.md names exists ⇒ **11 of 75 "missing"**, nearly all legitimate (ledgers
  deliberately retired into `provenance/` fragments, corpus suffixes like `_ECG.txt`, the `Foo.html`
  placeholder, two `*-list.txt` files killed in July) — ~15 % false positives, i.e. the noisy red that
  gets routed around rather than read.
- Grepping for banned strings ⇒ all three `@font-face` hits in the tree sit inside comments **saying
  "no @font-face"**. A prose gate reports the documentation of a rule as a violation of it.

So CLAUDE.md opts a claim in by writing `CLAIM <name> = <number>` inline, and the group checks that
number against the tree. A claim nobody marks is simply not gated — **under-coverage, never a false
red.** Three are marked today: `clockBundles`, `ownedBundles`, `orchestrators`.

**Mutation-verified in both directions**, not merely observed passing: changing a CLAIM number reds it,
and re-introducing the "every bundle" wording reds a second assertion written specifically for the
regression that motivated this. An unreadable builder yields `null`, which is reported as **UNVERIFIED
and fails** — it must never collapse to `0`, which would read as "the builder owns nothing" and certify
a wrong claim (CLAUDE.md §👥.4b: success reported about something never examined).

Node-lane only (fs reads); the browser lane SKIPs, mirroring `docs-ledger`/`release-ledger`. No bundle,
DSP or ledger is touched — no `manifestHash` moves.
