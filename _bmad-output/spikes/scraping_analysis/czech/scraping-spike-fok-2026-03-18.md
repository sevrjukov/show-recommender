# FOK — Prague Symphony Orchestra Scraping Spike

**Date:** 2026-03-18
**Status:** Complete
**Conclusion:** Viable for scraping with plain `fetch` + `cheerio`. SSR Drupal 11, no headless browser needed. No JSON-LD — all extraction is HTML-only. Performer pattern differs from ceskafilharmonie.cz / Rudolfinum (`|` pipe delimiter instead of `<em>`). Small event catalogue (~16 events near end of season); expect 50–80 events early season.

---

## Summary

`fok.cz` is a **Drupal 11** site (credited to drupalarts.cz), fully server-side rendered. All concert cards are present in the initial HTML payload. No JSON-LD structured data anywhere. Images are real WebP thumbnails (unlike Rudolfinum). Detail pages list multiple performance dates for the same programme. FOK events also appear on Rudolfinum — dedup on title + date + venue hash is needed.

---

## Listing Page

```
GET https://www.fok.cz/en/program
```

No headers or auth required.

---

## Pagination

| Property | Value |
|----------|-------|
| Mechanism | URL query parameter `?page=N` |
| Indexing | **0-based** (Drupal default) — page 1 = `?page=0`, page 2 = `?page=1` |
| Page size | ~15 events on page 0 |
| Total count | Not shown |
| Nav links | Page 1, Page 2, Next ›, Last » |

**Pattern:**
```
https://www.fok.cz/en/program          ← same as ?page=0
https://www.fok.cz/en/program?page=1
https://www.fok.cz/en/program?page=2
```

Stop when the page returns 0 events or no "Next" link is present.

> **Note (2026-03-18):** Only 2 pages (~16 events) visible — near end of season. Expect 5–6 pages (~75–90 events) when scraped at season start (September–October).

---

## Filter Parameters

Available on listing page for targeted scraping:

| Parameter | Values | Example |
|-----------|--------|---------|
| (none observed as query param) | All / Orchestral / Chamber / No subscriptions / Family | Filters appear to be client-side or URL-path based |

> Date range pickers are present in UI but no stable query param pattern was observed. Use full pagination without filters and apply genre pre-filter in the pipeline.

---

## DOM Selectors — Listing Cards

Drupal 11 renders node listings with standard Drupal view row markup. Exact wrapper class names were not fully exposed by the fetcher (HTML-to-markdown conversion loses class attributes), but the structural patterns are stable:

| Field | Element / Pattern | Example |
|-------|-------------------|---------|
| Detail URL | `<a href="/en/[slug]">` | `/en/beethoven-fate-symphony` |
| Title | Link text (heading inside `<a>`) | `Beethoven – Fate Symphony` |
| Date(s) + time(s) | Text node(s) inside card | `Wed, 18 Mar 2026 - 10:00` |
| Venue | Text node inside card | `Municipal House, Smetana Hall` |
| Thumbnail | `<img src="/sites/default/files/styles/2240/public/images/[YYYY-MM]/[date].jpg.webp">` | See image pattern below |
| Ticket link | Same as detail URL (goes to detail page first) | `/en/beethoven-fate-symphony` |

> **CSS class note:** Drupal 11 node listing rows typically carry classes like `node--type-concert`, `views-row`, `node--view-mode-teaser`. Confirm exact class names by inspecting raw page source — the scraper should use `find_all("a", href=re.compile(r"^/en/[a-z]"))` as a robust alternative.

### Detail URL pattern

```
/en/[human-readable-slug]
```

**No numeric event ID in the URL** — slug only (e.g. `/en/beethoven-fate-symphony`). Use the slug as the dedup key, or derive a key from title + first date.

### Image URL pattern

```
/sites/default/files/styles/2240/public/images/[YYYY-MM]/[filename].jpg.webp?itok=[token]
```

Example: `/sites/default/files/styles/2240/public/images/2025-03/2026-03-18.jpg.webp?itok=DNM7WWcA`

Real images present (not placeholders). Prepend `https://www.fok.cz` for absolute URL.

---

## DOM Selectors — Detail Pages

Detail URL pattern:
```
https://www.fok.cz/en/[slug]
```

**Critical: A single detail page lists ALL performance dates for the same programme.** Extract all dates and create one event record per date.

### Performer pattern

FOK uses a **pipe delimiter** (`|`) — different from ceskafilharmonie.cz / Rudolfinum which use `<em>`:

```html
<strong>Olivier Latry</strong> | organ
<strong>Prague Symphony Orchestra</strong>
<strong>Marko Letonja</strong> | conductor
```

```html
<strong>Bella Adamova</strong> | mezzosoprano
<strong>Michael Gees</strong> | piano
```

| Field | Element / Pattern | Notes |
|-------|-------------------|-------|
| Composer | `<strong>Composer name</strong>` | In programme section |
| Work title | Plain text node after `<strong>` | No wrapping class |
| Performer name | `<strong>Name</strong>` | In performers section |
| Performer role | Text after ` \| ` pipe | `organ`, `conductor`, `mezzosoprano`, `piano` |
| Performance dates | Text nodes `Weekday, DD Month YYYY - HH:MM` | **Multiple per page** |
| Event type per date | Text annotation | `(public general rehearsal)` for open rehearsals |
| Venue | Text node | `Municipal House, Smetana Hall` |
| Hero image | `<img src="/sites/default/files/styles/2240/...">` | Same pattern as listing |
| Buy ticket | `<a>Buy ticket</a>` → detail page → colosseum.eu | No direct Colosseum event ID in page HTML |
| Duration | Not present | Not shown on any page |
| Price | Not present | Not shown — colosseum.eu handles pricing |

---

## No JSON-LD

**No `<script type="application/ld+json">` blocks** on listing or detail pages. All extraction is HTML-only.

---

## Fields Available vs Missing

### Listing page

| Field | Available | Notes |
|-------|-----------|-------|
| Title | ✅ | Link text |
| Slug (dedup key) | ✅ | From href |
| Date(s) + time(s) | ✅ | Text nodes — may show multiple dates per card |
| Venue | ✅ | Text node |
| Thumbnail | ✅ | WebP image, real content |
| Concert category | ⚠️ | Implied by filter tabs (Orchestral / Chamber / Family) but not labelled per card |
| Performers | ❌ | Detail page only |
| Programme | ❌ | Detail page only |
| Conductor | ❌ | Detail page only |
| Duration | ❌ | Not available anywhere |
| Price | ❌ | Not available on fok.cz |

### Detail page

| Field | Available | Notes |
|-------|-----------|-------|
| All performance dates | ✅ | Multiple dates listed — extract all |
| Event type per date | ✅ | `public general rehearsal` annotation |
| Venue | ✅ | Full hall name |
| Full programme | ✅ | `<strong>` composer + text work title |
| Performers + roles | ✅ | `<strong>Name</strong> \| role` pattern |
| Conductor | ✅ | Identified by `\| conductor` role |
| Hero image | ✅ | WebP thumbnail |
| Buy ticket link | ✅ | Goes to detail page then to colosseum.eu |
| Price | ❌ | Not on fok.cz — colosseum.eu only |
| Duration per work | ❌ | Not provided |
| Total duration | ❌ | Not provided |
| Intermission | ❌ | Not marked explicitly |
| JSON-LD / structured data | ❌ | Absent entirely |

---

## Example Entries

### Entry 1 — Orchestral concert, multiple dates

```
Title:        Beethoven – Fate Symphony
Dates:        Wed 18 Mar 2026 10:00 (public general rehearsal)
              Wed 18 Mar 2026 19:30
              Thu 19 Mar 2026 19:30
Venue:        Municipal House, Smetana Hall
Programme:    Hector Berlioz — Roman Carnival, Overture Op. 9
              Francis Poulenc — Concerto for organ, timpani and strings in G minor
              Ludwig van Beethoven — Symphony No. 5 in C minor 'Fate'
Performers:   Olivier Latry | organ
              Marko Letonja | conductor
              Prague Symphony Orchestra
Detail URL:   /en/beethoven-fate-symphony
Image:        /sites/default/files/styles/2240/public/images/2025-03/2026-03-18.jpg.webp
```

### Entry 2 — Chamber concert, single date, non-Rudolfinum venue

```
Title:        Schubert – Winterreise
Date:         Thu 19 Mar 2026 19:30
Venue:        Convent of St Agnes of Bohemia
Programme:    Franz Schubert — Winterreise
Performers:   Bella Adamova | mezzosoprano
              Michael Gees | piano
Detail URL:   /en/schubert-winterreise
Image:        /sites/default/files/styles/2240/public/images/2025-03/2026-03-19.jpg.webp
```

### Entry 3 — Piano recital (also appears on Rudolfinum)

```
Title:        Vadym Kholodenko – Piano recital
Date:         Sat 21 Mar 2026 19:30
Venue:        Rudolfinum, Dvořák Hall
Programme:    Ludwig van Beethoven — Sonata No. 29 "Hammerklavier"
              Borys Lyatoshynsky — Three Preludes Op.38
              Franz Liszt — Études d'exécution transcendante d'après Paganini
Performers:   Vadym Kholodenko | piano
Detail URL:   /en/vadym-kholodenko-piano-recital
```

> Entry 3 also appears on rudolfinum.cz as `/en/event/34940-prague-symphony-orchestra-vadym-kholodenko-piano-recital/`. Dedup needed.

---

## JS Rendering Quirks

| Quirk | Impact |
|-------|--------|
| Drupal 11 settings JSON embedded | Low — Drupal config blob (`drupalSettings`), not event data |
| Filter tabs (Orchestral / Chamber / Family) | Low — may be client-side class toggle; use full pagination + pipeline filter |
| Multiple dates per detail page | **Medium** — extract all date nodes; create one record per date |
| `?page=0` (0-based) | Low — remember page 1 = `?page=0`; off-by-one if not handled |
| WebP images with `?itok=` cache-buster | Low — URL is stable; itok token is for Drupal image style caching |

---

## Recommended Scraping Strategy

FOK events cover both Rudolfinum (Dvořák Hall) and other Prague venues (Municipal House / Smetana Hall, Convent of St Agnes, etc.). **Scrape fok.cz directly** — it is the authoritative source for all FOK events and has richer detail (programme, performers) than the Rudolfinum aggregator listing.

**Two-phase approach:**

**Phase 1 — List scrape:**
```
GET https://www.fok.cz/en/program?page=0
GET https://www.fok.cz/en/program?page=1
... iterate until empty
```
Extract: title, slug, first date(s), venue, thumbnail URL, detail URL.

**Phase 2 — Detail scrape** (per event):
- Extract all performance dates → one record per date
- Parse `<strong>` blocks for programme (composer + work)
- Parse `<strong>Name</strong> | role` for performers
- Identify conductor by `| conductor` suffix
- Flag `public general rehearsal` dates — include but mark as rehearsal

**Genre pre-filter** (listing level, before detail scrape):
- Include: all (FOK = orchestral + chamber, both relevant)
- Exclude: `Family concerts` filter category if title contains keywords `children`, `family`, `pro děti`

---

## Minimal Fetch Recipe

```python
import requests
from bs4 import BeautifulSoup
import re

BASE = "https://www.fok.cz"

def fetch_listing(page=0):
    url = f"{BASE}/en/program" + (f"?page={page}" if page > 0 else "")
    resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    events = []
    # All internal /en/ links that are not navigation
    seen = set()
    for a in soup.find_all("a", href=re.compile(r"^/en/[a-z][a-z0-9-]+$")):
        href = a["href"]
        # Skip nav links (program, conductors, artists, etc.)
        skip = {"/en/program", "/en/conductors", "/en/artists", "/en/auditions",
                "/en/contacts", "/en/press", "/en/club", "/en/node"}
        if href in skip or href in seen:
            continue
        seen.add(href)
        events.append({
            "detail_url": BASE + href,
            "title": a.get_text(strip=True),
            "slug": href.lstrip("/en/"),
        })
    return events

def fetch_detail(detail_url):
    resp = requests.get(detail_url, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # Performance dates — "Weekday, DD Month YYYY - HH:MM" pattern
    date_pattern = re.compile(r"\w+,\s+\d{1,2}\s+\w+\s+\d{4}\s+-\s+\d{2}:\d{2}")
    dates = [t.strip() for t in soup.stripped_strings if date_pattern.search(t)]

    # Performers: <strong>Name</strong> followed by " | role" text
    performers = []
    for strong in soup.find_all("strong"):
        next_text = strong.next_sibling
        if next_text and isinstance(next_text, str) and "|" in next_text:
            role = next_text.split("|")[-1].strip()
            performers.append({"name": strong.get_text(strip=True), "role": role})
        elif strong.get_text(strip=True) in ("Prague Symphony Orchestra",):
            performers.append({"name": strong.get_text(strip=True), "role": "orchestra"})

    # Programme: <strong>Composer</strong> + text sibling
    programme = []
    for strong in soup.find_all("strong"):
        next_text = strong.next_sibling
        if next_text and isinstance(next_text, str) and "|" not in next_text and next_text.strip():
            programme.append({
                "composer": strong.get_text(strip=True),
                "work": next_text.strip().lstrip("–").strip(),
            })

    # Hero image
    img = soup.find("img", src=re.compile(r"/sites/default/files/styles/2240/"))
    image_url = BASE + img["src"] if img else None

    return {
        "dates": dates,
        "performers": performers,
        "programme": programme,
        "image_url": image_url,
    }
```

> **Disambiguation tip:** The `<strong>` tags appear in both performer and programme sections. Distinguish them by checking if the following text sibling contains `|` (performer) or not (programme). You may need to scope to specific container elements once you've confirmed the detail page structure by inspecting raw HTML.

---

## Fields Useful for Recommender

| Use case | Fields | Source |
|----------|--------|--------|
| Display | `title`, first `dates[]`, `venue` | Listing + detail |
| All dates | `dates[]` | Detail — one record per date |
| Programme | `programme[].composer`, `.work` | Detail HTML |
| Performers | `performers[].name`, `.role` | Detail HTML |
| Conductor | `performers[]` where `role == "conductor"` | Detail HTML |
| Deep link | `detail_url` | Listing HTML |
| Dedup key | `slug` (e.g. `beethoven-fate-symphony`) or `hash(title + first_date + venue)` | Listing URL |
| Thumbnail | `image_url` | Detail or listing HTML |
| City | Prague (hardcode — Municipal House / Rudolfinum / St Agnes / other Prague venues) | — |

---

## Notes & Risks

- **No numeric event ID.** Slug is the only identifier in the URL. Slugs are human-readable and stable within a season but may reuse across seasons (e.g. next year's Beethoven concert could get the same slug). Include the year from the date when building the dedup key.
- **No JSON-LD anywhere.** All extraction is positional HTML. Structural changes will break the scraper.
- **Performer `|` pattern is fragile.** If FOK changes the separator (e.g. to a dash or `<em>`), the performer parser breaks. Consider scraping raw text between performer `<strong>` tags and using a simple heuristic (last word = role if it's a known instrument/role keyword).
- **FOK ↔ Rudolfinum overlap.** Events at Dvořák Hall appear on both sites. Scrape fok.cz as the authoritative source; skip FOK events when scraping Rudolfinum (use `?organizer=fok` exclusion or dedup on title+date+venue).
- **Small catalogue near season end.** ~16 events observed 2026-03-18. Scrape again in September for full season coverage.
- **`?page=0` is 0-based.** The URL without `?page=` is equivalent to `?page=0`. Page 2 = `?page=1`. Off-by-one will cause you to miss the last page.
- **Colosseum ticket URL not exposed.** The "Buy ticket" button on detail pages redirects through fok.cz into Colosseum's ticketing system. Capture the fok.cz detail URL as the ticket entry point.
- **CMS:** Drupal 11 (drupalarts.cz). Drupal's HTML structure is stable across minor versions but watch for view mode changes after site updates.
