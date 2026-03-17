---
title: 'CDK Project Initialization'
slug: 'cdk-init'
created: '2026-03-17'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['TypeScript', 'AWS CDK v2', 'Node.js 20 LTS', 'esbuild']
files_to_modify:
  - 'bin/app.ts'
  - 'lib/recommender-data-stack.ts'
  - 'lib/recommender-app-stack.ts'
  - 'src/taste-expander/index.ts'
  - 'src/event-pipeline/index.ts'
  - 'assets/seed.json'
  - 'package.json'
  - 'tsconfig.json'
  - 'cdk.json'
code_patterns:
  - 'CDK two-stack architecture (stateful/compute separation)'
  - 'NodejsFunction construct for TypeScript Lambdas with esbuild bundling'
  - 'AwsCustomResource (onCreate only) for idempotent S3 seed — never overwrites on redeploy'
  - 'EventBridge Schedule rules via aws-events-targets'
  - 'CloudWatch Metric Alarm → SNS topic → email subscription'
test_patterns: ['cdk synth (CloudFormation template output)', 'tsc --noEmit (TypeScript compile check)']
---

# Tech-Spec: CDK Project Initialization

**Created:** 2026-03-17

## Overview

### Problem Statement

The project has no infrastructure or code structure yet. Before any Lambda logic can be written, the AWS CDK project must be bootstrapped to define the two-stack architecture, establish the S3 data layer with a starter `seed.json`, and wire up placeholder Lambda handlers — giving all future development a concrete file structure and deployable skeleton to build on.

### Solution

Run `cdk init app --language=typescript` in the repo root, define `RecommenderDataStack` (S3 bucket + pre-populated `config/seed.json`) and `RecommenderAppStack` (two placeholder Lambda functions, EventBridge cron triggers, CloudWatch alarm → SNS), and add stub Lambda handler files so the stack compiles and deploys end-to-end.

### Scope

**In Scope:**
- CDK project init (`cdk init app --language=typescript`) in repo root
- `RecommenderDataStack`: S3 bucket (`show-recommender-data-{accountId}`), one-time S3 seed of `config/seed.json` via `AwsCustomResource` (onCreate only — never overwrites on redeploy)
- `RecommenderAppStack`: `taste-expander` Lambda + `event-pipeline` Lambda (Node.js 20, ARM64), EventBridge cron rules (monthly for taste-expander, weekly for event-pipeline), CloudWatch metric alarm on Lambda errors → SNS topic → email subscription placeholder, IAM policies granting Lambdas S3 read/write on the bucket
- Placeholder Lambda handler files: `src/taste-expander/index.ts` and `src/event-pipeline/index.ts`
- CDK app entry point: `bin/app.ts` instantiating both stacks

**Out of Scope:**
- Actual Lambda business logic (Claude API calls, Ticketmaster fetching, SES sending)
- SES domain/email verification (done manually)
- Ticketmaster or venue scraper integration
- `artists.json` / `events-raw.json` / `events-sent.json` pre-population (only `seed.json` seeded)

## Context for Development

### Codebase Patterns

- Greenfield project — no existing code. This spec establishes the canonical structure.
- All app source lives under `src/`, CDK infra under `lib/`, CDK entry point under `bin/`.
- Lambda handlers are TypeScript source files under `src/`. `NodejsFunction` uses esbuild internally to bundle them at synth time — no `dist/` or manual `tsc` compilation step needed for deployment.
- S3 data files are all JSON. Key layout: `config/seed.json`, `data/artists.json`, `data/events-raw.json`, `data/events-sent.json`.
- No database — S3 JSON only.
- Bucket name is constructed as `` `show-recommender-data-${cdk.Aws.ACCOUNT_ID}` `` (a CFN token that resolves at deploy time). Defined once as a `const bucketName` in `bin/app.ts` and passed as a prop to both stacks — no CDK cross-stack exports, no hardcoded string that risks collision.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `_bmad-output/brainstorming/brainstorming-session-2026-03-17-1400.md` | Full architecture and requirements decisions from brainstorming |
| `_bmad-output/planning-artifacts/ticketmaster-api-spike-2026-03-17.md` | Ticketmaster API spike results — confirms two-source architecture, useful query params |

### Technical Decisions

- **Two stacks, not one:** `RecommenderDataStack` holds stateful resources (S3); `RecommenderAppStack` holds compute. Keeps data safe from accidental Lambda stack teardown.
- **Bucket name pattern:** `` `show-recommender-data-${cdk.Aws.ACCOUNT_ID}` `` — account-scoped to avoid global S3 name collision. Defined as a `const bucketName` in `bin/app.ts`, passed as a prop (`bucketName: string`) to both stacks. No CDK cross-stack exports.
- **ARM64 Lambdas:** Cheaper and faster for Node.js workloads on AWS.
- **Node.js 20 LTS runtime** for both Lambdas.
- **`AwsCustomResource` (onCreate only)** from `aws-cdk-lib/custom-resources` used to seed `config/seed.json` on first deploy. No `onUpdate` — so subsequent `cdk deploy` runs never overwrite live data in the bucket. `BucketDeployment` is explicitly NOT used here because it overwrites on every deploy.
- **CloudWatch alarm** watches `Errors` metric on both Lambda functions → SNS topic → email subscription (email address stored as CDK context variable `alertEmail`).
- **EventBridge cron schedules:** taste-expander = first day of each month at 08:00 UTC; event-pipeline = every Monday at 07:00 UTC.
- **IAM:** Each Lambda gets its own role. Both roles get `s3:GetObject` + `s3:PutObject` on `arn:aws:s3:::${bucketName}/*` (object-level actions). taste-expander additionally gets `s3:ListBucket` on `arn:aws:s3:::${bucketName}` (bucket-level — no `/*`). These are two separate policy statements with different resource ARNs.
- **Stack env:** Both stacks receive `env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'eu-central-1' }`. The explicit `account` is required for `NodejsFunction` asset bundling to work correctly.

## Implementation Plan

### Tasks

1. **`package.json` + CDK init**
   - File: `package.json` (repo root, created by CDK init)
   - Run: `cdk init app --language=typescript` in repo root
   - Verify generated files: `bin/app.ts`, `lib/`, `cdk.json`, `tsconfig.json`

2. **Add esbuild dev dependency**
   - File: `package.json`
   - Note: `cdk init` already adds `aws-cdk-lib`, `constructs`, `aws-cdk`, `ts-node`. Only `esbuild` needs to be added manually as it is a peer dep required by `NodejsFunction`.
   - Run: `npm install --save-dev esbuild`

3. **Create `seed.json` asset**
   - File: `assets/seed.json` (new)
   - Content:
     ```json
     {
       "artists": [],
       "composers": [],
       "genres": []
     }
     ```

4. **Define `RecommenderDataStack`**
   - File: `lib/recommender-data-stack.ts` (new)
   - Accept `bucketName: string` as a stack prop
   - Create S3 bucket with `bucketName` prop, versioning enabled, `RemovalPolicy.RETAIN`
   - Seed `config/seed.json` using `AwsCustomResource` (from `aws-cdk-lib/custom-resources`) with **only `onCreate`** — no `onUpdate`:
     ```typescript
     new AwsCustomResource(this, 'SeedSeedJson', {
       onCreate: {
         service: 'S3',
         action: 'putObject',
         parameters: {
           Bucket: bucketName,
           Key: 'config/seed.json',
           Body: JSON.stringify({ artists: [], composers: [], genres: [] }),
           ContentType: 'application/json',
         },
         physicalResourceId: PhysicalResourceId.of('seed-seed-json'),
       },
       policy: AwsCustomResourcePolicy.fromSdkCalls({
         resources: [`arn:aws:s3:::${bucketName}/config/seed.json`],
       }),
     });
     ```
   - **Do NOT use `BucketDeployment`** — it overwrites on every `cdk deploy`, which would destroy live edits to `seed.json`

5. **Define placeholder Lambda handlers**
   - File: `src/taste-expander/index.ts` (new)
     ```typescript
     export const handler = async (): Promise<void> => {
       console.log('taste-expander: not yet implemented');
     };
     ```
   - File: `src/event-pipeline/index.ts` (new)
     ```typescript
     export const handler = async (): Promise<void> => {
       console.log('event-pipeline: not yet implemented');
     };
     ```

6. **Define `RecommenderAppStack`**
   - File: `lib/recommender-app-stack.ts` (new)
   - Accept `bucketName: string` as a stack prop
   - Create `tasteExpanderFn`: `NodejsFunction` pointing at `src/taste-expander/index.ts`, runtime Node.js 20, ARM64
   - Create `eventPipelineFn`: `NodejsFunction` pointing at `src/event-pipeline/index.ts`, runtime Node.js 20, ARM64
   - IAM grants — two separate `addToRolePolicy` statements per function:
     - Object-level: `s3:GetObject`, `s3:PutObject` → resource `arn:aws:s3:::${bucketName}/*`
     - Bucket-level (taste-expander only): `s3:ListBucket` → resource `arn:aws:s3:::${bucketName}` (no `/*`)
   - Add env var `BUCKET_NAME` set to `bucketName` prop on both functions
   - Create EventBridge rule: taste-expander cron `cron(0 8 1 * ? *)` (monthly)
   - Create EventBridge rule: event-pipeline cron `cron(0 7 ? * MON *)` (weekly, Mondays)
   - Create SNS topic `recommender-alerts`
   - Create CloudWatch alarm on `tasteExpanderFn` errors (threshold ≥ 1, period 5 min) → SNS
   - Create CloudWatch alarm on `eventPipelineFn` errors (threshold ≥ 1, period 5 min) → SNS
   - Add SNS email subscription using CDK context key `alertEmail` (e.g. `cdk deploy -c alertEmail=you@example.com`)

7. **Wire up `bin/app.ts`**
   - File: `bin/app.ts`
   - Define bucket name: `` const bucketName = `show-recommender-data-${cdk.Aws.ACCOUNT_ID}`; ``
   - Instantiate `RecommenderDataStack` and `RecommenderAppStack`, passing `bucketName` as a prop to both
   - Pass `env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'eu-central-1' }` to both stacks
   - Note: `CDK_DEFAULT_ACCOUNT` is populated automatically when running with `aws configure` or a valid AWS profile — no manual export needed

8. **Update `tsconfig.json`**
   - File: `tsconfig.json`
   - Ensure `src/**` is included so `tsc --noEmit` type-checks the Lambda handlers
   - Remove or leave `outDir` — esbuild handles Lambda bundling; `tsc` is only used for type-checking here

9. **Verify synth**
   - Run: `cdk synth`
   - Expected: no errors, CloudFormation templates output for both stacks

### Acceptance Criteria

**AC1 — CDK synth succeeds**
- Given: all files are in place and `npm install` has been run
- When: `cdk synth` is executed
- Then: CloudFormation templates for `RecommenderDataStack` and `RecommenderAppStack` are emitted with no errors or warnings

**AC2 — S3 bucket defined in DataStack**
- Given: `RecommenderDataStack` is synthesized
- When: the CloudFormation template is inspected
- Then: an S3 bucket resource named `show-recommender-data` is present with versioning enabled and `DeletionPolicy: Retain`

**AC3 — `seed.json` seeded via AwsCustomResource (onCreate only)**
- Given: `RecommenderDataStack` is synthesized
- When: the CloudFormation template in `cdk.out/` is inspected
- Then: a `Custom::AWS` resource exists with `onCreate` containing an S3 `putObject` call targeting `config/seed.json`, and no `onUpdate` property is present (confirming it will not overwrite on redeploy)

**AC4 — Both Lambda functions defined in AppStack**
- Given: `RecommenderAppStack` is synthesized
- When: the template is inspected
- Then: two Lambda functions exist (`taste-expander`, `event-pipeline`), both with Node.js 20 runtime and ARM64 architecture

**AC5 — EventBridge cron rules attached**
- Given: `RecommenderAppStack` is synthesized
- When: the template is inspected
- Then: two EventBridge rules exist — one with `cron(0 8 1 * ? *)` targeting taste-expander, one with `cron(0 7 ? * MON *)` targeting event-pipeline

**AC6 — CloudWatch alarms wired to SNS**
- Given: `RecommenderAppStack` is synthesized
- When: the template is inspected
- Then: two CloudWatch alarms exist (one per Lambda, on the `Errors` metric), both with `AlarmActions` pointing at the `recommender-alerts` SNS topic

**AC7 — Lambda handlers compile**
- Given: `src/taste-expander/index.ts` and `src/event-pipeline/index.ts` exist
- When: `tsc --noEmit` is run
- Then: no TypeScript errors

## Additional Context

### Dependencies

- `aws-cdk-lib` ^2.x — installed by `cdk init`
- `constructs` ^10.x — installed by `cdk init`
- `esbuild` — install manually as dev dep (peer dep required by `NodejsFunction`)
- Node.js 20 LTS local environment

### Testing Strategy

No unit tests in this spec — the `cdk synth` and `tsc --noEmit` checks in the ACs serve as the verification gate. CDK snapshot tests can be added in a future spec once the stack stabilises.

### Notes

- `cdk bootstrap aws://ACCOUNT_ID/eu-central-1` must be run once before first `cdk deploy`. `cdk synth` does NOT require bootstrap — it generates templates and asset manifests locally without staging to S3. Bootstrap is only needed for `cdk deploy`.
- `CDK_DEFAULT_ACCOUNT` is set automatically by the CDK CLI when a valid AWS profile is configured (`aws configure` or `AWS_PROFILE`). No manual export is needed in normal dev workflows.
- SES sender/recipient email addresses will be added as environment variables on the Lambda functions in a later spec (when SES is manually verified and email sending is implemented).
- The `alertEmail` CDK context value must be passed at deploy time: `cdk deploy -c alertEmail=your@email.com`. Document this in a `README.md` (out of scope here, can be added alongside first real deploy).
