---
title: 'Split Evaluated Events into Sent and Discarded Stores'
slug: 'split-sent-discarded-events'
created: '2026-03-20'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'TypeScript 5.9 (strict, NodeNext modules)'
  - 'Node.js 20 LTS'
  - '@aws-sdk/client-s3'
  - 'Jest + ts-jest'
files_to_modify:
  - 'src/event-pipeline/types.ts'
  - 'src/event-pipeline/exclude-evaluated.ts'
  - 'src/event-pipeline/pipeline.ts'
  - 'upload_preferences.sh'
  - '_bmad-output/implementation-artifacts/tech-spec-event-pipeline-architecture.md'
code_patterns:
  - 'NoSuchKey graceful init for all S3 reads'
  - 'Pure function excludeEvaluatedEvents unchanged'
  - 'NodeNext .js import extensions on all relative imports'
test_patterns:
  - 'Inject mock S3Client; pure functions need no mocks'
  - 'Jest + ts-jest in test/event-pipeline/'
---

# Tech-Spec: Split Evaluated Events into Sent and Discarded Stores

**Created:** 2026-03-20

## Overview

### Problem Statement

`upload_preferences.sh` clears `data/events-evaluated.json` on every preference update so that events previously filtered by the LLM are re-evaluated against the new preferences. This also causes previously **sent** events to be re-included in the next digest, producing duplicate emails for shows the user has already seen.

### Solution

Split the single `events-evaluated.json` into two S3 files:
- `data/events-sent.json` — dedup keys of events already included in a digest (never cleared on preference update).
- `data/events-discarded.json` — richer records for LLM-rejected events (cleared on preference update so they can be re-evaluated against new preferences).

`upload_preferences.sh` is updated to clear only `events-discarded.json`. Both files are combined at exclusion-time so neither set is ever re-evaluated in the same run.

### Scope

**In Scope:**
- New `DiscardedRecord` type in `types.ts`
- Refactor `exclude-evaluated.ts`: new load/save functions for each file
- Update `pipeline.ts` to wire the split correctly
- Update `upload_preferences.sh` to clear only the discarded file
- Update architecture reference doc (`tech-spec-event-pipeline-architecture.md`)

**Out of Scope:**
- Migration of existing `data/events-evaluated.json` content (one-time re-evaluation on first deploy is acceptable)
- Changes to `digest-builder.ts`, `llm-match.ts`, or any event source
- UI or tooling to inspect discarded records beyond the raw S3 JSON

---

## Context for Development

### Codebase Patterns

- All relative imports use `.js` suffix (NodeNext `moduleResolution`).
- `console.log` with `[module-name]` prefix for every log line.
- S3 `NoSuchKey` errors are caught and treated as empty collections (graceful init) — replicate this for both new files.
- Pure functions (no S3 I/O) receive no mocks in tests.
- `strict` TypeScript — no implicit any, no implicit returns.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src/event-pipeline/exclude-evaluated.ts` | Module being refactored — all load/save logic lives here |
| `src/event-pipeline/pipeline.ts` | Orchestrator — wires load and save calls, computes discarded set |
| `src/event-pipeline/types.ts` | Add `DiscardedRecord` interface here |
| `src/event-pipeline/dedup.ts` | `computeDedupKey(event)` — needed in pipeline and save logic |
| `upload_preferences.sh` | Shell script to update — change which S3 key is cleared |

### Technical Decisions

**`DiscardedRecord` shape:**
```typescript
export interface DiscardedRecord {
  key: string;    // SHA-256 dedup key (same algo as dedup.ts)
  title: string;  // event.title
  date: string;   // event.date (ISO YYYY-MM-DD)
  venue: string;  // event.venue
}
```
The `key` field enables fast Set lookup during exclusion without re-hashing at load time.

**`events-sent.json` format:** remains `string[]` (array of dedup key strings) — matches existing format, no schema change needed.

**`events-discarded.json` format:** `DiscardedRecord[]` — richer objects for debugging; key field enables exclusion lookup.

**Computing discarded in `pipeline.ts`:** After `matchEvents()` returns, compute the Set of matched dedup keys using `computeDedupKey`. Any event in `newEvents` whose key is not in that Set is discarded. Import `computeDedupKey` from `./dedup.js` in `pipeline.ts`.

**Migration / first-deploy:** On first deploy, both new S3 files are absent. Both load functions return empty (graceful init). All events in `events-evaluated.json` (old file) are ignored — this is a one-time re-evaluation hit. The old file is never deleted; it simply stops being read.

**`upload_preferences.sh`:** Replace the block that clears `events-evaluated.json` with a block that clears only `events-discarded.json` (writes `[]`). The `events-sent.json` file is NOT touched.

---

## Implementation Plan

### Tasks

Tasks are ordered dependency-first (lowest-level first).

**Task 1 — Add `DiscardedRecord` to `types.ts`**
File: `src/event-pipeline/types.ts`
Action: Append the following interface after the existing `SourceError` interface:
```typescript
export interface DiscardedRecord {
  key: string;    // SHA-256 dedup key
  title: string;  // event.title
  date: string;   // event.date (ISO YYYY-MM-DD)
  venue: string;  // event.venue
}
```

---

**Task 2 — Refactor `exclude-evaluated.ts`**
File: `src/event-pipeline/exclude-evaluated.ts`
Action: Full file replacement. The complete new file content is the code block below, with `excludeEvaluatedEvents` (the pure filter function, lines 48–52 of the current file) appended after `saveDiscardedEvents` unchanged.

The new file replaces:
- `const EVALUATED_KEY` → two new constants (`SENT_KEY`, `DISCARDED_KEY`)
- `loadEvaluatedKeys()` → `loadSentKeys()` + `loadDiscardedRecords()`
- `saveEvaluatedKeys()` → `saveSentKeys()` + `saveDiscardedEvents()`

New file header and functions (paste this, then append the existing `excludeEvaluatedEvents` body):

```typescript
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
```

Keep `excludeEvaluatedEvents` exactly as-is.

---

**Task 3 — Update `pipeline.ts`**
File: `src/event-pipeline/pipeline.ts`

Change 1 — imports: replace the `exclude-evaluated` import line:
```typescript
// Before
import { loadEvaluatedKeys, excludeEvaluatedEvents, saveEvaluatedKeys } from './exclude-evaluated.js';
// After
import { loadSentKeys, loadDiscardedRecords, excludeEvaluatedEvents, saveSentKeys, saveDiscardedEvents } from './exclude-evaluated.js';
```

Change 2 — add `computeDedupKey` import:
```typescript
import { deduplicateEvents, computeDedupKey } from './dedup.js';
```

Change 3 — Step 4 in `runPipeline`: replace the two `loadEvaluatedKeys`/`excludeEvaluatedEvents` lines:
```typescript
// Before
const evaluatedKeys = await loadEvaluatedKeys(s3, bucketName);
const newEvents = excludeEvaluatedEvents(uniqueEvents, evaluatedKeys);

// After
const sentKeys = await loadSentKeys(s3, bucketName);
const discardedRecords = await loadDiscardedRecords(s3, bucketName);
const allEvaluatedKeys = new Set([...sentKeys, ...discardedRecords.map(r => r.key)]);
const newEvents = excludeEvaluatedEvents(uniqueEvents, allEvaluatedKeys);
```

Change 4 — Step 8 in `runPipeline`: replace `saveEvaluatedKeys`:
```typescript
// Before
await saveEvaluatedKeys(s3, bucketName, evaluatedKeys, newEvents);

// After
const matchedKeys = new Set(matchResult.matched.map(m => computeDedupKey(m.event)));
// Events in this run that the LLM rejected — persisted so they are excluded from future runs
// until upload_preferences.sh clears events-discarded.json.
const newlyDiscarded = newEvents.filter(e => !matchedKeys.has(computeDedupKey(e)));
await saveSentKeys(s3, bucketName, sentKeys, matchResult.matched.map(m => m.event));
await saveDiscardedEvents(s3, bucketName, discardedRecords, newlyDiscarded);
```

Update the comment on step 8:
```typescript
// 8. Persist results: sent events to events-sent.json, rejected events to events-discarded.json
```

---

**Task 4 — Update `upload_preferences.sh`**
File: `upload_preferences.sh`
Action: Replace the block that clears `events-evaluated.json` with a block that clears only `events-discarded.json`:

```bash
# Before
# Clear evaluated keys so all events are re-evaluated against the new preferences
EVALUATED_KEY="data/events-evaluated.json"
echo "Clearing s3://${BUCKET}/${EVALUATED_KEY}"
echo '[]' | aws s3 cp - "s3://${BUCKET}/${EVALUATED_KEY}" \
  --content-type application/json \
  --profile "$AWS_PROFILE"

# After
# Clear discarded events so they are re-evaluated against the new preferences.
# Sent events (events-sent.json) are intentionally preserved to avoid re-sending past digests.
DISCARDED_KEY="data/events-discarded.json"
echo "Clearing s3://${BUCKET}/${DISCARDED_KEY}"
echo '[]' | aws s3 cp - "s3://${BUCKET}/${DISCARDED_KEY}" \
  --content-type application/json \
  --profile "$AWS_PROFILE"
```

---

**Task 5 — Update architecture reference doc**
File: `_bmad-output/implementation-artifacts/tech-spec-event-pipeline-architecture.md`
Action: Update the S3 Layout table and the `events-evaluated.json` technical decision section:

In the **S3 Layout** table, replace:
```
| `data/events-evaluated.json` | Read + Write | Append-only dedup key log of all evaluated events |
```
With:
```
| `data/events-sent.json`      | Read + Write | Dedup keys of events included in a sent digest |
| `data/events-discarded.json` | Read + Write | Records of LLM-rejected events `{ key, title, date, venue }`; cleared on preference update |
```

In **Technical Decisions**, replace the `events-evaluated.json` section with:
```
### `events-sent.json` and `events-discarded.json`

Evaluated events are stored in two separate S3 files:
- `data/events-sent.json`: `string[]` of dedup keys — events included in at least one digest. Never cleared by `upload_preferences.sh`. Prevents re-sending past events.
- `data/events-discarded.json`: `DiscardedRecord[]` — LLM-rejected events stored with `{ key, title, date, venue }` for debugging. Cleared by `upload_preferences.sh` on preference update so newly-added artists/genres are re-evaluated. Both files are combined into a single exclusion Set at pipeline start. File absent → graceful empty init for both.
```

Update the Pipeline Flow step 8 description from:
```
8. Persist evaluated      saveEvaluatedKeys()       → merges existing + all evaluated keys back to S3
```
To:
```
8. Persist results        saveSentKeys()            → appends matched event keys to events-sent.json
                          saveDiscardedEvents()     → appends rejected event records to events-discarded.json
```

Update Module Map entry for `exclude-evaluated.ts`:
```
| `src/event-pipeline/exclude-evaluated.ts` | Loads/saves `data/events-sent.json` and `data/events-discarded.json`; filters already-evaluated events |
```

---

### Acceptance Criteria

**AC-1: Sent events are never re-sent after a preference update**
- Given: events A and B were matched and sent in a prior run (their keys are in `events-sent.json`)
- When: `upload_preferences.sh` runs (new preference uploaded)
- Then: `events-sent.json` is unchanged in S3; events A and B are excluded from the next pipeline run

**AC-2: Discarded events are re-evaluated after a preference update**
- Given: event C was discarded in a prior run (record in `events-discarded.json`)
- When: `upload_preferences.sh` runs
- Then: `events-discarded.json` is reset to `[]` in S3; event C is eligible for LLM evaluation on the next run

**AC-3: Discarded records contain debugging details**
- Given: event D (`title="Dvořák Symphony"`, `date="2026-04-15"`, `venue="Rudolfinum"`) is rejected by the LLM
- When: `saveDiscardedEvents` completes
- Then: `events-discarded.json` contains `{ key: "<sha256>", title: "Dvořák Symphony", date: "2026-04-15", venue: "Rudolfinum" }`

**AC-4: Both files contribute to exclusion**
- Given: event E key is in `events-sent.json` and event F key is in `events-discarded.json`
- When: `excludeEvaluatedEvents` runs with the combined key Set
- Then: neither E nor F appears in `newEvents`

**AC-5: Graceful init on absent files**
- Given: neither `events-sent.json` nor `events-discarded.json` exists in S3
- When: the pipeline runs
- Then: `loadSentKeys` returns empty Set; `loadDiscardedRecords` returns `[]`; pipeline completes without error

**AC-6: TypeScript compiles cleanly**
- Given: the changes above are applied
- When: `tsc --noEmit` runs
- Then: zero type errors

---

## Additional Context

### Dependencies

No new npm packages required. `computeDedupKey` is already exported from `dedup.ts` — just add it to the `pipeline.ts` import.

### Testing Strategy

Add `test/event-pipeline/exclude-evaluated.test.ts`. Tests needed:

| Test | Type | Mocks |
|------|------|-------|
| `loadSentKeys` — file exists, returns correct Set | Unit | Mock S3Client returns `'["key1","key2"]'` |
| `loadSentKeys` — `NoSuchKey`, returns empty Set | Unit | Mock S3Client throws `{ name: 'NoSuchKey' }` |
| `loadDiscardedRecords` — file exists, returns correct array | Unit | Mock S3Client returns valid JSON array |
| `loadDiscardedRecords` — `NoSuchKey`, returns `[]` | Unit | Mock S3Client throws `{ name: 'NoSuchKey' }` |
| `saveSentKeys` — merges and deduplicates | Unit | Capture PutObjectCommand body |
| `saveDiscardedEvents` — appends new records, deduplicates by key | Unit | Capture PutObjectCommand body |
| `saveDiscardedEvents` — record has correct `{ key, title, date, venue }` shape | Unit | Capture PutObjectCommand body |
| `excludeEvaluatedEvents` — combined Set excludes sent + discarded | Pure | None |

### Notes

- **First-deploy migration:** `events-evaluated.json` is not deleted and not read. On first deploy, all previously evaluated events will be re-evaluated (one-time acceptable re-evaluation hit). If re-sending previously matched events is not acceptable, a one-time migration script can pre-populate `events-sent.json` from `events-evaluated.json` — out of scope here.
- **Log prefix:** keep `[exclude-evaluated]` for all log lines in `exclude-evaluated.ts`.
- **`saveDiscardedEvents` dedup logic:** deduplication is by `key` (not full record equality) to avoid duplicate records if the same discarded event appears across multiple pipeline runs before a preference reset.
