<!--
  HEALTH-BOX-VISION-2026-07-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-07-01

# Tepna Vigil — the bedside health box (product vision & capability model)

> **What this is.** The **product / experience layer** for the bedside Raspberry Pi that
> `CAPTURE-HOST-2026-06-29-BRIEF.md` specifies as **reference architecture**. That brief answers *how
> the box is built* (hardware, capture daemon, web server, night store, integration contract). This
> brief answers *what the box is, what it does for a person, and in what order it earns each
> capability* — and it gives the appliance a **name: Tepna Vigil**. It **extends** the capture-host
> brief and **must not relitigate** it: every hardware pick, parser rule, filename convention, and
> Clock-Contract detail stays owned there. Styled mirror: **`Tepna Vigil — Health Box Vision.html`**
> (the visual vision page; this markdown is the authoritative text, the HTML is the pretty face —
> same relationship as `WHY-THIS-EXISTS.md` ↔ `Why This Exists.html`).

The division of labor, stated once so the two briefs never drift:

| | `CAPTURE-HOST` brief | **this** `HEALTH-BOX-VISION` brief |
|---|---|---|
| Answers | *How is it built?* | *What is it, and why, and in what order?* |
| Owns | BOM, dongle, daemon, systemd, `/srv/tepna` layout, the §7 integration contract, reliability checklist | the **name**, the **capability model** (v1 → next → someday), the **hero experience**, the **context/automation vision**, the product principles |
| Kind | Reference architecture | Product vision |

---

## 1. The name — **Tepna Vigil**

The appliance needs a product-surface name; "the capture host" / "the health box" are descriptions, not
a name. **Tepna Vigil.**

- **Why "Vigil."** The box's single defining behavior is that it **keeps watch through the night so you
  don't have to** — hands-off capture, always-on, wakes you to an answer. A vigil is exactly
  "a period of keeping awake to watch over." It reads calm, nocturnal, and protective — the right
  register for a device on the nightstand of someone who may be watching a real health concern. It also
  names the *hero capability* (the live watch), so the name and the product point at the same thing.
- **Shape.** `Tepna Vigil` — **Tepna** is the product brand (per `licensing/LICENSING-BRIEF.md`),
  **Vigil** is the appliance within it, exactly as **OxyDex / HRVDex / …** are apps within Tepna. The
  box is "a Tepna Vigil"; the fleet of analyzers it serves stays "the Dex suite."
- **⚠️ Frozen-name safety (non-negotiable).** `Vigil` is a **new product-surface label only**. It does
  **not** touch any frozen identifier: not the event-bus codename **`Ganglior`**, not the
  `ganglior.node-export` schema, not the `fascia` alias, not the **Integrator**, not any `*-dsp.js` /
  `*-app.js` symbol. Do not rename services, schemas, or code to "vigil" — the systemd units stay
  `tepna-capture` / `tepna-web` / `tepna-analyze` as the capture-host brief names them. `Vigil` lives
  in user-facing copy, docs, and the mDNS-friendly marketing name; the machine name can remain
  `tepna.local`. (Alternatives considered and rejected as either too generic — *Hub / Base / Box* — or
  overclaiming clinical duty — *Sentinel / Watch*. *Vigil* is watchful without medical-device
  overreach; keep the intended-use disclaimer per `LICENSING-BRIEF §6.5` on every surface regardless.)

---

## 2. The product in one line

> **Tepna Vigil is one Raspberry Pi by the bed that captures every signal all night, streams them live
> to any screen in the house, keeps every night on disk, has last night already fused before you wake,
> and explains it with the room, the weather, and your day. Press nothing. Wake up to the answer.**

The **five-stage loop** (the spine of the vision page):

```
  CAPTURE ──► STREAM ──► STORE ──► ANALYZE ──► CONTEXT
  all night   live in     disk is    fused by    why it
  hands-off   the browser  truth      dawn        happened
```

Stage 1–3 are v1 (the capture-host brief's core); stage 4 is "next"; stage 5 is "next → someday." The
loop is what turns a fleet of careful analyzers from *tools you must remember to run* into *an appliance
that runs itself* — the whole reason the box is worth building.

---

## 3. The capability model — six jobs, three waves

Every capability is phased so the vision stays **buildable, not a wish-list**. A capability only moves
up a wave when the one below it is real. Nothing here invents a new parser, DSP path, or export schema —
each job is composed from pieces the suite already ships (that constraint is the point).

| # | Capability | Wave | What it means for a person | Rests on |
|---|---|---|---|---|
| 1 | **Capture** | **v1 · now** | Wear the sensors, sleep; the night is written automatically in the exact vendor layouts the apps parse. | `CAPTURE-HOST §3/§6` (daemon), `§7` (contract) |
| 2 | **Stream & serve** | **v1 · now** | Open `tepna.local` on any device; watch live traces + metrics, or open any Dex app. | `CAPTURE-HOST §4/§6` (`tepna-web`), `GATE-LIVE-RUNNABILITY` (same-origin) |
| 3 | **Store & back up** | **v1 · now** | Every raw capture + node-export is durable on the SSD and re-ingestible; auto-backup to a second box. | `CAPTURE-HOST §4` (night store), `§8` (backup = re-ingest) |
| 4 | **Auto-analyze** | **next** | Last night is already fused when you open it — a nightly job walks the folder and runs each node → Integrator. | `CAPTURE-HOST §4` (`tepna-analyze.timer`), `env.equiv` gate (≡ the apps) |
| 5 | **Context channels** | **next** | A bad night has a *cause*, not just a score — room, weather, and life tags on the same timeline. | §4 below (new product surface) |
| 6 | **Automate & act** | **someday** | The signals + context drive the room through Home Assistant — gentle wake, vent alerts, light/noise. | §5 below (horizon) |

Jobs **1–3 are the loop closing** — the milestone. Jobs **4–6 are earned capability on top**, each a
thin driver over existing gate-proven pieces, never a rewrite.

---

## 4. The hero — the live view (job 2, given the spotlight)

Of the six jobs, **the live multi-signal view is the heart** and gets the hero treatment, because it is
the one capability nothing else in the suite offers today: **watch your own body in real time.** Every
Dex app is a *morning-after* reader of a file; Vigil adds the *tonight, as it happens* view.

- **Both layers, per the product decision:** **raw waveforms** (ECG / PPG / EEG scrolling traces) **plus
  a derived-metric strip** (HR, SpO₂, HRV, motion updating live). The raw traces prove the sensor is on
  and reading; the strip is the glanceable "am I OK right now."
- **Same DSP, live feed.** The live view runs the **same node DSP** the bundled apps run, fed by the
  live BLE stream instead of a morning file — so what you watch at 2am and what you read at 8am are the
  **same numbers**. No second, drifting "live-only" analysis path. (Implementation note for the build:
  the live strip should call the node's headless `compute()` on a rolling window, not reimplement it.)
- **Where it lives.** A served page at `tepna.local` (its own route, or a panel in a small dashboard),
  same-origin with the apps so it shares `tepna_profile`. Real-time DSP in the browser is well within a
  phone's budget at these rates (`CAPTURE-HOST §3`: EEG ~256 Hz × 4–5 ch is the ceiling and is trivial).
- **Honesty carries over.** Live numbers wear the **same evidence badges** as everywhere else
  (`CLAUDE.md §🎫`) — a live SpO₂ is `measured`, a live sleep-stage guess is `emerging`. Live-ness is
  not an excuse to drop a grade, and a dropped link shows a **gap**, never a fabricated live value.

---

## 5. Context channels — "why was last night bad?" (job 5, the payoff)

Signals alone tell you *that* a night was rough; the box's unique leverage is telling you *why*, by
lining the body up against everything else on **one floating-wall-clock timeline** (Clock Contract — the
same clock is what lets a room sensor and a chest strap align without sharing a timezone). This is the
capability that most justifies "why a Pi and not just a phone app": the box can **pull in and hold
context a phone can't.**

Channels, in rough build order:

1. **Bedroom environment** — temp · humidity · **CO₂** · light · noise from a bedside sensor. The room
   as a signal. (The killer correlation: desaturations that track rising CO₂ in a closed room are a
   *ventilation* story, not an *apnea* story — a distinction the body signals alone can't make.)
2. **Weather + outdoor air quality** — fetched **at the box**, stamped to the same clock. *(Note: this
   is the box, a host process, reaching out — **not** a Dex app phoning home. The "100% local, no CDN"
   rule governs the served *apps*, which still make zero external requests; the host fetching context
   is a separate, opt-in process, and fetched context is cached to disk like any other channel. Keep
   the two straight — `CAPTURE-HOST §7.6`.)*
3. **Home Assistant** — read whatever the smart home already knows (window state, HVAC, presence) via
   its local API; the read direction is v-"next", the *act* direction is §6/someday.
4. **Life-context tags** — one-tap notes (travel, alcohol, late meal, illness) that explain outliers;
   the cheapest channel and often the most explanatory.
5. **Phone / wearable cross-import** — Apple Health / Health Connect, so nothing important lives in a
   silo the box can't see (this also carries the Lingo CGM export per `CAPTURE-HOST §3`).

**The surface it produces:** a **night-story timeline** — body events + context events on one axis, with
a plain-language verdict ("likely ventilation, not apnea — crack the window before blaming the airway").
Correlation is **suggested, evidence-graded, and reversible**, never asserted as diagnosis; multi-night
"what actually moves my sleep" is the someday extension.

---

## 6. Automate & act — the horizon (job 6, someday)

The far wave closes the *other* loop: let signals + context **drive the room**, through Home Assistant's
local API (two-way). Deliberately last, because acting on the body raises a safety bar the read-only
jobs don't.

- Dim lights / nudge thermostat / fade white noise from the live state.
- **Gentle wake** timed to a light-sleep window (needs the EEG stage, which is `emerging` — so wake is a
  *nudge*, never a promise).
- **Vent alert** when CO₂ climbs while SpO₂ dips — the §5 correlation, turned into an action.
- Guardrail: actuation is **opt-in, local, and reversible**; the box never acts on a signal it grades
  below `measured` without a human in the loop.

---

## 7. Experience principles (the product's non-negotiables)

These mirror the vision page's trust band and inherit directly from the suite's constitution — stated
here so a future contributor building a Vigil surface can't accidentally violate one:

- **Local by law.** Serving the LAN is not egress; the apps make **zero external requests**. Remote
  access is **Tailscale**, never WAN (`CAPTURE-HOST §8`, `PHI-SURFACE-STATEMENT.md`).
- **Disk is truth.** Captures + exports on the SSD are the system of record; browser storage is a
  **rebuildable cache**; backup means **re-ingest**, not cache-dump (`CAPTURE-HOST §4/§8`).
- **One clock.** Every channel — body, room, weather, life — is stamped **floating wall-clock ms** so a
  night lines up on any viewer in any timezone (`CLAUDE.md §🔒`).
- **Zero forks.** Vigil is a **producer + host**, never a parser edit. New formats land as one adapter +
  one gate (`ADD-AN-ADAPTER.md`); the served fleet ships unchanged (`CAPTURE-HOST §7`).
- **Honesty scales to live + context.** Every surfaced number wears its evidence badge (`CLAUDE.md
  §🎫`); a gap is a gap, never a fabricated value; correlation is graded and reversible, never diagnosis.

---

## 8. What is genuinely NEW in this brief (the delta vs CAPTURE-HOST)

So a reviewer can see exactly what this brief adds and what it merely frames:

- **NEW:** the name **Tepna Vigil** (§1); the phased **capability model** as a product artifact (§3);
  the **hero framing** of the live view with the both-layers + same-DSP decisions (§4); the
  **night-story** context surface + the local-vs-egress clarification for fetched context (§5); the
  **automation guardrails** (§6); the styled vision page as a deliverable.
- **FRAMED ONLY (owned elsewhere, do not duplicate):** all hardware, the daemon, systemd, the storage
  layout, the integration contract, reliability — `CAPTURE-HOST`. The Clock Contract — `CLAUDE.md §🔒`.
  Evidence badges — `CLAUDE.md §🎫`. Same-origin gate-running — `GATE-LIVE-RUNNABILITY`.

---

## 9. Open product questions (human calls)
- Confirm **Tepna Vigil** as the name (or pick from the rejected set in §1) — this brief proceeds on it
  but it is a naming decision the human owns.
- Live view as its **own route** vs a **panel in a status dashboard** (which also shows §8 `status.json`).
- Is **context (job 5)** in the near roadmap, or does v1 ship as pure capture/serve/store and context
  waits? (Changes whether env-sensor procurement joins the hardware order in `CAPTURE-HOST §5`.)
- How much of the **night-story verdict** is rule-based (CO₂↑ + SpO₂↓ → ventilation) vs left to the
  human to read from an aligned timeline — i.e. how far to trust automated correlation copy.
- Automation (job 6): in scope as a real horizon, or explicitly parked as "not building"?

## 10. Deliverables / Done when
This is a **vision brief**; its job is to name the box and fix the capability model + experience
principles, not to ship code. It flips to DONE when:
- ☑ The **name** is proposed with rationale + frozen-name safety (§1). *(done in this brief)*
- ☑ The **phased capability model** (v1 → next → someday) is written and each job is tied to an existing
  gate-proven piece (§3). *(done)*
- ☑ The **hero live-view** decisions (both layers, same DSP, badges carry over) are recorded (§4). *(done)*
- ☑ The **context / night-story** surface + the fetched-context local-vs-egress rule are recorded (§5). *(done)*
- ☑ The **styled vision page** exists and mirrors this text (`Tepna Vigil — Health Box Vision.html`). *(done)*
- ☐ The **human confirms the name** (§9 first bullet) — until then the name is PROPOSED, not frozen.
- ☑ `DOCS-INDEX.md` carries a row for this brief (registered 2026-07-01, marked PROPOSED). *(done)*
- ☐ *(when built)* a Vigil **live-view route** ships on the served box and shares `tepna_profile`
  same-origin — but that is a `CAPTURE-HOST` "Done when" item; this brief only specifies its shape.

## 11. Expected follow-up
Real use will reshape the capability order (which context channel earns its keep first; whether the live
view wants alarms; how much correlation copy people trust). Capture it in
`HEALTH-BOX-VISION-FOLLOWUPS-YYYY-MM-DD-BRIEF.md`. If the name is rejected, that follow-up records the
chosen name and this brief flips `Superseded-by:` per the `CLAUDE.md` brief-lifecycle rule rather than
being renamed. If nothing surfaces, say so in this brief's header.

---

## Cross-references
- **`CAPTURE-HOST-2026-06-29-BRIEF.md`** — the reference architecture this brief sits on top of (hardware,
  daemon, `tepna-web`, night store, the §7 integration contract, reliability). **Read it first.**
- `Tepna Vigil — Health Box Vision.html` — the styled visual mirror of this brief.
- `CLAUDE.md` §🎙️ Capture provenance · §🔒 Clock Contract · §🎫 Evidence badges · §📜 Licensing (Tepna brand)
- `licensing/LICENSING-BRIEF.md` (the **Tepna** product brand `Vigil` extends) · `LICENSING-BRIEF §6.5` (intended-use disclaimer)
- `GATE-LIVE-RUNNABILITY-2026-06-28-BRIEF.md` (same-origin serving → the gates + shared profile work from the box)
- `ADD-AN-ADAPTER.md` (new context/vendor formats land here, never as a parser edit)
- `PHI-SURFACE-STATEMENT.md` (the on-box privacy posture the live + context surfaces inherit)
- `ARCHITECTURE-PRINCIPLES.md` (honesty-as-architecture, the evidence ladder the live view carries)
- `WHY-THIS-EXISTS.md` ↔ `Why This Exists.html` (the doc-↔-styled-mirror precedent this brief follows)
