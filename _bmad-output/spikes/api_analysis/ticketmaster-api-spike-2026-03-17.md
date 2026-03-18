# Ticketmaster Discovery API — Spike Results

**Date:** 2026-03-17
**API version:** Discovery v2
**Auth:** Consumer key (apikey param) only — consumer secret not required for Discovery API

---

## Queries Run

### 1. Music events in Czech Republic
```
GET /discovery/v2/events.json?countryCode=CZ&classificationName=music&size=5
```

**Result:** 252 total events

Sample events returned:
- The Witcher III in Concert — O2 universum, Praha 9 (Nov 2026)
- Rock in Symphony – Legends Live Forever — O2 universum, Praha 9 (Oct 2026)
- Brigitte Calls Me Baby — Café V lese, Praha 10 (Mar 2026)
- Ari Abdul — MeetFactory, Praha 5 (Mar 2026)

**Venues present:** O2 universum, Café V lese, MeetFactory — mainstream and mid-size Prague venues confirmed.

---

### 2. Classical events in Czech Republic
```
GET /discovery/v2/events.json?countryCode=CZ&classificationName=classical&size=5
```

**Result:** 20 total events

Sample events returned:
- Celebration Concert Ennio Morricone & Andrea Morricone — O2 universum, Praha 9 (Nov 2026)
- Magic of Miyazaki. Voice of Japan — První Patro, Brno (Mar 2026, cancelled)
- Tony Ann — Divadlo Hybernia, Praha 1 (Apr 2026)
- ŠTEFAN MARGITA a andělé strážní — O2 Arena, Praha 9 (May 2026)
- André Rieu in Prague 2026 — O2 Arena, Praha 9 (May 2026)

**Assessment:** These are crossover/commercial "classical-adjacent" events — orchestral pop, tribute concerts. No Czech Philharmonic, no Rudolfinum, no serious recital listings.

---

## Conclusions

| Finding | Detail |
|---|---|
| CZ music coverage | Good — 252 events, skews electronic / pop / rock |
| CZ classical coverage | Weak — 20 events, all crossover; real classical venues absent |
| Czech Philharmonic / Rudolfinum | Not present |
| Suitable for electronic / jazz / nu-metal discovery | Yes |
| Suitable for classical discovery | No |

---

## Architecture Decision Confirmed

Use Ticketmaster for **electronic / jazz / nu-metal** discovery only.
Classical venue coverage requires **direct venue scraping** (~5–8 hardcoded venues).

This was the assumption in the brainstorm — now validated by the spike.

---

## Useful Filter Parameters

| Parameter | Value | Notes |
|---|---|---|
| `countryCode` | `CZ`, `DE`, `AT`, `PL`, `SK`, `HU` | Geography filter |
| `classificationName` | `music` | Broadest useful filter for non-classical |
| `classificationName` | `classical` | Too sparse to rely on |
| `size` | up to 200 | Max page size |
| `page` | 0-based | Pagination |

For the `event-pipeline`, use `classificationName=music` + geography-based `countryCode` cycling.
