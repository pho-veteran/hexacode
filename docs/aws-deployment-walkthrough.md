# AWS Deployment Walkthrough

This document is the step-by-step runbook for deploying the current Hexacode repo to AWS.

Use it together with [aws.md](./aws.md):

- `aws.md` explains the target architecture and resource sizing
- this file explains the concrete order and settings to click through in AWS

This walkthrough assumes:

- region: `us-west-2`
- environment name: `prod`
- ECR repository already exists: `prod/hexacode`
- application secret already exists: `arn:aws:secretsmanager:us-west-2:380825342853:secret:hexacode-prod-V7OL5l`
- frontend is deployed to S3 + CloudFront
- backend services are deployed to ECS Fargate
- the local `gateway` container is not deployed to AWS

## 1. Deployment Order

Create resources in this order:

1. VPC, subnets, route tables, NAT, DNS settings, and endpoints
2. Security groups
3. S3 buckets
4. SQS queue and DLQ
5. RDS PostgreSQL
6. ElastiCache Redis
7. Cognito User Pool and App Client
8. Secrets Manager secrets
9. ECR images
10. CloudWatch log groups
11. ECS execution role and per-service task roles
12. ECS cluster
13. Internal ALB and target groups
14. ECS task definitions and ECS services
15. API Gateway HTTP API, VPC Link, and `chat-lambda`
16. Frontend bucket upload and CloudFront
17. Database bootstrap and problem catalog import

That order matters because the ECS services start by checking the database, buckets, and queue. If those resources do not exist yet, startup will fail or require broader IAM than necessary.

## 2. VPC Setup

Use the VPC design from [aws.md](./aws.md) with these practical choices:

- `Enable DNS hostnames`: `On`
- `Enable DNS resolution`: `On`
- NAT gateway option: `Regional`
- VPC endpoint option: `S3 Gateway`

Use private subnets only for:

- ECS services
- internal ALB
- RDS
- ElastiCache

Use public subnets only for NAT and internet-facing edge resources if you add any later.

### Recommended subnet placement

- `public_subnet_a`: NAT support
- `public_subnet_b`: NAT support
- `private_app_subnet_a`: ECS services, VPC Link ENIs, internal ALB
- `private_app_subnet_b`: ECS services, VPC Link ENIs, internal ALB
- `private_data_subnet_a`: RDS, ElastiCache
- `private_data_subnet_b`: RDS, ElastiCache

### Endpoints

Create or plan for these endpoints:

- `S3 Gateway`: create now
- `ECR API` interface endpoint: recommended
- `ECR DKR` interface endpoint: recommended
- `CloudWatch Logs` interface endpoint: recommended
- `Secrets Manager` interface endpoint: recommended
- `SQS` interface endpoint: recommended
- `STS` interface endpoint: recommended

If you do not create those interface endpoints, private ECS tasks will use NAT for those AWS API calls.

## 3. Security Groups

Create these security groups:

- `sg_apigw_vpclink`
- `sg_internal_alb`
- `sg_api_services`
- `sg_worker`
- `sg_rds`
- `sg_redis`

Use these rules:

- `sg_apigw_vpclink`
  - inbound: none
  - outbound: `tcp/80` to `sg_internal_alb`

- `sg_internal_alb`
  - inbound: `tcp/80` from `sg_apigw_vpclink`
  - inbound: `tcp/80` from `sg_api_services`
  - inbound: `tcp/80` from `sg_worker`
  - outbound: `tcp/8000` to `sg_api_services`

- `sg_api_services`
  - inbound: `tcp/8000` from `sg_internal_alb`
  - outbound: `tcp/5432` to `sg_rds`
  - outbound: `tcp/6379` to `sg_redis`
  - outbound: `tcp/80` to `sg_internal_alb`
  - outbound: `tcp/443` to AWS APIs through NAT or interface endpoints

- `sg_worker`
  - inbound: none
  - outbound: `tcp/80` to `sg_internal_alb`
  - outbound: `tcp/443` to AWS APIs through NAT or interface endpoints

- `sg_rds`
  - inbound: `tcp/5432` from `sg_api_services`

- `sg_redis`
  - inbound: `tcp/6379` from `sg_api_services`

The extra ALB rule from `sg_api_services` and `sg_worker` is required because `submission-service` and `worker` call private `/internal/...` routes through the ALB DNS name.

## 4. S3 Buckets

Create these buckets:

- `hexacode-prod-frontend`
- `hexacode-prod-problem-assets`
- `hexacode-prod-submission-artifacts`

Use these settings:

- Block Public Access: `On` for all three
- Object Ownership: bucket owner enforced
- Versioning: `On` for `problem-assets` and `submission-artifacts`
- Default encryption: SSE-S3 is fine to start

Recommended usage:

- `hexacode-prod-frontend`: CloudFront origin only
- `hexacode-prod-problem-assets`: statements, testcase archives, testcase files, checker source, compiled checker artifacts
- `hexacode-prod-submission-artifacts`: current code only lightly uses this bucket, but keep it provisioned for future source/log/artifact storage

Important repo detail:

- `problem-service` and `submission-service` both run bootstrap code that checks configured buckets on startup
- if you pre-create the buckets first, the task roles do not need bucket-creation permissions

## 5. SQS Queue And DLQ

Create:

- main queue: `hexacode-prod-judge-jobs`
- dead-letter queue: `hexacode-prod-judge-jobs-dlq`

Use these values:

- `Receive message wait time`: `20` seconds
- `Visibility timeout`: `300` seconds
- `Message retention`: `4` days
- redrive policy: send to DLQ after `5` receives

Save the main queue URL. That exact URL becomes `SQS_JUDGE_QUEUE_URL` in ECS.

Important repo detail:

- both `submission-service` and `worker` call `GetQueueUrl` on startup
- if the queue already exists, task roles only need normal queue access
- if the queue does not exist, the code tries `CreateQueue`

For production, pre-create the queue and avoid granting `CreateQueue` to app tasks.

## 6. RDS PostgreSQL

Create one PostgreSQL 16 instance or Multi-AZ deployment in the private data subnets.

Recommended beginner settings:

- engine: PostgreSQL 16
- DB name: `hexacode`
- public access: `No`
- subnet group: private data subnets only
- security group: `sg_rds`
- storage: `gp3`
- Secrets Manager-managed master password: `On`

This walkthrough assumes you already created one shared application secret in Secrets Manager:

- `arn:aws:secretsmanager:us-west-2:380825342853:secret:hexacode-prod-V7OL5l`

Store JSON like this in that secret:

```json
{
  "DATABASE_URL": "postgresql://postgres:REPLACE_ME@your-rds-endpoint.us-west-2.rds.amazonaws.com:5432/hexacode",
  "REDIS_URL": "redis://your-redis-endpoint:6379"
}
```

The task definitions below inject `DATABASE_URL` and `REDIS_URL` from that single JSON secret by key.

Before opening traffic, apply:

- [hexacode-backend/db/new-app-schema.sql](../hexacode-backend/db/new-app-schema.sql)

The services still attempt idempotent schema bootstrap, but production should not depend on first-request startup DDL.

## 7. ElastiCache Redis

Create one Redis replication group in the private data subnets.

Recommended beginner settings:

- engine: Redis OSS / Valkey-compatible mode if offered by AWS for your target
- cluster mode: disabled
- node count: `1 primary + 1 replica`
- subnet group: private data subnets only
- security group: `sg_redis`

If you enable in-transit encryption, set `REDIS_URL` like this:

```text
rediss://primary-endpoint:6379/0
```

If you keep it non-TLS inside the VPC, set:

```text
redis://primary-endpoint:6379/0
```

Repo detail:

- only `problem-service` currently uses Redis
- `identity-service`, `submission-service`, and `worker` can leave `REDIS_URL` empty

## 8. Cognito

Create:

- one User Pool
- one App Client for the SPA

Collect these values for ECS and frontend config:

- `COGNITO_USER_POOL_ID`
- `COGNITO_APP_CLIENT_ID`
- `COGNITO_ISSUER`
- `COGNITO_JWKS_URL`

Those values are configuration, not secrets.

## 9. Secrets Manager

For the current setup, use this shared application secret:

- `arn:aws:secretsmanager:us-west-2:380825342853:secret:hexacode-prod-V7OL5l`

Keep at least these JSON keys inside it:

- `DATABASE_URL`
- `REDIS_URL`

You can still create separate secrets later, but the task definitions in this walkthrough assume the single shared secret above.

For this repo, keep these as normal ECS environment variables instead of Secrets Manager:

- `COGNITO_USER_POOL_ID`
- `COGNITO_APP_CLIENT_ID`
- `COGNITO_ISSUER`
- `COGNITO_JWKS_URL`
- `S3_BUCKET_PROBLEMS`
- `S3_BUCKET_SUBMISSIONS`
- `SQS_JUDGE_QUEUE_URL`
- `PROBLEM_SERVICE_URL`
- `SUBMISSION_SERVICE_URL`

## 10. Push Images To ECR

Follow [ecr.md](./ecr.md).

The short version is:

```powershell
.\scripts\push-ecr.ps1 -Region us-west-2
```

That pushes these images into the shared ECR repository `prod/hexacode`:

- `identity-service-<tag>`
- `problem-service-<tag>`
- `submission-service-<tag>`
- `worker-<tag>`

## 11. CloudWatch Log Groups

Pre-create log groups so retention is explicit:

- `/ecs/hexacode-prod/identity-service`
- `/ecs/hexacode-prod/problem-service`
- `/ecs/hexacode-prod/submission-service`
- `/ecs/hexacode-prod/worker`
- `/aws/apigateway/hexacode-prod-http-api`
- `/aws/lambda/hexacode-prod-chat`

Start with `30` days retention unless you need more.

If you pre-create log groups, the ECS execution role does not need `logs:CreateLogGroup`.

## 12. IAM Roles

### ECS task execution role

Create one execution role used by all ECS task definitions:

- role name: `hexacode-prod-ecs-execution`

This role is for:

- pulling images from ECR
- writing container logs to CloudWatch Logs
- resolving task-definition `secrets` entries from Secrets Manager

Use this trust policy if the IAM console does not show the ECS task use case:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Attach:

- managed policy `AmazonECSTaskExecutionRolePolicy`
- one inline policy so ECS can read the shared application secret used by the task definitions below

Execution role inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadHexacodeAppSecret",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:us-west-2:380825342853:secret:hexacode-prod-V7OL5l"
    }
  ]
}
```

If that secret uses a customer-managed KMS key instead of the default AWS-managed key, add `kms:Decrypt` on that KMS key ARN to the same execution role.

Important:

- if you inject `DATABASE_URL` into the container with ECS `secrets`, the execution role needs secret access
- the application task role does not need Secrets Manager access unless your code calls the Secrets Manager API directly

### ECS task roles

Create one task role per service.

`identity-service` task role:

- role name: `hexacode-prod-identity-task`
- no inline permission policy needed for current code
- use the same ECS task trust policy shown above

`problem-service` task role:

- role name: `hexacode-prod-problem-task`
- use the same ECS task trust policy shown above
- attach this inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ProblemBucketMeta",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::hexacode-prod-problem-assets"
    },
    {
      "Sid": "ProblemBucketObjects",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::hexacode-prod-problem-assets/*"
    }
  ]
}
```

`submission-service` task role:

- role name: `hexacode-prod-submission-task`
- use the same ECS task trust policy shown above
- attach this inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "JudgeQueueProducer",
      "Effect": "Allow",
      "Action": [
        "sqs:GetQueueUrl",
        "sqs:SendMessage"
      ],
      "Resource": "arn:aws:sqs:us-west-2:380825342853:hexacode-prod-judge-jobs"
    },
    {
      "Sid": "SubmissionBucketMeta",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::hexacode-prod-submission-artifacts"
    },
    {
      "Sid": "SubmissionBucketRead",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::hexacode-prod-submission-artifacts/*"
    }
  ]
}
```

`worker` task role:

- role name: `hexacode-prod-worker-task`
- use the same ECS task trust policy shown above
- attach this inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "JudgeQueueConsumer",
      "Effect": "Allow",
      "Action": [
        "sqs:GetQueueUrl",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage"
      ],
      "Resource": "arn:aws:sqs:us-west-2:380825342853:hexacode-prod-judge-jobs"
    },
    {
      "Sid": "ProblemBucketRead",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::hexacode-prod-problem-assets/*"
    },
    {
      "Sid": "CompiledCheckerWrite",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::hexacode-prod-problem-assets/problem/*/checker/*/compiled/*"
    }
  ]
}
```

If you later persist submission source or judge logs to S3 and want the worker to read them back, add `s3:GetObject` on `arn:aws:s3:::hexacode-prod-submission-artifacts/*`.

None of the task roles above need Secrets Manager permissions because the application code does not call Secrets Manager directly. ECS injects the secret values by using the execution role instead.

## 13. ECS Cluster

Create one ECS cluster:

- name: `hexacode-prod`
- launch type / capacity: Fargate
- runtime platform: `Linux / x86_64`

Use private app subnets only.

Set `Assign public IP` to `Disabled` for every service.

## 14. Task Definitions

Create four task definitions:

- `hexacode-prod-identity-service`
- `hexacode-prod-problem-service`
- `hexacode-prod-submission-service`
- `hexacode-prod-worker`

Common container settings:

- container port: `8000` for API services
- log driver: `awslogs`
- CPU and memory from [aws.md](./aws.md)
- `executionRoleArn`: shared execution role
- `taskRoleArn`: service-specific task role

### Copyable task definition JSON

The four JSON blocks below are meant to be copied into the ECS task definition JSON editor. They follow the AWS console template shape more closely than the earlier examples. Replace the placeholders before creating each task definition.

Use these placeholder rules:

- replace image tags like `identity-service-abc1234` with the real ECR tags you pushed
- replace Cognito values with your real User Pool and App Client values
- replace `internal-alb-dns-name` with your real internal ALB DNS name

These examples already use:

- AWS account ID `380825342853`
- region `us-west-2`
- shared application secret ARN `arn:aws:secretsmanager:us-west-2:380825342853:secret:hexacode-prod-V7OL5l`

Because the examples inject JSON keys from a Secrets Manager secret, use Fargate platform version `LATEST` or at least Linux platform version `1.4.0` when you create the ECS services.

#### `hexacode-prod-identity-service`

```json
{
  "requiresCompatibilities": ["FARGATE"],
  "family": "hexacode-prod-identity-service",
  "containerDefinitions": [
    {
      "name": "identity-service",
      "image": "380825342853.dkr.ecr.us-west-2.amazonaws.com/prod/hexacode:identity-service-abc1234",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 8000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        { "name": "LOG_LEVEL", "value": "INFO" },
        { "name": "COGNITO_USER_POOL_ID", "value": "us-west-2_xxxxxx" },
        { "name": "COGNITO_APP_CLIENT_ID", "value": "xxxxxxxxxxxx" },
        { "name": "COGNITO_ISSUER", "value": "https://cognito-idp.us-west-2.amazonaws.com/us-west-2_xxxxxx" },
        { "name": "COGNITO_JWKS_URL", "value": "https://cognito-idp.us-west-2.amazonaws.com/us-west-2_xxxxxx/.well-known/jwks.json" }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:us-west-2:380825342853:secret:hexacode-prod-V7OL5l:DATABASE_URL::"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/hexacode-prod/identity-service",
          "awslogs-region": "us-west-2",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ],
  "volumes": [],
  "networkMode": "awsvpc",
  "memory": "512",
  "cpu": "256",
  "executionRoleArn": "arn:aws:iam::380825342853:role/hexacode-prod-ecs-execution",
  "taskRoleArn": "arn:aws:iam::380825342853:role/hexacode-prod-identity-task",
  "runtimePlatform": {
    "cpuArchitecture": "X86_64",
    "operatingSystemFamily": "LINUX"
  }
}
```

#### `hexacode-prod-problem-service`

```json
{
  "requiresCompatibilities": ["FARGATE"],
  "family": "hexacode-prod-problem-service",
  "containerDefinitions": [
    {
      "name": "problem-service",
      "image": "380825342853.dkr.ecr.us-west-2.amazonaws.com/prod/hexacode:problem-service-abc1234",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 8000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        { "name": "LOG_LEVEL", "value": "INFO" },
        { "name": "AWS_REGION", "value": "us-west-2" },
        { "name": "STORAGE_DRIVER", "value": "s3" },
        { "name": "S3_REGION", "value": "us-west-2" },
        { "name": "S3_ENDPOINT", "value": "" },
        { "name": "S3_FORCE_PATH_STYLE", "value": "false" },
        { "name": "S3_BUCKET_PROBLEMS", "value": "hexacode-prod-problem-assets" },
        { "name": "S3_BUCKET_SUBMISSIONS", "value": "" },
        { "name": "COGNITO_USER_POOL_ID", "value": "us-west-2_xxxxxx" },
        { "name": "COGNITO_APP_CLIENT_ID", "value": "xxxxxxxxxxxx" },
        { "name": "COGNITO_ISSUER", "value": "https://cognito-idp.us-west-2.amazonaws.com/us-west-2_xxxxxx" },
        { "name": "COGNITO_JWKS_URL", "value": "https://cognito-idp.us-west-2.amazonaws.com/us-west-2_xxxxxx/.well-known/jwks.json" }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:us-west-2:380825342853:secret:hexacode-prod-V7OL5l:DATABASE_URL::"
        },
        {
          "name": "REDIS_URL",
          "valueFrom": "arn:aws:secretsmanager:us-west-2:380825342853:secret:hexacode-prod-V7OL5l:REDIS_URL::"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/hexacode-prod/problem-service",
          "awslogs-region": "us-west-2",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ],
  "volumes": [],
  "networkMode": "awsvpc",
  "memory": "1024",
  "cpu": "512",
  "executionRoleArn": "arn:aws:iam::380825342853:role/hexacode-prod-ecs-execution",
  "taskRoleArn": "arn:aws:iam::380825342853:role/hexacode-prod-problem-task",
  "runtimePlatform": {
    "cpuArchitecture": "X86_64",
    "operatingSystemFamily": "LINUX"
  }
}
```

#### `hexacode-prod-submission-service`

```json
{
  "requiresCompatibilities": ["FARGATE"],
  "family": "hexacode-prod-submission-service",
  "containerDefinitions": [
    {
      "name": "submission-service",
      "image": "380825342853.dkr.ecr.us-west-2.amazonaws.com/prod/hexacode:submission-service-abc1234",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 8000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        { "name": "LOG_LEVEL", "value": "INFO" },
        { "name": "AWS_REGION", "value": "us-west-2" },
        { "name": "STORAGE_DRIVER", "value": "s3" },
        { "name": "QUEUE_DRIVER", "value": "sqs" },
        { "name": "S3_REGION", "value": "us-west-2" },
        { "name": "S3_ENDPOINT", "value": "" },
        { "name": "S3_FORCE_PATH_STYLE", "value": "false" },
        { "name": "S3_BUCKET_PROBLEMS", "value": "" },
        { "name": "S3_BUCKET_SUBMISSIONS", "value": "hexacode-prod-submission-artifacts" },
        { "name": "SQS_ENDPOINT", "value": "" },
        { "name": "SQS_JUDGE_QUEUE_URL", "value": "https://sqs.us-west-2.amazonaws.com/380825342853/hexacode-prod-judge-jobs" },
        { "name": "PROBLEM_SERVICE_URL", "value": "http://internal-alb-dns-name" },
        { "name": "COGNITO_USER_POOL_ID", "value": "us-west-2_xxxxxx" },
        { "name": "COGNITO_APP_CLIENT_ID", "value": "xxxxxxxxxxxx" },
        { "name": "COGNITO_ISSUER", "value": "https://cognito-idp.us-west-2.amazonaws.com/us-west-2_xxxxxx" },
        { "name": "COGNITO_JWKS_URL", "value": "https://cognito-idp.us-west-2.amazonaws.com/us-west-2_xxxxxx/.well-known/jwks.json" }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:us-west-2:380825342853:secret:hexacode-prod-V7OL5l:DATABASE_URL::"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/hexacode-prod/submission-service",
          "awslogs-region": "us-west-2",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ],
  "volumes": [],
  "networkMode": "awsvpc",
  "memory": "1024",
  "cpu": "512",
  "executionRoleArn": "arn:aws:iam::380825342853:role/hexacode-prod-ecs-execution",
  "taskRoleArn": "arn:aws:iam::380825342853:role/hexacode-prod-submission-task",
  "runtimePlatform": {
    "cpuArchitecture": "X86_64",
    "operatingSystemFamily": "LINUX"
  }
}
```

#### `hexacode-prod-worker`

```json
{
  "requiresCompatibilities": ["FARGATE"],
  "family": "hexacode-prod-worker",
  "containerDefinitions": [
    {
      "name": "worker",
      "image": "380825342853.dkr.ecr.us-west-2.amazonaws.com/prod/hexacode:worker-abc1234",
      "essential": true,
      "environment": [
        { "name": "LOG_LEVEL", "value": "INFO" },
        { "name": "AWS_REGION", "value": "us-west-2" },
        { "name": "STORAGE_DRIVER", "value": "s3" },
        { "name": "QUEUE_DRIVER", "value": "sqs" },
        { "name": "S3_REGION", "value": "us-west-2" },
        { "name": "S3_ENDPOINT", "value": "" },
        { "name": "S3_FORCE_PATH_STYLE", "value": "false" },
        { "name": "S3_BUCKET_PROBLEMS", "value": "hexacode-prod-problem-assets" },
        { "name": "S3_BUCKET_SUBMISSIONS", "value": "" },
        { "name": "SQS_ENDPOINT", "value": "" },
        { "name": "SQS_JUDGE_QUEUE_URL", "value": "https://sqs.us-west-2.amazonaws.com/380825342853/hexacode-prod-judge-jobs" },
        { "name": "PROBLEM_SERVICE_URL", "value": "http://internal-alb-dns-name" },
        { "name": "SUBMISSION_SERVICE_URL", "value": "http://internal-alb-dns-name" },
        { "name": "WORKER_NAME", "value": "worker-prod-1" },
        { "name": "WORKER_VERSION", "value": "1.0.0" },
        { "name": "WORKER_POLL_INTERVAL_SECONDS", "value": "15" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/hexacode-prod/worker",
          "awslogs-region": "us-west-2",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ],
  "volumes": [],
  "networkMode": "awsvpc",
  "memory": "4096",
  "cpu": "2048",
  "executionRoleArn": "arn:aws:iam::380825342853:role/hexacode-prod-ecs-execution",
  "taskRoleArn": "arn:aws:iam::380825342853:role/hexacode-prod-worker-task",
  "runtimePlatform": {
    "cpuArchitecture": "X86_64",
    "operatingSystemFamily": "LINUX"
  }
}
```

Keep these values empty in AWS:

- `S3_ENDPOINT`
- `SQS_ENDPOINT`

Leave these values unset entirely unless you intentionally use static credentials:

- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

`problem-service` is the only service that currently needs `REDIS_URL`.

## 15. Internal ALB

Create one internal Application Load Balancer:

- scheme: `internal`
- subnets: private app subnets
- security group: `sg_internal_alb`

Use one HTTP listener:

- listener port: `80`

For a first deployment, plain HTTP inside the VPC is simpler. API Gateway still provides HTTPS at the public edge.

For the listener default action:

- choose `Return fixed response`
- status code: `404`
- content type: `text/plain`
- message body: `Not found`

Do not use weighted forwarding here. For this repo, each non-default listener rule should forward to exactly one target group, and target group stickiness should stay off.

Create target groups:

- `hexacode-prod-tg-identity` -> `HTTP:8000`, health check `/healthz`
- `hexacode-prod-tg-problem` -> `HTTP:8000`, health check `/healthz`
- `hexacode-prod-tg-submission` -> `HTTP:8000`, health check `/healthz`

Create listener rules in this order:

1. priority `10`
   - `/api/auth*`
   - `/api/dashboard/users*`
   - forward to `identity`

2. priority `20`
   - `/api/submissions*`
   - `/api/runtimes*`
   - `/api/dashboard/operations*`
   - `/internal/judge-jobs*`
   - `/internal/runtimes*`
   - forward to `submission`

3. priority `30`
   - `/api/problems*`
   - `/api/tags*`
   - `/api/dashboard*`
   - `/internal/problems*`
   - `/internal/checkers*`
   - forward to `problem`

4. priority `31`
   - `/internal/cache/public-problems/invalidate`
   - forward to `problem`

5. default action
   - fixed response `404`

That ordering matters because `/api/dashboard/operations` must reach `submission-service` before the broader `/api/dashboard*` rule sends the rest of dashboard traffic to `problem-service`.

## 16. ECS Services

Create four ECS services:

- `hexacode-prod-identity-service`
- `hexacode-prod-problem-service`
- `hexacode-prod-submission-service`
- `hexacode-prod-worker`

For the three API services:

- launch type: Fargate
- subnets: private app subnets
- security group: `sg_api_services`
- assign public IP: `Disabled`
- attach the matching target group

For the worker:

- launch type: Fargate
- subnets: private app subnets
- security group: `sg_worker`
- assign public IP: `Disabled`
- no load balancer

Suggested rollout order:

1. `identity-service`
2. `problem-service`
3. `submission-service`
4. `worker`

Start with desired count `1` for each API service while validating health checks, then move to the steady-state counts from [aws.md](./aws.md).

## 17. API Gateway HTTP API

Create one HTTP API.

### Stage

Use the `$default` stage with auto-deploy enabled.

That keeps the public URL clean and avoids a stage prefix in your frontend API base URL.

### VPC Link

Create one VPC Link:

- subnets: private app subnets
- security group: `sg_apigw_vpclink`

### Integrations

Create these integrations:

- `alb-private-integration`
  - type: private integration
  - target: internal ALB listener ARN
  - connection: the VPC Link above

- `chat-lambda-integration`
  - type: Lambda proxy
  - target: deployed `chat-lambda`

- `cors-preflight-integration`
  - type: Lambda proxy
  - target: a tiny no-auth Lambda that returns `204`
  - purpose: guarantee successful browser preflight responses for deployed frontend requests

### Routes

Create:

- `ANY /api/{proxy+}` -> `alb-private-integration`
- `POST /api/chat/messages` -> `chat-lambda-integration`
- `OPTIONS /api/{proxy+}` -> `cors-preflight-integration`

The explicit chat route stays more specific than `ANY /api/{proxy+}`, so chat bypasses the ALB and goes straight to Lambda.

The explicit `OPTIONS /api/{proxy+}` route is important for deployed browser traffic. If preflight requests fall into the broad `ANY /api/{proxy+}` route, the browser can surface `CORS Preflight Did Not Succeed` even when the real backend route is fine. Keep this `OPTIONS` route unauthenticated.

The preflight Lambda can be minimal:

```js
export const handler = async () => ({
  statusCode: 204,
  body: ""
});
```

When API-level CORS is enabled on the HTTP API, API Gateway adds the CORS headers. The Lambda only needs to return success.

### CORS

Enable CORS for the frontend origin only.

Allow at least:

- origin: your exact frontend origin, for example `https://d2x2kyi0hl9xxu.cloudfront.net`
- methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`
- headers: `authorization`, `content-type`, `x-correlation-id`
- expose headers: `content-disposition`, `x-correlation-id`
- max age: `300`
- allow credentials: `No`

Do not use `*` in production. Enter the CloudFront or custom frontend domain exactly, without a trailing slash.

### Logging

Enable access logs to:

- `/aws/apigateway/hexacode-prod-http-api`

## 18. Frontend And CloudFront

The production frontend for this repo is a static Vite build uploaded to S3 and served through CloudFront.

Do not deploy the frontend Dockerfile to ECS. It runs the dev server and is not the production path.

### Build-time public env

The frontend reads browser-visible config from `PUBLIC_*` or `VITE_*` env vars at build time. The simplest deployment flow is to set those env vars locally, build once, then upload `dist/`.

Use:

- `PUBLIC_API_BASE_URL`: the public API Gateway domain, not localhost and not the internal ALB
- `PUBLIC_COGNITO_CLIENT_ID`: the production Cognito App Client ID
- `PUBLIC_COGNITO_REGION`: `us-west-2`
- `PUBLIC_COGNITO_DOMAIN`: optional, only if you use the Cognito hosted UI or want region inference from the domain
- `PUBLIC_COGNITO_SCOPES`: optional, default `openid email profile`

Example PowerShell build:

```powershell
$env:PUBLIC_API_BASE_URL = "https://your-api-id.execute-api.us-west-2.amazonaws.com"
$env:PUBLIC_COGNITO_CLIENT_ID = "your-cognito-app-client-id"
$env:PUBLIC_COGNITO_REGION = "us-west-2"
$env:PUBLIC_COGNITO_DOMAIN = ""
$env:PUBLIC_COGNITO_SCOPES = "openid email profile"
npm --prefix hexacode-frontend run build
```

If you later want runtime-swappable frontend config without rebuilding, you can inject `window.__HEXACODE_ENV__`, but that is not wired as part of this walkthrough. Build-time env is the intended first deployment path.

### S3 bucket settings

For `hexacode-prod-frontend`:

- keep `Block Public Access` enabled
- keep `Object Ownership` as `Bucket owner enforced`
- do not enable S3 static website hosting

Use the normal S3 bucket origin with CloudFront, not the S3 website endpoint. CloudFront OAC works only with a regular S3 bucket origin, not the website endpoint.

### CloudFront distribution

Create one standard distribution with:

- origin: the `hexacode-prod-frontend` S3 bucket
- origin type: S3 origin
- viewer protocol policy: `Redirect HTTP to HTTPS`
- allowed methods: `GET, HEAD, OPTIONS`
- compress objects automatically: `On`
- default root object: `index.html`
- cache policy: `CachingOptimized` is fine to start

If you use a custom frontend domain such as `app.example.com`:

- request or import the ACM certificate in `us-east-1`
- attach that certificate to the distribution
- add the alternate domain name to the distribution
- point your DNS record at the CloudFront distribution

### Origin Access Control (OAC)

Create an OAC for the S3 origin:

- origin type: `S3`
- signing behavior: `Sign requests (recommended)`
- signing protocol: `sigv4`

Attach that OAC to the S3 origin in the distribution.

### Bucket policy for OAC

After you know the CloudFront distribution ID, add a bucket policy to `hexacode-prod-frontend` that allows only that distribution to read objects.

Replace `DISTRIBUTION_ID` with the real CloudFront distribution ID:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontReadOnly",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::hexacode-prod-frontend/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::380825342853:distribution/DISTRIBUTION_ID"
        }
      }
    }
  ]
}
```

Some CloudFront console flows can generate or suggest the bucket policy for you. If the console offers that, use it, then verify it matches the bucket and distribution you created.

### SPA deep-link handling

Because this frontend is a single-page app, direct requests to routes like `/login` or `/problems/router-placement` must still return `index.html`.

In CloudFront, add custom error responses:

- `403` -> response page path `/index.html`, HTTP response code `200`, error caching minimum TTL `0`
- `404` -> response page path `/index.html`, HTTP response code `200`, error caching minimum TTL `0`

With a private S3 origin and OAC, missing SPA routes often surface as `403`, not only `404`, so configure both.

### Upload the build to S3

From the repo root, upload the built frontend.

Recommended approach:

1. upload everything except `index.html` with long-lived caching
2. upload `index.html` separately with short caching

Example:

```powershell
aws s3 sync .\hexacode-frontend\dist s3://hexacode-prod-frontend `
  --delete `
  --exclude "index.html" `
  --cache-control "public,max-age=31536000,immutable"

aws s3 cp .\hexacode-frontend\dist\index.html s3://hexacode-prod-frontend/index.html `
  --cache-control "public,max-age=60,must-revalidate" `
  --content-type "text/html"
```

Why split the upload:

- hashed JS/CSS/assets can stay cached for a long time
- `index.html` should refresh quickly because it points at the latest asset filenames

### CloudFront invalidation

After upload, invalidate at least the root document:

```powershell
aws cloudfront create-invalidation `
  --distribution-id DISTRIBUTION_ID `
  --paths "/" "/index.html"
```

If you ever skip the cache-control split above, invalidate `/*` instead, but that is slower and more expensive.

### Verification

After the distribution is deployed:

1. open the CloudFront domain
2. verify `/` loads the app
3. verify a deep link such as `/login` loads without S3 access errors
4. verify API requests go to the API Gateway public domain
5. verify Cognito sign-in works with the production client ID and region

Relevant AWS references:

- OAC with S3 origin: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
- CloudFront custom error responses: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/custom-error-pages-procedure.html
- Default root object: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DefaultRootObject.html
- Custom domain and ACM certificate for CloudFront: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CreatingCNAME.html

## 19. Bootstrap And Import

Before opening traffic:

1. apply `hexacode-backend/db/new-app-schema.sql`
2. verify all three API services return `200` on `/healthz`
3. verify `worker` logs show queue polling without permission errors
4. run the problem catalog import as a one-off job

The import helper is:

- [hexacode-backend/scripts/import_problem_catalog.py](../hexacode-backend/scripts/import_problem_catalog.py)

Do not bake the catalog import into container startup.

## 20. Common Beginner Mistakes

- Setting `S3_ENDPOINT` or `SQS_ENDPOINT` to a real AWS URL
  - leave them empty in AWS

- Giving every task the same IAM permissions
  - keep the execution role shared, but keep task roles separate

- Putting ECS tasks in public subnets
  - keep them private and disable public IP assignment

- Forgetting internal ALB rules for `/internal/*`
  - the worker and `submission-service` use those paths

- Pointing `PROBLEM_SERVICE_URL` or `SUBMISSION_SERVICE_URL` at a target group or container IP
  - use the internal ALB DNS name as the base URL

- Letting ECS create missing buckets or queues in production
  - pre-create stateful resources first and keep task roles tighter

## 21. Final Checklist

Before calling the deployment ready:

- VPC DNS hostnames enabled
- VPC DNS resolution enabled
- ECS tasks are in private subnets only
- `Assign public IP` disabled on every ECS service
- `S3_ENDPOINT` empty in AWS
- `SQS_ENDPOINT` empty in AWS
- `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` unset in AWS
- execution role can pull ECR images, write logs, and read injected secrets
- task roles only have the AWS API permissions their code paths need
- internal ALB rules cover both public `/api/*` and private `/internal/*`
- API Gateway has a specific `POST /api/chat/messages` Lambda route
- API Gateway forwards the rest of `/api/*` to the internal ALB
- RDS, Redis, SQS, and both application buckets exist before ECS starts
