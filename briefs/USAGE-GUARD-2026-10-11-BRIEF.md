<!--
  USAGE-GUARD-2026-10-11-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->
**Status:** DONE — 2026-10-11 · **Created:** 2026-10-11

# Usage guard — what the fleet has spent, measured; what nobody can measure, said so

**Owner, 2026-10-11 (an external review's proposal, with "make it better for Tepna-specific use, API
agents too, and implement it").** The proposal had two halves: operating rules every agent follows
about usage and allowance, and a small local service that reports them. This brief delivers the service
as `tools/usage-guard.mjs`, states what it can and cannot measure on this machine, and carries the
operating rules in §4 as text for the owner to adopt into `CLAUDE.md` — a coordinator does not edit
that file.

## 1 · Why

The 2026-08-31 directive schedules fleet work against the weekly allowance, and the only instrument was
the owner reading a percentage off a web page and typing it into chat ("97 % usage, let everyone idle",
2026-09-29). Nothing in the repo could say what a session had spent, how full a context was, or what an
API reader run cost. Every budget decision rested on a remembered number.

## 2 · What is measured, from where

Every figure carries its source and timestamp; none is estimated.

| quantity | source | how |
|---|---|---|
| per-session input, cache-creation, cache-read, output, thinking tokens | the session's own Claude Code transcript (`~/.claude/projects/<cwd-slug>/<session>.jsonl`, the `usage` block on every assistant message) | streamed line by line; the file is never loaded whole (a day-long session is ~470 MB) |
| context utilisation proxy | the LAST assistant message's prompt size: input + cache-creation + cache-read | the model's window is not read anywhere, so no percentage is printed from the transcript |
| session → bird name | the herder (`herdr agent list`) | absent when the herder is not running; the id stands in, never a guess |
| API reader runs | `tools/gemini-review.mjs --out <jsonl>` records; the provider's own usage object inside each `response` body (Gemini `usageMetadata`, OpenAI-shaped `usage`, Anthropic `usage`) | a record without one is COUNTED as "no usage field", never as 0 |
| Claude Code's own status-line figures | the statusLine stdin JSON (`context_window`, `cost`) when the running version sends them | labelled `[statusline]`; the transcript tail is the fallback, labelled `[transcript]` |

**The headline is FRESH tokens — input + cache-creation + output — with cache reads beside it, never
summed in.** Measured on the first live run (24 h to 2026-10-11 10:03Z): cache reads were 2,660M of a
2,684M "total". A sum would have published a fleet figure 100× the work done, and a budget reading it
would have tripped on cached prefixes.

## 3 · What is NOT measured, and is said so

The **plan allowance** (the percentage on the web page), its **reset time**, and a **provider's
remaining spend** are not exposed to a program on this machine. The tool reports them as `UNKNOWN`
with the supported manual check named — `/usage` or `/cost` in a Claude Code session, `/status` in a
Codex session, the provider's console — and never derives a percentage from tokens: a token count is a
fact about a SESSION, a percentage is a fact about an ACCOUNT, and the two are never the same number.
The 25 % and 10 % thresholds therefore bind on a **configured** budget (`--budget <name>=<tokens>`) and
every warning says "of the CONFIGURED budget".

Also not built, deliberately: a Codex adapter (no Codex session runs here; its quota is exhausted until
2026-11-03 by the owner's report), a reader for Wren's transcript on the capture box (the box is
read-only to the fleet and its transcripts stay there), and any price table (a price typed by hand is
indistinguishable from a measured one — the provider's console is the source of spend).

## 4 · Operating rules — proposed text for `CLAUDE.md` (owner adopts; verbatim-ready)

> ### 📊 Usage and allowance awareness (owner, 2026-10-11)
> - **Measured, or UNKNOWN. Never estimated.** `node tools/usage-guard.mjs` is the instrument: per-session
>   fresh tokens (input + cache-creation + output) with cache reads beside them, the last prompt size as the
>   context proxy, and the API reader runs' usage — each with its source. The plan allowance, its reset and
>   provider spend are `UNKNOWN` to every program here; the manual check is `/usage` (plan) or `/cost`
>   (session) in Claude Code, `/status` in Codex, the provider's console. Never write a quota, a remaining
>   percentage, a reset time or a token count you did not read from one of those.
> - **A session's tokens are not the account's allowance.** Report the two separately, always; a share is
>   stated only against a CONFIGURED budget and says so ("of the configured budget").
> - **Re-check at every major boundary** — before a mutation run, a full-tree gate, a sweep over many
>   files, or a multi-hour analysis — and at every unit completion report the measured delta
>   (`--since <start>`), the configured-budget state, and `allowance: UNKNOWN (manual: /usage)` unless the
>   owner has reported the figure in chat, in which case quote it with the time they said it.
> - **At ≤ 25 % of a configured budget, warn the coordinator; at ≤ 10 %, stop optional work**: no new
>   units, no exploration, save progress, and hand off with branch, commit, gate state, open tasks and the
>   usage figures as measured.
> - **The herder's name is the address; the transcript is the evidence.** A bird's spend is read from its
>   own transcript by session id, never from what it reports about itself.

## 5 · Measured on landing (2026-10-11, rig-x870, the four herder sessions)

| window | sessions | fresh tokens | served from cache |
|---|---|---|---|
| 24 h to 10:04Z | 4 | 24.53M (kestrel 7.55M · magpie 6.36M · osprey 5.38M · heron 5.23M) | 2,667.73M |
| 7 d to 10:04Z | 4 | 114.59M (osprey 31.93M · magpie 29.87M · heron 27.60M · kestrel 25.20M) | 10,309.30M |

Last prompt sizes at that instant: magpie ≈ 830k · kestrel ≈ 507k · osprey ≈ 427k · heron ≈ 330k
tokens. Wall time of the 24 h run over ~950 MB of transcripts: 3 s. Plan allowance: UNKNOWN (not
exposed); the owner's last reported figure was 97 % on 2026-09-29.

Where the agents run (the review's open question): every Claude Code coder runs locally — Kestrel,
Osprey, Magpie and Heron in terminals on rig-x870 under the herder, Wren on the capture box under its
own herder, Finch roaming through the cross-session bridge — so transcripts are local files on the
machine that ran them. No session is hosted; the owner's web Claude is a conversation, not a coder. No
Codex session exists here. The API readers are not sessions at all: each is one request from the rig,
recorded by `gemini-review.mjs`, and their usage is read from those records.

## 6 · Acceptance — all met

- [x] `node tools/usage-guard.mjs` streams the transcripts, names the sessions via the herder, reads
      API reader records, judges configured budgets, and emits ONE `tepna.verdict/1` (gate `usage-guard`)
      beside a `tepna.usage/1` measurement — `--selftest` 46/46 on planted records, including: a message
      without a usage block is counted, never zero; a NOT_APPLICABLE / NOT_RUN verdict carries `result:
      null`; an unreadable directory never prints "0 used · 100 % remains"; the status line never prints a
      plan percentage.
- [x] Adopted in `tools/verdict-adoption.json` (bin `decides`, `--verdict-sample` → NOT_RUN / checked 0).
- [x] The proposed operating rules are in §4, for the owner — not written into `CLAUDE.md` by the fleet.
- [x] `--status-line` reads Claude Code's statusLine stdin JSON when given and labels its source.

## 7 · Not in scope

A hook that runs the guard automatically at task boundaries (the owner decides whether the measured
delta goes into every PR body), a Codex adapter, a price table, and reading Wren's transcript across the
box boundary.
