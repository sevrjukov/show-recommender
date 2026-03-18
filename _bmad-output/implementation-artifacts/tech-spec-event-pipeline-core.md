---
title: 'Event Pipeline — Core Business Logic'
slug: 'event-pipeline-core'
created: '2026-03-18'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['TypeScript 5.9 (strict, NodeNext modules)', 'Node.js 20 LTS', 'openai SDK', '@aws-sdk/client-s3', '@aws-sdk/client-ses', 'Jest + ts-jest']
files_to_modify:
  - 'src/event-pipeline/index.ts'
  - 'package.json'
  - 'lib/recommender-app-stack.ts'
  - 'jest.config.js'
files_to_create:
  - 'src/event-pipeline/types.ts'
  - 'src/event-pipeline/fetch-events.ts'
  - 'src/event-pipeline/dedup.ts'
  - 'src/event-pipeline/exclude-sent.ts'
  - 'src/event-pipeline/llm-match.ts'
  - 'src/event-pipeline/load-preferences.ts'
  - 'src/event-pipeline/adapters/llm-adapter.ts'
  - 'src/event-pipeline/adapters/openai-adapter.ts'
  - 'src/event-pipeline/digest-builder.ts'
  - 'src/event-pipeline/send-email.ts'
  - 'src/event-pipeline/pipeline.ts'
  - 'config/user-preferences.json'
code_patterns:
  - 'NodeNext module resolution — relative imports must use .js extension (e.g. ./foo.js) even for .ts source files'
  - 'Strict TypeScript — noImplicitAny, strictNullChecks, noImplicitReturns all enabled'
  - 'EventSource interface pattern — all data sources implement fetch(): Promise<Event[]>'
  - 'LLMAdapter interface pattern — provider-agnostic, OpenAIAdapter as first implementation'
  - 'Non-fatal source failures — collect errors, continue pipeline, surface in digest warnings section'
test_patterns:
  - 'Jest + ts-jest; tests live in test/ root directory; pattern **/*.test.ts'
  - 'Test files for pipeline modules go in test/event-pipeline/ mirroring src/ structure'
---

# Tech-Spec: Event Pipeline — Core Business Logic

**Created:** 2026-03-18

## Overview

### Problem Statement

The `event-pipeline` Lambda handler is a placeholder. The pipeline business logic — aggregating events from multiple sources, deduplicating them, excluding already-sent events, running LLM-based matching against user preferences, building a digest, and sending a weekly email — needs to be implemented as testable, decoupled TypeScript modules.

### Solution

Implement the pipeline as independent TypeScript modules under `src/event-pipeline/`, each with a single responsibility, wired together by a thin orchestrator (`pipeline.ts`). The Lambda handler (`index.ts`) imports only the orchestrator, keeping infrastructure concerns separate from business logic. An `EventSource` interface decouples all data sources (Ticketmaster, venue scrapers) from the rest of the pipeline — this spec defines the interface and the fetch orchestrator only; no concrete implementations. An `LLMAdapter` interface similarly decouples the LLM provider, with an `OpenAIAdapter` as the initial implementation.

### Scope

**In Scope:**
- TypeScript interfaces in `src/event-pipeline/types.ts`: `Event`, `UserPreferences`, `MatchResult`, `PipelineResult`, `EventSource`
- `LLMAdapter` interface (`src/event-pipeline/adapters/llm-adapter.ts`) + `OpenAIAdapter` implementation (`src/event-pipeline/adapters/openai-adapter.ts`) using GPT-4o, model configurable via `OPENAI_MODEL` env var
- Fetch orchestrator (`src/event-pipeline/fetch-events.ts`): accepts array of `EventSource` instances, calls each, aggregates results, continues on individual source failure (collects errors)
- Dedup module (`src/event-pipeline/dedup.ts`): hash-based dedup using `hash(normalised_date + normalised_venue + normalised_title)`
- Exclude-already-sent module (`src/event-pipeline/exclude-sent.ts`): reads `data/events-sent.json` from S3, filters out events whose dedup key is already present
- LLM match module (`src/event-pipeline/llm-match.ts`): sends `user-preferences.json` + pre-filtered events to LLM adapter, returns matched events with per-match reasoning + "consider adding" suggestions
- Digest builder (`src/event-pipeline/digest-builder.ts`): assembles plain HTML email body from matches, "consider adding" section, and scraper failure warnings
- SES email sender (`src/event-pipeline/send-email.ts`): sends digest via AWS SES using `SENDER_EMAIL` and `RECIPIENT_EMAIL` env vars
- Pipeline orchestrator (`src/event-pipeline/pipeline.ts`): wires all modules together in sequence, persists newly matched events to `data/events-sent.json` in S3, returns `PipelineResult`
- Thin Lambda handler (`src/event-pipeline/index.ts`): reads config from S3, instantiates adapters, calls pipeline, logs result
- `config/user-preferences.json`: sample file with a handful of artists, composers, and genres for local testing

**Out of Scope:**
- Concrete `EventSource` implementations (Ticketmaster, any venue scrapers — separate specs)
- SES domain/email verification (manual, out of band)
- CDK infrastructure changes (except Task 15: env vars + Lambda timeout on `eventPipelineFn`)
- Unit tests (separate spec/task)

## Context for Development

### Codebase Patterns

- All Lambda source lives under `src/`. Lambda handler is `src/event-pipeline/index.ts` — already the entry point in CDK stack (`NodejsFunction`).
- TypeScript 5.9, strict mode. `module: NodeNext`, `moduleResolution: NodeNext` — **relative imports must use `.js` extension** (e.g. `import { foo } from './bar.js'`) even though source files are `.ts`. esbuild resolves correctly at bundle time; `tsc --noEmit` requires the extensions to pass NodeNext checks.
- No `outDir` — esbuild handles Lambda bundling; `tsc` is type-check only.
- Jest + ts-jest for testing. Config in `jest.config.js`. Tests live in `test/` root directory, matching `**/*.test.ts`. Pipeline module tests should go in `test/event-pipeline/`.
- No database — S3 JSON only. `BUCKET_NAME` env var available to Lambda.
- S3 key layout: `config/user-preferences.json` (read by pipeline), `data/events-sent.json` (append-only dedup log, read+write). No intermediate `events-raw.json` write for POC.
- Non-fatal source failure pattern: each `EventSource.fetch()` is called in a try/catch; errors are collected and passed through to the digest as a warnings section. Pipeline never throws on individual source failure.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `_bmad-output/brainstorming/brainstorming-session-2026-03-17-1400.md` | Full architecture decisions, pipeline flow, S3 layout, matching approach |
| `lib/recommender-app-stack.ts` | CDK stack — env vars on Lambda (`BUCKET_NAME`), needs `SENDER_EMAIL`, `RECIPIENT_EMAIL`, `OPENAI_API_KEY` added |
| `src/event-pipeline/index.ts` | Current placeholder handler — will be replaced |
| `tsconfig.json` | Confirms NodeNext module resolution — drives `.js` extension requirement |
| `jest.config.js` | Test runner config — ts-jest, roots at `test/` |
| `package.json` | Current deps — `openai`, `@aws-sdk/client-s3`, `@aws-sdk/client-ses` not yet installed |

### Technical Decisions

- **`EventSource` interface** — all event sources implement `fetch(): Promise<Event[]>`. Fetch orchestrator takes `EventSource[]`. Adding a new source = new class, zero pipeline changes.
- **`LLMAdapter` interface** — `matchEvents(prefs: UserPreferences, events: Event[]): Promise<MatchResult>`. `OpenAIAdapter` is first implementation. Switching provider = new class, no pipeline changes.
- **OpenAI GPT-4o** — model configurable via `OPENAI_MODEL` env var (default `'gpt-4o'`). Key via `OPENAI_API_KEY` env var. Both must be added to Lambda env in CDK (key preferably via Secrets Manager in production; for POC, set manually in Lambda console — never commit to CDK code).
- **NodeNext `.js` import extensions** — all relative imports across `src/event-pipeline/` must use `.js` suffix. This is a TypeScript NodeNext requirement and is compatible with esbuild bundling.
- **Dedup key** — `sha256(normalised_date + '|' + normalised_venue + '|' + normalised_title)` using Node.js built-in `crypto`. Normalise: ISO date string (`YYYY-MM-DD`), lowercase+trimmed venue name, lowercase+trimmed title/performer name.
- **`events-sent.json`** — array of dedup key strings. On first run, if file doesn't exist in S3, treat as empty array (graceful init). After matching, append new hashes and write back atomically (read → merge → write).
- **AWS SDK packages** — `@aws-sdk/client-s3` and `@aws-sdk/client-ses` must be added as `dependencies` in `package.json` and will be bundled by esbuild. Do not rely on Lambda runtime's built-in SDK (esbuild bundles explicitly).
- **SES env vars** — `SENDER_EMAIL` and `RECIPIENT_EMAIL` need to be added to `eventPipelineFn` in `lib/recommender-app-stack.ts`. Small CDK change — included in this spec's task list.
- **Plain HTML digest** — simple string construction, no template library. `<h2>`, `<ul>`, `<li>` only. One entry per matched event: Artist/Title · Venue · Date · URL · LLM reasoning.
- **Logging convention** — use `console.log` for informational steps, `console.warn` for recoverable issues (source errors), `console.error` for fatal errors. All log lines are prefixed with the module name in brackets: `[pipeline]`, `[fetch]`, `[dedup]`, `[exclude-sent]`, `[llm]`, `[email]`, `[handler]`. Never log the `OPENAI_API_KEY` value. Log counts at every stage boundary so CloudWatch Logs shows a clear trace of each run.

## Implementation Plan

### Tasks

Tasks are ordered by dependency — lowest-level modules first.

---

- [ ] **Task 1: Install npm dependencies and fix build script**
  - File: `package.json`
  - Action:
    1. Run `npm install openai @aws-sdk/client-s3 @aws-sdk/client-ses` — adds to `dependencies`
    2. Change the `"build"` script from `"tsc"` to `"tsc --noEmit"`
  - Notes: Deps must be in `dependencies` (not `devDependencies`) — esbuild bundles them into the Lambda artifact. The build script change is needed because `tsconfig.json` has `"declaration": true` with no `outDir` set — running plain `tsc` would emit `.d.ts` files into `src/`, polluting the source tree. Since esbuild handles Lambda bundling, `tsc` is only used for type-checking and must always run with `--noEmit`.

---

- [ ] **Task 2: Create `config/user-preferences.json`**
  - File: `config/user-preferences.json` (new, at repo root)
  - Action: Create with the following content — a handful of sample entries for local development and manual upload to S3:
    ```json
    {
      "artists": ["Evgeny Kissin", "Yuja Wang", "Armin van Buuren"],
      "composers": ["Chopin", "Rachmaninov", "Beethoven", "Brahms"],
      "genres": ["classical", "trance"]
    }
    ```
  - Notes: This is the seed for the S3 `config/user-preferences.json` key. The Lambda always reads from S3 — upload this file manually via AWS console or CLI after deploy: `aws s3 cp config/user-preferences.json s3://<bucket>/config/user-preferences.json`. Edit freely; it is not used by any code at build time.

---

- [ ] **Task 3: Create `src/event-pipeline/types.ts`**
  - File: `src/event-pipeline/types.ts` (new)
  - Action: Define all shared TypeScript interfaces used across pipeline modules:

    ```typescript
    export interface Event {
      title: string;          // performer name or show title
      venue: string;          // venue name (canonical, as returned by the source)
      /** Must be ISO date format YYYY-MM-DD. Sources are responsible for this format.
       *  computeDedupKey() tolerates ISO datetime strings by slicing to first 10 chars,
       *  but YYYY-MM-DD is the canonical form. */
      date: string;
      url: string;            // direct link to the event page
      sourceId: string;       // identifier of the data source (e.g. 'ceska-filharmonie', 'ticketmaster')
      performers?: string[];  // list of performer names if available from source
      composers?: string[];   // list of composer names if available from source
      description?: string;   // optional free-text for LLM context (genre, programme notes, etc.)
    }

    export interface UserPreferences {
      artists: string[];     // e.g. ["Evgeny Kissin", "Armin van Buuren"]
      composers: string[];   // e.g. ["Chopin", "Rachmaninov"]
      genres: string[];      // e.g. ["classical", "trance"]
    }

    export interface MatchedEvent {
      event: Event;
      reasoning: string;     // 1-2 sentence LLM explanation for why this matches the user's taste
    }

    export interface MatchResult {
      matched: MatchedEvent[];
      suggestions: string[]; // artist/composer names LLM found relevant but not in preferences
    }

    export interface SourceError {
      sourceId: string;
      error: string;         // error message summary (not full stack trace)
    }

    export interface FetchResult {
      events: Event[];
      errors: SourceError[];
    }

    export interface PipelineResult {
      matchedCount: number;
      suggestionsCount: number;
      sourceErrors: SourceError[];
    }

    export interface EventSource {
      readonly id: string;
      fetch(): Promise<Event[]>;
    }
    ```

---

- [ ] **Task 4: Create `src/event-pipeline/adapters/llm-adapter.ts`**
  - File: `src/event-pipeline/adapters/llm-adapter.ts` (new)
  - Action: Define the `LLMAdapter` interface:

    ```typescript
    import type { MatchResult, UserPreferences, Event } from '../types.js';

    export interface LLMAdapter {
      matchEvents(preferences: UserPreferences, events: Event[]): Promise<MatchResult>;
    }
    ```

  - Notes: Single method; implementors receive the full preferences object and pre-filtered event list, return `MatchResult`. The interface is intentionally minimal — no streaming, no conversation history.

---

- [ ] **Task 5: Create `src/event-pipeline/adapters/openai-adapter.ts`**
  - File: `src/event-pipeline/adapters/openai-adapter.ts` (new)
  - Action: Implement `OpenAIAdapter` using the `openai` npm SDK:

    ```typescript
    import OpenAI from 'openai';
    import type { LLMAdapter } from './llm-adapter.js';
    import type { Event, MatchResult, MatchedEvent, UserPreferences } from '../types.js';

    const SYSTEM_PROMPT = `You are a music event matching assistant. Given a user's taste profile and a list of upcoming music events, identify which events the user would likely enjoy attending.

    Return ONLY a valid JSON object with this exact structure:
    {
      "matched": [{ "eventIndex": 0, "reasoning": "Brief 1-2 sentence explanation" }],
      "suggestions": ["Artist or Composer Name"]
    }

    Where:
    - "matched": zero-based indexes of events the user would enjoy, with reasoning
    - "suggestions": artist/composer names found in the events that are NOT in the user's preferences but are stylistically relevant — for the user to consider adding`;

    export class OpenAIAdapter implements LLMAdapter {
      private readonly client: OpenAI;
      private readonly model: string;

      constructor(apiKey: string, model: string = 'gpt-4o') {
        this.client = new OpenAI({ apiKey });
        this.model = model;
      }

      async matchEvents(preferences: UserPreferences, events: Event[]): Promise<MatchResult> {
        if (events.length === 0) {
          return { matched: [], suggestions: [] };
        }

        const userMessage = `User taste profile:\n${JSON.stringify(preferences, null, 2)}\n\nUpcoming events:\n${JSON.stringify(events.map((e, i) => ({ index: i, ...e })), null, 2)}`;

        const maxAttempts = 3;
        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            console.log(`[llm:openai] Calling model=${this.model} with ${events.length} events (attempt ${attempt}/${maxAttempts})`);

            const completion = await this.client.chat.completions.create({
              model: this.model,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userMessage },
              ],
            });

            const raw = completion.choices[0]?.message?.content ?? '{}';
            const parsed = JSON.parse(raw) as { matched?: { eventIndex: number; reasoning: string }[]; suggestions?: string[] };

            if (!Array.isArray(parsed.matched) || !Array.isArray(parsed.suggestions)) {
              throw new Error(`OpenAI response missing required fields. Raw: ${raw}`);
            }

            console.log(`[llm:openai] Response received, usage: ${JSON.stringify(completion.usage)}`);
            console.log(`[llm:openai] Parsed: ${parsed.matched.length} matched, ${parsed.suggestions.length} suggestions`);

            const matched: MatchedEvent[] = parsed.matched
              .filter(m => {
                if (m.eventIndex < 0 || m.eventIndex >= events.length) {
                  console.warn('[llm:openai] Ignoring out-of-bounds eventIndex:', m.eventIndex);
                  return false;
                }
                return true;
              })
              .map(m => ({ event: events[m.eventIndex]!, reasoning: m.reasoning }));

            return { matched, suggestions: parsed.suggestions };
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            console.warn(`[llm:openai] Attempt ${attempt}/${maxAttempts} failed:`, lastError.message);
            if (attempt < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // 1s, 2s backoff
            }
          }
        }

        throw lastError ?? new Error('LLM matching failed after all attempts');
      }
    }
    ```

  - Notes: `response_format: { type: 'json_object' }` forces JSON output — requires the word "json" to appear in the system prompt (satisfied by "valid JSON object"). Retries up to 3 attempts total with linear backoff (1s, 2s) for transient GPT-4o validation failures (malformed JSON, missing fields). Out-of-bounds `eventIndex` values are filtered with a warning rather than throwing — a single bad index should not discard the entire response.

---

- [ ] **Task 6: Create `src/event-pipeline/dedup.ts`**
  - File: `src/event-pipeline/dedup.ts` (new)
  - Action: Implement dedup key computation and cross-source deduplication:

    ```typescript
    import { createHash } from 'crypto';
    import type { Event } from './types.js';

    export function computeDedupKey(event: Event): string {
      // Slice to first 10 chars to normalise both YYYY-MM-DD and YYYY-MM-DDTHH:mm:ssZ formats
      const date = event.date.trim().slice(0, 10);
      const venue = event.venue.toLowerCase().trim();
      const title = event.title.toLowerCase().trim();
      return createHash('sha256').update(`${date}|${venue}|${title}`).digest('hex');
    }

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
    ```

  - Notes: First occurrence wins (preserves order). `date` is not normalised beyond trim — sources are responsible for providing ISO `YYYY-MM-DD` format. The `|` separator prevents hash collisions between adjacent field values.
  - Logging: after `deduplicateEvents` returns: `[dedup] ${input.length} → ${output.length} events (${input.length - output.length} duplicates removed)`

---

- [ ] **Task 7: Create `src/event-pipeline/fetch-events.ts`**
  - File: `src/event-pipeline/fetch-events.ts` (new)
  - Action: Implement the fetch orchestrator that calls all registered sources, collects results and errors:

    ```typescript
    import type { Event, EventSource, FetchResult } from './types.js';

    const SOURCE_TIMEOUT_MS = 30_000;

    function withTimeout<T>(promise: Promise<T>, ms: number, sourceId: string): Promise<T> {
      return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Source timed out after ${ms}ms`)), ms)
        ),
      ]);
    }

    export async function fetchAllEvents(sources: EventSource[]): Promise<FetchResult> {
      const allEvents: Event[] = [];
      const errors: FetchResult['errors'] = [];

      console.log(`[fetch] Starting fetch from ${sources.length} sources`);

      await Promise.all(
        sources.map(async source => {
          try {
            console.log(`[fetch] ${source.id}: fetching...`);
            const events = await withTimeout(source.fetch(), SOURCE_TIMEOUT_MS, source.id);
            allEvents.push(...events);
            console.log(`[fetch] ${source.id}: ${events.length} events returned`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[fetch] ${source.id} failed:`, message);
            errors.push({ sourceId: source.id, error: message });
          }
        })
      );

      console.log(`[fetch] Total: ${allEvents.length} events (${errors.length} source(s) failed)`);
      return { events: allEvents, errors };
    }
    ```

  - Notes: `FetchResult` is defined in `types.ts` and imported here. Each source fetch is wrapped in a 30-second timeout via `Promise.race` — a hung source is treated as a non-fatal error and does not block the pipeline indefinitely. Uses `Promise.all` with an inner `try/catch` per source — the try/catch consumes any rejection, so `Promise.all` never rejects. All sources run concurrently; order of `allEvents` is non-deterministic but dedup and LLM matching are order-independent.
  - Logging:
    - Before loop: `[fetch] Starting fetch from ${sources.length} sources`
    - Per source success: `[fetch] ${source.id}: ${events.length} events returned`
    - Per source error: `console.warn('[fetch]', source.id, 'failed:', err.message)`
    - After loop: `[fetch] Total: ${allEvents.length} events (${errors.length} source(s) failed)`

---

- [ ] **Task 8: Create `src/event-pipeline/exclude-sent.ts`**
  - File: `src/event-pipeline/exclude-sent.ts` (new)
  - Action: Implement loading already-sent keys from S3 and filtering events:

    ```typescript
    import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
    import type { Event } from './types.js';
    import { computeDedupKey } from './dedup.js';

    const SENT_KEY = 'data/events-sent.json';

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

    export function excludeSentEvents(events: Event[], sentKeys: Set<string>): Event[] {
      const result = events.filter(event => !sentKeys.has(computeDedupKey(event)));
      console.log(`[exclude-sent] ${events.length} → ${result.length} new events (${events.length - result.length} already sent)`);
      return result;
    }

    export async function saveSentKeys(s3: S3Client, bucket: string, existingKeys: Set<string>, newEvents: Event[]): Promise<void> {
      const newKeys = newEvents.map(computeDedupKey);
      const merged = Array.from(new Set([...existingKeys, ...newKeys]));
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: SENT_KEY,
        Body: JSON.stringify(merged),
        ContentType: 'application/json',
      }));
    }
    ```

  - Notes: `loadSentKeys` handles first-run gracefully (file absent → empty Set). `saveSentKeys` merges existing keys with newly matched event keys before writing. Only matched events (those appearing in the digest) are passed to `saveSentKeys` — unmatched events are not logged and will be re-evaluated next week.
  - Logging:
    - `loadSentKeys` on NoSuchKey: `[exclude-sent] events-sent.json not found, starting fresh`
    - `loadSentKeys` on success: `[exclude-sent] Loaded ${keys.size} sent keys`
    - After `excludeSentEvents`: `[exclude-sent] ${input.length} → ${output.length} new events (${input.length - output.length} already sent)`
    - `saveSentKeys` after write: `[exclude-sent] Saved ${merged.length} total keys to S3`

---

- [ ] **Task 9: Create `src/event-pipeline/llm-match.ts`**
  - File: `src/event-pipeline/llm-match.ts` (new)
  - Action: Thin wrapper delegating to the `LLMAdapter`:

    ```typescript
    import type { LLMAdapter } from './adapters/llm-adapter.js';
    import type { Event, MatchResult, UserPreferences } from './types.js';

    export async function matchEvents(
      adapter: LLMAdapter,
      preferences: UserPreferences,
      events: Event[],
    ): Promise<MatchResult> {
      if (events.length === 0) {
        return { matched: [], suggestions: [] };
      }
      return adapter.matchEvents(preferences, events);
    }
    ```

  - Notes: Early-exit on empty events list avoids an unnecessary LLM call. The module exists as a seam for future pre/post-processing logic (e.g. chunking large event lists, geography pre-filter) without touching `pipeline.ts`.
  - Logging:
    - On early-exit: `[llm] No events to match, skipping LLM call`
    - Before call: `[llm] Sending ${events.length} events to LLM for matching`
    - After call (using result): `[llm] Result: ${result.matched.length} matches, ${result.suggestions.length} suggestions`

---

- [ ] **Task 10: Create `src/event-pipeline/digest-builder.ts`**
  - File: `src/event-pipeline/digest-builder.ts` (new)
  - Action: Build an HTML email body using **inline styles** (required for email client compatibility — Gmail, Outlook, and most clients strip `<style>` blocks):

    ```typescript
    import type { MatchResult, SourceError } from './types.js';

    // Style constants — applied inline to each element for email client compatibility
    const S = {
      body: 'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #222; background: #f9f9f9; margin: 0; padding: 24px 16px;',
      container: 'max-width: 620px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 32px 40px;',
      h2: 'font-size: 17px; font-weight: 600; color: #111; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-top: 32px; margin-bottom: 12px;',
      ul: 'padding: 0; list-style: none; margin: 0;',
      li: 'padding: 12px 0; border-bottom: 1px solid #f0f0f0;',
      liWarning: 'padding: 12px 0; border-bottom: 1px solid #f0f0f0; color: #b45309;',
      a: 'color: #0066cc; text-decoration: none;',
      em: 'color: #555; font-style: italic; font-size: 13px;',
      p: 'color: #555;',
    };

    export function buildDigest(result: MatchResult, errors: SourceError[]): string {
      const sections: string[] = [];

      // --- Matched events ---
      if (result.matched.length > 0) {
        const items = result.matched.map(({ event, reasoning }) =>
          `<li style="${S.li}"><strong>${escapeHtml(event.title)}</strong> · ${escapeHtml(event.venue)} · ${event.date}<br><a href="${safeHref(event.url)}" style="${S.a}">${escapeHtml(event.url)}</a><br><em style="${S.em}">${escapeHtml(reasoning)}</em></li>`
        );
        sections.push(`<h2 style="${S.h2}">Upcoming events for you</h2><ul style="${S.ul}">${items.join('')}</ul>`);
      } else {
        sections.push(`<h2 style="${S.h2}">Upcoming events for you</h2><p style="${S.p}">No new matching events this week.</p>`);
      }

      // --- Consider adding ---
      if (result.suggestions.length > 0) {
        const items = result.suggestions.map(s => `<li style="${S.li}">${escapeHtml(s)}</li>`);
        sections.push(`<h2 style="${S.h2}">Consider adding to your preferences</h2><ul style="${S.ul}">${items.join('')}</ul>`);
      }

      // --- Source warnings ---
      if (errors.length > 0) {
        const items = errors.map(e => `<li style="${S.liWarning}"><strong>${escapeHtml(e.sourceId)}</strong>: ${escapeHtml(e.error)}</li>`);
        sections.push(`<h2 style="${S.h2}">⚠️ Source warnings</h2><ul style="${S.ul}">${items.join('')}</ul>`);
      }

      return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="${S.body}"><div style="${S.container}">${sections.join('')}</div></body></html>`;
    }

    function escapeHtml(str: string): string {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /** Validates URL protocol before use in href — prevents javascript: injection from untrusted scraper URLs. */
    function safeHref(url: string): string {
      return url.startsWith('https://') || url.startsWith('http://') ? escapeHtml(url) : '#';
    }
    ```

  - Notes: Inline styles are used because `<style>` blocks are stripped by Gmail, Outlook, and most email clients. The `S` object centralises all style values — edit in one place to restyle. `event.url` uses `safeHref` in the `href` attribute (protocol allowlist + HTML escape) and `escapeHtml` in the link text — event URLs come from external scrapers and must be treated as untrusted input. `escapeHtml` now includes single-quote escaping (`&#39;`). Warning items use amber colour applied inline.

---

- [ ] **Task 11: Create `src/event-pipeline/send-email.ts`**
  - File: `src/event-pipeline/send-email.ts` (new)
  - Action: Send the HTML digest via AWS SES:

    ```typescript
    import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

    export async function sendDigestEmail(
      ses: SESClient,
      senderEmail: string,
      recipientEmail: string,
      htmlBody: string,
    ): Promise<void> {
      const now = new Date().toISOString().slice(0, 10);
      await ses.send(new SendEmailCommand({
        Source: senderEmail,
        Destination: { ToAddresses: [recipientEmail] },
        Message: {
          Subject: { Data: `Show Recommender Digest — ${now}`, Charset: 'UTF-8' },
          Body: { Html: { Data: htmlBody, Charset: 'UTF-8' } },
        },
      }));
    }
    ```

  - Notes: Subject includes the run date for easy inbox scanning. Both `senderEmail` and `recipientEmail` must be SES-verified before this call succeeds (done manually out of band). SES client is injected — region must match where SES is configured (eu-central-1 per CDK stack).
  - Logging:
    - Before send: `[email] Sending digest to ${recipientEmail}`
    - After send: `[email] Digest sent successfully`

---

- [ ] **Task 12: Create `src/event-pipeline/load-preferences.ts`**
  - File: `src/event-pipeline/load-preferences.ts` (new)
  - Action: Load and validate `user-preferences.json` from S3 — single-responsibility module, keeps `pipeline.ts` free of direct S3 calls:

    ```typescript
    import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
    import type { UserPreferences } from './types.js';

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

      const prefs = p as unknown as UserPreferences;
      console.log(`[preferences] Loaded: ${prefs.artists.length} artists, ${prefs.composers.length} composers, ${prefs.genres.length} genres`);
      return prefs;
    }
    ```

  - Notes: Validates that all three required arrays are present — throws with a descriptive message if not (covers malformed file and empty `{}` from graceful S3 default). Failure here is fatal — pipeline cannot match without valid preferences.

---

- [ ] **Task 13: Create `src/event-pipeline/pipeline.ts`**
  - File: `src/event-pipeline/pipeline.ts` (new)
  - Action: Orchestrate all modules in sequence:

    ```typescript
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

    export interface PipelineDeps {
      sources: EventSource[];
      llmAdapter: LLMAdapter;
      s3: S3Client;
      ses: SESClient;
      bucketName: string;
      senderEmail: string;
      recipientEmail: string;
    }

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
    ```

  - Notes: Steps 1–8 are sequential and intentional. Preferences loading (step 1) is delegated to `loadPreferences` — `pipeline.ts` makes no direct S3 calls. Email is sent before persisting (step 7 before 8) — if send fails, events are not marked sent and will re-appear next run (correct failure mode). LLM and SES failures are fatal and surface via CloudWatch alarm.
  - Logging:
    - Start: `[pipeline] Starting pipeline`
    - After step 1: `[pipeline] Preferences loaded: ${artists.length} artists, ${composers.length} composers, ${genres.length} genres`
    - After step 2: delegated to `[fetch]` module logs
    - After step 3: delegated to `[dedup]` module logs
    - After step 4: delegated to `[exclude-sent]` module logs
    - After step 5: delegated to `[llm]` module logs
    - After step 7: delegated to `[email]` module logs
    - After step 8: delegated to `[exclude-sent]` saveSentKeys log
    - End: `[pipeline] Complete — matched: ${matchedCount}, suggestions: ${suggestionsCount}, sourceErrors: ${sourceErrors.length}`

---

- [ ] **Task 14: Update `src/event-pipeline/index.ts`**
  - File: `src/event-pipeline/index.ts` (replace placeholder)
  - Action: Replace the placeholder with a thin Lambda handler that reads env vars, instantiates adapters, and delegates to `runPipeline`:

    ```typescript
    import { S3Client } from '@aws-sdk/client-s3';
    import { SESClient } from '@aws-sdk/client-ses';
    import { OpenAIAdapter } from './adapters/openai-adapter.js';
    import { runPipeline } from './pipeline.js';

    export const handler = async (): Promise<void> => {
      const bucketName = process.env['BUCKET_NAME'] ?? '';
      const senderEmail = process.env['SENDER_EMAIL'] ?? '';
      const recipientEmail = process.env['RECIPIENT_EMAIL'] ?? '';
      const openaiApiKey = process.env['OPENAI_API_KEY'] ?? '';
      const openaiModel = process.env['OPENAI_MODEL'] ?? 'gpt-4o';

      const region = process.env['AWS_REGION'] ?? 'eu-central-1';

      const result = await runPipeline({
        sources: [],  // EventSource implementations added in subsequent specs
        llmAdapter: new OpenAIAdapter(openaiApiKey, openaiModel),
        s3: new S3Client({ region }),
        ses: new SESClient({ region }),
        bucketName,
        senderEmail,
        recipientEmail,
      });

      console.log('Pipeline complete:', JSON.stringify(result));
    };
    ```

  - Notes: `sources: []` is intentional — no EventSource implementations yet. The pipeline will fetch zero events, match zero, and send an empty digest. This validates the full wiring end-to-end. `AWS_REGION` is set automatically by the Lambda runtime. All env vars default to empty string — missing vars will cause downstream failures with clear error messages (SES rejected source, S3 access denied, OpenAI auth error).
  - Logging:
    - Start: `[handler] Starting event-pipeline`
    - After reading env: `[handler] Config: bucket=${bucketName}, model=${openaiModel}, region=${region}` — never log `openaiApiKey`
    - On unhandled error: `console.error('[handler] Fatal error:', err)` then rethrow
    - Final result log: already present as `console.log('Pipeline complete:', JSON.stringify(result))`

---

- [ ] **Task 15: Update `lib/recommender-app-stack.ts`**
  - File: `lib/recommender-app-stack.ts`
  - Action: Two changes to the `eventPipelineFn` `NodejsFunction` construct:

    **1. Add env vars** — change:
    ```typescript
    environment: { BUCKET_NAME: bucketName },
    ```
    To:
    ```typescript
    environment: {
      BUCKET_NAME: bucketName,
      SENDER_EMAIL: this.node.tryGetContext('senderEmail') ?? '',
      RECIPIENT_EMAIL: this.node.tryGetContext('recipientEmail') ?? '',
      OPENAI_MODEL: this.node.tryGetContext('openaiModel') ?? 'gpt-4o',
    },
    ```

    **2. Add Lambda timeout** — add `timeout` property to the same `NodejsFunction` props:
    ```typescript
    timeout: cdk.Duration.seconds(60),
    ```

  - Notes: The default Lambda timeout is 3 seconds — the pipeline makes sequential network calls to S3 (×2), OpenAI, and SES, which routinely exceed this. 60 seconds is a safe ceiling for a weekly job. `OPENAI_API_KEY` is intentionally NOT set via CDK — set it manually post-deploy via AWS console or `aws lambda update-function-configuration`. **Warning:** setting all env vars via CLI (`aws lambda update-function-configuration --environment "Variables={...}"`) replaces the entire env map — if you run this command, include ALL vars (BUCKET_NAME, SENDER_EMAIL, RECIPIENT_EMAIL, OPENAI_MODEL, OPENAI_API_KEY); a subsequent `cdk deploy` will re-apply CDK-managed vars and drop OPENAI_API_KEY, requiring the CLI command to be re-run. The three non-secret vars follow the existing `alertEmail` CDK context pattern: `cdk deploy -c senderEmail=you@example.com -c recipientEmail=you@example.com`.

---

- [ ] **Task 16: Fix `jest.config.js` for NodeNext module resolution**
  - File: `jest.config.js`
  - Action: Add `moduleNameMapper` to strip `.js` extensions at test-time. ts-jest resolves `.ts` sources but cannot resolve literal `.js` files — the mapper redirects `./foo.js` → `./foo` which ts-jest then finds as `./foo.ts`. Change:
    ```javascript
    module.exports = {
      testEnvironment: 'node',
      roots: ['<rootDir>/test'],
      testMatch: ['**/*.test.ts'],
      transform: {
        '^.+\\.tsx?$': 'ts-jest'
      },
      setupFilesAfterEnv: ['aws-cdk-lib/testhelpers/jest-autoclean'],
    };
    ```
    To:
    ```javascript
    module.exports = {
      testEnvironment: 'node',
      roots: ['<rootDir>/test'],
      testMatch: ['**/*.test.ts'],
      transform: {
        '^.+\\.tsx?$': 'ts-jest'
      },
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      setupFilesAfterEnv: ['aws-cdk-lib/testhelpers/jest-autoclean'],
    };
    ```
  - Notes: Without this, any test that imports a pipeline module (which uses `.js` relative imports) will fail with `Cannot find module './foo.js'`. This fix is required before any pipeline unit tests can run. The regex `^(\\.{1,2}/.*)\\.js$` matches all relative imports ending in `.js` and strips the extension.

---

### Acceptance Criteria

- [ ] **AC1 — TypeScript compiles**
  - Given: all files are created as specified
  - When: `tsc --noEmit` is run from repo root
  - Then: exits 0 with no errors

- [ ] **AC2 — CDK synth succeeds after env var additions**
  - Given: Task 14 is complete
  - When: `cdk synth` is run
  - Then: `RecommenderAppStack` template shows `SENDER_EMAIL`, `RECIPIENT_EMAIL`, `OPENAI_MODEL` in the Lambda environment; `BUCKET_NAME` is still present; no errors

- [ ] **AC3 — `EventSource` interface is correctly typed**
  - Given: `src/event-pipeline/types.ts` exists
  - When: a class `class TestSource implements EventSource` is written with `id = 'test'` and `fetch(): Promise<Event[]> { return Promise.resolve([]); }`
  - Then: TypeScript accepts it without errors (confirms the interface contract is implementable)

- [ ] **AC4 — Dedup removes cross-source duplicates**
  - Given: two events with identical `date`, `venue` (case-insensitive), and `title` (case-insensitive) from different `sourceId` values
  - When: `deduplicateEvents([event1, event2])` is called
  - Then: returns an array of length 1 (first occurrence kept)

- [ ] **AC5 — Dedup keeps genuinely distinct events**
  - Given: two events with the same venue and date but different titles
  - When: `deduplicateEvents([event1, event2])` is called
  - Then: returns both events

- [ ] **AC6 — `fetchAllEvents` continues after source failure**
  - Given: two sources — one that returns `[event1]` and one that throws `new Error('network timeout')`
  - When: `fetchAllEvents([goodSource, badSource])` is called
  - Then: returns `{ events: [event1], errors: [{ sourceId: badSource.id, error: 'network timeout' }] }`

- [ ] **AC7 — `loadSentKeys` returns empty Set when file absent**
  - Given: `data/events-sent.json` does not exist in the S3 bucket (S3 returns `NoSuchKey`)
  - When: `loadSentKeys(s3, bucket)` is called
  - Then: returns an empty `Set<string>` without throwing

- [ ] **AC8 — `excludeSentEvents` filters previously sent events**
  - Given: three events; `sentKeys` contains the dedup key of the second event
  - When: `excludeSentEvents([e1, e2, e3], sentKeys)` is called
  - Then: returns `[e1, e3]` — the already-sent event is excluded

- [ ] **AC9 — `buildDigest` includes all sections when all data present**
  - Given: `matchResult` with two matched events and one suggestion; `errors` with one source error
  - When: `buildDigest(matchResult, errors)` is called
  - Then: returned HTML contains all three sections: "Upcoming events for you" with 2 items, "Consider adding" with 1 item, "Source warnings" with 1 item

- [ ] **AC10 — `buildDigest` returns fallback message when no matches**
  - Given: `matchResult` with `matched: []` and `suggestions: []`; `errors: []`
  - When: `buildDigest(matchResult, errors)` is called
  - Then: returned HTML contains "No new matching events this week" and does not throw or return empty string

- [ ] **AC11 — `matchEvents` skips LLM call when event list is empty**
  - Given: `events` is an empty array
  - When: `matchEvents(adapter, preferences, [])` is called
  - Then: returns `{ matched: [], suggestions: [] }` without calling `adapter.matchEvents`

- [ ] **AC12 — `OpenAIAdapter` maps eventIndex correctly**
  - Given: OpenAI API returns `{ matched: [{ eventIndex: 1, reasoning: 'Great match' }], suggestions: ['Yuja Wang'] }` for a 3-event input
  - When: `openAIAdapter.matchEvents(prefs, [event0, event1, event2])` resolves
  - Then: `matched[0].event` equals `event1` and `matched[0].reasoning` equals `'Great match'`

- [ ] **AC13 — `saveSentKeys` merges existing and new keys**
  - Given: S3 `events-sent.json` contains `["hash-a"]`; two new matched events with keys `"hash-b"` and `"hash-c"`
  - When: `saveSentKeys(s3, bucket, new Set(['hash-a']), [eventB, eventC])` is called
  - Then: S3 is written with a JSON array containing all three keys: `["hash-a", "hash-b", "hash-c"]` (order may vary)

- [ ] **AC14 — Pipeline completes and sends email even with zero matching events**
  - Given: `sources: []` (no event sources registered), valid user-preferences.json in S3, SES verified
  - When: `runPipeline(deps)` completes
  - Then: `matchedCount === 0`, email is sent (SES call made), `events-sent.json` is written (empty merge), no exception thrown

---

## Additional Context

### Dependencies

- `openai` — OpenAI SDK for GPT-4o calls
- `@aws-sdk/client-s3` — S3 GetObject/PutObject for preferences and sent-keys
- `@aws-sdk/client-ses` — SES SendEmail for digest delivery
- Node.js built-in `crypto` — SHA-256 for dedup key hashing (no installation needed)
- All existing CDK/TypeScript deps remain unchanged

### Testing Strategy

Unit tests are out of scope for this spec but the module design enables them:
- `dedup.ts` — pure functions, trivially unit-testable
- `fetch-events.ts` — inject mock `EventSource` array
- `exclude-sent.ts` — inject mock `S3Client` (or use `@aws-sdk/lib-storage` mock); `excludeSentEvents` is a pure function
- `llm-match.ts` — inject mock `LLMAdapter`
- `digest-builder.ts` — pure function, test with fixture data
- `pipeline.ts` — inject all deps; full integration test with mock S3/SES/LLMAdapter

All tests go in `test/event-pipeline/` to mirror `src/event-pipeline/` structure.

### Notes

- **`OPENAI_API_KEY` delivery:** never add to CDK code. After `cdk deploy`, set via: `aws lambda update-function-configuration --function-name event-pipeline --environment "Variables={OPENAI_API_KEY=sk-...,BUCKET_NAME=...,SENDER_EMAIL=...,RECIPIENT_EMAIL=...,OPENAI_MODEL=gpt-4o}"`. Alternatively, set it manually in the Lambda console — this overwrites all env vars, so set all of them at once.
- **SES verification prerequisite:** `SENDER_EMAIL` and `RECIPIENT_EMAIL` must both be verified in SES before the pipeline can send email. Do this manually in the AWS console (SES → Verified identities). SES sandbox mode limits sending to verified addresses only — sufficient for personal POC.
- **First run behaviour:** With `sources: []` in `index.ts`, the pipeline fetches no events, calls LLM with an empty list (early-exits), builds a "no new events" digest, and sends it. This is intentional — it validates the full pipeline wiring (S3 reads, SES send) before any scrapers are added.
- **Unit tests:** writing unit tests for pipeline modules is out of scope for this spec but should be done as a follow-up spec (`tech-spec-event-pipeline-tests.md`) before adding the first real `EventSource`. The module design (pure functions + injected deps) makes all modules straightforwardly testable.
- **Geography filtering:** the brainstorming specifies geographic constraints per genre (classical: CZ + DE + AT + PL + SK + HU; electronic/jazz/nu-metal: CZ only). This filtering is not implemented in this spec — it is a responsibility of each `EventSource` implementation (sources return only relevant-geography events). The pipeline does no geography filtering itself.
