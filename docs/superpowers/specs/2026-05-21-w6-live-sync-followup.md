# W6 Live Sync Follow-up Spec

**Scope:** Capture the local Terraform/settings work required to reconcile the live AWS changes made during the W6 evidence-first cleanup pass.

## Why this exists

The evidence pass intentionally prioritized live AWS closure first. This file records what must later be codified locally so the repo becomes the source of truth again.

## Live changes to model locally

### 1. Backup selection parity for `>=3` explicit resources

Current live backup selection now includes:
- `arn:aws:elasticfilesystem:us-west-2:583909632851:file-system/fs-05d2d37b6ac8518ff`
- `arn:aws:rds:us-west-2:583909632851:db:hexacode-prod-db`
- `arn:aws:s3:::hexacode-prod-problem-assets`

Local sync work:
- Extend the backup module interface to support explicit S3 backup resources.
- Update `terraform/main.tf` wiring so `problem-assets` is modeled as part of the protected resource set.
- Keep the explicit-resource model; do not switch to tag-only selection.

Relevant files:
- `terraform/main.tf`
- `terraform/variables.tf`
- `terraform/modules/backup/main.tf`

### 2. Backup service role permissions for S3 backup

Live change:
- `hexacode-prod-backup-service-role` now has S3-backup permissions attached.

Local sync work:
- Model the required S3 backup policy attachment in Terraform so the live role no longer drifts.
- Make the permission scope match AWS Backup’s S3 backup requirements without broadening unrelated access.

Relevant files:
- `terraform/modules/backup/main.tf`
- any IAM resources currently managing `hexacode-prod-backup-service-role`

### 3. CloudWatch dashboard/query-definition resources

Live change:
- Dashboard `HexaCode-Production-Observability` was updated with backup metric/alarm widgets.
- Saved Logs Insights query `hexacode-prod-backup-failure-events` was created live.
- The EventBridge rule was fixed so restore failures match `detail.status = FAILED`.
- The metric filter was fixed so both `detail.state = FAILED` and `detail.status = FAILED` emit `HexacodeBackupFailures` datapoints.
- The CloudWatch Logs resource policy was broadened to the AWS-documented `/aws/events/*:*` pattern.

Local sync work:
- Decide whether the existing dashboard should be fully Terraform-managed or whether W6 evidence widgets should live in a dedicated dashboard resource.
- Add a query-definition resource for the saved Logs Insights query if this project wants it under source control.
- Codify the EventBridge rule pattern, the corrected metric filter pattern, and the CloudWatch Logs resource policy shape so this live fix no longer drifts.

Relevant files:
- `terraform/modules/backup/alarms.tf`
- any dashboard/query Terraform location chosen for ownership

### 4. Security Guard Lambda / IAM

Live change:
- Created `hexacode-prod-security-guard-lambda-role`
- Created `hexacode-prod-security-guard`
- Added least-privilege S3 BPA remediation for the chosen bucket

Local sync work:
- Decide whether this security-remediation Lambda is a permanent production control or evidence-only helper.
- If permanent, model the Lambda, IAM role, inline policy, packaging approach, and invocation path in Terraform.
- If not permanent, document a removal plan and do not silently leave the live resource unmanaged.

Relevant files:
- `terraform/modules/cost-controls/main.tf` as the closest existing guard-pattern reference
- `terraform/modules/s3-buckets/main.tf`
- `terraform/main.tf`

### 5. Broad IAM `Resource = "*"` cleanup still needed

Observed during review:
- Existing guard-style IAM in `terraform/modules/cost-controls/main.tf` still uses broad `resources = ["*"]`.

Local sync work:
- Review whether those permissions can be narrowed to concrete resources or tighter conditions.
- Keep this as a separate hardening task from the evidence-closeout work.

Relevant files:
- `terraform/modules/cost-controls/main.tf`

### 6. W6 tag modeling is still not globally represented in code

Observed live decision:
- The W6 evidence pass normalized a curated screenshot set only.

Local sync work:
- Decide whether the four-key W6 schema (`Owner`, `Environment`, `CostCenter`, `Application`) should be reflected in provider default tags, module-level tags, or only specific resources.
- Avoid claiming estate-wide standardization until code ownership and rollout scope are explicit.

Relevant files:
- `terraform/main.tf`
- `terraform/modules/cost-controls/main.tf`
- `terraform/modules/s3-buckets/main.tf`

## Non-goals for this follow-up

- Do not reopen W6 evidence packaging work that already closed live.
- Do not mix Management VPC drift reconciliation into this stream.
- Do not mix billing-console-only checks into Terraform sync.

## Recommended implementation order

1. Model backup selection parity and S3 backup role permissions.
2. Decide ownership for dashboard/query resources and codify the now-working backup-failure log delivery path.
3. Decide whether the Security Guard Lambda is permanent, then codify or remove it.
4. Handle broader tag-standardization and IAM-scope cleanup as separate hardening work.
