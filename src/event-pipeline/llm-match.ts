import type { LLMAdapter } from './adapters/llm-adapter.js';
import type { Event, MatchResult, UserPreferences } from './types.js';

/**
 * Run LLM-based matching of events against the user's taste profile.
 *
 * Acts as a seam between the pipeline orchestrator and the {@link LLMAdapter}
 * interface. Future pre/post-processing logic (e.g. chunking large event lists,
 * geography pre-filtering) can be added here without touching `pipeline.ts`.
 *
 * Short-circuits to an empty result when `events` is empty, avoiding an
 * unnecessary LLM API call.
 *
 * @param adapter     - The {@link LLMAdapter} implementation to use (e.g. {@link OpenAIAdapter}).
 * @param preferences - User taste profile.
 * @param events      - Events that have been deduped and had already-sent events removed.
 * @returns A {@link MatchResult} with matched events and artist/composer suggestions.
 * @throws If the adapter throws (propagated from {@link LLMAdapter.matchEvents}).
 */
export async function matchEvents(
  adapter: LLMAdapter,
  preferences: UserPreferences,
  events: Event[],
): Promise<MatchResult> {
  if (events.length === 0) {
    console.log('[llm] No events to match, skipping LLM call');
    return { matched: [], suggestions: [] };
  }
  console.log(`[llm] Sending ${events.length} events to LLM for matching`);
  const result = await adapter.matchEvents(preferences, events);
  console.log(`[llm] Result: ${result.matched.length} matches, ${result.suggestions.length} suggestions`);
  return result;
}
