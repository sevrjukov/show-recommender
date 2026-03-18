# Czech Classical Music Sources — Scraping Summary

**Date:** 2026-03-18
**Sources covered:** Česká filharmonie, Rudolfinum, FOK, Obecní dům, SOČR
**Spike documents:** `scraping-spike-*.md` in this folder

---

## Source Reference Table

| Source | URL | CMS | Rendering | Headless browser |
|--------|-----|-----|-----------|-----------------|
| Česká filharmonie | ceskafilharmonie.cz/en/whats-on/ | Custom (perspectivo.cz) | SSR + Angular | Not needed |
| Rudolfinum | rudolfinum.cz/en/program/ | Custom (perspectivo.cz) | SSR + Angular | Not needed |
| FOK | fok.cz/en/program | Drupal 11 | SSR | Not needed |
| Obecní dům | obecnidum.cz/en/program/ | WordPress | SSR + AJAX sugar | Not needed |
| SOČR | socr.rozhlas.cz/koncerty-a-vstupenky | Drupal 7 | SSR | Not needed |

**Good news across the board: all five sources are server-side rendered.** No Playwright or Puppeteer required for any of them. Plain `fetch` + `cheerio` is sufficient for the full POC.

---

## Pagination Patterns

Every source uses a different pagination mechanism. Handle each independently.

| Source | Mechanism | Page size | Notes |
|--------|-----------|-----------|-------|
| Česká filharmonie | `?page=N` (1-based) | ~15 | 4 pages / ~68 events |
| Rudolfinum | `?page=N` (1-based) | 10 | 10 pages / ~100 events |
| FOK | `?page=N` **(0-based)** | ~15 | 2 pages / ~16 events near season end |
| Obecní dům | `/page/N/` (1-based) | ~30 | 13 pages / ~390 events |
| SOČR | **None — single page** | ~10–15 | Entire upcoming season on one page |

**FOK is the only 0-based paginator.** `?page=0` = first page. Easy off-by-one error.

**Obecní dům has the largest catalogue** (~390 events) because it is a general venue hosting many non-classical commercial concerts alongside FOK and recitals — genre filtering is especially important here.

**SOČR requires no loop at all** — one GET, done.

---

## Structured Data Availability

| Source | JSON-LD type | Useful for scraping? |
|--------|-------------|----------------------|
| Česká filharmonie | `schema.org/Event` on detail pages | ✅ Yes — ISO dates, partial performers, description, location with address |
| Rudolfinum | None | ❌ |
| FOK | None | ❌ |
| Obecní dům | `schema.org/WebPage` on detail pages | ❌ — contains only page title and thumbnail URL, no event data |
| SOČR | None (but `dataLayer["airedDate"]` in `<script>`) | ⚠️ Partial — ISO datetime only |

**Česká filharmonie is the only source with proper Event JSON-LD.** For all others, all data must be extracted from HTML.

**The `dataLayer` on SOČR** is the next best thing: it provides `airedDate` as an ISO timestamp (`2026-03-24 19:30:00`), avoiding Czech-locale date string parsing. Worth checking for on other Drupal/Czech Radio properties in later phases.

---

## Performer Data Patterns

Every source uses a different delimiter between performer name and role. The scraper needs a separate parser per source — or a unified parser that detects the delimiter.

| Source | Pattern | Example |
|--------|---------|---------|
| Česká filharmonie | `<strong>Name</strong> <em>role</em>` | `<strong>Sol Gabetta</strong> <em>cello</em>` |
| Rudolfinum | `<strong>Name</strong> <em>role</em>` | Same as CF (shared CMS) |
| FOK | `<strong>Name</strong> \| role` (pipe) | `<strong>Marko Letonja</strong> \| conductor` |
| Obecní dům | `Name \| role` (pipe, no `<strong>`) | `Olivier Latry \| organ` |
| SOČR | `Name, role` (comma, plain text) | `Robert Jindra, dirigent` |

**CF and Rudolfinum share the same `<strong>`+`<em>` structure** — they run on the same or closely related CMS.

**FOK and Obecní dům both use the pipe `|` pattern**, though FOK wraps names in `<strong>` and Obecní dům doesn't always. They share the Colosseum.eu ticketing system (same `online.colosseum.eu/fok/` path), suggesting organisational ties.

**SOČR's comma pattern is the most fragile** because commas appear in work titles, venue names, and Czech dates. Scope the performer regex to the correct `<p>` block within `.field.body`.

---

## Programme Data Patterns

| Source | Format | Location | Work duration? |
|--------|--------|----------|---------------|
| Česká filharmonie | `<strong>Composer</strong>` + text node | `<h2>Programme</h2>` section on detail page | ✅ In parentheses |
| Rudolfinum | Same as CF | Same as CF | ✅ In parentheses |
| FOK | `<strong>Composer</strong>` + text node | Detail page body | ❌ Usually absent |
| Obecní dům | `<h3>Composer</h3>` + text node | Detail page body (no class) | ❌ Usually absent |
| SOČR | `Composer: Work (duration)` plain text in `<p>` | `.field.body` shared with performers | ✅ In parentheses |

**CF and Rudolfinum again share identical structure**, with the cleanest semantic separation (an `<h2>Programme</h2>` header anchors the section).

**Obecní dům uses `<h3>` for composers** rather than `<strong>` — the same tag also appears as section headers, so positional logic may be needed.

**SOČR embeds duration in the programme text** (`39 min.`) which is useful for display and can help filter out very short works.

---

## Image Availability

| Source | Images available? | Format | How to get |
|--------|------------------|--------|------------|
| Česká filharmonie | ✅ | JPEG, CDN | `<img src>` in listing card |
| Rudolfinum | ❌ | Placeholder only | `/Assets/images/image-empty.png` everywhere |
| FOK | ✅ | WebP, `styles/2240` | `<img src>` in listing card |
| Obecní dům | ✅ | JPEG, WordPress media | `<img src>` in listing card |
| SOČR | ⚠️ | JPEG, Drupal files | CSS `background-image: url(...)` on wrapper div — no `<img>` tag |

**Rudolfinum has no real images anywhere.** For events scraped exclusively from Rudolfinum (Prague Philharmonia, Prague Radio Symphony, Collegium 1704), there will be no thumbnail unless a secondary source is found.

**SOČR requires style attribute parsing** to get the image URL. The image is present in the HTML, just not as an `<img>` tag.

---

## Ticket URL Availability

| Source | Ticket URL in HTML? | System | Notes |
|--------|---------------------|--------|-------|
| Česká filharmonie | ✅ | tickets.ceskafilharmonie.cz | On detail page |
| Rudolfinum | ✅ | Redirects to organizer site | Href goes to CF, FOK, etc. |
| FOK | ✅ | Colosseum.eu | Detail page → Colosseum |
| Obecní dům | ✅ | Colosseum.eu | **Direct link with event ID** in listing card href |
| SOČR | ❌ | Unknown | Drupal modal — destination not in static HTML |

**Obecní dům is the only source where the Colosseum event ID is directly in the listing card** (`/Index/[eventID]/` in the ticket href). This ID is the same across obecnidum.cz and fok.cz for shared events and can serve as a cross-site dedup key.

**SOČR's ticket URL is completely inaccessible** from static HTML — link users to the detail page and let them click through.

---

## Multiple Dates Per Event

| Source | One post per date? | Notes |
|--------|-------------------|-------|
| Česká filharmonie | ✅ Yes | Each performance is a separate listing entry |
| Rudolfinum | ❌ No | One detail page lists all dates for a programme run |
| FOK | ❌ No | Same — multiple dates on one detail page |
| Obecní dům | ✅ Yes | Each WordPress post = one performance |
| SOČR | ✅ Yes | One listing entry per concert |

**Rudolfinum and FOK require date-splitting logic** in the detail scraper: iterate all date text nodes on a detail page and emit one event record per date. For CF, Obecní dům, and SOČR this is not needed.

---

## Cross-Site Event Overlap

Several concerts appear on multiple sites simultaneously. Without dedup, the same event will appear twice in the recommender digest.

| Overlap | Sites | Dedup key |
|---------|-------|-----------|
| Czech Philharmonic concerts | ceskafilharmonie.cz + rudolfinum.cz | **Same numeric event ID** in URL slug (e.g. `33763`) |
| FOK concerts at Dvořák Hall | fok.cz + rudolfinum.cz | `hash(date + venue + conductor)` — no shared ID |
| FOK concerts at Smetana Hall | fok.cz + obecnidum.cz | **Colosseum event ID** in ticket href (same ID on both sites) |
| SOČR concerts at Rudolfinum | socr.rozhlas.cz + rudolfinum.cz | `hash(date + venue + conductor)` |
| SOČR concerts at Obecní dům | socr.rozhlas.cz + obecnidum.cz | `hash(date + venue + conductor)` or Colosseum ID |

### Recommended dedup strategy

**Primary key:** `hash(normalized_date + normalized_venue + normalized_conductor)`

- Normalize dates to ISO (`YYYY-MM-DD HH:MM`)
- Normalize venues to canonical IDs (see below)
- Normalize conductor: lowercase, strip diacritics, take first + last name only

**Secondary key (where available):** numeric event ID from URL slug or Colosseum ID

The hash-based approach handles all overlap cases uniformly, including sites with no shared IDs.

---

## Venue Coverage Map

All five sources cover Prague exclusively. Canonical venue IDs for normalization:

| Canonical ID | Venue name(s) used across sites |
|---|---|
| `prague-rudolfinum-dvorak` | "Dvořák Hall", "Rudolfinum — Dvořák Hall", "Rudolfinum, Dvořák Hall" |
| `prague-rudolfinum-suk` | "Suk Hall", "Rudolfinum — Suk Hall" |
| `prague-obecni-dum-smetana` | "Smetanova síň", "Municipal House, Smetana Hall", "Smetana Hall" |
| `prague-obecni-dum-greguv` | "Grégrův sál" |
| `prague-cr-studio1` | "Studio 1, Český rozhlas", "Studio 1" |
| `prague-bethlehem-chapel` | "Betlémská kaple" |
| `prague-st-agnes` | "Convent of St Agnes of Bohemia" |

---

## Source Authoritative Hierarchy

When the same concert appears on multiple sites, prefer the source with richer data:

1. **Česká filharmonie** — richest (Event JSON-LD, images, full programme/performers on detail page)
2. **FOK** — second richest (real images, structured HTML, authoritative for all FOK events)
3. **Obecní dům** — good (real images, Colosseum ID, one-post-per-date simplicity) but mixes commercial events
4. **SOČR** — adequate (dataLayer date, but comma-delimited text and no ticket URL)
5. **Rudolfinum** — lowest (no images, no JSON-LD) — use only for organizers with no dedicated site (Prague Philharmonia, Prague Radio Symphony, Collegium 1704)

**Rule:** if an event is covered by a higher-ranked source, skip the lower-ranked duplicate rather than merging — merging adds complexity for minimal gain at POC scale.

---

## Shared CMS Clusters

Two clusters of sites share platforms and HTML patterns. This means scrapers can share code:

**Cluster A — perspectivo.cz custom CMS (shared schema.org-style event IDs):**
- Česká filharmonie
- Rudolfinum
- Same event IDs, same performer `<strong>`+`<em>` pattern, same URL slug format, same programme structure

**Cluster B — Colosseum.eu ticketing (shared ticket URL pattern):**
- FOK
- Obecní dům
- Same `online.colosseum.eu/fok/standard/Hall/Index/[eventID]/` URL structure
- Colosseum event ID is a reliable cross-site dedup key within this cluster

---

## Czech-Locale Date Parsing

Three sites use Czech month names or date formats. Build one shared normalizer:

| Format | Example | Sites |
|--------|---------|-------|
| `DD. M. YYYY v HH.MM hodin` | `20. 4. 2026 v 19.30 hodin` | SOČR |
| `DD. Month YYYY Weekday HH.MMpm` | `18 Mar 2026 Wednesday 7.30pm` | CF listing |
| `Weekday DD. Month HH.MMpm` | `Wednesday 18. March 7.30pm` | Rudolfinum |
| `Weekday, DD Mon YYYY - HH:MM` | `Wed, 18 Mar 2026 - 19:30` | FOK |
| `DD Month, Weekday HH:MM` | `18 March, Friday 20:00` | Obecní dům |
| `YYYY-MM-DD HH:MM:SS` | `2026-03-24 19:30:00` | SOČR dataLayer ✅ |
| ISO 8601 | `2026-03-18T19:30:00` | CF JSON-LD ✅ |

**Prefer machine-readable dates where available** (CF JSON-LD `startDate`, SOČR `dataLayer["airedDate"]`). For the others, a Czech month name map is needed:

```javascript
const CZECH_MONTHS = {
  ledna:1, února:2, března:3, dubna:4, května:5, června:6,
  července:7, srpna:8, září:9, října:10, listopadu:11, prosince:12,
  // abbreviated
  jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
  jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
};
```

---

## Risks and Open Questions

### High priority

| Risk | Affected sources | Mitigation |
|------|-----------------|------------|
| Programme/performer `<strong>` disambiguation | CF, Rudolfinum, FOK | Scope to the section anchored by `<h2>Programme</h2>` / `<h2>Performers</h2>` headers; validate on 20+ events before deploying |
| SOČR `.field.body` shared container | SOČR | Heuristic (colon = programme, comma = performer) needs manual validation on edge cases |
| FOK 0-based pagination | FOK | Off-by-one if not handled; `?page=0` == page 1 |
| Obecní dům commercial noise | Obecní dům | Genre pre-filter on performing-org name and title keywords before detail scrape |

### Medium priority

| Risk | Affected sources | Mitigation |
|------|-----------------|------------|
| perspectivo.cz CMS upgrade | CF, Rudolfinum | Both on same platform; a redesign breaks two scrapers at once. Monitor together |
| FOK slug reuse across seasons | FOK | `/en/beethoven-fate-symphony` may reappear next season. Include year from date in dedup key |
| SOČR Drupal 7 EOL | SOČR | Drupal 7 reached end of life; site likely to migrate. Lower confidence in long-term stability |
| Rudolfinum `?organizer=` param stability | Rudolfinum | Slug-based organizer params (e.g. `collegium-1704`) are stable but not guaranteed |

### Low priority / deferred

| Risk | Notes |
|------|-------|
| Obecní dům date filter params | `?datefrom=` / `?dateto=` params not confirmed stable; use pagination for now |
| SOČR ticket URL | Currently inaccessible; revisit if Drupal modal URL can be found via browser HAR analysis |
| Image fallback for Rudolfinum events | No images for Prague Philharmonia/Radio Symphony/Collegium 1704; acceptable for POC |

---

## Recommended Implementation Order

Based on data richness, scraper simplicity, and unique event coverage:

| Priority | Source | Reason |
|----------|--------|--------|
| 1 | **Česká filharmonie** | Richest data (JSON-LD), cleanest extraction, establishes baseline schema |
| 2 | **FOK** | Second richest; covers Smetana Hall and other Prague venues; small catalogue = fast iteration |
| 3 | **SOČR** | No pagination, tiny catalogue, pure classical — easiest possible scraper |
| 4 | **Rudolfinum** | Adds Prague Philharmonia, Prague Radio Symphony, Collegium 1704 coverage not available elsewhere |
| 5 | **Obecní dům** | Largest catalogue, most noise — add last once pre-filter logic is validated |

---

## Shared Scraper Architecture Suggestion

Given the patterns above, the fetch module should have:

```
scrapers/
  base-scraper.js          ← shared: fetch, rate-limit, retry, date normalizer, venue normalizer
  perspectivo-scraper.js   ← shared by CF + Rudolfinum (same CMS, same HTML patterns)
  ceska-filharmonie.js     ← extends perspectivo; uses JSON-LD; CF-specific config
  rudolfinum.js            ← extends perspectivo; ?organizer= filter; multi-date splitting
  fok.js                   ← Drupal 11; 0-based pagination; pipe delimiter; multi-date splitting
  obecni-dum.js            ← WordPress; /page/N/ pagination; Colosseum ID extraction
  socr.js                  ← Drupal 7; single-page; CSS bg-image; dataLayer date; comma delimiter
```

**Shared utilities needed:**
- `normalizeDate(rawString, sourceLocale)` → ISO string
- `normalizeVenue(rawName)` → canonical venue ID
- `extractColosseum Id(hrefString)` → event ID or null
- `dedup(events, existingLog)` → filtered event list
