import { load } from 'cheerio';
import { REGION } from '../types.js';
import type { Event, EventSource } from '../types.js';

const LISTING_BASE = 'https://spielplan.musikverein.at';
const DETAIL_BASE = 'https://musikverein.at';
const REQUEST_DELAY_MS = 250;
const DETAIL_CONCURRENCY = 5;
const EXCLUDE_TITLE_KEYWORDS = ['Vortrag', 'Talkrunde', 'Führung', 'Workshop', 'Kinderkonzert'];

interface MvCard {
  id: string;
  title: string;
  detailUrl: string;
  eventType: 'EV' | 'FV';
}

interface MvCastEntry {
  name: string;
  role: string;
}

interface MvProgrammeEntry {
  composer: string;
  work: string;
  isEncore: boolean;
}

interface MvDetail {
  dateStart: string;
  isCancelled: boolean;
  cast: MvCastEntry[];
  programme: MvProgrammeEntry[];
}

interface MvApiResponse {
  booking: {
    data: Array<{
      date_start: string;
      booking_status_is_cancelled: string;
    }>;
  };
  cast: {
    data: Array<{
      name_D: string;
      name_E: string;
      profession_D: string;
      performer_display_mode: string;
      order: string;
    }>;
  };
  program: {
    data: Array<{
      composer_author: string;
      opus_titel_D: string;
      order: number;
      is_encore: number;
    }>;
  };
}

export class MusikvereinSource implements EventSource {
  readonly id = 'musikverein';
  readonly region = REGION.INTERNATIONAL;

  async fetch(): Promise<Event[]> {
    console.log('[musikverein] Starting scrape');

    const months = generateMonths(12);
    const allCards: MvCard[] = [];

    for (let i = 0; i < months.length; i++) {
      if (i > 0) await delay(REQUEST_DELAY_MS);
      try {
        const cards = await scrapeListingPage(months[i]!);
        allCards.push(...cards);
      } catch (err) {
        if (i === 0) throw err;
        console.warn(
          `[musikverein] Listing page ${months[i]} failed, skipping:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    console.log(`[musikverein] Listing: ${allCards.length} events found`);

    const filtered = allCards.filter(
      c => !EXCLUDE_TITLE_KEYWORDS.some(kw => c.title.includes(kw)),
    );
    console.log(
      `[musikverein] After keyword filter: ${filtered.length} events ` +
      `(${allCards.length - filtered.length} excluded)`,
    );

    const events: Event[] = [];

    for (let batchStart = 0; batchStart < filtered.length; batchStart += DETAIL_CONCURRENCY) {
      if (batchStart > 0) await delay(REQUEST_DELAY_MS);
      const batch = filtered.slice(batchStart, batchStart + DETAIL_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map(card => fetchEventDetail(card.id)),
      );

      for (let j = 0; j < batch.length; j++) {
        const card = batch[j]!;
        const result = results[j]!;

        if (result.status === 'rejected') {
          console.warn(
            `[musikverein] Skipping event (detail error): ${card.id} —`,
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          );
          continue;
        }

        const detail = result.value;

        if (detail.isCancelled) {
          console.log(`[musikverein] Skipping cancelled event: ${card.id}`);
          continue;
        }

        try {
          events.push(mapToEvent(card, detail));
        } catch (err) {
          console.warn(
            `[musikverein] Skipping event (map error): ${card.id} —`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    console.log(`[musikverein] Done — ${events.length} events`);
    return events;
  }
}

async function scrapeListingPage(month: string): Promise<MvCard[]> {
  const url = `${LISTING_BASE}/spielplan?month=${month}`;
  const html = await fetchHtml(url);
  const $ = load(html);
  const cards: MvCard[] = [];
  const seenIds = new Set<string>();

  $('div.event').each((_, el) => {
    const id = $(el).attr('id') ?? '';
    if (!id) {
      console.warn('[musikverein] div.event missing id attribute');
      return;
    }

    const title = $(el).find('h3.event--heading').text().trim();
    if (!title) {
      console.warn(`[musikverein] Skipping event with empty title (id=${id})`);
      return;
    }

    if (seenIds.has(id)) return;
    seenIds.add(id);

    const eventType = $(el).hasClass('EV') ? 'EV' : 'FV';
    const detailUrl = `${DETAIL_BASE}/konzert/?id=${id}`;

    cards.push({ id, title, detailUrl, eventType });
  });

  return cards;
}

async function fetchEventDetail(id: string): Promise<MvDetail> {
  const url = `${LISTING_BASE}/e/${id}.json`;
  const data = await fetchJson<MvApiResponse>(url);

  const booking = data.booking?.data?.[0];
  if (!booking) throw new Error('No booking data in API response for id: ' + id);

  const rawDate = booking.date_start;
  if (!rawDate || rawDate.length < 10) throw new Error('Invalid date_start: ' + rawDate);

  const dateStart = rawDate.substring(0, 10);
  const isCancelled = booking.booking_status_is_cancelled === 'True';

  const cast: MvCastEntry[] = (data.cast?.data ?? [])
    .map(c => ({ name: c.name_D?.trim() || c.name_E?.trim() || '', role: c.profession_D }))
    .filter(c => c.name !== '');

  const programme: MvProgrammeEntry[] = (data.program?.data ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter(p => p.composer_author !== '***')
    .map(p => ({
      composer: p.composer_author,
      work: p.opus_titel_D,
      isEncore: !!p.is_encore,
    }));

  return { dateStart, isCancelled, cast, programme };
}

function mapToEvent(card: MvCard, detail: MvDetail): Event {
  if (!detail.dateStart) throw new Error('No dateStart for event: ' + card.id);

  const performers = detail.cast.map(c => c.role ? `${c.name} (${c.role})` : c.name);
  const composers = [...new Set(detail.programme.map(p => p.composer))];
  const description = buildDescription(detail.programme, performers);

  return {
    title: card.title,
    venue: 'Musikverein Wien',
    date: detail.dateStart,
    url: card.detailUrl,
    sourceId: 'musikverein',
    ...(performers.length > 0 ? { performers } : {}),
    ...(composers.length > 0 ? { composers } : {}),
    ...(description ? { description } : {}),
  };
}

function buildDescription(programme: MvProgrammeEntry[], performers: string[]): string | undefined {
  const parts: string[] = [];

  if (programme.length > 0) {
    const progStr = programme
      .map(p => p.work ? `${p.composer} — ${p.work}` : p.composer)
      .join('; ');
    parts.push(`Programme: ${progStr}`);
  }

  if (performers.length > 0) {
    parts.push(`Performers: ${performers.join(', ')}`);
  }

  return parts.length > 0 ? parts.join('. ') + '.' : undefined;
}

function generateMonths(n: number): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    months.push(`${year}-${month}`);
  }
  return months;
}

async function fetchHtml(url: string, attempt = 1): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; show-recommender-bot/1.0)' },
    signal: AbortSignal.timeout(10_000),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    const retryAfterSec = parseInt(res.headers.get('Retry-After') ?? '', 10);
    const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? Math.min(retryAfterSec * 1000, 10_000)
      : attempt * 500;
    console.warn(`[musikverein] HTTP ${res.status} on attempt ${attempt}, retrying in ${waitMs}ms: ${url}`);
    await delay(waitMs);
    return fetchHtml(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  return res.text();
}

async function fetchJson<T>(url: string, attempt = 1): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; show-recommender-bot/1.0)' },
    signal: AbortSignal.timeout(10_000),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    const retryAfterSec = parseInt(res.headers.get('Retry-After') ?? '', 10);
    const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? Math.min(retryAfterSec * 1000, 10_000)
      : attempt * 500;
    console.warn(`[musikverein] HTTP ${res.status} on attempt ${attempt}, retrying in ${waitMs}ms: ${url}`);
    await delay(waitMs);
    return fetchJson<T>(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  return res.json() as T;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
