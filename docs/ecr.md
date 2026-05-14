# Hexacode ECR Guide

This guide shows how to push Hexacode backend container images to Amazon ECR.

Terraform manages the ECR repository. Create or update the repository through the Terraform workflow before relying on it for production ECS task definitions.

## What ECR Is

Amazon ECR is AWS's private Docker image registry. You build Docker images locally or in CI, push them to ECR, and ECS Fargate pulls those images to run the backend services.

## What Goes To ECR In This Repo

Push these backend images to the shared repository named by Terraform `ecr_repository_name`, defaulting to `prod/hexacode`:

- `identity-service`
- `problem-service`
- `submission-service`
- `worker`

Because all four services share one repository, image tags include the service name:

- `identity-service-abc1234`
- `problem-service-abc1234`
- `submission-service-abc1234`
- `worker-abc1234`

Do not use ECR for the production frontend. Build the frontend as static files and deploy it to S3 + CloudFront.

## Before You Start

You need:

- AWS CLI v2 configured for the target account and region
- Docker Desktop installed and running
- Terraform applied far enough to create the ECR repository
- access to this repo from its root directory

Check AWS and Docker:

```powershell
aws sts get-caller-identity
aws configure get region
docker version
```

For the current production target, use `us-west-2` unless the deployment owner intentionally changes `terraform.tfvars`.

## Required IAM Permissions

The identity that pushes images needs:

- `ecr:GetAuthorizationToken`
- `ecr:DescribeRepositories`
- `ecr:BatchCheckLayerAvailability`
- `ecr:InitiateLayerUpload`
- `ecr:UploadLayerPart`
- `ecr:CompleteLayerUpload`
- `ecr:PutImage`
- `ecr:BatchGetImage`

`ecr:CreateRepository`, `ecr:PutLifecyclePolicy`, and repository-management permissions belong to the Terraform operator, not the routine image-push identity.

## Repo-Specific Build Contexts

Backend production images use service-specific Dockerfiles, but the required build context differs by service:

- `identity-service`: `./hexacode-backend`
- `problem-service`: repo root `.` because the image includes the curated `data/problems` catalog for one-off seed tasks
- `submission-service`: `./hexacode-backend`
- `worker`: `./hexacode-backend`

If you use the wrong build context, Docker may fail because files expected by the Dockerfile are missing.

## Fast Path: Use The Repo Script

From the repo root:

```powershell
$env:AWS_REGION = "us-west-2"
$env:IMAGE_TAG = (git rev-parse --short HEAD).Trim()
powershell -ExecutionPolicy Bypass -File scripts/push-ecr.ps1 -Region $env:AWS_REGION -TagSuffix $env:IMAGE_TAG
```

Push only one service:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/push-ecr.ps1 -Region $env:AWS_REGION -Service problem-service -TagSuffix $env:IMAGE_TAG
```

Preview commands without running them:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/push-ecr.ps1 -Region $env:AWS_REGION -TagSuffix $env:IMAGE_TAG -DryRun
```

The script:

- reads the target account with `aws sts get-caller-identity`
- uses the shared ECR repository `prod/hexacode` unless overridden
- builds each backend service with the correct context; `problem-service` uses the repo root so the seed catalog is packaged
- tags images as `<service>-<tagSuffix>`
- logs Docker into ECR unless you pass `-SkipLogin`

Set Terraform `image_tag` to the same suffix before planning ECS changes:

```hcl
image_tag = "abc1234"
```

## Manual Push Workflow

Set common values:

```powershell
$env:AWS_REGION = "us-west-2"
$ACCOUNT_ID = (aws sts get-caller-identity --query Account --output text).Trim()
$GIT_SHA = (git rev-parse --short HEAD).Trim()
$REPOSITORY = "prod/hexacode"
```

Confirm the Terraform-managed repository exists:

```powershell
aws ecr describe-repositories `
  --region $env:AWS_REGION `
  --repository-names $REPOSITORY
```

Log Docker into ECR:

```powershell
aws ecr get-login-password --region $env:AWS_REGION |
  docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com"
```

Build, tag, and push one service:

```powershell
$SERVICE = "problem-service"
$TAG = "$SERVICE-$GIT_SHA"

$BUILD_CONTEXT = if ($SERVICE -eq "problem-service") { "." } else { "./hexacode-backend" }

docker build `
  -f "hexacode-backend/services/$SERVICE/Dockerfile" `
  -t "$SERVICE`:$TAG" `
  $BUILD_CONTEXT

docker tag `
  "$SERVICE`:$TAG" `
  "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY`:$TAG"

docker push "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/$REPOSITORY`:$TAG"
```

Repeat for:

- `identity-service`
- `problem-service`
- `submission-service`
- `worker`

## Verify Images In ECR

```powershell
aws ecr describe-images `
  --region $env:AWS_REGION `
  --repository-name $REPOSITORY
```

Expected image URI shape:

```text
198306925854.dkr.ecr.us-west-2.amazonaws.com/prod/hexacode:problem-service-abc1234
```

That means:

- AWS account: `198306925854` for the current production target; use your own account ID for other deployments
- region: `us-west-2`
- ECR repository: `prod/hexacode`
- tag: `problem-service-abc1234`

## Common Errors

### `no basic auth credentials`

Docker is not logged into ECR anymore. Run the login command again:

```powershell
aws ecr get-login-password --region $env:AWS_REGION |
  docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com"
```

### `RepositoryNotFoundException`

The ECR repository name is wrong, missing, or in another region. Check the Terraform output and selected AWS region:

```powershell
terraform -chdir=terraform output -raw ecr_repository_name
aws ecr describe-repositories --region $env:AWS_REGION --repository-names $REPOSITORY
```

### Docker build fails for a service

Use the repo-specific build context. For `problem-service`, use the repo root so `data/problems` is available to the Dockerfile:

```powershell
docker build -f hexacode-backend/services/problem-service/Dockerfile -t problem-service:$TAG .
```

### `UnrecognizedClientException` or AWS auth failure

AWS CLI credentials are missing, expired, or pointed at the wrong account:

```powershell
aws sts get-caller-identity
aws configure get region
```

Fix credentials before trying again.

## Next Step

Use [aws-production-operator-guide.md](./aws-production-operator-guide.md) for the full production deployment flow after images are pushed.
