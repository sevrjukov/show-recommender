import { load } from 'cheerio';
import type { Event, EventSource } from '../types.js';

const BASE_URL = 'https://socr.rozhlas.cz';
const LISTING_PATH = '/koncerty-a-vstupenky';
const REQUEST_DELAY_MS = 250;
const DETAIL_CONCURRENCY = 5;

// Matches SOČR event hrefs: /slug-with-hyphens-12345678
const EVENT_HREF_RE = /^\/[a-z][a-z0-9-]+-(\d+)$/;
const AIRED_DATE_RE = /"airedDate"\s*:\s*"([^"]+)"/;

function resolveImageUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const path = raw.trim();
  if (path.startsWith('//')) return 'https:' + path;
  if (path.startsWith('/')) return BASE_URL + path;
  if (path.startsWith('http')) return path;
  return BASE_URL + '/' + path;
}

interface SocrCard {
  eventId: string;
  title: string;
  venue: string;
  imageUrl: string | undefined;
  detailUrl: string;
}

interface ProgrammeEntry {
  composer: string;
  work: string;
  durationMin: number | undefined;
}

interface SocrDetail {
  date: string | undefined;   // ISO YYYY-MM-DD from dataLayer airedDate
  performers: string[];        // "Name (role)" format
  programme: ProgrammeEntry[];
}

export class SocrSource implements EventSource {
  readonly id = 'socr';

  async fetch(): Promise<Event[]> {
    console.log('[socr] Starting scrape');

    const cards = await scrapeListingPage();
    console.log(`[socr] Listing: ${cards.length} events found`);

    const events: Event[] = [];

    for (let batchStart = 0; batchStart < cards.length; batchStart += DETAIL_CONCURRENCY) {
      if (batchStart > 0) await delay(REQUEST_DELAY_MS);
      const batch = cards.slice(batchStart, batchStart + DETAIL_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map(card => scrapeDetailPage(card.detailUrl)),
      );

      for (let j = 0; j < batch.length; j++) {
        const card = batch[j]!;
        const result = results[j]!;
        if (result.status === 'rejected') {
          console.warn(
            `[socr] Skipping event (detail error): ${card.detailUrl} —`,
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          );
          continue;
        }
        const detail = result.value;
        if (!detail.date) {
          console.warn(`[socr] Skipping event (no date parsed): ${card.detailUrl}`);
          continue;
        }
        try {
          events.push(mapToEvent(card, detail));
        } catch (err) {
          console.warn(
            `[socr] Skipping event ${card.detailUrl} —`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    console.log(`[socr] Done — ${events.length} events`);
    return events;
  }
}

async function scrapeListingPage(): Promise<SocrCard[]> {
  const url = BASE_URL + LISTING_PATH;
  const html = await fetchHtml(url);
  const $ = load(html);
  const cards: SocrCard[] = [];
  const seenIds = new Set<string>();

  // Actual card structure:
  //   <li class="b-004__list-item ...">
  //     <div class="image"><a class="image-link" href="/slug-id"><picture>...</picture></a></div>
  //     <h3><a href="/slug-id">Title</a></h3>
  //     <a href="/slug-id"><p>Venue, day date. month. year v HH.MM hodin</p></a>
  //   </li>
  $('li.b-004__list-item').each((_, li) => {
    const titleAnchor = $(li).find('h3 a').first();
    const href = titleAnchor.attr('href') ?? '';
    const match = EVENT_HREF_RE.exec(href);
    if (!match) return;

    const eventId = match[1]!;
    const title = titleAnchor.text().trim();
    if (!title) return;

    if (seenIds.has(eventId)) return;
    seenIds.add(eventId);

    // Venue/date in <a><p> (the non-image link with a <p> child)
    const venueText = $(li).find('a:not(.image-link) p').first().text().trim();
    // Extract venue as the first comma-separated segment before date info
    const venue = venueText.split(',')[0]?.trim() ?? '';

    // Extract image URL from <source data-srcset="..."> inside the image div
    let imageUrl: string | undefined;
    const firstSource = $(li).find('source').first();
    const srcset = firstSource.attr('data-srcset') ?? firstSource.attr('srcset') ?? '';
    if (srcset) {
      const rawSrc = srcset.split(' ')[0];
      imageUrl = resolveImageUrl(rawSrc);
    }

    cards.push({
      eventId,
      title,
      venue,
      imageUrl,
      detailUrl: BASE_URL + href,
    });
  });

  return cards;
}

async function scrapeDetailPage(url: string): Promise<SocrDetail> {
  const html = await fetchHtml(url);
  const $ = load(html);

  // --- Date from dataLayer airedDate ---
  let date: string | undefined;
  $('script').each((_, el) => {
    const text = $(el).text();
    if (!text.includes('airedDate')) return;
    const m = AIRED_DATE_RE.exec(text);
    if (m) {
      date = m[1]!.substring(0, 10); // YYYY-MM-DD
      return false; // break
    }
    return; // explicit return for noImplicitReturns
  });

  // --- Programme and performers from .field.body ---
  const performers: string[] = [];
  const programme: ProgrammeEntry[] = [];

  const selectors = [
    'div.field.body',
    'div.field-body',
    'div.field--name-body',
    'div[class*="field"][class*="body"]',
  ];

  let bodyContainer = $();
  let matchedSelector = '';
  for (const sel of selectors) {
    const found = $(sel);
    if (found.length > 0) {
      bodyContainer = found;
      matchedSelector = sel;
      break;
    }
  }

  if (!bodyContainer.length) {
    console.warn(`[socr] No .field.body found on ${url}`);
  } else {
    console.log(`[socr] field.body selector: ${matchedSelector}`);

    bodyContainer.find('p').each((_, pEl) => {
      const rawText = $(pEl).text();
      const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

      for (const line of lines) {
        if (line.includes(':') && !/^\d{1,2}:\d{2}/.test(line)) {
          // Programme line
          const m = /^(.+?):\s*(.+?)(?:\s*\((\d+)\s*min\.?\))?$/.exec(line);
          if (m) {
            programme.push({
              composer: m[1]!.trim(),
              work: m[2]!.trim(),
              durationMin: m[3] ? parseInt(m[3], 10) : undefined,
            });
          } else {
            console.warn(`[socr] Unrecognised programme line: "${line}"`);
          }
        } else if (line.includes(',')) {
          // Performer line
          const idx = line.lastIndexOf(',');
          const name = line.slice(0, idx).trim();
          const role = line.slice(idx + 1).trim();
          performers.push(role ? `${name} (${role})` : name);
        } else {
          // Ensemble line — no comma, no colon
          performers.push(line);
        }
      }
    });

    if (performers.length === 0 && programme.length === 0) {
      console.warn(`[socr] No performers or programme extracted from ${url} — verify HTML structure`);
    }
  }

  return { date, performers, programme };
}

function mapToEvent(card: SocrCard, detail: SocrDetail): Event {
  const composers = [...new Set(detail.programme.map(p => p.composer))];
  const performers = [...new Set(detail.performers)];
  const description = buildDescription({ ...detail, performers });
  if (!card.venue) {
    console.warn(`[socr] Venue not parsed for ${card.detailUrl}, using fallback`);
  }
  return {
    title: card.title,
    venue: card.venue || 'SOČR Prague',
    date: detail.date!,
    url: card.detailUrl,
    sourceId: 'socr',
    ...(performers.length > 0 ? { performers } : {}),
    ...(composers.length > 0 ? { composers } : {}),
    ...(description ? { description } : {}),
  };
}

function buildDescription(detail: SocrDetail): string | undefined {
  const parts: string[] = [];

  if (detail.programme.length > 0) {
    const progStr = detail.programme
      .map(p => {
        const base = p.work ? `${p.composer} — ${p.work}` : p.composer;
        return p.durationMin ? `${base} (${p.durationMin} min.)` : base;
      })
      .join('; ');
    parts.push(`Programme: ${progStr}`);
  }

  if (detail.performers.length > 0) {
    parts.push(`Performers: ${detail.performers.join(', ')}`);
  }

  return parts.length > 0 ? parts.join('. ') + '.' : undefined;
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
    console.warn(`[socr] HTTP ${res.status} on attempt ${attempt}, retrying in ${waitMs}ms: ${url}`);
    await delay(waitMs);
    return fetchHtml(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  return res.text();
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
