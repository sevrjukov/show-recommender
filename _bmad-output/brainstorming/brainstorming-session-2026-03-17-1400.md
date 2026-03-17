---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
session_topic: 'Automatic musical shows and concerts recommender (personal POC)'
session_goals: 'Narrow down requirements list and define basic architecture'
selected_approach: 'progressive-flow'
techniques_used: ['What If Scenarios', 'Mind Mapping', 'Constraint Mapping', 'Solution Matrix']
ideas_generated: []
context_file: ''
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
- LLM (Claude API) expands seed into broader "extended artist list" weekly or on-demand
- All JSON, no YAML — consistent format, native to Node.js

### Geography

- **Electronic / Jazz / Nu Metal:** Czech Republic only
- **Classical:** Czech Republic + Germany, Austria, Poland, Slovakia, Hungary (DE and AT prioritised)

### Event Sources

- **Ticketmaster Discovery API** — validated: 252 CZ music events, mainstream/mid-size venues (O2 Universum, Café V lese, MeetFactory); skews pop/rock/electronic; classical unlikely
- **Classical venue scrapers** — ~5–8 hardcoded venues: Czech Philharmonic (Rudolfinum), National Theatre Prague, Prague Philharmonia, Musikverein Vienna, Philharmonie Berlin, and a few others
- Sources are isolated behind the fetch module — can be swapped or extended later without touching the rest of the pipeline
- **Out of scope for POC:** third-party CZ discovery source (Bandsintown has no discovery API; Songkick is commercial-only); add if coverage gaps emerge

### Notifications

- **Digest email** 1–2x per week via AWS SES
- **Format per entry:** Artist / Show name · Venue · Date · Source URL · one-line AI reasoning ("recommended because you like X")
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
- Calls Claude API → generates extended artist list
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
                     ├── build-digest (Claude API → formatted digest with reasoning)
                     └── send-email (AWS SES)
```

---

## POC Scope Boundaries

| In scope | Out of scope (later) |
|---|---|
| Manual seed.json | Spotify / YouTube auto-ingestion |
| Claude API expansion | Specialised music similarity APIs |
| Ticketmaster API + venue scrapers | Full venue coverage across Central Europe |
| ~5–8 hardcoded classical venues | Auto-discovery of new venues |
| Artist + composer name matching | Semantic / confidence-scored matching |
| Weekly digest email (plain HTML) | Rich email template, preferences UI |
| S3 JSON for all state | Database |
| Single Lambda per concern | Microservices, Step Functions |

---

## Open Items / Next Steps

1. ~~**Spike Ticketmaster API**~~ (30 min) — query `countryCode=CZ&classificationName=music`, done, confirmed usability for the project
2. ~~**Spike Bandsintown API**~~ — no discovery API available; dropped in favour of two-source POC (Ticketmaster + venue scrapers)
3. **Identify 5–8 classical venues** to scrape and check their schedule page structure
4. **Write `seed.json`** — start with known artists, composers, and genres
5. **Build `expand-taste.js`** — Claude prompt to expand seed → `artists.json`
6. **Build `scout.js`** — sequential pipeline, local first
