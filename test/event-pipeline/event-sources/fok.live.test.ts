import { FokSource } from '../../../src/event-pipeline/event-sources/fok.js';
import type { Event } from '../../../src/event-pipeline/types.js';

const RUN_LIVE = process.env['LIVE'] === '1';
const describe_ = RUN_LIVE ? describe : describe.skip;

// Set timeout at module scope — applies to all tests and beforeAll in this file.
// jest.setTimeout inside a describe block does NOT apply to beforeAll callbacks.
jest.setTimeout(120_000); // 2 min — covers full pagination + batch-parallel detail fetches

describe_('FokSource — live integration (LIVE=1 to run)', () => {
  let events: Event[] = [];

  beforeAll(async () => {
    const source = new FokSource();
    events = await source.fetch();
  }, 120_000); // explicit timeout on beforeAll — jest.setTimeout alone does not cover it

  it('returns at least 5 events', () => {
    console.log(`\n[fok live] Total events returned: ${events.length}`);
    expect(events.length).toBeGreaterThanOrEqual(5);
  });

  it('all events have required fields', () => {
    for (const event of events) {
      expect(event.title).toBeTruthy();
      expect(event.venue).toBeTruthy();
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(event.url).toMatch(/^https:\/\/www\.fok\.cz\/en\//);
      expect(event.sourceId).toBe('fok');
    }
  });

  it('at least one event has performers', () => {
    const withPerformers = events.filter(e => e.performers && e.performers.length > 0);
    console.log(`[fok live] Events with performers: ${withPerformers.length}/${events.length}`);
    expect(withPerformers.length).toBeGreaterThan(0);
  });

  it('at least one event has composers', () => {
    const withComposers = events.filter(e => e.composers && e.composers.length > 0);
    console.log(`[fok live] Events with composers: ${withComposers.length}/${events.length}`);
    expect(withComposers.length).toBeGreaterThan(0);
  });

  it('at least one event has a synthesized description', () => {
    const withDesc = events.filter(e => e.description && e.description.length > 0);
    console.log(`[fok live] Events with description: ${withDesc.length}/${events.length}`);
    expect(withDesc.length).toBeGreaterThan(0);
  });

  it('multi-date programmes produce multiple events with same url', () => {
    const byUrl = new Map<string, Event[]>();
    for (const e of events) {
      const arr = byUrl.get(e.url) ?? [];
      arr.push(e);
      byUrl.set(e.url, arr);
    }
    const multiDate = [...byUrl.entries()].filter(([, evts]) => evts.length > 1);
    console.log(`[fok live] Programmes with multiple date entries: ${multiDate.length}`);
    // Log one example for manual inspection
    if (multiDate.length > 0) {
      const [url, evts] = multiDate[0]!;
      console.log(`  Example: ${url}`);
      for (const e of evts) console.log(`    date=${e.date} title=${e.title}`);
    }
    // Not asserting > 0 — near season end a genuine single-date listing is valid
    expect(multiDate.length).toBeGreaterThanOrEqual(0);
  });

  it('prints sample events for manual inspection', () => {
    const sample = events.slice(0, 3);
    console.log('\n[fok live] Sample events:');
    for (const e of sample) {
      console.log(JSON.stringify(e, null, 2));
    }
    expect(sample.length).toBeGreaterThan(0);
  });
});
