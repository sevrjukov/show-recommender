import { BerlinerPhilSource } from '../../../src/event-pipeline/event-sources/berliner-phil.js';
import type { Event } from '../../../src/event-pipeline/types.js';

const RUN_LIVE = process.env['LIVE'] === '1';
const describe_ = RUN_LIVE ? describe : describe.skip;

jest.setTimeout(120_000);

describe_('BerlinerPhilSource — live integration (LIVE=1 to run)', () => {
  let events: Event[] = [];

  beforeAll(async () => {
    const source = new BerlinerPhilSource();
    events = await source.fetch();
  }, 120_000);

  it('returns at least 5 events', () => {
    console.log(`\n[berliner-phil live] Total events returned: ${events.length}`);
    expect(events.length).toBeGreaterThanOrEqual(5);
  });

  it('fetches more than one page (pagination works)', () => {
    expect(events.length).toBeGreaterThan(20);
  });

  it('all events have required fields', () => {
    for (const event of events) {
      expect(event.title).toBeTruthy();
      expect(event.venue).toBeTruthy();
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(event.url).toMatch(/^https:\/\/www\.berliner-philharmoniker\.de\/en\/concert\/calendar\//);
      expect(event.sourceId).toBe('berliner-phil');
    }
  });

  it('at least one event has performers', () => {
    const withPerformers = events.filter(e => e.performers && e.performers.length > 0);
    console.log(`[berliner-phil live] Events with performers: ${withPerformers.length}/${events.length}`);
    expect(withPerformers.length).toBeGreaterThan(0);
    for (const p of withPerformers[0]!.performers!) {
      expect(p).toMatch(/^[^(]+( \(.+\))?$/);
    }
  });

  it('at least one event has composers', () => {
    const withComposers = events.filter(e => e.composers && e.composers.length > 0);
    console.log(`[berliner-phil live] Events with composers: ${withComposers.length}/${events.length}`);
    expect(withComposers.length).toBeGreaterThan(0);
    for (const c of withComposers[0]!.composers!) {
      expect(c.length).toBeGreaterThan(0);
    }
  });

  it('at least one event has a synthesized description', () => {
    const withDesc = events.filter(e => e.description && e.description.length > 0);
    console.log(`[berliner-phil live] Events with description: ${withDesc.length}/${events.length}`);
    expect(withDesc.length).toBeGreaterThan(0);
    expect(withDesc[0]!.description).toMatch(/^(Programme:|Performers:)/);
  });

  it('prints sample events for manual inspection', () => {
    const sample = events.slice(0, 3);
    console.log('\n[berliner-phil live] Sample events:');
    for (const e of sample) {
      console.log(JSON.stringify(e, null, 2));
    }
    expect(sample.length).toBeGreaterThan(0);
  });
});
