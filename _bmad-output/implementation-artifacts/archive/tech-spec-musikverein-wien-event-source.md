---
title: 'Musikverein Wien Event Source'
slug: 'musikverein-wien-event-source'
created: '2026-03-23'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'TypeScript 5.9 (strict, NodeNext modules)'
  - 'Node.js 20 LTS'
  - 'cheerio (HTML parsing — already a dependency)'
  - 'Node built-in fetch'
files_to_modify:
  - 'src/event-pipeline/event-sources/musikverein.ts (NEW)'
  - 'src/event-pipeline/index.ts (add import + source registration)'
  - 'test/event-pipeline/event-sources/musikverein.live.test.ts (NEW)'
code_patterns:
  - 'EventSource interface: readonly id + fetch(): Promise<Event[]>'
  - 'Batch-parallel detail fetches: DETAIL_CONCURRENCY=5, REQUEST_DELAY_MS=250'
  - 'fetchHtml with Retry-After-aware retry (3 attempts, from fok.ts/socr.ts)'
  - 'fetchJson<T> helper (new — no existing JSON fetch helper in codebase)'
  - 'buildDescription: "Programme: ...; Performers: ..." (fok.ts/socr.ts pattern)'
  - 'mapToEvent: spread optional fields only if non-empty'
  - 'Logging prefix: [musikverein]'
  - 'NodeNext .js import extensions on all relative imports'
test_patterns:
  - 'LIVE=1 env gate (describe.skip when not set)'
  - 'jest.setTimeout(120_000) at module scope + explicit timeout on beforeAll'
  - 'beforeAll: instantiate source, call fetch(), store results'
  - 'Assertions: count >= 5, required fields shape, at least-one for optional fields'
  - 'Print 3 sample events for manual inspection'
---

# Tech-Spec: Musikverein Wien Event Source

**Created:** 2026-03-23

## Overview

### Problem Statement

The pipeline has no Musikverein Wien event source. Musikverein is a flagship classical venue in Vienna and a key source for Austrian/international classical concert recommendations. Four Czech sources are already registered; no Austrian venues are covered.

### Solution

Implement `MusikvereienSource` as a new `EventSource` class using a two-phase scrape: (1) monthly HTML listing pages at `spielplan.musikverein.at/spielplan?month=YYYY-MM` for event IDs + basic fields, with a keyword pre-filter to exclude non-musical events; (2) per-event JSON API at `spielplan.musikverein.at/e/[ID].json` for full cast, programme, and ISO datetime. Register the source in `index.ts`.

### Scope

**In Scope:**
- New file `src/event-pipeline/event-sources/musikverein.ts` implementing the `EventSource` interface
- Two-phase scrape: listing HTML (12 months) → per-event JSON API (filtered events only)
- Month range: current month + 11 months ahead (12 total), generated at runtime
- Genre pre-filter by title keyword exclusion (`Vortrag`, `Talkrunde`, `Führung`, `Workshop`, `Kinderkonzert`) before JSON API calls
- Skip cancelled events (`booking_status_is_cancelled === 'True'`)
- ISO date derived from `booking.date_start` field (Vienna local time → `YYYY-MM-DD`)
- `description` field synthesized from full cast + programme (same pattern as FOK/SOCR)
- Register `MusikvereienSource` in `src/event-pipeline/index.ts` `sources` array
- Live integration test at `test/event-pipeline/event-sources/musikverein.live.test.ts`

**Out of Scope:**
- Kirby REST API (`/api/...` — requires auth, not needed)
- `is_ticketing_active` / `secutix_id` beyond what `Event.url` already covers
- Genre-code-based GET filtering (keyword exclusion sufficient for POC)
- Any new environment variables (no auth required)

## Context for Development

### Codebase Patterns

- **EventSource interface:** `readonly id: string` + `async fetch(): Promise<Event[]>` — the only contract. See [src/event-pipeline/types.ts](src/event-pipeline/types.ts).
- **Source registration:** Instantiate and add to `sources` array inside `runPipeline({...})` in [src/event-pipeline/index.ts](src/event-pipeline/index.ts) — no other files change.
- **Module resolution:** All relative imports use `.js` suffix (NodeNext). E.g. `import type { Event, EventSource } from '../types.js'`.
- **Logging prefix:** `[musikverein]` — matches `[ceska-filharmonie]` / `[fok]` / `[socr]` pattern.
- **fetchHtml pattern:** `fetch(url, { headers: { 'User-Agent': '...' }, signal: AbortSignal.timeout(10_000) })` with `Retry-After`-aware retry on 429/5xx (max 3 attempts). Copy from `fok.ts` / `socr.ts` verbatim, change log prefix.
- **fetchJson\<T\> (new helper):** Same structure and retry logic as `fetchHtml`, but calls `res.json() as T` instead of `res.text()`. Signature: `async function fetchJson<T>(url: string, attempt = 1): Promise<T>`. No existing scraper has this — implement alongside `fetchHtml`.
- **Batch-parallel detail fetches:** `DETAIL_CONCURRENCY = 5`, `Promise.allSettled()` per batch, `await delay(REQUEST_DELAY_MS)` before each batch **except the first** (`if (batchStart > 0) await delay(...)`). Non-fatal per event — log warning and skip, continue with rest.
- **mapToEvent pattern:** Spread optional fields only if non-empty: `...(arr.length > 0 ? { field: arr } : {})`.
- **buildDescription:** Assembles `parts: string[]`. If programme non-empty, push `"Programme: <items>"` (items joined with `"; "`). If performers non-empty, push `"Performers: <items>"`. Return `parts.join('. ') + '.'` if any parts, else `undefined`. This produces `"Programme: X — Y; Z — W. Performers: A (role), B."` — same format as `fok.ts` / `socr.ts`.
- **Live test pattern:** `LIVE=1` env gate, `jest.setTimeout(120_000)`, standard assertions. See [test/event-pipeline/event-sources/fok.live.test.ts](test/event-pipeline/event-sources/fok.live.test.ts).

### Files to Reference

| File | Purpose |
| ---- | ------- |
| [src/event-pipeline/event-sources/fok.ts](src/event-pipeline/event-sources/fok.ts) | Primary pattern reference — batch-parallel detail fetches, buildDescription, fetchHtml with Retry-After retry |
| [src/event-pipeline/event-sources/socr.ts](src/event-pipeline/event-sources/socr.ts) | Confirms buildDescription and fetchHtml patterns are consistent across recent scrapers |
| [src/event-pipeline/event-sources/ceska-filharmonie.ts](src/event-pipeline/event-sources/ceska-filharmonie.ts) | Listing pre-filter pattern |
| [src/event-pipeline/types.ts](src/event-pipeline/types.ts) | Event and EventSource interfaces |
| [src/event-pipeline/index.ts](src/event-pipeline/index.ts) | Source registration — add MusikvereienSource to `sources` array inside `runPipeline({...})` |
| [test/event-pipeline/event-sources/fok.live.test.ts](test/event-pipeline/event-sources/fok.live.test.ts) | Live test template |
| [_bmad-output/spikes/scraping_analysis/international/musikverein-scraping-spike-2026-03-18.md](_bmad-output/spikes/scraping_analysis/international/musikverein-scraping-spike-2026-03-18.md) | Full DOM selectors, JSON API field reference, minimal fetch recipe, notes & risks |

### Technical Decisions

- **Month range:** Generate 12 months at runtime using `Date` arithmetic: start from `new Date()`, extract year/month, then for `i = 0..11` compute `new Date(year, month + i, 1)` to get each month, format as `YYYY-MM`. This correctly handles year rollover (e.g., month+12 wraps to next year).
- **Two-phase rationale:** JSON API is the only source for ISO datetime, full cast, and programme work titles. Pre-filtering by keyword limits JSON API calls to relevant events only.
- **Pre-filter approach:** Exclude by title keyword (`Vortrag`, `Talkrunde`, `Führung`, `Workshop`, `Kinderkonzert`). Applied after listing scrape, before JSON API calls.
- **Date parsing:** In `fetchEventDetail`: validate `booking.date_start` is a non-empty string of length ≥ 10 — throw `Error('Invalid date_start: ...')` if not. Then slice first 10 chars for `YYYY-MM-DD`. Do NOT use listing page `DD.MM.YYYY`.
- **Cancelled events:** Checked in `fetch()` loop **before** calling `mapToEvent`. If `detail.isCancelled`, log `[musikverein] Skipping cancelled event: ${card.id}` and `continue`. Keep `mapToEvent` pure.
- **`mapToEvent` throws only on missing `dateStart`:** Since date is validated in `fetchEventDetail`, a throw from `mapToEvent` on missing `dateStart` is a defensive fallback — should never trigger in practice.
- **Event URL:** `https://musikverein.at/konzert/?id={hex_id}` — built from `card.id` in `scrapeListingPage`.
- **Venue:** Hardcoded `'Musikverein Wien'` — set in `mapToEvent` directly (not in `MvCard` or `MvDetail`).
- **Cast name field:** Use `name_D || name_E` (German first, English fallback) — skip cast entries where both are empty.
- **Empty title guard:** In `scrapeListingPage`, skip any `div.event` where `h3.event--heading` yields empty string — log a warning.
- **`scrapeListingPage` error propagation:** If a listing page fetch throws (network error after retries), the error propagates up through `fetch()` and the entire source fails. The pipeline's per-source `try/catch` in `fetch-events.ts` records this as a `SourceError` — this is correct and intentional behaviour matching all other sources.
- **Hex ID validation:** No strict validation on the `id` attribute format — accept any non-empty string. Malformed IDs will result in a 404 from the JSON API, caught as a per-event detail error (warning + skip).

## Implementation Plan

### Tasks

- [ ] **Task 1: Create `src/event-pipeline/event-sources/musikverein.ts`**
  - File: `src/event-pipeline/event-sources/musikverein.ts`
  - Action: Create new file with the following structure in order:

  **1. Imports**
  ```typescript
  import { load } from 'cheerio';
  import type { Event, EventSource } from '../types.js';
  ```

  **2. Constants**
  ```typescript
  const LISTING_BASE = 'https://spielplan.musikverein.at';
  const DETAIL_BASE = 'https://musikverein.at';
  const REQUEST_DELAY_MS = 250;
  const DETAIL_CONCURRENCY = 5;
  const EXCLUDE_TITLE_KEYWORDS = ['Vortrag', 'Talkrunde', 'Führung', 'Workshop', 'Kinderkonzert'];
  ```

  **3. Private interfaces**
  ```typescript
  interface MvCard {
    id: string;          // 8-char hex from div.event[id] attribute
    title: string;       // from h3.event--heading
    detailUrl: string;   // https://musikverein.at/konzert/?id={id}
    eventType: 'EV' | 'FV';
  }

  interface MvCastEntry {
    name: string;   // name_D || name_E
    role: string;   // profession_D (e.g. "Dirigent", "Violine", "Orchester")
  }

  interface MvProgrammeEntry {
    composer: string;  // composer_author
    work: string;      // opus_titel_D
    isEncore: boolean; // !!is_encore
  }

  interface MvDetail {
    dateStart: string;            // YYYY-MM-DD, already validated and sliced
    isCancelled: boolean;
    cast: MvCastEntry[];
    programme: MvProgrammeEntry[];
  }

  // Typed shape of the JSON API response — only the keys we use
  interface MvApiResponse {
    booking: {
      data: Array<{
        date_start: string;                    // "YYYY-MM-DD HH:MM:SS" local Vienna time
        booking_status_is_cancelled: string;   // "True" | "False" (string, not boolean)
      }>;
    };
    cast: {
      data: Array<{
        name_D: string;
        name_E: string;
        profession_D: string;
        performer_display_mode: string;
        order: string;
      }>;
    };
    program: {
      data: Array<{
        composer_author: string;  // "***" means TBA — exclude
        opus_titel_D: string;
        order: number;
        is_encore: number;        // 0 | 1
      }>;
    };
  }
  ```

  **4. `MusikvereienSource` class**
  ```typescript
  export class MusikvereienSource implements EventSource {
    readonly id = 'musikverein';

    async fetch(): Promise<Event[]> {
      console.log('[musikverein] Starting scrape');

      const months = generateMonths(12);
      const allCards: MvCard[] = [];

      for (let i = 0; i < months.length; i++) {
        if (i > 0) await delay(REQUEST_DELAY_MS);
        try {
          const cards = await scrapeListingPage(months[i]!);
          allCards.push(...cards);
        } catch (err) {
          // If month 0 (first listing page) fails, re-throw — fatal.
          // For subsequent months, warn and continue (partial results acceptable).
          if (i === 0) throw err;
          console.warn(
            `[musikverein] Listing page ${months[i]} failed, skipping:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      console.log(`[musikverein] Listing: ${allCards.length} events found`);

      const filtered = allCards.filter(
        c => !EXCLUDE_TITLE_KEYWORDS.some(kw => c.title.includes(kw))
      );
      console.log(
        `[musikverein] After keyword filter: ${filtered.length} events ` +
        `(${allCards.length - filtered.length} excluded)`
      );

      const events: Event[] = [];

      for (let batchStart = 0; batchStart < filtered.length; batchStart += DETAIL_CONCURRENCY) {
        if (batchStart > 0) await delay(REQUEST_DELAY_MS);
        const batch = filtered.slice(batchStart, batchStart + DETAIL_CONCURRENCY);

        const results = await Promise.allSettled(
          batch.map(card => fetchEventDetail(card.id)),
        );

        for (let j = 0; j < batch.length; j++) {
          const card = batch[j]!;
          const result = results[j]!;

          if (result.status === 'rejected') {
            console.warn(
              `[musikverein] Skipping event (detail error): ${card.id} —`,
              result.reason instanceof Error ? result.reason.message : String(result.reason),
            );
            continue;
          }

          const detail = result.value;

          if (detail.isCancelled) {
            console.log(`[musikverein] Skipping cancelled event: ${card.id}`);
            continue;
          }

          try {
            events.push(mapToEvent(card, detail));
          } catch (err) {
            console.warn(
              `[musikverein] Skipping event (map error): ${card.id} —`,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
      }

      console.log(`[musikverein] Done — ${events.length} events`);
      return events;
    }
  }
  ```

  **5. `scrapeListingPage(month: string): Promise<MvCard[]>`**
  - URL: `${LISTING_BASE}/spielplan?month=${month}`
  - Call `fetchHtml(url)`, load with cheerio
  - Iterate `$('div.event')`:
    - Extract `id = $el.attr('id') ?? ''` — skip if empty, warn: `[musikverein] div.event missing id attribute`
    - Extract `title = $el.find('h3.event--heading').text().trim()` — skip if empty, warn: `[musikverein] Skipping event with empty title (id=${id})`
    - Extract `eventType`: `$el.hasClass('EV') ? 'EV' : 'FV'`
    - Build `detailUrl = \`${DETAIL_BASE}/konzert/?id=${id}\``
  - Deduplicate by `id` within the page using a `seenIds` Set
  - Return `MvCard[]`

  **6. `fetchEventDetail(id: string): Promise<MvDetail>`**
  - URL: `${LISTING_BASE}/e/${id}.json`
  - Call `fetchJson<MvApiResponse>(url)`
  - Extract `const booking = data.booking?.data?.[0]` — throw `new Error('No booking data in API response for id: ' + id)` if falsy
  - Validate date: `const rawDate = booking.date_start` — throw `new Error('Invalid date_start: ' + rawDate)` if `!rawDate || rawDate.length < 10`
  - `const dateStart = rawDate.substring(0, 10)`
  - `const isCancelled = booking.booking_status_is_cancelled === 'True'`
  - Cast: map `data.cast.data` → `MvCastEntry[]`:
    - `name = (c.name_D || c.name_E).trim()` — skip entries where name is empty after fallback
    - `role = c.profession_D`
  - Programme: **sort** `data.program.data` by `p.order` ascending, **then filter** `p.composer_author !== '***'`, map → `MvProgrammeEntry`:
    - `composer = p.composer_author`
    - `work = p.opus_titel_D`
    - `isEncore = !!p.is_encore`
  - Return `MvDetail`

  **7. `mapToEvent(card: MvCard, detail: MvDetail): Event`**
  - Throw `new Error('No dateStart for event: ' + card.id)` if `!detail.dateStart` (defensive — should not trigger)
  - `performers = detail.cast.map(c => c.role ? \`${c.name} (${c.role})\` : c.name)`
  - `composers = [...new Set(detail.programme.map(p => p.composer))]`
  - `description = buildDescription(detail.programme, performers)`
  - Return:
    ```typescript
    {
      title: card.title,
      venue: 'Musikverein Wien',    // hardcoded — all events at this venue
      date: detail.dateStart,
      url: card.detailUrl,
      sourceId: 'musikverein',
      ...(performers.length > 0 ? { performers } : {}),
      ...(composers.length > 0 ? { composers } : {}),
      ...(description ? { description } : {}),
    }
    ```

  **8. `buildDescription(programme: MvProgrammeEntry[], performers: string[]): string | undefined`**
  - Same structure as `fok.ts:buildDescription`:
    ```typescript
    const parts: string[] = [];
    if (programme.length > 0) {
      const progStr = programme
        .map(p => p.work ? `${p.composer} — ${p.work}` : p.composer)
        .join('; ');
      parts.push(`Programme: ${progStr}`);
    }
    if (performers.length > 0) {
      parts.push(`Performers: ${performers.join(', ')}`);
    }
    return parts.length > 0 ? parts.join('. ') + '.' : undefined;
    ```
  - Produces: `"Programme: Composer — Work; Composer — Work. Performers: Name (role), Name."` (period-space between sections, trailing period)

  **9. `generateMonths(n: number): string[]`**
  - Use `Date` arithmetic to correctly handle year rollover:
    ```typescript
    function generateMonths(n: number): string[] {
      const now = new Date();
      const months: string[] = [];
      for (let i = 0; i < n; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        months.push(`${year}-${month}`);
      }
      return months;
    }
    ```
  - Example: if today is 2026-03-23, returns `['2026-03', '2026-04', ..., '2027-02']`

  **10. `fetchHtml(url: string, attempt = 1): Promise<string>`**
  - Copy verbatim from `fok.ts:fetchHtml`, change all log prefixes from `[fok]` to `[musikverein]`

  **11. `fetchJson<T>(url: string, attempt = 1): Promise<T>`**
  - Same structure as `fetchHtml` (same retry/Retry-After logic) but:
    - Replace `res.text()` with `res.json() as T`
    - Log prefix: `[musikverein]`

  **12. `delay(ms: number): Promise<void>`**
  - Standard: `return new Promise(resolve => setTimeout(resolve, ms))`

- [ ] **Task 2: Register source in `src/event-pipeline/index.ts`**
  - File: `src/event-pipeline/index.ts`
  - Action:
    1. Add import after existing source imports: `import { MusikvereienSource } from './event-sources/musikverein.js'`
    2. Inside the `runPipeline({ sources: [...] })` call, add `new MusikvereienSource()` as the last item in the `sources` array (after `new SocrSource()`)

- [ ] **Task 3: Create live integration test**
  - File: `test/event-pipeline/event-sources/musikverein.live.test.ts`
  - Action: Create test file:
    ```typescript
    import { MusikvereienSource } from '../../../src/event-pipeline/event-sources/musikverein.js';
    import type { Event } from '../../../src/event-pipeline/types.js';

    const RUN_LIVE = process.env['LIVE'] === '1';
    const describe_ = RUN_LIVE ? describe : describe.skip;

    jest.setTimeout(120_000);

    describe_('MusikvereienSource — live integration (LIVE=1 to run)', () => {
      let events: Event[] = [];

      beforeAll(async () => {
        const source = new MusikvereienSource();
        events = await source.fetch();
      }, 120_000);

      it('returns at least 5 events', () => {
        console.log(`\n[musikverein live] Total events returned: ${events.length}`);
        expect(events.length).toBeGreaterThanOrEqual(5);
      });

      it('all events have required fields', () => {
        for (const event of events) {
          expect(event.title).toBeTruthy();
          expect(event.venue).toBe('Musikverein Wien');
          expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(event.url).toMatch(/musikverein\.at\/konzert\/\?id=/);
          expect(event.sourceId).toBe('musikverein');
        }
      });

      it('at least one event has performers', () => {
        const withPerformers = events.filter(e => e.performers && e.performers.length > 0);
        console.log(`[musikverein live] Events with performers: ${withPerformers.length}/${events.length}`);
        expect(withPerformers.length).toBeGreaterThan(0);
      });

      it('at least one event has composers', () => {
        const withComposers = events.filter(e => e.composers && e.composers.length > 0);
        console.log(`[musikverein live] Events with composers: ${withComposers.length}/${events.length}`);
        expect(withComposers.length).toBeGreaterThan(0);
      });

      it('at least one event has a synthesized description', () => {
        const withDesc = events.filter(e => e.description && e.description.length > 0);
        console.log(`[musikverein live] Events with description: ${withDesc.length}/${events.length}`);
        expect(withDesc.length).toBeGreaterThan(0);
      });

      it('prints sample events for manual inspection', () => {
        const sample = events.slice(0, 3);
        console.log('\n[musikverein live] Sample events:');
        for (const e of sample) {
          console.log(JSON.stringify(e, null, 2));
        }
        expect(sample.length).toBeGreaterThan(0);
      });
    });
    ```

### Acceptance Criteria

- [ ] **AC1 — Month range:** Given `generateMonths(12)` is called on 2026-03-23, then it returns exactly 12 entries `['2026-03', '2026-04', ..., '2027-02']`; given called on 2026-12-01, the 12th entry is `'2027-11'` (year rollover handled correctly)

- [ ] **AC2 — Listing parse:** Given a listing HTML page with `div.event` elements, when `scrapeListingPage` runs, then each `MvCard` has a non-empty `id`, a non-empty `title`, and `detailUrl` matching `https://musikverein.at/konzert/?id={id}`; `div.event` elements with empty `id` or empty `h3.event--heading` text are skipped with a `[musikverein]` warning

- [ ] **AC3 — Pre-filter (observable):** Given listing cards where some titles contain `Vortrag`, `Talkrunde`, `Führung`, `Workshop`, or `Kinderkonzert`, when `fetch()` runs, then `console.log` emits `[musikverein] After keyword filter: X events (Y excluded)` where Y > 0, and those excluded titles do not appear in the returned `Event[]`

- [ ] **AC4 — Date from JSON API:** Given `fetchEventDetail` receives `booking.date_start = "2026-03-19 19:30:00"`, then it returns `dateStart = "2026-03-19"`; given `date_start` is falsy or shorter than 10 chars, then `fetchEventDetail` throws `Error('Invalid date_start: ...')`

- [ ] **AC5 — Missing booking data guard:** Given the JSON API returns a response where `booking.data` is empty, when `fetchEventDetail` processes it, then it throws `Error('No booking data in API response for id: ...')`; this is caught by `Promise.allSettled` and logged as a detail error

- [ ] **AC6 — Cancelled events skipped:** Given `fetchEventDetail` returns `isCancelled = true`, when `fetch()` processes that result, then the event is not included in the output and `[musikverein] Skipping cancelled event: {id}` is logged

- [ ] **AC7 — TBA programme filtered:** Given `program.data[]` contains an entry with `composer_author = "***"`, then that entry is excluded from `programme[]` and does not appear in `composers[]`

- [ ] **AC8 — Programme sort order:** Given `program.data[]` entries with `order` values `[3, 1, 2]`, when mapped, then `MvDetail.programme` is in order `[1, 2, 3]` (sorted by `order` before filtering)

- [ ] **AC9 — Full cast and composers:** Given the JSON API returns cast with `name_D = "Zubin Mehta"`, `profession_D = "Dirigent"`, then `Event.performers` contains `"Zubin Mehta (Dirigent)"`; given a cast entry where `name_D = ""` and `name_E = "John Doe"`, then `Event.performers` contains `"John Doe"` (English fallback)

- [ ] **AC10 — Description synthesis:** Given programme `[{composer: "Beethoven", work: "Symphony No. 7"}]` and performers `["Zubin Mehta (Dirigent)"]`, when `buildDescription` runs, then `description = "Programme: Beethoven — Symphony No. 7. Performers: Zubin Mehta (Dirigent)."`

- [ ] **AC11 — Per-event error isolation:** Given `fetchEventDetail` throws for one card in a batch, when `fetch()` processes that batch, then `[musikverein] Skipping event (detail error): {id} — {message}` is logged and all other cards in the batch are still processed

- [ ] **AC12 — Registration:** Given the Lambda handler starts, when `sources` is evaluated in `runPipeline({...})`, then `MusikvereienSource` is present in the array alongside the existing sources

- [ ] **AC13 — Live test passes:** Given `LIVE=1` is set and `beforeAll` completes without throwing, when `LIVE=1 npm test -- musikverein.live` runs, then all 6 test assertions pass

## Additional Context

### Dependencies

No new npm packages required. Uses `cheerio` (already in `dependencies`) and Node built-in `fetch`.

### Testing Strategy

Live integration test only — same approach as all other event sources. The scraper logic is thin parsing/mapping code; correctness is best validated against the real site. Run with:

```bash
LIVE=1 npx jest musikverein.live --testTimeout=120000
```

### Notes

- **No auth required** for either the listing page or JSON API — both fully public.
- **JSON API is reverse-engineered** (undocumented, found in inline JS on the concert detail page) — monitor for breakage.
- **`booking_status_is_cancelled` is a string `"True"/"False"`** — must use `=== 'True'`, not a truthy check.
- **`program[].composer_author === "***"`** = programme TBA — filtered out; sort by `order` BEFORE filtering to preserve programme sequence.
- **Image URLs** are relative to `spielplan.musikverein.at` — not mapped to `Event`; ignore.
- **~50% of events are `FV` (external)** — include both `EV` and `FV`; quality classical concerts appear in both.
- **Empty listing pages** (months beyond season end) return gracefully as empty `MvCard[]`.
- **First listing page failure is fatal** (throws); subsequent month failures are non-fatal (warn + continue).
- **`cancelled` check in `fetch()`, not `mapToEvent()`** — keeps mapToEvent pure; it throws only on missing `dateStart` as a defensive fallback.
- **`fetchJson` is a new helper** — no other scraper in the codebase has a JSON fetch utility. Implement as a generic function alongside `fetchHtml` in the same file.
