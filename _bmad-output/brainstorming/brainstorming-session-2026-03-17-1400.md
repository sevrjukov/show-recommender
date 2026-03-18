---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
session_topic: 'Automatic musical shows and concerts recommender (personal POC)'
session_goals: 'Narrow down requirements list and define basic architecture'
selected_approach: 'progressive-flow'
techniques_used: ['What If Scenarios', 'Mind Mapping', 'Constraint Mapping', 'Solution Matrix', 'Continuation — LLM matching + simplification']
ideas_generated: []
context_file: '_bmad-output/spikes/scraping_analysis/czech/scraping-analysis-2026-03-18.md'
inputDocuments:
  - '_bmad-output/spikes/scraping_analysis/czech/czech-classical-scraping-summary-2026-03-18.md'
  - '_bmad-output/spikes/scraping_analysis/international/berliner-phil-api-spike-2026-03-18.md'
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

- Manually maintained preferences file (`user-preferences.json`) — artists, composers, genres
- All JSON, no YAML — consistent format, native to Node.js

### Geography

- **Electronic / Jazz / Nu Metal:** Czech Republic only
- **Classical:** Czech Republic + Germany, Austria, Poland, Slovakia, Hungary (DE and AT prioritised)

### Event Sources

- **Ticketmaster Discovery API** — validated: 252 CZ music events, mainstream/mid-size venues (O2 Universum, Café V lese, MeetFactory); skews pop/rock/electronic; classical unlikely. See `spikes/api_analysis/ticketmaster-api-spike-2026-03-17.md`
- **Classical venue scrapers** — 8 hardcoded venues for POC, all SSR or API, weekly cadence aligned with digest Lambda

**POC scrapers (Phase 1 — 8 venues):**

| Venue | City | Spike | Notes |
|---|---|---|---|
| Česká filharmonie | Prague | ✅ | SSR (perspectivo.cz CMS); JSON-LD on detail pages; `?page=N`; see `spikes/scraping_analysis/czech/scraping-spike-ceska-filharmonie-2026-03-18.md` |
| Rudolfinum | Prague | ✅ | SSR (perspectivo.cz CMS); venue aggregator — use `?organizer=` filter; multi-date per detail page; no JSON-LD, no images; see `spikes/scraping_analysis/czech/scraping-spike-rudolfinum-2026-03-18.md` |
| FOK | Prague | ✅ | SSR (Drupal 11); 0-based pagination; pipe-delimited performers; multi-date per detail page; see `spikes/scraping_analysis/czech/scraping-spike-fok-2026-03-18.md` |
| Obecní dům | Prague | ✅ | SSR (WordPress); `/page/N/` pagination (~390 events, mixed content — needs genre pre-filter); Colosseum event ID = cross-site dedup key with FOK; see `spikes/scraping_analysis/czech/scraping-spike-obecni-dum-2026-03-18.md` |
| SOČR | Prague | ✅ | SSR (Drupal 7); no pagination (single page ~10–15 events); `dataLayer["airedDate"]` for date; pure classical; see `spikes/scraping_analysis/czech/scraping-spike-socr-2026-03-18.md` |
| Berliner Philharmoniker | Berlin | ✅ | Typesense JSON API; plain HTTP GET + key header; `tags:=Piano` filter available; key rotates — re-fetch page HTML if broken; see `spikes/scraping_analysis/international/berliner-phil-api-spike-2026-03-18.md` |
| Musikverein | Vienna | ✅ | Two-tier: SSR listing (`spielplan.musikverein.at?month=YYYY-MM`) + JSON API per event (`/e/[ID].json`); genre code filter available (`?code=INSTRSOL` etc.); dedup key: hex event ID; see `spikes/scraping_analysis/international/musikverein-scraping-spike-2026-03-18.md` |
| Elbphilharmonie | Hamburg | ✅ | Django SSR; infinite-scroll pagination via date-based `/ajax/1` URL chain (~25 requests for 12-week horizon); no genre filter in listing — keyword pre-filter on subtitle/title only; JSON-LD on detail pages but `workPerformed` noisy — use HTML instead; dedup key: numeric ID from URL slug; see `spikes/scraping_analysis/international/elbphilharmonie-scraping-spike-2026-03-18.md` |

**Phase 2 (post-POC):** Konzerthaus Wien, Semperoper Dresden, NFM Wrocław, Slovenská filharmonie, Wiener Staatsoper, Munchen

**Phase 3 (post-POC):** Národní divadlo, PKF Prague Philharmonia, Collegium 1704, Wiener Philharmoniker

**Phase 4 / advanced:** Salzburg Festival (headless browser or seasonal-only run)

- Sources are isolated behind the fetch module — can be swapped or extended later without touching the rest of the pipeline
- **Out of scope for POC:** third-party CZ discovery source (Bandsintown has no discovery API; Songkick is commercial-only); add if coverage gaps emerge

### Scraping Architecture

- **Rendering approach:** All POC venues are SSR or JSON API — `fetch` + `cheerio` sufficient; no headless browser needed for POC
- **Cadence:** Weekly, triggered by the same EventBridge cron as `event-pipeline` (or as a pre-step within it)
- **Matching:** LLM-based fuzzy matching — handles exact name match, transliteration variants (e.g. Čajkovskij / Tchaikovsky / Tschaikowsky), and genre/scene proximity (e.g. Thrillseekers surfaced when Armin van Buuren is in preferences). No rule-based genre pre-filter; LLM receives `user-preferences.json` + pre-filtered event list and returns matched events with per-match reasoning, plus "consider adding" suggestions.
- **Dedup key across sources:** `hash(normalized_date + normalized_venue + normalized_conductor)` — normalize to ISO date, canonical venue ID, lowercase+stripped conductor name; use source-native IDs as secondary key where available
- **Source hierarchy:** when the same event appears on multiple sites, prefer the source with richer data and skip the lower-ranked duplicate — merging adds complexity for minimal gain at POC scale
- **Per-scraper spikes required** before implementation — completed spikes linked in the POC table above; for CZ sources see full analysis in `spikes/scraping_analysis/czech/czech-classical-scraping-summary-2026-03-18.md`
- **Error handling:** individual scraper failures are non-fatal — pipeline continues with remaining sources; failed sources are collected and reported as a warnings section at the bottom of the digest email (source name + error summary)

### Notifications

- **Digest email** 1–2x per week via AWS SES
- **Format per entry:** Artist / Show name · Venue · Date · Source URL · LLM reasoning for inclusion
- **"Consider adding" section:** appended to digest — artists/composers the LLM found relevant in this week's events but not present in `user-preferences.json`; allows easy curation without a separate email
- **Scraper failure warnings:** if any sources failed, appended at the bottom of the digest — source name + error summary; does not block the email from sending
- **Deduplication:** Once an event appears in a digest it is logged and never included again
- No real-time alerts — if a show sells out before the email arrives, that's acceptable

### Infrastructure

- **One Lambda function** + S3 for all persistence
- **CloudWatch alarm** on Lambda errors → SNS → SES email alert for silent failure detection
- Local Node.js script first (`recommender.js`), then deploy as Lambda
- No database — S3 JSON files only
- EventBridge cron trigger for `event-pipeline` Lambda (weekly)
- **AWS CDK project** for all infrastructure deployment (Lambda, S3 bucket, EventBridge rule, CloudWatch alarm, SNS, SES)

---

## Architecture

### One Lambda

**Lambda: `event-pipeline`** (`recommender.js` locally)
- Trigger: EventBridge weekly cron
- Sequential pipeline: fetch → deduplicate → exclude already-sent → LLM match → build digest → send email
- Local: `node recommender.js`

### S3 Layout

```
/config/user-preferences.json   ← manually maintained
/data/events-raw.json           ← geography-filtered raw events, written by fetch step
/data/events-sent.json          ← append-only dedup log
```

### Pipeline Flow

```
user-preferences.json
        ↓
[event-pipeline / recommender.js]
  ├── fetch-events (Ticketmaster + venue scrapers)
  │   └── geography filter → events-raw.json
  ├── deduplicate + exclude already-sent (events-sent.json) → pre-filtered events
  ├── LLM match (user-preferences.json × pre-filtered events)
  │   └── matched events (with reasoning) + "consider adding" suggestions
  ├── build-digest
  └── send-email (AWS SES)
```

---

## POC Scope Boundaries

| In scope | Out of scope (later) |
|---|---|
| Manual `user-preferences.json` | Spotify / YouTube auto-ingestion |
| LLM fuzzy matching (exact + transliteration + genre/scene) | Specialised music similarity APIs |
| Ticketmaster API + venue scrapers | Full venue coverage across Central Europe |
| 8 hardcoded classical venues (Phase 1) | Auto-discovery of new venues |
| "Consider adding" section in digest | Dedicated taste-expansion workflow |
| Weekly digest email (plain HTML) | Rich email template, preferences UI |
| S3 JSON for all state | Database |
| Single Lambda | Microservices, Step Functions |

---

## Next Steps

1. **Write `user-preferences.json`** — start with known artists, composers, and genres
2. **Build `recommender.js`** — sequential pipeline, local first:
   - fetch-events (Ticketmaster + venue scrapers) → geography filter → events-raw.json
   - deduplicate + exclude already-sent
   - LLM match → matched events + "consider adding" suggestions
   - build-digest + send-email (SES)
