import type { MatchResult, SourceError } from './types.js';

/**
 * Inline style constants for all HTML elements in the digest email.
 *
 * Inline styles are required because Gmail, Outlook, and most email clients
 * strip `<style>` blocks from the `<head>`. Edit here to restyle the digest.
 */
const S = {
  body: 'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 24px; line-height: 1.6; color: #222; background: #f9f9f9; margin: 0; padding: 24px 16px;',
  container: 'background: #fff; border-radius: 8px; padding: 32px 16px;',
  h1: 'font-size: 26px; font-weight: 600; color: #111; border-bottom: 1px solid #eee; padding-bottom: 6px; margin: 0 0 12px 0;',
  ul: 'padding: 0; list-style: none; margin: 0;',
  li: 'padding: 12px 0; border-bottom: 1px solid #f0f0f0;',
  liWarning: 'padding: 12px 0; border-bottom: 1px solid #f0f0f0; color: #b45309;',
  a: 'color: #0066cc; text-decoration: none;',
  em: 'color: #555; font-style: italic;',
  p: 'color: #555;',
};

/**
 * Build the HTML body for the weekly digest email.
 *
 * The output contains up to three sections:
 * 1. **Upcoming events for you** — matched events with title, venue, date, URL,
 *    and LLM reasoning. Falls back to a "no new events" message when `matched` is empty.
 * 2. **Consider adding to your preferences** — artist/composer suggestions from the LLM
 *    (only rendered when `suggestions` is non-empty).
 * 3. **Source warnings** — per-source fetch errors (only rendered when `errors` is non-empty).
 *
 * All user-supplied and scraper-supplied strings are HTML-escaped before insertion.
 * Event URLs are additionally passed through {@link safeHref} to prevent `javascript:`
 * injection via untrusted scraper data.
 *
 * @param result - The {@link MatchResult} from the LLM matching step.
 * @param errors - Any {@link SourceError} values collected during event fetching.
 * @returns A complete `<!DOCTYPE html>` document as a string, ready to send via SES.
 */
function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function buildDigest(result: MatchResult, errors: SourceError[]): string {
  const sections: string[] = [];

  // --- Matched events ---
  if (result.matched.length > 0) {
    const sorted = [...result.matched].sort((a, b) => a.event.date.localeCompare(b.event.date));
    const items = sorted.map(({ event, reasoning }) =>
      `<li style="${S.li}"><strong>${escapeHtml(event.title)}</strong> · ${escapeHtml(event.venue)} · ${formatDate(event.date)}<br><a href="${safeHref(event.url)}" style="${S.a}">${escapeHtml(event.url)}</a><br><em style="${S.em}">${escapeHtml(reasoning)}</em></li>`
    );
    sections.push(`<h1 style="${S.h1}">Upcoming events for you</h1><ul style="${S.ul}">${items.join('')}</ul>`);
  } else {
    sections.push(`<h1 style="${S.h1}">Upcoming events for you</h1><p style="${S.p}">No new matching events this week.</p>`);
  }

  // --- Consider adding ---
  if (result.suggestions.length > 0) {
    const items = result.suggestions.map(s =>
      `<li style="${S.li}"><strong>${escapeHtml(s.name)}</strong><br><em style="${S.em}">${escapeHtml(s.reasoning)}</em></li>`
    );
    sections.push(`<h1 style="${S.h1}">Consider adding to your preferences</h1><ul style="${S.ul}">${items.join('')}</ul>`);
  }

  // --- Source warnings ---
  if (errors.length > 0) {
    const items = errors.map(e => `<li style="${S.liWarning}"><strong>${escapeHtml(e.sourceId)}</strong>: ${escapeHtml(e.error)}</li>`);
    sections.push(`<h1 style="${S.h1}">⚠️ Source warnings</h1><ul style="${S.ul}">${items.join('')}</ul>`);
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="${S.body}"><div style="${S.container}">${sections.join('')}</div></body></html>`;
}

/**
 * Escape special HTML characters in a string to prevent XSS.
 *
 * Covers `& < > " '` — sufficient for both HTML text content and attribute values.
 *
 * @param str - Untrusted input string.
 * @returns HTML-safe string.
 */
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Validate a URL's protocol before use in an `href` attribute.
 *
 * Only `http://` and `https://` URLs are passed through (HTML-escaped). Any other
 * value — including `javascript:` URIs that could arrive from an untrusted scraper —
 * is replaced with `#` to produce a safe, non-navigating link.
 *
 * @param url - URL string from an event source (treated as untrusted).
 * @returns HTML-escaped URL if safe, otherwise `'#'`.
 */
function safeHref(url: string): string {
  return url.startsWith('https://') || url.startsWith('http://') ? escapeHtml(url) : '#';
}
