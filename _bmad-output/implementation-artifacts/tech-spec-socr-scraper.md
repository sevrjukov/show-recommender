---
title: 'SOČR Scraper'
slug: 'socr-scraper'
created: '2026-03-23'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'TypeScript 5.9 (strict, NodeNext modules)'
  - 'Node.js 20 LTS'
  - 'cheerio (HTML parsing)'
  - 'Node built-in fetch'
files_to_modify:
  - 'src/event-pipeline/event-sources/socr.ts'
  - 'src/event-pipeline/index.ts'
  - 'test/event-pipeline/event-sources/socr.live.test.ts'
code_patterns:
  - 'EventSource interface — id + fetch(): Promise<Event[]>'
  - 'cheerio load() for HTML parsing'
  - 'fetchHtml() with User-Agent, AbortSignal.timeout, retry on 429/5xx'
  - 'delay() between batch requests'
  - 'DETAIL_CONCURRENCY=5 batched Promise.allSettled'
  - '.js import extensions (NodeNext module resolution)'
test_patterns:
  - 'LIVE=1 guard (describe.skip unless env var set)'
  - 'jest.setTimeout(120_000) at module scope'
  - 'beforeAll with explicit timeout param'
  - 'assertions: count, required fields, optional fields at-least-one'
---

# Tech-Spec: SOČR Scraper

**Created:** 2026-03-23

## Overview

### Problem Statement

The event pipeline has no scraper for SOČR (Symfonický orchestr Českého rozhlasu). This means ~10–15 Prague classical concerts per season-half are missing from the digest — including exclusive Studio 1 (Czech Radio) concerts and SOČR's own Rudolfinum appearances that may not be covered by other scrapers.

### Solution

Implement a `SocrSource` class (implementing `EventSource`) in `src/event-pipeline/event-sources/socr.ts`. The scraper fetches a single listing page (no pagination), extracts event cards, then scrapes each detail page for machine-readable date, performers, and programme. Register the source in `index.ts`. Add a live integration test.

### Scope

**In Scope:**
- `SocrSource` class implementing `EventSource` interface
- Single listing page fetch (`/koncerty-a-vstupenky`)
- Per-event detail page scrape (batched, 5 concurrent)
- `dataLayer["airedDate"]` extraction for ISO datetime
- `.field.body` paragraph heuristic parsing (programme + performers)
- CSS `background-image` URL extraction for hero images
- Detail URL as ticket entry point (no direct ticket URL available)
- Registration in `index.ts`
- Live integration test (`LIVE=1` guard)

**Out of Scope:**
- Ticket URL extraction (Drupal modal — not in static HTML; link to detail page instead)
- Historical/archive concert data
- Open rehearsal filtering (can be added later if needed)
- Price tier extraction

---

## Context for Development

### Codebase Patterns

- **Module resolution:** NodeNext. All relative imports use `.js` extension (e.g. `import { Event } from '../types.js'`).
- **EventSource contract:** implement `readonly id: string` and `async fetch(): Promise<Event[]>`. Register instance in the `sources` array in `index.ts`.
- **fetchHtml pattern:** copy the `fetchHtml` + `delay` helpers verbatim from `fok.ts`. They handle User-Agent, 10s timeout via `AbortSignal.timeout`, and retry-with-backoff on 429/5xx up to 3 attempts.
- **Batch concurrency:** `DETAIL_CONCURRENCY = 5`. Use `Promise.allSettled` for per-event fault isolation. Warn and skip on rejected detail fetches.
- **Logging prefix:** `[socr]` — follows the `[module-name]` convention.
- **Event.date:** ISO `YYYY-MM-DD` string. Pipeline dedup hashes on date+venue+title.
- **Event.url:** Use the SOČR detail page URL as the ticket entry point.
- **TypeScript strict:** `noImplicitAny`, `strictNullChecks`. All local interfaces typed explicitly.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src/event-pipeline/event-sources/fok.ts` | Primary pattern reference — fetchHtml, delay, batching, mapToEvent, buildDescription |
| `src/event-pipeline/types.ts` | `Event` and `EventSource` interfaces |
| `src/event-pipeline/index.ts` | Where to register `SocrSource` |
| `test/event-pipeline/event-sources/fok.live.test.ts` | Live test pattern to mirror |
| `_bmad-output/spikes/scraping_analysis/czech/scraping-spike-socr-2026-03-18.md` | Full DOM selector reference, example HTML, scraping strategy |

### Technical Decisions

1. **No pagination loop.** `socr.rozhlas.cz/koncerty-a-vstupenky` shows the entire upcoming season (~10–15 events) on a single page. One GET, then scrape all linked detail pages.

2. **`dataLayer["airedDate"]` for date.** Every detail page embeds a `dataLayer` push in a `<script>` block containing `"airedDate": "2026-03-24 19:30:00"`. This is machine-readable and avoids parsing Czech locale month names. Extract with regex: `/"airedDate"\s*:\s*"([^"]+)"`. Slice to `YYYY-MM-DD` (first 10 chars).

3. **Listing card selectors.** All event cards are `<a href="/[slug]-[id]">` where href matches `/^\/[a-z][a-z0-9-]+-\d+$/`. Inside each `<a>`: title from `<h3>`, date/venue from `<span>` elements (index 0 = date, index 1 = venue). Event ID = `href.rsplit("-", 1)` → numeric suffix.

4. **CSS background-image for hero image.** No `<img>` tags — find the element with `style` attribute containing `background-image` inside the `<a>` card. Use regex `/url\(['"]?([^'")]+)['"]?\)/` (note `[^'")]+` — excludes closing paren/quote from the capture to avoid mismatched-quote captures). Resolve the extracted path via a `resolveImageUrl` helper:
   - starts with `//` → prepend `https:`
   - starts with `/` → prepend `BASE_URL`
   - starts with `http` → return as-is
   - otherwise → `BASE_URL + '/' + path`
   - no match → `undefined`

5. **`.field.body` programme/performer heuristic.** Programme and performers share one `<div class="field body">` container. Note: `"field body"` are two space-separated CSS classes — the cheerio selector `div.field.body` matches an element with both classes present (AND semantics), which is correct.

   No semantic tags differentiate programme from performers. Per-line heuristic (each `<p>` is split by `\n` first):

   **Programme line** (checked first): `line.includes(':') && !/^\d{1,2}:\d{2}/.test(line)`
   - The time-exclusion guard (`/^\d{1,2}:\d{2}/`) prevents time strings like "19:30 hodin" from being misclassified as programme lines.
   - Parse matched lines with: `/^(.+?):\s*(.+?)(?:\s*\((\d+)\s*min\.?\))?$/`

   **Performer line** (comma present, not programme): `line.includes(',')`
   - Split on last comma: `name = line.slice(0, lastCommaIdx)`, `role = line.slice(lastCommaIdx + 1)`
   - Format: `"Name (role)"`

   **Ensemble line** (no comma, no colon): push line as-is.

   **Selector fallback chain** — try in order; use first with non-empty result:
   1. `'div.field.body'`
   2. `'div.field-body'`
   3. `'div.field--name-body'`
   4. `'div[class*="field"][class*="body"]'` — catch-all

   Log which matched: `console.log('[socr] field.body selector: <matched>')`. If none match: `console.warn('[socr] No .field.body found on <url>')` and return empty arrays.

   This heuristic is inherently fragile. Accept remaining edge cases at POC scale.

6. **Ticket URL.** The "Koupit vstupenku" button uses a Drupal modal — ticket destination URL is not in static HTML. Set `event.url` to the SOČR detail page URL. Buyers can click through.

7. **sourceId:** `'socr'`

8. **`REQUEST_DELAY_MS = 250`** between listing page batches (mirrors FOK). Small catalogue so total scrape time is fast.

---

## Implementation Plan

### Tasks

Tasks are ordered by dependency (lowest level first).

**Task 1 — Create `src/event-pipeline/event-sources/socr.ts`**

Create the file with the following structure (all implementation detail below):

```
src/event-pipeline/event-sources/socr.ts
```

**1a. Constants and types**

```typescript
import { load } from 'cheerio';
import type { Event, EventSource } from '../types.js';

const BASE_URL = 'https://socr.rozhlas.cz';
const LISTING_PATH = '/koncerty-a-vstupenky';
const REQUEST_DELAY_MS = 250;
const DETAIL_CONCURRENCY = 5;

// Matches SOČR event hrefs: /slug-with-hyphens-12345678
const EVENT_HREF_RE = /^\/[a-z][a-z0-9-]+-(\d+)$/;
const AIRED_DATE_RE = /"airedDate"\s*:\s*"([^"]+)"/;
const BG_IMAGE_RE = /url\(['"]?([^'")]+)['"]?\)/;

function resolveImageUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const path = raw.trim();
  if (path.startsWith('//')) return 'https:' + path;
  if (path.startsWith('/')) return BASE_URL + path;
  if (path.startsWith('http')) return path;
  return BASE_URL + '/' + path;
}

interface SocrCard {
  eventId: string;
  title: string;
  dateRaw: string;
  venue: string;
  imageUrl: string | undefined;
  detailUrl: string;
}

interface ProgrammeEntry {
  composer: string;
  work: string;
  durationMin: number | undefined;
}

interface SocrDetail {
  date: string | undefined;   // ISO YYYY-MM-DD from dataLayer airedDate
  performers: string[];        // "Name (role)" format
  programme: ProgrammeEntry[];
}
```

**1b. `SocrSource` class**

```typescript
export class SocrSource implements EventSource {
  readonly id = 'socr';

  async fetch(): Promise<Event[]> {
    console.log('[socr] Starting scrape');

    const cards = await scrapeListingPage();
    console.log(`[socr] Listing: ${cards.length} events found`);

    const events: Event[] = [];

    for (let batchStart = 0; batchStart < cards.length; batchStart += DETAIL_CONCURRENCY) {
      if (batchStart > 0) await delay(REQUEST_DELAY_MS);
      const batch = cards.slice(batchStart, batchStart + DETAIL_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map(card => scrapeDetailPage(card.detailUrl)),
      );

      for (let j = 0; j < batch.length; j++) {
        const card = batch[j]!;
        const result = results[j]!;
        if (result.status === 'rejected') {
          console.warn(
            `[socr] Skipping event (detail error): ${card.detailUrl} —`,
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          );
          continue;
        }
        const detail = result.value;
        if (!detail.date) {
          console.warn(`[socr] Skipping event (no date parsed): ${card.detailUrl}`);
          continue;
        }
        try {
          events.push(mapToEvent(card, detail));
        } catch (err) {
          console.warn(
            `[socr] Skipping event ${card.detailUrl} —`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    console.log(`[socr] Done — ${events.length} events`);
    return events;
  }
}
```

**1c. `scrapeListingPage()`**

Fetches `BASE_URL + LISTING_PATH`. Iterates all `<a>` elements. For each `<a>` where `href` matches `EVENT_HREF_RE`:
- `eventId` = capture group 1 from regex match on href
- `title` = `a.find('h3').text().trim()`
- `spans` = `a.find('span')`; `dateRaw` = `spans.eq(0).text().trim()`; `venue` = `spans.eq(1).text().trim()`
- `imageUrl`: find element with `style` attribute containing `background-image` inside `a`; apply `BG_IMAGE_RE`; pass raw match to `resolveImageUrl()`
- `detailUrl` = `BASE_URL + href`
- Skip if `title` is empty (image-only anchor)
- Deduplicate by `eventId`

**1d. `scrapeDetailPage(url: string): Promise<SocrDetail>`**

Fetches detail page. Three extractions:

*Date:* Iterate all `<script>` elements. For any `script.text()` containing `"airedDate"`, apply `AIRED_DATE_RE`. If matched, slice `m[1].substring(0, 10)` → ISO `YYYY-MM-DD`. Use first match found.

*Programme and Performers from `.field.body`:*

Locate the body container using the fallback selector chain (try in order, use first non-empty result):
1. `'div.field.body'`
2. `'div.field-body'`
3. `'div.field--name-body'`
4. `'div[class*="field"][class*="body"]'`

Log which matched: `console.log('[socr] field.body selector: <matched>')`. If none match: `console.warn` and return empty arrays.

Iterate `<p>` elements inside. For each `<p>`, split text by `\n`, trim and filter empty lines. For each line:

1. **Programme line** (checked first): `line.includes(':') && !/^\d{1,2}:\d{2}/.test(line)`
   - Parse with: `/^(.+?):\s*(.+?)(?:\s*\((\d+)\s*min\.?\))?$/`
   - On match: push `{ composer: m[1].trim(), work: m[2].trim(), durationMin: m[3] ? parseInt(m[3], 10) : undefined }`
   - On no match: `console.warn('[socr] Unrecognised programme line: "<line>"')`

2. **Performer line** (comma present): `line.includes(',')`
   - `const idx = line.lastIndexOf(','); name = line.slice(0, idx).trim(); role = line.slice(idx + 1).trim()`
   - Push `role ? \`${name} (${role})\` : name`

3. **Ensemble line** (no comma, no colon): push line as-is.

Warn if no performers AND no programme extracted from the entire detail page.

**1e. `mapToEvent(card: SocrCard, detail: SocrDetail): Event`**

```typescript
function mapToEvent(card: SocrCard, detail: SocrDetail): Event {
  const composers = [...new Set(detail.programme.map(p => p.composer))];
  const description = buildDescription(detail);
  return {
    title: card.title,
    venue: card.venue || 'SOČR Prague',  // fallback
    date: detail.date!,
    url: card.detailUrl,
    sourceId: 'socr',
    ...(detail.performers.length > 0 ? { performers: detail.performers } : {}),
    ...(composers.length > 0 ? { composers } : {}),
    ...(description ? { description } : {}),
  };
}
```

**1f. `buildDescription(detail: SocrDetail): string | undefined`**

```typescript
function buildDescription(detail: SocrDetail): string | undefined {
  const parts: string[] = [];

  if (detail.programme.length > 0) {
    const progStr = detail.programme
      .map(p => {
        const base = p.work ? `${p.composer} — ${p.work}` : p.composer;
        return p.durationMin ? `${base} (${p.durationMin} min.)` : base;
      })
      .join('; ');
    parts.push(`Programme: ${progStr}`);
  }

  if (detail.performers.length > 0) {
    parts.push(`Performers: ${detail.performers.join(', ')}`);
  }

  return parts.length > 0 ? parts.join('. ') + '.' : undefined;
}
```

`durationMin` is included in the programme string when present (e.g. `"Béla Bartók — Hrad knížete Modrovouse (60 min.)"`) — this gives the LLM matching context about concert length.

**1g. `fetchHtml` and `delay` helpers**

Copy verbatim from `fok.ts`. Change log prefix from `[fok]` to `[socr]`.

---

**Task 2 — Register `SocrSource` in `src/event-pipeline/index.ts`**

Add import:
```typescript
import { SocrSource } from './event-sources/socr.js';
```

Add to `sources` array:
```typescript
new SocrSource(),
```

No other changes to `index.ts`.

---

**Task 3 — Create live integration test `test/event-pipeline/event-sources/socr.live.test.ts`**

Mirror `fok.live.test.ts` exactly, with the following changes:

- Import `SocrSource` instead of `FokSource`
- Change all `[fok live]` log prefixes to `[socr live]`
- URL assertion: `expect(event.url).toMatch(/^https:\/\/socr\.rozhlas\.cz\//)`
- `sourceId` assertion: `expect(event.sourceId).toBe('socr')`
- Remove the "multi-date programmes" test (SOČR has one entry per concert, no date-splitting)
- Keep: count ≥ 1, required fields, at-least-one performers, at-least-one composers, at-least-one description, sample print

---

### Acceptance Criteria

**AC-1: Listing page parsed correctly**

*Given* the SOČR listing page at `socr.rozhlas.cz/koncerty-a-vstupenky`
*When* `SocrSource.fetch()` runs
*Then* at least 1 `SocrCard` is extracted with non-empty `title`, `detailUrl` matching `https://socr.rozhlas.cz/[slug]-[id]`, and `eventId` being a numeric string

**AC-2: Date extraction from dataLayer**

*Given* a SOČR detail page containing a `dataLayer` script block with `"airedDate": "YYYY-MM-DD HH:MM:SS"`
*When* `scrapeDetailPage()` runs
*Then* `detail.date` equals `"YYYY-MM-DD"` (first 10 characters of airedDate)

*Given* a detail page with no `airedDate` in any script block
*When* `scrapeDetailPage()` runs
*Then* `detail.date` is `undefined` and the event is skipped with a `console.warn`

**AC-3: Programme parsing logic**

*Given* a `.field.body` `<p>` line matching `Composer: Work (N min.)` pattern
*When* `scrapeDetailPage()` runs
*Then* a `ProgrammeEntry` is produced with `composer`, `work`, and `durationMin` populated from the regex groups

*Given* a programme line without duration, e.g. `Composer: Work`
*When* parsed
*Then* a `ProgrammeEntry` is produced with `durationMin: undefined`

*Given* a time string like `19:30 hodin` appearing in `.field.body`
*When* parsed
*Then* it is NOT classified as a programme line (time-exclusion guard `!/^\d{1,2}:\d{2}/` prevents it)

*Given* a `<p>` containing multiple `Composer: Work` lines separated by `\n`
*When* parsed
*Then* each non-empty line produces a separate `ProgrammeEntry`

**AC-4: Performer parsing logic**

*Given* a `.field.body` line matching `Name, role` (comma-delimited)
*When* `scrapeDetailPage()` runs
*Then* the performer is added as `"Name (role)"`

*Given* a `.field.body` line with no comma and no colon (ensemble name)
*When* parsed
*Then* the line is added to `performers` as-is, without a role suffix

*Given* a multi-line performer `<p>` containing both `Name, role` lines and bare ensemble names
*When* parsed
*Then* all non-empty lines are included in `detail.performers` in their original order

**AC-5: Event mapped to pipeline `Event` type**

*Given* a successfully scraped SOČR event
*When* `mapToEvent()` runs
*Then*:
- `event.sourceId === 'socr'`
- `event.date` matches `/^\d{4}-\d{2}-\d{2}$/`
- `event.url` starts with `https://socr.rozhlas.cz/`
- `event.venue` is non-empty
- `event.title` is non-empty

**AC-6: Detail fetch failure is non-fatal**

*Given* one detail page returns HTTP 500
*When* `SocrSource.fetch()` runs
*Then* that event is skipped with `console.warn` and remaining events are returned normally

**AC-7: Source registered in pipeline**

*Given* `index.ts` with `SocrSource` registered
*When* `tsc --noEmit` is run
*Then* no type errors

**AC-8: Live integration test passes**

*Given* `LIVE=1 npx jest socr.live.test.ts`
*When* run against the live site
*Then* ≥ 1 event returned, all required fields present, at least 1 event has performers, at least 1 has composers

---

## Additional Context

### Dependencies

No new npm packages required. `cheerio` is already a dependency (used by `fok.ts`).

Check that `cheerio` is in `package.json` `dependencies`:
```
"cheerio": "..."
```

If only in `devDependencies`, move it to `dependencies` (same as `@aws-sdk` packages — must be bundled by esbuild for Lambda).

### Testing Strategy

- **Live tests only** — no unit test fixtures needed for this scraper. The parsing logic is tightly coupled to the live HTML structure; maintaining static HTML fixtures adds noise without proportional value at POC scale.
- Run: `LIVE=1 npx jest socr.live.test.ts --verbose`
- If live tests fail due to structure changes, compare against the spike document DOM selectors and update selectors accordingly.

### Notes

- **SOČR Drupal 7 stability risk.** Drupal 7 reached EOL. Site may migrate. Lower long-term confidence than CF or FOK. The scraper should be treated as best-effort; pipeline non-fatal failure handling already covers this.
- **`.field.body` class name.** Drupal 7 adds extra classes; the actual rendered class may be `"field body"`, `"field-items"`, or similar. If the `'.field.body'` selector fails, try: `$('[class*="field"][class*="body"]')` as fallback.
- **Overlap dedup.** SOČR concerts at Rudolfinum or Smetana Hall will also appear on those venues' sites. The pipeline's existing hash-based dedup (`sha256(date|venue|title)`) handles this — no scraper-level action needed.
- **Open rehearsals.** "Otevřené zkoušky" events can be filtered post-scrape by checking if `card.title` contains keywords like `zkouška` or `zkouška`. Deferred — LLM matching will likely score these low anyway.
- **Image URL.** If `imageUrl` is extracted, it can be included in the `description` or as a future `image` field extension. For now, the `Event` interface has no `image` field — omit it.
