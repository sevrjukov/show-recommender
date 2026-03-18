# show-recommender

Two-stack AWS CDK app (TypeScript).

- **RecommenderDataStack** — S3 bucket + one-time seed of `config/seed.json`
- **RecommenderAppStack** — `taste-expander` + `event-pipeline` Lambdas, EventBridge schedules, CloudWatch alarms → SNS

## Prerequisites

- Node.js 20 LTS
- AWS CLI configured (`aws configure` or `AWS_PROFILE`)
- CDK CLI: `npm install -g aws-cdk`

## Setup

```bash
npm install
```

## Useful commands

| Command | Description |
|---|---|
| `cdk synth` | Synthesize CloudFormation templates (no AWS needed) |
| `cdk diff` | Compare deployed stacks with local changes |
| `cdk deploy --all -c alertEmail=you@example.com` | Deploy both stacks |
| `cdk destroy --all` | Tear down compute stack (data stack is RETAIN) |
| `npx tsc --noEmit` | Type-check without compiling |

## First deploy

Bootstrap your account/region once (only needed the first time):

```bash
cdk bootstrap aws://ACCOUNT_ID/eu-central-1
```

Then deploy:

```bash
cdk deploy --all -c alertEmail=you@example.com
```

The `alertEmail` context value subscribes that address to the SNS error alert topic. You'll receive a confirmation email from AWS — click the link to activate it.

## Stack notes

- The S3 bucket is created with `RemovalPolicy.RETAIN` — `cdk destroy` will not delete it or its data.
- `config/seed.json` is seeded on **first deploy only**. Subsequent deploys never overwrite it.
- Lambda functions: Node.js 20, ARM64, 512 MB memory.
- Schedules: taste-expander runs 1st of each month at 08:00 UTC; event-pipeline runs every Monday at 07:00 UTC.
