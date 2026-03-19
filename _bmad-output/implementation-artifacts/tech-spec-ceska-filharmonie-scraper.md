---
title: 'Česká filharmonie Scraper'
slug: 'ceska-filharmonie-scraper'
created: '2026-03-19'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['TypeScript 5.9.3 (strict, NodeNext)', 'Node.js 20 LTS', 'cheerio 1.2.0', '@types/node 24 (fetch + AbortSignal.timeout globals)']
files_to_modify:
  - 'package.json'
  - 'src/event-pipeline/fetch-events.ts'
  - 'lib/recommender-app-stack.ts'
  - 'src/event-pipeline/index.ts'
files_to_create:
  - 'src/event-pipeline/event-sources/ceska-filharmonie.ts'
code_patterns:
  - 'NodeNext module resolution — relative imports must use .js extension'
  - 'Strict TypeScript — noImplicitAny, strictNullChecks, noImplicitReturns'
  - 'EventSource interface pattern — implements fetch(): Promise<Event[]>'
  - 'Non-fatal individual event failures — warn + skip, never throw from fetch()'
  - 'Batch-parallel detail fetches — DETAIL_CONCURRENCY = 5, delay between batches'
test_patterns:
  - 'Jest + ts-jest; tests in test/event-pipeline/event-sources/'
---

# Tech-Spec: Česká filharmonie Scraper

**Created:** 2026-03-19

## Overview

### Problem Statement

The pipeline currently has only Ticketmaster as an event source, which covers commercial music events but misses classical concerts. Česká filharmonie (Czech Philharmonic) is the highest-priority classical venue: richest data quality (Event JSON-LD on every detail page), cleanest extraction path, and establishes the scraper baseline for all subsequent Czech venue scrapers.

### Solution

Implement `CeskaFilharmonieSource` as a two-phase web scraper implementing the `EventSource` interface. Phase 1 paginates the listing to collect event cards and pre-filters by event type before making detail requests. Phase 2 fetches each filtered detail page **in parallel batches of 5** and extracts structured data: ISO datetime and description from JSON-LD, full performers and programme composers from HTML. Register the source in `index.ts`. Raise pipeline source timeout and Lambda timeout to accommodate the new scraper's runtime.

### Scope

**In Scope:**
- `cheerio` npm dependency (HTML parsing)
- `CeskaFilharmonieSource` class in `src/event-pipeline/event-sources/ceska-filharmonie.ts`
- Listing page pagination (`?page=N`, 1-based, stop when page returns 0 events, safety cap 10 pages)
- Pre-filter before detail scrape: include `Concert`, `Dress rehearsal`, `Annotated concert`; exclude `Workshop`, `Education programs`
- Detail page scraping: iterate all JSON-LD blocks, pick the one with `startDate` (event block); `<h2>Performers</h2>` for full cast with roles; `<h2>Programme</h2>` for composer names; HTML-strip description
- Batch-parallel detail fetches: `DETAIL_CONCURRENCY = 5`, 250ms delay between batches
- Per-page listing error handling: page 1 failure is fatal; pages 2+ failures log + stop pagination gracefully
- Per-event detail failure handling: warn + skip individual event, never fail the whole source
- Raise `SOURCE_TIMEOUT_MS` in `fetch-events.ts` from 30s → 90s
- Raise Lambda timeout in `lib/recommender-app-stack.ts` from 60s → 180s
- Register `CeskaFilharmonieSource` in `src/event-pipeline/index.ts` (no new env vars)

**Out of Scope:**
- Shared `normalizeVenue` utility — CF venue names come from JSON-LD consistently; cross-site normalization deferred until multiple scrapers coexist
- `normalizeDate` utility — CF JSON-LD provides ISO 8601 dates; no Czech locale parsing needed for this source
- Dedup against Rudolfinum (CF events also appear on rudolfinum.cz) — deferred to Rudolfinum scraper spec; pipeline-level hash dedup will handle it
- `deploy.sh` changes — Lambda timeout is set in CDK code, not a deploy-time context variable

---

## Context for Development

### Codebase Patterns

- All event source implementations live in `src/event-pipeline/event-sources/`. The Ticketmaster implementation ([src/event-pipeline/event-sources/ticketmaster.ts](src/event-pipeline/event-sources/ticketmaster.ts)) is the reference pattern.
- `EventSource` interface (in [src/event-pipeline/types.ts](src/event-pipeline/types.ts)): `readonly id: string` + `fetch(): Promise<Event[]>`. The fetch orchestrator wraps each source's `fetch()` in try/catch and a `SOURCE_TIMEOUT_MS` timeout.
- `Event` interface fields: `title`, `venue`, `date` (ISO `YYYY-MM-DD`), `url`, `sourceId`, `performers?: string[]`, `composers?: string[]`, `description?: string`.
- NodeNext imports — all relative imports must use `.js` extension (e.g. `import type { Event } from '../types.js'`).
- Node.js 20 built-in `fetch` is available globally — no `node-fetch` needed.
- `cheerio` must go in `dependencies` (not `devDependencies`) so esbuild bundles it into the Lambda artifact.
- Logging convention: prefix all log lines with `[ceska-filharmonie]`. Use `console.log` for progress, `console.warn` for skipped events or unexpected structure.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| [src/event-pipeline/event-sources/ticketmaster.ts](src/event-pipeline/event-sources/ticketmaster.ts) | Reference EventSource implementation pattern |
| [src/event-pipeline/types.ts](src/event-pipeline/types.ts) | `Event`, `EventSource` interface definitions |
| [src/event-pipeline/fetch-events.ts](src/event-pipeline/fetch-events.ts) | Contains `SOURCE_TIMEOUT_MS` to be raised |
| [lib/recommender-app-stack.ts](lib/recommender-app-stack.ts) | CDK stack — Lambda `timeout` property to be raised |
| [src/event-pipeline/index.ts](src/event-pipeline/index.ts) | Handler where new source must be registered |
| [_bmad-output/spikes/scraping_analysis/czech/scraping-spike-ceska-filharmonie-2026-03-18.md](_bmad-output/spikes/scraping_analysis/czech/scraping-spike-ceska-filharmonie-2026-03-18.md) | Full CF spike: selectors, JSON-LD shape, examples, risks |
| [_bmad-output/spikes/scraping_analysis/czech/czech-classical-scraping-summary-2026-03-18.md](_bmad-output/spikes/scraping_analysis/czech/czech-classical-scraping-summary-2026-03-18.md) | Multi-source summary: pagination patterns, dedup strategy, shared architecture |

### Technical Decisions

- **`cheerio` for HTML parsing** — SSR site, no headless browser needed. Add to `dependencies` for esbuild bundling. `cheerio 1.2.0` bundles its own TypeScript types — no `@types/cheerio` needed.
- **JSON-LD as primary extraction path** — iterate all `<script type="application/ld+json">` blocks and pick the first one containing `startDate` (the Event block). Pages often include `BreadcrumbList`/`WebSite` blocks before the Event block; using `.first()` unconditionally would extract the wrong block. Never parse the listing's human-readable date string — JSON-LD only.
- **HTML as secondary extraction path** — JSON-LD `performer[]` contains only 2 entries (soloists + conductor). Full cast and programme composers must be extracted from `<h2>Performers</h2>` and `<h2>Programme</h2>` sections via sibling traversal.
- **Performer format** — store as `"Name (role)"` strings (e.g. `"Sol Gabetta (cello)"`). No role → just `"Name"`. Gives the LLM maximum context for matching.
- **Description HTML stripping** — JSON-LD description may contain HTML tags and entities. Strip before storing: `.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()`.
- **Pre-filter before detail scrape** — CF listing mixes concerts with workshops and education programs. Filter by event type label on the listing page to avoid wasting requests on non-concert events. Include: `Concert`, `Dress rehearsal`, `Annotated concert`. Exclude all others.
- **Event type extraction** — use `$(el).closest('li').text()` for isolation to a single card; fall back to `$(el).parent().text()` if no `<li>` ancestor. `KNOWN_EVENT_TYPES` ordered most-specific-first (`'Dress rehearsal'` before `'Concert'`) to prevent substring false-positives. Default `'Concert'` if no match found. **Validate against 20+ real listing cards during development.**
- **Pagination termination** — stop when a page returns 0 event links. Page 2+ HTTP errors: log warning, stop paginating, return what was already collected. Page 1 HTTP error: throw (fatal, no data). Remove any heuristic based on page size — near season-end a genuine last page may have only 2–3 events.
- **Batch-parallel detail fetches** — `DETAIL_CONCURRENCY = 5`. Sequential fetching of 50+ events × ~1.25s each = ~62s, which exceeds the pipeline source timeout. Batching at 5 concurrent reduces detail phase to ~15s. 250ms delay between batches (not between individual requests within a batch). `Promise.allSettled` — one failed detail page does not cancel others in the batch.
- **Timeout chain** — `SOURCE_TIMEOUT_MS` in `fetch-events.ts`: 30s → 90s. Lambda timeout: 60s → 120s. Per-request `AbortSignal.timeout`: 10s (unchanged). All sources run in parallel in `fetchAllEvents`, so adding more scrapers does not multiply Lambda runtime.
- **`isTag` type guard** — `function isTag(node: AnyNode): node is Element` allows clean TypeScript narrowing without `(node as any)` casts. Import both `AnyNode` and `Element` from `'cheerio'` directly.
- **`location` array-form** — JSON-LD `location` can be an array of `Place` objects; handle both: `const locObj = Array.isArray(loc) ? loc[0] : loc`.
- **URL regex warning** — if `href` matches `a[href^="/en/event/"]` but fails the `(\d+)-` ID regex, log a `console.warn` (not silent drop). This surfaces CF URL format changes immediately.
- **`sourceId`** — `'ceska-filharmonie'`.
- **`AbortSignal.timeout(10_000)`** — Node 20 built-in; no polyfill needed. `@types/node@24` provides the type.

---

## Implementation Plan

### Tasks

---

- [ ] **Task 1: Install cheerio**
  - File: `package.json`
  - Action: Run `npm install cheerio` — adds `cheerio@1.2.0` to `dependencies`
  - Notes: Must be in `dependencies` (not `devDependencies`) — esbuild bundles it into the Lambda artifact. If `cheerio` is already present anywhere in `package.json` (e.g. in `devDependencies` from a prior attempt), remove it from there first and re-run `npm install cheerio` to ensure it lands in `dependencies`. Verify after install.

---

- [ ] **Task 2: Raise pipeline source timeout and Lambda timeout**
  - Files: `src/event-pipeline/fetch-events.ts`, `lib/recommender-app-stack.ts`
  - Action:

    **`src/event-pipeline/fetch-events.ts`** — change:
    ```typescript
    const SOURCE_TIMEOUT_MS = 30_000;
    ```
    To:
    ```typescript
    const SOURCE_TIMEOUT_MS = 90_000;
    ```

    **`lib/recommender-app-stack.ts`** — change:
    ```typescript
    timeout: cdk.Duration.seconds(60),
    ```
    To:
    ```typescript
    timeout: cdk.Duration.seconds(180),
    ```

  - Notes: `SOURCE_TIMEOUT_MS` is the per-source timeout in `fetchAllEvents` — all sources run in parallel, so this is the maximum time a single source may take before being abandoned. 90s gives the CF scraper (~15s for batch-parallel fetching) and future scrapers ample headroom. The Lambda timeout must exceed `SOURCE_TIMEOUT_MS` by enough to cover cold start (1–3s on ARM64), S3 preferences read, OpenAI matching call (up to ~20s), and SES send. 180s provides ~90s of headroom above SOURCE_TIMEOUT_MS — sufficient for any plausible pipeline overhead.

---

- [ ] **Task 3: Create `src/event-pipeline/event-sources/ceska-filharmonie.ts`**
  - File: `src/event-pipeline/event-sources/ceska-filharmonie.ts` (new)
  - Action: Implement `CeskaFilharmonieSource`:

    ```typescript
    import { load, type AnyNode, type Element } from 'cheerio';
    import type { Event, EventSource } from '../types.js';

    const BASE_URL = 'https://www.ceskafilharmonie.cz';
    const LISTING_PATH = '/en/whats-on/';
    const REQUEST_DELAY_MS = 250;
    const MAX_LISTING_PAGES = 10;
    const DETAIL_CONCURRENCY = 5; // parallel detail fetches per batch

    // Event types to include; all others (Workshop, Education programs, etc.) are excluded
    const INCLUDE_EVENT_TYPES = new Set(['Concert', 'Dress rehearsal', 'Annotated concert']);
    // Ordered most-specific first — prevents 'Concert' matching inside 'Annotated concert'
    const KNOWN_EVENT_TYPES = [
      'Dress rehearsal',
      'Annotated concert',
      'Education programs',
      'Workshop',
      'Concert',
    ] as const;

    interface CfCard {
      eventId: string;
      title: string;
      detailUrl: string;
      eventType: string;
    }

    interface CfDetail {
      date: string;         // ISO YYYY-MM-DD from JSON-LD
      venue: string;        // from JSON-LD location.name
      description: string;  // from JSON-LD description, HTML-stripped
      performers: string[]; // ["Sol Gabetta (cello)", "Semyon Bychkov (conductor)"]
      composers: string[];  // ["Edward Elgar", "Igor Stravinsky"]
    }

    /** Narrows AnyNode to Element (tag nodes), giving typed access to `.name`. */
    function isTag(node: AnyNode): node is Element {
      return node.type === 'tag';
    }

    export class CeskaFilharmonieSource implements EventSource {
      readonly id = 'ceska-filharmonie';

      async fetch(): Promise<Event[]> {
        console.log('[ceska-filharmonie] Starting scrape');

        const allCards = await this.scrapeAllListingPages();
        console.log(`[ceska-filharmonie] Listing: ${allCards.length} events found`);

        const filtered = allCards.filter(c => INCLUDE_EVENT_TYPES.has(c.eventType));
        console.log(`[ceska-filharmonie] After type filter: ${filtered.length} events (${allCards.length - filtered.length} excluded)`);

        const events: Event[] = [];

        // Batch-parallel detail fetches — sequential would take 50+ × ~1.25s ≈ 62s,
        // exceeding the pipeline source timeout. Batching at DETAIL_CONCURRENCY ≈ 15s total.
        for (let batchStart = 0; batchStart < filtered.length; batchStart += DETAIL_CONCURRENCY) {
          if (batchStart > 0) await delay(REQUEST_DELAY_MS);
          const batch = filtered.slice(batchStart, batchStart + DETAIL_CONCURRENCY);

          const results = await Promise.allSettled(
            batch.map(card => scrapeDetailPage(card.detailUrl)),
          );

          for (let j = 0; j < batch.length; j++) {
            const card = batch[j]!;
            const result = results[j]!;
            if (result.status === 'rejected') {
              console.warn(
                `[ceska-filharmonie] Skipping event (detail error): ${card.detailUrl} —`,
                result.reason instanceof Error ? result.reason.message : String(result.reason),
              );
              continue;
            }
            try {
              events.push(mapToEvent(card, result.value));
            } catch (err) {
              console.warn(
                `[ceska-filharmonie] Skipping event (map error): ${card.detailUrl} —`,
                err instanceof Error ? err.message : String(err),
              );
            }
          }
        }

        console.log(`[ceska-filharmonie] Done — ${events.length} events`);
        return events;
      }

      private async scrapeAllListingPages(): Promise<CfCard[]> {
        const cards: CfCard[] = [];
        const seenIds = new Set<string>();

        for (let page = 1; page <= MAX_LISTING_PAGES; page++) {
          if (page > 1) await delay(REQUEST_DELAY_MS);

          let pageCards: CfCard[];
          try {
            pageCards = await scrapeListingPage(page);
          } catch (err) {
            if (page === 1) throw err; // fatal — nothing collected yet
            console.warn(
              `[ceska-filharmonie] Listing page ${page} failed, stopping pagination:`,
              err instanceof Error ? err.message : String(err),
            );
            break;
          }

          if (pageCards.length === 0) break; // clean end-of-listing

          for (const card of pageCards) {
            if (!seenIds.has(card.eventId)) {
              seenIds.add(card.eventId);
              cards.push(card);
            }
          }
        }

        return cards;
      }
    }

    async function scrapeListingPage(page: number): Promise<CfCard[]> {
      const url =
        page === 1
          ? `${BASE_URL}${LISTING_PATH}`
          : `${BASE_URL}${LISTING_PATH}?page=${page}`;

      const html = await fetchHtml(url);
      const $ = load(html);
      const cards: CfCard[] = [];

      // Dedup within the page by eventId — the same event may appear via multiple
      // anchors (image link, title link, ticket link). Keep the first non-empty-title
      // occurrence; subsequent anchors for the same ID are logged and discarded.
      const seenOnPage = new Set<string>();

      $('a[href^="/en/event/"]').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        const title = $(el).text().trim();
        if (!title) return; // skip empty/image-only anchors

        const idMatch = /^\/en\/event\/(\d+)-/.exec(href);
        if (!idMatch) {
          // Log unexpected URL formats so CF URL changes are immediately visible
          console.warn(`[ceska-filharmonie] Skipping link with unexpected URL format: ${href}`);
          return;
        }

        const eventId = idMatch[1]!;
        if (seenOnPage.has(eventId)) return; // duplicate anchor on same page
        seenOnPage.add(eventId);

        const detailUrl = `${BASE_URL}${href}`;

        // Scope to the nearest <li> for card isolation; fall back to parent text.
        // KNOWN_EVENT_TYPES ordered most-specific first to avoid substring false-positives.
        // Unknown types → 'Unknown' (excluded by INCLUDE_EVENT_TYPES) with a warning.
        // VALIDATION: verify against 20+ real listing cards during development.
        const cardText = $(el).closest('li').text() || $(el).parent().text();
        let eventType: string | undefined;
        for (const type of KNOWN_EVENT_TYPES) {
          if (cardText.includes(type)) {
            eventType = type;
            break;
          }
        }
        if (!eventType) {
          console.warn(`[ceska-filharmonie] Unrecognized event type for "${title}" — excluding from pipeline`);
          eventType = 'Unknown';
        }

        cards.push({ eventId, title, detailUrl, eventType });
      });

      return cards;
    }

    async function scrapeDetailPage(url: string): Promise<CfDetail> {
      const html = await fetchHtml(url);
      const $ = load(html);

      // --- JSON-LD: iterate all blocks, pick the one with startDate (the Event block) ---
      // Pages often include BreadcrumbList / WebSite JSON-LD before the Event block;
      // using .first() unconditionally would extract the wrong block.
      let ld: Record<string, unknown> | null = null;
      $('script[type="application/ld+json"]').each((_, el) => {
        if (ld) return; // already found
        try {
          const parsed = JSON.parse($(el).html() ?? '{}') as Record<string, unknown>;
          if (typeof parsed['startDate'] === 'string') {
            ld = parsed;
          }
        } catch { /* skip malformed JSON-LD blocks */ }
      });

      let date = '';
      let venue = '';
      let description = '';

      if (ld) {
        if (typeof ld['startDate'] === 'string') {
          date = ld['startDate'].slice(0, 10); // "2026-03-18T19:30:00" → "2026-03-18"
        }
        if (typeof ld['description'] === 'string') {
          // Strip HTML tags and entities — CF description may contain rich text markup
          description = ld['description']
            .replace(/<[^>]+>/g, ' ')
            .replace(/&[a-z#0-9]+;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        }
        // location can be a Place object or an array of Place objects
        const loc = ld['location'];
        const locObj = Array.isArray(loc) ? (loc[0] as Record<string, unknown>) : (loc as Record<string, unknown> | undefined);
        if (typeof locObj?.['name'] === 'string') {
          venue = locObj['name'];
        }
      }

      // --- Full performers from <h2>Performers</h2> section ---
      // Structure: <strong>Name</strong> [whitespace text node] <em>role</em>
      // Raw DOM traversal handles whitespace nodes; isTag() guard narrows AnyNode to Element.
      const performers: string[] = [];
      const perfH2 = $('h2')
        .filter((_, el) => $(el).text().trim() === 'Performers')
        .first();

      if (perfH2.length) {
        let currentName: string | null = null;
        let node: AnyNode | null = (perfH2[0] as Element).next ?? null;
        while (node) {
          if (isTag(node)) {
            if (node.name === 'h2') break;
            if (node.name === 'strong') {
              if (currentName !== null) performers.push(currentName); // flush (no role found)
              currentName = $(node).text().trim() || null;
            } else if (node.name === 'em' && currentName !== null) {
              const role = $(node).text().trim();
              performers.push(role ? `${currentName} (${role})` : currentName);
              currentName = null;
            }
          }
          node = node.next ?? null;
        }
        if (currentName !== null) performers.push(currentName); // flush last

        if (performers.length === 0) {
          // Warn if the section exists but yielded nothing — signals HTML structure change
          console.warn(`[ceska-filharmonie] No performers extracted from ${url} — verify HTML structure`);
        }
      }

      // --- Composers from <h2>Programme</h2> section ---
      // Structure: <strong>Composer Name</strong> + text node work title [+ intermission marker]
      // Only <strong> elements are collected; text nodes (work titles) and intermissions are ignored.
      // Note: uses `progNode` (not `node`) to avoid redeclaring the variable from the Performers block.
      const composers: string[] = [];
      const progH2 = $('h2')
        .filter((_, el) => $(el).text().trim() === 'Programme')
        .first();

      if (progH2.length) {
        let progNode: AnyNode | null = (progH2[0] as Element).next ?? null;
        while (progNode) {
          if (isTag(progNode)) {
            if (progNode.name === 'h2') break;
            if (progNode.name === 'strong') {
              const composer = $(progNode).text().trim();
              if (composer && !composers.includes(composer)) {
                composers.push(composer);
              }
            }
          }
          progNode = progNode.next ?? null;
        }

        if (composers.length === 0) {
          // Warn if the section exists but yielded nothing — signals HTML structure change
          console.warn(`[ceska-filharmonie] No composers extracted from ${url} — verify HTML structure`);
        }
      }

      return { date, venue, description, performers, composers };
    }

    function mapToEvent(card: CfCard, detail: CfDetail): Event {
      if (!detail.date) {
        throw new Error(`No date found in JSON-LD for: ${card.detailUrl}`);
      }
      return {
        title: card.title,
        venue: detail.venue || 'Česká filharmonie',
        date: detail.date,
        url: card.detailUrl,
        sourceId: 'ceska-filharmonie',
        ...(detail.performers.length > 0 ? { performers: detail.performers } : {}),
        ...(detail.composers.length > 0 ? { composers: detail.composers } : {}),
        ...(detail.description ? { description: detail.description } : {}),
      };
    }

    async function fetchHtml(url: string): Promise<string> {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; show-recommender-bot/1.0)' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
      return res.text();
    }

    function delay(ms: number): Promise<void> {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
    ```

  - Notes:
    - **Event type detection** uses `$(el).closest('li').text()` for card-scoped isolation. If no `<li>` ancestor exists (flat markup), falls back to `$(el).parent().text()`. Validate against 20+ real listing cards during development — if results are incorrect, inspect the actual card container HTML and adjust the selector.
    - **JSON-LD block selection**: iterates all blocks and picks the first one containing `startDate`. If no event block is found, `date` remains `''` and `mapToEvent` throws → event is skipped with a warning.
    - **`location` handling**: covers both object and array-form `Place` values. Array form uses `loc[0]` — if needed, a future revision could scan all locations.
    - **Batch parallel**: `Promise.allSettled` ensures one failing detail page does not cancel others in the same batch. The outer `for` loop provides the 250ms inter-batch delay.
    - **`isTag` type guard**: imported `Element` from `'cheerio'` — the same package that provides `AnyNode`. `node.type === 'tag'` is the discriminant; the guard makes this TypeScript-safe without any `as any` casts.
    - **Performer HTML structure**: the spike documents `<strong>Name</strong> <em>role</em>` as direct siblings. The traversal handles whitespace text nodes between them. If performers are wrapped in intermediate elements (`<p>`, `<li>`), the traversal will yield zero results and log a warning — the warning is the signal to revisit the selector.
    - **Description HTML**: simple tag + entity stripping sufficient for LLM consumption. Does not need a full HTML parser — the description is short prose with at most basic markup.

---

- [ ] **Task 4: Register source in `src/event-pipeline/index.ts`**
  - File: `src/event-pipeline/index.ts`
  - Action: Import `CeskaFilharmonieSource` and add it to the sources array. No new env vars needed.

    Add import:
    ```typescript
    import { CeskaFilharmonieSource } from './event-sources/ceska-filharmonie.js';
    ```

    Change sources array from:
    ```typescript
    sources: [new TicketmasterSource(ticketmasterApiKey)],
    ```
    To:
    ```typescript
    sources: [
      new TicketmasterSource(ticketmasterApiKey),
      new CeskaFilharmonieSource(),
    ],
    ```

  - Notes: `CeskaFilharmonieSource` takes no constructor arguments. No CDK context variable changes needed.

---

### Acceptance Criteria

- [ ] **AC1 — TypeScript compiles clean**
  - Given: all tasks complete
  - When: `tsc --noEmit` is run from repo root
  - Then: exits 0 with no type errors

- [ ] **AC2 — Source implements EventSource contract**
  - Given: `CeskaFilharmonieSource` is instantiated
  - When: type-checked against `EventSource`
  - Then: `source.id === 'ceska-filharmonie'` and `source.fetch` is callable returning `Promise<Event[]>`

- [ ] **AC3 — Listing scraper returns non-empty results**
  - Given: network access to `ceskafilharmonie.cz`
  - When: `new CeskaFilharmonieSource().fetch()` is called
  - Then: returns at least 10 events, each with non-empty `title`, `date` matching `/^\d{4}-\d{2}-\d{2}$/`, `url` starting with `https://www.ceskafilharmonie.cz/en/event/`, non-empty `venue`, `sourceId === 'ceska-filharmonie'`

- [ ] **AC4 — Workshop events are excluded**
  - Given: CF listing includes Workshop events (e.g. titles containing "100 Minutes", "workshop", "education")
  - When: `fetch()` completes
  - Then: no returned event has a `url` containing a slug that corresponds to a known workshop event on the live listing (manual spot-check against 5+ workshop titles)

- [ ] **AC5 — Performers extracted with roles**
  - Given: a concert event featuring named soloists (any current event on the CF listing with a soloist)
  - When: that event is returned by `fetch()`
  - Then: `event.performers` is a non-empty array; at least one entry matches `"Name (role)"` format (e.g. contains `" (cello)"`, `" (conductor)"`, `" (violin)"` etc.)

- [ ] **AC6 — Composers extracted from programme section**
  - Given: a concert event with a known programme (any current event showing composer surnames on the CF listing)
  - When: that event is returned by `fetch()`
  - Then: `event.composers` is a non-empty array containing the expected composer name(s)

- [ ] **AC7 — ISO date format correct**
  - Given: any returned event
  - When: `event.date` is inspected
  - Then: matches `/^\d{4}-\d{2}-\d{2}$/` and is a valid calendar date (not `'2026-00-00'` or similar)

- [ ] **AC8 — Per-event detail failure is non-fatal**
  - Given: one event in the filtered list has a detail URL that returns HTTP 404
  - When: `fetch()` completes
  - Then: all other events are returned successfully; a `[ceska-filharmonie] Skipping event` warning is logged; `fetch()` does not throw

- [ ] **AC9 — Pagination fetches all events**
  - Given: CF listing has ~68 events across ~4 pages at time of development
  - When: `fetch()` completes
  - Then: raw card count logged before type filter is at least 50 (confirms pagination beyond page 1)

- [ ] **AC10 — Listing page 2+ failure is non-fatal**
  - Given: listing page 1 succeeds (returns cards), listing page 2 returns HTTP 500
  - When: `fetch()` completes
  - Then: events from page 1 are returned; a `[ceska-filharmonie] Listing page 2 failed` warning is logged; `fetch()` does not throw

- [ ] **AC11 — Batch parallel completes within source timeout**
  - Given: CF listing has ~50 concerts after type filter, `SOURCE_TIMEOUT_MS` raised to 90s
  - When: `fetch()` is timed end-to-end
  - Then: completes in under 30s on a normal network connection (validates batch-parallel is working, not sequential)

- [ ] **AC12 — Registered in pipeline**
  - Given: `index.ts` updated per Task 4
  - When: `tsc --noEmit` is run
  - Then: no errors; `CeskaFilharmonieSource` is present in the sources array (verify by inspection)

- [ ] **AC13 — Timeouts updated**
  - Given: Tasks 2 complete
  - When: `fetch-events.ts` and `lib/recommender-app-stack.ts` are inspected
  - Then: `SOURCE_TIMEOUT_MS === 90_000` and Lambda timeout is `cdk.Duration.seconds(180)`

---

## Additional Context

### Dependencies

- `cheerio@1.2.0` — HTML parsing. Add to `dependencies` for Lambda bundling. Ships own TypeScript types.
- Node.js 20 built-in `fetch` — all HTTP. No `node-fetch` needed.
- `@types/node@24` (already installed) — provides `fetch` and `AbortSignal.timeout` globals.
- All other deps already installed (`@aws-sdk/client-s3`, `@aws-sdk/client-ses`, `openai`).

### Testing Strategy

Integration-style testing for the scraper (network required). No CI-blocking tests for this POC:
- **Smoke test**: run `new CeskaFilharmonieSource().fetch()` and log counts + sample event — verifies all ACs except AC8/AC10/AC11
- **AC8/AC10**: manually test by temporarily patching a URL to an invalid one in a local test script
- **AC11**: time the `fetch()` call end-to-end during development
- Unit tests for `mapToEvent` (pure function) and `scrapeDetailPage` (accepts HTML fixture) may be added as follow-up in `test/event-pipeline/event-sources/ceska-filharmonie.test.ts`

### Notes

- **No API key needed.** Plain HTTP GET; no auth, no CORS issues for server-side requests.
- **Event type detection.** `$(el).closest('li')` is the preferred scope. If CF does not use `<li>` wrappers for cards (flat structure), the fallback to `$(el).parent()` scopes to the immediate parent — narrower than grandparent, safer than the full listing container. Validate both paths on the live HTML during implementation.
- **Performer/composer HTML structure.** The spike documents `<strong>Name</strong> <em>role</em>` as direct children of the section. The traversal handles interleaved whitespace text nodes. If performers or composers are wrapped in additional elements, the empty-array warning will fire and the structure needs to be re-examined.
- **Description HTML.** The regex stripping is sufficient for LLM context. If CF ever uses heavily formatted descriptions, a more thorough sanitizer (e.g. `htmlparser2`) can be added, but this is out of scope for the POC.
- **Dedup with Rudolfinum.** CF events also appear on rudolfinum.cz. When the Rudolfinum scraper is added, the pipeline hash-dedup keeps the CF record (CF is higher priority and scraped first — first occurrence wins).
- **Season-end behavior.** As the concert season ends, the CF listing shrinks. The pagination logic handles this gracefully — it stops on an empty page, not on a page-size heuristic.
- **Future timeout scaling.** With all 5 Czech scrapers running in parallel (each ~15s), the total pipeline runtime is still ~15s. The 90s source timeout and 180s Lambda timeout provide ample headroom for all planned sources plus pipeline overhead (S3 reads, OpenAI call, SES send).
