const { hash } = require("../lib/ami-hash");
const packageInfo = require("../package.json");
const { ArgumentStore } = require("../lib/argument-store");
const { AwsSemaphoreAgentStack } = require("../lib/aws-semaphore-agent-stack");
const { App } = require("aws-cdk-lib");
const { ParameterTier } = require("aws-cdk-lib/aws-ssm");
const { Template, Match } = require("aws-cdk-lib/assertions");

describe("SSM parameter", () => {
  test("name is prefixed with stack name", () => {
    const template = createTemplate(basicArgumentStore());
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Type: "String",
      Name: "test-stack-config",
      Description: "Parameters required by the semaphore agent",
      Tier: ParameterTier.STANDARD
    });
  })

  test("default values are used", () => {
    const template = createTemplate(basicArgumentStore());
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Value: JSON.stringify({
        endpoint: "test.semaphoreci.com",
        agentTokenParameterName: "test-token",
        disconnectAfterJob: "true",
        disconnectAfterIdleTimeout: "300",
        envVars: []
      })
    });
  })

  test("sets endpoint directly", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_ENDPOINT", "someother.endpoint")

    const template = createTemplate(argumentStore);
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Value: JSON.stringify({
        endpoint: "someother.endpoint",
        agentTokenParameterName: "test-token",
        disconnectAfterJob: "true",
        disconnectAfterIdleTimeout: "300",
        envVars: []
      })
    });
  });

  test("disconnect-after-job and disconnect-after-idle-timeout can be set", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_DISCONNECT_AFTER_JOB", "false");
    argumentStore.set("SEMAPHORE_AGENT_DISCONNECT_AFTER_IDLE_TIMEOUT", "120");

    const template = createTemplate(argumentStore);
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Value: JSON.stringify({
        endpoint: "test.semaphoreci.com",
        agentTokenParameterName: "test-token",
        disconnectAfterJob: "false",
        disconnectAfterIdleTimeout: "120",
        envVars: []
      })
    });
  });

  test("sets env vars, if using s3 bucket for caching", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_CACHE_BUCKET_NAME", "test-cache-bucket")

    const template = createTemplate(argumentStore);
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Value: JSON.stringify({
        endpoint: "test.semaphoreci.com",
        agentTokenParameterName: "test-token",
        disconnectAfterJob: "true",
        disconnectAfterIdleTimeout: "300",
        envVars: ["SEMAPHORE_CACHE_BACKEND=s3", "SEMAPHORE_CACHE_S3_BUCKET=test-cache-bucket"]
      })
    });
  });
})

describe("instance profile", () => {
  test("ec2 can assume role", () => {
    const template = createTemplate(basicArgumentStore());
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
              Service: "ec2.amazonaws.com"
            }
          }
        ],
        Version: Match.anyValue()
      }
    });
  })

  test("permissions to access cache bucket are not included, if bucket is not specified", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_TOKEN_KMS_KEY", "dummy-kms-key-id");

    const template = createTemplate(argumentStore);
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyName: "test-stack-instance-profile-policy",
      PolicyDocument: {
        Statement: [
          {
            Action: [
              "autoscaling:SetInstanceHealth",
              "autoscaling:TerminateInstanceInAutoScalingGroup"
            ],
            Effect: "Allow",
            Resource: "arn:aws:autoscaling:*:dummyaccount:autoScalingGroup:*:autoScalingGroupName/test-stack-autoScalingGroup-*"
          },
          {
            Action: "ssm:GetParameter",
            Effect: "Allow",
            Resource: [
              "arn:aws:ssm:*:*:parameter/test-stack-config",
              "arn:aws:ssm:*:*:parameter/test-token"
            ]
          },
          {
            Action: "kms:Decrypt",
            Effect: "Allow",
            Resource: "arn:aws:kms:*:*:key/dummy-kms-key-id"
          },
          {
            Action: [
              "logs:CreateLogGroup",
              "logs:PutRetentionPolicy",
              "logs:DeleteLogGroup"
            ],
            Effect: "Allow",
            Resource: "arn:aws:logs:*:*:log-group:/semaphore/*"
          }
        ],
        Version: Match.anyValue()
      },
      Roles: Match.anyValue(),
    });
  })

  test("permissions to access cache bucket are included, if bucket is specified", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_TOKEN_KMS_KEY", "dummy-kms-key-id");
    argumentStore.set("SEMAPHORE_AGENT_CACHE_BUCKET_NAME", "test-cache-bucket");

    const template = createTemplate(argumentStore);
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyName: "test-stack-instance-profile-policy",
      PolicyDocument: {
        Statement: [
          {
            Action: [
              "autoscaling:SetInstanceHealth",
              "autoscaling:TerminateInstanceInAutoScalingGroup"
            ],
            Effect: "Allow",
            Resource: "arn:aws:autoscaling:*:dummyaccount:autoScalingGroup:*:autoScalingGroupName/test-stack-autoScalingGroup-*"
          },
          {
            Action: "ssm:GetParameter",
            Effect: "Allow",
            Resource: [
              "arn:aws:ssm:*:*:parameter/test-stack-config",
              "arn:aws:ssm:*:*:parameter/test-token"
            ]
          },
          {
            Action: "kms:Decrypt",
            Effect: "Allow",
            Resource: "arn:aws:kms:*:*:key/dummy-kms-key-id"
          },
          {
            Action: [
              "logs:CreateLogGroup",
              "logs:PutRetentionPolicy",
              "logs:DeleteLogGroup"
            ],
            Effect: "Allow",
            Resource: "arn:aws:logs:*:*:log-group:/semaphore/*"
          },
          {
            Action: [
              "s3:PutObject",
              "s3:GetObject",
              "s3:ListBucket",
              "s3:DeleteObject"
            ],
            Effect: "Allow",
            Resource: [
              "arn:aws:s3:::test-cache-bucket/*",
              `arn:aws:s3:::test-cache-bucket`
            ]
          }
        ],
        Version: Match.anyValue()
      },
      Roles: Match.anyValue(),
    });
  })
})

describe("launch configuration", () => {
  test("uses default linux AMI", () => {
    const template = createTemplate(basicArgumentStore());
    template.hasResourceProperties("AWS::AutoScaling::LaunchConfiguration", {
      ImageId: "default-ubuntu-focal-ami-id"
    });
  })

  test("uses default windows AMI", () => {
    const argumentStore = basicArgumentStore()
    argumentStore.set("SEMAPHORE_AGENT_OS", "windows");

    const template = createTemplateWithOS(argumentStore, "windows");
    template.hasResourceProperties("AWS::AutoScaling::LaunchConfiguration", {
      ImageId: "default-windows-ami-id"
    });
  })

  test("uses specified AMI", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_AMI", "ami-custom")

    const template = createTemplate(argumentStore);
    template.hasResourceProperties("AWS::AutoScaling::LaunchConfiguration", {
      ImageId: "ami-custom"
    });
  })

  test("uses t2.micro as default", () => {
    const template = createTemplate(basicArgumentStore());
    template.hasResourceProperties("AWS::AutoScaling::LaunchConfiguration", {
      InstanceType: "t2.micro"
    });
  })

  test("uses specified instance type", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_INSTANCE_TYPE", "t2.medium");

    const template = createTemplate(argumentStore);
    template.hasResourceProperties("AWS::AutoScaling::LaunchConfiguration", {
      InstanceType: "t2.medium"
    })
  })

  test("agent is started using user data for linux", () => {
    const template = createTemplate(basicArgumentStore());
    template.hasResourceProperties("AWS::AutoScaling::LaunchConfiguration", {
      UserData: {
        "Fn::Base64": "#!/bin/bash\n/opt/semaphore/agent/start.sh test-stack-config"
      }
    })
  })

  test("agent is started using user data for windows", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_OS", "windows");

    const template = createTemplateWithOS(argumentStore, "windows");
    template.hasResourceProperties("AWS::AutoScaling::LaunchConfiguration", {
      UserData: {
        "Fn::Base64": "<powershell>C:\\semaphore-agent\\start.ps1 test-stack-config</powershell>"
      }
    })
  })
})

describe("security group", () => {
  test("creates security group with no ssh access, if no key is given", () => {
    const template = createTemplate(basicArgumentStore());
    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      SecurityGroupEgress: [
        {
          CidrIp: "0.0.0.0/0",
          Description: "Allow all outbound traffic by default",
          IpProtocol: "-1"
        }
      ],
      SecurityGroupIngress: Match.absent()
    });

    template.hasResourceProperties("AWS::AutoScaling::LaunchConfiguration", {
      SecurityGroups: [
        {
          "Fn::GetAtt": [Match.anyValue(), "GroupId"]
        }
      ]
    });
  })

  test("creates security group with ssh access, if key is given", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_KEY_NAME", "test-key");

    const template = createTemplate(argumentStore);
    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      SecurityGroupEgress: [
        {
          CidrIp: "0.0.0.0/0",
          Description: "Allow all outbound traffic by default",
          IpProtocol: "-1"
        }
      ],
      SecurityGroupIngress: [
        {
          CidrIp: "0.0.0.0/0",
          Description: "allow ssh access from anywhere",
          FromPort: 22,
          IpProtocol: "tcp",
          ToPort: 22
        }
      ]
    });

    template.hasResourceProperties("AWS::AutoScaling::LaunchConfiguration", {
      SecurityGroups: [
        {
          "Fn::GetAtt": [Match.anyValue(), "GroupId"]
        }
      ]
    });
  })

  test("uses specified security group", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_SECURITY_GROUP_ID", "dummy-sg");

    const template = createTemplate(argumentStore);
    template.resourceCountIs("AWS::EC2::SecurityGroup", 0);
    template.hasResourceProperties("AWS::AutoScaling::LaunchConfiguration", {
      SecurityGroups: ["dummy-sg"]
    });
  })
})

describe("auto scaling group", () => {
  test("default values are set if nothing is given", () => {
    const template = createTemplate(basicArgumentStore());
    template.hasResourceProperties("AWS::AutoScaling::AutoScalingGroup", {
      DesiredCapacity: "1",
      MinSize: "0",
      MaxSize: "1"
    });
  })

  test("desired, min and max can be specified", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_ASG_MIN_SIZE", "1");
    argumentStore.set("SEMAPHORE_AGENT_ASG_MAX_SIZE", "5");
    argumentStore.set("SEMAPHORE_AGENT_ASG_DESIRED", "3");

    const template = createTemplate(argumentStore);
    template.hasResourceProperties("AWS::AutoScaling::AutoScalingGroup", {
      DesiredCapacity: "3",
      MinSize: "1",
      MaxSize: "5"
    });
  })

  test("tags are used", () => {
    const template = createTemplate(basicArgumentStore());
    template.hasResourceProperties("AWS::AutoScaling::AutoScalingGroup", {
      Tags: [
        {
          "Key": "application",
          "PropagateAtLaunch": true,
          "Value": "semaphore-agent"
        }
      ]
    });
  })

  test("AZRebalance process is suspended", () => {
    const template = createTemplate(basicArgumentStore());

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyName: "test-stack-az-rebalance-suspender-policy",
      PolicyDocument: {
        Statement: [
          {
            Action: "autoscaling:SuspendProcesses",
            Effect: "Allow",
            Resource: "arn:aws:autoscaling:*:dummyaccount:autoScalingGroup:*:autoScalingGroupName/test-stack-autoScalingGroup-*"
          }
        ],
        Version: Match.anyValue()
      },
      Roles: Match.anyValue()
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
              Service: "lambda.amazonaws.com"
            }
          }
        ],
        Version: Match.anyValue()
      }
    });

    template.hasResourceProperties("AWS::Lambda::Function", {
      Description: "Suspend AZRebalance process for auto scaling group",
      Runtime: "nodejs14.x",
      Code: Match.anyValue(),
      Handler: "app.handler",
      Role: Match.anyValue()
    });

    template.resourceCountIs("AWS::CloudFormation::CustomResource", 1);
  })
})

describe("scaler lambda", () => {
  test("all needed properties are set", () => {
    const template = createTemplate(basicArgumentStore());
    template.hasResourceProperties("AWS::Lambda::Function", {
      Description: "Dynamically scale Semaphore agents based on jobs demand",
      Runtime: "nodejs14.x",
      Timeout: 60,
      Code: Match.anyValue(),
      Handler: "app.handler",
      Environment: {
        Variables: {
          SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME: "test-token",
          SEMAPHORE_AGENT_STACK_NAME: "test-stack"
        }
      },
      Role: Match.anyValue()
    });
  })

  test("rule to schedule lambda execution is created", () => {
    const template = createTemplate(basicArgumentStore());
    template.hasResourceProperties("AWS::Events::Rule", {
      Description: "Rule to dynamically invoke lambda function to scale Semaphore agent asg",
      ScheduleExpression: "rate(1 minute)",
      State: "ENABLED",
      Targets: Match.anyValue()
    });
  })

  test("proper permissions created", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_TOKEN_KMS_KEY", "dummy-kms-key-id");

    const template = createTemplate(argumentStore);
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyName: "test-stack-scaler-lambda-policy",
      PolicyDocument: {
        Statement: [
          {
            Action: "autoscaling:DescribeAutoScalingGroups",
            Effect: "Allow",
            Resource: "*"
          },
          {
            Action: "autoscaling:SetDesiredCapacity",
            Effect: "Allow",
            Resource: "arn:aws:autoscaling:*:dummyaccount:autoScalingGroup:*:autoScalingGroupName/test-stack-autoScalingGroup-*"
          },
          {
            Action: "ssm:GetParameter",
            Effect: "Allow",
            Resource: "arn:aws:ssm:*:*:parameter/test-token"
          },
          {
            Action: "kms:Decrypt",
            Effect: "Allow",
            Resource: "arn:aws:kms:*:*:key/dummy-kms-key-id"
          }
        ],
        Version: Match.anyValue()
      },
      Roles: Match.anyValue(),
    });
  })

  test("it can be disabled", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_USE_DYNAMIC_SCALING", "false");

    const template = createTemplate(argumentStore);
    const resources = template.findResources("AWS::Lambda::Function", {
      Description: "Dynamically scale Semaphore agents based on jobs demand"
    });

    expect(resources).toEqual({});
  })
})

describe("vpc and subnets", () => {
  test("uses default vpc if none is given", () => {
    const template = createTemplate(basicArgumentStore());
    template.hasResourceProperties("AWS::AutoScaling::AutoScalingGroup", {
      VPCZoneIdentifier: Match.absent(),
      AvailabilityZones: Match.anyValue(),
    });

    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      VpcId: "vpc-00000-default"
    });
  })

  test("uses vpc and subnets if specified", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_VPC_ID", "vpc-000000000-custom");
    argumentStore.set("SEMAPHORE_AGENT_SUBNETS", "subnet-00001,subnet-00002,subnet-00003");

    const template = createTemplate(argumentStore);
    template.hasResourceProperties("AWS::AutoScaling::AutoScalingGroup", {
      VPCZoneIdentifier: ["subnet-00001", "subnet-00002", "subnet-00003"],
      AvailabilityZones: Match.absent(),
    });

    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      VpcId: "vpc-000000000-custom"
    });
  })
})

function createTemplate(argumentStore) {
  return createTemplateWithOS(argumentStore, "ubuntu-focal");
}

function createTemplateWithOS(argumentStore, os) {
  const account = "dummyaccount";
  const region = "us-east-1";
  const customVpcId = "vpc-000000000-custom";
  const defaultAmiName = `semaphore-agent-v${packageInfo.version}-${os}-x86_64-${hash(os)}`;
  const amiLookupContextKey = `ami:account=${account}:filters.image-type.0=machine:filters.name.0=${defaultAmiName}:filters.state.0=available:owners.0=${account}:region=${region}`;
  const defaultVpcContextKey = `vpc-provider:account=${account}:filter.isDefault=true:region=${region}:returnAsymmetricSubnets=true`
  const customVpcContextKey = `vpc-provider:account=${account}:filter.vpc-id=${customVpcId}:region=${region}:returnAsymmetricSubnets=true`

  const app = new App({
    context: {
      [amiLookupContextKey]: `default-${os}-ami-id`,
      [defaultVpcContextKey]: {
        "vpcId": "vpc-00000-default",
        "vpcCidrBlock": "172.31.0.0/16",
        "availabilityZones": [],
        "subnetGroups": [
          {
            "name": "Public",
            "type": "Public",
            "subnets": [
              {
                "subnetId": "subnet-dummy-1",
                "cidr": "172.31.32.0/20",
                "availabilityZone": "us-east-1a",
                "routeTableId": "rtb-dummy"
              },
              {
                "subnetId": "subnet-dummy-2",
                "cidr": "172.31.0.0/20",
                "availabilityZone": "us-east-1b",
                "routeTableId": "rtb-dummy"
              }
            ]
          }
        ]
      },
      [customVpcContextKey]: {
        "vpcId": "vpc-000000000-custom",
        "vpcCidrBlock": "10.0.0.0/16",
        "availabilityZones": [],
        "subnetGroups": [
          {
            "name": "public-subnet-for-testing",
            "type": "Public",
            "subnets": [
              {
                "subnetId": "subnet-00001",
                "cidr": "10.0.3.0/24",
                "availabilityZone": "us-east-1a",
                "routeTableId": "rtb-dummy"
              },
              {
                "subnetId": "subnet-00002",
                "cidr": "10.0.4.0/24",
                "availabilityZone": "us-east-1b",
                "routeTableId": "rtb-dummy"
              },
              {
                "subnetId": "subnet-00003",
                "cidr": "10.0.5.0/24",
                "availabilityZone": "us-east-1c",
                "routeTableId": "rtb-dummy"
              }
            ]
          }
        ]
      }
    }
  });

  const stack = new AwsSemaphoreAgentStack(app, 'MyTestStack', {
    argumentStore,
    stackName: "test-stack",
    env: { account, region }
  });

  return Template.fromStack(stack);
}

function basicArgumentStore() {
  return ArgumentStore.fromMap({
    SEMAPHORE_AGENT_STACK_NAME: "test-stack",
    SEMAPHORE_ORGANIZATION: "test",
    SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME: "test-token"
  });
}