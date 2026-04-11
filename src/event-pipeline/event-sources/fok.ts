import { load } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { REGION } from '../types.js';
import type { Event, EventSource } from '../types.js';

const BASE_URL = 'https://www.fok.cz';
const LISTING_PATH = '/en/program';
const REQUEST_DELAY_MS = 250;
const MAX_LISTING_PAGES = 20;
const DETAIL_CONCURRENCY = 5;

// Navigation slugs present on every page — not event links
const NAV_SLUGS = new Set([
  'program', 'conductors', 'artists', 'auditions',
  'contacts', 'press', 'club', 'node',
  'prague-symphony-orchestra', 'partners', 'rental-church-sts-simon-and-jude',
]);

// Ensemble keyword detection — names containing these are performers with no role
const ENSEMBLE_KEYWORDS = [
  'Orchestra', 'Philharmonic', 'Ensemble', 'Quartet',
  'Trio', 'Duo', 'Choir', 'Chorus', 'Band',
];

// Venue name search strings — ordered most-specific first
const VENUE_STRINGS = [
  'Municipal House, Smetana Hall',
  'Smetana Hall',
  'Rudolfinum, Dvořák Hall',
  'Dvořák Hall',
  'Rudolfinum, Suk Hall',
  'Suk Hall',
  'Convent of St Agnes of Bohemia',
  'Bethlehem Chapel',
  'Municipal House',
  'Rudolfinum',
];


const EVENT_SLUG_RE = /^\/en\/([a-z][a-z0-9-]+)$/;

interface FokCard {
  slug: string;
  title: string;
  detailUrl: string;
}

interface ProgrammeEntry {
  composer: string;
  work: string;
}

interface FokDetail {
  dates: string[];           // ISO YYYY-MM-DD[], one per performance
  venue: string;
  performers: string[];      // "Name (role)" or "Name" for ensembles
  programme: ProgrammeEntry[];
}

export class FokSource implements EventSource {
  readonly id = 'fok';
  readonly region = REGION.CZECH;

  async fetch(): Promise<Event[]> {
    console.log('[fok] Starting scrape');

    const allCards = await this.scrapeAllListingPages();
    console.log(`[fok] Listing: ${allCards.length} events found`);

    const events: Event[] = [];

    for (let batchStart = 0; batchStart < allCards.length; batchStart += DETAIL_CONCURRENCY) {
      if (batchStart > 0) await delay(REQUEST_DELAY_MS);
      const batch = allCards.slice(batchStart, batchStart + DETAIL_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map(card => scrapeDetailPage(card.detailUrl)),
      );

      for (let j = 0; j < batch.length; j++) {
        const card = batch[j]!;
        const result = results[j]!;
        if (result.status === 'rejected') {
          console.warn(
            `[fok] Skipping event (detail error): ${card.detailUrl} —`,
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          );
          continue;
        }
        const detail = result.value;
        if (detail.dates.length === 0) {
          console.warn(`[fok] Skipping event (no dates parsed): ${card.detailUrl}`);
          continue;
        }
        for (const date of detail.dates) {
          try {
            events.push(mapToEvent(card, detail, date));
          } catch (err) {
            console.warn(
              `[fok] Skipping date ${date} for ${card.detailUrl} —`,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
      }
    }

    console.log(`[fok] Done — ${events.length} events`);
    return events;
  }

  private async scrapeAllListingPages(): Promise<FokCard[]> {
    const cards: FokCard[] = [];
    const seenSlugs = new Set<string>();

    for (let page = 0; page < MAX_LISTING_PAGES; page++) {
      if (page > 0) await delay(REQUEST_DELAY_MS);

      let pageCards: FokCard[];
      try {
        pageCards = await scrapeListingPage(page);
      } catch (err) {
        if (page === 0) throw err; // fatal — nothing collected yet
        console.warn(
          `[fok] Listing page ${page} failed, stopping pagination:`,
          err instanceof Error ? err.message : String(err),
        );
        break;
      }

      if (pageCards.length === 0) break; // end of listing

      for (const card of pageCards) {
        if (!seenSlugs.has(card.slug)) {
          seenSlugs.add(card.slug);
          cards.push(card);
        }
      }
    }

    return cards;
  }
}

async function scrapeListingPage(page: number): Promise<FokCard[]> {
  // FOK uses 0-based pagination. Page 0 has no ?page= param.
  const url = page === 0
    ? `${BASE_URL}${LISTING_PATH}`
    : `${BASE_URL}${LISTING_PATH}?page=${page}`;

  const html = await fetchHtml(url);
  const $ = load(html);
  const cards: FokCard[] = [];
  const seenOnPage = new Set<string>();

  $('a').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    // Strip fragment; preserve query string for detailUrl but use path-only for slug matching
    const hrefNoFrag = href.split('#')[0]!;
    const pathOnly = hrefNoFrag.split('?')[0]!;

    if (pathOnly.startsWith('/en/') && !EVENT_SLUG_RE.test(pathOnly)) {
      console.warn(`[fok] Skipping /en/ link with unexpected format: ${pathOnly}`);
    }
    const match = EVENT_SLUG_RE.exec(pathOnly);
    if (!match) return;

    const slug = match[1]!;
    if (NAV_SLUGS.has(slug)) return;

    const title = $(el).text().trim();
    if (!title) return; // skip image-only anchors

    if (seenOnPage.has(slug)) return; // deduplicate within page
    seenOnPage.add(slug);

    cards.push({
      slug,
      title,
      detailUrl: `${BASE_URL}${hrefNoFrag}`, // preserves query params, drops fragment
    });
  });

  return cards;
}

async function scrapeDetailPage(url: string): Promise<FokDetail> {
  const html = await fetchHtml(url);
  const $ = load(html);

  // --- Performance dates ---
  // Read the ISO date from <time datetime="YYYY-MM-DDTHH:MM:SSZ"> elements inside
  // .Ticket-date spans — these are the purchase buttons for each performance.
  // Using the datetime attribute avoids both the full-vs-abbreviated month-name ambiguity
  // and false matches from the "related events" <time> elements at the bottom of the page.
  // Dedup on YYYY-MM-DD — same-day rehearsal + evening show collapse to one Event, which
  // is intentional (the pipeline dedup hash uses title+date+venue anyway).
  const dates: string[] = [];
  const seenDates = new Set<string>();

  $('.Ticket-date time[datetime]').each((_, el) => {
    const datetimeAttr = $(el).attr('datetime') ?? '';
    const parsed = datetimeAttr.split('T')[0] ?? '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(parsed) && !seenDates.has(parsed)) {
      seenDates.add(parsed);
      dates.push(parsed);
    }
  });

  // --- Venue ---
  // Use $('body').text() — strips tags, excludes <head> and <script> blocks
  // (including Drupal settings JSON) avoiding false matches in those.
  let venue = '';
  const bodyText = $('body').text();
  for (const venueStr of VENUE_STRINGS) {
    if (bodyText.includes(venueStr)) {
      venue = venueStr;
      break;
    }
  }
  if (!venue) {
    console.warn(`[fok] Venue not found on ${url}, using fallback`);
    venue = 'FOK Prague';
  }

  // --- Performers and Programme via <strong> tag disambiguation ---
  // Actual FOK HTML structure (from inspection):
  //   Performer: <p><strong>Name</strong>| role</p>  — pipe in same text node
  //   Ensemble:  <p><strong>Prague Symphony Orchestra</strong></p>  — no following text
  //   Composer:  <p><strong>Composer</strong></p>  — sole child of <p>
  //              <p>Work title 1</p>               — work(s) in following <p> siblings
  //              <p>Work title 2</p>
  // Note: programme collects ALL entries including repeated composers (e.g. two works
  // by the same composer). Dedup for composers[] field is done in mapToEvent.
  const performers: string[] = [];
  const programme: ProgrammeEntry[] = [];

  $('strong').each((_, strongEl) => {
    // Normalize non-breaking spaces that FOK HTML includes after names
    const name = $(strongEl).text().replace(/\u00a0/g, ' ').trim();
    if (!name) return;

    // Walk forward past inline elements (e.g. <br>) to reach the role text node
    let sibling: AnyNode | null = strongEl.next ?? null;
    while (sibling && sibling.type !== 'text') {
      sibling = (sibling as { next?: AnyNode }).next ?? null;
    }
    const nextText = sibling
      ? ((sibling as unknown as { data: string }).data ?? '')
      : '';

    if (nextText.includes('|')) {
      // Performer with role(s) — all non-empty pipe segments are roles
      const roles = nextText.split('|').map(s => s.trim()).filter(Boolean);
      const role = roles.join(', ');
      performers.push(role ? `${name} (${role})` : name);
    } else if (ENSEMBLE_KEYWORDS.some(kw => name.includes(kw))) {
      // Ensemble/orchestra name — checked before composer path to avoid misclassification
      performers.push(name);
    } else {
      // Composer pattern: <p><strong>Composer</strong></p> followed by <p>Work</p> siblings.
      // Only applies when the <strong> is a direct child of a <p>.
      const parentPara = $(strongEl).parent('p');
      if (!parentPara.length) return; // not inside a <p> — skip (nav/header strong tags)

      let nextPara = parentPara.next('p');
      while (nextPara.length && !nextPara.find('strong').length) {
        const work = nextPara.text().replace(/\u00a0/g, ' ').replace(/^[\s—–-]+/, '').trim();
        if (work) programme.push({ composer: name, work });
        nextPara = nextPara.next('p');
      }
    }
  });

  // Warn if dates were found but performers/programme both empty — signals structure change
  if (dates.length > 0 && performers.length === 0 && programme.length === 0) {
    console.warn(`[fok] No performers or programme extracted from ${url} — verify HTML structure`);
  }

  return { dates, venue, performers, programme };
}


function buildDescription(detail: FokDetail): string | undefined {
  const parts: string[] = [];

  if (detail.programme.length > 0) {
    const progStr = detail.programme
      .map(p => (p.work ? `${p.composer} — ${p.work}` : p.composer))
      .join('; ');
    parts.push(`Programme: ${progStr}`);
  }

  if (detail.performers.length > 0) {
    parts.push(`Performers: ${detail.performers.join(', ')}`);
  }

  return parts.length > 0 ? parts.join('. ') + '.' : undefined;
}

function mapToEvent(card: FokCard, detail: FokDetail, date: string): Event {
  const composers = [...new Set(detail.programme.map(p => p.composer))];
  const description = buildDescription(detail);

  return {
    title: card.title,
    venue: detail.venue,
    date,
    url: card.detailUrl,
    sourceId: 'fok',
    ...(detail.performers.length > 0 ? { performers: detail.performers } : {}),
    ...(composers.length > 0 ? { composers } : {}),
    ...(description ? { description } : {}),
  };
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
    console.warn(`[fok] HTTP ${res.status} on attempt ${attempt}, retrying in ${waitMs}ms: ${url}`);
    await delay(waitMs);
    return fetchHtml(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  return res.text();
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
