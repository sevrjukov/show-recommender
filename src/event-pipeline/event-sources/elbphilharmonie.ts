import { load, type CheerioAPI } from 'cheerio';
import { REGION } from '../types.js';
import type { Event, EventSource } from '../types.js';

const BASE = 'https://www.elbphilharmonie.de';
const REQUEST_DELAY_MS = 250;
const DETAIL_CONCURRENCY = 5;
const HORIZON_WEEKS = 25;

const EXCLUDE_REGEX =
  /(?:^|[\s/,(])(Jazz|Pop|Rock|Electronic|DJ|Comedy|Chanson|Hip[- ]?Hop|Blues|Gospel|Spoken Word|Kulturcafé)(?:[\s/,).]|$)/i;

interface ElbCard {
  numericId: string;
  title: string;
  subtitle: string;
  isoDatetime: string;
  building: string;
  room: string;
  detailUrl: string;
}

interface ElbDetail {
  description: string;
  performers: string[];
  programme: Array<{ composer: string; works: string[] }>;
}

export class ElbphilharmonieSource implements EventSource {
  readonly id = 'elbphilharmonie';
  readonly region = REGION.INTERNATIONAL;

  async fetch(): Promise<Event[]> {
    console.log('[elbphilharmonie] Starting scrape');

    const horizonDate = new Date();
    horizonDate.setDate(horizonDate.getDate() + HORIZON_WEEKS * 7);

    const allCards: ElbCard[] = [];
    let currentUrl = `${BASE}/en/whats-on/LHGS/EPGS/`;

    for (let i = 0; i < 200; i++) {
      if (i > 0) await delay(REQUEST_DELAY_MS);

      let html: string;
      try {
        html = await fetchHtml(currentUrl);
      } catch (err) {
        if (i === 0) throw err;
        console.warn(
          `[elbphilharmonie] Listing fetch failed, stopping:`,
          err instanceof Error ? err.message : String(err),
        );
        break;
      }

      const { cards, nextDataUrl } = scrapeCards(html);
      allCards.push(...cards);

      if (!nextDataUrl) break;

      const dateMatch = nextDataUrl.match(/(\d{2}-\d{2}-\d{4})/);
      if (!dateMatch) {
        console.warn(`[elbphilharmonie] Cannot parse date from data-url: ${nextDataUrl}`);
        break;
      }

      const parts = dateMatch[1]!.split('-');
      // data-url format: DD-MM-YYYY → parse as YYYY-MM-DD
      const nextDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
      if (isNaN(nextDate.getTime())) {
        console.warn(`[elbphilharmonie] Cannot parse date from data-url: ${nextDataUrl}`);
        break;
      }

      if (nextDate > horizonDate) break;

      currentUrl = `${BASE}${nextDataUrl}/ajax/1`;
    }

    console.log(`[elbphilharmonie] Listing: ${allCards.length} events found`);

    const filtered = allCards.filter(c => !isExcluded(c.title, c.subtitle));
    const excluded = allCards.length - filtered.length;
    console.log(`[elbphilharmonie] Genre filter: ${excluded} excluded, ${filtered.length} remain`);

    const events: Event[] = [];

    for (let batchStart = 0; batchStart < filtered.length; batchStart += DETAIL_CONCURRENCY) {
      if (batchStart > 0) await delay(REQUEST_DELAY_MS);
      const batch = filtered.slice(batchStart, batchStart + DETAIL_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map(card => fetchDetail(card.detailUrl)),
      );

      for (let j = 0; j < batch.length; j++) {
        const card = batch[j]!;
        const result = results[j]!;

        if (result.status === 'rejected') {
          console.warn(
            `[elbphilharmonie] Skipping event (detail error): ${card.numericId} —`,
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          );
          continue;
        }

        try {
          events.push(mapToEvent(card, result.value));
        } catch (err) {
          console.warn(
            `[elbphilharmonie] Skipping event (map error): ${card.numericId} —`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    console.log(`[elbphilharmonie] Done — ${events.length} events`);
    return events;
  }
}

function scrapeCards(html: string): { cards: ElbCard[]; nextDataUrl: string | null } {
  const $ = load(html);
  const cards: ElbCard[] = [];

  $('li.event-item').each((_, el) => {
    const $el = $(el);

    const detailHref = $el.find('p.event-title a').attr('href');
    if (!detailHref) {
      console.warn('[elbphilharmonie] Skipping card: missing detailHref');
      return;
    }

    const title = $el.find('p.event-title a').text().trim();
    if (!title) {
      console.warn(`[elbphilharmonie] Skipping card: empty title (href=${detailHref})`);
      return;
    }

    const isoDatetime = $el.find('time').attr('datetime') ?? '';
    if (!isoDatetime || !/^\d{4}-\d{2}-\d{2}T/.test(isoDatetime)) {
      console.warn(
        `[elbphilharmonie] Skipping card: invalid datetime "${isoDatetime}" (title=${title})`,
      );
      return;
    }

    const subtitle = $el.find('p.event-subtitle').text().trim();
    const numericId = detailHref.split('/').filter(Boolean).pop() ?? '';
    if (!numericId) {
      console.warn(`[elbphilharmonie] Skipping card: empty numericId (href=${detailHref})`);
      return;
    }

    const placeCaption = $el.find('.place-cell .caption.uppercase');
    const building = placeCaption.find('strong').text().trim();
    const fullPlaceText = placeCaption.text().trim();
    const room = (building ? fullPlaceText.replace(building, '') : fullPlaceText)
      .replace(/\u2002/g, ' ')
      .trim();

    const detailUrl = detailHref.startsWith('http') ? detailHref : `${BASE}${detailHref}`;

    cards.push({
      numericId,
      title,
      subtitle,
      isoDatetime,
      building,
      room,
      detailUrl,
    });
  });

  const nextDataUrl = $('li[data-url]').last().attr('data-url') ?? null;

  return { cards, nextDataUrl };
}

function isExcluded(title: string, subtitle: string): boolean {
  return EXCLUDE_REGEX.test(`${title} ${subtitle}`);
}

async function fetchDetail(detailUrl: string): Promise<ElbDetail> {
  const html = await fetchHtml(detailUrl);
  const $ = load(html);

  // Extract description from JSON-LD MusicEvent schema
  let description = '';
  $('script[type="application/ld+json"]').each((_, el) => {
    if (description) return;
    try {
      const data = JSON.parse($(el).html() ?? '') as Record<string, unknown>;
      if (data['@type'] === 'MusicEvent' && typeof data['description'] === 'string') {
        description = data['description'];
      }
    } catch {
      // ignore JSON parse errors
    }
  });

  const performers = parsePerformers($);
  const programme = parseProgramme($);

  return { description, performers, programme };
}

function parsePerformers($: CheerioAPI): string[] {
  const performers: string[] = [];

  const performersH3 = $('h3').filter((_, el) => $(el).text().trim() === 'Performers').first();
  if (performersH3.length === 0) return performers;

  let $el = performersH3.next();
  while ($el.length > 0 && !$el.is('h3')) {
    if ($el.is('p.artists')) {
      const pHtml = $el.html() ?? '';
      let searchFrom = 0;

      while (true) {
        const bOpen = pHtml.indexOf('<b>', searchFrom);
        if (bOpen < 0) break;
        const bClose = pHtml.indexOf('</b>', bOpen);
        if (bClose < 0) break;

        const nameHtml = pHtml.substring(bOpen + 3, bClose);
        const name = $('<span>').html(nameHtml).text().trim();

        if (name) {
          // Text before this <b>, after the previous </b>
          const prevClose = pHtml.lastIndexOf('</b>', bOpen);
          const beforeHtml = pHtml.substring(prevClose >= 0 ? prevClose + 4 : 0, bOpen);
          const before = $('<div>').html(beforeHtml).text().replace(/\u2002/g, ' ').trim();

          let role: string;
          if (before.length > 0) {
            // Conductor pattern: role text appears before <b>name</b>
            role = before;
          } else {
            // Soloist pattern: role text appears after </b>
            const nextOpen = pHtml.indexOf('<b>', bClose + 4);
            const afterHtml =
              nextOpen >= 0 ? pHtml.substring(bClose + 4, nextOpen) : pHtml.substring(bClose + 4);
            role = $('<div>').html(afterHtml).text().replace(/\u2002/g, ' ').trim();
          }

          performers.push(role ? `${name} (${role})` : name);
        }

        searchFrom = bClose + 4;
      }
    }
    $el = $el.next();
  }

  return performers;
}

function parseProgramme($: CheerioAPI): Array<{ composer: string; works: string[] }> {
  const result: Array<{ composer: string; works: string[] }> = [];

  const programmeH3 = $('h3').filter((_, el) => $(el).text().trim() === 'Programme').first();
  if (programmeH3.length === 0) return result;

  // .readmore-wrapper is nested inside a sibling div, not a direct sibling of h3
  const wrapper = programmeH3.nextAll().find('.readmore-wrapper').first();
  if (wrapper.length === 0) return result;

  wrapper.find('p').each((_, el) => {
    const $p = $(el);
    if ($p.find('b').length === 0) return; // skip interval markers (use <span class="pause">)

    const composer = $p.find('b').first().text().trim();
    if (!composer) return;

    // Remove all <b> elements from a clone to isolate remaining work titles
    const $clone = $p.clone();
    $clone.find('b').remove();
    const remainingHtml = $clone.html() ?? '';

    const works = remainingHtml
      .split(/<br\s*\/?>/gi)
      .map(part => $('<span>').html(part).text().trim())
      .filter(s => s.length > 0);

    result.push({ composer, works });
  });

  return result;
}

function mapToEvent(card: ElbCard, detail: ElbDetail): Event {
  const date = card.isoDatetime.substring(0, 10);
  const venue = canonicalVenue(card.building, card.room);
  const performers = detail.performers;
  const composers = [
    ...new Set(detail.programme.map(p => p.composer).filter(c => c.length > 0)),
  ];
  const description = buildDescription(detail.programme, detail.performers);

  return {
    title: card.title,
    venue,
    date,
    url: card.detailUrl,
    sourceId: 'elbphilharmonie',
    ...(performers.length > 0 ? { performers } : {}),
    ...(composers.length > 0 ? { composers } : {}),
    ...(description ? { description } : {}),
  };
}

function buildDescription(
  programme: Array<{ composer: string; works: string[] }>,
  performers: string[],
): string | undefined {
  const parts: string[] = [];

  if (programme.length > 0) {
    const progStr = programme
      .map(p => (p.works.length > 0 ? `${p.composer} — ${p.works.join('; ')}` : p.composer))
      .join('; ');
    parts.push(`Programme: ${progStr}`);
  }

  if (performers.length > 0) {
    parts.push(`Performers: ${performers.join(', ')}`);
  }

  return parts.length > 0 ? parts.join('. ') + '.' : undefined;
}

function canonicalVenue(building: string, room: string): string {
  const b = building.trim();
  const r = room.trim();

  if (b === 'Elbphilharmonie') {
    if (r === 'Großer Saal') return 'Elbphilharmonie Großer Saal';
    if (r === 'Kleiner Saal') return 'Elbphilharmonie Kleiner Saal';
    if (r === 'Kaistudio') return 'Elbphilharmonie Kaistudio 1'; // normalize bare name
    if (r.startsWith('Kaistudio')) return `Elbphilharmonie ${r}`;
    if (r.startsWith('Kaispeicher')) return `Elbphilharmonie ${r}`;
  }

  if (b === 'Laeiszhalle') {
    if (r === 'Großer Saal') return 'Laeiszhalle Großer Saal';
  }

  const fallback = `${b} ${r}`.trim();
  console.warn(`[elbphilharmonie] Unknown hall: building="${b}" room="${r}"`);
  return fallback;
}

async function fetchHtml(url: string, attempt = 1): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; show-recommender-bot/1.0)' },
    signal: AbortSignal.timeout(10_000),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    const retryAfterSec = parseInt(res.headers.get('Retry-After') ?? '', 10);
    const waitMs =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.min(retryAfterSec * 1000, 10_000)
        : attempt * 500;
    console.warn(
      `[elbphilharmonie] HTTP ${res.status} on attempt ${attempt}, retrying in ${waitMs}ms: ${url}`,
    );
    await res.body?.cancel();
    await delay(waitMs);
    return fetchHtml(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  return res.text();
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
