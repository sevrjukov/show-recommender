import { createHash } from 'crypto';
import type { Event } from './types.js';

/**
 * Compute a stable deduplication key for an event.
 *
 * The key is a SHA-256 hex digest of `date|venue|title` where each field is
 * normalised before hashing: date is truncated to `YYYY-MM-DD`, venue and title
 * are lowercased and trimmed. The `|` separator prevents hash collisions between
 * adjacent field values (e.g. `"foo|bar"` vs `"foo|b"` + `"ar"`).
 *
 * The same key is used by {@link deduplicateEvents} (cross-source dedup) and by
 * `exclude-evaluated.ts` (already-evaluated filtering), so both operations stay consistent.
 *
 * @param event - The event to key.
 * @returns 64-character lowercase hex SHA-256 digest.
 */
export function computeDedupKey(event: Event): string {
  // Slice to first 10 chars to normalise both YYYY-MM-DD and YYYY-MM-DDTHH:mm:ssZ formats
  const date = event.date.trim().slice(0, 10);
  if (date.length < 10) {
    console.warn(`[dedup] Event has short/malformed date "${event.date}" (sourceId=${event.sourceId}, title=${event.title})`);
  }
  const venue = event.venue.toLowerCase().trim();
  const title = event.title.toLowerCase().trim();
  return createHash('sha256').update(`${date}|${venue}|${title}`).digest('hex');
}

/**
 * Remove duplicate events from an aggregated multi-source list.
 *
 * First occurrence wins (source order is preserved). Two events are considered
 * duplicates if they share the same {@link computeDedupKey} — i.e. same date,
 * venue, and title after normalisation, regardless of which source returned them.
 *
 * @param events - Raw event list, potentially containing cross-source duplicates.
 * @returns A new array with duplicates removed. The original array is not mutated.
 */
export function deduplicateEvents(events: Event[]): Event[] {
  const seen = new Set<string>();
  const result = events.filter(event => {
    const key = computeDedupKey(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log(`[dedup] ${events.length} → ${result.length} events (${events.length - result.length} duplicates removed)`);
  return result;
}
