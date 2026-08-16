---
bump: minor
type: added
---

**"A binary `trusted` flag cannot distinguish a 1-ms result from a 50-ms result."**

That sentence is `INTERDISCIPLINARY-LITERATURE-DIAGNOSIS §2.3`, which marks measurement-uncertainty
propagation **[MISSING]** at HIGH confidence. Every input it asks for was **already measured** per stream
— delivery jitter, the stamp quantum — and never combined, so a consumer asking *how well do I know WHEN
this sample happened* had to read four diagnostics and guess.

`nightqc.timing_uncertainty` combines them the way GUM (JCGM 100:2008) asks: identify the inputs, express
each as a standard uncertainty, combine independent ones in quadrature, and **publish the components**,
because a budget whose terms are hidden cannot be argued with.

    stream            u_ms   dominant   share
    H10 ecg          33.47   delivery    1.00
    Verity ppg       71-89   delivery    1.00
    Verity mag      408.40   delivery    1.00
    O2Ring          288.95   quantum     1.00     <- 1000/sqrt(12) exactly

**That last row is the point.** The ring and the H10 both read "connected, streaming, fine". One is
limited by link scheduling and the other by a 1-second quantised axis — same flag, different limiting
term, different fix, and no amount of link work moves the ring. `dominant_share` is a VARIANCE share, so
it says whether attacking the dominant term is worth anything at all.

## §2.2 is why this is a budget and not a correction

A one-way BLE arrival stamp **cannot** separate device event time, device offset and transport delay
without a delay model, a two-way exchange or an independent reference (RFC 5905; IEEE 1588-2019). We have
none of the three. So the honest output is an uncertainty attached to the timestamp we already have —
not a better timestamp. The brief's own warning against "just use PTP" is respected: PTP needs a timing
exchange and hardware timestamping this hardware does not offer.

## The oscillator is published BESIDE the budget, and folding it in was my first draft's error

The first cut added `adev_min * optimal_tau` as a third term and read **173 ms for the H10 where the real
per-event figure is 34** — a 5× overstatement of an uncertainty. Two mistakes at once: a spurious ×1000
(`allan.adev` divides a millisecond series by a second tau, so it is already ms/s), and a conceptual one
that survived the unit fix — **an arrival-stamped event does not ride the device clock at all.** The host
stamps it; nothing free-runs; no drift accumulates into that timestamp.

`adev_min * optimal_tau` answers a real and different question — *how far would the device clock drift if
ridden free for this long?* — so it is published as `free_run` with the tau it belongs to. Both numbers
are true; neither can now be mistaken for the other. A test asserts `free_run` cannot move `u_ms`.

⚠️ Caught by running it on the real corpus, not by a test: the absurd 173 ms was visible immediately
against a 34 ms delivery term, and no unit test I would have written first checks the magnitude of a
quantity it also computes.

⚠️ **Deliberately NOT claimed:** this is a per-EVENT uncertainty about ARRIVAL. It says how well the
timestamp locates the packet, not how well the packet locates a heartbeat. Delivery and quantum are
genuinely independent (link scheduling vs stamp resolution), so quadrature is sound for these two.
