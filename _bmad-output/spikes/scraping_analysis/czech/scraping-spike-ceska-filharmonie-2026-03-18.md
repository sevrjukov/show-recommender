# Česká filharmonie — Scraping Spike

**Date:** 2026-03-18
**Status:** Complete
**Conclusion:** Viable for scraping without a headless browser; plain `fetch` + `cheerio` sufficient. JSON-LD on every detail page is the cleanest extraction path for programme and performers.

---

## Summary

The site is **server-side rendered** (full HTML in source). Angular is loaded for UI interactivity (date picker, filters) but all concert cards are present in the initial HTML payload — no headless browser needed. Every detail page embeds a complete `schema.org/Event` JSON-LD block, making structured extraction straightforward without brittle CSS selectors.

---

## Listing Page

```
GET https://www.ceskafilharmonie.cz/en/whats-on/
```

No headers or auth required.

---

## Pagination

| Property | Value |
|----------|-------|
| Mechanism | URL query parameter `?page=N` |
| Page size | ~15–16 events per page |
| Indexing | 1-based |
| Total count | Displayed in page header: `"We found 68 events in our programme"` |
| Max pages (observed) | 4 (covering ~68 events) |

**Pattern:**
```
https://www.ceskafilharmonie.cz/en/whats-on/        ← page 1
https://www.ceskafilharmonie.cz/en/whats-on/?page=2
https://www.ceskafilharmonie.cz/en/whats-on/?page=3
https://www.ceskafilharmonie.cz/en/whats-on/?page=4
```

Iterate until the page returns fewer items than the page size, or until the pagination footer no longer shows a next page.

---

## DOM Selectors — Listing Cards

The page uses minimal class-based structure. Key selectors are primarily tag + attribute patterns. No `.concert-card`, `.event-item`, or similar named wrappers were detected — the layout relies on semantic HTML.

| Field | Element / Pattern | Example |
|-------|-------------------|---------|
| Detail page URL | `<a href="/en/event/[ID]-[slug]/">` | `/en/event/33763-sol-gabetta-czech-philharmonic/` |
| Event ID | First segment of slug (5-digit int) | `33763` |
| Title | Text inside the `<a>` above | `Czech Philharmonic • Sol Gabetta` |
| Subtitle / programme teaser | Text sibling of title link | `Elgar and Stravinsky` |
| Date + time | Inline text node inside card | `18 Mar 2026 Wednesday 7.30pm` |
| Venue / hall | Inline text node | `Dvořák Hall` |
| Event type label | Text label | `Concert`, `Dress rehearsal`, `Workshop` |
| Series label | Text label | `Subscription Series C` |
| Performers (partial) | Text node beginning with `with` | `with Sol Gabetta (cello), Stefanie Irányi (soprano)` |
| Thumbnail image | `<img src="https://cdn.ceskafilharmonie.cz/du/media/[hash]/[filename].jpg">` | CDN-hosted JPEG |

> **Note:** Angular template directives (`ng-cloak`, `ng:cloak`, `{{variable}}`) are present in the markup but do not block SSR content — the rendered values are in the HTML source.

---

## DOM Selectors — Detail Pages

Detail URL pattern:
```
https://www.ceskafilharmonie.cz/en/event/[ID]-[slug]/
```

Example: `https://www.ceskafilharmonie.cz/en/event/33763-sol-gabetta-czech-philharmonic/`

| Field | Element / Pattern | Notes |
|-------|-------------------|-------|
| Programme section | `<h2>` with text `Programme` | No CSS class |
| Composer name | `<strong>` inside programme section | E.g. `Edward Elgar` |
| Work title + duration | Plain text node after `<strong>` | `Cello Concerto in E minor, Op. 85 (30')` |
| Intermission marker | Text node `— Intermission —` | Between works |
| Performers section | `<h2>` with text `Performers` | No CSS class |
| Performer name | `<strong>` inside performers section | E.g. `Sol Gabetta` |
| Performer role/instrument | `<em>` after name `<strong>` | E.g. `cello`, `conductor` |
| Duration | Text node in header area | `1 hour 30 minutes` |
| Price | Text node | `Price from 500 to 1650 CZK` |
| Ticket cart URL | `<a href="https://tickets.ceskafilharmonie.cz/...">` | External ticketing system |

> **Recommended approach:** Parse the `<script type="application/ld+json">` block (see below) instead of navigating the semantic HTML — it is more stable and already structured.

---

## JSON-LD (Preferred Extraction Path)

Every detail page embeds a `schema.org/Event` block in a `<script type="application/ld+json">` tag. This is the most reliable extraction target.

```json
{
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "Czech Philharmonic • Sol Gabetta",
  "description": "The star cellist Sol Gabetta calls Elgar's Cello Concerto her very favourite work...",
  "startDate": "2026-03-18T19:30:00",
  "endDate": "2026-03-18T21:30:00",
  "performer": [
    { "@type": "Person", "name": "Sol Gabetta" },
    { "@type": "Person", "name": "Semyon Bychkov" }
  ],
  "location": {
    "@type": "Place",
    "name": "Rudolfinum, Dvořák Hall",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Alšovo nábřeží 12",
      "postalCode": "80209"
    }
  },
  "offers": [
    { "price": "500 to 1650 CZK", "priceCurrency": "CZK" }
  ]
}
```

> **Note:** `performer` array contains only 2 entries (soloists + conductor) in the JSON-LD even when more performers appear in the HTML. Full performer list (all soloists, conductor, ensemble) must be scraped from the `<h2>Performers</h2>` section on the detail page.

---

## Fields Available vs Missing

### Listing page (whats-on)

| Field | Available | Notes |
|-------|-----------|-------|
| Event ID | ✅ | From URL slug |
| Title | ✅ | Full title in link text |
| Subtitle / programme teaser | ✅ | Composer surnames only e.g. "Elgar and Stravinsky" |
| Date | ✅ | `DD Mon YYYY Weekday` format |
| Time | ✅ | `H.MMam/pm` format |
| Venue / hall | ✅ | Hall name only |
| Event type | ✅ | Concert / Workshop / Dress rehearsal / Annotated concert |
| Series name | ✅ | Subscription series label |
| Performers (partial) | ✅ | First 1–2 soloists, no conductor |
| Thumbnail URL | ✅ | CDN JPEG |
| Detail page URL | ✅ | Relative path |
| Full programme (works) | ❌ | Detail page only |
| Conductor | ⚠️ | Sometimes absent from listing; always on detail page |
| Duration | ❌ | Detail page only |
| Ticket price | ❌ | Detail page only |
| Ticket availability / sold-out | ⚠️ | Filter exists on listing page but not consistently shown on cards |
| Address / city | ❌ | Detail page JSON-LD only |

### Detail page

| Field | Available | Source |
|-------|-----------|--------|
| Full programme | ✅ | `<h2>Programme</h2>` section |
| Composer names | ✅ | `<strong>` in programme section |
| Work titles + opus + duration | ✅ | Text nodes after composer |
| Intermission | ✅ | Text marker |
| Full performer list | ✅ | `<h2>Performers</h2>` section |
| Conductor | ✅ | `<em>conductor</em>` role label |
| Ensemble name | ✅ | Listed as `<strong>Czech Philharmonic</strong>` |
| Duration (total) | ✅ | Text node in header |
| Price range | ✅ | `Price from X to Y CZK` |
| Ticket URL | ✅ | External link to tickets.ceskafilharmonie.cz |
| Venue address | ✅ | JSON-LD PostalAddress |
| ISO start/end datetime | ✅ | JSON-LD `startDate` / `endDate` |
| Description (editorial) | ✅ | JSON-LD `description` field |
| Artist biographies | ✅ | HTML only (no structured equivalent) |

---

## Example Entries

### Entry 1 — Main concert

```
Title:        Czech Philharmonic • Sol Gabetta
Subtitle:     Elgar and Stravinsky
Date:         18 Mar 2026, Wednesday, 7.30pm
Venue:        Dvořák Hall
Event type:   Concert
Series:       Subscription Series C
Performers:   Sol Gabetta (cello), Stefanie Irányi (soprano),
              Eric Finbarr Carey (tenor), Jongmin Park (bass),
              Semyon Bychkov (conductor), Czech Philharmonic
Programme:    Edward Elgar — Cello Concerto in E minor, Op. 85 (30')
              [Intermission]
              Igor Stravinsky — Pulcinella (40')
Duration:     1 hour 30 minutes
Price:        500–1650 CZK
Detail URL:   /en/event/33763-sol-gabetta-czech-philharmonic/
Image:        https://cdn.ceskafilharmonie.cz/du/media/hmdk5f54/c3_sol_gabeta.jpg
```

### Entry 2 — Dress rehearsal

```
Title:        Czech Philharmonic • Cristian Măcelaru
Subtitle:     Marsalis and Martinů
Date:         25 Mar 2026, Wednesday, 10.00am
Venue:        Dvořák Hall
Event type:   Dress rehearsal
Series:       (none)
Performers:   Nicola Benedetti (violin), Cristian Măcelaru (conductor)
Detail URL:   /en/event/33743-cristian-macelaru-czech-philharmonic/
```

### Entry 3 — Education event

```
Title:        100 Minutes among the Tones
Date:         21 Mar 2026, Saturday, 10.30am
Venue:        Suk Hall
Event type:   Workshop
Series:       Education programs
Detail URL:   /en/event/34302--100-minutes-among-the-tones/
Image:        https://cdn.ceskafilharmonie.cz/du/media/1c3nokwy/100minut_1-17.jpg
```

---

## JS Rendering Quirks

| Quirk | Impact |
|-------|--------|
| Angular (`ng-cloak`) | Low — content is SSR; Angular only handles interactive UI (calendar picker, filters) |
| Calendar date picker | None — pagination via `?page=N` is sufficient; calendar is UI sugar |
| "Hide sold out" toggle | Low — toggle is client-side filter over already-rendered cards; scraping unfiltered HTML will include sold-out events |
| Multiple identical picker DOM blocks | Harmless duplication in source; ignore |
| `{{variable}}` template syntax in source | Low — these appear in non-rendered template parts; actual values are in rendered nodes |

---

## Recommended Scraping Strategy

**Two-phase approach:**

**Phase 1 — List scrape** (`/en/whats-on/?page=N`):
- Extract: event ID, title, subtitle, date/time, venue, event type, series, performers (partial), detail URL
- Iterate pages until item count < page size

**Phase 2 — Detail scrape** (per event `/en/event/[ID]-[slug]/`):
- Extract JSON-LD block: ISO datetime, performers (partial), description
- Parse `<h2>Programme</h2>`: composer + work title + duration per work
- Parse `<h2>Performers</h2>`: full cast with roles

**Genre pre-filter** (apply before detail scrape to save requests):
- Include: event type = `Concert` or `Dress rehearsal`
- Exclude: event type = `Workshop`, title keywords `opera`, `ballet`, `drama`
- Dress rehearsals: include but flag — useful for completeness, may want to filter in recommender

---

## Minimal Fetch Recipe

```python
import requests
from bs4 import BeautifulSoup
import json

BASE = "https://www.ceskafilharmonie.cz"

def fetch_listing_page(page=1):
    url = f"{BASE}/en/whats-on/" + (f"?page={page}" if page > 1 else "")
    resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    events = []
    for a in soup.find_all("a", href=lambda h: h and h.startswith("/en/event/")):
        events.append({
            "detail_url": BASE + a["href"],
            "title": a.get_text(strip=True),
        })
    return events

def fetch_detail(detail_url):
    resp = requests.get(detail_url, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # Preferred: JSON-LD
    ld = soup.find("script", type="application/ld+json")
    structured = json.loads(ld.string) if ld else {}

    # Programme (not in JSON-LD)
    programme = []
    prog_h2 = soup.find("h2", string=lambda s: s and "Programme" in s)
    if prog_h2:
        for el in prog_h2.next_siblings:
            if el.name == "h2":
                break
            if el.name == "strong":
                programme.append({"composer": el.get_text(strip=True), "works": []})
            elif programme and isinstance(el, str) and el.strip():
                programme[-1]["works"].append(el.strip())

    # Full performers (JSON-LD only has partial list)
    performers = []
    perf_h2 = soup.find("h2", string=lambda s: s and "Performers" in s)
    if perf_h2:
        for strong in perf_h2.find_next_siblings("strong"):
            role_em = strong.find_next_sibling("em")
            performers.append({
                "name": strong.get_text(strip=True),
                "role": role_em.get_text(strip=True) if role_em else None,
            })

    return {**structured, "programme": programme, "performers_full": performers}
```

---

## Fields Useful for Recommender

| Use case | Fields | Source |
|----------|--------|--------|
| Display | `name`, `startDate`, `location.name` | JSON-LD |
| Programme | `programme[].composer`, `programme[].works` | Detail HTML |
| Performers | `performers_full[].name`, `.role` | Detail HTML |
| Classification | `event_type` (Concert/Workshop/etc.) | Listing HTML |
| Deep link | `detail_url` | Listing HTML |
| Dedup key | Event ID from URL slug (e.g. `33763`) | Listing URL |
| Ticket | `offers[].price`, ticket cart URL | Detail HTML |
| City | Prague (hardcode — all events at Rudolfinum or Suk Hall) | — |

---

## Notes & Risks

- **No API key needed.** Plain HTTP GET, no auth, no CORS issues for server-side requests.
- **Angular does not block SSR content.** All concert cards are present in the initial HTML — no Playwright needed.
- **JSON-LD `performer` is partial.** Only 2 entries in the schema block; full cast requires HTML parsing of the `<h2>Performers</h2>` section.
- **Slug double-dash pattern:** Some event URLs have `--` (e.g. `/en/event/34302--100-minutes-among-the-tones/`) — the ID is still the first numeric segment.
- **Education/workshop events:** Mixed in with concerts; filter by `event type` label or title keywords before detail scrape.
- **Sold-out events:** Included in SSR HTML regardless of filter state; check for sold-out indicator on detail page if needed.
- **Pagination total:** `68 events` was the live count on 2026-03-18; expect this to grow as season progresses.
- **CDN images:** `cdn.ceskafilharmonie.cz` — straightforward absolute URLs.
- **Ticket system:** External at `tickets.ceskafilharmonie.cz` — no need to scrape; just expose the link.
