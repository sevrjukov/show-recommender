import { MusikvereinSource } from '../../../src/event-pipeline/event-sources/musikverein.js';
import type { Event } from '../../../src/event-pipeline/types.js';

const RUN_LIVE = process.env['LIVE'] === '1';
const describe_ = RUN_LIVE ? describe : describe.skip;

jest.setTimeout(120_000);

describe_('MusikvereinSource — live integration (LIVE=1 to run)', () => {
  let events: Event[] = [];

  beforeAll(async () => {
    const source = new MusikvereinSource();
    events = await source.fetch();
  }, 120_000);

  it('returns at least 5 events', () => {
    console.log(`\n[musikverein live] Total events returned: ${events.length}`);
    expect(events.length).toBeGreaterThanOrEqual(5);
  });

  it('all events have required fields', () => {
    for (const event of events) {
      expect(event.title).toBeTruthy();
      expect(event.venue).toBe('Musikverein Wien');
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(event.url).toMatch(/musikverein\.at\/konzert\/\?id=/);
      expect(event.sourceId).toBe('musikverein');
    }
  });

  it('at least one event has performers', () => {
    const withPerformers = events.filter(e => e.performers && e.performers.length > 0);
    console.log(`[musikverein live] Events with performers: ${withPerformers.length}/${events.length}`);
    expect(withPerformers.length).toBeGreaterThan(0);
  });

  it('at least one event has composers', () => {
    const withComposers = events.filter(e => e.composers && e.composers.length > 0);
    console.log(`[musikverein live] Events with composers: ${withComposers.length}/${events.length}`);
    expect(withComposers.length).toBeGreaterThan(0);
  });

  it('at least one event has a synthesized description', () => {
    const withDesc = events.filter(e => e.description && e.description.length > 0);
    console.log(`[musikverein live] Events with description: ${withDesc.length}/${events.length}`);
    expect(withDesc.length).toBeGreaterThan(0);
  });

  it('prints sample events for manual inspection', () => {
    const sample = events.slice(0, 3);
    console.log('\n[musikverein live] Sample events:');
    for (const e of sample) {
      console.log(JSON.stringify(e, null, 2));
    }
    expect(sample.length).toBeGreaterThan(0);
  });
});
