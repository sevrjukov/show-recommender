import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { UserPreferences } from './types.js';

/**
 * Load and validate the user's taste profile from S3.
 *
 * Reads `config/user-preferences.json` from the pipeline bucket and validates
 * that the file is well-formed JSON containing the three required string arrays
 * (`artists`, `composers`, `genres`). Failure here is fatal — the pipeline cannot
 * match events without valid preferences, so an error is thrown and the Lambda
 * invocation fails with a CloudWatch alarm.
 *
 * Upload the seed file manually after deploy:
 * ```
 * aws s3 cp config/user-preferences.json s3://<bucket>/config/user-preferences.json
 * ```
 *
 * @param s3     - Authenticated S3 client.
 * @param bucket - Name of the S3 bucket (`BUCKET_NAME` env var).
 * @returns Validated {@link UserPreferences} object.
 * @throws If the S3 object is missing, unreadable, not valid JSON, or structurally malformed.
 */
export async function loadPreferences(s3: S3Client, bucket: string): Promise<UserPreferences> {
  console.log('[preferences] Loading user-preferences.json from S3');
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: 'config/user-preferences.json' }));
  const body = await response.Body?.transformToString() ?? '{}';

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('user-preferences.json is not valid JSON');
  }

  const p = parsed as Partial<Record<string, unknown>>;
  if (!Array.isArray(p['artists']) || !Array.isArray(p['composers']) || !Array.isArray(p['genres'])) {
    throw new Error('user-preferences.json is malformed: missing artists, composers, or genres arrays');
  }
  // Runtime guard: TypeScript types the arrays as string[], but the JSON is untrusted
  const isStringArray = (arr: unknown[]): arr is string[] => arr.every(v => typeof v === 'string');
  if (!isStringArray(p['artists']) || !isStringArray(p['composers']) || !isStringArray(p['genres'])) {
    throw new Error('user-preferences.json is malformed: artists, composers, and genres must contain only strings');
  }
  // exclude is optional for backward compatibility; default to empty array
  const excludeRaw = p['exclude'] ?? [];
  if (!Array.isArray(excludeRaw) || !isStringArray(excludeRaw)) {
    throw new Error('user-preferences.json is malformed: exclude must be an array of strings');
  }

  const prefs: UserPreferences = { ...(p as unknown as UserPreferences), exclude: excludeRaw };
  console.log(`[preferences] Loaded: ${prefs.artists.length} artists, ${prefs.composers.length} composers, ${prefs.genres.length} genres, ${prefs.exclude.length} exclude terms`);
  return prefs;
}
