import type { MatchResult, UserPreferences, Event } from '../types.js';

/**
 * Provider-agnostic interface for the LLM matching step.
 *
 * The pipeline depends on this interface, not on any concrete implementation.
 * Switching LLM providers means implementing this interface in a new class and
 * swapping it in the Lambda handler — no pipeline code changes required.
 *
 * @see OpenAIAdapter for the initial GPT-4o implementation.
 */
export interface LLMAdapter {
  /**
   * Evaluate a list of pre-filtered events against the user's taste profile and
   * return which events are a good match together with any artist/composer suggestions.
   *
   * @param preferences - The user's taste profile (artists, composers, genres).
   * @param events - Events that have already been deduped and had previously-sent
   *                 events removed. May be an empty array.
   * @returns A {@link MatchResult} with matched events (each with reasoning) and
   *          artist/composer suggestions the user might want to add to their profile.
   */
  matchEvents(preferences: UserPreferences, events: Event[]): Promise<MatchResult>;
}
