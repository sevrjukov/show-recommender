# Berliner Philharmoniker — Internal API Spike

**Date:** 2026-03-18
**Status:** Complete
**Conclusion:** Viable for scraping without a headless browser

---

## Summary

The site uses a **self-hosted Typesense** instance (reverse-proxied at the same domain) with a public read-only API key embedded in `window.typesense_config`. No headless browser needed — plain HTTP GET requests with one header.

---

## Endpoint

```
GET https://www.berliner-philharmoniker.de/filter/search/collections/performance_1/documents/search
```

**Required header:**
```
X-TYPESENSE-API-KEY: 09zNJI6igIRLJHhNB2YGwgaX0JApQYOL
```

> Note: This is a public read-only search key embedded in the page HTML (`window.typesense_config`). It may rotate — re-scrape the page if it stops working.

---

## Query Parameters

| Parameter | Type | Example | Notes |
|-----------|------|---------|-------|
| `q` | string | `""` or `"Chopin"` | Full-text search. Empty string = all concerts |
| `query_by` | string | `title,place,works_raw,artists_raw,super_title,brand_title,brand_title_second` | Fields searched by `q`. Send as-is |
| `filter_by` | string | see below | Typesense filter expression |
| `sort_by` | string | `time_start:asc` | Sort field + direction |
| `facet_by` | string | `tags` | Returns tag counts alongside hits |
| `max_facet_values` | int | `30` | Max values returned per facet |
| `per_page` | int | `20` | Results per page (max observed: 20) |
| `page` | int | `1` | 1-indexed page number |
| `drop_tokens_threshold` | int | `0` | Typesense token dropping — keep at 0 |
| `limit_hits` | int | `0` | Set to 0 for count-only queries (no hits returned) |

### `filter_by` patterns observed

**Main concerts (own events):**
```
is_guest_event:false && tags:!=Guided tours && time_start:>=<unix_timestamp>
```

**Guest events (count-only sidecar query):**
```
is_guest_event:true && time_start:>=<unix_timestamp>
```

> `time_start` is a Unix timestamp. The site uses `Date.now() / 1000` (current time) to exclude past events. Use `0` or omit to get all events including historical.

**Filter by tag (e.g. Chamber Music only):**
```
is_guest_event:false && tags:=Chamber Music && time_start:>=<unix_timestamp>
```

---

## Pagination

- `found` (top-level) = total matching documents
- Default page size: `20`
- Pages are 1-indexed
- Iterate `page=1,2,...` until `hits` is empty or `(page-1)*per_page >= found`
- Example: `found=98`, fetch pages 1–5

---

## Response Shape

```json
{
  "found": 98,
  "facet_counts": [
    {
      "field_name": "tags",
      "sampled": false,
      "stats": { "total_values": 14 },
      "counts": [
        { "value": "Berliner Philharmoniker", "count": 42, "highlighted": "Berliner Philharmoniker" },
        { "value": "On tour", "count": 21, "highlighted": "On tour" }
      ]
    }
  ],
  "hits": [
    {
      "document": { ... },
      "highlight": {},
      "highlights": [],
      "text_match": 100,
      "text_match_info": {
        "best_field_score": "0",
        "best_field_weight": 12,
        "fields_matched": 4,
        "score": "100",
        "tokens_matched": 0
      }
    }
  ]
}
```

### `document` fields

| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `id` | string | `"1167"` | Typesense document ID |
| `uid` | int | `9393` | TYPO3 internal UID |
| `title` | string | `"Ithay Khen, Markus Schlemmer"` | Usually performer names |
| `super_title` | string | `"Lunch concert"` | Concert series / category label |
| `brand_title` | string | `""` | Secondary branding |
| `brand_title_second` | string | `""` | Tertiary branding |
| `place` | string | `"Main Auditorium"` | Venue / hall name |
| `primary_category` | string | `"lunch_cat"` | Internal category slug |
| `tags` | string[] | `["Organ", "Singers"]` | Filter tags (same as facets) |
| `time_start` | int | `1773835200` | Unix timestamp of start |
| `time_start_formatted` | string | `"13:00"` | Formatted start time |
| `date_string` | string | `"Wed 18 March 2026"` | Formatted date |
| `time_string` | string | `"13:00"` | Formatted time |
| `date_time_string` | string | `"Wed 18 March 2026, 13:00 "` | Combined date+time |
| `intro_time` | int | `0` | Pre-concert talk offset (minutes?) |
| `is_free` | bool | `true` | Free admission |
| `is_guest_event` | bool | `false` | Guest/external event flag |
| `is_house_tour` | bool | `false` | Building tour (not a concert) |
| `is_invitation_claim` | bool | `true` | Invitation-only |
| `is_lunch_concert` | bool | `true` | Lunch concert flag |
| `is_works_overview_overwritten` | bool | `false` | Custom works summary override |
| `is_works_overwritten` | bool | `false` | Custom works list override |
| `artists` | object[] | `[{"name": "Ithay Khen", "role": "cello"}]` | Structured performers |
| `artists_raw` | string | `"Ithay Khen cello ..."` | Plain-text version for search |
| `artists_formatted` | string | `"<p><strong>...</strong></p>"` | HTML version |
| `artists_with_super_title_formatted` | string | HTML | Artists + series label combined |
| `works` | object[] | `[{}, {}, {}]` | Often empty objects — use `works_formatted` |
| `works_count` | int | `3` | Number of works on programme |
| `works_raw` | string | `"Beethoven Twelve Variations..."` | Plain-text programme for search |
| `works_formatted` | string | HTML | Full programme with composers, titles |
| `works_overview_formatted` | string | `"Beethoven, Schumann and Shostakovich"` | Short programme summary |
| `detail_url` | string | `"/en/concert/calendar/56552/"` | Relative URL to concert detail page |
| `presale_id` | string | `"000000e9001e5cfc"` | Ticketing system presale ID |
| `tickets_url` | string | `"Discontinued"` or URL | Ticket purchase link |
| `cinema` | string | `""` | Cinema broadcast info |
| `cinema_url` | string | `"/en/concerts/broadcasts/cinemas/"` | Cinema broadcast page |
| `dch_url` | string | `""` | Digital Concert Hall URL |
| `notification` | any[] | `[]` | Event notifications/alerts |
| `thumbnail` | object | see below | Concert image |

### `thumbnail` shape

```json
{
  "alternative": "Alt text string (optional)",
  "formats": {
    "sm":  { "src": "/fileadmin/...", "src_retina": "/fileadmin/..." },
    "md":  { "src": "/fileadmin/...", "src_retina": "/fileadmin/..." },
    "lg":  { "src": "/fileadmin/...", "src_retina": "/fileadmin/..." },
    "xl":  { "src": "/fileadmin/...", "src_retina": "/fileadmin/..." },
    "xxl": { "src": "/fileadmin/...", "src_retina": "/fileadmin/..." }
  }
}
```

Image paths are relative — prepend `https://www.berliner-philharmoniker.de`.

---

## Available Tag Values (observed)

From `facet_counts` on an unfiltered query:

| Tag | Count |
|-----|-------|
| Berliner Philharmoniker | 42 |
| On tour | 21 |
| Modern | 16 |
| Lunch Concerts | 15 |
| Easter Festival | 13 |
| Chamber Music | 12 |
| Singers | 11 |
| Children and Family | 11 |
| Piano | 7 |
| Young Ensembles | 3 |
| Talks and Literature | 3 |
| Jazz | 2 |
| Organ | 2 |
| World | 1 |

---

## Minimal Fetch Recipe

```python
import requests
from time import time

BASE = "https://www.berliner-philharmoniker.de/filter/search"
COLLECTION = "performance_1"
API_KEY = "09zNJI6igIRLJHhNB2YGwgaX0JApQYOL"

def fetch_concerts(page=1, q=""):
    resp = requests.get(
        f"{BASE}/collections/{COLLECTION}/documents/search",
        headers={"X-TYPESENSE-API-KEY": API_KEY},
        params={
            "q": q,
            "query_by": "title,place,works_raw,artists_raw,super_title,brand_title,brand_title_second",
            "filter_by": f"is_guest_event:false && tags:!=Guided tours && time_start:>={int(time())}",
            "sort_by": "time_start:asc",
            "facet_by": "tags",
            "max_facet_values": 30,
            "per_page": 20,
            "page": page,
            "drop_tokens_threshold": 0,
        }
    )
    resp.raise_for_status()
    return resp.json()
```

---

## Fields Useful for Recommender

| Use case | Fields |
|----------|--------|
| Display | `title`, `super_title`, `date_time_string`, `place`, `thumbnail` |
| Programme | `works_formatted`, `works_overview_formatted`, `works_raw` |
| Performers | `artists`, `artists_raw` |
| Classification | `tags`, `primary_category`, `is_free`, `is_guest_event` |
| Deep link | `detail_url` (prepend base URL) |
| Dedup key | `uid` or `presale_id` |
| City | Berlin (hardcode — all events are at Philharmonie Berlin or "On tour") |

---

## Notes & Risks

- **API key rotation:** The key is in `window.typesense_config` on the HTML page. If it changes, re-fetch the page to get the new key.
- **`works` array:** The structured `works[]` items are often empty objects `{}`. Use `works_formatted` (HTML) or `works_raw` (plain text) instead.
- **"On tour" events:** Have `is_guest_event:false` but the `tags` field includes `"On tour"`. These are BPh events at non-Berlin venues. The `place` field will reflect the actual location but no city name is provided — consider filtering these out or resolving the venue.
- **Guest events:** `is_guest_event:true` events are third-party concerts at the Philharmonie. The site makes a parallel count-only query for these. They may be lower quality for a BPh-specific recommender.
- **No auth required** beyond the API key header.
- **No rate limiting** observed in the HAR (sequential page fetches worked fine).
