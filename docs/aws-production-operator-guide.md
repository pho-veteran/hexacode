# Hexacode AWS Production Operator Guide

This guide explains how to deploy and operate Hexacode on AWS using Terraform, ECR, ECS Fargate, RDS/RDS Proxy, Client VPN, S3, SQS, Cognito, API Gateway, Lambda, WAF, Network Firewall, EFS, AWS Backup, and CloudFront.

The current W5 cloud-debugging deployment target is `hexacode-dev`. Do not touch the existing live `hexacode-prod` stack, ECR repository, VPC, state, or frontend distribution unless the deployment owner explicitly changes the target environment.

Do not paste AWS secret keys, passwords, admin passwords, private certificate material, Cognito tokens, or database passwords into this file. Use placeholders and environment variables.

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

Before touching AWS, confirm these are true:

- AWS CLI is configured for the target account and region.
- Docker Desktop is running.
- Terraform 1.7 or newer is installed.
- Docker can build Linux images and log in to Amazon ECR.
- The current W5 target is `hexacode-dev`, not `hexacode-prod`.
- `terraform/terraform-dev.tfvars` exists locally, is copied from `terraform/terraform-dev.tfvars.example`, and is not committed.
- `terraform/terraform-dev.tfvars` sets `region = "us-west-2"`, `environment = "dev"`, `cidr_block = "10.21.0.0/16"`, and `ecr_repository_name = "dev/hexacode"` unless the deployment owner explicitly chooses different dev-only values.
- `terraform/backend-dev.hcl` exists locally, is copied from `terraform/backend-dev.hcl.example`, and uses a `dev/terraform.tfstate` key or a separate dev state bucket.
- `terraform/terraform.tfvars` and `terraform/backend-prod.hcl` are production inputs. Do not use them for the W5 dev deployment.
- `application_secret_arn` is empty for the Terraform-managed dev runtime secret, or points to an existing dev Secrets Manager secret if intentionally reusing one.
- `frontend_domain` can be empty for the first dev apply. If using the generated dev CloudFront domain, plan for the two-pass frontend-domain update described below.
- If Client VPN is enabled, the server and client-root ACM certificate ARNs are dev-safe and not copied from prod by accident.
- No private certificate material, passwords, AWS secret keys, or raw browser tokens are pasted into docs or committed files.

Stop immediately if a plan, command, output, or console page references `hexacode-prod`, `prod/terraform.tfstate`, `prod/hexacode`, or the existing production CloudFront domain during the dev deployment flow.

Useful read-only checks:

```powershell
aws sts get-caller-identity
aws configure get region
terraform -chdir=terraform version
docker version
```

## W5 dev environment files

Create local dev deployment inputs from the checked-in templates. These local files are intentionally ignored by git.

```powershell
Copy-Item terraform/terraform-dev.tfvars.example terraform/terraform-dev.tfvars
Copy-Item terraform/backend-dev.hcl.example terraform/backend-dev.hcl
```

Review `terraform/terraform-dev.tfvars` before planning. Minimum dev isolation values:

```hcl
environment         = "dev"
cidr_block          = "10.21.0.0/16"
ecr_repository_name = "dev/hexacode"
image_tag           = "dev-git-sha"
frontend_domain     = ""
```

Use `frontend_domain = ""` only for the first dev apply. After Terraform creates the dev CloudFront distribution, set it to `https://<dev-cloudfront-domain>` and run a second reviewed dev plan/apply so Cognito callbacks, API Gateway CORS, CORS Lambda, and the chat Lambda allowed origin match the dev browser origin.

## Terraform remote state bootstrap

Terraform state should live in an encrypted, versioned S3 bucket with native S3 lockfiles so changes are durable and serialized across operators. For W5, bootstrap a dev state bucket or confirm the dev bucket already exists. This is the first mutating AWS step; do it only after the read-only checks and target environment review pass.

```powershell
$env:AWS_REGION = "us-west-2"
$env:AWS_ACCOUNT_ID = (aws sts get-caller-identity --query Account --output text).Trim()
$env:HEXACODE_TF_STATE_BUCKET = "hexacode-dev-terraform-state-$env:AWS_ACCOUNT_ID-$env:AWS_REGION"

aws s3api create-bucket `
  --bucket $env:HEXACODE_TF_STATE_BUCKET `
  --region $env:AWS_REGION `
  --create-bucket-configuration LocationConstraint=$env:AWS_REGION
```

For `us-east-1`, omit `--create-bucket-configuration LocationConstraint=...`. The W5 dev deployment uses `us-west-2`.

```powershell
aws s3api put-bucket-versioning `
  --bucket $env:HEXACODE_TF_STATE_BUCKET `
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption `
  --bucket $env:HEXACODE_TF_STATE_BUCKET `
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

Initialize Terraform against the dev backend after the bucket exists:

```powershell
terraform -chdir=terraform init -reconfigure -backend-config=backend-dev.hcl
```

Expected: Terraform initializes the S3 backend and uses `dev/terraform.tfstate`. Stop if Terraform reports `prod/terraform.tfstate` or the prod state bucket.

## Build and push images to ECR

Terraform creates the ECR repository, but Terraform cannot deploy ECS tasks successfully until the referenced image tags exist. From empty dev state, bootstrap only the Terraform-managed dev ECR repository first, then push images, then run the full dev Terraform plan.

```powershell
terraform -chdir=terraform plan -var-file=terraform-dev.tfvars -target=module.ecr -out=tfplan-dev-ecr-bootstrap
terraform -chdir=terraform show -no-color tfplan-dev-ecr-bootstrap | Select-String "hexacode-prod|prod/hexacode|prod/terraform.tfstate"
terraform -chdir=terraform apply tfplan-dev-ecr-bootstrap
```

Expected: the review command prints no matches. Set the image tag and ECR coordinates. ECR image tags are immutable, so choose a new dev suffix for each rollout, such as `dev-<git-sha>`.

```powershell
$env:AWS_REGION = "us-west-2"
$env:AWS_ACCOUNT_ID = (aws sts get-caller-identity --query Account --output text).Trim()
$env:ECR_REPOSITORY = "dev/hexacode"
$env:ECR_REGISTRY = "$env:AWS_ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com"
$env:ECR_REPOSITORY_URI = "$env:ECR_REGISTRY/$env:ECR_REPOSITORY"
$env:IMAGE_TAG = "dev-$((git rev-parse --short HEAD).Trim())"
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

Set the same suffix value in `terraform/terraform-dev.tfvars`:

```hcl
image_tag = "dev-git-sha"
```

You can use the repo helper instead of manual Docker commands. If the helper's nested Docker login fails after the manual login above succeeded, rerun it with `-SkipLogin` so it reuses the current Docker ECR session:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/push-ecr.ps1 `
  -Region $env:AWS_REGION `
  -Repository $env:ECR_REPOSITORY `
  -TagSuffix $env:IMAGE_TAG

# Use only after the manual docker login command above succeeded.
powershell -ExecutionPolicy Bypass -File scripts/push-ecr.ps1 `
  -Region $env:AWS_REGION `
  -Repository $env:ECR_REPOSITORY `
  -TagSuffix $env:IMAGE_TAG `
  -SkipLogin
```

Because the dev ECR repository uses immutable tags, a partially completed push may leave one service tag present even if a later service build fails. Do not overwrite that tag. Choose a fresh dev suffix such as `dev-<gitsha>-r1`, push all four images again, then set the same fresh suffix in `terraform/terraform-dev.tfvars`.

## Terraform init, validate, plan, and apply

Run formatting and validation first:

```powershell
terraform -chdir=terraform fmt -recursive
terraform -chdir=terraform validate
```

Create a dev plan:

```powershell
terraform -chdir=terraform plan -var-file=terraform-dev.tfvars -out=tfplan-dev
terraform -chdir=terraform show -no-color tfplan-dev > tfplan-dev.txt
Select-String -Path terraform/tfplan-dev.txt -Pattern "hexacode-prod|prod/hexacode|prod/terraform.tfstate"
```

Stop here and review the plan before applying. Confirm especially:

- region is `us-west-2`
- environment is `dev`
- planned resource names use `hexacode-dev`, not `hexacode-prod`
- Terraform state key is `dev/terraform.tfstate`
- ECR repository is `dev/hexacode`
- VPC CIDR does not overlap the existing prod VPC
- RDS is private and not publicly accessible
- ECS tasks run without public IPs
- API services and worker use the expected dev ECR tags
- WAF, Network Firewall, VPC Flow Logs, EFS, AWS Backup, API Gateway JWT auth, chat throttling, and chat Lambda reserved concurrency appear in the plan
- Client VPN is disabled unless dev certificate ARNs are intentionally supplied
- no existing `hexacode-prod` resource appears as updated, replaced, or destroyed

Only apply after the dev plan has been reviewed and the deployment owner approves the AWS mutation:

```powershell
terraform -chdir=terraform apply tfplan-dev
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
aws rds describe-db-instances --region $env:AWS_REGION --db-instance-identifier "hexacode-dev-db"
aws rds describe-db-proxies --region $env:AWS_REGION --db-proxy-name "hexacode-dev-db-proxy"
aws sqs get-queue-attributes --region $env:AWS_REGION --queue-url (terraform -chdir=terraform output -raw judge_queue_url) --attribute-names All
```

If `frontend_domain` was empty because the release uses the generated CloudFront domain, update `terraform/terraform-dev.tfvars` after the first dev apply:

```hcl
frontend_domain = "https://<dev-cloudfront-domain-output>"
```

Then run a second reviewed dev plan/apply so Cognito callback/logout URLs, API Gateway CORS, CORS Lambda, and chat Lambda allowed origin all match the real browser origin:

```powershell
terraform -chdir=terraform plan -var-file=terraform-dev.tfvars -out=tfplan-dev-frontend-domain
terraform -chdir=terraform show -no-color tfplan-dev-frontend-domain | Select-String "hexacode-prod|prod/hexacode|prod/terraform.tfstate"
terraform -chdir=terraform apply tfplan-dev-frontend-domain
```

## Frontend build, upload, and CloudFront invalidation

Build the React frontend as static assets. Do not deploy the frontend dev server as a production container. Before building, set the public browser environment from Terraform outputs:

```powershell
$env:PUBLIC_API_BASE_URL = terraform -chdir=terraform output -raw api_gateway_url
$env:PUBLIC_COGNITO_CLIENT_ID = terraform -chdir=terraform output -raw cognito_app_client_id
$env:PUBLIC_COGNITO_REGION = $env:AWS_REGION
$env:PUBLIC_COGNITO_DOMAIN = "https://hexacode-dev.auth.$env:AWS_REGION.amazoncognito.com"
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

Expected: CloudFront serves the new frontend and the frontend points to the dev API Gateway/Cognito settings for the W5 rollout.

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
aws logs tail /ecs/hexacode-dev/problem-service --region $env:AWS_REGION --since 30m
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
aws logs tail /ecs/hexacode-dev/identity-service --region $env:AWS_REGION --since 30m
```

Expected: exit code is `0`, and task logs include JSON with `"promoted": true` and `"role_code": "admin"`.

## W5 dev smoke tests

Run this checklist before opening traffic broadly. These tests collect dev evidence only; do not use prod tokens, prod CloudFront URLs, or prod ECS/log resources.

- [ ] Cognito sign-up/sign-in works.
- [ ] `/api/auth/me` returns the signed-in user.
- [ ] Initial admin has the `admin` role locally.
- [ ] Problem catalog import exits with code 0.
- [ ] Problem listing shows seeded published problems.
- [ ] Problem detail loads statements and sample cases.
- [ ] Bedrock chatbot returns a response through API Gateway JWT auth.
- [ ] Unauthenticated chat requests are rejected before Lambda invocation.
- [ ] Chat throttling and Lambda reserved concurrency are visible in AWS configuration.
- [ ] WAF Web ACLs are attached to CloudFront and the regional ALB target.
- [ ] Network Firewall endpoints, logs, and private route table routes are present for dev.
- [ ] VPC Flow Logs are writing to the dev CloudWatch log group.
- [ ] EFS mount targets and access point exist, and submission-service/worker task definitions mount EFS with transit encryption.
- [ ] AWS Backup vault and daily plan cover dev RDS and EFS.
- [ ] Practice submission returns `202`.
- [ ] SQS queue receives and drains the judge job.
- [ ] ECS Fargate worker logs show job execution.
- [ ] Submission detail shows final verdict/results.
- [ ] Another user cannot read that submission source or private artifacts.
- [ ] Client VPN can reach the RDS Proxy endpoint on port 5432 if Client VPN is enabled for dev.

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

aws logs tail /ecs/hexacode-dev/worker --region $env:AWS_REGION --since 30m
```

Create one practice submission from the browser, then rerun the SQS and worker-log commands. The queue should drain and the submission detail page should show a final verdict. Verify cross-user denial by signing in as a second user and requesting the first user's `/api/submissions/<id>/source`; it should return 403 or 404.

## Debugging and rollback

Start with the smallest failing boundary and keep production state in Terraform:

- Frontend stale or broken: re-upload `hexacode-frontend/dist` and create a CloudFront invalidation.
- API route broken: check API Gateway access logs, VPC Link status, ALB target health, and the target ECS service logs.
- Service unhealthy: inspect ECS service events, task stopped reasons, CloudWatch logs, and Secrets Manager/env wiring.
- Database errors: verify RDS Proxy target health, security groups, and the app secret used for `DATABASE_URL`.
- Queue stuck: check SQS visible/not-visible counts, worker service desired/running count, and worker logs.
- Secrets Manager recreate failure after dev teardown: if `hexacode-dev-app` is scheduled for deletion, restore it and import it before retrying Terraform.
  ```powershell
  aws secretsmanager restore-secret --region $env:AWS_REGION --secret-id hexacode-dev-app
  terraform -chdir=terraform import 'aws_secretsmanager_secret.application[0]' <restored-secret-arn>
  ```
- Bedrock alias failures: Terraform should manage only the alias used by the chat Lambda. If an obsolete failed alias remains from an interrupted apply, remove that obsolete address from state after confirming the module no longer declares it.
  ```powershell
  terraform -chdir=terraform state rm 'module.bedrock_chat.aws_bedrockagent_agent_alias.live'
  ```
- Chat broken: check API Gateway integration for `/api/chat/messages`, Lambda logs, Bedrock Agent alias state, Bedrock permissions, and non-secret error responses.
- Unexpected extra CloudFront distribution: compare `terraform -chdir=terraform output -raw cloudfront_distribution_id` with the console distribution ID. Only the Terraform output is managed by this deployment; do not delete older distributions until DNS/bookmarks have been checked.
- Bad dev image release: push a fixed dev image tag, set `image_tag` in `terraform-dev.tfvars`, run a reviewed dev Terraform plan, and apply only after approval.
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
