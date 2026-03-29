import { REGION } from '../types.js';
import type { Event, EventSource } from '../types.js';

const TM_BASE = 'https://app.ticketmaster.com/discovery/v2/events.json';
const PAGE_SIZE = 200;
const MAX_EVENTS = 500;
const MAX_PAGES = Math.ceil(MAX_EVENTS / PAGE_SIZE); // 3 pages max
const WINDOW_DAYS = 90;

export class TicketmasterSource implements EventSource {
  readonly id = 'ticketmaster';
  readonly region = REGION.CZECH;

  constructor(private readonly apiKey: string) {}

  async fetch(): Promise<Event[]> {
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + WINDOW_DAYS);

    const startDateTime = formatTmDate(now);
    const endDateTime = formatTmDate(end);

    const events: Event[] = [];
    let page = 0;

    while (events.length < MAX_EVENTS && page < MAX_PAGES) {
      if (page > 0) await new Promise(r => setTimeout(r, 250));
      const url = buildUrl(this.apiKey, startDateTime, endDateTime, page);
      console.log(`[ticketmaster] Fetching page ${page} (collected=${events.length})`);

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Ticketmaster API error: ${res.status} ${res.statusText}`);

      let data: TmResponse;
      try {
        data = await res.json() as TmResponse;
      } catch {
        throw new Error(`Ticketmaster API returned non-JSON response on page ${page}`);
      }
      const pageEvents = data._embedded?.events ?? [];

      for (const ev of pageEvents) {
        if (events.length >= MAX_EVENTS) break;
        const mapped = mapEvent(ev);
        if (mapped) events.push(mapped);
      }

      const totalPages = data.page?.totalPages ?? 1;
      if (page + 1 >= totalPages) break;
      page++;
    }

    console.log(`[ticketmaster] Done — ${events.length} events fetched`);
    return events;
  }
}

function formatTmDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function buildUrl(apiKey: string, startDateTime: string, endDateTime: string, page: number): string {
  const params = new URLSearchParams({
    apikey: apiKey,
    countryCode: 'CZ',
    classificationName: 'music',
    size: String(PAGE_SIZE),
    startDateTime,
    endDateTime,
    page: String(page),
  });
  return `${TM_BASE}?${params.toString()}`;
}

function mapEvent(ev: TmEvent): Event | null {
  const date = ev.dates?.start?.localDate;
  if (!date) { console.log(`[ticketmaster] Skipping event (no date): ${ev.name}`); return null; }
  if (!ev.url) { console.log(`[ticketmaster] Skipping event (no url): ${ev.name}`); return null; }

  const venue = ev._embedded?.venues?.[0]?.name ?? 'Unknown Venue';
  const performers = ev._embedded?.attractions?.map(a => a.name).filter((n): n is string => Boolean(n));
  const genreName = ev.classifications?.[0]?.genre?.name;

  return {
    title: ev.name,
    venue,
    date,
    url: ev.url,
    sourceId: 'ticketmaster',
    ...(performers && performers.length > 0 ? { performers } : {}),
    ...(genreName && genreName !== 'Undefined' ? { description: genreName } : {}),
  };
}

interface TmResponse {
  _embedded?: { events?: TmEvent[] };
  page?: { totalPages: number };
}

interface TmEvent {
  name: string;
  url?: string;
  dates: { start: { localDate?: string } };
  classifications?: Array<{ genre?: { name: string } }>;
  _embedded?: {
    venues?: Array<{ name: string }>;
    attractions?: Array<{ name?: string }>;
  };
}
