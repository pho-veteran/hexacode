# Hexacode ECR Guide

This guide shows how to push this project's backend container images to Amazon ECR in a way that a beginner can follow.

It is written for this repository specifically, not as a generic AWS tutorial.

This guide assumes your ECR repository already exists and is named:

- `prod/hexacode`

## What ECR Is

Amazon ECR is AWS's private Docker image registry.

You build Docker images on your machine, push them to ECR, and then services like ECS pull those images to run your app.

## What Goes To ECR In This Repo

For this project, push these backend images to ECR:

- `identity-service`
- `problem-service`
- `submission-service`
- `worker`

In your AWS account, all four images will be stored in the same ECR repository:

- repository: `prod/hexacode`

Because one repository is shared by multiple services, the image tags must include the service name.

Examples:

- `identity-service-abc1234`
- `problem-service-abc1234`
- `submission-service-abc1234`
- `worker-abc1234`

Do not use ECR for the production frontend in this repo.

The frontend should be built as static files and deployed to S3 + CloudFront instead.

Also note that the local `gateway` container is useful for local development, but the intended cloud target in this repo is AWS API Gateway rather than shipping that local gateway container as the main production entrypoint.

## Before You Start

You need:

- an AWS account
- an IAM user or role that can use ECR
- AWS CLI v2 installed
- Docker Desktop installed and running
- access to this repo on your machine

## Required IAM Permissions

At minimum, the AWS identity that pushes images should be able to:

- `ecr:GetAuthorizationToken`
- `ecr:DescribeRepositories`
- `ecr:BatchCheckLayerAvailability`
- `ecr:InitiateLayerUpload`
- `ecr:UploadLayerPart`
- `ecr:CompleteLayerUpload`
- `ecr:PutImage`
- `ecr:BatchGetImage`

`ecr:CreateRepository` is only needed if you want this guide to create a new ECR repository. It is not required for your current setup because `prod/hexacode` already exists.

If someone else manages AWS for you, ask them for ECR push access in the target AWS account and region.

## Repo-Specific Build Contexts

This repo does not build every service from the same directory.

That matters a lot.

Use these exact Docker build contexts:

- `identity-service`: build from `./hexacode-backend`
- `problem-service`: build from `./hexacode-backend`
- `submission-service`: build from `./hexacode-backend`
- `worker`: build from `./hexacode-backend`

If you use the wrong build context, Docker may fail because files expected by the Dockerfile are missing.

## Step 1: Open PowerShell In The Repo Root

Open PowerShell in:

```powershell
C:\Users\thanh\Desktop\workspace\xbrain-courses\hexacode
```

## Step 2: Configure AWS CLI

If AWS CLI is not configured yet:

```powershell
aws configure
```

You will usually enter:

- AWS Access Key ID
- AWS Secret Access Key
- default region, for example `ap-southeast-1`
- output format, for example `json`

Check that AWS CLI works:

```powershell
aws sts get-caller-identity
```

If that command fails, stop here and fix AWS credentials first.

## Step 3: Set Your Region And Get Your AWS Account ID

Run:

```powershell
$env:AWS_REGION = "ap-southeast-1"
$ACCOUNT_ID = (aws sts get-caller-identity --query Account --output text).Trim()
$GIT_SHA = (git rev-parse --short HEAD).Trim()
$REPOSITORY = "prod/hexacode"
```

What these values mean:

- `$env:AWS_REGION`: the AWS region where your ECR repositories live
- `$ACCOUNT_ID`: your AWS account ID
- `$GIT_SHA`: the current git commit short SHA
- `$REPOSITORY`: your existing ECR repository name

If you do not want to use git SHA tags, you can replace `$GIT_SHA` with something simple like:

```powershell
$GIT_SHA = "dev-001"
```

## Step 4: Confirm The ECR Repository Exists

Your repo already uses one shared ECR repository:

- `prod/hexacode`

Check that it exists:

```powershell
aws ecr describe-repositories `
  --region $env:AWS_REGION `
  --repository-names $REPOSITORY
```

If this fails, either:

- the repo name is wrong
- the repo is in a different region
- your AWS identity cannot access it

## Fast Path: Use The Repo Script

This repo now includes a helper script:

- [scripts/push-ecr.ps1](</C:/Users/thanh/Desktop/workspace/xbrain-courses/hexacode/scripts/push-ecr.ps1>)

Push all backend images:

```powershell
.\scripts\push-ecr.ps1 -Region ap-southeast-1
```

Push only one service:

```powershell
.\scripts\push-ecr.ps1 -Region ap-southeast-1 -Service problem-service
```

Use a custom tag suffix:

```powershell
.\scripts\push-ecr.ps1 -Region ap-southeast-1 -TagSuffix release-001
```

Preview commands without running them:

```powershell
.\scripts\push-ecr.ps1 -Region ap-southeast-1 -DryRun
```

The script:

- uses the existing ECR repository `prod/hexacode`
- builds all backend services from `./hexacode-backend`
- tags images as `<service>-<tagSuffix>`
- logs Docker into ECR unless you pass `-SkipLogin`

The rest of this guide shows the same workflow manually.

## Step 5: Log Docker Into ECR

Run:

```powershell
aws ecr get-login-password --region $env:AWS_REGION |
  docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com"
```

Important:

- this login token is temporary
- if pushing later fails with auth errors, just run this command again

## Step 6: Build And Push `identity-service`

Set the service-specific tag:

```powershell
$TAG = "identity-service-$GIT_SHA"
```

Build:

```powershell
docker build `
  -f hexacode-backend/services/identity-service/Dockerfile `
  -t identity-service:$TAG `
  ./hexacode-backend
```

Tag for ECR:

```powershell
docker tag `
  identity-service:$TAG `
  "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY:$TAG"
```

Push:

```powershell
docker push "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY:$TAG"
```

## Step 7: Build And Push `problem-service`

Set the service-specific tag:

```powershell
$TAG = "problem-service-$GIT_SHA"
```

Build:

```powershell
docker build `
  -f ./hexacode-backend/services/problem-service/Dockerfile `
  -t problem-service:$TAG `
  ./hexacode-backend
```

Tag for ECR:

```powershell
docker tag `
  problem-service:$TAG `
  "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY:$TAG"
```

Push:

```powershell
docker push "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY:$TAG"
```

## Step 8: Build And Push `submission-service`

Set the service-specific tag:

```powershell
$TAG = "submission-service-$GIT_SHA"
```

Build:

```powershell
docker build `
  -f hexacode-backend/services/submission-service/Dockerfile `
  -t submission-service:$TAG `
  ./hexacode-backend
```

Tag for ECR:

```powershell
docker tag `
  submission-service:$TAG `
  "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY:$TAG"
```

Push:

```powershell
docker push "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY:$TAG"
```

## Step 9: Build And Push `worker`

Set the service-specific tag:

```powershell
$TAG = "worker-$GIT_SHA"
```

Build:

```powershell
docker build `
  -f hexacode-backend/services/worker/Dockerfile `
  -t worker:$TAG `
  ./hexacode-backend
```

Tag for ECR:

```powershell
docker tag `
  worker:$TAG `
  "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY:$TAG"
```

Push:

```powershell
docker push "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY:$TAG"
```

## Step 10: Verify Your Images In ECR

Check the shared repository:

```powershell
aws ecr describe-images `
  --region $env:AWS_REGION `
  --repository-name $REPOSITORY
```

Or open the AWS Console:

- AWS Console
- Amazon ECR
- Repositories
- click `prod/hexacode`
- confirm your service tags exist

## One Copy-Paste Script For All Four Images

If you want a single block to run:

```powershell
$env:AWS_REGION = "ap-southeast-1"
$ACCOUNT_ID = (aws sts get-caller-identity --query Account --output text).Trim()
$GIT_SHA = (git rev-parse --short HEAD).Trim()
$REPOSITORY = "prod/hexacode"

aws ecr get-login-password --region $env:AWS_REGION |
  docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com"

$TAG = "identity-service-$GIT_SHA"
docker build -f hexacode-backend/services/identity-service/Dockerfile -t identity-service:$TAG ./hexacode-backend
docker tag identity-service:$TAG "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY:$TAG"
docker push "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY:$TAG"

$TAG = "problem-service-$GIT_SHA"
docker build -f ./hexacode-backend/services/problem-service/Dockerfile -t problem-service:$TAG ./hexacode-backend
docker tag problem-service:$TAG "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY:$TAG"
docker push "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY:$TAG"

$TAG = "submission-service-$GIT_SHA"
docker build -f hexacode-backend/services/submission-service/Dockerfile -t submission-service:$TAG ./hexacode-backend
docker tag submission-service:$TAG "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY:$TAG"
docker push "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY:$TAG"

$TAG = "worker-$GIT_SHA"
docker build -f hexacode-backend/services/worker/Dockerfile -t worker:$TAG ./hexacode-backend
docker tag worker:$TAG "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY:$TAG"
docker push "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY:$TAG"
```

## How ECS Uses These Images Later

After pushing, ECS task definitions should use image values like:

```text
123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/prod/hexacode:problem-service-abc1234
```

That means:

- AWS account: `123456789012`
- region: `ap-southeast-1`
- ECR repository: `prod/hexacode`
- tag: `problem-service-abc1234`

## Beginner Tips

- Start with one image first, such as `identity-service`, before pushing all four.
- If Docker says access denied, repeat the ECR login command.
- All backend services in this repo now build from `./hexacode-backend`.
- Use real tags like git SHA or release numbers. Avoid relying only on `latest`.
- Push frontend separately as static files, not as a production Docker image for this repo.

## Common Errors

### `no basic auth credentials`

Cause:

- Docker is not logged into ECR anymore

Fix:

```powershell
aws ecr get-login-password --region $env:AWS_REGION |
  docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com"
```

### `RepositoryNotFoundException`

Cause:

- the ECR repository name is wrong, missing, or in another region

Fix:

- check that `prod/hexacode` exists in the selected region
- run:

```powershell
aws ecr describe-repositories --region $env:AWS_REGION --repository-names $REPOSITORY
```

### Docker build fails for `problem-service`

Cause:

- wrong Docker build context

Fix:

- use:

```powershell
docker build -f ./hexacode-backend/services/problem-service/Dockerfile -t problem-service:$TAG ./hexacode-backend
```

### `UnrecognizedClientException` or AWS auth failure

Cause:

- AWS CLI credentials are missing, expired, or pointed at the wrong account

Fix:

```powershell
aws sts get-caller-identity
```

Then fix credentials before trying again.

## Recommended Next Step

After you confirm manual push works once, automate it in CI.

Good next steps are:

- GitHub Actions
- AWS CodeBuild
- a small PowerShell deploy script checked into the repo

## Official AWS References

- ECR push guide: https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html
- ECR with ECS: https://docs.aws.amazon.com/AmazonECR/latest/userguide/ECR_on_ECS.html
- IAM permissions for pushing images: https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-push-iam.html
