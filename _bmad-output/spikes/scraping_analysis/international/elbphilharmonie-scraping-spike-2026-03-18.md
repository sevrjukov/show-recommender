# Elbphilharmonie Hamburg — Scraping Spike

**Date:** 2026-03-18
**Status:** Complete
**Conclusion:** Viable for scraping without a headless browser; plain `fetch` + `cheerio` sufficient. The listing is SSR (all events in initial HTML). Pagination uses a date-based infinite-scroll mechanism via `/ajax/1` endpoints. Full `schema.org/MusicEvent` JSON-LD on every detail page, though the HTML `<h3>Programme</h3>` section is cleaner for programme extraction. No public event API.

---

## Summary

The site runs on a **Django app** served behind CloudFront CDN. The event listing at `/en/whats-on/` is **fully server-side rendered** — all event cards are in the initial HTML response. A JavaScript infinite-scroll layer loads additional batches as the user scrolls, using a date-based URL chain (`/ajax/1` suffix). No Playwright or Puppeteer needed; plain `fetch` + `cheerio` handles the full scrape.

The `api.elbphilharmonie.de` domain hosts auth-gated endpoints only (user profile, cart) — there is no public events API.

---

## Listing Page

```
GET https://www.elbphilharmonie.de/en/whats-on/
```

No headers or auth required. Returns ~15 events (current day + next ~3 days).

---

## Pagination

Elbphilharmonie uses an **infinite scroll with date-based URL chaining**, not a traditional page number scheme.

| Property | Value |
|----------|-------|
| Mechanism | Date-based URL chain: `/en/whats-on/DD-MM-YYYY/ajax/1` |
| Batch size | ~11–16 events per batch (roughly 3–4 days of events) |
| Monthly volume | ~100 events/month (classical + jazz + pop mixed) |
| Season coverage | 2025-08-01 to 2027-07-31 (~1,600 total events) |

**Algorithm:**

1. `GET /en/whats-on/` → returns ~15 events + `<li data-url="/en/whats-on/DD-MM-YYYY/">` element at the bottom of the list
2. For each subsequent batch: `GET [data-url]/ajax/1` → returns more event HTML + new `<li data-url="...">`
3. Repeat until `data-url` points beyond the desired horizon (e.g., 8–12 weeks ahead for a weekly scraper)
4. Stop condition: no `data-url` element in response (end of season) OR date exceeds cutoff

**AJAX response:** Returns raw HTML fragment (event `<li>` elements only, no `<html>` wrapper). Insert directly into the event list.

**Note:** The `/en/whats-on/DD-MM-YYYY/` URL (without `/ajax/1`) returns a full HTML page starting from that date — useful for date-targeted filtering.

---

## DOM Selectors — Listing Cards

Event list container: `<ul id="event-list">`

Each event:
```html
<li id="event_id_[16hex]" data-category="Upcoming" data-event-id="[int]" class="event-item" data-categories="[]">
```

| Field | Element / Pattern | Example |
|-------|-------------------|---------|
| Event hex ID | `li[id]` attribute, strip `event_id_` prefix | `000000e90017e384` |
| Detail page URL | `p.event-title a[href]` | `/en/whats-on/lucas-arthur-jussen.../23117` |
| Numeric event ID | Last path segment of detail URL | `23117` |
| Title | Text inside `p.event-title a` | `Lucas & Arthur Jussen / Alexej Gerassimez` |
| Subtitle | `p.event-subtitle` text | `Works by Steve Reich, George Gershwin...` |
| ISO datetime | `time[datetime]` attribute | `2026-03-18T20:00:00+01:00` |
| Hall building | `<strong>` inside `.place-cell .caption.uppercase` | `Elbphilharmonie` |
| Hall room | Text node after `<strong>` in same span | `Großer Saal` |
| Thumbnail URL | `img[src]` inside `.image-cell picture` (last `<source>` or `<img>`) | `https://d3c80vss50ue25.cloudfront.net/media/filer_public_thumbnails/...` |
| Ticket URL | `a.link-ticket[href]` in `.presale.sale-status` | `/en/whats-on/ticket/[slug]/[id]` |
| Price (min) | `span.price-from span` inside ticket link | `23.60` |
| Sold out indicator | `.soldout-status.status-box` visible (no `style="display:none"`) | `span.link-sold-out` text |

> **Sold-out detection:** The listing card shows either `.soldout-status` (sold out) or `.presale.sale-status` (available). The `display: none` style is toggled by JS but is present in the SSR HTML, so check visibility to determine status.

---

## DOM Selectors — Detail Pages

Detail URL pattern:
```
https://www.elbphilharmonie.de/en/whats-on/[slug]/[numeric_id]
```

Example: `https://www.elbphilharmonie.de/en/whats-on/lucas-arthur-jussen-alexej-gerassimez-emil-kuyumcuyan/23117`

| Field | Element / Pattern | Notes |
|-------|-------------------|-------|
| Event detail head | `div.event-detail-head` | Contains date, venue, title, subtitle |
| ISO datetime | `time[datetime]` in `div.date` | `2026-03-18T20:00:00+01:00` |
| Venue | `a[data-anchor-link]` text: `<strong>[Building]</strong> [Room]` | `Elbphilharmonie Großer Saal` |
| Title | `h1.event-title` | Full event title |
| Subtitle | `p.event-subtitle.subline` | Programme or subtitle text |
| Performers section | `<h3>Performers</h3>` | Followed by `<p class="artists without-space">` elements |
| Performer (standard) | `<p class="artists"><b>Name</b>&ensp;role</p>` | `<b>Lucas Jussen</b>&ensp;piano` |
| Performer (conductor) | `<p class="artists">role&ensp;<b>Name</b></p>` | `conductor&ensp;<b>Martin Peschík</b>` |
| Programme section | `<h3>Programme</h3>` | Followed by `.readmore-wrapper` |
| Programme items | `<p><b>Composer</b><br>Work1<br>Work2...</p>` in `.readmore-wrapper` | Multiple `<br>`-separated works per composer |
| Interval marker | `<span class="pause greyed-text">– Interval – </span>` | Between programme sections |
| Subscription | `<h3>Subscription</h3>` → `<p>` text + `<a href="/en/series/...">` | Series name and link |
| Promoter | `div.block-promoters p` text | `Promoter: Konzertdirektion Dr. Rudolf Goette / HamburgMusik` |
| Location | `aside#venue` → `<h2>...<strong>[Building]</strong><br>[Room]</h2>` | Full address in paragraph below |

> **Performer role pattern:** Role can appear **before** or **after** the name. For soloists: `<b>Name</b>&ensp;role`. For conductors: `role&ensp;<b>Name</b>`. Check which side `<b>` is on to parse correctly.

---

## JSON-LD (Available but Programme Extraction Messier)

Every detail page embeds a `schema.org/MusicEvent` JSON-LD block:

```json
{
  "@context": "http://schema.org/",
  "@type": "MusicEvent",
  "name": "Tschechische Symphoniker Prag / Coro di Praga / Martin Peschík",
  "description": "...",
  "startDate": "2026-03-18T20:00:00+01:00",
  "endDate": "2026-03-18T22:00:00+01:00",
  "location": {
    "@type": "MusicVenue",
    "name": "Laeiszhalle Großer Saal",
    "address": "Johannes-Brahms-Platz,20355 Hamburg"
  },
  "performer": [
    { "@type": "Person", "name": "Martin Peschík" },
    { "@type": "Person", "name": "Tschechische Symphoniker Prag" }
  ],
  "workPerformed": [
    { "@type": "CreativeWork", "name": "Wolfgang Amadeus Mozart" },
    { "@type": "CreativeWork", "name": "Requiem in D minor, K. 626" },
    { "@type": "CreativeWork", "name": "" },
    { "@type": "CreativeWork", "name": "– Interval –" },
    { "@type": "CreativeWork", "name": "Ludwig van Beethoven" },
    { "@type": "CreativeWork", "name": "Symphony No. 5 in C minor, Op. 67" }
  ],
  "offers": [
    { "@type": "Offer", "price": "31.10", "priceCurrency": "EUR", "url": "...", "availability": "http://schema.org/InStock" },
    ...
  ],
  "image": ""
}
```

> **`workPerformed` warning:** Composer names and work titles are interleaved as separate `CreativeWork` entries with no structural distinction. Empty-string entries appear as separators. Parsing requires heuristics (e.g., no `Op.`/`K.`/`BWV` = likely a composer name, not a title). **Recommend using the HTML `<h3>Programme</h3>` section instead** — it uses `<b>Composer</b><br>Work` structure that maps cleanly.

> **`performer` roles missing from JSON-LD:** The `performer` array only contains names, not roles (no conductor/soloist/ensemble distinction). Use the HTML `<h3>Performers</h3>` section for role-aware extraction.

> **`image` is always empty** in JSON-LD. Images are only in listing card HTML (CloudFront CDN).

---

## Fields Available vs Missing

### Listing card

| Field | Available | Notes |
|-------|-----------|-------|
| Numeric event ID | ✅ | From URL slug last segment |
| Title | ✅ | Full title |
| Subtitle | ✅ | Programme teaser |
| ISO datetime | ✅ | `time[datetime]` — includes CET/CEST offset |
| Venue building | ✅ | `Elbphilharmonie` or `Laeiszhalle` |
| Hall room | ✅ | E.g. `Großer Saal`, `Kleiner Saal`, `Studio E` |
| Thumbnail URL | ✅ | CloudFront CDN, responsive `<picture>` |
| Ticket URL | ✅ | `/en/whats-on/ticket/[slug]/[id]` |
| Min ticket price | ✅ | In listing when tickets available |
| Sold-out status | ✅ | `.soldout-status` visibility in HTML |
| Performers (partial) | ❌ | Not in listing card |
| Programme | ❌ | Detail page only |

### Detail page

| Field | Available | Source |
|-------|-----------|--------|
| Full ISO start/end datetime | ✅ | JSON-LD `startDate` / `endDate` |
| Location name + address | ✅ | JSON-LD `location` |
| Description (editorial) | ✅ | JSON-LD `description` |
| Full programme (structured) | ✅ | HTML `<h3>Programme</h3>` → `<p><b>Composer</b><br>Work</p>` |
| Full performer list with roles | ✅ | HTML `<h3>Performers</h3>` → `<p class="artists">` |
| Conductor | ✅ | `conductor&ensp;<b>Name</b>` pattern |
| Subscription series | ✅ | `<h3>Subscription</h3>` |
| Promoter | ✅ | `div.block-promoters` |
| Ticket offers (prices) | ✅ | JSON-LD `offers[]` |
| Duration | ❌ | Not exposed (can infer from `endDate - startDate`) |
| Programme durations | ❌ | Not shown per-work |
| Image | ❌ | Only in listing card (CloudFront) |

---

## Example Entries

### Entry 1 — Orchestral concert

```
Title:        NDR Elbphilharmonie Orchestra / Lawrence Power / James Gaffigan
Subtitle:     Works by Richard Strauss, Grażyna Bacewicz, Felix Mendelssohn and Sergei Prokofiev
Date:         2026-03-19T20:00:00+01:00
Venue:        Elbphilharmonie Großer Saal
Performers:   Lawrence Power: viola
              conductor: James Gaffigan
              NDR Elbphilharmonie Orchester
Programme:    Richard Strauss — Don Juan, Op. 20
              Grażyna Bacewicz — Viola Concerto
              – Interval –
              Felix Mendelssohn — ...
Detail URL:   /en/whats-on/ndr-elbphilharmonie-orchestra-lawrence-power-james-gaffigan/23300
Ticket URL:   /en/whats-on/ticket/ndr-elbphilharmonie-orchestra-lawrence-power-james-gaffigan/23300
```

### Entry 2 — Classical (external promoter, Laeiszhalle)

```
Title:        Tschechische Symphoniker Prag / Coro di Praga / Martin Peschík
Subtitle:     Mozart: Requiem / Beethoven: Sinfonie Nr. 5
Date:         2026-03-18T20:00:00+01:00
Venue:        Laeiszhalle Großer Saal
Programme:    Wolfgang Amadeus Mozart — Requiem in D minor, K. 626 / Sinfonie F-Dur KV 43
              – Interval –
              Ludwig van Beethoven — Symphony No. 5 in C minor, Op. 67
Performers:   Tschechische Symphoniker Prag (orchestra)
              Coro di Praga (choir)
              Monika Brychtová: soprano
              Dita Stejskalová: alto
              Roman Pokorný: tenor
              Jakub Tolaš: baritone
              conductor: Martin Peschík
```

### Entry 3 — Jazz (to illustrate genre filtering needed)

```
Title:        Moving Coil 4
Subtitle:     Jazz at the Kulturcafé / Please note the change of venue
Date:         2026-03-19T18:00:00+01:00
Venue:        Laeiszhalle Studio E
```

---

## JS Rendering Quirks

| Quirk | Impact |
|-------|--------|
| Infinite scroll via `/ajax/1` | Medium — must implement explicit pagination loop; standard page URLs not enough |
| `display: none` on presale/soldout boxes | Low — both elements are in SSR HTML; check style attribute to determine visible state |
| `data-categories="[]"` on all events | None — categories are always empty; no genre filtering at listing level |
| CloudFront CDN for all static assets | None — straightforward absolute URLs in `<img src>` |
| `readmore-wrapper` collapse on programme | None — full text is in SSR HTML; CSS toggle is client-side only |

---

## No Genre Filter Available in Listing

Unlike Berliner Philharmoniker (Typesense `tags:=Piano` filter) or Musikverein (`ORCH`/`KAM` genre codes), Elbphilharmonie exposes **no genre category in the listing HTML**. The `data-categories="[]"` attribute is always empty.

**Recommended genre pre-filter using listing fields:**

- **Include signals (classical likely):** subtitle contains composer surnames (`Mozart`, `Beethoven`, `Brahms`, `Schubert`, etc.); title contains `Orchestra`, `Philharmonic`, `Quartet`, `Ensemble`, `Recital`, `Symphony`, `Concerto`
- **Exclude signals:** subtitle/title contains `Jazz`, `Pop`, `Rock`, `Electronic`, `DJ`, `Comedy`, `Spoken Word`
- **Grey zone:** contemporary/crossover events — apply LLM classifier post-POC

The subtitle field is the most reliable signal: Elbphilharmonie formats classical subtitles as `"Works by [Composer A], [Composer B] and [Composer C]"` or `"[Composer]: [WorkTitle] / [Composer]: [WorkTitle]"`, which is a strong classical indicator.

---

## Venue Coverage

Both halls are in Hamburg. Two buildings, multiple rooms each:

| Canonical ID | Building | Room name(s) | Notes |
|---|---|---|---|
| `hamburg-elbphilharmonie-grosser-saal` | Elbphilharmonie | Großer Saal | Grand Hall, 2,100 seats |
| `hamburg-elbphilharmonie-kleiner-saal` | Elbphilharmonie | Kleiner Saal | Small Hall, 550 seats |
| `hamburg-elbphilharmonie-kaistudio` | Elbphilharmonie | Kaistudio 1 | Chamber/experimental |
| `hamburg-laeiszhalle-grosser-saal` | Laeiszhalle | Großer Saal | 2,032 seats |
| `hamburg-laeiszhalle-brahms-saal` | Laeiszhalle | Johannes Brahms Saal | 639 seats |
| `hamburg-laeiszhalle-studio-e` | Laeiszhalle | Studio E | Intimate, jazz/chamber |

Both venues are operated together; the site covers them equally. POC scope: focus on **Elbphilharmonie** rooms only (exclude Laeiszhalle) if volume is too high — but Laeiszhalle also hosts major classical concerts.

---

## Recommended Scraping Strategy

**One-pass approach (listing + detail):**

**Step 1 — Listing scrape (pagination loop):**
- `GET /en/whats-on/` → extract event cards + `li[data-url]` next-pointer
- Loop: `GET [data-url]/ajax/1` → extract more event cards + next-pointer
- Terminate when next `data-url` is beyond scrape horizon (e.g., 12 weeks out) or no `data-url` element present
- Collect: numeric ID, title, subtitle, ISO datetime, venue, thumbnail URL, detail URL

**Step 2 — Genre pre-filter:**
- Apply to `title + subtitle` before requesting detail pages (saves HTTP requests)
- Include classical signals (composer names in subtitle, orchestra/quartet in title)
- Exclude jazz/pop/DJ signals

**Step 3 — Detail scrape (per filtered event):**
- `GET /en/whats-on/[slug]/[id]`
- Extract: JSON-LD `description`, `offers[]` prices; HTML `<h3>Performers</h3>` for full cast with roles; HTML `<h3>Programme</h3>` for structured programme

---

## Minimal Fetch Recipe

```javascript
import * as cheerio from 'cheerio';

const BASE = 'https://www.elbphilharmonie.de';

async function fetchListingBatch(url) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  const html = await resp.text();
  const $ = cheerio.load(html);

  const events = [];
  $('li.event-item').each((_, el) => {
    const $el = $(el);
    const detailHref = $el.find('p.event-title a').attr('href') || '';
    const numericId = detailHref.split('/').pop();
    const imgSrc = $el.find('.image-cell img').last().attr('src') || '';

    events.push({
      id: numericId,
      title: $el.find('p.event-title a').text().trim(),
      subtitle: $el.find('p.event-subtitle').text().trim(),
      datetime: $el.find('time').attr('datetime'),             // ISO-8601 with offset
      venue: $el.find('.place-cell strong').text().trim(),    // 'Elbphilharmonie' | 'Laeiszhalle'
      room: $el.find('.place-cell .caption').text()
              .replace($el.find('.place-cell strong').text(), '').trim(),
      detailUrl: BASE + detailHref,
      ticketUrl: BASE + ($el.find('a.link-ticket').attr('href') || ''),
      thumbnailUrl: imgSrc,
      soldOut: !$el.find('.soldout-status').attr('style')?.includes('display: none'),
    });
  });

  // Next-page pointer
  const nextUrl = $('li[data-url]').last().attr('data-url') || null;

  return { events, nextUrl };
}

async function* fetchAllUpcoming(horizonWeeks = 12) {
  const horizonDate = new Date();
  horizonDate.setDate(horizonDate.getDate() + horizonWeeks * 7);

  let url = `${BASE}/en/whats-on/`;
  let isFirst = true;

  while (url) {
    const fetchUrl = isFirst ? url : `${BASE}${url}/ajax/1`;
    isFirst = false;

    const { events, nextUrl } = await fetchListingBatch(fetchUrl);
    yield events;

    if (!nextUrl) break;

    // Check if next batch is beyond horizon
    const nextDateStr = nextUrl.match(/(\d{2}-\d{2}-\d{4})/)?.[1];
    if (nextDateStr) {
      const [dd, mm, yyyy] = nextDateStr.split('-');
      const nextDate = new Date(`${yyyy}-${mm}-${dd}`);
      if (nextDate > horizonDate) break;
    }

    url = nextUrl;
    await new Promise(r => setTimeout(r, 500)); // rate limit
  }
}

async function fetchDetail(detailUrl) {
  const resp = await fetch(detailUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${detailUrl}`);
  const html = await resp.text();
  const $ = cheerio.load(html);

  // JSON-LD (for description and offers)
  let jsonLd = {};
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() || '{}');
      if (parsed['@type'] === 'MusicEvent') jsonLd = parsed;
    } catch {}
  });

  // Performers (HTML preferred — includes roles)
  const performers = [];
  $('h3:contains("Performers")').next().find('p.artists').each((_, el) => {
    const $p = $(el);
    const bold = $p.find('b').text().trim();
    const allText = $p.text().trim();
    const nonBold = allText.replace(bold, '').replace(/\u2002/g, ' ').trim(); // &ensp;
    // Determine if name is before or after role
    const bIdx = ($p.html() || '').indexOf('<b>');
    const textBefore = ($p.text().split(bold)[0] || '').trim();
    performers.push({
      name: bold,
      role: nonBold || null,
      isBeforeName: textBefore.length > 0,
    });
  });

  // Programme (HTML preferred — clean Composer → Works structure)
  const programme = [];
  const $prog = $('h3:contains("Programme")').closest('div').find('.readmore-wrapper');
  $prog.find('p').each((_, el) => {
    const $p = $(el);
    const composer = $p.find('b').first().text().trim();
    if (!composer) return; // skip interval markers (they use <span>)
    const htmlContent = $p.html() || '';
    const worksHtml = htmlContent.replace(/<b>[^<]+<\/b>/, '').replace(/<br\s*\/?>/gi, '\n');
    const works = $($('<div>').html(worksHtml).text())
      .toString().split('\n').map(s => s.trim()).filter(Boolean);
    programme.push({ composer, works });
  });

  return {
    ...jsonLd,
    performersFull: performers,
    programmeFull: programme,
  };
}
```

---

## Fields Useful for Recommender

| Use case | Fields | Source |
|----------|--------|--------|
| Display | `title`, `datetime`, `venue` + `room` | Listing HTML |
| Programme | `programmeFull[].composer`, `programmeFull[].works` | Detail HTML |
| Performers | `performersFull[].name`, `.role` | Detail HTML |
| Artist matching | `performersFull[].name` + `programmeFull[].composer` | Detail HTML |
| Genre pre-filter | `subtitle` (composer names pattern) | Listing HTML |
| Deep link | `detailUrl` | Listing HTML |
| Ticket | `ticketUrl`, `soldOut`, JSON-LD `offers[].price` | Listing + Detail |
| Dedup key | Numeric `id` from URL slug (e.g., `23117`) | Listing URL |

---

## Notes & Risks

- **No API key needed.** Plain `fetch`, no auth, no CORS issues for server-side requests.
- **SSR confirmed.** All event cards are in the initial HTML payload — no Playwright needed. JavaScript only handles the scroll-to-load trigger.
- **Infinite scroll rate.** Each AJAX batch covers 3–4 days. A 12-week horizon requires ~25 HTTP requests for the listing step. Add 500 ms delay between batches to be polite.
- **`data-categories` always empty.** Genre filtering must be done via title/subtitle text analysis — no server-side filter available.
- **Two halls, mixed programme.** Laeiszhalle hosts jazz, chamber, and rental events alongside classical. Elbphilharmonie (main building) skews towards classical but also includes pop/crossover. Pre-filter is essential.
- **Subtitle pattern for classical detection.** `"Works by [Composer] and [Composer]"` or `"[Composer]: [Work]"` is a strong indicator. Plain performer names (e.g., `»Albion, Now«`) suggest non-classical.
- **Performers section role order varies.** Conductor always has `role&ensp;<b>Name</b>` (role before name). All other roles are `<b>Name</b>&ensp;role`. Check HTML structure, not just text content.
- **Programme workPerformed in JSON-LD is noisy.** Composer names are `CreativeWork` entries mixed with work titles and empty strings. Do not use for structured extraction — use HTML instead.
- **Image only in listing.** JSON-LD `image` field is always empty string (`""`). Thumbnail is only in the listing card `<picture>` element; not available from detail page alone.
- **`data-event-id` occasionally empty.** Some events have `data-event-id=""` in the listing HTML. Use the numeric ID from the URL slug as the canonical ID instead.
- **CloudFront cache TTL.** Listing pages have 60-second cache. Safe for weekly scraping cadence.
- **`x-robots-tag: noai`** is set on all pages — this is a robots directive but applies to crawlers, not server-side fetch requests.
