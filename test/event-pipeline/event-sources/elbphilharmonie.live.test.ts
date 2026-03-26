import { ElbphilharmonieSource } from '../../../src/event-pipeline/event-sources/elbphilharmonie.js';
import type { Event } from '../../../src/event-pipeline/types.js';

const RUN_LIVE = process.env['LIVE'] === '1';
const describe_ = RUN_LIVE ? describe : describe.skip;

jest.setTimeout(120_000);

// Static canonical halls — fail if a new Elbphilharmonie/Laeiszhalle hall appears here
// Note: Kaistudio N and Kaispeicher N are matched by pattern (any numbered room is valid)
// Note: Only Laeiszhalle Großer Saal is in scope; other Laeiszhalle rooms are filtered out at source
const KNOWN_STATIC_VENUES = new Set([
  'Elbphilharmonie Großer Saal',
  'Elbphilharmonie Kleiner Saal',
  'Laeiszhalle Großer Saal',
]);

function isKnownElbLaeiszVenue(venue: string): boolean {
  return (
    KNOWN_STATIC_VENUES.has(venue) ||
    /^Elbphilharmonie Kaistudio/.test(venue) ||
    /^Elbphilharmonie Kaispeicher/.test(venue)
  );
}

describe_('ElbphilharmonieSource — live integration (LIVE=1 to run)', () => {
  let events: Event[] = [];

  beforeAll(async () => {
    const source = new ElbphilharmonieSource();
    events = await source.fetch();
  }, 120_000);

  it('returns at least 5 events', () => {
    console.log(`\n[elbphilharmonie live] Total events returned: ${events.length}`);
    expect(events.length).toBeGreaterThanOrEqual(5);
  });

  it('all events have required fields', () => {
    for (const event of events) {
      expect(event.title).toBeTruthy();
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(event.url).toContain('elbphilharmonie.de');
      expect(event.sourceId).toBe('elbphilharmonie');
      expect(event.venue).toBeTruthy();
    }
  });

  it('all Elbphilharmonie/Laeiszhalle venues are known canonical hall names', () => {
    const unknownMainVenues: string[] = [];
    const externalVenues = new Set<string>();

    for (const event of events) {
      const v = event.venue;
      if (v.startsWith('Elbphilharmonie') || v.startsWith('Laeiszhalle')) {
        if (!isKnownElbLaeiszVenue(v)) unknownMainVenues.push(v);
      } else {
        externalVenues.add(v);
      }
    }

    if (externalVenues.size > 0) {
      console.log(
        `[elbphilharmonie live] External/outreach venues (pass-through): ${[...externalVenues].join(', ')}`,
      );
    }

    // Fail if any new unrecognized Elbphilharmonie or Laeiszhalle hall appears
    expect(unknownMainVenues).toEqual([]);
  });

  it('at least one event has performers', () => {
    const withPerformers = events.filter(e => e.performers && e.performers.length > 0);
    console.log(`[elbphilharmonie live] Events with performers: ${withPerformers.length}/${events.length}`);
    expect(withPerformers.length).toBeGreaterThan(0);
  });

  it('at least one event has composers', () => {
    const withComposers = events.filter(e => e.composers && e.composers.length > 0);
    console.log(`[elbphilharmonie live] Events with composers: ${withComposers.length}/${events.length}`);
    expect(withComposers.length).toBeGreaterThan(0);
  });

  it('at least one event has a synthesized description', () => {
    const withDesc = events.filter(e => e.description && e.description.length > 0);
    console.log(`[elbphilharmonie live] Events with description: ${withDesc.length}/${events.length}`);
    expect(withDesc.length).toBeGreaterThan(0);
  });

  it('prints sample events for manual inspection', () => {
    const sample = events.slice(0, 3);
    console.log('\n[elbphilharmonie live] Sample events:');
    for (const e of sample) {
      console.log(JSON.stringify(e, null, 2));
    }
    expect(sample.length).toBeGreaterThan(0);
  });
});
