# Production Readiness Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Hexacode's application code, Terraform, AWS deployment docs, and production runtime behavior before relying on the cloud deployment for real users.

**Architecture:** Keep the existing target shape from `docs/plan.md`: CloudFront/S3 frontend, API Gateway HTTP API, VPC Link, internal ALB, ECS Fargate services, RDS PostgreSQL through RDS Proxy, S3 object storage, ElastiCache Redis, and SQS + DLQ workers. The main work is contract alignment and production hardening, not replacing the architecture.

**Tech Stack:** Terraform 1.7+, AWS ECS Fargate, API Gateway HTTP API, ALB, Cognito, RDS PostgreSQL, RDS Proxy, ElastiCache Redis, S3, SQS, CloudFront, FastAPI, React/Vite.

---

## Executive Summary

The architecture direction is sound and mostly matches `docs/plan.md`, but production readiness is blocked by app/IaC contract drift and several missing AWS hardening controls.

The most important insight is that the Terraform is not just missing best-practice toggles: it currently injects environment variables that do not match what the Python services read. Fix those contracts first, otherwise the deployed infrastructure can be secure but non-functional.

## Highest-Priority Insights

### 1. Runtime environment contract drift is the biggest deploy blocker

**Evidence:**
- App reads queue URL from `SQS_JUDGE_QUEUE_URL`: `hexacode-backend/backend_common/settings.py:99-103`.
- Worker reads service URLs from `SUBMISSION_SERVICE_URL` and `PROBLEM_SERVICE_URL`: `hexacode-backend/services/worker/app/main.py:1366-1368`.
- Submission service reads `PROBLEM_SERVICE_URL`: `hexacode-backend/services/submission-service/app/main.py:110-129`.
- Terraform sets `SQS_QUEUE_URL` and `INTERNAL_ALB_URL` instead: `terraform/modules/ecs-services/main.tf:267-273`, `terraform/modules/ecs-services/main.tf:370-375`.
- Existing deployment docs already use the app contract names: `docs/aws-deployment-walkthrough.md:702-765`.

**Meaning:** Cloud ECS tasks will not reliably dispatch jobs, poll SQS, or call internal service endpoints until Terraform uses the same env names as the code.

**Later action:** Make `terraform/modules/ecs-services/main.tf` the source that injects the app's actual runtime contract: `SQS_JUDGE_QUEUE_URL`, `PROBLEM_SERVICE_URL`, `SUBMISSION_SERVICE_URL`, and service-specific Cognito settings.

### 2. Cognito wiring is incomplete and split across services

**Evidence:**
- JWT validation requires `COGNITO_ISSUER`, `COGNITO_JWKS_URL`, and `COGNITO_APP_CLIENT_ID`: `hexacode-backend/backend_common/auth.py:26-45`.
- Shared settings load the full Cognito set: `hexacode-backend/backend_common/settings.py:79-84`.
- Terraform gives identity service no Cognito env vars: `terraform/modules/ecs-services/main.tf:55-76`.
- Terraform gives problem service pool/client only, not issuer/JWKS: `terraform/modules/ecs-services/main.tf:148-179`.
- Terraform gives submission service issuer/JWKS only, not app client/pool ID: `terraform/modules/ecs-services/main.tf:261-292`.

**Meaning:** Some authenticated endpoints may fail in AWS even though Cognito exists.

**Later action:** Inject the complete Cognito runtime contract into every backend service that validates tokens: `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, `COGNITO_ISSUER`, and `COGNITO_JWKS_URL`.

### 3. Route manifest is the intended source of truth, but Terraform hardcodes cloud routes

**Evidence:**
- Plan requires one route manifest/OpenAPI source for local and cloud routing: `docs/plan.md:203-208`.
- Manifest defines prefix routes including `/api/chat`: `hexacode-backend/contracts/route-manifest.json:1-52`.
- Terraform hardcodes ALB listener paths: `terraform/modules/alb/main.tf:98-160`.
- Terraform hardcodes only `POST /api/chat/messages` for chat: `terraform/modules/api-gateway/main.tf:146-155`.

**Meaning:** The local gateway, API Gateway, and ALB can drift. This directly violates the adapter-swap goal in `docs/plan.md:412-420`.

**Later action:** Generate or validate API Gateway and ALB routing from `hexacode-backend/contracts/route-manifest.json` so route drift fails CI before deployment.

### 4. Worker scaling policy is not safe for long-running judge jobs

**Evidence:**
- Worker receives one message at a time and sets visibility to `max(interval_seconds * 2, 30)`: `hexacode-backend/services/worker/app/main.py:1388-1409`.
- Terraform queue default visibility is 300 seconds: `terraform/modules/sqs/main.tf:14-23`.
- Queue helper has no heartbeat/change-visibility support: `hexacode-backend/backend_common/queue.py:116-136`.
- Autoscaling uses only visible message depth and scales down when visible depth is empty: `terraform/modules/ecs-services/autoscaling.tf:160-271`.

**Meaning:** Long jobs can become visible too early or autoscaling can scale in while work is still in flight. This is a correctness risk, not just a capacity tuning issue.

**Later action:** Add message visibility extension/heartbeat support and scale on backlog-per-task using visible + not-visible/oldest-message metrics, or disable aggressive scale-in until in-flight work is observable.

### 5. Worker sandboxing is the largest application security concern

**Evidence:**
- Worker compiles/runs submissions and checkers inside the worker task using subprocess execution: `hexacode-backend/services/worker/app/main.py:150-179`, `hexacode-backend/services/worker/app/main.py:1024-1237`.
- `docs/aws.md` already identifies sandbox hardening as the biggest production risk.

**Meaning:** Scaling the worker with Fargate does not by itself create a safe untrusted-code sandbox. The worker task boundary protects AWS infrastructure more than it protects the worker process from each submitted program.

**Later action:** Treat production judge isolation as a separate milestone: per-job sandbox/container/jailer, filesystem isolation, network denial, syscall limits, CPU/memory/time limits, and artifact cleanup.

### 6. Terraform security hardening gaps remain before production

**Evidence:**
- Secrets are read and rewritten through Terraform state: `terraform/runtime-secrets.tf:1-18`.
- Redis has `at_rest_encryption_enabled = false` and no transit/auth controls: `terraform/modules/elasticache/main.tf:14-37`.
- RDS disables final snapshot and deletion protection: `terraform/modules/rds/main.tf:38-39`.
- SQS queues do not explicitly enable SSE: `terraform/modules/sqs/main.tf:4-29`.
- Data subnets have NAT default routes: `terraform/modules/vpc/main.tf:150-170`.
- CloudFront uses default cert and lacks WAF/logging: `terraform/modules/cloudfront/main.tf:14-66`.
- Terraform has no remote backend block: `terraform/versions.tf:1-14`.

**Meaning:** The current IaC is acceptable as a dev baseline, but not as a production baseline.

**Later action:** Harden the platform in this order: state backend, secret model, data encryption/auth, RDS deletion safety, network isolation, CloudFront edge controls.

### 7. Frontend can fit the CloudFront/API Gateway target, but production builds are fragile

**Evidence:**
- Frontend env falls back to `http://127.0.0.1:8080`: `hexacode-frontend/src/lib/env.ts:32-55`.
- API client uses that base URL for all relative requests: `hexacode-frontend/src/lib/api/client.ts:20-30`.
- CloudFront SPA hosting shape is mostly correct: `terraform/modules/cloudfront/main.tf:19-50`.
- CloudFront custom domain/TLS is not wired: `terraform/modules/cloudfront/main.tf:59-61`.
- Cognito callback URLs are only `var.frontend_domain`, not an explicit callback route: `terraform/modules/cognito/main.tf:120-126`.

**Meaning:** A production frontend build with missing env vars can silently point users at localhost. Auth also needs a deliberate decision: direct Cognito SDK sign-in versus Hosted UI code flow.

**Later action:** Make production frontend builds fail unless public API and Cognito env vars are present; choose and document the final auth flow.

---

## Recommended Work Sequence

### Task 1: Align ECS runtime environment variables

**Files:**
- Modify: `terraform/modules/ecs-services/main.tf`
- Verify against: `hexacode-backend/backend_common/settings.py`
- Verify against: `hexacode-backend/services/worker/app/main.py`
- Verify against: `hexacode-backend/services/submission-service/app/main.py`

- [ ] Replace `SQS_QUEUE_URL` with `SQS_JUDGE_QUEUE_URL` for submission service and worker.
- [ ] Replace `INTERNAL_ALB_URL` with `PROBLEM_SERVICE_URL` and `SUBMISSION_SERVICE_URL` where the app reads those names.
- [ ] Pass the internal ALB base URL as the value for both service URLs unless separate internal endpoints are introduced.
- [ ] Add the full Cognito env set to identity, problem, and submission services.
- [ ] Run `terraform -chdir=terraform fmt -check -recursive`.
- [ ] Run `terraform -chdir=terraform init` if modules are not installed, then `terraform -chdir=terraform validate`.
- [ ] Run a cloud or local ECS task-definition render check to confirm the final env names match `hexacode-backend/.env.example`.

### Task 2: Stop rewriting live application secrets in Terraform

**Files:**
- Modify: `terraform/runtime-secrets.tf`
- Modify if needed: `terraform/modules/ecs-services/main.tf`
- Review: `docs/plan.md:103`

- [ ] Remove the `data.aws_secretsmanager_secret_version.application` read of full `secret_string`.
- [ ] Remove the Terraform-managed rewrite of `DATABASE_URL` into the same shared secret.
- [ ] Decide between two safe alternatives:
  - create a dedicated runtime secret outside Terraform value interpolation, or
  - inject the RDS Proxy endpoint as non-secret config and let app bootstrap compose the final DSN.
- [ ] Mark any remaining secret-bearing outputs as sensitive if introduced.
- [ ] Run `terraform -chdir=terraform fmt -check -recursive` and `terraform -chdir=terraform validate` after init.

### Task 3: Make route drift detectable

**Files:**
- Review: `hexacode-backend/contracts/route-manifest.json`
- Modify: `terraform/modules/api-gateway/main.tf`
- Modify: `terraform/modules/alb/main.tf`
- Add or modify a validation script under `hexacode-backend/scripts/` or `terraform/` if generation is not implemented immediately.

- [ ] Define which manifest fields map to API Gateway Lambda routes versus ALB routes.
- [ ] Ensure `/api/chat` prefix behavior is represented in cloud, not only `POST /api/chat/messages`.
- [ ] Add a CI-checkable script that compares manifest routes with Terraform route definitions.
- [ ] Later, replace manual duplication with generated Terraform locals or generated `.tf.json` if the validation-only step proves useful.

### Task 4: Fix worker queue correctness before tuning scaling

**Files:**
- Modify: `hexacode-backend/backend_common/queue.py`
- Modify: `hexacode-backend/services/worker/app/main.py`
- Modify: `terraform/modules/sqs/main.tf`
- Modify: `terraform/modules/ecs-services/autoscaling.tf`

- [ ] Add queue support for `ChangeMessageVisibility`.
- [ ] Set receive visibility based on maximum expected job duration, not `interval_seconds * 2`.
- [ ] Add heartbeat-based visibility extension while a job is compiling/running.
- [ ] Add alarms for DLQ depth, oldest visible message age, and in-flight message count.
- [ ] Revise autoscaling to account for in-flight work before scale-in.
- [ ] Decide whether `WORKER_CONCURRENCY` should be implemented or removed.

### Task 5: Harden Terraform for production baseline

**Files:**
- Modify: `terraform/versions.tf`
- Modify: `terraform/modules/elasticache/main.tf`
- Modify: `terraform/modules/rds/main.tf`
- Modify: `terraform/modules/sqs/main.tf`
- Modify: `terraform/modules/vpc/main.tf`
- Modify: `terraform/modules/cloudfront/main.tf`
- Modify: `terraform/variables.tf`

- [ ] Add remote state backend configuration for team/prod use.
- [ ] Enable Redis at-rest encryption, transit encryption, and auth.
- [ ] Enable RDS deletion protection and final snapshots for production.
- [ ] Enable SQS SSE for main queue and DLQ.
- [ ] Make data subnets isolated unless a concrete data-tier egress requirement exists.
- [ ] Add CloudFront aliases, ACM cert input, access logging, and WAF attachment.
- [ ] Add variable validations for environment, CIDR, domains, ARNs, image tag, and region-sensitive certificate inputs.

### Task 6: Make frontend production builds fail closed

**Files:**
- Modify: `hexacode-frontend/src/lib/env.ts`
- Modify or add: frontend build/CI configuration
- Review: `terraform/modules/cognito/main.tf`
- Review: `hexacode-frontend/src/routes/auth-callback.tsx`

- [ ] Add a production-mode assertion that refuses missing public API/Cognito config.
- [ ] Keep localhost fallback only for local development.
- [ ] Choose final auth path: direct SDK auth or Hosted UI authorization-code flow.
- [ ] If using Hosted UI, implement a real `/auth/callback` token exchange path and update Cognito callback URLs.
- [ ] If using direct SDK auth, ensure Terraform Cognito app client supports the required auth flows and remove misleading callback assumptions.

### Task 7: Separate app bootstrap from production startup

**Files:**
- Modify: `hexacode-backend/backend_common/bootstrap.py`
- Modify: `hexacode-backend/services/identity-service/app/main.py`
- Modify: `hexacode-backend/services/problem-service/app/main.py`
- Modify: `hexacode-backend/services/submission-service/app/main.py`
- Modify: `hexacode-backend/services/worker/app/main.py`
- Add or document: one-off bootstrap/migration job path

- [ ] Add an explicit production setting that disables schema, bucket, and queue mutation on normal service startup.
- [ ] Keep local developer bootstrap behavior convenient.
- [ ] Move production schema/object/queue setup into a controlled deploy step or one-off ECS task.
- [ ] Ensure health checks do not report ready until required dependencies are reachable.

### Task 8: Upgrade health and observability to match the plan

**Files:**
- Modify: service `main.py` files under `hexacode-backend/services/*/app/`
- Modify: `terraform/modules/ecs-cluster/main.tf`
- Modify: `terraform/modules/api-gateway/main.tf`
- Modify: `terraform/modules/ecs-services/autoscaling.tf`

- [ ] Define `/healthz` as process liveness and add a separate readiness endpoint if needed.
- [ ] Check DB/Redis/S3/SQS readiness in the appropriate services.
- [ ] Add structured request/error logs consistently, not just correlation IDs.
- [ ] Add CloudWatch alarms for API 5xx, ECS task restarts, worker failures, DLQ depth, old messages, RDS health, and Redis health.
- [ ] Decide on tracing/OpenTelemetry before adding broad instrumentation.

---

## Current Positive Alignment

- The cloud target in `docs/plan.md` still makes sense for the codebase: SPA frontend, thin public gateway, private services, worker-only queue consumption, S3 storage, Redis cache, and RDS-backed service schemas.
- ECS services are already private with `assign_public_ip = false`: `terraform/modules/ecs-services/main.tf:98-102`, `211-215`, `324-328`, `421-425`.
- RDS Proxy requires TLS: `terraform/modules/rds-proxy/main.tf:23-37`.
- S3 buckets have server-side encryption and public access blocks: `terraform/modules/s3-buckets/main.tf:21-38`, `57-74`, `121-138`.
- API Gateway access logs and ECS log groups already exist: `terraform/modules/api-gateway/main.tf:47-76`, `terraform/modules/ecs-cluster/main.tf:36-60`.
- The worker is correctly modeled as execution-only in the plan and code; the missing piece is stronger isolation and queue correctness.

## Verification Notes From This Audit

- `ccc search --refresh cloud deployment architecture gateway Cognito S3 SQS Redis RDS Proxy health configuration environment` completed and refreshed the index.
- `terraform -chdir=terraform fmt -check -recursive` passed with no output during the earlier Terraform audit.
- `terraform -chdir=terraform validate` could not run before `terraform init`; Terraform reported local modules were not installed.
- Targeted grep confirmed missing Terraform controls for backend, WAF/logging, Redis transit/auth, SQS encryption, container health checks, read-only filesystems, and variable validation.
