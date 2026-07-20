# Hexacode

Cloud-native online coding judge platform. Containerized microservices on AWS Fargate with RDS PostgreSQL, ElastiCache Redis, SQS, S3, API Gateway, CloudFront, Cognito, Bedrock, and full Terraform IaC.

## Architecture

```
CloudFront ──┬── S3 (SPA)
             │
         API Gateway ──┬── VPC Link ── ALB ──┬── identity-service (Fargate)
                       │                      ├── problem-service (Fargate)
                       │                      └── submission-service (Fargate)
                       │
                       └── /api/chat ── Lambda ── Bedrock Agent + Knowledge Base

SQS ◀── submission-service ──▶ worker (Fargate)
               │                       │
               └──── RDS Proxy ── RDS PostgreSQL ────┐
               └──── ElastiCache Redis               │
               └──── S3 (problem assets)             │
               └──── EFS (shared NFS)                │
                     worker ──── S3 (submissions) ────┘
```

Six containerized services run on ECS Fargate across private subnets. Three API services (identity, problem, submission) sit behind an internal ALB and are exposed via API Gateway HTTP API + VPC Link. The judge worker polls SQS independently with no public endpoint. Every service maps to an AWS-native equivalent during local development.

## AWS Services

| Category | Service | Use |
|---|---|---|
| Compute | ECS Fargate, Lambda | Microservices, chat handler, CORS preflight |
| Storage | S3 (3 buckets), EFS | SPA hosting, problem assets, submission artifacts, shared NFS |
| Database | RDS PostgreSQL 16, RDS Proxy, ElastiCache Redis 7 | Relational store, connection pooling, cache |
| Networking | VPC (private/public/data/firewall), ALB, API Gateway HTTP API, VPC Link, NAT Gateway, Network Firewall, Client VPN, VPC Peering | Isolated multi-tier network, ingress routing, egress inspection |
| Auth | Cognito User Pool | JWT issuance and validation |
| AI | Bedrock Agent + Knowledge Base, OpenSearch Serverless | Problem-assistant chat |
| Queue | SQS + DLQ | Async judge job delivery |
| CDN | CloudFront with S3 OAC | Global SPA distribution |
| Security | WAF (CloudFront + regional), Security Groups, IAM least-privilege per task role, Secrets Manager, KMS | Perimeter defense, service isolation, credential management |
| Observability | CloudWatch Logs, VPC Flow Logs, AWS Backup, Cost Anomaly Detection | Monitoring, auditing, backup, cost governance |

## Infrastructure as Code

Full AWS infrastructure defined in **Terraform** (23 modules, 150+ files). Provisioned via `terraform apply` with:
- Separate dev/prod workspaces with isolated state backends and VPC CIDRs
- Rolling ECS deployments with circuit breaker (min 100%, max 200%)
- Least-privilege IAM per service (identity role has zero AWS API permissions)
- Automated Secrets Manager rotation for `DATABASE_URL` and `REDIS_URL`
- RDS Proxy for connection pooling with automatic failover
- Network Firewall egress inspection on all private routes
- Dev environment scales to zero outside business hours

### Terraform modules

`vpc`, `security-groups`, `s3-buckets`, `sqs`, `ecr`, `rds`, `rds-proxy`, `elasticache`, `efs`, `iam`, `ecs-cluster`, `ecs-services`, `alb`, `api-gateway`, `cognito`, `cors-lambda`, `bedrock-chat`, `waf`, `network-firewall`, `cloudfront`, `management-vpc`, `client-vpn`, `backup`, `cost-controls`

### Deployment workflow

```sh
# 1. Provision or update infrastructure
terraform init -backend-config=backend-prod.hcl
terraform apply -var-file=terraform.tfvars

# 2. Build and push container images
./scripts/push-ecr.ps1 -Environment prod -Services all

# 3. Update image tag in tfvars, apply again → rolling ECS update

# 4. Deploy frontend to S3 + invalidate CloudFront
aws s3 sync hexacode-frontend/dist/ s3://hexacode-prod-frontend/
aws cloudfront create-invalidation --distribution-id <id> --paths "/*"
```

## Repository Layout

```
terraform/                  # Full AWS IaC (23 modules)
docs/
  aws.md                    # Architecture reference
  aws-production-operator-guide.md  # Production runbook
  ecr.md                    # ECR push guide
hexacode-frontend/          # React SPA (Vite + React)
hexacode-backend/
  services/
    api-gateway/            # Public API entrypoint (FastAPI)
    identity-service/       # User + role management
    problem-service/        # Problem catalog + authoring
    submission-service/     # Submission intake + judge dispatch
    worker/                 # Queue consumer, compiles/executes code
    chat-lambda/            # Bedrock Agent Runtime handler
  db/new-app-schema.sql     # Authoritative PostgreSQL schema
  scripts/                  # Catalog import, ECR push utilities
data/problems/              # Curated problem catalog (seed data)
```

## Local Development

Docker Compose provides local equivalents of every AWS service:

| AWS | Local | Port |
|---|---|---|
| S3 | MinIO | 19000 (API), 19001 (console) |
| SQS | ElasticMQ | 19324 |
| RDS PostgreSQL | PostgreSQL 16 Alpine | 15432 |
| ElastiCache Redis | Redis 7 Alpine | 16379 |

Adapter pattern: services switch between local and cloud via environment variables (`S3_ENDPOINT`, `SQS_ENDPOINT`). In AWS these are unset so boto3 uses native endpoints; locally they point to MinIO and ElasticMQ.

```powershell
docker compose -f docker-compose.local.yml up -d --build
```

| Endpoint | URL |
|---|---|
| Frontend | http://127.0.0.1:3000 |
| Gateway | http://127.0.0.1:8080 |
| Gateway API docs | http://127.0.0.1:8080/docs |

## Schema Design

Four PostgreSQL schemas with clear ownership boundaries:

- `app_identity` — users (Cognito-backed), roles, permissions, audit log
- `problem` — problems, tags, testsets, testcases, checkers
- `submission` — runtimes, submissions, judge jobs, results
- `storage` — object metadata shared across services

All tables enforce `created_at` / `updated_at` timestamps via trigger. Status columns use `CHECK` constraints. Foreign keys reference by UUID. Schema bootstrap is idempotent (`IF NOT EXISTS` throughout).

## Auth Model

- **Cognito** handles browser sign-in and JWT issuance
- Backend services validate Cognito JWTs via JWKS (verify issuer, audience, client ID)
- Local authorization is role-based in PostgreSQL (`app_identity.user_role_assignments`)
- Roles are independent of Cognito groups — managed entirely in the application database
- API Gateway enforces Cognito JWT authorizer on chat routes; internal services validate tokens independently

## Security

- All ECS tasks in private subnets — no public IPs, no direct internet access
- API Gateway → VPC Link → internal ALB: no public-facing load balancer
- Per-service IAM task roles with resource-scoped S3, SQS, and KMS policies
- WAF on both CloudFront (frontend) and regional (ALB) with rate limiting and OWASP rules
- Network Firewall for egress traffic inspection on all private subnets
- VPC Flow Logs shipped to CloudWatch; Secrets Manager for runtime credentials
- Worker sandbox (untrusted code execution) is the highest-risk surface — runs as unprivileged subprocess with resource limits

## Observability & Operations

- CloudWatch Log Groups per ECS service, Lambda function, and VPC Flow Logs
- RDS Performance Insights for query profiling
- AWS Backup daily plan covering RDS, EFS, and S3 problem bucket
- Cost Anomaly Detection + budget alerts via SNS
- Scheduled ECS cost guard (dev only): shuts down services when budget threshold is breached

## Fresh Database Setup

```powershell
docker compose -f docker-compose.local.yml down
docker volume rm hexacode-backend_postgres-data hexacode-backend_minio-data
docker compose -f docker-compose.local.yml up -d --build
docker compose -f docker-compose.local.yml exec -T problem-service python scripts/import_problem_catalog.py --catalog-dir /workspace/data/problems --skip-env-file --reset-existing
```
