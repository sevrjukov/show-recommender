# Rudolfinum — Scraping Spike

**Date:** 2026-03-18
**Status:** Complete
**Conclusion:** Viable for scraping with plain `fetch` + `cheerio`. SSR, no headless browser needed. **Primary value is coverage of non-Czech-Philharmonic organizers** — FOK, Prague Radio Symphony, Collegium 1704, Prague Philharmonia — that do not appear on ceskafilharmonie.cz. Czech Philharmonic events overlap exactly with ceskafilharmonie.cz (same event IDs); dedup is mandatory.

---

## Summary

Rudolfinum is a **venue aggregator**: it lists all concerts happening at the building regardless of organizer. The site is server-side rendered with Angular-style template variables (`{{variable}}`) that are resolved server-side before delivery — all content is in the initial HTML. No JSON-LD present (unlike ceskafilharmonie.cz). No thumbnail images — all cards use a placeholder. Detail pages can list **multiple performance dates** for the same programme.

The site shares event IDs and URL slug patterns with `ceskafilharmonie.cz`, suggesting a shared or integrated CMS (credited to perspectivo.cz). Event ID 33743 appears verbatim on both sites.

---

## Listing Page

```
GET https://www.rudolfinum.cz/en/program/
```

No headers or auth required.

---

## Pagination

| Property | Value |
|----------|-------|
| Mechanism | URL query parameter `?page=N` |
| Page size | 10 events per page |
| Indexing | 1-based |
| Total count | Not shown explicitly |
| Max pages (observed) | 10 (≈ 100 events total) |

**Pattern:**
```
https://www.rudolfinum.cz/en/program/          ← page 1
https://www.rudolfinum.cz/en/program/?page=2
...
https://www.rudolfinum.cz/en/program/?page=10
```

Pagination nav is a `<ul>` with `<li><a href="/en/program/?page=N">N</a></li>` items plus a "Next" link. Stop when the page returns fewer than 10 events, or when no "Next" link is present.

---

## Filter Parameters

Available query parameters for targeted scraping:

| Parameter | Values observed | Example |
|-----------|-----------------|---------|
| `?organizer=` | `czech-philharmonic`, `cskh`, `collegium-1704`, `fok`, `prague-philharmonia`, `prague-radio-symphony-orchestra` | `?organizer=fok` |
| `?festival=` | `prague-spring`, `dvorak-prague`, `dvorak-prague`, `strings-of-autumn`, `rudolf-firku%C5%A1n%C3%BD-piano-festival` | `?festival=prague-spring` |
| `?hall=` | `dvorak-hall`, `suk-hall` | `?hall=dvorak-hall` |
| `?page=` | Integer | `?page=3` |

Date filters are present in the UI but use JS template variables (`{{filterDateFromNiceVal}}`) — not reliable as static query params. Use `?organizer=` + pagination instead.

---

## DOM Selectors — Listing Cards

The card structure is minimal and class-free. Selectors are positional/structural.

```html
<!-- Card structure (no wrapper class observed) -->
<a href="/en/event/[ID]-[slug]/">
  <img src="/Assets/images/image-empty.png" alt="Photo illustrating a concert - event [Title]">
</a>

<a href="/en/event/[ID]-[slug]/">
  <h3>[Title]</h3>
</a>

<p>[Weekday DD. Month HH.MMpm] [Hall] Prague</p>
<p>[Composer] and [Composer] with [Performer] ([instrument]), [Performer] and more on the programme</p>

<a href="?organizer=[slug]">[Organizer Name]</a>
<span>[Event type]</span>

<a href="/en/event/[ID]-[slug]/">More info</a>
```

| Field | Element | Notes |
|-------|---------|-------|
| Detail URL | `<a href="/en/event/[ID]-[slug]/">` | Multiple `<a>` per card point to same URL; use first or the `<h3>` parent |
| Event ID | Numeric prefix of slug | E.g. `33763` from `/en/event/33763-sol-gabetta-czech-philharmonic/` |
| Title | `<h3>` inside the title `<a>` | E.g. `Czech Philharmonic ⬩ Sol Gabetta` |
| Date + time | First `<p>` after image link | `Wednesday 18. March 7.30pm Dvořák Hall Prague` — date, time, and hall concatenated |
| Programme teaser | Second `<p>` after image link | Composers + first performers, truncated with "and more on the programme" |
| Organizer | `<a href="?organizer=[slug]">` | E.g. `Czech Philharmonic` |
| Event type | `<span>` after organizer link | `Concert`, `Dress rehearsal`, `Final rehearsal`, `Workshop` |
| Thumbnail | `<img src="/Assets/images/image-empty.png">` | **Always placeholder** — no real images on listing page |

> **No CSS class names** observed on card elements beyond standard structural tags.

---

## DOM Selectors — Detail Pages

Detail URL pattern:
```
https://www.rudolfinum.cz/en/event/[ID]-[slug]/
```

Example: `https://www.rudolfinum.cz/en/event/33743-cristian-macelaru-czech-philharmonic/`

**Critical: A single detail page lists ALL performance dates for the same programme** (e.g. dress rehearsal + 3 evening concerts). Each date must be extracted as a separate event.

```html
<!-- Venue -->
Rudolfinum — Dvořák Hall

<!-- Multiple date/time entries (one per performance) -->
3/25/2026 Wednesday 10:00 AM
<em>Dress rehearsal</em>

3/25/2026 Wednesday 7:30 PM
3/26/2026 Thursday 7:30 PM
3/27/2022 Friday 7:30 PM

<!-- Duration -->
Duration of the programme 1 hour 40 minutes

<!-- Programme — same structure as ceskafilharmonie.cz -->
<strong>Wynton Marsalis</strong>
Violin Concerto in D major (Czech premiere) (44')

— Intermission —

<strong>Bohuslav Martinů</strong>
Symphony No. 1, H 289 (33')

<!-- Performers — same structure as ceskafilharmonie.cz -->
<strong>Nicola Benedetti</strong> <em>violin</em>
<strong>Cristian Măcelaru</strong> <em>conductor</em>
<strong>Czech Philharmonic</strong>
```

| Field | Element | Notes |
|-------|---------|-------|
| Venue | Text node | `Rudolfinum — Dvořák Hall` |
| Performance dates | Date text nodes (`M/DD/YYYY Weekday HH:MM AM/PM`) | **Multiple per page** — one per performance; extract all |
| Event type per date | `<em>` after date text | `Dress rehearsal` — absent for regular concerts |
| Duration | Text node `Duration of the programme X hour(s) Y minutes` | Present on detail page only |
| Composer | `<strong>` in programme section | E.g. `Wynton Marsalis` |
| Work title + premiere note + duration | Text node after `<strong>` | `Violin Concerto in D major (Czech premiere) (44')` |
| Intermission marker | Text node `— Intermission —` | Between works |
| Performer name | `<strong>` in performers section | E.g. `Nicola Benedetti` |
| Performer role/instrument | `<em>` after name `<strong>` | `violin`, `conductor` |
| Ticket buy URL | `<a>` "Buy online" | Redirects to organizer site (ceskafilharmonie.cz or fok.cz depending on organizer) |

---

## No JSON-LD

**No `<script type="application/ld+json">` blocks** present on listing or detail pages. Unlike ceskafilharmonie.cz, all data must be extracted from HTML.

---

## Fields Available vs Missing

### Listing page

| Field | Available | Notes |
|-------|-----------|-------|
| Event ID | ✅ | From URL slug |
| Title | ✅ | `<h3>` text |
| Date + time | ✅ | Concatenated in first `<p>` — needs parsing |
| Hall | ✅ | Concatenated in same `<p>` as date |
| Organizer | ✅ | `<a href="?organizer=...">` |
| Event type | ✅ | `<span>` — Concert / Dress rehearsal / Workshop |
| Programme teaser | ✅ | Truncated: composers + 1–2 performers |
| Thumbnail | ❌ | Placeholder only — no real images |
| Full programme | ❌ | Detail page only |
| Conductor | ⚠️ | Sometimes in teaser text; not consistently |
| Duration | ❌ | Detail page only |
| Price | ❌ | Detail page only |
| Multiple dates | ❌ | Only first date shown on listing; full set on detail page |

### Detail page

| Field | Available | Notes |
|-------|-----------|-------|
| All performance dates | ✅ | **Multiple dates listed** — must extract all |
| Event type per date | ✅ | `<em>` label (dress rehearsal, etc.) |
| Venue | ✅ | Hall name |
| Full programme | ✅ | `<strong>` composer + text work titles |
| Work duration per piece | ✅ | In parentheses e.g. `(44')` |
| Intermission | ✅ | Text marker |
| Full performers + roles | ✅ | `<strong>` + `<em>` |
| Conductor | ✅ | Role `<em>conductor</em>` |
| Duration total | ✅ | Text node |
| Ticket buy URL | ✅ | Redirects to organizer ticketing |
| Price | ❌ | Not on Rudolfinum page; on organizer's site |
| Images | ❌ | No images anywhere on the site |

---

## Example Entries

### Entry 1 — Czech Philharmonic (overlaps ceskafilharmonie.cz)

```
Title:        Czech Philharmonic ⬩ Sol Gabetta
Date/time:    Wednesday 18. March 7.30pm
Hall:         Dvořák Hall Prague
Organizer:    Czech Philharmonic
Event type:   Concert
Programme:    Edward Elgar, Igor Stravinsky [truncated in listing]
Performers:   Sol Gabetta (cello), Stefanie Irányi (soprano), Eric Finbarr Carey (tenor) [truncated]
Detail URL:   /en/event/33763-sol-gabetta-czech-philharmonic/
Image:        /Assets/images/image-empty.png (placeholder)
```

### Entry 2 — FOK (unique to Rudolfinum)

```
Title:        Vadym Kholodenko – Piano recital ⬩ Prague Symphony Orchestra
Date/time:    Saturday 21. March 7.30pm
Hall:         Dvořák Hall Prague
Organizer:    FOK
Event type:   Concert
Detail URL:   /en/event/34940-prague-symphony-orchestra-vadym-kholodenko-piano-recital/
```
Detail page:
```
Performers:   Vadym Kholodenko (piano)
Programme:    Ludwig van Beethoven — Sonata No. 29 in B flat major Op. 106 "Hammerklavier"
              Borys Lyatoshynsky — Three Preludes Op.38
              Franz Liszt — Études d'exécution transcendante d'après Paganini
Duration:     1 hour 30 minutes
Buy URL:      https://www.fok.cz/vadym-kholodenko-klavirni-recital
```

### Entry 3 — Prague Radio Symphony (unique to Rudolfinum)

```
Title:        R5 / Bluebeard's Castle ⬩ Prague Radio Symphony Orchestra
Date/time:    Tuesday 24. March 7.30pm
Hall:         Dvořák Hall Prague
Organizer:    Prague Radio Symphony Orchestra
Event type:   Concert
Detail URL:   /en/event/34664-prague-radio-symphony-orchestra-r5-bluebeards-castle/
```

---

## JS Rendering Quirks

| Quirk | Impact |
|-------|--------|
| Angular-style `{{variable}}` in source | Low — values are resolved server-side; actual content is in HTML |
| Date filter UI (calendar picker) | None — pagination via `?page=N` and `?organizer=` is sufficient |
| "More info" + image link both point to same URL | Harmless duplication — deduplicate `<a href>` targets per card |
| Multiple dates per detail page | **Medium** — must iterate all date text nodes on detail page and create one event record per date |
| Buy button redirects to organizer site | Low — just capture the href; don't follow |

---

## Recommended Scraping Strategy

**Important dedup decisions:**

- **Czech Philharmonic** — skip `?organizer=czech-philharmonic`; covered by ceskafilharmonie.cz with richer data (JSON-LD, images).
- **FOK** — skip `?organizer=fok`; covered by fok.cz directly with richer data (real thumbnail images, authoritative programme/performer detail). Rudolfinum listing has no images and less detail for FOK events.

Scrape Rudolfinum only for organizers that have no dedicated site in the pipeline:

```
Prague Philharmonia:    ?organizer=prague-philharmonia
Prague Radio Symphony:  ?organizer=prague-radio-symphony-orchestra
Collegium 1704:         ?organizer=collegium-1704
```

**Two-phase approach:**

**Phase 1 — List scrape** (per organizer):
```
GET https://www.rudolfinum.cz/en/program/?organizer=[slug]&page=N
```
- Extract: event ID, title, date/time (first date), hall, organizer, event type, detail URL
- Iterate `?page=N` until < 10 results

**Phase 2 — Detail scrape** (per event):
- Extract all performance dates (one record per date)
- Parse `<strong>` + text for programme
- Parse `<strong>` + `<em>` for performers
- Capture buy URL

---

## Minimal Fetch Recipe

```python
import requests
from bs4 import BeautifulSoup
import re

BASE = "https://www.rudolfinum.cz"

# Organizers to scrape (exclude czech-philharmonic — covered by ceskafilharmonie.cz)
ORGANIZERS = ["fok", "prague-philharmonia", "prague-radio-symphony-orchestra", "collegium-1704"]

def fetch_listing(organizer, page=1):
    params = {"organizer": organizer}
    if page > 1:
        params["page"] = page
    resp = requests.get(f"{BASE}/en/program/", params=params, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    events = []
    for h3 in soup.find_all("h3"):
        a = h3.find_parent("a")
        if not a:
            continue
        href = a.get("href", "")
        if not href.startswith("/en/event/"):
            continue
        # Date/time/hall is in the <p> sibling after the title <a>
        info_p = a.find_next_sibling("p")
        events.append({
            "id": href.split("/")[3].split("-")[0],
            "title": h3.get_text(strip=True),
            "detail_url": BASE + href,
            "date_raw": info_p.get_text(strip=True) if info_p else None,
        })
    return events

def fetch_detail(detail_url):
    resp = requests.get(detail_url, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # Multiple performance dates — extract all
    date_pattern = re.compile(r"\d{1,2}/\d{1,2}/\d{4}")
    dates = [t.strip() for t in soup.stripped_strings if date_pattern.match(t)]

    # Programme
    programme = []
    for strong in soup.find_all("strong"):
        next_text = strong.next_sibling
        if next_text and isinstance(next_text, str) and next_text.strip():
            programme.append({
                "composer": strong.get_text(strip=True),
                "work": next_text.strip(),
            })

    # Performers
    performers = []
    for strong in soup.find_all("strong"):
        em = strong.find_next_sibling("em")
        if em:
            performers.append({
                "name": strong.get_text(strip=True),
                "role": em.get_text(strip=True),
            })

    # Buy URL
    buy_link = soup.find("a", string=re.compile("Buy online", re.I))
    buy_url = buy_link["href"] if buy_link else None

    return {
        "dates": dates,
        "programme": programme,
        "performers": performers,
        "buy_url": buy_url,
    }
```

---

## Fields Useful for Recommender

| Use case | Fields | Source |
|----------|--------|--------|
| Display | `title`, first `dates[]` entry, `hall` | Listing HTML |
| All dates | `dates[]` | Detail HTML — create one record per date |
| Programme | `programme[].composer`, `.work` | Detail HTML |
| Performers | `performers[].name`, `.role` | Detail HTML |
| Classification | `organizer`, `event_type` | Listing HTML |
| Deep link | `detail_url` | Listing HTML |
| Dedup key | Event ID from URL slug (e.g. `34940`) | Listing URL |
| Ticket | `buy_url` (redirects to organizer) | Detail HTML |
| City | Prague (hardcode — all events at Rudolfinum) | — |

---

## Notes & Risks

- **Overlap with ceskafilharmonie.cz:** Czech Philharmonic events share the same event IDs. Dedup on event ID alone is sufficient for CF events.
- **Overlap with fok.cz:** FOK events appear on both sites. Treat fok.cz as authoritative (real images, richer detail); skip `?organizer=fok` when scraping Rudolfinum entirely.
- **No images anywhere:** The site uses `/Assets/images/image-empty.png` as a global placeholder on all listing cards. No thumbnails available from this source.
- **No JSON-LD:** All extraction is HTML-only. Programme and performer parsing relies on `<strong>`/`<em>` pattern — same structure as ceskafilharmonie.cz detail pages.
- **Multiple dates per detail page:** One detail URL represents a full run of performances. The listing page shows only the first/next date. Always fetch the detail page to get all dates.
- **Buy URL goes to organizer:** `fok.cz`, `ceskafilharmonie.cz`, or other organizer sites — do not need to follow, just capture the href.
- **Organizer filter is stable:** `?organizer=fok` etc. are slug-based and unlikely to change.
- **CMS:** perspectivo.cz custom platform. Shared with or feeding ceskafilharmonie.cz — identical HTML patterns for programme/performer sections.
