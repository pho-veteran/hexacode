# Hexacode Terraform Infrastructure Design

**Date:** 2026-05-10
**Status:** Approved
**Author:** Claude

---

## 1. Overview

Provision production-ready AWS infrastructure for Hexacode using Terraform with module-per-component structure. The design covers full stack: VPC, database, cache, queues, storage, compute, networking, and CDN.

**Region:** `ap-southeast-1` (configurable via `var.region`)

---

## 2. Module Structure

```
terraform/
├── main.tf                    # root: calls all modules
├── variables.tf               # environment inputs
├── outputs.tf                # useful outputs
├── terraform.tfvars.example  # template
└── modules/
    ├── vpc/
    ├── security-groups/
    ├── s3-buckets/
    ├── sqs/
    ├── rds/
    ├── elasticache/
    ├── iam/
    ├── ecs-cluster/
    ├── ecs-services/
    ├── alb/
    ├── cognito/
    ├── api-gateway/
    ├── cors-lambda/
    └── cloudfront/
```

---

## 3. Module Specifications

### 3.1 VPC (`modules/vpc`)

**Resources:**
- VPC with configurable CIDR (default: `10.20.0.0/16`)
- Internet Gateway attached to VPC
- 6 subnets across 2 AZs:
  - `public_subnet_a/b` (`10.20.0.0/24`, `10.20.1.0/24`) — NAT gateways
  - `private_app_subnet_a/b` (`10.20.10.0/24`, `10.20.11.0/24`) — ECS services, ALB
  - `private_data_subnet_a/b` (`10.20.20.0/24`, `10.20.21.0/24`) — RDS, ElastiCache
- NAT Gateways in public subnets
- Route tables: public (0.0.0.0/0 -> IGW), private app/data (0.0.0.0/0 -> NAT)
- Gateway VPC Endpoint: S3
- Interface VPC Endpoints (in private_app_subnets):
  - `com.amazonaws.ap-southeast-1.ecr.api`
  - `com.amazonaws.ap-southeast-1.ecr.dkr`
  - `com.amazonaws.ap-southeast-1.logs`
  - `com.amazonaws.ap-southeast-1.secretsmanager`
  - `com.amazonaws.ap-southeast-1.sqs`
  - `com.amazonaws.ap-southeast-1.sts`
- DNS hostnames and DNS resolution enabled

**Variables:**
```hcl
variable "region" { default = "ap-southeast-1" }
variable "environment" { description = "dev/staging/prod" }
variable "vpc_cidr" { default = "10.20.0.0/16" }
variable "availability_zones" { default = ["a", "b"] }
```

---

### 3.2 Security Groups (`modules/security-groups`)

**Groups:**
| Name | Inbound | Outbound |
|------|--------|----------|
| `sg_apigw_vpclink` | none | `tcp/80` -> `sg_internal_alb` |
| `sg_internal_alb` | `tcp/80` from `sg_apigw_vpclink`, `sg_api_services`, `sg_worker` | `tcp/8000` -> `sg_api_services` |
| `sg_api_services` | `tcp/8000` from `sg_internal_alb` | `tcp/5432` -> `sg_rds`, `tcp/6379` -> `sg_redis`, `tcp/80` -> `sg_internal_alb`, `tcp/443` -> AWS APIs (Cognito JWKS, AWS SDKs) |
| `sg_worker` | none | `tcp/80` -> `sg_internal_alb`, `tcp/443` -> AWS APIs |
| `sg_rds` | `tcp/5432` from `sg_api_services` | default all within VPC |
| `sg_redis` | `tcp/6379` from `sg_api_services` | default all within VPC |

**Note:** Outbound `tcp/443` on `sg_api_services` and `sg_worker` allows AWS API calls via interface endpoints (ECR, SQS, Secrets Manager, STS, CloudWatch) and Cognito JWKS fetching when interface endpoints are unavailable.

---

### 3.3 S3 Buckets (`modules/s3-buckets`)

**Buckets:**
| Bucket | Purpose | Versioning | Encryption |
|--------|---------|------------|------------|
| `hexacode-{env}-frontend` | CloudFront origin | No | SSE-S3 |
| `hexacode-{env}-problem-assets` | Problems, testcases, checkers | Yes | SSE-S3 |
| `hexacode-{env}-submission-artifacts` | Future submission storage | Yes | SSE-S3 |

All buckets: Block Public Access ON, Object Ownership bucket-owner enforced.

**Lifecycle:** No expiry for problem/testcase content; optionally expire compiled checker artifacts after 90 days.

---

### 3.4 SQS (`modules/sqs`)

**Queue:** `hexacode-{env}-judge-jobs`
- `message_retention_seconds = 86400` (1 day)
- `receive_wait_time_seconds = 20`
- `visibility_timeout_seconds = 300`
- Redrive: `maxReceiveCount = 5` -> DLQ

**DLQ:** `hexacode-{env}-judge-jobs-dlq`
- Same retention (1 day)

---

### 3.5 RDS (`modules/rds`)

**Configuration:**
- Engine: PostgreSQL 16
- DB name: `hexacode`
- Engine version: `16` (latest minor)
- Instance class: configurable (`db.t4g.medium` dev, `db.r6g.large` prod)
- Storage: gp3, 100 GiB dev / 200 GiB prod
- Multi-AZ: yes (prod), no (dev)
- Subnet group: `private_data_subnet_a`, `private_data_subnet_b`
- Security group: `sg_rds`

**Secrets:** Master password stored in Secrets Manager; injected as `DATABASE_URL` to ECS.

**Backup:** 7 days retention (dev), 14 days (prod). Performance Insights enabled.

---

### 3.6 ElastiCache (`modules/elasticache`)

**Configuration:**
- Engine: Redis 7
- Cluster mode: disabled
- Node count: 1 primary + 1 replica across 2 AZs
- Instance class: `cache.t4g.small`
- Subnet group: `private_data_subnet_a`, `private_data_subnet_b`
- Security group: `sg_redis`

**Note:** Only `problem-service` uses Redis currently. Other services leave `REDIS_URL` empty.

---

### 3.7 IAM (`modules/iam`)

**ECS Execution Role** (`hexacode-{env}-ecs-execution`):
- Trust: `ecs-tasks.amazonaws.com`
- Attached: `AmazonECSTaskExecutionRolePolicy`
- Inline: `secretsmanager:GetSecretValue` on application secret ARN
- **Note:** If Secrets Manager secret uses CMK, add `kms:Decrypt` on the KMS key ARN

**ECS Task Roles** (one per service):

| Role | Permissions |
|------|-------------|
| `identity-task` | None (validates via Cognito JWKS) |
| `problem-task` | S3: `ListBucket`, `GetBucketLocation` on problem-assets bucket; `GetObject`, `PutObject`, `DeleteObject` on `problem/*`, `testset/*`, `problem/*/checker/*` prefixes; `CreateBucket` if bucket auto-create not disabled in code |
| `submission-task` | SQS: `GetQueueUrl`, `GetQueueAttributes`, `SendMessage`, `CreateQueue` on judge queue; S3: `ListBucket`, `GetBucketLocation`, `GetObject` on submission-artifacts bucket |
| `worker-task` | SQS: `GetQueueUrl`, `GetQueueAttributes`, `ReceiveMessage`, `DeleteMessage`, `ChangeMessageVisibility`, `CreateQueue` on judge queue; S3: `GetObject` on `problem/*`, `testset/*`; `PutObject` on `problem/*/checker/*/compiled/*` |

**Security Note:** Internal service endpoints (`/internal/*`) currently have no service-to-service authentication. Security relies on VPC isolation via security groups. This is acceptable for initial deployment but should be revisited as the platform scales. Consider mTLS, service meshes (App Mesh), or signed requests for future hardening.

---

### 3.8 ECS Cluster (`modules/ecs-cluster`)

**Configuration:**
- Cluster name: `hexacode-{env}`
- Capacity provider: Fargate
- Runtime platform: `LINUX/X86_64`

**CloudWatch Log Groups** (pre-created, 30-day retention):
- `/ecs/hexacode-{env}/identity-service`
- `/ecs/hexacode-{env}/problem-service`
- `/ecs/hexacode-{env}/submission-service`
- `/ecs/hexacode-{env}/worker`

---

### 3.9 ECS Services (`modules/ecs-services`)

**Task Definitions:**

| Service | CPU | Memory | Desired | Min | Max | Scaling |
|---------|-----|--------|---------|-----|-----|---------|
| identity-service | 256 | 512 | 2 | 2 | 4 | CPU > 60% |
| problem-service | 512 | 2048 | 2 | 2 | 8 | CPU > 60% OR Mem > 75% |
| submission-service | 512 | 1536 | 2 | 2 | 8 | CPU > 60% OR Mem > 75% |
| worker | 1024 | 2048 | 5 | 1 | 20 | SQS backlog ≤ 1 msg/task |

**Worker Sizing Rationale:** Worker at 1024/2048 handles single-message processing with g++ compilation. Starting lower allows horizontal scaling via container count. If custom checker workloads prove heavier, increase CPU/memory and reduce desired count. Current code supports horizontal scaling better than vertical.

**Container Settings:**
- Container port: `8000` (API services), no port (worker)
- Health check: `/healthz` on `/healthz` returning `200 OK`
- Assign public IP: Disabled
- Deployment: rolling with circuit breaker, min healthy 100%, max 200%

**Worker Concurrency:**
- `WORKER_CONCURRENCY` env var (default: 1)
- Current code processes 1 message at a time (`max_messages=1`)
- Future enhancement: configurable batch receive + parallel execution

**Secrets Injected:**
- `DATABASE_URL` -> from Secrets Manager
- `REDIS_URL` -> from Secrets Manager (problem-service only)

---

### 3.10 Internal ALB (`modules/alb`)

**Configuration:**
- Scheme: internal (private-only)
- Subnets: `private_app_subnet_a`, `private_app_subnet_b`
- Security group: `sg_internal_alb`
- Listener: HTTP `80`, default fixed 404 response

**Target Groups:**
| Target Group | Port | Health Check |
|--------------|------|--------------|
| `tg-identity` | 8000 | HTTP `/healthz` |
| `tg-problem` | 8000 | HTTP `/healthz` |
| `tg-submission` | 8000 | HTTP `/healthz` |

**Listener Rules** (priority order, source of truth: `hexacode-backend/contracts/route-manifest.json`):
1. `/api/auth*`, `/api/dashboard/users*` -> `tg-identity`
2. `/api/submissions*`, `/api/runtimes*`, `/api/dashboard/operations*`, `/internal/judge-jobs*`, `/internal/runtimes*` -> `tg-submission`
3. `/api/problems*`, `/api/tags*`, `/api/dashboard*`, `/internal/problems*`, `/internal/checkers*`, `/internal/cache/public-problems/invalidate` -> `tg-problem`
4. Default: 404

**Note:** Route manifest defines which paths are Lambda-backed (chat) vs ALB-backed. Only container-service paths above go to ALB. `/api/chat` is handled by direct Lambda integration, not the ALB.

---

### 3.11 Cognito (`modules/cognito`)

**User Pool:**
- Name: `hexacode-{env}`
- Sign-up: email-based
- Auto-confirm: enabled

**App Client:**
- Name: `hexacode-{env}-spa`
- No client secret
- PKCE: optional

**Outputs:**
- User Pool ID
- App Client ID
- Issuer URL
- JWKS URL

---

### 3.12 API Gateway (`modules/api-gateway`)

**Type:** HTTP API (not REST)

**Stage:** `$default` with auto-deploy

**VPC Link:**
- Type: interface
- Subnets: `private_app_subnet_a`, `private_app_subnet_b`
- Security group: `sg_apigw_vpclink`

**Routes:**
| Method | Path | Integration |
|--------|------|-------------|
| ANY | `/api/{proxy+}` | Internal ALB (VPC Link) |
| POST | `/api/chat/messages` | Chat Lambda (direct) |
| OPTIONS | `/api/{proxy+}` | CORS Lambda (204 response) |

**CORS:**
- Allowed origins: frontend domain (not `*`)
- Allowed headers: `authorization`, `content-type`, `x-correlation-id`
- Expose headers: `content-disposition`, `x-correlation-id`
- Max age: 300 seconds

**Note:** Chat Lambda must be deployed separately. Terraform references Lambda ARN via variable.

---

### 3.13 CORS Lambda (`modules/cors-lambda`)

**Purpose:** Handle browser preflight `OPTIONS` requests with 204 No Content and proper CORS headers.

**Function:**
```python
def handler(event, context):
    return {
        "statusCode": 204,
        "headers": {
            "Access-Control-Allow-Origin": "https://your-frontend-domain.com",
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "authorization, content-type, x-correlation-id",
            "Access-Control-Max-Age": "300",
        },
        "body": ""
    }
```

**Note:** Origin and headers should match API Gateway CORS configuration. The Lambda can be made more flexible by reading allowed origins from environment variables or API Gateway settings.

---

### 3.14 CloudFront (`modules/cloudfront`)

**Distribution:**
- Origin: `hexacode-{env}-frontend` S3 bucket
- Viewer protocol: redirect HTTP -> HTTPS
- Allowed methods: GET, HEAD, OPTIONS
- Auto compress: yes
- Default root object: `index.html`
- Cache policy: CachingOptimized

**Origin Access Control (OAC):**
- Type: S3
- Signing: sigv4

**S3 Bucket Policy:**
- Allow CloudFront OAC read-only access
- Block all public access

**Custom Error Responses:**
- 403 -> `/index.html` (200)
- 404 -> `/index.html` (200)

**SPA Handling:** Both 403 and 404 configured because private S3 + OAC surfaces missing routes as 403.

---

## 4. Root Module

### 4.1 Variables (`variables.tf`)

```hcl
variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-southeast-1"
}

variable "environment" {
  description = "Environment name (dev/staging/prod)"
  type        = string
}

variable "cidr_block" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.20.0.0/16"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.medium"
}

variable "db_multi_az" {
  description = "Enable Multi-AZ for RDS"
  type        = bool
  default     = false
}

variable "db_allocated_storage" {
  description = "RDS allocated storage in GiB"
  type        = number
  default     = 100
}

variable "chat_lambda_arn" {
  description = "ARN of deployed chat Lambda function"
  type        = string
}

variable "frontend_domain" {
  description = "Frontend domain for CORS (e.g., https://d2x2kyi0hl9xxu.cloudfront.net)"
  type        = string
}

variable "cors_lambda_arn" {
  description = "ARN of deployed CORS preflight Lambda function"
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key ARN for Secrets Manager (if using CMK)"
  type        = string
  default     = ""
}

variable "frontend_bucket_name" {
  description = "Frontend S3 bucket name (for CORS Lambda origin)"
  type        = string
}
```

### 4.2 Outputs (`outputs.tf`)

```hcl
output "api_gateway_url" {
  value = module.api-gateway.http_api_endpoint
}

output "cloudfront_domain" {
  value = module.cloudfront.distribution_domain_name
}

output "cognito_user_pool_id" {
  value = module.cognito.user_pool_id
}

output "cognito_app_client_id" {
  value = module.cognito.app_client_id
}

output "cognito_issuer" {
  value = module.cognito.issuer
}

output "cognito_jwks_url" {
  value = module.cognito.jwks_url
}

output "ecs_cluster_name" {
  value = module.ecs-cluster.cluster_name
}

output "internal_alb_dns_name" {
  value = module.alb.internal_alb_dns_name
}

output "problem_bucket_name" {
  value = module.s3-buckets.problem_bucket_name
}

output "submission_bucket_name" {
  value = module.s3-buckets.submission_bucket_name
}

output "judge_queue_url" {
  value = module.sqs.judge_queue_url
}
```

---

## 5. Deployment Notes

### 5.1 Order of Operations

1. Apply VPC, security groups, endpoints
2. Apply S3 buckets, SQS queues
3. Apply RDS, ElastiCache (stateful, slower)
4. Apply Cognito
5. Apply IAM roles
6. Apply ECS cluster
7. Apply ALB
8. Apply ECS services (wait for ALB)
9. Apply API Gateway
10. Apply CloudFront

### 5.2 Pre-requisites (Not in Terraform)

- ECR repository `prod/hexacode` with pushed images
- Secrets Manager secret with `DATABASE_URL` and `REDIS_URL`
- Chat Lambda deployed (Terraform references ARN)
- CORS Lambda deployed (Terraform references ARN)
- Frontend built and uploaded to S3

### 5.3 Database Bootstrap

After Terraform applies:
```bash
# Run schema bootstrap
psql -f hexacode-backend/db/new-app-schema.sql

# Import problem catalog
docker compose exec problem-service python scripts/import_problem_catalog.py
```

---

## 6. Future Enhancements

### 6.1 Worker Parallel Execution

Current worker processes 1 message at a time. Enhancement:

```python
# In worker main.py
WORKER_CONCURRENCY = int(os.getenv("WORKER_CONCURRENCY", "1"))

messages = queue.receive_messages(
    max_messages=WORKER_CONCURRENCY,  # configurable
    wait_seconds=min(interval_seconds, 10),
    visibility_timeout=max(interval_seconds * 2 * WORKER_CONCURRENCY, 30),
)

with ThreadPoolExecutor(max_workers=WORKER_CONCURRENCY) as executor:
    futures = [
        executor.submit(process_message, msg)
        for msg in messages
    ]
    for future in as_completed(futures):
        future.result()
```

Terraform would set `WORKER_CONCURRENCY` env var in task definition.

---

## 7. Cost Considerations

| Resource | Dev Cost Estimate | Prod Cost Estimate |
|----------|-------------------|-------------------|
| NAT Gateway | ~$30/mo | ~$30/mo |
| Interface Endpoints | ~$15/mo (6 endpoints) | ~$15/mo |
| RDS t4g.medium | ~$50/mo | - |
| RDS r6g.large Multi-AZ | - | ~$150/mo |
| ElastiCache t4g.small | ~$20/mo | ~$20/mo |
| ALB | ~$16/mo | ~$16/mo |
| API Gateway | ~$5/mo (HTTP API) | ~$5/mo |
| CloudFront | ~$20/mo | ~$20/mo |
| ECS Fargate (4 services) | ~$30/mo | ~$50/mo |
| **Total** | **~$186/mo** | **~$306/mo** |

*Plus S3, SQS, CloudWatch at negligible cost for typical usage.*

---

## 8. Decisions Summary

- [x] Region: configurable (default ap-southeast-1)
- [x] SQS retention: 1 day (not 4 days)
- [x] Interface endpoints: all 6 included (ECR, DKR, CloudWatch, Secrets, SQS, STS)
- [x] Worker scaling: SQS backlog, 1-20 workers
- [x] Worker concurrency: scale via containers (current), parallel execution as future enhancement
- [x] Worker sizing: 1024/2048 (reduced from 2048/4096, horizontal scale preferred)
- [x] Redis instance: cache.t4g.small for all envs
- [x] RDS: db.t4g.medium dev, db.r6g.large prod
- [x] Problem service memory: 2048 (for S3 I/O and upload buffering)
- [x] IAM: added SQS CreateQueue, GetQueueAttributes; S3 prefix-scoped permissions
- [x] IAM: added kms:Decrypt note for CMK-backed secrets
- [x] Security groups: outbound tcp/443 for AWS API calls
- [x] Internal endpoints: no service-to-service auth (VPC isolation only), documented as security consideration
- [x] ALB rules: trace back to route-manifest.json, merged redundant cache invalidation rule
