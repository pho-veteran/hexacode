# Hexacode AWS Production Operator Guide

This guide explains how to deploy and operate Hexacode on AWS using Terraform, ECR, ECS Fargate, RDS/RDS Proxy, Client VPN, S3, SQS, Cognito, API Gateway, Lambda, and CloudFront.

Do not paste AWS secret keys, passwords, admin passwords, or private certificate material into this file. Use placeholders and environment variables.

## Concepts

### Terraform state

Terraform state records the AWS resources that belong to this deployment. Production state must be remote, encrypted, versioned, and locked so two operators cannot apply conflicting changes at the same time. This repo uses a partial S3 backend in `terraform/versions.tf`; the bucket, key, region, and S3 lockfile setting are supplied during `terraform init -reconfigure`.

### ECR image tags

Terraform owns the ECR repository name through `ecr_repository_name`, and ECS task definitions reference one shared repository URL. Each backend image uses a service-prefixed immutable tag:

- `identity-service-<image_tag>`
- `problem-service-<image_tag>`
- `submission-service-<image_tag>`
- `worker-<image_tag>`

Set Terraform `image_tag` to the same suffix used in the Docker/ECR tags, usually a git SHA or release tag.

### ECS Fargate services

Hexacode runs the API services and judge worker on ECS Fargate in private subnets. `identity-service`, `problem-service`, and `submission-service` sit behind an internal ALB. The worker has no public listener; it polls SQS and calls internal service APIs through the same internal ALB.

### One-off ECS Fargate tasks

Repeatable operational jobs run as one-off Fargate tasks using existing task definitions, private app subnets, and the API-services security group. Use this pattern for initial problem seeding, first-admin promotion, and future migration/maintenance jobs that need private VPC access.

### Private RDS and RDS Proxy

RDS remains private in data subnets. Application tasks connect through RDS Proxy. Do not make RDS public for bootstrap, imports, debugging, or admin promotion.

### Client VPN human access

Approved human database access goes through AWS Client VPN into the VPC, then to the private RDS Proxy endpoint on port `5432`. Client VPN is optional in Terraform and should be enabled only after ACM certificate ARNs are ready.

### Cognito users vs local app roles

Cognito handles browser sign-in and token issuance. Hexacode authorization is local: after first sign-in, the app creates an `app_identity.users` row, and roles are granted in Postgres through `app_identity.user_role_assignments`. Promote the first admin only after that user signs in once.

## Preflight

Before touching production, confirm these are true:

- AWS CLI is configured for the target account and region.
- Docker Desktop is running.
- Terraform 1.7 or newer is installed.
- Docker can build Linux images and log in to Amazon ECR.
- `terraform/terraform.tfvars` exists locally and is not committed.
- `terraform/terraform.tfvars` sets `region = "us-west-2"` for the current production target.
- `application_secret_arn` is empty for the Terraform-managed runtime secret, or points to an existing Secrets Manager secret if intentionally reusing one.
- `chat_lambda_arn` is empty for the Terraform-managed Bedrock chat stack, or points to an external chat Lambda only if intentionally bypassing the built-in module.
- `frontend_domain` is a stable custom frontend URL if available. If using the generated CloudFront domain, plan for the two-pass frontend-domain update described below.
- If Client VPN is enabled, the server and client-root ACM certificate ARNs are available.
- No private certificate material, passwords, or AWS secret keys are pasted into docs or committed files.

Useful checks:

```powershell
aws sts get-caller-identity
aws configure get region
terraform -chdir=terraform version
docker version
```

## Terraform remote state bootstrap

Terraform state should live in an encrypted, versioned S3 bucket with native S3 lockfiles so production changes are durable and serialized across operators.

```powershell
$env:AWS_REGION = "us-west-2"
$env:HEXACODE_TF_STATE_BUCKET = "hexacode-prod-terraform-state-$((aws sts get-caller-identity --query Account --output text).Trim())-$env:AWS_REGION"

aws s3api create-bucket `
  --bucket $env:HEXACODE_TF_STATE_BUCKET `
  --region $env:AWS_REGION `
  --create-bucket-configuration LocationConstraint=$env:AWS_REGION
```

For `us-east-1`, omit `--create-bucket-configuration LocationConstraint=...`. For Hexacode production, keep `$env:AWS_REGION` aligned with the deployment region used in `terraform.tfvars`.

```powershell
aws s3api put-bucket-versioning `
  --bucket $env:HEXACODE_TF_STATE_BUCKET `
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption `
  --bucket $env:HEXACODE_TF_STATE_BUCKET `
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

Initialize Terraform against that backend after the bucket exists:

```powershell
terraform -chdir=terraform init -reconfigure `
  -backend-config="bucket=$env:HEXACODE_TF_STATE_BUCKET" `
  -backend-config="key=prod/terraform.tfstate" `
  -backend-config="region=$env:AWS_REGION" `
  -backend-config="use_lockfile=true" `
  -backend-config="encrypt=true"
```

Expected: Terraform initializes the S3 backend and uses a native S3 lockfile without a DynamoDB lock table.

## Build and push images to ECR

Terraform creates the ECR repository, but Terraform cannot deploy ECS tasks successfully until the referenced image tags exist. From empty state, bootstrap only the Terraform-managed ECR repository first, then push images, then run the full Terraform plan.

```powershell
terraform -chdir=terraform plan -target=module.ecr -out=tfplan-ecr-bootstrap
terraform -chdir=terraform apply tfplan-ecr-bootstrap
```

Set the image tag and ECR coordinates. ECR image tags are immutable, so choose a new suffix for each release, such as an incrementing release number or git SHA.

```powershell
$env:AWS_REGION = "us-west-2"
$env:AWS_ACCOUNT_ID = (aws sts get-caller-identity --query Account --output text).Trim()
$env:ECR_REPOSITORY = "prod/hexacode"
$env:ECR_REGISTRY = "$env:AWS_ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com"
$env:ECR_REPOSITORY_URI = "$env:ECR_REGISTRY/$env:ECR_REPOSITORY"
$env:IMAGE_TAG = "1"
```

Log Docker in to ECR:

```powershell
aws ecr get-login-password --region $env:AWS_REGION |
  docker login --username AWS --password-stdin $env:ECR_REGISTRY
```

Build, tag, and push each service image:

```powershell
$identityImage = "$($env:ECR_REPOSITORY_URI):identity-service-$($env:IMAGE_TAG)"
docker build -f hexacode-backend/services/identity-service/Dockerfile -t "hexacode-identity-service:$env:IMAGE_TAG" hexacode-backend
docker tag "hexacode-identity-service:$env:IMAGE_TAG" $identityImage
docker push $identityImage

$problemImage = "$($env:ECR_REPOSITORY_URI):problem-service-$($env:IMAGE_TAG)"
docker build -f hexacode-backend/services/problem-service/Dockerfile -t "hexacode-problem-service:$env:IMAGE_TAG" .
docker tag "hexacode-problem-service:$env:IMAGE_TAG" $problemImage
docker push $problemImage

$submissionImage = "$($env:ECR_REPOSITORY_URI):submission-service-$($env:IMAGE_TAG)"
docker build -f hexacode-backend/services/submission-service/Dockerfile -t "hexacode-submission-service:$env:IMAGE_TAG" hexacode-backend
docker tag "hexacode-submission-service:$env:IMAGE_TAG" $submissionImage
docker push $submissionImage

$workerImage = "$($env:ECR_REPOSITORY_URI):worker-$($env:IMAGE_TAG)"
docker build -f hexacode-backend/services/worker/Dockerfile -t "hexacode-worker:$env:IMAGE_TAG" hexacode-backend
docker tag "hexacode-worker:$env:IMAGE_TAG" $workerImage
docker push $workerImage
```

Verify the four expected tags exist in ECR:

```powershell
aws ecr describe-images `
  --region $env:AWS_REGION `
  --repository-name $env:ECR_REPOSITORY `
  --query "imageDetails[].imageTags[]" `
  --output text
```

Expected ECR tags:

- `identity-service-$env:IMAGE_TAG`
- `problem-service-$env:IMAGE_TAG`
- `submission-service-$env:IMAGE_TAG`
- `worker-$env:IMAGE_TAG`

Set the same suffix value in `terraform/terraform.tfvars`:

```hcl
image_tag = "git-sha-or-release-tag"
```

## Terraform init, validate, plan, and apply

Run formatting and validation first:

```powershell
terraform -chdir=terraform fmt -recursive
terraform -chdir=terraform validate
```

Create a plan:

```powershell
terraform -chdir=terraform plan -var-file=terraform.tfvars -out=tfplan
```

Stop here and review the plan before applying. Confirm especially:

- region is `us-west-2`
- RDS is private and not publicly accessible
- ECS tasks run without public IPs
- API services and worker use the expected ECR tags
- Client VPN is disabled unless certificate ARNs are intentionally supplied
- no unexpected resource replacement appears for stateful resources

Only apply after the plan has been reviewed:

```powershell
terraform -chdir=terraform apply tfplan
```

After apply, collect the outputs used by later steps:

```powershell
terraform -chdir=terraform output
$env:API_BASE_URL = terraform -chdir=terraform output -raw api_gateway_url
$env:CLOUDFRONT_DISTRIBUTION_ID = terraform -chdir=terraform output -raw cloudfront_distribution_id
$env:FRONTEND_BUCKET = terraform -chdir=terraform output -raw frontend_bucket_name
$env:ECS_CLUSTER = terraform -chdir=terraform output -raw ecs_cluster_name
```

Verify core AWS resources exist:

```powershell
aws ecs describe-clusters --region $env:AWS_REGION --clusters $env:ECS_CLUSTER
aws ecs describe-services --region $env:AWS_REGION --cluster $env:ECS_CLUSTER --services `
  (terraform -chdir=terraform output -raw identity_service_name) `
  (terraform -chdir=terraform output -raw problem_service_name) `
  (terraform -chdir=terraform output -raw submission_service_name) `
  (terraform -chdir=terraform output -raw worker_service_name)
aws rds describe-db-instances --region $env:AWS_REGION --db-instance-identifier "hexacode-prod-db"
aws rds describe-db-proxies --region $env:AWS_REGION --db-proxy-name "hexacode-prod-db-proxy"
aws sqs get-queue-attributes --region $env:AWS_REGION --queue-url (terraform -chdir=terraform output -raw judge_queue_url) --attribute-names All
```

If `frontend_domain` was a placeholder because the release uses the generated CloudFront domain, update `terraform/terraform.tfvars` after the first apply:

```hcl
frontend_domain = "https://<cloudfront-domain-output>"
```

Then run a second reviewed plan/apply so Cognito callback/logout URLs, API Gateway CORS, CORS Lambda, and chat Lambda allowed origin all match the real browser origin:

```powershell
terraform -chdir=terraform plan -var-file=terraform.tfvars -out=tfplan-frontend-domain
terraform -chdir=terraform apply tfplan-frontend-domain
```

## Frontend build, upload, and CloudFront invalidation

Build the React frontend as static assets. Do not deploy the frontend dev server as a production container. Before building, set the public browser environment from Terraform outputs:

```powershell
$env:PUBLIC_API_BASE_URL = terraform -chdir=terraform output -raw api_gateway_url
$env:PUBLIC_COGNITO_CLIENT_ID = terraform -chdir=terraform output -raw cognito_app_client_id
$env:PUBLIC_COGNITO_REGION = $env:AWS_REGION
$env:PUBLIC_COGNITO_DOMAIN = "https://hexacode-prod.auth.$env:AWS_REGION.amazoncognito.com"
$env:PUBLIC_COGNITO_SCOPES = "openid email profile"
```

```powershell
npm --prefix hexacode-frontend install
npm --prefix hexacode-frontend run build
```

Upload the built files to the private frontend bucket created by Terraform:

```powershell
$env:FRONTEND_BUCKET = terraform -chdir=terraform output -raw frontend_bucket_name
aws s3 sync hexacode-frontend/dist "s3://$env:FRONTEND_BUCKET" --delete --region $env:AWS_REGION
```

Invalidate CloudFront so users receive the new static files:

```powershell
$env:CLOUDFRONT_DISTRIBUTION_ID = terraform -chdir=terraform output -raw cloudfront_distribution_id
aws cloudfront create-invalidation --distribution-id $env:CLOUDFRONT_DISTRIBUTION_ID --paths "/*"
```

Expected: CloudFront serves the new frontend and the frontend points to the production API Gateway/Cognito settings for the release.

## Seed initial problems

Use a one-off ECS Fargate task for the initial problem catalog import. Build and push the problem-service image tag referenced by Terraform before running the seed task. The production problem-service image includes `scripts/import_problem_catalog.py` and the curated `data/problems` catalog at `/app/data/problems`.

Set the shared task values from Terraform outputs:

```powershell
$env:AWS_REGION = "us-west-2"
$env:ECS_CLUSTER = terraform -chdir=terraform output -raw ecs_cluster_name
$env:PRIVATE_SUBNETS = (terraform -chdir=terraform output -json private_app_subnet_ids | ConvertFrom-Json) -join ","
$env:API_SG = terraform -chdir=terraform output -raw sg_api_services_id
$env:PROBLEM_TASK_DEF = terraform -chdir=terraform output -raw problem_task_definition_arn
```

Run the seed task:

```powershell
$seedOverride = @{
  containerOverrides = @(
    @{
      name = "problem-service"
      command = @("python", "scripts/import_problem_catalog.py", "--catalog-dir", "/app/data/problems", "--skip-env-file", "--fail-on-existing")
    }
  )
} | ConvertTo-Json -Compress -Depth 5

$seedTask = aws ecs run-task `
  --region $env:AWS_REGION `
  --cluster $env:ECS_CLUSTER `
  --launch-type FARGATE `
  --task-definition $env:PROBLEM_TASK_DEF `
  --network-configuration "awsvpcConfiguration={subnets=[$env:PRIVATE_SUBNETS],securityGroups=[$env:API_SG],assignPublicIp=DISABLED}" `
  --overrides $seedOverride `
  --query "tasks[0].taskArn" `
  --output text

$env:TASK_ARN = $seedTask.Trim()
aws ecs wait tasks-stopped --region $env:AWS_REGION --cluster $env:ECS_CLUSTER --tasks $env:TASK_ARN
aws ecs describe-tasks --region $env:AWS_REGION --cluster $env:ECS_CLUSTER --tasks $env:TASK_ARN --query "tasks[0].containers[0].exitCode"
aws logs tail /ecs/hexacode-prod/problem-service --region $env:AWS_REGION --since 30m
```

Expected: exit code is `0`, logs print JSON with created/imported problem counts, and the frontend problem list shows seeded problems.

## Promote initial admin

The user must sign in through Cognito once before promotion so the app has a local `app_identity.users` row to update.

```powershell
$env:IDENTITY_TASK_DEF = terraform -chdir=terraform output -raw identity_task_definition_arn
$env:ADMIN_USERNAME = "username-that-signed-in-once"

$adminOverride = @{
  containerOverrides = @(
    @{
      name = "identity-service"
      command = @("python", "scripts/promote_admin.py", "--username", $env:ADMIN_USERNAME)
    }
  )
} | ConvertTo-Json -Compress -Depth 5

$adminTask = aws ecs run-task `
  --region $env:AWS_REGION `
  --cluster $env:ECS_CLUSTER `
  --launch-type FARGATE `
  --task-definition $env:IDENTITY_TASK_DEF `
  --network-configuration "awsvpcConfiguration={subnets=[$env:PRIVATE_SUBNETS],securityGroups=[$env:API_SG],assignPublicIp=DISABLED}" `
  --overrides $adminOverride `
  --query "tasks[0].taskArn" `
  --output text

$env:TASK_ARN = $adminTask.Trim()
aws ecs wait tasks-stopped --region $env:AWS_REGION --cluster $env:ECS_CLUSTER --tasks $env:TASK_ARN
aws ecs describe-tasks --region $env:AWS_REGION --cluster $env:ECS_CLUSTER --tasks $env:TASK_ARN --query "tasks[0].containers[0].exitCode"
aws logs tail /ecs/hexacode-prod/identity-service --region $env:AWS_REGION --since 30m
```

Expected: exit code is `0`, and task logs include JSON with `"promoted": true` and `"role_code": "admin"`.

## Production smoke tests

Run this checklist before opening traffic broadly:

- [ ] Cognito sign-up/sign-in works.
- [ ] `/api/auth/me` returns the signed-in user.
- [ ] Initial admin has the `admin` role locally.
- [ ] Problem catalog import exits with code 0.
- [ ] Problem listing shows seeded published problems.
- [ ] Problem detail loads statements and sample cases.
- [ ] Bedrock chatbot returns a response.
- [ ] Chat misconfiguration returns a visible, non-secret error.
- [ ] Practice submission returns `202`.
- [ ] SQS queue receives and drains the judge job.
- [ ] ECS Fargate worker logs show job execution.
- [ ] Submission detail shows final verdict/results.
- [ ] Another user cannot read that submission source or private artifacts.
- [ ] Client VPN can reach the RDS Proxy endpoint on port 5432.

Use these commands with a real browser user token for API smoke tests:

```powershell
$env:API_BASE_URL = terraform -chdir=terraform output -raw api_gateway_url
$env:ECS_CLUSTER = terraform -chdir=terraform output -raw ecs_cluster_name
$env:JUDGE_QUEUE_URL = terraform -chdir=terraform output -raw judge_queue_url
$env:ACCESS_TOKEN = "paste-cognito-access-token-from-browser-session"

aws ecs describe-services --region $env:AWS_REGION --cluster $env:ECS_CLUSTER --services `
  (terraform -chdir=terraform output -raw identity_service_name) `
  (terraform -chdir=terraform output -raw problem_service_name) `
  (terraform -chdir=terraform output -raw submission_service_name) `
  (terraform -chdir=terraform output -raw worker_service_name)

Invoke-RestMethod -Method Get `
  -Uri "$env:API_BASE_URL/api/auth/me" `
  -Headers @{ Authorization = "Bearer $env:ACCESS_TOKEN" }

Invoke-RestMethod -Method Get `
  -Uri "$env:API_BASE_URL/api/problems" `
  -Headers @{ Authorization = "Bearer $env:ACCESS_TOKEN" }

$chatBody = @{
  sessionId = "smoke-$(Get-Date -Format yyyyMMddHHmmss)"
  messages = @(
    @{ role = "user"; content = "Give me one hint for solving coding problems." }
  )
  pageContext = @{ route = "/problems"; area = "public" }
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post `
  -Uri "$env:API_BASE_URL/api/chat/messages" `
  -ContentType "application/json" `
  -Headers @{ Authorization = "Bearer $env:ACCESS_TOKEN" } `
  -Body $chatBody

aws sqs get-queue-attributes `
  --region $env:AWS_REGION `
  --queue-url $env:JUDGE_QUEUE_URL `
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible

aws logs tail /ecs/hexacode-prod/worker --region $env:AWS_REGION --since 30m
```

Create one practice submission from the browser, then rerun the SQS and worker-log commands. The queue should drain and the submission detail page should show a final verdict. Verify cross-user denial by signing in as a second user and requesting the first user's `/api/submissions/<id>/source`; it should return 403 or 404.

## Debugging and rollback

Start with the smallest failing boundary and keep production state in Terraform:

- Frontend stale or broken: re-upload `hexacode-frontend/dist` and create a CloudFront invalidation.
- API route broken: check API Gateway access logs, VPC Link status, ALB target health, and the target ECS service logs.
- Service unhealthy: inspect ECS service events, task stopped reasons, CloudWatch logs, and Secrets Manager/env wiring.
- Database errors: verify RDS Proxy target health, security groups, and the app secret used for `DATABASE_URL`.
- Queue stuck: check SQS visible/not-visible counts, worker service desired/running count, and worker logs.
- Secrets Manager recreate failure after teardown: if `hexacode-prod-app` is scheduled for deletion, restore it and import it before retrying Terraform.
  ```powershell
  aws secretsmanager restore-secret --region $env:AWS_REGION --secret-id hexacode-prod-app
  terraform -chdir=terraform import 'aws_secretsmanager_secret.application[0]' <restored-secret-arn>
  ```
- Bedrock alias failures: Terraform should manage only the alias used by the chat Lambda. If an obsolete failed alias remains from an interrupted apply, remove that obsolete address from state after confirming the module no longer declares it.
  ```powershell
  terraform -chdir=terraform state rm 'module.bedrock_chat.aws_bedrockagent_agent_alias.live'
  ```
- Chat broken: check API Gateway integration for `/api/chat/messages`, Lambda logs, Bedrock Agent alias state, Bedrock permissions, and non-secret error responses.
- Unexpected extra CloudFront distribution: compare `terraform -chdir=terraform output -raw cloudfront_distribution_id` with the console distribution ID. Only the Terraform output is managed by this deployment; do not delete older distributions until DNS/bookmarks have been checked.
- Bad image release: push a fixed image tag, set `image_tag` in `terraform.tfvars`, run `terraform plan`, review, and apply.
- Bad infrastructure change: prefer reverting the Terraform code/input that caused it and applying a reviewed plan; do not hand-edit shared AWS resources unless it is an emergency.

For rollback, keep the previous image tag available in ECR. Set `image_tag` back to the last known-good suffix, create a new Terraform plan, review it, and apply. For frontend rollback, sync the previous built artifact to S3 and invalidate CloudFront.

## Deployment journal

Record every production deployment in a journal entry outside committed secrets. Use this template:

```markdown
## YYYY-MM-DD release-name

- Operator:
- AWS account alias or ID:
- Region:
- Git SHA:
- Terraform image_tag:
- Terraform plan file:
- ECR tags pushed:
- Frontend artifact source:
- Terraform apply start/end:
- Smoke test result:
- Issues found:
- Rollback tag/artifact:
- Follow-ups:
```

Do not paste secrets, private certificate material, admin passwords, raw tokens, or database passwords into the journal.
