import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface RecommenderDataStackProps extends cdk.StackProps {
  bucketName: string;
}

export class RecommenderDataStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: RecommenderDataStackProps) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: props.bucketName,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Seed config/user-preferences.json on first deploy only — onCreate, no onUpdate,
    // so subsequent deploys never overwrite live data.
    const seedResource = new AwsCustomResource(this, 'SeedSeedJson', {
      onCreate: {
        service: 'S3',
        action: 'putObject',
        parameters: {
          Bucket: props.bucketName,
          Key: 'config/user-preferences.json',
          Body: JSON.stringify({ artists: [], composers: [], genres: [] }),
          ContentType: 'application/json',
        },
        physicalResourceId: PhysicalResourceId.of('seed-user-preferences-json'),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [`arn:aws:s3:::${props.bucketName}/config/user-preferences.json`],
      }),
    });
    seedResource.node.addDependency(this.bucket);
  }
}
