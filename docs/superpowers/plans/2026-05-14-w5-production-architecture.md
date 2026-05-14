# W5 Production Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement W5 production hardening for Hexacode: justified single VPC evidence, authenticated/throttled chat Lambda API surface, WAF, Network Firewall with Regional NAT, VPC Flow Logs, EFS-backed submission artifacts, AWS Backup/restore testing, and production safety alarms.

**Architecture:** Keep Hexacode in one production VPC and harden it with layered controls: WAF at public edges, Cognito/JWT auth and throttling at API Gateway, least-privilege security groups at workloads, Network Firewall for inspected egress, Regional NAT per AZ, CloudWatch-based traffic evidence, EFS as durable submission artifact source of truth, and AWS Backup for recoverability. The chat Lambda remains outside the VPC because API Gateway and Bedrock do not require private VPC access for the approved design.

**Tech Stack:** Terraform, AWS API Gateway v2 HTTP API, Cognito/JWT authorizer, Lambda, Bedrock Agent Runtime, WAFv2, Network Firewall, VPC Flow Logs, CloudWatch Logs/Alarms, EFS, AWS Backup, ECS/Fargate, FastAPI, PostgreSQL, React/Vite.

---

## Implementation Notes

- Do **not** create git commits unless the user explicitly asks. This repo's `CLAUDE.md` overrides the planning skill's default commit steps.
- Use Docker for backend/app validation when possible.
- Run `terraform fmt` after Terraform edits.
- Use production-first defaults; avoid demo-only bypasses.
- Keep all file paths below relative to repo root: `C:\Users\thanh\Desktop\workspace\xbrain\hexacode`.

## File Structure Map

### Documentation
- Create: `docs/weekly-requirements/W5-Evidence-Pack.md` — W5 evidence scaffold and strong single-VPC rationale.
- Create: `docs/restore-procedure.md` — RDS/EFS restore test procedure for AWS Backup evidence.
- Existing reference: `docs/weekly-requirements/W5_project_announcement.md` — W5 requirement source.
- Existing design: `docs/superpowers/specs/2026-05-14-w5-production-architecture-design.md` — approved design spec.

### Terraform
- Modify: `terraform/main.tf` — wire new W5 modules and pass outputs between modules.
- Modify: `terraform/outputs.tf` — expose W5 resource names/ARNs useful for evidence.
- Modify: `terraform/modules/vpc/main.tf`, `variables.tf`, `outputs.tf` — firewall subnets, Regional NAT, route table outputs, VPC Flow Logs.
- Create: `terraform/modules/network-firewall/main.tf`, `variables.tf`, `outputs.tf` — Network Firewall policy, rule groups, firewall, logging.
- Create: `terraform/modules/waf/main.tf`, `variables.tf`, `outputs.tf` — CloudFront and regional API Gateway WAFs.
- Create: `terraform/modules/efs/main.tf`, `variables.tf`, `outputs.tf` — EFS file system, mount targets, access points.
- Create: `terraform/modules/backup/main.tf`, `variables.tf`, `outputs.tf`, `alarms.tf` — AWS Backup vault/plan/selections and failure alarms.
- Modify: `terraform/modules/api-gateway/main.tf`, `variables.tf`, `outputs.tf` — JWT authorizer and chat route throttling.
- Modify: `terraform/modules/bedrock-chat/main.tf`, `variables.tf`, `outputs.tf` — reserved concurrency and Lambda alarms.
- Modify: `terraform/modules/cloudfront/main.tf`, `variables.tf` — attach CloudFront WAF ACL.
- Modify: `terraform/modules/security-groups/main.tf`, `outputs.tf`, `variables.tf` — EFS NFS rules and least-privilege adjustments.
- Modify: `terraform/modules/ecs-services/main.tf`, `variables.tf` — mount EFS into submission-service and worker.
- Modify: `terraform/modules/rds/main.tf`, `outputs.tf`, `variables.tf` — prod deletion protection, final snapshot, DB ARN output.

### Backend / Frontend
- Modify: `hexacode-backend/backend_common/settings.py` — EFS storage settings.
- Modify: `hexacode-backend/backend_common/storage.py` — EFS-backed upload/download/delete helpers.
- Modify: `hexacode-backend/db/new-app-schema.sql` — EFS-compatible storage metadata fields if needed.
- Modify: `hexacode-backend/services/submission-service/app/main.py` — source artifact persistence, completion artifact registration, authenticated downloads.
- Modify: `hexacode-backend/services/worker/app/main.py` — EFS artifact read/write for source/stdout/stderr/compile logs.
- Test: `hexacode-backend/services/submission-service/tests/test_submission_authorization.py` — extend or add adjacent artifact tests.
- Optional modify: `hexacode-frontend/src/routes/submission-detail.tsx` — only if compile-log download or metadata display is added.

---

## Batch 1: W5 Evidence Pack and Restore Procedure

### Task 1: Create W5 Evidence Pack scaffold and Single-VPC rationale

**Files:**
- Create: `docs/weekly-requirements/W5-Evidence-Pack.md`

- [ ] **Step 1: Create the evidence pack with required W5 sections**

Write this structure:

```markdown
# W5 Evidence Pack — Hexacode

## 1. Cover

- **Project:** Hexacode
- **Week:** W5 — The Network Fortress
- **Repository:** <repo link to be added>
- **Prior evidence pack:** <link to be added>
- **Target production region:** us-west-2
- **Architecture path:** Path C — Justified Single-VPC

## 2. MH1 — Multi-VPC Connectivity: Justified Single-VPC

### Decision

Hexacode chooses **Path C — Justified Single-VPC** for W5.

### Production rationale

Hexacode is one tightly coupled application boundary: frontend delivery, API Gateway, internal ALB, ECS application services, asynchronous judge workers, chat Lambda API surface, RDS Proxy/RDS, Redis, SQS-compatible queueing, and EFS-backed submission artifacts all serve the same product, users, and deployment lifecycle.

A multi-VPC design would be justified if there were separate trust domains, separate compliance boundaries, or independently owned platform domains. Hexacode does not have those boundaries today. Splitting the current production system across multiple VPCs would add Transit Gateway or peering, duplicated route tables, cross-VPC DNS, cross-VPC service discovery, private integration complexity, and harder incident response without creating a meaningful isolation boundary.

The production hardening therefore happens inside one well-designed VPC: WAF at the public edge, API Gateway authentication and throttling, least-privilege security groups, private app/data subnet tiers, Network Firewall egress inspection, Regional NAT, VPC Flow Logs to CloudWatch, and AWS Backup for stateful resources.

### Why not Multi-VPC now

- The app does not have independently owned product domains.
- The judge, submission, problem, identity, storage, and chat paths are part of one production system.
- RDS Proxy, Redis, EFS, internal ALB, and ECS services are already designed around single-VPC private connectivity.
- Multi-VPC would increase operational failure modes before it creates a real isolation boundary.
- W5 security and observability requirements are better satisfied by hardening the existing VPC path than by introducing unnecessary routing complexity.

### Future triggers for Multi-VPC

Hexacode should revisit Multi-VPC if one of these events occurs:

1. Hexacode splits into independently owned product domains.
2. A separate compliance boundary is required between workloads.
3. The judge/runtime execution tier must be isolated from core app and data services as an untrusted workload boundary.
4. A shared-services or centralized-inspection network hub is introduced.
5. The deployment moves to a multi-account landing zone where network, application, and data accounts have separate ownership.

### Evidence to attach

- VPC subnet and route table screenshots.
- VPC Flow Logs sample entries from CloudWatch.
- Explanation of how each subnet tier maps to the deployed Terraform.

## 3. MH2 — Network Firewall Hardening

### Path selected

Path A — Deploy AWS Network Firewall.

### Rationale

Hexacode has private workload egress through NAT Gateway, so W5 Path B is not valid. Network Firewall will inspect outbound private-subnet traffic before Regional NAT.

### Evidence to attach

- Firewall policy and rule group screenshots.
- Firewall alert log for one blocked request.
- Flow Log sample for one allowed request.
- Route table screenshot showing private egress through firewall endpoints.

## 4. MH3 — EFS File Storage + AWS Backup Plan

### File storage decision

EFS is the source of truth for durable submission source, stdout, stderr, and compile-log artifacts. Postgres stores metadata and short previews only.

### Evidence to attach

- EFS filesystem and mount target screenshots.
- File written and read from private application tier.
- Backup vault and backup plan screenshots.
- Restore job completion screenshot.
- Readable restored data screenshot.

## 5. MH4 — API Gateway in Front of Lambda

### Decision

Chat uses API Gateway HTTP API with Cognito/JWT auth before Lambda invocation.

### Evidence to attach

- API Gateway route and authorizer screenshot.
- Authenticated curl returning 200.
- Unauthenticated curl returning 401 or 403.
- Lambda invocation metric proving unauthenticated requests do not invoke Lambda.

## 6. MH5 — Serverless Scaling Pattern

### Pattern selected

Reserved Concurrency for the existing chat Lambda, plus API Gateway throttling and WAF rate limiting.

### Evidence to attach

- Lambda reserved concurrency screenshot.
- CloudWatch Throttles metric or TooManyRequests evidence.
- API Gateway throttling settings.

## 7. Application Carry-Forward Verification

- End-to-end submission execution: <evidence to add>
- Bedrock/chat retrieval: <evidence to add>
- Database query or admin operation: <evidence to add>

## 8. Negative Security Tests

- Unauthenticated chat request rejected before Lambda: <evidence to add>
- Network Firewall blocked request: <evidence to add>
- Backup/restore validation result: <evidence to add>
- EFS access restricted to app/worker security groups: <evidence to add>
```

- [ ] **Step 2: Verify the required sections exist**

Run:

```powershell
Select-String -Path docs/weekly-requirements/W5-Evidence-Pack.md -Pattern "Justified Single-VPC","Future triggers","Network Firewall","EFS","API Gateway","Reserved Concurrency"
```

Expected: each pattern appears at least once.

### Task 2: Create restore procedure document

**Files:**
- Create: `docs/restore-procedure.md`

- [ ] **Step 1: Write restore procedure**

Create this file:

```markdown
# Hexacode Restore Procedure

## Scope

This procedure validates that Hexacode production backups can be restored and read. It covers RDS and EFS resources protected by AWS Backup.

## Preconditions

- AWS Backup vault exists for the production environment.
- Daily backup plan covers RDS and EFS.
- At least one completed recovery point exists.
- Restore IAM role exists and is allowed to restore the selected resource.
- Restore target uses a non-production identifier to avoid overwriting production.

## RDS restore test

1. Open AWS Backup and select the latest completed RDS recovery point.
2. Start a restore job to a temporary DB identifier such as `hexacode-prod-restore-test`.
3. Wait until the restore job status is `COMPLETED`.
4. Connect to the restored database from a private network path.
5. Run:

```sql
select count(*) from submission.submissions;
select count(*) from storage.objects;
```

6. Capture screenshots of the completed restore job and readable query output.
7. Delete the temporary restored database after evidence is captured.

## EFS restore test

1. Open AWS Backup and select the latest completed EFS recovery point.
2. Start a restore job to a temporary EFS restore target.
3. Wait until the restore job status is `COMPLETED`.
4. Mount the restored filesystem from a private application subnet test task or instance.
5. Read a known submission artifact path under `/submissions`.
6. Capture screenshots of the completed restore job and readable restored file.
7. Delete the temporary restored EFS resource after evidence is captured.

## Alarm response

If backup or restore failure alarms fire:

1. Check AWS Backup job details.
2. Confirm whether the failed resource still exists and is tagged for backup.
3. Check IAM permissions for the backup/restore role.
4. Re-run an on-demand backup or restore after remediation.
5. Record the incident and update the Evidence Pack if W5 validation is affected.
```

- [ ] **Step 2: Verify restore doc headings**

Run:

```powershell
Select-String -Path docs/restore-procedure.md -Pattern "RDS restore test","EFS restore test","Alarm response"
```

Expected: all three headings are found.

---

## Batch 2: Chat API Gateway Auth, Throttling, WAF, and Lambda Scaling

### Task 3: Add Cognito/JWT authorizer to chat route

**Files:**
- Modify: `terraform/modules/api-gateway/main.tf`
- Modify: `terraform/modules/api-gateway/variables.tf`
- Modify: `terraform/main.tf`

- [ ] **Step 1: Add API Gateway module variables**

Add variables similar to:

```hcl
variable "cognito_issuer" {
  description = "Cognito issuer URL for API Gateway JWT authorizer."
  type        = string
}

variable "cognito_client_id" {
  description = "Cognito app client ID accepted by API Gateway JWT authorizer."
  type        = string
}

variable "chat_throttle_burst_limit" {
  description = "Burst limit for the chat route."
  type        = number
  default     = 20
}

variable "chat_throttle_rate_limit" {
  description = "Steady-state request rate limit for the chat route."
  type        = number
  default     = 10
}
```

- [ ] **Step 2: Add JWT authorizer resource**

In `terraform/modules/api-gateway/main.tf`, add:

```hcl
resource "aws_apigatewayv2_authorizer" "cognito_jwt" {
  api_id           = aws_apigatewayv2_api.http_api.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${var.project_name}-${var.environment}-cognito-jwt"

  jwt_configuration {
    audience = [var.cognito_client_id]
    issuer   = var.cognito_issuer
  }
}
```

- [ ] **Step 3: Attach authorizer to chat route**

Update the existing `aws_apigatewayv2_route.chat_messages` resource:

```hcl
resource "aws_apigatewayv2_route" "chat_messages" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "POST /api/chat/messages"
  target             = "integrations/${aws_apigatewayv2_integration.chat_lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_jwt.id
}
```

- [ ] **Step 4: Pass Cognito outputs from root module**

In `terraform/main.tf`, pass the existing Cognito issuer/client outputs into `module "api_gateway"`. Use the exact output names from `terraform/modules/cognito/outputs.tf`.

- [ ] **Step 5: Validate Terraform**

Run:

```powershell
terraform -chdir=terraform fmt -recursive
terraform -chdir=terraform validate
```

Expected: Terraform validates successfully.

### Task 4: Add API Gateway chat throttling

**Files:**
- Modify: `terraform/modules/api-gateway/main.tf`

- [ ] **Step 1: Add route settings to the API stage**

Find the existing `aws_apigatewayv2_stage` resource and add route throttling for `POST /api/chat/messages`:

```hcl
route_settings {
  route_key              = aws_apigatewayv2_route.chat_messages.route_key
  throttling_burst_limit = var.chat_throttle_burst_limit
  throttling_rate_limit  = var.chat_throttle_rate_limit
}
```

If the stage resource already has `default_route_settings`, keep it and add this stricter route-specific block.

- [ ] **Step 2: Validate plan includes route settings**

Run:

```powershell
terraform -chdir=terraform plan -no-color
```

Expected: plan includes updates to the API Gateway stage route settings.

### Task 5: Add Lambda reserved concurrency and chat alarms

**Files:**
- Modify: `terraform/modules/bedrock-chat/main.tf`
- Modify: `terraform/modules/bedrock-chat/variables.tf`

- [ ] **Step 1: Add reserved concurrency variable**

```hcl
variable "reserved_concurrent_executions" {
  description = "Reserved concurrency for the chat Lambda."
  type        = number
  default     = 5
}
```

- [ ] **Step 2: Set reserved concurrency on chat Lambda**

Update `aws_lambda_function.chat`:

```hcl
reserved_concurrent_executions = var.reserved_concurrent_executions
```

- [ ] **Step 3: Add Lambda CloudWatch alarms**

Add alarms for `Errors`, `Throttles`, and high `Duration` using namespace `AWS/Lambda` and dimension `FunctionName = aws_lambda_function.chat.function_name`.

Example for throttles:

```hcl
resource "aws_cloudwatch_metric_alarm" "chat_lambda_throttles" {
  alarm_name          = "${var.project_name}-${var.environment}-chat-lambda-throttles"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.chat.function_name
  }
}
```

- [ ] **Step 4: Validate**

Run:

```powershell
terraform -chdir=terraform fmt -recursive
terraform -chdir=terraform validate
```

Expected: Terraform validates successfully.

### Task 6: Add WAF for CloudFront and API Gateway

**Files:**
- Create: `terraform/modules/waf/main.tf`
- Create: `terraform/modules/waf/variables.tf`
- Create: `terraform/modules/waf/outputs.tf`
- Modify: `terraform/modules/cloudfront/main.tf`
- Modify: `terraform/modules/cloudfront/variables.tf`
- Modify: `terraform/modules/api-gateway/outputs.tf`
- Modify: `terraform/main.tf`

- [ ] **Step 1: Create WAF module with CloudFront and regional ACLs**

Create `aws_wafv2_web_acl` resources:

```hcl
resource "aws_wafv2_web_acl" "regional" {
  name  = "${var.project_name}-${var.environment}-regional"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "AWSManagedCommonRuleSet"
    priority = 10

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-${var.environment}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "RateLimit"
    priority = 20

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-${var.environment}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project_name}-${var.environment}-regional"
    sampled_requests_enabled   = true
  }
}
```

Also create a CloudFront-scope ACL using a `us-east-1` provider alias in root Terraform. Keep rules conservative to avoid accidental production outage.

- [ ] **Step 2: Associate regional WAF to API Gateway stage**

Add an API Gateway stage ARN output if missing, then create `aws_wafv2_web_acl_association` in the WAF module or root module.

- [ ] **Step 3: Attach CloudFront WAF to distribution**

Add `web_acl_id = var.web_acl_id` to `aws_cloudfront_distribution.frontend` and pass the CloudFront ACL ARN.

- [ ] **Step 4: Validate provider alias requirement**

Run:

```powershell
terraform -chdir=terraform validate
```

Expected: validation succeeds and CloudFront WAF uses `us-east-1` provider.

---

## Batch 3: VPC Flow Logs, Network Firewall, Regional NAT, and SG Hardening

### Task 7: Add Regional NAT and firewall subnets

**Files:**
- Modify: `terraform/modules/vpc/main.tf`
- Modify: `terraform/modules/vpc/variables.tf`
- Modify: `terraform/modules/vpc/outputs.tf`

- [ ] **Step 1: Replace single NAT with per-AZ NAT**

Change NAT EIP and NAT Gateway resources to `count = length(var.availability_zones)` or the module's existing AZ local.

Expected shape:

```hcl
resource "aws_eip" "nat" {
  count  = length(var.availability_zones)
  domain = "vpc"

  tags = {
    Name = "${var.project_name}-${var.environment}-nat-${count.index}"
  }
}

resource "aws_nat_gateway" "main" {
  count         = length(var.availability_zones)
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = {
    Name = "${var.project_name}-${var.environment}-nat-${count.index}"
  }
}
```

- [ ] **Step 2: Add firewall subnets per AZ**

Add `aws_subnet.firewall` in the VPC module using a dedicated CIDR range variable or computed subnet ranges.

- [ ] **Step 3: Output firewall subnet IDs and route table IDs**

Add outputs for `firewall_subnet_ids`, `private_app_route_table_ids`, `private_data_route_table_ids`, and `public_route_table_id`/per-AZ public route table IDs.

- [ ] **Step 4: Validate VPC module**

Run:

```powershell
terraform -chdir=terraform fmt -recursive
terraform -chdir=terraform validate
```

Expected: validation succeeds.

### Task 8: Add Network Firewall module and egress routing

**Files:**
- Create: `terraform/modules/network-firewall/main.tf`
- Create: `terraform/modules/network-firewall/variables.tf`
- Create: `terraform/modules/network-firewall/outputs.tf`
- Modify: `terraform/main.tf`
- Modify: `terraform/modules/vpc/main.tf` or create root-level `terraform/network-routing.tf`

- [ ] **Step 1: Create firewall policy and rule groups**

Create stateful rule group for W5 evidence. Use a conservative domain block/allow test rule suitable for demonstration without blocking required AWS service endpoints.

- [ ] **Step 2: Create firewall in dedicated firewall subnets**

Create `aws_networkfirewall_firewall` with subnet mappings for each firewall subnet.

- [ ] **Step 3: Add firewall logging**

Create CloudWatch log groups and `aws_networkfirewall_logging_configuration` for `ALERT` and `FLOW` logs.

- [ ] **Step 4: Route private egress through firewall before NAT**

Routing target:

```text
private app/data route table 0.0.0.0/0 -> same-AZ Network Firewall endpoint
firewall subnet route table 0.0.0.0/0 -> same-AZ NAT Gateway
public route table 0.0.0.0/0 -> Internet Gateway
```

If Terraform cannot directly address endpoint IDs until apply, use the documented `firewall_status.sync_states[*].attachment[*].endpoint_id` pattern carefully and validate with a plan.

- [ ] **Step 5: Validate routing plan**

Run:

```powershell
terraform -chdir=terraform plan -no-color
```

Expected: plan shows Network Firewall, firewall policy, log groups, and route changes.

### Task 9: Add VPC Flow Logs to CloudWatch

**Files:**
- Modify: `terraform/modules/vpc/main.tf`
- Modify: `terraform/modules/vpc/outputs.tf`

- [ ] **Step 1: Add Flow Logs log group**

```hcl
resource "aws_cloudwatch_log_group" "vpc_flow_logs" {
  name              = "/aws/vpc/flow-logs/${var.project_name}-${var.environment}"
  retention_in_days = 30
}
```

- [ ] **Step 2: Add Flow Logs IAM role and policy**

Grant CloudWatch Logs delivery permissions for the log group.

- [ ] **Step 3: Add `aws_flow_log`**

```hcl
resource "aws_flow_log" "vpc" {
  iam_role_arn    = aws_iam_role.flow_logs.arn
  log_destination = aws_cloudwatch_log_group.vpc_flow_logs.arn
  traffic_type    = "ALL"
  vpc_id          = aws_vpc.main.id

  max_aggregation_interval = 60
}
```

- [ ] **Step 4: Validate**

Run:

```powershell
terraform -chdir=terraform validate
```

Expected: validation succeeds.

### Task 10: Tighten Security Groups for W5 paths

**Files:**
- Modify: `terraform/modules/security-groups/main.tf`
- Modify: `terraform/modules/security-groups/outputs.tf`

- [ ] **Step 1: Add EFS security group**

Create `aws_security_group.efs` and ingress from app/worker SGs only on TCP/2049.

- [ ] **Step 2: Preserve inspected HTTPS egress**

Keep app/worker outbound internet egress restricted to TCP/443. Do not widen to all ports. Network Firewall enforces domain/IPS controls on that routed egress path.

- [ ] **Step 3: Output EFS security group ID**

Add output for EFS module wiring.

- [ ] **Step 4: Validate no broad NFS rule exists**

Run:

```powershell
Select-String -Path terraform/modules/security-groups/main.tf -Pattern "2049","0.0.0.0/0"
```

Expected: no NFS ingress from `0.0.0.0/0`.

---

## Batch 4: EFS Infrastructure and Submission Artifact Migration

### Task 11: Add EFS Terraform module and ECS mounts

**Files:**
- Create: `terraform/modules/efs/main.tf`
- Create: `terraform/modules/efs/variables.tf`
- Create: `terraform/modules/efs/outputs.tf`
- Modify: `terraform/main.tf`
- Modify: `terraform/modules/ecs-services/main.tf`
- Modify: `terraform/modules/ecs-services/variables.tf`

- [ ] **Step 1: Create encrypted EFS filesystem**

```hcl
resource "aws_efs_file_system" "submission_artifacts" {
  creation_token = "${var.project_name}-${var.environment}-submission-artifacts"
  encrypted      = true

  tags = {
    Name          = "${var.project_name}-${var.environment}-submission-artifacts"
    BackupEnabled = "true"
  }
}
```

- [ ] **Step 2: Create access point**

Use a controlled root such as `/submissions` with application POSIX user/group.

- [ ] **Step 3: Create mount targets in private data subnets**

Create one `aws_efs_mount_target` per private data subnet using the EFS security group.

- [ ] **Step 4: Mount EFS into submission-service and worker ECS tasks**

In ECS task definitions, add an EFS volume and mount point:

```hcl
volume {
  name = "submission-artifacts"

  efs_volume_configuration {
    file_system_id     = var.submission_artifacts_file_system_id
    transit_encryption = "ENABLED"

    authorization_config {
      access_point_id = var.submission_artifacts_access_point_id
      iam             = "ENABLED"
    }
  }
}
```

Add mount point:

```hcl
mountPoints = [
  {
    sourceVolume  = "submission-artifacts"
    containerPath = "/mnt/submission-artifacts"
    readOnly      = false
  }
]
```

- [ ] **Step 5: Add environment variables**

Set for submission-service and worker:

```text
STORAGE_DRIVER=efs
ARTIFACT_STORAGE_ROOT=/mnt/submission-artifacts
```

- [ ] **Step 6: Validate Terraform**

Run:

```powershell
terraform -chdir=terraform fmt -recursive
terraform -chdir=terraform validate
```

Expected: validation succeeds.

### Task 12: Add EFS support to backend storage settings/helpers

**Files:**
- Modify: `hexacode-backend/backend_common/settings.py`
- Modify: `hexacode-backend/backend_common/storage.py`

- [ ] **Step 1: Extend storage settings**

Add an artifact root setting loaded from `ARTIFACT_STORAGE_ROOT`, defaulting to a local path for Docker/local use.

- [ ] **Step 2: Implement safe EFS path resolution**

In `storage.py`, add a helper that prevents path traversal:

```python
def resolve_efs_object_path(root: str, bucket: str, object_key: str) -> Path:
    base = Path(root).resolve()
    candidate = (base / bucket / object_key).resolve()
    if base not in candidate.parents and candidate != base:
        raise ValueError("object_key resolves outside artifact storage root")
    return candidate
```

- [ ] **Step 3: Branch upload/download/delete for EFS**

For `settings.driver == "efs"`, write/read/delete bytes from the resolved filesystem path. Keep S3 behavior for problem assets and existing compatibility if the driver remains S3 locally.

- [ ] **Step 4: Add unit tests if a backend_common test location exists**

Test path traversal rejection and round-trip bytes using a temp directory.

Run with Docker if available:

```powershell
docker compose -f docker-compose.local.yml exec -T submission-service python -m pytest services/submission-service/tests -q
```

Expected: existing submission-service tests still pass.

### Task 13: Update schema metadata for EFS artifacts

**Files:**
- Modify: `hexacode-backend/db/new-app-schema.sql`

- [ ] **Step 1: Add minimal EFS-compatible metadata fields**

Add nullable fields to `storage.objects` if needed:

```sql
alter table storage.objects
  add column if not exists storage_driver text not null default 's3',
  add column if not exists filesystem_path text,
  add column if not exists artifact_kind text;
```

If this schema file creates tables from scratch, integrate the fields directly in the `create table if not exists storage.objects` block instead of only adding `alter table` statements.

- [ ] **Step 2: Preserve existing object references**

Do not remove `bucket` or `object_key`; use them as logical namespace/key for EFS-backed artifacts.

- [ ] **Step 3: Validate SQL by loading local stack**

Run:

```powershell
docker compose -f docker-compose.local.yml up -d --build postgres
```

Then apply the schema through the existing project workflow if available. Do not reset volumes unless the user explicitly approves.

### Task 14: Persist submission source artifacts to EFS

**Files:**
- Modify: `hexacode-backend/services/submission-service/app/main.py`

- [ ] **Step 1: Add helper to create storage object metadata for source**

Create a helper that:

1. Generates a deterministic key under `submission/{submission_id}/source/`.
2. Writes source bytes via `upload_object_bytes`.
3. Inserts a `storage.objects` row.
4. Returns the object ID.

- [ ] **Step 2: Update `create_submission_and_dispatch`**

Change the creation transaction so submission source is persisted to EFS-backed storage and `source_object_id` is stored. Keep `source_code` as fallback/cache only if needed for compatibility.

- [ ] **Step 3: Update source retrieval**

Update `get_submission_source_code()` to prefer `source_object_id`, falling back to inline `source_code` for legacy rows.

- [ ] **Step 4: Update judge context**

Ensure `get_judge_job_context()` includes source object metadata so the worker reads from EFS.

- [ ] **Step 5: Add/extend submission-service tests**

Test cases:

```text
- creating a submission stores source_object_id
- /api/submissions/{id}/source returns exact original source for object-backed row
- legacy inline source row still returns source text
```

Run:

```powershell
docker compose -f docker-compose.local.yml exec -T submission-service python -m pytest services/submission-service/tests -q
```

Expected: tests pass.

### Task 15: Persist worker stdout/stderr/compile artifacts

**Files:**
- Modify: `hexacode-backend/services/worker/app/main.py`
- Modify: `hexacode-backend/services/submission-service/app/main.py`

- [ ] **Step 1: Add artifact descriptor shape to worker payload**

Worker should send descriptors like:

```json
{
  "artifact_kind": "stdout",
  "object_key": "submission/<submission_id>/results/<result_id>/stdout.txt",
  "content_type": "text/plain; charset=utf-8",
  "size_bytes": 123,
  "sha256": "..."
}
```

Submission-service remains the DB writer for `storage.objects`.

- [ ] **Step 2: Worker writes artifact bytes**

Update result-building functions so non-empty stdout/stderr and compile logs are written through storage helpers. Keep short previews in the existing preview fields.

- [ ] **Step 3: Submission-service registers completion artifacts**

Update `mark_judge_job_completed()` so artifact descriptors are inserted into `storage.objects` within the same DB transaction that inserts `submission.results` and updates `submission.judge_runs`.

- [ ] **Step 4: Keep frontend download contract stable**

Ensure `stdout_object_id`, `stderr_object_id`, and `compile_log_object_id` still reference `storage.objects.id` and `download_submission_file()` streams bytes through authenticated backend routes.

- [ ] **Step 5: Add tests**

Test cases:

```text
- completion payload with stdout/stderr descriptors creates storage.objects rows
- result rows store stdout_object_id and stderr_object_id
- judge run stores compile_log_object_id
- download endpoint rejects object IDs not linked to the submission
```

Run:

```powershell
docker compose -f docker-compose.local.yml exec -T submission-service python -m pytest services/submission-service/tests -q
docker compose -f docker-compose.local.yml logs submission-service worker --tail=200
```

Expected: tests pass and no artifact path errors appear in logs.

---

## Batch 5: AWS Backup, Restore Testing, RDS Safety, and Alarms

### Task 16: Harden RDS production deletion/final snapshot behavior

**Files:**
- Modify: `terraform/modules/rds/main.tf`
- Modify: `terraform/modules/rds/variables.tf`
- Modify: `terraform/modules/rds/outputs.tf`

- [ ] **Step 1: Add prod-safe variables**

```hcl
variable "deletion_protection" {
  description = "Enable deletion protection for the DB instance."
  type        = bool
  default     = true
}

variable "skip_final_snapshot" {
  description = "Skip final snapshot when deleting the DB instance."
  type        = bool
  default     = false
}
```

- [ ] **Step 2: Update RDS instance**

Set:

```hcl
deletion_protection = var.environment == "prod" ? true : var.deletion_protection
skip_final_snapshot = var.environment == "prod" ? false : var.skip_final_snapshot
final_snapshot_identifier = var.environment == "prod" ? "${var.project_name}-${var.environment}-final-${formatdate("YYYYMMDDhhmmss", timestamp())}" : null
```

Note: if `timestamp()` causes perpetual diffs, replace with a variable-based final snapshot identifier in implementation.

- [ ] **Step 3: Output DB ARN**

Add:

```hcl
output "db_instance_arn" {
  value = aws_db_instance.main.arn
}
```

- [ ] **Step 4: Validate**

Run:

```powershell
terraform -chdir=terraform validate
```

Expected: validation succeeds.

### Task 17: Add AWS Backup module

**Files:**
- Create: `terraform/modules/backup/main.tf`
- Create: `terraform/modules/backup/variables.tf`
- Create: `terraform/modules/backup/outputs.tf`
- Create: `terraform/modules/backup/alarms.tf`
- Modify: `terraform/main.tf`
- Modify: `terraform/outputs.tf`

- [ ] **Step 1: Create backup vault and role**

Create `aws_backup_vault`, `aws_iam_role` for backup, and attach AWS managed backup service role policy if appropriate.

- [ ] **Step 2: Create daily backup plan**

Create an `aws_backup_plan` with daily schedule and retention >= 7 days. Production recommended retention can be 35 days.

- [ ] **Step 3: Add backup selections for RDS and EFS**

Select by explicit ARNs:

```hcl
resources = compact([
  var.rds_instance_arn,
  var.efs_file_system_arn,
])
```

Add W2 EBS ARNs later only if the deployed stack still has W2 EBS volumes.

- [ ] **Step 4: Add failure alarms**

Add CloudWatch/EventBridge-based failure notification path for backup and restore failures. Prefer EventBridge rule matching AWS Backup job state changes to `FAILED`, routed to SNS.

- [ ] **Step 5: Wire module in root**

Pass `module.rds.db_instance_arn` and `module.efs.file_system_arn`.

- [ ] **Step 6: Validate**

Run:

```powershell
terraform -chdir=terraform fmt -recursive
terraform -chdir=terraform validate
terraform -chdir=terraform plan -no-color
```

Expected: plan includes backup vault, backup plan, backup selection, and failure notification resources.

---

## Batch 6: Final Validation and Evidence Updates

### Task 18: Run Terraform formatting and validation

**Files:**
- All Terraform files touched above.

- [ ] **Step 1: Format Terraform**

Run:

```powershell
terraform -chdir=terraform fmt -recursive
```

Expected: command exits 0.

- [ ] **Step 2: Validate Terraform**

Run:

```powershell
terraform -chdir=terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Generate production plan**

Run the project's normal backend config/var-file command. If no backend is initialized in this workspace, run only after confirming with the user because backend initialization can affect local state.

Expected: plan shows W5 resources and no accidental destructive replacement of core production resources unless explicitly intended.

### Task 19: Run Docker-based backend validation

**Files:**
- Backend and schema files touched above.

- [ ] **Step 1: Start local stack**

Run:

```powershell
docker compose -f docker-compose.local.yml up -d --build
```

Expected: services start successfully.

- [ ] **Step 2: Run submission-service tests**

Run:

```powershell
docker compose -f docker-compose.local.yml exec -T submission-service python -m pytest services/submission-service/tests -q
```

Expected: tests pass.

- [ ] **Step 3: Run worker tests if present**

Run:

```powershell
docker compose -f docker-compose.local.yml exec -T worker python -m pytest services/worker/tests -q
```

Expected: tests pass or no worker tests exist. If no tests exist, record that explicitly.

- [ ] **Step 4: Smoke-test submission artifact flow**

Use the app's existing submission path to submit a small program, then confirm:

```sql
select id, source_object_id, source_code from submission.submissions order by created_at desc limit 5;
select id, stdout_object_id, stderr_object_id from submission.results order by created_at desc limit 5;
```

Expected: new rows have object IDs for source and any non-empty stdout/stderr artifacts; previews remain available.

### Task 20: Update Evidence Pack with implementation references

**Files:**
- Modify: `docs/weekly-requirements/W5-Evidence-Pack.md`

- [ ] **Step 1: Add Terraform resource references**

For each MH section, add the exact Terraform resource/module names created.

- [ ] **Step 2: Add verification command placeholders**

Add command snippets for:

```powershell
aws logs describe-log-groups --log-group-name-prefix "/aws/vpc/flow-logs"
aws network-firewall describe-firewall --firewall-name <firewall-name> --region us-west-2
aws backup list-backup-vaults --region us-west-2
```

- [ ] **Step 3: Keep screenshot placeholders until resources are deployed**

Do not invent evidence. Leave clear placeholders for screenshots that must be captured after apply.

- [ ] **Step 4: Verify no fictional claims**

Run:

```powershell
Select-String -Path docs/weekly-requirements/W5-Evidence-Pack.md -Pattern "<evidence to add>","<screenshot>","to be captured"
```

Expected: placeholders remain only where deployment screenshots are genuinely pending.

---

## Self-Review

### Spec coverage

- Single-VPC rationale: Task 1.
- Chat JWT auth before Lambda: Task 3.
- API Gateway throttling: Task 4.
- Lambda reserved concurrency and alarms: Task 5.
- WAF: Task 6.
- Regional NAT and Network Firewall: Tasks 7-8.
- VPC Flow Logs to CloudWatch: Task 9.
- Least-privilege SG/EFS rules: Task 10.
- EFS source of truth for artifacts: Tasks 11-15.
- AWS Backup/restore procedure/failure alarms: Tasks 2 and 16-17.
- Docker/Terraform validation: Tasks 18-20.

### Placeholder scan

The plan intentionally contains evidence placeholders only for screenshots and live AWS outputs that cannot exist before deployment. Implementation instructions avoid unspecified "do later" work.

### Type and naming consistency

The plan consistently uses:

- `source_object_id`, `stdout_object_id`, `stderr_object_id`, `compile_log_object_id` for artifact references.
- `ARTIFACT_STORAGE_ROOT=/mnt/submission-artifacts` for EFS mount path.
- `STORAGE_DRIVER=efs` for EFS-backed artifact mode.
- `docs/weekly-requirements/W5-Evidence-Pack.md` for the evidence pack file requested by the user.
