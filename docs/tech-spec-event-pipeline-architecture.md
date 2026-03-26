---
title: 'Event Pipeline — Architecture & Technical Reference'
slug: 'event-pipeline-architecture'
created: '2026-03-20'
status: 'current'
tech_stack:
  - 'TypeScript 5.9 (strict, NodeNext modules)'
  - 'Node.js 20 LTS'
  - 'openai SDK'
  - '@aws-sdk/client-s3'
  - '@aws-sdk/client-ses'
  - 'Jest + ts-jest'
---

# Event Pipeline — Architecture & Technical Reference

**Created:** 2026-03-20

## Overview

The event pipeline is a weekly AWS Lambda that aggregates music events from multiple sources, deduplicates them, filters out previously evaluated events, runs LLM-based matching against user preferences, and sends a curated HTML digest via email.

The pipeline is implemented as independent TypeScript modules under `src/event-pipeline/`, each with a single responsibility, wired together by a thin orchestrator (`pipeline.ts`). The Lambda handler (`index.ts`) imports only the orchestrator, keeping infrastructure concerns separate from business logic.

Two interfaces — `EventSource` and `LLMAdapter` — decouple data sources and the LLM provider from the pipeline core. Adding a new event source or switching LLM providers requires a new implementation class only; the pipeline itself does not change.

---

## Module Map

| File | Responsibility |
|------|---------------|
| `src/event-pipeline/index.ts` | Lambda handler — reads env vars, instantiates adapters, calls `runPipeline` |
| `src/event-pipeline/pipeline.ts` | Orchestrator — wires all modules in sequence, returns `PipelineResult` |
| `src/event-pipeline/types.ts` | Shared TypeScript interfaces used across all pipeline modules |
| `src/event-pipeline/load-preferences.ts` | Loads and validates `config/user-preferences.json` from S3 |
| `src/event-pipeline/fetch-events.ts` | Calls all registered `EventSource` instances concurrently, collects errors |
| `src/event-pipeline/dedup.ts` | Hash-based cross-source deduplication |
| `src/event-pipeline/exclude-evaluated.ts` | Loads/saves `data/events-sent.json` and `data/events-discarded.json`; filters already-evaluated events |
| `src/event-pipeline/llm-match.ts` | Thin wrapper delegating to `LLMAdapter`; guards against empty event list |
| `src/event-pipeline/digest-builder.ts` | Assembles plain HTML email body from matches, suggestions, and source warnings |
| `src/event-pipeline/send-email.ts` | Sends HTML digest via AWS SES |
| `src/event-pipeline/adapters/llm-adapter.ts` | `LLMAdapter` interface definition |
| `src/event-pipeline/adapters/openai-adapter.ts` | `OpenAIAdapter` — concrete LLM implementation using GPT-4o |
| `config/user-preferences.json` | Local seed file for user preferences (uploaded to S3 manually) |

---

## Pipeline Flow

Steps execute sequentially in `pipeline.ts`. Each module emits its own log lines (see [Logging Conventions](#logging-conventions)).

```
1. Load preferences       loadPreferences()        → UserPreferences (fatal if missing/malformed)
2. Fetch events           fetchAllEvents()          → { events, errors } (non-fatal per source)
3. Deduplicate            deduplicateEvents()       → unique Event[]
4. Exclude evaluated      loadSentKeys()            → Set<string>
                          loadDiscardedRecords()    → DiscardedRecord[]
                          excludeEvaluatedEvents()  → new Event[] only
5. LLM matching           matchEvents()             → MatchResult (matched + suggestions)
6. Build digest           buildDigest()             → HTML string
7. Send email             sendDigestEmail()         → void (fatal if SES fails)
8. Persist results        saveSentKeys()            → appends matched event keys to events-sent.json
                          saveDiscardedEvents()     → appends rejected event records to events-discarded.json
```

**Failure semantics:**
- Steps 1, 7: fatal — pipeline throws; no email sent / no keys persisted.
- Step 2: non-fatal per source — failed sources are collected as `SourceError[]` and surfaced in the digest warnings section; pipeline continues.
- Email is sent (step 7) *before* evaluated keys are persisted (step 8). If send fails, events are not marked as evaluated and will be re-processed on the next run.

---

## Core Interfaces

### `types.ts`

```typescript
export interface Event {
  title: string;          // performer name or show title
  venue: string;          // venue name (canonical, as returned by the source)
  date: string;           // ISO format: YYYY-MM-DD
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

### `LLMAdapter` interface

```typescript
export interface LLMAdapter {
  matchEvents(preferences: UserPreferences, events: Event[]): Promise<MatchResult>;
}
```

Single method; implementors receive the full preferences object and a pre-filtered event list, return `MatchResult`. Intentionally minimal — no streaming, no conversation history.

---

## Technical Decisions

### `EventSource` interface
All event sources implement `fetch(): Promise<Event[]>`. The fetch orchestrator accepts `EventSource[]`. Adding a new source means a new class only — zero pipeline changes required.

### `LLMAdapter` interface
`matchEvents(prefs, events)` is the full contract. `OpenAIAdapter` is the first implementation. Switching LLM provider requires a new class only.

### OpenAI model configuration
Model is configurable via `OPENAI_MODEL` env var — no hardcoded default. Must be explicitly provided at deploy time (e.g. `gpt-4o`, `gpt-4o-mini`). Key is read from `OPENAI_API_KEY`. Both are injected via CDK context in `deploy.sh`.

### Dedup key
`sha256(normalised_date + '|' + normalised_venue + '|' + normalised_title)` using Node.js built-in `crypto`.
- Date: ISO `YYYY-MM-DD` — the `|` separator prevents collisions between adjacent field values. Dates provided as ISO datetime strings (`YYYY-MM-DDTHH:mm:ssZ`) are sliced to the first 10 characters.
- Venue and title: lowercased and trimmed.
- Sources are responsible for providing the canonical `YYYY-MM-DD` date format.

### `events-sent.json` and `events-discarded.json`

Evaluated events are stored in two separate S3 files:
- `data/events-sent.json`: `string[]` of dedup keys — events included in at least one digest. Never cleared by `upload_preferences.sh`. Prevents re-sending past events.
- `data/events-discarded.json`: `DiscardedRecord[]` — LLM-rejected events stored with `{ key, title, date, venue }` for debugging. Cleared by `upload_preferences.sh` on preference update so newly-added artists/genres are re-evaluated. Both files are combined into a single exclusion Set at pipeline start. File absent → graceful empty init for both.

### Non-fatal source failure
Each `EventSource.fetch()` is wrapped in a `try/catch` with a 30-second timeout via `Promise.race`. Errors are collected and passed through to the digest as a warnings section. The pipeline never throws on individual source failure.

### NodeNext `.js` import extensions
All relative imports across `src/event-pipeline/` use `.js` suffix (e.g. `import { foo } from './bar.js'`). This is required by TypeScript's `NodeNext` module resolution. esbuild handles the Lambda bundle and resolves correctly; `tsc --noEmit` requires the extensions to pass type-checking. Jest uses a `moduleNameMapper` to strip `.js` extensions at test time.

### AWS SDK bundling
`@aws-sdk/client-s3` and `@aws-sdk/client-ses` are in `dependencies` (not `devDependencies`) and bundled explicitly by esbuild. The Lambda runtime's built-in SDK is not relied upon.

### HTML digest format
Inline styles only — `<style>` blocks are stripped by Gmail, Outlook, and most email clients. Sections: matched events, "consider adding" suggestions, source warnings. Event URLs from scrapers are treated as untrusted input and validated (protocol allowlist + HTML escape) before use in `href` attributes.

### Geography filtering
Geographic constraints (classical: CZ/DE/AT/PL/SK/HU; electronic/jazz: CZ only) are a responsibility of each `EventSource` implementation. The pipeline core performs no geography filtering.

---

## Data & Configuration

### S3 Layout

| Key | R/W | Description |
|-----|-----|-------------|
| `config/user-preferences.json` | Read | User taste profile — artists, composers, genres |
| `data/events-sent.json`      | Read + Write | Dedup keys of events included in a sent digest |
| `data/events-discarded.json` | Read + Write | Records of LLM-rejected events `{ key, title, date, venue }`; cleared on preference update |

### Environment Variables

| Variable | Source | Purpose |
|----------|--------|---------|
| `BUCKET_NAME` | CDK (auto) | S3 bucket for preferences and evaluated keys |
| `SENDER_EMAIL` | CDK context | SES-verified sender address |
| `RECIPIENT_EMAIL` | CDK context | SES-verified recipient address |
| `OPENAI_API_KEY` | CDK context | OpenAI API key — never logged |
| `OPENAI_MODEL` | CDK context | OpenAI model name (e.g. `gpt-4o`) |
| `AWS_REGION` | Lambda runtime | AWS region (defaults to `eu-central-1`) |

All vars default to empty string in handler code — missing vars produce clear downstream errors (S3 access denied, SES rejected source, OpenAI auth error) rather than silent failures.

---

## Codebase Patterns

- **Module resolution:** `module: NodeNext`, `moduleResolution: NodeNext` in `tsconfig.json`. Relative imports must use `.js` extension.
- **TypeScript:** strict mode — `noImplicitAny`, `strictNullChecks`, `noImplicitReturns`.
- **No `outDir`:** esbuild handles Lambda bundling; `tsc` is type-check only (`--noEmit`).
- **No database:** S3 JSON only.
- **Tests:** Jest + ts-jest. Tests live in `test/` root, mirroring `src/` structure. Pipeline module tests go in `test/event-pipeline/`.

### Key files to reference

| File | Purpose |
|------|---------|
| `docs/business-spec-2026-03-17-1400.md` | Full architecture decisions, pipeline flow, S3 layout, matching approach |
| `lib/recommender-app-stack.ts` | CDK stack — Lambda env vars, timeout |
| `tsconfig.json` | NodeNext module resolution config |
| `jest.config.js` | Test runner config — ts-jest, `.js` extension mapper |
| `deploy.sh` | CDK deploy script — passes all context vars |

---

## Logging Conventions

All log lines are prefixed with the module name in brackets. Use `console.log` for informational steps, `console.warn` for recoverable issues (source errors), `console.error` for fatal errors. Never log the `OPENAI_API_KEY` value.

| Prefix | Module |
|--------|--------|
| `[handler]` | `index.ts` |
| `[pipeline]` | `pipeline.ts` |
| `[preferences]` | `load-preferences.ts` |
| `[fetch]` | `fetch-events.ts` |
| `[dedup]` | `dedup.ts` |
| `[exclude-evaluated]` | `exclude-evaluated.ts` |
| `[llm]` | `llm-match.ts` |
| `[llm:openai]` | `openai-adapter.ts` |
| `[email]` | `send-email.ts` |

Log counts at every stage boundary so CloudWatch Logs shows a clear trace of each run.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `openai` | OpenAI SDK for GPT-4o calls |
| `@aws-sdk/client-s3` | S3 GetObject/PutObject for preferences and evaluated keys |
| `@aws-sdk/client-ses` | SES SendEmail for digest delivery |
| `crypto` (Node built-in) | SHA-256 for dedup key hashing |

---

## Testing

Tests live in `test/event-pipeline/` mirroring `src/event-pipeline/`. The module design enables straightforward unit testing:

| Module | Test approach |
|--------|--------------|
| `dedup.ts` | Pure functions — no mocks needed |
| `fetch-events.ts` | Inject mock `EventSource[]` |
| `exclude-evaluated.ts` | Inject mock `S3Client`; `excludeEvaluatedEvents` is a pure function |
| `llm-match.ts` | Inject mock `LLMAdapter` |
| `digest-builder.ts` | Pure function — test with fixture data |
| `pipeline.ts` | Inject all deps; full integration test with mock S3/SES/LLMAdapter |

---

## Notes

- **SES verification prerequisite:** Both `SENDER_EMAIL` and `RECIPIENT_EMAIL` must be verified in SES before the pipeline can send email (SES → Verified identities in AWS console). SES sandbox mode limits sending to verified addresses only.
- **First-run behaviour:** With `sources: []` in `index.ts`, the pipeline fetches no events, skips the LLM call, builds a "no new events" digest, and sends it. This validates full pipeline wiring (S3 reads, SES send) before any scrapers are added.
- **Adding a new event source:** implement `EventSource` (provide `id` string + `fetch(): Promise<Event[]>`), register the instance in `index.ts` `sources` array. No other files change.
