import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { Event, DiscardedRecord } from './types.js';
import { computeDedupKey } from './dedup.js';

const SENT_KEY = 'data/events-sent.json';
const DISCARDED_KEY = 'data/events-discarded.json';

/**
 * Load dedup keys of events already sent in a digest from S3.
 * File absent → empty Set (graceful init).
 */
export async function loadSentKeys(s3: S3Client, bucket: string): Promise<Set<string>> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: SENT_KEY }));
    const body = await response.Body?.transformToString() ?? '[]';
    const keys = JSON.parse(body) as string[];
    const set = new Set(keys);
    console.log(`[exclude-evaluated] Loaded ${set.size} sent keys`);
    return set;
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === 'NoSuchKey') {
      console.log('[exclude-evaluated] events-sent.json not found, starting fresh');
      return new Set<string>();
    }
    throw err;
  }
}

/**
 * Load discarded event records from S3.
 * File absent → empty array (graceful init).
 */
export async function loadDiscardedRecords(s3: S3Client, bucket: string): Promise<DiscardedRecord[]> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: DISCARDED_KEY }));
    const body = await response.Body?.transformToString() ?? '[]';
    const records = JSON.parse(body) as DiscardedRecord[];
    console.log(`[exclude-evaluated] Loaded ${records.length} discarded records`);
    return records;
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === 'NoSuchKey') {
      console.log('[exclude-evaluated] events-discarded.json not found, starting fresh');
      return [];
    }
    throw err;
  }
}

/**
 * Append newly-sent event dedup keys to events-sent.json in S3.
 * Merges with existingSentKeys; deduplicates.
 */
export async function saveSentKeys(
  s3: S3Client,
  bucket: string,
  existingKeys: Set<string>,
  sentEvents: Event[],
): Promise<void> {
  const newKeys = sentEvents.map(computeDedupKey);
  const merged = Array.from(new Set([...existingKeys, ...newKeys]));
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: SENT_KEY,
    Body: JSON.stringify(merged),
    ContentType: 'application/json',
  }));
  console.log(`[exclude-evaluated] Saved ${merged.length} total sent keys to S3`);
}

/**
 * Append newly-discarded event records to events-discarded.json in S3.
 * Merges with existingRecords; deduplicates by key.
 */
export async function saveDiscardedEvents(
  s3: S3Client,
  bucket: string,
  existingRecords: DiscardedRecord[],
  newlyDiscarded: Event[],
): Promise<void> {
  const existingKeys = new Set(existingRecords.map(r => r.key));
  const newRecords: DiscardedRecord[] = newlyDiscarded
    .map(e => ({ key: computeDedupKey(e), title: e.title, date: e.date, venue: e.venue }))
    .filter(r => !existingKeys.has(r.key));
  const merged = [...existingRecords, ...newRecords];
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: DISCARDED_KEY,
    Body: JSON.stringify(merged),
    ContentType: 'application/json',
  }));
  console.log(`[exclude-evaluated] Saved ${merged.length} total discarded records to S3`);
}

/**
 * Filter out events whose dedup key is already in `evaluatedKeys`.
 *
 * Pure function — does not touch S3. Only events that are genuinely new
 * (not yet evaluated) are returned.
 *
 * @param events        - Deduplicated event list from the current pipeline run.
 * @param evaluatedKeys - Set of dedup keys combining sent and discarded keys.
 * @returns Subset of `events` whose dedup key is not present in `evaluatedKeys`.
 */
export function excludeEvaluatedEvents(events: Event[], evaluatedKeys: Set<string>): Event[] {
  const result = events.filter(event => !evaluatedKeys.has(computeDedupKey(event)));
  console.log(`[exclude-evaluated] ${events.length} → ${result.length} new events (${events.length - result.length} already evaluated)`);
  return result;
}
