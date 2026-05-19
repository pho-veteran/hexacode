terraform {
  required_providers {
    opensearch = {
      source  = "opensearch-project/opensearch"
      version = "~> 2.3"
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_iam_policy_document" "opensearch_bootstrap" {
  statement {
    actions = [
      "aoss:APIAccessAll"
    ]

    resources = [
      aws_opensearchserverless_collection.kb.arn
    ]
  }
}

provider "opensearch" {
  url               = aws_opensearchserverless_collection.kb.collection_endpoint
  healthcheck       = false
  aws_region        = var.region
  sign_aws_requests = true
}

locals {
  name_prefix = "hexacode-${var.environment}"

  agent_instruction = <<-EOT
    You are Hexacode's coding judge assistant. Help contestants understand platform navigation, problem statements, constraints, examples, submission behavior, and common debugging approaches without giving away complete accepted solutions. When a user asks for direct answers to an active problem, guide them with hints, explain concepts, and suggest how to test their reasoning. Prefer concise, practical answers grounded in the retrieved Hexacode problem catalog and platform documentation. If retrieved context is insufficient, say what information is missing instead of inventing details.
  EOT

  embedding_model_arn = "arn:${data.aws_partition.current.partition}:bedrock:${var.region}::foundation-model/${var.embedding_model_id}"
}

# =============================================================================
# OpenSearch Serverless vector store for Bedrock Knowledge Base
# =============================================================================
resource "aws_opensearchserverless_security_policy" "kb_encryption" {
  name = "hxc-${var.environment}-kb-enc"
  type = "encryption"

  policy = jsonencode({
    Rules = [
      {
        Resource = [
          "collection/${local.name_prefix}-kb"
        ]
        ResourceType = "collection"
      }
    ]
    AWSOwnedKey = true
  })
}

resource "aws_opensearchserverless_security_policy" "kb_network" {
  name = "hxc-${var.environment}-kb-net"
  type = "network"

  policy = jsonencode([
    {
      Rules = [
        {
          Resource = [
            "collection/${local.name_prefix}-kb"
          ]
          ResourceType = "collection"
        },
        {
          Resource = [
            "collection/${local.name_prefix}-kb"
          ]
          ResourceType = "dashboard"
        }
      ]
      AllowFromPublic = true
    }
  ])
}

resource "aws_opensearchserverless_collection" "kb" {
  name = "${local.name_prefix}-kb"
  type = "VECTORSEARCH"

  depends_on = [
    aws_opensearchserverless_security_policy.kb_encryption,
    aws_opensearchserverless_security_policy.kb_network
  ]

  tags = {
    Name = "${local.name_prefix}-kb"
  }
}

# =============================================================================
# Bedrock execution roles
# =============================================================================
resource "aws_iam_role" "knowledge_base" {
  name = "${local.name_prefix}-bedrock-kb"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "bedrock.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "knowledge_base" {
  name = "${local.name_prefix}-bedrock-kb"
  role = aws_iam_role.knowledge_base.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel"
        ]
        Resource = local.embedding_model_arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          var.knowledge_source_bucket_arn,
          "${var.knowledge_source_bucket_arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "aoss:APIAccessAll"
        ]
        Resource = aws_opensearchserverless_collection.kb.arn
      }
    ]
  })
}

resource "aws_iam_role" "agent" {
  name = "${local.name_prefix}-bedrock-agent"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "bedrock.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "agent" {
  name = "${local.name_prefix}-bedrock-agent"
  role = aws_iam_role.agent.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel"
        ]
        Resource = [
          "arn:${data.aws_partition.current.partition}:bedrock:${var.region}:${data.aws_caller_identity.current.account_id}:inference-profile/${var.agent_foundation_model}",
          "arn:${data.aws_partition.current.partition}:bedrock:*::foundation-model/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "bedrock:Retrieve"
        ]
        Resource = aws_bedrockagent_knowledge_base.hexacode.arn
      }
    ]
  })
}

resource "aws_iam_user_policy" "opensearch_bootstrap" {
  name   = "${local.name_prefix}-opensearch-bootstrap"
  user   = element(split("/", data.aws_caller_identity.current.arn), 1)
  policy = data.aws_iam_policy_document.opensearch_bootstrap.json
}

resource "aws_opensearchserverless_access_policy" "kb_data" {
  name = "hxc-${var.environment}-kb-data"
  type = "data"

  policy = jsonencode([
    {
      Rules = [
        {
          ResourceType = "collection"
          Resource = [
            "collection/${local.name_prefix}-kb"
          ]
          Permission = [
            "aoss:DescribeCollectionItems",
            "aoss:CreateCollectionItems",
            "aoss:UpdateCollectionItems"
          ]
        },
        {
          ResourceType = "index"
          Resource = [
            "index/${local.name_prefix}-kb/*"
          ]
          Permission = [
            "aoss:CreateIndex",
            "aoss:DeleteIndex",
            "aoss:UpdateIndex",
            "aoss:DescribeIndex",
            "aoss:ReadDocument",
            "aoss:WriteDocument"
          ]
        }
      ]
      Principal = [
        aws_iam_role.knowledge_base.arn,
        data.aws_caller_identity.current.arn
      ]
    }
  ])
}

resource "opensearch_index" "knowledge_base" {
  name      = "hexacode-knowledge-index"
  index_knn = true

  mappings = jsonencode({
    properties = {
      "bedrock-knowledge-base-default-vector" = {
        type      = "knn_vector"
        dimension = 1536
        method = {
          name       = "hnsw"
          engine     = "faiss"
          space_type = "l2"
        }
      }
      "AMAZON_BEDROCK_TEXT_CHUNK" = {
        type = "text"
      }
      "AMAZON_BEDROCK_METADATA" = {
        type  = "text"
        index = false
      }
    }
  })

  force_destroy = true

  lifecycle {
    ignore_changes = [
      mappings,
      number_of_replicas,
      number_of_shards,
      rollover_alias
    ]
  }

  depends_on = [
    aws_iam_user_policy.opensearch_bootstrap,
    aws_opensearchserverless_access_policy.kb_data,
    aws_opensearchserverless_collection.kb
  ]
}

# =============================================================================
# Bedrock Knowledge Base and Agent
# =============================================================================
resource "aws_bedrockagent_knowledge_base" "hexacode" {
  name     = "${local.name_prefix}-knowledge-base"
  role_arn = aws_iam_role.knowledge_base.arn

  knowledge_base_configuration {
    type = "VECTOR"

    vector_knowledge_base_configuration {
      embedding_model_arn = local.embedding_model_arn
    }
  }

  storage_configuration {
    type = "OPENSEARCH_SERVERLESS"

    opensearch_serverless_configuration {
      collection_arn    = aws_opensearchserverless_collection.kb.arn
      vector_index_name = "hexacode-knowledge-index"

      field_mapping {
        vector_field   = "bedrock-knowledge-base-default-vector"
        text_field     = "AMAZON_BEDROCK_TEXT_CHUNK"
        metadata_field = "AMAZON_BEDROCK_METADATA"
      }
    }
  }

  depends_on = [
    aws_iam_role_policy.knowledge_base,
    opensearch_index.knowledge_base
  ]

  tags = {
    Name = "${local.name_prefix}-knowledge-base"
  }
}

resource "aws_bedrockagent_data_source" "problem_assets" {
  knowledge_base_id = aws_bedrockagent_knowledge_base.hexacode.id
  name              = "${local.name_prefix}-problem-assets"
  description       = "Hexacode problem catalog and platform context from S3"

  data_source_configuration {
    type = "S3"

    s3_configuration {
      bucket_arn         = var.knowledge_source_bucket_arn
      inclusion_prefixes = var.knowledge_source_prefixes
    }
  }

  vector_ingestion_configuration {
    chunking_configuration {
      chunking_strategy = "FIXED_SIZE"

      fixed_size_chunking_configuration {
        max_tokens         = 500
        overlap_percentage = 20
      }
    }
  }
}

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
    events              = ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
    filter_prefix       = var.knowledge_source_prefixes[0]
  }

  depends_on = [aws_lambda_permission.allow_problem_bucket_kb_sync]
}

resource "aws_bedrockagent_agent" "hexacode" {
  agent_name                  = "${local.name_prefix}-chat-agent"
  agent_resource_role_arn     = aws_iam_role.agent.arn
  foundation_model            = var.agent_foundation_model
  instruction                 = trimspace(local.agent_instruction)
  idle_session_ttl_in_seconds = 1800
  prepare_agent               = true

  depends_on = [aws_iam_role_policy.agent]
}

resource "aws_bedrockagent_agent_knowledge_base_association" "hexacode" {
  agent_id             = aws_bedrockagent_agent.hexacode.agent_id
  agent_version        = "DRAFT"
  knowledge_base_id    = aws_bedrockagent_knowledge_base.hexacode.id
  knowledge_base_state = "ENABLED"
  description          = "Hexacode problem catalog retrieval"
}

resource "aws_bedrockagent_agent_alias" "live_profile" {
  agent_id         = aws_bedrockagent_agent.hexacode.agent_id
  agent_alias_name = "live-profile"
  description      = "Live Hexacode chat agent alias with inference profile"

  depends_on = [aws_bedrockagent_agent_knowledge_base_association.hexacode]
}

# =============================================================================
# Chat Lambda and API integration target
# =============================================================================
data "archive_file" "chat_lambda_zip" {
  type        = "zip"
  source_file = "${path.module}/index.py"
  output_path = "${path.module}/chat_lambda.zip"
}

resource "aws_iam_role" "chat_lambda" {
  name = "${local.name_prefix}-chat-lambda"

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

resource "aws_iam_role_policy_attachment" "chat_lambda_basic" {
  role       = aws_iam_role.chat_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "chat_lambda_bedrock" {
  name = "${local.name_prefix}-chat-lambda-bedrock"
  role = aws_iam_role.chat_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeAgent"
        ]
        Resource = aws_bedrockagent_agent_alias.live_profile.agent_alias_arn
      }
    ]
  })
}

resource "aws_lambda_function" "chat" {
  filename                       = data.archive_file.chat_lambda_zip.output_path
  function_name                  = "${local.name_prefix}-chat"
  role                           = aws_iam_role.chat_lambda.arn
  handler                        = "index.handler"
  source_code_hash               = data.archive_file.chat_lambda_zip.output_base64sha256
  runtime                        = "python3.12"
  timeout                        = var.chat_lambda_timeout_seconds
  memory_size                    = 256
  reserved_concurrent_executions = var.reserved_concurrent_executions
  publish                        = var.provisioned_concurrent_executions > 0

  environment {
    variables = {
      ALLOWED_ORIGIN = var.frontend_domain
      AGENT_ID       = aws_bedrockagent_agent.hexacode.agent_id
      AGENT_ALIAS_ID = aws_bedrockagent_agent_alias.live_profile.agent_alias_id
    }
  }

  tags = {
    Name = "${local.name_prefix}-chat"
  }
}

resource "aws_lambda_alias" "chat_live" {
  count = var.provisioned_concurrent_executions > 0 ? 1 : 0

  name             = "live"
  function_name    = aws_lambda_function.chat.function_name
  function_version = aws_lambda_function.chat.version
}

resource "aws_lambda_provisioned_concurrency_config" "chat" {
  count = var.provisioned_concurrent_executions > 0 ? 1 : 0

  function_name                     = aws_lambda_function.chat.function_name
  qualifier                         = aws_lambda_alias.chat_live[0].name
  provisioned_concurrent_executions = var.provisioned_concurrent_executions
}

resource "aws_cloudwatch_metric_alarm" "chat_lambda_errors" {
  alarm_name          = "${local.name_prefix}-chat-lambda-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = var.chat_lambda_error_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.chat.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "chat_lambda_throttles" {
  alarm_name          = "${local.name_prefix}-chat-lambda-throttles"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = var.chat_lambda_throttle_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.chat.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "chat_lambda_duration_high" {
  alarm_name          = "${local.name_prefix}-chat-lambda-duration-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Average"
  threshold           = var.chat_lambda_duration_threshold_ms
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.chat.function_name
  }
}
