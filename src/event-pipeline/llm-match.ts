import type { LLMAdapter } from './adapters/llm-adapter.js';
import type { Event, MatchResult, UserPreferences } from './types.js';

const CHUNK_SIZE = 50;

/**
 * Run LLM-based matching of events against the user's taste profile.
 *
 * Events are processed in chunks of {@link CHUNK_SIZE} to avoid overwhelming the
 * LLM with a single massive prompt — particularly important on the first pipeline
 * run when no events have been previously evaluated. Results are merged: all
 * matched events are collected, and suggestions are deduplicated by name.
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

  const totalChunks = Math.ceil(events.length / CHUNK_SIZE);
  console.log(`[llm] Sending ${events.length} events to LLM in ${totalChunks} chunk(s) of up to ${CHUNK_SIZE}`);

  const allMatched: MatchResult['matched'] = [];
  const seenSuggestions = new Set<string>();
  const allSuggestions: MatchResult['suggestions'] = [];

  for (let i = 0; i < events.length; i += CHUNK_SIZE) {
    const chunk = events.slice(i, i + CHUNK_SIZE);
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    console.log(`[llm] Chunk ${chunkNum}/${totalChunks}: ${chunk.length} events`);

    const result = await adapter.matchEvents(preferences, chunk);
    allMatched.push(...result.matched);

    for (const s of result.suggestions) {
      if (!seenSuggestions.has(s.name)) {
        seenSuggestions.add(s.name);
        allSuggestions.push(s);
      }
    }
  }

  console.log(`[llm] Total: ${allMatched.length} matches, ${allSuggestions.length} suggestions`);
  return { matched: allMatched, suggestions: allSuggestions };
}
