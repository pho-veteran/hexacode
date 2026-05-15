# Bedrock KB Auto Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a simple S3 object change trigger that starts Bedrock Knowledge Base ingestion for Hexacode problem assets.

**Architecture:** Extend the existing Terraform `bedrock-chat` module with one Lambda packaged from a new Python file. The problem assets bucket sends `s3:ObjectCreated:*` events for the configured KB source prefix to that Lambda, and the Lambda calls `bedrock-agent:start_ingestion_job` for the module-managed knowledge base and data source.

**Tech Stack:** Terraform AWS provider, Python 3.12 Lambda, Amazon S3 notifications, Amazon Bedrock Agent control plane.

---

## File Structure

- Create `terraform/modules/bedrock-chat/kb_sync.py` — Lambda handler that starts KB ingestion and ignores already-running conflicts.
- Modify `terraform/modules/bedrock-chat/main.tf` — package/deploy Lambda, grant IAM permissions, add S3 invoke permission, and configure bucket notification.
- Modify `terraform/modules/bedrock-chat/variables.tf` — add `knowledge_source_bucket_id` so Terraform can attach notifications to the bucket.
- Modify `terraform/main.tf` — pass the problem bucket ID to the module.
- Modify `terraform/modules/s3-buckets/outputs.tf` if no problem bucket ID output exists.

### Task 1: Add bucket ID output if missing

**Files:**
- Modify: `terraform/modules/s3-buckets/outputs.tf`

- [ ] Check whether `problem_bucket_id` exists. If missing, add:

```hcl
output "problem_bucket_id" {
  description = "ID/name of the problem assets S3 bucket"
  value       = aws_s3_bucket.problem_assets.id
}
```

- [ ] Run formatting:

```powershell
terraform fmt -recursive terraform
```

### Task 2: Add sync Lambda handler

**Files:**
- Create: `terraform/modules/bedrock-chat/kb_sync.py`

- [ ] Create this handler:

```python
import json
import os

import boto3
from botocore.exceptions import ClientError


bedrock_agent = boto3.client("bedrock-agent")


def handler(event, context):
    knowledge_base_id = os.environ["KNOWLEDGE_BASE_ID"]
    data_source_id = os.environ["DATA_SOURCE_ID"]

    records = event.get("Records", [])
    print(json.dumps({"message": "kb sync trigger received", "record_count": len(records)}))

    try:
        response = bedrock_agent.start_ingestion_job(
            knowledgeBaseId=knowledge_base_id,
            dataSourceId=data_source_id,
            description="Hexacode automatic S3 problem asset sync",
        )
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "")
        message = error.response.get("Error", {}).get("Message", "")
        if code in {"ConflictException", "ThrottlingException"} or "ingestion job" in message.lower():
            print(json.dumps({"message": "kb sync skipped", "code": code, "detail": message}))
            return {"statusCode": 202, "body": "sync already running or throttled"}
        raise

    ingestion_job = response.get("ingestionJob", {})
    print(json.dumps({"message": "kb sync started", "ingestion_job_id": ingestion_job.get("ingestionJobId")}))
    return {"statusCode": 202, "body": "sync started"}
```

### Task 3: Wire Terraform resources

**Files:**
- Modify: `terraform/modules/bedrock-chat/variables.tf`
- Modify: `terraform/modules/bedrock-chat/main.tf`
- Modify: `terraform/main.tf`

- [ ] Add variable:

```hcl
variable "knowledge_source_bucket_id" {
  description = "S3 bucket ID/name that stores problem/catalog documents for Bedrock ingestion"
  type        = string
}
```

- [ ] Pass it from root module:

```hcl
knowledge_source_bucket_id  = module.s3_buckets.problem_bucket_id
knowledge_source_bucket_arn = module.s3_buckets.problem_bucket_arn
```

- [ ] Add archive, IAM role/policy, Lambda, permission, and S3 notification to `terraform/modules/bedrock-chat/main.tf` after the data source resource:

```hcl
data "archive_file" "kb_sync_lambda_zip" {
  type        = "zip"
  source_file = "${path.module}/kb_sync.py"
  output_path = "${path.module}/kb_sync_lambda.zip"
}

resource "aws_iam_role" "kb_sync_lambda" {
  name = "${local.name_prefix}-kb-sync-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "kb_sync_lambda_basic" {
  role       = aws_iam_role.kb_sync_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "kb_sync_lambda_bedrock" {
  name = "${local.name_prefix}-kb-sync-lambda-bedrock"
  role = aws_iam_role.kb_sync_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:StartIngestionJob"
        ]
        Resource = aws_bedrockagent_knowledge_base.hexacode.arn
      }
    ]
  })
}

resource "aws_lambda_function" "kb_sync" {
  filename         = data.archive_file.kb_sync_lambda_zip.output_path
  function_name    = "${local.name_prefix}-kb-sync"
  role             = aws_iam_role.kb_sync_lambda.arn
  handler          = "kb_sync.handler"
  source_code_hash = data.archive_file.kb_sync_lambda_zip.output_base64sha256
  runtime          = "python3.12"
  timeout          = 30
  memory_size      = 128

  environment {
    variables = {
      KNOWLEDGE_BASE_ID = aws_bedrockagent_knowledge_base.hexacode.id
      DATA_SOURCE_ID    = aws_bedrockagent_data_source.problem_assets.data_source_id
    }
  }

  tags = {
    Name = "${local.name_prefix}-kb-sync"
  }
}

resource "aws_lambda_permission" "allow_problem_bucket_kb_sync" {
  statement_id  = "AllowExecutionFromProblemBucket"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.kb_sync.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = var.knowledge_source_bucket_arn
}

resource "aws_s3_bucket_notification" "problem_assets_kb_sync" {
  bucket = var.knowledge_source_bucket_id

  lambda_function {
    lambda_function_arn = aws_lambda_function.kb_sync.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = var.knowledge_source_prefixes[0]
  }

  depends_on = [aws_lambda_permission.allow_problem_bucket_kb_sync]
}
```

- [ ] Run formatting:

```powershell
terraform fmt -recursive terraform
```

### Task 4: Validate

**Files:**
- Validate Terraform only

- [ ] Run:

```powershell
terraform -chdir=terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] If provider initialization is missing, run:

```powershell
terraform -chdir=terraform init
terraform -chdir=terraform validate
```

Expected: `Success! The configuration is valid.`
