import type { Event, EventSource, FetchResult } from './types.js';

/** Maximum time (ms) to wait for a single source before treating it as failed. */
const SOURCE_TIMEOUT_MS = 180_000;

/**
 * Race a promise against a timeout, rejecting with a descriptive error if the
 * timeout fires first.
 *
 * @param promise  - The operation to time-limit.
 * @param ms       - Timeout in milliseconds.
 * @param sourceId - Used only for the rejection error message.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, sourceId: string): Promise<T> {
  let timerId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`${sourceId} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timerId));
}

/**
 * Fetch events from all registered sources concurrently.
 *
 * Each source is called in parallel. Individual source failures (including
 * timeouts after {@link SOURCE_TIMEOUT_MS}) are caught, logged, and collected
 * into the returned `errors` array — they do not abort the other sources or
 * propagate up. This means the pipeline can continue with partial data and
 * surface failures as warnings in the digest.
 *
 * @param sources - Array of {@link EventSource} instances to query.
 * @returns A {@link FetchResult} with the combined event list and per-source errors.
 *          The order of events within the result is non-deterministic (Promise.all).
 */
export async function fetchAllEvents(sources: EventSource[]): Promise<FetchResult> {
  const allEvents: Event[] = [];
  const errors: FetchResult['errors'] = [];

  console.log(`[fetch] Starting fetch from ${sources.length} sources`);

  await Promise.all(
    sources.map(async source => {
      try {
        console.log(`[fetch] ${source.id}: fetching...`);
        const events = await withTimeout(source.fetch(), SOURCE_TIMEOUT_MS, source.id);
        allEvents.push(...events.map(e => ({ ...e, region: source.region })));
        console.log(`[fetch] ${source.id}: ${events.length} events returned`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[fetch] ${source.id} failed:`, message);
        errors.push({ sourceId: source.id, error: message });
      }
    })
  );

  console.log(`[fetch] Total: ${allEvents.length} events (${errors.length} source(s) failed)`);
  return { events: allEvents, errors };
}
