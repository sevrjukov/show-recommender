---
title: 'Elbphilharmonie Event Source'
slug: 'elbphilharmonie-event-source'
created: '2026-03-26'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'TypeScript 5.9 (strict, NodeNext modules)'
  - 'Node.js 20 LTS'
  - 'cheerio (HTML parsing — already in package.json)'
  - 'Jest + ts-jest'
files_to_modify:
  - 'src/event-pipeline/event-sources/elbphilharmonie.ts (new)'
  - 'src/event-pipeline/index.ts (add import + source registration)'
  - 'test/event-pipeline/event-sources/elbphilharmonie.live.test.ts (new)'
code_patterns:
  - 'EventSource interface: id + fetch(): Promise<Event[]>'
  - 'fetchHtml helper with AbortSignal.timeout(10_000) + retry on 429/5xx (up to 3 attempts)'
  - 'Promise.allSettled batches of 5 for detail fetches, 500ms delay before each batch (skip first)'
  - 'mapToEvent with spread conditionals — no empty arrays emitted'
  - 'buildDescription: "Programme: ...; Performers: ..."'
  - 'All relative imports use .js extension (NodeNext)'
  - 'Logging prefix [elbphilharmonie], count logs at listing / post-filter / done'
test_patterns:
  - 'Live integration tests only — LIVE=1 env var gates describe block'
  - 'jest.setTimeout(120_000) + beforeAll fetch call'
  - 'Tests: event count >= 5, required fields shape, all venues are known canonical strings (fail on unknown), performers present, composers present, description present, sample print'
---

# Tech-Spec: Elbphilharmonie Event Source

**Created:** 2026-03-26

## Overview

### Problem Statement

The event pipeline has no coverage for Elbphilharmonie Hamburg — one of the world's premier concert venues. Both buildings (Elbphilharmonie and Laeiszhalle) host major classical concerts that are candidates for the recommender. Tickets for these concerts often need to be purchased months in advance, requiring a 12-month scrape horizon.

### Solution

Implement a new `ElbphilharmonieSource` class in `src/event-pipeline/event-sources/elbphilharmonie.ts` that:
1. Paginates the SSR listing at `https://www.elbphilharmonie.de/en/whats-on/` using date-based AJAX URL chaining up to a 12-month horizon
2. Applies a text-based genre pre-filter (exclude-only regex on title + subtitle) before fetching detail pages
3. Fetches detail pages in batched concurrent requests to extract performers with roles and structured programme
4. Maps results to the shared `Event` interface and registers the source in `index.ts`

### Scope

**In Scope:**
- Both buildings: Elbphilharmonie (Großer Saal, Kleiner Saal, Kaistudio 1) and Laeiszhalle (Großer Saal, Johannes Brahms Saal, Studio E)
- Listing pagination up to 12 months ahead
- Genre pre-filter using title + subtitle exclude signals (conservative: include grey-zone events)
- Detail page scrape for performers (with roles) and programme (structured composer → works)
- Description field assembly from programme + performers (matching existing source convention)
- Registration of the new source in `index.ts`
- Live integration test in `test/event-pipeline/event-sources/elbphilharmonie.live.test.ts`

**Out of Scope:**
- LLM-based genre classification (text pre-filter only; can be added post-POC if signal is too weak)
- Subscription/series metadata (not mapped to `Event` interface)
- Promoter field (not mapped to `Event` interface)
- Sold-out filtering (not a pipeline concern; tickets may open later)

---

## Context for Development

### Codebase Patterns

- New source file: `src/event-pipeline/event-sources/elbphilharmonie.ts`
- Exports a single named class: `ElbphilharmonieSource implements EventSource`
- All relative imports use `.js` extension (NodeNext module resolution)
- `fetchHtml` helper with retry on 429/5xx (up to 3 attempts), `AbortSignal.timeout(10_000)` — copy from `musikverein.ts`, update log prefix
- Detail fetches use `Promise.allSettled` in batches of 5 with 500ms delay **before** each batch (skip delay before first batch) — matching `musikverein.ts` pattern: `if (batchStart > 0) await delay(REQUEST_DELAY_MS)`
- Same delay pattern applies to listing batches: delay before each batch except the first
- Logging prefix: `[elbphilharmonie]`; log counts at listing, post-filter, and done boundaries
- `mapToEvent` uses spread conditionals: `...(performers.length > 0 ? { performers } : {})` — do not emit empty arrays
- `description` assembled as `"Programme: <entries>. Performers: <names>."` matching `musikverein.ts` / `berliner-phil.ts` convention; may be `undefined` if both `programme` and `performers` are empty (valid — `Event.description` is optional)
- Venue string is the canonical hall name (e.g. `'Elbphilharmonie Großer Saal'`)
- `date` field: `YYYY-MM-DD` sliced from the ISO datetime `time[datetime]` attribute (`.substring(0, 10)`) — see validation requirement below
- Dedup key is computed by `dedup.ts` in the pipeline (`SHA256(date|venue|title)`). The source's only obligation is to return consistent `venue` strings across runs. `data-event-id` attribute is unreliable — use numeric ID from URL slug as event identity within this source.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src/event-pipeline/event-sources/musikverein.ts` | Template: listing loop, batched detail fetch, `fetchHtml`, retry logic, `mapToEvent` pattern, delay-before-batch pattern |
| `src/event-pipeline/event-sources/berliner-phil.ts` | Reference: `buildDescription`, `parsePerformers` patterns |
| `src/event-pipeline/index.ts` | Registration point — add `ElbphilharmonieSource` to `sources` array |
| `src/event-pipeline/types.ts` | `Event` and `EventSource` interfaces |
| `test/event-pipeline/event-sources/musikverein.live.test.ts` | Template for live test structure |
| `_bmad-output/spikes/scraping_analysis/international/elbphilharmonie-scraping-spike-2026-03-18.md` | Full DOM selectors, pagination algorithm, genre filter signals, example entries, code recipe |

### Technical Decisions

#### Pagination algorithm

1. `GET https://www.elbphilharmonie.de/en/whats-on/` — full HTML page; parse `li.event-item` cards + `li[data-url]` next-pointer
2. Loop: `GET https://www.elbphilharmonie.de{data-url}/ajax/1` — returns raw HTML fragment (no `<html>` wrapper); parse cards + next-pointer from same selectors (selectors are identical for full page and fragment)
3. **Terminate** when: (a) no `li[data-url]` element in response, OR (b) date extracted from `data-url` exceeds horizon (`now + 52 weeks`)
4. **Horizon check is on the next-pointer date, not individual card dates.** As soon as a `data-url` date > horizon is found, stop — do not fetch that batch. There is no "wait for whole batch to be post-horizon" logic.
5. **Date extraction from `data-url`**: match `/(\d{2}-\d{2}-\d{4})/` → parse `DD-MM-YYYY` as `new Date('YYYY-MM-DD')`. If the regex does not match, or `isNaN(nextDate.getTime())`, log `console.warn('[elbphilharmonie] Cannot parse date from data-url: ...')` and **stop the loop** (treat as terminal).
6. 500ms delay before each listing batch, skipping the delay before the first request (same `if (i > 0) await delay(...)` pattern as `musikverein.ts`)

#### Next-pointer selector

Use: `$('li[data-url]').last().attr('data-url') ?? null`

This works for both full pages and AJAX fragments because:
- Full pages: `li[data-url]` appears only at the bottom of `ul#event-list`; `.last()` is correct
- AJAX fragments: the response is only `<li>` elements; the next-pointer is always the last one

Do **not** scope the selector to `#event-list` — AJAX fragments have no `<ul>` wrapper and the scoped selector would return nothing.

#### Genre pre-filter

Applied case-insensitively to `title + ' ' + subtitle` before detail fetches.

**Exclude** if the combined string matches:
```
/(?:^|\s|\/)(Jazz|Pop|Rock|Electronic|DJ|Comedy|Chanson|Hip.?Hop|Blues|Gospel|Spoken Word|Kulturcafé)(?:\s|\/|$)/i
```

Use a space/slash/start/end boundary instead of `\b` — word boundaries behave unexpectedly with non-ASCII characters and compound words like "Jazz-Abend" or "Gospel-influenced".

**Include everything not excluded** — conservative approach; grey-zone events pass through and the LLM layer handles final relevance filtering.

Log excluded count: `console.log('[elbphilharmonie] Genre filter: ${excluded} excluded, ${filtered.length} remain')`

**Known limitation**: This filter is intentionally coarse. After the first live run, compare pass/reject ratio in logs and tune the pattern if needed. Laeiszhalle Studio E predominantly hosts jazz — if the filter passes too many Studio E events, a venue-based exclusion can be added post-POC.

#### Listing card parsing

Each `li.event-item` in the response. Skip the card with `console.warn` if required fields are missing.

| Field | Selector | Notes |
|-------|----------|-------|
| `detailHref` | `p.event-title a[href]` | Required; skip card if missing |
| `numericId` | Last path segment of `detailHref` | `detailHref.split('/').pop()` |
| `title` | `p.event-title a` text, trimmed | Required; skip card if empty |
| `subtitle` | `p.event-subtitle` text, trimmed | Optional; default `''` |
| `isoDatetime` | `time[datetime]` attribute | **Validate** matches `/^\d{4}-\d{2}-\d{2}T/`; skip card with `console.warn` if missing or malformed |
| `building` | `strong` text inside `.place-cell .caption.uppercase` | Trim whitespace |
| `room` | `.place-cell .caption.uppercase` full text minus `building` text, trimmed | Trim whitespace |
| `detailUrl` | `'https://www.elbphilharmonie.de' + detailHref` | |

#### Detail page parsing

Use HTML selectors, **not** JSON-LD, for performers and programme.

**Description**: Parse `script[type="application/ld+json"]` elements, find the one where `@type === 'MusicEvent'`, extract `.description`. Wrap the `JSON.parse` in a try/catch; use `''` as fallback if parse fails.

**Performers** from `<h3>Performers</h3>`:

Navigate to the `<h3>` containing text "Performers", then iterate its following sibling `p.artists` elements until the next `<h3>` (or end of section). For each `<p class="artists">`:

1. Extract `name` = `$p.find('b').first().text().trim()`
2. Extract `role` = `$p.text().replace(name, '').replace(/\u2002/g, ' ').trim()` (strip en-space U+2002)
3. **Role order detection**: Check if there is non-whitespace text in `$p.html()` **before** the `<b>` tag:
   - Get the HTML: `const html = $p.html() ?? ''`
   - Get the index of `<b>`: `const bIndex = html.indexOf('<b>')`
   - Get text before: `const before = $('<div>').html(html.substring(0, bIndex)).text().replace(/\u2002/g, ' ').trim()`
   - If `before.length > 0`: role is `before`, name is the `<b>` text (conductor pattern)
   - If `before.length === 0`: name is the `<b>` text, role is the remaining text (soloist pattern)
4. Format as `"Name (role)"` when role is non-empty after trimming; `"Name"` otherwise
5. Skip entries where `name` is empty

**Concrete examples** (from spike):
- Conductor HTML: `<p class="artists">conductor&ensp;<b>James Gaffigan</b></p>` → `{ name: 'James Gaffigan', role: 'conductor' }` → `"James Gaffigan (conductor)"`
- Soloist HTML: `<p class="artists"><b>Lawrence Power</b>&ensp;viola</p>` → `{ name: 'Lawrence Power', role: 'viola' }` → `"Lawrence Power (viola)"`

**Programme** from `<h3>Programme</h3>` → `.readmore-wrapper`:

For each `<p>` inside `.readmore-wrapper`:
1. If `$p.find('b').length === 0`: skip (interval marker — uses `<span class="pause greyed-text">`)
2. `composer` = `$p.find('b').first().text().trim()`; skip if empty
3. Remove the `<b>` element from a cheerio clone: `$p.find('b').first().remove()`
4. Get remaining HTML, split on `/<br\s*\/?>/gi`, map each part through cheerio's `.text()` (or `$('<span>').html(part).text()`), trim, filter empty strings → `works: string[]`
5. Push `{ composer, works }`

**Note**: Use cheerio DOM manipulation (`.remove()`, `.text()`) rather than raw string regex for `<b>` removal to avoid partial-match issues with multiple `<b>` tags.

#### `mapToEvent` — composers extraction

```typescript
const composers = [...new Set(
  detail.programme.map(p => p.composer).filter(c => c.length > 0)
)];
```

Deduplicate by exact string. Pass to `Event.composers` using spread conditional (same pattern as performers).

#### `canonicalVenue(building, room)`

Trim whitespace from both `building` and `room` before lookup.

| building (trimmed) | room (trimmed) | canonical |
|---|---|---|
| `Elbphilharmonie` | `Großer Saal` | `'Elbphilharmonie Großer Saal'` |
| `Elbphilharmonie` | `Kleiner Saal` | `'Elbphilharmonie Kleiner Saal'` |
| `Elbphilharmonie` | `Kaistudio 1` or `Kaistudio` | `'Elbphilharmonie Kaistudio 1'` |
| `Laeiszhalle` | `Großer Saal` | `'Laeiszhalle Großer Saal'` |
| `Laeiszhalle` | `Johannes Brahms Saal` or `Brahms-Saal` | `'Laeiszhalle Johannes Brahms Saal'` |
| `Laeiszhalle` | `Studio E` | `'Laeiszhalle Studio E'` |
| _(anything else)_ | | `'${building} ${room}'.trim()` + `console.warn('[elbphilharmonie] Unknown hall: building="${building}" room="${room}"')` |

#### `fetchHtml` — User-Agent and retry

Copy `fetchHtml` from `musikverein.ts` verbatim; change log prefix from `[musikverein]` to `[elbphilharmonie]`. User-Agent header: `'Mozilla/5.0 (compatible; show-recommender-bot/1.0)'` (matching all other sources).

When all 3 retry attempts fail, `fetchHtml` throws. The calling code in `fetch()` handles this via `Promise.allSettled` → `result.status === 'rejected'` → `console.warn('[elbphilharmonie] Skipping event (detail error): ...')` + `continue`. This is the same pattern as `musikverein.ts` lines 107–113.

---

## Implementation Plan

### Tasks

- [ ] **Task 1**: Create `src/event-pipeline/event-sources/elbphilharmonie.ts` — the complete source implementation
  - **File**: `src/event-pipeline/event-sources/elbphilharmonie.ts` (new file)
  - **Action**: Implement `ElbphilharmonieSource implements EventSource` with all private helpers. Follow the structure of `musikverein.ts`. Internal structure:
    1. Constants: `BASE = 'https://www.elbphilharmonie.de'`, `REQUEST_DELAY_MS = 500`, `DETAIL_CONCURRENCY = 5`, `HORIZON_WEEKS = 52`
    2. Internal interfaces: `ElbCard` (listing fields: `numericId`, `title`, `subtitle`, `isoDatetime`, `building`, `room`, `detailUrl`), `ElbDetail` (detail fields: `description: string`, `performers: string[]`, `programme: Array<{composer: string, works: string[]}>`)
    3. `ElbphilharmonieSource` class with `readonly id = 'elbphilharmonie'`
    4. `fetch()` method:
       - Listing pagination loop: first URL is `${BASE}/en/whats-on/`; subsequent batches use next-pointer from previous response. Apply `if (i > 0) await delay(REQUEST_DELAY_MS)` before each batch (skip first).
       - Horizon check on extracted `data-url` date: stop immediately if date > horizon or date is unparseable
       - Genre pre-filter via `isExcluded(title, subtitle)` — log excluded count
       - Batched detail fetches via `Promise.allSettled`, batches of 5, `if (batchStart > 0) await delay(REQUEST_DELAY_MS)` before each batch
       - `result.status === 'rejected'` → `console.warn` + skip; map errors → `console.warn` + skip
       - Log counts at: listing total, post-filter, done
    5. `scrapeCards(html: string)` — parses HTML (works for both full pages and AJAX fragments without any flag), returns `{ cards: ElbCard[], nextDataUrl: string | null }`. Validate `isoDatetime` — skip card with `console.warn` if missing or malformed.
    6. `isExcluded(title: string, subtitle: string): boolean` — returns `true` if the exclude regex matches `title + ' ' + subtitle`
    7. `fetchDetail(detailUrl: string): Promise<ElbDetail>` — returns `ElbDetail` with `description`, `performers`, `programme`
    8. `parsePerformers($: CheerioAPI): string[]` — implements role-order detection algorithm (HTML position check for conductor vs soloist) described in Technical Decisions
    9. `parseProgramme($: CheerioAPI): Array<{composer: string, works: string[]}>` — uses cheerio DOM manipulation (`.remove()`, `.text()`) for `<b>` extraction; splits on `/<br\s*\/?>/gi`
    10. `mapToEvent(card: ElbCard, detail: ElbDetail): Event`:
        - `date` = `card.isoDatetime.substring(0, 10)`
        - `venue` = `canonicalVenue(card.building, card.room)`
        - `performers` = `detail.performers` (spread conditional)
        - `composers` = `[...new Set(detail.programme.map(p => p.composer).filter(c => c.length > 0))]` (spread conditional)
        - `description` = `buildDescription(detail.programme, detail.performers)` (spread conditional — may be `undefined`)
    11. `buildDescription(programme, performers): string | undefined` — returns `undefined` if both are empty; otherwise assembles `"Programme: Composer — Work1; Work2; ... Performers: Name (role), ..."` string
    12. `canonicalVenue(building: string, room: string): string` — trim inputs, map per table, fallback with warn
    13. `fetchHtml(url: string, attempt?: number): Promise<string>` — copy from `musikverein.ts`, change log prefix to `[elbphilharmonie]`
    14. `delay(ms: number): Promise<void>` helper

- [ ] **Task 2**: Register `ElbphilharmonieSource` in `src/event-pipeline/index.ts`
  - **File**: `src/event-pipeline/index.ts`
  - **Action**:
    1. Add import: `import { ElbphilharmonieSource } from './event-sources/elbphilharmonie.js';`
    2. Add `new ElbphilharmonieSource()` to the `sources` array in `runPipeline()`
  - **Notes**: No other changes to `index.ts`; no new env vars required

- [ ] **Task 3**: Create live integration test `test/event-pipeline/event-sources/elbphilharmonie.live.test.ts`
  - **File**: `test/event-pipeline/event-sources/elbphilharmonie.live.test.ts` (new file)
  - **Action**: Follow `musikverein.live.test.ts` as template. Implement these test cases:
    1. `'returns at least 5 events'` — log total count
    2. `'all events have required fields'` — `title` truthy, `date` matches `/^\d{4}-\d{2}-\d{2}$/`, `url` contains `elbphilharmonie.de`, `sourceId === 'elbphilharmonie'`, `venue` truthy
    3. `'all event venues are known canonical hall names'` — collect the 6 known canonical strings in a Set; for every `event.venue`, assert it is in the Set using `expect(KNOWN_VENUES).toContain(event.venue)`. **Fail** (do not warn-and-pass) if any unknown venue is returned — this ensures new hall variants are caught immediately.
    4. `'at least one event has performers'` — log count
    5. `'at least one event has composers'` — log count
    6. `'at least one event has a synthesized description'` — log count
    7. `'prints sample events for manual inspection'` — `console.log` first 3 events as JSON

---

### Acceptance Criteria

- [ ] **AC 1**: Given the live site is reachable, when `fetch()` is called, then it returns at least 5 `Event` objects with `title`, `date` (YYYY-MM-DD), `url`, `sourceId === 'elbphilharmonie'`, and `venue` populated.

- [ ] **AC 2**: Given the listing pagination is working, when `fetch()` is called, then events up to approximately 12 months ahead are returned (no events with `date` more than 54 weeks in the future; no events more than 1 week in the past).

- [ ] **AC 3**: Given the genre pre-filter is applied, when `fetch()` completes, then the console log contains the line `'[elbphilharmonie] Genre filter: X excluded, Y remain'` (X ≥ 0, Y ≥ 0).

- [ ] **AC 4**: Given a classical event detail page is fetched, when `parseProgramme` runs and the programme section is present, then `composers` on the returned `Event` contains at least one non-empty composer name deduplicated by exact string.

- [ ] **AC 5**: Given a concert with named soloists and a conductor, when `parsePerformers` runs, then the conductor entry is formatted as `"Name (conductor)"` and soloist entries are formatted as `"Name (role)"`.

- [ ] **AC 6**: Given a detail page fetch returns HTTP 429 or 5xx, when the retry logic runs, then it retries up to 3 times with back-off and only logs a `console.warn` (skips the event without throwing).

- [ ] **AC 7**: Given a single detail page fetch fails permanently (all retries exhausted), when `Promise.allSettled` resolves the batch, then the remaining events in the batch are still mapped and returned — the failure does not abort the batch.

- [ ] **AC 8**: Given a building/room combination not in the canonical map, when `canonicalVenue` is called, then it returns `'${building.trim()} ${room.trim()}'` and logs `console.warn('[elbphilharmonie] Unknown hall: building="..." room="..."')`.

- [ ] **AC 9**: Given `index.ts` is updated, when the Lambda handler initialises, then `ElbphilharmonieSource` is present in the `sources` array and its `id` is `'elbphilharmonie'`.

- [ ] **AC 10**: Given the live test is run with `LIVE=1`, when all assertions pass, then the test suite prints a sample of 3 events as JSON for manual inspection of field quality; and the venue assertion fails if any event has a venue string not in the 6 known canonical values.

---

## Additional Context

### Dependencies

- `cheerio` — already in `package.json` (used by `musikverein.ts`). No new packages required.
- Import: `import { load } from 'cheerio';`

### Testing Strategy

- **Live integration test only** (`LIVE=1` gated, `jest.setTimeout(120_000)`). No unit tests for the source file — consistent with all other event source implementations in the project.
- Run with: `LIVE=1 npx jest test/event-pipeline/event-sources/elbphilharmonie.live.test.ts --verbose`
- After first live run, manually inspect the console output for:
  - Genre filter pass/exclude ratio (adjust regex pattern if too many false positives/negatives)
  - Performer role parsing quality (check for conductor vs soloist order inversion)
  - Programme composer/work extraction completeness
  - Any `Unknown hall` warnings (add new hall to canonical map if needed)

### Notes

- **Volume estimate (unvalidated)**: ~100 events/month × 12 months ≈ 1,200 listing cards before filter. Rough estimate of ~50–70% passing the exclude filter → ~600–850 detail fetches per run. At 5 concurrent + 500ms inter-batch delay: roughly 60–90 seconds for the detail phase. These numbers are unvalidated and will be confirmed after the first live run.
- **Rate limiting**: CloudFront cache TTL on listing pages is 60s — safe for weekly run cadence. 500ms delay between batches is conservative.
- **`x-robots-tag: noai`** on all pages — this directive targets indexing crawlers, not server-side HTTP fetch. The User-Agent `'Mozilla/5.0 (compatible; show-recommender-bot/1.0)'` identifies the bot honestly.
- **`data-categories` always empty** — no server-side genre filter available from the listing API. The text pre-filter is the only option until an LLM classifier is added.
- **Post-POC tuning**: After first run, review pass/reject ratio from logs. If too many jazz/pop events pass through, tighten the exclude regex. If too many classical events are excluded, remove or narrow specific terms.
- **JSON-LD `workPerformed` is not usable** for structured programme extraction — composer names are `CreativeWork` entries with no structural distinction from work titles. Always use the HTML `<h3>Programme</h3>` section instead.
- **Image field**: The `Event` interface has no image field. Thumbnail URL from listing cards is not forwarded. If the interface gains an image field in future, it can be sourced from `ElbCard.thumbnailUrl` (already in the listing HTML).
