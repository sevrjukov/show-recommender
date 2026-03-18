# Musikverein Wien — Scraping Spike

**Date:** 2026-03-18
**Status:** Complete
**Conclusion:** Viable without a headless browser. Two complementary sources: (1) SSR monthly listing page at `spielplan.musikverein.at/spielplan?month=YYYY-MM` for all events and basic fields; (2) unauthenticated JSON API at `spielplan.musikverein.at/e/[ID].json` for full cast and programme. No auth required for either.

---

## Summary

Musikverein uses a **two-tier architecture**:

- **WordPress site** (`musikverein.at`) — main public-facing CMS. Has a `/konzert/?id=` template page that is a pure JS-rendered shell; it pulls all data from the JSON API at runtime. Not useful for scraping directly.
- **Kirby CMS** (`spielplan.musikverein.at`) — the authoritative schedule engine. The listing page at `/spielplan` is **server-side rendered** and contains all events for the current month. A separate JSON endpoint at `/e/[ID].json` returns the full structured data for each event.

The WordPress main site embeds the Kirby listing page in an iframe. Kirby's REST API panel endpoints (`/api/...`) require authentication (401), but the listing page and the per-event JSON endpoint are **fully public**.

---

## Source 1 — Listing Page

```
GET https://spielplan.musikverein.at/spielplan?month=YYYY-MM
```

No headers or auth required.

### Pagination

| Property | Value |
|----------|-------|
| Mechanism | URL query parameter `?month=YYYY-MM` |
| Page size | All events for the month (no further pagination) |
| Current season months | `2026-03` through `2026-12` (from `<select id="month">` dropdown) |
| Events per month | ~96–109 (50 own events + 44–59 external events in observed months) |

**Pattern:**
```
https://spielplan.musikverein.at/spielplan                  ← current month
https://spielplan.musikverein.at/spielplan?month=2026-04    ← April 2026
https://spielplan.musikverein.at/spielplan?month=2026-12    ← December 2026
```

Iterate months by reading the `<select id="month">` option values from the first page.

---

## DOM Selectors — Listing Cards

Events are grouped under `<li class="day">` elements (one per day), then listed as siblings.

### Container

```html
<div class="event [EV|FV]" id="[HEX_ID]">
```

| Class | Meaning |
|-------|---------|
| `EV` | Eigenveranstaltung — Musikverein own event |
| `FV` | Fremdveranstaltung — external/rented event |

`id` attribute = hex event ID (e.g. `000571db`).

### Fields on listing card

| Field | Selector | Format | Example |
|-------|----------|--------|---------|
| Event ID | `div.event[id]` attribute | 8-char hex | `000571db` |
| Detail URL | `a[href*="konzert/?id="]` | absolute URL | `https://musikverein.at/konzert/?id=000571db` |
| Date | first `<p class="">` inside `.event--date-time a` | `DD.MM.YYYY` | `19.03.2026` |
| Time (start–end) | second `<p class="">` inside `.event--date-time a` | `HH:MM Uhr - HH:MM Uhr` | `19:30 Uhr  - 21:30 Uhr` |
| Hall | first `<p class="text">` inside `.event--date-time a` | plain text | `Großer Saal` |
| Venue | second `<p class="text">` inside `.event--date-time a` | plain text | `Musikverein` |
| Title | `h3.event--heading` | plain text | `Wiener Philharmoniker` |
| Performers (summary) | first `<p class="text">` (not `.veranstalter`) inside `.event--main a` | `•`-separated | `Zubin Mehta • Pinchas Zukerman` |
| Programme (summary) | second `<p class="text">` (not `.veranstalter`) inside `.event--main a` | `•`-separated composers | `Weber • Bruch • Beethoven` |
| Organizer | `<p class="text veranstalter">` inside `.event--main` | prefix "Eingemietete Veranstaltung von: " | `Eingemietete Veranstaltung von: Gesellschaft der Musikfreunde in Wien` |
| Ticket URL | `<a class="ticket-link" href="...">` | absolute URL | `https://shop.musikverein.at/selection/event/seat?perfId=10229285630966` |
| Image | `<a class="enrichment" style="background-image: url(...)">` | relative path | `/enrichment/uploads/pictures/concert/Zubin_Mehta_...jpg` |

> **Image:** Prepend `https://spielplan.musikverein.at` to the relative image path from the CSS `background-image` attribute.

### Raw card example

```html
<div class="event EV" id="000571db">
  <div class="event-text-container">
    <div class="event--date-time text">
      <div class="filter fremd"><p>Fremdveranstaltung</p></div>
      <div class="filter eigen"><p>Eigenveranstaltung</p></div>
      <a href="https://musikverein.at/konzert/?id=000571db" target="_blank">
        <p class="">19.03.2026 </p>
        <p class="">19:30 Uhr  - 21:30 Uhr</p>
        <p class="text">Großer Saal</p>
        <p class="text">Musikverein</p>
      </a>
    </div>
    <div class="event--main">
      <a href="https://musikverein.at/konzert/?id=000571db" target="_blank">
        <h3 class="event--heading">Wiener Philharmoniker</h3>
        <p class="text">Zubin Mehta • Pinchas Zukerman</p>
        <p class="text">Weber • Bruch • Beethoven</p>
        <p class="text veranstalter">Eingemietete Veranstaltung von: Gesellschaft der Musikfreunde in Wien</p>
      </a>
    </div>
    <div class="event--ticketing">
      <a href="https://shop.musikverein.at/selection/event/seat?perfId=10229285630966"
         class="ticket-link" target="_blank">
        <span>Tickets</span>
      </a>
    </div>
  </div>
  <a class="enrichment" href="https://musikverein.at/konzert/?id=000571db" target="_blank"
     style="background-image: url('/enrichment/uploads/pictures/concert/Zubin_Mehta_Sooni_Taraporevala.jpg');"></a>
</div>
```

---

## Source 2 — Event Detail JSON API

```
GET https://spielplan.musikverein.at/e/[HEX_ID].json
```

No headers or auth required. Returns structured JSON for a single event.

### Top-level keys

| Key | Contents |
|-----|----------|
| `booking.data[0]` | Main event metadata |
| `cast.data[]` | Full performer list with roles |
| `program.data[]` | Full programme/works list |
| `promoter.data[]` | Organizer(s) |
| `related` | Related events (false or array) |
| `distributionChannels.data[]` | Subscription/series codes |
| `relatedEnrichments` | Related editorial content |

### `booking.data[0]` fields

| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `ID` | string | `"000000e9:000571db"` | Full entity ID (entity prefix + hex booking ID) |
| `name_1_web_D` / `_E` | string | `"Wiener Philharmoniker"` | Main title (German/English) |
| `name_2_web_D` / `_E` | string | `"Zubin Mehta • Pinchas Zukerman"` | Performer summary |
| `name_3_web_D` / `_E` | string | `"Weber • Bruch • Beethoven"` | Composer summary |
| `venue_description` | string | `"Musikverein"` | Building name |
| `room_description` | string | `"Großer Saal"` | Hall name |
| `date_start` | string | `"2026-03-19 19:30:00"` | Local Vienna time (CET/CEST), space-separated |
| `date_end` | string | `"2026-03-19 21:30:00"` | Estimated end time |
| `activity_status_description` | string | `"Konzert"` | Event type label |
| `activity_status_code` | string | `"Kzt"` | Short code for event type |
| `promoter_type_code` | string | `"EV"` / `"FV"` | Own vs. external event |
| `booking_status_code` | string | `"FIX"` | Booking status |
| `booking_status_is_cancelled` | string | `"False"` | String boolean |
| `is_ticketing_active` | string | `"True"` | String boolean |
| `secutix_id` | string | `"10229285630966"` | Ticket system ID → ticket URL |
| `ev_note_communication` | string | HTML | Event notes (e.g. sustainability badge) |
| `comm_important_note_1_ch_0_html_D` | string | HTML | Important note for attendees |
| `date_update` | string | `"2026-03-17 02:17:12"` | Last modified timestamp |

> **Ticket URL:** `https://shop.musikverein.at/selection/event/seat?perfId=[secutix_id]`

### `cast.data[]` fields

| Field | Type | Example |
|-------|------|---------|
| `name_D` / `name_E` | string | `"Zubin Mehta"` |
| `profession_D` | string | `"Dirigent"`, `"Violine"`, `"Orchester"` |
| `role_D` | string | specific role (often empty) |
| `performer_display_mode` | string | `"H"` (headliner), `"K"` (ensemble) |
| `website_target` | string | `"Dirigent"`, `"Orchester"`, `"Instrumentalsolist"` |
| `order` | string | display order |

### `program.data[]` fields

| Field | Type | Example |
|-------|------|---------|
| `composer_author` | string | `"Ludwig van Beethoven"` (or `"***"` = TBA) |
| `opus_titel_D` / `_E` | string | `"Symphonie Nr. 7 A-Dur, op. 92"` |
| `order` | int | programme order (1-indexed) |
| `is_encore` | int | `0` / `1` |
| `is_text` | int | `0` / `1` (spoken/text item) |

---

## Fields Available vs Missing

### Listing page

| Field | Available | Source |
|-------|-----------|--------|
| Event ID | ✅ | `div.event[id]` attribute |
| Date | ✅ | `DD.MM.YYYY` format |
| Start + End time | ✅ | `HH:MM Uhr - HH:MM Uhr` |
| Hall | ✅ | `<p class="text">` in date-time block |
| Main title | ✅ | `h3.event--heading` |
| Performers summary | ✅ | `•`-separated text |
| Programme summary | ✅ | `•`-separated composer names |
| Event type (EV/FV) | ✅ | CSS class on `div.event` |
| Organizer name | ✅ | `<p class="text veranstalter">` |
| Ticket URL | ✅ | `<a class="ticket-link">` — absent if not on sale |
| Image | ✅ | CSS `background-image` in `.enrichment` link |
| Detail URL | ✅ | `href` on links inside card |
| Full cast with roles | ❌ | JSON API only |
| Full programme with work titles | ❌ | JSON API only |
| ISO datetime | ❌ | JSON API only (`date_start` field) |
| Cancelled flag | ❌ | JSON API only |

### JSON API (`/e/[ID].json`)

| Field | Available |
|-------|-----------|
| ISO datetime (local) | ✅ `booking.date_start` |
| Full cast + roles | ✅ `cast.data[]` |
| Full programme with opus titles | ✅ `program.data[]` |
| Is ticketing active | ✅ `is_ticketing_active` |
| Event cancelled | ✅ `booking_status_is_cancelled` |
| English title/programme | ✅ `_E` suffix fields |
| Subscription/series code | ✅ `distributionChannels` |

---

## Example Entries

### Entry 1 — Flagship concert (own event)

```
ID:           000571db
Date:         19 Mar 2026, Thursday
Time:         19:30 – 21:30
Hall:         Großer Saal
Type:         EV (Eigenveranstaltung)
Title:        Wiener Philharmoniker
Performers:   Zubin Mehta (Dirigent), Pinchas Zukerman (Violine), Wiener Philharmoniker (Orchester)
Programme:    Carl Maria von Weber – Ouvertüre zur romantischen Oper „Oberon"
              Max Bruch – Konzert für Violine und Orchester g-Moll, op. 26
              Ludwig van Beethoven – Symphonie Nr. 7 A-Dur, op. 92
Ticket URL:   https://shop.musikverein.at/selection/event/seat?perfId=10229285630966
Image:        https://spielplan.musikverein.at/enrichment/uploads/pictures/concert/Zubin_Mehta_Sooni_Taraporevala.jpg
Detail URL:   https://musikverein.at/konzert/?id=000571db
```

### Entry 2 — Chamber concert (external event)

```
ID:           00117a06
Date:         19 Mar 2026, Thursday
Time:         20:00 – 22:00
Hall:         Brahms-Saal
Type:         FV (Fremdveranstaltung)
Title:        Haydn-Quartett
Programme:    Haydn • Beethoven • Smetana  (summary only; full works via JSON API)
Detail URL:   https://musikverein.at/konzert/?id=00117a06
```

### Entry 3 — Non-musical event (needs filtering)

```
ID:           0007dd32
Date:         18 Mar 2026, Wednesday
Time:         18:00 – 19:00
Hall:         Brahms-Saal
Title:        Vortrag Marcus Wadsak          ← "Vortrag" = lecture, not a concert
Type:         EV
```

---

## Genre / Classification Filters

The listing page form (`POST /spielplan`) accepts these filter parameters — they can also be passed as GET query params:

| Param | Values | Description |
|-------|--------|-------------|
| `month` | `YYYY-MM` | Month selector |
| `code` | `ORCH`, `KAM`, `STRQUA`, `CHOR`, `AM`, `LES`, `KIJU`, `GESSOL`, `INSTRSOL` | Genre code |
| `interpreter_name` | string | Performer name search |
| `composer_author` | string | Composer name search |
| `date_start_from` | `YYYY-MM-DD` | Date filter (from) |

> The form uses `method="post"` but genre/month can also be passed as GET params (e.g. `?month=2026-04&code=KAM`). The reset button uses `window.location.href` which confirms GET params work.

### Useful genre codes for classical recommender

| Code | Meaning |
|------|---------|
| `ORCH` | Orchestermusik (orchestral) |
| `KAM` | Kammermusik (chamber) |
| `STRQUA` | Streichquartett (string quartet) |
| `CHOR` | Chormusik (choral) |
| `AM` | Alte Musik (early music) |
| `GESSOL` | Gesangssolist (vocal soloists) |
| `INSTRSOL` | Instrumentalsolist (instrumental soloists) |

---

## Halls at Musikverein

| Room | Notes |
|------|-------|
| Großer Saal | Main hall ("Golden Hall") — flagship concerts |
| Brahms-Saal | Second largest — recitals, chamber |
| Gläserner Saal / Magna Auditorium | Modern glass hall |
| Schubert-Saal | Smaller recital hall |
| Metallener Saal | Smaller hall |

---

## Recommended Scraping Strategy

**Two-phase approach:**

**Phase 1 — Monthly listing scrape:**
```
for month in available_months:
    GET https://spielplan.musikverein.at/spielplan?month={month}
    extract: event_id, date, time, hall, title, performers_summary,
             programme_summary, event_type (EV/FV), ticket_url, image_url
    apply genre pre-filter (see below)
```

**Phase 2 — Selective JSON API fetch (per matched event only):**
```
for each event that passes pre-filter:
    GET https://spielplan.musikverein.at/e/{event_id}.json
    extract: full cast[], full programme[], ISO datetime, cancelled flag
```

**Genre pre-filter** (apply on listing data before JSON API requests):
- **Include** `EV` events: reliable programme content
- **Include** `FV` events if title/programme keywords match (chamber, recital, soloist)
- **Exclude by title keyword**: `Vortrag`, `Talkrunde`, `Führung`, `Workshop`, `Kinderkonzert` (unless KIJU is out of scope)
- **Exclude by genre code** if using POST filter: `LES` (Lesung/readings), `KIJU` (children's)
- **Include by genre code**: `ORCH`, `KAM`, `STRQUA`, `AM`, `GESSOL`, `INSTRSOL`

> For POC, scraping all events and filtering by title keyword is simpler than making separate requests per genre.

---

## Minimal Fetch Recipe

```javascript
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const BASE = 'https://spielplan.musikverein.at';

async function fetchMonthListing(month) {
  const url = month
    ? `${BASE}/spielplan?month=${month}`
    : `${BASE}/spielplan`;
  const html = await fetch(url).then(r => r.text());
  const $ = cheerio.load(html);

  const events = [];
  $('div.event').each((_, el) => {
    const $el = $(el);
    const id = $el.attr('id');
    const eventType = $el.hasClass('EV') ? 'EV' : 'FV';
    const dateTimeLinks = $el.find('.event--date-time a');
    const ps = dateTimeLinks.find('p');

    const date = ps.eq(0).text().trim();         // DD.MM.YYYY
    const timeRange = ps.eq(1).text().trim();    // HH:MM Uhr - HH:MM Uhr
    const hall = ps.filter('.text').eq(0).text().trim();
    const venue = ps.filter('.text').eq(1).text().trim();

    const mainPs = $el.find('.event--main p.text').not('.veranstalter');
    const performers = mainPs.eq(0).text().trim();
    const programme = mainPs.eq(1).text().trim();

    const ticketUrl = $el.find('a.ticket-link').attr('href') || null;
    const imgStyle = $el.find('a.enrichment').attr('style') || '';
    const imgMatch = imgStyle.match(/url\('?([^')]+)'?\)/);
    const imageUrl = imgMatch ? BASE + imgMatch[1] : null;

    events.push({
      id, eventType, date, timeRange, hall, venue,
      title: $el.find('h3.event--heading').text().trim(),
      performers, programme, ticketUrl, imageUrl,
      detailUrl: `https://musikverein.at/konzert/?id=${id}`,
    });
  });

  return events;
}

async function fetchEventDetail(id) {
  const data = await fetch(`${BASE}/e/${id}.json`).then(r => r.json());
  const booking = data.booking.data[0];
  return {
    titleDe: booking.name_1_web_D,
    titleEn: booking.name_1_web_E,
    dateStart: booking.date_start,       // "YYYY-MM-DD HH:MM:SS" local Vienna time
    dateEnd: booking.date_end,
    hall: booking.room_description,
    activityType: booking.activity_status_description,
    secutixId: booking.secutix_id,
    ticketUrl: booking.secutix_id
      ? `https://shop.musikverein.at/selection/event/seat?perfId=${booking.secutix_id}`
      : null,
    isCancelled: booking.booking_status_is_cancelled === 'True',
    isTicketingActive: booking.is_ticketing_active === 'True',
    cast: (data.cast.data || []).map(c => ({
      name: c.name_D,
      role: c.profession_D,
      displayMode: c.performer_display_mode,
    })),
    programme: (data.program.data || [])
      .filter(p => p.composer_author !== '***')
      .sort((a, b) => a.order - b.order)
      .map(p => ({
        composer: p.composer_author,
        work: p.opus_titel_D,
        isEncore: !!p.is_encore,
      })),
  };
}
```

---

## Fields Useful for Recommender

| Use case | Fields | Source |
|----------|--------|--------|
| Display | `title`, `date`, `timeRange`, `hall` | Listing HTML |
| Programme matching | `programme` (summary), `cast[].composer`, `programme[].work` | Listing / JSON API |
| Performer matching | `performers` (summary), `cast[].name`, `cast[].role` | Listing / JSON API |
| Classification | `eventType` (EV/FV), `activityType` | Listing / JSON API |
| Deep link | `detailUrl` | Listing HTML |
| Dedup key | `id` (hex event ID) | Listing HTML |
| Ticket | `ticketUrl` | Listing HTML or JSON API `secutix_id` |
| ISO datetime | `dateStart` | JSON API only |
| City | Vienna (hardcode — all events at Musikverein Wien) | — |

---

## Notes & Risks

- **No API key or auth needed** for either the listing page or the JSON API. Both are public.
- **JSON API is not documented** — reverse-engineered from the WordPress concert detail page JS. The endpoint `spielplan.musikverein.at/e/[ID].json` was found in a `const url = ...` statement in the page's inline script.
- **Kirby REST API requires auth** (`401` on `/api/...`) — not needed; use the listing page and JSON endpoint instead.
- **Date format in listing**: `DD.MM.YYYY` German locale; prefer `date_start` from JSON API for ISO parsing.
- **Time format in listing**: `HH:MM Uhr - HH:MM Uhr` with possible double-space; strip and parse as 24h.
- **`booking_status_is_cancelled` is a string `"True"/"False"`**, not a real boolean — check with `=== 'True'`.
- **`programme[].composer_author === "***"`** = programme TBA; filter these out.
- **~50% of events are `FV` (external)** — these are not Musikverein productions. They appear on the schedule but may have different data quality. For classical music recommender, include both: quality concerts happen under `FV` (e.g. chamber music series, visiting ensembles).
- **Non-concert events mixed in** (~20–30% of listing): lectures (Vortrag), talks (Talkrunde), tours (Führung), children's events. Filter by title keywords or use `code` genre param to pre-filter.
- **Season scope**: months `2026-03` through `2026-12` observed. At season rollover (typically August/September), the dropdown will include next season months. The scraper should re-read the available months from the dropdown each run.
- **Image paths are relative** to `spielplan.musikverein.at` — prepend domain for absolute URL.
- **Ticket URL from listing** may be absent (no `<a class="ticket-link">`) for events not yet on sale, sold out, or free (Zählkarten). The JSON API `is_ticketing_active` flag is more reliable.
