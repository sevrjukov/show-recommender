# Obecní dům (Municipal House) — Scraping Spike

**Date:** 2026-03-18
**Status:** Complete
**Conclusion:** Viable for scraping with plain `fetch` + `cheerio`. Despite AJAX "load more" on the listing page, standard WordPress archive pagination (`/en/program/page/N/`) works without JavaScript. WordPress REST API exists but exposes no performer or programme data — detail page HTML parsing required. **Medium difficulty** as assessed: no class names on programme/performer elements, pipe-delimited performers (same as FOK), JSON-LD is `WebPage` not `Event`.

---

## Summary

`obecnidum.cz` is a **WordPress** site. The program listing uses an AJAX "load more" button backed by `admin-ajax.php`, but standard WordPress archive pagination (`/en/program/page/N/`) serves the same content without JavaScript — 13 pages, ~30 events each. A custom post type (`program`) is exposed via the WP REST API but ACF/meta fields are empty in the API response; detail page scraping is the only way to get performers and programme. JSON-LD is limited to `WebPage` schema (not `Event`). Real thumbnail images present. Ticket links go directly to Colosseum.eu with an event ID.

**Dedup concern:** FOK concerts at Smetana Hall appear on both fok.cz and obecnidum.cz. Treat fok.cz as authoritative for those events (same approach as with Rudolfinum/FOK overlap).

---

## Listing Page

```
GET https://www.obecnidum.cz/en/program/
```

No headers or auth required.

---

## Pagination

| Property | Value |
|----------|-------|
| Mechanism (preferred) | WordPress archive URL `/en/program/page/N/` — **no JS needed** |
| Mechanism (site default) | AJAX POST to `/wp-admin/admin-ajax.php` with `action=program` |
| Page size | ~30 events per archive page |
| Indexing | 1-based (page 1 = `/en/program/`, page 2 = `/en/program/page/2/`) |
| Total pages (observed) | 13 |
| Total events (estimated) | ~390 |
| Total count displayed | Not shown on page |

**Preferred pattern — no JavaScript required:**
```
https://www.obecnidum.cz/en/program/                 ← page 1
https://www.obecnidum.cz/en/program/page/2/
https://www.obecnidum.cz/en/program/page/3/
...
https://www.obecnidum.cz/en/program/page/13/
```

Stop when the page returns 0 events or a 404.

> **Do not use the AJAX endpoint.** The `/wp-admin/admin-ajax.php` path requires WordPress nonce tokens and session state. The archive URL approach is simpler and more stable.

---

## WordPress REST API

A `program` custom post type is exposed at:

```
GET https://www.obecnidum.cz/wp-json/wp/v2/program?per_page=100&lang=en
```

| Field | Available | Notes |
|-------|-----------|-------|
| `id` | ✅ | WordPress post ID (e.g. `405`) |
| `slug` | ✅ | URL slug (e.g. `the-four-seasons-gypsy-airs-op-20`) |
| `link` | ✅ | Full detail URL (Czech locale — replace `/program/` with `/en/program/`) |
| `title.rendered` | ✅ | Concert title |
| `date` | ✅ | WP publish date — **not** performance date |
| `featured_media` | ✅ | Media ID — requires separate `/wp-json/wp/v2/media/[ID]` call for URL |
| Performance date/time | ⚠️ | Shown in `content.rendered` as text, not a structured field |
| Venue/hall | ⚠️ | In `content.rendered` as text |
| Performers | ❌ | Not in API response |
| Programme | ❌ | Not in API response |
| `acf` | ❌ | Empty `{}` — ACF fields not exposed |

**Verdict:** REST API useful for getting a full list of slugs/IDs quickly, but detail page scraping is still required for performers and programme.

---

## DOM Selectors — Listing Cards

WordPress renders `program` CPT archives. Card wrapper class is `program-item` (confirmed from JS source: `$('.program-item').size()`).

```html
<div class="program-item">
  <a href="https://www.obecnidum.cz/en/program/[slug]/">
    <img src="https://www.obecnidum.cz/wp-content/uploads/[YYYY]/[MM]/[filename]-800x602.jpg" sizes="auto">
  </a>
  <span>[DD Month]</span>
  <span>[Weekday HH:MM]</span>
  <h3><a href="/en/program/[slug]/">[Title]</a></h3>
  <div>[Venue/Hall name]</div>
  [Performing organization text node]
  <a href="https://online.colosseum.eu/fok/..." >Tickets</a>
</div>
```

| Field | Element / Pattern | Example |
|-------|-------------------|---------|
| Card wrapper | `<div class="program-item">` | Confirmed from JS source |
| Detail URL | `<a href="https://www.obecnidum.cz/en/program/[slug]/">` | Absolute URL |
| Slug | Path segment from detail URL | `olivier-latry-organ-recital` |
| Date | `<span>` — day + month | `28 March` |
| Time + weekday | `<span>` — weekday + time | `Saturday 11:00` |
| Title | `<h3><a>` | `Olivier Latry – Organ Recital` |
| Venue/hall | `<div>` text node | `Smetanova síň` |
| Performing org | Text node (unstructured) | `SYMFONICKÝ ORCHESTR HL. M. PRAHY FOK` |
| Thumbnail | `<img src="...wp-content/uploads/[YYYY]/[MM]/[filename]-800x602.jpg">` | WordPress media, 800×602 crop |
| Ticket link | `<a href="https://online.colosseum.eu/fok/standard/Hall/Index/[eventID]/...">` | Direct Colosseum.eu link with event ID |

---

## DOM Selectors — Detail Pages

Detail URL pattern:
```
https://www.obecnidum.cz/en/program/[slug]/
```

**No JSON-LD `Event` schema** — only `WebPage`. All programme and performer data is in plain HTML with no CSS classes.

### Programme

```html
<h3>Hector Berlioz</h3>
Roman Carnival, Overture Op. 9

<h3>Francis Poulenc</h3>
Concerto for organ, timpani and strings in G minor

<h3>Ludwig van Beethoven</h3>
Symphony No. 5 in C minor "Fate"
```

Composer name in `<h3>`, work title as plain text node immediately after. No opus durations.

### Performers

```
Olivier Latry | organ
Prague Symphony Orchestra
Marko Letonja | conductor
```

Same pipe `|` delimiter as fok.cz. Performer name in `<h3>` (or `<strong>`) with ` | role` as text suffix. Ensemble without role suffix.

| Field | Element | Notes |
|-------|---------|-------|
| Composer | `<h3>` in programme section | No class |
| Work title | Text node after `<h3>` | No class |
| Performer name | `<h3>` or `<strong>` | Followed by ` \| role` |
| Performer role | Text after ` \| ` pipe | `organ`, `conductor`, `mezzosoprano` |
| Performance date/time | Text `DD.MM.YYYY HH:MM` | E.g. `28.3.2026 11:00` |
| Venue | Text node | `Smetanova síň` |
| Hero image | `<img src="https://www.obecnidum.cz/wp-content/uploads/[YYYY]/[MM]/[filename].jpg">` | Full-res (no crop suffix) |
| Ticket link | `<a href="https://online.colosseum.eu/fok/standard/Hall/Index/[eventID]/...">` | Event ID embedded |

### Colosseum.eu ticket URL pattern

```
https://online.colosseum.eu/fok/standard/Hall/Index/[eventID]/[token]?
```

Example:
```
https://online.colosseum.eu/fok/standard/Hall/Index/3406911/qUM1uB3o...?
```

Event ID (e.g. `3406911`) is usable as an external dedup key across obecnidum.cz and fok.cz for shared events.

---

## JSON-LD — Limited to WebPage

Both listing and detail pages embed JSON-LD, but **only `WebPage` type** — not `Event`:

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": "https://www.obecnidum.cz/en/program/olivier-latry-organ-recital/",
      "name": "Olivier Latry – Organ Recital - Municipal house",
      "thumbnailUrl": "https://www.obecnidum.cz/wp-content/uploads/2025/11/2026-03-28.jpg"
    }
  ]
}
```

Fields available from JSON-LD: page URL, page title, thumbnail URL. **Not useful for event data extraction.**

---

## Fields Available vs Missing

### Listing page

| Field | Available | Notes |
|-------|-----------|-------|
| Title | ✅ | `<h3><a>` text |
| Slug | ✅ | From href |
| Date + time | ✅ | Two `<span>` elements |
| Venue/hall | ✅ | `<div>` text node |
| Performing org | ✅ | Text node — org name, not individual performers |
| Thumbnail | ✅ | WordPress media, 800×602 |
| Ticket link | ✅ | Direct Colosseum.eu with event ID |
| Performers (individual) | ❌ | Detail page only |
| Conductor | ❌ | Detail page only |
| Programme | ❌ | Detail page only |
| Price | ❌ | Not shown anywhere on obecnidum.cz |
| Duration | ❌ | Not shown anywhere |

### Detail page

| Field | Available | Notes |
|-------|-----------|-------|
| Programme | ✅ | `<h3>` composer + text work title |
| Performers + roles | ✅ | `Name \| role` pattern |
| Conductor | ✅ | Role `\| conductor` |
| Performance date/time | ✅ | `DD.MM.YYYY HH:MM` text node |
| Venue | ✅ | Hall name text node |
| Hero image (full-res) | ✅ | WordPress uploads URL |
| Ticket link + Colosseum event ID | ✅ | Direct link with ID in path |
| Price | ❌ | Colosseum.eu only |
| Duration | ❌ | Not provided |
| Multiple dates per page | ❌ | Each performance is a separate WordPress post (unlike Rudolfinum/FOK) |

> **Important:** Unlike Rudolfinum and fok.cz, Obecní dům creates **one WordPress post per performance date**. The Beethoven rehearsal (18 Mar 10:00) and the evening concert (18 Mar 19:30) are separate pages with separate slugs. No multi-date aggregation needed.

---

## Example Entries

### Entry 1 — FOK orchestral (also on fok.cz)

```
Title:        Beethoven – Fate Symphony – Public general rehearsal
Date/time:    18.3.2026 10:00
Venue:        Smetanova síň
Performing:   SYMFONICKÝ ORCHESTR HL. M. PRAHY FOK
Programme:    Hector Berlioz — Roman Carnival, Overture Op. 9
              Francis Poulenc — Concerto for organ, timpani and strings in G minor
              Ludwig van Beethoven — Symphony No. 5 in C minor "Fate"
Performers:   Olivier Latry | organ
              Marko Letonja | conductor
              Prague Symphony Orchestra
Ticket URL:   https://online.colosseum.eu/fok/standard/Hall/Index/3406998/...
Detail URL:   /en/program/beethoven-fate-symphony-public-generalrehearsal/
Image:        wp-content/uploads/2025/11/2026-03-18_foto-William-Beaucardet-.jpg
```

### Entry 2 — Organ recital (unique to Municipal House)

```
Title:        Olivier Latry – Organ Recital
Date/time:    28.3.2026 11:00
Venue:        Smetanova síň
Programme:    Johann Sebastian Bach
              César Franck
              Charles-Marie Widor
              Jehan Alain
              Maurice Duruflé
              Improvisation
Performers:   Olivier Latry | organ
Ticket URL:   https://online.colosseum.eu/fok/standard/Hall/Index/3406911/...
Detail URL:   /en/program/olivier-latry-organ-recital/
Image:        wp-content/uploads/2025/11/2026-03-28.jpg
```

### Entry 3 — Commercial/crossover (filter candidate)

```
Title:        The Best of Classics
Date/time:    20 March 2026, Friday 20:00
Venue:        Smetanova síň
Performing:   Prague Music Orchestra
Detail URL:   /en/program/the-best-of-classics-6/
Image:        wp-content/uploads/2025/05/The-Best-of-Classics-800x602.jpg
```

> Entry 3 illustrates the genre filtering challenge: commercial "Best of Classics" concerts by non-resident orchestras are mixed in with FOK and recitals. Apply programme keyword filter before LLM classification.

---

## JS Rendering Quirks

| Quirk | Impact |
|-------|--------|
| AJAX "load more" on listing | **None** — use `/en/program/page/N/` archive URLs instead |
| `flatpickr` date picker (#datefrom / #dateto) | None — ignore; use pagination |
| Lazy image loading (`sizes="auto"`) | None for server-side scraping |
| GDPR/cookie banner JS | None — doesn't block HTML content |
| Czech vs English locale | Low — use `/en/program/` consistently; REST API link field uses Czech locale (swap `/program/` → `/en/program/`) |

---

## Recommended Scraping Strategy

**One post per performance** simplifies the pipeline — no multi-date splitting needed.

**Phase 1 — List scrape via WP archive pages:**
```
GET https://www.obecnidum.cz/en/program/
GET https://www.obecnidum.cz/en/program/page/2/
... up to /page/13/
```
Extract per card: title, slug, date+time (from `<span>` elements), venue, performing org, thumbnail URL, Colosseum ticket URL (with event ID), detail URL.

**Phase 2 — Detail scrape** (per event, for programme + individual performers):
- Parse `<h3>` → composer, text sibling → work title
- Parse `Name | role` nodes for performers
- Extract Colosseum event ID from ticket href path segment

**Dedup / overlap with fok.cz:**
- FOK events at Smetana Hall appear on both sites. Use the **Colosseum event ID** (from the ticket href) as a cross-site dedup key — it is the same ID on both obecnidum.cz and fok.cz for the same performance.
- Alternatively: `hash(normalized_date + "smetana-hall" + main_performer)`.
- Treat fok.cz as authoritative for FOK events (has images + richer structural data).

**Genre pre-filter** (listing level):
- Exclude: performing org contains `Prague Music Orchestra` or similar commercial ensembles; title keywords `best of`, `gala`, `film music`, `christmas`
- Include: individual recitals, named soloists, named conductors

---

## Minimal Fetch Recipe

```python
import requests
from bs4 import BeautifulSoup
import re

BASE = "https://www.obecnidum.cz"

def fetch_listing(page=1):
    url = f"{BASE}/en/program/" + (f"page/{page}/" if page > 1 else "")
    resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"})
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    events = []
    for card in soup.find_all("div", class_="program-item"):
        a = card.find("a", href=re.compile(r"/en/program/[^/]+/$"))
        if not a:
            continue
        spans = card.find_all("span")
        ticket_a = card.find("a", href=re.compile(r"colosseum\.eu"))
        colosseum_id = None
        if ticket_a:
            m = re.search(r"/Index/(\d+)/", ticket_a["href"])
            colosseum_id = m.group(1) if m else None

        events.append({
            "detail_url": a["href"] if a["href"].startswith("http") else BASE + a["href"],
            "slug": a["href"].rstrip("/").split("/")[-1],
            "title": card.find("h3").get_text(strip=True) if card.find("h3") else None,
            "date_raw": spans[0].get_text(strip=True) if len(spans) > 0 else None,
            "time_raw": spans[1].get_text(strip=True) if len(spans) > 1 else None,
            "colosseum_event_id": colosseum_id,
        })
    return events

def fetch_detail(detail_url):
    resp = requests.get(detail_url, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # Programme: <h3>Composer</h3> + text node
    programme = []
    for h3 in soup.find_all("h3"):
        text = h3.next_sibling
        if text and isinstance(text, str) and text.strip():
            programme.append({
                "composer": h3.get_text(strip=True),
                "work": text.strip(),
            })

    # Performers: "Name | role" text pattern
    performers = []
    pipe_pattern = re.compile(r"(.+?)\s*\|\s*(.+)")
    for node in soup.stripped_strings:
        m = pipe_pattern.match(node)
        if m:
            performers.append({"name": m.group(1).strip(), "role": m.group(2).strip()})

    # Colosseum event ID from ticket link
    ticket_a = soup.find("a", href=re.compile(r"colosseum\.eu"))
    colosseum_id = None
    if ticket_a:
        m = re.search(r"/Index/(\d+)/", ticket_a["href"])
        colosseum_id = m.group(1) if m else None

    return {
        "programme": programme,
        "performers": performers,
        "colosseum_event_id": colosseum_id,
    }
```

---

## Fields Useful for Recommender

| Use case | Fields | Source |
|----------|--------|--------|
| Display | `title`, `date_raw`, `time_raw`, `venue` | Listing card |
| Programme | `programme[].composer`, `.work` | Detail HTML |
| Performers | `performers[].name`, `.role` | Detail HTML |
| Conductor | `performers[]` where `role == "conductor"` | Detail HTML |
| Deep link | `detail_url` | Listing card |
| Cross-site dedup | `colosseum_event_id` | Ticket href on listing or detail |
| Slug dedup | `slug` | Detail URL |
| Thumbnail | `<img>` src in card | Listing card |
| City | Prague (hardcode — all events at Municipal House, Smetana Hall or Grégrův sál) | — |

---

## Notes & Risks

- **One post per date** (unlike Rudolfinum/FOK): no multi-date splitting logic needed. Simpler pipeline.
- **Archive pagination is stable.** `/en/program/page/N/` is standard WordPress — do not use the AJAX endpoint.
- **No `Event` JSON-LD.** Only `WebPage` schema — all structured data must come from HTML parsing.
- **Programme opus numbers missing** in some cases. Work titles are present but durations and opus numbers are inconsistent.
- **Performer/programme `<h3>` disambiguation.** Both sections use `<h3>` — scope parsing to the correct container div once the full HTML is inspected. The recipe above may need refinement after verifying actual class names on the container elements.
- **Commercial concerts mixed in.** Obecní dům hosts commercial promoters (Prague Music Orchestra, "Best of Classics" etc.) alongside FOK and recitals. Apply performing-org and title keyword filter before detail scrape.
- **FOK overlap via Colosseum ID.** The Colosseum event ID in the ticket URL is a reliable cross-site dedup key between obecnidum.cz and fok.cz for shared events.
- **~390 events** across 13 pages — larger catalogue than CF or FOK alone. Consider filtering by date range using `/en/program/?datefrom=YYYY-MM-DD&dateto=YYYY-MM-DD` if the date filter params are stable (not confirmed — requires testing).
- **CMS:** WordPress (drupalarts.cz theme is FOK-specific; obecnidum.cz uses a custom "obecnidum" WordPress theme). Updates may change the `program-item` class or card structure.
