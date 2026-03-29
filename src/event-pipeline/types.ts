/**
 * A music event returned by an {@link EventSource}.
 *
 * Sources are responsible for normalising dates to ISO `YYYY-MM-DD` format before
 * returning events. The dedup logic tolerates full ISO datetime strings but the
 * canonical form is date-only.
 */
export const REGION = {
  CZECH: 'czech',
  INTERNATIONAL: 'international',
} as const;

export type Region = (typeof REGION)[keyof typeof REGION];

export interface Event {
  title: string;          // performer name or show title
  venue: string;          // venue name (canonical, as returned by the source)
  /** ISO date string. Canonical form is YYYY-MM-DD; YYYY-MM-DDTHH:mm:ssZ is also tolerated. */
  date: string;
  url: string;            // direct link to the event page
  sourceId: string;       // identifier of the data source (e.g. 'ceska-filharmonie', 'ticketmaster')
  region?: Region; // geographic region, stamped by fetch-events from EventSource.region
  performers?: string[];  // list of performer names if available from source
  composers?: string[];   // list of composer names if available from source
  description?: string;   // optional free-text for LLM context (genre, programme notes, etc.)
}

/**
 * User taste profile loaded from `config/user-preferences.json` in S3.
 * All three arrays must be present; an empty array is valid.
 */
export interface UserPreferences {
  artists: string[];     // e.g. ["Evgeny Kissin", "Armin van Buuren"]
  composers: string[];   // e.g. ["Chopin", "Rachmaninov"]
  genres: string[];      // e.g. ["classical", "trance"]
  exclude: string[];     // terms to never recommend — matched against title, venue, description (case-insensitive)
}

/**
 * A single event that the LLM deemed a match for the user's preferences,
 * together with a short human-readable explanation.
 */
export interface MatchedEvent {
  event: Event;
  reasoning: string;     // 1-2 sentence LLM explanation for why this matches the user's taste
}

/**
 * The full result returned by the LLM matching step.
 */
export interface Suggestion {
  name: string;      // artist or composer name
  reasoning: string; // why it matches the user's taste, e.g. "often plays jazz fusion you enjoy"
}

export interface MatchResult {
  matched: MatchedEvent[];
  suggestions: Suggestion[];
}

/**
 * A record of an event that was evaluated by the LLM and rejected.
 * Stored in S3 at `data/events-discarded.json`. Cleared by `upload_preferences.sh`
 * on preference update so rejected events are re-evaluated against new preferences.
 */
export interface DiscardedRecord {
  key: string;    // SHA-256 dedup key
  title: string;  // event.title
  date: string;   // event.date (ISO YYYY-MM-DD)
  venue: string;  // event.venue
}

/**
 * A non-fatal error that occurred while fetching from a single event source.
 * The pipeline continues after recording the error and surfaces it in the digest.
 */
export interface SourceError {
  sourceId: string;
  error: string;         // error message summary (not full stack trace)
}

/**
 * Aggregated result from the fetch orchestrator — events collected across all
 * sources plus any per-source errors that occurred.
 */
export interface FetchResult {
  events: Event[];
  errors: SourceError[];
}

/**
 * Summary returned by {@link runPipeline} at the end of a successful run.
 * Logged by the Lambda handler and visible in CloudWatch Logs.
 */
export interface PipelineResult {
  matchedCount: number;
  suggestionsCount: number;
  sourceErrors: SourceError[];
}

/**
 * Contract that every event data source must implement.
 *
 * Adding a new source means creating a class that implements this interface and
 * passing an instance to the `sources` array in {@link PipelineDeps}. No other
 * pipeline code needs to change.
 */
export interface EventSource {
  /** Stable identifier used in logs and error reporting (e.g. `'ceska-filharmonie'`). */
  readonly id: string;
  /** Geographic region of this source's events — used to section the digest email. */
  readonly region: Region;
  /** Fetch all upcoming events from this source. Must resolve with an array (empty is fine). */
  fetch(): Promise<Event[]>;
}
