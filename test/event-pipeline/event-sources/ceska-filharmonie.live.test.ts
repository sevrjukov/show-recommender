import { CeskaFilharmonieSource } from '../../../src/event-pipeline/event-sources/ceska-filharmonie.js';
import type { Event } from '../../../src/event-pipeline/types.js';

const RUN_LIVE = process.env['LIVE'] === '1';
const describe_ = RUN_LIVE ? describe : describe.skip;

// Set timeout at module scope — applies to all tests and beforeAll in this file.
// jest.setTimeout inside a describe block does NOT apply to beforeAll callbacks.
jest.setTimeout(120_000); // 2 min — covers full pagination + batch-parallel detail fetches

describe_('CeskaFilharmonieSource — live integration (LIVE=1 to run)', () => {
  let events: Event[] = [];

  beforeAll(async () => {
    const source = new CeskaFilharmonieSource();
    events = await source.fetch();
  }, 120_000); // explicit timeout on beforeAll — jest.setTimeout alone does not cover it

  it('returns at least 5 events', () => {
    console.log(`\n[cf live] Total events returned: ${events.length}`);
    expect(events.length).toBeGreaterThanOrEqual(5);
  });

  it('all events have required fields', () => {
    for (const event of events) {
      expect(event.title).toBeTruthy();
      expect(event.venue).toBeTruthy();
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(event.url).toMatch(/^https:\/\/www\.ceskafilharmonie\.cz\/en\/event\//);
      expect(event.sourceId).toBe('ceska-filharmonie');
    }
  });

  it('at least one event has performers', () => {
    const withPerformers = events.filter(e => e.performers && e.performers.length > 0);
    console.log(`[cf live] Events with performers: ${withPerformers.length}/${events.length}`);
    expect(withPerformers.length).toBeGreaterThan(0);
  });

  it('at least one event has composers', () => {
    const withComposers = events.filter(e => e.composers && e.composers.length > 0);
    console.log(`[cf live] Events with composers: ${withComposers.length}/${events.length}`);
    expect(withComposers.length).toBeGreaterThan(0);
  });

  it('at least one event has a description', () => {
    const withDesc = events.filter(e => e.description && e.description.length > 0);
    console.log(`[cf live] Events with description: ${withDesc.length}/${events.length}`);
    expect(withDesc.length).toBeGreaterThan(0);
  });

  it('event type breakdown logged for manual inspection', () => {
    // eventType is an internal CfCard field — it does not survive into the Event interface,
    // so exclusion of Workshop/Education programs cannot be asserted here.
    // This test logs the full count so regressions in type filtering are visible in CI output.
    console.log(`[cf live] Total events after type filter: ${events.length}`);
    expect(events.length).toBeGreaterThan(0);
  });

  it('prints sample events for manual inspection', () => {
    const sample = events.slice(0, 3);
    console.log('\n[cf live] Sample events:');
    for (const e of sample) {
      console.log(JSON.stringify(e, null, 2));
    }
    expect(sample.length).toBeGreaterThan(0);
  });
});
