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

### The board lane — new board posts in search within minutes (owner, 2026-10-31)

```sh
cp tools/systemd/tepna-board-search.service ~/.config/systemd/user/
cp tools/systemd/tepna-board-search.timer   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tepna-board-search.timer            # every 5 min
```

The tick runs `tools/bge-reindex-driver.sh --board`: the board export, an embed of what changed, and
`xerj-load.mjs --only ext:agent-board/ --newer-than 10`. That load upserts into the generation that
serves the alias now, and it never builds or promotes one. The hourly reload stays the source of truth.
A quiet tick reports `NOT_APPLICABLE` and writes no log line.

## The reranker server — the OWNER enables it too

Rule 0 asks this server on every hybrid search (owner, 2026-10-12). It scores the fused top 20 and
refuses a search whose best score is under 0.105. It never changes the order of the hits. When the
server does not answer, the search uses the cosine and BM25 floor and prints one line that says so.

```sh
# stop the hand-started server first: it holds port 8091
ln -s ~/Tepna/tools/systemd/tepna-rerank.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tepna-rerank.service
curl -s http://127.0.0.1:8091/health                              # {"status":"ok"}
node tools/doc-search.mjs --brief "a question"                    # prints "reranker best score"
```

| floor | answerable refused | off-topic refused | hold-out off-topic refused |
|---|---|---|---|
| cosine and BM25 | 1 of 52 | 38 of 40 | 18 of 20 |
| reranker | 1 of 52 | 40 of 40 | 20 of 20 |

`node tools/doc-search.mjs --no-rerank "…"` uses the old floor by name.
`node tools/xerj-bench.mjs --refusal --rerank` repeats the measurement.

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
* `⚠ no reranker (…)` under the hits → the reranker server is down: `systemctl --user status tepna-rerank`.
  The search still answers, on the old floor.
* nothing is wrong with Rule 0 — re-run without `--hybrid` and the default path answers as always.
