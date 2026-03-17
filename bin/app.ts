#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { RecommenderDataStack } from '../lib/recommender-data-stack';
import { RecommenderAppStack } from '../lib/recommender-app-stack';

const app = new cdk.App();

const bucketName = `show-recommender-data-${cdk.Aws.ACCOUNT_ID}`;

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'eu-central-1',
};

new RecommenderDataStack(app, 'RecommenderDataStack', { bucketName, env });
new RecommenderAppStack(app, 'RecommenderAppStack', { bucketName, env });
