#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CdkStack } from '../lib/cdk-stack';
import { EksStack } from '../lib/eks-stack';

const app = new cdk.App();

// Legacy Serverless Stack (Optional)
// new CdkStack(app, 'CdkStack', {
//   env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
// });

// New EKS Infrastructure Stack
new EksStack(app, 'EksStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
