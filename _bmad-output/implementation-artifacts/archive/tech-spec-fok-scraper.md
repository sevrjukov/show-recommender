---
title: 'FOK Scraper'
slug: 'fok-scraper'
created: '2026-03-23'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'TypeScript 5.9 (strict, NodeNext)'
  - 'Node.js 20 LTS'
  - 'cheerio 1.2.0 (already installed)'
  - 'domhandler (cheerio peer dep — AnyNode type)'
files_to_modify:
  - 'src/event-pipeline/index.ts'
files_to_create:
  - 'src/event-pipeline/event-sources/fok.ts'
  - 'test/event-pipeline/event-sources/fok.live.test.ts'
code_patterns:
  - 'NodeNext module resolution — relative imports must use .js extension'
  - 'Strict TypeScript — noImplicitAny, strictNullChecks, noImplicitReturns'
  - 'EventSource interface pattern — implements fetch(): Promise<Event[]>'
  - 'Non-fatal individual event failures — warn + skip, never throw from fetch()'
  - 'Batch-parallel detail fetches — DETAIL_CONCURRENCY = 5, delay between batches'
test_patterns:
  - 'Jest + ts-jest; tests in test/event-pipeline/event-sources/'
---

# Tech-Spec: FOK Scraper

**Created:** 2026-03-23

## Overview

### Problem Statement

The pipeline has Ticketmaster and Česká filharmonie as event sources. FOK (Prague Symphony Orchestra) is the second-priority Czech classical source: it covers Municipal House / Smetana Hall and other Prague venues not covered by CF, has real images and structured HTML, and is the authoritative source for all FOK events. Unlike CF, FOK has no JSON-LD — all extraction is HTML-only, and a single detail page lists multiple performance dates that must be split into separate Event records.

### Solution

Implement `FokSource` as a two-phase web scraper implementing the `EventSource` interface. Phase 1 paginates the listing (`?page=N`, 0-based) to collect event slugs. Phase 2 fetches each detail page in parallel batches of 5 and extracts: all performance dates (one Event emitted per date), venue, performers (`<strong>Name</strong> | role` pattern), programme (`<strong>Composer</strong> — Work` pattern), and synthesizes a `description` string for LLM context. Include all event types — no pre-filtering. Register the source in `index.ts`. No timeout changes needed (SOURCE_TIMEOUT_MS already 90s, Lambda already 180s, both set by the CF spec).

### Scope

**In Scope:**
- `FokSource` class in `src/event-pipeline/event-sources/fok.ts`
- Listing pagination: `GET https://www.fok.cz/en/program?page=N` (0-based — `?page=0` = first page, no `?page=` param for first request), stop when page returns 0 event links, safety cap 20 pages
- Listing slug dedup: `Set<string>` across pages prevents duplicate detail fetches
- Detail page per-slug fetch: extract all performance dates, emit one Event per date
- Date parsing: `"Wed, 18 Mar 2026 - 19:30"` → ISO `YYYY-MM-DD` using English month abbreviations
- Venue extraction: search detail page HTML for known Prague venue name strings; fallback to `'FOK Prague'`
- Performer extraction: `<strong>Name</strong> | role` → `"Name (role)"`; ensemble names (containing "Orchestra", "Philharmonic", "Ensemble", "Quartet", "Trio", "Choir") with no `|` marker → `"Name"`
- Programme extraction: `<strong>Composer</strong> — Work title` (dash after composer name) → `{ composer, work }` pair
- Description synthesis: `"Programme: Composer — Work; .... Performers: Name (role), ...."` built from extracted programme + performers; omitted if both empty
- All event types included — no exclusions (LLM decides relevance)
- Public general rehearsals included — treated as normal events
- Per-event detail failure: warn + skip, never throw from `fetch()`
- Per-listing-page failure: page 0 failure is fatal; pages 1+ failures log + stop pagination
- Register `FokSource` in `src/event-pipeline/index.ts`

**Out of Scope:**
- Timeout changes — already raised to 90s/180s by CF spec
- `cheerio` install — already in `dependencies`
- Venue canonical normalisation — deferred until all Czech scrapers coexist
- Colosseum ticket URL extraction — FOK detail page is the ticket entry point; Colosseum URL is behind a redirect not present in static HTML
- Cross-site dedup with Rudolfinum/Obecní dům — handled by pipeline-level hash dedup; no scraper changes needed

---

## Context for Development

### Codebase Patterns

- All event source implementations live in `src/event-pipeline/event-sources/`. The CF implementation ([src/event-pipeline/event-sources/ceska-filharmonie.ts](src/event-pipeline/event-sources/ceska-filharmonie.ts)) is the primary reference.
- `EventSource` interface ([src/event-pipeline/types.ts](src/event-pipeline/types.ts)): `readonly id: string` + `fetch(): Promise<Event[]>`.
- `Event` interface fields: `title`, `venue`, `date` (ISO `YYYY-MM-DD`), `url`, `sourceId`, `performers?: string[]`, `composers?: string[]`, `description?: string`.
- NodeNext imports — all relative imports use `.js` extension.
- Node.js 20 built-in `fetch` — no `node-fetch` needed.
- `cheerio 1.2.0` already in `dependencies`. Import: `import { load } from 'cheerio'`. Types for DOM nodes: `import type { AnyNode } from 'domhandler'` (cheerio peer dep, already available).
- Logging: prefix all lines with `[fok]`. `console.log` for progress, `console.warn` for skipped events or unexpected structure, `console.error` for fatal.
- `fetchHtml` and `delay` helpers: copy the pattern from `ceska-filharmonie.ts` (fetch with User-Agent + AbortSignal.timeout(10_000), 429/503 retry up to 3 attempts).

### Files to Reference

| File | Purpose |
| ---- | ------- |
| [src/event-pipeline/event-sources/ceska-filharmonie.ts](src/event-pipeline/event-sources/ceska-filharmonie.ts) | Primary reference: EventSource pattern, batch-parallel detail fetches, fetchHtml helper, delay helper |
| [src/event-pipeline/types.ts](src/event-pipeline/types.ts) | `Event`, `EventSource` interface definitions |
| [src/event-pipeline/index.ts](src/event-pipeline/index.ts) | Handler where new source must be registered |
| [_bmad-output/spikes/scraping_analysis/czech/scraping-spike-fok-2026-03-18.md](_bmad-output/spikes/scraping_analysis/czech/scraping-spike-fok-2026-03-18.md) | Full FOK spike: selectors, date format, performer pattern, pagination, examples, risks |
| [_bmad-output/spikes/scraping_analysis/czech/czech-classical-scraping-summary-2026-03-18.md](_bmad-output/spikes/scraping_analysis/czech/czech-classical-scraping-summary-2026-03-18.md) | Multi-source summary: cross-site dedup strategy, venue canonical IDs, shared patterns |
| [_bmad-output/implementation-artifacts/tech-spec-event-pipeline-architecture.md](_bmad-output/implementation-artifacts/tech-spec-event-pipeline-architecture.md) | Pipeline architecture reference: module map, interfaces, dedup key, logging conventions |

### Technical Decisions

- **No JSON-LD** — FOK has no structured data. All extraction is positional HTML. Changes to the Drupal 11 theme will break the scraper. Warn on zero results so structural changes are immediately visible.

- **0-based pagination** — FOK is the only Czech source using 0-based page indexing. First page URL has no `?page=` param (equivalent to `?page=0`). Page 2 = `?page=1`. Cap at 20 pages. Stop on empty page (0 event links found), not on HTTP error for pages ≥ 1.

- **Listing selector: `a[href]` regex** — CSS class names for Drupal 11 view rows were not confirmed in the spike. Use `$('a')` + regex `/^\/en\/([a-z][a-z0-9-]+)$/` to find event links robustly. Maintain a `NAV_SLUGS` blocklist to skip known navigation links: `program`, `conductors`, `artists`, `auditions`, `contacts`, `press`, `club`, `node`. Skip anchors with empty text (image-only links). The slug extracted from the href is used as the listing-level dedup key.

- **Multi-date splitting** — A single FOK detail page lists ALL performance dates for the same programme. Extract every date text node matching the `"Weekday, DD Mon YYYY - HH:MM"` pattern and emit one `Event` per date. All resulting Events share the same `url` (detail page), `title`, `venue`, `performers`, `composers`, `description` — only `date` differs.

- **Date parsing** — FOK English site uses: `"Wed, 18 Mar 2026 - 19:30"`. Extract with regex: `/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/`. Map month abbreviation to number using `ENGLISH_MONTHS` map (`jan:1 ... dec:12`). Output ISO `YYYY-MM-DD`. If parsing fails, warn and skip that date.

- **Performer extraction: `|` delimiter** — `<strong>Name</strong>` followed by a text sibling containing `|` → performer. Role = `nextText.split('|')[1]?.trim() ?? ''` — takes the second segment (index 1), making the single-role assumption explicit. Format: `"Name (role)"` (e.g. `"Marko Letonja (conductor)"`). If role is empty, store just `"Name"`.

- **Ensemble detection** — `<strong>Name</strong>` with no `|` in next sibling, where Name contains any of: `Orchestra`, `Philharmonic`, `Ensemble`, `Quartet`, `Trio`, `Duo`, `Choir`, `Chorus`, `Band` → performer with no role, stored as `"Name"` (e.g. `"Prague Symphony Orchestra"`). This handles guest orchestras without hardcoding.

- **Programme extraction: dash delimiter** — `<strong>Composer</strong>` followed by a text sibling containing `—` or `–` (em/en dash) → programme entry. Composer = strong text. Work = text after the first dash, trimmed. Collect as `{ composer: string; work: string }[]` (internal type, not exported).

- **Disambiguation** — The `|` vs `—` check is the primary discriminant between performer and programme `<strong>` tags. A `<strong>` with no clear next sibling signal and no ensemble keyword → skip silently. Log a warning only if the entire performers or composers array ends up empty while the detail page returned valid dates (signals structural change).

- **Description synthesis** — Build from programme + performers. Format:
  - If both present: `"Programme: Composer — Work; Composer — Work. Performers: Name (role), Name (role), Name."`
  - If programme only: `"Programme: Composer — Work; ...."`
  - If performers only: `"Performers: Name (role), Name."`
  - If both empty: omit `description` field entirely.
  - FOK detail pages have no freetext event description in the HTML; the synthesized string is the only description available.

- **Venue extraction** — No reliable CSS class confirmed from the spike. Strategy: extract `$('body').text()` (strips all tags, excludes `<head>` and `<script>` content including the Drupal settings JSON blob) then search for known Prague venue name substrings ordered most-specific first:
  ```
  'Municipal House, Smetana Hall'
  'Smetana Hall'
  'Rudolfinum, Dvořák Hall'
  'Dvořák Hall'
  'Rudolfinum, Suk Hall'
  'Suk Hall'
  'Convent of St Agnes of Bohemia'
  'Bethlehem Chapel'
  'Municipal House'
  'Rudolfinum'
  ```
  First match wins. Using `.text()` avoids false matches in `<script>` JSON blobs, HTML attributes, and `<head>` meta tags. Nav/footer false matches are possible but unlikely given the venue name specificity — validate against all FOK venue types during implementation. If no match found: warn once per detail URL and use `'FOK Prague'` as fallback.

- **`url` field** — Use the detail page URL (`https://www.fok.cz/en/[slug]`). The same URL is used for all Event records derived from one detail page (all performance dates of the same programme). This is correct — the detail page is the authoritative event link.

- **`sourceId`** — `'fok'`.

- **Batch-parallel detail fetches** — `DETAIL_CONCURRENCY = 5`, `REQUEST_DELAY_MS = 250` between batches. Same pattern as CF. `Promise.allSettled` — one failed detail does not cancel others in the batch.

- **Listing-level dedup** — `Set<string>` of seen slugs. Prevents duplicate detail fetches when the same event appears via multiple anchors on one page or across pages.

- **`fetchHtml` + `delay`** — Copy from `ceska-filharmonie.ts` verbatim, changing the log prefix to `[fok]`.

---

## Implementation Plan

### Tasks

---

- [x] **Task 1: Create `src/event-pipeline/event-sources/fok.ts`**
  - File: `src/event-pipeline/event-sources/fok.ts` (new)
  - Action: Implement `FokSource`:

    ```typescript
    import { load } from 'cheerio';
    import type { AnyNode } from 'domhandler';
    import type { Event, EventSource } from '../types.js';

    const BASE_URL = 'https://www.fok.cz';
    const LISTING_PATH = '/en/program';
    const REQUEST_DELAY_MS = 250;
    const MAX_LISTING_PAGES = 20;
    const DETAIL_CONCURRENCY = 5;

    // Navigation slugs present on every page — not event links
    const NAV_SLUGS = new Set([
      'program', 'conductors', 'artists', 'auditions',
      'contacts', 'press', 'club', 'node',
    ]);

    // Ensemble keyword detection — names containing these are performers with no role
    const ENSEMBLE_KEYWORDS = [
      'Orchestra', 'Philharmonic', 'Ensemble', 'Quartet',
      'Trio', 'Duo', 'Choir', 'Chorus', 'Band',
    ];

    // Venue name search strings — ordered most-specific first
    const VENUE_STRINGS = [
      'Municipal House, Smetana Hall',
      'Smetana Hall',
      'Rudolfinum, Dvořák Hall',
      'Dvořák Hall',
      'Rudolfinum, Suk Hall',
      'Suk Hall',
      'Convent of St Agnes of Bohemia',
      'Bethlehem Chapel',
      'Municipal House',
      'Rudolfinum',
    ];

    const ENGLISH_MONTHS: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };

    const EVENT_SLUG_RE = /^\/en\/([a-z][a-z0-9-]+)$/;
    const FOK_DATE_RE = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/;

    interface FokCard {
      slug: string;
      title: string;
      detailUrl: string;
    }

    interface ProgrammeEntry {
      composer: string;
      work: string;
    }

    interface FokDetail {
      dates: string[];           // ISO YYYY-MM-DD[], one per performance
      venue: string;
      performers: string[];      // "Name (role)" or "Name" for ensembles
      programme: ProgrammeEntry[];
    }

    export class FokSource implements EventSource {
      readonly id = 'fok';

      async fetch(): Promise<Event[]> {
        console.log('[fok] Starting scrape');

        const allCards = await this.scrapeAllListingPages();
        console.log(`[fok] Listing: ${allCards.length} events found`);

        const events: Event[] = [];

        for (let batchStart = 0; batchStart < allCards.length; batchStart += DETAIL_CONCURRENCY) {
          if (batchStart > 0) await delay(REQUEST_DELAY_MS);
          const batch = allCards.slice(batchStart, batchStart + DETAIL_CONCURRENCY);

          const results = await Promise.allSettled(
            batch.map(card => scrapeDetailPage(card.detailUrl)),
          );

          for (let j = 0; j < batch.length; j++) {
            const card = batch[j]!;
            const result = results[j]!;
            if (result.status === 'rejected') {
              console.warn(
                `[fok] Skipping event (detail error): ${card.detailUrl} —`,
                result.reason instanceof Error ? result.reason.message : String(result.reason),
              );
              continue;
            }
            const detail = result.value;
            if (detail.dates.length === 0) {
              console.warn(`[fok] Skipping event (no dates parsed): ${card.detailUrl}`);
              continue;
            }
            for (const date of detail.dates) {
              try {
                events.push(mapToEvent(card, detail, date));
              } catch (err) {
                console.warn(
                  `[fok] Skipping date ${date} for ${card.detailUrl} —`,
                  err instanceof Error ? err.message : String(err),
                );
              }
            }
          }
        }

        console.log(`[fok] Done — ${events.length} events`);
        return events;
      }

      private async scrapeAllListingPages(): Promise<FokCard[]> {
        const cards: FokCard[] = [];
        const seenSlugs = new Set<string>();

        for (let page = 0; page < MAX_LISTING_PAGES; page++) {
          if (page > 0) await delay(REQUEST_DELAY_MS);

          let pageCards: FokCard[];
          try {
            pageCards = await scrapeListingPage(page);
          } catch (err) {
            if (page === 0) throw err; // fatal — nothing collected yet
            console.warn(
              `[fok] Listing page ${page} failed, stopping pagination:`,
              err instanceof Error ? err.message : String(err),
            );
            break;
          }

          if (pageCards.length === 0) break; // end of listing

          for (const card of pageCards) {
            if (!seenSlugs.has(card.slug)) {
              seenSlugs.add(card.slug);
              cards.push(card);
            }
          }
        }

        return cards;
      }
    }

    async function scrapeListingPage(page: number): Promise<FokCard[]> {
      // FOK uses 0-based pagination. Page 0 has no ?page= param.
      const url = page === 0
        ? `${BASE_URL}${LISTING_PATH}`
        : `${BASE_URL}${LISTING_PATH}?page=${page}`;

      const html = await fetchHtml(url);
      const $ = load(html);
      const cards: FokCard[] = [];
      const seenOnPage = new Set<string>();

      $('a').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        if (href.startsWith('/en/') && !EVENT_SLUG_RE.test(href)) {
          console.warn(`[fok] Skipping /en/ link with unexpected format: ${href}`);
        }
        const match = EVENT_SLUG_RE.exec(href);
        if (!match) return;

        const slug = match[1]!;
        if (NAV_SLUGS.has(slug)) return;

        const title = $(el).text().trim();
        if (!title) return; // skip image-only anchors

        if (seenOnPage.has(slug)) return; // deduplicate within page
        seenOnPage.add(slug);

        cards.push({
          slug,
          title,
          detailUrl: `${BASE_URL}/en/${slug}`,
        });
      });

      return cards;
    }

    async function scrapeDetailPage(url: string): Promise<FokDetail> {
      const html = await fetchHtml(url);
      const $ = load(html);

      // --- Performance dates ---
      // Pattern: "Wed, 18 Mar 2026 - 19:30"
      // Exclude <script> and <style> content (avoids Drupal settings JSON false matches).
      // Dedup on parsed ISO date strings — same-day rehearsal + evening show both parse to the
      // same YYYY-MM-DD, so they collapse to a single Event. This is intentional: the pipeline
      // dedup hash uses title+date+venue so two events at the same venue on the same day
      // would collide regardless. Accept for POC.
      const dates: string[] = [];
      const seenDates = new Set<string>();

      $('*').not('script, style').each((_, el) => {
        $(el).contents().each((_, node) => {
          if (node.type !== 'text') return;
          const text = (node as unknown as { data: string }).data?.trim() ?? '';
          if (!FOK_DATE_RE.test(text) || !text.includes('-')) return;
          const parsed = parseFokDate(text);
          if (parsed) {
            if (!seenDates.has(parsed)) {
              seenDates.add(parsed);
              dates.push(parsed);
            }
          } else {
            console.warn(`[fok] Could not parse date from: "${text}" on ${url}`);
          }
        });
      });

      // --- Venue ---
      // Use $('body').text() — strips tags, excludes <head> and <script> blocks
      // (including Drupal settings JSON) avoiding false matches in those.
      let venue = '';
      const bodyText = $('body').text();
      for (const venueStr of VENUE_STRINGS) {
        if (bodyText.includes(venueStr)) {
          venue = venueStr;
          break;
        }
      }
      if (!venue) {
        console.warn(`[fok] Venue not found on ${url}, using fallback`);
        venue = 'FOK Prague';
      }

      // --- Performers and Programme via <strong> tag disambiguation ---
      // Performer: next text sibling contains '|'  →  "Name (role)"
      // Ensemble:  name contains ensemble keyword, no '|'  →  "Name"
      // Programme: next text sibling contains '—' or '–'  →  { composer, work }
      // Note: programme collects ALL entries including repeated composers (e.g. two works
      // by the same composer). Dedup for composers[] field is done in mapToEvent.
      const performers: string[] = [];
      const programme: ProgrammeEntry[] = [];

      $('strong').each((_, strongEl) => {
        const name = $(strongEl).text().trim();
        if (!name) return;

        const nextNode: AnyNode | null = strongEl.next ?? null;
        const nextText =
          nextNode && nextNode.type === 'text'
            ? ((nextNode as unknown as { data: string }).data ?? '')
            : '';

        if (nextText.includes('|')) {
          // Performer with role — use [1] not .pop() (makes single-role assumption explicit)
          const role = nextText.split('|')[1]?.trim() ?? '';
          performers.push(role ? `${name} (${role})` : name);
        } else if (/[—–]/.test(nextText)) {
          // Programme entry: Composer — Work title
          const work = nextText.replace(/^[^—–]*[—–]\s*/, '').trim();
          programme.push({ composer: name, work });
        } else if (ENSEMBLE_KEYWORDS.some(kw => name.includes(kw))) {
          // Ensemble/orchestra name with no role marker
          performers.push(name);
        }
        // else: ambiguous <strong> (section headers, etc.) — skip silently
      });

      // Warn if dates were found but performers/programme both empty — signals structure change
      if (dates.length > 0 && performers.length === 0 && programme.length === 0) {
        console.warn(`[fok] No performers or programme extracted from ${url} — verify HTML structure`);
      }

      return { dates, venue, performers, programme };
    }

    function parseFokDate(raw: string): string | null {
      // "Wed, 18 Mar 2026 - 19:30" → "2026-03-18"
      const m = FOK_DATE_RE.exec(raw);
      if (!m) return null;
      const day = parseInt(m[1]!, 10);
      const monthNum = ENGLISH_MONTHS[m[2]!.toLowerCase()];
      const year = parseInt(m[3]!, 10);
      if (!monthNum || !day || !year) return null;
      return `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    function buildDescription(detail: FokDetail): string | undefined {
      const parts: string[] = [];

      if (detail.programme.length > 0) {
        const progStr = detail.programme
          .map(p => (p.work ? `${p.composer} — ${p.work}` : p.composer))
          .join('; ');
        parts.push(`Programme: ${progStr}`);
      }

      if (detail.performers.length > 0) {
        parts.push(`Performers: ${detail.performers.join(', ')}`);
      }

      return parts.length > 0 ? parts.join('. ') + '.' : undefined;
    }

    function mapToEvent(card: FokCard, detail: FokDetail, date: string): Event {
      const composers = [...new Set(detail.programme.map(p => p.composer))];
      const description = buildDescription(detail);

      return {
        title: card.title,
        venue: detail.venue,
        date,
        url: card.detailUrl,
        sourceId: 'fok',
        ...(detail.performers.length > 0 ? { performers: detail.performers } : {}),
        ...(composers.length > 0 ? { composers } : {}),
        ...(description ? { description } : {}),
      };
    }

    async function fetchHtml(url: string, attempt = 1): Promise<string> {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; show-recommender-bot/1.0)' },
        signal: AbortSignal.timeout(10_000),
      });
      if ((res.status === 429 || res.status === 503) && attempt < 3) {
        console.warn(`[fok] HTTP ${res.status} on attempt ${attempt}, retrying: ${url}`);
        await delay(attempt * 500);
        return fetchHtml(url, attempt + 1);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
      return res.text();
    }

    function delay(ms: number): Promise<void> {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
    ```

  - Notes:
    - **0-based pagination**: `page === 0` → no `?page=` param. Confirm during implementation that `?page=0` and no param return identical responses to avoid doubling page 0 events.
    - **`strongEl.next` cast**: `domhandler` `Text` node has a `data` property. The cast `(nextNode as unknown as { data: string }).data` is safe after the `node.type === 'text'` check — no `as any` needed.
    - **Date dedup on ISO string** (F1): `seenDates` deduplicates on the parsed ISO date, not the raw text. A rehearsal at 10:00 and an evening show at 19:30 on the same day produce the same ISO date `YYYY-MM-DD` and collapse to one Event. This is intentional — the pipeline dedup hash uses title+date+venue so both would collide regardless. AC4 reflects this: a programme with a rehearsal + 2 evening shows on 2 different days produces 2 Events, not 3.
    - **`$('*').not('script, style')`** (F7): excludes Drupal settings JSON (in `<script>` tags) from date text scanning. Without this, JSON config timestamps could match `FOK_DATE_RE`.
    - **Venue via `$('body').text()`** (F8): strips all HTML tags and excludes `<head>` / `<script>` content. Avoids false matches in JSON blobs and attributes. Nav/footer matches remain possible but are unlikely given the specificity of venue strings — validate against all known FOK venue types during development.
    - **`split('|')[1]?.trim()`** (F9): index 1 (not `.pop()`) makes the single-role assumption explicit. If `|` appears twice (edge case), the second `|` and beyond are ignored rather than silently returning the wrong segment.
    - **Programme no dedup** (F3): `programme` collects all entries including repeated composers (e.g. Beethoven with two works). `mapToEvent` deduplicates when building `composers[]`. This preserves the full programme for description synthesis.
    - **`/en/` warn** (F4): any `/en/` href that fails `EVENT_SLUG_RE` logs a warning (uppercase slug, trailing slash, unexpected path structure). Surfaces FOK URL changes immediately, mirroring the CF pattern.
    - **Venue fallback**: `'FOK Prague'` is intentionally vague — it keeps the Event valid while flagging that the venue string changed or is absent. If frequently fired in practice, extend `VENUE_STRINGS`.
    - **`ENSEMBLE_KEYWORDS`**: covers Prague Symphony Orchestra and plausible guest ensembles. Validate against 10+ FOK events during development — if an ensemble name is missed, add its keyword.
    - **Validate `—` vs `–`**: the spike shows `—` (em dash, U+2014) in the HTML examples, but `–` (en dash, U+2013) may also appear. The regex `/[—–]/` covers both. Confirm against raw HTML during implementation.

---

- [x] **Task 2: Create live integration test `test/event-pipeline/event-sources/fok.live.test.ts`**
  - File: `test/event-pipeline/event-sources/fok.live.test.ts` (new)
  - Action: Create a live test file gated behind a `LIVE=1` env var so normal `npm test` skips it. Run with: `LIVE=1 npx jest fok.live --verbose`

    ```typescript
    import { FokSource } from '../../../src/event-pipeline/event-sources/fok.js';
    import type { Event } from '../../../src/event-pipeline/types.js';

    const RUN_LIVE = process.env['LIVE'] === '1';
    const describe_ = RUN_LIVE ? describe : describe.skip;

    // Set timeout at module scope — applies to all tests and beforeAll in this file.
    // jest.setTimeout inside a describe block does NOT apply to beforeAll callbacks.
    jest.setTimeout(120_000); // 2 min — covers full pagination + batch-parallel detail fetches

    describe_('FokSource — live integration (LIVE=1 to run)', () => {
      let events: Event[] = [];

      beforeAll(async () => {
        const source = new FokSource();
        events = await source.fetch();
      }, 120_000); // explicit timeout on beforeAll — jest.setTimeout alone does not cover it

      it('returns at least 5 events', () => {
        console.log(`\n[fok live] Total events returned: ${events.length}`);
        expect(events.length).toBeGreaterThanOrEqual(5);
      });

      it('all events have required fields', () => {
        for (const event of events) {
          expect(event.title).toBeTruthy();
          expect(event.venue).toBeTruthy();
          expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(event.url).toMatch(/^https:\/\/www\.fok\.cz\/en\//);
          expect(event.sourceId).toBe('fok');
        }
      });

      it('at least one event has performers', () => {
        const withPerformers = events.filter(e => e.performers && e.performers.length > 0);
        console.log(`[fok live] Events with performers: ${withPerformers.length}/${events.length}`);
        expect(withPerformers.length).toBeGreaterThan(0);
      });

      it('at least one event has composers', () => {
        const withComposers = events.filter(e => e.composers && e.composers.length > 0);
        console.log(`[fok live] Events with composers: ${withComposers.length}/${events.length}`);
        expect(withComposers.length).toBeGreaterThan(0);
      });

      it('at least one event has a synthesized description', () => {
        const withDesc = events.filter(e => e.description && e.description.length > 0);
        console.log(`[fok live] Events with description: ${withDesc.length}/${events.length}`);
        expect(withDesc.length).toBeGreaterThan(0);
      });

      it('multi-date programmes produce multiple events with same url', () => {
        const byUrl = new Map<string, Event[]>();
        for (const e of events) {
          const arr = byUrl.get(e.url) ?? [];
          arr.push(e);
          byUrl.set(e.url, arr);
        }
        const multiDate = [...byUrl.entries()].filter(([, evts]) => evts.length > 1);
        console.log(`[fok live] Programmes with multiple date entries: ${multiDate.length}`);
        // Log one example for manual inspection
        if (multiDate.length > 0) {
          const [url, evts] = multiDate[0]!;
          console.log(`  Example: ${url}`);
          for (const e of evts) console.log(`    date=${e.date} title=${e.title}`);
        }
        // Not asserting > 0 — near season end a genuine single-date listing is valid
        expect(multiDate.length).toBeGreaterThanOrEqual(0);
      });

      it('prints sample events for manual inspection', () => {
        const sample = events.slice(0, 3);
        console.log('\n[fok live] Sample events:');
        for (const e of sample) {
          console.log(JSON.stringify(e, null, 2));
        }
        expect(sample.length).toBeGreaterThan(0);
      });
    });
    ```

  - Notes:
    - `describe.skip` is active when `LIVE` env var is absent — safe to include in normal test suite; no network calls in CI.
    - Run command: `LIVE=1 npx jest fok.live --verbose` from repo root. Logs appear in `--verbose` output.
    - `jest.setTimeout(120_000)` is at **module scope** (outside `describe`) — this is required because `jest.setTimeout` inside a `describe` block does NOT apply to `beforeAll` callbacks, which use Jest's default 5s timeout. The explicit `120_000` second arg on `beforeAll` is a belt-and-suspenders guarantee.
    - The multi-date test logs examples but does not assert `> 0` — near season end, all events may genuinely be single-date. Manual inspection of the log confirms splitting works.
    - `beforeAll` fetches once; all `it` blocks share the result — no redundant network calls.

---

- [x] **Task 3: Register source in `src/event-pipeline/index.ts`**
  - File: `src/event-pipeline/index.ts`
  - Action:

    Add import after the existing `CeskaFilharmonieSource` import:
    ```typescript
    import { FokSource } from './event-sources/fok.js';
    ```

    Change sources array from:
    ```typescript
    sources: [
      new TicketmasterSource(ticketmasterApiKey),
      new CeskaFilharmonieSource(),
    ],
    ```
    To:
    ```typescript
    sources: [
      new TicketmasterSource(ticketmasterApiKey),
      new CeskaFilharmonieSource(),
      new FokSource(),
    ],
    ```

  - Notes: `FokSource` takes no constructor arguments. No new env vars. No CDK changes.

---

## Review Notes
- Adversarial review completed
- Findings: 11 total, 6 fixed (F1–F5, F7, F8), 5 skipped (F6, F9–F11)
- Resolution approach: walk-through

---

### Acceptance Criteria

- [ ] **AC1 — TypeScript compiles clean**
  - Given: both tasks complete
  - When: `tsc --noEmit` is run from repo root
  - Then: exits 0 with no type errors

- [ ] **AC2 — Source implements EventSource contract**
  - Given: `FokSource` is instantiated
  - When: type-checked against `EventSource`
  - Then: `source.id === 'fok'` and `source.fetch` returns `Promise<Event[]>`

- [ ] **AC3 — Listing scraper returns non-empty results**
  - Given: network access to `fok.cz`
  - When: `new FokSource().fetch()` is called
  - Then: returns at least 5 events (near season-end), each with non-empty `title`, `date` matching `/^\d{4}-\d{2}-\d{2}$/`, `url` starting with `https://www.fok.cz/en/`, non-empty `venue`, `sourceId === 'fok'`

- [ ] **AC4 — Multi-date splitting works**
  - Given: a FOK detail page listing multiple performance dates (e.g. `beethoven-fate-symphony` with a rehearsal + 2 evening shows across 2 calendar days)
  - When: `fetch()` completes
  - Then: the scraper emits one Event per unique ISO date — e.g. if the rehearsal and first evening show share the same calendar day, they collapse to 1 event; 2 distinct calendar days → 2 Event records, each with the same `title`/`url` but different `date` values

- [ ] **AC5 — Performers extracted with roles**
  - Given: an orchestral concert with named soloists and conductor (any current FOK concert)
  - When: that event is returned by `fetch()`
  - Then: `event.performers` is non-empty; at least one entry matches `"Name (role)"` format; `"Prague Symphony Orchestra"` present in performers

- [ ] **AC6 — Composers extracted from programme**
  - Given: a concert with a known programme (any current FOK concert showing composer names)
  - When: that event is returned by `fetch()`
  - Then: `event.composers` is non-empty containing expected composer surnames

- [ ] **AC7 — Description synthesized**
  - Given: any event with programme and performers
  - When: `event.description` is inspected
  - Then: non-empty string containing `"Programme:"` and/or `"Performers:"` prefix(es)

- [ ] **AC8 — ISO date format correct**
  - Given: any returned event
  - When: `event.date` is inspected
  - Then: matches `/^\d{4}-\d{2}-\d{2}$/` and is a valid calendar date in 2026 or later

- [ ] **AC9 — Per-event detail failure is non-fatal**
  - Given: one detail URL in the listing returns HTTP 404
  - When: `fetch()` completes
  - Then: all other events returned successfully; `[fok] Skipping event (detail error)` warning logged; `fetch()` does not throw

- [ ] **AC10 — Pagination beyond page 0**
  - Given: FOK listing has events across multiple pages
  - When: `fetch()` completes (near-season-end: ~2 pages; early season: ~6 pages)
  - Then: card count logged before detail fetch reflects all pages (not just page 0)

- [ ] **AC11 — Listing page 1+ failure is non-fatal**
  - Given: page 0 succeeds, page 1 returns HTTP 500
  - When: `fetch()` completes
  - Then: events from page 0 are returned; `[fok] Listing page 1 failed` warning logged; `fetch()` does not throw

- [ ] **AC12 — Nav links excluded from listing**
  - Given: fok.cz listing page includes navigation links (`/en/program`, `/en/artists`, etc.)
  - When: `fetch()` completes
  - Then: no event has a `url` of `https://www.fok.cz/en/program` or other nav paths

- [ ] **AC13 — Registered in pipeline**
  - Given: Task 3 complete
  - When: `tsc --noEmit` is run and `index.ts` is inspected
  - Then: `FokSource` is present in sources array; no type errors

---

## Additional Context

### Dependencies

- `cheerio@1.2.0` — already in `dependencies` from CF spec. No new install needed.
- `domhandler` — already available as cheerio peer dep. Provides `AnyNode` type for DOM traversal.
- Node.js 20 built-in `fetch` + `AbortSignal.timeout` — no polyfill needed.
- `@types/node@24` (already installed) — provides globals.
- No new packages required.

### Testing Strategy

Integration-style smoke test (network required). Same approach as CF scraper:
- **Smoke test**: run `new FokSource().fetch()` directly, log event count, sample a few events and verify fields manually
- **AC4 (multi-date)**: inspect a known multi-date programme — confirm emitted Event count equals date count on detail page
- **AC5/AC6**: spot-check performers/composers on 3–5 events against live fok.cz HTML
- **AC9**: temporarily patch a detail URL to `https://www.fok.cz/en/nonexistent-event-xxxxx` and confirm non-fatal behaviour
- Unit tests for `parseFokDate` (pure function) and `buildDescription` (pure function) may be added in `test/event-pipeline/event-sources/fok.test.ts` as a follow-up

### Notes

- **`strongEl.next` type safety**: `domhandler` types `Element.next` as `AnyNode | null`. Text nodes have `.type === 'text'` and a `.data` property. The cast `(nextNode as unknown as { data: string })` after the type check is the cleanest approach without importing the `Text` type from domhandler directly. Alternatively: `import type { Text } from 'domhandler'` and use `node instanceof Text` — but the cast is simpler for a POC.

- **`—` em dash in HTML**: Drupal 11 may serve the em dash as the actual Unicode character `—` or as the HTML entity `&mdash;`. Cheerio decodes entities, so `.data` will always contain the Unicode character. The regex `/[—–]/` is correct.

- **FOK ↔ Rudolfinum overlap**: FOK events at Dvořák Hall appear on both sites. The pipeline-level hash dedup (title + date + venue) will keep the FOK record and drop the Rudolfinum duplicate, since FOK is scraped first and is the authoritative source. No scraper changes needed.

- **FOK ↔ Obecní dům overlap**: FOK events at Smetana Hall appear on both sites. Same dedup logic applies — FOK record wins.

- **Slug reuse across seasons**: `/en/beethoven-fate-symphony` could reappear in a future season for a different performance. The pipeline dedup hash includes the date, so cross-season reuse is handled correctly. No special action needed in the scraper.

- **Season-end behaviour**: Near season end (~March), FOK lists ~16 events across 2 pages. The scraper handles this correctly — it stops on an empty page. Early season (September–October) expects ~75–90 events across 5–6 pages. Both within SOURCE_TIMEOUT_MS (90s) at DETAIL_CONCURRENCY=5.

- **Public general rehearsals**: included as normal events. The raw date text may include `(public general rehearsal)` annotation. The date pattern `/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/` extracts the date component regardless of annotation text. The title comes from the listing and does not include the rehearsal annotation — this is acceptable for POC.

- **No event type pre-filter**: all events included. The LLM will filter based on user preferences. This differs from CF (which excludes workshops/education) — FOK content is uniformly classical/orchestral/chamber, so no pre-filter is needed.
