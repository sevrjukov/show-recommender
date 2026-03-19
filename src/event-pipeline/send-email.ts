import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

/**
 * Send the weekly digest as an HTML email via AWS SES.
 *
 * Both `senderEmail` and `recipientEmail` must be verified in SES before this
 * call can succeed. In SES sandbox mode only verified addresses can receive email.
 * Verification is done manually in the AWS console out of band.
 *
 * The email subject includes the run date (`YYYY-MM-DD`) for easy inbox scanning.
 *
 * @param ses            - Authenticated SES client. Region must match where the
 *                         sending identity is verified (eu-central-1 per CDK stack).
 * @param senderEmail    - Verified SES sender address (`SENDER_EMAIL` env var).
 * @param recipientEmail - Verified SES recipient address (`RECIPIENT_EMAIL` env var).
 * @param htmlBody       - Complete HTML document produced by {@link buildDigest}.
 * @throws If SES rejects the request (unverified address, quota exceeded, etc.).
 */
export async function sendDigestEmail(
  ses: SESClient,
  senderEmail: string,
  recipientEmail: string,
  htmlBody: string,
): Promise<void> {
  console.log(`[email] Sending digest to ${recipientEmail}`);
  const now = formatDate(new Date().toISOString());
  await ses.send(new SendEmailCommand({
    Source: senderEmail,
    Destination: { ToAddresses: [recipientEmail] },
    Message: {
      Subject: { Data: `Musical Events Recommender — ${now}`, Charset: 'UTF-8' },
      Body: { Html: { Data: htmlBody, Charset: 'UTF-8' } },
    },
  }));
  console.log('[email] Digest sent successfully');
}

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
