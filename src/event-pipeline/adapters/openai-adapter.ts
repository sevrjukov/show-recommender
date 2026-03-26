import OpenAI from 'openai';
import type { LLMAdapter } from './llm-adapter.js';
import type { Event, MatchResult, MatchedEvent, Suggestion, UserPreferences } from '../types.js';

const LLM_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `You are a music event matching assistant. Given a user's taste profile and a list of upcoming music events, identify which events the user would likely enjoy attending.

Return ONLY a valid JSON object with this exact structure:
{
  "matched": [{ "eventIndex": 0, "reasoning": "Brief 1-2 sentence explanation" }],
  "suggestions": [{ "name": "Artist or Composer Name", "reasoning": "Brief explanation of why they match the user's taste, e.g. which genres or styles overlap" }]
}

Where:
- "matched": zero-based indexes of events the user would enjoy, with reasoning
- "suggestions": artists/composers found in the events that are NOT in the user's preferences but are stylistically relevant — include a short reason why they fit the user's taste, for the user to consider adding

HARD RULES:
- If the user's profile contains an "exclude" list, NEVER include any event whose title, venue, or description contains any of those terms (case-insensitive match). This overrides all other criteria.
- If an event is included twice in the input list, return it only once (deduplicate). This may happen because events are scraped from multiple overlapping sources, each having slightly different description. It is up to you to identify them. If unsure, return both events.`;

/**
 * {@link LLMAdapter} implementation backed by the OpenAI Chat Completions API.
 *
 * Uses `response_format: { type: 'json_object' }` to guarantee structured output,
 * which requires the word "json" to appear in the system prompt (satisfied above).
 *
 * On transient failures (malformed JSON, missing fields, network errors) the call is
 * retried up to three times with linear backoff (1 s, 2 s) before throwing.
 */
export class OpenAIAdapter implements LLMAdapter {
  private readonly client: OpenAI;
  private readonly model: string;

  /**
   * @param apiKey - OpenAI API key. Never log this value.
   * @param model  - Model ID to use (e.g. `'gpt-4o'`, `'gpt-4o-mini'`).
   *                 Passed through from the `OPENAI_MODEL` env var.
   */
  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  /**
   * Send the user's taste profile and a list of events to the OpenAI Chat API.
   * Returns which events match and any artist/composer suggestions.
   *
   * Short-circuits to an empty result without making an API call if `events` is empty.
   *
   * @param preferences - User taste profile.
   * @param events      - Pre-filtered event list to evaluate.
   * @returns Matched events with per-match reasoning, and artist/composer suggestions.
   * @throws If all retry attempts fail (network error, persistent bad JSON, etc.).
   */
  async matchEvents(preferences: UserPreferences, events: Event[]): Promise<MatchResult> {
    if (events.length === 0) {
      return { matched: [], suggestions: [] };
    }

    const userMessage = `User taste profile:\n${JSON.stringify(preferences, null, 2)}\n\nUpcoming events:\n${JSON.stringify(events.map((e, i) => ({ index: i, ...e })), null, 2)}`;

    const maxAttempts = 3;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[llm:openai] Calling model=${this.model} with ${events.length} events (attempt ${attempt}/${maxAttempts})`);

        const completion = await this.client.chat.completions.create({
          model: this.model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
        }, { timeout: LLM_TIMEOUT_MS });

        const raw = completion.choices[0]?.message?.content ?? '{}';
        const parsed = JSON.parse(raw) as { matched?: { eventIndex: number; reasoning: string }[]; suggestions?: { name: string; reasoning: string }[] };

        if (!Array.isArray(parsed.matched) || !Array.isArray(parsed.suggestions)) {
          throw new Error(`OpenAI response missing required fields. Raw: ${raw}`);
        }

        console.log(`[llm:openai] Response received, usage: ${JSON.stringify(completion.usage)}`);
        console.log(`[llm:openai] Parsed: ${parsed.matched.length} matched, ${parsed.suggestions.length} suggestions`);

        const seenIndices = new Set<number>();
        const matched: MatchedEvent[] = parsed.matched
          .filter(m => {
            if (typeof m.eventIndex !== 'number' || !Number.isInteger(m.eventIndex)) {
              console.warn('[llm:openai] Ignoring non-integer eventIndex:', m.eventIndex);
              return false;
            }
            if (m.eventIndex < 0 || m.eventIndex >= events.length) {
              // Out-of-bounds index from the LLM — skip rather than throw so the rest of the response is used
              console.warn('[llm:openai] Ignoring out-of-bounds eventIndex:', m.eventIndex);
              return false;
            }
            if (seenIndices.has(m.eventIndex)) {
              console.warn('[llm:openai] Ignoring duplicate eventIndex:', m.eventIndex);
              return false;
            }
            seenIndices.add(m.eventIndex);
            return true;
          })
          .map(m => ({ event: events[m.eventIndex]!, reasoning: m.reasoning }));

        const suggestions: Suggestion[] = parsed.suggestions.filter(s => {
          if (typeof s?.name !== 'string' || typeof s?.reasoning !== 'string') {
            console.warn('[llm:openai] Ignoring malformed suggestion:', s);
            return false;
          }
          return true;
        });

        return { matched, suggestions };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[llm:openai] Attempt ${attempt}/${maxAttempts} failed:`, lastError.message);
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // 1s, 2s backoff
        }
      }
    }

    throw lastError ?? new Error('LLM matching failed after all attempts');
  }
}
