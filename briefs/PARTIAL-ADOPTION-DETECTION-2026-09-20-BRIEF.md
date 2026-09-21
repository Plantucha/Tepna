<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** DONE — 2026-09-20 (Osprey; scan 7 in `find_unwired.py` — population (1) only, advisory, 13 plants; AUDIT-PROMPT question for (2)/(3); §1 re-checked below) · **Created:** 2026-09-20

# A mechanism wired to one of N consumers — the case that reads as done

Charter: name the failure class in which **the machinery already exists, is correct, is tested, and one
of its several consumers never adopted it**; propose a mechanical check for the one population where
the denominator is derivable, and an audit prompt for the two where it is not. Nothing here asks for
new machinery in the product — the whole finding is that the machinery was already there.

## 1 · The measurement that produced this

Six instances, four sessions, **one day** (2026-09-20). Every one was found while doing something
else, and **not one needed new machinery built**:

| mechanism | built & documented | adopted at | found by |
|---|---|---|---|
| `adapter_usb_id` — docstring: *"the only sanctioned source of a rebind target"* | ✓ | **1 of 2** call sites | Heron, #2716 |
| `_adapter_responds` — post-recovery verification | ✓ | **1 of 4** radios | Heron, §9 note |
| flap cap `max_failovers` (P1.5) | ✓ | documented as **missing** | Heron |
| append-when-non-empty — `SessionSidecar`, `ClockSidecar` | ✓ | **2 of 3** writers; OXYLIFE lacked it | Wren, #2715 |
| passive `or_patterns` scan path | ✓ | observer **never** adopted | Wren, #2711 |
| `cmd_noquotes` quote/heredoc stripping | ✓ | **1 of 12** guard rules | Kestrel, #2710 |

**§1 re-checked 2026-09-20 (Osprey), each row against the tree, not the table:**

| row | state | evidence |
|---|---|---|
| `adapter_usb_id` | **fixed** #2716 | `git log -S'_usb = adapter_usb_id(_hci)'` → `c50be244`; scan 7 flags `_usb_rebind 0 [CALL:adapter_usb_id, CONFIG]` on `c50be244^` and nothing on `main` |
| `_adapter_responds` | open row | `2026-09-20-unpinned-radio-wedge-seen-only-at-failover` (OPEN) |
| flap cap `max_failovers` | **the "missing" was the DOC** — built since P1.5 (`capture.py:6256`, both failover sites); Heron's 2026-09-20 re-triage stamp on `CAPTURE-HOST-RESOURCE-ORCHESTRATION-AUDIT` §7 corrects it | row `2026-09-11-dead-adapter-goes-unnoticed` (OPEN) still names the three-status bundle; its picker-up reads that stamp first |
| OXYLIFE append | **fixed** #2715 | row `2026-09-20-oxylife-truncated-on-every-restart` stays OPEN for the re-measure it owes |
| `or_patterns` | open rows | `2026-09-20-o2ring-passive-scan-needs-or-patterns` + `…-needs-experimental-bluetoothd` (OPEN, box half owner-authorized) |
| `cmd_noquotes` | open row | `2026-09-20-guard-strips-quotes-for-one-rule-only` (OPEN) |

⚠️ **The six are not one population and must not be presented as one.** They are three, with different
denominators and different tractability — see §3. Merging them would let the one measurable case lend
credibility to the one that cannot work, which is the unification error `CLAUDE.md` and the owner's
standing filter both forbid.

## 2 · Why nothing catches it, stated precisely

`capture-host/tools/find_unwired.py` already owns the adjacent class, and its own header states the
taxonomy this extends:

> THE CLASS. This suite's documented failure mode is *a check that reports success about something it
> never examined*. This finds its sibling: **a check that examines correctly and reports to nobody.**

The third sibling is **a check that examines correctly and reports to only SOME of the places that
need it.** `find_unwired` answers `n == 0`. Nothing answers `0 < n < should_be`.

**The survival mechanism is the whole point: a zero-consumer mechanism looks BROKEN; a one-of-two
mechanism looks FINISHED.** Every instance in §1 has passing tests, a correct implementation, and at
least one real caller. There is nothing for a reviewer to see.

Osprey's #2714 finding is the same failure one layer down — a fake that **accepts** an argument and
drops it is indistinguishable from one that **checks** it, until a mutant changes the value.
Accepted-but-ignored and wired-but-unadopted are one shape in two artifacts.

## 3 · Three populations, three denominators

**The reframe that makes (1) tractable is Heron's: anchor the denominator on the CONSUMER, not on the
mechanism.** *"Who should have adopted `adapter_usb_id`?"* is not derivable from syntax and never will
be. *"Who calls `_usb_rebind`?"* is **2**, is purely syntactic, and the defect is then visible as **the
same parameter arriving by two materially different provenances** — one site derives it
(`adapter_usb_id(...)`), the other reads config (`wcfg.get("usb_path")`). No exclusivity docstring
needed, no population guess needed.

| # | population | denominator | tractable? |
|---|---|---|---|
| 1 | **consumer call sites** — `_usb_rebind`'s 2 callers | syntactic, countable | **yes — advisory check** |
| 2 | **sibling blocks** — `cmd_noquotes` (1 of 12 rules), OXYLIFE (1 of 3 writers) | "structurally similar blocks", clone-detection heuristics only | report, never a gate |
| 3 | **data populations** — `_adapter_responds` (1 of 4 **radios**) | **not in the code at all — it is the hardware** | **no, in principle** |

⚠️ **(3) is not a hard problem, it is an impossible one for any syntactic tool.** The denominator is a
count of physical devices. Only a human asking *"one of how many?"* finds it. Proposing a detector that
appears to cover it would be the fabricated-coverage failure this repo keeps recording.

⚠️ **The cleanest instance in §1 is one the mechanical check CANNOT see.** `cmd_noquotes` — the hook's
header documents the stripping, names the 2026-08-05 instance that forced it, and wires it to one rule
while eleven have been denying commit messages ever since — is population (2). State this plainly so
nobody reads (1)'s success as coverage of the class.

## 4 · Measured evidence for population (1)

Heron built a 70-line stdlib-`ast` probe (read-only) and ran it before proposing anything:

- **116 files scanned (Heron, package only) → 1 flag, 0 false positives, and the flag IS the defect.**
- **Independently re-run (Kestrel) over 404 files including `tests/` → 1 flag, same one:**
  `_usb_rebind [('CONFIG', 6197), ('CALL:adapter_usb_id', 6067)]`

⚠️ **Note the two file counts and do not average them.** 116 and 404 are different populations, not a
disagreement; the *finding* is identical. Three times on 2026-09-20 two sessions counted different
denominators for the same shape (this; 24 vs 58 files on Osprey's fake pattern; 187 vs 6616 paths on the
rescue snapshot). **Quote the pattern beside any number.**

### 4.1 · Two caveats that must reach the owner rather than be discovered

- **n = 1 true positive.** Zero false positives across 116 files is *encouraging, not established* — the
  FP rate was measured on a codebase containing exactly one instance. **The FP rate is the number that
  decides advisory-vs-gate, and nobody has it.**
- **A config read is often CORRECT.** The CPAP's `ble_stream.adapter` is legitimately configured. The
  rule survives only because it flags **divergence between callers of one consumer**, never "config
  reads are suspect". A broader phrasing convicts working code.

### 4.2 · 🔴 The probe's first version missed the defect it was written for

`_cp_usb = adapter_usb_id(_cp_hci) if _cp_hci else None` is an `IfExp`; the provenance classifier
understood only `Call`, so that site returned UNKNOWN, the pair never formed, and the probe reported
**2 flags — both builtins (`sleep`, `str`) — and zero real ones.**

**A detector for silently-narrow adoption that was itself silently narrow.** `find_unwired`'s header
records the same thing happening twice to it (*"TWO SCAN DRAFTS WERE WRONG BEFORE THIS ONE, both in
ways that produced confident nonsense"*), which makes this the third occurrence in one tool's lineage.

**Therefore: any implementation MUST be validated by a PLANT, never by finding the known instance.**
The known instance is what it was tuned against; rediscovering it proves only that the tuning worked.

## 5 · Proposal

1. **Population (1) as an advisory check inside `find_unwired.py`** — not a new tool. It already owns
   *"is this wired"*, already has the allowlist-**with-a-reason** discipline, already exits 0 always
   (*"a gate that fails on those trains people to silence it, which is the same failure one level up"*),
   and already answers the `n == 0` case. Adding `0 < n < should_be` extends its own stated taxonomy.
2. **Populations (2) and (3) into `AUDIT-PROMPT.md`** as a question, not a scan: *for each mechanism
   this change touches — how many places should use it, and how many do?*
3. **Do NOT present the three as one detector.**

### Done when

- [x] `find_unwired.py` reports divergent-provenance arguments among the callers of one consumer;
      exit stays 0; an allowlist entry requires a reason. — scan 7, `ALLOW_PROVENANCE`, staleness-checked
      like the other allowlists; deliberately OUTSIDE the `--check` sum until an FP rate exists on n > 1.
- [x] A **planted** test: a synthetic two-caller divergence the scan must flag, and a legitimate
      configured-value caller it must not. Plant added **before** the scan is pointed at real source.
      — **13 plants**, and the ORDER matters more than the count: 5 were written before the first
      real-source run, which then flagged 9 consumers and MISSED `_usb_rebind`; each subsequent plant
      names the shape that run exposed (§4.2's IfExp; the value ONE ASSIGNMENT UPSTREAM — `_usb_rebind(str(_cp_usb))`;
      builtin wrappers transparent; `dict.get` vs a method named `get`; a Name binding AFTER the call
      — `share = _abs_path(share)`; a parameter inheriting `main()`'s `root = cfg["root"]`; `out["k"]`
      subscript targets; two modules each defining `probe`). Every one was planted red, then fixed.
- [x] The FP rate is stated from a run over the whole package, with the population named. —
      **`main` at 2026-09-20: 93 files · 304 consumers with ≥2 callers · 692 slots compared · 1 flagged ·
      0 TP · 1 FP** (`_num_signal`: `channels.get(name, [])` is a DATA mapping; `.get` cannot tell config
      from data — the classifier's known FP mechanism, allowlisted with that reason). **`c50be244^` (the
      tree before #2716): 691 slots · 2 flagged · 1 TP (`_usb_rebind`) · 1 FP (the same).** n=1 TP is a
      confirmation of tuning, not a rate — which is why the check is advisory.
- [x] `AUDIT-PROMPT.md` carries the "one of how many?" question for (2) and (3), saying explicitly
      that no tool covers them.
- [x] This brief's §1 table is re-checked: each of the six either fixed, or carrying an open row. — table under §1.

⚠️ **Not done when a detector exists.** A detector that finds the six known instances and nothing else
has measured its own tuning.
