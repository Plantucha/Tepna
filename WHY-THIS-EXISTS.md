<!--
  WHY-THIS-EXISTS.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0

  NARRATIVE / VOICE — not a contract. This file states the project's intent and
  tone. It is NOT spec: it defines no formats, no APIs, no behavior. Nothing here
  should be read as an instruction to implement. For authoritative rules see
  CLAUDE.md, README.md, and the *-BRIEF.md documents. Styled mirror: "Why This
  Exists.html".
-->

# Why This Exists

*Colophon — narrative, not spec.*

The story goes that the Swedish writer [August Strindberg](https://en.wikipedia.org/wiki/August_Strindberg) once blew pipe smoke into a bucket of water to see if he could make gold.

*What a strange idea from a brilliant mind.*

But maybe that's the wrong way to look at it. Maybe Strindberg wasn't the man who thought smoke could make gold. Maybe he was the man who proved that it couldn't.

Someone has to explore the dead ends of human knowledge. Someone has to walk down the wrong path, all the way to the end, and come back to tell everyone else:

> "Not this way, friends."

Under suitably favorable conditions, of course.

By which I mean the arrival of a cold front, freezing temperatures, several failed experiments, three contradictory papers, and the discovery that the thing I spent many moons building measures absolutely nothing useful.

This project exists in that spirit. Some ideas will work. Most won't.

Every experiment deserves to be performed at least once. Preferably by someone else.

## We Already Have the Answer

The answer is **42**. The trouble is that nobody knows the *question.*

That's the actual job here. Answers are cheap — you can compute one to ten decimal places before breakfast. The hard part is working backward to the question that makes the answer mean anything.

The program advances by suddenly running down the wrong end of a maze, eating the wrong bit of cheese, or unexpectedly dropping dead of myxomatosis — and if it's finely calculated, the cumulative effect is enormous.

Every wrong turn is a data point. The cheese counts.

So I run the maze on purpose, and I write down where the walls are.

This project computes a lot of metrics.

Some of them may turn out to measure absolutely nothing useful.

## Why It Looks Like This

As devoted Ham radio operator [KQ4KIJ](https://www.qrz.com/db/KQ4KIJ) I'm previously intimately familiar with a concept called the **Wife Acceptance Factor** — WAF, the informal but merciless measure of how much domestic invasion a hobby can get away with — (occasionally implemented as Partner Acceptance Factor, with lower impact score).

It is an informal measure of how much a partner is willing to tolerate a hobby's cost, equipment, and general invasion of daily life. For biohackers and self-quantifiers, WAF is not a joke. It is a *load-bearing engineering constraint.*

Score is calculated including, but not limited to:

- **Aesthetics** — the number of wearables, pulse oximeters, chest straps, and electrode patches currently attached to your body.
- **Space** — how much of the bedroom, bathroom, and living room has quietly become a miniature research lab.
- **Cost** — the budget vanishing into devices, supplements, and "just one more" sensor.
- **Noise & Light** — the blinking LEDs, charging docks, and overnight lab equipment that turn a bedroom into a small datacenter.
- **Time** — the hours spent collecting data, tuning dashboards, and reading papers at an hour no reasonable person is awake.

Anyone who can install a whole-home sensor network, maintain a 14-supplement morning routine, and run multiple sleep monitors *without* triggering a household rebellion has achieved a level of systems engineering that deserves academic recognition, possibly a medal.

So the whole project is built around one ironclad rule: **maximum information, minimum hardware, minimum annoyance.**

One should never reject a hypothesis merely because it appears ridiculous. Ridiculous hypotheses have an unfortunate habit of occasionally being correct, which only encourages them.

## Why Consumer Sensors?

Because I like the idea of doing more with less.

Also, because I have them.

I think of [William Kamkwamba](https://en.wikipedia.org/wiki/William_Kamkwamba), a teenager in **Malawi** who built a working wind turbine out of bicycle parts, scrap metal, and a library book — and brought electricity to his family's home during a famine. He did it to keep people alive.

I am, by comparison, using bicycle parts and scrap metal to find out whether my heart rate variability dips after the second coffee.

Same principle. Slightly lower stakes. Significantly better coffee.

Still — consumer devices are cheap, widely available, and already sitting in people's homes. Instead of dreaming about a hospital-grade laboratory, I'd rather see how far I can push the gear ordinary people can actually buy.

The goal isn't to use the most expensive equipment. The goal is to get **105%** out of the equipment you already have.

*(That said — if someone wants to send me free lab equipment, I will not say no. 😁)*

## Why So Much Documentation?

I'm told I have a playful personality. The side effect is that people can't always tell when I'm joking and when I'm serious.

Sometimes I can't either.

This is less of a confession and more of a known system parameter.

That's why you'll find citations, references, and documentation scattered throughout this project. Not because I enjoy over-documenting things — okay, *slightly* because of that — but mostly because citations are a natural guardrail against confusion. When a claim matters, you should be able to trace it back to the source and decide for yourself.

> Life is optional. The references are not.
>
> — *the whole thing, in one line*

## Why "Tepna"

[**Tepna**](https://en.wiktionary.org/wiki/tepna) is Czech for *artery* — a small homage to where I'm from, and to the only thing this whole project really does: carry a faint physiological signal from where it's measured to where it can mean something.

The rest of the suite is named from the body too — the nodes that sense, the bus that relays, the centre that integrates. The artery just carries. That felt like the right name for the part you're looking at.

## Who am I

Mailman, Ham radio operator, an amateur scientist, an amateur astronomer, master of dead ends, ballroom dancer, inventor, electronic engineer, world traveller, explorer, philosopher, businessman, photographer and sportsman, among other things.

I am also, according to several years of independently collected customer-satisfaction metrics, a remarkably nice guy. look for yourself:

```
985,1070,1031,914,878,953,1015,957,878,903,1008,1074,994,889,887,967,997,903,833,880,1003,1026,938,874,915,987,965,837,800,887,989,981,896,868,940,996,949,843,845,939,1029,984,907,921,1009,1042,953,865,889,991,1042,965,889,955,1059,1048,924,853,896,996,978,881,848,944,1038,1000,872,827,892,966,920,819,832,963,1047,978,884,883,966,994,913,838,893,996,1038,964,901,947,1050,1026,921,861,925,1036,1031,936,917,1003,1052,989,867,837,941,1001,957,870,907,989,1040,952,841,847,942,979,906,841,889,1012,1022,927,844,886,976,969,887,851,954,1050,1043,937,899,953,1013,969,862,855,975,1050,996,896,910,998,1013,908,821,854,957,1009,933,852,905,987,974,873,806,877,973,984,900,863,950,1021,997,875,834,920,992,973,879,891,998,1057,983,880,864,965,1019,949,873,926,1039,1070,966,890,915,997,977,888,846,932,1032,1019,911,865,916,987,938,827,827,927,1008,977,866,857,955,1007,920,827,853,951
```

All metrics are fully reproducible. Permission to understand it is expected within 30–60 business days.

## Dedication

This project is dedicated to [**Jára Cimrman**](https://en.wikipedia.org/wiki/J%C3%A1ra_Cimrman) — the greatest Czech who never existed. Playwright, inventor, polymath, and permanent runner-up in the Greatest Czech of All Time poll, disqualified on a technicality of not being real. He was somehow present at many defining moments of modern history and left no verifiable trace of any of them, which is either a scandal or a methodology.

[Planet 7796 Járacimrman](https://en.wikipedia.org/wiki/7796_J%C3%A1racimrman) orbits the Sun in his honor.

If this project occasionally wanders down strange paths, investigates improbable ideas, and takes itself only slightly too seriously, that is entirely his fault. He would have understood this project completely.

In fact, there is every possibility that he invented it first and neglected to publish the results.

◈ end
