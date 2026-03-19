---
title: 'Ticketmaster Event Source'
slug: 'ticketmaster-event-source'
created: '2026-03-19'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['TypeScript', 'Node 24 native fetch', 'Ticketmaster Discovery v2 API', 'AWS CDK']
files_to_modify:
  - src/event-pipeline/event-sources/ticketmaster.ts
  - src/event-pipeline/index.ts
  - lib/recommender-app-stack.ts
  - deploy.sh
code_patterns: []
test_patterns: []
---

# Tech-Spec: Ticketmaster Event Source

**Created:** 2026-03-19

## Overview

### Problem Statement

The event pipeline has no real data sources — `sources: []` in `index.ts` is a placeholder. Without at least one `EventSource` implementation the pipeline runs but produces no events, no matches, and no useful digest.

### Solution

Create a `TicketmasterSource` class in a new `src/event-pipeline/event-sources/` directory that implements the existing `EventSource` interface. It queries the Ticketmaster Discovery v2 API for `classificationName=music` events in CZ, paginates up to a 500-event hard cap with a 90-day future date window, and maps the API response to the pipeline's `Event` type. Wire it into the Lambda handler and add the API key to the CDK stack via CDK context.

### Scope

**In Scope:**
- New directory `src/event-pipeline/event-sources/`
- `ticketmaster.ts` — `TicketmasterSource` class implementing `EventSource`
- Pagination using Ticketmaster's `page` param (max `size=200`), stopping when total collected >= 500 or no more pages
- 90-day date window using `startDateTime` / `endDateTime` query params
- Mapping TM API response fields to the `Event` type
- `TICKETMASTER_API_KEY` env var added to the Lambda (CDK context key `ticketmasterKey`)
- `new TicketmasterSource(apiKey)` added to `sources` array in `index.ts`

**Out of Scope:**
- Countries beyond CZ
- `classificationName=classical`
- Scraping sources
- Unit/integration tests

## Context for Development

### Codebase Patterns

- **EventSource interface** (`src/event-pipeline/types.ts:82`): `{ id: string; fetch(): Promise<Event[]> }`. Implement exactly this — no extra methods needed.
- **Event type** (`src/event-pipeline/types.ts:8`): `{ title, venue, date (ISO YYYY-MM-DD), url, sourceId, performers?, composers?, description? }`. `composers` will not be populated from TM data.
- **HTTP**: Node 24 runtime — use native `fetch` globally. No `node-fetch` or `axios` in the project.
- **API key pattern**: CDK passes secrets via `this.node.getContext(key)` → Lambda env var. Follow `openaiKey` → `OPENAI_API_KEY` pattern exactly.
- **Logging style**: `console.log('[source-id] ...')` prefix, matching `[fetch]`, `[dedup]`, `[pipeline]` pattern in existing code.
- **Error handling**: `fetch()` may throw — `fetchAllEvents` already wraps each source in try/catch with a 30s timeout. The source itself does not need to catch errors from individual pages; a thrown error aborts that source and is logged as a non-fatal `SourceError`.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| [deploy.sh](deploy.sh) | Deploy script — CDK context args pattern to follow |
| [src/event-pipeline/types.ts](src/event-pipeline/types.ts) | `Event` and `EventSource` interface definitions |
| [src/event-pipeline/fetch-events.ts](src/event-pipeline/fetch-events.ts) | Shows how sources are called; 30s timeout wrapper |
| [src/event-pipeline/index.ts](src/event-pipeline/index.ts) | Lambda handler — where source is wired in |
| [lib/recommender-app-stack.ts](lib/recommender-app-stack.ts) | CDK stack — env var + context pattern to follow |
| [_bmad-output/spikes/api_analysis/ticketmaster-api-spike-2026-03-17.md](_bmad-output/spikes/api_analysis/ticketmaster-api-spike-2026-03-17.md) | TM API spike: confirmed params, response shape, coverage |

### Technical Decisions

- **Country**: CZ only for now. Add more countries later by passing a `countryCodes` array to the constructor.
- **Page size**: `size=200` (TM max). Fetch pages 0, 1, 2 — stop early if a page returns fewer than 200 events (last page) or if total collected >= 500.
- **Hard cap**: 500 events. After collecting events from all pages, slice to 500 before returning.
- **Date window**: `startDateTime` = today at 00:00:00Z, `endDateTime` = today + 90 days at 23:59:59Z. Format as TM requires: `YYYY-MM-DDTHH:mm:ssZ`.
- **TM response mapping**:
  - `title` ← `event.name`
  - `venue` ← `event._embedded?.venues?.[0]?.name ?? 'Unknown Venue'`
  - `date` ← `event.dates.start.localDate` (already YYYY-MM-DD)
  - `url` ← `event.url`
  - `sourceId` ← `'ticketmaster'`
  - `performers` ← `event._embedded?.attractions?.map(a => a.name)` (optional, may be absent)
  - `description` ← `event.classifications?.[0]?.genre?.name` if present (e.g. "Electronic", "Jazz")
- **Source ID**: `'ticketmaster'` — stable, matches spike doc terminology.
- **Constructor**: `constructor(private readonly apiKey: string)` — single param, key never logged.

## Implementation Plan

### Tasks

Tasks are ordered lowest-dependency first.

- [x] Task 1: Create `TicketmasterSource` class
  - File: `src/event-pipeline/event-sources/ticketmaster.ts` (new file, new directory)
  - Action: Create the file with the full implementation below. The directory `event-sources/` does not exist yet — create it.
  - Notes:
    - Implements `EventSource` from `../types.js`
    - Uses Node 24 native `fetch` — no imports needed
    - Paginates using TM's 0-based `page` param, `size=200` per page, stops when `page + 1 >= totalPages` or collected >= 500
    - Date window: `startDateTime` = today 00:00:00Z, `endDateTime` = today + 90 days at same time
    - TM date format: `YYYY-MM-DDTHH:mm:ssZ` with no milliseconds — strip with `.replace(/\.\d{3}Z$/, 'Z')`
    - Skip events where `dates.start.localDate` is absent (return `null` from `mapEvent`, filter out)
    - Genre `"Undefined"` is a real TM value — filter it out from `description`
    - `_embedded.events` is absent (not empty) when page has no results — guard with `?? []`
  - Implementation:
    ```typescript
    import type { Event, EventSource } from '../types.js';

    const TM_BASE = 'https://app.ticketmaster.com/discovery/v2/events.json';
    const PAGE_SIZE = 200;
    const MAX_EVENTS = 500;
    const WINDOW_DAYS = 90;

    export class TicketmasterSource implements EventSource {
      readonly id = 'ticketmaster';

      constructor(private readonly apiKey: string) {}

      async fetch(): Promise<Event[]> {
        const now = new Date();
        const end = new Date(now);
        end.setDate(end.getDate() + WINDOW_DAYS);

        const startDateTime = formatTmDate(now);
        const endDateTime = formatTmDate(end);

        const events: Event[] = [];
        let page = 0;

        while (events.length < MAX_EVENTS) {
          const url = buildUrl(this.apiKey, startDateTime, endDateTime, page);
          console.log(`[ticketmaster] Fetching page ${page} (collected=${events.length})`);

          const res = await fetch(url);
          if (!res.ok) throw new Error(`Ticketmaster API error: ${res.status} ${res.statusText}`);

          const data = await res.json() as TmResponse;
          const pageEvents = data._embedded?.events ?? [];

          for (const ev of pageEvents) {
            if (events.length >= MAX_EVENTS) break;
            const mapped = mapEvent(ev);
            if (mapped) events.push(mapped);
          }

          const totalPages = data.page?.totalPages ?? 1;
          if (page + 1 >= totalPages) break;
          page++;
        }

        console.log(`[ticketmaster] Done — ${events.length} events fetched`);
        return events;
      }
    }

    function formatTmDate(d: Date): string {
      return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    }

    function buildUrl(apiKey: string, startDateTime: string, endDateTime: string, page: number): string {
      const params = new URLSearchParams({
        apikey: apiKey,
        countryCode: 'CZ',
        classificationName: 'music',
        size: String(PAGE_SIZE),
        startDateTime,
        endDateTime,
        page: String(page),
      });
      return `${TM_BASE}?${params.toString()}`;
    }

    function mapEvent(ev: TmEvent): Event | null {
      const date = ev.dates?.start?.localDate;
      if (!date) return null;

      const venue = ev._embedded?.venues?.[0]?.name ?? 'Unknown Venue';
      const performers = ev._embedded?.attractions?.map(a => a.name).filter(Boolean);
      const genreName = ev.classifications?.[0]?.genre?.name;

      return {
        title: ev.name,
        venue,
        date,
        url: ev.url,
        sourceId: 'ticketmaster',
        ...(performers && performers.length > 0 ? { performers } : {}),
        ...(genreName && genreName !== 'Undefined' ? { description: genreName } : {}),
      };
    }

    interface TmResponse {
      _embedded?: { events?: TmEvent[] };
      page?: { totalPages: number };
    }

    interface TmEvent {
      name: string;
      url: string;
      dates: { start: { localDate?: string } };
      classifications?: Array<{ genre?: { name: string } }>;
      _embedded?: {
        venues?: Array<{ name: string }>;
        attractions?: Array<{ name: string }>;
      };
    }
    ```

- [x] Task 2: Wire `TicketmasterSource` into the Lambda handler
  - File: `src/event-pipeline/index.ts`
  - Action 1: Add import after the existing imports:
    ```typescript
    import { TicketmasterSource } from './event-sources/ticketmaster.js';
    ```
  - Action 2: Add env var read after the `openaiModel` line:
    ```typescript
    const ticketmasterApiKey = requireEnv('TICKETMASTER_API_KEY');
    ```
  - Action 3: Replace `sources: [],` with:
    ```typescript
    sources: [new TicketmasterSource(ticketmasterApiKey)],
    ```

- [x] Task 3: Add `TICKETMASTER_API_KEY` env var to the CDK stack
  - File: `lib/recommender-app-stack.ts`
  - Action: In the `environment: { ... }` block of `eventPipelineFn`, add alongside `OPENAI_API_KEY`:
    ```typescript
    TICKETMASTER_API_KEY: this.node.getContext('ticketmasterKey'),
    ```

- [x] Task 4: Add `--ticketmaster-key` to the deploy script
  - File: `deploy.sh`
  - Action 1: Update `usage()` echo to include `--ticketmaster-key <key>`:
    ```
    echo "Usage: $0 --profile <aws-profile> --openai-key <key> --ticketmaster-key <key> --sender-email <email> --recipient-email <email> --openai-model <model>"
    ```
  - Action 2: Add case to the `while` loop (alongside `--openai-key`):
    ```
    --ticketmaster-key) TICKETMASTER_KEY="$2"; shift 2 ;;
    ```
  - Action 3: Add `TICKETMASTER_KEY` to the required vars guard:
    ```
    [[ -z "$AWS_PROFILE" || -z "$OPENAI_KEY" || -z "$TICKETMASTER_KEY" || -z "$SENDER_EMAIL" || -z "$RECIPIENT_EMAIL" || -z "$OPENAI_MODEL" ]] && usage
    ```
  - Action 4: Add context flag to `cdk deploy` call (alongside `--context "openaiKey=..."`):
    ```
    --context "ticketmasterKey=$TICKETMASTER_KEY"
    ```

### Acceptance Criteria

- [x] AC1: Given `TicketmasterSource` is instantiated with an API key, when `fetch()` is called, then it returns a `Promise<Event[]>` where every item has `title`, `venue`, `date` (YYYY-MM-DD), `url`, and `sourceId === 'ticketmaster'`

- [x] AC2: Given the TM API returns more than 500 total events matching the query, when `fetch()` is called, then no more than 500 events are returned

- [x] AC3: Given today is T, when `fetch()` is called, then all API requests include `startDateTime` = T at 00:00:00Z and `endDateTime` = T+90 days

- [x] AC4: Given the TM API returns a non-2xx HTTP status, when `fetch()` is called, then it throws an `Error` containing the status code — `fetchAllEvents` catches it as a non-fatal `SourceError` and the pipeline continues

- [x] AC5: Given the Lambda handler runs with `TICKETMASTER_API_KEY` set, when any log output is produced, then the API key value does not appear in any `console.log` or `console.warn` line

- [x] AC6: Given `ticketmasterKey` is set in CDK context, when `cdk deploy` runs, then the Lambda function environment contains `TICKETMASTER_API_KEY` with that value

- [x] AC7: Given `deploy.sh` is invoked without `--ticketmaster-key`, when the script runs, then it exits non-zero and prints the updated usage line

## Review Notes

- Adversarial review completed
- Findings: 7 total, 5 fixed, 2 skipped
- Resolution approach: walk-through
- Skipped: F1 (plaintext key in Lambda env — pre-existing pattern, out of scope), F3 (no per-request timeout — accepted trade-off)
- Fixed: F2 (page-count cap), F4 (inter-page delay for rate limiting), F5 (non-JSON response guard), F6 (missing url skips event), F7 (attraction.name type predicate)

## Additional Context

### Dependencies

- No new npm dependencies — uses Node 24 native `fetch`
- `TICKETMASTER_API_KEY` must be added to `cdk.context.json` before deploy (same pattern as `openaiKey`)

### Testing Strategy

Manual smoke-test after deploy: invoke Lambda from AWS Console, check CloudWatch logs for `[ticketmaster] Done — N events fetched` with N > 0.

### Notes

- TM Discovery v2 date params format: `2026-03-19T00:00:00Z` (ISO 8601, no milliseconds)
- `_embedded.events` is absent (not just empty) when a page returns zero results — guard with `?? []`
- Genre name `"Undefined"` is a real TM response value for uncategorised events — filter it out from description
- Constructor accepts only `apiKey` — adding `countryCodes: string[]` in future to expand beyond CZ is the natural extension point
