# Hexacode Terraform Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision the approved AWS Terraform stack for Hexacode: network, storage, data, compute, identity, API gateway, and CloudFront.

**Architecture:** Build the stack in dependency order so each layer can be validated before the next one lands. The root module stays thin and only wires module outputs to downstream inputs; each module owns its resources and exports only the values the next layer needs.

**Tech Stack:** Terraform, AWS provider, VPC, EC2/NAT/VPC endpoints, S3, SQS, RDS PostgreSQL 16, ElastiCache Redis 7, IAM, ECS Fargate, ALB, Cognito, API Gateway HTTP API, Lambda, CloudFront.

---

## File Structure

Create the Terraform tree from scratch and keep each module focused on one responsibility.

```text
terraform/
├── versions.tf
├── main.tf
├── variables.tf
├── outputs.tf
├── terraform.tfvars.example
└── modules/
    ├── vpc/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── security-groups/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── s3-buckets/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── sqs/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── rds/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── elasticache/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── iam/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── ecs-cluster/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── alb/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── ecs-services/
    │   ├── main.tf
    │   ├── autoscaling.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── cognito/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── cors-lambda/
    │   ├── main.tf
    │   ├── index.py
    │   ├── variables.tf
    │   └── outputs.tf
    ├── api-gateway/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    └── cloudfront/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

---

## Batch 1 — Foundation

### Task 1: Root Terraform Scaffold

**Files:**
- Create: `terraform/versions.tf`
- Create: `terraform/main.tf`
- Create: `terraform/variables.tf`
- Create: `terraform/terraform.tfvars.example`

**Goal:** Create a valid root Terraform configuration with provider pinning, shared variables, and an example variables file.

- [ ] **Step 1: Create the Terraform version and provider pinning**

```hcl
terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
```

- [ ] **Step 2: Create the root provider configuration**

```hcl
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "hexacode"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
```

- [ ] **Step 3: Declare the root input surface used by later tasks**

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

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zones" {
  description = "AZ suffixes to use"
  type        = list(string)
  default     = ["a", "b"]
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

variable "application_secret_arn" {
  description = "Secrets Manager ARN that stores DATABASE_URL and REDIS_URL"
  type        = string
  default     = ""
}

variable "ecr_repository_url" {
  description = "ECR repository URL for Hexacode images"
  type        = string
  default     = ""
}

variable "image_tag" {
  description = "Image tag to deploy"
  type        = string
  default     = ""
}

variable "chat_lambda_arn" {
  description = "ARN of the deployed chat Lambda function"
  type        = string
  default     = ""
}

variable "frontend_domain" {
  description = "Frontend origin used for Cognito callbacks and CORS"
  type        = string
  default     = ""
}

variable "cors_lambda_arn" {
  description = "ARN of the deployed CORS Lambda function"
  type        = string
  default     = ""
}

variable "kms_key_arn" {
  description = "KMS key ARN for Secrets Manager if CMK-backed"
  type        = string
  default     = ""
}
```

- [ ] **Step 4: Create the example tfvars file**

```hcl
region                 = "ap-southeast-1"
environment            = "prod"
vpc_cidr               = "10.20.0.0/16"
availability_zones     = ["a", "b"]
db_instance_class      = "db.r6g.large"
db_multi_az            = true
db_allocated_storage   = 200
application_secret_arn = "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:hexacode-prod-app"
ecr_repository_url     = "123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/prod/hexacode"
image_tag              = "git-sha-or-release-tag"
chat_lambda_arn        = "arn:aws:lambda:ap-southeast-1:123456789012:function:hexacode-prod-chat"
frontend_domain        = "https://d2x2kyi0hl9xxu.cloudfront.net"
cors_lambda_arn        = "arn:aws:lambda:ap-southeast-1:123456789012:function:hexacode-prod-cors"
```

- [ ] **Step 5: Verify the root configuration is syntactically valid**

Run:
```powershell
terraform -chdir=terraform init -backend=false
terraform -chdir=terraform fmt -check -recursive
terraform -chdir=terraform validate
terraform -chdir=terraform plan
```
Expected: init succeeds, fmt is clean, validate passes, and the plan reports 0 resources because no modules are wired yet.

- [ ] **Step 6: Create a minimal root outputs file that stays valid before modules exist**

```hcl
output "region" {
  value = var.region
}

output "environment" {
  value = var.environment
}
```

Later tasks append the module-backed outputs once their modules exist.

Expected: the root module still validates after adding `outputs.tf`, and no module references are required in Task 1.

---

### Task 2: VPC Module

**Files:**
- Create: `terraform/modules/vpc/main.tf`
- Create: `terraform/modules/vpc/variables.tf`
- Create: `terraform/modules/vpc/outputs.tf`
- Modify: `terraform/main.tf`
- Modify: `terraform/outputs.tf`

**Goal:** Build the VPC, subnets, NAT gateways, route tables, S3 gateway endpoint, interface endpoints, and the small endpoint security group required by those interface endpoints.

- [ ] **Step 1: Create the module inputs and locals**

```hcl
variable "environment" {
  type = string
}

variable "region" {
  type    = string
  default = "ap-southeast-1"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "availability_zones" {
  type    = list(string)
  default = ["a", "b"]
}

locals {
  azs = [for suffix in var.availability_zones : "${var.region}${suffix}"]

  public_cidrs       = ["10.20.0.0/24", "10.20.1.0/24"]
  private_app_cidrs  = ["10.20.10.0/24", "10.20.11.0/24"]
  private_data_cidrs = ["10.20.20.0/24", "10.20.21.0/24"]

  interface_endpoints = {
    ecr_api        = "com.amazonaws.${var.region}.ecr.api"
    ecr_dkr        = "com.amazonaws.${var.region}.ecr.dkr"
    logs           = "com.amazonaws.${var.region}.logs"
    secretsmanager = "com.amazonaws.${var.region}.secretsmanager"
    sqs            = "com.amazonaws.${var.region}.sqs"
    sts            = "com.amazonaws.${var.region}.sts"
  }
}
```

- [ ] **Step 2: Create the VPC, IGW, subnets, NAT gateways, and route tables**

Implement:
- one VPC with DNS hostnames and DNS support enabled
- one Internet Gateway
- 2 public subnets
- 2 private app subnets
- 2 private data subnets
- 2 NAT gateways, one per AZ
- public route table to the IGW
- private app/data route tables to the NAT gateway in the same AZ

- [ ] **Step 3: Create the gateway endpoint and interface endpoints**

Implement the S3 gateway endpoint on the private route tables and one interface endpoint each for ECR API, ECR DKR, CloudWatch Logs, Secrets Manager, SQS, and STS in the private app subnets.

Because interface endpoints require a security group, create a module-local `aws_security_group` for the endpoint ENIs that allows inbound 443 from the VPC CIDR and egress within the VPC.

- [ ] **Step 4: Export the downstream values**

```hcl
output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_app_subnet_ids" {
  value = aws_subnet.private_app[*].id
}

output "private_data_subnet_ids" {
  value = aws_subnet.private_data[*].id
}

output "vpc_endpoint_security_group_id" {
  value = aws_security_group.vpc_endpoints.id
}
```

- [ ] **Step 5: Wire the module into the root configuration and create the first root outputs**

```hcl
module "vpc" {
  source             = "./modules/vpc"
  environment        = var.environment
  region             = var.region
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
}
```

```hcl
output "vpc_id" {
  value = module.vpc.vpc_id
}

output "private_app_subnet_ids" {
  value = module.vpc.private_app_subnet_ids
}

output "private_data_subnet_ids" {
  value = module.vpc.private_data_subnet_ids
}

output "public_subnet_ids" {
  value = module.vpc.public_subnet_ids
}
```

- [ ] **Step 6: Verify the module in isolation and through the root plan**

Run:
```powershell
terraform -chdir=terraform/modules/vpc init -backend=false
terraform -chdir=terraform/modules/vpc fmt -check -recursive
terraform -chdir=terraform/modules/vpc validate
terraform -chdir=terraform fmt -check -recursive
terraform -chdir=terraform plan -target=module.vpc
```
Expected: the VPC module validates, and the targeted plan shows the VPC, 6 subnets, 2 NAT gateways, 1 S3 gateway endpoint, and 6 interface endpoints.

---

### Task 3: Security Groups Module

**Files:**
- Create: `terraform/modules/security-groups/main.tf`
- Create: `terraform/modules/security-groups/variables.tf`
- Create: `terraform/modules/security-groups/outputs.tf`
- Modify: `terraform/main.tf`
- Modify: `terraform/outputs.tf`

**Goal:** Build the six security groups and exact ingress/egress rules in the approved design.

- [ ] **Step 1: Create the module inputs**

```hcl
variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}
```

- [ ] **Step 2: Implement the six groups and their rules exactly as specified**

Create these groups:
- `sg_apigw_vpclink`
- `sg_internal_alb`
- `sg_api_services`
- `sg_worker`
- `sg_rds`
- `sg_redis`

Use the exact rule matrix from the design:
- `sg_apigw_vpclink`: egress 80 to `sg_internal_alb`
- `sg_internal_alb`: ingress 80 from `sg_apigw_vpclink`, `sg_api_services`, and `sg_worker`; egress 8000 to `sg_api_services`
- `sg_api_services`: ingress 8000 from `sg_internal_alb`; egress 5432 to `sg_rds`, 6379 to `sg_redis`, 80 to `sg_internal_alb`, and 443 to `0.0.0.0/0`
- `sg_worker`: egress 80 to `sg_internal_alb` and 443 to `0.0.0.0/0`
- `sg_rds`: ingress 5432 from `sg_api_services`; egress restricted to the VPC CIDR
- `sg_redis`: ingress 6379 from `sg_api_services`; egress restricted to the VPC CIDR

- [ ] **Step 3: Export the security group IDs**

```hcl
output "sg_apigw_vpclink_id" { value = aws_security_group.apigw_vpclink.id }
output "sg_internal_alb_id"   { value = aws_security_group.internal_alb.id }
output "sg_api_services_id"   { value = aws_security_group.api_services.id }
output "sg_worker_id"         { value = aws_security_group.worker.id }
output "sg_rds_id"            { value = aws_security_group.rds.id }
output "sg_redis_id"         { value = aws_security_group.redis.id }
```

- [ ] **Step 4: Wire the module into the root configuration and extend root outputs**

```hcl
module "security_groups" {
  source      = "./modules/security-groups"
  environment = var.environment
  vpc_id      = module.vpc.vpc_id
  vpc_cidr    = var.vpc_cidr
}
```

```hcl
output "sg_apigw_vpclink_id" { value = module.security_groups.sg_apigw_vpclink_id }
output "sg_internal_alb_id"   { value = module.security_groups.sg_internal_alb_id }
output "sg_api_services_id"   { value = module.security_groups.sg_api_services_id }
output "sg_worker_id"         { value = module.security_groups.sg_worker_id }
output "sg_rds_id"            { value = module.security_groups.sg_rds_id }
output "sg_redis_id"          { value = module.security_groups.sg_redis_id }
```

- [ ] **Step 5: Verify the module in isolation and through the root plan**

Run:
```powershell
terraform -chdir=terraform/modules/security-groups init -backend=false
terraform -chdir=terraform/modules/security-groups fmt -check -recursive
terraform -chdir=terraform/modules/security-groups validate
terraform -chdir=terraform plan -target=module.security_groups
```
Expected: the module validates and the plan shows exactly six security groups with the rule counts from the spec.

---

## Batch 2 — State and Storage

### Task 4: S3 Buckets Module

**Files:**
- Create: `terraform/modules/s3-buckets/main.tf`
- Create: `terraform/modules/s3-buckets/variables.tf`
- Create: `terraform/modules/s3-buckets/outputs.tf`
- Modify: `terraform/main.tf`
- Modify: `terraform/outputs.tf`

**Goal:** Create the three buckets the stack needs and export both names and ARNs for downstream modules.

- [ ] **Step 1: Define the module inputs and bucket map**

```hcl
variable "environment" {
  type = string
}

locals {
  buckets = {
    frontend = {
      name       = "hexacode-${var.environment}-frontend"
      versioning = false
    }
    problem_assets = {
      name       = "hexacode-${var.environment}-problem-assets"
      versioning = true
    }
    submission_artifacts = {
      name       = "hexacode-${var.environment}-submission-artifacts"
      versioning = true
    }
  }
}
```

- [ ] **Step 2: Create the buckets with the required controls**

Implement:
- Block Public Access on all buckets
- Bucket-owner-enforced object ownership on all buckets
- SSE-S3 on all buckets
- versioning enabled on `problem-assets` and `submission-artifacts`
- a lifecycle rule for compiled checker artifacts after 90 days, scoped to the compiled checker prefix only

- [ ] **Step 3: Export bucket names and ARNs**

```hcl
output "frontend_bucket_name" { value = aws_s3_bucket.frontend.bucket }
output "frontend_bucket_arn"  { value = aws_s3_bucket.frontend.arn }
output "problem_bucket_name"  { value = aws_s3_bucket.problem_assets.bucket }
output "problem_bucket_arn"   { value = aws_s3_bucket.problem_assets.arn }
output "submission_bucket_name" { value = aws_s3_bucket.submission_artifacts.bucket }
output "submission_bucket_arn"  { value = aws_s3_bucket.submission_artifacts.arn }
```

- [ ] **Step 4: Wire the module into the root configuration and extend root outputs**

```hcl
module "s3_buckets" {
  source      = "./modules/s3-buckets"
  environment = var.environment
}
```

```hcl
output "frontend_bucket_name"  { value = module.s3_buckets.frontend_bucket_name }
output "frontend_bucket_arn"   { value = module.s3_buckets.frontend_bucket_arn }
output "problem_bucket_name"   { value = module.s3_buckets.problem_bucket_name }
output "problem_bucket_arn"    { value = module.s3_buckets.problem_bucket_arn }
output "submission_bucket_name" { value = module.s3_buckets.submission_bucket_name }
output "submission_bucket_arn"  { value = module.s3_buckets.submission_bucket_arn }
```

- [ ] **Step 5: Verify the module in isolation and through the root plan**

Run:
```powershell
terraform -chdir=terraform/modules/s3-buckets init -backend=false
terraform -chdir=terraform/modules/s3-buckets fmt -check -recursive
terraform -chdir=terraform/modules/s3-buckets validate
terraform -chdir=terraform plan -target=module.s3_buckets
```
Expected: the module validates and the plan shows exactly three buckets with the expected versioning and access settings.

---

### Task 5: SQS Module

**Files:**
- Create: `terraform/modules/sqs/main.tf`
- Create: `terraform/modules/sqs/variables.tf`
- Create: `terraform/modules/sqs/outputs.tf`
- Modify: `terraform/main.tf`
- Modify: `terraform/outputs.tf`

**Goal:** Create the judge queue and DLQ that the worker and submission service use.

- [ ] **Step 1: Define the module inputs**

```hcl
variable "environment" {
  type = string
}
```

- [ ] **Step 2: Create the queue and its dead-letter queue**

Implement:
- `hexacode-${var.environment}-judge-jobs`
- `hexacode-${var.environment}-judge-jobs-dlq`
- 1 day retention on both
- 20 second long polling on the main queue
- 5 minute visibility timeout on the main queue
- redrive policy from the main queue to the DLQ with `maxReceiveCount = 5`

- [ ] **Step 3: Export queue URLs and ARNs**

```hcl
output "judge_queue_url" { value = aws_sqs_queue.judge_jobs.url }
output "judge_queue_arn" { value = aws_sqs_queue.judge_jobs.arn }
output "judge_dlq_url"   { value = aws_sqs_queue.judge_jobs_dlq.url }
output "judge_dlq_arn"   { value = aws_sqs_queue.judge_jobs_dlq.arn }
```

- [ ] **Step 4: Wire the module into the root configuration and extend root outputs**

```hcl
module "sqs" {
  source      = "./modules/sqs"
  environment = var.environment
}
```

```hcl
output "judge_queue_url" { value = module.sqs.judge_queue_url }
output "judge_queue_arn" { value = module.sqs.judge_queue_arn }
output "judge_dlq_url"   { value = module.sqs.judge_dlq_url }
output "judge_dlq_arn"   { value = module.sqs.judge_dlq_arn }
```

- [ ] **Step 5: Verify the module in isolation and through the root plan**

Run:
```powershell
terraform -chdir=terraform/modules/sqs init -backend=false
terraform -chdir=terraform/modules/sqs fmt -check -recursive
terraform -chdir=terraform/modules/sqs validate
terraform -chdir=terraform plan -target=module.sqs
```
Expected: the module validates and the plan shows one queue plus one DLQ with the exact retention and redrive settings from the spec.

---

### Task 6: RDS and ElastiCache Modules

**Files:**
- Create: `terraform/modules/rds/main.tf`
- Create: `terraform/modules/rds/variables.tf`
- Create: `terraform/modules/rds/outputs.tf`
- Create: `terraform/modules/elasticache/main.tf`
- Create: `terraform/modules/elasticache/variables.tf`
- Create: `terraform/modules/elasticache/outputs.tf`
- Modify: `terraform/main.tf`
- Modify: `terraform/outputs.tf`

**Goal:** Provision the stateful data layer that sits in the private data subnets.

- [ ] **Step 1: Define the RDS module inputs and resource shape**

```hcl
variable "environment" {
  type = string
}

variable "db_instance_class" {
  type = string
}

variable "db_allocated_storage" {
  type = number
}

variable "db_multi_az" {
  type = bool
}

variable "private_data_subnet_ids" {
  type = list(string)
}

variable "rds_security_group_id" {
  type = string
}
```

Implement:
- a subnet group spanning `private_data_subnet_a` and `private_data_subnet_b`
- PostgreSQL 16
- `db_name = "hexacode"`
- `storage_type = "gp3"`
- `performance_insights_enabled = true`
- `multi_az = var.db_multi_az`
- 7 day backup retention in non-prod, 14 days in prod
- `manage_master_user_password = true` so the DB password stays in Secrets Manager

- [ ] **Step 2: Export the RDS endpoint and secret ARN**

```hcl
output "db_endpoint" { value = aws_db_instance.main.endpoint }
output "db_address"  { value = aws_db_instance.main.address }
output "db_master_user_secret_arn" { value = aws_db_instance.main.master_user_secret[0].secret_arn }
```

- [ ] **Step 3: Define the ElastiCache module inputs and resource shape**

```hcl
variable "environment" {
  type = string
}

variable "private_data_subnet_ids" {
  type = list(string)
}

variable "redis_security_group_id" {
  type = string
}
```

Implement:
- Redis 7
- cluster mode disabled
- one primary and one replica across the two private data subnets
- `cache.t4g.small`
- automatic failover and multi-AZ enabled
- no transit encryption change from the spec unless the service code is updated at the same time

- [ ] **Step 4: Export the Redis endpoint and port**

```hcl
output "redis_primary_endpoint" { value = aws_elasticache_replication_group.main.primary_endpoint_address }
output "redis_reader_endpoint"  { value = aws_elasticache_replication_group.main.reader_endpoint_address }
output "redis_port"             { value = aws_elasticache_replication_group.main.port }
```

- [ ] **Step 5: Wire both modules into the root configuration and extend root outputs**

```hcl
module "rds" {
  source                 = "./modules/rds"
  environment            = var.environment
  db_instance_class      = var.db_instance_class
  db_allocated_storage   = var.db_allocated_storage
  db_multi_az            = var.db_multi_az
  private_data_subnet_ids = module.vpc.private_data_subnet_ids
  rds_security_group_id  = module.security_groups.sg_rds_id
}

module "elasticache" {
  source                  = "./modules/elasticache"
  environment             = var.environment
  private_data_subnet_ids = module.vpc.private_data_subnet_ids
  redis_security_group_id = module.security_groups.sg_redis_id
}
```

```hcl
output "db_endpoint"               { value = module.rds.db_endpoint }
output "db_master_user_secret_arn" { value = module.rds.db_master_user_secret_arn }
output "redis_primary_endpoint"    { value = module.elasticache.redis_primary_endpoint }
output "redis_reader_endpoint"     { value = module.elasticache.redis_reader_endpoint }
output "redis_port"                { value = module.elasticache.redis_port }
```

- [ ] **Step 6: Verify both modules in isolation and through the root plan**

Run:
```powershell
terraform -chdir=terraform/modules/rds init -backend=false
terraform -chdir=terraform/modules/rds fmt -check -recursive
terraform -chdir=terraform/modules/rds validate
terraform -chdir=terraform/modules/elasticache init -backend=false
terraform -chdir=terraform/modules/elasticache fmt -check -recursive
terraform -chdir=terraform/modules/elasticache validate
terraform -chdir=terraform plan -target=module.rds -target=module.elasticache
```
Expected: both modules validate, and the plan shows the database subnet group, PostgreSQL instance, Redis replication group, and the expected private-data subnet placement.

---

## Batch 3 — Runtime and Edge

### Task 7: IAM and ECS Cluster Modules

**Files:**
- Create: `terraform/modules/iam/main.tf`
- Create: `terraform/modules/iam/variables.tf`
- Create: `terraform/modules/iam/outputs.tf`
- Create: `terraform/modules/ecs-cluster/main.tf`
- Create: `terraform/modules/ecs-cluster/variables.tf`
- Create: `terraform/modules/ecs-cluster/outputs.tf`
- Modify: `terraform/main.tf`
- Modify: `terraform/outputs.tf`

**Goal:** Create the shared ECS execution role, the four ECS task roles, the ECS cluster, and the pre-created CloudWatch log groups.

- [ ] **Step 1: Define the IAM module inputs**

```hcl
variable "environment" {
  type = string
}

variable "application_secret_arn" {
  type = string
}

variable "problem_bucket_arn" {
  type = string
}

variable "submission_bucket_arn" {
  type = string
}

variable "judge_queue_arn" {
  type = string
}

variable "kms_key_arn" {
  type    = string
  default = ""
}
```

- [ ] **Step 2: Create the ECS execution role and the per-service task roles**

Implement:
- `hexacode-${var.environment}-ecs-execution`
- `hexacode-${var.environment}-identity-task`
- `hexacode-${var.environment}-problem-task`
- `hexacode-${var.environment}-submission-task`
- `hexacode-${var.environment}-worker-task`

Attach:
- `AmazonECSTaskExecutionRolePolicy` to the execution role
- `secretsmanager:GetSecretValue` on the application secret ARN
- S3 prefix-scoped permissions for `problem-task`, `submission-task`, and `worker-task`
- SQS permissions for `submission-task` and `worker-task`
- optional `kms:Decrypt` when `kms_key_arn` is set

- [ ] **Step 3: Export the role ARNs**

```hcl
output "ecs_execution_role_arn" { value = aws_iam_role.ecs_execution.arn }
output "identity_task_role_arn" { value = aws_iam_role.identity_task.arn }
output "problem_task_role_arn" { value = aws_iam_role.problem_task.arn }
output "submission_task_role_arn" { value = aws_iam_role.submission_task.arn }
output "worker_task_role_arn" { value = aws_iam_role.worker_task.arn }
```

- [ ] **Step 4: Create the ECS cluster and the four pre-created log groups**

Implement:
- cluster name `hexacode-${var.environment}`
- Fargate launch type compatibility
- runtime platform `LINUX/X86_64`
- log groups:
  - `/ecs/hexacode-${var.environment}/identity-service`
  - `/ecs/hexacode-${var.environment}/problem-service`
  - `/ecs/hexacode-${var.environment}/submission-service`
  - `/ecs/hexacode-${var.environment}/worker`
- 30 day retention on each log group

- [ ] **Step 5: Export the cluster values**

```hcl
output "cluster_name" { value = aws_ecs_cluster.main.name }
output "cluster_arn"  { value = aws_ecs_cluster.main.arn }
```

- [ ] **Step 6: Wire both modules into the root configuration and extend root outputs**

```hcl
module "iam" {
  source                = "./modules/iam"
  environment           = var.environment
  application_secret_arn = var.application_secret_arn
  problem_bucket_arn    = module.s3_buckets.problem_bucket_arn
  submission_bucket_arn = module.s3_buckets.submission_bucket_arn
  judge_queue_arn       = module.sqs.judge_queue_arn
  kms_key_arn           = var.kms_key_arn
}

module "ecs_cluster" {
  source      = "./modules/ecs-cluster"
  environment = var.environment
}
```

```hcl
output "ecs_cluster_name" { value = module.ecs_cluster.cluster_name }
output "ecs_cluster_arn"  { value = module.ecs_cluster.cluster_arn }
output "ecs_execution_role_arn" { value = module.iam.ecs_execution_role_arn }
output "identity_task_role_arn" { value = module.iam.identity_task_role_arn }
output "problem_task_role_arn" { value = module.iam.problem_task_role_arn }
output "submission_task_role_arn" { value = module.iam.submission_task_role_arn }
output "worker_task_role_arn" { value = module.iam.worker_task_role_arn }
```

- [ ] **Step 7: Verify the modules in isolation and through the root plan**

Run:
```powershell
terraform -chdir=terraform/modules/iam init -backend=false
terraform -chdir=terraform/modules/iam fmt -check -recursive
terraform -chdir=terraform/modules/iam validate
terraform -chdir=terraform/modules/ecs-cluster init -backend=false
terraform -chdir=terraform/modules/ecs-cluster fmt -check -recursive
terraform -chdir=terraform/modules/ecs-cluster validate
terraform -chdir=terraform plan -target=module.iam -target=module.ecs_cluster
```
Expected: both modules validate, and the plan shows the IAM roles plus the ECS cluster and four log groups.

---

### Task 8: Internal ALB Module

**Files:**
- Create: `terraform/modules/alb/main.tf`
- Create: `terraform/modules/alb/variables.tf`
- Create: `terraform/modules/alb/outputs.tf`
- Modify: `terraform/main.tf`
- Modify: `terraform/outputs.tf`

**Goal:** Create the internal application load balancer, target groups, and route rules from the manifest.

- [ ] **Step 1: Define the module inputs**

```hcl
variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_app_subnet_ids" {
  type = list(string)
}

variable "sg_internal_alb_id" {
  type = string
}
```

- [ ] **Step 2: Create the ALB, listener, target groups, and listener rules**

Implement:
- an internal ALB in the private app subnets
- a listener on port 80 with a fixed 404 default response
- three target groups on port 8000 with `/healthz` health checks
- listener rules with the approved priorities and paths:
  - `/api/auth*`, `/api/dashboard/users*` -> identity target group
  - `/api/submissions*`, `/api/runtimes*`, `/api/dashboard/operations*`, `/internal/judge-jobs*`, `/internal/runtimes*` -> submission target group
  - `/api/problems*`, `/api/tags*`, `/api/dashboard*`, `/internal/problems*`, `/internal/checkers*`, `/internal/cache/public-problems/invalidate` -> problem target group

- [ ] **Step 3: Export the listener and target group ARNs**

```hcl
output "internal_alb_dns_name" { value = aws_lb.internal.dns_name }
output "internal_alb_arn"      { value = aws_lb.internal.arn }
output "internal_alb_listener_arn" { value = aws_lb_listener.http.arn }
output "tg_identity_arn"       { value = aws_lb_target_group.tg_identity.arn }
output "tg_problem_arn"        { value = aws_lb_target_group.tg_problem.arn }
output "tg_submission_arn"     { value = aws_lb_target_group.tg_submission.arn }
```

- [ ] **Step 4: Wire the module into the root configuration and extend root outputs**

```hcl
module "alb" {
  source                = "./modules/alb"
  environment           = var.environment
  vpc_id                = module.vpc.vpc_id
  private_app_subnet_ids = module.vpc.private_app_subnet_ids
  sg_internal_alb_id    = module.security_groups.sg_internal_alb_id
}
```

```hcl
output "internal_alb_dns_name" { value = module.alb.internal_alb_dns_name }
output "internal_alb_arn"      { value = module.alb.internal_alb_arn }
output "internal_alb_listener_arn" { value = module.alb.internal_alb_listener_arn }
output "tg_identity_arn"       { value = module.alb.tg_identity_arn }
output "tg_problem_arn"        { value = module.alb.tg_problem_arn }
output "tg_submission_arn"     { value = module.alb.tg_submission_arn }
```

- [ ] **Step 5: Verify the module in isolation and through the root plan**

Run:
```powershell
terraform -chdir=terraform/modules/alb init -backend=false
terraform -chdir=terraform/modules/alb fmt -check -recursive
terraform -chdir=terraform/modules/alb validate
terraform -chdir=terraform plan -target=module.alb
```
Expected: the module validates and the plan shows one internal ALB, one listener, three target groups, and the four listener rules.

---

### Task 9: ECS Services Module

**Files:**
- Create: `terraform/modules/ecs-services/main.tf`
- Create: `terraform/modules/ecs-services/autoscaling.tf`
- Create: `terraform/modules/ecs-services/variables.tf`
- Create: `terraform/modules/ecs-services/outputs.tf`
- Modify: `terraform/main.tf`
- Modify: `terraform/outputs.tf`

**Goal:** Deploy the four ECS services and their autoscaling policies.

- [ ] **Step 1: Define the module inputs**

```hcl
variable "environment" { type = string }
variable "region" { type = string }
variable "ecs_cluster_name" { type = string }
variable "ecs_execution_role_arn" { type = string }
variable "identity_task_role_arn" { type = string }
variable "problem_task_role_arn" { type = string }
variable "submission_task_role_arn" { type = string }
variable "worker_task_role_arn" { type = string }
variable "tg_identity_arn" { type = string }
variable "tg_problem_arn" { type = string }
variable "tg_submission_arn" { type = string }
variable "private_app_subnet_ids" { type = list(string) }
variable "sg_api_services_id" { type = string }
variable "sg_worker_id" { type = string }
variable "application_secret_arn" { type = string }
variable "ecr_repository_url" { type = string }
variable "image_tag" { type = string }
variable "cognito_user_pool_id" { type = string }
variable "cognito_app_client_id" { type = string }
variable "cognito_issuer" { type = string }
variable "cognito_jwks_url" { type = string }
variable "problem_bucket_name" { type = string }
variable "submission_bucket_name" { type = string }
variable "judge_queue_url" { type = string }
variable "internal_alb_dns_name" { type = string }
```

- [ ] **Step 2: Create the four task definitions and services**

Implement:
- `identity-service` with CPU 256, memory 512, desired count 2, container port 8000, and DATABASE_URL from the application secret
- `problem-service` with CPU 512, memory 2048, desired count 2, container port 8000, DATABASE_URL and REDIS_URL from the application secret
- `submission-service` with CPU 512, memory 1536, desired count 2, container port 8000, DATABASE_URL from the application secret, SQS URL, and internal ALB URL
- `worker` with CPU 1024, memory 2048, desired count 5, no listener attachment, SQS URL, internal ALB URL, and `WORKER_CONCURRENCY = 1`

Each task definition should point at the pre-created CloudWatch log group for its service.

- [ ] **Step 3: Create the autoscaling resources in `autoscaling.tf`**

Implement:
- identity-service: min 2, max 4, CPU target tracking at 60%
- problem-service: min 2, max 8, CPU target tracking at 60% and memory target tracking at 75%
- submission-service: min 2, max 8, CPU target tracking at 60% and memory target tracking at 75%
- worker: min 1, max 20, CloudWatch-alarm-driven queue-depth scaling that keeps backlog near one visible judge job per running task

Use `aws_appautoscaling_target` and `aws_appautoscaling_policy` so the service desired counts are managed by application autoscaling rather than hard-coded service updates.

- [ ] **Step 4: Export the service names**

```hcl
output "identity_service_name" { value = aws_ecs_service.identity_service.name }
output "problem_service_name" { value = aws_ecs_service.problem_service.name }
output "submission_service_name" { value = aws_ecs_service.submission_service.name }
output "worker_service_name" { value = aws_ecs_service.worker.name }
```

- [ ] **Step 5: Wire the module into the root configuration and extend root outputs**

```hcl
module "ecs_services" {
  source = "./modules/ecs-services"

  environment           = var.environment
  region                = var.region
  ecs_cluster_name      = module.ecs_cluster.cluster_name
  ecs_execution_role_arn = module.iam.ecs_execution_role_arn
  identity_task_role_arn = module.iam.identity_task_role_arn
  problem_task_role_arn = module.iam.problem_task_role_arn
  submission_task_role_arn = module.iam.submission_task_role_arn
  worker_task_role_arn   = module.iam.worker_task_role_arn
  tg_identity_arn       = module.alb.tg_identity_arn
  tg_problem_arn        = module.alb.tg_problem_arn
  tg_submission_arn     = module.alb.tg_submission_arn
  private_app_subnet_ids = module.vpc.private_app_subnet_ids
  sg_api_services_id    = module.security_groups.sg_api_services_id
  sg_worker_id          = module.security_groups.sg_worker_id
  application_secret_arn = var.application_secret_arn
  ecr_repository_url    = var.ecr_repository_url
  image_tag             = var.image_tag
  cognito_user_pool_id  = module.cognito.user_pool_id
  cognito_app_client_id = module.cognito.app_client_id
  cognito_issuer        = module.cognito.issuer
  cognito_jwks_url      = module.cognito.jwks_url
  problem_bucket_name   = module.s3_buckets.problem_bucket_name
  submission_bucket_name = module.s3_buckets.submission_bucket_name
  judge_queue_url       = module.sqs.judge_queue_url
  internal_alb_dns_name = module.alb.internal_alb_dns_name
}
```

- [ ] **Step 6: Verify the module in isolation and through the root plan**

Run:
```powershell
terraform -chdir=terraform/modules/ecs-services init -backend=false
terraform -chdir=terraform/modules/ecs-services fmt -check -recursive
terraform -chdir=terraform/modules/ecs-services validate
terraform -chdir=terraform plan -target=module.ecs_services
```
Expected: the module validates and the plan shows four services, four task definitions, and the autoscaling resources described above.

---

### Task 10: Cognito and CORS Lambda Modules

**Files:**
- Create: `terraform/modules/cognito/main.tf`
- Create: `terraform/modules/cognito/variables.tf`
- Create: `terraform/modules/cognito/outputs.tf`
- Create: `terraform/modules/cors-lambda/main.tf`
- Create: `terraform/modules/cors-lambda/index.py`
- Create: `terraform/modules/cors-lambda/variables.tf`
- Create: `terraform/modules/cors-lambda/outputs.tf`
- Modify: `terraform/main.tf`
- Modify: `terraform/outputs.tf`

**Goal:** Create the Cognito user pool/app client and the preflight Lambda that API Gateway uses for OPTIONS requests.

- [ ] **Step 1: Define the Cognito module inputs**

```hcl
variable "environment" {
  type = string
}

variable "region" {
  type = string
}

variable "frontend_domain" {
  type = string
}
```

- [ ] **Step 2: Create the Cognito user pool and SPA client**

Implement:
- email sign-up
- auto-confirm email
- app client without a client secret
- PKCE-capable authorization code flow
- callback and logout URLs derived from `frontend_domain`

Use the issuer format `https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}` and derive the JWKS URL from that issuer.

- [ ] **Step 3: Export the Cognito values**

```hcl
output "user_pool_id" { value = aws_cognito_user_pool.main.id }
output "app_client_id" { value = aws_cognito_user_pool_client.spa.id }
output "issuer" { value = local.issuer }
output "jwks_url" { value = "${local.issuer}/.well-known/jwks.json" }
```

- [ ] **Step 4: Define the CORS Lambda module inputs and implementation**

```hcl
variable "environment" {
  type = string
}

variable "frontend_domain" {
  type = string
}
```

Create `index.py`:

```python
import os

ALLOWED_ORIGIN = os.environ["ALLOWED_ORIGIN"]

def handler(event, context):
    return {
        "statusCode": 204,
        "headers": {
            "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "authorization, content-type, x-correlation-id",
            "Access-Control-Max-Age": "300",
        },
        "body": "",
    }
```

Package it with Terraform’s `archive_file` data source so the Lambda artifact is created during `terraform plan`/`apply` without a manual zip step.

- [ ] **Step 5: Export the CORS Lambda ARN**

```hcl
output "cors_lambda_arn" { value = aws_lambda_function.cors_preflight.arn }
```

- [ ] **Step 6: Wire both modules into the root configuration and extend root outputs**

```hcl
module "cognito" {
  source          = "./modules/cognito"
  environment     = var.environment
  region          = var.region
  frontend_domain = var.frontend_domain
}

module "cors_lambda" {
  source          = "./modules/cors-lambda"
  environment     = var.environment
  frontend_domain = var.frontend_domain
}
```

```hcl
output "cognito_user_pool_id" { value = module.cognito.user_pool_id }
output "cognito_app_client_id" { value = module.cognito.app_client_id }
output "cognito_issuer" { value = module.cognito.issuer }
output "cognito_jwks_url" { value = module.cognito.jwks_url }
output "cors_lambda_arn" { value = module.cors_lambda.cors_lambda_arn }
```

- [ ] **Step 7: Verify both modules in isolation and through the root plan**

Run:
```powershell
terraform -chdir=terraform/modules/cognito init -backend=false
terraform -chdir=terraform/modules/cognito fmt -check -recursive
terraform -chdir=terraform/modules/cognito validate
terraform -chdir=terraform/modules/cors-lambda init -backend=false
terraform -chdir=terraform/modules/cors-lambda fmt -check -recursive
terraform -chdir=terraform/modules/cors-lambda validate
terraform -chdir=terraform plan -target=module.cognito -target=module.cors_lambda
```
Expected: both modules validate, and the plan shows one user pool, one app client, one Lambda function, one IAM role for the Lambda, and the packaged artifact.

---

### Task 11: API Gateway and CloudFront Modules, Then Final Integration

**Files:**
- Create: `terraform/modules/api-gateway/main.tf`
- Create: `terraform/modules/api-gateway/variables.tf`
- Create: `terraform/modules/api-gateway/outputs.tf`
- Create: `terraform/modules/cloudfront/main.tf`
- Create: `terraform/modules/cloudfront/variables.tf`
- Create: `terraform/modules/cloudfront/outputs.tf`
- Modify: `terraform/main.tf`
- Modify: `terraform/outputs.tf`

**Goal:** Create the public HTTP API front door and the CloudFront distribution for the frontend.

- [ ] **Step 1: Define the API Gateway module inputs**

```hcl
variable "environment" {
  type = string
}

variable "frontend_domain" {
  type = string
}

variable "private_app_subnet_ids" {
  type = list(string)
}

variable "sg_apigw_vpclink_id" {
  type = string
}

variable "internal_alb_listener_arn" {
  type = string
}

variable "chat_lambda_arn" {
  type = string
}

variable "cors_lambda_arn" {
  type = string
}
```

- [ ] **Step 2: Create the HTTP API, VPC Link, integrations, routes, and default stage**

Implement:
- HTTP API, not REST
- `$default` stage with auto deploy
- VPC Link into the private app subnets using `sg_apigw_vpclink_id`
- `ANY /api/{proxy+}` to the internal ALB listener
- `POST /api/chat/messages` to the chat Lambda ARN
- `OPTIONS /api/{proxy+}` to the CORS Lambda ARN
- CORS configuration limited to `frontend_domain`
- access logs retained for 30 days

- [ ] **Step 3: Export the public API values**

```hcl
output "http_api_endpoint" { value = aws_apigatewayv2_api.http_api.api_endpoint }
output "http_api_id" { value = aws_apigatewayv2_api.http_api.id }
output "vpc_link_id" { value = aws_apigatewayv2_vpc_link.alb_vpclink.id }
```

- [ ] **Step 4: Define the CloudFront module inputs and create the distribution**

```hcl
variable "environment" {
  type = string
}

variable "frontend_bucket_name" {
  type = string
}

variable "frontend_bucket_arn" {
  type = string
}
```

Implement:
- CloudFront origin access control for the S3 origin
- an origin pointing at the frontend bucket
- redirect HTTP to HTTPS
- allowed methods GET/HEAD/OPTIONS
- default root object `index.html`
- custom 403 and 404 responses that rewrite to `/index.html` with 200
- a bucket policy that grants CloudFront OAC read-only access to the frontend bucket

- [ ] **Step 5: Export the CloudFront values**

```hcl
output "distribution_domain_name" { value = aws_cloudfront_distribution.frontend.domain_name }
output "distribution_id" { value = aws_cloudfront_distribution.frontend.id }
```

- [ ] **Step 6: Wire both modules into the root configuration and extend root outputs**

```hcl
module "api_gateway" {
  source                  = "./modules/api-gateway"
  environment             = var.environment
  frontend_domain         = var.frontend_domain
  private_app_subnet_ids  = module.vpc.private_app_subnet_ids
  sg_apigw_vpclink_id     = module.security_groups.sg_apigw_vpclink_id
  internal_alb_listener_arn = module.alb.internal_alb_listener_arn
  chat_lambda_arn         = var.chat_lambda_arn
  cors_lambda_arn         = module.cors_lambda.cors_lambda_arn
}

module "cloudfront" {
  source              = "./modules/cloudfront"
  environment         = var.environment
  frontend_bucket_name = module.s3_buckets.frontend_bucket_name
  frontend_bucket_arn  = module.s3_buckets.frontend_bucket_arn
}
```

```hcl
output "api_gateway_url" { value = module.api_gateway.http_api_endpoint }
output "api_gateway_id" { value = module.api_gateway.http_api_id }
output "cloudfront_domain" { value = module.cloudfront.distribution_domain_name }
output "cloudfront_distribution_id" { value = module.cloudfront.distribution_id }
```

- [ ] **Step 7: Run the final root validation and plan**

Run:
```powershell
terraform -chdir=terraform fmt -check -recursive
terraform -chdir=terraform validate
terraform -chdir=terraform plan
```
Expected: the full root plan is valid and shows the complete stack in dependency order.

- [ ] **Step 8: Run the post-apply smoke checks from the spec**

After `terraform apply`, run:
```powershell
terraform output api_gateway_url
terraform output cloudfront_domain
terraform output cognito_jwks_url
aws ecs describe-services --cluster (terraform output -raw ecs_cluster_name) --services (terraform output -raw identity_service_name) (terraform output -raw problem_service_name) (terraform output -raw submission_service_name) (terraform output -raw worker_service_name)
aws elbv2 describe-target-health --target-group-arn (terraform output -raw tg_identity_arn)
aws cognito-idp describe-user-pool --user-pool-id (terraform output -raw cognito_user_pool_id)
```
Expected: the API URL resolves, CloudFront serves the frontend, Cognito is ACTIVE, the ECS services are running, and the ALB target groups are healthy.

---

## Coverage Check

- 3.1 VPC -> Task 2
- 3.2 Security Groups -> Task 3
- 3.3 S3 Buckets -> Task 4
- 3.4 SQS -> Task 5
- 3.5 RDS -> Task 6
- 3.6 ElastiCache -> Task 6
- 3.7 IAM -> Task 7
- 3.8 ECS Cluster -> Task 7
- 3.9 ECS Services -> Task 9
- 3.10 Internal ALB -> Task 8
- 3.11 Cognito -> Task 10
- 3.12 API Gateway -> Task 11
- 3.13 CORS Lambda -> Task 10
- 3.14 CloudFront -> Task 11

Notes:
- Interface VPC endpoints require a module-local endpoint security group inside `modules/vpc`; the design doc lists the endpoints but not their SG, so this plan adds that implementation detail in the VPC module only.
- The frontend bucket is owned by the S3 module, so later modules consume its name and ARN via outputs instead of taking a separate root input.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-11-terraform-infrastructure.md`.

Two execution options:

1. Subagent-Driven (recommended) — I dispatch a fresh subagent per task and review between tasks.
2. Inline Execution — I execute the tasks in this session with checkpointed reviews.

Which approach?
