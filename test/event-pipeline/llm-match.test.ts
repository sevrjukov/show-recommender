import { matchEvents } from '../../src/event-pipeline/llm-match.js';
import type { LLMAdapter } from '../../src/event-pipeline/adapters/llm-adapter.js';
import type { Event, MatchResult, UserPreferences } from '../../src/event-pipeline/types.js';

const PREFS: UserPreferences = { artists: [], composers: [], genres: [], exclude: [] };

function makeEvent(i: number): Event {
  return {
    title: `Event ${i}`,
    venue: 'Test Hall',
    date: '2026-04-15',
    url: `https://example.com/${i}`,
    sourceId: 'test',
  };
}

function makeEvents(n: number): Event[] {
  return Array.from({ length: n }, (_, i) => makeEvent(i));
}

/** Adapter that matches events at the given local indices within each chunk. */
function makeAdapter(
  localIndices: number[] = [],
  suggestions: MatchResult['suggestions'] = [],
): LLMAdapter {
  return {
    matchEvents: jest.fn().mockImplementation(async (_prefs, events: Event[]) => ({
      matched: localIndices
        .filter(i => i < events.length)
        .map(i => ({ event: events[i]!, reasoning: `Reason for ${events[i]!.title}` })),
      suggestions,
    })),
  };
}

describe('matchEvents — chunking', () => {
  it('returns empty result and never calls adapter when events is empty', async () => {
    const adapter = makeAdapter([0]);
    const result = await matchEvents(adapter, PREFS, []);
    expect(result).toEqual({ matched: [], suggestions: [] });
    expect(adapter.matchEvents).not.toHaveBeenCalled();
  });

  it('sends a single chunk when event count is below chunk size', async () => {
    const events = makeEvents(10);
    const adapter = makeAdapter([0, 2]);
    const result = await matchEvents(adapter, PREFS, events);
    expect(adapter.matchEvents).toHaveBeenCalledTimes(1);
    expect(adapter.matchEvents).toHaveBeenCalledWith(PREFS, events);
    expect(result.matched).toHaveLength(2);
    expect(result.matched[0]!.event).toBe(events[0]);
    expect(result.matched[1]!.event).toBe(events[2]);
  });

  it('sends a single chunk when event count equals chunk size (50)', async () => {
    const events = makeEvents(50);
    const adapter = makeAdapter([0]);
    await matchEvents(adapter, PREFS, events);
    expect(adapter.matchEvents).toHaveBeenCalledTimes(1);
    expect((adapter.matchEvents as jest.Mock).mock.calls[0][1]).toHaveLength(50);
  });

  it('splits 120 events into 3 chunks (50, 50, 20)', async () => {
    const events = makeEvents(120);
    const adapter = makeAdapter();
    await matchEvents(adapter, PREFS, events);
    expect(adapter.matchEvents).toHaveBeenCalledTimes(3);
    const calls = (adapter.matchEvents as jest.Mock).mock.calls as [UserPreferences, Event[]][];
    expect(calls[0]![1]).toHaveLength(50);
    expect(calls[1]![1]).toHaveLength(50);
    expect(calls[2]![1]).toHaveLength(20);
  });

  it('each chunk receives the correct slice of the events array', async () => {
    const events = makeEvents(120);
    const adapter = makeAdapter();
    await matchEvents(adapter, PREFS, events);
    const calls = (adapter.matchEvents as jest.Mock).mock.calls as [UserPreferences, Event[]][];
    expect(calls[0]![1]).toEqual(events.slice(0, 50));
    expect(calls[1]![1]).toEqual(events.slice(50, 100));
    expect(calls[2]![1]).toEqual(events.slice(100, 120));
  });

  it('merges matched events from all chunks into a single result', async () => {
    const events = makeEvents(120);
    // Match event at index 0 of chunk 1 and index 0 of chunk 3
    const adapter: LLMAdapter = {
      matchEvents: jest.fn()
        .mockResolvedValueOnce({ matched: [{ event: events[0]!, reasoning: 'A' }], suggestions: [] })
        .mockResolvedValueOnce({ matched: [], suggestions: [] })
        .mockResolvedValueOnce({ matched: [{ event: events[100]!, reasoning: 'B' }], suggestions: [] }),
    };
    const result = await matchEvents(adapter, PREFS, events);
    expect(result.matched).toHaveLength(2);
    expect(result.matched[0]!.event).toBe(events[0]);
    expect(result.matched[1]!.event).toBe(events[100]);
  });

  it('deduplicates suggestions with the same name across chunks', async () => {
    const events = makeEvents(120);
    const sharedSuggestion = { name: 'Brahms', reasoning: 'Romantic style' };
    const uniqueSuggestion = { name: 'Mahler', reasoning: 'Large scale symphonies' };
    const adapter: LLMAdapter = {
      matchEvents: jest.fn()
        .mockResolvedValueOnce({ matched: [], suggestions: [sharedSuggestion] })
        .mockResolvedValueOnce({ matched: [], suggestions: [sharedSuggestion, uniqueSuggestion] })
        .mockResolvedValueOnce({ matched: [], suggestions: [] }),
    };
    const result = await matchEvents(adapter, PREFS, events);
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions.map(s => s.name)).toEqual(['Brahms', 'Mahler']);
  });

  it('propagates adapter errors', async () => {
    const events = makeEvents(10);
    const adapter: LLMAdapter = {
      matchEvents: jest.fn().mockRejectedValue(new Error('LLM timeout')),
    };
    await expect(matchEvents(adapter, PREFS, events)).rejects.toThrow('LLM timeout');
  });

  it('passes preferences to every chunk call', async () => {
    const prefs: UserPreferences = {
      artists: ['Yuja Wang'],
      composers: ['Ravel'],
      genres: ['classical'],
      exclude: ['jazz'],
    };
    const events = makeEvents(60);
    const adapter = makeAdapter();
    await matchEvents(adapter, prefs, events);
    const calls = (adapter.matchEvents as jest.Mock).mock.calls as [UserPreferences, Event[]][];
    for (const call of calls) {
      expect(call[0]).toBe(prefs);
    }
  });
});
