<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Hybrid search — making the lane survive a reboot

`node tools/doc-search.mjs --hybrid "<question>"` answers from a **local, loopback-only** search index
holding BM25 text and the bge-m3 vectors doc-search has already cached. **Rule 0's default path does not
use it** and is unaffected by everything on this page; adoption is the owner's call
(`briefs/XERJ-HYBRID-SEARCH-2026-10-10-BRIEF.md`).

Primary development machine only. Measured 2026-10-10: the index server was a bare process started by
hand, so a reboot or a closed terminal ended the hybrid lane silently — the flag fails with a connection
error while the default path keeps working, which is an outage nobody is paged for.

## Enable it — the OWNER does this; a session must not

```sh
mkdir -p ~/.local/share/tepna/hybrid-index
cp tools/systemd/tepna-hybrid-index.service        ~/.config/systemd/user/
cp tools/systemd/tepna-hybrid-index-reload.service ~/.config/systemd/user/
cp tools/systemd/tepna-hybrid-index-reload.timer   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tepna-hybrid-index.service          # the server
systemctl --user enable --now tepna-hybrid-index-reload.timer     # follow the cache, hourly at :20
node tools/xerj-load.mjs                                          # the first fill (~56–77 s)
node tools/doc-search.mjs --hybrid "a question"                   # the one-line check
```

## What the three units are, and the two properties that matter

| unit | what it does |
|---|---|
| `tepna-hybrid-index.service` | the server. `Restart=on-failure`, loopback-bound, `Nice=10`/idle I/O so it never outranks a gate |
| `tepna-hybrid-index-reload.service` | one refill from the vector cache. **Fails on a load of zero** |
| `tepna-hybrid-index-reload.timer` | hourly at `:20`, **after** the hourly re-embed rather than near it |

**Loopback is the reason the server runs without TLS.** The listener binds `127.0.0.1` (the engine's own
default; exposing it needs a separate opt-in), and the unit enforces the same thing at the kernel with
`IPAddressAllow=localhost` / `IPAddressDeny=any` rather than trusting an argument. If the bind address
ever changes, the `--insecure` flag must change in the same edit — they are one decision.

**Source only.** The documents come from doc-search's own corpus, and the loader additionally refuses any
path matching `uploads/`, `.edf`, `captures/` or `.dat|.bin|.wav`. Nothing recorded enters this index.

**No model is downloaded.** The vectors are ours, computed by doc-search against the loopback inference
server; the engine runs in lexical mode and never embeds.

## It survives a restart — measured, not assumed

2026-10-10, on a second instance so the running one was untouched: **54,180 documents loaded in 55.8 s**
(peak RSS 343 MB, 382 MB on disk), the process killed, restarted on the same data directory, and
**54,180 documents still served**. A count only proves documents, so a kNN query was run after the
restart and returned the right passages — the **vectors** persisted, not merely the row count.

## If `--hybrid` fails

* `xerj HTTP …` or a connection error → the server is down: `systemctl --user status tepna-hybrid-index`
* hits look stale → run `node tools/xerj-load.mjs` (the timer does this hourly). Each run builds a FRESH
  `tepna-hybrid-<stamp>` index and moves the name `tepna-hybrid` to it; the replaced one is deleted.
  Reloading INTO one index is what the loader did until 2026-10-11, and the engine's vector graph never
  reclaims an overwrite: one index grew to 9.7 GB on disk and the server to 11.3 GB RSS.
* searches take seconds, or the loader reports the engine's memory breaker → `du -sh
  ~/.local/share/tepna/hybrid-index/*` — a `tepna-hybrid` directory (a real index wearing the alias's
  name) is the pre-2026-10-11 shape; one run of the loader replaces it.
* `loaded 0 documents` → **this is a failure, not a quiet success**: the cache, the corpus or the
  staleness rule stopped matching. The skip histogram in the output says which.
* nothing is wrong with Rule 0 — re-run without `--hybrid` and the default path answers as always.
