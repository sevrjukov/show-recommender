import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

interface RecommenderAppStackProps extends cdk.StackProps {
  bucketName: string;
}

export class RecommenderAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RecommenderAppStackProps) {
    super(scope, id, props);

    const { bucketName } = props;

    // --- Lambda functions ---

    const eventPipelineFn = new NodejsFunction(this, 'EventPipelineFn', {
      functionName: 'event-pipeline',
      entry: path.join(__dirname, '../src/event-pipeline/index.ts'),
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: {
        BUCKET_NAME: bucketName,
        OPENAI_API_KEY: this.node.getContext('openaiKey'),
        SENDER_EMAIL: this.node.getContext('senderEmail'),
        RECIPIENT_EMAIL: this.node.getContext('recipientEmail'),
        OPENAI_MODEL: this.node.getContext('openaiModel'),
      },
    });

    // --- IAM: S3 object-level access ---

    eventPipelineFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject'],
      resources: [`arn:aws:s3:::${bucketName}/*`],
    }));

    eventPipelineFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:ListBucket'],
      resources: [`arn:aws:s3:::${bucketName}`],
    }));

    // --- EventBridge cron schedules ---

    new events.Rule(this, 'EventPipelineSchedule', {
      schedule: events.Schedule.expression('cron(0 7 ? * MON *)'), // weekly, Mondays 07:00 UTC
      targets: [new targets.LambdaFunction(eventPipelineFn, {
        retryAttempts: 2,
        maxEventAge: cdk.Duration.hours(2),
      })],
    });

    // --- CloudWatch alarms → SNS ---

    const alertTopic = new sns.Topic(this, 'AlertsTopic', {
      topicName: 'recommender-alerts',
    });

    const alertEmail = this.node.tryGetContext('alertEmail');
    if (alertEmail) {
      alertTopic.addSubscription(new snsSubscriptions.EmailSubscription(alertEmail));
    }

    const alarmAction = new cwActions.SnsAction(alertTopic);

    const eventPipelineAlarm = new cloudwatch.Alarm(this, 'EventPipelineErrorAlarm', {
      metric: eventPipelineFn.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'event-pipeline Lambda errors',
    });
    eventPipelineAlarm.addAlarmAction(alarmAction);
    eventPipelineAlarm.addOkAction(alarmAction);
  }
}
