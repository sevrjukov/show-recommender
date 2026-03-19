import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { Event } from './types.js';
import { computeDedupKey } from './dedup.js';

/** S3 key for the append-only log of dedup keys that have already been emailed. */
const SENT_KEY = 'data/events-sent.json';

/**
 * Load the set of already-sent dedup keys from S3.
 *
 * The file is a JSON array of SHA-256 hex strings produced by {@link computeDedupKey}.
 * On first run (file absent), returns an empty Set without throwing — this is the
 * expected initial state and is not treated as an error.
 *
 * @param s3     - Authenticated S3 client.
 * @param bucket - Name of the S3 bucket that holds pipeline data.
 * @returns Set of dedup key strings previously written by {@link saveSentKeys}.
 * @throws If the S3 call fails for any reason other than `NoSuchKey`.
 */
export async function loadSentKeys(s3: S3Client, bucket: string): Promise<Set<string>> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: SENT_KEY }));
    const body = await response.Body?.transformToString() ?? '[]';
    const keys = JSON.parse(body) as string[];
    const sentSet = new Set(keys);
    console.log(`[exclude-sent] Loaded ${sentSet.size} sent keys`);
    return sentSet;
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === 'NoSuchKey') {
      console.log('[exclude-sent] events-sent.json not found, starting fresh');
      return new Set<string>();
    }
    throw err;
  }
}

/**
 * Filter out events whose dedup key is already in `sentKeys`.
 *
 * Pure function — does not touch S3. Only events that are genuinely new
 * (not yet emailed) are returned.
 *
 * @param events   - Deduplicated event list from the current pipeline run.
 * @param sentKeys - Set of dedup keys loaded by {@link loadSentKeys}.
 * @returns Subset of `events` whose dedup key is not present in `sentKeys`.
 */
export function excludeSentEvents(events: Event[], sentKeys: Set<string>): Event[] {
  const result = events.filter(event => !sentKeys.has(computeDedupKey(event)));
  console.log(`[exclude-sent] ${events.length} → ${result.length} new events (${events.length - result.length} already sent)`);
  return result;
}

/**
 * Persist the merged set of sent keys back to S3.
 *
 * Merges `existingKeys` with the dedup keys of `newEvents` (de-duplicated) and
 * writes the result as a JSON array. Only matched events should be passed here —
 * unmatched events are intentionally re-evaluated on the next run.
 *
 * Called *after* the email has been sent successfully. If the email send fails,
 * this function is never called, so the same events will be re-evaluated next week.
 *
 * @param s3           - Authenticated S3 client.
 * @param bucket       - Name of the S3 bucket.
 * @param existingKeys - The set returned by {@link loadSentKeys} at the start of this run.
 * @param newEvents    - Events that were matched and included in the digest.
 */
export async function saveSentKeys(s3: S3Client, bucket: string, existingKeys: Set<string>, newEvents: Event[]): Promise<void> {
  const newKeys = newEvents.map(computeDedupKey);
  const merged = Array.from(new Set([...existingKeys, ...newKeys]));
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: SENT_KEY,
    Body: JSON.stringify(merged),
    ContentType: 'application/json',
  }));
  console.log(`[exclude-sent] Saved ${merged.length} total keys to S3`);
}
