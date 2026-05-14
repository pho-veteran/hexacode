# AWS Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Hexacode production-ready on AWS ECS Fargate, then deploy and document the end-to-end production rollout.

**Architecture:** Terraform is the source of truth for AWS infrastructure, including ECR, ECS Fargate services, private networking, RDS/RDS Proxy, Client VPN, queues, storage, and edge resources. Backend images are built locally or by automation, pushed to ECR with service-specific tags, deployed to ECS Fargate, seeded through one-off ECS tasks, and verified through production smoke tests. Human database access uses Client VPN; repeatable database operations use ECS Fargate one-off tasks.

**Tech Stack:** Terraform 1.7+, AWS ECS Fargate, ECR, VPC, Client VPN, RDS PostgreSQL, RDS Proxy, ElastiCache Redis, S3, SQS, Cognito, API Gateway, Lambda, CloudFront, FastAPI, React/Vite, PowerShell, Docker.

---

## Repo Rule

Do not create git commits while executing this plan unless the user explicitly asks. Each task includes a verification checkpoint instead of a commit step.

## File Structure

### Terraform root

- Modify: `terraform/versions.tf` — add partial S3 backend configuration.
- Modify: `terraform/main.tf` — add ECR and Client VPN modules/resources; pass corrected ECS values.
- Modify: `terraform/variables.tf` — add variables for Terraform backend documentation support, ECR, Client VPN, and production safety inputs.
- Modify: `terraform/outputs.tf` — output ECR URL, Client VPN endpoint details, RDS Proxy endpoint, and smoke-test values.
- Modify: `terraform/terraform.tfvars.example` — align region and variables with production-ready defaults and remove misleading stale values.

### Terraform modules

- Modify: `terraform/modules/ecs-services/main.tf` — align image tags and runtime environment variables with backend code; add reusable one-off task definitions if needed.
- Modify: `terraform/modules/ecs-services/variables.tf` — add service URL and image repository inputs.
- Modify: `terraform/modules/ecs-services/outputs.tf` — output task definition ARNs needed for one-off seed tasks.
- Modify: `terraform/modules/security-groups/main.tf` — add Client VPN security group and RDS Proxy ingress from VPN.
- Modify: `terraform/modules/security-groups/outputs.tf` — output Client VPN security group ID.
- Create: `terraform/modules/ecr/main.tf` — Terraform-managed ECR repository.
- Create: `terraform/modules/ecr/variables.tf` — ECR module inputs.
- Create: `terraform/modules/ecr/outputs.tf` — ECR repository URL/ARN/name outputs.
- Create: `terraform/modules/client-vpn/main.tf` — Client VPN endpoint, subnet associations, authorization, routes, logging.
- Create: `terraform/modules/client-vpn/variables.tf` — Client VPN inputs.
- Create: `terraform/modules/client-vpn/outputs.tf` — Client VPN endpoint ID/DNS/status outputs.

### Backend

- Modify: `hexacode-backend/services/submission-service/app/main.py` — require auth for submission detail/results and enforce owner-or-privileged access.
- Modify: `hexacode-backend/backend_common/authz.py` — add a small helper for owner-or-permission authorization.
- Create: `hexacode-backend/scripts/promote_admin.py` — idempotently grant the local `admin` role to a user after first Cognito sign-in.
- Modify: `hexacode-backend/services/identity-service/Dockerfile` or `hexacode-backend/services/problem-service/Dockerfile` — include `promote_admin.py` in the image used for one-off admin bootstrap.
- Modify: `hexacode-backend/services/problem-service/Dockerfile` — include `data/problems` in the image or document an S3/object-copy alternative. Preferred for first rollout: include `data/problems` so the one-off Fargate import task is self-contained.

### Scripts and docs

- Modify: `scripts/push-ecr.ps1` — keep tag convention as `identity-service-<tag>`, `problem-service-<tag>`, `submission-service-<tag>`, `worker-<tag>`; update output to print Terraform `image_tag` value.
- Modify: `docs/ecr.md` — align with Terraform-managed ECR and script behavior.
- Modify: `docs/aws-deployment-walkthrough.md` — replace stale manual walkthrough with the operator guide.
- Modify: `docs/aws.md` — update production architecture notes for Client VPN, one-off ECS tasks, and ECR ownership.
- Create: `docs/aws-production-operator-guide.md` — learning runbook and deployment journal.

---

## Task 1: Protect Submission Detail and Results APIs

**Files:**
- Modify: `hexacode-backend/backend_common/authz.py`
- Modify: `hexacode-backend/services/submission-service/app/main.py`

- [ ] **Step 1: Add an owner-or-permission helper**

Add this function to `hexacode-backend/backend_common/authz.py` after `require_local_any_permission`:

```python
def require_owner_or_local_any_permission(
    local_user: dict[str, Any],
    owner_user_id: str,
    permission_codes: Iterable[str],
    *,
    detail: str,
) -> None:
    if str(local_user.get("id")) == str(owner_user_id):
        return
    require_local_any_permission(local_user, permission_codes, detail=detail)
```

- [ ] **Step 2: Include owner ID in submission detail lookup**

In `hexacode-backend/services/submission-service/app/main.py`, update `get_submission_row()` so the `select` list includes the owner:

```sql
submissions.user_id::text as user_id,
```

Place it immediately after `submissions.id::text as id,`.

- [ ] **Step 3: Include owner ID in result lookup**

Change `list_submission_results(submission_id: str)` into a function that returns both the submission owner and result rows:

```python
def get_submission_results_payload(submission_id: str) -> dict[str, Any] | None:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select id::text as id, user_id::text as user_id
                from submission.submissions
                where id = %s::uuid
                """,
                (submission_id,),
            )
            submission_row = cursor.fetchone()
            if submission_row is None:
                return None

            cursor.execute(
                """
                select
                  results.id::text as id,
                  results.testcase_id::text as testcase_id,
                  testcases.ordinal as testcase_ordinal,
                  results.result_type_code,
                  results.status_code,
                  results.runtime_ms,
                  results.memory_kb,
                  results.input_preview,
                  results.expected_output_preview,
                  results.actual_output_preview,
                  results.stdout_object_id::text as stdout_object_id,
                  results.stderr_object_id::text as stderr_object_id,
                  results.checker_message,
                  results.exit_code,
                  results.signal,
                  results.message,
                  results.note,
                  results.created_at
                from submission.results as results
                left join problem.testcases as testcases on testcases.id = results.testcase_id
                where results.submission_id = %s::uuid
                order by
                  case results.result_type_code
                    when 'compile' then 0
                    when 'testcase' then 1
                    when 'custom_case' then 2
                    else 3
                  end asc,
                  testcases.ordinal asc nulls first,
                  results.created_at asc
                """,
                (submission_id,),
            )
            return {
                "submission_id": submission_id,
                "user_id": submission_row["user_id"],
                "results": list(cursor.fetchall()),
            }
```

- [ ] **Step 4: Import the helper and permission constants**

Update the `authz` import in `submission-service/app/main.py`:

```python
from backend_common.authz import (
    PERM_OPS_READ_DASHBOARD,
    PERM_SUBMISSION_CREATE,
    PERM_SUBMISSION_READ_PUBLIC_DETAIL,
    PERM_SUBMISSION_READ_PUBLIC_SUMMARY,
    require_local_permission,
    require_owner_or_local_any_permission,
)
```

- [ ] **Step 5: Protect submission detail endpoint**

Replace the existing endpoint:

```python
@app.get("/api/submissions/{submission_id}")
async def get_submission(submission_id: str) -> dict[str, Any]:
```

with:

```python
@app.get("/api/submissions/{submission_id}")
async def get_submission(
    submission_id: str,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    submission = get_submission_row(submission_id)
    if submission is None:
        raise HTTPException(status_code=404, detail=f"Submission '{submission_id}' was not found.")
    require_owner_or_local_any_permission(
        local_user,
        submission["user_id"],
        (PERM_SUBMISSION_READ_PUBLIC_SUMMARY, PERM_SUBMISSION_READ_PUBLIC_DETAIL),
        detail="You do not have permission to read this submission.",
    )
    return {"data": submission}
```

- [ ] **Step 6: Protect submission results endpoint**

Replace the existing endpoint body with:

```python
@app.get("/api/submissions/{submission_id}/results")
async def get_submission_results(
    submission_id: str,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    payload = get_submission_results_payload(submission_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Submission '{submission_id}' was not found.")
    require_owner_or_local_any_permission(
        local_user,
        payload["user_id"],
        (PERM_SUBMISSION_READ_PUBLIC_DETAIL,),
        detail="You do not have permission to read this submission's results.",
    )
    return {
        "data": {
            "submission_id": submission_id,
            "results": payload["results"],
        }
    }
```

- [ ] **Step 7: Run local syntax verification**

Run:

```bash
python -m py_compile hexacode-backend/backend_common/authz.py hexacode-backend/services/submission-service/app/main.py
```

Expected: command exits with code `0` and prints no syntax errors.

- [ ] **Step 8: Run local stack smoke check for auth behavior**

Run the stack if it is not already running:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

Manual expected behavior:

- `GET /api/submissions/{id}` without a token returns auth failure.
- owner token can read the submission.
- different contestant token cannot read it.
- admin/moderator token with submission read permission can read it.

Checkpoint: tell the user the exact URLs, status codes, and tokens used. Do not commit unless explicitly asked.

---

## Task 2: Terraform-Manage ECR and Align Image Tags

**Files:**
- Create: `terraform/modules/ecr/main.tf`
- Create: `terraform/modules/ecr/variables.tf`
- Create: `terraform/modules/ecr/outputs.tf`
- Modify: `terraform/main.tf`
- Modify: `terraform/variables.tf`
- Modify: `terraform/outputs.tf`
- Modify: `terraform/modules/ecs-services/main.tf`
- Modify: `scripts/push-ecr.ps1`

- [ ] **Step 1: Create ECR module variables**

Create `terraform/modules/ecr/variables.tf`:

```hcl
variable "environment" {
  description = "Environment name"
  type        = string
}

variable "repository_name" {
  description = "ECR repository name"
  type        = string
}
```

- [ ] **Step 2: Create ECR module resources**

Create `terraform/modules/ecr/main.tf`:

```hcl
resource "aws_ecr_repository" "hexacode" {
  name                 = var.repository_name
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name = "hexacode-${var.environment}-ecr"
  }
}

resource "aws_ecr_lifecycle_policy" "hexacode" {
  repository = aws_ecr_repository.hexacode.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the most recent 30 images per service tag prefix"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["identity-service-", "problem-service-", "submission-service-", "worker-"]
          countType     = "imageCountMoreThan"
          countNumber   = 30
        }
        action = {
          type = "expire"
        }
      },
      {
        rulePriority = 2
        description  = "Expire untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
```

- [ ] **Step 3: Create ECR module outputs**

Create `terraform/modules/ecr/outputs.tf`:

```hcl
output "repository_name" {
  description = "ECR repository name"
  value       = aws_ecr_repository.hexacode.name
}

output "repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.hexacode.repository_url
}

output "repository_arn" {
  description = "ECR repository ARN"
  value       = aws_ecr_repository.hexacode.arn
}
```

- [ ] **Step 4: Add root ECR variable**

In `terraform/variables.tf`, replace the manual repository URL variable:

```hcl
variable "ecr_repository_url" {
  description = "ECR repository URL for Hexacode images"
  type        = string
  default     = ""
}
```

with:

```hcl
variable "ecr_repository_name" {
  description = "ECR repository name for Hexacode images"
  type        = string
  default     = "prod/hexacode"
}
```

Keep `image_tag` as-is.

- [ ] **Step 5: Wire ECR module in root Terraform**

In `terraform/main.tf`, add after `module "sqs"`:

```hcl
module "ecr" {
  source          = "./modules/ecr"
  environment     = var.environment
  repository_name = var.ecr_repository_name
}
```

Then change the `module "ecs_services"` argument:

```hcl
ecr_repository_url = module.ecr.repository_url
```

- [ ] **Step 6: Output ECR values**

Add to `terraform/outputs.tf`:

```hcl
output "ecr_repository_name" {
  description = "ECR repository name"
  value       = module.ecr.repository_name
}

output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = module.ecr.repository_url
}

output "ecr_repository_arn" {
  description = "ECR repository ARN"
  value       = module.ecr.repository_arn
}
```

- [ ] **Step 7: Align ECS image tags with push script**

In `terraform/modules/ecs-services/main.tf`, replace image references:

```hcl
image = "${var.ecr_repository_url}:identity-${var.image_tag}"
image = "${var.ecr_repository_url}:problem-${var.image_tag}"
image = "${var.ecr_repository_url}:submission-${var.image_tag}"
image = "${var.ecr_repository_url}:worker-${var.image_tag}"
```

with:

```hcl
image = "${var.ecr_repository_url}:identity-service-${var.image_tag}"
image = "${var.ecr_repository_url}:problem-service-${var.image_tag}"
image = "${var.ecr_repository_url}:submission-service-${var.image_tag}"
image = "${var.ecr_repository_url}:worker-${var.image_tag}"
```

- [ ] **Step 8: Update push script output**

In `scripts/push-ecr.ps1`, after printing pushed images, add:

```powershell
Write-Host "Terraform image_tag value: $TagSuffix"
```

- [ ] **Step 9: Format and validate Terraform**

Run:

```bash
terraform -chdir=terraform fmt -recursive
terraform -chdir=terraform init -backend=false
terraform -chdir=terraform validate
```

Expected:

- `fmt` completes.
- `init -backend=false` completes.
- `validate` reports `Success! The configuration is valid.`

- [ ] **Step 10: Verify ECR dry run tag contract**

Run from PowerShell or via bash calling PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/push-ecr.ps1 -Region ap-southeast-1 -DryRun -TagSuffix test123
```

Expected dry-run output includes:

```text
identity-service-test123
problem-service-test123
submission-service-test123
worker-test123
Terraform image_tag value: test123
```

Checkpoint: report whether Terraform image refs and push script tags now match.

---

## Task 3: Fix ECS Runtime Environment Contract

**Files:**
- Modify: `terraform/modules/ecs-services/main.tf`
- Modify: `terraform/modules/ecs-services/variables.tf`
- Modify: `terraform/main.tf`

- [ ] **Step 1: Add explicit internal service URL variables**

In `terraform/modules/ecs-services/variables.tf`, after `internal_alb_dns_name`, add:

```hcl
variable "internal_service_base_url" {
  description = "Base URL for internal service-to-service HTTP calls through the internal ALB"
  type        = string
  default     = ""
}
```

- [ ] **Step 2: Pass internal service URL from root**

In `terraform/main.tf`, inside `module "ecs_services"`, add:

```hcl
internal_service_base_url = "http://${module.alb.internal_alb_dns_name}"
```

- [ ] **Step 3: Add common environment values to problem service**

In the problem-service container `environment` list in `terraform/modules/ecs-services/main.tf`, include these entries:

```hcl
{
  name  = "LOG_LEVEL"
  value = "INFO"
},
{
  name  = "AWS_REGION"
  value = var.region
},
{
  name  = "STORAGE_DRIVER"
  value = "s3"
},
{
  name  = "S3_REGION"
  value = var.region
},
{
  name  = "S3_FORCE_PATH_STYLE"
  value = "false"
}
```

- [ ] **Step 4: Fix submission-service queue and internal URLs**

In the submission-service container `environment` list, replace:

```hcl
{
  name  = "SQS_QUEUE_URL"
  value = var.judge_queue_url
},
{
  name  = "INTERNAL_ALB_URL"
  value = "http://${var.internal_alb_dns_name}"
},
```

with:

```hcl
{
  name  = "LOG_LEVEL"
  value = "INFO"
},
{
  name  = "AWS_REGION"
  value = var.region
},
{
  name  = "STORAGE_DRIVER"
  value = "s3"
},
{
  name  = "QUEUE_DRIVER"
  value = "sqs"
},
{
  name  = "S3_REGION"
  value = var.region
},
{
  name  = "S3_FORCE_PATH_STYLE"
  value = "false"
},
{
  name  = "SQS_JUDGE_QUEUE_URL"
  value = var.judge_queue_url
},
{
  name  = "PROBLEM_SERVICE_URL"
  value = var.internal_service_base_url
},
```

- [ ] **Step 5: Fix worker queue and service URLs**

In the worker container `environment` list, replace:

```hcl
{
  name  = "SQS_QUEUE_URL"
  value = var.judge_queue_url
},
{
  name  = "INTERNAL_ALB_URL"
  value = "http://${var.internal_alb_dns_name}"
},
```

with:

```hcl
{
  name  = "LOG_LEVEL"
  value = "INFO"
},
{
  name  = "AWS_REGION"
  value = var.region
},
{
  name  = "STORAGE_DRIVER"
  value = "s3"
},
{
  name  = "QUEUE_DRIVER"
  value = "sqs"
},
{
  name  = "S3_REGION"
  value = var.region
},
{
  name  = "S3_FORCE_PATH_STYLE"
  value = "false"
},
{
  name  = "SQS_JUDGE_QUEUE_URL"
  value = var.judge_queue_url
},
{
  name  = "PROBLEM_SERVICE_URL"
  value = var.internal_service_base_url
},
{
  name  = "SUBMISSION_SERVICE_URL"
  value = var.internal_service_base_url
},
```

Keep `WORKER_CONCURRENCY`, bucket names, and log configuration.

- [ ] **Step 6: Add Cognito issuer values where auth is used**

Ensure identity, problem, and submission services each include:

```hcl
{
  name  = "COGNITO_USER_POOL_ID"
  value = var.cognito_user_pool_id
},
{
  name  = "COGNITO_APP_CLIENT_ID"
  value = var.cognito_app_client_id
},
{
  name  = "COGNITO_ISSUER"
  value = var.cognito_issuer
},
{
  name  = "COGNITO_JWKS_URL"
  value = var.cognito_jwks_url
}
```

- [ ] **Step 7: Validate Terraform**

Run:

```bash
terraform -chdir=terraform fmt -recursive
terraform -chdir=terraform validate
```

Expected: Terraform is valid.

- [ ] **Step 8: Inspect planned task definition JSON**

Run when AWS credentials are available:

```bash
terraform -chdir=terraform plan -var-file=terraform.tfvars
```

Expected task-definition environment contains `SQS_JUDGE_QUEUE_URL`, `PROBLEM_SERVICE_URL`, and `SUBMISSION_SERVICE_URL`; it does not contain `SQS_QUEUE_URL` or `INTERNAL_ALB_URL`.

Checkpoint: report exact planned environment names for submission-service and worker.

---

## Task 4: Add Remote Terraform State Backend

**Files:**
- Modify: `terraform/versions.tf`
- Modify: `docs/aws-production-operator-guide.md`
- Modify: `docs/aws-deployment-walkthrough.md`

- [ ] **Step 1: Add partial backend block**

In `terraform/versions.tf`, inside the existing `terraform {}` block before `required_version`, add:

```hcl
  backend "s3" {}
```

The file should start like:

```hcl
terraform {
  backend "s3" {}

  required_version = ">= 1.7.0"
```

- [ ] **Step 2: Document backend bootstrap commands**

In `docs/aws-production-operator-guide.md`, add a section named `Terraform remote state bootstrap` with these commands:

```powershell
$env:AWS_REGION = "ap-southeast-1"
$env:HEXACODE_TF_STATE_BUCKET = "hexacode-prod-terraform-state-$((aws sts get-caller-identity --query Account --output text).Trim())"
$env:HEXACODE_TF_LOCK_TABLE = "hexacode-prod-terraform-locks"

aws s3api create-bucket `
  --bucket $env:HEXACODE_TF_STATE_BUCKET `
  --region $env:AWS_REGION `
  --create-bucket-configuration LocationConstraint=$env:AWS_REGION

aws s3api put-bucket-versioning `
  --bucket $env:HEXACODE_TF_STATE_BUCKET `
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption `
  --bucket $env:HEXACODE_TF_STATE_BUCKET `
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws dynamodb create-table `
  --table-name $env:HEXACODE_TF_LOCK_TABLE `
  --attribute-definitions AttributeName=LockID,AttributeType=S `
  --key-schema AttributeName=LockID,KeyType=HASH `
  --billing-mode PAY_PER_REQUEST `
  --region $env:AWS_REGION
```

- [ ] **Step 3: Document Terraform init command**

Add:

```powershell
terraform -chdir=terraform init -reconfigure `
  -backend-config="bucket=$env:HEXACODE_TF_STATE_BUCKET" `
  -backend-config="key=prod/terraform.tfstate" `
  -backend-config="region=$env:AWS_REGION" `
  -backend-config="dynamodb_table=$env:HEXACODE_TF_LOCK_TABLE" `
  -backend-config="encrypt=true"
```

Expected: Terraform initializes the S3 backend and DynamoDB lock table.

- [ ] **Step 4: Validate local backend-free syntax still works**

Run:

```bash
terraform -chdir=terraform init -backend=false
terraform -chdir=terraform validate
```

Expected: validation succeeds without needing the real backend.

Checkpoint: report the backend bucket/table naming convention and whether validation succeeds.

---

## Task 5: Add Client VPN for Human Database Access

**Files:**
- Create: `terraform/modules/client-vpn/main.tf`
- Create: `terraform/modules/client-vpn/variables.tf`
- Create: `terraform/modules/client-vpn/outputs.tf`
- Modify: `terraform/modules/security-groups/main.tf`
- Modify: `terraform/modules/security-groups/outputs.tf`
- Modify: `terraform/main.tf`
- Modify: `terraform/variables.tf`
- Modify: `terraform/outputs.tf`

- [ ] **Step 1: Add Client VPN variables**

Create `terraform/modules/client-vpn/variables.tf`:

```hcl
variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_app_subnet_ids" {
  description = "Private app subnet IDs associated with the Client VPN endpoint"
  type        = list(string)
}

variable "client_cidr_block" {
  description = "Client VPN CIDR block"
  type        = string
}

variable "server_certificate_arn" {
  description = "ACM ARN for the Client VPN server certificate"
  type        = string
}

variable "root_certificate_chain_arn" {
  description = "ACM ARN for mutual-auth root client certificate"
  type        = string
}

variable "security_group_id" {
  description = "Security group attached to Client VPN network interfaces"
  type        = string
}

variable "target_network_cidr" {
  description = "CIDR authorized for VPN clients"
  type        = string
}

variable "enabled" {
  description = "Whether to create Client VPN resources"
  type        = bool
  default     = false
}
```

- [ ] **Step 2: Add Client VPN resources**

Create `terraform/modules/client-vpn/main.tf`:

```hcl
resource "aws_cloudwatch_log_group" "client_vpn" {
  count             = var.enabled ? 1 : 0
  name              = "/aws/clientvpn/hexacode-${var.environment}"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_stream" "client_vpn" {
  count          = var.enabled ? 1 : 0
  name           = "connections"
  log_group_name = aws_cloudwatch_log_group.client_vpn[0].name
}

resource "aws_ec2_client_vpn_endpoint" "main" {
  count                  = var.enabled ? 1 : 0
  description            = "hexacode-${var.environment}-client-vpn"
  server_certificate_arn = var.server_certificate_arn
  client_cidr_block      = var.client_cidr_block
  split_tunnel           = true
  security_group_ids     = [var.security_group_id]
  vpc_id                 = var.vpc_id

  authentication_options {
    type                       = "certificate-authentication"
    root_certificate_chain_arn = var.root_certificate_chain_arn
  }

  connection_log_options {
    enabled               = true
    cloudwatch_log_group  = aws_cloudwatch_log_group.client_vpn[0].name
    cloudwatch_log_stream = aws_cloudwatch_log_stream.client_vpn[0].name
  }

  tags = {
    Name = "hexacode-${var.environment}-client-vpn"
  }
}

resource "aws_ec2_client_vpn_network_association" "private_app" {
  for_each               = var.enabled ? toset(var.private_app_subnet_ids) : []
  client_vpn_endpoint_id = aws_ec2_client_vpn_endpoint.main[0].id
  subnet_id              = each.value
}

resource "aws_ec2_client_vpn_authorization_rule" "vpc" {
  count                  = var.enabled ? 1 : 0
  client_vpn_endpoint_id = aws_ec2_client_vpn_endpoint.main[0].id
  target_network_cidr    = var.target_network_cidr
  authorize_all_groups   = true
  description            = "Allow approved VPN clients to access Hexacode VPC resources"
}
```

- [ ] **Step 3: Add Client VPN outputs**

Create `terraform/modules/client-vpn/outputs.tf`:

```hcl
output "endpoint_id" {
  description = "Client VPN endpoint ID"
  value       = try(aws_ec2_client_vpn_endpoint.main[0].id, null)
}

output "dns_name" {
  description = "Client VPN DNS name"
  value       = try(aws_ec2_client_vpn_endpoint.main[0].dns_name, null)
}

output "self_service_portal_url" {
  description = "Client VPN self-service portal URL"
  value       = try(aws_ec2_client_vpn_endpoint.main[0].self_service_portal_url, null)
}
```

- [ ] **Step 4: Add VPN security group**

In `terraform/modules/security-groups/main.tf`, after `aws_security_group.rds_proxy`, add:

```hcl
resource "aws_security_group" "client_vpn" {
  name        = "${local.name_prefix}-sg-client-vpn"
  description = "Security group for AWS Client VPN"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.name_prefix}-sg-client-vpn"
  }
}
```

- [ ] **Step 5: Allow Client VPN to reach RDS Proxy only**

In `terraform/modules/security-groups/main.tf`, add:

```hcl
resource "aws_vpc_security_group_ingress_rule" "rds_proxy_from_client_vpn" {
  security_group_id            = aws_security_group.rds_proxy.id
  referenced_security_group_id = aws_security_group.client_vpn.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL from Client VPN to RDS Proxy"
}

resource "aws_vpc_security_group_egress_rule" "client_vpn_to_rds_proxy" {
  security_group_id            = aws_security_group.client_vpn.id
  referenced_security_group_id = aws_security_group.rds_proxy.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL to RDS Proxy"
}
```

- [ ] **Step 6: Output VPN security group**

In `terraform/modules/security-groups/outputs.tf`, add:

```hcl
output "sg_client_vpn_id" {
  description = "Security group ID for Client VPN"
  value       = aws_security_group.client_vpn.id
}
```

- [ ] **Step 7: Add root Client VPN variables**

In `terraform/variables.tf`, add:

```hcl
variable "client_vpn_enabled" {
  description = "Create AWS Client VPN for approved human database access"
  type        = bool
  default     = false
}

variable "client_vpn_cidr_block" {
  description = "Client VPN CIDR block"
  type        = string
  default     = "10.30.0.0/22"
}

variable "client_vpn_server_certificate_arn" {
  description = "ACM ARN for the Client VPN server certificate"
  type        = string
  default     = ""
}

variable "client_vpn_root_certificate_chain_arn" {
  description = "ACM ARN for the Client VPN root client certificate"
  type        = string
  default     = ""
}
```

- [ ] **Step 8: Wire Client VPN root module**

In `terraform/main.tf`, after `module "security_groups"`, add:

```hcl
module "client_vpn" {
  source                     = "./modules/client-vpn"
  enabled                    = var.client_vpn_enabled
  environment                = var.environment
  vpc_id                     = module.vpc.vpc_id
  private_app_subnet_ids     = module.vpc.private_app_subnet_ids
  client_cidr_block          = var.client_vpn_cidr_block
  server_certificate_arn     = var.client_vpn_server_certificate_arn
  root_certificate_chain_arn = var.client_vpn_root_certificate_chain_arn
  security_group_id          = module.security_groups.sg_client_vpn_id
  target_network_cidr        = var.cidr_block
}
```

- [ ] **Step 9: Add root outputs**

In `terraform/outputs.tf`, add:

```hcl
output "client_vpn_endpoint_id" {
  description = "Client VPN endpoint ID"
  value       = module.client_vpn.endpoint_id
}

output "client_vpn_dns_name" {
  description = "Client VPN DNS name"
  value       = module.client_vpn.dns_name
}
```

- [ ] **Step 10: Validate VPN disabled by default**

Run:

```bash
terraform -chdir=terraform fmt -recursive
terraform -chdir=terraform validate
terraform -chdir=terraform plan -var-file=terraform.tfvars.example
```

Expected: with `client_vpn_enabled = false` or omitted, no Client VPN resources are planned.

- [ ] **Step 11: Validate VPN enabled plan**

Copy `terraform/terraform.tfvars.example` to a local uncommitted `terraform/terraform.tfvars` and set:

```hcl
client_vpn_enabled                    = true
client_vpn_server_certificate_arn     = "arn:aws:acm:ap-southeast-1:123456789012:certificate/example-server"
client_vpn_root_certificate_chain_arn = "arn:aws:acm:ap-southeast-1:123456789012:certificate/example-client-root"
```

Run:

```bash
terraform -chdir=terraform plan -var-file=terraform.tfvars
```

Expected: plan includes Client VPN endpoint, subnet associations, authorization rule, log group, and one controlled Postgres path to RDS Proxy.

Checkpoint: report whether VPN defaults off and enabled plan looks correct.

---

## Task 6: Add Repeatable Admin Promotion Script

**Files:**
- Create: `hexacode-backend/scripts/promote_admin.py`
- Modify: `hexacode-backend/services/identity-service/Dockerfile`
- Modify: `hexacode-backend/services/problem-service/Dockerfile`

- [ ] **Step 1: Create admin promotion script**

Create `hexacode-backend/scripts/promote_admin.py`:

```python
from __future__ import annotations

import argparse
import json
import os
from typing import Any

from backend_common.database import get_connection
from backend_common.settings import load_service_settings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Grant the local admin role to an existing Hexacode user.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--username", help="Local username created after first Cognito sign-in.")
    group.add_argument("--email", help="Email stored on the local user row.")
    group.add_argument("--cognito-sub", help="Cognito subject stored on the local user row.")
    parser.add_argument("--json-out", help="Optional path to write result JSON.")
    return parser.parse_args()


def load_user(cursor: Any, args: argparse.Namespace) -> dict[str, Any] | None:
    if args.username:
        cursor.execute(
            """
            select id::text as id, username, email, cognito_sub
            from app_identity.users
            where lower(username) = lower(%s)
            """,
            (args.username,),
        )
    elif args.email:
        cursor.execute(
            """
            select id::text as id, username, email, cognito_sub
            from app_identity.users
            where lower(email) = lower(%s)
            """,
            (args.email,),
        )
    else:
        cursor.execute(
            """
            select id::text as id, username, email, cognito_sub
            from app_identity.users
            where cognito_sub = %s
            """,
            (args.cognito_sub,),
        )
    row = cursor.fetchone()
    return dict(row) if row else None


def main() -> int:
    args = parse_args()
    settings = load_service_settings("admin-bootstrap")
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL must be configured.")

    with get_connection(settings.database_url) as connection:
        with connection.cursor() as cursor:
            user = load_user(cursor, args)
            if user is None:
                raise RuntimeError("No local user matched the supplied identifier. Sign in through Cognito first.")
            cursor.execute(
                """
                insert into app_identity.user_role_assignments (user_id, role_code)
                values (%s::uuid, 'admin')
                on conflict (user_id, role_code) do nothing
                """,
                (user["id"],),
            )
        connection.commit()

    result = {"promoted": True, "role_code": "admin", "user": user}
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Include script in Docker images**

In `hexacode-backend/services/identity-service/Dockerfile`, add after `COPY db ./db`:

```dockerfile
COPY scripts/promote_admin.py ./scripts/promote_admin.py
```

In `hexacode-backend/services/problem-service/Dockerfile`, add after the existing import script copy:

```dockerfile
COPY scripts/promote_admin.py ./scripts/promote_admin.py
COPY ../data/problems ./data/problems
```

If Docker build context cannot copy `../data/problems` from `hexacode-backend`, change `scripts/push-ecr.ps1` problem-service build context from `hexacode-backend` to `.` and adjust the Dockerfile copy paths in the same task.

- [ ] **Step 3: Run syntax check**

Run:

```bash
python -m py_compile hexacode-backend/scripts/promote_admin.py
```

Expected: no syntax errors.

- [ ] **Step 4: Dry-run image build context**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/push-ecr.ps1 -Region ap-southeast-1 -DryRun -Service problem-service -TagSuffix seedtest
```

Expected: dry-run shows the problem-service Docker build command and tag. If the Dockerfile copy path was changed, dry-run must show the updated build context.

Checkpoint: report which image contains `promote_admin.py` and how `data/problems` is made available for the import task.

---

## Task 7: Add One-Off ECS Seed Task Runbook

**Files:**
- Modify: `terraform/modules/ecs-services/outputs.tf`
- Modify: `docs/aws-production-operator-guide.md`
- Modify: `docs/aws-deployment-walkthrough.md`

- [ ] **Step 1: Output task definition families/ARNs**

In `terraform/modules/ecs-services/outputs.tf`, add:

```hcl
output "problem_task_definition_arn" {
  description = "Problem service task definition ARN"
  value       = aws_ecs_task_definition.problem_service.arn
}

output "identity_task_definition_arn" {
  description = "Identity service task definition ARN"
  value       = aws_ecs_task_definition.identity_service.arn
}
```

In root `terraform/outputs.tf`, add:

```hcl
output "problem_task_definition_arn" {
  description = "Problem service task definition ARN for one-off seed tasks"
  value       = module.ecs_services.problem_task_definition_arn
}

output "identity_task_definition_arn" {
  description = "Identity service task definition ARN for one-off admin tasks"
  value       = module.ecs_services.identity_task_definition_arn
}
```

- [ ] **Step 2: Document problem catalog seed command**

Add this to `docs/aws-production-operator-guide.md`:

```powershell
$env:AWS_REGION = "ap-southeast-1"
$env:ECS_CLUSTER = terraform -chdir=terraform output -raw ecs_cluster_name
$env:PROBLEM_TASK_DEF = terraform -chdir=terraform output -raw problem_task_definition_arn
$env:PRIVATE_SUBNETS = (terraform -chdir=terraform output -json private_app_subnet_ids | ConvertFrom-Json) -join ","
$env:API_SG = terraform -chdir=terraform output -raw sg_api_services_id

aws ecs run-task `
  --region $env:AWS_REGION `
  --cluster $env:ECS_CLUSTER `
  --launch-type FARGATE `
  --task-definition $env:PROBLEM_TASK_DEF `
  --network-configuration "awsvpcConfiguration={subnets=[$env:PRIVATE_SUBNETS],securityGroups=[$env:API_SG],assignPublicIp=DISABLED}" `
  --overrides '{"containerOverrides":[{"name":"problem-service","command":["python","scripts/import_problem_catalog.py","--catalog-dir","/app/data/problems","--skip-env-file","--fail-on-existing"]}]}'
```

Expected: ECS returns a task ARN.

- [ ] **Step 3: Document seed task monitoring**

Add:

```powershell
$env:TASK_ARN = "paste-task-arn-from-run-task-output"
aws ecs wait tasks-stopped --region $env:AWS_REGION --cluster $env:ECS_CLUSTER --tasks $env:TASK_ARN
aws ecs describe-tasks --region $env:AWS_REGION --cluster $env:ECS_CLUSTER --tasks $env:TASK_ARN --query "tasks[0].containers[0].exitCode"
aws logs tail /ecs/hexacode-prod/problem-service --region $env:AWS_REGION --since 30m
```

Expected: exit code is `0`, logs print JSON with `created_problem_count`, and the frontend problem list shows seeded problems.

- [ ] **Step 4: Document admin promotion command**

Add:

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

aws ecs run-task `
  --region $env:AWS_REGION `
  --cluster $env:ECS_CLUSTER `
  --launch-type FARGATE `
  --task-definition $env:IDENTITY_TASK_DEF `
  --network-configuration "awsvpcConfiguration={subnets=[$env:PRIVATE_SUBNETS],securityGroups=[$env:API_SG],assignPublicIp=DISABLED}" `
  --overrides $adminOverride
```

Expected: script prints JSON with `"promoted": true`.

- [ ] **Step 5: Validate Terraform outputs**

Run:

```bash
terraform -chdir=terraform fmt -recursive
terraform -chdir=terraform validate
```

Expected: output references are valid.

Checkpoint: report the exact one-off task commands and explain why ECS one-off tasks are used instead of opening RDS publicly.

---

## Task 8: Update Production tfvars Example

**Files:**
- Modify: `terraform/terraform.tfvars.example`

- [ ] **Step 1: Replace stale/manual ECR input**

Update `terraform/terraform.tfvars.example` to use `ecr_repository_name`, not `ecr_repository_url`:

```hcl
region              = "ap-southeast-1"
environment         = "prod"
cidr_block          = "10.20.0.0/16"
availability_zones  = ["a", "b"]
db_instance_class   = "db.r6g.large"
db_multi_az         = true
db_allocated_storage = 200

application_secret_arn = "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:hexacode-prod-app"
ecr_repository_name    = "prod/hexacode"
image_tag              = "git-sha-or-release-tag"
chat_lambda_arn        = "arn:aws:lambda:ap-southeast-1:123456789012:function:hexacode-prod-chat"
frontend_domain        = "https://your-cloudfront-domain.example"
kms_key_arn            = ""

client_vpn_enabled                    = false
client_vpn_cidr_block                 = "10.30.0.0/22"
client_vpn_server_certificate_arn     = ""
client_vpn_root_certificate_chain_arn = ""
```

- [ ] **Step 2: Remove obsolete variable**

Ensure this line no longer appears:

```hcl
ecr_repository_url = "123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/prod/hexacode"
```

- [ ] **Step 3: Validate with example values**

Run:

```bash
terraform -chdir=terraform validate
```

Expected: validation succeeds.

Checkpoint: report every value the real production `terraform.tfvars` must replace before apply.

---

## Task 9: Write the Production Operator Guide

**Files:**
- Create: `docs/aws-production-operator-guide.md`
- Modify: `docs/aws-deployment-walkthrough.md`
- Modify: `docs/ecr.md`
- Modify: `docs/aws.md`

- [ ] **Step 1: Create guide header and scope**

Create `docs/aws-production-operator-guide.md` with:

```markdown
# Hexacode AWS Production Operator Guide

This guide explains how to deploy and operate Hexacode on AWS using Terraform, ECR, ECS Fargate, RDS/RDS Proxy, Client VPN, S3, SQS, Cognito, API Gateway, Lambda, and CloudFront.

Do not paste AWS secret keys, passwords, admin passwords, or private certificate material into this file. Use placeholders and environment variables.
```

- [ ] **Step 2: Add concept sections**

Add sections with these exact headings:

```markdown
## Concepts

### Terraform state

### ECR image tags

### ECS Fargate services

### One-off ECS Fargate tasks

### Private RDS and RDS Proxy

### Client VPN human access

### Cognito users vs local app roles
```

Each section must explain what the component does in this repo and which command later uses it.

- [ ] **Step 3: Add deployment runbook sections**

Add headings:

```markdown
## Preflight

## Terraform remote state bootstrap

## Build and push images to ECR

## Terraform init, validate, plan, and apply

## Frontend build, upload, and CloudFront invalidation

## Seed initial problems

## Promote initial admin

## Production smoke tests

## Debugging and rollback

## Deployment journal
```

- [ ] **Step 4: Add ECR command**

In `Build and push images to ECR`, include:

```powershell
$env:AWS_REGION = "ap-southeast-1"
$env:IMAGE_TAG = (git rev-parse --short HEAD).Trim()
powershell -ExecutionPolicy Bypass -File scripts/push-ecr.ps1 -Region $env:AWS_REGION -TagSuffix $env:IMAGE_TAG
```

Expected output: pushed images end with `identity-service-$env:IMAGE_TAG`, `problem-service-$env:IMAGE_TAG`, `submission-service-$env:IMAGE_TAG`, and `worker-$env:IMAGE_TAG`.

- [ ] **Step 5: Add Terraform commands**

Include:

```powershell
terraform -chdir=terraform fmt -recursive
terraform -chdir=terraform validate
terraform -chdir=terraform plan -var-file=terraform.tfvars -out=tfplan
terraform -chdir=terraform apply tfplan
```

Expected: plan is reviewed before apply; apply outputs include API Gateway URL, CloudFront domain, ECS service names, RDS Proxy endpoint, and Client VPN endpoint if enabled.

- [ ] **Step 6: Add smoke-test checklist**

Add this checklist:

```markdown
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
- [ ] Another user cannot read that submission or results.
- [ ] Client VPN can reach the RDS Proxy endpoint on port 5432.
```

- [ ] **Step 7: Update old docs to point at guide**

At the top of `docs/aws-deployment-walkthrough.md`, add:

```markdown
> Current production deployment runbook: see [aws-production-operator-guide.md](./aws-production-operator-guide.md). This older walkthrough is retained only for historical context until it is fully merged into the operator guide.
```

In `docs/ecr.md`, update stale repo paths and state that Terraform owns the ECR repository.

In `docs/aws.md`, add a short note that production human DB access uses Client VPN and repeatable data operations use one-off ECS Fargate tasks.

- [ ] **Step 8: Verify docs have no known stale references**

Run:

```bash
python - <<'PY'
from pathlib import Path
bad = ['xbrain-courses', 'us-west-2:380825342853', 'docs/cloud-deployment.md']
for path in [Path('docs/aws-production-operator-guide.md'), Path('docs/aws-deployment-walkthrough.md'), Path('docs/ecr.md'), Path('docs/aws.md')]:
    text = path.read_text(encoding='utf-8')
    for item in bad:
        if item in text:
            print(f'{path}: stale reference {item}')
PY
```

Expected: no stale references in the new/updated docs, unless an old walkthrough explicitly labels the value as historical.

Checkpoint: report the guide path and the main sections added.

---

## Task 10: Full Local Verification Before AWS Credentials

**Files:**
- No required source changes.

- [ ] **Step 1: Run Terraform checks**

Run:

```bash
terraform -chdir=terraform fmt -recursive
terraform -chdir=terraform init -backend=false
terraform -chdir=terraform validate
```

Expected: all pass.

- [ ] **Step 2: Run ECR dry-run**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/push-ecr.ps1 -Region ap-southeast-1 -DryRun -TagSuffix verify123
```

Expected: all four image tags match Terraform convention.

- [ ] **Step 3: Run frontend checks**

Run:

```bash
npm --prefix hexacode-frontend run lint
npm --prefix hexacode-frontend run build
```

Expected: lint and build pass.

- [ ] **Step 4: Run backend syntax checks**

Run:

```bash
python -m py_compile hexacode-backend/backend_common/authz.py hexacode-backend/services/submission-service/app/main.py hexacode-backend/scripts/promote_admin.py hexacode-backend/scripts/import_problem_catalog.py
```

Expected: no syntax errors.

- [ ] **Step 5: Run Docker build smoke check**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/push-ecr.ps1 -Region ap-southeast-1 -Service identity-service,problem-service,submission-service,worker -TagSuffix localverify -SkipLogin -SkipPush
```

Expected: all four Docker images build locally.

Checkpoint: do not ask for AWS admin credentials until all local verification is complete or until the user explicitly chooses to proceed with known local failures.

---

## Task 11: AWS Production Deployment Execution

**Files:**
- Modify: `docs/aws-production-operator-guide.md` deployment journal section only.

- [ ] **Step 1: Confirm credential handling**

Ask the user to provide credentials through their preferred secure method. Do not paste credentials into files. If interactive login is required, ask the user to run:

```bash
! aws sso login --profile <profile-name>
```

or configure environment variables outside repo files.

- [ ] **Step 2: Verify caller identity**

Run:

```bash
aws sts get-caller-identity
```

Expected: account ID and ARN match the intended production account.

- [ ] **Step 3: Initialize remote state**

Run the backend bootstrap and `terraform init -reconfigure` commands from the operator guide.

Expected: Terraform uses remote S3 state and DynamoDB locking.

- [ ] **Step 4: Build and push images**

Run:

```powershell
$env:IMAGE_TAG = (git rev-parse --short HEAD).Trim()
powershell -ExecutionPolicy Bypass -File scripts/push-ecr.ps1 -Region $env:AWS_REGION -TagSuffix $env:IMAGE_TAG
```

Expected: ECR contains four pushed service images.

- [ ] **Step 5: Plan production Terraform**

Run:

```bash
terraform -chdir=terraform plan -var-file=terraform.tfvars -out=tfplan
```

Expected: plan creates/updates expected resources only. Stop and review with the user before applying.

- [ ] **Step 6: Apply production Terraform after review**

Run only after user approval:

```bash
terraform -chdir=terraform apply tfplan
```

Expected: apply completes and prints outputs.

- [ ] **Step 7: Run seed tasks**

Run the problem import and admin promotion one-off ECS Fargate tasks from the guide.

Expected: both tasks exit with code `0`.

- [ ] **Step 8: Run production smoke tests**

Use the checklist from Task 9. Record actual endpoints, task IDs, log group names, status codes, and failures in the deployment journal.

- [ ] **Step 9: Debug and record fixes**

For any failure, record:

```markdown
### YYYY-MM-DD HH:mm local - Issue title

- Symptom:
- Command or page:
- Error output:
- Root cause:
- Fix applied:
- Verification after fix:
```

Checkpoint: only call deployment complete after the full smoke checklist passes.

---

## Self-Review

### Spec coverage

- Infrastructure reproducibility: Tasks 2, 3, 4, 5, 8, 10, 11.
- App readiness and submission auth: Task 1 and Task 10.
- Initial problem and admin seeding: Tasks 6 and 7.
- Private DB access through Client VPN: Task 5 and Task 9.
- ECS Fargate runtime and one-off tasks: Tasks 3, 6, 7, 9, 11.
- Operator learning guide: Task 9.
- End-to-end deployment and smoke testing: Tasks 10 and 11.

### Placeholder scan

This plan intentionally uses environment variables such as `$env:AWS_REGION`, `$env:IMAGE_TAG`, and `$env:ADMIN_USERNAME` for values that must not be hard-coded. It contains no `TBD`, `TODO`, or unspecified implementation steps.

### Type and name consistency

- Image tag convention is `service-name-<image_tag>` across Terraform and `scripts/push-ecr.ps1`.
- Queue env var is `SQS_JUDGE_QUEUE_URL`, matching `backend_common/settings.py`.
- Internal service URLs are `PROBLEM_SERVICE_URL` and `SUBMISSION_SERVICE_URL`, matching gateway/worker/submission code expectations.
- Human DB access targets RDS Proxy through Client VPN, not public RDS.
