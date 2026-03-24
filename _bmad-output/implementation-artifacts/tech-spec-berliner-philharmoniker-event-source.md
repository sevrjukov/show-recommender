---
title: 'Berliner Philharmoniker Event Source'
slug: 'berliner-philharmoniker-event-source'
created: '2026-03-24'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'TypeScript 5.9 (strict, NodeNext modules)'
  - 'Node.js 20 LTS fetch (built-in, no cheerio needed)'
  - 'Jest + ts-jest'
files_to_modify:
  - 'src/event-pipeline/event-sources/berliner-phil.ts (CREATE)'
  - 'src/event-pipeline/index.ts (MODIFY — add import + register source)'
  - 'test/event-pipeline/event-sources/berliner-phil.live.test.ts (CREATE)'
code_patterns:
  - 'EventSource class with module-level helper functions (not methods)'
  - 'fetchJson helper with Retry-After header parsing and 3-attempt retry (copy from musikverein.ts)'
  - 'delay helper (copy from musikverein.ts)'
  - 'Spread optional Event fields only when non-empty: ...(x.length > 0 ? { field: x } : {})'
  - 'Per-event errors logged+skipped, never throw from fetch()'
  - 'Log prefix: [berliner-phil]'
test_patterns:
  - 'Live-only tests gated by LIVE=1 env var, describe.skip otherwise'
  - 'jest.setTimeout(120_000), beforeAll fetches events'
  - 'Tests: min count, required fields, optional field coverage, sample print'
---

# Tech-Spec: Berliner Philharmoniker Event Source

**Created:** 2026-03-24

## Overview

### Problem Statement

The event pipeline has no Berliner Philharmoniker source. BPh events — one of the world's premier orchestras — are entirely absent from weekly recommendations.

### Solution

Implement `BerlinerPhilSource`, a new `EventSource` class that queries the public Typesense API already embedded in the BPh website. No headless browser is needed — plain HTTP GET with a single API key header. Paginate over all future non-guest events, map the response to the pipeline's `Event` interface, and register the source in `index.ts`.

### Scope

**In Scope:**
- `BerlinerPhilSource` class in `src/event-pipeline/event-sources/berliner-phil.ts`
- Paginated fetch from the Typesense endpoint (all non-guest events, including "On tour")
- Filter: `is_guest_event:false && tags:!=Guided tours && time_start:>={now}`
- Field mapping: `title` (composed from `super_title`+`title`), `date` (from `time_start` unix → ISO), `url` (prepend base URL to `detail_url`), `venue` (from `place` field), `performers` (from `artists` array), `composers` (parsed from `works_overview_formatted`), `description` (`works_raw` + `artists_raw`)
- Registration in `src/event-pipeline/index.ts`
- Live integration test at `test/event-pipeline/event-sources/berliner-phil.live.test.ts`

**Out of Scope:**
- Guest events (`is_guest_event:true`)
- Guided tours (excluded via `tags:!=Guided tours` filter)
- API key rotation recovery (source fails non-fatally if key is stale; update constant manually)
- Unit tests with mocked HTTP (project pattern is live tests only for event sources)

## Context for Development

### Codebase Patterns

- **Module resolution:** NodeNext — all relative imports use `.js` extension (e.g. `import type { Event, EventSource } from '../types.js'`)
- **TypeScript:** strict mode — `noImplicitAny`, `strictNullChecks`, `noImplicitReturns`
- **EventSource interface:** Implement `readonly id: string` and `fetch(): Promise<Event[]>`. Zero pipeline changes needed — just add instance to `sources[]` in `index.ts`.
- **HTTP fetching:** Use native `fetch` (Node 20 built-in) with `AbortSignal.timeout(10_000)`. Copy `fetchJson<T>` helper verbatim from `musikverein.ts` — it handles `Retry-After` header, 3-attempt retry on 429/5xx, and logs with the module prefix. Change log prefix to `[berliner-phil]`. **After copying, add `'X-TYPESENSE-API-KEY': API_KEY` to the `headers` object** — the Typesense endpoint requires this header on every request; without it all requests return 401. No `cheerio` needed (pure JSON API).
- **Class structure:** Export a named class (`BerlinerPhilSource`). All helper functions are module-level (not class methods) — matches both existing sources.
- **Non-fatal failures:** Per-event mapping errors are logged and skipped; `fetch()` returns all events that mapped successfully, never throws for individual record issues. Fatal only on page-1 fetch failure (throws, bubbles up as SourceError in pipeline).
- **Optional Event fields:** Spread only when non-empty — `...(arr.length > 0 ? { field: arr } : {})`. Matches pattern in `ceska-filharmonie.ts` and `musikverein.ts`.
- **Log prefix:** `[berliner-phil]` on all `console.log/warn/error` calls.
- **Dedup key input:** Pipeline computes SHA-256 from `date + '|' + venue + '|' + title` — source must supply ISO `YYYY-MM-DD` date and a consistent `venue` string per event.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src/event-pipeline/event-sources/musikverein.ts` | Reference implementation — copy `fetchJson<T>` and `delay` helpers verbatim (lines 266–286), follow class/function structure |
| `src/event-pipeline/types.ts` | `Event` and `EventSource` interfaces |
| `src/event-pipeline/index.ts` | Add import and register new source in `sources[]` array |
| `test/event-pipeline/event-sources/musikverein.live.test.ts` | Test structure to replicate exactly |
| `_bmad-output/spikes/scraping_analysis/international/berliner-phil-api-spike-2026-03-18.md` | Full API reference — endpoint, headers, query params, response shape, field descriptions |

### Technical Decisions

- **API key:** Hardcode `09zNJI6igIRLJHhNB2YGwgaX0JApQYOL` as `const API_KEY` at module level. Add comment: `// Public read-only key embedded in window.typesense_config — update if requests start returning 401`. This is not a secret.
- **Title field:** `super_title ? \`${super_title}: ${title}\` : title`. Avoids the common case where `title` alone is just performer names with no concert category context.
- **Date parsing:** `time_start` is Unix seconds. Convert: `new Date(doc.time_start * 1000).toISOString().substring(0, 10)`. All BPh events are in the Europe/Berlin timezone but using UTC ISO slice is acceptable here — events are unlikely to be at midnight UTC and even if so the date shift is a one-day difference that won't affect matching.
- **URL construction:** `detail_url` is relative (e.g. `/en/concert/calendar/56552/`). Prepend `https://www.berliner-philharmoniker.de`.
- **Venue:** Use `place` field directly (e.g. `"Main Auditorium"`, `"Philharmonie Berlin"`). "On tour" events carry a non-Berlin venue name — intentional.
- **Performers:** Implement `parsePerformers` defensively — `artists` may contain entries with null/empty names. Filter them out. Implement as:
  ```typescript
  function parsePerformers(artists: BpArtist[]): string[] {
    return artists
      .map(a => {
        const name = a.name?.trim() ?? '';
        if (!name) return null;
        const role = a.role?.trim() ?? '';
        return role ? `${name} (${role})` : name;
      })
      .filter((x): x is string => x !== null);
  }
  ```
  Use structured `artists` field, not `artists_raw`.
- **Composers:** Implement `parseComposers` with signature `(overview: string | undefined): string[]`. Parse `works_overview_formatted` (e.g. `"Beethoven, Schumann and Shostakovich"`). Split on ` and ` (space-and-space) first, then on `, ` (comma-space). Trim each result. Filter empty strings. If input is absent/empty, return `[]`. Implement as:
  ```typescript
  function parseComposers(overview: string | undefined): string[] {
    if (!overview?.trim()) return [];
    return overview
      .split(' and ')
      .flatMap(part => part.split(', '))
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }
  ```
- **Description:** Implement `buildDescription` with signature `(worksRaw: string | undefined, artistsRaw: string | undefined): string | undefined`. Join non-empty parts with `. ` and append a trailing `.`. Implement as:
  ```typescript
  function buildDescription(worksRaw: string | undefined, artistsRaw: string | undefined): string | undefined {
    const parts: string[] = [];
    if (worksRaw?.trim()) parts.push(`Programme: ${worksRaw.trim()}`);
    if (artistsRaw?.trim()) parts.push(`Performers: ${artistsRaw.trim()}`);
    return parts.length > 0 ? parts.join('. ') + '.' : undefined;
  }
  ```
- **Pagination:** Fetch page 1 to get `found`. Compute `totalPages = Math.ceil(found / PER_PAGE)`. Fetch pages 2…N **sequentially** with `await delay(REQUEST_DELAY_MS)` between each. `PER_PAGE = 20`, `REQUEST_DELAY_MS = 250`. Note: unlike `musikverein.ts` which uses `Promise.allSettled` parallel batches for detail pages, BPh pagination is strictly sequential — each page is a top-level API call, not a per-event detail fetch, so serial is appropriate.
- **`filter_by` constant:** Build at fetch time: `` `is_guest_event:false && tags:!=Guided tours && time_start:>=${Math.floor(Date.now() / 1000)}` ``
- **`query_by` constant:** `"title,place,works_raw,artists_raw,super_title,brand_title,brand_title_second"` — copy from spike, send as-is.

## Implementation Plan

### Tasks

- [ ] Task 1: Create `src/event-pipeline/event-sources/berliner-phil.ts`
  - File: `src/event-pipeline/event-sources/berliner-phil.ts`
  - Action: Create new file with the following structure (in order):
    1. **Imports:** `import type { Event, EventSource } from '../types.js';`
    2. **Constants:**
       ```typescript
       const BASE_URL = 'https://www.berliner-philharmoniker.de';
       const API_BASE = `${BASE_URL}/filter/search`;
       const COLLECTION = 'performance_1';
       // Public read-only key embedded in window.typesense_config — update if requests start returning 401
       const API_KEY = '09zNJI6igIRLJHhNB2YGwgaX0JApQYOL';
       const PER_PAGE = 20;
       const REQUEST_DELAY_MS = 250;
       ```
    3. **Interfaces:** Define the following TypeScript interfaces:
       ```typescript
       interface BpArtist {
         name: string;
         role?: string;
       }

       interface BpDocument {
         id: string;
         uid: number;
         title: string;
         super_title?: string;
         place: string;
         time_start: number;
         detail_url: string;
         artists: BpArtist[];
         works_overview_formatted?: string;
         works_raw?: string;
         artists_raw?: string;
       }

       interface BpSearchResponse {
         found: number;
         hits: Array<{ document: BpDocument }>;
       }
       ```
    4. **`BerlinerPhilSource` class** implementing `EventSource`:
       - `readonly id = 'berliner-phil'`
       - `async fetch(): Promise<Event[]>`: logs start, builds `filter_by` with current unix time, fetches page 1, logs found count, iterates pages 2…N with delay, collects hits, maps each document via `mapToEvent`, skips+warns on map errors, logs done count, returns events
    5. **`mapToEvent(doc: BpDocument): Event`** module-level function:
       - `title`: `doc.super_title ? \`${doc.super_title}: ${doc.title}\` : doc.title`
       - `venue`: `doc.place`
       - `date`: `new Date(doc.time_start * 1000).toISOString().substring(0, 10)`
       - `url`: `` `${BASE_URL}${doc.detail_url}` ``
       - `sourceId`: `'berliner-phil'`
       - `performers`: from `parsePerformers(doc.artists)` — spread only if non-empty
       - `composers`: from `parseComposers(doc.works_overview_formatted)` — spread only if non-empty
       - `description`: from `buildDescription(doc.works_raw, doc.artists_raw)` — spread only if truthy
    6. **`parsePerformers(artists: BpArtist[]): string[]`** — implement exactly as shown in the Performers technical decision above
    7. **`parseComposers(overview: string | undefined): string[]`** — implement exactly as shown in the Composers technical decision above
    8. **`buildDescription(worksRaw: string | undefined, artistsRaw: string | undefined): string | undefined`** — implement exactly as shown in the Description technical decision above
    9. **`fetchJson<T>`** — copy verbatim from `musikverein.ts` lines 266–282, then:
       - Change all `[musikverein]` log prefixes to `[berliner-phil]`
       - Add `'X-TYPESENSE-API-KEY': API_KEY` to the `headers` object (the Typesense endpoint requires this header; without it every request returns 401)
    10. **`delay`** — copy verbatim from `musikverein.ts`

- [ ] Task 2: Register source in `src/event-pipeline/index.ts`
  - File: `src/event-pipeline/index.ts`
  - Action:
    1. Add import after existing source imports: `import { BerlinerPhilSource } from './event-sources/berliner-phil.js';`
    2. Add `new BerlinerPhilSource()` to the `sources` array inside `runPipeline()`

- [ ] Task 3: Create live integration test `test/event-pipeline/event-sources/berliner-phil.live.test.ts`
  - File: `test/event-pipeline/event-sources/berliner-phil.live.test.ts`
  - Action: Replicate `musikverein.live.test.ts` structure exactly, substituting:
    - Import: `BerlinerPhilSource` from `../../../src/event-pipeline/event-sources/berliner-phil.js`
    - `describe_` label: `'BerlinerPhilSource — live integration (LIVE=1 to run)'`
    - `venue` check: `expect(event.venue).toBeTruthy()` (not a hardcoded string — varies by event)
    - `url` check: `expect(event.url).toMatch(/berliner-philharmoniker\.de\/en\/concert\/calendar\//)`
    - `sourceId` check: `expect(event.sourceId).toBe('berliner-phil')`
    - Keep all other tests identical: min 5 events, all required fields, performers coverage, composers coverage, description coverage, sample print

### Acceptance Criteria

- [ ] AC 1: Given the Typesense API is reachable and the API key is valid, when `BerlinerPhilSource.fetch()` is called, then it returns at least 5 `Event` objects.

- [ ] AC 2: Given events are returned, when each event is inspected, then `title` is non-empty, `date` matches `/^\d{4}-\d{2}-\d{2}$/`, `url` starts with `https://www.berliner-philharmoniker.de/en/concert/calendar/`, `venue` is non-empty, and `sourceId` is `'berliner-phil'`.

- [ ] AC 3: Given the API returns `found > 20`, when `fetch()` is called, then all pages are fetched and the number of events returned is greater than 20 (verifiable via `console.log` output from the live test).

- [ ] AC 4: Given at least one event has a non-empty `artists` array, when mapped, then that event's `performers` field is a string array where each entry is either `"Name (role)"` or `"Name"`.

- [ ] AC 5: Given at least one event has a non-empty `works_overview_formatted`, when mapped, then that event's `composers` field is a non-empty string array of composer names.

- [ ] AC 6: Given at least one event has non-empty `works_raw` or `artists_raw`, when mapped, then that event's `description` is a non-empty string beginning with `"Programme:"` or `"Performers:"`.

- [ ] AC 7: Given `BerlinerPhilSource` is registered in `index.ts`, when the Lambda handler initialises, then TypeScript compiles without errors (`tsc --noEmit` passes).

- [ ] AC 8: Given the live test runs with `LIVE=1`, when it executes, then it prints at least 3 sample events to stdout with visible `title`, `date`, `venue`, and `url` fields.

## Additional Context

### Dependencies

No new npm dependencies. Uses:
- Node 20 built-in `fetch`
- `import type { Event, EventSource }` from existing `types.ts`

### Testing Strategy

- **Live integration test only** (project pattern — no mocked HTTP for event sources)
- Run with: `LIVE=1 npx jest berliner-phil --testTimeout=120000`
- Test file: `test/event-pipeline/event-sources/berliner-phil.live.test.ts`
- Tests are skipped by default (`describe.skip`) unless `LIVE=1` is set — safe for CI

### Notes

- **API key rotation risk:** The key `09zNJI6igIRLJHhNB2YGwgaX0JApQYOL` is embedded in `window.typesense_config` on `berliner-philharmoniker.de`. If it rotates, the source will surface as a `SourceError` in the weekly digest. Fix: load the homepage HTML, extract the new key with a regex on `typesense_config`, update the constant.
- **`works[]` structured array:** Often contains empty objects `{}` — do NOT use it. Use `works_raw` (plain text) or `works_overview_formatted` (summary string) instead.
- **"On tour" dedup:** These events have `place` values like `"Carnegie Hall"`. The dedup key will correctly treat them as distinct from Berlin events with the same title.
- **`is_works_overwritten` / `is_works_overview_overwritten` flags:** When true, the programme has been manually edited by BPh staff. No special handling needed — just use the fields as-is; the override only means the content is more reliable, not less.
