import { REGION } from '../types.js';
import type { Event, EventSource } from '../types.js';

const BASE_URL = 'https://www.berliner-philharmoniker.de';
const API_BASE = `${BASE_URL}/filter/search`;
const COLLECTION = 'performance_1';
// Public read-only key embedded in window.typesense_config — update if requests start returning 401
const API_KEY = '09zNJI6igIRLJHhNB2YGwgaX0JApQYOL';
const PER_PAGE = 20;
const REQUEST_DELAY_MS = 250;

interface BpArtist {
  name: string;
  role?: string;
}

interface BpDocument {
  id: string;
  uid: number;
  title: string;
  super_title?: string;
  place: string;
  time_start: number;
  detail_url: string;
  artists: BpArtist[];
  works_overview_formatted?: string;
  works_raw?: string;
  artists_raw?: string;
}

interface BpSearchResponse {
  found: number;
  hits: Array<{ document: BpDocument }>;
}

export class BerlinerPhilSource implements EventSource {
  readonly id = 'berliner-phil';
  readonly region = REGION.INTERNATIONAL;

  async fetch(): Promise<Event[]> {
    console.log('[berliner-phil] Starting fetch');

    const filterBy = `is_guest_event:false && tags:!=Guided tours && time_start:>=${Math.floor(Date.now() / 1000)}`;
    const searchUrl = `${API_BASE}/collections/${COLLECTION}/documents/search`;

    const buildParams = (page: number): string =>
      new URLSearchParams({
        q: '',
        query_by: 'title,place,works_raw,artists_raw,super_title,brand_title,brand_title_second',
        filter_by: filterBy,
        sort_by: 'time_start:asc',
        per_page: String(PER_PAGE),
        page: String(page),
        drop_tokens_threshold: '0',
      }).toString();

    const page1 = await fetchJson<BpSearchResponse>(`${searchUrl}?${buildParams(1)}`);
    const { found } = page1;
    console.log(`[berliner-phil] Found ${found} events`);

    if (!Array.isArray(page1.hits)) throw new Error('[berliner-phil] Unexpected API response: hits is not an array');
    const allHits = [...page1.hits];
    const totalPages = Math.ceil(found / PER_PAGE);

    for (let page = 2; page <= totalPages; page++) {
      await delay(REQUEST_DELAY_MS);
      const data = await fetchJson<BpSearchResponse>(`${searchUrl}?${buildParams(page)}`);
      allHits.push(...data.hits);
    }

    const events: Event[] = [];
    for (const hit of allHits) {
      try {
        events.push(mapToEvent(hit.document));
      } catch (err) {
        console.warn(
          `[berliner-phil] Skipping event (map error): ${hit.document.id} —`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    console.log(`[berliner-phil] Done — ${events.length} events`);
    return events;
  }
}

function mapToEvent(doc: BpDocument): Event {
  const title = doc.super_title ? `${doc.super_title}: ${doc.title}` : doc.title;
  const date = new Date(doc.time_start * 1000).toISOString().substring(0, 10);
  const detailPath = doc.detail_url.startsWith('/') ? doc.detail_url : `/${doc.detail_url}`;
  const url = `${BASE_URL}${detailPath}`;
  const performers = parsePerformers(doc.artists);
  const composers = parseComposers(doc.works_overview_formatted);
  const description = buildDescription(doc.works_raw, doc.artists_raw);

  return {
    title,
    venue: doc.place,
    date,
    url,
    sourceId: 'berliner-phil',
    ...(performers.length > 0 ? { performers } : {}),
    ...(composers.length > 0 ? { composers } : {}),
    ...(description ? { description } : {}),
  };
}

function parsePerformers(artists: BpArtist[]): string[] {
  return artists
    .map(a => {
      const name = a.name?.trim() ?? '';
      if (!name) return null;
      const role = a.role?.trim() ?? '';
      return role ? `${name} (${role})` : name;
    })
    .filter((x): x is string => x !== null);
}

function parseComposers(overview: string | undefined): string[] {
  if (!overview?.trim()) return [];
  return overview
    .split(' and ')
    .flatMap(part => part.split(', '))
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function buildDescription(worksRaw: string | undefined, artistsRaw: string | undefined): string | undefined {
  const parts: string[] = [];
  if (worksRaw?.trim()) parts.push(`Programme: ${worksRaw.trim()}`);
  if (artistsRaw?.trim()) parts.push(`Performers: ${artistsRaw.trim()}`);
  return parts.length > 0 ? parts.join('. ') + '.' : undefined;
}

async function fetchJson<T>(url: string, attempt = 1): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; show-recommender-bot/1.0)',
      'X-TYPESENSE-API-KEY': API_KEY,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    const retryAfterSec = parseInt(res.headers.get('Retry-After') ?? '', 10);
    const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? Math.min(retryAfterSec * 1000, 10_000)
      : attempt * 500;
    console.warn(`[berliner-phil] HTTP ${res.status} on attempt ${attempt}, retrying in ${waitMs}ms: ${url}`);
    await res.body?.cancel();
    await delay(waitMs);
    return fetchJson<T>(url, attempt + 1);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  return res.json() as T;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
