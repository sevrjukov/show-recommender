# SOČR — Symfonický orchestr Českého rozhlasu Scraping Spike

**Date:** 2026-03-18
**Status:** Complete
**Conclusion:** Viable for scraping with plain `fetch` + `cheerio`. SSR Drupal, no headless browser needed. **Small catalogue** (~10 events per season-half); the listing page shows all upcoming concerts with no pagination. No JSON-LD or Schema.org data. Programme and performers share the same `.field.body` container with no class differentiation — requires heuristic parsing. Ticket buy button URL is hidden behind Drupal modal forms; use detail page URL as the entry point instead.

---

## Summary

`socr.rozhlas.cz` is a **Drupal** site (custom "e7" theme, Czech Radio platform). The listing page (`/koncerty-a-vstupenky`) shows the full upcoming season without pagination — typically 10–15 events. Detail pages contain programme and performer data as unstructured plain text within a single `.field.body` container. No `<img>` tags for images — hero images are CSS `background-image` properties. A `dataLayer` object on each detail page provides a machine-readable `airedDate` ISO timestamp. Ticket buttons exist but their destination URL is not exposed in the static HTML (Drupal modal form).

**Overlap with other sources:** Some SOČR concerts take place at Rudolfinum, Obecní dům (Smetana Hall), or Betlémská kaple. These may also appear on those venues' sites — apply dedup on `hash(normalized_date + venue + main_performer)`.

---

## Listing Page

```
GET https://socr.rozhlas.cz/koncerty-a-vstupenky
```

No headers or auth required.

---

## Pagination

| Property | Value |
|----------|-------|
| Mechanism | **None** — all upcoming events shown on a single page |
| Total events | ~10–11 per season-half (small orchestra catalogue) |
| Total count | Not displayed |
| `?page=1` | Returns "no content found" — not used |

**No pagination loop needed.** Scrape the single listing page and extract all events.

---

## Venue Filters

The listing page has filter buttons by venue (client-side JS, not URL params):

| Label | Venue |
|-------|-------|
| P | Premium series |
| R | Rudolfinum |
| O | Obecní dům |
| B | Betlémská kaple |
| S | Studio 1, Český rozhlas |

Additional filter tabs: Veřejné generální zkoušky (public dress rehearsals), Otevřené zkoušky (open rehearsals), Přijďte dřív (pre-concert talks), Zájezdy a festivaly (tours/festivals).

> Filters are client-side only — scrape the unfiltered page and apply pipeline filters.

---

## DOM Selectors — Listing Cards

```html
<a href="/[slug]-[id]">
  <!-- background-image set inline or via CSS -->
  <div class="...">
    <h3>[Concert title]</h3>
    <span>[Weekday DD.MM.YYYY, HH:MM]</span>
    <span>[Venue name]</span>
    <!-- filter labels: "P", "R", "O", "B", "S" -->
  </div>
</a>
```

| Field | Element / Pattern | Example |
|-------|-------------------|---------|
| Detail URL | `<a href="/[slug]-[id]">` | `/hrad-knizete-modrovouse-9430148` |
| Event ID | Numeric suffix after last `-` in slug | `9430148` |
| Title | `<h3>` inside card `<a>` | `Hrad knížete Modrovouse` |
| Date + time | `<span>` text node | `úterý 24. 3. 2026 v 19.30 hodin` |
| Venue | `<span>` text node | `Rudolfinum` |
| Image | CSS `background-image` on wrapper div | See image pattern below |
| Ticket link | Not on listing card | Detail page only |

### Event ID pattern

```
URL:  /hrad-knizete-modrovouse-9430148
ID:   9430148   ← last hyphen-segment
```

Extract with: `slug.rsplit("-", 1)[-1]`

### Image pattern

Images are CSS background images, not `<img>` tags:

```
https://socr.rozhlas.cz/sites/default/files/images/[md5-hash].jpg
```

Example:
```
https://socr.rozhlas.cz/sites/default/files/images/982e728950aad893a19ae2cadab06fcb_0.jpg
```

To extract: find `style="background-image: url('...')"` attribute on the card element and parse the URL from it.

---

## DOM Selectors — Detail Pages

Detail URL pattern:
```
https://socr.rozhlas.cz/[slug]-[id]
```

### dataLayer (machine-readable date)

Every detail page embeds a `dataLayer` push in a `<script>` block:

```json
{
  "entityLabel": "Hrad knížete Modrovouse",
  "contentID": 9430148,
  "airedDate": "2026-03-24 19:30:00",
  "contentCreationDateGMT": "2025-03-12T00:00:00+01:00",
  "theme": {"99": "Klasika"},
  "institution": {
    "8469585": "Český rozhlas D-dur",
    "8469537": "Český rozhlas Vltava"
  }
}
```

`airedDate` is the most reliable machine-readable performance date. Extract with a regex on the `<script>` block.

### Programme and Performers — shared container

Both programme and performer data live inside **one `.field.body` container** with no inner class differentiation:

```html
<div class="field body">
  <p>
    Béla Bartók: Hrad knížete Modrovouse (60 min.)
  </p>
  <p>
    Robert Jindra, dirigent
    Szilvia Vörös, mezzosoprán
    Günther Groissböck, bas
    Symfonický orchestr Českého rozhlasu
  </p>
</div>
```

**Programme format:** `Composer: Work title (duration)`
**Performer format:** `Name, role` (comma delimiter — different from FOK/Obecní dům pipe `|`)
Ensemble name appears without a role suffix.

| Field | Element | Notes |
|-------|---------|-------|
| Page title | `<h1>` | Concert title |
| Date/time (human) | `<p>` in `.field.body` or header area | Czech-locale: `pondělí 20. 4. 2026 v 19.30 hodin` |
| Date/time (machine) | `dataLayer["airedDate"]` in `<script>` | `2026-04-20 19:30:00` — **preferred** |
| Venue | `<p>` text node | `Rudolfinum`, `Studio 1, Český rozhlas` |
| Programme | `<p>` in `.field.body` | `Composer: Work (duration)` pattern |
| Performers | `<p>` in `.field.body` | `Name, role` comma pattern |
| Duration per work | In parentheses in programme text | `(39 min.)` |
| Hero image | `background-image: url(...)` CSS | `/sites/default/files/images/[hash].jpg` |
| Ticket button | `<a class="cro-form-button">Koupit vstupenku</a>` | **href not exposed in static HTML** — Drupal modal |
| Broadcast info | `<p>` text | `Koncert živě vysílá Český rozhlas D-dur` |

### Ticket URL — not extractable from static HTML

The "Koupit vstupenku" button triggers a Drupal modal form (module: `modal_forms`). The destination ticketing URL is loaded dynamically and is not present in the initial HTML. **Use the SOČR detail page URL as the ticket entry point** — visitors can click through to buy tickets from there.

---

## Fields Available vs Missing

### Listing page

| Field | Available | Notes |
|-------|-----------|-------|
| Title | ✅ | `<h3>` text |
| Event ID | ✅ | From URL slug suffix |
| Date + time | ✅ | `<span>` text — Czech locale, needs parsing |
| Venue | ✅ | `<span>` text |
| Detail URL | ✅ | `<a href>` |
| Image | ⚠️ | CSS background-image — requires style attribute parsing |
| Programme | ❌ | Detail page only |
| Performers | ❌ | Detail page only |
| Conductor | ❌ | Detail page only |
| Ticket link | ❌ | Detail page only (and even there, URL not in static HTML) |
| Price | ❌ | Detail page text (e.g. `1100 Kč \| 900 Kč \| ...`) |

### Detail page

| Field | Available | Notes |
|-------|-----------|-------|
| Machine-readable datetime | ✅ | `dataLayer["airedDate"]` in `<script>` |
| Venue | ✅ | Text in body |
| Programme | ✅ | `.field.body` `<p>` — `Composer: Work (duration)` |
| Work duration | ✅ | Parenthesised in programme text |
| Performers + roles | ✅ | `.field.body` `<p>` — `Name, role` comma format |
| Conductor | ✅ | Role `, dirigent` |
| Price tiers | ✅ | Text: `1100 Kč \| 900 Kč \| 700 Kč \| ...` |
| Hero image URL | ✅ | CSS background-image extraction |
| Broadcast schedule | ✅ | Text (Czech Radio D-dur / Vltava) |
| Direct ticket URL | ❌ | Hidden behind Drupal modal — not in static HTML |
| JSON-LD / Schema.org | ❌ | Absent entirely |
| Duration total | ⚠️ | Sometimes in listing title or body text |

---

## Example Entries

### Entry 1 — Opera in concert (single work)

```
Title:        Hrad knížete Modrovouse
Date:         úterý 24. 3. 2026 v 19.30 hodin
airedDate:    2026-03-24 19:30:00
Venue:        Rudolfinum
Programme:    Béla Bartók — Hrad knížete Modrovouse (60 min.)
Performers:   Robert Jindra, dirigent
              Szilvia Vörös, mezzosoprán
              Günther Groissböck, bas
              György Budányi, vypravěč
              Symfonický orchestr Českého rozhlasu
Detail URL:   /hrad-knizete-modrovouse-9430148
Image:        /sites/default/files/images/982e728950aad893a19ae2cadab06fcb_0.jpg
Price:        1100 Kč | 900 Kč | 700 Kč | 500 Kč | 300 Kč | 180 Kč
```

### Entry 2 — Mixed programme

```
Title:        Rachmaninovův Třetí klavírní koncert
Date:         pondělí 20. 4. 2026 v 19.30 hodin
airedDate:    2026-04-20 19:30:00
Venue:        Rudolfinum
Programme:    Sergej Rachmaninov — Koncert pro klavír a orchestr č. 3 d moll, op. 30 (39 min.)
              Igor Stravinskij — Oedipus rex (51 min.)
Performers:   Petr Popelka, dirigent
              Isata Kanneh-Mason, klavír
              Paul Appleby, tenor, Oedipus
Detail URL:   /rachmaninovuv-treti-klavirni-koncert-9430160
```

### Entry 3 — Chamber/ensemble (Studio 1)

```
Title:        Návrat ke kořenům
Date:         pondělí 23. 3. 2026 v 19.30 hodin
airedDate:    2026-03-23 19:30:00
Venue:        Studio 1, Český rozhlas
Performers:   České noneto (10 members listed individually)
Price:        200 Kč
Detail URL:   /navrat-ke-korenum-9426773
```

---

## JS Rendering Quirks

| Quirk | Impact |
|-------|--------|
| Venue filter buttons (P/R/O/B/S) | None — client-side only; scrape unfiltered |
| Ticket button Drupal modal | **Medium** — ticket URL not in static HTML; link to detail page instead |
| CSS `background-image` for photos | Low — parse `style` attribute; URL present in HTML source |
| Czech locale dates | Low — parse `DD. M. YYYY v HH.MM hodin`; use `dataLayer["airedDate"]` instead |
| `dataLayer` script block | **Useful** — contains machine-readable `airedDate` and `contentID` |

---

## Recommended Scraping Strategy

**Single-page listing — no loop needed:**

```
GET https://socr.rozhlas.cz/koncerty-a-vstupenky
```

Extract all event cards → detail URLs → scrape each detail page.

**Phase 1 — List scrape:**
- Extract: event ID (from slug suffix), title, date/time (`<span>`), venue (`<span>`), CSS background image URL, detail URL.

**Phase 2 — Detail scrape** (per event):
- Extract `dataLayer["airedDate"]` from `<script>` block — ISO datetime, most reliable.
- Parse `.field.body` paragraphs:
  - First `<p>` containing `: ` → programme lines (`Composer: Work (duration)`)
  - Subsequent `<p>` containing `, ` → performers (`Name, role`)
- Extract price tiers from text if needed.
- Use SOČR detail URL as the ticket entry point (no direct ticket URL available).

**Genre pre-filter:** All SOČR events are orchestral/chamber classical — no filtering needed for genre. Filter out `Otevřené zkoušky` (open rehearsals) by event type label if desired.

---

## Minimal Fetch Recipe

```python
import requests
from bs4 import BeautifulSoup
import re
import json

BASE = "https://socr.rozhlas.cz"

def fetch_listing():
    resp = requests.get(f"{BASE}/koncerty-a-vstupenky", headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    events = []
    for a in soup.find_all("a", href=re.compile(r"^/[a-z].*-\d+$")):
        href = a["href"]
        event_id = href.rsplit("-", 1)[-1]
        h3 = a.find("h3")
        spans = a.find_all("span")
        # CSS background image
        style_div = a.find(style=re.compile(r"background-image"))
        image_url = None
        if style_div:
            m = re.search(r"url\(['\"]?([^'\"]+)['\"]?\)", style_div.get("style", ""))
            image_url = BASE + m.group(1) if m else None

        events.append({
            "id": event_id,
            "detail_url": BASE + href,
            "title": h3.get_text(strip=True) if h3 else None,
            "date_raw": spans[0].get_text(strip=True) if spans else None,
            "venue": spans[1].get_text(strip=True) if len(spans) > 1 else None,
            "image_url": image_url,
        })
    return events

def fetch_detail(detail_url):
    resp = requests.get(detail_url, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # Machine-readable date from dataLayer
    aired_date = None
    for script in soup.find_all("script"):
        if "airedDate" in (script.string or ""):
            m = re.search(r'"airedDate"\s*:\s*"([^"]+)"', script.string)
            if m:
                aired_date = m.group(1)  # "2026-03-24 19:30:00"

    # Programme and performers from .field.body
    body = soup.find(class_=re.compile(r"field.*body|body.*field"))
    programme, performers = [], []
    if body:
        for p in body.find_all("p"):
            text = p.get_text(strip=True)
            # Programme lines contain "Composer: Work" pattern
            if re.search(r"[A-ZÁÉÍÓÚŮČĎĚŇŘŠŤŽ][^:]+:.+", text):
                for line in text.splitlines():
                    m = re.match(r"(.+?):\s*(.+?)(?:\s*\((\d+)\s*min\.?\))?$", line.strip())
                    if m:
                        programme.append({
                            "composer": m.group(1).strip(),
                            "work": m.group(2).strip(),
                            "duration_min": int(m.group(3)) if m.group(3) else None,
                        })
            # Performer lines: "Name, role"
            elif ", " in text and not re.search(r"\d{4}", text):
                for line in text.splitlines():
                    parts = line.strip().rsplit(",", 1)
                    if len(parts) == 2:
                        performers.append({"name": parts[0].strip(), "role": parts[1].strip()})

    return {
        "aired_date": aired_date,
        "programme": programme,
        "performers": performers,
    }
```

> **Note on programme/performer disambiguation:** The heuristic above uses `: ` presence for programme lines and `, ` for performer lines. This will need validation against a larger sample — some works have colons in their titles, and some text paragraphs may be editorial prose. Scope parsing to the relevant `<p>` blocks by position or content fingerprint after inspecting live HTML.

---

## Fields Useful for Recommender

| Use case | Fields | Source |
|----------|--------|--------|
| Display | `title`, `aired_date`, `venue` | Listing + dataLayer |
| Programme | `programme[].composer`, `.work`, `.duration_min` | Detail `.field.body` |
| Performers | `performers[].name`, `.role` | Detail `.field.body` |
| Conductor | `performers[]` where `role == "dirigent"` | Detail `.field.body` |
| Deep link | `detail_url` (also serves as ticket entry) | Listing |
| Dedup key | `id` (e.g. `9430160`) from URL slug | Listing URL |
| Image | `image_url` (CSS background) | Listing card style attr |
| City | Prague (hardcode) | — |

---

## Notes & Risks

- **Small catalogue.** ~10–15 events per season-half; no pagination needed. Check for a full season archive if historical data is needed.
- **No ticket URL in static HTML.** The Drupal `modal_forms` module hides the destination. Link users to the SOČR detail page; they can buy from there.
- **`airedDate` in dataLayer is the cleanest date source.** Avoids parsing Czech-locale month names (`března`, `dubna`, etc.).
- **Programme/performers share `.field.body`.** No semantic separation between the two sections. The colon-vs-comma heuristic is fragile — validate against real data before deploying.
- **CSS background images.** Unlike other sources, there are no `<img>` tags. Image URL must be extracted from `style="background-image: url(...)"` attributes — may be on a nested `<div>` rather than the `<a>` itself.
- **Czech-only site.** No English version with cleaner structure; `prso.czech.radio` redirects to `concertino.czech.radio` (a different aggregator product). Stick with `socr.rozhlas.cz`.
- **Overlap with Rudolfinum / Obecní dům.** SOČR concerts at Rudolfinum or Smetana Hall will appear on those venues' sites. Dedup on `hash(normalized_date + venue + conductor)`.
- **Event ID is reliable.** The numeric suffix (e.g. `9430148`) is a Drupal node ID — stable and unique per event.
- **Drupal version:** Older Drupal (pre-8 based on module names like `ctools`, `panels`, `views` — likely Drupal 7). Higher risk of eventual migration/redesign.
