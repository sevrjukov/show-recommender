import { S3Client } from '@aws-sdk/client-s3';
import { SESClient } from '@aws-sdk/client-ses';
import type { LLMAdapter } from './adapters/llm-adapter.js';
import type { EventSource, PipelineResult } from './types.js';
import { loadPreferences } from './load-preferences.js';
import { fetchAllEvents } from './fetch-events.js';
import { deduplicateEvents } from './dedup.js';
import { loadSentKeys, excludeSentEvents, saveSentKeys } from './exclude-sent.js';
import { matchEvents } from './llm-match.js';
import { buildDigest } from './digest-builder.js';
import { sendDigestEmail } from './send-email.js';

/**
 * All external dependencies required by the pipeline.
 *
 * Injected by the Lambda handler so each dependency can be swapped out in tests
 * without touching this file.
 */
export interface PipelineDeps {
  /** Event sources to fetch from. Pass `[]` when no sources are registered yet. */
  sources: EventSource[];
  /** LLM adapter used for event matching (e.g. {@link OpenAIAdapter}). */
  llmAdapter: LLMAdapter;
  /** Authenticated S3 client for reading preferences and the sent-keys log. */
  s3: S3Client;
  /** Authenticated SES client for sending the digest email. */
  ses: SESClient;
  /** Name of the S3 bucket (`BUCKET_NAME` env var). */
  bucketName: string;
  /** Verified SES sender address (`SENDER_EMAIL` env var). */
  senderEmail: string;
  /** Verified SES recipient address (`RECIPIENT_EMAIL` env var). */
  recipientEmail: string;
}

/**
 * Run the full event-recommendation pipeline end-to-end.
 *
 * Steps (in order):
 * 1. Load user preferences from S3 — fatal if missing or malformed.
 * 2. Fetch events from all registered sources concurrently — individual source
 *    failures are non-fatal and surface as digest warnings.
 * 3. Deduplicate the aggregated event list across sources.
 * 4. Load already-sent dedup keys from S3 and filter out previously-sent events.
 * 5. Run LLM matching against user preferences.
 * 6. Build the HTML digest from matches, suggestions, and any source errors.
 * 7. Send the digest via SES.
 * 8. Persist the newly-matched event keys back to S3 (after send, so a send failure
 *    causes the same events to be re-evaluated next run).
 *
 * @param deps - Injected dependencies (AWS clients, adapters, config).
 * @returns A {@link PipelineResult} summary logged by the Lambda handler.
 * @throws If preferences loading, LLM matching, or SES sending fails.
 */
export async function runPipeline(deps: PipelineDeps): Promise<PipelineResult> {
  const { sources, llmAdapter, s3, ses, bucketName, senderEmail, recipientEmail } = deps;
  console.log('[pipeline] Starting pipeline');

  // 1. Load and validate user preferences from S3
  const preferences = await loadPreferences(s3, bucketName);

  // 2. Fetch events from all sources (non-fatal per source)
  const { events: rawEvents, errors: fetchErrors } = await fetchAllEvents(sources);

  // 3. Deduplicate across sources — [dedup] log emitted by deduplicateEvents
  const uniqueEvents = deduplicateEvents(rawEvents);

  // 4. Load already-sent keys and filter — [exclude-sent] logs emitted by loadSentKeys and excludeSentEvents
  const sentKeys = await loadSentKeys(s3, bucketName);
  const newEvents = excludeSentEvents(uniqueEvents, sentKeys);

  // 5. LLM matching
  const matchResult = await matchEvents(llmAdapter, preferences, newEvents);

  // 6. Build digest HTML
  const html = buildDigest(matchResult, fetchErrors);

  // 7. Send email (before persisting — if send fails, events are not marked sent and will retry next week)
  await sendDigestEmail(ses, senderEmail, recipientEmail, html);

  // 8. Persist matched event keys
  await saveSentKeys(s3, bucketName, sentKeys, matchResult.matched.map(m => m.event));

  const result: PipelineResult = {
    matchedCount: matchResult.matched.length,
    suggestionsCount: matchResult.suggestions.length,
    sourceErrors: fetchErrors,
  };
  console.log(`[pipeline] Complete — matched: ${result.matchedCount}, suggestions: ${result.suggestionsCount}, sourceErrors: ${result.sourceErrors.length}`);
  return result;
}
