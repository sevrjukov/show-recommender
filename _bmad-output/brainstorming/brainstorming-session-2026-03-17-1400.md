---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
session_topic: 'Automatic musical shows and concerts recommender (personal POC)'
session_goals: 'Narrow down requirements list and define basic architecture'
selected_approach: 'progressive-flow'
techniques_used: ['What If Scenarios', 'Mind Mapping', 'Constraint Mapping', 'Solution Matrix']
ideas_generated: []
context_file: '_bmad-output/planning-artifacts/scraping-analysis-2026-03-18.md'
---

# Brainstorming Session Results

**Facilitator:** Alex
**Date:** 2026-03-17

## Session Overview

**Topic:** Automatic musical shows and concerts recommender — personal POC
**Goals:** (1) Narrow down a minimal requirements list, (2) Define basic architecture

### Session Setup

Small personal project. No multi-user concerns. Goal is a working POC that automatically recommends upcoming musical shows and concerts based on user taste.

## Technique Selection

**Approach:** Progressive Technique Flow
**Journey Design:** Systematic development from exploration to action

**Progressive Techniques:**

- **Phase 1 - Exploration:** What If Scenarios — maximum idea generation, no constraints
- **Phase 2 - Pattern Recognition:** Mind Mapping — organize ideas into requirements themes
- **Phase 3 - Development:** Constraint Mapping — identify POC vs full-product boundaries
- **Phase 4 - Action Planning:** Solution Matrix — map requirements to architecture decisions

**Journey Rationale:** Starting broad with "what if" thinking surfaces all possible features and data flows before narrowing down. Mind mapping clusters them into natural requirement groups. Constraint mapping cuts scope to POC size. Solution matrix produces the final architecture skeleton.

---

## Requirements

### Recommendation Modes

- **Watchlist mode:** Known artists (e.g. Evgeny Kissin) — direct match, alert when they announce a show in relevant geography
- **Composer mode:** Known composers (e.g. Chopin, Rachmaninov) — any quality recital featuring their works surfaces, regardless of performer
- **Similarity mode:** AI-expanded artist graph — "you like X, here's Y playing live"

### Taste Profile

- Manually maintained seed file (`seed.json`) — artists, composers, genres
- LLM (ChatGPT / OpenAI API) expands seed into broader "extended artist list" weekly or on-demand
- All JSON, no YAML — consistent format, native to Node.js

### Geography

- **Electronic / Jazz / Nu Metal:** Czech Republic only
- **Classical:** Czech Republic + Germany, Austria, Poland, Slovakia, Hungary (DE and AT prioritised)

### Event Sources

- **Ticketmaster Discovery API** — validated: 252 CZ music events, mainstream/mid-size venues (O2 Universum, Café V lese, MeetFactory); skews pop/rock/electronic; classical unlikely
- **Classical venue scrapers** — 6 hardcoded venues for POC, all SSR or SSR+light JS, weekly cadence aligned with digest Lambda

**POC scrapers (Phase 1 — 6 venues):**

| Venue | City | Difficulty | Notes |
|---|---|---|---|
| Rudolfinum | Prague | Low | Cleanest structure; baseline schema |
| Česká filharmonie | Prague | Low | Includes composer + works metadata |
| FOK | Prague | Low | Well-structured |
| Obecní dům | Prague | Medium | Less structured HTML; include for piano recital coverage |
| Musikverein | Vienna | Medium | Consistent; watch for multi-day recurring events |
| Elbphilharmonie | Hamburg | Medium | SSR + some JS filters; rich metadata |
| Berliner Philharmoniker | Berlin | Low (API) | Typesense JSON API; plain HTTP GET + key header; key rotates, re-fetch page HTML if it breaks; see `berliner-phil-api-spike-2026-03-18.md` |

**Phase 2 (post-POC):** Konzerthaus Wien, Semperoper Dresden, NFM Wrocław, Slovenská filharmonie, Wiener Staatsoper

**Phase 3 (post-POC):** Národní divadlo, PKF Prague Philharmonia, Collegium 1704, Wiener Philharmoniker

**Phase 4 / advanced:** Salzburg Festival (headless browser or seasonal-only run)

- Sources are isolated behind the fetch module — can be swapped or extended later without touching the rest of the pipeline
- **Out of scope for POC:** third-party CZ discovery source (Bandsintown has no discovery API; Songkick is commercial-only); add if coverage gaps emerge

### Scraping Architecture

- **Rendering approach:** All POC venues are SSR or SSR+minimal JS — `fetch` + `cheerio` sufficient; no headless browser needed for POC
- **Cadence:** Weekly, triggered by the same EventBridge cron as `event-pipeline` (or as a pre-step within it)
- **Genre pre-filter:** Rule-based before any LLM matching
  - **Include signals:** keywords *piano, recital, solo, concerto* in title/program; presence of known composer names (Chopin, Rachmaninov, etc.); for Berliner Philharmoniker use `tags:=Piano` or `tags:=Chamber Music` query filter directly
  - **Exclude signals:** keywords *opera, ballet, drama, theater/theatre* — catches Staatsoper and Národní divadlo mixed-genre noise
  - LLM classifier deferred to post-POC
- **Dedup key across sources:** `hash(normalized_date + normalized_venue + main_performer)` — prevents same concert appearing from both venue and orchestra sites
- **Location normalization:** Map all venue URLs → canonical city IDs: Prague, Vienna, Hamburg (extend to Berlin, Dresden, Bratislava, Wrocław, Salzburg in later phases)

### Notifications

- **Digest email** 1–2x per week via AWS SES
- **Format per entry:** Artist / Show name · Venue · Date · Source URL
- **Deduplication:** Once an event appears in a digest it is logged and never included again
- **Taste expansion email:** Separate email sent by `taste-expander` after each run — lists the full current `artists.json` with AI reasoning for each entry, so the user can review and curate `seed.json` if needed
- No real-time alerts — if a show sells out before the email arrives, that's acceptable

### Infrastructure

- **Two Lambda functions** + S3 for all persistence
- **CloudWatch alarm** on Lambda errors → SNS → SES email alert for silent failure detection
- Local Node.js scripts first (`expand-taste.js`, `scout.js`), then deploy as Lambdas
- No database — S3 JSON files only
- EventBridge cron trigger for `event-pipeline` Lambda (weekly) and `taste-expander` Lambda (monthly)
- **AWS CDK project** for all infrastructure deployment (Lambdas, S3 bucket, EventBridge rules, CloudWatch alarm, SNS, SES)

---

## Architecture

### Two Lambdas

**Lambda 1: `taste-expander`**
- Trigger: manual, on seed change, or monthly cron
- Reads `config/seed.json` from S3
- Calls OpenAI API (ChatGPT) → generates extended artist list
- Hard cap: `artists.json` will not exceed 100 entries; expander stops adding once the cap is reached
- Writes `data/artists.json` to S3
- Local: `node expand-taste.js`

**Lambda 2: `event-pipeline`** (`scout.js` locally)
- Trigger: EventBridge weekly cron
- Sequential pipeline: fetch → match/filter → build digest → send email
- Local: `node scout.js`

### S3 Layout

```
/config/seed.json          ← manually maintained
/data/artists.json         ← LLM-expanded, written by taste-expander
/data/events-raw.json      ← geography-filtered raw events, written by fetch step
/data/events-sent.json     ← append-only dedup log
```

### Pipeline Flow

```
seed.json → [taste-expander] → artists.json
                                     ↓
                   [event-pipeline / scout.js]
                     ├── fetch-events (Ticketmaster + venue scrapers)
                     │   └── geography filter → events-raw.json
                     ├── match-filter (artists.json × events-raw.json)
                     │   └── dedup against events-sent.json → matched events
                     ├── build-digest (OpenAI API → formatted digest with reasoning)
                     └── send-email (AWS SES)
```

---

## POC Scope Boundaries

| In scope | Out of scope (later) |
|---|---|
| Manual seed.json | Spotify / YouTube auto-ingestion |
| OpenAI API (ChatGPT) expansion | Specialised music similarity APIs |
| Ticketmaster API + venue scrapers | Full venue coverage across Central Europe |
| 6 hardcoded classical venues (Phase 1) | Auto-discovery of new venues |
| Artist + composer name matching | Semantic / confidence-scored matching |
| Rule-based genre pre-filter (piano/recital keywords) | LLM classifier for genre |
| Weekly digest email (plain HTML) | Rich email template, preferences UI |
| S3 JSON for all state | Database |
| Single Lambda per concern | Microservices, Step Functions |

---

## Open Items / Next Steps

1. ~~**Spike Ticketmaster API**~~ (30 min) — query `countryCode=CZ&classificationName=music`, done, confirmed usability for the project
2. ~~**Spike Bandsintown API**~~ — no discovery API available; dropped in favour of two-source POC (Ticketmaster + venue scrapers)
3. ~~**Identify 5–8 classical venues**~~ — done; 6 POC venues selected (see Event Sources), phases 2–4 documented in scraping-analysis-2026-03-18.md
4. **Write `seed.json`** — start with known artists, composers, and genres
5. **Build `expand-taste.js`** — OpenAI API prompt to expand seed → `artists.json`
6. **Build `scout.js`** — sequential pipeline, local first
7. ~~**Spike Berliner Philharmoniker API**~~ — done; Typesense self-hosted API confirmed, no headless browser needed; see `berliner-phil-api-spike-2026-03-18.md`
