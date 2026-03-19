import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { Event } from './types.js';
import { computeDedupKey } from './dedup.js';

/** S3 key for the append-only log of dedup keys that have already been evaluated. */
const EVALUATED_KEY = 'data/events-evaluated.json';

/**
 * Load the set of already-evaluated dedup keys from S3.
 *
 * The file is a JSON array of SHA-256 hex strings produced by {@link computeDedupKey}.
 * On first run (file absent), returns an empty Set without throwing — this is the
 * expected initial state and is not treated as an error.
 *
 * @param s3     - Authenticated S3 client.
 * @param bucket - Name of the S3 bucket that holds pipeline data.
 * @returns Set of dedup key strings previously written by {@link saveEvaluatedKeys}.
 * @throws If the S3 call fails for any reason other than `NoSuchKey`.
 */
export async function loadEvaluatedKeys(s3: S3Client, bucket: string): Promise<Set<string>> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: EVALUATED_KEY }));
    const body = await response.Body?.transformToString() ?? '[]';
    const keys = JSON.parse(body) as string[];
    const evaluatedSet = new Set(keys);
    console.log(`[exclude-evaluated] Loaded ${evaluatedSet.size} evaluated keys`);
    return evaluatedSet;
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === 'NoSuchKey') {
      console.log('[exclude-evaluated] events-evaluated.json not found, starting fresh');
      return new Set<string>();
    }
    throw err;
  }
}

/**
 * Filter out events whose dedup key is already in `evaluatedKeys`.
 *
 * Pure function — does not touch S3. Only events that are genuinely new
 * (not yet evaluated) are returned.
 *
 * @param events        - Deduplicated event list from the current pipeline run.
 * @param evaluatedKeys - Set of dedup keys loaded by {@link loadEvaluatedKeys}.
 * @returns Subset of `events` whose dedup key is not present in `evaluatedKeys`.
 */
export function excludeEvaluatedEvents(events: Event[], evaluatedKeys: Set<string>): Event[] {
  const result = events.filter(event => !evaluatedKeys.has(computeDedupKey(event)));
  console.log(`[exclude-evaluated] ${events.length} → ${result.length} new events (${events.length - result.length} already evaluated)`);
  return result;
}

/**
 * Persist the merged set of evaluated keys back to S3.
 *
 * Merges `existingKeys` with the dedup keys of `evaluatedEvents` (de-duplicated) and
 * writes the result as a JSON array. All events evaluated by the LLM (matched and
 * rejected) should be passed here to prevent unbounded re-evaluation of events that
 * will never match current preferences.
 *
 * Called *after* the email has been sent successfully. If the email send fails,
 * this function is never called, so the same events will be re-evaluated next week.
 *
 * @param s3             - Authenticated S3 client.
 * @param bucket         - Name of the S3 bucket.
 * @param existingKeys   - The set returned by {@link loadEvaluatedKeys} at the start of this run.
 * @param evaluatedEvents - All events that were submitted to the LLM this run.
 */
export async function saveEvaluatedKeys(s3: S3Client, bucket: string, existingKeys: Set<string>, evaluatedEvents: Event[]): Promise<void> {
  const newKeys = evaluatedEvents.map(computeDedupKey);
  const merged = Array.from(new Set([...existingKeys, ...newKeys]));
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: EVALUATED_KEY,
    Body: JSON.stringify(merged),
    ContentType: 'application/json',
  }));
  console.log(`[exclude-evaluated] Saved ${merged.length} total keys to S3`);
}
