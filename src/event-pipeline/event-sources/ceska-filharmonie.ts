import { load } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { Event, EventSource } from '../types.js';

const BASE_URL = 'https://www.ceskafilharmonie.cz';
const LISTING_PATH = '/en/whats-on/';
const REQUEST_DELAY_MS = 250;
const MAX_LISTING_PAGES = 10;
const DETAIL_CONCURRENCY = 5; // parallel detail fetches per batch

// Event types to include; all others (Workshop, Education programs, etc.) are excluded
const INCLUDE_EVENT_TYPES = new Set(['Concert', 'Dress rehearsal', 'Annotated concert']);
// Ordered most-specific first — prevents 'Concert' matching inside 'Annotated concert'
const KNOWN_EVENT_TYPES = [
  'Dress rehearsal',
  'Annotated concert',
  'Education programs',
  'Workshop',
  'Concert',
] as const;

interface CfCard {
  eventId: string;
  title: string;
  detailUrl: string;
  eventType: string;
}

interface CfDetail {
  title: string;        // from JSON-LD name (full title); falls back to listing anchor text
  date: string;         // ISO YYYY-MM-DD from JSON-LD
  venue: string;        // from JSON-LD location.name
  description: string;  // from JSON-LD description, HTML-stripped
  performers: string[]; // ["Sol Gabetta (cello)", "Semyon Bychkov (conductor)"]
  composers: string[];  // ["Edward Elgar", "Igor Stravinsky"]
}

/** Narrows AnyNode to Element (tag nodes), giving typed access to `.name`. */
function isTag(node: AnyNode): node is Element {
  return node.type === 'tag';
}

export class CeskaFilharmonieSource implements EventSource {
  readonly id = 'ceska-filharmonie';

  async fetch(): Promise<Event[]> {
    console.log('[ceska-filharmonie] Starting scrape');

    const allCards = await this.scrapeAllListingPages();
    console.log(`[ceska-filharmonie] Listing: ${allCards.length} events found`);

    const filtered = allCards.filter(c => INCLUDE_EVENT_TYPES.has(c.eventType));
    console.log(`[ceska-filharmonie] After type filter: ${filtered.length} events (${allCards.length - filtered.length} excluded)`);

    const events: Event[] = [];

    // Batch-parallel detail fetches — sequential would take 50+ × ~1.25s ≈ 62s,
    // exceeding the pipeline source timeout. Batching at DETAIL_CONCURRENCY ≈ 15s total.
    for (let batchStart = 0; batchStart < filtered.length; batchStart += DETAIL_CONCURRENCY) {
      if (batchStart > 0) await delay(REQUEST_DELAY_MS);
      const batch = filtered.slice(batchStart, batchStart + DETAIL_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map(card => scrapeDetailPage(card.detailUrl)),
      );

      for (let j = 0; j < batch.length; j++) {
        const card = batch[j]!;
        const result = results[j]!;
        if (result.status === 'rejected') {
          console.warn(
            `[ceska-filharmonie] Skipping event (detail error): ${card.detailUrl} —`,
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          );
          continue;
        }
        try {
          events.push(mapToEvent(card, result.value));
        } catch (err) {
          console.warn(
            `[ceska-filharmonie] Skipping event (map error): ${card.detailUrl} —`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    console.log(`[ceska-filharmonie] Done — ${events.length} events`);
    return events;
  }

  private async scrapeAllListingPages(): Promise<CfCard[]> {
    const cards: CfCard[] = [];
    const seenIds = new Set<string>();

    for (let page = 1; page <= MAX_LISTING_PAGES; page++) {
      if (page > 1) await delay(REQUEST_DELAY_MS);

      let pageCards: CfCard[];
      try {
        pageCards = await scrapeListingPage(page);
      } catch (err) {
        if (page === 1) throw err; // fatal — nothing collected yet
        console.warn(
          `[ceska-filharmonie] Listing page ${page} failed, stopping pagination:`,
          err instanceof Error ? err.message : String(err),
        );
        break;
      }

      if (pageCards.length === 0) break; // clean end-of-listing

      for (const card of pageCards) {
        if (!seenIds.has(card.eventId)) {
          seenIds.add(card.eventId);
          cards.push(card);
        }
      }
    }

    return cards;
  }
}

async function scrapeListingPage(page: number): Promise<CfCard[]> {
  const url =
    page === 1
      ? `${BASE_URL}${LISTING_PATH}`
      : `${BASE_URL}${LISTING_PATH}?page=${page}`;

  const html = await fetchHtml(url);
  const $ = load(html);
  const cards: CfCard[] = [];

  // Dedup within the page by eventId — the same event may appear via multiple
  // anchors (image link, title link, ticket link). Keep the first non-empty-title
  // occurrence; subsequent anchors for the same ID are logged and discarded.
  const seenOnPage = new Set<string>();

  $('a[href^="/en/event/"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const title = $(el).text().trim();
    if (!title) return; // skip empty/image-only anchors

    const idMatch = /^\/en\/event\/(\d+)-/.exec(href);
    if (!idMatch) {
      // Log unexpected URL formats so CF URL changes are immediately visible
      console.warn(`[ceska-filharmonie] Skipping link with unexpected URL format: ${href}`);
      return;
    }

    const eventId = idMatch[1]!;
    if (seenOnPage.has(eventId)) return; // duplicate anchor on same page
    seenOnPage.add(eventId);

    const detailUrl = `${BASE_URL}${href.split('?')[0]!.split('#')[0]!}`;

    // Scope to the nearest <li> for card isolation; fall back to parent text.
    // KNOWN_EVENT_TYPES ordered most-specific first to avoid substring false-positives.
    // Unknown types → 'Unknown' (excluded by INCLUDE_EVENT_TYPES) with a warning.
    // VALIDATION: verify against 20+ real listing cards during development.
    const cardText = $(el).closest('li').text() || $(el).parent().text();
    let eventType: string | undefined;
    for (const type of KNOWN_EVENT_TYPES) {
      if (cardText.includes(type)) {
        eventType = type;
        break;
      }
    }
    if (!eventType) {
      console.warn(`[ceska-filharmonie] Unrecognized event type for "${title}" — excluding from pipeline`);
      eventType = 'Unknown';
    }

    cards.push({ eventId, title, detailUrl, eventType });
  });

  return cards;
}

async function scrapeDetailPage(url: string): Promise<CfDetail> {
  const html = await fetchHtml(url);
  const $ = load(html);

  // --- JSON-LD: iterate all blocks, pick the one with startDate (the Event block) ---
  // Pages often include BreadcrumbList / WebSite JSON-LD before the Event block;
  // using .first() unconditionally would extract the wrong block.
  // for...of (not .each()) so TypeScript can track the assignment to `ld`.
  let ld: Record<string, unknown> | null = null;
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed = JSON.parse($(el).html() ?? '{}') as Record<string, unknown>;
      if (typeof parsed['startDate'] === 'string') {
        ld = parsed;
        break;
      }
    } catch (e) {
      console.warn(`[ceska-filharmonie] Skipping malformed JSON-LD block on ${url}:`, e instanceof Error ? e.message : String(e));
    }
  }

  let title = '';
  let date = '';
  let venue = '';
  let description = '';

  if (ld) {
    // Extract to local consts — avoids TS narrowing-through-callback producing 'never'
    const startDate = ld['startDate'];
    const descriptionRaw = ld['description'];
    const loc = ld['location'];

    const nameRaw = ld['name'];
    if (typeof nameRaw === 'string') {
      title = load(nameRaw).text().trim();
    }
    if (typeof startDate === 'string') {
      // Parse as Europe/Prague local date — slicing is wrong for UTC ISO strings
      // e.g. "2026-03-18T23:00:00Z" (00:00 CET) would slice to the wrong day
      date = new Date(startDate).toLocaleDateString('sv', { timeZone: 'Europe/Prague' });
    }
    if (typeof descriptionRaw === 'string') {
      // Use cheerio to strip HTML and decode entities correctly
      description = load(descriptionRaw).text().replace(/\s+/g, ' ').trim();
    }
    // location can be a Place object or an array of Place objects
    const locObj = Array.isArray(loc) ? (loc[0] as Record<string, unknown>) : (loc as Record<string, unknown> | undefined);
    if (typeof locObj?.['name'] === 'string') {
      venue = load(locObj['name']).text().trim();
    }
  }

  // --- Full performers from <h2>Performers</h2> section ---
  // Structure: <strong>Name</strong> [whitespace text node] <em>role</em>
  // Raw DOM traversal handles whitespace nodes; isTag() guard narrows AnyNode to Element.
  const performers: string[] = [];
  const perfH2 = $('h2')
    .filter((_, el) => $(el).text().trim() === 'Performers')
    .first();

  if (perfH2.length) {
    let currentName: string | null = null;
    let node: AnyNode | null = (perfH2[0] as Element).next ?? null;
    while (node) {
      if (isTag(node)) {
        if (node.name === 'h2') break;
        if (node.name === 'strong') {
          if (currentName !== null) performers.push(currentName); // flush (no role found)
          currentName = $(node).text().trim() || null;
        } else if (node.name === 'em' && currentName !== null) {
          const role = $(node).text().trim();
          performers.push(role ? `${currentName} (${role})` : currentName);
          currentName = null;
        }
      }
      node = node.next ?? null;
    }
    if (currentName !== null) performers.push(currentName); // flush last

    if (performers.length === 0) {
      // Warn if the section exists but yielded nothing — signals HTML structure change
      console.warn(`[ceska-filharmonie] No performers extracted from ${url} — verify HTML structure`);
    }
  }

  // --- Composers from <h2>Programme</h2> section ---
  // Structure: <strong>Composer Name</strong> + text node work title [+ intermission marker]
  // Only <strong> elements are collected; text nodes (work titles) and intermissions are ignored.
  // Note: uses `progNode` (not `node`) to avoid redeclaring the variable from the Performers block.
  const composersSet = new Set<string>();
  const progH2 = $('h2')
    .filter((_, el) => $(el).text().trim() === 'Programme')
    .first();

  if (progH2.length) {
    let progNode: AnyNode | null = (progH2[0] as Element).next ?? null;
    while (progNode) {
      if (isTag(progNode)) {
        if (progNode.name === 'h2') break;
        if (progNode.name === 'strong') {
          const composer = $(progNode).text().trim();
          if (composer) composersSet.add(composer);
        }
      }
      progNode = progNode.next ?? null;
    }

    if (composersSet.size === 0) {
      // Warn if the section exists but yielded nothing — signals HTML structure change
      console.warn(`[ceska-filharmonie] No composers extracted from ${url} — verify HTML structure`);
    }
  }

  const composers = Array.from(composersSet);
  return { title, date, venue, description, performers, composers };
}

function mapToEvent(card: CfCard, detail: CfDetail): Event {
  if (!detail.date) {
    throw new Error(`No date found in JSON-LD for: ${card.detailUrl}`);
  }
  return {
    title: detail.title || card.title,
    venue: detail.venue || 'Česká filharmonie',
    date: detail.date,
    url: card.detailUrl,
    sourceId: 'ceska-filharmonie',
    ...(detail.performers.length > 0 ? { performers: detail.performers } : {}),
    ...(detail.composers.length > 0 ? { composers: detail.composers } : {}),
    ...(detail.description ? { description: detail.description } : {}),
  };
}

async function fetchHtml(url: string, attempt = 1): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; show-recommender-bot/1.0)' },
    signal: AbortSignal.timeout(10_000),
  });
  if ((res.status === 429 || res.status === 503) && attempt < 3) {
    console.warn(`[ceska-filharmonie] HTTP ${res.status} on attempt ${attempt}, retrying: ${url}`);
    await delay(attempt * 500);
    return fetchHtml(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  return res.text();
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
