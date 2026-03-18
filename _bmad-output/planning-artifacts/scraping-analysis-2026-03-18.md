# Classical Concert Sources — Tier A (Scraping Research)

## Scope
High-signal sources covering Prague + nearby travel destinations (Vienna, Germany, Bratislava, Wrocław, Salzburg).  
Focus: **program pages**, not generic listings.

---

# Summary Table

| Source | Type | URL | Difficulty | Rendering | Pagination | Data Quality | Notes |
|------|------|-----|-----------|-----------|------------|-------------|------|
| Rudolfinum | Venue | https://www.rudolfinum.cz/en/program/ | Low | SSR | Yes | High | Clean structure, filters |
| Obecní dům | Venue | https://www.obecnidum.cz/en/program/ | Medium | SSR | No/limited | Medium | Less structured |
| Národní divadlo | Venue | https://www.narodni-divadlo.cz/en/program | Medium | SSR | Yes | Medium | Mixed genres |
| FOK | Venue/Orchestra | https://www.fok.cz/en/concerts | Low | SSR | Yes | High | Clean |
| HAMU | Venue | https://www.hamu.cz/en/events/ | Low | SSR | No | Medium | Small volume |
| Musikverein | Venue | https://www.musikverein.at/en/concerts/ | Medium | SSR | Yes | High | Consistent |
| Konzerthaus Wien | Venue | https://konzerthaus.at/concerts | Medium | SSR | Yes | High | Slight JS filtering |
| Wiener Staatsoper | Venue | https://www.wiener-staatsoper.at/en/season-tickets/events/ | Medium | SSR | Yes | High | Opera-heavy |
| Berliner Philharmoniker | Orchestra/Venue | https://www.berliner-philharmoniker.de/en/concerts/ | Medium | CSR-heavy | Yes | High | Requires JS or API |
| Elbphilharmonie | Venue | https://www.elbphilharmonie.de/en/whats-on | Medium | SSR + JS | Yes | High | Some dynamic filters |
| Semperoper Dresden | Venue | https://www.semperoper.de/en/whats-on/ | Low | SSR | Yes | High | Stable |
| Slovenská filharmonie | Venue | https://www.filharmonia.sk/en/program/ | Low | SSR | No | Medium | Simple |
| NFM Wrocław | Venue | https://www.nfm.wroclaw.pl/en/programme | Medium | SSR | Yes | High | Clean but nested |
| Salzburg Festival | Festival | https://www.salzburgerfestspiele.at/en/events | High | CSR-heavy | Yes | High | Seasonal + complex |
| Česká filharmonie | Orchestra | https://www.ceskafilharmonie.cz/en/program/ | Low | SSR | Yes | High | Very clean |
| PKF Prague Philharmonia | Orchestra | https://www.prgphil.cz/ | Medium | SSR | No | Medium | Weak structure |
| Collegium 1704 | Ensemble | https://collegium1704.com/en/ | Medium | SSR | No | Medium | Sparse metadata |
| Berliner Philharmoniker | Orchestra | https://www.berliner-philharmoniker.de/en/concerts/ | Medium | CSR-heavy | Yes | High | Duplicate of venue |
| Wiener Philharmoniker | Orchestra | https://www.wienerphilharmoniker.at/en/concerts | Low | SSR | No | Medium | Limited detail |

---

# Difficulty Classification

## Low (recommended starting point)
- Rudolfinum
- FOK
- HAMU
- Semperoper Dresden
- Slovenská filharmonie
- Česká filharmonie
- Wiener Philharmoniker

Characteristics:
- Server-side rendered (SSR)
- Stable HTML
- Minimal JS
- Straightforward DOM parsing

---

## Medium (manageable, some quirks)
- Obecní dům
- Národní divadlo
- Musikverein
- Konzerthaus Wien
- Wiener Staatsoper
- Elbphilharmonie
- NFM Wrocław
- PKF
- Collegium 1704

Typical issues:
- Nested structures
- Filtering via query params or JS
- Mixed event types (need classification)

---

## High (delay for later phase)
- Salzburg Festival
- Berliner Philharmoniker

Reasons:
- Heavy client-side rendering (React/Vue)
- Requires:
  - headless browser (Playwright)
  - OR reverse-engineering internal API
- Frequent layout changes

---

# Parsing Notes Per Source

## Rudolfinum
- Strong semantic structure
- Event cards with:
  - date
  - performers
  - program
- Good for baseline schema

## FOK / Česká filharmonie
- Best structured sources
- Often include:
  - composer
  - works
  - conductor
- Ideal for training your classifier

## Národní divadlo / Staatsoper
- Must filter:
  - opera vs ballet vs drama
- Genre classification required

## Musikverein / Konzerthaus
- Consistent but:
  - multi-day events
  - recurring concerts

## Elbphilharmonie / NFM
- Rich metadata
- Sometimes nested JSON inside HTML

## Berliner Philharmoniker
- Likely API behind site
- Recommendation: inspect network calls instead of DOM scraping

## Salzburg Festival
- Complex structure
- Seasonal spikes
- Multiple venues per event

---

# Normalization Challenges

## Duplicate Events
Same concert appears in:
- venue site
- orchestra site

Suggested dedup key:

hash(
normalized_date +
normalized_venue +
main_performer
)


---

## Genre Classification
Problem:
- Many sites mix:
  - classical
  - crossover
  - film music

Solution:
- Rule-based first:
  - presence of composer names
  - keywords: symphony, concerto, recital
- Later: LLM classifier

---

## Location Normalization
Map all venues → canonical city IDs:
- Prague
- Vienna
- Berlin
- Dresden
- Hamburg
- Bratislava
- Wrocław
- Salzburg

---

# Recommended Implementation Order

## Phase 1 (fast wins)
1. Rudolfinum
2. Česká filharmonie
3. FOK
4. Musikverein

## Phase 2
5. Konzerthaus Wien
6. Semperoper
7. NFM Wrocław
8. Elbphilharmonie

## Phase 3
9. Národní divadlo
10. Obecní dům
11. Ensembles (PKF, Collegium)

## Phase 4 (advanced)
12. Berliner Philharmoniker (API scraping)
13. Salzburg Festival (headless browser)

---

# Scheduling Strategy

| Source Type | Refresh Frequency |
|------------|------------------|
| Major venues | 1x per day |
| Orchestras | 1x per day |
| Festivals | 1x per week |
| CSR-heavy | 1x per 2–3 days |

---

# Key Risks

- DOM changes (medium probability)
- JS-heavy sites blocking scraping
- Duplicate explosion across sources
- Inconsistent metadata (especially small ensembles)

---

# Recommendation

Start with **4 sources only**:
- Rudolfinum
- Česká filharmonie
- Musikverein
- FOK

This gives:
- High-quality structured data
- Coverage of Prague + Vienna
- Minimal scraping complexity

Then expand incrementally.

---