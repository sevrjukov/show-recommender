import { S3Client } from '@aws-sdk/client-s3';
import { SESClient } from '@aws-sdk/client-ses';
import { OpenAIAdapter } from './adapters/openai-adapter.js';
import { runPipeline } from './pipeline.js';
import { TicketmasterSource } from './event-sources/ticketmaster.js';
import { CeskaFilharmonieSource } from './event-sources/ceska-filharmonie.js';
import { FokSource } from './event-sources/fok.js';

/**
 * Lambda entry point for the event-pipeline function.
 *
 * Reads all configuration from environment variables (set via CDK context at
 * deploy time), instantiates the AWS and LLM adapter clients, and delegates to
 * {@link runPipeline}. No business logic lives here.
 *
 * Required environment variables (all set by CDK — see `lib/recommender-app-stack.ts`):
 * - `BUCKET_NAME`     — S3 bucket for preferences and sent-keys log.
 * - `SENDER_EMAIL`    — SES-verified sender address.
 * - `RECIPIENT_EMAIL` — SES-verified recipient address.
 * - `OPENAI_API_KEY`  — OpenAI API key. Never log this value.
 * - `OPENAI_MODEL`    — OpenAI model ID (e.g. `gpt-4o`, `gpt-4o-mini`).
 * - `AWS_REGION`      — Set automatically by the Lambda runtime.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const handler = async (): Promise<void> => {
  const bucketName = requireEnv('BUCKET_NAME');
  const senderEmail = requireEnv('SENDER_EMAIL');
  const recipientEmail = requireEnv('RECIPIENT_EMAIL');
  const openaiApiKey = requireEnv('OPENAI_API_KEY');
  const openaiModel = requireEnv('OPENAI_MODEL');
  const ticketmasterApiKey = requireEnv('TICKETMASTER_API_KEY');

  const region = process.env['AWS_REGION'] ?? 'eu-central-1';

  console.log(`[handler] Starting event-pipeline`);
  console.log(`[handler] Config: bucket=${bucketName}, model=${openaiModel}, region=${region}`);

  try {
    const result = await runPipeline({
      sources: [
        new TicketmasterSource(ticketmasterApiKey),
        new CeskaFilharmonieSource(),
        new FokSource(),
      ],
      llmAdapter: new OpenAIAdapter(openaiApiKey, openaiModel),
      s3: new S3Client({ region }),
      ses: new SESClient({ region }),
      bucketName,
      senderEmail,
      recipientEmail,
    });

    console.log('Pipeline complete:', JSON.stringify(result));
  } catch (err) {
    console.error('[handler] Fatal error:', err);
    throw err;
  }
};
