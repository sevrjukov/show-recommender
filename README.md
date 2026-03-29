# show-recommender

A personal concert recommender. Periodically scrapes upcoming events from several classical music venues across Central Europe plus the Ticketmaster API, runs them through an LLM against your taste profile, and sends a curated digest email listing matches with a short reasoning note for each.

Three matching modes:
- **Watchlist** — direct artist match (e.g. Evgeny Kissin)
- **Composer** — any quality recital featuring a composer you follow (e.g. Chopin, Rachmaninov)
- **Similarity** — LLM-expanded suggestions based on your taste

The digest also includes a "consider adding" section with artists/composers the LLM found relevant but aren't in your preferences yet.

## How it works

```
user-preferences.json (S3)
        ↓
[event-pipeline Lambda — weekly]
  ├── fetch events (Ticketmaster + 8 venue scrapers)
  ├── deduplicate + exclude already-seen events
  ├── LLM match against preferences
  ├── build HTML digest
  └── send via AWS SES
```

State lives entirely in S3 (no database). The Lambda runs on an EventBridge cron twice a week.

**Venues scraped:** Česká filharmonie, Rudolfinum, FOK, Obecní dům, SOČR (Prague) · Berliner Philharmoniker (Berlin) · Musikverein (Vienna) · Elbphilharmonie (Hamburg)

## Prerequisites

- Node.js 20 LTS
- AWS CLI configured with a profile that has CDK/SES/S3 permissions
- Both sender and recipient emails verified in AWS SES
- OpenAI API key
- Ticketmaster API key

## Setup

```bash
npm install
```



## Deploy
Populate `prod.env.properties` with AWS profile reference, API keys etc.

```bash
./deploy.sh 
```

On first deploy, bootstrap CDK if you haven't already:

```bash
cdk bootstrap aws://ACCOUNT_ID/eu-central-1
```

## Updating preferences

Edit `config/user-preferences.json` locally, then upload:

```bash
./upload_preferences.sh
```

This backs up the existing file in S3, uploads the new one, and clears the discarded-events log so any previously-rejected events are re-evaluated against your updated taste profile.

## Stack notes

- The S3 bucket is created with `RemovalPolicy.RETAIN` — `cdk destroy` will not delete it or its data.
- `config/seed.json` is seeded on first deploy only.
- Lambda: Node.js 20, ARM64, 512 MB, 600 s timeout.
