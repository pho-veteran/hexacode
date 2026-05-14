# AWS Production Readiness Design

## Goal

Make Hexacode ready for a real AWS production deployment, then perform and document that deployment end to end. The target runtime is ECS Fargate for the backend services and worker, with Terraform as the infrastructure control plane and ECR as the image registry.

This is not a deploy-as-is effort. Known drift and readiness gaps must be fixed before using admin AWS credentials for production rollout.

## Success Criteria

1. Infrastructure is reproducible: Terraform owns or explicitly bootstraps state, ECR, networking, ECS Fargate services, ALB/API Gateway, Cognito, CloudFront, queues, storage, DB, cache, and secrets wiring.
2. Known application gaps are closed: submission/result authorization, Terraform/backend environment variable drift, image tag naming drift, region/doc mismatch, and unclear queue retry behavior.
3. AWS smoke testing passes: Cognito login, local role lookup, Bedrock chatbot, problem listing/detail, code submission, SQS worker execution, verdict/result display, and unauthorized access denial.
4. The operator guide teaches the full path: Terraform, ECR upload, secrets, production deploy, seeding, admin promotion, Client VPN database access, debugging, rollback, and validation.

## Recommended Approach

Use a production-now rollout with a gated dry-run path:

1. Fix readiness blockers.
2. Validate Terraform and app contracts locally where possible.
3. Build and push images to ECR.
4. Run Terraform validation and plan.
5. Review the plan before apply.
6. Apply production infrastructure.
7. Seed initial data using repeatable operational commands.
8. Run production smoke tests.
9. Record every command, expected output, failure, fix, and verification result.

This balances production rigor with the user's learning goal. CI/CD automation can be added after the first clean deployment is repeatable.

## Workstreams

### 1. IaC Foundation

The Terraform layer must describe the same system the application expects to run:

- Choose and consistently use one production AWS region.
- Add or define remote Terraform state and locking.
- Make ECR explicit, preferably Terraform-managed. If bootstrapping is required, document it as a pre-Terraform step.
- Validate ECS Fargate task environment variables against backend settings.
- Align Docker image tags across Terraform, `scripts/push-ecr.ps1`, and deployment docs.
- Ensure `terraform.tfvars.example` is present, complete, and does not contain secrets.
- Remove stale path references and docs that point to missing or unrelated files.
- Review temporary/manual deployment artifacts for drift from Terraform.

### 2. Application Readiness

The deployed product must work from start to finish:

- Confirm Cognito sign-in and local `/api/auth/me` role bootstrap.
- Fix or verify authorization for submission detail and result endpoints.
- Verify problem catalog import from empty AWS resources.
- Verify problem list, detail, solve page, sample cases, and attachments.
- Verify submission creation, SQS dispatch, ECS Fargate worker execution, result callback, and frontend polling.
- Verify Bedrock Agent chatbot behavior with real AWS configuration.
- Verify user-facing behavior when chat dependencies fail.
- Confirm the queue/outbox retry path or document the operational recovery procedure.

### 3. Initial Data and Admin Bootstrap

Initial production data must be repeatable and auditable.

#### Initial Problems

Seed curated problems using the existing catalog importer and `data/problems` source of truth. The preferred AWS execution path is a one-off ECS Fargate task in the private subnets, using the same application image family, secrets, IAM permissions, and network access as the backend services.

The guide must include:

- how to run the import,
- how to verify imported problems,
- how to verify statement files and assets in S3,
- how to safely re-run or reset if needed.

#### Initial Admin

Cognito authenticates users, but application authorization lives in local Postgres. The preferred flow is:

1. The initial admin signs in through Cognito once.
2. The app creates or syncs the local `app_identity.users` row.
3. A repeatable admin-promotion command assigns the local `admin` role in `app_identity.user_role_assignments`.
4. `/api/auth/me` is checked to confirm admin capabilities.

The guide must document both the preferred scripted path and the direct SQL fallback.

### 4. Private Database Access

RDS must remain private. No public database endpoint and no broad inbound rule from the internet.

Use three access patterns:

1. **Repeatable operations:** one-off ECS Fargate tasks for problem seeding, admin bootstrap, and future migrations.
2. **Normal human access:** AWS Client VPN into the VPC, then local `psql` or a database GUI against the private RDS/RDS Proxy endpoint. Security groups and authorization rules must restrict access to the DB layer.
3. **Fallback / break-glass:** AWS Systems Manager Session Manager port forwarding through a private admin host if Client VPN is unavailable or intentionally avoided.

Client VPN is the recommended regular developer/admin access path. Session Manager is a fallback, not a required hop for normal VPN users.

### 5. Deployment Workflow

#### Preflight

- Confirm AWS account and production region.
- Confirm domain and DNS plan.
- Confirm AWS CLI, Docker, Terraform, database client, and VPN tooling.
- Confirm admin AWS credentials are active but not stored in docs or repo.
- Confirm required secrets are created or managed by Terraform.
- Confirm expected Bedrock Agent identifiers and permissions.

#### Readiness Fixes

- Fix Terraform/app environment drift.
- Fix ECR/image tag drift.
- Add or settle remote Terraform state and locking.
- Complete production tfvars example.
- Fix submission/result authorization.
- Add seed/admin operational commands.
- Create the production operator guide and update stale deployment docs.

#### Build and Publish

- Build backend images.
- Push traceable image tags to ECR.
- Build frontend assets.
- Upload frontend assets to the CloudFront origin bucket.
- Invalidate CloudFront when required.

#### Terraform Deployment

- Run `terraform init`.
- Run `terraform validate`.
- Run `terraform plan`.
- Review the plan.
- Run `terraform apply` only after review.
- Record failures and fixes in the deployment guide.

#### Smoke Tests

- Cognito login succeeds.
- `/api/auth/me` returns the expected user and role data.
- Initial problems are seeded and visible.
- Problem detail and solve pages load.
- Bedrock Agent chatbot responds.
- Failed chat dependency produces acceptable user-facing behavior.
- Practice submission is accepted.
- SQS dispatch occurs.
- ECS Fargate worker consumes the job.
- Verdict and result details render in the frontend.
- Unauthorized users cannot read other users' submissions or results.
- Client VPN database access works for approved users.

## Operator Guide Requirements

The guide must be written as a learning runbook. Every command should include:

- purpose,
- working directory,
- required inputs,
- expected successful output,
- common failure modes,
- where to check logs,
- rollback or recovery notes.

The guide must cover:

1. Terraform concepts used in this repo.
2. ECR image repository and tag strategy.
3. ECS Fargate service and one-off task execution.
4. RDS/RDS Proxy private access model.
5. Client VPN setup and use for database access.
6. Secrets Manager usage.
7. Cognito vs local app roles.
8. Preflight checklist.
9. Build and push workflow.
10. Terraform plan/apply workflow.
11. Frontend upload and CloudFront invalidation.
12. Initial problem seeding.
13. Initial admin promotion.
14. End-to-end smoke testing.
15. Debugging and rollback.
16. Cost and cleanup notes.

Secrets, credentials, account-specific private values, and admin passwords must not be written into the guide. Use placeholders and explain where each value comes from.

## Out of Scope for First Production Rollout

- Full CI/CD automation.
- Multi-region active-active deployment.
- Blue/green or canary deployment automation.
- Automated database migration framework beyond the initial repeatable operational commands.
- Large-scale load testing beyond basic production smoke validation.

These can be added after the first production deployment is repeatable and documented.
