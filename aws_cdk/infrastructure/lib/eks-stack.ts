import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { KubectlV29Layer } from '@aws-cdk/lambda-layer-kubectl-v29';

export class EksStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. VPC for EKS
    const vpc = new ec2.Vpc(this, 'EksVpc', {
      maxAzs: 3,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          mapPublicIpOnLaunch: true,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
      natGateways: 1, // Cost optimization for dev
    });

    // 2. EKS Cluster
    const cluster = new eks.Cluster(this, 'DevOpsCluster', {
      clusterName: 'devops-cluster',
      version: eks.KubernetesVersion.V1_29,
      kubectlLayer: new KubectlV29Layer(this, 'KubectlLayer'),
      defaultCapacity: 0, // We manage node groups explicitly
      vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
      endpointAccess: eks.EndpointAccess.PUBLIC_AND_PRIVATE,
    });

    // 3. Managed Node Group
    cluster.addNodegroupCapacity('StandardNodeGroup', {
      instanceTypes: [new ec2.InstanceType('t3.medium')],
      minSize: 2,
      maxSize: 4,
      desiredSize: 2,
      diskSize: 20,
      amiType: eks.NodegroupAmiType.AL2_X86_64,
    });

    // 4. Outputs
    new cdk.CfnOutput(this, 'ClusterEndpoint', {
      value: cluster.clusterEndpoint,
      description: 'The endpoint URL for the EKS cluster control plane',
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      description: 'The name of the EKS cluster',
    });

    new cdk.CfnOutput(this, 'ClusterSecurityGroupId', {
      value: cluster.clusterSecurityGroup.securityGroupId,
      description: 'Security Group ID for the EKS cluster',
    });

    new cdk.CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID where EKS is deployed',
    });

    // Output Private Subnets
    vpc.privateSubnets.forEach((subnet, index) => {
      new cdk.CfnOutput(this, `PrivateSubnet${index + 1}`, {
        value: subnet.subnetId,
        description: `Private Subnet ${index + 1} ID`,
      });
    });
  }
}
