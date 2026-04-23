**1. Architecture Summary**
Hexacode is a React SPA plus a FastAPI backend split into a thin API gateway, `identity-service`, `problem-service`, `submission-service`, a separate queue-polling `worker`, and an AWS `chat-lambda` for Bedrock-backed chat. Local infrastructure is PostgreSQL, Redis, MinIO, and ElasticMQ; the cloud target should preserve that shape with adapter swaps rather than an application rewrite.

The real boundaries from code are: gateway does path routing/CORS/correlation IDs and simulates API Gateway HTTP API v2 for chat by invoking Lambda directly in local development; every backend service validates Cognito JWTs itself; `problem-service` owns problem authoring/read flows and problem-file storage; `submission-service` owns submissions/judge jobs/results and publishes judge jobs to SQS; `worker` consumes the queue, calls internal service APIs, executes code, and reports results back; `chat-lambda` accepts an API Gateway HTTP API v2 event, calls Bedrock, and returns a Lambda proxy response. `frontend` talks only to the gateway and authenticates directly against Cognito from the browser.

Evidence: [docker-compose.local.yml](/C:/Users/thanh/Desktop/workspace/xbrain-courses/hexacode/docker-compose.local.yml), [route-manifest.json](/C:/Users/thanh/Desktop/workspace/xbrain-courses/hexacode/hexacode-backend/contracts/route-manifest.json), [new-app-schema.sql](/C:/Users/thanh/Desktop/workspace/xbrain-courses/hexacode/hexacode-backend/db/new-app-schema.sql), [api-gateway](/C:/Users/thanh/Desktop/workspace/xbrain-courses/hexacode/hexacode-backend/services/api-gateway/app/main.py), [chat-lambda](/C:/Users/thanh/Desktop/workspace/xbrain-courses/hexacode/hexacode-backend/services/chat-lambda/handler.py), [submission-service](/C:/Users/thanh/Desktop/workspace/xbrain-courses/hexacode/hexacode-backend/services/submission-service/app/main.py:1430), [worker](/C:/Users/thanh/Desktop/workspace/xbrain-courses/hexacode/hexacode-backend/services/worker/app/main.py), [frontend auth/client](/C:/Users/thanh/Desktop/workspace/xbrain-courses/hexacode/hexacode-frontend/src/lib/auth/cognito.ts:191).

**2. Service Breakdown**
- `frontend`: React/Vite SPA. Public API calls are `/api/problems`, `/api/tags`, `/api/runtimes`, `/api/auth/me`, `/api/submissions*`, and dashboard routes via the gateway. Auth is direct browser-to-Cognito using the Cognito Identity Provider SDK; the SPA stores tokens in localStorage and sends `idToken` first as the bearer token.
- `api-gateway`: Public backend entrypoint. Reads [route-manifest.json](/C:/Users/thanh/Desktop/workspace/hexacode/hexacode-backend/contracts/route-manifest.json) and proxies `/api/auth` and `/api/dashboard/users` to identity, `/api/problems`, `/api/tags`, `/api/dashboard/*` to problem, and `/api/submissions`, `/api/runtimes`, `/api/dashboard/operations` to submission. No DB, cache, queue, or JWT validation.
- `api-gateway`: Public backend entrypoint. Reads [route-manifest.json](/C:/Users/thanh/Desktop/workspace/xbrain-courses/hexacode/hexacode-backend/contracts/route-manifest.json) and proxies `/api/auth` and `/api/dashboard/users` to identity, `/api/problems`, `/api/tags`, `/api/dashboard/*` to problem, and `/api/submissions`, `/api/runtimes`, `/api/dashboard/operations` to submission. For `/api/chat/*`, local development simulates AWS API Gateway HTTP API v2 by building the Lambda event shape and invoking the configured Lambda directly. No DB, cache, or JWT validation.
- `identity-service`: Responsibilities are `/api/auth/me`, dashboard user directory, enable/disable users, and role grant/revoke. Dependencies are PostgreSQL and Cognito JWKS. Logical ownership is `app_identity.*`; it also reads counts from `problem.problems` and `submission.submissions` for dashboard summaries.
- `problem-service`: Public APIs are `/api/problems`, `/api/problems/{slug}`, `/api/problems/{slug}/solve`, `/api/problems/{slug}/files/{object_id}`, `/api/tags`. Dashboard APIs cover problems, tags, testsets, testcase edits, lifecycle actions, and storage orphan cleanup. Internal APIs are `/internal/problems/{problem_id}/judge-context`, `/internal/checkers/{checker_id}/compiled-artifact`, and `/internal/cache/public-problems/invalidate`. Dependencies are PostgreSQL, Redis, Cognito JWKS, and the problems S3-compatible bucket. Logical ownership is `problem.*` plus most problem-related `storage.objects` rows.
- `submission-service`: Public APIs are `/api/runtimes`, `/api/submissions`, `/api/submissions/{id}`, `/api/submissions/{id}/source`, `/api/submissions/{id}/results`, `/api/submissions/{id}/files/{object_id}`, and `/api/dashboard/operations`. Internal APIs are `/internal/runtimes/{profile_key}`, `/internal/judge-jobs/{job_id}/context`, `/started`, and `/completed`. Dependencies are PostgreSQL, SQS, Cognito JWKS, internal HTTP call to problem-service for cache invalidation, and S3 read paths for submission files. Logical ownership is `submission.*`; it also updates `problem.problem_stats`.
- `worker`: No public API. Polls SQS, fetches submission context from submission-service, fetches problem judge context from problem-service, optionally fetches checker runtime context, runs compile/execute locally in the container, uploads compiled custom checker artifacts to the problems bucket, and posts started/completed callbacks to submission-service. Dependencies are SQS, internal HTTP to problem/submission services, and S3. The Dockerfile installs `g++`; execution is direct subprocess execution inside the container.
- `chat-lambda`: No database ownership. Accepts `POST /api/chat/messages` in Lambda proxy form, validates the session/message/page-context payload, calls Amazon Bedrock using `converse`, and returns a Lambda proxy response containing the frontend API envelope. In cloud it sits behind real AWS API Gateway; in local dev the thin gateway invokes it directly to preserve the same request/response contract.

**3. Data Flow**
- Request flow: browser authenticates directly with Cognito; browser sends bearer token to gateway; gateway forwards the request unchanged except for `x-correlation-id`; the target service validates the Cognito JWT against JWKS, verifies issuer and app-client audience, ensures a local `app_identity.users` row exists, then serves from PostgreSQL, Redis, and S3 as needed.
- Chat flow: browser posts `POST /api/chat/messages` to the gateway; in local dev the gateway constructs an API Gateway HTTP API v2 event and invokes the configured Lambda directly; in cloud the real AWS API Gateway forwards the same route to Lambda; Lambda validates the payload, calls Bedrock, and returns a Lambda proxy response. The frontend contract stays the same in both environments.
- Problem read flow: public problem list/detail/solve endpoints are served by `problem-service`; Redis caches public list/detail/solve responses with versioned keys and explicit invalidation.
- Submission create flow: `submission-service` validates runtime/problem/testset inputs, inserts `submission.submissions`, inserts `submission.judge_jobs`, inserts `submission.outbox_events`, then publishes one SQS message.
- Queue contract: the judge message shape is exactly `judge_job_id`, `submission_id`, `problem_id`, `runtime_profile_key`, `user_id`, `trace_id`, `submitted_at`.
- Worker start contract: worker calls `/internal/judge-jobs/{job_id}/started` with `worker_name`, optional `worker_version`, `limits_json`, and optional `note`.
- Worker completion contract: worker calls `/internal/judge-jobs/{job_id}/completed` with `worker_name`, `status_code`, `verdict_code`, `runtime_ms`, `memory_kb`, optional `compile_log_object_id`, `compile_exit_code`, `compile_time_ms`, and a `results[]` array. Each result is `compile`, `testcase`, or `custom_case`; testcase results may carry previews plus `stdout_object_id` and `stderr_object_id`.
- Internal judge context boundary: `submission-service` returns submission source/runtime/job context; `problem-service` returns problem limits, chosen testset, testcase inputs/outputs, and active checker metadata.
- Storage contract: `storage.objects` stores only metadata: `bucket`, `object_key`, `content_type`, `original_filename`, `size_bytes`, `sha256`, `etag`, `metadata_json`.
- Object key patterns actually used in code: `problem/{problem_id}/statement/{object_id}.{ext}`, `problem/{problem_id}/media/{object_id}-{filename}`, `testset/{testset_id}/archive/{object_id}.{ext}`, `testset/{testset_id}/cases/{ordinal}/input.{ext}`, `testset/{testset_id}/cases/{ordinal}/output.{ext}`, `problem/{problem_id}/checker/{object_id}.{ext}`, `problem/{problem_id}/checker/{checker_id}/compiled/{sha256}-{artifact}`.
- Database ownership: `app_identity.*` is identity; `problem.*` is problem-service; `submission.*` is submission-service; `storage.objects` is shared metadata. Cross-service leakage exists today: identity reads problem/submission counts, and submission-service writes `problem.problem_stats`.
- Auth contract: services accept either Cognito `id` or `access` tokens, require `exp`, `iat`, `sub`, verify issuer, and require `aud` or `client_id` to equal `COGNITO_APP_CLIENT_ID`. Gateway does not enforce auth.
- API Gateway HTTP API v2 note: this is the newer Lambda event/response contract used by AWS HTTP API integrations. The request includes fields such as `version: "2.0"`, `rawPath`, `rawQueryString`, `headers`, `requestContext.http`, `body`, and `isBase64Encoded`. The Lambda returns `statusCode`, `headers`, `body`, optional `cookies`, and `isBase64Encoded`. The local gateway now simulates that contract for chat so the same Lambda handler works locally and in AWS.

**4. AWS Mapping Table**

| Local component | AWS target | Why |
|---|---|---|
| React frontend | S3 static site origin + CloudFront | Repo frontend is a SPA; current frontend Dockerfile is dev-only, so production should publish `dist/` not run `npm run dev`. |
| Thin local gateway | API Gateway HTTP API + VPC Link + internal ALB | Matches the repo’s “thin gateway” intent and route-manifest model; API Gateway stays public and thin, ALB handles private fan-out to ECS services. |
| `identity-service` | ECS Fargate service behind internal ALB | Stateless FastAPI service with DB/JWKS dependency; no reason for EKS. |
| `problem-service` | ECS Fargate service behind internal ALB | Stateless HTTP service with RDS, Redis, and S3 dependencies; fits Fargate well. |
| `submission-service` | ECS Fargate service behind internal ALB | Stateless HTTP service with RDS and SQS producer role; fits Fargate well. |
| `chat-lambda` | AWS Lambda behind API Gateway HTTP API | Chat is already implemented as a Lambda proxy handler that calls Bedrock and does not need to transit a containerized FastAPI service. |
| `worker` | ECS Fargate service without LB, polling SQS | Matches current long-running polling worker model and keeps it isolated from public traffic. |
| PostgreSQL | RDS for PostgreSQL 16 | Local stack uses Postgres 16; shared multi-schema database maps directly to one RDS cluster/instance. |
| MinIO | S3 buckets | Code already uses boto3 S3 APIs and stores bucket/key metadata only. |
| Redis | ElastiCache for Redis | Current Redis usage is cache-only and disposable. |
| ElasticMQ | SQS + DLQ | Current queue driver is SQS-compatible and already uses boto3 SQS. |
| Cognito | Cognito User Pool + App Client | Frontend already uses Cognito directly and services validate Cognito JWTs. |

Assumption: queue URL/name, actual bucket names, and Cognito IDs are env-driven and not hard-coded in the repo, so the names below are recommended production names rather than discovered literals.

**5. Architecture Diagram (text)**
```text
Internet
  |
  +--> CloudFront --> S3 frontend bucket
  |
  +--> Cognito User Pool public endpoints
  |
  +--> API Gateway HTTP API (public)
  |      |
  |      +--> Lambda: chat-lambda -> Bedrock
  |
  +--> local dev only: thin local gateway simulating API Gateway HTTP API v2 for chat

API Gateway HTTP API
  |
  +--> VPC Link
        |
        +--> Internal ALB (private app subnets)
              |
              +--> ECS Fargate: api-gateway replacement routing layer is ALB listener rules
              +--> ECS Fargate: identity-service
              +--> ECS Fargate: problem-service
              +--> ECS Fargate: submission-service

Private app subnets
  |
  +--> ECS Fargate: worker (no inbound listener)
          |
          +--> SQS judge queue
          +--> Internal ALB -> submission-service internal APIs
          +--> Internal ALB -> problem-service internal APIs
          +--> S3 problem bucket

Private data subnets
  |
  +--> RDS PostgreSQL (shared cluster, separate schemas)
  +--> ElastiCache Redis

Storage and async
  |
  +--> problem-service <-> S3 problem-assets bucket
  +--> worker -> S3 problem-assets bucket (compiled checker cache)
  +--> submission-service -> SQS judge queue -> worker
  +--> submission-service -> RDS submission schema/results/outbox
  +--> problem-service <-> Redis public-problem cache

Egress
  |
  +--> NAT / endpoints for Cognito JWKS, ECR, CloudWatch, Secrets Manager, SQS, S3
```

**6. Deployment Plan (step-by-step)**
1. Provision the network first: VPC, two AZs, public subnets for NAT, private app subnets for ECS/internal ALB, private data subnets for RDS/Redis, route tables, NAT gateways, and VPC endpoints where used.
2. Provision managed stateful services: RDS PostgreSQL 16, ElastiCache Redis, S3 buckets, SQS queue plus DLQ, Secrets Manager parameters/secrets, and Cognito User Pool/App Client.
3. Create ECR repos for `identity-service`, `problem-service`, `submission-service`, and `worker`. Do not containerize the frontend for prod; build static assets instead.
4. Build and push backend images using the repo’s actual Dockerfile contexts. Important detail: `problem-service` builds from repo root, while the other backend services build from `hexacode-backend/`.
5. Create the ECS Fargate cluster, CloudWatch log groups, execution role, and per-service task roles. Use private subnets only. Set `S3_ENDPOINT` and `SQS_ENDPOINT` empty in AWS; keep `S3_BUCKET_*`, `SQS_JUDGE_QUEUE_URL`, `DATABASE_URL`, `REDIS_URL`, and `COGNITO_*` as env/secrets.
6. Create an internal ALB with path-based rules matching the repo route manifest. Attach separate target groups for identity, problem, and submission services; use `/healthz` health checks.
7. Deploy `identity-service`, `problem-service`, and `submission-service` as separate ECS services behind the ALB. Set internal service URL env vars to the internal ALB DNS name so service-to-service calls and worker callbacks use the same private entrypoint.
8. Create API Gateway HTTP API with one VPC Link to the internal ALB. Mirror the route manifest prefixes as API Gateway routes, enable CORS for the frontend domain, and enable access logs.
9. Add a dedicated `POST /api/chat/messages` route in API Gateway HTTP API that integrates directly with the deployed `chat-lambda` instead of forwarding that route through the internal ALB.
10. Deploy the worker as a separate ECS service with no load balancer. Wire it to the SQS queue URL, internal ALB DNS for `PROBLEM_SERVICE_URL` and `SUBMISSION_SERVICE_URL`, and a distinct task role.
11. Run database bootstrap as a controlled one-off deployment step before traffic cutover. The services also attempt schema bootstrap on startup today, but production should still execute `new-app-schema.sql` first to reduce startup-time DDL races.
12. Run the curated problem import as a separate admin job. The repo’s import remains script-driven and depends on `data/problems/`; execute it from CI/CodeBuild or a one-off ECS/runner job that has the repo checkout or a packaged catalog artifact.
13. Build the frontend with `npm --prefix hexacode-frontend run build`, upload `hexacode-frontend/dist` to the frontend S3 bucket, front it with CloudFront, and set public env values so `apiBaseUrl` points to the API Gateway custom domain and Cognito settings point to the production User Pool/App Client.
14. Add observability before go-live: API Gateway access logs, ALB access logs or metrics, ECS service logs, Lambda logs/metrics, RDS enhanced monitoring, Redis metrics, SQS backlog alarms, and ECS autoscaling policies. Preserve the app’s `x-correlation-id` across API Gateway, ALB, Lambda, services, and worker logs.

**7. Risks & Recommendations**
- The worker executes untrusted code directly with local subprocesses and only light process limits. This is the biggest production risk. Keep the worker in a separate ECS service with no inbound access and minimal IAM; plan a stronger sandbox before internet-scale use.
- The worker currently receives SQS messages with a visibility timeout of about 30 seconds by default. Long-running jobs can be duplicated. Fix the code to extend visibility or use a longer dynamic timeout before production load.
- The database is shared and not cleanly isolated yet. `submission-service` writes `problem.problem_stats`, and `identity-service` joins across schemas for dashboard counts. Treat this as a shared-cluster/multi-schema system operationally, not as fully independent microservice data ownership.
- Schema bootstrap happens inside service startup. It is idempotent and advisory-locked, but that is still not ideal for production rollouts. Use a dedicated migration/bootstrap step and keep the in-app bootstrap only as a temporary safety net.
- Internal service-to-service calls have no explicit service auth; they rely on private networking. Keep the ALB internal, lock SGs tightly, and add signed service auth later if the platform grows.
- The submission bucket is configured in shared settings but is not actively written by current code. Provision it anyway because the storage contract expects it, but do not assume current workloads justify heavy lifecycle engineering there yet.
- The frontend Dockerfile is not production-ready; it runs the dev server. Production must use S3 + CloudFront.
- Cost risk is the API Gateway + VPC Link + internal ALB double-hop plus NAT gateways. That is the right shape for this repo, but add VPC endpoints to reduce NAT traffic and monitor worker scale because judge workloads can dominate cost.

**8. Infrastructure Specification (Terraform-ready level)**

**8.1 VPC Design**
- Region assumption: `ap-southeast-1`; keep all AZ/resource names consistent if you choose another region.
- `vpc_cidr`: `10.20.0.0/16`
- `public_subnet_a`: `10.20.0.0/24` in `ap-southeast-1a`
- `public_subnet_b`: `10.20.1.0/24` in `ap-southeast-1b`
- `private_app_subnet_a`: `10.20.10.0/24` in `ap-southeast-1a`
- `private_app_subnet_b`: `10.20.11.0/24` in `ap-southeast-1b`
- `private_data_subnet_a`: `10.20.20.0/24` in `ap-southeast-1a`
- `private_data_subnet_b`: `10.20.21.0/24` in `ap-southeast-1b`
- Internet Gateway attached to VPC; one NAT Gateway per public subnet.
- Public route table: `0.0.0.0/0 -> igw`
- Private app/data route tables: `0.0.0.0/0 -> nat`
- S3 Gateway Endpoint attached to private route tables; Interface Endpoints recommended for ECR API, ECR DKR, CloudWatch Logs, Secrets Manager, STS, and SQS.
- Note: ALB should be internal and live in `private_app_*`, not public subnets, because API Gateway is the public edge. Public subnets exist for NAT and future edge needs.

**8.2 Networking & Security**
- `sg_apigw_vpclink`: inbound none; outbound `tcp/443` to `sg_internal_alb`.
- `sg_internal_alb`: inbound `tcp/443` from `sg_apigw_vpclink`; outbound `tcp/8000` to `sg_api_services`.
- `sg_api_services`: inbound `tcp/8000` from `sg_internal_alb`; outbound `tcp/5432` to `sg_rds`; outbound `tcp/6379` to `sg_redis`; outbound `tcp/443` to `sg_internal_alb`; outbound `tcp/443` to `0.0.0.0/0` for Cognito JWKS and AWS APIs through NAT/endpoints.
- `sg_worker`: inbound none; outbound `tcp/443` to `sg_internal_alb`; outbound `tcp/443` to `0.0.0.0/0`.
- `sg_rds`: inbound `tcp/5432` from `sg_api_services`; outbound default all within VPC.
- `sg_redis`: inbound `tcp/6379` from `sg_api_services`; outbound default all within VPC.
- ALB listener should be `443` with ACM cert on the internal ALB if you want TLS on the VPC hop; backend target groups can stay `HTTP:8000`.

**8.3 IAM Roles & Policies**
- `ecs_task_execution_role`: trust `ecs-tasks.amazonaws.com`; permissions `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, `logs:CreateLogStream`, `logs:PutLogEvents`, `logs:CreateLogGroup` if not pre-created.
- `ecs_task_role_identity`: trust `ecs-tasks.amazonaws.com`; `secretsmanager:GetSecretValue` or `ssm:GetParameter` for identity service config; `kms:Decrypt` for the CMK protecting those secrets; no S3 or SQS permissions.
- `ecs_task_role_problem`: trust `ecs-tasks.amazonaws.com`; secret reads; `s3:ListBucket` on `hexacode-${env}-problem-assets` with prefix conditions `problem/*` and `testset/*`; `s3:GetObject`,`PutObject`,`DeleteObject` on `arn:aws:s3:::hexacode-${env}-problem-assets/problem/*` and `.../testset/*`.
- `ecs_task_role_submission`: trust `ecs-tasks.amazonaws.com`; secret reads; `sqs:GetQueueUrl`,`sqs:GetQueueAttributes`,`sqs:SendMessage` on the judge queue ARN; `s3:GetObject` on `hexacode-${env}-submission-artifacts/*`.
- `ecs_task_role_worker`: trust `ecs-tasks.amazonaws.com`; secret reads; `sqs:GetQueueUrl`,`sqs:GetQueueAttributes`,`sqs:ReceiveMessage`,`sqs:DeleteMessage`,`sqs:ChangeMessageVisibility` on the judge queue ARN; `s3:GetObject` on `hexacode-${env}-problem-assets/problem/*`, `.../testset/*`, and `hexacode-${env}-submission-artifacts/submission/*`; `s3:PutObject` on `hexacode-${env}-problem-assets/problem/*/checker/*/compiled/*`.
- API Gateway custom IAM role is not required for HTTP API -> VPC Link -> ALB forwarding; use the AWS service-linked role for VPC Link/log delivery.

**8.4 S3 Bucket Design**
- `hexacode-${env}-frontend`: private bucket, Block Public Access on, read only through CloudFront Origin Access Control.
- `hexacode-${env}-problem-assets`: private bucket, Block Public Access on, bucket-owner-enforced, SSE-S3 or SSE-KMS, versioning on.
- Problem bucket prefixes from code: `problem/{problem_id}/statement/*`, `problem/{problem_id}/media/*`, `testset/{testset_id}/archive/*`, `testset/{testset_id}/cases/{ordinal}/*`, `problem/{problem_id}/checker/*`, `problem/{problem_id}/checker/{checker_id}/compiled/*`.
- `hexacode-${env}-submission-artifacts`: private bucket, same encryption/public-block posture. Current repo reserves it in config but does not actively write objects there; keep prefix policy `submission/{submission_id}/*` for future source/log/stdout/stderr storage.
- Access pattern: frontend bucket read by CloudFront only; problem bucket read/write by problem-service and worker; submission bucket read by submission-service and read-capable by worker for future `source_object_id` support.
- Lifecycle: no expiry for statements/testcases; optionally expire `problem/*/checker/*/compiled/*` after 90 days; do not add destructive expiry to submission artifacts until the product decides retention for logs/results.

**8.5 SQS Configuration**
- Queue assumption: `hexacode-${env}-judge-jobs`
- DLQ: `hexacode-${env}-judge-jobs-dlq`
- Redrive policy: `maxReceiveCount = 5`
- `message_retention_seconds = 345600` (4 days)
- `receive_wait_time_seconds = 20`
- Desired `visibility_timeout_seconds = 300`
- Important caveat: current worker overrides visibility timeout per `ReceiveMessage`; this must be aligned in code before production-scale judging.

**8.6 RDS Configuration**
- Engine: `postgres` version `16`
- DB name: `hexacode`
- Dev/staging suggestion: `db.t4g.medium`, `gp3`, `100 GiB`, single-AZ, backups `7 days`
- Production suggestion: `db.r6g.large`, `gp3`, `200 GiB`, Multi-AZ, backups `14 days`
- Enable Performance Insights and enhanced monitoring.
- Put RDS in a DB subnet group containing `private_data_subnet_a` and `private_data_subnet_b`.
- Use Secrets Manager for credentials and construct `DATABASE_URL` from that secret.
- Run `hexacode-backend/db/new-app-schema.sql` as the bootstrap schema job.

**8.7 Redis (ElastiCache)**
- Engine: Redis 7
- Topology: replication group, cluster mode disabled, 1 primary + 1 replica across 2 AZs
- Dev/staging suggestion: `cache.t4g.small`
- Production start point: `cache.t4g.small` or `cache.t4g.medium`; current workload is only cache-backed public problem reads
- Subnet group: `private_data_subnet_a`, `private_data_subnet_b`
- Security group: `sg_redis`
- Export one primary endpoint as `REDIS_URL`
- No persistence is required for correctness; Redis can be rebuilt from Postgres.

**8.8 ECS Configuration**
- Cluster: `hexacode-${env}` using ECS Fargate
- Runtime platform: use `LINUX/X86_64` for all services, especially the worker, because it compiles and executes native binaries inside the container
- `identity-service` task: `cpu=256`, `memory=512`, desired count `2`, autoscale `2-4` on `CPUUtilization > 60%`
- `problem-service` task: `cpu=512`, `memory=1024`, desired count `2`, autoscale `2-6` on `CPUUtilization > 60%` or `MemoryUtilization > 75%`
- `submission-service` task: `cpu=512`, `memory=1024`, desired count `2`, autoscale `2-6` on `CPUUtilization > 60%` or `MemoryUtilization > 75%`
- `worker` task: `cpu=2048`, `memory=4096`, desired count `1`, autoscale `1-20` on SQS backlog with target `<= 1 visible message per running task`
- Health checks: API services use `/healthz`; worker has no LB health check, only ECS task health and log/metric alarms
- Deployment settings: rolling deploy with ECS deployment circuit breaker enabled, `minimum_healthy_percent=100`, `maximum_percent=200`
- Environment/secrets injection:
  - Common: `DATABASE_URL`, `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, `COGNITO_ISSUER`, `COGNITO_JWKS_URL`, `S3_REGION`, `S3_BUCKET_PROBLEMS`, `S3_BUCKET_SUBMISSIONS`, `SQS_JUDGE_QUEUE_URL`
  - AWS-specific blanks: `S3_ENDPOINT=""`, `SQS_ENDPOINT=""`
  - Service URLs: set `PROBLEM_SERVICE_URL`, `SUBMISSION_SERVICE_URL`, `IDENTITY_SERVICE_URL` to the internal ALB base URL where needed
  - Worker-specific: `WORKER_NAME`, `WORKER_VERSION`, `WORKER_POLL_INTERVAL_SECONDS`
