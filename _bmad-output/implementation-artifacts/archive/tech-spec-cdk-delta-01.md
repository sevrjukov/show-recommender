---
title: 'CDK Delta 01 — Single Lambda + user-preferences rename'
slug: 'cdk-delta-01'
created: '2026-03-18'
status: 'ready'
parent_spec: 'tech-spec-cdk-init.md'
tech_stack: ['TypeScript', 'AWS CDK v2']
files_to_modify:
  - 'lib/recommender-app-stack.ts'
  - 'lib/recommender-data-stack.ts'
files_to_delete:
  - 'src/taste-expander/index.ts'
---

# Tech-Spec: CDK Delta 01 — Single Lambda + user-preferences rename

**Created:** 2026-03-18
**Parent spec:** `tech-spec-cdk-init.md` (already implemented)

## Overview

### Problem Statement

The brainstorming document was updated after the CDK spec was implemented. Two architecture decisions changed:

1. **One Lambda, not two** — `taste-expander` is removed. The "consider adding" suggestions are handled inline by the single `event-pipeline` Lambda. There is no separate taste-expansion workflow.
2. **Seed file renamed** — S3 key `config/seed.json` is now `config/user-preferences.json` to match the canonical name used throughout the architecture (`user-preferences.json`).

### Solution

Three surgical changes to the already-deployed CDK code:

1. Remove all `taste-expander` infrastructure from `RecommenderAppStack` (Lambda, EventBridge rule, CloudWatch alarm, IAM policy statements).
2. Update `RecommenderDataStack` to seed `config/user-preferences.json` instead of `config/seed.json`.
3. Delete the placeholder handler `src/taste-expander/index.ts`.

`src/event-pipeline/index.ts` is unchanged.

### Scope

**In Scope:**
- Remove `tasteExpanderFn` (`NodejsFunction`) from `RecommenderAppStack`
- Remove `TasteExpanderSchedule` EventBridge rule
- Remove `TasteExpanderErrorAlarm` CloudWatch alarm and its SNS actions
- Remove IAM policy statements that were specific to `tasteExpanderFn` (the `s3:ListBucket` statement)
- Remove the shared `s3ObjectPolicy` add on `tasteExpanderFn`
- Update `RecommenderDataStack` seed: change `Key` from `config/seed.json` → `config/user-preferences.json`, update `physicalResourceId` and IAM resource ARN to match
- Delete `src/taste-expander/index.ts`

**Out of Scope:**
- Any changes to `event-pipeline` Lambda behaviour or handler
- Adding `s3:ListBucket` to `event-pipeline` (not needed — all S3 reads are by explicit key)
- `user-preferences.json` content (schema stays the same: `{ artists: [], composers: [], genres: [] }`)
- CloudFormation resource replacement of the seed CustomResource (see Notes)

## Implementation Plan

### Task 1 — Update `lib/recommender-app-stack.ts`

Remove everything related to `tasteExpanderFn`. The file after the change should contain only:

- `eventPipelineFn` (`NodejsFunction`)
- `s3ObjectPolicy` applied to `eventPipelineFn` only (GetObject + PutObject on `bucketName/*`)
- `EventPipelineSchedule` EventBridge rule
- `alertTopic` SNS topic + optional email subscription
- `EventPipelineErrorAlarm` CloudWatch alarm

**Lines to remove:**
- `tasteExpanderFn` construct (lines 26–33)
- `tasteExpanderFn.addToRolePolicy(s3ObjectPolicy)` (line 51)
- The `s3:ListBucket` policy statement and `tasteExpanderFn.addToRolePolicy(...)` for it (lines 55–58)
- `TasteExpanderSchedule` EventBridge rule (lines 62–68)
- `tasteExpanderAlarm` CloudWatch alarm + its `addAlarmAction` / `addOkAction` calls (lines 91–99)

**Result:** `eventPipelineFn` retains `s3:GetObject` + `s3:PutObject`. No `s3:ListBucket` needed.

### Task 2 — Update `lib/recommender-data-stack.ts`

Change three strings inside the `AwsCustomResource` `onCreate` block:

| Field | Old value | New value |
|---|---|---|
| `Key` | `'config/seed.json'` | `'config/user-preferences.json'` |
| `physicalResourceId` | `'seed-seed-json'` | `'seed-user-preferences-json'` |
| IAM `resources` | `.../${bucketName}/config/seed.json` | `.../${bucketName}/config/user-preferences.json` |

Also update the comment on line 23 from `// Seed config/seed.json` → `// Seed config/user-preferences.json`.

> **Note on CloudFormation behaviour:** Changing `physicalResourceId` causes CloudFormation to treat this as a new resource and re-run `onCreate`. This is intentional — the new key (`config/user-preferences.json`) will be created in S3 on next `cdk deploy`. The old `config/seed.json` key in S3 is NOT deleted by CDK (no `onDelete` defined). If already deployed, manually delete `config/seed.json` from the bucket after the next deploy to avoid confusion.

### Task 3 — Delete `src/taste-expander/index.ts`

Delete the file. No other file imports it — `NodejsFunction` references it only via the path string in `recommender-app-stack.ts`, which is being removed in Task 1.

### Verification

```bash
cdk synth          # must succeed — no errors or warnings
tsc --noEmit       # must succeed — no TypeScript errors
```

After synth, confirm in `cdk.out/`:
- `RecommenderAppStack` template has **one** Lambda function (`event-pipeline`), **one** EventBridge rule, **one** CloudWatch alarm.
- `RecommenderDataStack` template `Custom::AWS` resource has `Key: config/user-preferences.json` and no `onUpdate`.

## Acceptance Criteria

**AC1 — Synth succeeds**
- `cdk synth` produces templates for both stacks with no errors.

**AC2 — taste-expander gone from AppStack**
- `RecommenderAppStack` CloudFormation template contains exactly one Lambda function resource, one EventBridge rule, and one CloudWatch alarm. No reference to `taste-expander`.

**AC3 — user-preferences seeded in DataStack**
- `RecommenderDataStack` CloudFormation template `Custom::AWS` resource has `Key` = `config/user-preferences.json` and no `onUpdate` property.

**AC4 — taste-expander handler deleted**
- `src/taste-expander/index.ts` does not exist.

**AC5 — TypeScript compiles**
- `tsc --noEmit` exits 0.

## Notes

- The shared `s3ObjectPolicy` variable in `recommender-app-stack.ts` (lines 46–49) can stay — it's still used by `eventPipelineFn`. Only the two `addToRolePolicy` calls referencing `tasteExpanderFn` need to be removed.
- No changes to `bin/app.ts` — both stacks are still instantiated there and the bucket name prop pattern is unchanged.
- No changes to `tsconfig.json`, `cdk.json`, or `package.json`.
